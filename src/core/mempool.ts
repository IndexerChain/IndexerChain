/**
 * Mempool - Pending Transaction Pool
 * 
 * Phase 5: Added signature verification
 */

import type { Tx } from "./types.js";
import { verifyTxSignature } from "./signatures.js";

/**
 * Mempool class
 * Simple array-based transaction pool with signature verification
 */
export class Mempool {
  private txs: Tx[] = [];

  /**
   * Add a transaction to the mempool
   * 
   * Phase 5: Verifies signature before adding
   * 
   * @param tx Transaction to add
   * @returns true if added successfully, false if invalid or duplicate
   */
  async addTx(tx: Tx): Promise<boolean> {
    // Check if transaction already exists
    if (this.txs.some((t) => t.txId === tx.txId)) {
      return false; // Already exists
    }

    // Phase 5: Verify signature
    const isValid = await verifyTxSignature(tx);
    if (!isValid) {
      console.warn("Transaction signature verification failed:", tx.txId);
      return false; // Invalid signature
    }

    this.txs.push(tx);
    return true;
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

