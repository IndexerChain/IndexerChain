import { sha256 } from "../crypto.js";

export interface WeightedAddress {
  address: string;
  weight: number; // non-negative
}

/**
 * Deterministic Weighted VRF: given seed and (address, weight) list,
 * computes a score per address and chooses the max as leader.
 * Score = H(seed | address) / (1 + 1/weight) to bias by weight (higher weight -> higher score)
 */
export async function pickLeaderWeighted(seed: string, candidates: WeightedAddress[]): Promise<string | null> {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  let bestAddr: string | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const h = await sha256(`${seed}|${c.address}`);
    // Convert first 8 bytes of hex to number
    const num = parseInt(h.slice(0, 16), 16);
    const base = num / 0xffffffffffffffff; // 0..1
    const w = Math.max(0, c.weight);
    const bias = w <= 0 ? 0 : (w / (1 + w)); // 0..1 (approaches 1)
    const score = base * (1 + bias); // 0..2
    if (score > bestScore) {
      bestScore = score;
      bestAddr = c.address;
    }
  }
  return bestAddr;
}


