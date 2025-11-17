/**
 * Signature Utilities
 * 
 * Phase 5: ECDSA signature creation and verification for transactions
 */

import type { Tx } from "./types.js";
import { encodeTxForSigning } from "./txCodec.js";

/**
 * Convert ArrayBuffer to base64 string
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Sign a transaction
 * 
 * Signs the transaction (excluding id and signature fields) using ECDSA P-256
 * 
 * @param tx Transaction without id and signature
 * @param privateKey Private key as CryptoKey
 * @returns Base64-encoded signature
 */
export async function signTx(
  tx: Omit<Tx, "txId" | "signature">,
  privateKey: CryptoKey
): Promise<string> {
  // Encode transaction for signing
  const data = encodeTxForSigning(tx);

  // Sign with ECDSA
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    privateKey,
    data.buffer as ArrayBuffer
  );

  // Return as base64 string
  return bufferToBase64(signature);
}

/**
 * Verify transaction signature
 * 
 * Verifies that the transaction signature is valid for the given public key
 * 
 * @param tx Transaction with signature
 * @returns true if signature is valid, false otherwise
 */
export async function verifyTxSignature(tx: Tx): Promise<boolean> {
  try {
    // Extract signature and reconstruct tx without id and signature
    const { txId, signature, ...rest } = tx;

    // Encode transaction for verification
    const data = encodeTxForSigning(rest as Omit<Tx, "txId" | "signature">);

    // Import public key from JWK
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      tx.ownerPubKey.jwk,
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["verify"]
    );

    // Convert signature from base64 to ArrayBuffer
    const sigBytes = base64ToBuffer(signature);

    // Verify signature
    return await crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: "SHA-256",
      },
      publicKey,
      sigBytes,
      data.buffer as ArrayBuffer
    );
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

