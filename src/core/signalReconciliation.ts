/**
 * Phase 31: Browser-to-Signal Reconciliation
 * 
 * Periodically reconciles with root signal server to ensure consistency.
 * Root node serves as a reference (not authoritative) to help converge consensus.
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { logger } from "./logger.js";

/**
 * Root node tip summary
 */
export interface RootTipSummary {
  height: number;
  tipHash: string;
  difficulty: number;
  stateCommitment?: string;
  timestamp: number;
}

/**
 * Reconciliation result
 */
export interface ReconciliationResult {
  consistent: boolean;
  localHeight: number;
  localTipHash: string;
  rootHeight: number;
  rootTipHash: string;
  p2pMajorityHeight: number;
  p2pMajorityTipHash: string;
  action?: "FOLLOW_ROOT" | "FOLLOW_P2P_MAJORITY" | "NONE";
  reason?: string;
}

/**
 * Signal Reconciliation Manager
 * 
 * Manages reconciliation with root signal server.
 */
export class SignalReconciliation {
  private reconciliationInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private rootTipSummary: RootTipSummary | null = null;
  private p2pMajorityHeight: number = 0;
  private p2pMajorityTipHash: string = "";

  constructor(
    private chainContext: ChainContext,
    // @ts-ignore - p2pNode stored for future use
    private _p2pNode: P2PNode | null,
    private signalUrl: string | null
  ) {
    // _p2pNode is stored but not directly used in current implementation
    // It may be used in future for P2P-based reconciliation
  }

  /**
   * Start reconciliation
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    logger.debug("[Phase 31] Starting Signal Reconciliation...");
    
    // Reconcile every 30 seconds
    this.reconciliationInterval = setInterval(() => {
      this.performReconciliation().catch(_err => {
      });
    }, 30000);
    
    // Initial reconciliation after 10 seconds
    setTimeout(() => {
      this.performReconciliation().catch(_err => {
      });
    }, 10000);
  }

  /**
   * Stop reconciliation
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
    }
    
    logger.debug("[Phase 31] Stopped Signal Reconciliation.");
  }

  /**
   * Update P2P majority (called by height consensus manager)
   */
  updateP2PMajority(height: number, tipHash: string): void {
    this.p2pMajorityHeight = height;
    this.p2pMajorityTipHash = tipHash;
  }

  /**
   * Perform reconciliation
   */
  async performReconciliation(): Promise<void> {
    if (!this.signalUrl) {
      return;
    }

    const localTip = this.chainContext.storage.getTip();
    if (!localTip) {
      return;
    }

    try {
      // Request tip summary from root signal server
      // Note: This assumes the signal server has an HTTP endpoint for tip summary
      // In practice, this might be done via WebSocket or a separate HTTP API
      const rootSummary = await this.fetchRootTipSummary();
      
      if (!rootSummary) {
        // Root not available, skip reconciliation
        return;
      }

      this.rootTipSummary = rootSummary;

      // Compare with local and P2P majority
      const result = this.compareWithRoot(localTip.header.height, localTip.hash);

      // Log reconciliation result
      if (!result.consistent) {
      } else {
        logger.debug("[Phase 31] Reconciliation consistent");
      }

      // Determine action based on result
      if (result.action === "FOLLOW_ROOT") {
        // Root matches P2P majority, we can trust root
        logger.debug("[Phase 31] Following root node (consistent with P2P majority)");
      } else if (result.action === "FOLLOW_P2P_MAJORITY") {
        // P2P majority differs from root, follow majority
      }

    } catch (error) {
    }
  }

  /**
   * Fetch root tip summary from signal server
   * 
   * Note: This is a placeholder. In practice, the signal server would need
   * to expose an HTTP endpoint or WebSocket message for tip summary.
   */
  private async fetchRootTipSummary(): Promise<RootTipSummary | null> {
    // For now, we'll return null as signal server integration is not yet implemented
    // In production, this would make an HTTP request or WebSocket message to signal server
    
    // Example implementation (commented out):
    /*
    try {
      const url = this.signalUrl.replace("wss://", "https://").replace("ws://", "http://");
      const response = await fetch(`${url}/api/tip-summary`);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return {
        height: data.height,
        tipHash: data.tipHash,
        difficulty: data.difficulty,
        stateCommitment: data.stateCommitment,
        timestamp: data.timestamp,
      };
    } catch (error) {
      return null;
    }
    */
    
    return null;
  }

  /**
   * Compare local state with root and P2P majority
   */
  private compareWithRoot(localHeight: number, localTipHash: string): ReconciliationResult {
    if (!this.rootTipSummary) {
      return {
        consistent: true,
        localHeight,
        localTipHash,
        rootHeight: 0,
        rootTipHash: "",
        p2pMajorityHeight: this.p2pMajorityHeight,
        p2pMajorityTipHash: this.p2pMajorityTipHash,
        action: "NONE",
      };
    }

    const rootHeight = this.rootTipSummary.height;
    const rootTipHash = this.rootTipSummary.tipHash;

    // Check consistency
    const rootMatchesLocal = rootHeight === localHeight && rootTipHash === localTipHash;
    const rootMatchesP2P = rootHeight === this.p2pMajorityHeight && rootTipHash === this.p2pMajorityTipHash;
    const localMatchesP2P = localHeight === this.p2pMajorityHeight && localTipHash === this.p2pMajorityTipHash;

    const consistent = rootMatchesLocal && rootMatchesP2P && localMatchesP2P;

    // Determine action
    let action: "FOLLOW_ROOT" | "FOLLOW_P2P_MAJORITY" | "NONE" = "NONE";
    let reason: string | undefined;

    if (!consistent) {
      if (rootMatchesP2P && !rootMatchesLocal) {
        // Root and P2P agree, but local differs - follow root/P2P
        action = "FOLLOW_ROOT";
        reason = "Root and P2P majority agree, local differs";
      } else if (localMatchesP2P && !rootMatchesP2P) {
        // Local and P2P agree, but root differs - follow P2P majority
        action = "FOLLOW_P2P_MAJORITY";
        reason = "Local and P2P majority agree, root differs";
      } else {
        // All three differ - follow P2P majority (decentralized)
        action = "FOLLOW_P2P_MAJORITY";
        reason = "Root, local, and P2P all differ - following P2P majority";
      }
    }

    return {
      consistent,
      localHeight,
      localTipHash,
      rootHeight,
      rootTipHash,
      p2pMajorityHeight: this.p2pMajorityHeight,
      p2pMajorityTipHash: this.p2pMajorityTipHash,
      action,
      reason,
    };
  }

  /**
   * Get latest reconciliation result
   */
  getLatestReconciliation(): ReconciliationResult | null {
    const localTip = this.chainContext.storage.getTip();
    if (!localTip) {
      return null;
    }

    return this.compareWithRoot(localTip.header.height, localTip.hash);
  }
}

