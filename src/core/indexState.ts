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
  public _debugId = Math.random().toString(36).substring(7); // Debug ID to track instances
  
  // Phase 12: Change log for incremental snapshots
  private changeLog: Operation[] = [];
  private isRecording: boolean = false;
  
  // Phase 27: Privacy layer - commitments and nullifiers
  private commitments: Map<string, string> = new Map(); // commitment -> noteId
  private nullifierSet: Set<string> = new Set(); // Set of used nullifiers
  
  // CRITICAL: Hard isolation mode for solo mining - only allow applyBlock, block all other modifications
  private isApplyingBlock: boolean = false; // Flag to allow modifications during applyBlock

  /**
   * Create an empty state
   */
  static createEmpty(): IndexState {
    return new IndexState();
  }

  /**
   * Restore state from snapshot
   * 
   * Phase 27: Also restores commitments and nullifier set from snapshot
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
    
    // Phase 27: Restore commitments and nullifiers from shielded_pool namespace
    const shieldedPool = inst.state.get("shielded_pool");
    if (shieldedPool) {
      for (const [commitment] of shieldedPool) {
        const noteId = `${commitment}_${Date.now()}`;
        inst.commitments.set(commitment, noteId);
      }
    }
    
    // Nullifiers are stored in a separate namespace "nullifiers"
    const nullifiers = inst.state.get("nullifiers");
    if (nullifiers) {
      for (const nullifier of nullifiers.keys()) {
        inst.nullifierSet.add(nullifier);
      }
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
   * Check if solo mining mode is active and block modifications
   * CRITICAL: In solo mining mode, only applyBlock is allowed to modify state
   */
  private checkSoloMiningLock(actionName: string): void {
    if (this.isApplyingBlock) {
      // Allow modifications during applyBlock
      return;
    }
    
    try {
      const g: any = (typeof window !== "undefined") ? (window as any) : {};
      if (typeof g.__soloMiningMode === "boolean" && g.__soloMiningMode) {
        console.warn(`[IndexState] 🛑 Blocked ${actionName} during solo mining mode (only applyBlock allowed)`);
        throw new Error(`IndexState modification blocked: ${actionName} (solo mining mode)`);
      }
    } catch (e) {
      // If check throws, re-throw it
      if (e instanceof Error && e.message.includes("IndexState modification blocked")) {
        throw e;
      }
      // Otherwise ignore (window might not be available)
    }
  }

  /**
   * Set balance for an address
   * Phase 7: Helper to set balance in "balances" namespace
   */
  setBalance(address: Address, amount: number): void {
    this.checkSoloMiningLock("setBalance");
    const nsMap = this.state.get("balances") || new Map<string, string>();
    nsMap.set(address, amount.toString());
    this.state.set("balances", nsMap);
  }

  /**
   * Phase 16: Get total minted IDC (in uIDC)
   * Stored in "system" namespace, key "total_minted"
   */
  getTotalMinted(): bigint {
    const totalMintedStr = this.get("system", "total_minted");
    if (!totalMintedStr) return 0n;
    try {
      return BigInt(totalMintedStr);
    } catch {
      return 0n;
    }
  }

  /**
   * Phase 16: Set total minted IDC (in uIDC)
   * Stored in "system" namespace, key "total_minted"
   */
  setTotalMinted(amount: bigint): void {
    this.checkSoloMiningLock("setTotalMinted");
    const nsMap = this.state.get("system") || new Map<string, string>();
    nsMap.set("total_minted", amount.toString());
    this.state.set("system", nsMap);
  }

  /**
   * Phase 16: Increment total minted IDC
   * Used when minting new coins (coinbase reward)
   * CRITICAL: Allow this during applyBlock or when called from appendMinedBlock
   */
  incrementTotalMinted(amount: bigint): void {
    // CRITICAL: Allow incrementTotalMinted during applyBlock or when called from appendMinedBlock
    // This is part of the normal block application flow
    if (this.isApplyingBlock) {
      // During applyBlock, allow setTotalMinted
      const current = this.getTotalMinted();
      const nsMap = this.state.get("system") || new Map<string, string>();
      nsMap.set("total_minted", (current + amount).toString());
      this.state.set("system", nsMap);
    } else {
      // Outside applyBlock, use normal path (will be blocked in solo mining mode)
      const current = this.getTotalMinted();
      this.setTotalMinted(current + amount);
    }
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
   * Phase 12: Start recording changes to changeLog
   */
  beginRecording(): void {
    this.isRecording = true;
    this.changeLog = [];
  }

  /**
   * Phase 12: Stop recording and return the change log
   * @returns Array of operations recorded since beginRecording()
   */
  stopRecording(): Operation[] {
    this.isRecording = false;
    const changes = [...this.changeLog];
    this.changeLog = [];
    return changes;
  }

  /**
   * Phase 12: Get current change log (without stopping recording)
   */
  getChangeLog(): Operation[] {
    return [...this.changeLog];
  }

  /**
   * Phase 12: Clear change log
   */
  clearChangeLog(): void {
    this.changeLog = [];
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
    // CRITICAL: Only allow applyOperation during applyBlock (when isApplyingBlock is true)
    // This prevents external code from modifying state during solo mining
    if (!this.isApplyingBlock) {
      this.checkSoloMiningLock("applyOperation");
    }
    const { namespace, key, value = "", type } = op;

    // Phase 7: Handle TRANSFER operation
    if (type === "TRANSFER") {
      if (!ownerAddress) {
        throw new Error("TRANSFER operation requires ownerAddress");
      }
      if (!op.to || op.amount === undefined) {
        throw new Error("TRANSFER operation requires 'to' and 'amount' fields");
      }
      
      // Phase 12: Record operation before applying (so it's in changeLog)
      if (this.isRecording) {
        this.changeLog.push(op);
      }
      
      this.applyTransfer(ownerAddress, op.to, op.amount);
      return;
    }

    // Phase 27: Handle SHIELDED_TRANSFER operation
    if (type === "SHIELDED_TRANSFER") {
      if (!op.commitment) {
        throw new Error("SHIELDED_TRANSFER operation requires 'commitment' field");
      }
      
      // Phase 12: Record operation before applying
      if (this.isRecording) {
        this.changeLog.push(op);
      }
      
      this.applyShieldedTransfer(op);
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

    // Phase 12: Record operation in change log if recording
    if (this.isRecording) {
      this.changeLog.push(op);
    }
  }

  /**
   * Apply a transfer operation
   * Phase 7: Transfer IDC from one address to another
   * Phase 15: System address (idc_system) can transfer without balance check (for coinbase rewards)
   * 
   * @param from Sender address
   * @param to Recipient address
   * @param amount Amount to transfer in IDC
   * @throws Error if insufficient balance (except for system address)
   */
  private applyTransfer(from: Address, to: Address, amount: number): void {
    if (amount <= 0) {
      throw new Error("Transfer amount must be positive");
    }

    // Phase 15: System address can transfer without balance check (coinbase rewards)
    const isSystemAddress = from === "idc_system";
    
    if (!isSystemAddress) {
      const fromBalance = this.getBalance(from);
      if (fromBalance < amount) {
        // Enhanced error message with more context
        throw new Error(
          `Insufficient balance: ${fromBalance.toFixed(6)} < ${amount.toFixed(6)} ` +
          `(from: ${from}, to: ${to}, amount: ${amount.toFixed(6)} IDC)`
        );
      }
      // Deduct from sender (only for non-system addresses)
      this.setBalance(from, fromBalance - amount);
    }
    // For system address, we don't deduct (it's a reward, not a transfer from existing balance)

    // Add to recipient
    const toBalance = this.getBalance(to);
    this.setBalance(to, toBalance + amount);
    
    // Phase 12: TRANSFER operations are recorded via applyOperation, not here
    // The operation is already in changeLog when applyOperation is called
  }

  /**
   * Apply all operations in a transaction
   * 
   * Phase 7: Pass ownerAddress for TRANSFER operations
   */
  applyTx(tx: Tx): void {
    try {
      for (const op of tx.ops) {
        // Phase 7: Pass ownerAddress for TRANSFER operations
        this.applyOperation(op, tx.ownerAddress);
      }
    } catch (error) {
      // Enhanced error with transaction context
      const txIdShort = tx.txId ? tx.txId.substring(0, 16) + "..." : "unknown";
      const owner = tx.ownerAddress || "unknown";
      throw new Error(
        `Failed to apply transaction ${txIdShort} (owner: ${owner}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Apply all transactions in a block
   */
  applyBlock(block: Block): void {
    // CRITICAL: Set flag to allow modifications during applyBlock
    // This is the ONLY allowed modification path during solo mining
    const wasApplyingBlock = this.isApplyingBlock;
    this.isApplyingBlock = true;
    
    try {
      for (let i = 0; i < block.txs.length; i++) {
        const tx = block.txs[i];
        try {
          this.applyTx(tx);
        } catch (error) {
          // Enhanced error with block and transaction context
          const txIdShort = tx.txId ? tx.txId.substring(0, 16) + "..." : "unknown";
          throw new Error(
            `Failed to apply transaction ${i} (${txIdShort}) in block ${block.header.height}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } catch (error) {
      // Re-throw with block context
      throw new Error(
        `Failed to apply block at height ${block.header.height}: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // CRITICAL: Restore flag after applyBlock completes
      this.isApplyingBlock = wasApplyingBlock;
    }
  }

  /**
   * Rebuild state from a list of blocks (used during initialization)
   * Clears current state and applies all blocks in order
   * 
   * Phase 16: Also updates total_minted for coinbase rewards
   * 
   * Note: This is synchronous, but total_minted update is async.
   * For now, we skip total_minted update here since it's handled in chain.ts during initialization.
   * The balance calculation doesn't depend on total_minted.
   */
  rebuildFromBlocks(blocks: Block[]): void {
    // CRITICAL: Only block rebuildFromBlocks if this is the main chainContext.indexState
    // Temporary states created in buildCandidateBlock should be allowed to rebuild
    // Check if this is a temporary state by checking if it has no state yet (newly created)
    const isTemporaryState = this.state.size === 0 && this.commitments.size === 0 && this.nullifierSet.size === 0;
    
    if (!isTemporaryState) {
      // This is the main indexState, check solo mining lock
      this.checkSoloMiningLock("rebuildFromBlocks");
    }
    
    this.state.clear();
    // Also clear commitments and nullifiers (Phase 27)
    this.commitments.clear();
    this.nullifierSet.clear();
    
    // Set isApplyingBlock to allow applyBlock modifications
    const wasApplyingBlock = this.isApplyingBlock;
    this.isApplyingBlock = true;
    
    try {
      for (const block of blocks) {
        this.applyBlock(block);
      }
    } finally {
      this.isApplyingBlock = wasApplyingBlock;
    }
    
    // Note: total_minted is updated in chain.ts during initialization
    // after rebuildFromBlocks completes, to avoid async issues
  }

  /**
   * Get the internal state map (for debugging)
   * CRITICAL: In solo mining mode, this returns a read-only view to prevent external modifications
   */
  getInternalState(): Map<string, Map<string, string>> {
    // CRITICAL: Check if solo mining mode is active
    try {
      const g: any = (typeof window !== "undefined") ? (window as any) : {};
      if (typeof g.__soloMiningMode === "boolean" && g.__soloMiningMode && !this.isApplyingBlock) {
        console.warn("[IndexState] 🛑 getInternalState() called during solo mining mode - returning read-only view");
        // Return a read-only proxy that throws on modification attempts
        return new Proxy(this.state, {
          get: (target, prop) => {
            if (prop === 'clear' || prop === 'delete' || prop === 'set') {
              throw new Error(`IndexState.getInternalState() modification blocked during solo mining mode (${String(prop)})`);
            }
            const value = target[prop as keyof typeof target];
            if (typeof value === 'function') {
              return value.bind(target);
            }
            return value;
          }
        }) as any;
      }
    } catch {}
    return this.state;
  }

  // Export/import helpers for UI persistence (wrap existing snapshot format)
  exportSnapshot(): IndexStateSnapshot {
    return this.toSnapshot();
  }

  importSnapshot(snapshot: IndexStateSnapshot): void {
    this.checkSoloMiningLock("importSnapshot");
    try {
      // Reset
      this.state.clear();
      this.commitments.clear();
      this.nullifierSet.clear();
      // Restore namespaces
      for (const [ns, kv] of Object.entries(snapshot.data || {})) {
        const inner = new Map<string, string>();
        for (const [k, v] of Object.entries(kv || {})) {
          inner.set(k, String(v));
        }
        this.state.set(ns, inner);
      }
      // Rebuild commitments from shielded_pool
      const shieldedPool = this.state.get("shielded_pool");
      if (shieldedPool) {
        for (const [commitment] of shieldedPool) {
          const noteId = `${commitment}_${Date.now()}`;
          this.commitments.set(commitment, noteId);
        }
      }
      // Rebuild nullifier set
      const nullifiers = this.state.get("nullifiers");
      if (nullifiers) {
        for (const nullifier of nullifiers.keys()) {
          this.nullifierSet.add(nullifier);
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * Phase 27: Apply a shielded transfer operation
   * 
   * Handles privacy-preserving transfers:
   * 1. Validates nullifier (if spending)
   * 2. Adds nullifier to set (if spending)
   * 3. Stores commitment (output)
   * 
   * @param op Shielded transfer operation
   */
  private applyShieldedTransfer(op: Operation): void {
    // Validate nullifier if spending
    if (op.nullifier) {
      // Check if nullifier has been used before
      if (this.nullifierSet.has(op.nullifier)) {
        throw new Error(`Double-spend detected: nullifier ${op.nullifier} already used`);
      }
      
      // Add nullifier to set
      this.nullifierSet.add(op.nullifier);
      
      // Also store in nullifiers namespace for persistence
      let nullifierMap = this.state.get("nullifiers");
      if (!nullifierMap) {
        nullifierMap = new Map<string, string>();
        this.state.set("nullifiers", nullifierMap);
      }
      nullifierMap.set(op.nullifier, "1"); // Value is just a marker
    }
    
    // Store commitment in shielded_pool namespace
    // Key format: commitment value, Value: oneTimePublic (if available) or empty
    const shieldedNamespace = "shielded_pool";
    let nsMap = this.state.get(shieldedNamespace);
    if (!nsMap) {
      nsMap = new Map<string, string>();
      this.state.set(shieldedNamespace, nsMap);
    }
    
    // Store commitment
    const commitmentKey = op.commitment!;
    const commitmentValue = op.oneTimePublic || op.ephemeralPub || "";
    nsMap.set(commitmentKey, commitmentValue);
    
    // Also track in commitments map for quick lookup
    const noteId = `${op.commitment}_${Date.now()}`;
    this.commitments.set(op.commitment!, noteId);
  }

  /**
   * Phase 27: Check if a nullifier has been used
   * 
   * @param nullifier Nullifier to check
   * @returns true if nullifier has been used
   */
  isNullifierUsed(nullifier: string): boolean {
    return this.nullifierSet.has(nullifier);
  }

  /**
   * Phase 27: Get all commitments
   * 
   * @returns Map of commitment -> noteId
   */
  getCommitments(): Map<string, string> {
    return new Map(this.commitments);
  }

  /**
   * Phase 27: Get nullifier set
   * 
   * @returns Set of used nullifiers
   */
  getNullifierSet(): Set<string> {
    return new Set(this.nullifierSet);
  }
}

