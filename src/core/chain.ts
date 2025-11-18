/**
 * Chain Initialization and High-level API
 * 
 * Provides a simple API to initialize and manage the chain
 */

import type { ChainParams, Block, SnapshotMeta } from "./types.js";
import { BrowserChainStorage } from "./chainStorage.js";
import { IndexState } from "./indexState.js";
import { createGenesisBlock } from "./genesis.js";
import { verifyBlock } from "./verify.js";
import type { P2PNode } from "./p2p.js";
import {
  getLatestSnapshotMeta,
  loadSnapshotByHeight,
  clearAllSnapshots,
  saveSnapshot,
  pruneOldSnapshots,
  recompressAllSnapshots,
  findNearestFullSnapshot,
  loadDeltaSnapshotsAfter,
} from "./snapshot.js";

/**
 * Chain context containing storage, state, parameters, and P2P node
 */
export interface ChainContext {
  storage: BrowserChainStorage;
  indexState: IndexState;
  params: ChainParams;
  p2p?: P2PNode; // Optional P2P node
  remoteSnapshotUsed?: SnapshotMeta | null; // Phase 14: Remote snapshot used during initialization
}

/**
 * Check if chain data needs migration (Phase 5 compatibility check)
 * 
 * Phase 5: Detects old transaction format (without signatures)
 * 
 * @param storage Chain storage
 * @returns true if migration/reset is needed
 */
export function needsMigration(storage: BrowserChainStorage): boolean {
  const blocks = storage.getAllBlocks();
  
  // Check if any transaction is missing Phase 5 fields
  for (const block of blocks) {
    for (const tx of block.txs) {
      // Phase 5 transactions must have ownerAddress, ownerPubKey, and signature
      if (!("ownerAddress" in tx) || !("ownerPubKey" in tx) || !("signature" in tx)) {
        return true; // Old format detected
      }
    }
  }
  
  return false; // All transactions are in Phase 5 format
}

/**
 * Initialize the local chain:
 * 1. Load blocks from localStorage
 * 2. Check for Phase 5 compatibility (migration needed)
 * 3. If no genesis block exists, create and write it
 * 4. Rebuild IndexState by replaying blocks (using snapshot if available)
 * 
 * Phase 9: Uses snapshots to speed up initialization
 * 
 * @param params Chain parameters
 * @returns Chain context with storage, state, and params, and migration status
 */
