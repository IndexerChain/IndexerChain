/**
 * Phase 30: Global Consistency Sentinel
 * 
 * Monitors local node's consistency with network majority.
 * Detects if local Leader is on a minority fork or significantly behind.
 * 
 * Design:
 * - Periodically requests global view from peers
 * - Aggregates responses to determine network majority
 * - Compares local state with majority to assess drift
 * - Provides UI with health status and recovery recommendations
 */

import type { ChainContext } from "./chain.js";
import type { ChainParams, GlobalViewSummary, DriftAssessment, GlobalViewResponse } from "./types.js";
import type { P2PNode } from "./p2p.js";

export class GlobalStateSentinel {
  private chainContext: ChainContext;
  private params: ChainParams;
  private p2pNode: P2PNode | null = null;
  private isRunning: boolean = false;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  
  // Peer view summaries (keyed by peerId)
  private peerViews: Map<string, GlobalViewSummary> = new Map();
  
  // Latest assessment
  private latestAssessment: DriftAssessment | null = null;
  
  // Assessment update callback
  private onAssessmentUpdate: ((assessment: DriftAssessment) => void) | null = null;

  constructor(chainContext: ChainContext, params: ChainParams) {
    this.chainContext = chainContext;
    this.params = params;
    this.p2pNode = chainContext.p2p || null;
  }

