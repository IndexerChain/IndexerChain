/**
 * Phase 41: Height Sync Manager - Unified Multi-Device Height Synchronization
 * 
 * Implements the unified height synchronization pipeline:
 * Shadow Node → Signal RootTip → P2P Headers → Blocks+Snapshots
 * 
 * Priority decision logic:
 * 1. StateLock + Quorum majority chain
 * 2. P2P majority + Signal RootTip consistent
 * 3. Shadow Node & Local
 * 4. Local-only (completely offline)
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { getStateLockManager } from "./stateLockManager.js";
import { getStateCommitGossip } from "./stateCommitGossip.js";
import type { Block } from "./types.js";

export interface HeightSource {
  type: "local" | "shadow" | "signal" | "p2p" | "statelock";
  height: number;
  tipHash: string;
  stateCommitment: string | null;
  recentHeaders?: Block[];
  trustLevel: "trusted" | "majority" | "single" | "offline";
  timestamp: number;
}

export interface SyncStatus {
  localHeight: number;
  shadowHeight: number | null;
  signalHeight: number | null;
  p2pHeight: number | null;
  stateLockHeight: number | null;
  recommendedHeight: number;
  recommendedSource: HeightSource["type"];
  syncStatus: "aligned" | "syncing" | "fork_detected" | "offline";
  sources: HeightSource[];
}

export class HeightSyncManager {
  private chainContext: ChainContext | null = null;
  private shadowState: {
    height: number;
    tipHash: string;
    stateCommitment: string | null;
    lastUpdated: number;
  } | null = null;
  private signalRootTip: {
    height: number;
    tipHash: string;
    stateCommitment: string | null;
    recentHeaders: Block[];
    lastUpdated: number;
  } | null = null;
  private p2pNetworkHeight: number | null = null;
  private stateLockHeight: number | null = null;

  /**
   * Initialize the height sync manager
   */
  init(chainContext: ChainContext, _p2pNode: P2PNode): void {
    this.chainContext = chainContext;
    // p2pNode is stored for potential future use but not currently needed
  }

  /**
   * Update shadow node state
   */
  updateShadowState(state: {
    height: number;
    tipHash: string;
    stateCommitment: string | null;
  }): void {
    this.shadowState = {
      ...state,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Update signal root tip
   */
  updateSignalRootTip(rootTip: {
    latestHeight: number;
    latestHeaderHash: string;
    stateCommitment: string | null;
    recentHeaders?: Block[];
  }): void {
    this.signalRootTip = {
      height: rootTip.latestHeight,
      tipHash: rootTip.latestHeaderHash,
      stateCommitment: rootTip.stateCommitment || null,
      recentHeaders: rootTip.recentHeaders || [],
      lastUpdated: Date.now(),
    };
  }

  /**
   * Update P2P network height (from GLOBAL_VIEW_RESPONSE)
   */
  updateP2PNetworkHeight(height: number): void {
    this.p2pNetworkHeight = height;
  }

  /**
   * Update state lock height
   */
  updateStateLockHeight(height: number): void {
    this.stateLockHeight = height;
  }

  /**
   * Get current sync status with priority decision
   */
  getSyncStatus(): SyncStatus {
    if (!this.chainContext) {
      return {
        localHeight: 0,
        shadowHeight: null,
        signalHeight: null,
        p2pHeight: null,
        stateLockHeight: null,
        recommendedHeight: 0,
        recommendedSource: "local",
        syncStatus: "offline",
        sources: [],
      };
    }

    const localTip = this.chainContext.storage.getTip();
    const localHeight = localTip?.header.height ?? 0;
    const localTipHash = localTip?.hash || "";
    const localStateCommitment = localTip?.header.stateCommitment || null;

    // Collect all available sources
    const sources: HeightSource[] = [];

    // 1. StateLock + Quorum majority (highest priority)
    if (this.stateLockHeight !== null) {
      const lockManager = getStateLockManager();
      const lock = lockManager.getCurrentLock();
      if (lock && lock.locked) {
        sources.push({
          type: "statelock",
          height: lock.height,
          tipHash: lock.tipHash,
          stateCommitment: lock.stateCommitment,
          trustLevel: "trusted",
          timestamp: lock.timestamp,
        });
      }
    }

    // 2. P2P majority + Signal RootTip (if consistent)
    if (this.p2pNetworkHeight !== null && this.signalRootTip) {
      const p2pHeight = this.p2pNetworkHeight;
      const signalHeight = this.signalRootTip.height;
      
      // Check if P2P and Signal are consistent (within 1 block)
      if (Math.abs(p2pHeight - signalHeight) <= 1) {
        // Check if majority of peers agree
        const gossip = getStateCommitGossip();
        const commits = gossip.getStateCommitsForHeight(signalHeight);
        const isMajority = commits.length >= 2;
        
        sources.push({
          type: "signal",
          height: signalHeight,
          tipHash: this.signalRootTip.tipHash,
          stateCommitment: this.signalRootTip.stateCommitment,
          recentHeaders: this.signalRootTip.recentHeaders,
          trustLevel: isMajority ? "majority" : "single",
          timestamp: this.signalRootTip.lastUpdated,
        });

        if (p2pHeight === signalHeight) {
          sources.push({
            type: "p2p",
            height: p2pHeight,
            tipHash: this.signalRootTip.tipHash,
            stateCommitment: this.signalRootTip.stateCommitment,
            trustLevel: isMajority ? "majority" : "single",
            timestamp: Date.now(),
          });
        }
      } else {
        // Inconsistent - add both but with lower trust
        sources.push({
          type: "signal",
          height: signalHeight,
          tipHash: this.signalRootTip.tipHash,
          stateCommitment: this.signalRootTip.stateCommitment,
          recentHeaders: this.signalRootTip.recentHeaders,
          trustLevel: "single",
          timestamp: this.signalRootTip.lastUpdated,
        });
        sources.push({
          type: "p2p",
          height: p2pHeight,
          tipHash: "",
          stateCommitment: null,
          trustLevel: "single",
          timestamp: Date.now(),
        });
      }
    } else if (this.signalRootTip) {
      // Only Signal available
      sources.push({
        type: "signal",
        height: this.signalRootTip.height,
        tipHash: this.signalRootTip.tipHash,
        stateCommitment: this.signalRootTip.stateCommitment,
        recentHeaders: this.signalRootTip.recentHeaders,
        trustLevel: "single",
        timestamp: this.signalRootTip.lastUpdated,
      });
    } else if (this.p2pNetworkHeight !== null) {
      // Only P2P available
      sources.push({
        type: "p2p",
        height: this.p2pNetworkHeight,
        tipHash: "",
        stateCommitment: null,
        trustLevel: "single",
        timestamp: Date.now(),
      });
    }

    // 3. Shadow Node (personal progress, lower priority)
    if (this.shadowState) {
      sources.push({
        type: "shadow",
        height: this.shadowState.height,
        tipHash: this.shadowState.tipHash,
        stateCommitment: this.shadowState.stateCommitment,
        trustLevel: "single",
        timestamp: this.shadowState.lastUpdated,
      });
    }

    // 4. Local (lowest priority, only if offline)
    sources.push({
      type: "local",
      height: localHeight,
      tipHash: localTipHash,
      stateCommitment: localStateCommitment,
      trustLevel: sources.length === 0 ? "offline" : "single",
      timestamp: Date.now(),
    });

    // Determine recommended height based on priority
    let recommendedHeight = localHeight;
    let recommendedSource: HeightSource["type"] = "local";
    let syncStatus: SyncStatus["syncStatus"] = "aligned";

    // Priority 1: StateLock
    const stateLockSource = sources.find(s => s.type === "statelock");
    if (stateLockSource) {
      recommendedHeight = stateLockSource.height;
      recommendedSource = "statelock";
    } else {
      // Priority 2: P2P + Signal consistent
      const signalSource = sources.find(s => s.type === "signal" && s.trustLevel === "majority");
      if (signalSource) {
        recommendedHeight = signalSource.height;
        recommendedSource = "signal";
      } else {
        // Priority 3: Signal or P2P (whichever is higher)
        const networkSources = sources.filter(s => s.type === "signal" || s.type === "p2p");
        if (networkSources.length > 0) {
          const highestNetwork = networkSources.reduce((max, s) => s.height > max.height ? s : max);
          recommendedHeight = highestNetwork.height;
          recommendedSource = highestNetwork.type;
        } else if (this.shadowState) {
          // Priority 4: Shadow Node
          recommendedHeight = this.shadowState.height;
          recommendedSource = "shadow";
        }
      }
    }

    // Determine sync status
    if (recommendedHeight > localHeight) {
      // Check if we're on a fork
      if (this.signalRootTip && localTipHash) {
        const recentHeaders = this.signalRootTip.recentHeaders || [];
        const isInRecentHeaders = recentHeaders.some(h => h.hash === localTipHash);
        if (!isInRecentHeaders && localHeight > 0) {
          syncStatus = "fork_detected";
        } else {
          syncStatus = "syncing";
        }
      } else {
        syncStatus = "syncing";
      }
    } else if (recommendedHeight < localHeight) {
      // Local is ahead - might be on a fork
      syncStatus = "fork_detected";
    } else {
      // Heights match - check if state commitments match
      const recommendedSourceObj = sources.find(s => s.type === recommendedSource);
      if (recommendedSourceObj && recommendedSourceObj.stateCommitment && localStateCommitment) {
        if (recommendedSourceObj.stateCommitment !== localStateCommitment) {
          syncStatus = "fork_detected";
        } else {
          syncStatus = "aligned";
        }
      } else {
        syncStatus = "aligned";
      }
    }

    // If no network sources, we're offline
    if (sources.filter(s => s.type !== "local" && s.type !== "shadow").length === 0) {
      syncStatus = "offline";
    }

    return {
      localHeight,
      shadowHeight: this.shadowState?.height ?? null,
      signalHeight: this.signalRootTip?.height ?? null,
      p2pHeight: this.p2pNetworkHeight,
      stateLockHeight: this.stateLockHeight,
      recommendedHeight,
      recommendedSource,
      syncStatus,
      sources,
    };
  }

  /**
   * Get height source display info
   */
  getHeightSourceDisplay(): {
    local: { height: number; status: string; color: string };
    shadow: { height: number | null; status: string; color: string };
    signal: { height: number | null; status: string; color: string };
    p2p: { height: number | null; status: string; color: string };
    statelock: { height: number | null; status: string; color: string };
  } {
    const status = this.getSyncStatus();
    const isZh = typeof window !== "undefined" && (window as any).locale === "zh";

    const getStatusColor = (sourceType: HeightSource["type"], height: number | null): string => {
      if (height === null) return "#999";
      if (sourceType === status.recommendedSource) return "#28a745";
      if (height < status.localHeight) return "#ffc107";
      if (height > status.localHeight) return "#dc3545";
      return "#666";
    };

    const getStatusText = (sourceType: HeightSource["type"], height: number | null): string => {
      if (height === null) return isZh ? "不可用" : "N/A";
      if (sourceType === status.recommendedSource) {
        return isZh ? "推荐来源" : "Trust: Recommended";
      }
      if (height < status.localHeight) {
        return isZh ? "等待同步" : "Waiting to sync";
      }
      if (height > status.localHeight) {
        return isZh ? "需要追赶" : "Need to catch up";
      }
      return isZh ? "已对齐" : "Aligned";
    };

    return {
      local: {
        height: status.localHeight,
        status: getStatusText("local", status.localHeight),
        color: getStatusColor("local", status.localHeight),
      },
      shadow: {
        height: status.shadowHeight,
        status: getStatusText("shadow", status.shadowHeight),
        color: getStatusColor("shadow", status.shadowHeight),
      },
      signal: {
        height: status.signalHeight,
        status: getStatusText("signal", status.signalHeight),
        color: getStatusColor("signal", status.signalHeight),
      },
      p2p: {
        height: status.p2pHeight,
        status: getStatusText("p2p", status.p2pHeight),
        color: getStatusColor("p2p", status.p2pHeight),
      },
      statelock: {
        height: status.stateLockHeight,
        status: getStatusText("statelock", status.stateLockHeight),
        color: getStatusColor("statelock", status.stateLockHeight),
      },
    };
  }
}

// Singleton instance
let heightSyncManagerInstance: HeightSyncManager | null = null;

export function getHeightSyncManager(): HeightSyncManager {
  if (!heightSyncManagerInstance) {
    heightSyncManagerInstance = new HeightSyncManager();
  }
  return heightSyncManagerInstance;
}

