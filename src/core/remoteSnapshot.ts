/**
 * Remote Snapshot Sync Module
 * 
 * Phase 14: Remote snapshot fetching and synchronization
 * 
 * Allows nodes to quickly sync by downloading snapshots from remote sources
 * (HTTP/CDN/IPFS) instead of replaying from genesis or waiting for P2P sync.
 */

import type { SnapshotMeta, SnapshotData, ChainParams } from "./types.js";
import {
  computeSnapshotStateHash,
  verifySnapshotIntegrity,
} from "./snapshotVerify.js";
import {
  decompressSnapshot,
} from "./snapshotCompress.js";
import {
  saveSnapshot,
  saveAllSnapshotMeta,
  loadAllSnapshotMeta,
} from "./snapshot.js";

/**
 * Remote snapshot source configuration
 */
export interface RemoteSnapshotSource {
  baseUrl: string; // Base URL, e.g., "https://snap.indexerchain.io"
  priority: number; // Priority for multi-source selection (lower = higher priority)
}

/**
 * Fetch list of available snapshots from remote source
 * 
 * Expected API: GET {baseUrl}/snapshots/meta
 * Returns: Array of SnapshotMeta
 * 
 * @param source Remote snapshot source
 * @returns Array of snapshot metadata, or empty array on error
 */
export async function fetchRemoteSnapshotList(
  source: RemoteSnapshotSource
): Promise<SnapshotMeta[]> {
  try {
    const url = `${source.baseUrl}/snapshots/meta`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return [];
    }

    const metas = await response.json() as SnapshotMeta[];
    
    // Validate that all items have required fields
    const validMetas = metas.filter((meta) => 
      meta.id && 
      typeof meta.height === "number" && 
      meta.blockHash && 
      meta.createdAt
    );

    return validMetas;
  } catch (error) {
    return [];
  }
}

/**
 * Fetch snapshot data from remote source
 * 
 * Expected API: GET {baseUrl}/snapshots/{id}
 * Returns: SnapshotData (compressed format)
 * 
 * @param source Remote snapshot source
 * @param id Snapshot ID (e.g., "snap_0001234")
 * @returns Snapshot data, or null on error
 */
