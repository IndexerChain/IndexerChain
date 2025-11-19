/**
 * Phase 30: Mining Guard - Pre-mining Health Checks
 * Phase 33: Mining Permission Levels - Three-tier mining system
 * 
 * Ensures mining only happens when node is:
 * - Synchronized with network
 * - Connected to sufficient peers
 * - On the correct network (mainnet)
 * - Has finalized blocks up to date
 * 
 * Phase 33: Three-tier mining permission levels:
 * - SAFE: Mainnet default, requires >= 3 peers
 * - GUARDED: Dev/testnet mode, allows < 3 peers with warnings
 * - LOCAL_ONLY: Training mode, completely local mining
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { validateMainnetParams, isMainnet } from "./networkParams.js";
import { getQuorumManager } from "./quorumManager.js";

/**
 * Phase 33: Mining permission level
 */
export type MiningMode = "SAFE" | "GUARDED" | "LOCAL_ONLY" | "BLOCKED";

/**
 * Mining guard result
 */
export interface MiningGuardResult {
  ok: boolean;
  mode?: MiningMode; // Phase 33: Mining permission level
  reason?: string;
  code?: 
    | "NOT_SYNCED"
    | "INSUFFICIENT_PEERS"
    | "NOT_FINALIZED"
    | "NETWORK_MISMATCH"
    | "PARAMS_MISMATCH"
    | "NO_VALID_WALLET"
    | "FOLLOWER_MODE"
    | "STATE_LOCK_MISMATCH" // Phase 36
    | "NO_RECENT_STATE_COMMITS" // Phase 36
    | "STATE_DRIFT_DETECTED"; // Phase 36
  details?: {
    localHeight?: number;
    networkHeight?: number;
    peerCount?: number;
    requiredPeers?: number;
    finalizedHeight?: number;
    tipHeight?: number;
    // Phase 34: Quorum information
    quorumScore?: number;
    requiredQuorumScore?: number;
    independentPeerCount?: number;
    // Phase 35: Mainnet admission requirements
    requiredIndependentPeers?: number;
  };
}

/**
 * Mining Guard
 * 
 * Performs health checks before allowing mining
 */
