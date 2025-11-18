/**
 * Phase 30: Mining Statistics & Effectiveness Tracking
 * 
 * Tracks mining effectiveness:
 * - Accepted blocks (blocks that made it to the chain)
 * - Rejected/orphaned blocks (blocks that were mined but not accepted)
 * - Effectiveness rate
 */

/**
 * Mining statistics
 */
export interface MiningStats {
  acceptedBlocks: number;
  rejectedBlocks: number;
  orphanedBlocks: number;
  totalBlocksMined: number;
  effectivenessRate: number; // (accepted / total) * 100
  lastAcceptedBlockHeight?: number;
  lastAcceptedBlockHash?: string;
  lastRejectedBlockHeight?: number;
  lastRejectedBlockHash?: string;
  lastRejectedReason?: string;
}

/**
 * Mining Statistics Tracker
 */
export class MiningStatsTracker {
  private stats: MiningStats = {
    acceptedBlocks: 0,
    rejectedBlocks: 0,
    orphanedBlocks: 0,
    totalBlocksMined: 0,
    effectivenessRate: 0,
  };

  private recentMinedBlocks: Map<string, {
    height: number;
    hash: string;
    timestamp: number;
    minerAddress: string;
  }> = new Map();

  /**
   * Record that a block was mined (before broadcasting)
   */
  recordBlockMined(height: number, hash: string, minerAddress: string): void {
    this.stats.totalBlocksMined++;
    this.recentMinedBlocks.set(hash, {
      height,
      hash,
      timestamp: Date.now(),
      minerAddress,
    });
    
    // Clean up old entries (older than 1 hour)
    const oneHourAgo = Date.now() - 3600000;
    for (const [h, block] of this.recentMinedBlocks.entries()) {
      if (block.timestamp < oneHourAgo) {
        this.recentMinedBlocks.delete(h);
      }
    }
    
    this.updateEffectivenessRate();
  }

  /**
   * Record that a mined block was accepted (appended to chain)
   */
  recordBlockAccepted(height: number, hash: string): void {
    const block = this.recentMinedBlocks.get(hash);
    if (block) {
      this.stats.acceptedBlocks++;
      this.stats.lastAcceptedBlockHeight = height;
      this.stats.lastAcceptedBlockHash = hash;
      this.recentMinedBlocks.delete(hash);
    } else {
      // Block was accepted but we didn't track it as mined
      // This can happen if stats were reset or block was mined before tracking started
      this.stats.acceptedBlocks++;
      this.stats.lastAcceptedBlockHeight = height;
      this.stats.lastAcceptedBlockHash = hash;
    }
    
    this.updateEffectivenessRate();
  }

  /**
   * Record that a mined block was rejected/orphaned
   */
  recordBlockRejected(hash: string, reason?: string): void {
    const block = this.recentMinedBlocks.get(hash);
    if (block) {
      this.stats.rejectedBlocks++;
      this.stats.orphanedBlocks++; // Rejected blocks are considered orphaned
      this.stats.lastRejectedBlockHeight = block.height;
      this.stats.lastRejectedBlockHash = hash;
      this.stats.lastRejectedReason = reason;
      this.recentMinedBlocks.delete(hash);
    } else {
      // Block was rejected but we didn't track it
      this.stats.rejectedBlocks++;
      this.stats.orphanedBlocks++;
      this.stats.lastRejectedReason = reason;
    }
    
    this.updateEffectivenessRate();
  }

  /**
   * Check if a block was recently mined by this node
   */
  wasMinedByThisNode(hash: string): boolean {
    return this.recentMinedBlocks.has(hash);
  }

  /**
   * Get current statistics
   */
  getStats(): MiningStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.stats = {
      acceptedBlocks: 0,
      rejectedBlocks: 0,
      orphanedBlocks: 0,
      totalBlocksMined: 0,
      effectivenessRate: 0,
    };
    this.recentMinedBlocks.clear();
  }

  /**
   * Update effectiveness rate
   */
  private updateEffectivenessRate(): void {
    const total = this.stats.totalBlocksMined;
    if (total > 0) {
      this.stats.effectivenessRate = (this.stats.acceptedBlocks / total) * 100;
    } else {
      this.stats.effectivenessRate = 0;
    }
  }

  /**
   * Check if mining effectiveness is concerning
   * Returns true if we've been mining but all blocks are rejected
   */
  isEffectivenessConcerning(): boolean {
    // If we've mined at least 3 blocks in the last 10 minutes and all were rejected
    const tenMinutesAgo = Date.now() - 600000;
    const recentMined = Array.from(this.recentMinedBlocks.values()).filter(
      b => b.timestamp > tenMinutesAgo
    );
    
    if (recentMined.length >= 3 && this.stats.acceptedBlocks === 0 && this.stats.rejectedBlocks > 0) {
      return true;
    }
    
    // Or if effectiveness rate is very low (< 10%) and we've mined at least 10 blocks
    if (this.stats.totalBlocksMined >= 10 && this.stats.effectivenessRate < 10) {
      return true;
    }
    
    return false;
  }
}

// Global instance
let globalMiningStatsTracker: MiningStatsTracker | null = null;

/**
 * Get global mining stats tracker
 */
export function getMiningStatsTracker(): MiningStatsTracker {
  if (!globalMiningStatsTracker) {
    globalMiningStatsTracker = new MiningStatsTracker();
  }
  return globalMiningStatsTracker;
}

