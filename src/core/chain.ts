/**
 * Chain Initialization and High-level API
 * 
 * Provides a simple API to initialize and manage the chain
 */

import type { ChainParams, Block } from "./types.js";
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
  const indexState = IndexState.createEmpty();
  indexState.beginRecording(); // Start recording changes for delta snapshots
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

  // Phase 10: Replay blocks from startHeight to tip (with light node window limit)
  const tip = storage.getTip();
  const lightNodeWindow = params.lightNodeWindow ?? 200;
  
  if (tip) {
    // In light node mode, we may not have all blocks from startHeight
    // We'll replay what we have, starting from the earliest available block
    const minHeight = storage.getMinHeight();
    const actualStartHeight = Math.max(startHeight, minHeight);
    
    // Only replay blocks within the window (if in light node mode)
    const maxReplayHeight = lightNodeWindow > 0 
      ? Math.min(tip.header.height, actualStartHeight + lightNodeWindow - 1)
      : tip.header.height;
    
    for (let h = actualStartHeight; h <= maxReplayHeight; h++) {
      const block = storage.getBlockByHeight(h);
      if (block) {
        indexState.applyBlock(block);
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

  return {
    storage,
    indexState,
    params,
    needsReset,
  };
}

/**
 * Get default chain parameters for development
 */
export function getDefaultChainParams(): ChainParams {
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
  // Get previous block
  const prevBlock = context.storage.getTip();

  // Phase 6: Get all blocks for difficulty verification
  const allBlocks = context.storage.getAllBlocks();

  // Verify block (with difficulty verification)
  const verification = await verifyBlock(block, prevBlock, allBlocks, context.params);
  if (!verification.valid) {
    return { success: false, error: verification.error };
  }

  try {
    // Append to storage (this also saves to persistence)
    context.storage.appendBlock(block);

    // Apply block to index state
    context.indexState.applyBlock(block);

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
        const { loadAllSnapshotMeta } = await import("./snapshot.js");
        const allMetas = loadAllSnapshotMeta();
        const snapshotCount = allMetas.length;
        const isFull = snapshotCount % fullSnapshotInterval === 0;

        if (isFull) {
          // Full snapshot
          const indexStateSnapshot = context.indexState.toSnapshot();
          await saveSnapshot(height, block.hash, indexStateSnapshot, undefined, true);
          // Clear change log after full snapshot
          context.indexState.clearChangeLog();
          context.indexState.beginRecording();
          console.log(`[Phase 12] Full compressed snapshot created at height ${height}`);
        } else {
          // Delta snapshot
          // Get operations since last snapshot
          const deltaOperations = context.indexState.getChangeLog();
          if (deltaOperations.length > 0) {
            await saveSnapshot(height, block.hash, undefined, deltaOperations, false);
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

    // Broadcast to P2P network
    if (context.p2p && context.p2p.isConnected) {
      context.p2p.broadcast("NEW_BLOCK", block);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
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

