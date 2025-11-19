/**
 * Chain Synchronization
 * 
 * Handles chain synchronization between peers
 * 
 * Phase 17: Added fast block relay (header-first, body on-demand)
 */

import type { Block } from "./types.js";
import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { verifyBlock } from "./verify.js";
import {
  compactToHeader,
  validateCompactHeader,
  shouldRestartMining,
  globalBodyRequestTracker,
} from "./blockRelay.js";
import { globalHeaderCache } from "./headerCache.js";
import { hashBlockHeader } from "./crypto.js";

/**
 * Synchronize chain with peers
 * 
 * When receiving a block from peer:
 * - If block.height == local.height + 1: append it
 * - If block.height > local.height: request missing blocks
 * - If block.height <= local.height: ignore (old or forked)
 * 
 * Phase 21: Added sender parameter for peer reputation tracking
 */
export async function handleReceivedBlock(
  block: Block,
  context: ChainContext,
  p2pNode: P2PNode,
  sender?: string
): Promise<{ handled: boolean; error?: string }> {
  const localTip = context.storage.getTip();
  const localHeight = localTip?.header.height ?? -1;
  const blockHeight = block.header.height;

  // Ignore old blocks
  if (blockHeight <= localHeight) {
    return { handled: false };
  }

  // Phase 21: Check if sender is banned
  if (sender && context.params.peerScoreEnabled) {
    const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
    const reputationManager = getGlobalPeerReputationManager(context.params);
    if (reputationManager.isBanned(sender)) {
      return { handled: false, error: "Peer is banned" };
    }
  }

  // If block is next in sequence, append it
  if (blockHeight === localHeight + 1) {
    const prevBlock = localTip;
    // Phase 6: Get all blocks for difficulty verification
    const allBlocks = context.storage.getAllBlocks();
    const startTime = Date.now();
    const verification = await verifyBlock(block, prevBlock, allBlocks, context.params);
    const latencyMs = Date.now() - startTime;
    
    if (!verification.valid) {
      // Phase 21: Record invalid block
      if (sender && context.params.peerScoreEnabled) {
        const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
        const reputationManager = getGlobalPeerReputationManager(context.params);
        reputationManager.onInvalidBlockFrom(sender);
      }
      return { handled: false, error: verification.error };
    }

    try {
      context.storage.appendBlock(block);
      context.indexState.applyBlock(block);
      
      // Phase 21: Record valid block
      if (sender && context.params.peerScoreEnabled) {
        const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
        const reputationManager = getGlobalPeerReputationManager(context.params);
        reputationManager.onValidBlockFrom(sender, latencyMs);
      }
      
      return { handled: true };
    } catch (error) {
      return {
        handled: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // If block is ahead, request missing blocks
  if (blockHeight > localHeight + 1) {
    // Phase 10: In light node mode, check if requested blocks are available
    const minHeight = context.storage.getMinHeight();
    const requestedFromHeight = localHeight + 1;
    
    // If requested blocks are below our minimum (pruned), we need snapshot
    if (requestedFromHeight < minHeight) {
      // In light node mode, we can't provide old blocks
      // The peer should use snapshot + recent blocks instead
      // For now, we'll still request, but the peer may not have them
    }
    
    // Request blocks from height (localHeight + 1) to blockHeight
    p2pNode.broadcast("REQUEST_BLOCKS", {
      fromHeight: localHeight + 1,
      toHeight: blockHeight,
    });
    return { handled: false };
  }

  return { handled: false };
}

/**
 * Handle received blocks (for chain sync)
 * 
 * Phase 21: Added sender parameter for peer reputation tracking
 */
export async function handleReceivedBlocks(
  blocks: Block[],
  context: ChainContext,
  sender?: string
): Promise<{ success: boolean; error?: string; appended: number }> {
  let appended = 0;

  // Sort blocks by height
  const sortedBlocks = blocks.sort((a, b) => a.header.height - b.header.height);

  // Track the expected next height as we process blocks
  // This allows us to handle out-of-order blocks in the same batch
  let expectedNextHeight = -1;
  
  for (const block of sortedBlocks) {
    const localTip = context.storage.getTip();
    const localHeight = localTip?.header.height ?? -1;

    // Skip if we already have this block
    if (block.header.height <= localHeight) {
      continue;
    }

    // Check if block is too far ahead (height gap > 1)
    // This indicates missing blocks, which is normal when blocks are pruned
    // However, if we're in the middle of processing a batch, we should continue
    // to process consecutive blocks in the batch, even if there's a gap from local height
    
    // If this is the first block in the batch, check if it's consecutive from local
    // For subsequent blocks, check if they continue the sequence
    if (expectedNextHeight === -1) {
      // First block in batch - must be consecutive from local height
      if (block.header.height !== localHeight + 1) {
        const gap = block.header.height - localHeight;
        if (gap > 1) {
          // Special case: if local height is 0 (genesis) and Worker has headers from a higher height,
          // allow starting from Worker's headers even if they don't connect to genesis
          if (localHeight === 0 && gap > 100) {
            // Check if this block matches Worker's recent headers
            const workerRecentHeaders = typeof window !== "undefined" ? ((window as any).lastRootTipRecentHeaders || []) : [];
            const matchingHeader = workerRecentHeaders.find((h: any) => h.height === block.header.height);
            
            if (matchingHeader) {
              // Verify the block hash matches the header hash from Worker
              const { hashBlockHeader } = await import("./crypto.js");
              const blockHeaderHash = await hashBlockHeader(block.header);
              const expectedHash = matchingHeader.hash || (await hashBlockHeader(matchingHeader));
              
              if (blockHeaderHash === expectedHash) {
                // This block matches Worker's header - allow it even though it doesn't connect to genesis
                console.log(`[Sync] Allowing block ${block.header.height} from Worker headers (local is at genesis, gap: ${gap} blocks)`);
                // This block is valid, process it
                expectedNextHeight = block.header.height + 1;
              } else {
                // Hash mismatch - skip this block
                console.warn(`[Sync] Block ${block.header.height} hash mismatch with Worker header, skipping`);
                continue;
              }
            } else {
              // Not in Worker headers - skip it
              console.warn(`[Sync] Block ${block.header.height} not in Worker headers, skipping`);
              continue;
            }
          } else {
            // If local height is 0 and we receive a block > 1, we need to request from height 1
            if (localHeight === 0 && block.header.height > 1) {
              // Request missing blocks from height 1
              if (context.p2p) {
                context.p2p.broadcast("REQUEST_BLOCKS", {
                  fromHeight: 1,
                  toHeight: block.header.height - 1,
                });
              }
            }
            // Skip blocks that are too far ahead - will be requested later
            continue;
          }
        } else if (gap < 1) {
          // This shouldn't happen (already checked above), but handle it
          // Skip old blocks silently
          continue;
        }
      } else {
        // This block is consecutive, process it
        expectedNextHeight = block.header.height + 1;
      }
    } else {
      // We're processing a batch - check if this block continues the sequence
      if (block.header.height !== expectedNextHeight) {
        // Gap in the batch - this means we're missing blocks in the middle
        // Skip this block and continue to see if we can process later blocks
        continue;
      }
      // This block continues the sequence - expectedNextHeight will be updated after append
    }

    // Phase 6: Get all blocks for difficulty verification
    const allBlocks = context.storage.getAllBlocks();
    
    // Special case: if local is at genesis (height 0) and this block is from Worker headers,
    // we need to handle it specially because it won't connect to genesis
    let allowFromWorkerHeaders = false;
    if (localHeight === 0 && block.header.height > 100) {
      const workerRecentHeaders = typeof window !== "undefined" ? ((window as any).lastRootTipRecentHeaders || []) : [];
      const matchingHeader = workerRecentHeaders.find((h: any) => h.height === block.header.height);
      
      if (matchingHeader) {
        // Verify the block hash matches the header hash from Worker
        const { hashBlockHeader } = await import("./crypto.js");
        const blockHeaderHash = await hashBlockHeader(block.header);
        const expectedHash = matchingHeader.hash || (await hashBlockHeader(matchingHeader));
        
        if (blockHeaderHash === expectedHash) {
          // This block matches Worker's header - allow it even though it doesn't connect to genesis
          console.log(`[Sync] Allowing block ${block.header.height} from Worker headers (local is at genesis, will skip prevHash check in verification)`);
          allowFromWorkerHeaders = true;
        }
      }
    }
    
    // Phase 21: Check if sender is banned
    if (sender && context.params.peerScoreEnabled) {
      const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
      const reputationManager = getGlobalPeerReputationManager(context.params);
      if (reputationManager.isBanned(sender)) {
        continue; // Skip blocks from banned peers
      }
    }

    // Verify block (with difficulty verification)
    const startTime = Date.now();
    let verification;
    
    // Special handling for blocks from Worker headers when local is at genesis
    if (allowFromWorkerHeaders && localHeight === 0) {
      // For blocks from Worker headers, skip prevHash check
      // We've already verified the block hash matches Worker's header
      // Still verify other aspects (merkle root, difficulty, etc.) but skip prevHash
      const { verifyBlock } = await import("./verify.js");
      // Pass null as prevBlock to skip prevHash check
      verification = await verifyBlock(block, null, allBlocks, context.params);
      // If verification fails only due to prevHash, allow it
      if (!verification.valid && verification.error?.includes("prevHash")) {
        // Create a modified verification that allows the block
        // We'll do basic checks manually
        const { hashBlockHeader } = await import("./crypto.js");
        const blockHash = await hashBlockHeader(block.header);
        if (blockHash === block.hash) {
          verification = { valid: true };
        }
      }
    } else {
      verification = await verifyBlock(block, localTip, allBlocks, context.params);
    }
    
    const latencyMs = Date.now() - startTime;
    
    if (!verification.valid) {
      // Phase 21: Record invalid block
      // But don't ban for height mismatch if it's due to missing blocks (gap > 1)
      // This is handled above, so if we get here, it's a real verification error
      if (sender && context.params.peerScoreEnabled) {
        const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
        const reputationManager = getGlobalPeerReputationManager(context.params);
        reputationManager.onInvalidBlockFrom(sender);
      }
      console.error(`[Sync] Block ${block.header.height} verification failed: ${verification.error}`);
      // Continue processing other blocks instead of returning immediately
      // This allows us to append valid blocks even if some fail
      continue;
    }

    // Append block
    try {
      // Re-check tip before appending (in case another block was appended)
      const currentTip = context.storage.getTip();
      const currentHeight = currentTip?.header.height ?? -1;
      
      // Skip if we already have this block (race condition)
      if (block.header.height <= currentHeight) {
        continue;
      }
      
      context.storage.appendBlock(block);
      context.indexState.applyBlock(block);
      
      // Phase 21: Record valid block
      if (sender && context.params.peerScoreEnabled) {
        const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
        const reputationManager = getGlobalPeerReputationManager(context.params);
        reputationManager.onValidBlockFrom(sender, latencyMs);
      }
      
      appended++;
      
      // Update expectedNextHeight after successful append
      // This ensures we continue processing consecutive blocks correctly
      expectedNextHeight = block.header.height + 1;
    } catch (error) {
      console.error(`[Sync] ❌ Failed to append block ${block.header.height}:`, error);
      // Continue processing other blocks instead of returning immediately
      // Don't update expectedNextHeight on error - we'll skip this block
      continue;
    }
  }

  return { success: true, appended };
}

/**
 * Phase 17: Handle received block header (fast relay)
 * 
 * This is called when receiving NEW_BLOCK_HEADER message.
 * Validates header and triggers mining restart if needed.
 */
export async function handleReceivedBlockHeader(
  compactHeader: {
    height: number;
    hash: string;
    prevHash: string;
    stateCommitment: string;
    txnCount: number;
    miner: string;
    timestamp: number;
    difficulty: number;
    nonce: number;
    merkleRoot: string;
  },
  context: ChainContext,
  p2pNode: P2PNode,
  sender?: string // Phase 21: Added sender parameter
): Promise<{ handled: boolean; shouldRestartMining: boolean; error?: string }> {
  const localTip = context.storage.getTip();
  const localHeight = localTip?.header.height ?? -1;

  // Convert compact header to full header
  const header = compactToHeader(compactHeader);

  // Get previous header hash
  const prevHeaderHash = localTip ? localTip.hash : null;

  // Phase 21: Check if sender is banned
  if (sender && context.params.peerScoreEnabled) {
    const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
    const reputationManager = getGlobalPeerReputationManager(context.params);
    if (reputationManager.isBanned(sender)) {
      return { handled: false, shouldRestartMining: false, error: "Peer is banned" };
    }
  }

  // Validate header
  const startTime = Date.now();
  const validation = validateCompactHeader(compactHeader, prevHeaderHash, {
    targetBlockTime: context.params.targetBlockTime,
    maxBlockSizeBytes: context.params.maxBlockSizeBytes ?? 1_000_000,
  });

  if (!validation.valid) {
    // Phase 21: Record invalid header
    if (sender && context.params.peerScoreEnabled) {
      const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
      const reputationManager = getGlobalPeerReputationManager(context.params);
      reputationManager.onInvalidHeaderFrom(sender);
    }
    return { handled: false, shouldRestartMining: false, error: validation.error };
  }

  // Verify hash matches
  const computedHash = await hashBlockHeader(header);
  if (computedHash !== compactHeader.hash) {
    // Phase 21: Record invalid header
    if (sender && context.params.peerScoreEnabled) {
      const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
      const reputationManager = getGlobalPeerReputationManager(context.params);
      reputationManager.onInvalidHeaderFrom(sender);
    }
    return { handled: false, shouldRestartMining: false, error: "Header hash mismatch" };
  }
  
  const latencyMs = Date.now() - startTime;

  // Check if we already have this header
  if (globalHeaderCache.hasHeader(compactHeader.hash)) {
    return { handled: false, shouldRestartMining: false };
  }

  // Add to header cache
  globalHeaderCache.addHeader(header, compactHeader.hash, false);

  // Check if this should trigger mining restart
  const shouldRestart = shouldRestartMining(compactHeader, localHeight);

  // Phase 21: Record valid header
  if (sender && context.params.peerScoreEnabled) {
    const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
    const reputationManager = getGlobalPeerReputationManager(context.params);
    reputationManager.onValidHeaderFrom(sender, latencyMs);
  }

  // Phase 22: Trigger finality process for new block header
  if (context.params.finalityEnabled && compactHeader.height === localHeight + 1) {
    try {
      const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
      const { getOrCreateNodeAddress } = await import("./keys.js");
      
      // Get finality manager instance (will be initialized in App.tsx)
      // For now, we'll trigger it through a global instance or callback
      // This will be properly integrated in App.tsx
      
      // Get all peers with their addresses and scores
      const reputationManager = getGlobalPeerReputationManager(context.params);
      const allScores = reputationManager.getAllScores();
      const nodeAddress = await getOrCreateNodeAddress();
      
      // Map peer scores to format expected by finality manager
      const allPeers = allScores.map((score) => {
        // Get peer address from peer ID (we'll need to store this mapping)
        // For now, use peer ID as address placeholder
        return {
          peerId: score.peerId,
          address: score.peerId as any, // TODO: Get actual address from peer
          score,
        };
      });
      
      // Add current node
      allPeers.push({
        peerId: p2pNode.nodeId,
        address: nodeAddress,
        score: reputationManager.getScore(p2pNode.nodeId) || {
          peerId: p2pNode.nodeId,
          lastSeenAt: Date.now(),
          blocksServed: 0,
          blocksInvalid: 0,
          snapshotsServed: 0,
          snapshotsInvalid: 0,
          headersServed: 0,
          requestsSent: 0,
          responsesOk: 0,
          responsesTimeout: 0,
          workAssigned: 0,
          workCompleted: 0,
          workFailed: 0,
          score: 50,
          trustLevel: "normal",
        },
      });
      
      // Trigger finality (will be handled by FinalityManager in App.tsx)
      // We'll emit an event or use a callback mechanism
      if (typeof window !== "undefined" && (window as any).finalityManager) {
        (window as any).finalityManager.handleNewBlockHeader(
          compactHeader.hash,
          compactHeader.height,
          allPeers
        );
      }
    } catch (error) {
      // Don't fail header processing if finality fails
    }
  }

  // If this is the next block, request body
  if (compactHeader.height === localHeight + 1) {
    // Check if we already requested this body
    if (!globalBodyRequestTracker.isPending(compactHeader.hash)) {
      globalBodyRequestTracker.addRequest(compactHeader.hash, compactHeader.height);
      p2pNode.broadcast("REQUEST_BLOCK_BODY", {
        hash: compactHeader.hash,
        height: compactHeader.height,
      });
    }
  }

  return {
    handled: true,
    shouldRestartMining: shouldRestart,
  };
}

/**
 * Phase 17: Handle received block body
 * 
 * This is called when receiving BLOCK_BODY message.
 * Validates full block and appends to chain.
 * 
 * Phase 21: Added sender parameter for peer reputation tracking
 */
export async function handleReceivedBlockBody(
  block: Block,
  context: ChainContext,
  sender?: string
): Promise<{ handled: boolean; error?: string }> {
  const localTip = context.storage.getTip();

  // Phase 21: Check if sender is banned
  if (sender && context.params.peerScoreEnabled) {
    const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
    const reputationManager = getGlobalPeerReputationManager(context.params);
    if (reputationManager.isBanned(sender)) {
      return { handled: false, error: "Peer is banned" };
    }
  }

  // Check if we have the header
  const cached = globalHeaderCache.getHeaderByHash(block.hash);
  if (!cached) {
    // Header not in cache, treat as regular block
    return handleReceivedBlock(block, context, context.p2p!, sender);
  }

  // Verify header matches
  if (cached.header.height !== block.header.height || cached.hash !== block.hash) {
    // Phase 21: Record invalid block
    if (sender && context.params.peerScoreEnabled) {
      const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
      const reputationManager = getGlobalPeerReputationManager(context.params);
      reputationManager.onInvalidBlockFrom(sender);
    }
    return { handled: false, error: "Block body doesn't match cached header" };
  }

  // Verify full block
  const allBlocks = context.storage.getAllBlocks();
  const startTime = Date.now();
  const verification = await verifyBlock(block, localTip, allBlocks, context.params);
  const latencyMs = Date.now() - startTime;

  if (!verification.valid) {
    // Remove invalid header from cache
    globalHeaderCache.removeHeader(block.hash);
    // Phase 21: Record invalid block
    if (sender && context.params.peerScoreEnabled) {
      const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
      const reputationManager = getGlobalPeerReputationManager(context.params);
      reputationManager.onInvalidBlockFrom(sender);
    }
    return { handled: false, error: verification.error };
  }

  // Verify state commitment matches
  if (block.header.stateCommitment && cached.header.stateCommitment) {
    if (block.header.stateCommitment !== cached.header.stateCommitment) {
      globalHeaderCache.removeHeader(block.hash);
      return { handled: false, error: "State commitment mismatch" };
    }
  }

  // Append block
  try {
    context.storage.appendBlock(block);
    context.indexState.applyBlock(block);

    // Phase 21: Record valid block
    if (sender && context.params.peerScoreEnabled) {
      const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
      const reputationManager = getGlobalPeerReputationManager(context.params);
      reputationManager.onValidBlockFrom(sender, latencyMs);
    }

    // Mark body as received in cache
    globalHeaderCache.markBodyReceived(block.hash);
    globalBodyRequestTracker.removeRequest(block.hash);

    return { handled: true };
  } catch (error) {
    return {
      handled: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

