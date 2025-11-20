/**
 * Multi-Wallet Store
 * 
 * Phase 24: Multi-Account Architecture
 * 
 * Manages multiple wallet identities in a single browser node
 * - Create/delete wallets
 * - Switch active wallet
 * - Separate mining wallet from transaction wallet
 * - Import/export individual wallets
 */

import type { Address, KeyPair } from "./types.js";
import { getNodeAddressFromPublicKey } from "./keys.js";
import { exportWallet, importWallet } from "./walletBackup.js";

/**
 * Wallet information
 */
export interface Wallet {
  id: string; // Unique wallet ID (e.g., "wallet_01")
  name: string; // User-friendly name
  address: Address;
  publicKey: JsonWebKey;
  createdAt: number; // Unix timestamp in milliseconds
  isEncrypted?: boolean; // Whether private key is encrypted (future Phase 25)
}

/**
 * Multi-wallet storage structure
 */
interface MultiWalletStorage {
  currentId: string | null; // Currently active wallet ID
  miningId: string | null; // Wallet ID used for mining (can be different from current)
  list: Record<string, WalletInfo>;
}

interface WalletInfo {
  name: string;
  address: Address;
  publicKey: JsonWebKey;
  encryptedPrivateKey?: string; // Encrypted private key (future Phase 25)
  createdAt: number;
}

const STORAGE_KEY = "indexerchain_wallets_v1";
const STORAGE_KEY_LEGACY_PUBKEY = "indexerchain_node_pubkey_v1";
const STORAGE_KEY_LEGACY_PRIVKEY = "indexerchain_node_privkey_v1";

/**
 * Multi-Wallet Store
 * 
 * Manages multiple wallet identities
 */
export class MultiWalletStore {
  private storage: MultiWalletStorage;
  private keyPairs: Map<string, CryptoKey> = new Map(); // In-memory private keys

  constructor() {
    this.storage = this.loadFromStorage();
    this.migrateLegacyWallet();
  }

  /**
   * Load wallets from localStorage
   */
  private loadFromStorage(): MultiWalletStorage {
    if (typeof localStorage === "undefined") {
      return { currentId: null, miningId: null, list: {} };
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { currentId: null, miningId: null, list: {} };
    }

    try {
      return JSON.parse(raw) as MultiWalletStorage;
    } catch {
      return { currentId: null, miningId: null, list: {} };
    }
  }

  /**
   * Save wallets to localStorage
   */
  private saveToStorage(): void {
    if (typeof localStorage === "undefined") return;

    // Remove private keys from storage (only keep metadata)
    const storageData: MultiWalletStorage = {
      currentId: this.storage.currentId,
      miningId: this.storage.miningId,
      list: {},
    };

    for (const [id, info] of Object.entries(this.storage.list)) {
      storageData.list[id] = {
        name: info.name,
        address: info.address,
        publicKey: info.publicKey,
        createdAt: info.createdAt,
        // Don't store encryptedPrivateKey in localStorage (future Phase 25)
      };
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(storageData));
  }

  /**
   * Migrate legacy single wallet to multi-wallet structure
   */
  private async migrateLegacyWallet(): Promise<void> {
    if (typeof localStorage === "undefined") return;
    if (this.storage.currentId) return; // Already migrated

    // Check for legacy keys
    const legacyPubKey = localStorage.getItem(STORAGE_KEY_LEGACY_PUBKEY);
    const legacyPrivKey = localStorage.getItem(STORAGE_KEY_LEGACY_PRIVKEY);

    if (legacyPubKey && legacyPrivKey) {
      try {
        const publicKeyJwk = JSON.parse(legacyPubKey) as JsonWebKey;
        const privateKeyJwk = JSON.parse(legacyPrivKey) as JsonWebKey;

        // Import private key
        const privateKey = await crypto.subtle.importKey(
          "jwk",
          privateKeyJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["sign"]
        );

        // Get address
        const address = await getNodeAddressFromPublicKey(publicKeyJwk);

        // Create wallet from legacy
        const walletId = "wallet_01";
        this.storage.list[walletId] = {
          name: "Main Wallet",
          address,
          publicKey: publicKeyJwk,
          createdAt: Date.now(),
        };
        this.storage.currentId = walletId;
        this.storage.miningId = walletId; // Default mining wallet
        this.keyPairs.set(walletId, privateKey);

        this.saveToStorage();
      } catch (error) {
      }
    }
  }

  /**
   * Create a new wallet
   */
  async createWallet(name: string): Promise<Wallet> {
    // Generate new key pair
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["sign", "verify"]
    );

    // Export keys
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const address = await getNodeAddressFromPublicKey(publicKeyJwk);