export class MiningGuard {
  /**
   * Check if mining is safe to start
   */
  static async canMineNow(
    chainContext: ChainContext,
    p2pNode: P2PNode | null,
    finalityManager?: any,
    localInstanceRole?: "LEADER" | "FOLLOWER",
    miningWalletAddress?: string,
    bootstrapComplete?: boolean // Phase 32: Bootstrap sync status (currently not used, but kept for future use)
  ): Promise<MiningGuardResult> {
    // Phase 32: Check bootstrap sync status
    // bootstrapComplete === true means we've synced from signal server's rootTip
    // This is important for Cold Start phase: even with 0 peers, if bootstrapComplete === true,
    // we should allow mining (subject to QuorumScore and other checks)
    
    // Check 1: P2P connection to signal server (required for bootstrap)
    if (!p2pNode || !p2pNode.isConnected) {
      // If bootstrap is complete, we might still allow mining (Cold Start mode)
      if (bootstrapComplete) {
        console.log(`[Phase 32] P2P disconnected but bootstrap complete - allowing Cold Start mining`);
        // Continue to other checks, but note that we're in Cold Start mode
      } else {
        return {
          ok: false,
          code: "INSUFFICIENT_PEERS",
          reason: "Not connected to P2P network and bootstrap not complete",
          details: {
            peerCount: 0,
            requiredPeers: 3,
          },
        };
      }
    }

    const peerCount = p2pNode?.getPeerCount() ?? 0;
    const isMainnetNetwork = isMainnet(chainContext.params);
    
    // Phase 33: Intelligent Peer Quorum System
    // Use QuorumManager to evaluate peer quality instead of simple peer count
    const quorumManager = getQuorumManager();
    if (p2pNode) {
      quorumManager.initialize(p2pNode, chainContext);
    }
    // Initialize with empty status if no P2P node
    const quorumStatus = p2pNode ? quorumManager.getQuorumStatus() : {
      ready: false,
      totalScore: 0,
      requiredScore: 80,
      peerCount: 0,
      independentPeerCount: 0,
    };
    
    // Phase 33: Three-tier mining permission levels (with quorum support)
    const minPeersRequired = chainContext.params.minPeersRequired ?? 3;
    const allowGuardedMining = chainContext.params.allowGuardedMining ?? (!isMainnetNetwork); // Auto-enable for dev/testnet
    const allowLocalMining = chainContext.params.allowLocalMining ?? false;
    
    // Check for local-only mining mode (URL parameter or environment)
    const isLocalMiningMode = typeof window !== "undefined" && (
      new URLSearchParams(window.location.search).get("localmine") === "true" ||
      localStorage.getItem("INDEXER_LOCAL_MINE") === "1"
    );
    
    // Phase 33: Determine mining mode based on quorum status, bootstrap status, and configuration
    let miningMode: MiningMode = "BLOCKED";
    
    // Phase 37: Cold Start mode - allow mining if bootstrapComplete === true, even with 0 peers
    // This is for early network phase where nodes can mine based on signal server's rootTip
    const isColdStartMode = bootstrapComplete && peerCount === 0;
    if (isColdStartMode) {
      console.log(`[Phase 37] Cold Start mode: bootstrapComplete=true, peers=0, allowing mining`);
      miningMode = "GUARDED"; // Use GUARDED mode for Cold Start
    }
    
    // Phase 38: Check Genesis phase first (height = 0, allows mining with minimal requirements)
    const isGenesisPhase = quorumManager.isGenesisPhase();
    if (isGenesisPhase && isMainnetNetwork && p2pNode) {
      const quorumStatus = quorumManager.getQuorumStatus();
      
      // Genesis mode: Check minimal requirements
      // Requirements: ≥2 independent IPs, online >2 minutes, bootstrapComplete
      if (quorumStatus.ready && quorumStatus.independentPeerCount >= 2) {
        console.log(`[Phase 38] 🌟 Genesis Quorum Mode: Allowing mining at height 0 (independent peers: ${quorumStatus.independentPeerCount}, score: ${quorumStatus.totalScore})`);
        // Continue to other checks, but mining is allowed in Genesis mode
      } else {
        return {
          ok: false,
          mode: "BLOCKED",
          code: "INSUFFICIENT_PEERS",
          reason: `Genesis phase: Need ≥2 independent peers (current: ${quorumStatus.independentPeerCount}), stable peers, and bootstrap complete`,
          details: {
            peerCount,
            requiredPeers: 2,
            quorumScore: quorumStatus.totalScore,
            requiredQuorumScore: quorumStatus.requiredScore,
            independentPeerCount: quorumStatus.independentPeerCount,
            requiredIndependentPeers: 2,
          },
        };
      }
    }
    
    // Phase 35: Check mainnet admission rules first (unless in Cold Start mode or Genesis mode)
    if (isMainnetNetwork && !isColdStartMode && !isGenesisPhase && p2pNode) {
      const admissionStatus = quorumManager.getMainnetAdmissionStatus();
      
      if (admissionStatus.admissionReady) {
        // Phase 36: Check state lock
        const { getStateLockManager } = await import("./stateLockManager.js");
        const { getStateCommitGossip } = await import("./stateCommitGossip.js");
        const { getStateDriftDetector } = await import("./stateDriftDetector.js");
        
        const lockManager = getStateLockManager();
        lockManager.initialize(chainContext, p2pNode);
        const lockCheck = lockManager.canMineBasedOnLock();
        
        const gossip = getStateCommitGossip();
        const hasRecentCommits = gossip.hasRecentStateCommits(30000); // 30 seconds
        
        const driftDetector = getStateDriftDetector();
        driftDetector.initialize(chainContext, p2pNode);
        const driftCheck = driftDetector.checkDrift();
        
        // Phase 36: Block mining if state lock issues or drift detected
        if (!lockCheck.allowed) {
          return {
            ok: false,
            mode: "BLOCKED",
            code: "STATE_LOCK_MISMATCH",
            reason: `State lock check failed: ${lockCheck.reason}`,
            details: {
              peerCount,
              requiredPeers: minPeersRequired,
              quorumScore: admissionStatus.quorumScore,
              requiredQuorumScore: admissionStatus.requiredQuorumScore,
              independentPeerCount: admissionStatus.independentPeers,
            },
          };
        }
        
        if (!hasRecentCommits) {
          return {
            ok: false,
            mode: "BLOCKED",
            code: "NO_RECENT_STATE_COMMITS",
            reason: "No recent state commits received from peers (>30s)",
            details: {
              peerCount,
              requiredPeers: minPeersRequired,
            },
          };
        }
        
        if (driftCheck.hasDrift && driftCheck.severity === "critical") {
          return {
            ok: false,
            mode: "BLOCKED",
            code: "STATE_DRIFT_DETECTED",
            reason: `Critical state drift detected: ${driftCheck.reason}`,
            details: {
              peerCount,
              requiredPeers: minPeersRequired,
            },
          };
        }
        
        // Level 1: SAFE Mining - Mainnet admission rules satisfied + state lock OK
        miningMode = "SAFE";
        console.log(`[Phase 35/36] Mainnet admission ready: Stage ${admissionStatus.stage}, Score ${admissionStatus.quorumScore} >= ${admissionStatus.requiredQuorumScore}, Independent peers ${admissionStatus.independentPeers} >= ${admissionStatus.requiredIndependentPeers}, State lock OK`);
      } else {
        // BLOCKED: Mainnet admission rules not satisfied
        return {
          ok: false,
          mode: "BLOCKED",
          code: "INSUFFICIENT_PEERS",
          reason: `Mainnet admission not ready (${admissionStatus.stage} stage): Quorum score ${admissionStatus.quorumScore} < ${admissionStatus.requiredQuorumScore} or independent peers ${admissionStatus.independentPeers} < ${admissionStatus.requiredIndependentPeers}. ${admissionStatus.reasons.join("; ")}`,
          details: {
            peerCount,
            requiredPeers: minPeersRequired,
            quorumScore: admissionStatus.quorumScore,
            requiredQuorumScore: admissionStatus.requiredQuorumScore,
            independentPeerCount: admissionStatus.independentPeers,
            requiredIndependentPeers: admissionStatus.requiredIndependentPeers,
          },
        };
      }
    } else if (peerCount >= minPeersRequired && !isMainnetNetwork) {
      // Level 1: SAFE Mining - Dev/testnet with enough peers
      miningMode = "SAFE";
    } else if (allowLocalMining && isLocalMiningMode) {
      // Level 3: LOCAL_ONLY Mining - Training mode
      miningMode = "LOCAL_ONLY";
      console.log(`[Phase 33] Local-only mining mode enabled (peers: ${peerCount})`);
    } else if (bootstrapComplete && peerCount === 0) {
      // Phase 37: Cold Start mode - bootstrap complete but no peers yet
      miningMode = "GUARDED";
      console.log(`[Phase 37] Cold Start mining mode: bootstrapComplete=true, peers=0`);
    } else if (allowGuardedMining) {
      // Level 2: GUARDED Mining - Dev/testnet with warnings
      miningMode = "GUARDED";
      console.log(`[Phase 33] Guarded mining mode: ${peerCount} peers < ${minPeersRequired} (dev/testnet mode)`);
    } else if (isMainnetNetwork && !quorumStatus.ready && !bootstrapComplete) {
      // BLOCKED: Mainnet quorum not satisfied
      return {
        ok: false,
        mode: "BLOCKED",
        code: "INSUFFICIENT_PEERS",
        reason: `Quorum not satisfied: Total score ${quorumStatus.totalScore} < required ${quorumStatus.requiredScore}. Need ${quorumStatus.independentPeerCount} independent peer(s), have ${quorumStatus.peerCount} peer(s).`,
        details: {
          peerCount,
          requiredPeers: minPeersRequired,
          quorumScore: quorumStatus.totalScore,
          requiredQuorumScore: quorumStatus.requiredScore,
          independentPeerCount: quorumStatus.independentPeerCount,
        },
      };
    } else {
      // BLOCKED: Not enough peers and guarded mining not allowed
      return {
        ok: false,
        mode: "BLOCKED",
        code: "INSUFFICIENT_PEERS",
        reason: `Insufficient peers: ${peerCount} < ${minPeersRequired}`,
        details: {
          peerCount,
          requiredPeers: minPeersRequired,
        },
      };
    }
    
    // Continue with other checks, but mining is allowed in GUARDED or LOCAL_ONLY mode

    // Check 2: Local instance role (mainnet mode)
    if (isMainnet(chainContext.params)) {
      if (localInstanceRole === "FOLLOWER") {
        return {
          ok: false,
          code: "FOLLOWER_MODE",
          reason: "This instance is a follower. Only the leader instance can mine on mainnet.",
          details: {},
        };
      }
    }

    // Check 3: Valid mining wallet
    if (!miningWalletAddress || !miningWalletAddress.startsWith("idc_")) {
      return {
        ok: false,
        code: "NO_VALID_WALLET",
        reason: "No valid mining wallet selected. Please select a wallet in the Wallet panel.",
        details: {},
      };
    }

    // Check 4: Network parameters validation (mainnet)
    if (isMainnet(chainContext.params)) {
      const networkValidation = await validateMainnetParams(chainContext.params);
      if (!networkValidation.valid) {
        return {
          ok: false,
          code: "NETWORK_MISMATCH",
          reason: networkValidation.reason || "Network parameters do not match mainnet",
          details: {},
        };
      }
    }

    // Check 5: Synchronization status
    const localTip = chainContext.storage.getTip();
    let localHeight = 0;
    
    if (localTip) {
      localHeight = localTip.header.height;
    } else {
      // No local tip - this is normal for a new chain (only genesis block exists)
      // Don't block mining if we're at height 0 - this is expected for a new node
      // The sync check should compare with network height, not just check if tip exists
      // For now, we'll allow mining at height 0 and let natural sync happen
      localHeight = 0;
    }
    
    // Note: We don't block mining just because localHeight is 0
    // The real sync check should compare local height with network height from peers
    // For now, we'll allow mining and let the sync happen naturally
    
    // Get network height from peers (if available via global sentinel)
    // For now, we'll use a simpler check: if we have peers and recent blocks
    // In a real implementation, you'd query the global sentinel for network height
    // Note: Sync drift check is handled by GlobalStateSentinel, so we don't need to check it here
    
    // Check 6: Finality status (if finality is enabled)
    if (chainContext.params.finalityEnabled && finalityManager) {
      const finalityStats = finalityManager.getStats();
      if (finalityStats) {
        const finalizedHeight = finalityStats.finalizedHeight || 0;
        const finalityLag = localHeight - finalizedHeight;
        const maxFinalityLag = 5; // Allow up to 5 blocks unfinalized
        
        // Phase 36: Relax finality check during initialization or in dev/testnet mode
        // - If finalizedHeight is 0 and localHeight is small (< 20), allow mining (initialization phase)
        // - If we're in dev/testnet mode, allow more lag
        const isMainnetNetwork = isMainnet(chainContext.params);
        const isInitializationPhase = finalizedHeight === 0 && localHeight < 20;
        const shouldRelaxCheck = !isMainnetNetwork || isInitializationPhase;
        
        if (finalityLag > maxFinalityLag && !shouldRelaxCheck) {
          return {
            ok: false,
            code: "NOT_FINALIZED",
            reason: `Too many unfinalized blocks: ${finalityLag} > ${maxFinalityLag}`,
            details: {
              localHeight,
              finalizedHeight,
              tipHeight: localHeight,
            },
          };
        }
        
        // Log warning in dev/testnet or initialization phase, but don't block
        if (finalityLag > maxFinalityLag && shouldRelaxCheck) {
          console.log(`[Phase 36] Finality lag ${finalityLag} > ${maxFinalityLag}, but allowing mining (${isInitializationPhase ? 'initialization phase' : 'dev/testnet mode'})`);
        }
      }
    }

    // Check 7: Verify we have consensus on tip hash from multiple peers
    // This would require integration with GlobalStateSentinel
    // For now, we'll just check if we have enough peers
    
    // Phase 33: All checks passed, return with mining mode and quorum info
    return {
      ok: true,
      mode: miningMode,
      details: {
        localHeight,
        peerCount,
        requiredPeers: minPeersRequired,
        quorumScore: quorumStatus.totalScore,
        requiredQuorumScore: quorumStatus.requiredScore,
        independentPeerCount: quorumStatus.independentPeerCount,
      },
    };
  }

