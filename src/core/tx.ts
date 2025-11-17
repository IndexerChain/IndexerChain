/**
 * Transaction utilities
 * 
 * Phase 5: Updated with signature and identity support
 * 
 * Functions:
 * - computeTxId: Compute transaction ID from transaction data (excluding signature)
 * - createTx: Create a new signed transaction
 */

import type { Tx, Operation, Address } from "./types.js";
import { sha256 } from "./crypto.js";
import {
  getOrCreateNodeKeyPair,
  getOrCreateNodeAddress,
  serializePublicKey,
} from "./keys.js";
import { signTx } from "./signatures.js";
import { encodeTxForSigning } from "./txCodec.js";

/**
 * Compute transaction ID
 * Hash of the transaction content (excluding txId and signature)
 * 
 * Phase 5: Uses canonical encoding for consistency
 * 
 * @param txWithoutId Transaction without txId and signature
 * @returns Transaction ID (hex string)
 */
export async function computeTxId(
  txWithoutId: Omit<Tx, "txId" | "signature">
): Promise<string> {
  // Use canonical encoding for consistency
  const encoded = encodeTxForSigning(txWithoutId);

  // Compute SHA-256 hash
  return await sha256(encoded);
}

/**
 * Create a transfer transaction
 * 
 * Phase 7: Helper function to create a TRANSFER operation transaction
 * 
 * @param to Recipient address
 * @param amount Amount to transfer in IDC
 * @returns New signed transfer transaction
 */
export async function createTransferTx(to: Address, amount: number): Promise<Tx> {
  const op: Operation = {
    type: "TRANSFER",
    namespace: "", // Not used for TRANSFER
    key: "", // Not used for TRANSFER
    to,
    amount,
    nonce: Date.now(),
    owner: "", // Will be set by createTx
  };

  return await createTx([op]);
}

/**
 * Create a new signed transaction
 * 
 * Phase 5: Automatically signs the transaction with node's private key
 * 
 * @param ops Array of operations
 * @returns New signed transaction with computed txId
 */
export async function createTx(ops: Operation[]): Promise<Tx> {
  // Get node identity
  const keyPair = await getOrCreateNodeKeyPair();
  const address = await getOrCreateNodeAddress();

  const timestamp = Date.now();

  // Create base transaction (without id and signature)
  const baseTx: Omit<Tx, "txId" | "signature"> = {
    owner: address, // Legacy field, equals ownerAddress
    ownerAddress: address,
    ownerPubKey: serializePublicKey(keyPair.publicKey),
    ops,
    timestamp,
  };

  // Sign the transaction
  const signature = await signTx(baseTx, keyPair.privateKey);

  // Compute txId (from content, excluding signature)
  const txId = await computeTxId(baseTx);

  // Return complete transaction
  return {
    ...baseTx,
    txId,
    signature,
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