    // Generate wallet ID
    const walletId = `wallet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Store wallet
    this.storage.list[walletId] = {
      name: name || `Wallet ${Object.keys(this.storage.list).length + 1}`,
      address,
      publicKey: publicKeyJwk,
      createdAt: Date.now(),
    };

    // Store private key in memory
    this.keyPairs.set(walletId, keyPair.privateKey);

    // Set as current if this is the first wallet
    if (!this.storage.currentId) {
      this.storage.currentId = walletId;
      this.storage.miningId = walletId;
    }

    this.saveToStorage();

    return {
      id: walletId,
      name: this.storage.list[walletId].name,
      address,
      publicKey: publicKeyJwk,
      createdAt: this.storage.list[walletId].createdAt,
    };
  }

  /**
   * Delete a wallet
   */
  deleteWallet(id: string): boolean {
    if (!this.storage.list[id]) {
      return false;
    }

    // Don't allow deleting the last wallet
    if (Object.keys(this.storage.list).length === 1) {
      throw new Error("Cannot delete the last wallet");
    }

    // Remove from storage
    delete this.storage.list[id];
    this.keyPairs.delete(id);

    // Update current/mining IDs if needed
    if (this.storage.currentId === id) {
      // Switch to first available wallet
      const remainingIds = Object.keys(this.storage.list);
      this.storage.currentId = remainingIds[0] || null;
    }
    if (this.storage.miningId === id) {
      const remainingIds = Object.keys(this.storage.list);
      this.storage.miningId = remainingIds[0] || null;
    }

    this.saveToStorage();
    return true;
  }

  /**
   * Get wallet by ID
   */
  getWallet(id: string): Wallet | null {
    const info = this.storage.list[id];
    if (!info) return null;

    return {
      id,
      name: info.name,
      address: info.address,
      publicKey: info.publicKey,
      createdAt: info.createdAt,
    };
  }

  /**
   * List all wallets
   */
  listWallets(): Wallet[] {
    return Object.entries(this.storage.list).map(([id, info]) => ({
      id,
      name: info.name,
      address: info.address,
      publicKey: info.publicKey,
      createdAt: info.createdAt,
    }));
  }

  /**
   * Set current active wallet
   */
  setCurrentWallet(id: string): void {
    if (!this.storage.list[id]) {
      throw new Error(`Wallet ${id} not found`);
    }
    this.storage.currentId = id;
    this.saveToStorage();
  }

  /**
   * Get current active wallet
   */
  getCurrentWallet(): Wallet | null {
    if (!this.storage.currentId) return null;
    return this.getWallet(this.storage.currentId);
  }

  /**
   * Set mining wallet (can be different from current wallet)
   */
  setMiningWallet(id: string): void {
    if (!this.storage.list[id]) {
      throw new Error(`Wallet ${id} not found`);
    }
    this.storage.miningId = id;
    this.saveToStorage();
  }

  /**
   * Get mining wallet
   */
  getMiningWallet(): Wallet | null {
    if (!this.storage.miningId) {
      // Fallback to current wallet
      return this.getCurrentWallet();
    }
    return this.getWallet(this.storage.miningId);
  }

  /**
   * Get key pair for a wallet
   */
  async getKeyPair(walletId: string): Promise<KeyPair | null> {
    const wallet = this.getWallet(walletId);
    if (!wallet) return null;

    // Check if we have private key in memory
    let privateKey = this.keyPairs.get(walletId);
    if (!privateKey) {
      // Try to load from legacy storage
      // Check if legacy storage has a key pair that matches this wallet's address
      if (typeof localStorage !== "undefined") {
        const legacyPubKey = localStorage.getItem(STORAGE_KEY_LEGACY_PUBKEY);
        const legacyPrivKey = localStorage.getItem(STORAGE_KEY_LEGACY_PRIVKEY);
        
        if (legacyPubKey && legacyPrivKey) {
          try {
            const publicKeyJwk = JSON.parse(legacyPubKey) as JsonWebKey;
            const legacyAddress = await getNodeAddressFromPublicKey(publicKeyJwk);
            
            // If legacy address matches this wallet's address, use legacy keys
            if (legacyAddress === wallet.address) {
              const privateKeyJwk = JSON.parse(legacyPrivKey) as JsonWebKey;
              privateKey = await crypto.subtle.importKey(
                "jwk",
                privateKeyJwk,
                { name: "ECDSA", namedCurve: "P-256" },
                true,
                ["sign"]
              );
              // Store in memory for future use
              this.keyPairs.set(walletId, privateKey);
            }
          } catch (error) {
          }
        }
      }
    }

    if (!privateKey) {
      return null;
    }

    return {
      publicKey: wallet.publicKey,
      privateKey,
    };
  }

  /**
   * Get key pair for current wallet
   */
  async getCurrentKeyPair(): Promise<KeyPair | null> {
    const currentWallet = this.getCurrentWallet();
    if (!currentWallet) return null;
    return this.getKeyPair(currentWallet.id);
  }

  /**
   * Get key pair for mining wallet
   */
  async getMiningKeyPair(): Promise<KeyPair | null> {
    const miningWallet = this.getMiningWallet();
    if (!miningWallet) return null;
    return this.getKeyPair(miningWallet.id);
  }

  /**
   * Rename a wallet
   */
  renameWallet(id: string, newName: string): boolean {
    if (!this.storage.list[id]) {
      return false;
    }
    this.storage.list[id].name = newName;
    this.saveToStorage();
    return true;
  }

  /**
   * Import encrypted wallet (from Phase 23 backup)
   */
  async importEncryptedWallet(
    backupData: string,
    password: string,
    name?: string
  ): Promise<Wallet> {
    // Use Phase 23 import logic
    const success = await importWallet(password, backupData);
    if (!success) {
      throw new Error("Failed to import wallet");
    }

    // Get the imported keys from localStorage (Phase 23 stores them)
    if (typeof localStorage === "undefined") {
      throw new Error("localStorage not available");
    }

    const publicKeyJwk = JSON.parse(localStorage.getItem(STORAGE_KEY_LEGACY_PUBKEY)!) as JsonWebKey;
    const privateKeyJwk = JSON.parse(localStorage.getItem(STORAGE_KEY_LEGACY_PRIVKEY)!) as JsonWebKey;

    // Import private key
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      privateKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"]
    );

    const address = await getNodeAddressFromPublicKey(publicKeyJwk);

    // Check if wallet with this address already exists
    const existingWallet = Object.entries(this.storage.list).find(
      ([_, info]) => info.address === address
    );
    
    if (existingWallet) {
      // Wallet already exists, update it instead of creating a new one
      const [walletId, _] = existingWallet;
      
      // Update wallet info
      this.storage.list[walletId] = {
        ...this.storage.list[walletId],
        name: name || this.storage.list[walletId].name,
        publicKey: publicKeyJwk, // Update public key in case it changed
      };
      
      // Update private key in memory
      this.keyPairs.set(walletId, privateKey);
      
      // Clear legacy keys (they're now in multi-wallet)
      localStorage.removeItem(STORAGE_KEY_LEGACY_PUBKEY);
      localStorage.removeItem(STORAGE_KEY_LEGACY_PRIVKEY);
      
      this.saveToStorage();
      
      return {
        id: walletId,
        name: this.storage.list[walletId].name,
        address,
        publicKey: publicKeyJwk,
        createdAt: this.storage.list[walletId].createdAt,
      };
    }

    // Create new wallet entry
    const walletId = `wallet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.storage.list[walletId] = {
      name: name || `Imported Wallet ${Object.keys(this.storage.list).length + 1}`,
      address,
      publicKey: publicKeyJwk,
      createdAt: Date.now(),
    };

