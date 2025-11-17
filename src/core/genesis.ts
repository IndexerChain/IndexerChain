/**
 * Genesis Block Generation
 * 
 * Creates the first block of the chain
 */

import type { Block, BlockHeader, ChainParams, Tx } from "./types.js";
import { hashBlockHeader } from "./crypto.js";
import { calcMerkleRoot } from "./merkle.js";

/**
 * Create the genesis block
 * 
 * Genesis block properties:
 * - height: 0
 * - prevHash: "0" repeated 64 times (no previous block)
 * - txs: empty array
 * - merkleRoot: hash of empty array
 */
export async function createGenesisBlock(
  params: ChainParams
): Promise<Block> {
  const txs: Tx[] = [];

  // Calculate merkle root for empty transactions
  const txIds: string[] = [];
  const merkleRoot = await calcMerkleRoot(txIds);

  const header: BlockHeader = {
    version: params.version,
    height: 0,
    prevHash: "0".repeat(64), // Genesis block has no previous block
    merkleRoot,
    timestamp: params.genesisTimestamp,
    difficulty: params.initialDifficulty,
    nonce: 0,
  };

  // Calculate block hash
  const hash = await hashBlockHeader(header);

  const block: Block = {
    header,
    txs,
    hash,
  };

  return block;
}

