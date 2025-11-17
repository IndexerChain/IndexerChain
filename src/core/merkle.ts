/**
 * Merkle tree utilities
 * 
 * Functions:
 * - calcMerkleRoot: Calculate Merkle root from transaction IDs
 */

import { sha256 } from "./crypto.js";

/**
 * Calculate Merkle root from transaction IDs
 * Uses a simple binary tree structure
 * 
 * @param txIds Array of transaction IDs (hex strings)
 * @returns Merkle root (hex string)
 */
export async function calcMerkleRoot(txIds: string[]): Promise<string> {
  if (txIds.length === 0) {
    // Empty block: return hash of empty string
    return await sha256("");
  }

  if (txIds.length === 1) {
    // Single transaction: hash it twice (or return its hash)
    const hash = await sha256(txIds[0]);
    return await sha256(hash + hash); // Double hash for single element
  }

  // Hash each transaction ID
  const hashes = await Promise.all(
    txIds.map((txId) => sha256(txId))
  );

  // Build Merkle tree bottom-up
  let level = hashes;

  while (level.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        // Pair exists: hash the concatenation
        const combined = level[i] + level[i + 1];
        nextLevel.push(await sha256(combined));
      } else {
        // Odd number: duplicate last hash
        const combined = level[i] + level[i];
        nextLevel.push(await sha256(combined));
      }
    }

    level = nextLevel;
  }

  return level[0];
}

