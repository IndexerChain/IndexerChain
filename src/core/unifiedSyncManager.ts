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
import { logger } from "./logger.js";
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

export interface UnifiedSyncResult {
  success: boolean;
  synced: boolean;
  method: "statelock" | "warp" | "chunk" | "fast" | "none";
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
      logger.info(`[UnifiedSync] Found common ancestor at height ${block.header.height} (hash: ${block.hash.substring(0, 16)}...)`);
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

  logger.info(`[FastSync500] 🚀 Starting fast sync: ${localHeight} → ${targetHeight} (gap: ${heightDiff} blocks)`);

  // Use chunk-based sync for gaps < 500
  const chunkSyncManager = getChunkBasedSyncManager();
  chunkSyncManager.init(chainContext, p2pNode);

  try {
    const result = await chunkSyncManager.syncMissingBlocks(localHeight + 1, targetHeight);
    
    if (result.success) {
      logger.info(`[FastSync500] ✅ Fast sync completed: requested ${result.requestedChunks.length} chunk(s), ${result.skippedBlocks} blocks already present`);
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
    logger.error(`[FastSync500] ❌ Fast sync failed:`, error);
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
  toHeight: number
): Promise<UnifiedSyncResult> {
  logger.info(`[ChunkSync] 🚀 Starting chunk sync: ${fromHeight} → ${toHeight} (gap: ${toHeight - fromHeight} blocks)`);

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
          logger.info(`[ChunkSync] ⏳ Waiting for blocks to arrive (genesis sync): current=${actualLocalHeight}, target=${toHeight}`);
          
          // Wait up to 10 seconds for blocks to arrive
          const maxWaitTime = 10000;
          const checkInterval = 1000;
          const startTime = Date.now();
          let currentHeight = actualLocalHeight;
          
          while (Date.now() - startTime < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            
            // Re-check local height
            const newTip = chainContext.storage.getTip();
            const newHeight = newTip?.header.height ?? -1;
            
            if (newHeight > currentHeight) {
              logger.info(`[ChunkSync] ✅ Blocks arriving: height=${newHeight}, target=${toHeight}`);
              currentHeight = newHeight;
              
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
          }
          
          // After waiting, check final state
          const finalTip = chainContext.storage.getTip();
          const finalHeight = finalTip?.header.height ?? -1;
          const finalSynced = finalHeight >= toHeight;
          
          if (finalSynced) {
            logger.info(`[ChunkSync] ✅ Chunk sync completed after wait: height=${finalHeight}, target=${toHeight}`);
            return {
              success: true,
              synced: true,
              method: "chunk",
              fromHeight,
              toHeight,
            };
          } else {
            logger.warn(`[ChunkSync] ⚠️ Still waiting for blocks: current=${finalHeight}, target=${toHeight}. Blocks may still be downloading...`);
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
          logger.warn(`[ChunkSync] ⚠️ Requested ${result.requestedChunks.length} chunk(s) but local height is still ${actualLocalHeight} (target: ${toHeight}). Blocks may still be downloading...`);
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
      
      logger.info(`[ChunkSync] ✅ Chunk sync completed: requested ${result.requestedChunks.length} chunk(s), ${result.skippedBlocks} blocks already present, actual height: ${actualLocalHeight}`);
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
    logger.error(`[ChunkSync] ❌ Chunk sync failed:`, error);
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
  logger.info(`[StateLockSync] 🚀 Starting StateLock sync to height ${stateLock.height}`);

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
    logger.warn(`[UnifiedSync] Ancestor height ${ancestorHeight} is invalid, using minimum height 1`);
    ancestorHeight = 1;
  }

  if (ancestorHeight >= localHeight) {
    return { success: false, error: `Ancestor height ${ancestorHeight} must be less than local height ${localHeight}`, removedBlocks: 0 };
  }

  logger.info(`[UnifiedSync] 🔄 Rolling back from height ${localHeight} to ${ancestorHeight}`);

  try {
    const { performHardReorg } = await import("./hardReorg.js");
    const result = await performHardReorg(chainContext, ancestorHeight);
    return result;
  } catch (error) {
    logger.error(`[UnifiedSync] ❌ Rollback failed:`, error);
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
  rootTip: RootTip
): Promise<UnifiedSyncResult> {
  logger.info(`[UnifiedSync] 🔍 Requesting snapshots from peers for genesis sync`);
  
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
  
  // Get all connected peers
  const peers = Array.from(p2pNode.peers?.entries() || []);
  if (peers.length === 0) {
    return {
      success: false,
      synced: false,
      method: "warp",
      fromHeight: 0,
      toHeight: rootTip.latestHeight,
      error: "No peers available",
    };
  }
  
  logger.info(`[UnifiedSync] Requesting snapshots from ${peers.length} peer(s)`);
  
  // Request snapshot metadata from all peers
  const requestId = `genesis_warp_${Date.now()}`;
  for (const [peerId, peer] of peers) {
    if (peer.connected && peer.dataChannel && peer.dataChannel.readyState === 'open') {
      try {
        p2pNode.sendToPeer(peerId, "REQUEST_SNAPSHOT_META", {
          targetHeight: rootTip.latestHeight,
          requestId,
        });
        logger.debug(`[UnifiedSync] Sent REQUEST_SNAPSHOT_META to peer ${peerId.substring(0, 16)}...`);
      } catch (error) {
        logger.debug(`[UnifiedSync] Failed to request snapshot from peer ${peerId.substring(0, 16)}...:`, error);
      }
    }
  }
  
  // Wait for snapshot metadata responses (up to 5 seconds)
  const maxWaitTime = 5000;
  const checkInterval = 500;
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    
    // Check if we've received any snapshots via snapshotDownloader
    // The snapshotDownloader will handle SNAPSHOT_META responses and download snapshots
    const localTip = chainContext.storage.getTip();
    const localHeight = localTip?.header.height ?? -1;
    
    if (localHeight > 0) {
      logger.info(`[UnifiedSync] ✅ Genesis sync successful via peer snapshot: height=${localHeight}`);
      return {
        success: true,
        synced: localHeight >= rootTip.latestHeight,
        method: "warp",
        fromHeight: 0,
        toHeight: localHeight,
      };
    }
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

export async function handleRootTipUpdate(
  chainContext: ChainContext,
  p2pNode: P2PNode,
  rootTip: RootTip,
  isMiner: boolean = false
): Promise<UnifiedSyncResult> {
  logger.info(`[UnifiedSync] handleRootTipUpdate called: rootHeight=${rootTip.latestHeight}, rootHash=${rootTip.latestHeaderHash.substring(0, 16)}...`);
  
  const localTip = chainContext.storage.getTip();
  if (!localTip) {
    // No local chain, use warp sync
    logger.info(`[UnifiedSync] No local chain, using warp sync`);
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

  // Phase 47: Special case - If local is at genesis (height 0), ALWAYS force warp sync
  // This ensures genesis nodes never get stuck, even if peers have pruned old blocks
  if (localHeight === 0) {
    logger.info(`[UnifiedSync] 🚀 Genesis node detected (height 0) → FORCING warp sync (network: ${rootHeight})`);
    const warpSyncManager = getWarpSyncManager();
    warpSyncManager.init(chainContext, p2pNode);
    
    // Phase 47: Force warp sync from peers, even if rootTip doesn't have snapshotMeta
    // First try with rootTip's snapshotMeta (if available)
    const hasRootTipSnapshot = rootTip.latestSnapshotMeta !== null && 
                              rootTip.latestSnapshotMeta !== undefined &&
                              typeof rootTip.latestSnapshotMeta === 'object' &&
                              'height' in rootTip.latestSnapshotMeta;
    
    if (hasRootTipSnapshot) {
      logger.info(`[UnifiedSync] RootTip has snapshot, trying warp sync with rootTip snapshot`);
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
        return {
          success: warpResult.success,
          synced: warpResult.synced,
          method: "warp" as const,
          fromHeight: warpResult.fromHeight,
          toHeight: warpResult.toHeight,
          error: warpResult.error,
        };
      }
      logger.info(`[UnifiedSync] RootTip snapshot warp sync failed, trying peer snapshots`);
    }
    
    // Phase 47: If rootTip snapshot failed or not available, request snapshots from peers
    logger.info(`[UnifiedSync] Requesting snapshots from peers for genesis sync`);
    const peerWarpResult = await warpSyncFromPeers(chainContext, p2pNode, rootTip);
    
    if (peerWarpResult.success && peerWarpResult.synced) {
      return peerWarpResult;
    }
    
    // If all warp sync attempts failed, log warning but don't fall back to chunk sync
    // Chunk sync won't work if peers don't have height 1 blocks
    logger.warn(`[UnifiedSync] ⚠️ All warp sync attempts failed for genesis node. Waiting for peers with snapshots...`);
    return {
      success: false,
      synced: false,
      method: "warp" as const,
      fromHeight: 0,
      toHeight: rootHeight,
      error: "Genesis warp sync failed: no snapshots available from peers or rootTip",
    };
  }

  // Step 1: StateLock highest priority
  const stateLockManager = getStateLockManager();
  const stateLock = stateLockManager.getCurrentLock();
  if (stateLock && stateLock.locked && stateLock.height > localHeight) {
    if (stateLock.tipHash !== localTipHash) {
      logger.info(`[UnifiedSync] StateLock detected: height=${stateLock.height}, hash=${stateLock.tipHash.substring(0, 16)}...`);
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
    logger.info(`[UnifiedSync] Large gap detected (${rootHeight - localHeight} blocks), using warp sync`);
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
      logger.info(`[UnifiedSync] Local tip found in recent headers, using fast sync`);
      return await fastSync500(chainContext, p2pNode, rootHeight, rootTip.recentHeaders);
    }
  }

  // Step 5: Check for common ancestor (only if we suspect a fork)
  // Only check if local tip hash doesn't match root tip hash
  if (localTipHash !== rootTipHash && rootTip.recentHeaders && rootTip.recentHeaders.length > 0) {
      // Only miners can trigger fork detection and reorg
      if (isMiner) {
        logger.info(`[UnifiedSync] Hash mismatch detected, checking for common ancestor (miner node)`);
        const ancestor = await findCommonAncestor(chainContext, localTip, rootTip.recentHeaders, 500);
      
      if (ancestor) {
        // Found common ancestor - rollback to it and sync
        logger.warn(`[UnifiedSync] 🚨 Fork detected! Common ancestor at height ${ancestor.height}`);
        
        const rollbackResult = await rollbackTo(chainContext, ancestor.height);
        if (rollbackResult.success) {
          logger.info(`[UnifiedSync] ✅ Rolled back to height ${ancestor.height}, now syncing to ${rootHeight}`);
          
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
        logger.warn(`[UnifiedSync] ⚠️ No common ancestor found, using warp sync (chain may be corrupted or different)`);
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
      logger.info(`[UnifiedSync] Non-miner node: hash mismatch but no fork check needed, syncing missing blocks`);
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

