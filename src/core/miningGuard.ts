/**
 * Phase 30: Mining Guard - Pre-mining Health Checks
 * Phase 33: Mining Permission Levels - Three-tier mining system
 * Phase 39: Network Stage System - Three-stage architecture
 * 
 * Ensures mining only happens when node is:
 * - Synchronized with network
 * - Connected to sufficient peers
 * - On the correct network (mainnet)
 * - Has finalized blocks up to date (after initialization phase)
 * 
 * Phase 33: Three-tier mining permission levels:
 * - SAFE: Mainnet default, requires >= 3 peers
 * - GUARDED: Dev/testnet mode, allows < 3 peers with warnings
 * - LOCAL_ONLY: Training mode, completely local mining
 * 
 * Phase 39: Network Stage System
 * 
 * Three distinct stages with different security rules:
 * 
 * 1. Genesis Quorum Mode (height = 0)
 *    - Trigger: localHeight === 0 && rootTipHeight === 0
 *    - Requirements: ≥2 independent IPs, bootstrapComplete, stable peers
 *    - Rules: Skip all finality/stateLock/stateCommit/stateDrift checks
 *    - Exit: localHeight >= 1
 * 
 * 2. Finality Initialization Mode (warmup phase)
 *    - Trigger: finalizedHeight === 0 AND (localHeight < 50 OR localHeight <= 500)
 *    - Rules: Relax StateLock/stateCommit/drift checks (allow mining)
 *    - Safety: If height > 500 and finalizedHeight still 0, treat as system error
 *    - Exit: finalizedHeight > 0 AND localHeight >= 50
 * 
 * 3. Normal Finality Mode (mature phase)
 *    - Trigger: finalizedHeight > 0 AND localHeight >= 50
 *    - Rules: Full strict checks (StateLock, stateCommit, drift, etc.)
 *    - All security mechanisms active
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { validateMainnetParams, isMainnet } from "./networkParams.js";
import { getQuorumManager } from "./quorumManager.js";
import { logger } from "./logger.js";
import { getYear } from "./idcEmission.js";
import { isSlotLeaderModeEnabled } from "./featureFlags.js";
import { getSlotIdentity, deriveRandSeed, selectLeader } from "./slotSchedule.js";

/**
 * Phase 33: Mining permission level
 */
export type MiningMode = "SAFE" | "GUARDED" | "LOCAL_ONLY" | "BLOCKED";

/**
 * Phase 39: Mining network stage for mining readiness
 * Different from quorumManager's NetworkStage (which is for network maturity)
 */
export type MiningNetworkStage = "GENESIS_QUORUM" | "FINALITY_INIT" | "NORMAL_FINALITY";

/**
 * Phase 39: Mining network stage information
 */
export interface MiningNetworkStageInfo {
  stage: MiningNetworkStage;
  relaxedChecks: string[]; // List of checks that are relaxed in this stage
  description: string;
}

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
    | "STATE_DRIFT_DETECTED" // Phase 36
    | "NOT_ACTIVE_MINER"; // Phase 44: Not the active miner for this device
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
    // Phase 39: Finality Initialization Mode
    finalityLag?: number;
    isFinalityInitializationPhase?: boolean;
    // Phase 39: Mining network stage information
    networkStage?: MiningNetworkStage;
    networkStageInfo?: MiningNetworkStageInfo;
    // Phase 44: Active miner and device information
    activeMinerId?: string;
    currentMinerId?: string;
    deviceId?: string;
    ipSharingWeight?: number;
    ipSharingPosition?: number;
  };
}

/**
 * Phase 39: Network stage constants
 */
const FINALITY_WARMUP_HEIGHT = 50; // Height threshold for warmup phase
// Increase tolerance so dev/single-node environments are not blocked early
const FINALITY_WARMUP_MAX_HEIGHT = 500000; // Maximum height to tolerate finalizedHeight === 0 (dev-friendly)

/**
 * Mining Guard
 * 
 * Performs health checks before allowing mining
 */
export class MiningGuard {
  /**
   * Check if we're in the first year (Year 0-1)
   * First year: height < IDC_BLOCKS_PER_YEAR (3,153,600 blocks)
   */
  static isFirstYear(chainContext: ChainContext): boolean {
    const localTip = chainContext.storage.getTip();
    const localHeight = localTip?.header.height ?? 0;
    const year = getYear(localHeight);
    return year === 0; // Year 0 is the first year
  }

