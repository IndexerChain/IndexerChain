/**
 * Block Builder
 * 
 * Functions for building candidate blocks for mining
 */

import type { Block, BlockHeader, ChainParams, Tx } from "./types.js";
import { calcMerkleRoot } from "./merkle.js";

/**
 * Build a candidate block for mining
 * 
 * @param pendingTxs Pending transactions to include
 * @param prevBlock Previous block (tip of the chain)
 * @param params Chain parameters
 * @returns Candidate block with nonce = 0 (ready for mining)
 */
export async function buildCandidateBlock(
  pendingTxs: Tx[],
  prevBlock: Block,
  params: ChainParams
): Promise<Block> {
  const height = prevBlock.header.height + 1;
  const prevHash = prevBlock.hash;
  const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

  // Calculate merkle root from transaction IDs
  const txIds = pendingTxs.map((tx) => tx.txId);
  const merkleRoot = await calcMerkleRoot(txIds);

  // Build block header
  const header: BlockHeader = {
    version: params.version,
    height,
    prevHash,
    merkleRoot,
    timestamp,
    difficulty: params.initialDifficulty, // For Phase 3, use initial difficulty
    nonce: 0, // Will be incremented during mining
  };

  // Block hash will be computed during mining
  const block: Block = {
    header,
    txs: pendingTxs,
    hash: "", // Will be set after mining
  };

  return block;
}

/**
 * Build genesis block candidate (helper for consistency)
 * Note: This is already implemented in genesis.ts, but included here for reference
 */
export async function buildGenesisBlockCandidate(
  params: ChainParams
): Promise<Block> {
  const txs: Tx[] = [];
  const txIds: string[] = [];
  const merkleRoot = await calcMerkleRoot(txIds);

  const header: BlockHeader = {
    version: params.version,
    height: 0,
    prevHash: "0".repeat(64),
    merkleRoot,
    timestamp: params.genesisTimestamp,
    difficulty: params.initialDifficulty,
    nonce: 0,
  };

  // For genesis, we still need to compute hash
  const block: Block = {
    header,
    txs,
    hash: "", // Will be computed
  };

  return block;
}

