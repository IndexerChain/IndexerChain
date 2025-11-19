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
  getBlockRewardRaw,
  uIDCToIDC,
  estimateTxFee,
  IDCToUIDC,
  IDC_MAX_SUPPLY,
  IDC_BLOCKS_PER_YEAR,
} from "./idcEmission.js";
import {
  calculateMiningReward,
  getSessionTracker,
} from "./miningRewardMultiplier.js";
import {
  getActiveBoosterTracker,
} from "./activeBooster.js";
import {
  getReferralSystem,
} from "./referralSystem.js";
import {
  getIPSharingTracker,
  getOrCreateDeviceId,
} from "./ipSharingWeight.js";

/**
 * Create coinbase transaction (mining reward)
 * Phase 7: System transaction that rewards the miner
 * Phase 16: Uses dynamic emission schedule based on block height and total minted
 * Phase 41: Applies reward multipliers (IP reputation + session duration)
 * Phase 42: Adds ActiveBooster (consecutive days) + Referral rewards (invitation fission)
 * Phase 44: Applies IP sharing weight (same IP multiple miners reward reduction)
 * 
 * @param minerAddress Address of the miner
 * @param blockHeight Block height (for emission calculation)
 * @param totalMinted Total IDC already minted (in uIDC, for cap check)
 * @param fees Total transaction fees collected in this block (in uIDC)
 * @param quorumScore Optional: QuorumScore for IP reputation multiplier (default: 100 = 1.0x)
 * @param sessionDurationMs Optional: Session duration in ms for session multiplier (default: uses SessionTracker)
 * @param ipSharingWeight Optional: IP sharing weight (0.1-1.0) for same IP multiple miners (default: 1.0)
 * @returns Coinbase transaction with all operations (miner reward + referral rewards)
 */
