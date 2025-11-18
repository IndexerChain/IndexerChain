/**
 * Stealth Keys Management
 * 
 * Phase 27: Generate and manage view/spend key pairs for privacy
 * 
 * Each wallet can optionally have stealth keys for privacy features.
 * If not present, privacy features are disabled for that wallet.
 */

import type { StealthKeys } from "./types.js";

/**
 * Generate stealth keys for a wallet
 * 
 * Creates two key pairs:
 * - View key pair: For scanning incoming transactions
 * - Spend key pair: For spending notes
 * 
 * @returns Stealth keys
 */
export async function generateStealthKeys(): Promise<StealthKeys> {
  // Generate view key pair (ECDSA P-256)
  const viewKeyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true, // extractable
    ["sign", "verify"]
  );

  // Generate spend key pair (ECDSA P-256)
  const spendKeyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true, // extractable
    ["sign", "verify"]
  );

  // Export public keys as JWK
  const pubView = await crypto.subtle.exportKey("jwk", viewKeyPair.publicKey);
  const pubSpend = await crypto.subtle.exportKey("jwk", spendKeyPair.publicKey);

  return {
    privView: viewKeyPair.privateKey,
    pubView,
    privSpend: spendKeyPair.privateKey,
    pubSpend,
  };
}

/**
 * Serialize stealth keys for storage
 * 
 * Note: Private keys are stored encrypted (handled by wallet backup system)
 * 
 * @param keys Stealth keys to serialize
 * @returns Serialized keys (public keys only, private keys must be handled separately)
 */
export async function serializeStealthKeys(keys: StealthKeys): Promise<{
  pubView: JsonWebKey;
  pubSpend: JsonWebKey;
}> {
  return {
    pubView: keys.pubView,
    pubSpend: keys.pubSpend,
  };
}

/**
 * Check if a wallet has stealth keys
 * 
 * @param pubView Public view key (optional)
 * @param pubSpend Public spend key (optional)
 * @returns true if both keys are present
 */
export function hasStealthKeys(
  pubView?: JsonWebKey,
  pubSpend?: JsonWebKey
): boolean {
  return !!(pubView && pubSpend);
}

