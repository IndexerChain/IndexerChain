/**
 * Index State Machine
 * 
 * Maintains a key-value state by applying operations from blocks in order.
 * State structure: namespace -> key -> value
 */

import type { Block, Tx, Operation } from "./types.js";

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
   */
  applyOperation(op: Operation): void {
    const { namespace, key, value = "", type } = op;

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
   * Apply all operations in a transaction
   */
  applyTx(tx: Tx): void {
    for (const op of tx.ops) {
      this.applyOperation(op);
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

