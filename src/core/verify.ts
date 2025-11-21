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
  IDCToUIDC,
  IDC_MAX_SUPPLY,
} from "./idcEmission.js";
import { isProposerEnforceEnabled } from "./featureFlags.js";
import { deriveRandSeed, selectLeader } from "./slotSchedule.js";

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
    // Special case: if prevBlock is null and block height is > 0, this might be a block from Worker headers
    // when local is at genesis. In this case, we'll allow it if it's from Worker headers.
    // This is handled in sync.ts by checking against Worker headers before calling verifyBlock.
    if (block.header.height === 0) {
      // Genesis block
      if (block.header.prevHash !== "0".repeat(64)) {
        return {
          valid: false,
          error: "Genesis block must have prevHash = 0...0",
        };
      }
    } else {
      // Non-genesis block with null prevBlock - this is allowed when syncing from Worker headers
      // The prevHash check will be skipped, but we still verify other aspects
      // This case is handled in sync.ts
    }
  } else {
    // Non-genesis block with previous block
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

  // Phase 48-C: Optional proposer enforcement (single-leader slots)
  // Only apply when explicitly enabled and when previous block context exists.
  if (isProposerEnforceEnabled() && prevBlock) {
    const h = block.header;
    // Require proposer metadata to be present to enforce
    const epoch = (h as any).epoch ?? h.epochId;
    const slot = (h as any).slot ?? h.slotIndex;
    const proposer = h.proposer;
    if (typeof epoch === "number" && typeof slot === "number" && typeof proposer === "string") {
      try {
        // Prefer header.randomness if provided; otherwise derive from previous hash
        const headerSeed = (h as any).randomness ?? h.randSeed;
        const seed = typeof headerSeed === "string" && headerSeed ? headerSeed : await deriveRandSeed(prevBlock.hash, epoch, slot);
        // Candidates from previous block payout metadata (preferred) or coinbase recipients (fallback)
        const recipients: string[] = [];
        const prevCoinbase = prevBlock.txs?.[0];
        const meta = prevCoinbase?.ops?.find((op) => (op as any).type !== "TRANSFER" && (op as any).namespace === "payout" && typeof (op as any).value === "string");
        let weightsByAddr: Record<string, number> | null = null;
        if (meta && typeof (meta as any).value === "string") {
          try {
            const parsed = JSON.parse((meta as any).value || "{}");
            const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
            // Validate signal fields (if present) are bounded and integers
            for (const e of entries) {
              const o = e?.online;
              const r = e?.reliab;
              if (o !== undefined) {
                if (typeof o !== "number" || o < 0 || o > 100 || !Number.isFinite(o)) {
                  return { valid: false, error: "Invalid payout metadata: online out of range" };
                }
              }
              if (r !== undefined) {
                if (typeof r !== "number" || r < 0 || r > 100 || !Number.isFinite(r)) {
                  return { valid: false, error: "Invalid payout metadata: reliab out of range" };
                }
              }
            }
            for (const e of entries) {
              const addr = e?.address;
              if (typeof addr === "string" && addr.startsWith("idc_") && !recipients.includes(addr)) {
                recipients.push(addr);
              }
            }
            // Collect weights if present
            for (const e of entries) {
              const addr = e?.address;
              const w = e?.weight;
              if (typeof addr === "string" && typeof w === "number" && w > 0) {
                if (!weightsByAddr) weightsByAddr = {};
                weightsByAddr[addr] = w;
              }
            }
          } catch {}
        }
        if (recipients.length === 0 && prevCoinbase && prevCoinbase.ownerAddress === "idc_system") {
          for (const op of prevCoinbase.ops) {
            if (op.type === "TRANSFER" && op.to && typeof op.to === "string" && op.to.startsWith("idc_")) {
              if (!recipients.includes(op.to)) recipients.push(op.to);
            }
          }
        }
        // If no recipients found, skip enforcement (legacy blocks)
        if (recipients.length > 0) {
          // Deterministic leader selection with equal weights for verifiability
          const candidates = recipients.map((a) => ({ address: a, weight: 1 }));
          const expectedLeader = await selectLeader(epoch, slot, seed, candidates);
          if (!expectedLeader || expectedLeader !== proposer) {
            return {
              valid: false,
              error: `Proposer mismatch: expected ${expectedLeader || "none"}, got ${proposer}`,
            };
          }
        }
      } catch (e) {
        // On error, do not fail verification for compatibility
      }
    }
  }

  // Phase 48-D: If header.payoutRoot present, verify against payout metadata in coinbase
  try {
    const pr = block.header.payoutRoot;
    if (typeof pr === "string" && pr.length > 0 && block.txs.length > 0) {
      const coinbaseTx = block.txs[0];
      // Look for metadata op
      const meta = coinbaseTx.ops.find((op) => op.type !== "TRANSFER" && (op as any).namespace === "payout" && typeof (op as any).value === "string");
      if (meta && typeof (meta as any).value === "string") {
        const parsed = JSON.parse((meta as any).value || "{}");
        const rawEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
        const { computePayoutRoot } = await import("./pool/payout.js");
        const entries = rawEntries.map((e: any) => ({ address: String(e.address || ""), amountUIDC: String(e.amountUIDC || "0") }));
        const computedRoot = await computePayoutRoot(entries);
        if (computedRoot !== pr) {
          return {
            valid: false,
            error: `payoutRoot mismatch: expected ${pr.substring(0, 16)}..., got ${computedRoot.substring(0, 16)}...`,
          };
        }
      }
      // Else: if no metadata op, skip for backward compatibility
    }
  } catch {
    // Skip on parse error for compatibility
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

  // Phase 42: Coinbase transaction may contain multiple operations:
  // - Miner reward (with multipliers: IP reputation, session duration, active booster, IP sharing weight)
  // - Referral rewards (if any)
  // - Transaction fees
  // Calculate total reward from all operations
  let totalCoinbaseRewardIDC = 0;
  for (const op of coinbaseTx.ops) {
    if (op.type === "TRANSFER" && op.amount) {
      totalCoinbaseRewardIDC += op.amount;
    }
  }

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
    
    // Calculate expected block reward (raw reward, before multipliers)
    // Phase 41-44: Actual reward may be less due to multipliers (IP sharing weight, etc.)
    const expectedBlockRewardUIDC = getCappedBlockReward(block.header.height, totalMinted);
    const expectedTotalRewardUIDC = expectedBlockRewardUIDC + expectedFeesUIDC;
    const expectedTotalRewardIDC = uIDCToIDC(expectedTotalRewardUIDC);
    
    // Phase 41-44: Allow actual reward to be less than or equal to expected reward
    // (because multipliers like IP sharing weight can reduce the reward)
    // But it should not exceed the expected reward, except for legacy blocks
    // where we allow a bounded compatibility window below a configurable height.
    const actualTotalRewardUIDC = IDCToUIDC(totalCoinbaseRewardIDC);
    if (actualTotalRewardUIDC > expectedTotalRewardUIDC) {
      // Backward-compatibility window:
      // - Strict enforcement activates at VITE_EMISSION_STRICT_HEIGHT (default: very high)
      // - Before that height, allow up to VITE_EMISSION_LEGACY_ALLOWANCE_PCT over expected (default: 100%)
      const strictHeightRaw = (import.meta as any)?.env?.VITE_EMISSION_STRICT_HEIGHT;
      const allowancePctRaw = (import.meta as any)?.env?.VITE_EMISSION_LEGACY_ALLOWANCE_PCT;
      const strictHeight =
        typeof strictHeightRaw === "string" ? Number(strictHeightRaw) : Number(strictHeightRaw ?? 10_000_000);
      const allowancePctNum =
        typeof allowancePctRaw === "string" ? Number(allowancePctRaw) : Number(allowancePctRaw ?? 100);
      const boundedPct = Math.max(0, Math.min(1000, allowancePctNum)); // clamp 0%..1000%
      const allowedOverUIDC = (expectedTotalRewardUIDC * BigInt(boundedPct)) / 100n;
      const allowedMaxUIDC = expectedTotalRewardUIDC + allowedOverUIDC;
      
      if (!(block.header.height < strictHeight && actualTotalRewardUIDC <= allowedMaxUIDC)) {
        // Actual reward exceeds expected beyond allowance
        return {
          valid: false,
          error: `Coinbase reward exceeds expected: expected ${expectedTotalRewardIDC.toFixed(6)} IDC (block: ${uIDCToIDC(expectedBlockRewardUIDC).toFixed(6)}, fees: ${uIDCToIDC(expectedFeesUIDC).toFixed(6)}), got ${totalCoinbaseRewardIDC.toFixed(6)}`,
        };
      }
      // else: within legacy allowance window → accept
    }
    
    // Verify total supply cap (use actual reward, not expected)
    const newTotalMinted = totalMinted + actualTotalRewardUIDC;
    if (newTotalMinted > IDC_MAX_SUPPLY) {
      return {
        valid: false,
        error: `Block reward would exceed max supply: ${uIDCToIDC(newTotalMinted).toFixed(6)} > ${uIDCToIDC(IDC_MAX_SUPPLY).toFixed(6)} IDC`,
      };
    }
  } else {
    // Fallback: if we can't verify emission schedule, at least check it's positive
    if (totalCoinbaseRewardIDC < 0) {
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
    
    // Phase 16: Update total_minted for all previous blocks (matching chain.ts initChain logic)
    // rebuildFromBlocks doesn't update total_minted, so we need to do it manually
    for (const prevBlockItem of previousBlocks) {
      if (prevBlockItem.txs.length > 0) {
        const coinbaseTx = prevBlockItem.txs[0];
        if (coinbaseTx.ownerAddress === "idc_system" && coinbaseTx.ops.length > 0) {
          const rewardOp = coinbaseTx.ops[0];
          if (rewardOp.type === "TRANSFER" && rewardOp.amount) {
            const { IDCToUIDC } = await import("./idcEmission.js");
            const rewardUIDC = IDCToUIDC(rewardOp.amount);
            dryRunState.incrementTotalMinted(rewardUIDC);
          }
        }
      }
    }

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