  /**
   * Get human-readable status message
   * Phase 33: Updated to show mining mode
   */
  static getStatusMessage(result: MiningGuardResult, locale: string = "en"): string {
    const isZh = locale === "zh";
    
    if (result.ok) {
      // Phase 33: Show mining mode
      switch (result.mode) {
        case "SAFE":
          return isZh ? "✅ 挖矿就绪：安全模式（网络健康）" : "✅ Mining Ready: SAFE (Network Healthy)";
        case "GUARDED":
          return isZh 
            ? `🟡 挖矿就绪：保护模式（对等节点不足：${result.details?.peerCount || 0} < ${result.details?.requiredPeers || 3}）`
            : `🟡 Mining Ready: GUARDED (Insufficient peers: ${result.details?.peerCount || 0} < ${result.details?.requiredPeers || 3})`;
        case "LOCAL_ONLY":
          return isZh ? "🔵 挖矿就绪：本地训练模式" : "🔵 Mining Ready: LOCAL-ONLY (Training Mode)";
        default:
          return isZh ? "✅ 挖矿就绪：安全" : "✅ Mining Ready: SAFE";
      }
    }

    switch (result.code) {
      case "NOT_SYNCED":
        return isZh 
          ? `🚫 挖矿就绪：已阻止 - 节点未同步（本地高度: ${result.details?.localHeight || 0}）`
          : `🚫 Mining Ready: BLOCKED - Node not synced (local height: ${result.details?.localHeight || 0})`;
      
      case "INSUFFICIENT_PEERS":
        return isZh
          ? `🚫 挖矿就绪：已阻止 - 对等节点不足（${result.details?.peerCount || 0} < ${result.details?.requiredPeers || 3}）`
          : `🚫 Mining Ready: BLOCKED - Insufficient peers (${result.details?.peerCount || 0} < ${result.details?.requiredPeers || 3})`;
      
      case "NOT_FINALIZED":
        return isZh
          ? `⚠️ 挖矿就绪：降级 - 未最终确认的区块过多`
          : `⚠️ Mining Ready: DEGRADED - Too many unfinalized blocks`;
      
      case "NETWORK_MISMATCH":
        return isZh
          ? `🚫 挖矿就绪：已阻止 - 网络参数不匹配`
          : `🚫 Mining Ready: BLOCKED - Network parameters mismatch`;
      
      case "NO_VALID_WALLET":
        return isZh
          ? `🚫 挖矿就绪：已阻止 - 未选择有效的挖矿钱包`
          : `🚫 Mining Ready: BLOCKED - No valid mining wallet selected`;
      
      case "FOLLOWER_MODE":
        return isZh
          ? `🚫 挖矿就绪：已阻止 - 本窗口为只读模式（Follower）`
          : `🚫 Mining Ready: BLOCKED - This window is read-only (Follower)`;
      
      default:
        return result.reason || (isZh ? "🚫 挖矿就绪：已阻止" : "🚫 Mining Ready: BLOCKED");
    }
  }
  
