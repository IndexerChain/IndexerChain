/**
 * Phase 37-A: Mining Epoch Manager
 * 
 * Manages mining epochs to prevent stale mining results from polluting current state.
 * When a new block header arrives, all old mining tasks become invalid.
 */

/**
 * Mining Epoch Manager
 * 
 * Ensures that each mining session has a unique epoch ID. When a new block header
 * arrives, the epoch changes, and all messages from old epochs are discarded.
 */
export class MiningEpochManager {
  private currentEpochId: string | null = null;

  /**
   * Create a new mining epoch
   * 
   * @param blockHeight - Current block height
   * @param _blockHash - Hash of the previous block (tip hash) - used for logging/debugging
   * @returns The new epoch ID
   */
  newEpoch(blockHeight: number, _blockHash: string): string {
    // Generate unique epoch ID: epoch_{height}_{random}
    const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
    this.currentEpochId = `epoch_${blockHeight}_${random}`;
    console.log(`[MiningEpoch] New epoch created: ${this.currentEpochId.substring(0, 32)}... (height=${blockHeight})`);
    return this.currentEpochId;
  }

  /**
   * Get current epoch ID
   * 
   * @returns Current epoch ID or null if no epoch is active
   */
  getCurrent(): string | null {
    return this.currentEpochId;
  }

  /**
   * Check if an epoch ID is valid (matches current epoch)
   * 
   * @param epochId - Epoch ID to validate
   * @returns true if epochId matches current epoch, false otherwise
   */
  isValid(epochId: string | undefined | null): boolean {
    if (!epochId || !this.currentEpochId) {
      return false;
    }
    return epochId === this.currentEpochId;
  }

  /**
   * Reset current epoch (called when mining stops)
   */
  reset(): void {
    if (this.currentEpochId) {
      console.log(`[MiningEpoch] Epoch reset: ${this.currentEpochId.substring(0, 32)}...`);
    }
    this.currentEpochId = null;
  }

  /**
   * Check if an epoch is currently active
   * 
   * @returns true if an epoch is active, false otherwise
   */
  isActive(): boolean {
    return this.currentEpochId !== null;
  }
}

