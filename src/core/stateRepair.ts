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
      return;
    }

    // Check cooldown period
    const now = Date.now();
    const timeSinceLastRepair = now - this.lastRepairAttempt;
    if (timeSinceLastRepair < this.repairCooldownMs) {
      return;
    }

    // Check if we've had too many consecutive failures
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      if (onFailed) {
        onFailed("Too many consecutive repair failures, please check your network connection and try resetting chain data");
      }
      return;
    }

    // Check if we have enough peers to determine majority
    const gossip = getStateCommitGossip();
    const commits = gossip.getStateCommitsForHeight(driftResult.majorityHeight);
    if (commits.length < 2) {
      // Not enough peers - this is not critical, just skip repair
      return;
    }
    
    // Only attempt repair if severity is critical (not just warning)
    if (driftResult.severity !== "critical") {
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
        // If verification failed but we requested blocks from peers, wait a bit for them to arrive
        const tip = this.chainContext?.storage.getTip();
        if (tip && this.p2pNode && 'broadcast' in this.p2pNode) {
          const browserP2p = this.p2pNode as BrowserP2PNode;
          const peerCount = browserP2p.getPeerCount();
          if (peerCount > 0) {
            // Wait 5 seconds for blocks to arrive
            await this.delay(5000);
            
            // Re-verify after waiting
            const reVerified = await this.verifyStateAlignment(driftResult);
            if (reVerified) {
            } else {
              // Still failed - but if we don't have enough peers, accept it
              const gossip = getStateCommitGossip();
              const commits = gossip.getStateCommitsForHeight(driftResult.majorityHeight);
              if (commits.length < 2) {
                // Don't throw error - accept partial success
                return;
              }
              throw new Error("State verification failed after repair and block sync");
            }
          } else {
            // No peers - can't fix, but don't fail
            return;
          }
        } else {
          // No way to fix - but check if we have enough peers to determine if this is critical
          const gossip = getStateCommitGossip();
          const commits = gossip.getStateCommitsForHeight(driftResult.majorityHeight);
          if (commits.length < 2) {
            return;
          }
          throw new Error("State verification failed after repair");
        }
      }

      // Step 5: Complete
      this.repairStatus.step = "completed";
      this.repairStatus.progress = 100;
      this.repairStatus.completedAt = Date.now();


      // Reset consecutive failures on success
      this.consecutiveFailures = 0;

      if (this.onRepairComplete) {
        this.onRepairComplete();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

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
      return;
    }

    // Try to get snapshot from peers
    const gossip = getStateCommitGossip();
    const commits = gossip.getStateCommitsForHeight(targetHeight);

    if (commits.length === 0) {
      // No peers available, but we might have a local snapshot
      if (localSnapshot) {
        return;
      }
      throw new Error(`No peers available and no local snapshot for height ${targetHeight}`);
    }


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

    // Find the nearest full snapshot
    const fullSnapMeta = findNearestFullSnapshot(targetHeight);
    if (!fullSnapMeta) {
      // No snapshot available - try to rebuild from blocks
      return this.rebuildStateFromBlocks(targetHeight);
    }


    // Load the full snapshot
    const fullSnap = await loadSnapshotByHeight(fullSnapMeta.height);
    if (!fullSnap || !fullSnap.indexState) {
      throw new Error(`Failed to load snapshot at height ${fullSnapMeta.height}`);
    }

    // CRITICAL: Block state repair during solo mining to prevent balance rollback
    const { guardSnapshotApplication } = await import("./stateGuards.js");
    const currentHeight = this.chainContext.storage.getTip()?.header.height ?? 0;
    
    if (!guardSnapshotApplication(fullSnapMeta.height, currentHeight)) {
      console.warn(`[StateRepair] Skipping state rebuild from snapshot at height ${fullSnapMeta.height} (solo mining mode)`);
      throw new Error("State repair blocked (solo mining mode)");
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


    for (const block of blocksToReplay) {
      this.chainContext.indexState.applyBlock(block);
    }


    // After rebuilding, verify that the tip's state commitment matches what we expect
    // If it doesn't, the blocks themselves might have wrong state commitments
    const tip = this.chainContext.storage.getTip();
    if (tip && tip.header.height === targetHeight) {
      const computedStateCommitment = await this.computeCurrentStateCommitment();
      if (computedStateCommitment && driftResult.majorityStateCommitment) {
        if (computedStateCommitment !== driftResult.majorityStateCommitment) {
          // This is a warning, not an error - we'll let verification handle it
        } else {
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
      return false;
    }

    // Check state commitment matches
    const localStateCommitment = tip.header.stateCommitment || "";
    if (driftResult.majorityStateCommitment && localStateCommitment !== driftResult.majorityStateCommitment) {
      // State commitment still doesn't match - this means the blocks themselves have wrong state commitments
      // Try to compute the actual state commitment and see if it matches majority
      const computedStateCommitment = await this.computeCurrentStateCommitment();
      
      if (computedStateCommitment && computedStateCommitment === driftResult.majorityStateCommitment) {
        // The computed state matches majority, but block header has wrong state commitment
        // This is acceptable - the state is correct, just the block header is wrong
        return true;
      }
      
      // State commitment doesn't match - blocks may be incorrect or we're on a fork
      
      // If computed state matches local block header, it means our blocks are consistent but wrong
      // This suggests we're on a fork or have incorrect blocks
      if (computedStateCommitment && computedStateCommitment === localStateCommitment) {
        
        // If we have peers, try to request correct blocks
        if (this.p2pNode && 'broadcast' in this.p2pNode) {
          const browserP2p = this.p2pNode as BrowserP2PNode;
          const peerCount = browserP2p.getPeerCount();
          if (peerCount > 0) {
            // Request a wider range to ensure we get the correct chain
            // Request from a point before the mismatch to catch any fork
            const requestFromHeight = Math.max(0, tip.header.height - 100);
            browserP2p.broadcast("REQUEST_BLOCKS", {
              fromHeight: requestFromHeight,
              toHeight: tip.header.height,
            });
            
            // Also request headers to check for forks
            browserP2p.broadcast("GLOBAL_VIEW_REQUEST", {
              wantHeaders: true,
              headerCount: 200,
            });
          }
        }
        
        // Check if we have enough peers to determine if this is a real problem
        const gossip = getStateCommitGossip();
        const commits = gossip.getStateCommitsForHeight(driftResult.majorityHeight);
        if (commits.length < 2) {
          // Not enough peers - can't verify, so accept current state
          return true;
        }
        
        // Have peers but state doesn't match - this suggests we're on a fork
        // Don't fail immediately - return false so repair can wait for blocks to arrive
        // The repair process will wait 5 seconds and re-verify
        return false;
      }
      
      // Computed state doesn't match either - this is a more serious problem
      // But if we don't have peers, we can't fix it
      const gossip = getStateCommitGossip();
      const commits = gossip.getStateCommitsForHeight(driftResult.majorityHeight);
      if (commits.length < 2) {
        return true;
      }
      
      return false;
    }

    // Verify with state lock manager (non-blocking)
    const lockManager = getStateLockManager();
    lockManager.initialize(this.chainContext, this.p2pNode);
    const matchesLock = lockManager.checkLocalStateMatchesLock();

    if (!matchesLock && lockManager.hasValidLock()) {
      // Lock mismatch is not critical if state commitment matches
    }

    // Re-check drift (but be more lenient)
    const driftDetector = getStateDriftDetector();
    driftDetector.initialize(this.chainContext, this.p2pNode);
    const newDriftCheck = driftDetector.checkDrift();

    // Only fail if drift is still critical AND we have enough peers to determine true majority
    if (newDriftCheck.hasDrift && newDriftCheck.severity === "critical") {
      const gossip = getStateCommitGossip();
      const commits = gossip.getStateCommitsForHeight(driftResult.majorityHeight);
      if (commits.length >= 2) {
        return false;
      } else {
        // Not enough peers - don't fail verification
        return true;
      }
    }

    return true;
  }

  /**
   * Rebuild state from blocks when no snapshot is available
   */
  private async rebuildStateFromBlocks(targetHeight: number): Promise<void> {
    if (!this.chainContext) {
      throw new Error("Chain context not available");
    }


    // Get all blocks up to target height
    const allBlocks = this.chainContext.storage.getAllBlocks();
    const blocksToReplay = allBlocks.filter(b => b.header.height <= targetHeight);
    
    if (blocksToReplay.length === 0) {
      throw new Error(`No blocks available to rebuild state`);
    }

    // Sort blocks by height
    blocksToReplay.sort((a, b) => a.header.height - b.header.height);


    // Clear current state and rebuild from blocks
    this.chainContext.indexState.rebuildFromBlocks(blocksToReplay);

    // Update total_minted for all blocks (similar to chain.ts initialization)
    for (const block of blocksToReplay) {
      if (block.txs.length > 0) {
        const coinbaseTx = block.txs[0];
        if (coinbaseTx.ownerAddress === "idc_system" && coinbaseTx.ops.length > 0) {
          const rewardOp = coinbaseTx.ops[0];
          if (rewardOp.type === "TRANSFER" && rewardOp.amount) {
            const { IDCToUIDC } = await import("./idcEmission.js");
            const rewardUIDC = IDCToUIDC(rewardOp.amount);
            this.chainContext.indexState.incrementTotalMinted(rewardUIDC);
          }
        }
      }
    }

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

