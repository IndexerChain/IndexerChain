/**
 * Phase 46: Unified Sync Manager - 统一区块同步 + 分叉处理 + 多节点竞争挖矿
 * 
 * 实现完整的统一同步方案：
 * - 3层决策逻辑：StateLock > P2P Majority > Signal RootTip > Shadow > Local
 * - 3层同步方式：Warp Sync (1000+) > Chunk Sync (100-1000) > FastSync500 (<500)
 * - 核心保证：永远不因为高度差距大而回滚到0，只在真正分叉时才回滚
 * 
 * 核心目标：
 * 1. 只要有可信 rootTip 或多数 Peer，一定能自动同步
 * 2. 非真正分叉绝不回滚（不能误判）
 * 3. 真正分叉时必须自动修复
 * 4. 每个节点都能最终收敛到唯一链
 * 5. 允许多个节点同时挖矿（但最终只有一个链）
 * 6. 手机、掉线上线、后台运行，都能恢复正确状态
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import type { BlockHeader, Block } from "./types.js";
import { getStateLockManager } from "./stateLockManager.js";
import { getWarpSyncManager } from "./warpSync.js";
import { getChunkBasedSyncManager } from "./chunkBasedSync.js";
import { hashBlockHeader } from "./crypto.js";

export interface RootTip {
  latestHeight: number;
  latestHeader?: BlockHeader;
  latestHeaderHash: string;
  recentHeaders?: Array<{ height: number; hash: string } | BlockHeader>;
  latestSnapshotMeta?: any;
  stateCommitment?: string;
}

// Phase 47: Callback for UI status updates (instead of logging)
export type SyncStatusCallback = (message: string) => void;

export interface UnifiedSyncResult {
  success: boolean;
  synced: boolean;
  method: "statelock" | "warp" | "chunk" | "fast" | "none" | "bootstrap" | "bootstrap+chunk";
  fromHeight: number;
  toHeight: number;
  error?: string;
}

/**
 * Find common ancestor between local chain and recent headers
 * 
 * Only checks recent 200-500 blocks to find the common ancestor.
 * Returns the height of the common ancestor, or null if not found.
 */
export async function findCommonAncestor(
  chainContext: ChainContext,
  _localTip: Block,
  recentHeaders: Array<{ height: number; hash: string } | BlockHeader>,
  maxCheckDepth: number = 500
): Promise<{ height: number; hash: string } | null> {
  if (!recentHeaders || recentHeaders.length === 0) {
    return null;
  }

  // Convert recent headers to a map of hash -> height for fast lookup
  const recentHashes = new Map<string, number>();
  for (const header of recentHeaders) {
    let hash: string;
    if ("hash" in header && header.hash) {
      hash = header.hash;
    } else {
      // It's a BlockHeader, need to compute hash
      try {
        hash = await hashBlockHeader(header as BlockHeader);
      } catch {
        continue;
      }
    }
    
    const height = (header as any).height || 0;
    if (height > 0 && hash) {
      recentHashes.set(hash, height);
    }
  }

  // Get all local blocks
  const allBlocks = chainContext.storage.getAllBlocks();
  
  // Check from local tip backwards, up to maxCheckDepth blocks
  const checkRange = Math.min(maxCheckDepth, allBlocks.length);
  const startIndex = Math.max(0, allBlocks.length - checkRange);
  
  for (let i = allBlocks.length - 1; i >= startIndex; i--) {
    const block = allBlocks[i];
    if (recentHashes.has(block.hash)) {
      // Found common ancestor
      // Found common ancestor
      return {
        height: block.header.height,
        hash: block.hash,
      };
    }
  }

  // No common ancestor found in recent blocks
  return null;
}

/**
 * Fast Sync 500 - Sync when gap is less than 500 blocks
 * 
 * Uses recent headers to quickly sync to target height.
 */
