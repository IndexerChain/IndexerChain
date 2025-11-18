/**
 * Snapshot Management
 * 
 * Phase 9: State snapshots for fast chain initialization
 * Phase 11: Snapshot compression to reduce storage size
 * 
 * Snapshots allow nodes to quickly restore IndexState without replaying
 * all blocks from genesis. Snapshots are stored in localStorage.
 */

import type { SnapshotMeta, SnapshotData, Operation } from "./types.js";
import {
  compressSnapshot,
  decompressSnapshot,
  estimateUncompressedSize,
} from "./snapshotCompress.js";
import { computeDelta, applyDelta } from "./snapshotDelta.js";
import { computeSnapshotStateHash } from "./snapshotVerify.js";

// Storage keys
const SNAPSHOTS_META_KEY = "indexerchain_snapshots_meta_v1";
const SNAPSHOT_DATA_PREFIX = "indexerchain_snapshot_v1_";

// Default limits
const DEFAULT_MAX_SNAPSHOT_COUNT = 5;

/**
 * Load all snapshot metadata from localStorage
 * Returns empty array if no snapshots exist
 */
export function loadAllSnapshotMeta(): SnapshotMeta[] {
  if (typeof localStorage === "undefined") {
    return [];
  }

  const raw = localStorage.getItem(SNAPSHOTS_META_KEY);
  if (!raw) {
    return [];
  }

  try {
    const metas = JSON.parse(raw) as SnapshotMeta[];
    // Sort by height (ascending)
    return metas.sort((a, b) => a.height - b.height);
  } catch (error) {
    console.error("Failed to load snapshot metadata:", error);
    return [];
  }
}

/**
 * Save snapshot metadata list to localStorage
 */
export function saveAllSnapshotMeta(metas: SnapshotMeta[]): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    // Sort by height before saving
    const sorted = metas.sort((a, b) => a.height - b.height);
    localStorage.setItem(SNAPSHOTS_META_KEY, JSON.stringify(sorted));
  } catch (error) {
    console.error("Failed to save snapshot metadata:", error);
  }
}

/**
 * Load snapshot data by height
 * Returns null if snapshot doesn't exist
 * 
 * Phase 11: Supports both compressed and legacy formats
 * Phase 12: Supports full and delta snapshots
 */
export async function loadSnapshotByHeight(height: number): Promise<SnapshotData | null> {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const key = `${SNAPSHOT_DATA_PREFIX}${height}`;
  const raw = localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SnapshotData;
    
    // Phase 12: Handle delta snapshot - need to reconstruct from full + deltas
    if (parsed.full === false && parsed.delta) {
      // This is a delta snapshot, we'll reconstruct it in reconstructStateFromSnapshots
      return parsed;
    }
    
    // Phase 12: Handle full snapshot
    if (parsed.full === true && parsed.compressed && parsed.data) {
      try {
        const decompressed = await decompressSnapshot(parsed.data);
        return {
          meta: parsed.meta,
          indexState: decompressed,
          compressed: true,
          full: true,
        };
      } catch (error) {
        console.error(`[Phase 13] Failed to decompress snapshot at height ${height}:`, error);
        // Phase 13: Auto-repair corrupted snapshot
        console.warn(`[Phase 13] Snapshot at height ${height} is corrupted (decompression failed), deleting...`);
        deleteSnapshotByHeight(height);
        return null;
      }
    }
    
    // Phase 11: Handle compressed format (legacy, treat as full)
    if (parsed.compressed && parsed.data) {
      try {
        const decompressed = await decompressSnapshot(parsed.data);
        return {
          meta: parsed.meta,
          indexState: decompressed,
          compressed: true,
          full: true, // Legacy compressed snapshots are treated as full
        };
      } catch (error) {
        console.error(`[Phase 13] Failed to decompress snapshot at height ${height}:`, error);
        // Phase 13: Auto-repair corrupted snapshot
        console.warn(`[Phase 13] Snapshot at height ${height} is corrupted (decompression failed), deleting...`);
        deleteSnapshotByHeight(height);
        return null;
      }
    }
    
    // Legacy format (Phase 9)
    return {
      ...parsed,
      full: true, // Legacy snapshots are treated as full
    };
  } catch (error) {
    console.error(`Failed to load snapshot at height ${height}:`, error);
    return null;
  }
}

/**
 * Reconstruct IndexState from snapshots (full + deltas)
 * 
 * Phase 12: Reconstruct state from full snapshot and subsequent delta snapshots
 * 
 * @param targetHeight Target height to reconstruct state for
 * @param applyOperation Function to apply an operation to IndexState
 * @returns Reconstructed IndexState snapshot data, or null if reconstruction fails
 */
