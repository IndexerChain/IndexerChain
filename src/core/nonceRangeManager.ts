/**
 * Phase 37-B: Node Nonce Range Manager
 * 
 * Manages nonce range allocation at the node level:
 * - Handles global pool ranges (from delegator)
 * - Handles local-only mode (unbounded from 0 to 2^64-1)
 * - Allocates sub-ranges to workers
 */

import type { NonceRange } from "./globalNonceAllocator.js";

/**
 * Simplified nonce range for internal use (only start and end)
 */
export interface SimpleNonceRange {
  start: bigint;
  end: bigint; // inclusive
}

/**
 * Node Nonce Range Manager
 * 
 * Manages the nonce range for a single node, which can be:
 * - A global pool range (bounded, from delegator)
 * - Local-only mode (unbounded, from 0 to 2^64-1)
 * 
 * Splits the node-level range into smaller sub-ranges for individual workers.
 */
export class NodeNonceRangeManager {
  private currentRange: NonceRange | null = null;
  private cursor: bigint = 0n;

  /**
   * Set the global nonce range for this node
   * 
   * @param range - The global range from delegator, or null for local-only mode
   */
  setGlobalRange(range: NonceRange | null): void {
    this.currentRange = range;
    this.cursor = range ? range.start : 0n;
    console.log(`[NodeNonceRangeManager] Set global range: ${range ? `${range.start}..${range.end}` : 'local-only (unbounded)'}`);
  }

  /**
   * Allocate a sub-range for a worker
   * 
   * In local mode (currentRange = null), cursor starts from 0 and increments.
   * In global pool mode, cursor is bounded by currentRange.end.
   * 
   * @param size - Size of the sub-range to allocate
   * @returns Allocated sub-range, or null if exhausted (global pool mode only)
   */
  allocateSubRange(size: bigint): SimpleNonceRange | null {
    if (!this.currentRange) {
      // Local mode: unbounded, cursor starts from 0 and increments
      const start = this.cursor;
      const end = start + size - 1n;
      this.cursor = end + 1n;
      return { start, end };
    }

    // Global pool mode: bounded by currentRange
    const { end: gEnd } = this.currentRange;
    
    // Check if exhausted
    if (this.cursor > gEnd) {
      return null;
    }

    const start = this.cursor;
    let end = start + size - 1n;
    
    // Clamp to global range end
    if (end > gEnd) {
      end = gEnd;
    }

    this.cursor = end + 1n;
    return { start, end };
  }

  /**
   * Check if the global range is exhausted
   * 
   * @returns true if exhausted (global pool mode only), false if local mode or not exhausted
   */
  isExhausted(): boolean {
    if (!this.currentRange) {
      return false; // Local mode = unbounded, never exhausted
    }
    return this.cursor > this.currentRange.end;
  }

  /**
   * Get current cursor position
   * 
   * @returns Current cursor position
   */
  getCursor(): bigint {
    return this.cursor;
  }

  /**
   * Get current global range
   * 
   * @returns Current global range, or null if local mode
   */
  getCurrentRange(): NonceRange | null {
    return this.currentRange;
  }

  /**
   * Reset cursor (useful when starting new mining session)
   */
  reset(): void {
    if (this.currentRange) {
      this.cursor = this.currentRange.start;
    } else {
      this.cursor = 0n;
    }
  }
}

