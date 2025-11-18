/**
 * Nullifier System
 * 
 * Phase 27: Prevents double-spending of notes
 * 
 * Nullifier: N = hash(random || privSpend || "nullifier")
 * 
 * When spending a note, the nullifier is published on-chain.
 * If the same nullifier appears twice, it's a double-spend attempt.
 */

import { sha256 } from "../crypto.js";
import type { Nullifier, Note } from "./types.js";

/**
 * Generate a nullifier for a note
 * 
 * @param note Note to generate nullifier for
 * @param privSpend Private spend key (CryptoKey)
 * @returns Nullifier value
 */
export async function generateNullifier(
  note: Note,
  privSpend: CryptoKey
): Promise<string> {
  // Export private spend key as raw bytes
  const privSpendBytes = await crypto.subtle.exportKey("raw", privSpend);
  const privSpendArray = new Uint8Array(privSpendBytes);
  
  // Create nullifier: N = sha256(random || privSpend || "nullifier")
  const randomStr = note.random;
  const privSpendStr = Array.from(privSpendArray)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  const nullifierInput = `${randomStr}${privSpendStr}nullifier`;
  
  const nullifier = await sha256(nullifierInput);
  
  return nullifier;
}

/**
 * Create a nullifier object
 * 
 * @param note Note being spent
 * @param privSpend Private spend key
 * @returns Nullifier object
 */
export async function createNullifier(
  note: Note,
  privSpend: CryptoKey
): Promise<Nullifier> {
  const nullifier = await generateNullifier(note, privSpend);
  return {
    nullifier,
    noteId: note.noteId,
  };
}

/**
 * Verify a nullifier hasn't been used before
 * 
 * This should be checked against the on-chain nullifier set
 * 
 * @param nullifier Nullifier value to check
 * @param nullifierSet Set of used nullifiers (from IndexState)
 * @returns true if nullifier is valid (not used before)
 */
export function verifyNullifier(
  nullifier: string,
  nullifierSet: Set<string>
): boolean {
  // Check if nullifier has been used
  if (nullifierSet.has(nullifier)) {
    return false; // Double-spend detected
  }
  return true;
}

