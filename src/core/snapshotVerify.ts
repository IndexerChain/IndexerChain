/**
 * Snapshot Verification Module
 * 
 * Phase 13: Snapshot integrity verification and hash computation
 * 
 * Provides functions to:
 * - Normalize snapshot data for deterministic hashing
 * - Compute SHA-256 hash of snapshot state
 * - Verify snapshot integrity
 */

import type { SnapshotData } from "./types.js";
import {
  loadSnapshotByHeight,
  deleteSnapshotByHeight,
  loadAllSnapshotMeta,
  saveAllSnapshotMeta,
} from "./snapshot.js";

/**
 * Current verification algorithm version
 */
const CURRENT_VERIFICATION_VERSION = 1;

/**
 * Normalize snapshot data for deterministic hashing
 * 
 * Ensures consistent key ordering for stable hash computation:
 * - Namespaces sorted alphabetically
 * - Keys within each namespace sorted alphabetically
 * - Values as strings
 * 
 * @param snapshotJson IndexState snapshot data (from toSnapshot())
 * @returns Normalized data as Uint8Array (UTF-8 encoded JSON)
 */
export function normalizeSnapshotData(snapshotJson: any): Uint8Array {
  // Extract the data object from snapshot
  const data = snapshotJson.data || snapshotJson;
  
  // Build ordered structure
  const ordered: Record<string, Record<string, string>> = {};
  
  // Get all namespaces and sort
  const namespaces = Object.keys(data).sort();
  
  for (const namespace of namespaces) {
    const namespaceData = data[namespace];
    if (typeof namespaceData !== "object" || namespaceData === null) {
      continue;
    }
    
    // Get all keys in this namespace and sort
    const keys = Object.keys(namespaceData).sort();
    ordered[namespace] = {};
    
    for (const key of keys) {
      const value = namespaceData[key];
      // Convert value to string if needed
      ordered[namespace][key] = typeof value === "string" ? value : String(value);
    }
  }
  
  // Convert to JSON string with stable formatting
  const jsonString = JSON.stringify(ordered);
  
  // Encode as UTF-8
  return new TextEncoder().encode(jsonString);
}

/**
 * Compute SHA-256 hash of normalized snapshot state
 * 
 * @param snapshotJson IndexState snapshot data
 * @returns Hex-encoded SHA-256 hash (64 characters)
 */