async function fastSync500(
  chainContext: ChainContext,
  p2pNode: P2PNode,
  targetHeight: number,
  _recentHeaders?: Array<{ height: number; hash: string } | BlockHeader>
): Promise<UnifiedSyncResult> {
  const localTip = chainContext.storage.getTip();
  const localHeight = localTip?.header.height ?? -1;
  const heightDiff = targetHeight - localHeight;

  if (heightDiff <= 0) {
    return {
      success: true,
      synced: false,
      method: "none",
      fromHeight: localHeight,
      toHeight: targetHeight,
    };
  }

  if (heightDiff >= 500) {
    // Too large for fast sync, should use chunk sync instead
    return {
      success: true,
      synced: false,
      method: "none",
      fromHeight: localHeight,
      toHeight: targetHeight,
    };
  }

  // Starting fast sync

  // Use chunk-based sync for gaps < 500
  const chunkSyncManager = getChunkBasedSyncManager();
  chunkSyncManager.init(chainContext, p2pNode);

  try {
    const result = await chunkSyncManager.syncMissingBlocks(localHeight + 1, targetHeight);
    
    if (result.success) {
      // Fast sync completed
      return {
        success: true,
        synced: result.missingBlocks > 0,
        method: "fast",
        fromHeight: localHeight,
        toHeight: targetHeight,
      };
    } else {
      return {
        success: false,
        synced: false,
        method: "fast",
        fromHeight: localHeight,
        toHeight: targetHeight,
        error: "Chunk sync failed",
      };
    }
  } catch (error) {
    // Fast sync failed
    return {
      success: false,
      synced: false,
      method: "fast",
      fromHeight: localHeight,
      toHeight: targetHeight,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Chunk Sync - Sync when gap is 100-1000 blocks
 */
async function chunkSync(
  chainContext: ChainContext,
  p2pNode: P2PNode,
  fromHeight: number,
  toHeight: number,
  statusCallback?: SyncStatusCallback
): Promise<UnifiedSyncResult> {
  // Starting chunk sync

  // Phase 47: Wait for peer connections AND data channels to be open
  // This is especially important for genesis sync when peers may still be connecting
  const getAvailablePeerCount = (): number => {
    if (!p2pNode.peers) return 0;
    return Array.from(p2pNode.peers.values()).filter((p: any) => 
      p.connected && p.dataChannel && p.dataChannel.readyState === 'open'
    ).length;
  };
  
  let availablePeerCount = getAvailablePeerCount();
  if (availablePeerCount === 0) {
    if (statusCallback) {
      statusCallback(`Waiting for peer data channels to open...`);
    }
    
    // Wait up to 20 seconds for data channels to open
    const maxWaitTime = 20000;
    const checkInterval = 500;
    const startTime = Date.now();
    
    while (availablePeerCount === 0 && Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      availablePeerCount = getAvailablePeerCount();
      
      if (statusCallback && (Date.now() - startTime) % 3000 < checkInterval) {
        const totalPeers = p2pNode.getPeerCount();
        statusCallback(`Waiting for data channels... (${totalPeers} peer(s) connected, ${availablePeerCount} data channel(s) open)`);
      }
    }
    
    if (availablePeerCount === 0) {
      // Still no data channels after waiting
      const totalPeers = p2pNode.getPeerCount();
      if (statusCallback) {
        statusCallback(`No data channels available (${totalPeers} peer(s) connected but data channels not open). Please wait...`);
      }
      return {
        success: false,
        synced: false,
        method: "chunk",
        fromHeight,
        toHeight,
        error: `No data channels available (${totalPeers} peer(s) connected but data channels not open)`,
      };
    }
  }

  // Phase 47: Before starting chunk sync, check if we have any availableFromHeight hints
  // If peers don't have the blocks we need, try requesting from signal server first
  if (fromHeight === 1 && typeof window !== "undefined") {
    const availableFromHeight = (window as any).lastAvailableFromHeight;
    if (availableFromHeight && availableFromHeight > 1) {
      if (statusCallback) {
        statusCallback(`Peers don't have blocks from height 1. Trying signal server...`);
      }
      
      // Note: Signal server doesn't currently store blocks, so we can't request from it
      // The signal server only stores rootTip (headers) and snapshot metadata
      // We need to rely on warp sync or wait for peers with blocks
      
      // If signal server didn't help, return error to trigger warp sync
      return {
        success: false,
        synced: false,
        method: "chunk",
        fromHeight,
        toHeight,
        error: `Peers don't have blocks from height 1 (available from ${availableFromHeight}). Need warp sync.`,
      };
    }
  }

  const chunkSyncManager = getChunkBasedSyncManager();
  chunkSyncManager.init(chainContext, p2pNode);

  try {
    const result = await chunkSyncManager.syncMissingBlocks(fromHeight, toHeight);
    
    if (result.success) {
      // Check if we actually received any blocks
      const actualLocalHeight = chainContext.storage.getTip()?.header.height ?? -1;
      const actuallySynced = actualLocalHeight >= toHeight;
      
      if (result.missingBlocks > 0 && !actuallySynced) {
        // Requested blocks but didn't receive them - wait longer and check again
        // This is especially important for genesis sync (fromHeight === 1)
        if (fromHeight === 1) {
          if (statusCallback) {
            statusCallback(`Waiting for blocks to arrive...`);
          }
          
          // Wait up to 15 seconds for blocks to arrive
          const maxWaitTime = 15000;
          const checkInterval = 1000;
          const startTime = Date.now();
          let currentHeight = actualLocalHeight;
          
          while (Date.now() - startTime < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            
            // Re-check local height
            const newTip = chainContext.storage.getTip();
            const newHeight = newTip?.header.height ?? -1;
            
            if (newHeight > currentHeight) {
              // Blocks arriving
              currentHeight = newHeight;
              
              if (statusCallback) {
                statusCallback(`Received blocks: height ${newHeight}/${toHeight}...`);
              }
              
              // If we've reached target, we're done
              if (newHeight >= toHeight) {
                return {
                  success: true,
                  synced: true,
                  method: "chunk",
                  fromHeight,
                  toHeight,
                };
              }
            }
            
            // Check if we got availableFromHeight hint during wait
            if (typeof window !== "undefined") {
              const availableFromHeight = (window as any).lastAvailableFromHeight;
              if (availableFromHeight && availableFromHeight > 1 && currentHeight === 0) {
                // Peers don't have blocks from height 1, need warp sync
                if (statusCallback) {
                  statusCallback(`Peers don't have blocks from height 1. Trying warp sync...`);
                }
                return {
                  success: false,
                  synced: false,
                  method: "chunk",
                  fromHeight,
                  toHeight,
                  error: `Peers don't have blocks from height 1 (available from ${availableFromHeight}). Need warp sync.`,
                };
              }
            }
          }
          
          // After waiting, check final state
          const finalTip = chainContext.storage.getTip();
          const finalHeight = finalTip?.header.height ?? -1;
          const finalSynced = finalHeight >= toHeight;
          
          if (finalSynced) {
            // Chunk sync completed after wait
            return {
              success: true,
              synced: true,
              method: "chunk",
              fromHeight,
              toHeight,
            };
          } else {
            // Still waiting for blocks - check if we need warp sync
            if (typeof window !== "undefined") {
              const availableFromHeight = (window as any).lastAvailableFromHeight;
              if (availableFromHeight && availableFromHeight > 1 && finalHeight === 0) {
                if (statusCallback) {
                  statusCallback(`Peers don't have blocks from height 1. Trying warp sync...`);
                }
                return {
                  success: false,
                  synced: false,
                  method: "chunk",
                  fromHeight,
                  toHeight,
                  error: `Peers don't have blocks from height 1 (available from ${availableFromHeight}). Need warp sync.`,
                };
              }
            }
            
            // Still waiting for blocks
            return {
              success: true,
              synced: false,
              method: "chunk",
              fromHeight,
              toHeight,
              error: `Blocks requested but not yet received (current: ${finalHeight}, target: ${toHeight})`,
            };
          }
        } else {
          // For non-genesis sync, just warn and return
          // Requested chunks but local height still behind
          return {
            success: true,
            synced: false,
            method: "chunk",
            fromHeight,
            toHeight,
            error: "Blocks requested but not yet received",
          };
        }
      }
      
      // Chunk sync completed
      return {
        success: true,
        synced: actuallySynced || result.missingBlocks === 0,
        method: "chunk",
        fromHeight,
        toHeight,
      };
    } else {
      return {
        success: false,
        synced: false,
        method: "chunk",
        fromHeight,
        toHeight,
        error: "Chunk sync failed",
      };
    }
  } catch (error) {
    // Chunk sync failed
    return {
      success: false,
      synced: false,
      method: "chunk",
      fromHeight,
      toHeight,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Perform StateLock sync (highest priority)
 */
async function performStateLockSync(
  chainContext: ChainContext,
  p2pNode: P2PNode,
  stateLock: any
): Promise<UnifiedSyncResult> {
  // Starting StateLock sync

  const localTip = chainContext.storage.getTip();
  const localHeight = localTip?.header.height ?? -1;
  const targetHeight = stateLock.height;

  if (localHeight >= targetHeight) {
    return {
      success: true,
      synced: false,
      method: "statelock",
      fromHeight: localHeight,
      toHeight: targetHeight,
    };
  }

  // Use appropriate sync method based on gap
  const heightDiff = targetHeight - localHeight;
  
  if (heightDiff >= 1000) {
    // Use warp sync
    const warpSyncManager = getWarpSyncManager();
    warpSyncManager.init(chainContext, p2pNode);
    
    if (warpSyncManager.canWarpSync(localHeight, targetHeight)) {
      const result = await warpSyncManager.performWarpSync({
        latestHeight: targetHeight,
        latestHeaderHash: stateLock.tipHash,
        stateCommitment: stateLock.stateCommitment,
      });
      
      return {
        success: result.success,
        synced: result.synced,
        method: "warp" as const,
        fromHeight: result.fromHeight,
        toHeight: result.toHeight,
        error: result.error,
      };
    }
  } else if (heightDiff >= 100) {
    // Use chunk sync
    return await chunkSync(chainContext, p2pNode, localHeight + 1, targetHeight);
  } else {
    // Use fast sync
    return await fastSync500(chainContext, p2pNode, targetHeight);
  }

  return {
    success: false,
    synced: false,
    method: "statelock",
    fromHeight: localHeight,
    toHeight: targetHeight,
    error: "StateLock sync failed",
  };
}

/**
 * Rollback to ancestor height (never to 0 unless user manually clears)
 */
async function rollbackTo(
  chainContext: ChainContext,
  ancestorHeight: number
): Promise<{ success: boolean; error?: string; removedBlocks: number }> {
  const localTip = chainContext.storage.getTip();
  if (!localTip) {
    return { success: false, error: "No local chain", removedBlocks: 0 };
  }

  const localHeight = localTip.header.height;

  // CRITICAL: Never rollback to 0 unless user manually clears
  // Minimum rollback height is 1 (keep genesis)
  if (ancestorHeight < 0) {
    // Ancestor height invalid, using minimum height 1
    ancestorHeight = 1;
  }

  if (ancestorHeight >= localHeight) {
    return { success: false, error: `Ancestor height ${ancestorHeight} must be less than local height ${localHeight}`, removedBlocks: 0 };
  }

  // Rolling back

  try {
    const { performHardReorg } = await import("./hardReorg.js");
    const result = await performHardReorg(chainContext, ancestorHeight);
    return result;
  } catch (error) {
    // Rollback failed
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      removedBlocks: 0,
    };
  }
}

/**
 * Unified RootTip Update Handler
 * 
 * This is the main entry point for handling ROOT_TIP_UPDATE messages.
 * Implements the complete unified sync algorithm from the Phase 46 specification.
 */
/**
 * Phase 47: Request snapshots from peers for genesis warp sync
 */
async function warpSyncFromPeers(
  chainContext: ChainContext,
  p2pNode: P2PNode,
  rootTip: RootTip,
  _statusCallback?: SyncStatusCallback
): Promise<UnifiedSyncResult> {
  // Requesting snapshots from peers for genesis sync
  if (!p2pNode.sendToPeer) {
    return {
      success: false,
      synced: false,
      method: "warp",
      fromHeight: 0,
      toHeight: rootTip.latestHeight,
      error: "sendToPeer not available",
    };
  }
  
  // Get all connected peers with open data channels
  const peers = Array.from(p2pNode.peers?.entries() || []).filter(([_, peer]: [string, any]) => 
    peer.connected && peer.dataChannel && peer.dataChannel.readyState === 'open'
  );
  if (peers.length === 0) {
    return {
      success: false,
      synced: false,
      method: "warp",
      fromHeight: 0,
      toHeight: rootTip.latestHeight,
      error: "No peers with open data channels available",
    };
  }
  
  // Requesting snapshots from peers
  // Phase 47: Try to use snapshotDownloader if available (from App.tsx)
  // First, request snapshot metadata from all peers
  const requestId = `genesis_warp_${Date.now()}`;
  for (const [peerId, peer] of peers) {
    if (peer.connected && peer.dataChannel && peer.dataChannel.readyState === 'open') {
      try {
        p2pNode.sendToPeer(peerId, "REQUEST_SNAPSHOT_META", {
          targetHeight: rootTip.latestHeight,
          requestId,
        });
        // Sent REQUEST_SNAPSHOT_META
      } catch (error) {
        // Failed to request snapshot
      }
    }
  }
  
  // Wait a bit for SNAPSHOT_META responses to arrive
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Phase 47: Try to use snapshotDownloader to find and download snapshots
  // Check if snapshotDownloader is available via window (set by App.tsx)
  let snapshotDownloader: any = null;
  if (typeof window !== "undefined") {
    snapshotDownloader = (window as any).snapshotDownloader;
  }
  
  if (snapshotDownloader) {
    try {
      if (_statusCallback) {
        _statusCallback(`Requesting snapshot metadata from peers...`);
      }
      
      // Using snapshotDownloader to find snapshots
      // Request snapshot metadata with longer timeout
      let metas: any[] = [];
      try {
        metas = await Promise.race([
          snapshotDownloader.requestSnapshotMeta(rootTip.latestHeight),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error("Snapshot metadata request timeout")), 10000)
          ),
        ]) as any[];
      } catch (metaError) {
        // Log error for debugging
        if (_statusCallback) {
          _statusCallback(`Failed to request snapshot metadata: ${metaError instanceof Error ? metaError.message : String(metaError)}`);
        }
        throw metaError;
      }
      
      // Debug: Log what we received
      if (metas && metas.length > 0) {
        if (_statusCallback) {
          _statusCallback(`Found ${metas.length} snapshot(s) from peers`);
        }
        
        // Find the best snapshot (closest to target height, but not exceeding it)
        const suitableSnapshots = metas.filter((m: any) => m.height <= rootTip.latestHeight);
        if (suitableSnapshots.length > 0) {
          const bestSnapshot = suitableSnapshots.sort((a: any, b: any) => b.height - a.height)[0];
          
          if (_statusCallback) {
            _statusCallback(`Selected snapshot at height ${bestSnapshot.height} (target: ${rootTip.latestHeight})`);
          }
          
          if (_statusCallback) {
            _statusCallback(`Downloading snapshot at height ${bestSnapshot.height}...`);
          }
          
          // Download snapshot with error handling
          try {
            // Check if snapshot is already being downloaded
            const snapshotId = `${bestSnapshot.height}`;
            const isAlreadyDownloading = (snapshotDownloader as any).activeDownloads?.has(snapshotId);
            
            if (isAlreadyDownloading) {
              if (_statusCallback) {
                _statusCallback(`Snapshot ${bestSnapshot.height} is already downloading, waiting for completion...`);
              }
              // Wait for the existing download to complete (up to 60 seconds)
              const maxWaitTime = 60000;
              const checkInterval = 1000;
              const startTime = Date.now();
              
              while (Date.now() - startTime < maxWaitTime) {
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                
                // Check if download completed
                const stillDownloading = (snapshotDownloader as any).activeDownloads?.has(snapshotId);
                if (!stillDownloading) {
                  // Download completed, check if snapshot was saved and applied
                  const { loadSnapshotByHeight } = await import("./snapshot.js");
                  const savedSnapshot = await loadSnapshotByHeight(bestSnapshot.height);
                  
                  if (savedSnapshot) {
                    // Snapshot was saved, check if it was applied (local height > 0)
                    const localTip = chainContext.storage.getTip();
                    const localHeight = localTip?.header.height ?? -1;
                    if (localHeight > 0) {
                      if (_statusCallback) {
                        _statusCallback(`Snapshot applied successfully! Syncing remaining blocks...`);
                      }
                      return {
                        success: true,
                        synced: localHeight >= rootTip.latestHeight,
                        method: "warp",
                        fromHeight: 0,
                        toHeight: localHeight,
                      };
                    } else {
                      // Snapshot downloaded but not applied - try to apply it
                      if (_statusCallback) {
                        _statusCallback(`Snapshot downloaded, applying...`);
                      }
                      // Apply snapshot logic will be handled below
                      break;
                    }
                  } else {
                    // Download completed but snapshot not saved - might have failed
                    if (_statusCallback) {
                      _statusCallback(`Snapshot download completed but not saved. Continuing...`);
                    }
                    break;
                  }
                }
              }
              
              // After waiting, check if snapshot was applied anyway
              const checkTip = chainContext.storage.getTip();
              const checkHeight = checkTip?.header.height ?? -1;
              if (checkHeight > 0) {
                if (_statusCallback) {
                  _statusCallback(`Snapshot applied! Syncing remaining blocks...`);
                }
                return {
                  success: true,
                  synced: checkHeight >= rootTip.latestHeight,
                  method: "warp",
                  fromHeight: 0,
                  toHeight: checkHeight,
                };
              }
            } else {
              // Not downloading yet, start download
              let downloadedSnapshotData: any = null;
              try {
                if (_statusCallback) {
                  _statusCallback(`Starting snapshot download from peer(s)...`);
                }
                
                downloadedSnapshotData = await Promise.race([
                  snapshotDownloader.downloadSnapshot(bestSnapshot, {}, (_progress: any) => {
                    if (_statusCallback && _progress?.percent !== undefined) {
                      _statusCallback(`Downloading snapshot: ${_progress.percent.toFixed(1)}% (${_progress.receivedChunks}/${_progress.totalChunks} chunks)`);
                    } else if (_statusCallback) {
                      _statusCallback(`Downloading snapshot... (waiting for chunks)`);
                    }
                  }),
                  new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error("Snapshot download timeout after 30s")), 30000)
                  ),
                ]);
                
                if (_statusCallback) {
                  _statusCallback(`Snapshot download completed successfully`);
                }
                
                // Save snapshot to local storage after download
                if (downloadedSnapshotData && downloadedSnapshotData.meta) {
                  if (_statusCallback) {
                    _statusCallback(`Saving snapshot to local storage...`);
                  }
                  
                  // Save snapshot directly (it's already in the correct format)
                  // The snapshot data from downloadSnapshot is already a SnapshotData object
                  // We just need to save it to localStorage
                  if (downloadedSnapshotData && downloadedSnapshotData.meta) {
                    try {
                      // Save snapshot data directly to localStorage
                      if (typeof localStorage !== "undefined") {
                        const SNAPSHOT_DATA_PREFIX = "indexerchain_snapshot_v1_";
                        const key = `${SNAPSHOT_DATA_PREFIX}${downloadedSnapshotData.meta.height}`;
                        localStorage.setItem(key, JSON.stringify(downloadedSnapshotData));
                        
                        // Update metadata list
                        const { loadAllSnapshotMeta, saveAllSnapshotMeta } = await import("./snapshot.js");
                        const allMetas = loadAllSnapshotMeta();
                        const filtered = allMetas.filter((m) => m.height !== downloadedSnapshotData.meta.height);
                        filtered.push(downloadedSnapshotData.meta);
                        saveAllSnapshotMeta(filtered);
                        
                        if (_statusCallback) {
                          _statusCallback(`Snapshot saved at height ${downloadedSnapshotData.meta.height}`);
                        }
                      }
                    } catch (saveError) {
                      if (_statusCallback) {
                        _statusCallback(`Failed to save snapshot: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
                      }
                      throw saveError;
                    }
                  }
                }
              } catch (downloadError) {
                const errorMsg = downloadError instanceof Error ? downloadError.message : String(downloadError);
                
                // Check what kind of error it is
                if (errorMsg.includes("No available sources")) {
                  if (_statusCallback) {
                    _statusCallback(`No peers have snapshot at height ${bestSnapshot.height}. Peers may not have snapshots available.`);
                  }
                } else if (errorMsg.includes("timeout")) {
                  if (_statusCallback) {
                    _statusCallback(`Snapshot download timed out. Peers may be slow or not responding.`);
                  }
                } else {
                  if (_statusCallback) {
                    _statusCallback(`Snapshot download failed: ${errorMsg}`);
                  }
                }
                
                // Check if snapshot exists locally anyway (might have been downloaded by another process)
                const { loadSnapshotByHeight } = await import("./snapshot.js");
                const existingSnapshot = await loadSnapshotByHeight(bestSnapshot.height);
                if (existingSnapshot) {
                  if (_statusCallback) {
                    _statusCallback(`Snapshot found locally despite download error, applying...`);
                  }
                  // Continue to apply snapshot below - don't throw
                } else {
                  // Download failed and no local snapshot - check if we should wait a bit more
                  // Sometimes download completes but we didn't catch it
                  if (_statusCallback) {
                    _statusCallback(`Waiting a bit to see if snapshot download completes...`);
                  }
                  await new Promise(resolve => setTimeout(resolve, 3000));
                  
                  // Check again
                  const recheckSnapshot = await loadSnapshotByHeight(bestSnapshot.height);
                  if (recheckSnapshot) {
                    if (_statusCallback) {
                      _statusCallback(`Snapshot found after waiting, applying...`);
                    }
                    // Continue to apply snapshot below - don't throw
                  } else {
                    // Download failed and no local snapshot - continue to next sync method
                    if (_statusCallback) {
                      _statusCallback(`Snapshot download failed and not found locally. Trying other sync methods...`);
                    }
                    throw downloadError;
                  }
                }
              }
            }
            
            // Check if snapshot was already saved (might have been saved during download)
            const { loadSnapshotByHeight } = await import("./snapshot.js");
            const savedSnapshot = await loadSnapshotByHeight(bestSnapshot.height);
            
            if (savedSnapshot) {
              if (_statusCallback) {
                _statusCallback(`Snapshot downloaded and saved, applying...`);
              }
            } else {
              if (_statusCallback) {
                _statusCallback(`Snapshot downloaded but not saved yet, waiting...`);
              }
              // Wait a bit for snapshot to be saved
              await new Promise(resolve => setTimeout(resolve, 2000));
              // Check again
              const recheckSnapshot = await loadSnapshotByHeight(bestSnapshot.height);
              if (!recheckSnapshot) {
                if (_statusCallback) {
                  _statusCallback(`Snapshot not saved after download. This may indicate a storage issue.`);
                }
                // Continue anyway - might be applied by another process
              }
            }
            
            // Wait for snapshot to be applied (snapshot application is async)
            // Check every 500ms for up to 30 seconds (increased from 15)
            const maxWaitTime = 30000;
            const checkInterval = 500;
            const startTime = Date.now();
            let lastReportedHeight = -1;
            
            while (Date.now() - startTime < maxWaitTime) {
              await new Promise(resolve => setTimeout(resolve, checkInterval));
              
              const localTip = chainContext.storage.getTip();
              const localHeight = localTip?.header.height ?? -1;
              
              // Report progress if height changed
              if (localHeight > lastReportedHeight && _statusCallback) {
                _statusCallback(`Snapshot applying... (height: ${localHeight})`);
                lastReportedHeight = localHeight;
              }
              
              if (localHeight > 0) {
                // Genesis sync successful via peer snapshot
                if (_statusCallback) {
                  _statusCallback(`Snapshot applied successfully! Syncing remaining blocks...`);
                }
                return {
                  success: true,
                  synced: localHeight >= rootTip.latestHeight,
                  method: "warp",
                  fromHeight: 0,
                  toHeight: localHeight,
                };
              }
            }
            
            // Snapshot downloaded but not applied after waiting
            // Try to manually apply the snapshot if it exists
            const finalSnapshot = await (async () => {
              const { loadSnapshotByHeight } = await import("./snapshot.js");
              return await loadSnapshotByHeight(bestSnapshot.height);
            })();
            
            if (finalSnapshot && finalSnapshot.indexState) {
              if (_statusCallback) {
                _statusCallback(`Snapshot found, manually applying...`);
              }
              
              // Apply snapshot state
              const { IndexState } = await import("./indexState.js");
              const restoredState = IndexState.fromSnapshot(finalSnapshot.indexState);
              const restoredInternalState = (restoredState as any).getInternalState();
              const currentInternalState = (chainContext.indexState as any).getInternalState();
              
              // Replace current state
              currentInternalState.clear();
              for (const [ns, kvMap] of restoredInternalState) {
                const newMap = new Map(kvMap);
                currentInternalState.set(ns, newMap);
              }
              
              // Restore privacy state
              const restoredCommitments = (restoredState as any).getCommitments?.() || (restoredState as any).commitments;
              const restoredNullifiers = (restoredState as any).getNullifierSet?.() || (restoredState as any).nullifierSet;
              
              if (restoredCommitments) {
                (chainContext.indexState as any).commitments = new Map(restoredCommitments);
              }
              if (restoredNullifiers) {
                (chainContext.indexState as any).nullifierSet = new Set(restoredNullifiers);
              }
              
              // Verify the snapshot was applied by checking if we have blocks up to snapshot height
              // The state has been restored, but we need blocks to set the tip
              // For now, we'll check if the state was restored correctly
              const currentTip = chainContext.storage.getTip();
              const currentHeight = currentTip?.header.height ?? -1;
              
              if (_statusCallback) {
                _statusCallback(`Snapshot state restored. Current height: ${currentHeight}, snapshot height: ${bestSnapshot.height}`);
              }
              
              // If we have blocks up to snapshot height, we're good
              // Otherwise, we'll need to sync blocks (which will update the tip)
              if (currentHeight >= bestSnapshot.height) {
                return {
                  success: true,
                  synced: currentHeight >= rootTip.latestHeight,
                  method: "warp",
                  fromHeight: 0,
                  toHeight: currentHeight,
                };
              } else {
                // State restored but need to sync blocks
                return {
                  success: true,
                  synced: false,
                  method: "warp",
                  fromHeight: 0,
                  toHeight: bestSnapshot.height,
                };
              }
            }
            
            // Check one more time if snapshot was applied in the background
            const finalTip = chainContext.storage.getTip();
            const finalHeight = finalTip?.header.height ?? -1;
            if (finalHeight > 0) {
              if (_statusCallback) {
                _statusCallback(`Snapshot applied! Syncing remaining blocks...`);
              }
              return {
                success: true,
                synced: finalHeight >= rootTip.latestHeight,
                method: "warp",
                fromHeight: 0,
                toHeight: finalHeight,
              };
            }
            
            if (_statusCallback) {
              _statusCallback(`Snapshot downloaded but not applied after 30s. Will retry...`);
            }
          } catch (downloadError) {
            // Download failed
            const errorMsg = downloadError instanceof Error ? downloadError.message : String(downloadError);
            if (_statusCallback) {
              _statusCallback(`Snapshot download failed: ${errorMsg}. Checking if snapshot exists locally...`);
            }
            
            // Check if snapshot exists locally anyway (might have been downloaded by another process)
            const localSnapshot = await (async () => {
              const { loadSnapshotByHeight } = await import("./snapshot.js");
              return await loadSnapshotByHeight(bestSnapshot.height);
            })();
            
            if (localSnapshot && localSnapshot.indexState) {
              if (_statusCallback) {
                _statusCallback(`Snapshot found locally, applying...`);
              }
              
              // Apply snapshot state
              const { IndexState } = await import("./indexState.js");
              const restoredState = IndexState.fromSnapshot(localSnapshot.indexState);
              const restoredInternalState = (restoredState as any).getInternalState();
              const currentInternalState = (chainContext.indexState as any).getInternalState();
              
              // Replace current state
              currentInternalState.clear();
              for (const [ns, kvMap] of restoredInternalState) {
                const newMap = new Map(kvMap);
                currentInternalState.set(ns, newMap);
              }
              
              // Restore privacy state
              const restoredCommitments = (restoredState as any).getCommitments?.() || (restoredState as any).commitments;
              const restoredNullifiers = (restoredState as any).getNullifierSet?.() || (restoredState as any).nullifierSet;
              
              if (restoredCommitments) {
                (chainContext.indexState as any).commitments = new Map(restoredCommitments);
              }
              if (restoredNullifiers) {
                (chainContext.indexState as any).nullifierSet = new Set(restoredNullifiers);
              }
              
              // Verify the snapshot was applied
              const currentTip = chainContext.storage.getTip();
              const currentHeight = currentTip?.header.height ?? -1;
              
              if (_statusCallback) {
                _statusCallback(`Snapshot state restored. Current height: ${currentHeight}, snapshot height: ${bestSnapshot.height}`);
              }
              
              // If we have blocks up to snapshot height, we're good
              if (currentHeight >= bestSnapshot.height) {
                return {
                  success: true,
                  synced: currentHeight >= rootTip.latestHeight,
                  method: "warp",
                  fromHeight: 0,
                  toHeight: currentHeight,
                };
              } else {
                // State restored but need to sync blocks
                return {
                  success: true,
                  synced: false,
                  method: "warp",
                  fromHeight: 0,
                  toHeight: bestSnapshot.height,
                };
              }
            }
            
            // Continue to wait and check if snapshot was applied anyway
            await new Promise(resolve => setTimeout(resolve, 2000));
            const checkTip = chainContext.storage.getTip();
            const checkHeight = checkTip?.header.height ?? -1;
            if (checkHeight > 0) {
              if (_statusCallback) {
                _statusCallback(`Snapshot applied after error! Syncing remaining blocks...`);
              }
              return {
                success: true,
                synced: checkHeight >= rootTip.latestHeight,
                method: "warp",
                fromHeight: 0,
                toHeight: checkHeight,
              };
            }
          }
        } else {
          if (_statusCallback) {
            _statusCallback(`No suitable snapshots found (received ${metas.length} but none <= ${rootTip.latestHeight}). Trying block sync...`);
          }
        }
      } else {
        if (_statusCallback) {
          _statusCallback(`No snapshots available from peers (request returned empty). Trying block sync...`);
        }
      }
    } catch (error) {
      // Failed to request or download snapshot
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (_statusCallback) {
        _statusCallback(`Snapshot sync failed: ${errorMsg}. Trying block sync...`);
      }
      // Don't throw, continue to return failure below
    }
  } else {
    if (_statusCallback) {
      _statusCallback(`SnapshotDownloader not available. Trying block sync...`);
    }
  }
  
  // Before returning failure, check one more time if snapshot was applied in the background
  // This handles the case where snapshot download completed but we didn't detect it
  const finalCheckTip = chainContext.storage.getTip();
  const finalCheckHeight = finalCheckTip?.header.height ?? -1;
  if (finalCheckHeight > 0) {
    if (_statusCallback) {
      _statusCallback(`Snapshot applied! Syncing remaining blocks...`);
    }
    return {
      success: true,
      synced: finalCheckHeight >= rootTip.latestHeight,
      method: "warp",
      fromHeight: 0,
      toHeight: finalCheckHeight,
    };
  }
  
  return {
    success: false,
    synced: false,
    method: "warp",
    fromHeight: 0,
    toHeight: rootTip.latestHeight,
    error: "No snapshots received from peers within timeout",
  };
}

/**
 * Phase 48: Try downloading bootstrap blocks from signal server
 * This is a fallback when warp sync fails and localHeight is 0
 */
async function trySignalBootstrapBlocks(
  chainContext: ChainContext,
  _rootTip: RootTip,
  statusCallback?: SyncStatusCallback
): Promise<boolean> {
  const signalServers = chainContext.params.signalServers;
  if (!signalServers || signalServers.length === 0) {
    if (statusCallback) {
      statusCallback(`No signal servers configured for bootstrap blocks`);
    }
    return false;
  }

  // Use the first signal server (or current connected one)
  const signalUrl = signalServers[0];
  if (!signalUrl) {
    return false;
  }

  // Convert WebSocket URL to HTTP URL
  const httpUrl = signalUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  const endpoint = `${httpUrl}/bootstrap-blocks?from=1&to=256`;

  if (statusCallback) {
    statusCallback(`Requesting bootstrap blocks from signal server...`);
  }

  try {
    const res = await fetch(endpoint, { 
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!res.ok) {
      // Handle different error statuses (server errors, network issues, etc.)
      if (res.status === 503) {
        // Service unavailable - signal server might not be ready
        if (statusCallback) {
          statusCallback(`Signal server temporarily unavailable (503). Will retry later.`);
        }
        // Fallback to WS
        return await trySignalBootstrapBlocksWS(chainContext, statusCallback);
      } else {
        // Other errors (404, 500, etc.) - now worker returns 200 with ok:false, but keep this for compatibility
        if (statusCallback) {
          statusCallback(`Signal server returned ${res.status}. Bootstrap blocks not available.`);
        }
        // Fallback to WS
        return await trySignalBootstrapBlocksWS(chainContext, statusCallback);
      }
    }

    let data;
    try {
      data = await res.json();
    } catch (jsonError) {
      if (statusCallback) {
        statusCallback(`Failed to parse response from signal server.`);
      }
      // Fallback to WS
      return await trySignalBootstrapBlocksWS(chainContext, statusCallback);
    }
    
    if (!data.ok || !Array.isArray(data.blocks) || data.blocks.length === 0) {
      if (statusCallback) {
        statusCallback(`No bootstrap blocks available (${data.reason || 'empty response'}). This is normal if signal server hasn't stored any blocks yet.`);
      }
      // Fallback to WS
      return await trySignalBootstrapBlocksWS(chainContext, statusCallback);
    }

    if (statusCallback) {
      statusCallback(`Received ${data.blocks.length} bootstrap block(s) from signal server`);
    }

    // Sort blocks by height
    const sorted = data.blocks.sort((a: any, b: any) => a.header.height - b.header.height);

    // Import verification function
    const { verifyBlock } = await import("./verify.js");

    let appended = 0;
    const allBlocks = chainContext.storage.getAllBlocks();

    for (const block of sorted) {
      const height = block.header.height;
      const tip = chainContext.storage.getTip();
      const currentHeight = tip?.header.height ?? 0;
      const expected = currentHeight + 1;

      // Must be continuous from current height
      if (height !== expected) {
        if (statusCallback) {
          statusCallback(`Bootstrap block height not continuous: got=${height}, expected=${expected}. Stopping.`);
        }
        break;
      }

      // For height 1, verify prevHash matches genesis (all zeros for genesis)
      if (height === 1) {
        // Genesis block has prevHash = "0".repeat(64)
        const genesisPrevHash = "0".repeat(64);
        if (block.header.prevHash !== genesisPrevHash) {
          if (statusCallback) {
            statusCallback(`Bootstrap block #1 prevHash mismatch genesis. Verification failed.`);
          }
          return false;
        }
      } else if (tip) {
        // For height > 1, verify prevHash matches current tip
        if (block.header.prevHash !== tip.hash) {
          if (statusCallback) {
            statusCallback(`Bootstrap block #${height} prevHash mismatch. Verification failed.`);
          }
          return false;
        }
      }

      // Full block verification (difficulty, hash, etc.)
      const prevBlock = height === 1 ? null : tip;
      const verification = await verifyBlock(block, prevBlock, allBlocks, chainContext.params);

      if (!verification.valid) {
        if (statusCallback) {
          statusCallback(`Bootstrap block #${height} verification failed: ${verification.error}`);
        }
        return false; // Abort on any verification failure
      }

      // Append block to chain
      try {
        chainContext.storage.appendBlock(block);
        chainContext.indexState.applyBlock(block);
        appended++;

        if (statusCallback && appended % 50 === 0) {
          statusCallback(`Applied ${appended} bootstrap block(s)...`);
        }
      } catch (error) {
        if (statusCallback) {
          statusCallback(`Failed to append bootstrap block #${height}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return false;
      }
    }

    if (appended > 0) {
      const newTip = chainContext.storage.getTip();
      const newHeight = newTip?.header.height ?? 0;
      
      if (statusCallback) {
        statusCallback(`✅ Applied ${appended} bootstrap block(s) from signal server. Height: ${newHeight}`);
      }
      
      return true;
    }

    return false;
  } catch (err) {
    if (statusCallback) {
      statusCallback(`Signal bootstrap error: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Fallback to WS
    return await trySignalBootstrapBlocksWS(chainContext, statusCallback);
  }
}

/**
 * Phase 48: Try WS-based bootstrap blocks (no CORS)
 */
async function trySignalBootstrapBlocksWS(
  chainContext: ChainContext,
  statusCallback?: SyncStatusCallback
): Promise<boolean> {
  const p2pNode: any = (chainContext as any).p2p;
  if (!p2pNode || !p2pNode.sendToSignalServer || !p2pNode.onMessage) {
    if (statusCallback) statusCallback(`WS bootstrap not available (no signal connection)`);
    return false;
  }
  
  const requestId = `ws_bootstrap_${Date.now()}`;
  const from = 1;
  const localTip = chainContext.storage.getTip();
  const target = Math.min(256, (localTip?.header?.height ?? 0) + 256 || 256);
  
  if (statusCallback) statusCallback(`Requesting WS bootstrap blocks: ${from}-${target} ...`);
  
  const response = await new Promise<any>((resolve) => {
    let timeoutId: any;
    const handler = (message: any) => {
      // message is forwarded from signaling path as-is
      if (!message || message.type !== 'BOOTSTRAP_BLOCKS') return;
      if (message.requestId && message.requestId !== requestId) return;
      try {
        // Remove handler
        (p2pNode as any).messageHandlers?.get?.("BOOTSTRAP_BLOCKS")?.delete?.(handler);
      } catch {}
      clearTimeout(timeoutId);
      resolve(message);
    };
    try {
      p2pNode.onMessage("BOOTSTRAP_BLOCKS" as any, handler);
    } catch {
      resolve(null);
      return;
    }
    p2pNode.sendToSignalServer("REQUEST_BOOTSTRAP_BLOCKS", { from, to: target, requestId });
    timeoutId = setTimeout(() => {
      try {
        (p2pNode as any).messageHandlers?.get?.("BOOTSTRAP_BLOCKS")?.delete?.(handler);
      } catch {}
      resolve(null);
    }, 10000);
  });
  
  if (!response || response.ok !== true || !Array.isArray(response.blocks) || response.blocks.length === 0) {
    if (statusCallback) statusCallback(`WS bootstrap returned no blocks`);
    return false;
  }
  
  const sorted = response.blocks.sort((a: any, b: any) => a.header.height - b.header.height);
  const { verifyBlock } = await import("./verify.js");
  
  let appended = 0;
  for (const block of sorted) {
    const height = block.header.height;
    const tip = chainContext.storage.getTip();
    const currentHeight = tip?.header.height ?? 0;
    const expected = currentHeight + 1;
    if (height !== expected) break;
    
    if (height === 1) {
      const genesisPrevHash = "0".repeat(64);
      if (block.header.prevHash !== genesisPrevHash) {
        if (statusCallback) statusCallback(`WS bootstrap block #1 prevHash mismatch`);
        return false;
      }
    } else if (tip && block.header.prevHash !== tip.hash) {
      if (statusCallback) statusCallback(`WS bootstrap block #${height} prevHash mismatch`);
      return false;
    }
    
    const prevBlock = height === 1 ? null : tip;
    const allBlocks = chainContext.storage.getAllBlocks();
    const verification = await verifyBlock(block, prevBlock, allBlocks, chainContext.params);
    if (!verification.valid) {
      if (statusCallback) statusCallback(`WS bootstrap block #${height} verification failed: ${verification.error}`);
      return false;
    }
    
    try {
      chainContext.storage.appendBlock(block);
      chainContext.indexState.applyBlock(block);
      appended++;
    } catch (error) {
      if (statusCallback) statusCallback(`Failed to append WS bootstrap block #${height}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  if (appended > 0) {
    const newTip = chainContext.storage.getTip();
    const newHeight = newTip?.header.height ?? 0;
    if (statusCallback) statusCallback(`✅ Applied ${appended} WS bootstrap block(s). Height: ${newHeight}`);
    return true;
  }
  
  return false;
}
export async function handleRootTipUpdate(
  chainContext: ChainContext,
  p2pNode: P2PNode,
  rootTip: RootTip,
  isMiner: boolean = false,
  statusCallback?: SyncStatusCallback
): Promise<UnifiedSyncResult> {
  const localTip = chainContext.storage.getTip();
  if (!localTip) {
    // No local chain, use warp sync
    if (statusCallback) {
      statusCallback(`Starting warp sync (no local chain)...`);
    }
    const warpSyncManager = getWarpSyncManager();
    warpSyncManager.init(chainContext, p2pNode);
    // Convert recentHeaders to BlockHeader[] if needed
    const recentHeadersForWarp = rootTip.recentHeaders?.filter((h): h is BlockHeader => 
      "version" in h || "prevHash" in h
    ) as BlockHeader[] | undefined;
    const warpResult = await warpSyncManager.performWarpSync({
      latestHeight: rootTip.latestHeight,
      latestHeader: rootTip.latestHeader,
      latestHeaderHash: rootTip.latestHeaderHash,
      recentHeaders: recentHeadersForWarp,
      latestSnapshotMeta: rootTip.latestSnapshotMeta,
      stateCommitment: rootTip.stateCommitment,
    });
    return {
      success: warpResult.success,
      synced: warpResult.synced,
      method: "warp" as const,
      fromHeight: warpResult.fromHeight,
      toHeight: warpResult.toHeight,
      error: warpResult.error,
    };
  }

  const localHeight = localTip.header.height;
  const localTipHash = localTip.hash;
  const rootHeight = rootTip.latestHeight;
  const rootTipHash = rootTip.latestHeaderHash;

  // Phase 47: Wait for peer connections before attempting sync
  // This is especially important when ROOT_TIP_UPDATE arrives before WebRTC connections are established
  let peerCount = p2pNode.getPeerCount();
  if (peerCount === 0 && localHeight < rootHeight) {
    if (statusCallback) {
      statusCallback(`Waiting for peer connections before sync...`);
    }
    
    // Wait up to 10 seconds for peers to connect
    const maxWaitTime = 10000;
    const checkInterval = 500;
    const startTime = Date.now();
    
    while (peerCount === 0 && Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      peerCount = p2pNode.getPeerCount();
    }
    
    if (peerCount === 0 && statusCallback) {
      statusCallback(`No peers available yet. Will retry when peers connect...`);
    }
  }

  // Phase 47: Special case - If local is at genesis (height 0), ALWAYS force warp sync
  // This ensures genesis nodes never get stuck, even if peers have pruned old blocks
  if (localHeight === 0) {
    // Phase 47: Genesis node detected, forcing warp sync
    
    const warpSyncManager = getWarpSyncManager();
    warpSyncManager.init(chainContext, p2pNode);
    
    // Phase 47: Force warp sync from peers, even if rootTip doesn't have snapshotMeta
    // First try with rootTip's snapshotMeta (if available)
    const hasRootTipSnapshot = rootTip.latestSnapshotMeta !== null && 
                              rootTip.latestSnapshotMeta !== undefined &&
                              typeof rootTip.latestSnapshotMeta === 'object' &&
                              'height' in rootTip.latestSnapshotMeta;
    
    if (hasRootTipSnapshot) {
      if (statusCallback) {
        statusCallback(`Trying warp sync with rootTip snapshot...`);
      }
      const recentHeadersForWarp = rootTip.recentHeaders?.filter((h): h is BlockHeader => 
        "version" in h || "prevHash" in h
      ) as BlockHeader[] | undefined;
      const warpResult = await warpSyncManager.performWarpSync({
        latestHeight: rootTip.latestHeight,
        latestHeader: rootTip.latestHeader,
        latestHeaderHash: rootTip.latestHeaderHash,
        recentHeaders: recentHeadersForWarp,
        latestSnapshotMeta: rootTip.latestSnapshotMeta,
        stateCommitment: rootTip.stateCommitment,
      });
      
      if (warpResult.success && warpResult.synced) {
        if (statusCallback) {
          statusCallback("");
        }
        return {
          success: warpResult.success,
          synced: warpResult.synced,
          method: "warp" as const,
          fromHeight: warpResult.fromHeight,
          toHeight: warpResult.toHeight,
          error: warpResult.error,
        };
      }
      if (statusCallback) {
        statusCallback(`RootTip snapshot failed, requesting snapshots from peers...`);
      }
    }
    
    // Phase 47: If rootTip snapshot failed or not available, request snapshots from peers
    if (statusCallback) {
      statusCallback(`Requesting snapshots from peers...`);
    }
    const peerWarpResult = await warpSyncFromPeers(chainContext, p2pNode, rootTip, statusCallback);
    
    if (peerWarpResult.success && peerWarpResult.synced) {
      if (statusCallback) {
        statusCallback("");
      }
      return peerWarpResult;
    }
    
    // Phase 48: If all warp sync attempts failed, try signal server bootstrap blocks
    // Only try if we haven't already tried recently (to avoid spam)
    const lastBootstrapAttempt = typeof window !== "undefined" ? (window as any).lastBootstrapAttempt : 0;
    const now = Date.now();
    const shouldTryBootstrap = !lastBootstrapAttempt || (now - lastBootstrapAttempt) > 30000; // Try every 30 seconds
    
    if (shouldTryBootstrap) {
      if (typeof window !== "undefined") {
        (window as any).lastBootstrapAttempt = now;
      }
      
      if (statusCallback) {
        statusCallback(`Warp sync not available, trying signal server bootstrap blocks...`);
      }
      
      try {
        const bootstrapSuccess = await trySignalBootstrapBlocks(chainContext, rootTip, statusCallback);
        if (bootstrapSuccess) {
          // Bootstrap blocks applied successfully, continue with chunk sync for remaining blocks
          const newTip = chainContext.storage.getTip();
          const newHeight = newTip?.header.height ?? 0;
          if (newHeight < rootHeight) {
            if (statusCallback) {
              statusCallback(`Bootstrap blocks applied (height ${newHeight}), syncing remaining blocks...`);
            }
            // Continue with chunk sync for remaining blocks
            const chunkResult = await chunkSync(chainContext, p2pNode, newHeight + 1, rootHeight, statusCallback);
            if (chunkResult.synced && statusCallback) {
              statusCallback("");
            } else if (!chunkResult.synced && statusCallback) {
              statusCallback(`Block sync in progress...`);
            }
            return {
              success: chunkResult.success,
              synced: chunkResult.synced,
              method: "bootstrap+chunk" as const,
              fromHeight: 0,
              toHeight: chunkResult.synced ? rootHeight : newHeight,
              error: chunkResult.error,
            };
          } else {
            if (statusCallback) {
              statusCallback("");
            }
            return {
              success: true,
              synced: true,
              method: "bootstrap" as const,
              fromHeight: 0,
              toHeight: newHeight,
            };
          }
        }
      } catch (bootstrapError) {
        // Bootstrap blocks failed (CORS, 503, etc.) - this is expected if signal server hasn't been deployed yet
        // Don't treat this as a fatal error, continue to chunk sync
        if (statusCallback) {
          const errorMsg = bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError);
          if (errorMsg.includes("CORS") || errorMsg.includes("503")) {
            statusCallback(`Signal bootstrap not available (server may not be deployed yet). Continuing with other sync methods...`);
          } else {
            statusCallback(`Signal bootstrap failed: ${errorMsg}. Continuing...`);
          }
        }
      }
    } else {
      // Skip bootstrap attempt if we tried recently
      if (statusCallback && shouldTryBootstrap === false) {
        statusCallback(`Skipping bootstrap blocks (tried recently). Will retry later...`);
      }
    }
    
    // Phase 47: If bootstrap blocks also failed, check if chunk sync is possible
    // If peers don't have height 1 blocks, chunk sync will also fail
    // In that case, we should return an error indicating warp sync is needed
    if (statusCallback) {
      statusCallback(`Signal bootstrap failed, checking if block sync is possible...`);
    }
    
    // Wait a bit more for peers to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const chunkResult = await chunkSync(chainContext, p2pNode, 1, rootHeight, statusCallback);
    
    // If chunk sync failed because peers don't have height 1 blocks, return error
    if (!chunkResult.success && chunkResult.error?.includes("Need warp sync")) {
      return {
        success: false,
        synced: false,
        method: "warp",
        fromHeight: 0,
        toHeight: rootHeight,
        error: "Warp sync needed but not available. Peers don't have blocks from height 1.",
      };
    }
    
    if (chunkResult.synced && statusCallback) {
      statusCallback("");
    } else if (!chunkResult.synced && statusCallback) {
      statusCallback(`Block sync in progress...`);
    }
    
    return chunkResult;
  }

  // Step 1: StateLock highest priority
  const stateLockManager = getStateLockManager();
  const stateLock = stateLockManager.getCurrentLock();
  if (stateLock && stateLock.locked && stateLock.height > localHeight) {
    if (stateLock.tipHash !== localTipHash) {
      // StateLock detected
      return await performStateLockSync(chainContext, p2pNode, stateLock);
    }
  }

  // Step 2: If height equal, no sync needed
  if (rootHeight === localHeight) {
    // Still check if hash matches (might be on a fork)
    if (rootTipHash === localTipHash) {
      return {
        success: true,
        synced: false,
        method: "none",
        fromHeight: localHeight,
        toHeight: rootHeight,
      };
    }
    // Hash mismatch at same height - this is a fork, but we'll handle it below
  }

  // Step 3: If far behind (>= 1000 blocks), use Warp Sync
  if (rootHeight - localHeight >= 1000) {
    // Large gap detected, using warp sync
    const warpSyncManager = getWarpSyncManager();
    warpSyncManager.init(chainContext, p2pNode);
    // Convert recentHeaders to BlockHeader[] if needed
    const recentHeadersForWarp = rootTip.recentHeaders?.filter((h): h is BlockHeader => 
      "version" in h || "prevHash" in h
    ) as BlockHeader[] | undefined;
    const warpResult = await warpSyncManager.performWarpSync({
      latestHeight: rootTip.latestHeight,
      latestHeader: rootTip.latestHeader,
      latestHeaderHash: rootTip.latestHeaderHash,
      recentHeaders: recentHeadersForWarp,
      latestSnapshotMeta: rootTip.latestSnapshotMeta,
      stateCommitment: rootTip.stateCommitment,
    });
    return {
      success: warpResult.success,
      synced: warpResult.synced,
      method: "warp" as const,
      fromHeight: warpResult.fromHeight,
      toHeight: warpResult.toHeight,
      error: warpResult.error,
    };
  }

  // Step 4: If local tip is in recent headers, use Fast Sync
  if (rootTip.recentHeaders && rootTip.recentHeaders.length > 0) {
    // Convert recent headers to hash set
    const recentHashes = new Set<string>();
    for (const header of rootTip.recentHeaders) {
      let hash: string;
      if ("hash" in header) {
        hash = header.hash;
      } else {
        // It's a BlockHeader, need to compute hash
        try {
          hash = await hashBlockHeader(header as BlockHeader);
        } catch {
          continue;
        }
      }
      recentHashes.add(hash);
    }

    if (recentHashes.has(localTipHash)) {
      // Local tip is in recent headers - no fork, just need to sync
      // Local tip found in recent headers, using fast sync
      return await fastSync500(chainContext, p2pNode, rootHeight, rootTip.recentHeaders);
    }
  }

  // Step 5: Check for common ancestor (only if we suspect a fork)
  // Only check if local tip hash doesn't match root tip hash
  if (localTipHash !== rootTipHash && rootTip.recentHeaders && rootTip.recentHeaders.length > 0) {
      // Only miners can trigger fork detection and reorg
      if (isMiner) {
        // Hash mismatch detected, checking for common ancestor
        const ancestor = await findCommonAncestor(chainContext, localTip, rootTip.recentHeaders, 500);
      
      if (ancestor) {
        // Found common ancestor - rollback to it and sync
        // Fork detected
        
        const rollbackResult = await rollbackTo(chainContext, ancestor.height);
        if (rollbackResult.success) {
          // Rolled back, now syncing
          
          // Sync from ancestor height + 1 to root height
          return await chunkSync(chainContext, p2pNode, ancestor.height + 1, rootHeight);
        } else {
          return {
            success: false,
            synced: false,
            method: "none",
            fromHeight: localHeight,
            toHeight: rootHeight,
            error: rollbackResult.error || "Rollback failed",
          };
        }
      } else {
        // No common ancestor found - this is rare (chain DB corruption or different chain)
        // Use warp sync instead of clearing to 0
        // No common ancestor found, using warp sync
        const warpSyncManager = getWarpSyncManager();
        warpSyncManager.init(chainContext, p2pNode);
        // Convert recentHeaders to BlockHeader[] if needed
        const recentHeadersForWarp = rootTip.recentHeaders?.filter((h): h is BlockHeader => 
          "version" in h || "prevHash" in h
        ) as BlockHeader[] | undefined;
        const warpResult = await warpSyncManager.performWarpSync({
          latestHeight: rootTip.latestHeight,
          latestHeader: rootTip.latestHeader,
          latestHeaderHash: rootTip.latestHeaderHash,
          recentHeaders: recentHeadersForWarp,
          latestSnapshotMeta: rootTip.latestSnapshotMeta,
          stateCommitment: rootTip.stateCommitment,
        });
        return {
          success: warpResult.success,
          synced: warpResult.synced,
          method: "warp" as const,
          fromHeight: warpResult.fromHeight,
          toHeight: warpResult.toHeight,
          error: warpResult.error,
        };
      }
    } else {
      // Non-miner: just sync missing blocks (no reorg)
      // Non-miner node: syncing missing blocks
      const heightDiff = rootHeight - localHeight;
      if (heightDiff >= 100) {
        return await chunkSync(chainContext, p2pNode, localHeight + 1, rootHeight);
      } else {
        return await fastSync500(chainContext, p2pNode, rootHeight, rootTip.recentHeaders);
      }
    }
  }

  // Step 6: Default - just sync missing blocks
  const heightDiff = rootHeight - localHeight;
  if (heightDiff > 0) {
    if (heightDiff >= 100) {
      return await chunkSync(chainContext, p2pNode, localHeight + 1, rootHeight);
    } else {
      return await fastSync500(chainContext, p2pNode, rootHeight, rootTip.recentHeaders);
    }
  }

  return {
    success: true,
    synced: false,
    method: "none",
    fromHeight: localHeight,
    toHeight: rootHeight,
  };
}

