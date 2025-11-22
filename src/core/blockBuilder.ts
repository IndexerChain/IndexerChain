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
  getCappedBlockReward,
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
import { isSlotLeaderModeEnabled, isPooledRewardsEnabled } from "./featureFlags.js";
import { getSlotIdentity, deriveRandSeed, selectLeader } from "./slotSchedule.js";
import { allocateRewardPool, computeEffectiveWeight } from "./rewardPoolAllocator.js";
import { computeOnlineScore } from "./weightSignals.js";

/**
 * Create coinbase transaction (mining reward)
 * Phase 7: System transaction that rewards the miner
 * Phase 16: Uses dynamic emission schedule based on block height and total minted
 * Phase 41: Applies reward multipliers (IP reputation + session duration)
 * Phase 42: Adds ActiveBooster (consecutive days) + Referral rewards (invitation fission)
 * 
 * @param minerAddress Address of the miner
 * @param blockHeight Block height (for emission calculation)
 * @param totalMinted Total IDC already minted (in uIDC, for cap check)
 * @param fees Total transaction fees collected in this block (in uIDC)
 * @param quorumScore Optional: QuorumScore for IP reputation multiplier (default: 100 = 1.0x)
 * @param sessionDurationMs Optional: Session duration in ms for session multiplier (default: uses SessionTracker)
 * @returns Coinbase transaction with all operations (miner reward + referral rewards)
 */
type PooledCandidateInput = { address: Address; balanceUIDC?: bigint; onlineScore?: number; reliabilityScore?: number };

