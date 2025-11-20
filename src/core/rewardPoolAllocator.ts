/**
 * Reward Pool Allocator (Phase 48-B)
 *
 * Splits a block's emission budget among eligible participants by weight.
 * Not wired into consensus/mining by default. Safe to import for experiments.
 */

import type { Address } from "./types.js";
import { calcMerkleRoot } from "./merkle.js";
import { IDC_DECIMALS } from "./idcEmission.js";

export interface RewardCandidateInput {
  address: Address;
  balanceUIDC?: bigint;          // micro IDC
  onlineScore?: number;          // 0..1 or 0..100 normalized
  reliabilityScore?: number;     // 0..1 or 0..100 normalized
  eligible?: boolean;            // default true
}

export interface EffectiveWeightConfig {
  wBase: number;
  wStake: number;
  wOnline: number;
  wReliab: number;
  sqrtStake: boolean;            // use sqrt(balance) weighting
  normalizeFactorOnline: number; // divide onlineScore by this
  normalizeFactorReliab: number; // divide reliabilityScore by this
  minWeight: number;             // clamp minimum positive weight
}

export interface AllocationResult {
  address: Address;
  amountUIDC: bigint;
  weight: number;
}

export interface AllocationPlan {
  totalBudgetUIDC: bigint;
  distributedUIDC: bigint;
  remainderUIDC: bigint;
  recipients: AllocationResult[];
  payoutRoot: string; // merkle root of "address:amountUIDC" list (sorted)
}

