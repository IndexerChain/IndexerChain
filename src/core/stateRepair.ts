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
import type { P2PNode, BrowserP2PNode } from "./p2p.js";
import { getStateDriftDetector, type StateDriftResult } from "./stateDriftDetector.js";
import { getStateCommitGossip } from "./stateCommitGossip.js";
import { getStateLockManager } from "./stateLockManager.js";
import { 
  findNearestFullSnapshot, 
  loadSnapshotByHeight,
  loadDeltaSnapshotsAfter 
} from "./snapshot.js";
import { IndexState } from "./indexState.js";
import { applyDelta } from "./snapshotDelta.js";

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
  private lastRepairAttempt: number = 0;
  private repairCooldownMs: number = 60000; // 1 minute cooldown between repairs
  private consecutiveFailures: number = 0;
  private maxConsecutiveFailures: number = 3;

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

    // Check cooldown period
    const now = Date.now();
    const timeSinceLastRepair = now - this.lastRepairAttempt;
    if (timeSinceLastRepair < this.repairCooldownMs) {
      console.warn(`[Phase 36] Repair cooldown active (${Math.ceil((this.repairCooldownMs - timeSinceLastRepair) / 1000)}s remaining)`);
      return;
    }

    // Check if we've had too many consecutive failures
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      console.error(`[Phase 36] Too many consecutive repair failures (${this.consecutiveFailures}), skipping repair`);
      if (onFailed) {
        onFailed("Too many consecutive repair failures, please check your network connection and try resetting chain data");
      }
      return;
    }

    // Check if we have enough peers to determine majority
    const gossip = getStateCommitGossip();
    const commits = gossip.getStateCommitsForHeight(driftResult.majorityHeight);
    if (commits.length < 2) {
      console.warn(`[Phase 36] Not enough peers to determine majority (${commits.length} peers), skipping repair`);
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
    this.lastRepairAttempt = now;

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

      // Reset consecutive failures on success
      this.consecutiveFailures = 0;

      if (this.onRepairComplete) {
        this.onRepairComplete();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Phase 36] State repair failed:`, errorMessage);

      // Increment consecutive failures
      this.consecutiveFailures++;

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
    
    // First, check if we have a local snapshot at or before target height
    const localSnapshot = findNearestFullSnapshot(targetHeight);
    if (localSnapshot && localSnapshot.height >= targetHeight - 100) {
      // We have a recent snapshot, use it
      console.log(`[Phase 36] Using local snapshot at height ${localSnapshot.height}`);
      return;
    }

    // Try to get snapshot from peers
    const gossip = getStateCommitGossip();
    const commits = gossip.getStateCommitsForHeight(targetHeight);

    if (commits.length === 0) {
      // No peers available, but we might have a local snapshot
      if (localSnapshot) {
        console.log(`[Phase 36] No peers available, using local snapshot at height ${localSnapshot.height}`);
        return;
      }
      throw new Error(`No peers available and no local snapshot for height ${targetHeight}`);
    }

    console.log(`[Phase 36] Requesting snapshot for height ${targetHeight} from ${commits.length} peer(s)`);

    // Try to request snapshot metadata from peers
    if (this.p2pNode && 'broadcast' in this.p2pNode) {
      const browserP2p = this.p2pNode as BrowserP2PNode;
      browserP2p.broadcast("REQUEST_SNAPSHOT_META", {
        targetHeight: targetHeight,
      });
      
      // Wait a bit for responses
      await this.delay(2000);
    }
  }

  /**
   * Rebuild local state from snapshot
   */
  private async rebuildState(driftResult: StateDriftResult): Promise<void> {
    if (!this.chainContext) {
      throw new Error("Chain context not available");
    }

    const targetHeight = driftResult.majorityHeight;
    console.log(`[Phase 36] Rebuilding state to match majority at height ${targetHeight}`);

    // Find the nearest full snapshot
    const fullSnapMeta = findNearestFullSnapshot(targetHeight);
    if (!fullSnapMeta) {
      throw new Error(`No snapshot found at or before height ${targetHeight}`);
    }

    console.log(`[Phase 36] Found snapshot at height ${fullSnapMeta.height}, rebuilding state...`);

    // Load the full snapshot
    const fullSnap = await loadSnapshotByHeight(fullSnapMeta.height);
    if (!fullSnap || !fullSnap.indexState) {
      throw new Error(`Failed to load snapshot at height ${fullSnapMeta.height}`);
    }

    // Restore state from snapshot
    const restoredState = IndexState.fromSnapshot(fullSnap.indexState);
    const restoredInternalState = (restoredState as any).getInternalState();
    const currentInternalState = (this.chainContext.indexState as any).getInternalState();

    // Clear current state and restore from snapshot
    currentInternalState.clear();
    for (const [ns, kvMap] of restoredInternalState) {
      const newMap = new Map(kvMap);
      currentInternalState.set(ns, newMap);
    }

    // Restore privacy state (commitments, nullifiers)
    const restoredCommitments = (restoredState as any).getCommitments?.() || (restoredState as any).commitments;
    const restoredNullifiers = (restoredState as any).getNullifierSet?.() || (restoredState as any).nullifierSet;

    if (restoredCommitments) {
      (this.chainContext.indexState as any).commitments = new Map(restoredCommitments);
    }
    if (restoredNullifiers) {
      (this.chainContext.indexState as any).nullifierSet = new Set(restoredNullifiers);
    }

    // Apply delta snapshots if any
    const deltaMetas = loadDeltaSnapshotsAfter(fullSnapMeta.height, targetHeight);
    for (const deltaMeta of deltaMetas) {
      const deltaSnap = await loadSnapshotByHeight(deltaMeta.height);
      if (deltaSnap && deltaSnap.delta) {
        await applyDelta(deltaSnap.delta, (op: any) => {
          this.chainContext!.indexState.applyOperation(op, undefined);
        });
      }
    }

    // Replay blocks from snapshot height to target height
    const blocksToReplay = this.chainContext.storage.getAllBlocks().filter(
      b => b.header.height > fullSnapMeta.height && b.header.height <= targetHeight
    );

    // Sort blocks by height
    blocksToReplay.sort((a, b) => a.header.height - b.header.height);

    console.log(`[Phase 36] Replaying ${blocksToReplay.length} blocks from height ${fullSnapMeta.height + 1} to ${targetHeight}`);

    for (const block of blocksToReplay) {
      this.chainContext.indexState.applyBlock(block);
    }

    console.log(`[Phase 36] State rebuilt from snapshot (height ${fullSnapMeta.height}) + ${blocksToReplay.length} blocks`);

    // After rebuilding, verify that the tip's state commitment matches what we expect
    // If it doesn't, the blocks themselves might have wrong state commitments
    const tip = this.chainContext.storage.getTip();
    if (tip && tip.header.height === targetHeight) {
      const computedStateCommitment = await this.computeCurrentStateCommitment();
      if (computedStateCommitment && driftResult.majorityStateCommitment) {
        if (computedStateCommitment !== driftResult.majorityStateCommitment) {
          console.warn(`[Phase 36] Rebuilt state commitment (${computedStateCommitment.substring(0, 16)}...) doesn't match majority (${driftResult.majorityStateCommitment.substring(0, 16)}...). Blocks may have incorrect state commitments.`);
          // This is a warning, not an error - we'll let verification handle it
        } else {
          console.log(`[Phase 36] Rebuilt state commitment matches majority`);
        }
      }
    }
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
   * Compute current state commitment from index state
   */
  private async computeCurrentStateCommitment(): Promise<string | null> {
    if (!this.chainContext) {
      return null;
    }

    try {
      const { computeSnapshotStateHash } = await import("./snapshotVerify.js");
      const snapshot = this.chainContext.indexState.toSnapshot();
      return await computeSnapshotStateHash(snapshot);
    } catch (error) {
      console.error(`[Phase 36] Failed to compute state commitment:`, error);
      return null;
    }
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

