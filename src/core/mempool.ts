/**
 * Mempool - Pending Transaction Pool
 * 
 * Simple in-memory transaction queue for pending transactions
 */

import type { Tx } from "./types.js";

/**
 * Mempool class
 * Simple array-based transaction pool
 */
export class Mempool {
  private txs: Tx[] = [];

  /**
   * Add a transaction to the mempool
   */
  addTx(tx: Tx): void {
    // Check if transaction already exists
    if (this.txs.some((t) => t.txId === tx.txId)) {
      return; // Already exists, skip
    }
    this.txs.push(tx);
  }

  /**
   * Get all pending transactions
   */
  getAll(): Tx[] {
    return [...this.txs];
  }

  /**
   * Get transactions up to a limit
   */
  getTxs(limit?: number): Tx[] {
    if (limit === undefined) {
      return this.getAll();
    }
    return this.txs.slice(0, limit);
  }

  /**
   * Remove transactions from mempool (after they're included in a block)
   */
  removeTxs(txIds: string[]): void {
    const txIdSet = new Set(txIds);
    this.txs = this.txs.filter((tx) => !txIdSet.has(tx.txId));
  }

  /**
   * Clear all transactions
   */
  clear(): void {
    this.txs = [];
  }

  /**
   * Get number of pending transactions
   */
  size(): number {
    return this.txs.length;
  }

  /**
   * Check if mempool is empty
   */
  isEmpty(): boolean {
    return this.txs.length === 0;
  }
}

