/**
 * Incremental Snapshot (Delta Snapshot) Management
 * 
 * Phase 12: Delta snapshots store only changes since last snapshot
 * 
 * This module handles:
 * - Computing deltas (changes between snapshots)
 * - Saving delta snapshots
 * - Applying delta snapshots to reconstruct state
 */

import type { Operation } from "./types.js";
import { compressSnapshot, decompressSnapshot } from "./snapshotCompress.js";

/**
 * Compute delta from a list of operations
 * 
 * Phase 12: Compress operations list for delta snapshot
 * 
 * @param operations Array of operations since last snapshot
 * @returns Base64-encoded compressed delta string
 */
export async function computeDelta(operations: Operation[]): Promise<string> {
  if (operations.length === 0) {
    // Empty delta - return empty compressed string
    return await compressSnapshot([]);
  }
  
  // Compress the operations array
  return await compressSnapshot(operations);
}

/**
 * Apply delta operations to an IndexState
 * 
 * Phase 12: Apply delta operations to reconstruct state
 * 
 * @param delta Base64-encoded compressed delta string
 * @param applyOperation Function to apply an operation to IndexState
 * @returns Array of operations that were applied
 */
export async function applyDelta(
  delta: string,
  applyOperation: (op: Operation) => void
): Promise<Operation[]> {
  // Decompress delta
  const operations = await decompressSnapshot(delta) as Operation[];
  
  // Apply each operation
  for (const op of operations) {
    applyOperation(op);
  }
  
  return operations;
}

/**
 * Get the size of a delta snapshot
 * 
 * @param delta Base64-encoded compressed delta string
 * @returns Size in bytes
 */
export function getDeltaSize(delta: string): number {
  return delta.length;
}

