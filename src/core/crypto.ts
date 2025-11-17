/**
 * Cryptographic utilities using Web Crypto API
 * 
 * Functions:
 * - sha256: Compute SHA-256 hash
 * - hashBlockHeader: Compute block header hash
 */

import type { BlockHeader } from "./types.js";

/**
 * Compute SHA-256 hash using Web Crypto API
 * @param data String or Uint8Array to hash
 * @returns Hex string of the hash
 */
export async function sha256(data: string | Uint8Array): Promise<string> {
  // Convert string to Uint8Array if needed
  let bytes: Uint8Array;
  if (typeof data === "string") {
    bytes = new TextEncoder().encode(data);
  } else {
    bytes = data;
  }

  // Use Web Crypto API
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer as ArrayBuffer
  );
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex;
}

/**
 * Compute block header hash
 * Serializes the header (excluding nonce for PoW, but including it in hash calculation)
 * and computes SHA-256 hash
 * 
 * @param header Block header
 * @returns Hex string of the block hash
 */
export async function hashBlockHeader(
  header: Omit<BlockHeader, "nonce"> & { nonce?: number }
): Promise<string> {
  // Serialize header deterministically
  // Format: version|height|prevHash|merkleRoot|timestamp|difficulty|nonce
  const parts = [
    header.version.toString(),
    header.height.toString(),
    header.prevHash,
    header.merkleRoot,
    header.timestamp.toString(),
    header.difficulty.toString(),
    (header.nonce ?? 0).toString(),
  ];

  const serialized = parts.join("|");
  return await sha256(serialized);
}