  /**
   * Start the sentinel
   */
  start(): void {
    if (this.isRunning) return;
    if (!this.p2pNode) {
      console.warn("[GlobalSentinel] Cannot start: P2P node not available");
      return;
    }

    this.isRunning = true;
    const intervalMs = this.params.globalDriftCheckIntervalMs ?? 5000;
    
    // Initial check after a short delay
    setTimeout(() => {
      this.performDriftCheck();
    }, 1000);
    
    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.performDriftCheck();
    }, intervalMs);
    
    console.log(`[GlobalSentinel] Started (check interval: ${intervalMs}ms)`);
  }

  /**
   * Stop the sentinel
   */
  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    console.log("[GlobalSentinel] Stopped");
  }

  /**
   * Set callback for assessment updates
   */
  setOnAssessmentUpdate(callback: (assessment: DriftAssessment) => void): void {
    this.onAssessmentUpdate = callback;
  }

  /**
   * Handle global view response from a peer
   */
  async onGlobalViewResponse(peerId: string, payload: GlobalViewResponse): Promise<void> {
    if (!this.isRunning) return;
    
    // Get peer reputation score if available
    let reputationScore: number | undefined = payload.reputationScore;
    if (this.params.peerScoreEnabled && this.chainContext.params.peerScoreEnabled) {
      try {
        // Try to get reputation from peer reputation manager
        const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
        const reputationManager = getGlobalPeerReputationManager(this.chainContext.params);
        const peerScore = reputationManager.getScore(peerId);
        if (peerScore) {
          reputationScore = peerScore.score;
        }
      } catch (e) {
        // Reputation manager not available, use payload value
      }
    }
    
    const summary: GlobalViewSummary = {
      peerId,
      height: payload.height,
      tipHash: payload.tipHash,
      finalizedHeight: payload.finalizedHeight,
      stateCommitment: payload.stateCommitment,
      reputationScore,
      lastSeenAt: Date.now(),
    };
    
    this.peerViews.set(peerId, summary);
    
    // Clean up old views (older than 30 seconds)
    const now = Date.now();
    for (const [pid, view] of this.peerViews.entries()) {
      if (now - view.lastSeenAt > 30000) {
        this.peerViews.delete(pid);
      }
    }
  }

  /**
   * Get latest drift assessment
   */
  getLatestAssessment(): DriftAssessment | null {
    return this.latestAssessment;
  }

  /**
   * Perform drift check (public method for manual trigger)
   */
  performDriftCheck(): void {
    if (!this.p2pNode || !this.p2pNode.isConnected) {
      return;
    }

    // Request global view from peers
    this.requestGlobalViews();
    
    // Wait a bit for responses, then compute assessment
    setTimeout(() => {
      const assessment = this.computeDriftAssessment();
      if (assessment) {
        this.latestAssessment = assessment;
        if (this.onAssessmentUpdate) {
          this.onAssessmentUpdate(assessment);
        }
      }
    }, 1000); // Wait 1 second for responses
  }

  /**
   * Request global views from peers
   */
  private requestGlobalViews(): void {
    if (!this.p2pNode) return;
    
    // Broadcast request to all peers
    this.p2pNode.broadcast("GLOBAL_VIEW_REQUEST", {});
  }

  /**
   * Compute drift assessment from collected peer views
   */
  private computeDriftAssessment(): DriftAssessment | null {
    const localTip = this.chainContext.storage.getTip();
    if (!localTip) {
      return null;
    }

    const localHeight = localTip.header.height;
    const localTipHash = localTip.hash;
    
    // Get finalized height from finality manager if available
    let localFinalizedHeight = 0;
    if (this.chainContext.params.finalityEnabled && (window as any).finalityManager) {
      const finalityManager = (window as any).finalityManager;
      const stats = finalityManager.getStats();
      if (stats && stats.finalizedHeight) {
        localFinalizedHeight = stats.finalizedHeight;
      }
    }

    // Filter peers by reputation
    const minReputation = this.params.globalMinReputationForVoting ?? 0;
    const validViews = Array.from(this.peerViews.values()).filter(view => {
      if (minReputation > 0 && view.reputationScore !== undefined) {
        return view.reputationScore >= minReputation;
      }
      return true;
    });

    const minPeers = this.params.globalMinPeersForAssessment ?? 3;
    
    // Not enough peers for assessment
    if (validViews.length < minPeers) {
      return {
        localHeight,
        localTipHash,
        localFinalizedHeight,
        peerCount: validViews.length,
        majorityHeight: localHeight,
        majorityTipHash: localTipHash,
        majorityFinalizedHeight: localFinalizedHeight,
        driftBlocks: 0,
        forkSuspected: false,
        healthLevel: "HEALTHY",
        reason: `Not enough peers for assessment (${validViews.length} < ${minPeers})`,
      };
    }

    // Compute majority height (median)
    const heights = validViews.map(v => v.height).sort((a, b) => a - b);
    const majorityHeight = heights[Math.floor(heights.length / 2)];

    // Compute majority tipHash (most common among peers near majority height)
    const nearMajorityViews = validViews.filter(v => 
      Math.abs(v.height - majorityHeight) <= 1
    );
    
    const tipHashCounts = new Map<string, number>();
    for (const view of nearMajorityViews) {
      const count = tipHashCounts.get(view.tipHash) || 0;
      tipHashCounts.set(view.tipHash, count + 1);
    }
    
    let majorityTipHash = localTipHash;
    let maxCount = 0;
    for (const [hash, count] of tipHashCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        majorityTipHash = hash;
      }
    }

    // Compute majority finalized height (median)
    const finalizedHeights = validViews.map(v => v.finalizedHeight).sort((a, b) => a - b);
    const majorityFinalizedHeight = finalizedHeights.length > 0
      ? finalizedHeights[Math.floor(finalizedHeights.length / 2)]
      : 0;

    // Calculate drift
    const driftBlocks = majorityHeight - localHeight;
    
    // Check for fork (tipHash differs but heights are close)
    const forkSuspected = localTipHash !== majorityTipHash && 
                         Math.abs(localHeight - majorityHeight) <= 2;

    // Determine health level
    const criticalBlocks = this.params.globalDriftCriticalBlocks ?? 10;
    const minorBlocks = this.params.globalDriftMinorBlocks ?? 3;
    
    let healthLevel: "HEALTHY" | "MINOR_DRIFT" | "CRITICAL_DRIFT";
    let reason: string;

    if (forkSuspected) {
      healthLevel = "CRITICAL_DRIFT";
      reason = `Local tip hash diverged from majority (fork suspected). Local: ${localTipHash.substring(0, 16)}..., Majority: ${majorityTipHash.substring(0, 16)}...`;
    } else if (driftBlocks <= minorBlocks && driftBlocks >= -minorBlocks) {
      healthLevel = "HEALTHY";
      reason = `Local node is in sync with network majority (drift: ${driftBlocks} blocks)`;
    } else if (driftBlocks <= criticalBlocks && driftBlocks >= -criticalBlocks) {
      healthLevel = "MINOR_DRIFT";
      reason = `Local node is ${driftBlocks > 0 ? 'behind' : 'ahead'} network majority by ${Math.abs(driftBlocks)} blocks`;
    } else {
      healthLevel = "CRITICAL_DRIFT";
      reason = `Local node is ${driftBlocks > 0 ? 'significantly behind' : 'significantly ahead'} network majority by ${Math.abs(driftBlocks)} blocks`;
    }

    return {
      localHeight,
      localTipHash,
      localFinalizedHeight,
      peerCount: validViews.length,
      majorityHeight,
      majorityTipHash,
      majorityFinalizedHeight,
      driftBlocks,
      forkSuspected,
      healthLevel,
      reason,
    };
  }
}

