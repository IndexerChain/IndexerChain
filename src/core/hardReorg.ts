/**
 * Hard Reorg (Chain Reorganization)
 * 
 * Detects and repairs blockchain forks by:
 * 1. Checking if local tip hash is in recent headers from root tip
 * 2. If not, detecting fork and triggering hard reorg
 * 3. Rewinding to common ancestor height
 * 4. Rebuilding state from that point
 * 5. Resuming sync from correct chain
 */

import type { ChainContext } from "./chain.js";
import { logger } from "./logger.js";

export interface HardReorgResult {
  reorged: boolean;
  rewindHeight: number;
  reason: string;
  localHeight: number;
  rootHeight: number;
  localTipHash: string;
  rootTipHash: string;
}

/**
 * Check if local chain has forked from root tip
 * 
 * @param chainContext Chain context
 * @param rootTipHash Root tip hash from signal server
 * @param recentHeaders Recent headers from root tip (last 500 blocks)
 * @param rootHeight Root tip height
 * @returns Reorg result if fork detected, null otherwise
 */
export function checkForFork(
  chainContext: ChainContext,
  rootTipHash: string,
  recentHeaders: Array<{ height: number; hash: string }> | undefined,
  rootHeight: number
): HardReorgResult | null {
  const localTip = chainContext.storage.getTip();
  if (!localTip) {
    // No local chain, not a fork
    return null;
  }

  const localHeight = localTip.header.height;
  const localTipHash = localTip.hash;

  // Special case: If local height is 0 (only genesis), don't trigger reorg
  // This prevents the "Rewind height 0 must be less than local height 0" error
  if (localHeight === 0) {
    logger.debug(`[HardReorg] Local chain is at genesis (height 0), skipping fork check`);
    return null;
  }

  // If local tip hash matches root tip hash, we're on the correct chain
  if (localTipHash === rootTipHash) {
    return null;
  }

  // If local height is ahead of root, this is suspicious but not necessarily a fork
  // (could be that root tip is stale)
  if (localHeight > rootHeight) {
    logger.warn(`[HardReorg] Local height (${localHeight}) is ahead of root height (${rootHeight}), but hash mismatch. Possible fork.`);
    // Continue to check recent headers
  }

  // If local height is significantly behind (>= 5 blocks), check if we're on a fork
  const heightDiff = rootHeight - localHeight;
  if (heightDiff >= 5) {
    // Check if local tip hash is in recent headers
    if (recentHeaders && recentHeaders.length > 0) {
      const recentHashes = new Set(recentHeaders.map(h => h.hash));
      
      if (!recentHashes.has(localTipHash)) {
        // Local tip hash is not in recent headers - we're on a fork!
        logger.warn(`[HardReorg] Fork detected: local tip hash ${localTipHash.substring(0, 16)}... not in recent headers (${recentHeaders.length} headers checked)`);
        
        // Find common ancestor by checking if any of our recent blocks are in recent headers
        // We need to find the highest block in our chain that is also in the main chain
        let commonAncestorHeight = -1;
        const allBlocks = chainContext.storage.getAllBlocks();
        
        // Check blocks from local height backwards to find the last common block
        // We check the last 100 blocks (or all blocks if less than 100)
        const checkRange = Math.min(100, allBlocks.length);
        for (let i = allBlocks.length - 1; i >= Math.max(0, allBlocks.length - checkRange); i--) {
          const block = allBlocks[i];
          if (recentHashes.has(block.hash)) {
            // Found a block that's in the main chain
            commonAncestorHeight = block.header.height;
            logger.info(`[HardReorg] Found common ancestor at height ${commonAncestorHeight} (hash: ${block.hash.substring(0, 16)}...)`);
            break;
          }
        }
        
        // If no common ancestor found in recent blocks, check if we're too far behind
        // In this case, we should rewind to a safe height (e.g., localHeight - 50, or 0)
        let targetRewindHeight: number;
        if (commonAncestorHeight >= 0) {
          // Found common ancestor - rewind to that height (keep the common ancestor)
          targetRewindHeight = commonAncestorHeight;
        } else {
          // No common ancestor found - we're on a completely different chain
          // Rewind to a safe point: either localHeight - 50, or 0 if localHeight < 50
          // This ensures we don't lose too much history, but also don't keep invalid blocks
          targetRewindHeight = Math.max(0, localHeight - 50);
          logger.warn(`[HardReorg] No common ancestor found in recent blocks. Rewinding to safe height ${targetRewindHeight}`);
        }
        
        return {
          reorged: false, // Not yet reorged, just detected
          rewindHeight: targetRewindHeight,
          reason: `Local tip hash not in recent headers. Local: ${localHeight} (${localTipHash.substring(0, 16)}...), Root: ${rootHeight} (${rootTipHash.substring(0, 16)}...)`,
          localHeight,
          rootHeight,
          localTipHash,
          rootTipHash,
        };
      }
    } else {
      // No recent headers provided, but height difference is significant
      // This could indicate a fork, but we can't be sure without headers
      // For now, we'll be conservative and not trigger reorg
      logger.debug(`[HardReorg] Height difference ${heightDiff} but no recent headers to verify fork`);
    }
  }

  return null;
}

/**
 * Perform hard reorg: rewind chain to specified height
 * 
 * @param chainContext Chain context
 * @param rewindHeight Height to rewind to (blocks above this will be removed)
 * @returns Success result
 */
