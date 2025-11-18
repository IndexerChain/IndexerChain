/**
 * Phase 36: State Repair
 * 
 * Automatically repairs state drift by:
 * 1. Pausing local mining
 * 2. Requesting latest checkpoint + delta snapshot
 * 3. Quickly rebuilding local state
 * 4. Realigning with majority state before resuming mining
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { getStateDriftDetector, type StateDriftResult } from "./stateDriftDetector.js";
import { getStateCommitGossip } from "./stateCommitGossip.js";
import { getStateLockManager } from "./stateLockManager.js";

/**
 * State repair status
 */
export interface StateRepairStatus {
  repairing: boolean;
  progress: number; // 0-100
  step: "paused" | "requesting" | "rebuilding" | "verifying" | "completed" | "failed";
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

/**
 * State Repair Manager
 * 
 * Manages automatic state repair when drift is detected
 */
export class StateRepairManager {
  private chainContext: ChainContext | null = null;
  private p2pNode: P2PNode | null = null;
  private repairStatus: StateRepairStatus = {
    repairing: false,
    progress: 0,
    step: "paused",
  };
  private onRepairComplete?: () => void;
  private onRepairFailed?: (error: string) => void;

  private static instance: StateRepairManager;

  private constructor() {}

  static getInstance(): StateRepairManager {
    if (!StateRepairManager.instance) {
      StateRepairManager.instance = new StateRepairManager();
    }
    return StateRepairManager.instance;
  }

  /**
   * Initialize the repair manager
   */
  initialize(chainContext: ChainContext, p2pNode: P2PNode): void {
    this.chainContext = chainContext;
    this.p2pNode = p2pNode;
  }

  /**
   * Start state repair process
   */
  async startRepair(
    driftResult: StateDriftResult,
    onComplete?: () => void,
    onFailed?: (error: string) => void
  ): Promise<void> {
    if (this.repairStatus.repairing) {
      console.warn("[Phase 36] Repair already in progress");
      return;
    }

    this.onRepairComplete = onComplete;
    this.onRepairFailed = onFailed;
    this.repairStatus = {
      repairing: true,
      progress: 0,
      step: "paused",
      startedAt: Date.now(),
    };

    console.log(`[Phase 36] Starting state repair:`, driftResult);

    try {
      // Step 1: Pause mining (already handled by MiningGuard)
      this.repairStatus.step = "paused";
      this.repairStatus.progress = 10;
      await this.delay(100);

      // Step 2: Request latest checkpoint and delta snapshot
      this.repairStatus.step = "requesting";
      this.repairStatus.progress = 20;
      await this.requestLatestSnapshot(driftResult);

      // Step 3: Rebuild local state
      this.repairStatus.step = "rebuilding";
      this.repairStatus.progress = 50;
      await this.rebuildState(driftResult);

      // Step 4: Verify state matches majority
      this.repairStatus.step = "verifying";
      this.repairStatus.progress = 80;
      const verified = await this.verifyStateAlignment(driftResult);

      if (!verified) {
        throw new Error("State verification failed after repair");
      }

      // Step 5: Complete
      this.repairStatus.step = "completed";
      this.repairStatus.progress = 100;
      this.repairStatus.completedAt = Date.now();

      console.log(`[Phase 36] State repair completed successfully`);

      if (this.onRepairComplete) {
        this.onRepairComplete();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Phase 36] State repair failed:`, errorMessage);

      this.repairStatus.step = "failed";
      this.repairStatus.error = errorMessage;

      if (this.onRepairFailed) {
        this.onRepairFailed(errorMessage);
      }
    } finally {
      // Reset repair status after a delay
      setTimeout(() => {
        this.repairStatus = {
          repairing: false,
          progress: 0,
          step: "paused",
        };
      }, 5000);
    }
  }

  /**
   * Request latest snapshot from peers
   */
  private async requestLatestSnapshot(driftResult: StateDriftResult): Promise<void> {
    if (!this.p2pNode || !this.chainContext) {
      throw new Error("P2P node or chain context not available");
    }

    const targetHeight = driftResult.majorityHeight;
    const gossip = getStateCommitGossip();
    const commits = gossip.getStateCommitsForHeight(targetHeight);

    if (commits.length === 0) {
      throw new Error(`No peers available for height ${targetHeight}`);
    }

    // Request snapshot from peers (this would trigger snapshot sync)
    // For now, we'll use the existing snapshot sync mechanism
    console.log(`[Phase 36] Requesting snapshot for height ${targetHeight} from ${commits.length} peer(s)`);

    // The actual snapshot request would be handled by the existing sync mechanism
    // This is a placeholder for the actual implementation
    await this.delay(1000);
  }

  /**
   * Rebuild local state from snapshot
   */
  private async rebuildState(driftResult: StateDriftResult): Promise<void> {
    if (!this.chainContext) {
      throw new Error("Chain context not available");
    }

    console.log(`[Phase 36] Rebuilding state to match majority at height ${driftResult.majorityHeight}`);

    // This would trigger a full state rebuild from snapshot
    // The actual implementation would:
    // 1. Load the latest snapshot
    // 2. Apply all blocks from snapshot height to target height
    // 3. Verify state commitment matches

    // For now, this is a placeholder
    await this.delay(2000);
  }

  /**
   * Verify that state is aligned with majority
   */
  private async verifyStateAlignment(driftResult: StateDriftResult): Promise<boolean> {
    if (!this.chainContext || !this.p2pNode) {
      return false;
    }

    const tip = this.chainContext.storage.getTip();
    if (!tip) {
      return false;
    }

    // Check height matches
    if (tip.header.height !== driftResult.majorityHeight) {
      console.warn(`[Phase 36] Height mismatch after repair: ${tip.header.height} != ${driftResult.majorityHeight}`);
      return false;
    }

    // Check state commitment matches
    const localStateCommitment = tip.header.stateCommitment || "";
    if (driftResult.majorityStateCommitment && localStateCommitment !== driftResult.majorityStateCommitment) {
      console.warn(`[Phase 36] State commitment mismatch after repair`);
      return false;
    }

    // Verify with state lock manager
    const lockManager = getStateLockManager();
    lockManager.initialize(this.chainContext, this.p2pNode);
    const matchesLock = lockManager.checkLocalStateMatchesLock();

    if (!matchesLock && lockManager.hasValidLock()) {
      console.warn(`[Phase 36] State does not match locked state after repair`);
      return false;
    }

    // Re-check drift
    const driftDetector = getStateDriftDetector();
    driftDetector.initialize(this.chainContext, this.p2pNode);
    const newDriftCheck = driftDetector.checkDrift();

    if (newDriftCheck.hasDrift && newDriftCheck.severity === "critical") {
      console.warn(`[Phase 36] Critical drift still present after repair`);
      return false;
    }

    return true;
  }

  /**
   * Get current repair status
   */
  getRepairStatus(): StateRepairStatus {
    return { ...this.repairStatus };
  }

  /**
   * Check if repair is in progress
   */
  isRepairing(): boolean {
    return this.repairStatus.repairing;
  }

  /**
   * Helper: Delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Destroy the repair manager
   */
  destroy(): void {
    this.repairStatus = {
      repairing: false,
      progress: 0,
      step: "paused",
    };
    this.chainContext = null;
    this.p2pNode = null;
    this.onRepairComplete = undefined;
    this.onRepairFailed = undefined;
  }
}

/**
 * Get the singleton instance
 */
export const getStateRepairManager = () => StateRepairManager.getInstance();