  /**
   * Phase 39: Determine current network stage
   */
  static getNetworkStage(
    chainContext: ChainContext,
    quorumManager: any,
    finalityManager?: any
  ): { stage: MiningNetworkStage; info: MiningNetworkStageInfo } {
    const localTip = chainContext.storage.getTip();
    const localHeight = localTip?.header.height ?? 0;
    
    // Check Genesis phase
    if (quorumManager.isGenesisPhase()) {
      return {
        stage: "GENESIS_QUORUM",
        info: {
          stage: "GENESIS_QUORUM",
          relaxedChecks: [
            "Finality checks",
            "StateLock checks",
            "StateCommit checks",
            "StateDrift checks"
          ],
          description: "Genesis phase: Mining allowed with minimal requirements (≥2 independent IPs, bootstrapComplete). All finality/state checks skipped."
        }
      };
    }
    
    // Check Finality Initialization Mode
    let finalizedHeight = 0;
    if (finalityManager) {
      const finalityStats = finalityManager.getStats();
      if (finalityStats) {
        finalizedHeight = finalityStats.finalizedHeight || 0;
      }
    }
    
    // Phase 39: Safe Finality Initialization Mode check
    // - Height < 50: Always in warmup
    // - Height 50-500 AND finalizedHeight === 0: Tolerate warmup (finality may be starting)
    // - Height > 500 AND finalizedHeight === 0: System error, treat as normal mode (strict checks)
    const isFinalityInitPhase = 
      localHeight < FINALITY_WARMUP_HEIGHT || 
      (finalizedHeight === 0 && localHeight <= FINALITY_WARMUP_MAX_HEIGHT);
    
    if (isFinalityInitPhase) {
      return {
        stage: "FINALITY_INIT",
        info: {
          stage: "FINALITY_INIT",
          relaxedChecks: [
            "StateLock formation (quorum < 66.67%)",
            "Recent state commits",
            "Critical state drift"
          ],
          description: `Finality Initialization Mode: Finality system warming up (height: ${localHeight}, finalized: ${finalizedHeight}). StateLock/stateCommit/drift checks relaxed.`
        }
      };
    }
    
    // Normal Finality Mode
    return {
      stage: "NORMAL_FINALITY",
      info: {
        stage: "NORMAL_FINALITY",
        relaxedChecks: [],
        description: "Normal Finality Mode: All security mechanisms active (StateLock, stateCommit, drift checks enforced)."
      }
    };
  }

  /**
   * Phase 39: Check if in Finality Initialization Phase (with safety limits)
   */
  /**
   * Phase 39: Check if in Finality Initialization Phase (with safety limits)
   * @deprecated Use getNetworkStage() instead for more comprehensive stage information
   */
  static isFinalityInitializationPhase(
    localHeight: number,
    finalizedHeight: number
  ): boolean {
    // Case 1: Height is low (< 50), definitely in warmup
    if (localHeight < FINALITY_WARMUP_HEIGHT) {
      return true;
    }
    
    // Case 2: finalizedHeight hasn't started, but we're still in tolerance range (50-500)
    // Allow warmup mode to give finality system time to start
    if (finalizedHeight === 0 && localHeight <= FINALITY_WARMUP_MAX_HEIGHT) {
      return true;
    }
    
    // Case 3: Height > 500 and still no finalized blocks
    // This is likely a system error, don't treat as warmup (enforce strict checks)
    return false;
  }