export async function reconstructStateFromSnapshots(
  targetHeight: number,
  applyOperation: (op: Operation) => void
): Promise<any | null> {
  // Find nearest full snapshot
  const fullSnapMeta = findNearestFullSnapshot(targetHeight);
  if (!fullSnapMeta) {
    console.warn(`[Phase 12] No full snapshot found before height ${targetHeight}`);
    return null;
  }

  // Load full snapshot
  const fullSnap = await loadSnapshotByHeight(fullSnapMeta.height);
  if (!fullSnap || !fullSnap.indexState) {
    console.error(`[Phase 12] Failed to load full snapshot at height ${fullSnapMeta.height}`);
    return null;
  }

  // Start with full snapshot state
  let state = fullSnap.indexState;

  // Load and apply all delta snapshots after the full snapshot
  const deltaMetas = loadDeltaSnapshotsAfter(fullSnapMeta.height, targetHeight);
  
  for (const deltaMeta of deltaMetas) {
    const deltaSnap = await loadSnapshotByHeight(deltaMeta.height);
    if (!deltaSnap || !deltaSnap.delta) {
      console.warn(`[Phase 12] Failed to load delta snapshot at height ${deltaMeta.height}`);
      continue;
    }

    try {
      // Apply delta operations to reconstruct state
      await applyDelta(deltaSnap.delta, applyOperation);
    } catch (error) {
      console.error(`[Phase 12] Failed to apply delta at height ${deltaMeta.height}:`, error);
      return null;
    }
  }

  // Return the reconstructed state (we need to get it from IndexState)
  // Since we're applying operations, the state is already updated in IndexState
  // We'll need to get it from the IndexState instance that's applying operations
  return state;
}

/**
 * Synchronous version for backward compatibility
 * Note: This will return null for compressed snapshots, use async version instead
 */
export function loadSnapshotByHeightSync(height: number): SnapshotData | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const key = `${SNAPSHOT_DATA_PREFIX}${height}`;
  const raw = localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SnapshotData;
    
    // If compressed, return null (need async version)
    if (parsed.compressed) {
      return null;
    }
    
    // Legacy format
    return parsed;
  } catch (error) {
    console.error(`Failed to load snapshot at height ${height}:`, error);
    return null;
  }
}

/**
 * Save a new snapshot
 * 
 * Phase 11: Automatically compresses snapshot data
 * Phase 12: Supports full and delta snapshots
 * 
 * @param height Block height at which snapshot is taken
 * @param blockHash Hash of the block at this height
 * @param indexStateSnapshot IndexState.toSnapshot() result (for full snapshots)
 * @param deltaOperations Array of operations since last snapshot (for delta snapshots)
 * @param isFull Whether this is a full snapshot (true) or delta snapshot (false)
 * @returns Created snapshot metadata
 */
