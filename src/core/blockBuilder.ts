/**
 * Block Builder
 * 
 * Phase 6: Updated to use dynamic difficulty adjustment
 * Phase 7: Added coinbase transaction for mining rewards
 */

import type { Block, BlockHeader, ChainParams, Tx, Address, Operation } from "./types.js";
import { calcMerkleRoot } from "./merkle.js";
import { getNextDifficulty } from "./difficulty.js";
import { sha256 } from "./crypto.js";

/**
 * Create coinbase transaction (mining reward)
 * Phase 7: System transaction that rewards the miner
 * 
 * @param minerAddress Address of the miner
 * @param blockReward Reward amount in IDC
 * @returns Coinbase transaction
 */
export async function createCoinbaseTx(
  minerAddress: Address,
  blockReward: number
): Promise<Tx> {
  const systemAddress: Address = "idc_system" as Address;
  
  const op: Operation = {
    type: "TRANSFER",
    namespace: "", // Not used for TRANSFER
    key: "", // Not used for TRANSFER
    to: minerAddress,
    amount: blockReward,
    nonce: 0,
    owner: systemAddress,
  };

  // Coinbase transaction structure
  const coinbaseTx: Omit<Tx, "txId"> = {
    owner: systemAddress,
    ownerAddress: systemAddress,
    ownerPubKey: {
      alg: "SYSTEM",
      format: "jwk",
      jwk: {} as JsonWebKey, // System transaction has no real key
    },
    ops: [op],
    timestamp: Math.floor(Date.now() / 1000),
    signature: "coinbase", // System transaction signature
  };

  // Compute txId (excluding signature for coinbase)
  const serialized = JSON.stringify({
    owner: coinbaseTx.owner,
    ownerAddress: coinbaseTx.ownerAddress,
    ops: coinbaseTx.ops,
    timestamp: coinbaseTx.timestamp,
  });
  const txId = await sha256(serialized);

  return {
    ...coinbaseTx,
    txId,
  };
}

/**
 * Build a candidate block for mining
 * 
 * Phase 6: Calculates dynamic difficulty based on recent block times
 * Phase 7: Automatically adds coinbase transaction as first transaction
 * 
 * @param pendingTxs Pending transactions to include
 * @param prevBlock Previous block (tip of the chain)
 * @param allBlocks All blocks in the chain (for difficulty calculation)
 * @param params Chain parameters
 * @param minerAddress Address of the miner (for coinbase reward)
 * @returns Candidate block with nonce = 0 (ready for mining)
 */
export async function buildCandidateBlock(
  pendingTxs: Tx[],
  prevBlock: Block,
  allBlocks: Block[],
  params: ChainParams,
  minerAddress: Address
): Promise<Block> {
  const height = prevBlock.header.height + 1;
  const prevHash = prevBlock.hash;
  const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

  // Phase 7: Create coinbase transaction (mining reward)
  const coinbaseTx = await createCoinbaseTx(minerAddress, params.blockReward);

  // Combine coinbase + pending transactions
  const allTxs = [coinbaseTx, ...pendingTxs];

  // Calculate merkle root from transaction IDs
  const txIds = allTxs.map((tx) => tx.txId);
  const merkleRoot = await calcMerkleRoot(txIds);

  // Phase 6: Calculate dynamic difficulty
  const difficulty = getNextDifficulty(allBlocks, params);

  // Build block header
  const header: BlockHeader = {
    version: params.version,
    height,
    prevHash,
    merkleRoot,
    timestamp,
    difficulty, // Phase 6: Dynamic difficulty
    nonce: 0, // Will be incremented during mining
  };

  // Block hash will be computed during mining
  const block: Block = {
    header,
    txs: allTxs, // Phase 7: Includes coinbase as first transaction
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