export async function createCoinbaseTx(
  minerAddress: Address,
  blockHeight: number,
  totalMinted: bigint,
  fees: bigint = 0n,
  quorumScore: number = 100, // Default: standard node (1.0x)
  sessionDurationMs?: number, // Optional: if not provided, uses SessionTracker
  pooledRecipients?: Address[], // Phase 50: When provided, perform pooled distribution (equal weights)
  pooledCandidateInputs?: PooledCandidateInput[] // Phase 50-B: Weighted pooled distribution
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
  
  // IP sharing weight removed - all nodes can mine without IP restrictions
  
  // Phase 42: Calculate referral rewards
  // Phase 42.1: Pass blockHeight for year-based decay
  const referralSystem = getReferralSystem();
  const referralRewards = referralSystem.calculateReferralRewards(minerAddress, blockRewardUIDC, blockHeight);
  
  // Calculate total referral rewards
  let totalReferralRewardsUIDC = 0n;
  for (const refReward of referralRewards) {
    totalReferralRewardsUIDC += refReward.referralReward;
  }
  
  // Phase 44/46: Enforce emission schedule cap at block level (before adding fees)
  // Budget for this block from emission schedule (excludes fees)
  const emissionBudgetUIDC = getCappedBlockReward(blockHeight, totalMinted);
  const combinedRewardsUIDC = blockRewardUIDC + totalReferralRewardsUIDC;
  if (combinedRewardsUIDC > emissionBudgetUIDC) {
    // Scale miner reward and each referral reward proportionally to fit the budget
    // Keep ratio between miner and referrals while never exceeding emission schedule
    const scale = emissionBudgetUIDC === 0n ? 0n : (emissionBudgetUIDC * 1_000_000n) / combinedRewardsUIDC; // 6-decimal fixed scale
    const scaleApply = (value: bigint) => (value * scale) / 1_000_000n;
    blockRewardUIDC = scaleApply(blockRewardUIDC);
    let adjustedReferralTotal = 0n;
    for (const refReward of referralRewards) {
      refReward.referralReward = scaleApply(refReward.referralReward);
      adjustedReferralTotal += refReward.referralReward;
    }
    totalReferralRewardsUIDC = adjustedReferralTotal;
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
  
  // Build operations depending on pooled mode
  const ops: Operation[] = [];
  if (Array.isArray(pooledCandidateInputs) && pooledCandidateInputs.length > 0) {
    // Weighted pooled distribution using provided balances
    const uniqueByAddr = new Map<string, PooledCandidateInput>();
    for (const c of pooledCandidateInputs) {
      if (!uniqueByAddr.has(c.address)) uniqueByAddr.set(c.address, c);
    }
    const plan = await allocateRewardPool(
      totalRewardUIDC,
      Array.from(uniqueByAddr.values()).map((c) => ({
        address: c.address,
        balanceUIDC: c.balanceUIDC ?? 0n,
      }))
    );
    for (const r of plan.recipients) {
      const amtIDC = uIDCToIDC(r.amountUIDC);
      if (amtIDC > 0) {
        ops.push({
          type: "TRANSFER",
          namespace: "",
          key: "",
          to: r.address,
          amount: amtIDC,
          nonce: 0,
          owner: systemAddress,
        });
      }
    }
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
  } else if (Array.isArray(pooledRecipients) && pooledRecipients.length > 0) {
    // Phase 50: Pooled rewards - allocate entire totalRewardUIDC across recipients
    const uniqueRecipients = Array.from(new Set(pooledRecipients));
    const plan = await allocateRewardPool(
      totalRewardUIDC,
      uniqueRecipients.map((addr) => ({ address: addr }))
    );
    for (const r of plan.recipients) {
      const amtIDC = uIDCToIDC(r.amountUIDC);
      if (amtIDC > 0) {
        ops.push({
          type: "TRANSFER",
          namespace: "",
          key: "",
          to: r.address,
          amount: amtIDC,
          nonce: 0,
          owner: systemAddress,
        });
      }
    }
    if (ops.length === 0) {
      // Ensure at least one op exists
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
  } else {
    // Pool Mining Architecture: Always generate multi-output coinbase (even for single node)
    // Treat single miner as a pool with one participant
    const singleMinerRewardIDC = uIDCToIDC(blockRewardUIDC);
    if (singleMinerRewardIDC > 0) {
      ops.push({
        type: "TRANSFER",
        namespace: "",
        key: "",
        to: minerAddress,
        amount: singleMinerRewardIDC,
        nonce: 0,
        owner: systemAddress,
      });
    }
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
    // Ensure at least one output exists (pool mining always has outputs)
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
  }

  // Phase 48-D: Embed payout metadata entries into coinbase (deterministic, non-balance affecting)
  try {
    // Build deterministic map for candidate weights if provided
    const weightByAddr = new Map<string, number>();
    if (Array.isArray(pooledCandidateInputs)) {
      for (const c of pooledCandidateInputs) {
        const w = computeEffectiveWeight({
          address: c.address,
          balanceUIDC: c.balanceUIDC ?? 0n,
          onlineScore: c.onlineScore ?? 0,
          reliabilityScore: c.reliabilityScore ?? 0,
        });
        weightByAddr.set(c.address, Math.max(0, w));
      }
    }
    const entries = ops
      .filter((op) => op.type === "TRANSFER" && op.to && typeof op.amount === "number" && op.amount > 0)
      .map((op) => {
        const addr = op.to as Address;
        const amtUIDC = IDCToUIDC(op.amount as number).toString();
        const w = weightByAddr.get(addr) ?? 1;
        return {
          address: addr,
          amountUIDC: amtUIDC,
          weight: Number.isFinite(w) && w > 0 ? w : 1,
        };
      })
      // Deterministic sort by address
      .sort((a, b) => a.address.localeCompare(b.address));
    // Optional: attach online/reliability snapshot (only reliable for local miner; others default 0)
    let minerOnline = 0;
    let minerReliab = 0;
    try {
      minerOnline = computeOnlineScore();
      minerOnline = Math.max(0, Math.min(100, Math.round(minerOnline)));
      minerReliab = Math.max(0, Math.min(100, Math.round(minerReliab)));
    } catch {}
    const entriesWithSignals = entries.map((e) => ({
      ...e,
      online: e.address === minerAddress ? minerOnline : 0,
      reliab: e.address === minerAddress ? minerReliab : 0,
    }));

    const metaOp: Operation = {
      type: "PUT",
      namespace: "payout",
      key: `h:${blockHeight}`,
      value: JSON.stringify({ v: 2, entries: entriesWithSignals }),
      nonce: 0,
      owner: systemAddress,
    };
    ops.push(metaOp);
  } catch {
    // Ignore metadata on error to keep backward compatibility
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
 * Creates candidate block for mining
 * 
 * @param pendingTxs Pending transactions to include
 * @param prevBlock Previous block (tip of the chain)
 * @param allBlocks All blocks in the chain (for difficulty calculation)
 * @param params Chain parameters
 * @param minerAddress Address of the miner (for coinbase reward)
 * @param currentIndexState Current IndexState (before applying block transactions)
 * @param p2pNode Optional: P2P node
 * @param chainContext Optional: Chain context
 * @returns Candidate block with nonce = 0 (ready for mining)
 */
export async function buildCandidateBlock(
  pendingTxs: Tx[],
  prevBlock: Block,
  allBlocks: Block[],
  params: ChainParams,
  minerAddress: Address,
  currentIndexState: IndexState,
  _p2pNode?: any, // Optional P2P node (not used after IP restrictions removal)
  _chainContext?: any // Optional chain context (not used after IP restrictions removal)
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
  // Phase 50: Determine pooled recipients (from previous block coinbase recipients)
  let pooledRecipients: Address[] | undefined = undefined;
  try {
    if (isPooledRewardsEnabled()) {
      const prevCoinbase = prevBlock?.txs?.[0];
      const recipients: Address[] = [];
      if (prevCoinbase && prevCoinbase.ownerAddress === "idc_system") {
        for (const op of prevCoinbase.ops) {
          if (op.type === "TRANSFER" && op.to && typeof op.to === "string" && op.to.startsWith("idc_")) {
            if (!recipients.includes(op.to as Address)) {
              recipients.push(op.to as Address);
            }
          }
        }
      }
      if (!recipients.includes(minerAddress)) recipients.push(minerAddress);
      pooledRecipients = recipients;
    }
  } catch {}

  // Phase 50-B: Build weighted pooled candidate inputs from previous payout metadata or coinbase recipients
  let pooledCandidateInputs: PooledCandidateInput[] | undefined = undefined;
  try {
    if (isPooledRewardsEnabled()) {
      const prevCoinbase = prevBlock?.txs?.[0];
      const metaOp = prevCoinbase?.ops?.find((op) => (op as any).type !== "TRANSFER" && (op as any).namespace === "payout" && typeof (op as any).value === "string");
      let addrs: Address[] = [];
      const signalByAddr = new Map<string, { online?: number; reliab?: number }>();
      if (metaOp && typeof (metaOp as any).value === "string") {
        try {
          const parsed = JSON.parse((metaOp as any).value || "{}");
          const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
          addrs = entries.map((e: any) => e.address).filter((a: any) => typeof a === "string" && a.startsWith("idc_"));
          for (const e of entries) {
            const a = e?.address;
            if (typeof a === "string" && a.startsWith("idc_")) {
              const o = typeof e?.online === "number" ? Math.max(0, Math.min(100, Math.round(e.online))) : undefined;
              const r = typeof e?.reliab === "number" ? Math.max(0, Math.min(100, Math.round(e.reliab))) : undefined;
              signalByAddr.set(a, { online: o, reliab: r });
            }
          }
        } catch {}
      }
      if (addrs.length === 0 && prevCoinbase && prevCoinbase.ownerAddress === "idc_system") {
        for (const op of prevCoinbase.ops) {
          if (op.type === "TRANSFER" && op.to && typeof op.to === "string" && op.to.startsWith("idc_")) {
            if (!addrs.includes(op.to as Address)) addrs.push(op.to as Address);
          }
        }
      }
      if (!addrs.includes(minerAddress)) addrs.push(minerAddress);
      // Compute balances deterministically from currentIndexState
      const inputs: PooledCandidateInput[] = addrs.map((a) => {
        try {
          const balIDC = currentIndexState.getBalance(a) || 0;
          const balUIDC = IDCToUIDC(balIDC);
          const sig = signalByAddr.get(a);
          return { address: a, balanceUIDC: balUIDC, onlineScore: sig?.online, reliabilityScore: sig?.reliab };
        } catch {
          const sig = signalByAddr.get(a);
          return { address: a, balanceUIDC: 0n, onlineScore: sig?.online, reliabilityScore: sig?.reliab };
        }
      });
      pooledCandidateInputs = inputs;
    }
  } catch {}

  // IP reputation multiplier removed - all nodes get 1.0x
  // No need to calculate quorumScore

  // Phase 16 + 41: Create coinbase transaction with dynamic reward + multipliers + fees
  // IP sharing weight removed - all nodes can mine without IP restrictions
  const coinbaseTx = await createCoinbaseTx(
    minerAddress, 
    height, 
    totalMinted, 
    totalFeesUIDC,
    100, // Default quorumScore (no IP reputation multiplier)
    undefined, // sessionDurationMs - will use SessionTracker
    pooledRecipients, // Phase 50: Equal recipients fallback
    pooledCandidateInputs // Phase 50-B: Weighted candidates (preferred)
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

  // Phase 48-C: Optional slot metadata + proposer (scaffolding; non-enforcing by default)
  try {
    if (isSlotLeaderModeEnabled()) {
      const nowMs = Date.now();
      const { epochId, slotIndex } = getSlotIdentity(nowMs);
      const randSeed = await deriveRandSeed(prevHash, epochId, slotIndex);
      // Derive candidate set from previous block coinbase recipients (deterministic)
      const prevCoinbase = prevBlock?.txs?.[0];
      const recipients: Address[] = [];
      if (prevCoinbase && prevCoinbase.ownerAddress === "idc_system") {
        for (const op of prevCoinbase.ops) {
          if (op.type === "TRANSFER" && op.to && typeof op.to === "string" && op.to.startsWith("idc_")) {
            if (!recipients.includes(op.to as Address)) {
              recipients.push(op.to as Address);
            }
          }
        }
      }
      // Fallback: include current miner address to ensure header is filled
      if (!recipients.includes(minerAddress)) {
        recipients.push(minerAddress);
      }
      const candidates = recipients.map((a) => ({ address: a, weight: 1 }));
      const proposer = await selectLeader(epochId, slotIndex, randSeed, candidates) || minerAddress;
      header.epochId = epochId;
      header.slotIndex = slotIndex;
      header.randSeed = randSeed;
      // Aliases for external compatibility
      (header as any).epoch = epochId;
      (header as any).slot = slotIndex;
      (header as any).randomness = randSeed;
      header.proposer = proposer;
      // payoutRoot will be set by allocator wiring in Phase B/C when used for enforcement
    }
  } catch {
    // Ignore slot metadata on failure; backward compatible
  }

  // Phase 48-D: Compute payoutRoot from coinbase TRANSFER recipients (sorted by address) and set into header
  try {
    const cb = coinbaseTx;
    const { computePayoutRoot } = await import("./pool/payout.js");
    const entries = cb.ops
      .filter((op) => op.type === "TRANSFER" && op.to && typeof op.amount === "number" && op.amount > 0)
      .map((op) => ({ address: op.to as Address, amountUIDC: IDCToUIDC(op.amount as number).toString() }));
    const payoutRoot = await computePayoutRoot(entries);
    (header as any).payoutRoot = payoutRoot;
  } catch {
    // Leave payoutRoot undefined on failure
  }

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

