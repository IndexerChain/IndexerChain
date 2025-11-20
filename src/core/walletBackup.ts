/**
 * Wallet Backup & Recovery
 * 
 * Phase 23: Account Backup & Secure Recovery Layer
 * 
 * Provides secure wallet backup and recovery using PBKDF2 + AES-GCM encryption
 * - Export wallet: Encrypt private key with user password
 * - Import wallet: Decrypt and restore private key
 * - Zero-trust: No server, no centralization, all encryption in browser
 */

import { getOrCreateNodeKeyPair } from "./keys.js";

/**
 * Wallet backup file format
 */
export interface WalletBackup {
  version: number; // Backup format version
  cipher: "AES-GCM"; // Encryption algorithm
  salt: string; // Base64-encoded salt for PBKDF2
  iv: string; // Base64-encoded initialization vector for AES-GCM
  kdf: "pbkdf2"; // Key derivation function
  iterations: number; // PBKDF2 iterations (200k for security)
  encryptedKey: string; // Base64-encoded encrypted private key (JWK)
  createdAt: number; // Unix timestamp in milliseconds
  device?: string; // Device/browser identifier (optional)
}

/**
 * Export wallet to encrypted backup format
 * 
 * Uses PBKDF2 (SHA-256, 200k iterations) to derive encryption key from password,
 * then encrypts the private key JWK using AES-GCM.
 * 
 * @param password User password (will be used for PBKDF2)
 * @returns Base64-encoded JSON string of WalletBackup
 */
export async function exportWallet(password: string): Promise<string> {
  // Validate password strength
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }
  
  // Get current node key pair
  // IMPORTANT: This should always return the current wallet's key pair from MultiWalletStore
  const keyPair = await getOrCreateNodeKeyPair();
  
  // Verify address before export (for debugging)
  const { getNodeAddressFromPublicKey } = await import("./keys.js");
  await getNodeAddressFromPublicKey(keyPair.publicKey);
  
  // Export private key as JWK
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  
  // Generate random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  // Generate random IV (12 bytes for AES-GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // Derive encryption key using PBKDF2
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 200000, // 200k iterations for security
      hash: "SHA-256",
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256, // 256-bit key
    },
    false,
    ["encrypt"]
  );
  
  // Encrypt private key JWK
  const privateKeyJson = JSON.stringify(privateKeyJwk);
  const encryptedData = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    derivedKey,
    new TextEncoder().encode(privateKeyJson)
  );
  
  // Create backup object
  const backup: WalletBackup = {
    version: 1,
    cipher: "AES-GCM",
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
    kdf: "pbkdf2",
    iterations: 200000,
    encryptedKey: btoa(String.fromCharCode(...new Uint8Array(encryptedData))),
    createdAt: Date.now(),
    device: typeof navigator !== "undefined" 
      ? `${navigator.userAgent.split(" ")[0]}-${navigator.platform}` 
      : undefined,
  };
  
  // Return as JSON string
  return JSON.stringify(backup, null, 2);
}

/**
 * Import wallet from encrypted backup
 * 
 * Decrypts the backup file using the provided password and restores
 * the private key to localStorage.
 * 
 * @param password User password
 * @param backupData JSON string of WalletBackup
 * @returns true if successful
 */