export async function createCoinbaseTx(
  minerAddress: Address,
  blockHeight: number,
  totalMinted: bigint,
  fees: bigint = 0n,
  quorumScore: number = 100, // Default: standard node (1.0x)
  sessionDurationMs?: number, // Optional: if not provided, uses SessionTracker
  ipSharingWeight: number = 1.0 // Phase 44: IP sharing weight (default: 1.0 = full reward)
): Promise<Tx> {
  const systemAddress: Address = "idc_system" as Address;
  
  // Phase 16: Get raw block reward (before multipliers)
  const rawBlockRewardUIDC = getBlockRewardRaw(blockHeight);
  
  // Phase 41: Apply reward multipliers (IP reputation + session duration)
  // Get session duration from tracker if not provided
  const sessionDuration = sessionDurationMs ?? getSessionTracker().getTotalDuration();
  
  // Calculate reward with multipliers
  const rewardBreakdown = calculateMiningReward(
    rawBlockRewardUIDC,
    quorumScore,
    sessionDuration
  );
  
  // Phase 42: Apply ActiveBooster multiplier (consecutive active days)
  // Phase 42.1: ActiveBooster multiplier varies by year (Year 1: max 1.5x, Year 2-3: max 2.0x, Year 3+: max 2.5x)
  const activeBooster = getActiveBoosterTracker();
  activeBooster.markActive(); // Mark user as active today
  const rawActiveBoosterMultiplier = activeBooster.getMultiplier();
  
  // Adjust ActiveBooster cap based on year
  const year = Math.floor(blockHeight / Number(IDC_BLOCKS_PER_YEAR));
  let activeBoosterCap = 2.0; // Default max
  if (year === 0) {
    activeBoosterCap = 1.5; // Year 1: max 1.5x
  } else if (year < 3) {
    activeBoosterCap = 2.0; // Year 2-3: max 2.0x
  } else {
    activeBoosterCap = 2.5; // Year 3+: max 2.5x
  }
  
  const activeBoosterMultiplier = Math.min(rawActiveBoosterMultiplier, activeBoosterCap);
  
  // Phase 42.1: Apply ActiveBooster to base reward
  let blockRewardUIDC = (rewardBreakdown.finalReward * BigInt(Math.floor(activeBoosterMultiplier * 1000))) / 1000n;
  
  // Phase 42.1: Apply global hard cap (total multiplier max 3.0x)
  // Calculate total multiplier: IP × Session × ActiveBooster
  const totalMultiplier = rewardBreakdown.ipReputationMultiplier * 
                          rewardBreakdown.sessionDurationMultiplier * 
                          activeBoosterMultiplier;
  const HARD_CAP_MULTIPLIER = 3.0;
  
  if (totalMultiplier > HARD_CAP_MULTIPLIER) {
    // Scale down to hard cap
    const scaleFactor = HARD_CAP_MULTIPLIER / totalMultiplier;
    blockRewardUIDC = (blockRewardUIDC * BigInt(Math.floor(scaleFactor * 1000))) / 1000n;
  }
  
  // Phase 44: Apply IP sharing weight (same IP multiple miners reward reduction)
  // This is applied AFTER hard cap to ensure fairness
  blockRewardUIDC = (blockRewardUIDC * BigInt(Math.floor(ipSharingWeight * 1000))) / 1000n;
  
  // Phase 42: Calculate referral rewards
  // Phase 42.1: Pass blockHeight for year-based decay
  const referralSystem = getReferralSystem();
  const referralRewards = referralSystem.calculateReferralRewards(minerAddress, blockRewardUIDC, blockHeight);
  
  // Calculate total referral rewards
  let totalReferralRewardsUIDC = 0n;
  for (const refReward of referralRewards) {
    totalReferralRewardsUIDC += refReward.referralReward;
  }
  
  // Calculate remaining supply to ensure we don't exceed max supply
  const remaining = IDC_MAX_SUPPLY - totalMinted;
  
  // Cap block reward to remaining supply (multipliers can't exceed max supply)
  if (blockRewardUIDC > remaining) {
    blockRewardUIDC = remaining;
  }
  
  // Cap referral rewards to remaining supply
  const remainingAfterMiner = remaining - blockRewardUIDC;
  if (totalReferralRewardsUIDC > remainingAfterMiner) {
    // Proportionally reduce referral rewards if needed
    const scaleFactor = remainingAfterMiner > 0n 
      ? (remainingAfterMiner * 1000n) / totalReferralRewardsUIDC 
      : 0n;
    totalReferralRewardsUIDC = (totalReferralRewardsUIDC * scaleFactor) / 1000n;
    
    // Also scale individual referral rewards
    for (const refReward of referralRewards) {
      refReward.referralReward = (refReward.referralReward * scaleFactor) / 1000n;
    }
  }
  
  // Total reward = block reward (with all multipliers) + referral rewards + fees, but capped to remaining supply
  const totalRewardUIDC = blockRewardUIDC + totalReferralRewardsUIDC + fees > remaining 
    ? remaining 
    : blockRewardUIDC + totalReferralRewardsUIDC + fees;
  
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
  
  // Phase 42: Create operations for miner reward + referral rewards
  const ops: Operation[] = [];
  
  // Operation 1: Miner's base reward (with all multipliers)
  const minerRewardIDC = uIDCToIDC(blockRewardUIDC);
  if (minerRewardIDC > 0) {
    ops.push({
      type: "TRANSFER",
      namespace: "",
      key: "",
      to: minerAddress,
      amount: minerRewardIDC,
      nonce: 0,
      owner: systemAddress,
    });
  }
  
  // Operations 2+: Referral rewards
  for (const refReward of referralRewards) {
    if (refReward.referralReward > 0n) {
      const refRewardIDC = uIDCToIDC(refReward.referralReward);
      if (refRewardIDC > 0) {
        ops.push({
          type: "TRANSFER",
          namespace: "",
          key: "",
          to: refReward.inviterAddress,
          amount: refRewardIDC,
          nonce: 0,
          owner: systemAddress,
        });
      }
    }
  }
  
  // Operation N+1: Transaction fees (if any)
  const feesIDC = uIDCToIDC(fees);
  if (feesIDC > 0) {
    ops.push({
      type: "TRANSFER",
      namespace: "",
      key: "",
      to: minerAddress, // Fees go to miner
      amount: feesIDC,
      nonce: 0,
      owner: systemAddress,
    });
  }
  
  // If no operations, create empty operation
  if (ops.length === 0) {
    ops.push({
      type: "TRANSFER",
      namespace: "",
      key: "",
      to: minerAddress,
      amount: 0,
      nonce: 0,
      owner: systemAddress,
    });
  }

  // Coinbase transaction structure
  const coinbaseTx: Omit<Tx, "txId"> = {
    owner: systemAddress,
    ownerAddress: systemAddress,
    ownerPubKey: {
      alg: "SYSTEM",
      format: "jwk",
      jwk: {} as JsonWebKey, // System transaction has no real key
    },
    ops, // Phase 42: Multiple operations (miner + referrals)
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
 * Phase 44: Applies IP sharing weight for same IP multiple miners
 * 
 * @param pendingTxs Pending transactions to include
 * @param prevBlock Previous block (tip of the chain)
 * @param allBlocks All blocks in the chain (for difficulty calculation)
 * @param params Chain parameters
 * @param minerAddress Address of the miner (for coinbase reward)
 * @param currentIndexState Current IndexState (before applying block transactions)
 * @param p2pNode Optional: P2P node for IP sharing weight calculation
 * @param chainContext Optional: Chain context for IP sharing weight calculation
 * @returns Candidate block with nonce = 0 (ready for mining)
 */
export async function buildCandidateBlock(
  pendingTxs: Tx[],
  prevBlock: Block,
  allBlocks: Block[],
  params: ChainParams,
  minerAddress: Address,
  currentIndexState: IndexState,
  p2pNode?: any, // Phase 44: Optional P2P node
  chainContext?: any // Phase 44: Optional chain context
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

  // Phase 41: Get QuorumScore for reward multiplier
  // Try to get from QuorumManager if available
  let quorumScore = 100; // Default: standard node (1.0x multiplier)
  try {
    const { getQuorumManager } = await import("./quorumManager.js");
    const quorumManager = getQuorumManager();
    if (p2pNode && chainContext) {
      quorumManager.initialize(p2pNode, chainContext);
    }
    const quorumStatus = quorumManager.getQuorumStatus();
    // Use local node's quorum score (if available) or average peer score
    quorumScore = quorumStatus.totalScore > 0 
      ? Math.max(quorumStatus.totalScore, 80) // Minimum 80 for standard multiplier
      : 100; // Default if no quorum data
  } catch (e) {
    // QuorumManager not available, use default
    console.debug("[Phase 41] QuorumManager not available, using default quorumScore:", quorumScore);
  }

  // Phase 44: Get IP sharing weight
  let ipSharingWeight = 1.0; // Default: full reward
  try {
    const deviceId = getOrCreateDeviceId();
    const ipSharingTracker = getIPSharingTracker();
    
    if (p2pNode && chainContext) {
      // Get IP hash from QuorumManager (if available)
      const { getQuorumManager } = await import("./quorumManager.js");
      const quorumManager = getQuorumManager();
      quorumManager.initialize(p2pNode, chainContext);
      const quorumStatus = quorumManager.getQuorumStatus();
      
      // Get IP hash from quorum status (if available)
      // For now, use deviceId as fallback for IP identification
      // Try to find local peer's IP hash, or use deviceId
      const localPeer = quorumStatus.peerMetrics.find(p => p.peerId === p2pNode?.nodeId);
      const ipHash = localPeer?.ipHash || deviceId;
      
      // Register this miner and get sharing weight
      ipSharingTracker.registerMiner(ipHash, deviceId);
      ipSharingWeight = ipSharingTracker.getSharingWeight(ipHash, deviceId);
    }
  } catch (e) {
    console.debug("[Phase 44] Failed to calculate IP sharing weight, using default:", e);
    // Continue with default weight (1.0)
  }

  // Phase 16 + 41 + 44: Create coinbase transaction with dynamic reward + multipliers + IP sharing weight + fees
  const coinbaseTx = await createCoinbaseTx(
    minerAddress, 
    height, 
    totalMinted, 
    totalFeesUIDC,
    quorumScore, // Pass quorumScore for IP reputation multiplier
    undefined, // sessionDurationMs - will use SessionTracker
    ipSharingWeight // Phase 44: Pass IP sharing weight
  );

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
    
    // Production: No console logs
  } catch (error) {
    // Production: Only log errors in development
    if (process.env.NODE_ENV === 'development') {
      console.error(`[Phase 15] Failed to compute stateCommitment:`, error);
    }
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

