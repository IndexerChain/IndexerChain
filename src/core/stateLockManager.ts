/**
 * Phase 36: State Lock Manager
 * 
 * Manages state commitment locks based on supermajority consensus (2/3+).
 * When 2/3+ independent nodes agree on the same state commitment at the same height,
 * a State Lock is formed, which acts as a soft finality stronger than PoW probability finality.
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { getStateCommitGossip } from "./stateCommitGossip.js";
import { getQuorumManager } from "./quorumManager.js";

/**
 * State Lock
 * 
 * Represents a locked state commitment at a specific height
 */
export interface StateLock {
  height: number;
  stateCommitment: string;
  tipHash: string;
  quorum: number; // Percentage of independent peers (0-100)
  independentPeerCount: number;
  totalPeerCount: number;
  timestamp: number;
  locked: boolean; // true if quorum >= 66.67% (2/3+)
}

/**
 * State Lock Manager
 * 
 * Manages state locks based on supermajority consensus
 */
export class StateLockManager {
  private chainContext: ChainContext | null = null;
  private p2pNode: P2PNode | null = null;
  private currentLock: StateLock | null = null;
  private lockCheckInterval: any = null;
  private readonly LOCK_CHECK_INTERVAL_MS = 5000; // Check every 5 seconds
  private readonly SUPERMAJORITY_THRESHOLD = 66.67; // 2/3 threshold

  private static instance: StateLockManager;

  private constructor() {}

  static getInstance(): StateLockManager {
    if (!StateLockManager.instance) {
      StateLockManager.instance = new StateLockManager();
    }
    return StateLockManager.instance;
  }

  /**
   * Initialize the state lock manager
   */
  initialize(chainContext: ChainContext, p2pNode: P2PNode): void {
    this.chainContext = chainContext;
    this.p2pNode = p2pNode;
    this.startLockChecking();
  }

  /**
   * Start checking for state locks
   */
  private startLockChecking(): void {
    if (this.lockCheckInterval) {
      clearInterval(this.lockCheckInterval);
    }

    this.lockCheckInterval = setInterval(() => {
      this.checkAndUpdateLock();
    }, this.LOCK_CHECK_INTERVAL_MS);

    // Check immediately
    this.checkAndUpdateLock();
  }

  /**
   * Check and update the current state lock
   */
  private checkAndUpdateLock(): void {
    if (!this.chainContext || !this.p2pNode) {
      return;
    }

    const tip = this.chainContext.storage.getTip();
    if (!tip) {
      return;
    }

    const currentHeight = tip.header.height;
    const gossip = getStateCommitGossip();
    const majorityCommit = gossip.getMajorityStateCommit(currentHeight);

    if (!majorityCommit) {
      // No majority state commit found
      this.currentLock = null;
      return;
    }

    // Check if we have supermajority (2/3+)
    const quorumManager = getQuorumManager();
    quorumManager.initialize(this.p2pNode, this.chainContext);

    const locked = majorityCommit.quorum >= this.SUPERMAJORITY_THRESHOLD;

    // Create or update state lock
    this.currentLock = {
      height: currentHeight,
      stateCommitment: majorityCommit.stateCommitment,
      tipHash: majorityCommit.tipHash,
      quorum: majorityCommit.quorum,
      independentPeerCount: majorityCommit.independentCount,
      totalPeerCount: majorityCommit.count,
      timestamp: Date.now(),
      locked,
    };

    if (locked) {
      // Only log if this is a new lock (height changed) to avoid spam
      const lastLockedHeight = (this as any).lastLockedHeight || 0;
      if (currentHeight > lastLockedHeight) {
        (this as any).lastLockedHeight = currentHeight;
        console.log(`[Phase 36] State Lock formed at height ${currentHeight}:`, {
          stateCommitment: majorityCommit.stateCommitment.substring(0, 16) + "...",
          quorum: majorityCommit.quorum.toFixed(2) + "%",
          independentPeers: majorityCommit.independentCount,
        });
      }
    }
  }

  /**
   * Get the current state lock
   */
  getCurrentLock(): StateLock | null {
    return this.currentLock;
  }

  /**
   * Check if we have a valid state lock
   */
  hasValidLock(): boolean {
    return this.currentLock !== null && this.currentLock.locked;
  }

  /**
   * Check if our local state matches the locked state commitment
   */
  checkLocalStateMatchesLock(): boolean {
    if (!this.chainContext || !this.currentLock || !this.currentLock.locked) {
      return false;
    }

    const tip = this.chainContext.storage.getTip();
    if (!tip) {
      return false;
    }

    // Check height matches
    if (tip.header.height !== this.currentLock.height) {
      return false;
    }

    // Check state commitment matches
    const localStateCommitment = tip.header.stateCommitment || "";
    return localStateCommitment === this.currentLock.stateCommitment;
  }

  /**
   * Get the locked state commitment for block building
   * This should be written to the block header as lockedStateCommitment
   */
  getLockedStateCommitment(): string | null {
    if (!this.hasValidLock()) {
      return null;
    }

    return this.currentLock!.stateCommitment;
  }

  /**
   * Check if we should allow mining based on state lock
   */
  canMineBasedOnLock(): {
    allowed: boolean;
    reason?: string;
  } {
    if (!this.currentLock) {
      return {
        allowed: false,
        reason: "No state lock available",
      };
    }

    if (!this.currentLock.locked) {
      return {
        allowed: false,
        reason: `State lock not formed (quorum: ${this.currentLock.quorum.toFixed(2)}% < ${this.SUPERMAJORITY_THRESHOLD}%)`,
      };
    }

    if (!this.checkLocalStateMatchesLock()) {
      return {
        allowed: false,
        reason: "Local state does not match locked state commitment",
      };
    }

    return {
      allowed: true,
    };
  }

  /**
   * Destroy the state lock manager
   */
  destroy(): void {
    if (this.lockCheckInterval) {
      clearInterval(this.lockCheckInterval);
      this.lockCheckInterval = null;
    }
    this.currentLock = null;
    this.chainContext = null;
    this.p2pNode = null;
  }
}

/**
 * Get the singleton instance
 */
export const getStateLockManager = () => StateLockManager.getInstance();

