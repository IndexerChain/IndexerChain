/**
 * Block Verification
 * 
 * Phase 5: Added transaction signature verification
 * Phase 6: Added difficulty verification
 * Phase 7: Added coinbase and transfer balance verification
 */

import type { Block, ChainParams } from "./types.js";
import { hashBlockHeader } from "./crypto.js";
import { calcMerkleRoot } from "./merkle.js";
import { checkDifficulty } from "./miner.js";
import { verifyTxSignature } from "./signatures.js";
import { getNextDifficulty } from "./difficulty.js";
import { IndexState } from "./indexState.js";

/**
 * Verify a block
 * 
 * Phase 6: Added difficulty verification
 * 
 * Checks:
 * - Height is continuous (height = prevBlock.height + 1)
 * - prevHash matches previous block hash
 * - merkleRoot is correct
 * - Block hash is correct
 * - Difficulty requirement is satisfied
 * - Difficulty value matches expected (Phase 6)
 * 
 * @param block Block to verify
 * @param prevBlock Previous block
 * @param allBlocks All blocks in the chain (for difficulty calculation)
 * @param params Chain parameters
 * @returns Verification result
 */
export async function verifyBlock(
  block: Block,
  prevBlock: Block | null,
  allBlocks?: Block[],
  params?: ChainParams
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

  // Verify difficulty requirement (hash must satisfy difficulty)
  if (!checkDifficulty(block.hash, block.header.difficulty)) {
    return {
      valid: false,
      error: `Block hash does not satisfy difficulty requirement (${block.header.difficulty} leading zeros)`,
    };
  }

  // Phase 6: Verify difficulty value matches expected
  if (allBlocks && params && prevBlock) {
    const expectedDifficulty = getNextDifficulty(allBlocks, params);
    if (block.header.difficulty !== expectedDifficulty) {
      return {
        valid: false,
        error: `Difficulty mismatch: expected ${expectedDifficulty}, got ${block.header.difficulty}`,
      };
    }
  }

  // Phase 7: Verify coinbase transaction (first transaction must be coinbase)
  if (block.txs.length === 0) {
    return { valid: false, error: "Block must contain at least one transaction (coinbase)" };
  }

  const coinbaseTx = block.txs[0];
  if (coinbaseTx.ownerAddress !== "idc_system") {
    return {
      valid: false,
      error: "First transaction must be coinbase (ownerAddress must be 'idc_system')",
    };
  }

  if (coinbaseTx.ops.length !== 1 || coinbaseTx.ops[0].type !== "TRANSFER") {
    return {
      valid: false,
      error: "Coinbase transaction must contain exactly one TRANSFER operation",
    };
  }

  const coinbaseOp = coinbaseTx.ops[0];
  if (params && coinbaseOp.amount !== params.blockReward) {
    return {
      valid: false,
      error: `Coinbase reward mismatch: expected ${params.blockReward}, got ${coinbaseOp.amount}`,
    };
  }

  // Phase 5: Verify all transaction signatures (skip coinbase signature check)
  for (let i = 0; i < block.txs.length; i++) {
    const tx = block.txs[i];
    // Skip signature verification for coinbase (system transaction)
    if (tx.ownerAddress === "idc_system") {
      continue;
    }
    const isValid = await verifyTxSignature(tx);
    if (!isValid) {
      return {
        valid: false,
        error: `Transaction ${i} (${tx.txId.substring(0, 16)}...) has invalid signature`,
      };
    }
  }

  // Phase 7: Verify transfer balances using dry-run IndexState
  if (prevBlock && allBlocks && params) {
    // Create a dry-run state from all previous blocks (up to prevBlock)
    const dryRunState = IndexState.createEmpty();
    // Get all blocks up to and including prevBlock
    const prevBlockIndex = allBlocks.findIndex((b) => b.hash === prevBlock.hash);
    const previousBlocks = prevBlockIndex >= 0 ? allBlocks.slice(0, prevBlockIndex + 1) : allBlocks;
    dryRunState.rebuildFromBlocks(previousBlocks);

    // Apply all transactions in the block to dry-run state
    try {
      for (const tx of block.txs) {
        dryRunState.applyTx(tx);
      }
    } catch (error) {
      return {
        valid: false,
        error: `Balance verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  return { valid: true };
}

