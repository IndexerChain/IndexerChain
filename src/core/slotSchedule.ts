/**
 * Slot scheduling primitives for single-leader, high-frequency blocks.
 * 
 * Phase 48-A: Scaffolding only. Not enforced unless feature is enabled.
 */

import type { Address, BlockHeader } from "./types.js";
import { sha256 } from "./crypto.js";
import { getEpochMs, getSlotTimeMs } from "./featureFlags.js";

export interface SlotIdentity {
  epochId: number;
  slotIndex: number;
}

export function getEpochId(timestampMs: number, epochMs: number = getEpochMs()): number {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) return 0;
  const ms = Math.max(1, Math.floor(epochMs));
  return Math.floor(timestampMs / ms);
}

export function getSlotIndex(
  timestampMs: number,
  epochMs: number = getEpochMs(),
  slotTimeMs: number = getSlotTimeMs()
): number {
  const msEpoch = Math.max(1, Math.floor(epochMs));
  const msSlot = Math.max(1, Math.floor(slotTimeMs));
  const epochStart = Math.floor(timestampMs / msEpoch) * msEpoch;
  return Math.floor((timestampMs - epochStart) / msSlot);
}

export function getSlotIdentity(timestampMs: number): SlotIdentity {
  return {
    epochId: getEpochId(timestampMs),
    slotIndex: getSlotIndex(timestampMs),
  };
}

export interface WeightedCandidate {
  address: Address;
  weight: number; // positive real; 0 means excluded
}

function unitFloatFromHexPrefix(hex: string): number {
  // Use first 8 bytes (16 hex chars)
  const c = hex.slice(0, 16);
  const x = Number.parseInt(c, 16);
  const denom = 0xffff_ffff_ffff_ffff; // 64-bit
  return Math.max(1e-12, Math.min(1 - 1e-12, x / denom));
}

/**
 * Deterministic leader selection. All nodes produce same result given same inputs.
 * score = -ln(u) / weight  (VRF-like lottery)
 */
export async function selectLeader(
  epochId: number,
  slotIndex: number,
  randSeed: string,
  candidates: WeightedCandidate[]
): Promise<Address | null> {
  const usable = candidates.filter((c) => c.weight > 0 && !!c.address);
  if (usable.length === 0) return null;
  
  // Optimization: If only one candidate, return immediately (no VRF needed)
  // This significantly speeds up single-node mining
  if (usable.length === 1) {
    return usable[0].address;
  }

  let bestScore = Number.POSITIVE_INFINITY;
  let leader: Address = usable[0].address;

  for (const c of usable) {
    // Mix: seed|epoch|slot|address
    const mix = `${randSeed}|${epochId}|${slotIndex}|${c.address}`;
    const h = await sha256(mix);
    const u = unitFloatFromHexPrefix(h);
    const score = -Math.log(u) / c.weight;
    if (score < bestScore) {
      bestScore = score;
      leader = c.address;
    }
  }
  return leader;
}

/**
 * Derive a per-slot random seed from previous block linkage.
 * If previous hash is unknown, falls back to epoch/slot-only seed.
 */
export async function deriveRandSeed(
  prevBlockHash: string | undefined,
  epochId: number,
  slotIndex: number
): Promise<string> {
  const base = prevBlockHash ?? "genesis-seed";
  return sha256(`${base}|${epochId}|${slotIndex}`);
}

/**
 * Convenience: compute slot identity and seed from a header context (no enforcement).
 */
export async function computeSlotContextFromHeader(
  prevHeader: BlockHeader | undefined,
  currentTimestampMs: number
): Promise<{ epochId: number; slotIndex: number; randSeed: string }> {
  const { epochId, slotIndex } = getSlotIdentity(currentTimestampMs);
  const prevHash = prevHeader?.prevHash; // we may only have prevHash here
  const randSeed = await deriveRandSeed(prevHash, epochId, slotIndex);
  return { epochId, slotIndex, randSeed };
}


