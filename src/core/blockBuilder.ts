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
import { IndexState } from "./indexState.js";
import { computeSnapshotStateHash } from "./snapshotVerify.js";
import {
  getCappedBlockReward,
  uIDCToIDC,
  estimateTxFee,
  IDCToUIDC,
  IDC_MAX_SUPPLY,
} from "./idcEmission.js";

/**
 * Create coinbase transaction (mining reward)
 * Phase 7: System transaction that rewards the miner
 * Phase 16: Uses dynamic emission schedule based on block height and total minted
 * 
 * @param minerAddress Address of the miner
 * @param blockHeight Block height (for emission calculation)
 * @param totalMinted Total IDC already minted (in uIDC, for cap check)
 * @param fees Total transaction fees collected in this block (in uIDC)
 * @returns Coinbase transaction
 */
export async function createCoinbaseTx(
  minerAddress: Address,
  blockHeight: number,
  totalMinted: bigint,
  fees: bigint = 0n
): Promise<Tx> {
  const systemAddress: Address = "idc_system" as Address;
  
  // Phase 16: Calculate block reward using emission schedule
  const blockRewardUIDC = getCappedBlockReward(blockHeight, totalMinted);
  
  // Calculate remaining supply to ensure we don't exceed max supply
  const remaining = IDC_MAX_SUPPLY - totalMinted;
  
  // Total reward = block reward + fees, but capped to remaining supply
  // This ensures that even with high fees, we never exceed IDC_MAX_SUPPLY
  const totalRewardUIDC = blockRewardUIDC + fees > remaining 
    ? remaining 
    : blockRewardUIDC + fees;
  
  const totalRewardIDC = uIDCToIDC(totalRewardUIDC);
  
  // Only create coinbase if there's a reward
  if (totalRewardIDC <= 0) {
    // No reward - return empty coinbase (shouldn't happen in normal operation)
    const op: Operation = {
      type: "TRANSFER",
      namespace: "",
      key: "",
      to: minerAddress,
      amount: 0,
      nonce: 0,
      owner: systemAddress,
    };
    
    const coinbaseTx: Omit<Tx, "txId"> = {
      owner: systemAddress,
      ownerAddress: systemAddress,
      ownerPubKey: {
        alg: "SYSTEM",
        format: "jwk",
        jwk: {} as JsonWebKey,
      },
      ops: [op],
      timestamp: Math.floor(Date.now() / 1000),
      signature: "coinbase",
    };
    
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
  
  const op: Operation = {
    type: "TRANSFER",
    namespace: "", // Not used for TRANSFER
    key: "", // Not used for TRANSFER
    to: minerAddress,
    amount: totalRewardIDC, // Total reward (block reward + fees) in IDC
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
 * Phase 15: Computes stateCommitment from IndexState after applying all transactions
 * 
 * @param pendingTxs Pending transactions to include
 * @param prevBlock Previous block (tip of the chain)
 * @param allBlocks All blocks in the chain (for difficulty calculation)
 * @param params Chain parameters
 * @param minerAddress Address of the miner (for coinbase reward)
 * @param currentIndexState Current IndexState (before applying block transactions)
 * @returns Candidate block with nonce = 0 (ready for mining)
 */
export async function buildCandidateBlock(
  pendingTxs: Tx[],
  prevBlock: Block,
  allBlocks: Block[],
  params: ChainParams,
  minerAddress: Address,
  currentIndexState: IndexState
): Promise<Block> {
  const height = prevBlock.header.height + 1;
  const prevHash = prevBlock.hash;
  const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

  // Phase 16: Get total minted and calculate fees
  const totalMinted = currentIndexState.getTotalMinted();
  
  // Calculate total fees from pending transactions
  let totalFeesUIDC = 0n;
  for (const tx of pendingTxs) {
    // Skip coinbase (it's not in pendingTxs yet)
    if (tx.ownerAddress !== "idc_system") {
      const fee = estimateTxFee(tx);
      totalFeesUIDC += fee;
    }
  }

  // Phase 16: Create coinbase transaction with dynamic reward + fees
  const coinbaseTx = await createCoinbaseTx(minerAddress, height, totalMinted, totalFeesUIDC);

  // Combine coinbase + pending transactions
  const allTxs = [coinbaseTx, ...pendingTxs];

  // Calculate merkle root from transaction IDs
  const txIds = allTxs.map((tx) => tx.txId);
  const merkleRoot = await calcMerkleRoot(txIds);

  // Phase 6: Calculate dynamic difficulty
  const difficulty = getNextDifficulty(allBlocks, params);

  // Phase 15: Compute stateCommitment by dry-running all transactions
  let stateCommitment: string | undefined;
  try {
    // IMPORTANT: Rebuild state from blocks to ensure consistency with verification
    // This matches the logic in verify.ts which uses rebuildFromBlocks
    const tempState = IndexState.createEmpty();
    // Get all blocks up to and including prevBlock
    const prevBlockIndex = allBlocks.findIndex((b) => b.hash === prevBlock.hash);
    const previousBlocks = prevBlockIndex >= 0 ? allBlocks.slice(0, prevBlockIndex + 1) : allBlocks;
    tempState.rebuildFromBlocks(previousBlocks);
    
    // Phase 16: Update total_minted for all previous blocks (matching verify.ts logic)
    // rebuildFromBlocks doesn't update total_minted, so we need to do it manually
    for (const prevBlockItem of previousBlocks) {
      if (prevBlockItem.txs.length > 0) {
        const coinbaseTx = prevBlockItem.txs[0];
        if (coinbaseTx.ownerAddress === "idc_system" && coinbaseTx.ops.length > 0) {
          const rewardOp = coinbaseTx.ops[0];
          if (rewardOp.type === "TRANSFER" && rewardOp.amount) {
            const rewardUIDC = IDCToUIDC(rewardOp.amount);
            tempState.incrementTotalMinted(rewardUIDC);
          }
        }
      }
    }

    // Apply all transactions to temporary state
    for (const tx of allTxs) {
      tempState.applyTx(tx);
    }

    // Phase 16: Update total minted after applying coinbase
    // The coinbase reward increases total_minted
    if (coinbaseTx.ops.length > 0 && coinbaseTx.ops[0].type === "TRANSFER") {
      const rewardAmount = coinbaseTx.ops[0].amount || 0;
      if (rewardAmount > 0) {
        const rewardUIDC = IDCToUIDC(rewardAmount);
        tempState.incrementTotalMinted(rewardUIDC);
      }
    }

    // Compute stateCommitment from the resulting state
    const finalSnapshot = tempState.toSnapshot();
    stateCommitment = await computeSnapshotStateHash(finalSnapshot);
    
    // Debug: Log state commitment computation details
    console.log(`[Phase 15] State commitment computed:`, {
      height,
      totalMintedBefore: tempState.getTotalMinted().toString(),
      txCount: allTxs.length,
      stateCommitment: stateCommitment.substring(0, 16) + "...",
    });
  } catch (error) {
    console.error(`[Phase 15] Failed to compute stateCommitment:`, error);
    // Continue without stateCommitment for backward compatibility
  }

  // Build block header
  const header: BlockHeader = {
    version: params.version,
    height,
    prevHash,
    merkleRoot,
    timestamp,
    difficulty, // Phase 6: Dynamic difficulty
    nonce: 0, // Will be incremented during mining
    stateCommitment, // Phase 15: State commitment hash
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