    // Store private key in memory
    this.keyPairs.set(walletId, privateKey);

    // Clear legacy keys (they're now in multi-wallet)
    localStorage.removeItem(STORAGE_KEY_LEGACY_PUBKEY);
    localStorage.removeItem(STORAGE_KEY_LEGACY_PRIVKEY);

    this.saveToStorage();

    return {
      id: walletId,
      name: this.storage.list[walletId].name,
      address,
      publicKey: publicKeyJwk,
      createdAt: this.storage.list[walletId].createdAt,
    };
  }

  /**
   * Export encrypted wallet (using Phase 23 format)
   */
  async exportEncryptedWallet(walletId: string, password: string): Promise<string> {
    const keyPair = await this.getKeyPair(walletId);
    if (!keyPair) {
      throw new Error(`Wallet ${walletId} not found or private key unavailable`);
    }

    // Temporarily set as legacy keys for export
    if (typeof localStorage !== "undefined") {
      const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
      localStorage.setItem(STORAGE_KEY_LEGACY_PUBKEY, JSON.stringify(keyPair.publicKey));
      localStorage.setItem(STORAGE_KEY_LEGACY_PRIVKEY, JSON.stringify(privateKeyJwk));
    }

    try {
      // Use Phase 23 export
      const backupData = await exportWallet(password);

      // Clean up temporary keys
      if (typeof localStorage !== "undefined") {
        // Only remove if they were temporary (check if they match current wallet)
        const currentWallet = this.getCurrentWallet();
        if (currentWallet && currentWallet.id !== walletId) {
          localStorage.removeItem(STORAGE_KEY_LEGACY_PUBKEY);
          localStorage.removeItem(STORAGE_KEY_LEGACY_PRIVKEY);
        }
      }

      return backupData;
    } catch (error) {
      // Clean up on error
      if (typeof localStorage !== "undefined") {
        const currentWallet = this.getCurrentWallet();
        if (currentWallet && currentWallet.id !== walletId) {
          localStorage.removeItem(STORAGE_KEY_LEGACY_PUBKEY);
          localStorage.removeItem(STORAGE_KEY_LEGACY_PRIVKEY);
        }
      }
      throw error;
    }
  }
}

// Global instance
let globalMultiWalletStore: MultiWalletStore | null = null;

/**
 * Get global multi-wallet store instance
 */
export function getMultiWalletStore(): MultiWalletStore {
  if (!globalMultiWalletStore) {
    globalMultiWalletStore = new MultiWalletStore();
  }
  return globalMultiWalletStore;
}