export async function fetchRemoteSnapshotData(
  source: RemoteSnapshotSource,
  id: string
): Promise<SnapshotData | null> {
  try {
    const url = `${source.baseUrl}/snapshots/${id}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const snapshotData = await response.json() as SnapshotData;
    
    // Basic validation
    if (!snapshotData.meta || snapshotData.meta.id !== id) {
      return null;
    }

    return snapshotData;
  } catch (error) {
    return null;
  }
}

/**
 * Choose the best remote snapshot from candidates
 * 
 * Selection criteria:
 * - Height must be >= remoteSnapshotMinHeight
 * - Version must be compatible (currently version 1)
 * - Prefer higher height
 * - Prefer snapshots with stateHash (Phase 13)
 * 
 * @param candidates Array of candidate snapshot metadata
 * @param params Chain parameters
 * @returns Best snapshot metadata, or null if none suitable
 */
export function chooseBestRemoteSnapshot(
  candidates: SnapshotMeta[],
  params: ChainParams
): SnapshotMeta | null {
  if (candidates.length === 0) {
    return null;
  }

  const minHeight = params.remoteSnapshotMinHeight ?? 0;
  const currentVersion = 1; // Current snapshot version

  // Filter candidates
  const validCandidates = candidates.filter((meta) => {
    // Must meet minimum height requirement
    if (meta.height < minHeight) {
      return false;
    }

    // Version must be compatible
    if (meta.version !== currentVersion) {
      return false;
    }

    return true;
  });

  if (validCandidates.length === 0) {
    return null;
  }

  // Sort by: has stateHash first, then by height descending
  const sorted = validCandidates.sort((a, b) => {
    // Prefer snapshots with stateHash
    const aHasHash = a.stateHash ? 1 : 0;
    const bHasHash = b.stateHash ? 1 : 0;
    if (aHasHash !== bHasHash) {
      return bHasHash - aHasHash;
    }

    // Then by height (higher is better)
    return b.height - a.height;
  });

  const best = sorted[0];
  return best;
}

/**
 * Verify and save remote snapshot to local storage
 * 
 * This function:
 * 1. Verifies the snapshot's stateHash (if present)
 * 2. Decompresses the snapshot data
 * 3. Saves it to localStorage as if it were a local snapshot
 * 
 * @param snapshotData Remote snapshot data
 * @param storage Chain storage (for blockHash verification)
 * @returns true if successful, false otherwise
 */
export async function verifyAndSaveRemoteSnapshot(
  snapshotData: SnapshotData,
  storage: any
): Promise<boolean> {
  try {
    const { meta } = snapshotData;

    // Verify blockHash matches actual block (if available)
    // Phase 15: Also verify stateCommitment
    const block = storage.getBlockByHeight(meta.height);
    if (block && block.hash !== meta.blockHash) {
      return false;
    }

    // Phase 15: Verify stateCommitment matches block (if block available)
    if (block && block.header.stateCommitment) {
      if (meta.stateCommitment && meta.stateCommitment !== block.header.stateCommitment) {
        return false;
      }
      // If snapshot doesn't have stateCommitment, set it from block
      if (!meta.stateCommitment) {
        meta.stateCommitment = block.header.stateCommitment;
      }
    }

    // Verify stateHash if present (Phase 13)
    if (meta.stateHash) {
      // For full snapshots, verify directly
      if (snapshotData.full === true && snapshotData.compressed && snapshotData.data) {
        try {
          const decompressed = await decompressSnapshot(snapshotData.data);
          const computedHash = await computeSnapshotStateHash(decompressed);
          
          if (computedHash !== meta.stateHash) {
            return false;
          }

          // Phase 15: Verify stateCommitment matches stateHash
          if (meta.stateCommitment && computedHash !== meta.stateCommitment) {
            return false;
          }

          // Hash matches, save the decompressed state
          snapshotData.indexState = decompressed;
        } catch (error) {
          return false;
        }
      } else if (snapshotData.full === false && snapshotData.delta) {
        // For delta snapshots, need to reconstruct full state first
        // This is more complex, for now we'll skip hash verification for delta snapshots
        // or reconstruct them
      }

      // Use existing verification function
      const isValid = await verifySnapshotIntegrity(snapshotData);
      if (!isValid) {
        return false;
      }
    }

    // Save to local storage (reuse existing saveSnapshot logic)
    // For full snapshots, we can save directly
    if (snapshotData.full === true && snapshotData.indexState) {
      // Save as local snapshot using existing saveSnapshot function
      // This will also compute and save stateHash if not already present
      await saveSnapshot(
        meta.height,
        meta.blockHash,
        snapshotData.indexState,
        undefined,
        true
      );
      return true;
    } else if (snapshotData.compressed && snapshotData.data) {
      // For compressed-only data (without indexState), save directly to localStorage
      // and update metadata list
      if (typeof localStorage !== "undefined") {
        const key = `indexerchain_snapshot_v1_${meta.height}`;
        localStorage.setItem(key, JSON.stringify(snapshotData));
        
        // Update metadata list
        const allMetas = loadAllSnapshotMeta();
        const filtered = allMetas.filter((m) => m.height !== meta.height);
        filtered.push(meta);
        saveAllSnapshotMeta(filtered);
        
        return true;
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Attempt to sync from remote snapshot sources
 * 
 * This function:
 * 1. Fetches snapshot lists from all configured remote sources
 * 2. Chooses the best snapshot
 * 3. Downloads and verifies it
 * 4. Saves it locally
 * 
 * @param params Chain parameters
 * @param storage Chain storage (for blockHash verification)
 * @returns Snapshot metadata if successful, null otherwise
 */
export async function syncFromRemoteSnapshot(
  params: ChainParams,
  storage: any
): Promise<SnapshotMeta | null> {
  if (!params.remoteSnapshotEnabled || !params.remoteSnapshotEndpoints || params.remoteSnapshotEndpoints.length === 0) {
    return null;
  }


  // Create sources from endpoints
  const sources: RemoteSnapshotSource[] = params.remoteSnapshotEndpoints.map((url, index) => ({
    baseUrl: url.replace(/\/$/, ""), // Remove trailing slash
    priority: index,
  }));

  // Try each source in priority order
  for (const source of sources) {
    try {
      // Fetch snapshot list
      const metas = await fetchRemoteSnapshotList(source);
      if (metas.length === 0) {
        continue;
      }

      // Choose best snapshot
      const bestMeta = chooseBestRemoteSnapshot(metas, params);
      if (!bestMeta) {
        continue;
      }

      // Fetch snapshot data
      const snapshotData = await fetchRemoteSnapshotData(source, bestMeta.id);
      if (!snapshotData) {
        continue;
      }

      // Verify and save
      const success = await verifyAndSaveRemoteSnapshot(snapshotData, storage);
      if (success) {
        return bestMeta;
      } else {
        continue;
      }
    } catch (error) {
      continue;
    }
  }

  return null;
}