export async function performHardReorg(
  chainContext: ChainContext,
  rewindHeight: number
): Promise<{ success: boolean; error?: string; removedBlocks: number }> {
  try {
    const localTip = chainContext.storage.getTip();
    if (!localTip) {
      return { success: false, error: "No local chain to rewind", removedBlocks: 0 };
    }

    const localHeight = localTip.header.height;
    
    // Special case: If rewindHeight === 0 and localHeight === 0, there's nothing to rewind
    // This can happen when chain is empty (only genesis) and fork detection tries to rewind to 0
    if (rewindHeight === 0 && localHeight === 0) {
      logger.info(`[HardReorg] Chain is already at height 0 (genesis only), no rewind needed`);
      return { success: true, removedBlocks: 0 };
    }
    
    if (rewindHeight >= localHeight) {
      return { success: false, error: `Rewind height ${rewindHeight} must be less than local height ${localHeight}`, removedBlocks: 0 };
    }

    logger.warn(`[HardReorg] 🔄 Starting hard reorg: rewinding from height ${localHeight} to ${rewindHeight}`);

    // Step 1: Remove blocks from rewindHeight + 1 onwards
    const blocksBefore = chainContext.storage.getAllBlocks().length;
    chainContext.storage.removeBlocksFromHeight(rewindHeight + 1);
    const blocksAfter = chainContext.storage.getAllBlocks().length;
    const removedBlocks = blocksBefore - blocksAfter;

    logger.info(`[HardReorg] ✅ Removed ${removedBlocks} blocks (from height ${rewindHeight + 1} to ${localHeight})`);

    // Step 2: Rebuild index state from remaining blocks
    // We need to rebuild state from the rewind height
    logger.info(`[HardReorg] 🔄 Rebuilding index state from height ${rewindHeight}...`);
    
    // Get the block at rewind height (or genesis if rewindHeight is 0)
    const anchorBlock = chainContext.storage.getBlockByHeight(rewindHeight);
    if (!anchorBlock && rewindHeight > 0) {
      // If anchor block not found, try to find the highest available block
      const allBlocks = chainContext.storage.getAllBlocks();
      if (allBlocks.length === 0) {
        return { success: false, error: `No blocks found after rewind`, removedBlocks: 0 };
      }
      // Use the highest available block as anchor
      const actualAnchor = allBlocks[allBlocks.length - 1];
      logger.warn(`[HardReorg] Anchor block at height ${rewindHeight} not found, using highest available block at height ${actualAnchor.header.height}`);
    }

    // Rebuild state by replaying all blocks from genesis (or from snapshot if available)
    // For now, we'll use a simpler approach: rebuild from the anchor block's state commitment
    // If anchor block has state commitment, we can use it to verify state
    // Otherwise, we need to replay from genesis or from a snapshot

    // Phase 12: Try to use snapshot if available
    const { getLatestSnapshotMeta, loadSnapshotByHeight } = await import("./snapshot.js");
    const latestSnap = getLatestSnapshotMeta();
    
    if (latestSnap && latestSnap.height <= rewindHeight) {
      // We have a snapshot at or before rewind height, use it
      logger.info(`[HardReorg] Using snapshot at height ${latestSnap.height} to rebuild state`);
      try {
        const snapData = await loadSnapshotByHeight(latestSnap.height);
        if (snapData && snapData.indexState) {
          // Restore state from snapshot
          const { IndexState } = await import("./indexState.js");
          const restoredState = IndexState.fromSnapshot(snapData.indexState);
          const restoredInternalState = (restoredState as any).getInternalState();
          const currentInternalState = (chainContext.indexState as any).getInternalState();
          
          // Clear and restore
          currentInternalState.clear();
          for (const [ns, kvMap] of restoredInternalState) {
            const newMap = new Map(kvMap);
            currentInternalState.set(ns, newMap);
          }
          
          // Replay blocks from snapshot height + 1 to rewind height
          const blocksToReplay = chainContext.storage.getAllBlocks().filter(
            b => b.header.height > latestSnap.height && b.header.height <= rewindHeight
          );
          
          for (const block of blocksToReplay) {
            chainContext.indexState.applyBlock(block);
          }
          
          logger.info(`[HardReorg] ✅ Rebuilt state from snapshot (height ${latestSnap.height}) + ${blocksToReplay.length} blocks`);
        }
      } catch (error) {
        logger.warn(`[HardReorg] Failed to use snapshot, falling back to full replay:`, error);
        // Fall through to full replay
      }
    }

    // If snapshot approach didn't work, do full replay
    if (chainContext.storage.getAllBlocks().length > 0) {
      logger.info(`[HardReorg] Replaying all blocks to rebuild state...`);
      const { IndexState } = await import("./indexState.js");
      const newIndexState = IndexState.createEmpty();
      newIndexState.beginRecording();
      
      const allBlocks = chainContext.storage.getAllBlocks();
      for (const block of allBlocks) {
        newIndexState.applyBlock(block);
      }
      
      // Replace index state
      const currentInternalState = (chainContext.indexState as any).getInternalState();
      const newInternalState = (newIndexState as any).getInternalState();
      currentInternalState.clear();
      for (const [ns, kvMap] of newInternalState) {
        const newMap = new Map(kvMap);
        currentInternalState.set(ns, newMap);
      }
      
      logger.info(`[HardReorg] ✅ Rebuilt state by replaying ${allBlocks.length} blocks`);
    }

    logger.info(`[HardReorg] ✅ Hard reorg completed: rewound to height ${rewindHeight}, removed ${removedBlocks} blocks`);

    return {
      success: true,
      removedBlocks,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`[HardReorg] ❌ Failed to perform hard reorg:`, error);
    return {
      success: false,
      error: errorMsg,
      removedBlocks: 0,
    };
  }
}

