/**
 * Phase 31: P2P Gossip Consensus on Tip Height
 * 
 * Ensures all nodes maintain consistent tip height through gossip consensus.
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { logger } from "./logger.js";

/**
 * Height vote from peer
 */
export interface HeightVote {
  height: number;
  tipHash: string;
  peerId: string;
  timestamp: number;
}

/**
 * Height consensus result
 */
export interface HeightConsensusResult {
  localHeight: number;
  localTipHash: string;
  majorityHeight: number;
  majorityTipHash: string;
  heightHistogram: Map<number, number>; // height -> count
  isConsistent: boolean;
  action?: "SYNC" | "STOP_MINING" | "NONE";
  reason?: string;
}

/**
 * Height Consensus Manager
 * 
 * Manages tip height consensus through gossip protocol.
 */
export class HeightConsensusManager {
  private voteInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private heightVotes: Map<string, HeightVote> = new Map(); // peerId -> vote
  private onConsensusAction: ((result: HeightConsensusResult) => Promise<void>) | null = null;

  constructor(
    private chainContext: ChainContext,
    private p2pNode: P2PNode | null
  ) {}

  /**
   * Start height consensus
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    logger.debug("[Phase 31] Starting Height Consensus Manager...");
    
    // Broadcast height vote every 30 seconds
    this.voteInterval = setInterval(() => {
      this.broadcastHeightVote().catch(_err => {
      });
    }, 30000);
    
    // Initial vote after 5 seconds
    setTimeout(() => {
      this.broadcastHeightVote().catch(_err => {
      });
    }, 5000);
    
    // Check consensus every 10 seconds
    setInterval(() => {
      this.checkConsensus().catch(_err => {
      });
    }, 10000);
  }

  /**
   * Stop height consensus
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    if (this.voteInterval) {
      clearInterval(this.voteInterval);
      this.voteInterval = null;
    }
    
    logger.debug("[Phase 31] Stopped Height Consensus Manager.");
  }

  /**
   * Set callback for when consensus action is needed
   */
  setOnConsensusAction(callback: (result: HeightConsensusResult) => Promise<void>): void {
    this.onConsensusAction = callback;
  }

  /**
   * Handle height vote from peer
   */
  onHeightVote(vote: HeightVote): void {
    // Update vote for this peer
    this.heightVotes.set(vote.peerId, vote);
    
    // Clean up old votes (older than 2 minutes)
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
    for (const [peerId, v] of this.heightVotes.entries()) {
      if (v.timestamp < twoMinutesAgo) {
        this.heightVotes.delete(peerId);
      }
    }
  }

  /**
   * Broadcast local height vote
   */
  private async broadcastHeightVote(): Promise<void> {
    if (!this.p2pNode || !this.p2pNode.isConnected) {
      return;
    }

    const localTip = this.chainContext.storage.getTip();
    if (!localTip) {
      return;
    }

    const vote: HeightVote = {
      height: localTip.header.height,
      tipHash: localTip.hash,
      peerId: this.p2pNode.nodeId,
      timestamp: Date.now(),
    };

    if (this.p2pNode.broadcast) {
      this.p2pNode.broadcast("HEIGHT_VOTE", vote);
    }
  }

  /**
   * Check consensus and determine action
   */
  async checkConsensus(): Promise<void> {
    if (!this.p2pNode || !this.p2pNode.isConnected) {
      return;
    }

    const peerCount = this.p2pNode.getPeerCount();
    if (peerCount < 3) {
      // Need at least 3 peers for reliable consensus
      return;
    }

    const localTip = this.chainContext.storage.getTip();
    if (!localTip) {
      return;
    }

    const localHeight = localTip.header.height;
    const localTipHash = localTip.hash;

    // Build height histogram
    const heightHistogram = new Map<number, number>();
    const tipHashByHeight = new Map<number, Set<string>>();

    for (const vote of this.heightVotes.values()) {
      const count = heightHistogram.get(vote.height) || 0;
      heightHistogram.set(vote.height, count + 1);

      if (!tipHashByHeight.has(vote.height)) {
        tipHashByHeight.set(vote.height, new Set());
      }
      tipHashByHeight.get(vote.height)!.add(vote.tipHash);
    }
    
    // tipHashByHeight is used below to find majority tip hash

    // Find majority height
    let majorityHeight = localHeight;
    let majorityCount = 0;

    for (const [height, count] of heightHistogram.entries()) {
      if (count > majorityCount) {
        majorityCount = count;
        majorityHeight = height;
      }
    }

    // Find majority tip hash at majority height
    const tipHashCounts = new Map<string, number>();

    for (const vote of this.heightVotes.values()) {
      if (vote.height === majorityHeight) {
        const count = tipHashCounts.get(vote.tipHash) || 0;
        tipHashCounts.set(vote.tipHash, count + 1);
      }
    }

    let majorityTipHash = localTipHash;
    let majorityTipHashCount = 0;

    for (const [hash, count] of tipHashCounts.entries()) {
      if (count > majorityTipHashCount) {
        majorityTipHashCount = count;
        majorityTipHash = hash;
      }
    }

    // Determine if consistent
    const heightDiff = localHeight - majorityHeight;
    const isConsistent = Math.abs(heightDiff) <= 3 && localTipHash === majorityTipHash;

    // Determine action
    let action: "SYNC" | "STOP_MINING" | "NONE" = "NONE";
    let reason: string | undefined;

    if (!isConsistent) {
      if (heightDiff < -3) {
        // Local is behind
        action = "SYNC";
        reason = `Local height ${localHeight} is ${Math.abs(heightDiff)} blocks behind majority ${majorityHeight}`;
      } else if (heightDiff > 3) {
        // Local is ahead (possible fork)
        action = "STOP_MINING";
        reason = `Local height ${localHeight} is ${heightDiff} blocks ahead of majority ${majorityHeight}. Possible fork detected.`;
      } else if (localTipHash !== majorityTipHash) {
        // Same height but different tip hash (fork at same height)
        action = "STOP_MINING";
        reason = `Local tip hash differs from majority at height ${localHeight}. Fork detected.`;
      }
    }

    const result: HeightConsensusResult = {
      localHeight,
      localTipHash,
      majorityHeight,
      majorityTipHash,
      heightHistogram,
      isConsistent,
      action,
      reason,
    };

    // Trigger action if needed
    if (action !== "NONE" && this.onConsensusAction) {
      await this.onConsensusAction(result);
    }
  }

  /**
   * Get latest consensus result
   */
  getLatestConsensus(): HeightConsensusResult | null {
    // This would be populated by checkConsensus
    // For now, return null as we handle consensus immediately
    return null;
  }
}