export async function initChain(params: ChainParams): Promise<ChainContext & { needsReset?: boolean }> {
  const storage = new BrowserChainStorage();
  let blocks = storage.getAllBlocks();

  // Phase 5: Check if migration is needed
  const needsReset = needsMigration(storage);

  // If chain is empty, create genesis block
  if (blocks.length === 0) {
    const genesis = await createGenesisBlock(params);
    storage.appendBlock(genesis);
    blocks = [genesis];
  }

  // Phase 9: Try to use snapshot for fast initialization
  // Phase 11: Auto-upgrade legacy snapshots to compressed format
  // Phase 12: Start recording changes for delta snapshots
  // Phase 16: Initialize total_minted to 0 if not exists
  let indexState = IndexState.createEmpty();
  indexState.beginRecording(); // Start recording changes for delta snapshots
  
  // Phase 16: Ensure total_minted exists (initialize to 0 if not set)
  // This will be updated when we rebuild from blocks
  let startHeight = 0;

  // Phase 11: Auto-upgrade legacy snapshots in background (non-blocking)
  // This runs asynchronously and doesn't block initialization
  Promise.resolve().then(async () => {
    try {
      const recompressed = await recompressAllSnapshots();
      if (recompressed > 0) {
        console.log(`[Phase 11] Auto-upgraded ${recompressed} legacy snapshot(s) to compressed format`);
      }
    } catch (error) {
      console.warn("[Phase 11] Failed to auto-upgrade snapshots:", error);
    }
  });

  const latestSnap = getLatestSnapshotMeta();
  let remoteSnapshotUsed: SnapshotMeta | null = null;
  
  if (latestSnap) {
    // Verify snapshot is still valid
    const snapshotBlock = storage.getBlockByHeight(latestSnap.height);
    if (snapshotBlock && snapshotBlock.hash === latestSnap.blockHash) {
      // Phase 12: Load snapshot (supports full and delta)
      const snapData = await loadSnapshotByHeight(latestSnap.height);
      if (snapData) {
        if (snapData.full === false && snapData.delta) {
          // Delta snapshot - need to reconstruct from full + deltas
          console.log(
            `[Phase 12] Latest snapshot is delta, reconstructing from full snapshot + deltas`
          );
          
          // Find nearest full snapshot
          const fullSnapMeta = findNearestFullSnapshot(latestSnap.height);
          if (fullSnapMeta) {
            const fullSnap = await loadSnapshotByHeight(fullSnapMeta.height);
            if (fullSnap && fullSnap.indexState) {
              // Start with full snapshot
              const restoredState = IndexState.fromSnapshot(fullSnap.indexState);
              const restoredInternalState = (restoredState as any).getInternalState();
              const currentInternalState = (indexState as any).getInternalState();
              currentInternalState.clear();
              for (const [ns, kvMap] of restoredInternalState) {
                const newMap = new Map(kvMap);
                currentInternalState.set(ns, newMap);
              }
              
              // Apply all delta snapshots
              const deltaMetas = loadDeltaSnapshotsAfter(fullSnapMeta.height, latestSnap.height);
              for (const deltaMeta of deltaMetas) {
                const deltaSnap = await loadSnapshotByHeight(deltaMeta.height);
                if (deltaSnap && deltaSnap.delta) {
                  const { applyDelta } = await import("./snapshotDelta.js");
                  await applyDelta(deltaSnap.delta, (op: any) => {
                    indexState.applyOperation(op, undefined);
                  });
                }
              }
              
              startHeight = latestSnap.height + 1;
              console.log(
                `[Phase 12] Reconstructed state from full snapshot (${fullSnapMeta.height}) + ${deltaMetas.length} delta(s), replaying from height ${startHeight}`
              );
            }
          } else {
            console.warn(`[Phase 12] No full snapshot found, falling back to full rebuild`);
            startHeight = 0;
          }
        } else {
          // Full snapshot (or legacy format)
          const restoredState = IndexState.fromSnapshot(snapData.indexState);
          const restoredInternalState = (restoredState as any).getInternalState();
          const currentInternalState = (indexState as any).getInternalState();
          currentInternalState.clear();
          for (const [ns, kvMap] of restoredInternalState) {
            const newMap = new Map(kvMap);
            currentInternalState.set(ns, newMap);
          }
          startHeight = latestSnap.height + 1;
          console.log(
            `[Phase 12] Using full snapshot at height ${latestSnap.height}, replaying from height ${startHeight}`
          );
        }
      }
    } else {
      // Snapshot is invalid (block missing or hash mismatch)
      console.warn(
        `[Phase 12] Snapshot at height ${latestSnap.height} is invalid, clearing all snapshots`
      );
      clearAllSnapshots();
      startHeight = 0;
    }
  }

  // Phase 14: Try remote snapshot sync if local snapshot is insufficient
  const tip = storage.getTip();
  const currentHeight = tip?.header.height ?? 0;
  const minHeight = params.remoteSnapshotMinHeight ?? 0;
  
  // Only try remote sync if:
  // 1. Remote sync is enabled
  // 2. Current height is below minimum (or no local snapshot)
  // 3. Local snapshot doesn't exist or is too low
  if (
    params.remoteSnapshotEnabled &&
    params.remoteSnapshotEndpoints &&
    params.remoteSnapshotEndpoints.length > 0 &&
    (currentHeight < minHeight || !latestSnap || latestSnap.height < minHeight)
  ) {
    try {
      const { syncFromRemoteSnapshot } = await import("./remoteSnapshot.js");
      const remoteMeta = await syncFromRemoteSnapshot(params, storage);
      
      if (remoteMeta) {
        remoteSnapshotUsed = remoteMeta;
        
        // Reload snapshot after saving remote one
        const updatedSnap = getLatestSnapshotMeta();
        if (updatedSnap && updatedSnap.height === remoteMeta.height) {
          // Load the newly saved remote snapshot
          const snapData = await loadSnapshotByHeight(updatedSnap.height);
          if (snapData && snapData.indexState) {
            // Restore state from remote snapshot
            const restoredState = IndexState.fromSnapshot(snapData.indexState);
            const restoredInternalState = (restoredState as any).getInternalState();
            const currentInternalState = (indexState as any).getInternalState();
            currentInternalState.clear();
            for (const [ns, kvMap] of restoredInternalState) {
              const newMap = new Map(kvMap);
              currentInternalState.set(ns, newMap);
            }
            
            startHeight = updatedSnap.height + 1;
            console.log(
              `[Phase 14] Using remote snapshot at height ${updatedSnap.height}, replaying from height ${startHeight}`
            );
          }
        }
      }
    } catch (error) {
      console.warn("[Phase 14] Remote snapshot sync failed, falling back to local initialization:", error);
      // Continue with local initialization
    }
  }

  // Phase 10: Replay blocks from startHeight to tip (with light node window limit)
  const lightNodeWindow = params.lightNodeWindow ?? 200;
  
  // Re-fetch tip in case it changed during remote sync
  const finalTip = storage.getTip();
  if (finalTip) {
    // In light node mode, we may not have all blocks from startHeight
    // We'll replay what we have, starting from the earliest available block
    const minHeight = storage.getMinHeight();
    const actualStartHeight = Math.max(startHeight, minHeight);
    
    // Only replay blocks within the window (if in light node mode)
    const maxReplayHeight = lightNodeWindow > 0 
      ? Math.min(finalTip.header.height, actualStartHeight + lightNodeWindow - 1)
      : finalTip.header.height;
    
    for (let h = actualStartHeight; h <= maxReplayHeight; h++) {
      const block = storage.getBlockByHeight(h);
      if (block) {
        try {
          indexState.applyBlock(block);
          
          // Phase 16: Update total_minted after applying each block
          if (block.txs.length > 0) {
            const coinbaseTx = block.txs[0];
            if (coinbaseTx.ownerAddress === "idc_system" && coinbaseTx.ops.length > 0) {
              const rewardOp = coinbaseTx.ops[0];
              if (rewardOp.type === "TRANSFER" && rewardOp.amount) {
                const { IDCToUIDC } = await import("./idcEmission.js");
                const rewardUIDC = IDCToUIDC(rewardOp.amount);
                indexState.incrementTotalMinted(rewardUIDC);
              }
            }
          }
        } catch (error) {
          // Enhanced error handling with better error messages
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (errorMsg.includes("Insufficient balance")) {
            console.error(
              `[Chain Init] Balance error at block ${h}: ${errorMsg}\n` +
              `This may indicate corrupted chain state or snapshot inconsistency.`
            );
            // Re-throw with more context
            throw new Error(
              `Chain initialization failed at block ${h}: ${errorMsg}\n` +
              `This usually means the chain state is corrupted. You may need to reset the chain.`
            );
          }
          // Re-throw other errors
          throw error;
        }
      } else {
        // Block missing - in light node mode this is expected for old blocks
        if (h < minHeight) {
          // This block was pruned, which is expected in light node mode
          console.log(
            `[Phase 10] Block at height ${h} was pruned (light node mode), continuing from ${minHeight}`
          );
          continue;
        } else {
          // Block should exist but doesn't - this is an error
          console.error(`[Phase 10] Block at height ${h} is missing unexpectedly`);
          // Try to continue with next block
          continue;
        }
      }
    }
    
    // If we're in light node mode and started from a snapshot, log it
    if (latestSnap && lightNodeWindow > 0) {
      console.log(
        `[Phase 10] Light node mode: Replayed blocks from ${actualStartHeight} to ${maxReplayHeight} (window: ${lightNodeWindow})`
      );
    }
  }

  // Phase 13: Sample-based snapshot verification (non-blocking)
  const sampleRate = params.snapshotVerificationSampleRate ?? 0.3;
  const r = Math.random();
  if (r < sampleRate) {
    // Run verification in background, don't block initialization
    Promise.resolve().then(async () => {
      try {
        const { verifySnapshotIntegrity, handleCorruptedSnapshot } = await import("./snapshotVerify.js");
        const latestMeta = getLatestSnapshotMeta();
        if (!latestMeta) {
          return; // No snapshots to verify
        }

        const snapshot = await loadSnapshotByHeight(latestMeta.height);
        if (!snapshot) {
          return; // Snapshot doesn't exist or was already deleted
        }

        const isValid = await verifySnapshotIntegrity(snapshot);
        if (!isValid) {
          console.warn(
            `[Phase 13] Latest snapshot at height ${latestMeta.height} failed integrity check, deleting...`
          );
          const fallbackHeight = await handleCorruptedSnapshot(latestMeta.height);
          console.log(
            `[Phase 13] Snapshot deleted. Next startup will use snapshot at height ${fallbackHeight} or replay from genesis.`
          );
        } else {
          console.log(`[Phase 13] Snapshot at height ${latestMeta.height} verified successfully`);
        }
      } catch (error) {
        console.warn("[Phase 13] Background snapshot verification failed:", error);
        // Don't throw - this is non-critical
      }
    });
  }

  return {
    storage,
    indexState,
    params,
    needsReset,
    remoteSnapshotUsed, // Phase 14: Track if remote snapshot was used
  };
}