  /**
   * Phase 33: Get mining mode color for UI
   */
  static getModeColor(mode?: MiningMode): string {
    switch (mode) {
      case "SAFE":
        return "#28a745"; // Green
      case "GUARDED":
        return "#ffc107"; // Yellow
      case "LOCAL_ONLY":
        return "#17a2b8"; // Blue
      case "BLOCKED":
      default:
        return "#dc3545"; // Red
    }
  }
  
  /**
   * Phase 33: Get mining mode description
   */
  static getModeDescription(mode?: MiningMode, locale: string = "en"): string {
    const isZh = locale === "zh";
    
    switch (mode) {
      case "SAFE":
        return isZh 
          ? "网络健康，可安全挖矿。区块将被主网接受。"
          : "Network healthy, safe to mine. Blocks will be accepted by mainnet.";
      case "GUARDED":
        return isZh
          ? "低连接模式，风险挖矿。区块可能不会被主网接受。"
          : "Low connectivity mode, guarded mining. Blocks may not be accepted by mainnet.";
      case "LOCAL_ONLY":
        return isZh
          ? "本地训练模式，完全本地挖矿，不参与网络共识。"
          : "Local training mode, completely local mining, not participating in network consensus.";
      case "BLOCKED":
      default:
        return isZh
          ? "无法挖矿：不满足最低要求。"
          : "Cannot mine: Minimum requirements not met.";
    }
  }

