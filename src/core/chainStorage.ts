/**
 * Chain Storage Layer
 * 
 * Provides storage interface for blocks with localStorage persistence
 */

import type { Block } from "./types.js";

/**
 * ChainStorage interface
 */
export interface ChainStorage {
  /** Returns the latest block (tip) of the chain, or null if chain is empty */
  getTip(): Block | null;

  /** Get block by height (0 = genesis block) */
  getBlockByHeight(height: number): Block | null;

  /** Get block by hash */
  getBlockByHash(hash: string): Block | null;

  /** Append a new block to the chain tail (only allows height = currentHeight + 1) */
  appendBlock(block: Block): void;

  /** Returns all blocks in the chain, ordered by height ascending */
  getAllBlocks(): Block[];

  /** Clear the chain (for development/testing or reset) */
  reset(): void;

  /** Load chain from persistent storage (browser localStorage) */
  loadFromPersistence(): void;

  /** Save chain in memory to persistent storage */
  saveToPersistence(): void;
}

/**
 * Storage key for localStorage
 */
const STORAGE_KEY = "indexerchain_blocks_v1";

/**
 * BrowserChainStorage - Implementation using localStorage
 */
export class BrowserChainStorage implements ChainStorage {
  private blocks: Block[] = [];

  constructor() {
    this.loadFromPersistence();
  }

  getTip(): Block | null {
    if (this.blocks.length === 0) return null;
    return this.blocks[this.blocks.length - 1];
  }

  getBlockByHeight(height: number): Block | null {
    if (height < 0 || height >= this.blocks.length) {
      return null;
    }
    return this.blocks[height] ?? null;
  }

  getBlockByHash(hash: string): Block | null {
    return this.blocks.find((b) => b.hash === hash) ?? null;
  }

  appendBlock(block: Block): void {
    const expectedHeight = this.blocks.length;

    if (block.header.height !== expectedHeight) {
      throw new Error(
        `Invalid block height: expected ${expectedHeight}, got ${block.header.height}`
      );
    }

    // Validate previous hash for non-genesis blocks
    if (expectedHeight > 0) {
      const prev = this.blocks[expectedHeight - 1];
      if (!prev) {
        throw new Error("Previous block not found");
      }
      if (block.header.prevHash !== prev.hash) {
        throw new Error(
          `Invalid prevHash: expected ${prev.hash}, got ${block.header.prevHash}`
        );
      }
    } else {
      // Genesis block: prevHash should be all zeros
      if (block.header.prevHash !== "0".repeat(64)) {
        throw new Error("Genesis block must have prevHash = 0...0");
      }
    }

    this.blocks.push(block);
    this.saveToPersistence();
  }

  getAllBlocks(): Block[] {
    return [...this.blocks];
  }

  reset(): void {
    this.blocks = [];
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  loadFromPersistence(): void {
    if (typeof localStorage === "undefined") {
      // Server-side rendering or non-browser environment
      this.blocks = [];
      return;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      this.blocks = [];
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Block[];
      // Validate that it's an array
      if (Array.isArray(parsed)) {
        this.blocks = parsed;
      } else {
        this.blocks = [];
      }
    } catch (error) {
      console.error("Failed to load chain from persistence:", error);
      this.blocks = [];
    }
  }

  saveToPersistence(): void {
    if (typeof localStorage === "undefined") {
      // Server-side rendering or non-browser environment
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.blocks));
    } catch (error) {
      console.error("Failed to save chain to persistence:", error);
    }
  }
}

