/**
 * Key Management
 * 
 * Phase 5: Generate, store, and manage node identity (key pairs and addresses)
 * 
 * Uses WebCrypto API with ECDSA P-256 for key generation and signing
 */

import { sha256 } from "./crypto.js";
import type { KeyPair, Address, SerializedPublicKey } from "./types.js";

/**
 * Storage keys for localStorage
 */
const STORAGE_KEY_PUBKEY = "indexerchain_node_pubkey_v1";
const STORAGE_KEY_PRIVKEY = "indexerchain_node_privkey_v1";

/**
 * Get or create node key pair
 * 
 * Generates ECDSA P-256 key pair if not exists, otherwise loads from storage
 * 
 * Note: Private key is stored in localStorage as JWK (plaintext for Phase 5).
 * Production environments should encrypt the private key or use WebAuthn/FIDO.
 * 
 * @returns Key pair with public key as JWK and private key as CryptoKey
 */
export async function getOrCreateNodeKeyPair(): Promise<KeyPair> {
  // Try to load from storage
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

  // Generate new key pair
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
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  // Store in localStorage
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY_PUBKEY, JSON.stringify(publicKeyJwk));
    localStorage.setItem(STORAGE_KEY_PRIVKEY, JSON.stringify(privateKeyJwk));
  }

  return {
    publicKey: publicKeyJwk,
    privateKey: keyPair.privateKey,
  };
}

/**
 * Get node address from public key
 * 
 * Derives a human-readable address from a public key JWK:
 * 1. JSON.stringify the JWK
 * 2. SHA-256 hash
 * 3. Take first 20 bytes (40 hex characters)
 * 4. Prefix with "idc_"
 * 
 * @param pubKey Public key as JsonWebKey
 * @returns Address string (e.g., "idc_a3f92b...")
 */
export async function getNodeAddressFromPublicKey(pubKey: JsonWebKey): Promise<Address> {
  // Serialize public key to JSON
  const serialized = JSON.stringify(pubKey);

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
 * Loads public key from storage and derives address, or generates new key pair if needed
 * 
 * @returns Node address
 */
export async function getOrCreateNodeAddress(): Promise<Address> {
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

