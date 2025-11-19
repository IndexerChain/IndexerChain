/**
 * Browser Miner
 * 
 * Implements Proof-of-Work mining in the browser
 * PoW rule: hash(header) must start with N zeros (where N = difficulty)
 */

import type { Block, Tx } from "./types.js";
import type { ChainContext } from "./chain.js";
import { hashBlockHeader } from "./crypto.js";
import { buildCandidateBlock } from "./blockBuilder.js";

/**
 * Sleep utility for yielding control to browser
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if hash satisfies difficulty requirement
 * 
 * @param hash Block hash (hex string)
 * @param difficulty Required number of leading zeros
 * @returns true if hash satisfies difficulty
 */
export function checkDifficulty(hash: string, difficulty: number): boolean {
  if (difficulty <= 0) return true;
  if (difficulty > 64) return false; // Hex string is 64 chars max

  const prefix = "0".repeat(difficulty);
  return hash.startsWith(prefix);
}

/**
 * Mine a block
 * 
 * Continuously increments nonce until hash satisfies difficulty requirement
 * Yields control to browser every 5000 iterations to avoid freezing UI
 * 
 * @param pendingTxs Transactions to include in the block
 * @param chainContext Chain context (storage, state, params)
 * @param onProgress Optional callback for progress updates (hash, nonce)
 * @returns Mined block
 */
export async function mineBlock(
  pendingTxs: Tx[],
  chainContext: ChainContext,
  minerAddress: string,
  onProgress?: (hash: string, nonce: number) => void
): Promise<Block> {
  const prevBlock = chainContext.storage.getTip();
  if (!prevBlock) {
    throw new Error("Cannot mine: no previous block found");
  }

  // Phase 6: Get all blocks for difficulty calculation
  const allBlocks = chainContext.storage.getAllBlocks();

  // Phase 7: Build candidate block (with coinbase and dynamic difficulty)
  // Phase 15: Pass current IndexState for stateCommitment calculation
  // Phase 44: Pass chainContext for IP sharing weight calculation
  const block = await buildCandidateBlock(
    pendingTxs,
    prevBlock,
    allBlocks,
    chainContext.params,
    minerAddress as any,
    chainContext.indexState,
    undefined, // p2pNode - will be passed from caller if available
    chainContext // chainContext for IP sharing weight
  );

  // Phase 6: Use dynamic difficulty from block header
  const difficulty = block.header.difficulty;
  let nonce = 0;
  const YIELD_INTERVAL = 5000; // Yield every 5000 iterations

  // Mining loop
  while (true) {
    // Update nonce
    block.header.nonce = nonce;

    // Compute hash
    const hash = await hashBlockHeader(block.header);

    // Check difficulty
    if (checkDifficulty(hash, difficulty)) {
      // Found valid block!
      block.hash = hash;
      return block;
    }

    // Increment nonce
    nonce++;

    // Yield control to browser periodically to avoid freezing UI
    if (nonce % YIELD_INTERVAL === 0) {
      if (onProgress) {
        onProgress(hash, nonce);
      }
      await sleep(0); // Yield to event loop
    }
  }
}

/**
 * Stop mining signal
 * Used to cancel mining operation
 */
export class MiningCancelledError extends Error {
  constructor() {
    super("Mining was cancelled");
    this.name = "MiningCancelledError";
  }
}

/**
 * Mine block with cancellation support
 * 
 * @param pendingTxs Transactions to include
 * @param chainContext Chain context
 * @param shouldCancel Function that returns true if mining should be cancelled
 * @param onProgress Optional progress callback
 * @returns Mined block or throws MiningCancelledError
 */
export async function mineBlockWithCancel(
  pendingTxs: Tx[],
  chainContext: ChainContext,
  minerAddress: string,
  shouldCancel: () => boolean,
  onProgress?: (hash: string, nonce: number) => void
): Promise<Block> {
  const prevBlock = chainContext.storage.getTip();
  if (!prevBlock) {
    throw new Error("Cannot mine: no previous block found");
  }

  // Phase 6: Get all blocks for difficulty calculation
  const allBlocks = chainContext.storage.getAllBlocks();

  // Phase 7: Build candidate block (with coinbase and dynamic difficulty)
  // Phase 15: Pass current IndexState for stateCommitment calculation
  // Phase 44: Pass chainContext for IP sharing weight calculation
  const block = await buildCandidateBlock(
    pendingTxs,
    prevBlock,
    allBlocks,
    chainContext.params,
    minerAddress as any,
    chainContext.indexState,
    undefined, // p2pNode - will be passed from caller if available
    chainContext // chainContext for IP sharing weight
  );

  // Phase 6: Use dynamic difficulty from block header
  const difficulty = block.header.difficulty;
  let nonce = 0;
  const YIELD_INTERVAL = 5000;

  while (true) {
    // Check if cancelled
    if (shouldCancel()) {
      throw new MiningCancelledError();
    }

    block.header.nonce = nonce;
    const hash = await hashBlockHeader(block.header);

    if (checkDifficulty(hash, difficulty)) {
      block.hash = hash;
      return block;
    }

    nonce++;

    if (nonce % YIELD_INTERVAL === 0) {
      if (onProgress) {
        onProgress(hash, nonce);
      }
      await sleep(0);
    }
  }
}

