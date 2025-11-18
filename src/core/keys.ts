/**
 * Key Management
 * 
 * Phase 5: Generate, store, and manage node identity (key pairs and addresses)
 * Phase 24: Integrated with MultiWalletStore for multi-account support
 * 
 * Uses WebCrypto API with ECDSA P-256 for key generation and signing
 */

import { sha256 } from "./crypto.js";
import type { KeyPair, Address, SerializedPublicKey } from "./types.js";
import { getMultiWalletStore } from "./multiWallet.js";

/**
 * Storage keys for localStorage (legacy, for backward compatibility)
 */
const STORAGE_KEY_PUBKEY = "indexerchain_node_pubkey_v1";
const STORAGE_KEY_PRIVKEY = "indexerchain_node_privkey_v1";

/**
 * Get or create node key pair
 * 
 * Phase 24: Uses MultiWalletStore to get current wallet's key pair
 * Falls back to legacy storage for backward compatibility
 * 
 * @returns Key pair with public key as JWK and private key as CryptoKey
 */
export async function getOrCreateNodeKeyPair(): Promise<KeyPair> {
  // Phase 24: Try MultiWalletStore first
  const walletStore = getMultiWalletStore();
  const currentKeyPair = await walletStore.getCurrentKeyPair();
  if (currentKeyPair) {
    return currentKeyPair;
  }

  // Fallback to legacy storage (for backward compatibility)
  if (typeof localStorage !== "undefined") {
    const storedPubKey = localStorage.getItem(STORAGE_KEY_PUBKEY);
    const storedPrivKey = localStorage.getItem(STORAGE_KEY_PRIVKEY);

    if (storedPubKey && storedPrivKey) {
      try {
        const publicKeyJwk = JSON.parse(storedPubKey) as JsonWebKey;
        const privateKeyJwk = JSON.parse(storedPrivKey) as JsonWebKey;

        // Import private key (public key is already in JWK format)
        const privateKey = await crypto.subtle.importKey(
          "jwk",
          privateKeyJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["sign"]
        );

        return {
          publicKey: publicKeyJwk,
          privateKey,
        };
      } catch (error) {
        console.warn("Failed to load keys from storage, generating new ones:", error);
        // Fall through to generate new keys
      }
    }
  }

  // Generate new key pair and create wallet
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true, // extractable
    ["sign", "verify"]
  );

  // Export keys to JWK format
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  // Phase 24: Create wallet in MultiWalletStore
  const wallet = await walletStore.createWallet("Main Wallet");
  
  // Store private key in wallet store (access internal keyPairs map)
  const walletId = wallet.id;
  const walletStoreInternal = walletStore as any;
  if (walletStoreInternal.keyPairs) {
    walletStoreInternal.keyPairs.set(walletId, keyPair.privateKey);
  }

  // Also store in legacy format for backward compatibility
  if (typeof localStorage !== "undefined") {
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    localStorage.setItem(STORAGE_KEY_PUBKEY, JSON.stringify(publicKeyJwk));
    localStorage.setItem(STORAGE_KEY_PRIVKEY, JSON.stringify(privateKeyJwk));
  }

  return {
    publicKey: publicKeyJwk,
    privateKey: keyPair.privateKey,
  };
}

/**
 * Deterministic JSON serialization for JWK
 * Ensures consistent key ordering across all browsers
 * 
 * For ECDSA P-256 keys, we use: kty, crv, x, y (and optionally alg, use, key_ops, ext)
 * This ensures the same public key always produces the same address
 */
function serializeJwkDeterministic(jwk: JsonWebKey): string {
  // Create a new object with fields in a fixed, canonical order
  // This ensures JSON.stringify produces the same string across all browsers
  // IMPORTANT: Only include fields that are relevant for address calculation
  // For ECDSA P-256, we only need: kty, crv, x, y
  // Other fields (alg, use, key_ops, ext, kid) are ignored for address calculation
  // to ensure consistency even if they differ between export and import
  const ordered: Record<string, any> = {};
  
  // Core ECDSA P-256 fields (MUST be present and in this order)
  if (jwk.kty) ordered.kty = jwk.kty;
  if (jwk.crv) ordered.crv = jwk.crv;
  if (jwk.x) ordered.x = jwk.x;
  if (jwk.y) ordered.y = jwk.y;
  
  // Note: We intentionally exclude optional fields (alg, use, key_ops, ext, kid)
  // to ensure address calculation is consistent regardless of these metadata fields
  
  return JSON.stringify(ordered);
}

/**
 * Get node address from public key
 * 
 * Derives a human-readable address from a public key JWK:
 * 1. Deterministic JSON serialization (ensures consistent key ordering)
 * 2. SHA-256 hash
 * 3. Take first 20 bytes (40 hex characters)
 * 4. Prefix with "idc_"
 * 
 * IMPORTANT: Uses deterministic serialization to ensure the same public key
 * always produces the same address across all browsers and platforms.
 * 
 * @param pubKey Public key as JsonWebKey
 * @returns Address string (e.g., "idc_a3f92b...")
 */
export async function getNodeAddressFromPublicKey(pubKey: JsonWebKey): Promise<Address> {
  // Use deterministic serialization to ensure consistent address across browsers
  const serialized = serializeJwkDeterministic(pubKey);

  // Hash with SHA-256
  const hash = await sha256(serialized);

  // Take first 40 hex characters (20 bytes)
  const addressHex = hash.substring(0, 40);

  // Prefix with "idc_"
  return `idc_${addressHex}`;
}

/**
 * Get or create node address
 * 
 * Phase 24: Uses MultiWalletStore to get current wallet's address
 * 
 * @returns Node address
 */
export async function getOrCreateNodeAddress(): Promise<Address> {
  // Phase 24: Try MultiWalletStore first
  const walletStore = getMultiWalletStore();
  const currentWallet = walletStore.getCurrentWallet();
  if (currentWallet) {
    return currentWallet.address;
  }

  // Fallback to legacy method
  const keyPair = await getOrCreateNodeKeyPair();
  return await getNodeAddressFromPublicKey(keyPair.publicKey);
}

/**
 * Get serialized public key for transmission
 * 
 * @param pubKey Public key as JsonWebKey
 * @returns Serialized public key
 */
export function serializePublicKey(pubKey: JsonWebKey): SerializedPublicKey {
  return {
    alg: "ECDSA_P256",
    format: "jwk",
    jwk: pubKey,
  };
}

/**
 * Clear stored keys (for testing/reset)
 */
export function clearStoredKeys(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY_PUBKEY);
    localStorage.removeItem(STORAGE_KEY_PRIVKEY);
  }
}