/**
 * Get default chain parameters for development
 */
export async function getDefaultChainParams(): Promise<ChainParams> {
  // Phase 30: Check if we should use mainnet params
  // In production, this should default to mainnet
  // For development, you can set MAINNET_MODE=false in environment
  const useMainnet = typeof window !== "undefined" && 
    (window.location.hostname === "indexerchain.com" || 
     window.location.hostname === "www.indexerchain.com" ||
     localStorage.getItem("indexerchain_force_mainnet") === "true");
  
  if (useMainnet) {
    const { MAINNET_PARAMS } = await import("./networkParams.js");
    return MAINNET_PARAMS;
  }
  
  // Phase 21: Default peer reputation parameters (dev/testnet)
  return {
    version: 1,
    networkId: "indexerchain-dev",
    genesisTimestamp: Math.floor(Date.now() / 1000), // Unix timestamp in seconds
    initialDifficulty: 1,
    targetBlockTime: 10, // Target 10 seconds per block
    difficultyAdjustmentInterval: 10, // Adjust difficulty every 10 blocks
    blockReward: 10, // Phase 7: Block reward in IDC
    snapshotInterval: 50, // Phase 9: Create snapshot every 50 blocks
    maxSnapshotCount: 5, // Phase 9: Keep maximum 5 snapshots
    lightNodeWindow: 200, // Phase 10: Keep only recent 200 blocks (light node mode)
    fullSnapshotInterval: 5, // Phase 12: Create full snapshot every 5 snapshots
    maxBlockSizeBytes: 1_000_000,
    // Phase 13: Snapshot verification parameters
    snapshotVerificationSampleRate: 0.3, // 30% chance of full verification on startup
    snapshotAutoVerifyIntervalMs: 60_000, // Background verification every 60 seconds
    // Phase 21: Peer reputation and security parameters
    peerScoreEnabled: true, // Enable peer reputation system
    peerScoreDecayIntervalMs: 60_000, // Check decay every 1 minute
    peerScoreHalfLifeMs: 300_000, // Score half-life: 5 minutes
    peerBanThreshold: 20, // Ban peers with score below 20
    peerBanDurationMs: 600_000, // Ban duration: 10 minutes
    // Phase 22: Fast finality parameters
    finalityEnabled: true, // Enable fast finality
    finalityCommitteeSize: 11, // Committee size (7-21 recommended)
    finalityThreshold: 0.67, // Threshold ratio (2/3)
    finalityVoteTimeoutMs: 5000, // Vote collection timeout: 5 seconds
    finalityCommitteeRoundInterval: 10, // Re-elect committee every 10 blocks
    // Phase 30: Global Consistency Sentinel parameters
    globalSentinelEnabled: true, // Enable global consistency sentinel
    globalDriftCheckIntervalMs: 5000, // Check drift every 5 seconds
    globalDriftCriticalBlocks: 10, // Critical drift: 10 blocks
    globalDriftMinorBlocks: 3, // Minor drift: 3 blocks
    globalMinPeersForAssessment: 3, // Minimum 3 peers for assessment
    globalMinReputationForVoting: 0, // All peers can vote (reputation >= 0)
    // Phase 33: Mining Permission Levels
    minPeersRequired: 3, // Minimum peers required for safe mining
    allowGuardedMining: true, // Auto-enable guarded mining for dev/testnet
    allowLocalMining: false, // Local-only mining disabled by default
    // Phase 34: Quorum Debug Mode
    quorumDebugOverride: false, // Debug mode disabled by default (can be enabled for testing)
    // Phase 35: Mainnet Mining Admission Rules
    mainnetQuorumThresholds: {
      coldStart: 80,
      earlyGrowth: 150,
      mature: 250,
      secure: 400,
    },
    mainnetMinIndependentPeers: {
      coldStart: 1,
      earlyGrowth: 2,
      mature: 3,
      secure: 5,
    },
  };
}