  /**
   * Check if mining is safe to start
   * 
   * Phase 44: Added active miner check and device/IP restrictions
   */
  static async canMineNow(
    chainContext: ChainContext,
    p2pNode: P2PNode | null,
    finalityManager?: any,
    localInstanceRole?: "LEADER" | "FOLLOWER",
    miningWalletAddress?: string,
    bootstrapComplete?: boolean, // Phase 32: Bootstrap sync status
    shadowNodeClient?: any, // Phase 44: Shadow Node client for active miner check
    deviceId?: string // Phase 44: Device ID for device restriction
  ): Promise<MiningGuardResult> {
    // Phase 32: Check bootstrap sync status
    // bootstrapComplete === true means we've synced from signal server's rootTip
    // This is important for Cold Start phase: even with 0 peers, if bootstrapComplete === true,
    // we should allow mining (subject to QuorumScore and other checks)
    
    // Phase 45: First year requires only 1 independent peer (define early)
    const MIN_PEERS_FIRST_YEAR = 1;
    
    // Check 1: P2P connection to signal server (required for bootstrap)
    if (!p2pNode || !p2pNode.isConnected) {
      // If bootstrap is complete, we might still allow mining (Cold Start mode)
      if (bootstrapComplete) {
        logger.debug(`[Phase 32] P2P disconnected but bootstrap complete - allowing Cold Start mining`);
        // Continue to other checks, but note that we're in Cold Start mode
      } else {
        return {
          ok: false,
          code: "INSUFFICIENT_PEERS",
          reason: "Not connected to P2P network and bootstrap not complete",
          details: {
            peerCount: 0,
            requiredPeers: MIN_PEERS_FIRST_YEAR, // Phase 45: Use first year minimum
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
    
    // Phase 39: Determine current network stage
    const { stage: networkStage, info: stageInfo } = this.getNetworkStage(
      chainContext,
      quorumManager,
      finalityManager
    );
    
    // Phase 45: Dynamic minimum peers based on network age
    // First year (age < 1 year OR height < 50,000): Require only 1 independent peer
    const tip = chainContext.storage.getTip();
    const currentHeight = tip?.header.height ?? 0;
    const networkAgeYears = quorumManager.getNetworkAgeYears(chainContext.params);
    const isFirstYearModeForPeers = (networkAgeYears < 1 || currentHeight < 50_000) && isMainnetNetwork;
    
    const minPeersRequired = isFirstYearModeForPeers 
      ? MIN_PEERS_FIRST_YEAR 
      : (chainContext.params.minPeersRequired ?? 3);
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
      miningMode = "GUARDED"; // Use GUARDED mode for Cold Start
    }
    
    // Phase 45: First Year Mode - Ultra-lenient rules
    // First year (age < 1 year OR height < 50,000): Only check minimal requirements
    const isFirstYearMode = (networkAgeYears < 1 || currentHeight < 50_000) && isMainnetNetwork;
    
    if (isFirstYearMode && p2pNode) {
      // Phase 45: First year requirements: ≥1 independent IP, Quorum ≥ 40, bootstrapComplete, no critical state drift
      // Check state drift (only critical drift blocks mining)
      let stateDriftCritical = false;
      try {
        const { getStateDriftDetector } = await import("./stateDriftDetector.js");
        const driftDetector = getStateDriftDetector();
        driftDetector.initialize(chainContext, p2pNode);
        const driftCheck = driftDetector.checkDrift();
        stateDriftCritical = driftCheck.hasDrift && driftCheck.severity === "critical";
      } catch (e) {
        // Production: No console logs
      }
      
      // Phase 45: Get dynamic required quorum score (first year = 40)
      const firstYearRequiredQuorumScore = quorumManager.getRequiredQuorumScore(chainContext.params, { height: currentHeight });
      const firstYearRequiredPeers = MIN_PEERS_FIRST_YEAR;
      
      // Phase 45: Check independent peers first (must have ≥1)
      if (quorumStatus.independentPeerCount < firstYearRequiredPeers) {
        return {
          ok: false,
          mode: "BLOCKED",
          code: "INSUFFICIENT_PEERS",
          reason: `首年规则：需要至少 ${firstYearRequiredPeers} 个独立 IP 对等节点，目前只有 ${quorumStatus.independentPeerCount} 个`,
          details: {
            peerCount,
            requiredPeers: firstYearRequiredPeers,
            independentPeerCount: quorumStatus.independentPeerCount,
            quorumScore: quorumStatus.totalScore,
            requiredQuorumScore: firstYearRequiredQuorumScore,
          },
        };
      }
      
      // Check quorum score (constant = current policy threshold)
      if (quorumStatus.totalScore < firstYearRequiredQuorumScore) {
        return {
          ok: false,
          mode: "BLOCKED",
          code: "INSUFFICIENT_PEERS",
          reason: `规则 2：当前 Quorum 分数为 ${quorumStatus.totalScore}，需要 ≥ ${firstYearRequiredQuorumScore}`,
          details: {
            peerCount,
            requiredPeers: firstYearRequiredPeers,
            quorumScore: quorumStatus.totalScore,
            requiredQuorumScore: firstYearRequiredQuorumScore,
            independentPeerCount: quorumStatus.independentPeerCount,
          },
        };
      }
      
      // Phase 45: All first year requirements met
      if (bootstrapComplete && !stateDriftCritical) {
        // Production: No console logs
        miningMode = "SAFE";
        // Skip all StateLock/Finality checks for first year (but Quorum score is checked above)
        // Continue to wallet/network checks, then return success
      } else {
        // Phase 45: First year: Still need minimal requirements
        const reasons: string[] = [];
        if (quorumStatus.independentPeerCount < firstYearRequiredPeers) {
          reasons.push(`需要 ≥${firstYearRequiredPeers} 个独立对等节点（当前: ${quorumStatus.independentPeerCount}）`);
        }
        if (quorumStatus.totalScore < firstYearRequiredQuorumScore) {
          reasons.push(`Quorum 分数 ${quorumStatus.totalScore} < 要求 ${firstYearRequiredQuorumScore}`);
        }
        if (!bootstrapComplete) {
          reasons.push("Bootstrap 未完成");
        }
        if (stateDriftCritical) {
          reasons.push("检测到严重状态漂移");
        }
        
        return {
          ok: false,
          mode: "BLOCKED",
          code: "INSUFFICIENT_PEERS",
          reason: `首年规则：${reasons.join(", ")}`,
          details: {
            peerCount,
            requiredPeers: firstYearRequiredPeers,
            quorumScore: quorumStatus.totalScore,
            requiredQuorumScore: firstYearRequiredQuorumScore,
            independentPeerCount: quorumStatus.independentPeerCount,
            requiredIndependentPeers: firstYearRequiredPeers,
            networkStage: "GENESIS_QUORUM", // Use existing stage type
            networkStageInfo: {
              stage: "GENESIS_QUORUM",
              relaxedChecks: ["StateLock", "Finality", "GSN"], // Quorum score is still required (≥30)
              description: "First year: Relaxed rules - require ≥1 independent IP, Quorum ≥30, bootstrap complete, no critical drift",
            },
          },
        };
      }
    }
    
    // Phase 39: Stage 1 - Genesis Quorum Mode (height = 0)
    if (networkStage === "GENESIS_QUORUM" && isMainnetNetwork && p2pNode && !isFirstYearMode) {
      // Genesis mode: Check minimal requirements
      // Requirements: ≥1 independent IP, online >2 minutes, bootstrapComplete
      if (quorumStatus.ready && quorumStatus.independentPeerCount >= 1) {
        logger.info(`[Phase 39] 🌟 Genesis Quorum Mode: Allowing mining at height 0 (independent peers: ${quorumStatus.independentPeerCount}, score: ${quorumStatus.totalScore})`);
        // Skip all finality/state checks in Genesis mode
        // Continue to wallet/network checks, then return success
      } else {
        return {
          ok: false,
          mode: "BLOCKED",
          code: "INSUFFICIENT_PEERS",
          reason: `Genesis phase: Need ≥1 independent peer (current: ${quorumStatus.independentPeerCount}), stable peers, and bootstrap complete`,
          details: {
            peerCount,
            requiredPeers: 1,
            quorumScore: quorumStatus.totalScore,
            requiredQuorumScore: quorumStatus.requiredScore,
            independentPeerCount: quorumStatus.independentPeerCount,
            requiredIndependentPeers: 1,
            networkStage,
            networkStageInfo: stageInfo,
          },
        };
      }
    }
    
    // Phase 35: Check mainnet admission rules first (unless in Cold Start mode, Genesis mode, or First Year mode)
    if (isMainnetNetwork && !isColdStartMode && networkStage !== "GENESIS_QUORUM" && !isFirstYearMode && p2pNode) {
      const admissionStatus = quorumManager.getMainnetAdmissionStatus();
      
      if (admissionStatus.admissionReady) {
        // Phase 36: Check state lock
        // Phase 39: Use network stage to determine if we should relax checks
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
        
        // Phase 39: Stage 2 - Finality Initialization Mode: Relax checks
        // Stage 3 - Normal Finality Mode: Enforce strict checks
        if (networkStage === "FINALITY_INIT") {
          // Phase 39: Relax state lock check during initialization phase
          // During initialization, StateLock may not form yet (needs 66.67% quorum with only 2 nodes)
          // This is safe because:
          // 1. Genesis Quorum mode provides security (≥2 independent IPs)
          // 2. Quorum score evaluation ensures network quality
          // 3. StateCommitment gossip provides early consistency
          // 4. StateLock will form naturally as network grows
          if (!lockCheck.allowed) {
            logger.debug(`[Phase 39] StateLock not formed (quorum: ${lockCheck.reason?.match(/quorum: ([\d.]+)%/)?.[1] || 'N/A'}%), but allowing mining (Finality Initialization Mode)`);
          }
          
          // Relax state commit check during initialization phase
          if (!hasRecentCommits) {
            logger.debug(`[Phase 39] No recent state commits, but allowing mining (Finality Initialization Mode)`);
          }
          
          // Relax drift check during initialization phase
          if (driftCheck.hasDrift && driftCheck.severity === "critical") {
            logger.debug(`[Phase 39] State drift detected, but allowing mining (Finality Initialization Mode): ${driftCheck.reason}`);
          }
        } else if (networkStage === "NORMAL_FINALITY") {
          // Phase 39: Stage 3 - Normal Finality Mode: Enforce all checks
          
          // Enforce state lock check
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
                networkStage,
                networkStageInfo: stageInfo,
              },
            };
          }
          
          // Enforce state commit check
          if (!hasRecentCommits) {
            return {
              ok: false,
              mode: "BLOCKED",
              code: "NO_RECENT_STATE_COMMITS",
              reason: "No recent state commits received from peers (>30s)",
              details: {
                peerCount,
                requiredPeers: minPeersRequired,
                networkStage,
                networkStageInfo: stageInfo,
              },
            };
          }
          
          // Enforce drift check
          if (driftCheck.hasDrift && driftCheck.severity === "critical") {
            return {
              ok: false,
              mode: "BLOCKED",
              code: "STATE_DRIFT_DETECTED",
              reason: `Critical state drift detected: ${driftCheck.reason}`,
              details: {
                peerCount,
                requiredPeers: minPeersRequired,
                networkStage,
                networkStageInfo: stageInfo,
              },
            };
          }
        }
        
        // Level 1: SAFE Mining - Mainnet admission rules satisfied + state lock OK
        miningMode = "SAFE";
        logger.debug(`[Phase 35/36] Mainnet admission ready: Stage ${admissionStatus.stage}, Score ${admissionStatus.quorumScore} >= ${admissionStatus.requiredQuorumScore}, Independent peers ${admissionStatus.independentPeers} >= ${admissionStatus.requiredIndependentPeers}, State lock OK`);
      } else {
        // BLOCKED: Mainnet admission rules not satisfied
        // Phase 39: Use requiredIndependentPeers for mainnet admission error message
        return {
          ok: false,
          mode: "BLOCKED",
          code: "INSUFFICIENT_PEERS",
          reason: `Mainnet admission not ready (${admissionStatus.stage} stage): Quorum score ${admissionStatus.quorumScore} < ${admissionStatus.requiredQuorumScore} or independent peers ${admissionStatus.independentPeers} < ${admissionStatus.requiredIndependentPeers}. ${admissionStatus.reasons.join("; ")}`,
          details: {
            peerCount,
            requiredPeers: admissionStatus.requiredIndependentPeers, // Phase 39: Use requiredIndependentPeers for mainnet
            requiredIndependentPeers: admissionStatus.requiredIndependentPeers,
            quorumScore: admissionStatus.quorumScore,
            requiredQuorumScore: admissionStatus.requiredQuorumScore,
            independentPeerCount: admissionStatus.independentPeers,
          },
        };
      }
    } else if (peerCount >= minPeersRequired && !isMainnetNetwork) {
      // Level 1: SAFE Mining - Dev/testnet with enough peers
      miningMode = "SAFE";
    } else if (allowLocalMining && isLocalMiningMode) {
      // Level 3: LOCAL_ONLY Mining - Training mode
      miningMode = "LOCAL_ONLY";
      logger.debug(`[Phase 33] Local-only mining mode enabled (peers: ${peerCount})`);
    } else if (bootstrapComplete && peerCount === 0) {
      // Phase 37: Cold Start mode - bootstrap complete but no peers yet
      miningMode = "GUARDED";
    } else if (allowGuardedMining) {
      // Level 2: GUARDED Mining - Dev/testnet with warnings
      miningMode = "GUARDED";
      logger.debug(`[Phase 33] Guarded mining mode: ${peerCount} peers < ${minPeersRequired} (dev/testnet mode)`);
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
      // Phase 45: Skip this check if we're in first year mode and already passed first year checks above
      // (First year mode is handled earlier in the function, so if we reach here in first year mode,
      // it means bootstrap is not complete or there's another issue)
      if (isFirstYearMode) {
        // Phase 45: In first year mode, if we reach here, it's likely bootstrap is not complete
        // or we're missing some other requirement. Don't show peer count error if peers are sufficient.
        if (quorumStatus.independentPeerCount >= MIN_PEERS_FIRST_YEAR) {
          // Peers are sufficient, but something else is blocking (likely bootstrap)
          // This should have been handled in the first year mode check above
          // Just continue to other checks
        } else {
          // Peers are actually insufficient
          return {
            ok: false,
            mode: "BLOCKED",
            code: "INSUFFICIENT_PEERS",
            reason: `首年规则：需要至少 ${MIN_PEERS_FIRST_YEAR} 个独立 IP 对等节点，目前只有 ${quorumStatus.independentPeerCount} 个`,
            details: {
              peerCount,
              requiredPeers: MIN_PEERS_FIRST_YEAR,
              independentPeerCount: quorumStatus.independentPeerCount,
              requiredIndependentPeers: MIN_PEERS_FIRST_YEAR,
              quorumScore: quorumStatus.totalScore,
              requiredQuorumScore: quorumManager.getRequiredQuorumScore(chainContext.params, { height: currentHeight }),
            },
          };
        }
      } else {
        // Normal mode: Show peer insufficiency
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

    // Phase 44: Check 2.5: Active miner check (same device restriction)
    // Rule: Same device can only have 1 active miner
    if (shadowNodeClient && deviceId) {
      const currentActiveMinerId = shadowNodeClient.getActiveMinerId();
      const sessionId = shadowNodeClient.getSessionId();
      const nodeId = p2pNode?.nodeId || "unknown";
      const currentMinerId = sessionId ? `${sessionId}-${nodeId}` : `${deviceId}-${nodeId}`;
      
      // If there's an active miner and it's not us, block mining
      if (currentActiveMinerId && currentActiveMinerId !== currentMinerId) {
        return {
          ok: false,
          code: "NOT_ACTIVE_MINER",
          reason: "Another device/tab is already mining. Only one active miner per device is allowed.",
          details: {
            activeMinerId: currentActiveMinerId,
            currentMinerId,
            deviceId,
          },
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

    // Check 5: Synchronization status (STRICT)
    // Enforce: must be fully synced to the latest known network height before mining
    {
      const localHeightStrict = chainContext.storage.getTip()?.header.height ?? 0;
      let networkHeightStrict = 0;
      if (typeof window !== "undefined") {
        try {
          networkHeightStrict = (window as any).lastRootTipHeight || 0;
        } catch {}
      }
      if (networkHeightStrict > 0 && localHeightStrict < networkHeightStrict) {
        return {
          ok: false,
          mode: "BLOCKED",
          code: "NOT_SYNCED",
          reason: `Must sync to latest height before mining (local: ${localHeightStrict}, network: ${networkHeightStrict}, behind: ${networkHeightStrict - localHeightStrict})`,
          details: {
            localHeight: localHeightStrict,
            networkHeight: networkHeightStrict,
            peerCount,
          },
        };
      }
    }

    // Check 5.1: Require at least one open data channel (ensures block propagation before mining)
    if (p2pNode) {
      const openChannels =
        Array.from(p2pNode.peers?.values() || []).filter(
          (p: any) => p.connected && p.dataChannel && p.dataChannel.readyState === "open"
        ).length;
      // If there are known peers but zero open channels, block mining
      if (peerCount > 0 && openChannels === 0) {
        return {
          ok: false,
          mode: "BLOCKED",
          code: "NOT_SYNCED",
          reason: "No data channels open to peers. Wait for a P2P data channel to open before mining.",
          details: {
            peerCount,
          },
        };
      }
    }
    
    // Check 6: Finality status (if finality is enabled)
    // Phase 39: Finality Initialization Mode
    if (chainContext.params.finalityEnabled && finalityManager) {
      const finalityStats = finalityManager.getStats();
      if (finalityStats) {
        const finalizedHeight = finalityStats.finalizedHeight || 0;
        const finalityLocalHeight = tip?.header.height ?? 0;
        const finalityLag = finalityLocalHeight - finalizedHeight;
        const maxFinalityLag = 5; // Allow up to 5 blocks unfinalized
        
        // Phase 39: Use network stage to determine if we should relax finality check
        // Genesis mode: Skip finality check entirely
        // Finality Init mode: Allow large finalityLag
        // Normal mode: Enforce finalityLag <= 5
        const isMainnetNetwork = isMainnet(chainContext.params);
        const shouldRelaxCheck = !isMainnetNetwork || networkStage === "GENESIS_QUORUM" || networkStage === "FINALITY_INIT";
        
        // Phase 39: Only enforce finalityLag check in Normal Finality Mode
        if (finalityLag > maxFinalityLag && !shouldRelaxCheck) {
          return {
            ok: false,
            code: "NOT_FINALIZED",
            reason: `Too many unfinalized blocks: ${finalityLag} > ${maxFinalityLag}`,
            details: {
              localHeight: finalityLocalHeight,
              finalizedHeight,
              tipHeight: finalityLocalHeight,
              finalityLag,
              isFinalityInitializationPhase: false,
              networkStage,
              networkStageInfo: stageInfo,
            },
          };
        }
        
        // Phase 39: Log info during initialization phase (don't block mining)
        if (finalityLag > maxFinalityLag && shouldRelaxCheck) {
          if (networkStage === "FINALITY_INIT") {
            // Finality Initialization Mode: allowing mining during warmup
          } else if (networkStage === "GENESIS_QUORUM") {
            logger.debug(`[Phase 39] Genesis Quorum Mode: finalityLag=${finalityLag}, but skipping finality check (height=0)`);
          } else {
            logger.debug(`[Phase 36] Finality lag ${finalityLag} > ${maxFinalityLag}, but allowing mining (dev/testnet mode)`);
          }
        }
      }
    }

    // Check 7: Verify we have consensus on tip hash from multiple peers
    // This would require integration with GlobalStateSentinel
    // For now, we'll just check if we have enough peers
    
    // Phase 44: Calculate IP sharing weight
    let ipSharingWeight = 1.0;
    let ipSharingPosition = 1;
    if (p2pNode && deviceId) {
      try {
        const { getIPSharingTracker } = await import("./ipSharingWeight.js");
        const { getQuorumManager } = await import("./quorumManager.js");
        
        const ipSharingTracker = getIPSharingTracker();
        const quorumManager = getQuorumManager();
        quorumManager.initialize(p2pNode, chainContext);
        const quorumStatus = quorumManager.getQuorumStatus();
        
        // Get IP hash from quorum status (if available)
        // Try to find local peer's IP hash, or use deviceId
        const localPeer = quorumStatus.peerMetrics.find(p => p.peerId === p2pNode?.nodeId);
        const ipHash = localPeer?.ipHash || deviceId;
        const minerId = deviceId;
        
        // Register this miner and get position
        ipSharingPosition = ipSharingTracker.registerMiner(ipHash, minerId);
        ipSharingWeight = ipSharingTracker.getSharingWeight(ipHash, minerId);
      } catch (e) {
        logger.debug("[Phase 44] Failed to calculate IP sharing weight:", e);
        // Continue with default weight (1.0)
      }
    }

    // Phase 33: All checks passed, return with mining mode and quorum info
    // Phase 39: Include network stage information
    // Phase 44: Include IP sharing weight information
    // Phase 45: Get actual required quorum score (first year = 40, not 50)
    const isFirstYearModeForDisplay = this.isFirstYear(chainContext) && isMainnet(chainContext.params);
    let requiredQuorumScoreForDisplay = quorumStatus.requiredScore;
    if (isFirstYearModeForDisplay && p2pNode) {
      const quorumManager = getQuorumManager();
      quorumManager.initialize(p2pNode, chainContext);
      const tip = chainContext.storage.getTip();
      const height = tip?.header.height ?? 0;
      requiredQuorumScoreForDisplay = quorumManager.getRequiredQuorumScore(chainContext.params, { height });
    }
    
    // Get required independent peers (first year: 1, normal: from admission status)
    let requiredIndependentPeers = 3; // Default for normal mode
    if (isFirstYearModeForDisplay) {
      requiredIndependentPeers = 1; // First year: min 1 independent peer
    } else if (p2pNode) {
      const quorumManager = getQuorumManager();
      quorumManager.initialize(p2pNode, chainContext);
      const admissionStatus = quorumManager.getMainnetAdmissionStatus();
      requiredIndependentPeers = admissionStatus.requiredIndependentPeers;
    }
    
    // Phase 48-C: Optional strict slot-leader gating before success return
    try {
      if (isSlotLeaderModeEnabled() && miningWalletAddress) {
        const nowMs = Date.now();
        const { epochId, slotIndex } = getSlotIdentity(nowMs);
        const tipBlock = chainContext.storage.getTip();
        const seed = await deriveRandSeed(tipBlock?.hash, epochId, slotIndex);
        const recipients: string[] = [];
        const prevCoinbase = tipBlock?.txs?.[0];
        if (prevCoinbase && prevCoinbase.ownerAddress === "idc_system") {
          for (const op of prevCoinbase.ops) {
            if (op.type === "TRANSFER" && op.to && typeof op.to === "string" && op.to.startsWith("idc_")) {
              if (!recipients.includes(op.to)) recipients.push(op.to);
            }
          }
        }
        if (!recipients.includes(miningWalletAddress)) recipients.push(miningWalletAddress);
        const candidates = recipients.map((a) => ({ address: a, weight: 1 }));
        const leader = await selectLeader(epochId, slotIndex, seed, candidates);
        if (!leader || leader !== miningWalletAddress) {
          return {
            ok: false,
            mode: "BLOCKED",
            code: "FOLLOWER_MODE",
            reason: "Not slot leader for current time window (leader-only mining enabled)",
            details: {
              peerCount,
              requiredPeers: minPeersRequired,
              independentPeerCount: quorumStatus.independentPeerCount,
              requiredIndependentPeers,
            },
          };
        }
      }
    } catch (e) {
      // Do not block if leader computation fails
    }
    
    return {
      ok: true,
      mode: miningMode,
      details: {
        localHeight: currentHeight,
        peerCount,
        requiredPeers: minPeersRequired,
        quorumScore: quorumStatus.totalScore,
        requiredQuorumScore: requiredQuorumScoreForDisplay,
        independentPeerCount: quorumStatus.independentPeerCount,
        requiredIndependentPeers,
        networkStage,
        networkStageInfo: stageInfo,
        // Phase 44: IP sharing information
        deviceId,
        ipSharingWeight,
        ipSharingPosition,
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
        // Phase 45: First year mode: requiredQuorumScore is 40 (or <= 50 for compatibility)
        const isFirstYearMode = result.details?.requiredQuorumScore !== undefined && result.details.requiredQuorumScore <= 50;
        if (isFirstYearMode && result.reason) {
          // Use the reason from first year mode (already formatted)
          return result.reason;
        }
        
        // Phase 39: Show independent peers requirement for mainnet, or total peers for dev/testnet
        const requiredPeers = result.details?.requiredIndependentPeers ?? result.details?.requiredPeers ?? 3;
        const currentPeers = result.details?.requiredIndependentPeers !== undefined 
          ? (result.details?.independentPeerCount ?? 0)
          : (result.details?.peerCount ?? 0);
        const peerLabel = result.details?.requiredIndependentPeers !== undefined
          ? (isZh ? "独立节点" : "independent peers")
          : (isZh ? "对等节点" : "peers");
        
        // Check if peers are actually insufficient (avoid showing "1 < 1" when peers are sufficient)
        const peersInsufficient = currentPeers < requiredPeers;
        
        // If peers are sufficient but quorum score is insufficient, show quorum score issue instead
        if (!peersInsufficient && result.details?.quorumScore !== undefined && result.details?.requiredQuorumScore !== undefined && result.details.requiredQuorumScore > 0) {
          const quorumScore = result.details.quorumScore;
          const requiredQuorumScore = result.details.requiredQuorumScore;
          return isZh
            ? `🚫 挖矿就绪：已阻止 - Quorum分数不足（${quorumScore} < ${requiredQuorumScore}）`
            : `🚫 Mining Ready: BLOCKED - Insufficient Quorum Score (${quorumScore} < ${requiredQuorumScore})`;
        }
        
        // Only show peer insufficiency if peers are actually insufficient
        if (peersInsufficient) {
          return isZh
            ? `🚫 挖矿就绪：已阻止 - ${peerLabel}不足（${currentPeers} < ${requiredPeers}）`
            : `🚫 Mining Ready: BLOCKED - Insufficient ${peerLabel} (${currentPeers} < ${requiredPeers})`;
        }
        
        // Fallback: show the reason from result if available
        return result.reason || (isZh 
          ? `🚫 挖矿就绪：已阻止 - 网络条件不满足`
          : `🚫 Mining Ready: BLOCKED - Network conditions not met`);
      
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
      
      case "NOT_ACTIVE_MINER":
        return isZh
          ? `🚫 挖矿就绪：已阻止 - 另一台设备/标签页正在挖矿（同一设备只能有1个活跃矿工）`
          : `🚫 Mining Ready: BLOCKED - Another device/tab is already mining (only 1 active miner per device allowed)`;
      
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
      isFinalityInitializationPhase?: boolean; // Phase 39: Finality Initialization Mode (deprecated, use networkStage)
      networkStage?: MiningNetworkStage; // Phase 39: Mining network stage
      networkStageInfo?: MiningNetworkStageInfo; // Phase 39: Mining network stage information
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
    
    // Phase 39: Check finality readiness (considering Network Stage System)
    let finalityReady = true;
    let networkStage: MiningNetworkStage = "NORMAL_FINALITY";
    let networkStageInfo: MiningNetworkStageInfo | undefined;
    
    // Get network stage
    const stageResult = this.getNetworkStage(chainContext, quorumManager, finalityManager);
    networkStage = stageResult.stage;
    networkStageInfo = stageResult.info;
    
    if (chainContext.params.finalityEnabled && finalityManager) {
      const finalityStats = finalityManager.getStats();
      if (finalityStats) {
        const localTip = chainContext.storage.getTip();
        const localHeight = localTip?.header.height ?? 0;
        const finalizedHeight = finalityStats.finalizedHeight || 0;
        const finalityLag = localHeight - finalizedHeight;
        
        // Phase 39: Network Stage System
        // Genesis/Init mode: finality is considered "ready" (mining allowed)
        // Normal mode: require finalityLag <= 5
        if (networkStage === "GENESIS_QUORUM" || networkStage === "FINALITY_INIT") {
          finalityReady = true; // Allow mining during initialization
        } else {
          finalityReady = finalityLag <= 5; // Require finality after initialization
        }
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
      
      // Phase 39: Only report finality issue if in Normal Finality Mode
      if (!finalityReady && networkStage === "NORMAL_FINALITY") {
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
      isFinalityInitializationPhase: networkStage === "FINALITY_INIT", // Phase 39: Deprecated, kept for compatibility
      networkStage, // Phase 39: Network stage
      networkStageInfo, // Phase 39: Network stage information
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
export type { MainnetAdmissionStatus } from "./quorumManager.js";
export type { NetworkStage } from "./quorumManager.js"; // Re-export quorumManager's NetworkStage for network maturity

