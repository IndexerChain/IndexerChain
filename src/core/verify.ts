/**
 * Block Verification
 * 
 * Functions for verifying blocks before appending to chain
 */

import type { Block } from "./types.js";
import { hashBlockHeader } from "./crypto.js";
import { calcMerkleRoot } from "./merkle.js";
import { checkDifficulty } from "./miner.js";

/**
 * Verify a block
 * 
 * Checks:
 * - Height is continuous (height = prevBlock.height + 1)
 * - prevHash matches previous block hash
 * - merkleRoot is correct
 * - Block hash is correct
 * - Difficulty requirement is satisfied
 * 
 * @param block Block to verify
 * @param prevBlock Previous block
 * @returns Verification result
 */
export async function verifyBlock(
  block: Block,
  prevBlock: Block | null
): Promise<{ valid: boolean; error?: string }> {
  // Check height continuity
  if (prevBlock === null) {
    // Genesis block
    if (block.header.height !== 0) {
      return { valid: false, error: "Genesis block must have height 0" };
    }
    if (block.header.prevHash !== "0".repeat(64)) {
      return {
        valid: false,
        error: "Genesis block must have prevHash = 0...0",
      };
    }
  } else {
    // Non-genesis block
    const expectedHeight = prevBlock.header.height + 1;
    if (block.header.height !== expectedHeight) {
      return {
        valid: false,
        error: `Height mismatch: expected ${expectedHeight}, got ${block.header.height}`,
      };
    }
    if (block.header.prevHash !== prevBlock.hash) {
      return {
        valid: false,
        error: `prevHash mismatch: expected ${prevBlock.hash}, got ${block.header.prevHash}`,
      };
    }
  }

  // Verify merkle root
  const txIds = block.txs.map((tx) => tx.txId);
  const computedMerkleRoot = await calcMerkleRoot(txIds);
  if (block.header.merkleRoot !== computedMerkleRoot) {
    return {
      valid: false,
      error: `Merkle root mismatch: expected ${computedMerkleRoot}, got ${block.header.merkleRoot}`,
    };
  }

  // Verify block hash
  const computedHash = await hashBlockHeader(block.header);
  if (block.hash !== computedHash) {
    return {
      valid: false,
      error: `Block hash mismatch: expected ${computedHash}, got ${block.hash}`,
    };
  }

  // Verify difficulty
  if (!checkDifficulty(block.hash, block.header.difficulty)) {
    return {
      valid: false,
      error: `Block hash does not satisfy difficulty requirement (${block.header.difficulty} leading zeros)`,
    };
  }

  return { valid: true };
}

