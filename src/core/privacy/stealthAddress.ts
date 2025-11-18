/**
 * Stealth Address System
 * 
 * Phase 27: Implements one-time addresses for privacy
 * 
 * Based on Monero-style stealth addresses:
 * - Each transaction uses a unique one-time address
 * - External observers cannot link transactions to the same recipient
 */

import { sha256 } from "../crypto.js";
import type { StealthAddress, StealthKeys } from "./types.js";

/**
 * Generate a stealth address for a recipient
 * 
 * Algorithm:
 * 1. Sender generates random ephemeral key pair (r, R = r * G)
 * 2. One-time public key: P = H(r * V) * G + S
 *    where V = recipient's public view key, S = recipient's public spend key
 * 3. Recipient can derive: P' = H(v * R) * G + s
 *    where v = recipient's private view key, s = recipient's private spend key
 * 
 * @param recipientPubView Recipient's public view key (JWK)
 * @param recipientPubSpend Recipient's public spend key (JWK)
 * @returns Stealth address with one-time public key and ephemeral public key
 */
export async function generateStealthAddress(
  recipientPubView: JsonWebKey,
  recipientPubSpend: JsonWebKey
): Promise<StealthAddress> {
  // Generate ephemeral key pair (r, R)
  // For simplicity, we use a random 32-byte value as the ephemeral private key
  const ephemeralPrivate = crypto.getRandomValues(new Uint8Array(32));
  
  // Derive ephemeral public key R = r * G
  // Note: In a full implementation, this would use elliptic curve point multiplication
  // For Phase 27, we use a simplified approach with hash-based derivation
  const ephemeralPub = await sha256(ephemeralPrivate);
  
  // Compute shared secret: H(r * V) = H(sha256(ephemeralPrivate + recipientPubView))
  const viewKeyBytes = new TextEncoder().encode(JSON.stringify(recipientPubView));
  const sharedSecretInput = new Uint8Array(ephemeralPrivate.length + viewKeyBytes.length);
  sharedSecretInput.set(ephemeralPrivate);
  sharedSecretInput.set(viewKeyBytes, ephemeralPrivate.length);
  const sharedSecret = await sha256(sharedSecretInput);
  
  // Derive one-time public key: P = H(sharedSecret) * G + S
  // Simplified: P = sha256(sharedSecret + recipientPubSpend)
  const oneTimeInput = `${sharedSecret}${JSON.stringify(recipientPubSpend)}`;
  const oneTimeHash = await sha256(oneTimeInput);
  const oneTimePublic = `idc_${oneTimeHash.substring(0, 40)}`; // Format as Address
  
  return {
    oneTimePublic,
    ephemeralPub,
    payload: undefined, // Optional encrypted memo (Phase Z2)
  };
}

/**
 * Check if a stealth address belongs to this wallet
 * 
 * Recipient scans incoming transactions by:
 * 1. For each transaction, compute P' = H(v * R) * G + s
 * 2. If P' matches the one-time public key, this transaction is for us
 * 
 * @param stealthAddress The stealth address to check
 * @param keys Wallet's stealth keys
 * @returns true if this address belongs to the wallet
 */
export async function checkStealthAddress(
  stealthAddress: StealthAddress,
  keys: StealthKeys
): Promise<boolean> {
  // Import private view key
  const privView = await crypto.subtle.importKey(
    "jwk",
    await crypto.subtle.exportKey("jwk", keys.privView),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    []
  );
  
  // Compute shared secret: H(v * R)
  // Simplified: H(sha256(privView + ephemeralPub))
  const privViewBytes = await crypto.subtle.exportKey("raw", privView);
  const ephemeralPubBytes = new TextEncoder().encode(stealthAddress.ephemeralPub);
  const sharedSecretInput = new Uint8Array(privViewBytes.byteLength + ephemeralPubBytes.length);
  sharedSecretInput.set(new Uint8Array(privViewBytes));
  sharedSecretInput.set(ephemeralPubBytes, privViewBytes.byteLength);
  const sharedSecret = await sha256(sharedSecretInput);
  
  // Derive expected one-time public key
  const pubSpendBytes = new TextEncoder().encode(JSON.stringify(keys.pubSpend));
  const oneTimeInput = new Uint8Array(
    new TextEncoder().encode(sharedSecret).length + pubSpendBytes.length
  );
  oneTimeInput.set(new TextEncoder().encode(sharedSecret));
  oneTimeInput.set(pubSpendBytes, new TextEncoder().encode(sharedSecret).length);
  const expectedOneTime = await sha256(oneTimeInput);
  const expectedAddress = `idc_${expectedOneTime.substring(0, 40)}`;
  
  return stealthAddress.oneTimePublic === expectedAddress;
}