export async function computeSnapshotStateHash(snapshotJson: any): Promise<string> {
  const normalized = normalizeSnapshotData(snapshotJson);
  // Ensure we have a proper ArrayBuffer for crypto.subtle.digest
  // Create a new ArrayBuffer to avoid SharedArrayBuffer issues
  const buffer = new Uint8Array(normalized).buffer;
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  
  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify snapshot integrity by checking state hash
 * 
 * For delta snapshots, reconstructs the full state first.
 * Updates meta.verifiedAt and meta.verificationVersion on success.
 * 
 * @param snapshot Snapshot data to verify
 * @returns true if snapshot is valid, false otherwise
 */
export async function verifySnapshotIntegrity(
  snapshot: SnapshotData
): Promise<boolean> {
  if (!snapshot.meta.stateHash) {
    // No hash stored, cannot verify (but not necessarily corrupted)
    return false;
  }

  try {
    let fullStateSnapshot: any;
    
    // Phase 12: Handle delta snapshots - need to reconstruct full state
    if (snapshot.full === false && snapshot.delta) {
      // Reconstruct from full snapshot + deltas
      const { findNearestFullSnapshot, loadDeltaSnapshotsAfter } = await import("./snapshot.js");
      const { IndexState } = await import("./indexState.js");
      const { applyDelta } = await import("./snapshotDelta.js");
      
      const fullSnapMeta = findNearestFullSnapshot(snapshot.meta.height);
      if (!fullSnapMeta) {
        return false;
      }
      
      const fullSnap = await loadSnapshotByHeight(fullSnapMeta.height);
      if (!fullSnap || !fullSnap.indexState) {
        return false;
      }
      
      // Reconstruct state
      const restoredState = IndexState.fromSnapshot(fullSnap.indexState);
      const deltaMetas = loadDeltaSnapshotsAfter(fullSnapMeta.height, snapshot.meta.height);
      
      for (const deltaMeta of deltaMetas) {
        const deltaSnap = await loadSnapshotByHeight(deltaMeta.height);
        if (deltaSnap && deltaSnap.delta) {
          await applyDelta(deltaSnap.delta, (op: any) => {
            restoredState.applyOperation(op, undefined);
          });
        }
      }
      
      fullStateSnapshot = restoredState.toSnapshot();
    } else {
      // Full snapshot - use indexState directly
      if (!snapshot.indexState) {
        return false;
      }
      fullStateSnapshot = snapshot.indexState;
    }
    
    // Compute hash of the full state
    const computedHash = await computeSnapshotStateHash(fullStateSnapshot);
    
    // Compare with stored hash
    const isValid = computedHash === snapshot.meta.stateHash;
    
    if (isValid) {
      // Update verification metadata
      snapshot.meta.verifiedAt = Date.now();
      snapshot.meta.verificationVersion = CURRENT_VERIFICATION_VERSION;
      
      // Persist updated meta
      const allMetas = loadAllSnapshotMeta();
      const index = allMetas.findIndex((m) => m.id === snapshot.meta.id);
      if (index >= 0) {
        allMetas[index] = snapshot.meta;
        saveAllSnapshotMeta(allMetas);
      }
    }
    
    return isValid;
  } catch (error) {
    return false;
  }
}

/**
 * Verify a snapshot by height
 * 
 * Convenience function that loads and verifies a snapshot.
 * 
 * @param height Snapshot height
 * @returns true if snapshot exists and is valid, false otherwise
 */
export async function verifySnapshotByHeight(height: number): Promise<boolean> {
  const snapshot = await loadSnapshotByHeight(height);
  if (!snapshot) {
    return false;
  }
  
  return await verifySnapshotIntegrity(snapshot);
}

/**
 * Delete corrupted snapshot and return fallback height
 * 
 * @param height Height of corrupted snapshot
 * @returns Height of nearest valid snapshot, or 0 if none found
 */
export async function handleCorruptedSnapshot(height: number): Promise<number> {
  
  // Delete the corrupted snapshot
  await deleteSnapshotByHeight(height);
  
  // Find nearest valid snapshot
  const allMetas = loadAllSnapshotMeta();
  const validMetas = allMetas.filter((m) => m.height < height);
  
  if (validMetas.length > 0) {
    // Return height of latest valid snapshot
    const latest = validMetas[validMetas.length - 1];
    return latest.height;
  }
  
  // No valid snapshots found, must replay from genesis
  return 0;
}

/**
 * Verify one snapshot in background (for periodic verification)
 * 
 * Selects the snapshot that has been verified least recently (or never verified).
 * 
 * @returns true if a snapshot was verified, false if none found or verification failed
 */
export async function verifyOneSnapshotInBackground(): Promise<boolean> {
  const allMetas = loadAllSnapshotMeta();
  if (allMetas.length === 0) {
    return false;
  }

  // Sort by verifiedAt (null/undefined first, then oldest first)
  const sorted = allMetas.sort((a, b) => {
    const aTime = a.verifiedAt ?? 0;
    const bTime = b.verifiedAt ?? 0;
    return aTime - bTime;
  });

  // Verify the least recently verified snapshot
  const targetMeta = sorted[0];
  const snapshot = await loadSnapshotByHeight(targetMeta.height);
  
  if (!snapshot) {
    // Snapshot doesn't exist, might have been deleted
    return false;
  }

  try {
    const isValid = await verifySnapshotIntegrity(snapshot);
    if (isValid) {
      return true;
    } else {
      await handleCorruptedSnapshot(targetMeta.height);
      return false;
    }
  } catch (error) {
    return false;
  }
}

