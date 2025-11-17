/**
 * Index State Machine
 * 
 * Phase 7: Extended with TRANSFER operation and balance management
 * 
 * Maintains a key-value state by applying operations from blocks in order.
 * State structure: namespace -> key -> value
 * 
 * Balances are stored in "balances" namespace with address as key.
 */

import type { Block, Tx, Operation, Address } from "./types.js";

/**
 * Snapshot of index state for serialization
 */
export interface IndexStateSnapshot {
  // namespace -> key -> value
  data: Record<string, Record<string, string>>;
}

/**
 * IndexState class
 * 
 * Applies operations from blocks to maintain a global state:
 * - PUT: Set (namespace, key) to value (overwrites)
 * - APPEND: Append value to existing value (string concatenation)
 * - DELETE: Delete (namespace, key)
 */
export class IndexState {
  // Internal: Map<namespace, Map<key, value>>
  private state: Map<string, Map<string, string>> = new Map();

  /**
   * Create an empty state
   */
  static createEmpty(): IndexState {
    return new IndexState();
  }

  /**
   * Restore state from snapshot
   */
  static fromSnapshot(snapshot: IndexStateSnapshot): IndexState {
    const inst = new IndexState();
    for (const [ns, kv] of Object.entries(snapshot.data)) {
      const inner = new Map<string, string>();
      for (const [k, v] of Object.entries(kv)) {
        inner.set(k, v);
      }
      inst.state.set(ns, inner);
    }
    return inst;
  }

  /**
   * Export snapshot for persistence or debugging
   */
  toSnapshot(): IndexStateSnapshot {
    const data: Record<string, Record<string, string>> = {};
    for (const [ns, kvMap] of this.state) {
      data[ns] = {};
      for (const [k, v] of kvMap) {
        data[ns][k] = v;
      }
    }
    return { data };
  }

  /**
   * Get value for a key in a namespace
   * @returns The value, or undefined if not found
   */
  get(namespace: string, key: string): string | undefined {
    return this.state.get(namespace)?.get(key);
  }

  /**
   * Get balance for an address
   * Phase 7: Helper to get balance from "balances" namespace
   * @returns Balance in IDC, or 0 if not found
   */
  getBalance(address: Address): number {
    const balanceStr = this.get("balances", address);
    if (!balanceStr) return 0;
    const balance = parseFloat(balanceStr);
    return isNaN(balance) ? 0 : balance;
  }

  /**
   * Set balance for an address
   * Phase 7: Helper to set balance in "balances" namespace
   */
  setBalance(address: Address, amount: number): void {
    const nsMap = this.state.get("balances") || new Map<string, string>();
    nsMap.set(address, amount.toString());
    this.state.set("balances", nsMap);
  }

  /**
   * Get all keys in a namespace
   */
  getNamespaceKeys(namespace: string): string[] {
    const nsMap = this.state.get(namespace);
    if (!nsMap) return [];
    return Array.from(nsMap.keys());
  }

  /**
   * Get all namespaces
   */
  getNamespaces(): string[] {
    return Array.from(this.state.keys());
  }

  /**
   * Apply a single operation to update internal state
   * 
   * Phase 7: Added TRANSFER operation support
   * 
   * @param op Operation to apply
   * @param ownerAddress Owner address (from transaction, required for TRANSFER)
   */
  applyOperation(op: Operation, ownerAddress?: Address): void {
    const { namespace, key, value = "", type } = op;

    // Phase 7: Handle TRANSFER operation
    if (type === "TRANSFER") {
      if (!ownerAddress) {
        throw new Error("TRANSFER operation requires ownerAddress");
      }
      if (!op.to || op.amount === undefined) {
        throw new Error("TRANSFER operation requires 'to' and 'amount' fields");
      }
      this.applyTransfer(ownerAddress, op.to, op.amount);
      return;
    }

    // Handle other operation types (PUT, APPEND, DELETE)
    let nsMap = this.state.get(namespace);
    if (!nsMap) {
      nsMap = new Map<string, string>();
      this.state.set(namespace, nsMap);
    }

    if (type === "PUT") {
      nsMap.set(key, value);
    } else if (type === "APPEND") {
      const prev = nsMap.get(key) ?? "";
      nsMap.set(key, prev + value);
    } else if (type === "DELETE") {
      nsMap.delete(key);
      // If namespace becomes empty, we can optionally remove it
      if (nsMap.size === 0) {
        this.state.delete(namespace);
      }
    }
  }

  /**
   * Apply a transfer operation
   * Phase 7: Transfer IDC from one address to another
   * 
   * @param from Sender address
   * @param to Recipient address
   * @param amount Amount to transfer in IDC
   * @throws Error if insufficient balance
   */
  private applyTransfer(from: Address, to: Address, amount: number): void {
    if (amount <= 0) {
      throw new Error("Transfer amount must be positive");
    }

    const fromBalance = this.getBalance(from);
    if (fromBalance < amount) {
      throw new Error(`Insufficient balance: ${fromBalance} < ${amount}`);
    }

    // Deduct from sender
    this.setBalance(from, fromBalance - amount);

    // Add to recipient
    const toBalance = this.getBalance(to);
    this.setBalance(to, toBalance + amount);
  }

  /**
   * Apply all operations in a transaction
   * 
   * Phase 7: Pass ownerAddress for TRANSFER operations
   */
  applyTx(tx: Tx): void {
    for (const op of tx.ops) {
      // Phase 7: Pass ownerAddress for TRANSFER operations
      this.applyOperation(op, tx.ownerAddress);
    }
  }

  /**
   * Apply all transactions in a block
   */
  applyBlock(block: Block): void {
    for (const tx of block.txs) {
      this.applyTx(tx);
    }
  }

  /**
   * Rebuild state from a list of blocks (used during initialization)
   * Clears current state and applies all blocks in order
   */
  rebuildFromBlocks(blocks: Block[]): void {
    this.state.clear();
    for (const block of blocks) {
      this.applyBlock(block);
    }
  }

  /**
   * Get the internal state map (for debugging)
   */
  getInternalState(): Map<string, Map<string, string>> {
    return this.state;
  }
}

