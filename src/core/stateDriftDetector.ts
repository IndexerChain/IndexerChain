/**
 * Phase 36: State Drift Detector
 * 
 * Detects when local state diverges from the majority state commitment.
 * Triggers state repair when drift is detected.
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { getStateCommitGossip } from "./stateCommitGossip.js";
import { getStateLockManager } from "./stateLockManager.js";

/**
 * State drift detection result
 */
export interface StateDriftResult {
  hasDrift: boolean;
  localHeight: number;
  localStateCommitment: string;
  majorityHeight: number;
  majorityStateCommitment: string | null;
  driftType: "height_mismatch" | "commitment_mismatch" | "none";
  severity: "critical" | "warning" | "none";
  reason?: string;
}

/**
 * State Drift Detector
 * 
 * Monitors state consistency and detects drift
 */
export class StateDriftDetector {
  private chainContext: ChainContext | null = null;
  private p2pNode: P2PNode | null = null;
  private checkInterval: any = null;
  private readonly CHECK_INTERVAL_MS = 10000; // Check every 10 seconds
  private lastDriftCheck: StateDriftResult | null = null;
  private lastDriftLogTime: number = 0;
  private readonly DRIFT_LOG_COOLDOWN_MS = 60000; // Only log drift once per minute

  private static instance: StateDriftDetector;

  private constructor() {}

  static getInstance(): StateDriftDetector {
    if (!StateDriftDetector.instance) {
      StateDriftDetector.instance = new StateDriftDetector();
    }
    return StateDriftDetector.instance;
  }

  /**
   * Initialize the drift detector
   */
  initialize(chainContext: ChainContext, p2pNode: P2PNode): void {
    this.chainContext = chainContext;
    this.p2pNode = p2pNode;
    this.startDriftChecking();
  }

  /**
   * Start checking for state drift
   */
  private startDriftChecking(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.checkDrift();
    }, this.CHECK_INTERVAL_MS);

    // Check immediately
    this.checkDrift();
  }

  /**
   * Check for state drift
   */
  checkDrift(): StateDriftResult {
    if (!this.chainContext || !this.p2pNode) {
      return {
        hasDrift: false,
        localHeight: 0,
        localStateCommitment: "",
        majorityHeight: 0,
        majorityStateCommitment: null,
        driftType: "none",
        severity: "none",
      };
    }

    const tip = this.chainContext.storage.getTip();
    if (!tip) {
      return {
        hasDrift: false,
        localHeight: 0,
        localStateCommitment: "",
        majorityHeight: 0,
        majorityStateCommitment: null,
        driftType: "none",
        severity: "none",
      };
    }

    const localHeight = tip.header.height;
    const localStateCommitment = tip.header.stateCommitment || "";

    // Get majority state commit from gossip
    const gossip = getStateCommitGossip();
    const majorityCommit = gossip.getMajorityStateCommit(localHeight);
    const latestHeight = gossip.getLatestHeight();

    // Check for height mismatch
    if (latestHeight > 0 && localHeight < latestHeight) {
      // We're behind
      this.lastDriftCheck = {
        hasDrift: true,
        localHeight,
        localStateCommitment,
        majorityHeight: latestHeight,
        majorityStateCommitment: null,
        driftType: "height_mismatch",
        severity: "warning",
        reason: `Local height ${localHeight} is behind majority height ${latestHeight}`,
      };
      return this.lastDriftCheck;
    }

    // Check for state commitment mismatch
    if (majorityCommit && localStateCommitment !== majorityCommit.stateCommitment) {
      // Critical drift: same height but different state
      // Only log as warning if we don't have enough peers to determine true majority
      const commits = gossip.getStateCommitsForHeight(localHeight);
      const isTrueMajority = commits.length >= 2;
      
      this.lastDriftCheck = {
        hasDrift: true,
        localHeight,
        localStateCommitment,
        majorityHeight: localHeight,
        majorityStateCommitment: majorityCommit.stateCommitment,
        driftType: "commitment_mismatch",
        severity: isTrueMajority ? "critical" : "warning",
        reason: `State commitment mismatch at height ${localHeight}: local=${localStateCommitment.substring(0, 16)}..., majority=${majorityCommit.stateCommitment.substring(0, 16)}...`,
      };

      // Only log drift detection once per minute to avoid spam
      const now = Date.now();
      const shouldLog = now - this.lastDriftLogTime > this.DRIFT_LOG_COOLDOWN_MS;
      
      if (isTrueMajority) {
        if (shouldLog) {
          this.lastDriftLogTime = now;
        }
      } else {
        // For insufficient peers, use debug level and only log once per minute
        if (shouldLog) {
          this.lastDriftLogTime = now;
        }
      }
      return this.lastDriftCheck;
    }

    // Check state lock
    const lockManager = getStateLockManager();
    lockManager.initialize(this.chainContext, this.p2pNode);
    const lock = lockManager.getCurrentLock();

    if (lock && lock.locked) {
      // We have a locked state, check if we match
      if (!lockManager.checkLocalStateMatchesLock()) {
        this.lastDriftCheck = {
          hasDrift: true,
          localHeight,
          localStateCommitment,
          majorityHeight: lock.height,
          majorityStateCommitment: lock.stateCommitment,
          driftType: "commitment_mismatch",
          severity: "critical",
          reason: `Local state does not match locked state at height ${lock.height}`,
        };

        // Only log once per minute
        const now = Date.now();
        if (now - this.lastDriftLogTime > this.DRIFT_LOG_COOLDOWN_MS) {
          this.lastDriftLogTime = now;
        }
        return this.lastDriftCheck;
      }
    }

    // No drift detected
    this.lastDriftCheck = {
      hasDrift: false,
      localHeight,
      localStateCommitment,
      majorityHeight: majorityCommit ? localHeight : latestHeight,
      majorityStateCommitment: majorityCommit?.stateCommitment || null,
      driftType: "none",
      severity: "none",
    };

    return this.lastDriftCheck;
  }

  /**
   * Get the last drift check result
   */
  getLastDriftCheck(): StateDriftResult | null {
    return this.lastDriftCheck;
  }

  /**
   * Check if critical drift is detected
   */
  hasCriticalDrift(): boolean {
    return this.lastDriftCheck !== null && 
           this.lastDriftCheck.hasDrift && 
           this.lastDriftCheck.severity === "critical";
  }

  /**
   * Destroy the drift detector
   */
  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.lastDriftCheck = null;
    this.chainContext = null;
    this.p2pNode = null;
  }
}

/**
 * Get the singleton instance
 */
export const getStateDriftDetector = () => StateDriftDetector.getInstance();