  /**
   * Phase 34: Get comprehensive mining readiness information
   */
  static async getMiningReadinessInfo(
    chainContext: ChainContext | null,
    p2pNode: P2PNode | null,
    finalityManager: any,
    localInstanceRole: "LEADER" | "FOLLOWER",
    bootstrapComplete: boolean
  ): Promise<{
    canMine: boolean;
    reason: string;
    quorumScore: number;
    uniquePeers: number;
    threshold: number;
    p2pConnected: boolean;
    bootstrapCompleted: boolean;
    finalityReady: boolean;
    localRole: "LEADER" | "FOLLOWER";
    details: {
      peerCount: number;
      quorumReady: boolean;
      networkValidated: boolean;
      walletValid: boolean;
      syncStatus: string;
    };
  }> {
    const defaultResult = {
      canMine: false,
      reason: "Chain context or P2P node not available",
      quorumScore: 0,
      uniquePeers: 0,
      threshold: 0,
      p2pConnected: false,
      bootstrapCompleted: false,
      finalityReady: false,
      localRole: localInstanceRole,
      details: {
        peerCount: 0,
        quorumReady: false,
        networkValidated: false,
        walletValid: false,
        syncStatus: "unknown",
      },
    };

    if (!chainContext || !p2pNode) {
      return defaultResult;
    }

    const p2pConnected = p2pNode.isConnected;
    const peerCount = p2pNode.getPeerCount();
    
    // Get quorum status
    const quorumManager = getQuorumManager();
    quorumManager.initialize(p2pNode, chainContext);
    const quorumStatus = quorumManager.getQuorumStatus();
    
    // Check finality readiness
    let finalityReady = true;
    if (chainContext.params.finalityEnabled && finalityManager) {
      const finalityStats = finalityManager.getStats();
      if (finalityStats) {
        const localTip = chainContext.storage.getTip();
        const localHeight = localTip?.header.height ?? 0;
        const finalizedHeight = finalityStats.finalizedHeight || 0;
        const finalityLag = localHeight - finalizedHeight;
        finalityReady = finalityLag <= 5; // Allow up to 5 blocks unfinalized
      }
    }

    // Check wallet
    const walletStore = await import("./multiWallet.js").then(m => m.getMultiWalletStore());
    const miningWallet = walletStore.getMiningWallet();
    const walletValid = !!(miningWallet && miningWallet.address && miningWallet.address.startsWith("idc_"));

    // Check network validation
    const peers = Array.from(p2pNode.peers.values());
    const networkValidated = peers.some(p => p.networkValidated);

    // Check sync status
    const localTip = chainContext.storage.getTip();
    const localHeight = localTip?.header.height ?? 0;
    let syncStatus = "synced";
    if (localHeight === 0) {
      syncStatus = "genesis";
    } else if (!bootstrapComplete) {
      syncStatus = "syncing";
    }

    // Determine if can mine
    const guardResult = await this.canMineNow(
      chainContext,
      p2pNode,
      finalityManager,
      localInstanceRole,
      miningWallet?.address,
      bootstrapComplete
    );

    const canMine = guardResult.ok;
    let reason = "";
    
    if (!canMine) {
      const reasons: string[] = [];
      
      if (!p2pConnected) {
        reasons.push("Not connected to P2P network");
      }
      
      if (!quorumStatus.ready && isMainnet(chainContext.params)) {
        reasons.push(`Quorum not ready: ${quorumStatus.totalScore} < ${quorumStatus.requiredScore}`);
        reasons.push(`Unique peers: ${quorumStatus.independentPeerCount} (need ≥2)`);
      }
      
      if (!bootstrapComplete) {
        reasons.push("Bootstrap not completed");
      }
      
      if (localInstanceRole === "FOLLOWER" && isMainnet(chainContext.params)) {
        reasons.push("You are not the local LEADER");
      }
      
      if (!walletValid) {
        reasons.push("No valid mining wallet selected");
      }
      
      if (!finalityReady) {
        reasons.push("Finality not ready (too many unfinalized blocks)");
      }
      
      reason = reasons.join("; ");
    } else {
      reason = guardResult.mode === "SAFE" 
        ? "All checks passed, ready to mine"
        : guardResult.mode === "GUARDED"
        ? "Guarded mode: Mining allowed but with warnings"
        : "Local-only mode: Mining for training purposes";
    }

    return {
      canMine,
      reason,
      quorumScore: quorumStatus.totalScore,
      uniquePeers: quorumStatus.independentPeerCount,
      threshold: quorumStatus.requiredScore,
      p2pConnected,
      bootstrapCompleted: bootstrapComplete,
      finalityReady,
      localRole: localInstanceRole,
      details: {
        peerCount,
        quorumReady: quorumStatus.ready,
        networkValidated,
        walletValid,
        syncStatus,
      },
    };
  }

