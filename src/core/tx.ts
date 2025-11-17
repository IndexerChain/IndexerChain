/**
 * Transaction utilities
 * 
 * Functions:
 * - computeTxId: Compute transaction ID from transaction data
 * - createTx: Create a new transaction
 */

import type { Tx, Operation } from "./types.js";
import { sha256 } from "./crypto.js";

/**
 * Compute transaction ID
 * Hash of the transaction without txId field
 * 
 * @param txWithoutId Transaction without txId
 * @returns Transaction ID (hex string)
 */
export async function computeTxId(
  txWithoutId: Omit<Tx, "txId">
): Promise<string> {
  // Serialize transaction deterministically (without txId)
  const serialized = JSON.stringify({
    ops: txWithoutId.ops,
    timestamp: txWithoutId.timestamp,
  });

  // Compute SHA-256 hash
  return await sha256(serialized);
}

/**
 * Create a new transaction
 * 
 * @param owner Owner address (browser node ID)
 * @param ops Array of operations
 * @returns New transaction with computed txId
 */
export async function createTx(
  _owner: string,
  ops: Operation[]
): Promise<Tx> {
  const timestamp = Date.now();

  // Create transaction without txId
  const txWithoutId: Omit<Tx, "txId"> = {
    ops,
    timestamp,
  };

  // Compute txId
  const txId = await computeTxId(txWithoutId);

  return {
    txId,
    ops,
    timestamp,
  };
}

/**
 * Generate a simple browser node ID
 * For Phase 3, we use a random string stored in localStorage
 * 
 * @returns Browser node ID
 */
export function getOrCreateBrowserNodeId(): string {
  const STORAGE_KEY = "indexerchain_nodeid_v1";

  if (typeof localStorage === "undefined") {
    // Fallback for non-browser environment
    return `node_${Math.random().toString(36).substring(2, 15)}`;
  }

  let nodeId = localStorage.getItem(STORAGE_KEY);
  if (!nodeId) {
    // Generate new node ID
    nodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(STORAGE_KEY, nodeId);
  }

  return nodeId;
}