/**
 * Append a mined block to the chain
 * 
 * This function:
 * 1. Verifies the block
 * 2. Appends to storage
 * 3. Applies block to index state
 * 4. Saves to persistence
 * 5. Broadcasts block to P2P network (if connected)
 * 
 * @param block Block to append
 * @param context Chain context
 * @returns Success result
 */
export async function appendMinedBlock(
  block: Block,
  context: ChainContext
): Promise<{ success: boolean; error?: string }> {
  // Check if block already exists (race condition: block may have been appended by another worker or from P2P)
  const existingBlock = context.storage.getBlockByHeight(block.header.height);
  if (existingBlock) {
    // Block already exists - check if it's the same block
    if (existingBlock.hash === block.hash) {
      // Same block - already appended, return success
      console.log(`[appendMinedBlock] Block ${block.header.height} already exists with same hash, skipping append`);
      return { success: true };
    } else {
      // Different block at same height - this is a fork, reject
      return { 
        success: false, 
        error: `Block ${block.header.height} already exists with different hash (fork detected)` 
      };
    }
  }

  // Get previous block (re-fetch to ensure we have the latest tip)
  const prevBlock = context.storage.getTip();
  
  // Check if tip has advanced beyond this block (race condition: another block was appended)
  if (prevBlock && prevBlock.header.height >= block.header.height) {
    // Tip has advanced - this block is stale
    console.log(`[appendMinedBlock] Block ${block.header.height} is stale (tip is now at ${prevBlock.header.height}), skipping append`);
    return { 
      success: false, 
      error: `Block ${block.header.height} is stale (tip is now at ${prevBlock.header.height})` 
    };
  }

  // Phase 6: Get all blocks for difficulty verification
  const allBlocks = context.storage.getAllBlocks();

  // Verify block (with difficulty verification)
  const verification = await verifyBlock(block, prevBlock, allBlocks, context.params);
  if (!verification.valid) {
    return { success: false, error: verification.error };
  }

  try {
    // Re-check tip right before appending (race condition: tip may have changed)
    const currentTip = context.storage.getTip();
    if (currentTip && currentTip.header.height >= block.header.height) {
      // Tip has advanced - this block is stale
      console.log(`[appendMinedBlock] Block ${block.header.height} is stale (tip is now at ${currentTip.header.height}), skipping append`);
      return { 
        success: false, 
        error: `Block ${block.header.height} is stale (tip is now at ${currentTip.header.height})` 
      };
    }
    
    // Check if block already exists (race condition: another worker may have appended it)
    const existingBlock = context.storage.getBlockByHeight(block.header.height);
    if (existingBlock) {
      if (existingBlock.hash === block.hash) {
        // Same block - already appended, return success
        console.log(`[appendMinedBlock] Block ${block.header.height} already exists with same hash, skipping append`);
        return { success: true };
      } else {
        // Different block at same height - this is a fork, reject
        return { 
          success: false, 
          error: `Block ${block.header.height} already exists with different hash (fork detected)` 
        };
      }
    }
    
    // Append to storage (this also saves to persistence)
    context.storage.appendBlock(block);

    // Apply block to index state
    context.indexState.applyBlock(block);
    
    // Phase 29: Report state update to LocalStateCoordinator
    if (typeof window !== "undefined" && (window as any).localStateCoordinator) {
      (window as any).localStateCoordinator.reportLocalState(
        block.header.height,
        block.hash,
        block.header.stateCommitment,
        undefined // finalizedHeight will be updated separately
      );
    }

    // Phase 16: Update total minted after applying block
    // Extract coinbase reward and add to total_minted
    if (block.txs.length > 0) {
      const coinbaseTx = block.txs[0];
      if (coinbaseTx.ownerAddress === "idc_system" && coinbaseTx.ops.length > 0) {
        const rewardOp = coinbaseTx.ops[0];
        if (rewardOp.type === "TRANSFER" && rewardOp.amount) {
          const { IDCToUIDC } = await import("./idcEmission.js");
          const rewardUIDC = IDCToUIDC(rewardOp.amount);
          context.indexState.incrementTotalMinted(rewardUIDC);
        }
      }
    }

    // Phase 9: Auto-generate snapshot if needed
    // Phase 11: Snapshots are now automatically compressed
    // Phase 12: Supports full and delta snapshots
    const height = block.header.height;
    const snapshotInterval = context.params.snapshotInterval ?? 50;
    const maxSnapshotCount = context.params.maxSnapshotCount ?? 5;
    const fullSnapshotInterval = context.params.fullSnapshotInterval ?? 5;

    if (height > 0 && height % snapshotInterval === 0) {
      try {
        // Phase 12: Determine if this should be a full or delta snapshot
        const { loadAllSnapshotMeta, findNearestFullSnapshot } = await import("./snapshot.js");
        const allMetas = loadAllSnapshotMeta();
        const snapshotCount = allMetas.length;
        
        // Check if there's a full snapshot available before deciding on delta
        const hasFullSnapshot = findNearestFullSnapshot(height - 1) !== null;
        
        // Force full snapshot if:
        // 1. This is the first snapshot (snapshotCount === 0)
        // 2. No full snapshot exists (hasFullSnapshot === false)
        // 3. It's time for a full snapshot (snapshotCount % fullSnapshotInterval === 0)
        const isFull = snapshotCount === 0 || !hasFullSnapshot || snapshotCount % fullSnapshotInterval === 0;

        if (isFull) {
          // Full snapshot
          const indexStateSnapshot = context.indexState.toSnapshot();
          // Phase 15: Pass stateCommitment from block header
          await saveSnapshot(height, block.hash, indexStateSnapshot, undefined, true, block.header.stateCommitment);
          // Clear change log after full snapshot
          context.indexState.clearChangeLog();
          context.indexState.beginRecording();
          console.log(`[Phase 12] Full compressed snapshot created at height ${height}`);
        } else {
          // Delta snapshot
          // Get operations since last snapshot
          const deltaOperations = context.indexState.getChangeLog();
          if (deltaOperations.length > 0) {
            // Phase 15: Pass stateCommitment from block header
            await saveSnapshot(height, block.hash, undefined, deltaOperations, false, block.header.stateCommitment);
            // Clear change log after saving delta
            context.indexState.clearChangeLog();
            context.indexState.beginRecording();
            console.log(
              `[Phase 12] Delta compressed snapshot created at height ${height} (${deltaOperations.length} operations)`
            );
          } else {
            // No changes, skip delta snapshot
            console.log(`[Phase 12] No changes since last snapshot, skipping delta at height ${height}`);
          }
        }
        
        // Prune old snapshots
        pruneOldSnapshots(maxSnapshotCount);
      } catch (error) {
        console.error(`[Phase 12] Failed to create snapshot at height ${height}:`, error);
        // Don't fail block append if snapshot fails
      }
    }

    // Phase 10: Auto-prune old blocks (light node mode)
    const lightNodeWindow = context.params.lightNodeWindow ?? 200;
    if (lightNodeWindow > 0) {
      context.storage.autoPrune(height, lightNodeWindow);
    }

    // Phase 17: Fast block relay - broadcast header first, then body
    // Phase 32: Update root tip on signal server
    if (context.p2p && context.p2p.isConnected) {
      // Get miner address from coinbase transaction
      let minerAddress = "idc_unknown";
      if (block.txs.length > 0) {
        const coinbaseTx = block.txs[0];
        if (coinbaseTx.ops.length > 0 && coinbaseTx.ops[0].type === "TRANSFER") {
          minerAddress = coinbaseTx.ops[0].to || "idc_unknown";
        }
      }

      // Phase 17: Broadcast compact header first (fast relay)
      // This allows nodes to quickly detect new blocks and restart mining
      const { headerToCompact } = await import("./blockRelay.js");
      const compactHeader = headerToCompact(block.header, block.hash, block.txs.length, minerAddress);
      context.p2p.broadcast("NEW_BLOCK_HEADER", compactHeader);

      // Also broadcast full block for backward compatibility
      // Nodes that haven't upgraded to Phase 17 will still receive full blocks
      context.p2p.broadcast("NEW_BLOCK", block);
      
      // Phase 32: Update root tip on signal server (if this is a LEADER instance)
      if (typeof window !== "undefined") {
        const { getLocalInstanceCoordinator } = await import("./localInstance.js");
        const coordinator = getLocalInstanceCoordinator();
        if (coordinator.getRole() === "LEADER" && (context.p2p as any).sendToSignalServer) {
          // Get recent headers (last 100) for fast sync
          const recentHeaders: any[] = [];
          let currentBlock = block;
          for (let i = 0; i < 100 && currentBlock; i++) {
            recentHeaders.push(currentBlock.header);
            const prevHash = currentBlock.header.prevHash;
            if (prevHash) {
              // Try to get previous block from storage
              const allBlocks = context.storage.getAllBlocks();
              const prevBlock = allBlocks.find(b => b.hash === prevHash);
              if (prevBlock) {
                currentBlock = prevBlock;
              } else {
                break;
              }
            } else {
              break;
            }
          }
          recentHeaders.reverse(); // Oldest to newest
          
          // Get latest snapshot meta if available
          let latestSnapshotMeta = null;
          try {
            const { getLatestSnapshotMeta } = await import("./snapshot.js");
            latestSnapshotMeta = getLatestSnapshotMeta();
          } catch (error) {
            // Snapshot not available, continue without it
          }
          
          // Phase 37: Send UPDATE_ROOT_TIP with stateCommitment for verification
          (context.p2p as any).sendToSignalServer("UPDATE_ROOT_TIP", {
            header: block.header,
            headerHash: block.hash,
            latestHeight: block.header.height,
            recentHeaders: recentHeaders,
            latestSnapshotMeta: latestSnapshotMeta,
            stateCommitment: block.header.stateCommitment, // Phase 37: Include stateCommitment for Worker verification
            // Note: finalityCert can be added here if available from finalityManager
          });
          console.log(`[Phase 32] Updated root tip on signal server: height=${block.header.height}, recentHeaders=${recentHeaders.length}, hasSnapshot=${!!latestSnapshotMeta}`);
        }
      }
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    
    // Handle race condition: block may have been appended by another worker
    if (errorMsg.includes("Invalid block height") || errorMsg.includes("already exists")) {
      // Re-check if block exists with same hash
      const existingBlock = context.storage.getBlockByHeight(block.header.height);
      if (existingBlock && existingBlock.hash === block.hash) {
        // Same block - already appended, return success (this is normal in cluster mining)
        console.log(`[appendMinedBlock] Block ${block.header.height} was appended by another worker, skipping duplicate append`);
        return { success: true };
      }
      
      // Check if tip has advanced
      const currentTip = context.storage.getTip();
      if (currentTip && currentTip.header.height > block.header.height) {
        // Tip has advanced - this block is stale
        console.log(`[appendMinedBlock] Block ${block.header.height} is stale (tip is now at ${currentTip.header.height}), skipping append`);
        return { 
          success: false, 
          error: `Block ${block.header.height} is stale (tip is now at ${currentTip.header.height})` 
        };
      }
    }
    
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Broadcast transaction to P2P network
 * 
 * @param tx Transaction to broadcast
 * @param context Chain context
 */
export function broadcastTransaction(tx: any, context: ChainContext): void {
  if (context.p2p && context.p2p.isConnected) {
    context.p2p.broadcast("NEW_TX", tx);
  }
}