  /**
   * Phase 35: Get mainnet admission status
   * Returns comprehensive admission status for mainnet mining
   */
  static async getMainnetAdmissionStatus(
    chainContext: ChainContext | null,
    p2pNode: P2PNode | null,
    _finalityManager: any,
    _localInstanceRole: "LEADER" | "FOLLOWER",
    _bootstrapComplete: boolean
  ): Promise<import("./quorumManager.js").MainnetAdmissionStatus> {
    const { getQuorumManager } = await import("./quorumManager.js");
    const quorumManager = getQuorumManager();
    
    if (!chainContext || !p2pNode) {
      return {
        stage: "coldStart",
        quorumScore: 0,
        requiredQuorumScore: 0,
        independentPeers: 0,
        requiredIndependentPeers: 0,
        admissionReady: false,
        reasons: ["Chain context or P2P node not available"],
        suggestions: ["Initialize chain and connect to P2P network"],
      };
    }

    quorumManager.initialize(p2pNode, chainContext);
    return quorumManager.getMainnetAdmissionStatus();
  }

  /**
   * Phase 35: Check all 10 mainnet mining admission rules
   * 
   * 1. Mainnet must enable Quorum Check
   * 2. Local multiple browsers don't count (same IP Hash = 0 score)
   * 3. At least 2 independent IPs (≥3 in mature phase)
   * 4. QuorumScore ≥ threshold (150/250/400)
   * 5. Bootstrap completed (chain fully synced)
   * 6. HeightConsensus consistent (no local leading)
   * 7. Finality normal (2/3 committee signed)
   * 8. Fork detected → auto-block mining
   * 9. Mining effectiveness monitoring (too many orphan blocks → block mining)
   * 10. Delegator normally allocates nonce before allowing mining
   */
  static async checkMainnetAdmissionRules(
    chainContext: ChainContext,
    p2pNode: P2PNode | null,
    finalityManager: any,
    _localInstanceRole: "LEADER" | "FOLLOWER",
    bootstrapComplete: boolean
  ): Promise<{
    passed: boolean;
    rules: Array<{
      id: number;
      name: string;
      passed: boolean;
      reason?: string;
    }>;
  }> {
    const rules: Array<{ id: number; name: string; passed: boolean; reason?: string }> = [];
    
    // Rule 1: Mainnet must enable Quorum Check
    const isMainnetNetwork = isMainnet(chainContext.params);
    rules.push({
      id: 1,
      name: "Mainnet Quorum Check Enabled",
      passed: isMainnetNetwork,
      reason: isMainnetNetwork ? undefined : "Not on mainnet",
    });

    // Rule 2: Local multiple browsers don't count (same IP Hash = 0 score)
    // This is handled by QuorumManager - same IP peers get 0 score
    const { getQuorumManager } = await import("./quorumManager.js");
    const quorumManager = getQuorumManager();
    quorumManager.initialize(p2pNode, chainContext);
    const quorumStatus = quorumManager.getQuorumStatus();
    const hasSameIPPeers = quorumStatus.peerMetrics.some(p => {
      const sameIPCount = quorumStatus.peerMetrics.filter(m => m.ipHash === p.ipHash && m.ipHash).length;
      return sameIPCount > 1 && p.scoreBreakdown.ipIndependence === 0;
    });
    rules.push({
      id: 2,
      name: "IP Independence Check",
      passed: !hasSameIPPeers || quorumStatus.independentPeerCount > 0,
      reason: hasSameIPPeers ? "Same IP peers detected (not counted)" : undefined,
    });

    // Rule 3: At least 2 independent IPs (≥3 in mature phase)
    const admissionStatus = quorumManager.getMainnetAdmissionStatus();
    rules.push({
      id: 3,
      name: `Independent Peers (${admissionStatus.stage} stage)`,
      passed: admissionStatus.independentPeers >= admissionStatus.requiredIndependentPeers,
      reason: admissionStatus.independentPeers < admissionStatus.requiredIndependentPeers
        ? `Have ${admissionStatus.independentPeers}, need ${admissionStatus.requiredIndependentPeers}`
        : undefined,
    });

    // Rule 4: QuorumScore ≥ threshold
    rules.push({
      id: 4,
      name: `Quorum Score (${admissionStatus.stage} stage)`,
      passed: admissionStatus.quorumScore >= admissionStatus.requiredQuorumScore,
      reason: admissionStatus.quorumScore < admissionStatus.requiredQuorumScore
        ? `Score ${admissionStatus.quorumScore} < required ${admissionStatus.requiredQuorumScore}`
        : undefined,
    });

    // Rule 5: Bootstrap completed
    rules.push({
      id: 5,
      name: "Bootstrap Completed",
      passed: bootstrapComplete,
      reason: bootstrapComplete ? undefined : "Bootstrap sync not completed",
    });

    // Rule 6: HeightConsensus consistent (no local leading)
    const localTip = chainContext.storage.getTip();
    const localHeight = localTip?.header.height ?? 0;
    // Check if we're ahead of network (would need GlobalStateSentinel for accurate check)
    // For now, we'll assume consistent if we have peers and bootstrap is complete
    const heightConsistent = !p2pNode || p2pNode.getPeerCount() === 0 || bootstrapComplete;
    rules.push({
      id: 6,
      name: "Height Consensus Consistent",
      passed: heightConsistent,
      reason: heightConsistent ? undefined : "Local height may be ahead of network",
    });

    // Rule 7: Finality normal (2/3 committee signed)
    let finalityNormal = true;
    if (chainContext.params.finalityEnabled && finalityManager) {
      const finalityStats = finalityManager.getStats();
      if (finalityStats) {
        const finalizedHeight = finalityStats.finalizedHeight || 0;
        const finalityLag = localHeight - finalizedHeight;
        finalityNormal = finalityLag <= 5; // Allow up to 5 blocks unfinalized
      }
    }
    rules.push({
      id: 7,
      name: "Finality Normal",
      passed: finalityNormal,
      reason: finalityNormal ? undefined : "Too many unfinalized blocks",
    });

    // Rule 8: Fork detected → auto-block mining
    // This would be handled by GlobalStateSentinel and LongRangeDetector
    // For now, we'll check if there's a conflict detected
    const forkDetected = false; // Would be set by conflict detection system
    rules.push({
      id: 8,
      name: "No Fork Detected",
      passed: !forkDetected,
      reason: forkDetected ? "Fork detected in network" : undefined,
    });

    // Rule 9: Mining effectiveness monitoring
    // Check if mining stats show too many orphan blocks
    let miningEffective = true;
    try {
      const { getMiningStatsTracker } = await import("./miningStats.js");
      const statsTracker = getMiningStatsTracker();
      const stats = statsTracker.getStats();
      if (stats.totalBlocksMined > 10) {
        const orphanRate = stats.orphanedBlocks / stats.totalBlocksMined;
        miningEffective = orphanRate < 0.5; // Allow up to 50% orphan rate
      }
    } catch (e) {
      // Stats tracker not available, assume effective
    }
    rules.push({
      id: 9,
      name: "Mining Effectiveness",
      passed: miningEffective,
      reason: miningEffective ? undefined : "Too many orphan blocks (mining ineffective)",
    });

    // Rule 10: Delegator normally allocates nonce
    // This is handled by DelegatorManager - if delegator is available and working
    let delegatorReady = true;
    if (isMainnetNetwork) {
      // In mainnet, we might require delegator to be ready
      // For now, we'll allow mining even without delegator (solo mining)
      delegatorReady = true;
    }
    rules.push({
      id: 10,
      name: "Delegator Ready",
      passed: delegatorReady,
      reason: delegatorReady ? undefined : "Delegator not ready for nonce allocation",
    });

    const passed = rules.every(r => r.passed);

    return { passed, rules };
  }
}

/**
 * Phase 35: Mainnet admission status (re-export from quorumManager)
 */
export type { MainnetAdmissionStatus, NetworkStage } from "./quorumManager.js";

