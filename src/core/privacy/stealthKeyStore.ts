/**
 * Stealth Key Store
 * 
 * Phase 28: Manages stealth keys per wallet
 * 
 * Stores view/spend key pairs for each wallet in localStorage
 */

import type { StealthKeys } from "./types.js";
import { generateStealthKeys } from "./stealthKeys.js";

const STORAGE_KEY = "indexerchain_stealth_keys_v1";

interface StealthKeyStorage {
  [walletId: string]: {
    pubView: JsonWebKey;
    pubSpend: JsonWebKey;
    // Private keys are stored encrypted (handled by wallet backup system)
    // For now, we store them in memory only
  };
}

/**
 * Stealth Key Store for managing privacy keys per wallet
 */
export class StealthKeyStore {
  private storage: StealthKeyStorage = {};
  private inMemoryKeys: Map<string, StealthKeys> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Load stealth keys from localStorage
   */
  private loadFromStorage(): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      this.storage = JSON.parse(raw) as StealthKeyStorage;
    } catch {
      this.storage = {};
    }
  }

  /**
   * Save stealth keys to localStorage
   */
  private saveToStorage(): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.storage));
  }

  /**
   * Get or create stealth keys for a wallet
   * 
   * @param walletId Wallet ID
   * @returns Stealth keys (generates new ones if not exists)
   */
  async getOrCreateStealthKeys(walletId: string): Promise<StealthKeys> {
    // Check if already in memory
    if (this.inMemoryKeys.has(walletId)) {
      return this.inMemoryKeys.get(walletId)!;
    }

    // Check if public keys exist in storage
    if (this.storage[walletId]) {
      // For Phase 28, we need to regenerate private keys
      // In production, these would be decrypted from wallet backup
      // For now, we generate new keys if not in memory
      const keys = await generateStealthKeys();
      this.inMemoryKeys.set(walletId, keys);
      
      // Update storage with new public keys
      this.storage[walletId] = {
        pubView: keys.pubView,
        pubSpend: keys.pubSpend,
      };
      this.saveToStorage();
      
      return keys;
    }

    // Generate new stealth keys
    const keys = await generateStealthKeys();
    this.inMemoryKeys.set(walletId, keys);
    
    // Save public keys to storage
    this.storage[walletId] = {
      pubView: keys.pubView,
      pubSpend: keys.pubSpend,
    };
    this.saveToStorage();
    
    return keys;
  }

  /**
   * Get stealth keys from memory (must be loaded first)
   */
  getStealthKeys(walletId: string): StealthKeys | null {
    return this.inMemoryKeys.get(walletId) || null;
  }

  /**
   * Store stealth keys in memory
   */
  setStealthKeys(walletId: string, keys: StealthKeys): void {
    this.inMemoryKeys.set(walletId, keys);
    
    // Update storage
    this.storage[walletId] = {
      pubView: keys.pubView,
      pubSpend: keys.pubSpend,
    };
    this.saveToStorage();
  }

  /**
   * Get public keys for a wallet (from storage)
   */
  getPublicKeys(walletId: string): { pubView: JsonWebKey; pubSpend: JsonWebKey } | null {
    return this.storage[walletId] || null;
  }

  /**
   * Check if wallet has stealth keys
   */
  hasStealthKeys(walletId: string): boolean {
    return !!this.storage[walletId];
  }

  /**
   * Remove stealth keys for a wallet
   */
  removeStealthKeys(walletId: string): void {
    delete this.storage[walletId];
    this.inMemoryKeys.delete(walletId);
    this.saveToStorage();
  }
}

// Global instance
let globalStealthKeyStore: StealthKeyStore | null = null;

/**
 * Get global stealth key store instance
 */
export function getStealthKeyStore(): StealthKeyStore {
  if (!globalStealthKeyStore) {
    globalStealthKeyStore = new StealthKeyStore();
  }
  return globalStealthKeyStore;
}

