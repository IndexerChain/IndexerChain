/**
 * Phase 31: Distributed Checkpoint Locking
 * 
 * Implements checkpoint-based chain locking to prevent forks.
 * Every 100 blocks forms a checkpoint that must be finalized
 * before allowing reorganization.
 */

import type { ChainContext } from "./chain.js";
import type { Block } from "./types.js";
import { logger } from "./logger.js";

/**
 * Checkpoint information
 */
export interface Checkpoint {
  height: number;
  blockHash: string;
  stateCommitment: string;
  finalized: boolean;
  finalitySignatures: string[]; // ECDSA signatures from finality committee
  createdAt: number;
}

/**
 * Checkpoint lock result
 */
export interface CheckpointLockResult {
  locked: boolean;
  checkpointHeight: number;
  canReorganize: boolean;
  reason?: string;
}

/**
 * Distributed Checkpoint Lock Manager
 * 
 * Manages checkpoint-based chain locking to prevent forks.
 */
export class CheckpointLock {
  private checkpoints: Map<number, Checkpoint> = new Map();
  private readonly CHECKPOINT_INTERVAL = 100; // Every 100 blocks

  constructor(private chainContext: ChainContext) {}

  /**
   * Get checkpoint for a given height
   */
  getCheckpoint(height: number): Checkpoint | null {
    const checkpointHeight = Math.floor(height / this.CHECKPOINT_INTERVAL) * this.CHECKPOINT_INTERVAL;
    return this.checkpoints.get(checkpointHeight) || null;
  }

  /**
   * Get latest checkpoint
   */
  getLatestCheckpoint(): Checkpoint | null {
    let latest: Checkpoint | null = null;
    let latestHeight = -1;

    for (const [height, checkpoint] of this.checkpoints.entries()) {
      if (height > latestHeight) {
        latestHeight = height;
        latest = checkpoint;
      }
    }

    return latest;
  }

  /**
   * Create checkpoint from block
   */
  async createCheckpoint(block: Block): Promise<Checkpoint | null> {
    const height = block.header.height;
    
    // Only create checkpoint at checkpoint intervals
    if (height % this.CHECKPOINT_INTERVAL !== 0) {
      return null;
    }

    const checkpoint: Checkpoint = {
      height,
      blockHash: block.hash,
      stateCommitment: block.header.stateCommitment || "",
      finalized: false,
      finalitySignatures: [],
      createdAt: Date.now(),
    };

    // If finality is enabled, check if this checkpoint is finalized
    if (this.chainContext.params.finalityEnabled) {
      // Check if we have finality certificate for this block
      // This would require integration with finality manager
      // For now, we'll mark as finalized if stateCommitment exists
      if (block.header.stateCommitment) {
        checkpoint.finalized = true;
      }
    }

    this.checkpoints.set(height, checkpoint);
    
    logger.debug(`[Phase 31] Created checkpoint at height ${height}, hash: ${block.hash.substring(0, 16)}...`);

    // Clean up old checkpoints (keep only last 10)
    const sortedHeights = Array.from(this.checkpoints.keys()).sort((a, b) => b - a);
    if (sortedHeights.length > 10) {
      for (let i = 10; i < sortedHeights.length; i++) {
        this.checkpoints.delete(sortedHeights[i]);
      }
    }

    return checkpoint;
  }

  /**
   * Check if reorganization is allowed
   */
  canReorganize(fromHeight: number, toHeight: number): CheckpointLockResult {
    // Find checkpoint between fromHeight and toHeight
    const fromCheckpointHeight = Math.floor(fromHeight / this.CHECKPOINT_INTERVAL) * this.CHECKPOINT_INTERVAL;
    const toCheckpointHeight = Math.floor(toHeight / this.CHECKPOINT_INTERVAL) * this.CHECKPOINT_INTERVAL;

    // If reorganization crosses a checkpoint, check if checkpoint is finalized
    if (fromCheckpointHeight !== toCheckpointHeight) {
      const checkpoint = this.getCheckpoint(fromCheckpointHeight);
      
      if (checkpoint && checkpoint.finalized) {
        return {
          locked: true,
          checkpointHeight: fromCheckpointHeight,
          canReorganize: false,
          reason: `Reorganization would cross finalized checkpoint at height ${fromCheckpointHeight}`,
        };
      }
    }

    // Check if reorganization would go below latest checkpoint
    const latestCheckpoint = this.getLatestCheckpoint();
    if (latestCheckpoint && toHeight < latestCheckpoint.height) {
      return {
        locked: true,
        checkpointHeight: latestCheckpoint.height,
        canReorganize: false,
        reason: `Reorganization would go below latest checkpoint at height ${latestCheckpoint.height}`,
      };
    }

    return {
      locked: false,
      checkpointHeight: toCheckpointHeight,
      canReorganize: true,
    };
  }

  /**
   * Finalize checkpoint with finality signatures
   */
  finalizeCheckpoint(height: number, signatures: string[]): boolean {
    const checkpoint = this.getCheckpoint(height);
    if (!checkpoint) {
      return false;
    }

    // Check if we have enough signatures (2/3 of committee)
    const committeeSize = this.chainContext.params.finalityCommitteeSize || 11;
    const threshold = Math.ceil(committeeSize * (this.chainContext.params.finalityThreshold || 0.67));
    
    if (signatures.length < threshold) {
      return false;
    }

    checkpoint.finalized = true;
    checkpoint.finalitySignatures = signatures;

    logger.debug(`[Phase 31] Finalized checkpoint at height ${height} with ${signatures.length} signatures`);

    return true;
  }

  /**
   * Check if block can be appended (not locked by checkpoint)
   */
  canAppendBlock(block: Block): boolean {
    const tip = this.chainContext.storage.getTip();
    if (!tip) {
      return true; // Genesis block
    }

    // Check if we're trying to append a block that would reorganize past a checkpoint
    if (block.header.height <= tip.header.height) {
      // This is a reorganization attempt
      const result = this.canReorganize(tip.header.height, block.header.height);
      return result.canReorganize;
    }

    // Normal append, check if previous block is at checkpoint
    const prevCheckpoint = this.getCheckpoint(tip.header.height);
    if (prevCheckpoint && prevCheckpoint.finalized) {
      // Previous block is at a finalized checkpoint, we can append
      return true;
    }

    return true;
  }

  /**
   * Initialize checkpoints from existing chain
   */
  async initializeFromChain(): Promise<void> {
    const allBlocks = this.chainContext.storage.getAllBlocks();
    
    for (const block of allBlocks) {
      if (block.header.height % this.CHECKPOINT_INTERVAL === 0) {
        await this.createCheckpoint(block);
      }
    }

    logger.debug(`[Phase 31] Initialized ${this.checkpoints.size} checkpoints from chain`);
  }
}

