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
import { computeSnapshotStateHash } from "./snapshotVerify.js";
import {
  getCappedBlockReward,
  estimateTxFee,
  uIDCToIDC,
  IDC_MAX_SUPPLY,
} from "./idcEmission.js";

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
  // Phase 16: Verify coinbase reward matches emission schedule
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
  const coinbaseRewardIDC = coinbaseOp.amount || 0;

  // Phase 16: Verify coinbase reward matches emission schedule
  if (prevBlock && allBlocks && params) {
    // Calculate expected reward
    const dryRunState = IndexState.createEmpty();
    const prevBlockIndex = allBlocks.findIndex((b) => b.hash === prevBlock.hash);
    const previousBlocks = prevBlockIndex >= 0 ? allBlocks.slice(0, prevBlockIndex + 1) : allBlocks;
    dryRunState.rebuildFromBlocks(previousBlocks);
    
    const totalMinted = dryRunState.getTotalMinted();
    
    // Calculate expected fees from non-coinbase transactions
    let expectedFeesUIDC = 0n;
    for (let i = 1; i < block.txs.length; i++) {
      const tx = block.txs[i];
      if (tx.ownerAddress !== "idc_system") {
        const fee = estimateTxFee(tx);
        expectedFeesUIDC += fee;
      }
    }
    
    // Calculate expected block reward
    const expectedBlockRewardUIDC = getCappedBlockReward(block.header.height, totalMinted);
    const expectedTotalRewardUIDC = expectedBlockRewardUIDC + expectedFeesUIDC;
    const expectedTotalRewardIDC = uIDCToIDC(expectedTotalRewardUIDC);
    
    // Allow small floating point rounding differences (0.000001 IDC tolerance)
    const tolerance = 0.000001;
    const diff = Math.abs(coinbaseRewardIDC - expectedTotalRewardIDC);
    
    if (diff > tolerance) {
      return {
        valid: false,
        error: `Coinbase reward mismatch: expected ${expectedTotalRewardIDC.toFixed(6)} IDC (block: ${uIDCToIDC(expectedBlockRewardUIDC).toFixed(6)}, fees: ${uIDCToIDC(expectedFeesUIDC).toFixed(6)}), got ${coinbaseRewardIDC.toFixed(6)}`,
      };
    }
    
    // Verify total supply cap
    const newTotalMinted = totalMinted + expectedTotalRewardUIDC;
    if (newTotalMinted > IDC_MAX_SUPPLY) {
      return {
        valid: false,
        error: `Block reward would exceed max supply: ${uIDCToIDC(newTotalMinted).toFixed(6)} > ${uIDCToIDC(IDC_MAX_SUPPLY).toFixed(6)} IDC`,
      };
    }
  } else {
    // Fallback: if we can't verify emission schedule, at least check it's positive
    if (coinbaseRewardIDC < 0) {
      return {
        valid: false,
        error: "Coinbase reward must be non-negative",
      };
    }
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
  // Phase 15: Also verify stateCommitment
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
      
      // Phase 16: Update total_minted after applying coinbase (matching blockBuilder.ts logic)
      if (block.txs.length > 0) {
        const coinbaseTx = block.txs[0];
        if (coinbaseTx.ownerAddress === "idc_system" && coinbaseTx.ops.length > 0) {
          const rewardOp = coinbaseTx.ops[0];
          if (rewardOp.type === "TRANSFER" && rewardOp.amount) {
            const { IDCToUIDC } = await import("./idcEmission.js");
            const rewardUIDC = IDCToUIDC(rewardOp.amount);
            dryRunState.incrementTotalMinted(rewardUIDC);
          }
        }
      }
    } catch (error) {
      return {
        valid: false,
        error: `Balance verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }

    // Phase 15: Verify stateCommitment if present
    if (block.header.stateCommitment) {
      try {
        const finalSnapshot = dryRunState.toSnapshot();
        const computedCommitment = await computeSnapshotStateHash(finalSnapshot);
        
        if (computedCommitment !== block.header.stateCommitment) {
          return {
            valid: false,
            error: `State commitment mismatch: expected ${block.header.stateCommitment.substring(0, 16)}..., got ${computedCommitment.substring(0, 16)}...`,
          };
        }
      } catch (error) {
        return {
          valid: false,
          error: `State commitment verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    }
  }

  return { valid: true };
}