function readNumber(winKey: string, lsKey: string, envKey: string, def: number): number {
  try {
    const g: any = globalThis as any;
    const v = g?.[winKey];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  try {
    const s = localStorage.getItem(lsKey);
    if (s !== null) {
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  try {
    const e = (import.meta as any)?.env?.[envKey];
    if (typeof e !== "undefined") {
      const n = Number(e);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  return def;
}

function getMaxRecipients(): number {
  const n = readNumber(
    "PAYOUT_MAX_RECIPIENTS",
    "indexerchain_payout_max_recipients",
    "VITE_PAYOUT_MAX_RECIPIENTS",
    64
  );
  return Math.max(1, Math.floor(n));
}

function getWeightConfig(): EffectiveWeightConfig {
  const wBase = readNumber("PAYOUT_W_BASE", "indexerchain_payout_w_base", "VITE_PAYOUT_W_BASE", 1.0);
  const wStake = readNumber("PAYOUT_W_STAKE", "indexerchain_payout_w_stake", "VITE_PAYOUT_W_STAKE", 1.0);
  const wOnline = readNumber("PAYOUT_W_ONLINE", "indexerchain_payout_w_online", "VITE_PAYOUT_W_ONLINE", 1.0);
  const wReliab = readNumber("PAYOUT_W_RELIAB", "indexerchain_payout_w_reliab", "VITE_PAYOUT_W_RELIAB", 1.0);
  const sqrtStake = true; // default on
  const normalizeFactorOnline = readNumber(
    "PAYOUT_ONLINE_NORM",
    "indexerchain_payout_online_norm",
    "VITE_PAYOUT_ONLINE_NORM",
    100
  );
  const normalizeFactorReliab = readNumber(
    "PAYOUT_RELIAB_NORM",
    "indexerchain_payout_reliab_norm",
    "VITE_PAYOUT_RELIAB_NORM",
    100
  );
  const minWeight = readNumber(
    "PAYOUT_MIN_WEIGHT",
    "indexerchain_payout_min_weight",
    "VITE_PAYOUT_MIN_WEIGHT",
    1e-6
  );
  return {
    wBase,
    wStake,
    wOnline,
    wReliab,
    sqrtStake,
    normalizeFactorOnline,
    normalizeFactorReliab,
    minWeight,
  };
}

export function computeEffectiveWeight(
  c: RewardCandidateInput,
  cfg: EffectiveWeightConfig = getWeightConfig()
): number {
  if (c.eligible === false) return 0;
  const base = Math.max(0, cfg.wBase);
  const balUIDC = c.balanceUIDC ?? 0n;
  const balIDC = Number(balUIDC) / 10 ** IDC_DECIMALS;
  const stakeComponent = Math.max(0, cfg.wStake) * (cfg.sqrtStake ? Math.sqrt(Math.max(0, balIDC)) : Math.max(0, balIDC));
  const onlineRaw = c.onlineScore ?? 0;
  const onlineNorm = onlineRaw / Math.max(1, cfg.normalizeFactorOnline);
  const onlineComponent = Math.max(0, cfg.wOnline) * Math.max(0, onlineNorm);
  const reliabRaw = c.reliabilityScore ?? 0;
  const reliabNorm = reliabRaw / Math.max(1, cfg.normalizeFactorReliab);
  const reliabComponent = Math.max(0, cfg.wReliab) * Math.max(0, reliabNorm);
  const total = base + stakeComponent + onlineComponent + reliabComponent;
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(cfg.minWeight, total);
}

/**
 * Allocate reward budget among candidates by effective weight.
 * - Returns at most maxRecipients (configurable).
 * - Sums to <= totalBudgetUIDC; any remainder is kept as remainderUIDC.
 * - Deterministic: sort by (weight desc, address asc) before selection.
 */
export async function allocateRewardPool(
  totalBudgetUIDC: bigint,
  candidates: RewardCandidateInput[],
  maxRecipients: number = getMaxRecipients()
): Promise<AllocationPlan> {
  const enriched = candidates
    .map((c) => ({ c, w: computeEffectiveWeight(c) }))
    .filter((x) => x.w > 0);
  if (enriched.length === 0 || totalBudgetUIDC <= 0n) {
    return {
      totalBudgetUIDC,
      distributedUIDC: 0n,
      remainderUIDC: totalBudgetUIDC < 0n ? 0n : totalBudgetUIDC,
      recipients: [],
      payoutRoot: await calcMerkleRoot([]),
    };
  }
  // Deterministic ordering
  enriched.sort((a, b) => {
    if (b.w !== a.w) return b.w - a.w;
    return a.c.address.localeCompare(b.c.address);
  });

  const selected = enriched.slice(0, Math.max(1, maxRecipients));
  const sumW = selected.reduce((s, x) => s + x.w, 0);
  if (!Number.isFinite(sumW) || sumW <= 0) {
    return {
      totalBudgetUIDC,
      distributedUIDC: 0n,
      remainderUIDC: totalBudgetUIDC,
      recipients: [],
      payoutRoot: await calcMerkleRoot([]),
    };
  }

  // First pass: floor allocation
  const rawShares: AllocationResult[] = selected.map((x) => {
    const fraction = x.w / sumW;
    const share = BigInt(Math.floor(Number(totalBudgetUIDC) * fraction));
    return { address: x.c.address, amountUIDC: share, weight: x.w };
  });
  let distributed = rawShares.reduce((s, r) => s + r.amountUIDC, 0n);
  let remainder = totalBudgetUIDC - distributed;

  // Deterministic remainder distribution: round-robin by descending weight
  if (remainder > 0n) {
    let i = 0;
    while (remainder > 0n) {
      rawShares[i % rawShares.length].amountUIDC += 1n;
      distributed += 1n;
      remainder -= 1n;
      i++;
    }
  }

  // Payout root over "address:amount" lines sorted by address
  const leaves = [...rawShares]
    .sort((a, b) => a.address.localeCompare(b.address))
    .map((r) => `${r.address}:${r.amountUIDC.toString()}`);
  const payoutRoot = await calcMerkleRoot(leaves);

  return {
    totalBudgetUIDC,
    distributedUIDC: distributed,
    remainderUIDC: totalBudgetUIDC - distributed,
    recipients: rawShares,
    payoutRoot,
  };
}