export async function importWallet(password: string, backupData: string): Promise<boolean> {
  try {
    // Parse backup data
    const backup: WalletBackup = JSON.parse(backupData);
    
    // Validate backup format
    if (backup.version !== 1) {
      throw new Error(`Unsupported backup version: ${backup.version}`);
    }
    if (backup.cipher !== "AES-GCM") {
      throw new Error(`Unsupported cipher: ${backup.cipher}`);
    }
    if (backup.kdf !== "pbkdf2") {
      throw new Error(`Unsupported KDF: ${backup.kdf}`);
    }
    
    // Decode salt and IV
    const salt = Uint8Array.from(atob(backup.salt), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(backup.iv), c => c.charCodeAt(0));
    const encryptedKey = Uint8Array.from(atob(backup.encryptedKey), c => c.charCodeAt(0));
    
    // Derive decryption key using PBKDF2
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );
    
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: backup.iterations,
        hash: "SHA-256",
      },
      passwordKey,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["decrypt"]
    );
    
    // Decrypt private key
    const decryptedData = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      derivedKey,
      encryptedKey
    );
    
    // Parse decrypted JWK
    const privateKeyJson = new TextDecoder().decode(decryptedData);
    const privateKeyJwk = JSON.parse(privateKeyJson) as JsonWebKey;
    
    // Validate JWK structure
    if (!privateKeyJwk.kty || !privateKeyJwk.crv || !privateKeyJwk.d) {
      throw new Error("Invalid private key format in backup");
    }
    
    // Validate private key structure (import to verify it's valid)
    await crypto.subtle.importKey(
      "jwk",
      privateKeyJwk,
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["sign"]
    );
    
    // Get public key from private key
    // IMPORTANT: Only include core fields (kty, crv, x, y) for address calculation consistency
    // Optional fields (alg, use, key_ops, ext) are ignored in address calculation
    const publicKeyJwk: JsonWebKey = {
      kty: privateKeyJwk.kty,
      crv: privateKeyJwk.crv,
      x: privateKeyJwk.x,
      y: privateKeyJwk.y,
    };
    
    // Copy optional fields for storage (but they won't affect address calculation)
    if (privateKeyJwk.alg) publicKeyJwk.alg = privateKeyJwk.alg;
    if (privateKeyJwk.use) publicKeyJwk.use = privateKeyJwk.use;
    if (privateKeyJwk.key_ops) publicKeyJwk.key_ops = privateKeyJwk.key_ops;
    if (privateKeyJwk.ext !== undefined) publicKeyJwk.ext = privateKeyJwk.ext;
    
    // Verify address calculation (for debugging)
    const { getNodeAddressFromPublicKey } = await import("./keys.js");
    await getNodeAddressFromPublicKey(publicKeyJwk);
    
    // Store keys in localStorage
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("indexerchain_node_pubkey_v1", JSON.stringify(publicKeyJwk));
      localStorage.setItem("indexerchain_node_privkey_v1", JSON.stringify(privateKeyJwk));
    }
    
    return true;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("decrypt") || error.message.includes("password")) {
        throw new Error("Incorrect password or corrupted backup file");
      }
      throw error;
    }
    throw new Error("Failed to import wallet");
  }
}

/**
 * Validate password strength
 * 
 * @param password Password to validate
 * @returns Object with isValid and message
 */
export function validatePassword(password: string): { isValid: boolean; message: string } {
  if (password.length < 8) {
    return {
      isValid: false,
      message: "Password must be at least 8 characters long",
    };
  }
  
  if (password.length > 128) {
    return {
      isValid: false,
      message: "Password is too long (max 128 characters)",
    };
  }
  
  // Check for common weak passwords (simplified check)
  const commonPasswords = [
    "password", "12345678", "password123", "qwerty123", "admin123",
    "letmein", "welcome", "monkey", "1234567890", "password1",
  ];
  
  const lowerPassword = password.toLowerCase();
  if (commonPasswords.some(common => lowerPassword.includes(common))) {
    return {
      isValid: false,
      message: "Password is too common. Please use a stronger password.",
    };
  }
  
  // Check for basic complexity (at least one letter and one number)
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  
  if (!hasLetter || !hasNumber) {
    return {
      isValid: true, // Still valid, but suggest improvement
      message: "Consider using a mix of letters, numbers, and special characters for better security",
    };
  }
  
  return {
    isValid: true,
    message: "Password strength: Good",
  };
}

/**
 * Download backup file
 * 
 * @param backupData JSON string of WalletBackup
 * @param filename Optional filename (default: "indexerchain-wallet-backup.idcbackup")
 */
export function downloadBackupFile(backupData: string, filename?: string): void {
  const blob = new Blob([backupData], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `indexerchain-wallet-backup-${Date.now()}.idcbackup`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read backup file from file input
 * 
 * @param file File object from input element
 * @returns Promise resolving to file content as string
 */
export function readBackupFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result && typeof e.target.result === "string") {
        resolve(e.target.result);
      } else {
        reject(new Error("Failed to read backup file"));
      }
    };
    reader.onerror = () => {
      reject(new Error("Failed to read backup file"));
    };
    reader.readAsText(file);
  });
}

