/**
 * Commitment System
 * 
 * Phase 27: Pedersen Commitment for hiding amounts
 * 
 * Commitment: C = v * H + r * G
 * where:
 * - v = amount (value)
 * - r = random blinding factor
 * - H, G = generator points (simplified for browser)
 * 
 * For Phase 27, we use a simplified hash-based commitment:
 * C = sha256(amount || random || "commitment")
 */

import { sha256 } from "../crypto.js";
import type { Commitment } from "./types.js";

/**
 * Create a commitment for an amount
 * 
 * @param amount Amount to commit to (in IDC)
 * @param random Optional random blinding factor (hex string). If not provided, generates one.
 * @returns Commitment object with commitment value, amount, and random
 */
export async function createCommitment(
  amount: number,
  random?: string
): Promise<Commitment> {
  // Generate random if not provided
  if (!random) {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    random = Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }
  
  // Create commitment: C = sha256(amount || random || "commitment")
  const amountStr = amount.toString();
  const commitmentLabel = "commitment";
  const commitmentInput = `${amountStr}${random}${commitmentLabel}`;
  
  const commitment = await sha256(commitmentInput);
  
  return {
    commitment,
    amount,
    random,
  };
}

/**
 * Verify a commitment
 * 
 * Recomputes the commitment from amount and random, then compares
 * 
 * @param commitment Commitment value to verify
 * @param amount Amount that was committed to
 * @param random Random blinding factor used
 * @returns true if commitment is valid
 */
export async function verifyCommitment(
  commitment: string,
  amount: number,
  random: string
): Promise<boolean> {
  const recomputed = await createCommitment(amount, random);
  return recomputed.commitment === commitment;
}

/**
 * Generate a random blinding factor
 * 
 * @returns Random 32-byte hex string
 */
export function generateRandom(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

