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
    // Phase 10: In light node mode, blocks may not be indexed by height
    // Search through blocks array to find matching height
    return this.blocks.find((b) => b.header.height === height) ?? null;
  }

  getBlockByHash(hash: string): Block | null {
    return this.blocks.find((b) => b.hash === hash) ?? null;
  }

  appendBlock(block: Block): void {
    // Phase 10: In light node mode, we need to check if block already exists
    // and validate against tip (not array length)
    const tip = this.getTip();
    const expectedHeight = tip ? tip.header.height + 1 : 0;

    if (block.header.height !== expectedHeight) {
      throw new Error(
        `Invalid block height: expected ${expectedHeight}, got ${block.header.height}`
      );
    }

    // Check if block already exists (shouldn't happen, but safety check)
    const existing = this.getBlockByHeight(block.header.height);
    if (existing) {
      throw new Error(`Block at height ${block.header.height} already exists`);
    }

    // Validate previous hash for non-genesis blocks
    if (expectedHeight > 0) {
      if (!tip) {
        throw new Error("Previous block (tip) not found");
      }
      if (block.header.prevHash !== tip.hash) {
        throw new Error(
          `Invalid prevHash: expected ${tip.hash}, got ${block.header.prevHash}`
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

  /**
   * Phase 10: Prune blocks before a given height
   * Removes all blocks with height < pruneHeight
   * 
   * @param pruneHeight Minimum height to keep (blocks below this will be deleted)
   */
  pruneBlocksBefore(pruneHeight: number): void {
    if (pruneHeight <= 0) {
      return; // Don't prune genesis block
    }

    // Filter out blocks below pruneHeight
    const pruned = this.blocks.filter((block) => block.header.height >= pruneHeight);
    
    // Only update if we actually removed blocks
    if (pruned.length < this.blocks.length) {
      this.blocks = pruned;
      this.saveToPersistence();
      console.log(
        `[Phase 10] Pruned blocks before height ${pruneHeight}, kept ${pruned.length} blocks`
      );
    }
  }

  /**
   * Phase 10: Get the minimum block height currently stored
   * Returns 0 if no blocks exist
   */
  getMinHeight(): number {
    if (this.blocks.length === 0) {
      return 0;
    }
    return Math.min(...this.blocks.map((b) => b.header.height));
  }

  /**
   * Phase 10: Get the maximum block height currently stored
   * Returns 0 if no blocks exist
   */
  getMaxHeight(): number {
    if (this.blocks.length === 0) {
      return 0;
    }
    return Math.max(...this.blocks.map((b) => b.header.height));
  }

  /**
   * Phase 10: Auto-prune blocks based on window size
   * Keeps only the most recent N blocks (where N = window)
   * 
   * @param currentHeight Current tip height
   * @param window Number of recent blocks to keep
   */
  autoPrune(currentHeight: number, window: number): void {
    if (window <= 0 || currentHeight < window) {
      return; // Don't prune if window is invalid or not enough blocks
    }

    const pruneHeight = currentHeight - window + 1; // Keep blocks from this height onwards
    if (pruneHeight > 0) {
      this.pruneBlocksBefore(pruneHeight);
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
      const serialized = JSON.stringify(this.blocks);
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch (error) {
      // Handle QuotaExceededError - localStorage is full
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        console.error("localStorage quota exceeded! Attempting to prune old blocks...");
        // Try to prune old blocks and retry
        const tip = this.getTip();
        if (tip && tip.header.height > 50) {
          // Prune blocks before height - 50
          const pruneHeight = tip.header.height - 50;
          this.pruneBlocksBefore(pruneHeight);
          // Retry saving
          try {
            const serialized = JSON.stringify(this.blocks);
            localStorage.setItem(STORAGE_KEY, serialized);
            console.log("Successfully saved after pruning old blocks");
          } catch (retryError) {
            console.error("Failed to save even after pruning:", retryError);
            // Last resort: clear all blocks except tip
            if (tip) {
              this.blocks = [tip];
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.blocks));
                console.warn("Cleared all blocks except tip due to storage limit");
              } catch (finalError) {
                console.error("Failed to save even with only tip block:", finalError);
              }
            }
          }
        } else {
          console.error("Cannot prune: not enough blocks or no tip");
        }
      } else {
        console.error("Failed to save chain to persistence:", error);
      }
    }
  }
}

