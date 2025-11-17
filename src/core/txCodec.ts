/**
 * Transaction Encoding
 * 
 * Phase 5: Canonical encoding for transaction signing and hashing
 * 
 * Ensures all nodes use the same encoding format to avoid JSON ordering issues
 */

import type { Tx, Operation } from "./types.js";

/**
 * Encode transaction for signing/hashing
 * 
 * Creates a canonical representation of the transaction (excluding id and signature)
 * Uses fixed field order to ensure consistency across all nodes
 * 
 * @param tx Transaction without id and signature
 * @returns Encoded transaction as Uint8Array
 */
export function encodeTxForSigning(
  tx: Omit<Tx, "txId" | "signature">
): Uint8Array {
  // Create a canonical object with fixed field order
  const canonical = {
    owner: tx.owner,
    ownerAddress: tx.ownerAddress,
    ownerPubKey: tx.ownerPubKey,
    timestamp: tx.timestamp,
    ops: tx.ops.map((op) => ({
      type: op.type,
      namespace: op.namespace,
      key: op.key,
      value: op.value ?? "",
      nonce: op.nonce,
      owner: op.owner,
    })),
  };

  // Convert to JSON string (ensures consistent ordering)
  const jsonString = JSON.stringify(canonical);

  // Encode as UTF-8 bytes
  return new TextEncoder().encode(jsonString);
}

/**
 * Encode operation for hashing (if needed separately)
 */
export function encodeOperationForSigning(op: Operation): Uint8Array {
  const canonical = {
    type: op.type,
    namespace: op.namespace,
    key: op.key,
    value: op.value ?? "",
    nonce: op.nonce,
    owner: op.owner,
  };

  const jsonString = JSON.stringify(canonical);
  return new TextEncoder().encode(jsonString);
}

