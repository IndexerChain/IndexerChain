/**
 * Chain Synchronization
 * 
 * Handles chain synchronization between peers
 */

import type { Block } from "./types.js";
import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { verifyBlock } from "./verify.js";

/**
 * Synchronize chain with peers
 * 
 * When receiving a block from peer:
 * - If block.height == local.height + 1: append it
 * - If block.height > local.height: request missing blocks
 * - If block.height <= local.height: ignore (old or forked)
 */
export async function handleReceivedBlock(
  block: Block,
  context: ChainContext,
  p2pNode: P2PNode
): Promise<{ handled: boolean; error?: string }> {
  const localTip = context.storage.getTip();
  const localHeight = localTip?.header.height ?? -1;
  const blockHeight = block.header.height;

  // Ignore old blocks
  if (blockHeight <= localHeight) {
    return { handled: false };
  }

  // If block is next in sequence, append it
  if (blockHeight === localHeight + 1) {
    const prevBlock = localTip;
    const verification = await verifyBlock(block, prevBlock);
    
    if (!verification.valid) {
      return { handled: false, error: verification.error };
    }

    try {
      context.storage.appendBlock(block);
      context.indexState.applyBlock(block);
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
 */
export async function handleReceivedBlocks(
  blocks: Block[],
  context: ChainContext
): Promise<{ success: boolean; error?: string; appended: number }> {
  let appended = 0;

  // Sort blocks by height
  const sortedBlocks = blocks.sort((a, b) => a.header.height - b.header.height);

  for (const block of sortedBlocks) {
    const localTip = context.storage.getTip();
    const localHeight = localTip?.header.height ?? -1;

    // Skip if we already have this block
    if (block.header.height <= localHeight) {
      continue;
    }

    // Verify block
    const verification = await verifyBlock(block, localTip);
    if (!verification.valid) {
      return {
        success: false,
        error: `Block ${block.header.height} verification failed: ${verification.error}`,
        appended,
      };
    }

    // Append block
    try {
      context.storage.appendBlock(block);
      context.indexState.applyBlock(block);
      appended++;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        appended,
      };
    }
  }

  return { success: true, appended };
}