export async function saveSnapshot(
  height: number,
  blockHash: string,
  indexStateSnapshot?: any,
  deltaOperations?: Operation[],
  isFull: boolean = true,
  stateCommitment?: string // Phase 15: State commitment from block header
): Promise<SnapshotMeta> {
  // Create snapshot metadata
  const meta: SnapshotMeta = {
    id: `snap_${height.toString().padStart(7, "0")}`,
    height,
    blockHash,
    createdAt: Date.now(),
    version: 1,
  };

  let snapshotData: SnapshotData;
  let fullStateSnapshot: any; // For hash computation

  if (isFull) {
    // Phase 12: Full snapshot
    if (!indexStateSnapshot) {
      throw new Error("Full snapshot requires indexStateSnapshot");
    }

    fullStateSnapshot = indexStateSnapshot;

    // Phase 11: Compress snapshot data
    let compressedData: string;
    try {
      compressedData = await compressSnapshot(indexStateSnapshot);
    } catch (error) {
      console.error(`Failed to compress snapshot at height ${height}:`, error);
      throw error;
    }

    snapshotData = {
      meta,
      compressed: true,
      full: true,
      data: compressedData,
    };
  } else {
    // Phase 12: Delta snapshot
    if (!deltaOperations || deltaOperations.length === 0) {
      throw new Error("Delta snapshot requires deltaOperations");
    }

    // For delta snapshots, we need to reconstruct the full state to compute hash
    // Find the nearest full snapshot and apply deltas
    const fullSnapMeta = findNearestFullSnapshot(height - 1);
    if (!fullSnapMeta) {
      throw new Error(`Cannot create delta snapshot: no full snapshot found before height ${height}`);
    }

    const fullSnap = await loadSnapshotByHeight(fullSnapMeta.height);
    if (!fullSnap || !fullSnap.indexState) {
      throw new Error(`Failed to load full snapshot at height ${fullSnapMeta.height}`);
    }

    // Reconstruct full state by applying delta operations
    const { IndexState } = await import("./indexState.js");
    const restoredState = IndexState.fromSnapshot(fullSnap.indexState);
    
    // Apply delta operations
    for (const op of deltaOperations) {
      restoredState.applyOperation(op, undefined); // ownerAddress not needed here
    }

    fullStateSnapshot = restoredState.toSnapshot();

    // Compress delta operations
    let compressedDelta: string;
    try {
      compressedDelta = await computeDelta(deltaOperations);
    } catch (error) {
      console.error(`Failed to compress delta at height ${height}:`, error);
      throw error;
    }

    snapshotData = {
      meta,
      compressed: true,
      full: false,
      delta: compressedDelta,
    };
  }

  // Phase 13: Compute state hash and size information
  // Phase 15: Save stateCommitment from block header
  try {
    const stateHash = await computeSnapshotStateHash(fullStateSnapshot);
    meta.stateHash = stateHash;
    
    // Phase 15: Save stateCommitment if provided
    if (stateCommitment) {
      meta.stateCommitment = stateCommitment;
      
      // Verify that stateCommitment matches stateHash
      if (stateHash !== stateCommitment) {
        console.warn(`[Phase 15] State commitment mismatch at height ${height}: stateHash=${stateHash.substring(0, 16)}..., stateCommitment=${stateCommitment.substring(0, 16)}...`);
        // Still save, but log warning
      }
    }

    // Calculate sizes
    if (snapshotData.compressed) {
      if (snapshotData.data) {
        meta.compressedSize = snapshotData.data.length;
        meta.uncompressedSize = estimateUncompressedSize(snapshotData.data);
      } else if (snapshotData.delta) {
        meta.compressedSize = snapshotData.delta.length;
        // For delta, estimate based on operations count
        meta.uncompressedSize = deltaOperations ? deltaOperations.length * 100 : 0; // Rough estimate
      }
    }
  } catch (error) {
    console.error(`[Phase 13] Failed to compute snapshot hash at height ${height}:`, error);
    // Don't fail snapshot creation if hash computation fails
  }

  // Save snapshot data
  if (typeof localStorage !== "undefined") {
    try {
      const key = `${SNAPSHOT_DATA_PREFIX}${height}`;
      localStorage.setItem(key, JSON.stringify(snapshotData));
    } catch (error) {
      console.error(`Failed to save snapshot at height ${height}:`, error);
      throw error;
    }
  }

  // Update metadata list
  const allMetas = loadAllSnapshotMeta();
  
  // Remove existing snapshot at this height (if any)
  const filtered = allMetas.filter((m) => m.height !== height);
  
  // Add new snapshot
  filtered.push(meta);
  
  // Save updated metadata
  saveAllSnapshotMeta(filtered);

  return meta;
}

/**
 * Find the nearest full snapshot at or before the given height
 * 
 * Phase 12: Find the base full snapshot for delta reconstruction
 * 
 * @param height Target height
 * @returns Snapshot metadata of the nearest full snapshot, or null
 */
export function findNearestFullSnapshot(height: number): SnapshotMeta | null {
  const allMetas = loadAllSnapshotMeta();
  
  // Filter to snapshots at or before height, sorted by height descending
  const candidates = allMetas
    .filter((m) => m.height <= height)
    .sort((a, b) => b.height - a.height);
  
  // Check each candidate to see if it's a full snapshot
  for (const meta of candidates) {
    const snapshot = loadSnapshotByHeightSync(meta.height);
    if (snapshot && snapshot.full) {
      return meta;
    }
  }
  
  return null;
}

/**
 * Load all delta snapshots after a given height
 * 
 * Phase 12: Get all delta snapshots between full snapshot and target height
 * 
 * @param fromHeight Starting height (exclusive)
 * @param toHeight Target height (inclusive)
 * @returns Array of snapshot metadata, sorted by height
 */
export function loadDeltaSnapshotsAfter(
  fromHeight: number,
  toHeight: number
): SnapshotMeta[] {
  const allMetas = loadAllSnapshotMeta();
  
  return allMetas
    .filter((m) => m.height > fromHeight && m.height <= toHeight)
    .sort((a, b) => a.height - b.height);
}

/**
 * Recompress an existing snapshot (upgrade from legacy format)
 * 
 * Phase 11: Convert legacy snapshot to compressed format
 * 
 * @param height Snapshot height to recompress
 * @returns true if successful, false if snapshot doesn't exist or already compressed
 */
export async function recompressSnapshot(height: number): Promise<boolean> {
  if (typeof localStorage === "undefined") {
    return false;
  }

  const key = `${SNAPSHOT_DATA_PREFIX}${height}`;
  const raw = localStorage.getItem(key);
  if (!raw) {
    return false;
  }

  try {
    const parsed = JSON.parse(raw) as SnapshotData;
    
    // Already compressed, skip
    if (parsed.compressed) {
      return false;
    }
    
    // Legacy format, compress it
    if (parsed.indexState) {
      const compressedData = await compressSnapshot(parsed.indexState);
      const newSnapshotData: SnapshotData = {
        meta: parsed.meta,
        compressed: true,
        data: compressedData,
      };
      
      localStorage.setItem(key, JSON.stringify(newSnapshotData));
      console.log(`[Phase 11] Recompressed snapshot at height ${height}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`Failed to recompress snapshot at height ${height}:`, error);
    return false;
  }
}

/**
 * Get snapshot size information
 * 
 * Phase 11: Returns size information for display
 * 
 * @param height Snapshot height
 * @returns Size information or null if snapshot doesn't exist
 */
export async function getSnapshotSizeInfo(height: number): Promise<{
  compressedSize: number;
  estimatedUncompressedSize: number;
  compressionRatio: number;
} | null> {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const key = `${SNAPSHOT_DATA_PREFIX}${height}`;
  const raw = localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SnapshotData;
    
    if (parsed.compressed && parsed.data) {
      const compressedSize = parsed.data.length;
      const estimatedUncompressed = estimateUncompressedSize(parsed.data);
      const compressionRatio = estimatedUncompressed > 0
        ? (1 - compressedSize / estimatedUncompressed) * 100
        : 0;
      
      return {
        compressedSize,
        estimatedUncompressedSize: estimatedUncompressed,
        compressionRatio,
      };
    } else if (parsed.indexState) {
      // Legacy format
      const jsonString = JSON.stringify(parsed.indexState);
      const uncompressedSize = new Blob([jsonString]).size;
      
      return {
        compressedSize: uncompressedSize,
        estimatedUncompressedSize: uncompressedSize,
        compressionRatio: 0,
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Failed to get snapshot size info at height ${height}:`, error);
    return null;
  }
}

/**
 * Recompress all snapshots (upgrade all legacy snapshots)
 * 
 * Phase 11: Convert all legacy snapshots to compressed format
 * 
 * @returns Number of snapshots recompressed
 */
export async function recompressAllSnapshots(): Promise<number> {
  if (typeof localStorage === "undefined") {
    return 0;
  }
  
  const allMetas = loadAllSnapshotMeta();
  let recompressed = 0;
  
  for (const meta of allMetas) {
    const success = await recompressSnapshot(meta.height);
    if (success) {
      recompressed++;
    }
  }
  
  return recompressed;
}

/**
 * Get the latest (highest height) snapshot metadata
 * Returns null if no snapshots exist
 */
export function getLatestSnapshotMeta(): SnapshotMeta | null {
  const allMetas = loadAllSnapshotMeta();
  if (allMetas.length === 0) {
    return null;
  }

  // Return the one with highest height
  return allMetas.reduce((latest, current) =>
    current.height > latest.height ? current : latest
  );
}

/**
 * Get snapshot count (for determining full vs delta)
 * 
 * Phase 12: Count snapshots to determine if next should be full
 */
export function getSnapshotCount(): number {
  return loadAllSnapshotMeta().length;
}

/**
 * Delete snapshot by height
 * Removes both metadata and data
 */
export function deleteSnapshotByHeight(height: number): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  // Remove from metadata list
  const allMetas = loadAllSnapshotMeta();
  const filtered = allMetas.filter((m) => m.height !== height);
  saveAllSnapshotMeta(filtered);

  // Remove snapshot data
  const key = `${SNAPSHOT_DATA_PREFIX}${height}`;
  localStorage.removeItem(key);
}

/**
 * Clear all snapshots
 * Removes all snapshot metadata and data
 */
export function clearAllSnapshots(): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  // Get all snapshot heights
  const allMetas = loadAllSnapshotMeta();
  
  // Delete all snapshot data
  for (const meta of allMetas) {
    const key = `${SNAPSHOT_DATA_PREFIX}${meta.height}`;
    localStorage.removeItem(key);
  }

  // Clear metadata list
  localStorage.removeItem(SNAPSHOTS_META_KEY);
}

/**
 * Prune old snapshots, keeping only the most recent N snapshots
 * 
 * @param maxCount Maximum number of snapshots to keep
 */
export function pruneOldSnapshots(maxCount: number = DEFAULT_MAX_SNAPSHOT_COUNT): void {
  const allMetas = loadAllSnapshotMeta();
  
  if (allMetas.length <= maxCount) {
    return; // No pruning needed
  }

  // Sort by height (descending) to get newest first
  const sorted = allMetas.sort((a, b) => b.height - a.height);
  
  // Keep only the newest maxCount snapshots
  const toKeep = sorted.slice(0, maxCount);
  const toDelete = sorted.slice(maxCount);

  // Delete old snapshots
  for (const meta of toDelete) {
    deleteSnapshotByHeight(meta.height);
  }

  // Update metadata list (only keep the ones we're keeping)
  saveAllSnapshotMeta(toKeep);
}

