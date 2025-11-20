import { useState, useEffect, useRef } from "react";
import {
  initChain,
  getDefaultChainParams,
  appendMinedBlock,
  broadcastTransaction,
  type ChainContext,
} from "../core/chain.js";
import { Mempool } from "../core/mempool.js";
import { createTx, createTransferTx, getOrCreateBrowserNodeId } from "../core/tx.js";
import { getOrCreateNodeAddress } from "../core/keys.js";
import { getMultiWalletStore } from "../core/multiWallet.js";
import { buildCandidateBlock } from "../core/blockBuilder.js";
import { MinerClient } from "../core/minerClient.js";
import { MinerCluster } from "../core/minerCluster.js";
import { DelegatorManager } from "../core/delegatorManager.js";
import { WorkerNodeManager } from "../core/workerNode.js";
import type { NodeCapability, NonceRange } from "../core/globalNonceAllocator.js";
import { SnapshotDownloader } from "../core/snapshotDownloader.js";
import { SnapshotSeeder } from "../core/snapshotSeeder.js";
import { BrowserP2PNode } from "../core/p2p.js";
import { ShadowNodeClient, type ShadowState } from "../core/shadowNode.js";
import { handleReceivedBlock, handleReceivedBlocks } from "../core/sync.js";
import { HardReorgBanner } from "./HardReorgBanner.js";
import { ActiveMinerDialog, type ActiveMinerInfo } from "./ActiveMinerDialog.js";
import { getHeightSyncManager } from "../core/heightSyncManager.js";
import { getParallelSyncManager } from "../core/parallelSync.js";
import { getWarpSyncManager } from "../core/warpSync.js";
import { getChunkBasedSyncManager } from "../core/chunkBasedSync.js";
import { getIncrementalStateSyncManager } from "../core/incrementalStateSync.js";
import { GlobalStateSentinel } from "../core/globalSentinel.js";
import type { DriftAssessment } from "../core/types.js";
import { verifyTxSignature } from "../core/signatures.js";
import { verifyBlock } from "../core/verify.js";
import { logger } from "../core/logger.js";
import {
  getAverageBlockTime,
  getBlocksUntilAdjustment,
  explainDifficultyChange,
} from "../core/difficulty.js";
import {
  loadAllSnapshotMeta,
  getLatestSnapshotMeta,
  clearAllSnapshots,
  saveSnapshot,
  recompressAllSnapshots,
  getSnapshotSizeInfo,
  loadSnapshotByHeightSync,
  loadSnapshotByHeight,
} from "../core/snapshot.js";
import {
  getEmissionStats,
  getBlockRewardRaw,
  uIDCToIDC,
  IDC_MAX_SUPPLY,
  IDC_EMISSION_YEARS,
  IDC_BLOCKS_PER_YEAR,
  IDC_DECIMALS,
  IDC_BASE_FEE,
  IDC_FEE_PER_100_BYTES,
} from "../core/idcEmission.js";
import type { Operation, Block, Tx, SnapshotMeta } from "../core/types.js";
import { WalletBackupPanel } from "./WalletBackupPanel.js";
import { WalletManagerPanel } from "./WalletManagerPanel.js";
import { ConfigChecker } from "./ConfigChecker.js";
import { RuntimePanel } from "./RuntimePanel.js";
import { PrivacyPanel } from "./privacy/PrivacyPanel.js";
import { GlobalSentinelPanel } from "./GlobalSentinelPanel.js";
import { RuntimeManager } from "../core/runtimeManager.js";
import { useI18n } from "../i18n/useI18n.js";
import { formatNumber, formatAddress, formatPercent, formatInteger } from "../utils/format.js";
import { getLocalInstanceCoordinator, type LocalInstanceRole, type LeaderInfo } from "../core/localInstance.js";
import { getLocalStateCoordinator } from "../core/localStateCoordinator.js";
import { NetworkHealthPanel } from "./network/NetworkHealthPanel.js";
import { MiningMainCard } from "./mining/MiningMainCard.js";
import { MiningModeSelector } from "./mining/MiningModeSelector.js";
import { MiningAdvancedPanel } from "./mining/MiningAdvancedPanel.js";
import { MiningReadinessChipList } from "./mining/MiningReadinessChipList.js";
import { MiningWarningsPanel } from "./mining/MiningWarningsPanel.js";
import { MiningLiveStatsCard } from "./mining/MiningLiveStatsCard.js";
import { MiningOnboardingDialog } from "./mining/MiningOnboardingDialog.js";
import { MiningStatusBanner } from "./mining/MiningStatusBanner.js";
import { GenesisQuorumBanner } from "./mining/GenesisQuorumBanner.js";
import { MultiTerminalSyncNotice } from "./mining/MultiTerminalSyncNotice.js";
import { QuorumScoreExplanation } from "./mining/QuorumScoreExplanation.js";
// Phase 45: New Mining UX components
import { MiningStatusBar } from "./mining/MiningStatusBar.js";
import { RewardBreakdownCard } from "./mining/RewardBreakdownCard.js";
import { ReferralAndBoosterCard } from "./mining/ReferralAndBoosterCard.js";
import { NetworkMiniHealthCard } from "./mining/NetworkMiniHealthCard.js";
import { getOrCreateDeviceId } from "../core/ipSharingWeight.js";
import { QuickStatusDashboard } from "./components/QuickStatusDashboard.js";
import { AccordionCard } from "./components/AccordionCard.js";
import { DailyInfoBar } from "./components/DailyInfoBar.js";
import "./index.css";

/**
 * Main App Component
 *
 * Phase 4: P2P Networking
 */
function App() {
  const { locale, setLocale, t } = useI18n();
  const [chainContext, setChainContext] = useState<ChainContext | null>(null);
  const [mempool] = useState(() => new Mempool());
  // Load persisted state from localStorage
  const loadPersistedState = () => {
    try {
      const saved = localStorage.getItem("indexerchain_app_state");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      // Failed to load persisted state - silently ignore
    }
    return {};
  };

  const persistedState = loadPersistedState();
  const DEFAULT_MAINNET_SIGNALING = "wss://signal.indexerchain.com";
  
  const [isMining, setIsMining] = useState<boolean>(persistedState.isMining ?? false);
  const [loading, setLoading] = useState<boolean>(true);
  // Removed unused state: miningHash, miningNonce (replaced by MiningLiveStatsCard)
  const [error, setError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>(""); // Success message for transfers
  const [syncMessage, setSyncMessage] = useState<string>(""); // Phase 47: Sync status message for UI display
  // Phase 17: Support mainnet mode (default) and dev mode
  // Default to mainnet signaling server (can be configured)
  const [bootstrapUrl, setBootstrapUrl] = useState<string>(persistedState.bootstrapUrl ?? DEFAULT_MAINNET_SIGNALING);
  const [isMainnetMode, setIsMainnetMode] = useState<boolean>(persistedState.isMainnetMode ?? true);
  const [peerCount, setPeerCount] = useState<number>(0);
  const [isP2PConnected, setIsP2PConnected] = useState<boolean>(false);
  const [nodeAddress, setNodeAddress] = useState<string>("");
  const [isSigning, setIsSigning] = useState<boolean>(false);
  
  // Phase 42: Referral system - pending invite address
  const [pendingInviteAddress, setPendingInviteAddress] = useState<string | null>(null);
  const [currentReferrerAddress, setCurrentReferrerAddress] = useState<string | null>(null);
  
  // Phase 7: Transfer form state
  const [transferTo, setTransferTo] = useState<string>("");
  const [transferAmount, setTransferAmount] = useState<string>("");

  // Phase 8: Miner client and stats
  const [minerClient] = useState(() => {
    try {
      return new MinerClient();
    } catch (error) {
      console.error("Failed to create miner client:", error);
      // Return a client instance anyway - it will retry on first use
      return new MinerClient();
    }
  });
  const [miningStats, setMiningStats] = useState<{
    hashesTried: number;
    hashRate: number | null;
    elapsedTime: number;
  }>({
    hashesTried: 0,
    hashRate: null,
    elapsedTime: 0,
  });

  // Phase 18: Cluster mining
  const [minerCluster] = useState(() => new MinerCluster());
  const [clusterMining, setClusterMining] = useState<boolean>(persistedState.clusterMining ?? false);
  
  // Phase 38: Mining UX state
  const [miningMode, setMiningMode] = useState<"solo" | "cluster" | "global-pool">(() => {
    if (persistedState.globalPoolEnabled) return "global-pool";
    if (persistedState.clusterMining) return "cluster";
    return "solo";
  });
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(() => {
    try {
      return localStorage.getItem("mining_onboarding_completed") === "true";
    } catch {
      return false;
    }
  });
  // Phase 39: Use ref to immediately track onboarding completion (avoids async state update issue)
  const onboardingCompletedRef = useRef<boolean>(onboardingCompleted);
  
  // Phase 39: Sync ref with state when state changes
  useEffect(() => {
    onboardingCompletedRef.current = onboardingCompleted;
  }, [onboardingCompleted]);
  
  // Phase 26: Runtime Manager
  const [runtimeManager] = useState(() => {
    try {
      return new RuntimeManager();
    } catch (error) {
      console.error("Failed to create runtime manager:", error);
      return null;
    }
  });
  
  const [clusterWorkerCount, setClusterWorkerCount] = useState<number>(() => {
    // Phase 26: Use RuntimeManager to get recommended worker count
    if (runtimeManager) {
      const deviceCap = runtimeManager.getDeviceCapability();
      const recommended = deviceCap.recommendedWorkers;
      // Ensure at least 1 worker
      if (recommended > 0) {
        return recommended;
      }
    }
    // Fallback to CPU cores
    if (typeof navigator !== "undefined" && "hardwareConcurrency" in navigator) {
      const cores = navigator.hardwareConcurrency || 4;
      return Math.max(1, cores - 1);
    }
    return 4;
  });
  
  // Phase 27: Local Instance Coordinator
  const [localCoordinator] = useState(() => getLocalInstanceCoordinator());
  const [localRole, setLocalRole] = useState<LocalInstanceRole>("FOLLOWER");
  const [leaderInfo, setLeaderInfo] = useState<LeaderInfo | null>(null);
  const [localConflictDetected, setLocalConflictDetected] = useState<boolean>(false);
  
  // Phase 29: Local State Coordinator
  const [localStateCoordinator] = useState(() => getLocalStateCoordinator());
  const [localStateSyncInfo, setLocalStateSyncInfo] = useState<{
    lastSyncEpoch: number;
    lastSyncTime: number;
    lastSyncTipHash: string;
    lastSyncStateCommitment: string;
    syncStatus: "synced" | "syncing" | "out_of_sync" | "error";
    error?: string;
  }>({
    lastSyncEpoch: 0,
    lastSyncTime: 0,
    lastSyncTipHash: "",
    lastSyncStateCommitment: "",
    syncStatus: "synced",
  });
  const [consistencyCheck, setConsistencyCheck] = useState<{
    isConsistent: boolean;
    tipHashMatch: boolean;
    stateCommitmentMatch: boolean;
    heightMatch: boolean;
  }>({
    isConsistent: true,
    tipHashMatch: true,
    stateCommitmentMatch: true,
    heightMatch: true,
  });
  
  // Phase 26: Duty cycle state
  const [dutyCycle, setDutyCycle] = useState<number>(1.0);
  const [clusterStats, setClusterStats] = useState<{
    totalWorkers: number;
    activeWorkers: number;
    totalHashesTried: bigint;
    totalHashRate: number | null;
    workers: Array<{
      workerId: number;
      hashesTried: number;
      hashRate: number | null;
      currentNonceStart: bigint;
      currentNonceEnd: bigint | null;
      status: "running" | "stopped" | "exhausted" | "error"; // Phase 37-E: Added error status
    }>;
  }>({
    totalWorkers: 0,
    activeWorkers: 0,
    totalHashesTried: 0n,
    totalHashRate: null,
    workers: [],
  });

  // Phase 19: Global miner scheduler
  // Note: DelegatorManager needs params, so we'll create it when chainContext is available
  const delegatorManagerRef = useRef<DelegatorManager | null>(null);
  const [delegatorManager, setDelegatorManager] = useState<DelegatorManager | null>(null);
  const [workerNodeManager] = useState(() => {
    const nodeId = getOrCreateBrowserNodeId();
    return new WorkerNodeManager(nodeId);
  });
  // Removed unused state: isDelegator, delegatorStats (moved to advanced settings)
  const [globalPoolEnabled, setGlobalPoolEnabled] = useState<boolean>(false);

  // Phase 20: Global Snapshot Network
  const [snapshotDownloader] = useState(() => new SnapshotDownloader());
  const [snapshotSeeder] = useState(() => new SnapshotSeeder());
  const [gsnEnabled] = useState<boolean>(true); // Auto-enabled
  const [snapshotDownloadProgress] = useState<{
    snapshotId: string;
    receivedChunks: number;
    totalChunks: number;
    percent: number;
    speed: number;
    peers: number;
  } | null>(null);
  const [gsnStats, setGsnStats] = useState<{
    downloader: { totalSources: number; averageLatency: number; averageIntegrity: number; averageTrust: number };
    seeder: { cachedCount: number; totalSize: number };
  } | null>(null);

  // Phase 9: Snapshot state
  const [snapshotMetas, setSnapshotMetas] = useState<SnapshotMeta[]>([]);
  const [latestSnapshot, setLatestSnapshot] = useState<SnapshotMeta | null>(null);
  
  // Phase 11: Snapshot compression info
  const [snapshotSizeInfo, setSnapshotSizeInfo] = useState<{
    compressedSize: number;
    estimatedUncompressedSize: number;
    compressionRatio: number;
  } | null>(null);
  const [isRecompressing, setIsRecompressing] = useState<boolean>(false);
  
  // Auto-mining option (persisted)
  const [autoMining, setAutoMining] = useState<boolean>(persistedState.autoMining ?? false);

  // Phase 30: Global Consistency Sentinel
  const [globalSentinel, setGlobalSentinel] = useState<GlobalStateSentinel | null>(null);
  const [driftAssessment, setDriftAssessment] = useState<DriftAssessment | null>(null);
  
  // Phase 30: Mining Guard & Stats
  const [miningGuardResult, setMiningGuardResult] = useState<any>(null);
  const [_miningEffectiveness, setMiningEffectiveness] = useState<any>(null);
  
  // Phase 31: Mainnet Stability
  const [_longRangeDetector, setLongRangeDetector] = useState<any>(null);
  const [_heightConsensus, setHeightConsensus] = useState<any>(null);
  const [antiInvalidMining, setAntiInvalidMining] = useState<any>(null);
  const [_checkpointLock, setCheckpointLock] = useState<any>(null);
  const [_signalReconciliation, setSignalReconciliation] = useState<any>(null);

  // Phase 17: Fast relay statistics
  const [relayStats, setRelayStats] = useState<{
    lastHeaderDelay: number | null; // ms
    headersCached: number;
    missingBodies: number;
    pendingBodyRequests: number;
    receivedBodyCount: number;
    lastBodyDownloadTime: number | null; // ms
  }>({
    lastHeaderDelay: null,
    headersCached: 0,
    missingBodies: 0,
    pendingBodyRequests: 0,
    receivedBodyCount: 0,
    lastBodyDownloadTime: null,
  });

  // Phase 21: Peer reputation state
  const [peerScores, setPeerScores] = useState<Array<{
    peerId: string;
    score: number;
    trustLevel: "trusted" | "normal" | "low" | "banned";
    blocksServed: number;
    blocksInvalid: number;
    snapshotsServed: number;
    snapshotsInvalid: number;
    headersServed: number;
    avgLatencyMs?: number;
    workCompleted: number;
    workFailed: number;
    lastSeenAt: number;
  }>>([]);

  // Phase 22: Fast Finality state
  const [finalityManager, setFinalityManager] = useState<any>(null);
  const [finalityStats, setFinalityStats] = useState<{
    finalizedCount: number;
    pendingVotes: number;
    currentRound: number;
    committeeSize: number;
  } | null>(null);
  const [finalizedBlocks, setFinalizedBlocks] = useState<Set<string>>(new Set());
  
  // Initialize finality manager when chain context is available
  useEffect(() => {
    if (chainContext && !finalityManager && chainContext.params.finalityEnabled) {
      const initFinality = async () => {
        const { FinalityManager } = await import("../core/finality/finalityManager.js");
        const fm = new FinalityManager(chainContext.params);
        setFinalityManager(fm);
      };
      initFinality();
    }
  }, [chainContext, finalityManager]);

  // Phase 27: Initialize Local Instance Coordinator
  useEffect(() => {
    const initCoordinator = async () => {
      await localCoordinator.init();
      
      // Set initial state
      setLocalRole(localCoordinator.getRole());
      setLeaderInfo(localCoordinator.getLeaderInfo());
      
      // Register callbacks
      const unregisterRoleChange = localCoordinator.onRoleChange((role, leaderInfo) => {
        setLocalRole(role);
        setLeaderInfo(leaderInfo);
        
        // If we became follower, stop mining
        if (role === "FOLLOWER") {
          if (isMining) {
            minerClient.stopMining("user");
            setIsMining(false);
          }
          if (clusterMining) {
            minerCluster.stopMining("user");
            setClusterMining(false);
          }
        }
        
        // If we became leader and auto-mining is enabled, start mining
        if (role === "LEADER" && autoMining && !isMining && !clusterMining && chainContext) {
          // Use setTimeout to avoid calling handleStartMining before it's defined
          setTimeout(() => {
            if (chainContext && !isMining && !clusterMining) {
              handleStartMining();
            }
          }, 100);
        }
      });
      
      const unregisterLeaderChange = localCoordinator.onLeaderChange((leaderInfo) => {
        setLeaderInfo(leaderInfo);
      });
      
      const unregisterConflict = localCoordinator.onConflictDetected((localHeight, leaderHeight, finalizedHeight) => {
        setLocalConflictDetected(true);
        setError(
          locale === "zh"
            ? `⚠️ 检测到本地分叉冲突：本地高度 ${localHeight}，Leader 高度 ${leaderHeight}，已最终确认高度 ${finalizedHeight}。将自动回滚并重新同步。`
            : `⚠️ Local fork conflict detected: Local height ${localHeight}, Leader height ${leaderHeight}, Finalized height ${finalizedHeight}. Will auto-rollback and resync.`
        );
      });
      
      return () => {
        unregisterRoleChange();
        unregisterLeaderChange();
        unregisterConflict();
        localCoordinator.destroy();
      };
    };
    
    initCoordinator();
  }, [localCoordinator]);

  // Phase 27: Report local status to coordinator
  useEffect(() => {
    if (chainContext) {
      const tip = chainContext.storage.getTip();
      if (tip) {
        const finalizedHeight = finalityStats?.finalizedCount || 0;
        localCoordinator.reportLocalStatus(tip.header.height, tip.hash, finalizedHeight);
        
        // Phase 29: Report state to LocalStateCoordinator
        localStateCoordinator.reportLocalState(
          tip.header.height,
          tip.hash,
          tip.header.stateCommitment,
          finalizedHeight
        );
      }
    }
  }, [chainContext, finalityStats, localCoordinator, localStateCoordinator]);
  
  // Phase 29: Initialize LocalStateCoordinator
  useEffect(() => {
    if (!chainContext) return;
    
    const initStateCoordinator = async () => {
      await localStateCoordinator.init(chainContext);
      
      // Expose to window for chain.ts access
      if (typeof window !== "undefined") {
        (window as any).localStateCoordinator = localStateCoordinator;
      }
      
      // Register callbacks
      const unregisterStateSync = localStateCoordinator.onStateSync((info) => {
        setLocalStateSyncInfo(info);
      });
      
      const unregisterConsistencyCheck = localStateCoordinator.onConsistencyCheck((isConsistent, details) => {
        setConsistencyCheck({
          isConsistent,
          ...details,
        });
      });
      
      return () => {
        unregisterStateSync();
        unregisterConsistencyCheck();
        if (typeof window !== "undefined") {
          delete (window as any).localStateCoordinator;
        }
        localStateCoordinator.destroy();
      };
    };
    
    const cleanupPromise = initStateCoordinator();
    
    return () => {
      cleanupPromise.then((cleanup) => cleanup?.());
    };
  }, [chainContext, localStateCoordinator]);

  // Form state for creating transactions
  const [txNamespace, setTxNamespace] = useState<string>("test");
  const [txKey, setTxKey] = useState<string>("");
  const [txValue, setTxValue] = useState<string>("");
  const [txOpType, setTxOpType] = useState<"PUT" | "APPEND" | "DELETE">("PUT");

  const p2pNodeRef = useRef<BrowserP2PNode | null>(null);
  
  // Phase 40: Shadow Node for mobile persistence
  const shadowNodeRef = useRef<ShadowNodeClient | null>(null);
  const [_shadowNodeConnected, setShadowNodeConnected] = useState<boolean>(false);
  const [_shadowNodeState, setShadowNodeState] = useState<ShadowState | null>(null);
  
  // Phase 42: Active miner management
  const [activeMinerDialogOpen, setActiveMinerDialogOpen] = useState<boolean>(false);
  const [activeMinerInfo, setActiveMinerInfo] = useState<ActiveMinerInfo | null>(null);
  const activeMinerHeartbeatRef = useRef<number | null>(null);

  const [needsReset, setNeedsReset] = useState<boolean>(false);

  // Tab navigation state
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [showAdvancedTabs, setShowAdvancedTabs] = useState<boolean>(false); // Advanced tabs collapsed by default
  const [showMobileMenu, setShowMobileMenu] = useState<boolean>(false); // Mobile menu state
  
  // Auto-expand advanced tabs if user navigates to an advanced tab
  // Auto-collapse when navigating away from advanced tabs
  useEffect(() => {
    const advancedTabs = ["storage", "advanced", "token", "privacy", "tools", "runtime"];
    if (advancedTabs.includes(activeTab)) {
      // If navigating to an advanced tab, expand if not already expanded
      if (!showAdvancedTabs) {
        setShowAdvancedTabs(true);
      }
    } else {
      // If navigating away from advanced tabs, collapse if currently expanded
      if (showAdvancedTabs) {
        setShowAdvancedTabs(false);
      }
    }
  }, [activeTab]); // Remove showAdvancedTabs from dependencies to avoid conflicts

  // Save state to localStorage whenever relevant state changes
  useEffect(() => {
    const saveState = () => {
      try {
        const state = {
          isMining,
          clusterMining,
          autoMining,
          bootstrapUrl,
          isMainnetMode,
          autoConnect: isP2PConnected, // Save connection state for auto-reconnect
        };
        localStorage.setItem("indexerchain_app_state", JSON.stringify(state));
      } catch (e) {
        // Failed to save app state - silently ignore
      }
    };
    saveState();
  }, [isMining, clusterMining, autoMining, bootstrapUrl, isMainnetMode, isP2PConnected]);

  // Phase 42: Check for invite code in URL on mount
  useEffect(() => {
    const checkInviteCode = () => {
      try {
        // Check URL parameters: ?invite=xxx or ?ref=xxx
        const urlParams = new URLSearchParams(window.location.search);
        let inviteCode = urlParams.get("invite") || urlParams.get("ref");
        
        // Check URL path: /invite/xxx
        if (!inviteCode) {
          const pathMatch = window.location.pathname.match(/\/invite\/([^\/]+)/);
          if (pathMatch) {
            inviteCode = pathMatch[1];
          }
        }
        
        if (inviteCode) {
          // Try to parse as referral code (base64 encoded address)
          import("../core/referralSystem.js").then(({ parseReferralCode }) => {
            const inviteAddress = parseReferralCode(inviteCode);
            
            if (inviteAddress) {
              // Removed debug log: [App] Found invite code
              setPendingInviteAddress(inviteAddress);
            } else if (inviteCode.startsWith("idc_")) {
              // Also try direct address format (idc_...)
              // Removed debug log: [App] Found invite address
              setPendingInviteAddress(inviteCode);
            }
          }).catch(() => {
            // If import fails, try direct address format
            if (inviteCode.startsWith("idc_")) {
              setPendingInviteAddress(inviteCode);
            }
          });
        }
        
        // Check if user already has a referrer
        const savedReferrer = localStorage.getItem("indexerchain_referrer_address");
        if (savedReferrer) {
          setCurrentReferrerAddress(savedReferrer);
        }
      } catch (error) {
        console.error("[App] Failed to check invite code:", error);
      }
    };
    
    checkInviteCode();
  }, []);

  // Initialize chain on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        const params = await getDefaultChainParams();
        const context = await initChain(params);
        setChainContext(context);
        
        // Phase 5: Check if reset is needed
        if (context.needsReset) {
          setNeedsReset(true);
        }
        
        // Phase 5: Load node address
        const address = await getOrCreateNodeAddress();
        setNodeAddress(address);
        
        // Phase 19: Initialize delegator manager with params
        const nodeId = getOrCreateBrowserNodeId();
        const dm = new DelegatorManager(nodeId, params);
        delegatorManagerRef.current = dm;
        setDelegatorManager(dm);
        
        setLoading(false);
        
        // Auto-connect to P2P network if it was connected before
        // This will be handled by a separate useEffect after handleConnectP2P is defined
        
        // Restore mining state if it was active before
        // This will be handled by the auto-mining useEffect and role-based mining logic
        // The persisted state is already loaded into state variables, so they will trigger
        // the appropriate useEffects to restore mining
      } catch (error) {
        console.error("Failed to initialize chain:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        // Always show reset button for initialization errors
        // Check if it's a balance error or chain corruption
        const isCorruption = errorMsg.includes("Insufficient balance") || 
                            errorMsg.includes("Chain initialization failed") ||
                            errorMsg.includes("corrupted") ||
                            errorMsg.includes("corruption");
        
        // Always show reset button for initialization errors
        setNeedsReset(true);
        
        if (isCorruption) {
          const fullErrorMsg = `⚠️ Chain State Corruption Detected!\n\n` +
            `Error: ${errorMsg}\n\n` +
            `This usually happens when chain data is corrupted (e.g., invalid transaction in a block).\n\n` +
            `Solution: Click the "Reset Chain" button below to clear all chain data and start fresh.`;
          setError(fullErrorMsg);
          // Removed debug log: [App] Set error
        } else {
          const fullErrorMsg = `Failed to initialize chain: ${errorMsg}\n\n` +
            `If this persists, try resetting the chain using the button below.`;
          setError(fullErrorMsg);
          // Removed debug log: [App] Set error
        }
        
        // Removed debug log: [App] Set needsReset
        setLoading(false);
      }
    };

    initialize();

    // Phase 8: Cleanup miner client on unmount
    // Phase 18: Also cleanup cluster
    // Phase 19: Also cleanup delegator and worker node managers
    // Phase 20: Cleanup snapshot downloader/seeder
    return () => {
      minerClient.destroy();
      minerCluster.destroy();
      delegatorManagerRef.current?.destroy();
      workerNodeManager.destroy();
      // Snapshot downloader/seeder don't have destroy methods yet
    };
  }, []);

  // PWA: Keepalive and Wake Lock support for mobile lock screen persistence
  useEffect(() => {
    let keepaliveInterval: number | null = null;
    let wakeLock: WakeLockSentinel | null = null;
    let serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
    let handleVisibilityChange: (() => void) | null = null;

    const initPWASupport = async () => {
      // 1. Register/access Service Worker for keepalive
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.ready;
          serviceWorkerRegistration = registration;
          
          // Start keepalive in service worker
          if (registration.active) {
            registration.active.postMessage({ type: 'start-keepalive' });
          }
          
        } catch (error) {
          // Service Worker not available - silently ignore
        }
      }

      // 2. Client-side keepalive ping (backup to service worker)
      const performKeepalive = async () => {
        try {
          // Try to ping service worker first
          if (serviceWorkerRegistration?.active) {
            const channel = new MessageChannel();
            serviceWorkerRegistration.active.postMessage(
              { type: 'ping' },
              [channel.port2]
            );
          }

          // Also send keepalive request to server (if endpoint exists)
          // This helps maintain WebSocket/WebRTC connections
          try {
            await fetch('/keepalive', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ timestamp: Date.now() }),
              keepalive: true, // Critical: keeps connection alive even when page is suspended
            });
          } catch (e) {
            // Endpoint might not exist, that's okay
            // The keepalive flag still helps maintain connections
          }
        } catch (error) {
          // Keepalive ping failed - silently ignore
        }
      };

      // Start periodic keepalive (every 30 seconds)
      keepaliveInterval = window.setInterval(performKeepalive, 30000);
      
      // Perform initial keepalive
      performKeepalive();

      // 3. Screen Wake Lock API (optional, for users who want screen to stay on)
      const requestWakeLock = async () => {
        if ('wakeLock' in navigator) {
          try {
            wakeLock = await navigator.wakeLock.request('screen');
            // Removed debug log: [PWA] Wake Lock acquired
            
            wakeLock.addEventListener('release', () => {
              // Removed debug log: [PWA] Wake Lock released
            });
          } catch (error) {
            // Wake Lock might be denied or not supported
            // Removed debug log: [PWA] Wake Lock not available
          }
        }
      };

      // Request wake lock if mining is active (optional feature)
      // Users can enable this if they want screen to stay on during mining
      if (isMining) {
        requestWakeLock();
      }

      // Re-request wake lock when visibility changes (e.g., tab becomes visible again)
      handleVisibilityChange = async () => {
        if (document.visibilityState === 'visible' && isMining && wakeLock === null) {
          await requestWakeLock();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
    };

    initPWASupport();
    
    // Cleanup function
    return () => {
      if (keepaliveInterval !== null) {
        clearInterval(keepaliveInterval);
      }
      if (wakeLock !== null) {
        wakeLock.release().catch(() => {});
      }
      if (serviceWorkerRegistration?.active) {
        serviceWorkerRegistration.active.postMessage({ type: 'stop-keepalive' });
      }
      if (handleVisibilityChange !== null) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [isMining]); // Re-run when mining state changes

  // Phase 40: Shadow Node - Sync state when browser recovers from lock screen
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && shadowNodeRef.current && shadowNodeRef.current.getConnected()) {
        // Browser recovered from lock screen, sync state from Shadow Node
        logger.info("[ShadowNode] Browser recovered, syncing state from shadow node...");
        
        const shadowState = shadowNodeRef.current.getCachedState();
        if (shadowState && chainContext) {
          // Request latest state
          shadowNodeRef.current.requestSync();
          
          // If shadow node has newer state, we could trigger a sync here
          // For now, the shadow node will push updates via WebSocket
          logger.info(`[ShadowNode] Shadow state: height=${shadowState.latestHeight}, lastUpdated=${new Date(shadowState.lastUpdated).toISOString()}`);
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [chainContext]);

  // Phase 40: Forward ROOT_TIP_UPDATE to Shadow Node
  useEffect(() => {
    if (!p2pNodeRef.current || !shadowNodeRef.current) return;
    
    const p2pNode = p2pNodeRef.current;
    const shadowNode = shadowNodeRef.current;
    
    // Listen for ROOT_TIP_UPDATE messages
    const handleRootTipUpdate = (payload: any, _sender: string) => {
      // Forward to Shadow Node
      if (shadowNode.getConnected()) {
        shadowNode.sendRootTipUpdate(payload.rootTip || payload);
      }
    };
    
    // Register handler
    p2pNode.onMessage("ROOT_TIP_UPDATE", handleRootTipUpdate);
    
    // Note: p2p.ts doesn't have offMessage, but handler will be cleaned up when component unmounts
    // The handler reference will be garbage collected
  }, [p2pNodeRef.current, shadowNodeRef.current]);

  // Phase 9: Load snapshot metadata when chain context changes
  // Phase 11: Also load snapshot size info
  // Phase 20: Update seeder cache when new snapshot is created
  // Use ref to track previous latest snapshot to avoid infinite loop
  const prevLatestSnapshotRef = useRef<SnapshotMeta | null>(null);
  
  useEffect(() => {
    if (chainContext) {
      const metas = loadAllSnapshotMeta();
      setSnapshotMetas(metas);
      const latest = getLatestSnapshotMeta();
      const prevLatest = prevLatestSnapshotRef.current;
      
      // Phase 20: If new snapshot was created, update seeder cache
      if (latest && (!prevLatest || latest.height > prevLatest.height)) {
        if (isP2PConnected && gsnEnabled && snapshotSeeder) {
          snapshotSeeder.updateCache(latest.height);
        }
      }
      
      // Only update if latest snapshot actually changed
      if (latest?.height !== prevLatest?.height) {
        setLatestSnapshot(latest);
        prevLatestSnapshotRef.current = latest;
      }
      
      // Load size info for latest snapshot
      if (latest) {
        getSnapshotSizeInfo(latest.height).then((info) => {
          setSnapshotSizeInfo(info);
        });
      } else {
        setSnapshotSizeInfo(null);
      }
    }
  }, [chainContext, isP2PConnected, gsnEnabled, snapshotSeeder]);

  // Auto-connect to P2P network on mount
  // Always attempts to connect automatically when page loads (first-time users included)
  const autoConnectAttemptedRef = useRef<boolean>(false);
  useEffect(() => {
    // Only attempt auto-connect once, when chainContext is ready and not loading
    // Skip if already connected or already attempted
    if (!chainContext || loading || isP2PConnected || autoConnectAttemptedRef.current) {
      return;
    }
    
    // Always attempt auto-connect if we have a bootstrapUrl
    // This ensures first-time users also connect automatically
    const savedState = loadPersistedState();
    const urlToUse = savedState.bootstrapUrl || bootstrapUrl || DEFAULT_MAINNET_SIGNALING;
    
    if (urlToUse) {
      autoConnectAttemptedRef.current = true; // Mark as attempted immediately to prevent duplicate attempts
      
      logger.debug(`[Auto-Connect] Attempting automatic connection to ${urlToUse}`, { 
        hasSavedState: !!savedState.bootstrapUrl,
        savedUrl: savedState.bootstrapUrl,
        currentUrl: bootstrapUrl,
        willUse: urlToUse
      });
      
      // Ensure bootstrapUrl is set if it's not already
      if (bootstrapUrl !== urlToUse) {
        setBootstrapUrl(urlToUse);
      }
      
      // Connect immediately (small delay to ensure state is updated)
      setTimeout(() => {
        const autoConnectLog = `[Auto-Connect] 🚀 Attempting automatic connection to ${urlToUse}...`;
        console.log(autoConnectLog); // Force console output for debugging
        logger.info(autoConnectLog);
        handleConnectP2P().catch((error) => {
          const errorLog = `[Auto-Connect] ❌ Auto-connect failed: ${error}`;
          console.error(errorLog); // Force console output for debugging
          logger.error(errorLog, error);
        });
      }, 300); // Reduced delay for faster connection
    } else {
      logger.debug(`[Auto-Connect] No bootstrap URL available, skipping auto-connect`);
    }
  }, [chainContext, loading, bootstrapUrl, isP2PConnected]); // Include all dependencies

  // Restore mining state after chain is initialized
  const restoreMiningRef = useRef<boolean>(false);
  useEffect(() => {
    if (!chainContext || loading || restoreMiningRef.current) return;
    
    // Restore mining state if it was active before
    const savedState = loadPersistedState();
    if (savedState.clusterMining && !clusterMining) {
      restoreMiningRef.current = true;
      // Restore cluster mining after a delay to ensure everything is ready
      setTimeout(() => {
        if (chainContext && !clusterMining) {
          handleStartClusterMining();
        }
        restoreMiningRef.current = false;
      }, 2000);
    } else if (savedState.isMining && !isMining && !autoMining) {
      restoreMiningRef.current = true;
      // Restore single worker mining after a delay
      setTimeout(() => {
        if (chainContext && !isMining) {
          handleStartMining();
        }
        restoreMiningRef.current = false;
      }, 2000);
    }
  }, [chainContext, loading]); // Only run when chainContext becomes available

  // Auto-mining: Start mining automatically when chain is ready
  const autoMiningStartedRef = useRef<boolean>(false);
  useEffect(() => {
    // Only start once when autoMining is enabled and conditions are met
    if (autoMining && chainContext && !isMining && !clusterMining && !autoMiningStartedRef.current) {
      const tip = chainContext.storage.getTip();
      if (tip) {
        autoMiningStartedRef.current = true;
        // Small delay to ensure everything is initialized
        const timer = setTimeout(() => {
          handleStartMining();
          // Reset flag after starting to allow restart if needed
          setTimeout(() => {
            autoMiningStartedRef.current = false;
          }, 2000);
        }, 1000);
        return () => {
          clearTimeout(timer);
          autoMiningStartedRef.current = false;
        };
      }
    } else if (!autoMining) {
      // Reset flag when auto-mining is disabled
      autoMiningStartedRef.current = false;
    }
  }, [autoMining, chainContext, isMining, clusterMining]);

  // Phase 13: Background periodic snapshot verification
  useEffect(() => {
    if (!chainContext) return;

    const intervalMs = chainContext.params.snapshotAutoVerifyIntervalMs ?? 60_000;
    const interval = setInterval(async () => {
      try {
        const { verifyOneSnapshotInBackground } = await import("../core/snapshotVerify.js");
        await verifyOneSnapshotInBackground();
        
        // Reload snapshot metadata to update verification status
        const metas = loadAllSnapshotMeta();
        setSnapshotMetas(metas);
        const latest = getLatestSnapshotMeta();
        setLatestSnapshot(latest);
      } catch (error) {
        // Background verification error - silently ignore
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [chainContext]);

  // Phase 17: Update fast relay statistics
  useEffect(() => {
    if (!chainContext) return;

    const updateStats = async () => {
      const { globalHeaderCache } = await import("../core/headerCache.js");
      const { globalBodyRequestTracker } = await import("../core/blockRelay.js");
      
      const cacheStats = globalHeaderCache.getStats();
      const pendingRequests = globalBodyRequestTracker.getAllPending();
      
      setRelayStats({
        lastHeaderDelay: null, // TODO: Track actual delay
        headersCached: cacheStats.totalHeaders,
        missingBodies: cacheStats.headersNeedingBody,
        pendingBodyRequests: pendingRequests.length,
        receivedBodyCount: cacheStats.totalHeaders - cacheStats.headersNeedingBody,
        lastBodyDownloadTime: null, // TODO: Track actual download time
      });
    };

    // Update stats every second
    const interval = setInterval(() => {
      updateStats();
    }, 1000);
    updateStats(); // Initial update

    return () => clearInterval(interval);
  }, [chainContext]);

  // Handle chain reset (for Phase 5 migration or corruption recovery)
  const handleResetChain = () => {
    const confirmMsg = t("chainReset.confirmMessage");
    if (!confirm(confirmMsg)) {
      return;
    }
    
    // Clear chain storage (even if chainContext is null, we can still clear)
    if (chainContext) {
      chainContext.storage.reset();
    } else {
      // If chainContext is null, clear directly from localStorage
      if (typeof localStorage !== "undefined") {
        // Clear all possible storage keys
        localStorage.removeItem("indexerchain_blocks_v1");
        localStorage.removeItem("indexerchain_blocks");
        // Clear any other chain-related data
        Object.keys(localStorage)
          .filter(k => k.startsWith("indexerchain_") && (k.includes("block") || k.includes("chain")))
          .forEach(k => localStorage.removeItem(k));
      }
    }
    
    // Clear all snapshots (they might be corrupted)
    clearAllSnapshots();
    
    // Clear other related data
    if (typeof localStorage !== "undefined") {
      // Clear snapshot metadata
      localStorage.removeItem("indexerchain_snapshots_meta");
      // Clear any snapshot data
      Object.keys(localStorage)
        .filter(k => k.startsWith("indexerchain_snapshot_"))
        .forEach(k => localStorage.removeItem(k));
      // Clear bootstrap state
      localStorage.removeItem("indexerchain_bootstrap_state");
      // Clear state repair data
      localStorage.removeItem("indexerchain_state_repair");
    }
    
    setNeedsReset(false);
    setError("");
    
    // Reload page to reinitialize
    window.location.reload();
  };

  // Phase 32: Bootstrap sync status
  const [bootstrapComplete, setBootstrapComplete] = useState<boolean>(false);
  
  // Sync status tracking
  const [syncStatus, setSyncStatus] = useState<{
    isSyncing: boolean;
    localHeight: number;
    networkHeight: number;
    behindBy: number;
    progress: number; // 0-100
  }>({
    isSyncing: false,
    localHeight: 0,
    networkHeight: 0,
    behindBy: 0,
    progress: 0,
  });
  
  // Ref to access latest syncStatus in intervals (always up-to-date)
  const syncStatusRef = useRef(syncStatus);
  useEffect(() => {
    syncStatusRef.current = syncStatus;
  }, [syncStatus]);

  // Phase 36: Initialize state commit gossip, lock manager, drift detector, and repair manager
  useEffect(() => {
    if (!chainContext || !chainContext.p2p) return;

    const p2p = chainContext.p2p;
    
    // Initialize Phase 36 modules
    (async () => {
      const { getStateCommitGossip } = await import("../core/stateCommitGossip.js");
      const { getStateLockManager } = await import("../core/stateLockManager.js");
      const { getStateDriftDetector } = await import("../core/stateDriftDetector.js");
      const { getStateRepairManager } = await import("../core/stateRepair.js");
      
      const gossip = getStateCommitGossip();
      const lockManager = getStateLockManager();
      const driftDetector = getStateDriftDetector();
      const repairManager = getStateRepairManager();
      
      gossip.initialize(chainContext, p2p);
      lockManager.initialize(chainContext, p2p);
      driftDetector.initialize(chainContext, p2p);
      repairManager.initialize(chainContext, p2p);
      
      // Check for drift periodically and trigger repair if needed
      const driftCheckInterval = setInterval(() => {
        const driftCheck = driftDetector.checkDrift();
        if (driftCheck.hasDrift && driftCheck.severity === "critical" && !repairManager.isRepairing()) {
          repairManager.startRepair(
            driftCheck,
            () => {
              logger.debug("[Phase 36] State repair completed successfully");
            },
            (error) => {
              console.error("[Phase 36] State repair failed:", error);
            }
          );
        }
      }, 10000); // Check every 10 seconds
      
      return () => {
        clearInterval(driftCheckInterval);
        gossip.destroy();
        lockManager.destroy();
        driftDetector.destroy();
        repairManager.destroy();
      };
    })();
  }, [chainContext]);

  // Phase 43: Initialize all sync managers
  useEffect(() => {
    if (!chainContext || !chainContext.p2p) return;
    
    const parallelSyncManager = getParallelSyncManager();
    parallelSyncManager.init(chainContext, chainContext.p2p);
    
    const warpSyncManager = getWarpSyncManager();
    warpSyncManager.init(chainContext, chainContext.p2p, snapshotDownloader || undefined);
    
    const chunkBasedSyncManager = getChunkBasedSyncManager();
    chunkBasedSyncManager.init(chainContext, chainContext.p2p);
    
    const incrementalStateSyncManager = getIncrementalStateSyncManager();
    incrementalStateSyncManager.init(chainContext, chainContext.p2p);
    
    // Phase 47: Make snapshotDownloader available to UnifiedSyncManager
    if (typeof window !== "undefined") {
      (window as any).snapshotDownloader = snapshotDownloader;
    }
  }, [chainContext, snapshotDownloader]);

  // Setup P2P message handlers
  useEffect(() => {
    if (!chainContext || !chainContext.p2p) return;

    const p2p = chainContext.p2p;

    // Handle NEW_TX messages
    p2p.onMessage("NEW_TX", async (tx: Tx, _sender: string) => {
      // Removed debug log: Received NEW_TX
      // Phase 5: Verify signature before adding
      const isValid = await verifyTxSignature(tx);
      if (!isValid) {
        // Invalid transaction - silently ignore
        return;
      }
      
      // Add to mempool if not already present
      if (!mempool.getAll().some((t) => t.txId === tx.txId)) {
        const added = await mempool.addTx(tx);
        if (added) {
          setChainContext((prev) => prev ? { ...prev } : prev); // Trigger re-render
        }
      }
    });

    // Phase 17: Handle NEW_BLOCK_HEADER (fast relay)
    // Phase 21: Pass sender for peer reputation tracking
    p2p.onMessage("NEW_BLOCK_HEADER", async (compactHeader: any, sender: string) => {
      logger.debug("[Phase 17] Received NEW_BLOCK_HEADER from", sender, "height:", compactHeader.height);
      const { handleReceivedBlockHeader } = await import("../core/sync.js");
      const result = await handleReceivedBlockHeader(compactHeader, chainContext, p2p, sender);
      
      if (result.handled) {
        // Phase 19: Attempt to become delegator for new block
        if (globalPoolEnabled && delegatorManager) {
          delegatorManager.attemptBecomeDelegator(compactHeader.height);
        }
        
        // Phase 17: If should restart mining, stop current mining and restart
        if (result.shouldRestartMining) {
          logger.debug("[Phase 17] New block header received, restarting mining...");
          
          // Phase 19: If global pool enabled, reset worker nodes
          if (globalPoolEnabled) {
            workerNodeManager.reset();
            // Workers will request new ranges automatically
          }
          
          // Phase 18: Stop cluster mining if active
          if (clusterMining) {
            minerCluster.stopMining("replaced");
            // Restart cluster mining after a short delay
            setTimeout(() => {
              if (clusterMining) {
                handleStartClusterMining();
              }
            }, 50);
          } else if (isMining || autoMining) {
            // Single worker mining
            minerClient.stopMining("replaced");
            // Restart mining after a short delay
            setTimeout(() => {
              if (autoMining || isMining) {
                handleStartMining();
              }
            }, 100);
          }
        }
        setChainContext({ ...chainContext }); // Trigger re-render
      }
    });

    // Phase 17: Handle REQUEST_BLOCK_BODY
    p2p.onMessage("REQUEST_BLOCK_BODY", async (request: { hash: string; height: number }, sender: string) => {
      logger.debug("[Phase 17] Received REQUEST_BLOCK_BODY from", sender, "hash:", request.hash);
      // Try to find block by hash (search through all blocks)
      let block: Block | null = null;
      const allBlocks = chainContext.storage.getAllBlocks();
      for (const b of allBlocks) {
        if (b.hash === request.hash) {
          block = b;
          break;
        }
      }
      if (block) {
        // Send block body to requesting peer
        p2p.broadcast("BLOCK_BODY", block);
      } else {
        logger.debug(`[Phase 17] Block ${request.hash} not found in local storage`);
      }
    });

    // Phase 17: Handle BLOCK_BODY
    // Phase 21: Pass sender for peer reputation tracking
    p2p.onMessage("BLOCK_BODY", async (block: Block, sender: string) => {
      logger.debug("[Phase 17] Received BLOCK_BODY from", sender, "height:", block.header.height);
      const { handleReceivedBlockBody } = await import("../core/sync.js");
      const result = await handleReceivedBlockBody(block, chainContext, sender);
      if (result.handled) {
        // Remove transactions from mempool
        const txIds = block.txs.map((tx) => tx.txId);
        mempool.removeTxs(txIds);
        setChainContext({ ...chainContext }); // Trigger re-render
      }
    });

    // Handle NEW_BLOCK messages (backward compatibility)
    // Phase 21: Pass sender for peer reputation tracking
    p2p.onMessage("NEW_BLOCK", async (block: Block, sender: string) => {
      // Removed debug log: Received NEW_BLOCK
      const result = await handleReceivedBlock(block, chainContext, p2p, sender);
      if (result.handled) {
        // Remove transactions from mempool
        const txIds = block.txs.map((tx) => tx.txId);
        mempool.removeTxs(txIds);
        setChainContext({ ...chainContext }); // Trigger re-render
      }
    });

    // Handle REQUEST_BLOCKS messages
    // Track recent requests to avoid spam and reduce logging
    const recentBlockRequests = new Map<string, number>(); // sender -> last request time
    p2p.onMessage("REQUEST_BLOCKS", async (request: { fromHeight: number; toHeight: number; requestId?: string }, sender: string) => {
      const localTip = chainContext.storage.getTip();
      const localHeight = localTip?.header?.height ?? -1;
      
      // Rate limiting: ignore requests from same sender within 2 seconds
      const now = Date.now();
      const lastRequest = recentBlockRequests.get(sender);
      if (lastRequest && now - lastRequest < 2000) {
        return; // Ignore duplicate requests
      }
      recentBlockRequests.set(sender, now);
      
      // Clean up old entries (older than 10 seconds)
      for (const [peerId, timestamp] of recentBlockRequests.entries()) {
        if (now - timestamp > 10000) {
          recentBlockRequests.delete(peerId);
        }
      }
      
      // Only log if it's a new request or significant change
      if (!lastRequest || Math.abs(request.fromHeight - (lastRequest % 10000)) > 100) {
        // Suppress frequent logs - only log occasionally
      }
      
      const blocks: Block[] = [];
      
      // Phase 10: Check if requested blocks are available (light node mode)
      const minHeight = chainContext.storage.getMinHeight();
      const actualFromHeight = Math.max(request.fromHeight, minHeight);
      const actualToHeight = Math.min(request.toHeight, localHeight);
      
      // If requested range is completely pruned, send a helpful response
      if (actualFromHeight > actualToHeight) {
        // Send a response indicating the available range
        // This helps the requesting peer know where to start
        if (p2p.sendToPeer) {
          p2p.sendToPeer(sender, "GLOBAL_VIEW_RESPONSE", {
            height: localHeight,
            tipHash: localTip?.hash ?? "",
            finalizedHeight: 0,
            stateCommitment: localTip?.header?.stateCommitment,
            availableFromHeight: minHeight, // Tell them where blocks are available
          });
        }
        return;
      }
      
      for (let h = actualFromHeight; h <= actualToHeight; h++) {
        const block = chainContext.storage.getBlockByHeight(h);
        if (block) {
          blocks.push(block);
        }
      }
      
      if (blocks.length > 0) {
        // Production: No console logs
        // Send blocks directly to the requesting peer if sendToPeer is available
        if (p2p.sendToPeer) {
          // Phase 43: Include requestId if this is part of parallel sync
          const responseRequestId = request.requestId || `${sender}_${Date.now()}`;
          p2p.sendToPeer(sender, "BLOCKS", { blocks, requestId: responseRequestId });
        } else {
          // Fallback to broadcast
          p2p.broadcast("BLOCKS", { blocks, requestId: request.requestId || `${sender}_${Date.now()}` });
        }
      } else {
        // Production: No console logs
      }
    });

    // Handle BLOCKS messages (chain sync)
    // Phase 21: Pass sender for peer reputation tracking
    // Phase 43: Support parallel sync with requestId
    p2p.onMessage("BLOCKS", async (data: { blocks: Block[]; requestId?: string }, sender: string) => {
      if (!data.blocks || data.blocks.length === 0) {
        logger.warn("[Sync] ⚠️ Received empty BLOCKS message from", sender.substring(0, 16));
        return;
      }
      
      // Only log if significant change (reduce spam)
      const firstHeight = data.blocks[0]?.header?.height || 0;
      const lastHeight = data.blocks[data.blocks.length - 1]?.header?.height || 0;
      const localTip = chainContext.storage.getTip();
      const localHeight = localTip?.header.height ?? -1;
      
      // Only log if blocks are ahead of local height or if it's a significant batch
      if (firstHeight > localHeight || data.blocks.length >= 50) {
        logger.debug(`[Sync] 📦 Received ${data.blocks.length} blocks from ${sender.substring(0, 16)}... (heights: ${firstHeight}-${lastHeight})`);
      }
      
      // Phase 43: Notify parallel sync manager if this is part of parallel sync
      if (data.requestId) {
        const parallelSyncManager = getParallelSyncManager();
        parallelSyncManager.handleReceivedBlocks(data.blocks, sender, data.requestId);
      }
      
      const result = await handleReceivedBlocks(data.blocks, chainContext, sender);
      
      // Always update UI even if no blocks were appended (blocks may already exist)
      const newTip = chainContext.storage.getTip();
      const newHeight = newTip?.header.height ?? 0;
      
      if (result.success && result.appended > 0) {
        // Production: No console logs
        // Use functional update to avoid unnecessary re-renders
        if (result.appended > 0) {
          setChainContext((prev) => prev ? { ...prev } : prev);
        }
        
        // Phase 32: Auto-scroll console to bottom when new blocks arrive
        if (typeof window !== "undefined") {
          // Scroll browser console to bottom (if possible)
          // Note: Browser console scrolling is limited, but we can try
          setTimeout(() => {
            // Try to scroll console if it's available
            if ((window as any).console && (window as any).console.scroll) {
              (window as any).console.scroll();
            }
          }, 100);
        }
        
        // Calculate max received height once (with safety checks)
        const maxReceivedHeight = data.blocks.length > 0 
          ? Math.max(...data.blocks.filter(b => b && b.header).map(b => b.header.height))
          : 0;
        
        // Update sync status (always update, even if no blocks were appended)
        setSyncStatus(prev => {
          // If we have networkHeight, update progress
          if (prev.networkHeight > 0) {
            const behindBy = prev.networkHeight - newHeight;
            return {
              ...prev,
              localHeight: newHeight,
              behindBy,
              isSyncing: behindBy > 0,
              progress: prev.networkHeight > 0 ? Math.min(100, Math.max(0, (newHeight / prev.networkHeight) * 100)) : 0,
            };
          }
          // If we don't have networkHeight yet, but we received blocks, 
          // try to infer networkHeight from the highest received block
          // This helps when blocks arrive before GLOBAL_VIEW_RESPONSE
          if (maxReceivedHeight > newHeight) {
            // We received blocks up to maxReceivedHeight, so network is at least that high
            const inferredNetworkHeight = maxReceivedHeight;
            const behindBy = inferredNetworkHeight - newHeight;
            return {
              ...prev,
              localHeight: newHeight,
              networkHeight: inferredNetworkHeight,
              behindBy,
              isSyncing: behindBy > 0,
              progress: inferredNetworkHeight > 0 ? Math.min(100, Math.max(0, (newHeight / inferredNetworkHeight) * 100)) : 0,
            };
          }
          // Just update localHeight if we can't infer networkHeight
          const newStatus = { ...prev, localHeight: newHeight };
          // Update ref immediately so auto-sync interval can access it
          syncStatusRef.current = newStatus;
          return newStatus;
        });
      } else if (result.success && result.appended === 0) {
        // Even if no blocks were appended, update UI to reflect current state
        // Suppress this log - it's normal when blocks already exist
        // console.log(`[Sync] No new blocks appended (may already have them), but updating UI. Current height: ${newHeight}`);
        setChainContext({ ...chainContext }); // Trigger re-render
        
        // Calculate max received height for this case too (with safety checks)
        const maxReceivedHeight = data.blocks.length > 0
          ? Math.max(...data.blocks.filter(b => b && b.header).map(b => b.header.height))
          : 0;
        
        // Update sync status to reflect current state
        setSyncStatus(prev => {
          // Store sync status in window for auto-sync interval to access (backward compatibility)
          (window as any).lastSyncStatus = {
            networkHeight: prev.networkHeight,
            localHeight: newHeight,
          };
          
          if (prev.networkHeight > 0) {
            const behindBy = prev.networkHeight - newHeight;
            const newStatus = {
              ...prev,
              localHeight: newHeight,
              behindBy,
              isSyncing: behindBy > 0,
              progress: prev.networkHeight > 0 ? Math.min(100, Math.max(0, (newHeight / prev.networkHeight) * 100)) : 0,
            };
            // Update ref immediately so auto-sync interval can access it
            syncStatusRef.current = newStatus;
            return newStatus;
          }
          // Try to infer networkHeight from received blocks
          if (maxReceivedHeight > newHeight) {
            const inferredNetworkHeight = maxReceivedHeight;
            const behindBy = inferredNetworkHeight - newHeight;
            const newStatus = {
              ...prev,
              localHeight: newHeight,
              networkHeight: inferredNetworkHeight,
              behindBy,
              isSyncing: behindBy > 0,
              progress: inferredNetworkHeight > 0 ? Math.min(100, Math.max(0, (newHeight / inferredNetworkHeight) * 100)) : 0,
            };
            // Update ref immediately so auto-sync interval can access it
            syncStatusRef.current = newStatus;
            return newStatus;
          }
          return { ...prev, localHeight: newHeight };
        });
        
        // If the highest received block is higher than what we have, request more
        if (maxReceivedHeight > newHeight) {
          // Production: No console logs
          p2p.broadcast("REQUEST_BLOCKS", {
            fromHeight: newHeight + 1,
            toHeight: maxReceivedHeight,
          });
        } else if (maxReceivedHeight === newHeight) {
          // We're caught up with what we received, but check if we need more
          const peerCount = p2p.getPeerCount();
          if (peerCount > 0) {
            // Query network height to see if there are more blocks
            p2p.broadcast("GLOBAL_VIEW_REQUEST", {});
          }
        }
      } else if (!result.success) {
        logger.error("[Sync] ❌ Failed to append blocks:", result.error);
      } else if (result.appended === 0) {
        // This is normal when blocks already exist, but log it at debug level
        logger.debug("[Sync] ⚠️ No blocks appended (may already have them)");
      }
    });

    // Update peer count periodically and save connection state
    // Also update sync status from actual storage to ensure UI reflects reality
    const interval = setInterval(() => {
      if (p2p.isConnected) {
        setPeerCount(p2p.getPeerCount());
        const wasConnected = isP2PConnected;
        setIsP2PConnected(true);
        
        // Periodically update sync status from actual storage
        // This ensures UI reflects the real state even if block reception handlers miss updates
        if (chainContext) {
          const actualTip = chainContext.storage.getTip();
          const actualHeight = actualTip?.header.height ?? 0;
          
          setSyncStatus(prev => {
            // Only update if height actually changed or if we need to refresh
            if (actualHeight !== prev.localHeight || prev.networkHeight > 0) {
              const behindBy = prev.networkHeight > 0 ? prev.networkHeight - actualHeight : 0;
              return {
                ...prev,
                localHeight: actualHeight,
                behindBy,
                isSyncing: behindBy > 0,
                progress: prev.networkHeight > 0 ? Math.min(100, Math.max(0, (actualHeight / prev.networkHeight) * 100)) : 0,
              };
            }
            return prev;
          });
        }
        
        // Save connection state immediately when connected (only once to avoid excessive writes)
        if (!wasConnected) {
          try {
            const savedState = loadPersistedState();
            // Only save if state actually changed to avoid excessive writes
            if (!savedState.autoConnect || savedState.bootstrapUrl !== bootstrapUrl) {
              const state = {
                ...savedState,
                autoConnect: true,
                bootstrapUrl: bootstrapUrl,
              };
              localStorage.setItem("indexerchain_app_state", JSON.stringify(state));
              // Removed debug log: [Auto-Connect] Saved connection state
            }
          } catch (e) {
            // Failed to save connection state - silently ignore
          }
        }
      } else {
        setPeerCount(0);
        setIsP2PConnected(false);
      }
    }, 1000);

    // Phase 28: Auto-sync check - periodically check if we're behind and request blocks
    // This helps keep nodes in sync automatically
    const autoSyncInterval = setInterval(async () => {
      if (!chainContext || !p2p.isConnected) {
        return; // Not connected, skip
      }

      const peerCount = p2p.getPeerCount();
      const localTip = chainContext.storage.getTip();
      const localHeight = localTip?.header.height ?? -1;
      const now = Date.now();
      
      // Get current syncStatus from ref (always up-to-date)
      const currentSyncStatus = syncStatusRef.current;
      
      // Query network height periodically (every ~5 seconds) if we have peers
      // More frequent queries for faster initial sync
      if (peerCount > 0) {
        const lastQueryKey = "lastGlobalViewQuery";
        const lastQueryTime = (window as any)[lastQueryKey] || 0;
        if (now - lastQueryTime > 5000) { // Query every 5 seconds
          (window as any)[lastQueryKey] = now;
          p2p.broadcast("GLOBAL_VIEW_REQUEST", {});
        }
      }
      
      // Request blocks if we have peers
      if (peerCount > 0) {
        // Check if we have a pending block request from when we had no peers
        if (typeof window !== "undefined" && (window as any).pendingBlockRequest) {
          const pending = (window as any).pendingBlockRequest;
          // Production: No console logs
          p2p.broadcast("REQUEST_BLOCKS", pending);
          delete (window as any).pendingBlockRequest;
        }
        
        // Check if we're behind network height
        // Use syncStatus from ref (always up-to-date) as primary source
        const networkHeight = currentSyncStatus.networkHeight || 0;
        const behindBy = networkHeight > 0 ? networkHeight - localHeight : 0;
        
        // Only request blocks if we're actually behind
        if (behindBy > 0) {
          // Phase 46: Try UnifiedSyncManager first if we have rootTip info
          const lastRootTipHeight = (window as any).lastRootTipHeight || 0;
          const lastRootTipHash = (window as any).lastRootTipHash || "";
          const lastRootTipRecentHeaders = (window as any).lastRootTipRecentHeaders || [];
          
          if (lastRootTipHeight > localHeight && p2pNodeRef.current) {
            const lastUnifiedSyncKey = `lastUnifiedSync_${lastRootTipHeight}`;
            const lastUnifiedSyncTime = (window as any)[lastUnifiedSyncKey] || 0;
            
            // Try UnifiedSyncManager every 5 seconds
            if (now - lastUnifiedSyncTime > 5000) {
              (window as any)[lastUnifiedSyncKey] = now;
              
              try {
                const { handleRootTipUpdate } = await import("../core/unifiedSyncManager.js");
                const isMiner = isMining || clusterMining;
                
                logger.info(`[Phase 46] Auto-sync via UnifiedSyncManager: local=${localHeight}, rootTip=${lastRootTipHeight}`);
                
                const syncResult = await handleRootTipUpdate(
                  chainContext,
                  p2pNodeRef.current,
                  {
                    latestHeight: lastRootTipHeight,
                    latestHeaderHash: lastRootTipHash,
                    recentHeaders: lastRootTipRecentHeaders,
                    stateCommitment: (window as any).lastRootTipStateCommitment || undefined,
                  },
                  isMiner,
                  (message: string) => {
                    setSyncMessage(message);
                  }
                );
                
                if (syncResult.success && syncResult.synced) {
                  logger.info(`[Phase 46] ✅ Auto-sync completed: ${syncResult.method} sync from ${syncResult.fromHeight} → ${syncResult.toHeight}`);
                  setChainContext({ ...chainContext });
                  return; // Success, skip fallback
                }
              } catch (syncError) {
                logger.debug(`[Phase 46] UnifiedSyncManager failed, falling back to direct request:`, syncError);
              }
            }
          }
          
          // Fallback: Direct block request (original logic)
          const requestRange = Math.min(behindBy, 500); // Request up to 500 blocks at a time
          const targetHeight = Math.min(localHeight + requestRange, networkHeight);
          
          // Only request if we haven't requested this range recently (avoid spam)
          const lastRequestKey = `lastBlockRequest_${localHeight + 1}_${targetHeight}`;
          const lastRequestTime = (window as any)[lastRequestKey] || 0;
          
          // Request every 3 seconds if we're behind
          if (now - lastRequestTime > 3000) {
            (window as any)[lastRequestKey] = now;
            const peerCount = p2p.getPeerCount();
            if (peerCount === 0) {
              logger.warn(`[Sync] ⚠️ Behind by ${behindBy} blocks but no peers connected`);
            } else {
              logger.debug(`[Sync] 📥 Requesting ${requestRange} blocks (heights ${localHeight + 1}-${targetHeight}) from ${peerCount} peer(s)`);
              p2p.broadcast("REQUEST_BLOCKS", {
                fromHeight: localHeight + 1,
                toHeight: targetHeight,
              });
              // Also try direct peer requests
              if (p2p.sendToPeer) {
                const peerIds = Array.from(p2p.peers.keys());
                for (const peerId of peerIds) {
                  const peer = p2p.peers.get(peerId);
                  if (peer && peer.connected && peer.dataChannel && peer.dataChannel.readyState === 'open') {
                    logger.debug(`[Sync] Direct request to peer ${peerId.substring(0, 16)}...`);
                    p2p.sendToPeer(peerId, "REQUEST_BLOCKS", {
                      fromHeight: localHeight + 1,
                      toHeight: targetHeight,
                    });
                  }
                }
              }
            }
          }
        } else if ((localHeight === 0 || localHeight < 100) && networkHeight === 0) {
          // Initial sync: request aggressively even without network height
          // Only do this if we don't have networkHeight yet (to avoid duplicate requests)
          const requestRange = 500;
          const lastRequestKey = `lastBlockRequest_${localHeight + 1}_${localHeight + requestRange}`;
          const lastRequestTime = (window as any)[lastRequestKey] || 0;
          if (now - lastRequestTime > 5000) { // Request every 5 seconds for initial sync
            (window as any)[lastRequestKey] = now;
            logger.info(`[Sync] Initial sync: requesting blocks from height ${localHeight + 1} to ${localHeight + requestRange} (no network height yet)`);
            p2p.broadcast("REQUEST_BLOCKS", {
              fromHeight: localHeight + 1,
              toHeight: localHeight + requestRange,
            });
            // Also try direct peer requests
            if (p2p.sendToPeer) {
              const peerIds = Array.from(p2p.peers.keys());
              for (const peerId of peerIds) {
                const peer = p2p.peers.get(peerId);
                if (peer && peer.connected && peer.dataChannel && peer.dataChannel.readyState === 'open') {
                  p2p.sendToPeer(peerId, "REQUEST_BLOCKS", {
              fromHeight: localHeight + 1,
              toHeight: localHeight + requestRange,
            });
                }
              }
            }
          }
        }
      } else {
        // No peers - try to request peers and bootstrap again periodically
        // Request more frequently when we have no peers (every 2 seconds)
        if (now % 2000 < 500) {
          // Request peers first (if method exists)
          if (typeof (p2p as any).requestPeers === 'function') {
            (p2p as any).requestPeers();
          }
          
          // Also try bootstrap again (in case Worker state was updated)
          if (typeof (p2p as any).sendToSignalServer === 'function') {
            // Production: No console logs
            (p2p as any).sendToSignalServer("REQUEST_BOOTSTRAP", {
              requestId: `${Date.now()}_${Math.random()}`,
              wantSnapshotMeta: true,
              wantHeaders: true,
              headerCount: 200,
            });
          }
        }
      }
      
      // Phase 46: Use HeightSyncManager to check if we need to sync
      // This provides a unified view of all height sources (StateLock, P2P, Signal, Shadow)
      if (p2pNodeRef.current && chainContext) {
        try {
          const heightSyncManager = getHeightSyncManager();
          heightSyncManager.init(chainContext, p2pNodeRef.current);
          const syncStatus = heightSyncManager.getSyncStatus();
          
          logger.debug(`[Phase 46] HeightSyncManager status: local=${localHeight}, recommended=${syncStatus.recommendedHeight}, source=${syncStatus.recommendedSource}, status=${syncStatus.syncStatus}`);
          
          // If recommended height is higher than local, trigger sync
          if (syncStatus.recommendedHeight > localHeight && syncStatus.recommendedHeight > 0) {
            const heightDiff = syncStatus.recommendedHeight - localHeight;
            
            // Only trigger if we're significantly behind (>= 1 block) and haven't synced recently
            if (heightDiff >= 1) {
              const lastSyncKey = `lastHeightSyncManagerSync`;
              const lastSyncTime = (window as any)[lastSyncKey] || 0;
              
              // Trigger sync every 5 seconds max
              if (now - lastSyncTime > 5000) {
                (window as any)[lastSyncKey] = now;
                
                // Only log if significant change or first time
                const lastAutoSyncLog = (window as any).lastAutoSyncLog || "";
                const autoSyncLog = `[Phase 46] 🚀 Auto-sync triggered: local=${localHeight}, recommended=${syncStatus.recommendedHeight} (source: ${syncStatus.recommendedSource}), diff=${heightDiff}`;
                if (autoSyncLog !== lastAutoSyncLog) {
                  (window as any).lastAutoSyncLog = autoSyncLog;
                  logger.debug(autoSyncLog);
                }
                
                // Use UnifiedSyncManager to sync
                const { handleRootTipUpdate } = await import("../core/unifiedSyncManager.js");
                const isMiner = isMining || clusterMining;
                
                // Build rootTip from syncStatus
                const recommendedSource = syncStatus.sources.find(s => s.type === syncStatus.recommendedSource);
                const recentHeaders = recommendedSource?.recentHeaders || [];
                // Convert Block[] to BlockHeader[] or { height, hash }[]
                const recentHeadersForSync = recentHeaders.map((h: any) => {
                  if (h.header) {
                    // It's a Block, extract header
                    return h.header;
                  } else if (h.height && h.hash) {
                    // It's already { height, hash }
                    return h;
                  } else {
                    // It's a BlockHeader
                    return h;
                  }
                });
                
                const rootTip = {
                  latestHeight: syncStatus.recommendedHeight,
                  latestHeaderHash: recommendedSource?.tipHash || "",
                  recentHeaders: recentHeadersForSync,
                  stateCommitment: recommendedSource?.stateCommitment || undefined,
                };
                
                try {
                  const syncResult = await handleRootTipUpdate(
                    chainContext,
                    p2pNodeRef.current,
                    rootTip,
                    isMiner,
                    (message: string) => {
                      setSyncMessage(message);
                    }
                  );
                  
                  if (syncResult.success) {
                    if (syncResult.synced) {
                      logger.info(`[Phase 46] ✅ Auto-sync completed: ${syncResult.method} sync from ${syncResult.fromHeight} → ${syncResult.toHeight}`);
                      setChainContext({ ...chainContext });
                    } else {
                      logger.debug(`[Phase 46] Auto-sync: ${syncResult.error || 'not applicable'}`);
                    }
                  } else {
                    logger.warn(`[Phase 46] Auto-sync failed: ${syncResult.error}`);
                  }
                } catch (syncError) {
                  logger.warn(`[Phase 46] Auto-sync error:`, syncError);
                }
              }
            }
          } else if (localHeight === 0 && peerCount > 0) {
            // Special case: at genesis (height 0) with peers, try to sync
            // This handles the case where we have peers but haven't received rootTip yet
            const lastGenesisSyncKey = `lastGenesisSyncAttempt`;
            const lastGenesisSyncTime = (window as any)[lastGenesisSyncKey] || 0;
            
            if (now - lastGenesisSyncTime > 10000) { // Try every 10 seconds
              (window as any)[lastGenesisSyncKey] = now;
              
              logger.info(`[Phase 46] 🔄 At genesis (height 0) with ${peerCount} peer(s), requesting network height...`);
              
              // Request global view to get network height
              if (p2pNodeRef.current) {
                p2pNodeRef.current.broadcast("GLOBAL_VIEW_REQUEST", {});
              }
            }
          }
        } catch (error) {
          logger.debug(`[Phase 46] HeightSyncManager check error:`, error);
        }
      }
    }, 2000); // Check every 2 seconds for faster sync (reduced from 3 seconds)

    // Phase 30: Handle GLOBAL_VIEW_REQUEST
    p2p.onMessage("GLOBAL_VIEW_REQUEST", async (_data: any, sender: string) => {
      const localTip = chainContext.storage.getTip();
      // Only respond if we have a valid tip with header
      if (!localTip || !localTip.header) {
        return; // Don't send response if we don't have valid chain state
      }
      
      // Get finalized height from finality manager if available
      let finalizedHeight = 0;
      if (chainContext.params.finalityEnabled && (window as any).finalityManager) {
        const finalityManager = (window as any).finalityManager;
        const stats = finalityManager.getStats();
        if (stats && stats.finalizedHeight) {
          finalizedHeight = stats.finalizedHeight;
        }
      }
      
      // Get reputation score if available
      let reputationScore: number | undefined;
      if (chainContext.params.peerScoreEnabled) {
        try {
          const { getGlobalPeerReputationManager } = await import("../core/peerReputation.js");
          const reputationManager = getGlobalPeerReputationManager(chainContext.params);
          const nodeId = getOrCreateBrowserNodeId();
          const peerScore = reputationManager.getScore(nodeId);
          if (peerScore) {
            reputationScore = peerScore.score;
          }
        } catch (e) {
          // Reputation manager not available
        }
      }
      
      const response = {
        height: localTip.header?.height ?? 0,
        tipHash: localTip.hash ?? "",
        finalizedHeight,
        stateCommitment: localTip.header?.stateCommitment,
        reputationScore,
      };
      
      // Only send response if we have valid height
      if (response.height > 0) {
        // Send response directly to requesting peer
        if (p2p.sendToPeer) {
          p2p.sendToPeer(sender, "GLOBAL_VIEW_RESPONSE", response);
        } else {
          // Fallback to broadcast if sendToPeer not available
          p2p.broadcast("GLOBAL_VIEW_RESPONSE", response);
        }
      }
    });

    // Phase 36: Handle STATE_COMMIT_GOSSIP
    p2p.onMessage("STATE_COMMIT_GOSSIP", async (data: any, sender: string) => {
      if (!chainContext) return;
      
      // Validate data structure
      if (!data || typeof data !== 'object') {
        return;
      }
      
      // Validate required fields
      if (typeof data.height !== 'number' || !data.stateCommitment || !data.tipHash) {
        return;
      }
      
      const { getStateCommitGossip } = await import("../core/stateCommitGossip.js");
      const gossip = getStateCommitGossip();
      
      // Handle state commit from peer
      gossip.handleStateCommit({
        peerId: sender,
        height: data.height,
        stateCommitment: data.stateCommitment,
        tipHash: data.tipHash,
        timestamp: data.timestamp || Date.now(),
        ipHash: data.ipHash,
      });
    });

    // Phase 30: Handle GLOBAL_VIEW_RESPONSE
    let lastKnownNetworkHeight = -1; // Track network height for auto-sync
    p2p.onMessage("GLOBAL_VIEW_RESPONSE", async (payload: any, sender: string) => {
      // Suppress frequent GLOBAL_VIEW_RESPONSE logs - only log if height changes significantly
      // console.log(`[Sync] Received GLOBAL_VIEW_RESPONSE from ${sender.substring(0, 16)}...`, payload);
      
      if (globalSentinel) {
        globalSentinel.onGlobalViewResponse(sender, payload);
      }
      
      // Phase 47: Handle availableFromHeight hint (when peer can't provide requested blocks)
      if (payload && typeof payload.availableFromHeight === 'number' && payload.availableFromHeight > 0) {
        // Store availableFromHeight for chunkSync to check
        if (typeof window !== "undefined") {
          (window as any).lastAvailableFromHeight = payload.availableFromHeight;
        }
        
        const localTip = chainContext.storage.getTip();
        const localHeight = localTip?.header?.height ?? -1;
        const gap = payload.availableFromHeight - localHeight;
        
        // Phase 47: If local is at genesis (height 0) and availableFromHeight > 1, force warp sync
        if (localHeight === 0 && payload.availableFromHeight > 1) {
          // Deduplication: Only trigger once per height
          const syncKey = `genesis_warp_${payload.height}`;
          const lastSyncTime = (window as any)[syncKey] || 0;
          const now = Date.now();
          
          // Only trigger if we haven't synced this height in the last 30 seconds
          if (now - lastSyncTime < 30000) {
            return; // Skip duplicate trigger
          }
          
          (window as any)[syncKey] = now;
          
          logger.info(`[Phase 47] 🚀 Genesis node detected with availableFromHeight=${payload.availableFromHeight} → FORCING warp sync`);
          
          // Trigger UnifiedSyncManager to force warp sync
          if (p2pNodeRef.current) {
            const { handleRootTipUpdate } = await import("../core/unifiedSyncManager.js");
            const rootTip = {
              latestHeight: payload.height,
              latestHeaderHash: payload.tipHash || "",
              recentHeaders: [],
              latestSnapshotMeta: null,
              stateCommitment: payload.stateCommitment,
            };
            
            // Force warp sync with status callback
            handleRootTipUpdate(
              chainContext, 
              p2pNodeRef.current, 
              rootTip, 
              false,
              (message: string) => {
                setSyncMessage(message);
              }
            ).catch((error) => {
              logger.error(`[Phase 47] Failed to trigger warp sync:`, error);
              setSyncMessage(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
          
          return; // Don't process as regular GLOBAL_VIEW_RESPONSE
        }
        
        // If we're requesting blocks that are pruned, check if we need snapshot sync
        if (localHeight < payload.availableFromHeight && payload.height > localHeight) {
          const snapshotInterval = chainContext.params.snapshotInterval || 1000;
          
          // If gap is large (>= snapshotInterval), we need snapshot sync
          if (gap >= snapshotInterval) {
            // Prevent duplicate snapshot requests
            const snapshotRequestKey = `snapshot_request_${payload.availableFromHeight}`;
            const lastRequest = (window as any)[snapshotRequestKey] || 0;
            const now = Date.now();
            
            // Only request snapshot once every 30 seconds
            if (now - lastRequest < 30000) {
              logger.debug(`[Sync] Snapshot request already in progress, skipping duplicate request`);
              // Still request blocks from available height
              p2p.broadcast("REQUEST_BLOCKS", {
                fromHeight: payload.availableFromHeight,
                toHeight: Math.min(payload.height, payload.availableFromHeight + 500),
              });
              return;
            }
            
            (window as any)[snapshotRequestKey] = now;
            
            // Try to request snapshot from peers via P2P
            if (p2p.sendToPeer && snapshotDownloader) {
              const peerIds = Array.from(p2p.peers.keys());
              for (const peerId of peerIds) {
                const peer = p2p.peers.get(peerId);
                if (peer && peer.connected && peer.dataChannel && peer.dataChannel.readyState === 'open') {
                  logger.debug(`[Sync] Requesting snapshot metadata from peer ${peerId.substring(0, 16)}... (need height ~${payload.availableFromHeight - 1})`);
                  // Request snapshot metadata first
                  p2p.sendToPeer(peerId, "REQUEST_SNAPSHOT_META", {
                    targetHeight: payload.availableFromHeight - 1,
                  });
                }
              }
              
              // Also try to trigger snapshot downloader to find and download snapshot
              // Use setTimeout to avoid blocking the message handler
              setTimeout(async () => {
                try {
                  const targetHeight = payload.availableFromHeight - 1;
                  // Removed debug log: [Sync] Triggering snapshot downloader
                  // Wait a bit for SNAPSHOT_META responses to arrive
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  const metas = await snapshotDownloader.requestSnapshotMeta(targetHeight);
                  if (metas && metas.length > 0) {
                    // Find the best snapshot (closest to targetHeight but not exceeding it)
                    const suitableSnapshots = metas.filter(m => m.height <= targetHeight);
                    if (suitableSnapshots.length > 0) {
                      const bestSnapshot = suitableSnapshots.sort((a, b) => b.height - a.height)[0];
                      // Removed debug log: [Sync] Found suitable snapshot
                      snapshotDownloader.downloadSnapshot(bestSnapshot, {}, (_progress) => {
                        // Removed debug log: [Sync] Snapshot download progress
                      }).then(() => {
                        // Removed debug log: [Sync] Snapshot downloaded
                        // Snapshot will be applied automatically by the downloader
                      }).catch((error) => {
                        console.error(`[Sync] ❌ Failed to download snapshot:`, error);
                      });
                    }
                  }
                  
                  // Phase 38: Check if Worker has snapshot in rootTIP
                  const workerHasSnapshot = typeof window !== "undefined" && (window as any).lastRootTipSnapshotMeta;
                  const workerHeight = typeof window !== "undefined" ? ((window as any).lastRootTipHeight || 0) : 0;
                  
                  if (workerHasSnapshot && workerHeight > localHeight) {
                    // Worker has snapshot, try to download from Worker
                    const workerSnapshotMeta = (window as any).lastRootTipSnapshotMeta;
                    
                    setTimeout(async () => {
                      try {
                        // Check peer count before attempting download
                        const peerCount = p2p.peers ? p2p.peers.size : 0;
                        const connectedPeers = peerCount > 0 ? Array.from(p2p.peers.values()).filter(p => p.connected && p.dataChannel && p.dataChannel.readyState === 'open').length : 0;
                        
                        if (connectedPeers === 0) {
                          // No peers connected
                          const errorMsg = locale === "zh" 
                            ? `⚠️ 无法同步：本地高度 ${localHeight}，网络高度 ${workerHeight}（差距 ${gap} 个）。\n\nCloudflare Worker 有快照，但没有对等节点连接，无法下载。\n\n解决方案：\n1. 等待对等节点连接（通常需要几秒钟）\n2. 检查 P2P 网络连接状态\n3. 或者重置链数据重新开始（在 Advanced 标签页）`
                            : `⚠️ Cannot sync: Local height ${localHeight}, network height ${workerHeight} (gap: ${gap} blocks).\n\nCloudflare Worker has snapshot, but no peers connected to download it.\n\nSolutions:\n1. Wait for peers to connect (usually takes a few seconds)\n2. Check P2P network connection status\n3. Or reset chain data to start fresh (in Advanced tab)`;
                          setError(errorMsg);
                          return;
                        }
                        
                        // First, request snapshot metadata from peers to discover available snapshots
                        logger.debug(`[Sync] Requesting snapshot metadata from ${connectedPeers} peer(s) before downloading...`);
                        try {
                          const availableMetas = await snapshotDownloader.requestSnapshotMeta(workerSnapshotMeta.height);
                          if (availableMetas && availableMetas.length > 0) {
                            // Use the best available snapshot (closest to target height, but can be lower)
                            const bestMeta = availableMetas
                              .filter(m => m.height <= workerSnapshotMeta.height)
                              .sort((a, b) => b.height - a.height)[0] || availableMetas[0];
                            
                            logger.debug(`[Sync] Found ${availableMetas.length} available snapshot(s), using height ${bestMeta.height}`);
                            await snapshotDownloader.downloadSnapshot(bestMeta, {}, (_progress) => {
                              // Snapshot download progress
                            });
                            setError(""); // Clear error on success
                          } else {
                            // No snapshots available from peers, try with Worker's snapshot meta anyway
                            logger.debug(`[Sync] No snapshots found from peers, trying with Worker's snapshot meta...`);
                            await snapshotDownloader.downloadSnapshot(workerSnapshotMeta, {}, (_progress) => {
                              // Snapshot download progress
                            });
                            setError(""); // Clear error on success
                          }
                        } catch (metaError) {
                          // If metadata request fails, try downloading with Worker's snapshot meta anyway
                          logger.debug(`[Sync] Snapshot metadata request failed, trying direct download:`, metaError);
                          await snapshotDownloader.downloadSnapshot(workerSnapshotMeta, {}, (_progress) => {
                            // Snapshot download progress
                          });
                          setError(""); // Clear error on success
                        }
                      } catch (error) {
                        // Snapshot download failed - this is normal if peers don't have snapshots
                        // Fallback to block sync instead of showing error
                        logger.debug(`[Sync] Snapshot download failed, falling back to block sync:`, error);
                        const errorMsg = error instanceof Error ? error.message : String(error);
                        const peerCount = p2p.peers ? p2p.peers.size : 0;
                        const connectedPeers = peerCount > 0 ? Array.from(p2p.peers.values()).filter(p => p.connected && p.dataChannel && p.dataChannel.readyState === 'open').length : 0;
                        
                        // If snapshot download fails but we have peers, allow fallback to block sync
                        // Only show error if gap is very large (>= 200 blocks) and no peers have snapshots
                        if (gap >= 200 && errorMsg.includes("No available sources")) {
                          let detailedError = locale === "zh" 
                            ? `⚠️ 无法同步：本地高度 ${localHeight}，网络高度 ${workerHeight}（差距 ${gap} 个）。\n\n已尝试从 Cloudflare Worker 下载快照，但失败：${errorMsg}\n\n当前状态：\n- 对等节点数量：${connectedPeers}\n- 对等节点没有快照\n\n系统将尝试通过区块同步来追赶（可能需要较长时间）。\n\n解决方案：\n1. 等待有快照的对等节点连接\n2. 或者重置链数据重新开始（在 Advanced 标签页）`
                            : `⚠️ Cannot sync: Local height ${localHeight}, network height ${workerHeight} (gap: ${gap} blocks).\n\nAttempted to download snapshot from Cloudflare Worker but failed: ${errorMsg}\n\nCurrent status:\n- Connected peers: ${connectedPeers}\n- Peers don't have snapshots\n\nSystem will attempt to catch up via block sync (may take a while).\n\nSolutions:\n1. Wait for peers with snapshots to connect\n2. Or reset chain data to start fresh (in Advanced tab)`;
                          setError(detailedError);
                        } else {
                          // For smaller gaps or other errors, allow block sync to proceed
                          logger.debug(`[Sync] Snapshot download failed, allowing block sync to proceed. Error: ${errorMsg}`);
                          // Clear error to allow block sync
                          setError("");
                        }
                      }
                    }, 500);
                  } else {
                    // No snapshot available from Worker or peers
                    const errorMsg = locale === "zh" 
                      ? `⚠️ 无法同步：本地高度 ${localHeight}，对等节点只能从高度 ${payload.availableFromHeight} 提供区块（差距 ${gap} 个）。\n\n对等节点没有快照，无法填补缺失的区块。\n\n解决方案：\n1. 等待有快照的对等节点连接\n2. 或者重置链数据重新开始（在 Advanced 标签页）\n\n提示：如果 Cloudflare Worker 有快照，系统会自动尝试下载。`
                      : `⚠️ Cannot sync: Local height ${localHeight}, peer can only provide from height ${payload.availableFromHeight} (gap: ${gap} blocks).\n\nPeer has no snapshots to fill the gap.\n\nSolutions:\n1. Wait for peers with snapshots to connect\n2. Or reset chain data to start fresh (in Advanced tab)\n\nNote: If Cloudflare Worker has a snapshot, the system will automatically attempt to download it.`;
                    console.error(`[Sync] ${errorMsg}`);
                    setError(errorMsg);
                  }
                } catch (error) {
                  console.error(`[Sync] Error requesting snapshot:`, error);
                }
              }, 100);
            }
            
            // Don't request blocks from available height if gap is too large
            // Wait for snapshot sync first
            // Removed debug log: [Sync] Gap too large
            return; // Don't process as regular GLOBAL_VIEW_RESPONSE
          } else {
            // Small gap, just request from available height
            // Removed debug log: [Sync] Peer indicates blocks available
            p2p.broadcast("REQUEST_BLOCKS", {
              fromHeight: payload.availableFromHeight,
              toHeight: Math.min(payload.height, payload.availableFromHeight + 500),
            });
            return; // Don't process as regular GLOBAL_VIEW_RESPONSE
          }
        }
      }
      
        // Use network height to trigger sync if we're behind
        if (payload && typeof payload.height === 'number' && payload.height > 0) {
          const networkHeight = payload.height;
          lastKnownNetworkHeight = Math.max(lastKnownNetworkHeight, networkHeight); // Track highest known height
          
          const localTip = chainContext.storage.getTip();
          const localHeight = localTip?.header.height ?? -1;
          const behindBy = networkHeight - localHeight;
          
          // Log when network height is discovered or changes significantly (reduce frequency)
          const shouldLog = lastKnownNetworkHeight !== networkHeight || (localHeight === 0 && networkHeight > 0 && behindBy > 100);
          if (shouldLog) {
            logger.debug(`[Sync] 📡 Network height: ${networkHeight}, Local height: ${localHeight}, Behind by: ${behindBy} blocks`);
            
            // Phase 46: If we're at genesis (height 0) and network is ahead, trigger UnifiedSyncManager immediately
            if (localHeight === 0 && networkHeight > 0 && p2pNodeRef.current) {
              const lastRootTipHeight = (window as any).lastRootTipHeight || 0;
              const lastRootTipHash = (window as any).lastRootTipHash || "";
              const lastRootTipRecentHeaders = (window as any).lastRootTipRecentHeaders || [];
              
              // Use networkHeight as target if we don't have rootTip info
              const targetHeight = lastRootTipHeight > 0 ? lastRootTipHeight : networkHeight;
              
              if (targetHeight > localHeight) {
                // Deduplication: Only trigger if target height changed or last sync was > 10 seconds ago
                // Store in window to persist across function calls
                const now = Date.now();
                const lastSyncTriggerTime = (window as any).lastGLOBAL_VIEW_SYNC_TIME || 0;
                const lastSyncTargetHeight = (window as any).lastGLOBAL_VIEW_SYNC_HEIGHT || -1;
                
                if (targetHeight !== lastSyncTargetHeight || (now - lastSyncTriggerTime > 10000)) {
                  (window as any).lastGLOBAL_VIEW_SYNC_TIME = now;
                  (window as any).lastGLOBAL_VIEW_SYNC_HEIGHT = targetHeight;
                  
                  logger.debug(`[Phase 46] 🚀 Triggering immediate sync from GLOBAL_VIEW_RESPONSE: local=0, target=${targetHeight}`);
                  
                  // Trigger UnifiedSyncManager immediately
                  setTimeout(async () => {
                    try {
                      const { handleRootTipUpdate } = await import("../core/unifiedSyncManager.js");
                    const isMiner = isMining || clusterMining;
                    
                      const syncResult = await handleRootTipUpdate(
                        chainContext,
                        p2pNodeRef.current!,
                        {
                          latestHeight: targetHeight,
                          latestHeaderHash: lastRootTipHash || "",
                          recentHeaders: lastRootTipRecentHeaders || [],
                          stateCommitment: (window as any).lastRootTipStateCommitment || undefined,
                        },
                        isMiner
                      );
                      
                      if (syncResult.success) {
                        if (syncResult.synced) {
                          logger.info(`[Phase 46] ✅ Sync from GLOBAL_VIEW_RESPONSE completed: ${syncResult.method} sync from ${syncResult.fromHeight} → ${syncResult.toHeight}`);
                          setChainContext({ ...chainContext });
                        } else {
                          logger.debug(`[Phase 46] Sync from GLOBAL_VIEW_RESPONSE: ${syncResult.error || 'not applicable'}`);
                        }
                      } else {
                        logger.warn(`[Phase 46] Sync from GLOBAL_VIEW_RESPONSE failed: ${syncResult.error}`);
                      }
                    } catch (error) {
                      logger.warn(`[Phase 46] Sync from GLOBAL_VIEW_RESPONSE error:`, error);
                    }
                  }, 100);
                } else {
                  logger.debug(`[Phase 46] Skipping duplicate sync trigger: target=${targetHeight}, lastSync=${now - lastSyncTriggerTime}ms ago`);
                }
              }
            }
          }
        
        // Suppress frequent sync status logs - only log when height changes significantly
        // console.log(`[Sync] Network height: ${networkHeight}, Local height: ${localHeight}, Behind by: ${behindBy}`);
        
        // Update sync status (always update if we have a valid network height)
        setSyncStatus(prev => {
          // Always update networkHeight if we receive a valid response
          // Use the higher of the two network heights (in case of multiple responses)
          const finalNetworkHeight = Math.max(networkHeight, prev.networkHeight);
          const finalBehindBy = finalNetworkHeight - localHeight;
          
          // Store sync status in window for auto-sync interval to access (backward compatibility)
          (window as any).lastSyncStatus = {
            networkHeight: finalNetworkHeight,
            localHeight: localHeight,
          };
          // Also update ref immediately so auto-sync interval can access it
          syncStatusRef.current = {
            isSyncing: finalBehindBy > 0,
            localHeight,
            networkHeight: finalNetworkHeight,
            behindBy: finalBehindBy,
            progress: finalNetworkHeight > 0 ? Math.min(100, Math.max(0, (localHeight / finalNetworkHeight) * 100)) : 0,
          };
          
          return {
            isSyncing: finalBehindBy > 0,
            localHeight,
            networkHeight: finalNetworkHeight,
            behindBy: finalBehindBy,
            progress: finalNetworkHeight > 0 ? Math.min(100, Math.max(0, (localHeight / finalNetworkHeight) * 100)) : 0,
          };
        });
        
        if (networkHeight > localHeight) {
          // Special case: if local is at genesis (height 0) and Worker has recent headers from a higher height,
          // start syncing from the lowest available header height instead of from 1
          let syncFromHeight = localHeight + 1;
          const workerRecentHeaders = typeof window !== "undefined" ? ((window as any).lastRootTipRecentHeaders || []) : [];
          
          if (localHeight === 0 && workerRecentHeaders.length > 0) {
            // Find the minimum height from Worker's recent headers
            const minWorkerHeight = Math.min(...workerRecentHeaders.map((h: any) => h.height || Infinity));
            if (minWorkerHeight > 0 && minWorkerHeight < networkHeight) {
              logger.debug(`[Sync] Local is at genesis, Worker has headers from height ${minWorkerHeight}, starting sync from ${minWorkerHeight} instead of 1`);
              syncFromHeight = minWorkerHeight;
            }
          }
          
          const requestRange = Math.min(behindBy, 500); // Request up to 500 blocks at a time
          const targetHeight = Math.min(syncFromHeight + requestRange - 1, networkHeight);
          
          // Check if we've requested this range recently (avoid duplicate requests)
          const requestKey = `request_${syncFromHeight}_${targetHeight}`;
          const lastRequest = (window as any)[requestKey] || 0;
          const now = Date.now();
          
          // Request if we haven't requested this exact range in the last 2 seconds
          if (now - lastRequest > 2000) {
            (window as any)[requestKey] = now;
            const peerCount = p2p.getPeerCount();
            // Production: No console logs
            if (peerCount === 0) {
              // Production: No console logs
            } else {
              // Phase 43: Use chunk-based sync to only request missing blocks
              const chunkBasedSyncManager = getChunkBasedSyncManager();
              const coverage = chunkBasedSyncManager.getBlockCoverage(syncFromHeight, targetHeight);
              
              if (coverage.missing > 0) {
                // Use chunk-based sync to only request missing blocks
                const syncResult = await chunkBasedSyncManager.syncMissingBlocks(syncFromHeight, targetHeight);
                
                if (syncResult.success) {
                  logger.debug(`[ChunkBasedSync] ✅ Requested ${syncResult.requestedChunks.length} chunk(s), skipped ${syncResult.skippedBlocks} already-present blocks`);
                } else {
                  // Fallback to normal sync
                  logger.warn(`[ChunkBasedSync] Failed, falling back to normal sync`);
                  p2p.broadcast("REQUEST_BLOCKS", {
                    fromHeight: syncFromHeight,
                    toHeight: targetHeight,
                  });
                }
              } else {
                logger.info(`[Sync] ✅ All blocks ${syncFromHeight}-${targetHeight} are already present, no sync needed`);
              }
            }
          }
        } else if (networkHeight === localHeight) {
          // Only log when fully synced (important milestone)
          // console.log(`[Sync] ✅ Already synced to network height ${networkHeight}`);
          setSyncStatus(prev => ({ ...prev, isSyncing: false, behindBy: 0, progress: 100 }));
        } else if (localHeight > networkHeight) {
          // We're ahead of the network (shouldn't happen, but log it)
          // Suppress this log as it's not critical
          // console.log(`[Sync] ⚠️ Local height (${localHeight}) is ahead of network height (${networkHeight})`);
        }
      }
    });

    // Phase 32: Handle BOOTSTRAP_RESPONSE from signal server
    p2p.onMessage("BOOTSTRAP_RESPONSE", async (payload: any, sender: string) => {
      logger.debug(`[Phase 32] Received BOOTSTRAP_RESPONSE from ${sender}`, {
        latestHeight: payload.latestHeight,
        latestHeaderHash: payload.latestHeaderHash?.substring(0, 16) + "...",
        hasHeader: !!payload.latestHeader,
        hasSnapshotMeta: !!payload.latestSnapshotMeta,
        recentHeadersCount: payload.recentHeaders?.length || 0
      });
      
      // Phase 37: Store rootTip info for debug overlay
      // Phase 38: Also store snapshot meta for later use
      if (typeof window !== "undefined" && payload.latestHeight > 0) {
        (window as any).lastRootTipHeight = payload.latestHeight;
        (window as any).lastRootTipHash = payload.latestHeaderHash || "";
        (window as any).lastBootstrapResponseTime = Date.now();
        (window as any).lastRootTipTrustLevel = payload.trustLevel || 'root-only';
        (window as any).lastRootTipStateCommitment = payload.stateCommitment || null;
        
        // Store recent headers to determine minimum available height
        if (payload.recentHeaders && payload.recentHeaders.length > 0) {
          (window as any).lastRootTipRecentHeaders = payload.recentHeaders;
        }
        
        if (payload.latestSnapshotMeta) {
          (window as any).lastRootTipSnapshotMeta = payload.latestSnapshotMeta;
        }
      }
      
      if (!chainContext) {
        return;
      }
      
      const localTip = chainContext.storage.getTip();
      const localHeight = localTip?.header.height ?? -1;
      const networkHeight = payload.latestHeight || 0;
      
      // 🔥 Hard Reorg: Check for fork if we have recent headers
      // Sync 3.5: Only miners can trigger hard reorg. Non-miners never fork.
      const isMiner = isMining || clusterMining;
      if (!isMiner) {
        logger.debug(`[HardReorg] Non-miner node: skipping fork check. Will only append blocks during sync.`);
      }
      if (payload.latestHeaderHash && payload.recentHeaders && payload.recentHeaders.length > 0 && isMiner) {
        try {
          const { checkForFork, performHardReorg } = await import("../core/hardReorg.js");
          const forkResult = checkForFork(chainContext, payload.latestHeaderHash, payload.recentHeaders, networkHeight, isMiner);
          
          if (forkResult) {
            logger.warn(`[HardReorg] 🚨 Fork detected from BOOTSTRAP_RESPONSE! ${forkResult.reason}`);
            logger.warn(`[HardReorg] Local: height=${forkResult.localHeight}, hash=${forkResult.localTipHash.substring(0, 16)}...`);
            logger.warn(`[HardReorg] Root: height=${forkResult.rootHeight}, hash=${forkResult.rootTipHash.substring(0, 16)}...`);
            logger.warn(`[HardReorg] Will rewind to height ${forkResult.rewindHeight}`);
            
            // Stop mining immediately
            if (isMining) {
              logger.warn(`[HardReorg] Stopping mining due to fork detection`);
              handleStopMining();
            }
            if (clusterMining) {
              logger.warn(`[HardReorg] Stopping cluster mining due to fork detection`);
              handleStopClusterMining();
            }
            
            // Perform hard reorg
            const reorgResult = await performHardReorg(chainContext, forkResult.rewindHeight);
            
            if (reorgResult.success) {
              logger.info(`[HardReorg] ✅ Hard reorg completed: removed ${reorgResult.removedBlocks} blocks, rewound to height ${forkResult.rewindHeight}`);
              
              // Update chain context to trigger re-render
              setChainContext({ ...chainContext });
              
              // Set error message to inform user
              setError(
                locale === "zh"
                  ? `⚠️ 检测到分叉链，已自动重组：删除了 ${reorgResult.removedBlocks} 个区块，回滚到高度 ${forkResult.rewindHeight}。正在重新同步...`
                  : `⚠️ Fork detected and auto-reorged: removed ${reorgResult.removedBlocks} blocks, rewound to height ${forkResult.rewindHeight}. Resyncing...`
              );
              
              // Trigger resync
              if (networkHeight > forkResult.rewindHeight) {
                logger.info(`[HardReorg] Triggering resync from height ${forkResult.rewindHeight + 1} to ${networkHeight}`);
                p2p.broadcast("REQUEST_BLOCKS", {
                  fromHeight: forkResult.rewindHeight + 1,
                  toHeight: networkHeight,
                });
              }
            } else {
              logger.error(`[HardReorg] ❌ Hard reorg failed: ${reorgResult.error}`);
              setError(
                locale === "zh"
                  ? `❌ 链重组失败: ${reorgResult.error}。建议手动重置链。`
                  : `❌ Chain reorg failed: ${reorgResult.error}. Consider manual chain reset.`
              );
            }
            
            // Don't continue with normal bootstrap sync if we just did a reorg
            return;
          }
        } catch (error) {
          logger.error(`[HardReorg] Error checking for fork:`, error);
          // Continue with normal processing
        }
      }
      
      // Check if Worker has snapshot meta and we need it
      if (payload.latestSnapshotMeta && networkHeight > localHeight) {
        const heightDiff = networkHeight - localHeight;
        const snapshotInterval = chainContext.params.snapshotInterval || 1000;
        
        if (heightDiff >= snapshotInterval) {
          logger.debug(`[Phase 32] ✅ Worker has snapshot meta at height ${payload.latestSnapshotMeta.height}, triggering snapshot download (height diff: ${heightDiff})`);
          
          // Check if we have peers before attempting snapshot download
          const connectedPeers = p2p.peers ? Array.from(p2p.peers.values()).filter((peer: any) => peer.connected && peer.dataChannel && peer.dataChannel.readyState === 'open') : [];
          
          if (connectedPeers.length === 0) {
            logger.debug(`[Phase 32] No peers connected yet, will attempt snapshot download once peers connect. Falling back to block sync for now.`);
            // Store snapshot meta for later when peers connect
            if (typeof window !== "undefined") {
              (window as any).pendingSnapshotDownload = {
                snapshotMeta: payload.latestSnapshotMeta,
                requestedAt: Date.now(),
              };
            }
            // Continue with block sync instead
            return;
          }
          
          // Trigger snapshot download from Worker's snapshot meta
          if (snapshotDownloader) {
            setTimeout(async () => {
              try {
                logger.debug(`[Phase 32] Starting snapshot download from Worker snapshot meta (height: ${payload.latestSnapshotMeta.height})`);
                snapshotDownloader.downloadSnapshot(payload.latestSnapshotMeta, {}, (progress) => {
                  logger.debug(`[Phase 32] Snapshot download progress: ${progress.percent.toFixed(1)}% (${progress.receivedChunks}/${progress.totalChunks} chunks)`);
                }).then(() => {
                  logger.debug(`[Phase 32] ✅ Snapshot downloaded successfully from Worker at height ${payload.latestSnapshotMeta.height}`);
                  // Snapshot will be applied automatically by the downloader
                }).catch((error) => {
                  // Only log as warning if it's "No available sources" (no peers), otherwise error
                  const errorMsg = error instanceof Error ? error.message : String(error);
                  if (errorMsg.includes("No available sources")) {
                    logger.debug(`[Phase 32] ⚠️ Snapshot download skipped: no peers available. Will retry when peers connect.`);
                    // Store for retry when peers connect
                    if (typeof window !== "undefined") {
                      (window as any).pendingSnapshotDownload = {
                        snapshotMeta: payload.latestSnapshotMeta,
                        requestedAt: Date.now(),
                      };
                    }
                  } else {
                    logger.warn(`[Phase 32] ⚠️ Failed to download snapshot from Worker: ${errorMsg}. Will fall back to block sync.`);
                  }
                });
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.warn(`[Phase 32] ⚠️ Error downloading snapshot from Worker: ${errorMsg}. Will fall back to block sync.`);
              }
            }, 500);
          }
        }
      }
      
      // Phase 32: If bootstrap state is empty (latestHeight: 0), fall back to P2P query
      if (networkHeight === 0 || !payload.latestHeader) {
        logger.debug(`[Phase 32] Bootstrap state is empty (height: ${networkHeight}), falling back to P2P network query`);
        
        // Mark bootstrap as complete (even though we don't have valid data)
        // This allows mining guard to proceed, but we'll rely on P2P for sync
        setBootstrapComplete(true);
        
        // Query network height via P2P (if we have peers)
        const peerCount = p2p.getPeerCount();
        if (peerCount > 0) {
          logger.debug(`[Phase 32] Querying network height from ${peerCount} peer(s) via GLOBAL_VIEW_REQUEST`);
          p2p.broadcast("GLOBAL_VIEW_REQUEST", {});
        } else {
          logger.debug(`[Phase 32] No peers available yet, requesting peers more aggressively...`);
          // Request peers more frequently when we don't have any
          p2p.requestPeers();
          
          // Also try to request peers via signaling server
          if (typeof (p2p as any).sendToSignalServer === 'function') {
            (p2p as any).sendToSignalServer("request-peers", {});
          }
        }
        
        // Also request blocks aggressively if we're at a low height
        // Even without peers, we'll request so that when peers connect, they can respond
        if (localHeight < 100) {
          // Production: No console logs
          if (peerCount > 0) {
            p2p.broadcast("REQUEST_BLOCKS", {
              fromHeight: localHeight + 1,
              toHeight: localHeight + 500,
            });
          } else {
            // Store request for when peers connect
            logger.debug(`[Phase 32] Storing block request for when peers connect`);
            if (typeof window !== "undefined") {
              (window as any).pendingBlockRequest = {
                fromHeight: localHeight + 1,
                toHeight: localHeight + 500,
              };
            }
          }
        }
        
        return; // Don't process empty bootstrap response
      }
      
      try {
        // Phase 46: Use UnifiedSyncManager instead of BootstrapSyncManager
        const localTip = chainContext.storage.getTip();
        const localHeight = localTip?.header.height ?? -1;
        const networkHeight = payload.latestHeight || 0;
        const peerCount = p2p.getPeerCount();
        
        logger.info(`[Phase 46] BOOTSTRAP_RESPONSE received: local=${localHeight}, network=${networkHeight}, peers=${peerCount}, hasHeader=${!!payload.latestHeader}, hasRecentHeaders=${!!payload.recentHeaders?.length}, hasSnapshotMeta=${!!payload.latestSnapshotMeta}`);
        
        // Phase 47: Special handling for genesis nodes (height 0)
        if (localHeight === 0 && networkHeight > 0) {
          logger.info(`[Phase 47] 🚀 Genesis node detected in BOOTSTRAP_RESPONSE: local=0, network=${networkHeight}, forcing warp sync`);
        }
        
        if (networkHeight > 0 && p2pNodeRef.current) {
          logger.info(`[Phase 46] 🚀 Processing BOOTSTRAP_RESPONSE via UnifiedSyncManager: local=${localHeight}, network=${networkHeight}, peers=${peerCount}`);
          
          const { handleRootTipUpdate } = await import("../core/unifiedSyncManager.js");
          const isMiner = isMining || clusterMining;
          
          logger.info(`[Phase 46] Calling handleRootTipUpdate with: height=${networkHeight}, hasHeader=${!!payload.latestHeader}, recentHeaders=${payload.recentHeaders?.length || 0}, hasSnapshotMeta=${!!payload.latestSnapshotMeta}`);
          
          const syncResult = await handleRootTipUpdate(
            chainContext,
            p2pNodeRef.current,
            {
              latestHeight: networkHeight,
              latestHeader: payload.latestHeader,
              latestHeaderHash: payload.latestHeaderHash || "",
              recentHeaders: payload.recentHeaders || [],
              latestSnapshotMeta: payload.latestSnapshotMeta,
              stateCommitment: payload.stateCommitment,
            },
            isMiner,
            (message: string) => {
              // Phase 47: Update UI with sync status
              setSyncMessage(message);
            }
          );
          
          logger.info(`[Phase 46] handleRootTipUpdate result: success=${syncResult.success}, synced=${syncResult.synced}, method=${syncResult.method}, error=${syncResult.error || 'none'}`);
          
          // Phase 47: If genesis sync failed, log more details
          if (localHeight === 0 && !syncResult.synced) {
            logger.warn(`[Phase 47] ⚠️ Genesis sync not completed: success=${syncResult.success}, method=${syncResult.method}, error=${syncResult.error || 'none'}`);
            logger.warn(`[Phase 47] Current state: localHeight=${localHeight}, networkHeight=${networkHeight}, peers=${peerCount}, hasSnapshotDownloader=${!!(typeof window !== "undefined" && (window as any).snapshotDownloader)}`);
          }
          
          if (syncResult.success) {
            if (syncResult.synced) {
              logger.info(`[Phase 46] ✅ Bootstrap sync via UnifiedSyncManager completed: ${syncResult.method} sync from ${syncResult.fromHeight} → ${syncResult.toHeight}`);
              setChainContext({ ...chainContext });
              setBootstrapComplete(true);
              
              // Update sync status
              const newLocalHeight = chainContext.storage.getTip()?.header.height ?? localHeight;
              const behindBy = networkHeight - newLocalHeight;
              setSyncStatus({
                isSyncing: behindBy > 0,
                localHeight: newLocalHeight,
                networkHeight,
                behindBy,
                progress: networkHeight > 0 ? Math.min(100, Math.max(0, (newLocalHeight / networkHeight) * 100)) : 0,
              });
              
              return; // Success, skip old bootstrap processing
            } else {
              logger.warn(`[Phase 46] UnifiedSyncManager did not sync: ${syncResult.error || 'not applicable'}, will fallback to BootstrapSyncManager`);
            }
          } else {
            logger.error(`[Phase 46] UnifiedSyncManager failed: ${syncResult.error}, will fallback to BootstrapSyncManager`);
          }
        } else {
          logger.warn(`[Phase 46] Cannot use UnifiedSyncManager: networkHeight=${networkHeight}, hasP2PNode=${!!p2pNodeRef.current}`);
        }
        
        // Fallback to old BootstrapSyncManager if UnifiedSyncManager fails or is not applicable
        const { getBootstrapSyncManager } = await import("../core/bootstrapSync.js");
        const bootstrapManager = getBootstrapSyncManager(chainContext);
        
        const result = await bootstrapManager.processBootstrapResponse(payload);
        
        if (result.success) {
          logger.debug(`[Phase 32] Bootstrap sync ${result.synced ? 'completed' : 'skipped (already up to date)'}`, result.actions);
          setBootstrapComplete(bootstrapManager.isBootstrapComplete());
          
          // Only update if we got a valid network height
          if (networkHeight > 0) {
            const behindBy = networkHeight - localHeight;
            
            // Check if bootstrap actions suggest chain reset
            const suggestsReset = result.actions.some(action => 
              typeof action === 'string' && action.includes('Consider resetting chain')
            );
            
            // Special case: if local height is 0 (genesis), don't show error - this is normal
            // Worker only has recent headers, so they won't connect to genesis
            if (suggestsReset && behindBy > 100 && localHeight > 0) {
              // Large gap detected and chain discontinuity (but not at genesis) - suggest reset
              const resetSuggestion = locale === "zh"
                ? `⚠️ 链同步问题：本地高度 ${localHeight}，网络高度 ${networkHeight}（差距 ${behindBy} 个区块）。\n\n检测到链不连续，本地链可能在不同的分叉上或过于落后。\n\n建议：在 Advanced 标签页重置链数据，然后重新开始同步。`
                : `⚠️ Chain sync issue: Local height ${localHeight}, network height ${networkHeight} (gap: ${behindBy} blocks).\n\nChain discontinuity detected. Local chain may be on a different fork or too far behind.\n\nRecommendation: Reset chain data in Advanced tab, then restart sync.`;
              setError(resetSuggestion);
            } else if (localHeight === 0 && behindBy > 100) {
              // At genesis with large gap - this is normal, clear any previous errors
              // System will sync from available headers or snapshots
              setError("");
            }
            
            setSyncStatus({
              isSyncing: behindBy > 0,
              localHeight,
              networkHeight,
              behindBy,
              progress: networkHeight > 0 ? Math.min(100, Math.max(0, (localHeight / networkHeight) * 100)) : 0,
            });
            
            logger.debug(`[Phase 32] Updated sync status: behindBy=${behindBy}, progress=${Math.round((localHeight / networkHeight) * 100)}%`);
          }
          
          // Phase 37: If we need to sync, trigger block requests immediately
          // This ensures we actually request blocks even if peers=0 (they'll be requested when peers connect)
          if (result.synced && result.newHeight && result.newHeight > localHeight) {
            const heightDiff = result.newHeight - localHeight;
            
            logger.debug(`[Phase 32] Bootstrap indicates we need to sync: ${heightDiff} blocks behind (local: ${localHeight}, target: ${result.newHeight})`);
            
            // Request blocks via P2P (if we have peers)
            const peerCount = p2p.getPeerCount();
            if (peerCount > 0) {
              logger.debug(`[Phase 32] Requesting ${heightDiff} blocks from ${peerCount} peer(s) to sync to height ${result.newHeight}`);
              p2p.broadcast("REQUEST_BLOCKS", {
                fromHeight: localHeight + 1,
                toHeight: result.newHeight,
              });
            } else {
              // Store request for when peers connect
              logger.debug(`[Phase 32] No peers yet, storing block request for when peers connect`);
              if (typeof window !== "undefined") {
                (window as any).pendingBootstrapBlockRequest = {
                  fromHeight: localHeight + 1,
                  toHeight: result.newHeight,
                  requestedAt: Date.now(),
                };
              }
            }
          }
          
          // If snapshot meta is provided and we're far behind, trigger snapshot sync
          if (payload.latestSnapshotMeta && typeof window !== "undefined") {
            const localTip = chainContext.storage.getTip();
            const localHeight = localTip?.header.height ?? -1;
            const heightDiff = payload.latestHeight - localHeight;
            const snapshotInterval = chainContext.params.snapshotInterval || 1000;
            
            if (heightDiff >= snapshotInterval) {
              logger.debug(`[Phase 32] Large height difference (${heightDiff}), triggering snapshot sync`);
              (window as any).pendingBootstrapSnapshot = payload.latestSnapshotMeta;
            }
          }
        } else {
          console.error(`[Phase 32] Bootstrap sync failed:`, result.error);
        }
      } catch (error) {
        console.error(`[Phase 32] Error processing bootstrap response:`, error);
      }
    });

    // Phase 46+: Handle ROOT_TIP_GOSSIP (P2P rootTip propagation)
    p2p.onMessage("ROOT_TIP_GOSSIP", async (message: any, sender: string) => {
      if (!chainContext || !p2pNodeRef.current) return;
      
      try {
        const { getRootTipGossipManager } = await import("../core/rootTipGossip.js");
        const gossipManager = getRootTipGossipManager();
        gossipManager.init(p2pNodeRef.current);
        
        // Handle gossip message
        const result = await gossipManager.handleGossipMessage(message, sender);
        
        if (result.processed && result.shouldSync) {
          logger.info(`[Phase 46+] 📨 Received ROOT_TIP_GOSSIP: height=${message.rootTip.latestHeight}, from=${sender.substring(0, 16)}..., processing with UnifiedSyncManager`);
          
          // Use UnifiedSyncManager to process the rootTip
          const { handleRootTipUpdate } = await import("../core/unifiedSyncManager.js");
          const isMiner = isMining || clusterMining;
          
          const syncResult = await handleRootTipUpdate(
            chainContext,
            p2pNodeRef.current,
            {
              latestHeight: message.rootTip.latestHeight,
              latestHeader: message.rootTip.latestHeader,
              latestHeaderHash: message.rootTip.latestHeaderHash,
              recentHeaders: message.rootTip.recentHeaders || [],
              latestSnapshotMeta: message.rootTip.latestSnapshotMeta,
              stateCommitment: message.rootTip.stateCommitment || undefined,
            },
            isMiner
          );
          
          if (syncResult.success && syncResult.synced) {
            logger.info(`[Phase 46+] ✅ Gossip sync completed: ${syncResult.method} sync from ${syncResult.fromHeight} → ${syncResult.toHeight}`);
            setChainContext({ ...chainContext });
          }
        }
      } catch (error) {
        logger.warn(`[Phase 46+] Error processing ROOT_TIP_GOSSIP:`, error);
      }
    });

    // Phase 46: Handle ROOT_TIP_UPDATE using Unified Sync Manager
    p2p.onMessage("ROOT_TIP_UPDATE", async (payload: any, _sender: string) => {
      logger.info(`[Phase 46] 🔔 ROOT_TIP_UPDATE received from ${_sender.substring(0, 16)}...`);
      
      if (!chainContext || !p2pNodeRef.current) {
        logger.warn(`[Phase 46] Cannot process ROOT_TIP_UPDATE: chainContext=${!!chainContext}, p2pNode=${!!p2pNodeRef.current}`);
        return;
      }
      
      // Check if there's a pending rootTip from JOIN_ACK that we should process first
      if (typeof window !== "undefined" && (window as any).pendingRootTipFromJoinAck) {
        const pendingRootTip = (window as any).pendingRootTipFromJoinAck;
        delete (window as any).pendingRootTipFromJoinAck;
        logger.debug(`[Phase 46] Processing pending rootTip from JOIN_ACK`);
        // Process the pending rootTip with the same logic below
        payload = { rootTip: pendingRootTip };
      }
      
      // Handle both old format (payload.latestHeight) and new format (payload.rootTip)
      const rootTip = payload.rootTip || payload;
      const rootHeight = rootTip.latestHeight || payload.latestHeight || 0;
      const rootHeader = rootTip.latestHeader || payload.latestHeader;
      const rootHeaderHash = rootTip.latestHeaderHash || payload.latestHeaderHash;
      const recentHeaders = rootTip.recentHeaders || payload.recentHeaders;
      const snapshotMeta = rootTip.latestSnapshotMeta || payload.latestSnapshotMeta;
      
      const localTip = chainContext.storage.getTip();
      const localHeight = localTip?.header.height ?? -1;
      
      logger.info(`[Phase 46] ROOT_TIP_UPDATE data: local=${localHeight}, root=${rootHeight}, hasHeader=${!!rootHeader}, recentHeaders=${recentHeaders?.length || 0}`);
      
      // Phase 42: Update HeightSyncManager with signal root tip
      if (p2pNodeRef.current) {
        const heightSyncManager = getHeightSyncManager();
        heightSyncManager.init(chainContext, p2pNodeRef.current);
        heightSyncManager.updateSignalRootTip({
          latestHeight: rootHeight,
          latestHeaderHash: rootHeaderHash || "",
          stateCommitment: rootTip.stateCommitment || null,
          recentHeaders: recentHeaders || [],
        });
      }
      
      // Phase 37: Store rootTip info for debug overlay
      if (typeof window !== "undefined" && rootHeight > 0) {
        (window as any).lastRootTipHeight = rootHeight;
        (window as any).lastRootTipHash = rootHeaderHash || "";
        (window as any).lastBootstrapResponseTime = Date.now();
        (window as any).lastRootTipTrustLevel = rootTip.trustLevel || payload.trustLevel || 'root-only';
        (window as any).lastRootTipStateCommitment = rootTip.stateCommitment || payload.stateCommitment || null;
        if (snapshotMeta) {
          (window as any).lastRootTipSnapshotMeta = snapshotMeta;
        }
        if (recentHeaders) {
          (window as any).lastRootTipRecentHeaders = recentHeaders;
        }
      }
      
      // Phase 46: Use Unified Sync Manager
      try {
        const { handleRootTipUpdate } = await import("../core/unifiedSyncManager.js");
        const isMiner = isMining || clusterMining;
        
        logger.info(`[Phase 46] Processing ROOT_TIP_UPDATE: local=${localHeight}, root=${rootHeight}, isMiner=${isMiner}, hasHeader=${!!rootHeader}, recentHeaders=${recentHeaders?.length || 0}`);
        
        // Ensure we have valid rootTip data
        if (!rootHeight || rootHeight <= 0) {
          logger.warn(`[Phase 46] Invalid rootHeight: ${rootHeight}, skipping sync`);
          return;
        }
        
        const syncResult = await handleRootTipUpdate(
          chainContext,
          p2pNodeRef.current,
          {
            latestHeight: rootHeight,
            latestHeader: rootHeader,
            latestHeaderHash: rootHeaderHash || "",
            recentHeaders: recentHeaders || [],
            latestSnapshotMeta: snapshotMeta,
            stateCommitment: rootTip.stateCommitment || undefined,
          },
          isMiner
        );
        
        if (syncResult.success) {
          if (syncResult.synced) {
            logger.info(`[Phase 46] ✅ Unified sync completed: ${syncResult.method} sync from ${syncResult.fromHeight} → ${syncResult.toHeight}`);
            
            // Update chain context to trigger re-render
            setChainContext({ ...chainContext });
            
            // If we did a rollback (fork detected), stop mining and show message
            if (syncResult.method === "chunk" && syncResult.fromHeight < localHeight) {
              // This indicates a rollback happened
              if (isMining) {
                logger.warn(`[Phase 46] Stopping mining due to fork detection and rollback`);
                handleStopMining();
              }
              if (clusterMining) {
                logger.warn(`[Phase 46] Stopping cluster mining due to fork detection and rollback`);
                handleStopClusterMining();
              }
              
              setError(
                locale === "zh"
                  ? `⚠️ 检测到分叉链，已自动修复并同步到高度 ${syncResult.toHeight}`
                  : `⚠️ Fork detected and auto-fixed, synced to height ${syncResult.toHeight}`
              );
            }
            
            // Mark bootstrap as complete
            setBootstrapComplete(true);
          } else {
            logger.debug(`[Phase 46] Unified sync: already up to date or not applicable`);
          }
        } else {
          logger.warn(`[Phase 46] ❌ Unified sync failed: ${syncResult.error}`);
          setError(
            locale === "zh"
              ? `⚠️ 同步失败: ${syncResult.error}`
              : `⚠️ Sync failed: ${syncResult.error}`
          );
        }
      } catch (error) {
        logger.error(`[Phase 46] Error in unified sync:`, error);
        // Fallback to old bootstrap sync logic
        if (rootHeight > 0 && rootHeader && rootHeaderHash) {
          try {
            const { BootstrapSyncManager } = await import("../core/bootstrapSync.js");
            const bootstrapManager = new BootstrapSyncManager(chainContext);
            
            const bootstrapResponse = {
              requestId: `root_tip_update_${Date.now()}`,
              latestHeight: rootHeight,
              latestHeader: rootHeader,
              latestHeaderHash: rootHeaderHash,
              recentHeaders: recentHeaders,
              latestSnapshotMeta: snapshotMeta,
              timestamp: Date.now(),
            };
            
            const result = await bootstrapManager.processBootstrapResponse(bootstrapResponse);
            if (result.success) {
              setBootstrapComplete(true);
            }
          } catch (fallbackError) {
            console.error(`[Phase 46] Fallback bootstrap sync also failed:`, fallbackError);
          }
        }
      }
    });

    // Phase 37: Handle peer-connected event to execute pending block requests
    if (typeof window !== "undefined") {
      window.addEventListener("peer-connected", (event: any) => {
        const { peerCount } = event.detail || {};
        logger.debug(`[Phase 37] Peer connected event: peerCount=${peerCount}`);
        
        // Execute pending snapshot download if we have one
        const pendingSnapshot = (window as any).pendingSnapshotDownload;
        if (pendingSnapshot && peerCount > 0 && snapshotDownloader) {
          const { snapshotMeta, requestedAt } = pendingSnapshot;
          const age = Date.now() - requestedAt;
          // Only retry if request is not too old (less than 5 minutes)
          if (age < 5 * 60 * 1000) {
            logger.debug(`[Phase 37] Retrying snapshot download now that peers are connected (height: ${snapshotMeta.height}, age: ${Math.round(age / 1000)}s)`);
            setTimeout(async () => {
              try {
                snapshotDownloader.downloadSnapshot(snapshotMeta, {}, (progress) => {
                  logger.debug(`[Phase 37] Snapshot download progress: ${progress.percent.toFixed(1)}% (${progress.receivedChunks}/${progress.totalChunks} chunks)`);
                }).then(() => {
                  logger.debug(`[Phase 37] ✅ Snapshot downloaded successfully at height ${snapshotMeta.height}`);
                  // Clear pending snapshot
                  delete (window as any).pendingSnapshotDownload;
                }).catch((error) => {
                  const errorMsg = error instanceof Error ? error.message : String(error);
                  if (errorMsg.includes("No available sources")) {
                    logger.debug(`[Phase 37] ⚠️ Snapshot download still failed: no sources available. Will retry later.`);
                  } else {
                    logger.warn(`[Phase 37] ⚠️ Snapshot download failed: ${errorMsg}`);
                    // Clear pending snapshot if it's a different error (not just no sources)
                    delete (window as any).pendingSnapshotDownload;
                  }
                });
              } catch (error) {
                logger.warn(`[Phase 37] ⚠️ Error retrying snapshot download:`, error);
              }
            }, 1000);
          } else {
            logger.debug(`[Phase 37] Pending snapshot download is too old (${Math.round(age / 1000)}s), clearing it`);
            delete (window as any).pendingSnapshotDownload;
          }
        }
        
        // Execute pending bootstrap block request if we have one
        const pendingRequest = (window as any).pendingBootstrapBlockRequest;
        if (pendingRequest && peerCount > 0) {
          const { fromHeight, toHeight, requestedAt } = pendingRequest;
          const age = Date.now() - requestedAt;
          
          // Only execute if request is recent (< 5 minutes)
          if (age < 300000) {
            logger.debug(`[Phase 37] Executing pending bootstrap block request: ${fromHeight} to ${toHeight} (age: ${Math.round(age / 1000)}s)`);
            p2p.broadcast("REQUEST_BLOCKS", {
              fromHeight,
              toHeight,
            });
            delete (window as any).pendingBootstrapBlockRequest;
          } else {
            logger.debug(`[Phase 37] Pending bootstrap block request expired (age: ${Math.round(age / 1000)}s), removing`);
            delete (window as any).pendingBootstrapBlockRequest;
          }
        }
      });
    }

    // Phase 30: Handle NETWORK_HANDSHAKE
    p2p.onMessage("NETWORK_HANDSHAKE", async (payload: { networkId: string; genesisHash: string; chainParamsHash: string }, sender: string) => {
      const { getNetworkInfo } = await import("../core/networkParams.js");
      const localNetworkInfo = await getNetworkInfo(chainContext.params);
      
      // Validate peer's network parameters
      if (payload.networkId !== localNetworkInfo.networkId) {
        const peer = p2p.peers.get(sender);
        if (peer && peer.connection) {
          peer.connection.close();
          p2p.peers.delete(sender);
        }
        return;
      }
      
      if (payload.genesisHash !== localNetworkInfo.genesisHash) {
        const peer = p2p.peers.get(sender);
        if (peer && peer.connection) {
          peer.connection.close();
          p2p.peers.delete(sender);
        }
        return;
      }
      
      if (payload.chainParamsHash !== localNetworkInfo.chainParamsHash) {
        const peer = p2p.peers.get(sender);
        if (peer && peer.connection) {
          peer.connection.close();
          p2p.peers.delete(sender);
        }
        return;
      }
      
      // Network parameters match, mark peer as validated
      const peer = p2p.peers.get(sender);
      if (peer) {
        peer.networkValidated = true;
        peer.networkId = payload.networkId;
        peer.genesisHash = payload.genesisHash;
        peer.chainParamsHash = payload.chainParamsHash;
      }
      
      // Send response
      if (p2p.sendToPeer) {
        p2p.sendToPeer(sender, "NETWORK_HANDSHAKE_RESPONSE", localNetworkInfo);
      } else {
        p2p.broadcast("NETWORK_HANDSHAKE_RESPONSE", localNetworkInfo);
      }
    });

    // Phase 30: Handle NETWORK_HANDSHAKE_RESPONSE
    p2p.onMessage("NETWORK_HANDSHAKE_RESPONSE", async (payload: { networkId: string; genesisHash: string; chainParamsHash: string }, sender: string) => {
      const { getNetworkInfo } = await import("../core/networkParams.js");
      const localNetworkInfo = await getNetworkInfo(chainContext.params);
      
      // Validate response
      if (payload.networkId !== localNetworkInfo.networkId ||
          payload.genesisHash !== localNetworkInfo.genesisHash ||
          payload.chainParamsHash !== localNetworkInfo.chainParamsHash) {
        // Network parameters mismatch - disconnect peer
        const peer = p2p.peers.get(sender);
        if (peer && peer.connection) {
          peer.connection.close();
          p2p.peers.delete(sender);
        }
        return;
      }
      
      // Mark peer as validated
      const peer = p2p.peers.get(sender);
      if (peer) {
        peer.networkValidated = true;
        peer.networkId = payload.networkId;
        peer.genesisHash = payload.genesisHash;
        peer.chainParamsHash = payload.chainParamsHash;
      }
    });

    // Phase 30: Send network handshake to all peers when they connect
    const sendNetworkHandshake = async () => {
      if (!chainContext) return;
      const { getNetworkInfo } = await import("../core/networkParams.js");
      const networkInfo = await getNetworkInfo(chainContext.params);
      
      // Send handshake to all connected peers
      for (const [peerId, peer] of p2p.peers.entries()) {
        if (peer.connected && peer.dataChannel && !peer.networkValidated) {
          if (p2p.sendToPeer) {
            p2p.sendToPeer(peerId, "NETWORK_HANDSHAKE", networkInfo);
          } else {
            // Fallback to broadcast (less efficient but works)
            p2p.broadcast("NETWORK_HANDSHAKE", networkInfo);
          }
        }
      }
    };
    
    // Send handshake periodically to newly connected peers
    const handshakeInterval = setInterval(sendNetworkHandshake, 2000);
    
    // Also send immediately
    setTimeout(sendNetworkHandshake, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(autoSyncInterval);
      if (handshakeInterval) {
        clearInterval(handshakeInterval);
      }
    };
  }, [chainContext, mempool, globalSentinel]);

  // Phase 30: Check mining readiness periodically
  useEffect(() => {
    if (!chainContext || !chainContext.p2p) {
      setMiningGuardResult(null);
      return;
    }

    const checkMiningReady = async () => {
      try {
        const { MiningGuard } = await import("../core/miningGuard.js");
        const walletStore = getMultiWalletStore();
        const miningWallet = walletStore.getMiningWallet();
        const minerAddr = miningWallet ? miningWallet.address : nodeAddress;
        const result = await MiningGuard.canMineNow(
          chainContext,
          chainContext.p2p || null,
          finalityManager,
          localCoordinator.getRole(),
          minerAddr,
          bootstrapComplete // Phase 32: Pass bootstrap status
        );
        setMiningGuardResult(result);
        
        // Don't set error state for mining guard results - these are informational
        // Only set error if user explicitly tries to mine and guard blocks it
        // The mining guard result is used to disable/enable mining buttons, not to show errors
      } catch (e) {
        // Failed to check mining readiness - silently ignore
      }
    };

    // Only check if P2P is connected and we have a chain context
    if (isP2PConnected) {
      checkMiningReady();
      const interval = setInterval(checkMiningReady, 5000);
      return () => clearInterval(interval);
    }
  }, [chainContext, chainContext?.p2p, finalityManager, localCoordinator, nodeAddress, isP2PConnected, bootstrapComplete]);

  // Phase 30: Update mining effectiveness stats periodically
  useEffect(() => {
    const updateStats = async () => {
      try {
        const { getMiningStatsTracker } = await import("../core/miningStats.js");
        const statsTracker = getMiningStatsTracker();
        const stats = statsTracker.getStats();
        setMiningEffectiveness(stats);
      } catch (e) {
        // Stats tracker not available, ignore
      }
    };

    updateStats();
    const interval = setInterval(updateStats, 2000);
    return () => clearInterval(interval);
  }, [isMining, clusterMining]);

  // Connect to P2P network
  const handleConnectP2P = async () => {
    if (!chainContext) {
      setError("Chain context not ready. Please wait...");
      return;
    }

    try {
      setError("");
      // Save bootstrap URL when connecting (state will be saved by useEffect)
      const nodeId = getOrCreateBrowserNodeId();
      const p2pNode = new BrowserP2PNode(nodeId);
      p2pNodeRef.current = p2pNode;

      // Phase 45: Use multiple signal servers from chainParams if available
      const params = await getDefaultChainParams();
      let signalServersToUse: string[] = [];
      
      if (params.signalServers && params.signalServers.length > 0) {
        // Use signal servers from chainParams
        signalServersToUse = params.signalServers;
        logger.debug(`[Phase 45] Using ${signalServersToUse.length} signal server(s) from chainParams`);
      } else {
        // Fallback to single URL
        const urlToUse = bootstrapUrl || DEFAULT_MAINNET_SIGNALING;
        if (!urlToUse) {
          setError("Please enter a bootstrap server URL (e.g., ws://localhost:8080)");
          return;
        }
        signalServersToUse = [urlToUse];
        
        // Update bootstrapUrl if using default
        if (!bootstrapUrl) {
          setBootstrapUrl(urlToUse);
        }
      }

      // Phase 40: Setup connection manager for auto-reconnect
      await import("../core/connectionManager.js");
      const primaryUrl = signalServersToUse[0];
      p2pNode.setupConnectionManager({
        bootstrapUrl: primaryUrl,
        reconnectInterval: 1500,
        maxReconnectAttempts: -1, // Infinite
        heartbeatInterval: 10000, // 10 seconds
        heartbeatTimeout: 30000, // 30 seconds
        enableSessionPersistence: true,
      });

      // Phase 45: Connect using multiple signal servers
      logger.info(`[P2P] 🔌 Connecting to ${signalServersToUse.length} signal server(s): ${signalServersToUse.join(", ")}`);
      if (signalServersToUse.length > 1) {
        await p2pNode.connect(signalServersToUse);
      } else {
        await p2pNode.connect(signalServersToUse[0]);
      }
      logger.info(`[P2P] ✅ Connected to signal server, requesting peers...`);
      p2pNode.requestPeers();

      // Phase 45: Initialize Shadow Node with multiple URLs for mobile persistence
      try {
        // Phase 45: Use multiple shadow node URLs from chainParams if available
        let shadowNodeUrls: string[] = [];
        
        if (params.shadowNodeUrls && params.shadowNodeUrls.length > 0) {
          shadowNodeUrls = params.shadowNodeUrls;
          logger.debug(`[Phase 45] Using ${shadowNodeUrls.length} shadow node URL(s) from chainParams`);
        } else {
          // Fallback: derive from signal servers
          shadowNodeUrls = signalServersToUse.map(url => 
            url.replace("ws://", "http://").replace("wss://", "https://")
          );
        }
        
        // Phase 45: Try multiple shadow nodes
        let shadowNodeInitialized = false;
        for (const shadowNodeUrl of shadowNodeUrls) {
          try {
            const shadowNode = new ShadowNodeClient({
              shadowNodeUrl: shadowNodeUrl,
              nodeId: nodeId,
              autoReconnect: true,
              reconnectInterval: 5000,
            });
            
            shadowNodeRef.current = shadowNode;
            
            // Initialize shadow session
            const initialized = await shadowNode.initialize();
            if (initialized) {
              logger.debug(`[Phase 45] Shadow node initialized successfully with ${shadowNodeUrl}`);
              shadowNodeInitialized = true;
              
              // Listen for state updates
              shadowNode.onStateUpdate((state) => {
                setShadowNodeState(state);
                logger.debug(`[ShadowNode] State updated: height=${state.latestHeight}`);
                
                // Phase 42: Update HeightSyncManager with shadow state
                if (chainContext && p2pNodeRef.current) {
                  const heightSyncManager = getHeightSyncManager();
                  heightSyncManager.init(chainContext, p2pNodeRef.current);
                  heightSyncManager.updateShadowState({
                    height: state.latestHeight,
                    tipHash: state.latestHeaderHash,
                    stateCommitment: state.stateCommitment,
                  });
                }
              });
              
              // Phase 42: Listen for active miner changes
              shadowNode.onActiveMinerChange((activeMinerId) => {
                if (activeMinerId && shadowNode.getSessionId()) {
                  const sessionId = shadowNode.getSessionId();
                  const nodeId = p2pNodeRef.current?.nodeId || "";
                  const minerId = sessionId ? `${sessionId}-${nodeId}` : nodeId;
                  
                  if (activeMinerId !== minerId && isMining) {
                    // Another device took over - stop mining
                    logger.warn("[ActiveMiner] Another device took over mining, stopping...");
                    handleStopMining();
                  }
                }
              });
              
              // Listen for connection changes
              shadowNode.onConnectionChange((connected) => {
                setShadowNodeConnected(connected);
                logger.info(`[ShadowNode] Connection status: ${connected ? 'connected' : 'disconnected'}`);
              });
              
              // Successfully initialized, break out of loop
              break;
            }
          } catch (error) {
            logger.warn(`[Phase 45] Failed to initialize shadow node with ${shadowNodeUrl}:`, error);
            // Continue to next shadow node URL
          }
        }
        
        if (!shadowNodeInitialized) {
          logger.warn("[Phase 45] Failed to initialize any shadow node (non-critical)");
        }
      } catch (error) {
        logger.warn("[ShadowNode] Shadow node initialization error (non-critical):", error);
        // Shadow Node is optional, don't fail P2P connection if it fails
      }

      // Phase 19: Initialize delegator and worker node managers
      if (delegatorManager) {
        delegatorManager.initialize(p2pNode);
      }
      workerNodeManager.initialize(p2pNode);
      
      // Phase 21: Initialize peer reputation manager
      if (chainContext?.params?.peerScoreEnabled) {
        const { getGlobalPeerReputationManager } = await import("../core/peerReputation.js");
        const reputationManager = getGlobalPeerReputationManager(chainContext.params);
        
        // Track existing peers
        for (const peer of p2pNode.peers.values()) {
          if (peer.connected) {
            reputationManager.onPeerConnected(peer.id);
          }
        }
        
        // Setup periodic tick for score decay and UI updates
        if (chainContext.params.peerScoreDecayIntervalMs) {
          const tickInterval = setInterval(() => {
            reputationManager.tick();
            // Update UI with current scores
            const scores = reputationManager.getAllScores();
            setPeerScores(scores.map(ps => ({
              peerId: ps.peerId,
              score: ps.score,
              trustLevel: ps.trustLevel,
              blocksServed: ps.blocksServed,
              blocksInvalid: ps.blocksInvalid,
              snapshotsServed: ps.snapshotsServed,
              snapshotsInvalid: ps.snapshotsInvalid,
              headersServed: ps.headersServed,
              avgLatencyMs: ps.avgLatencyMs,
              workCompleted: ps.workCompleted,
              workFailed: ps.workFailed,
              lastSeenAt: ps.lastSeenAt,
            })));
          }, chainContext.params.peerScoreDecayIntervalMs);
          // Store interval for cleanup
          (p2pNode as any).peerReputationTickInterval = tickInterval;
          
          // Cleanup function for peer reputation tick
          const cleanupPeerReputation = () => {
            if ((p2pNode as any).peerReputationTickInterval) {
              clearInterval((p2pNode as any).peerReputationTickInterval);
              (p2pNode as any).peerReputationTickInterval = null;
            }
          };
          
          // Store cleanup function
          if (!(p2pNode as any).cleanupFunctions) {
            (p2pNode as any).cleanupFunctions = [];
          }
          (p2pNode as any).cleanupFunctions.push(cleanupPeerReputation);
          
          // Initial update
          const scores = reputationManager.getAllScores();
          setPeerScores(scores.map(ps => ({
            peerId: ps.peerId,
            score: ps.score,
            trustLevel: ps.trustLevel,
            blocksServed: ps.blocksServed,
            blocksInvalid: ps.blocksInvalid,
            snapshotsServed: ps.snapshotsServed,
            snapshotsInvalid: ps.snapshotsInvalid,
            headersServed: ps.headersServed,
            avgLatencyMs: ps.avgLatencyMs,
            workCompleted: ps.workCompleted,
            workFailed: ps.workFailed,
            lastSeenAt: ps.lastSeenAt,
          })));
        }
      }
      
      // Phase 20: Initialize snapshot downloader and seeder
      snapshotDownloader.initialize(p2pNode, chainContext?.params);
      snapshotSeeder.initialize(p2pNode);
      
      // Phase 22: Initialize finality manager
      if (finalityManager && chainContext?.params?.finalityEnabled) {
        await finalityManager.initialize(p2pNode);
        // Expose to window for sync.ts to access
        (window as any).finalityManager = finalityManager;
        
        // Setup finalized block callback
        finalityManager.onFinalized((blockHash: string) => {
          setFinalizedBlocks((prev) => new Set([...prev, blockHash]));
          logger.debug(`[Phase 22] Block ${blockHash.substring(0, 16)}... finalized with certificate`);
        });
        
        // Update stats periodically
        const updateFinalityStats = () => {
          if (finalityManager) {
            setFinalityStats(finalityManager.getStats());
          }
        };
        const finalityStatsInterval = setInterval(updateFinalityStats, 2000);
        updateFinalityStats();
        
        // Store interval for cleanup
        (p2pNode as any).finalityStatsInterval = finalityStatsInterval;
        
        // Cleanup function for finality stats
        const cleanupFinality = () => {
          if ((p2pNode as any).finalityStatsInterval) {
            clearInterval((p2pNode as any).finalityStatsInterval);
            (p2pNode as any).finalityStatsInterval = null;
          }
        };
        
        // Store cleanup function
        if (!(p2pNode as any).cleanupFunctions) {
          (p2pNode as any).cleanupFunctions = [];
        }
        (p2pNode as any).cleanupFunctions.push(cleanupFinality);
      }
      
      // Setup delegator change handler
      if (delegatorManager) {
        let delegatorStatsInterval: ReturnType<typeof setInterval> | null = null;
        delegatorManager.onDelegatorChange((_isDelegator) => {
          // Removed: setIsDelegator, setDelegatorStats (moved to advanced settings)
          // Clear previous interval if exists
          if (delegatorStatsInterval) {
            clearInterval(delegatorStatsInterval);
            delegatorStatsInterval = null;
          }
          // Removed: delegator stats update (moved to advanced settings)
        });
        // Store interval for cleanup
        (p2pNode as any).delegatorStatsInterval = delegatorStatsInterval;
        
        // Cleanup function for delegator stats
        const cleanupDelegator = () => {
          if ((p2pNode as any).delegatorStatsInterval) {
            clearInterval((p2pNode as any).delegatorStatsInterval);
            (p2pNode as any).delegatorStatsInterval = null;
          }
        };
        
        // Store cleanup function
        if (!(p2pNode as any).cleanupFunctions) {
          (p2pNode as any).cleanupFunctions = [];
        }
        (p2pNode as any).cleanupFunctions.push(cleanupDelegator);
      }
      
      // Update chain context with P2P node
      if (chainContext) {
        const updatedContext: ChainContext = {
          storage: chainContext.storage,
          indexState: chainContext.indexState,
          params: chainContext.params,
          p2p: p2pNode,
          remoteSnapshotUsed: chainContext.remoteSnapshotUsed,
        };
        setChainContext(updatedContext);
        
        // Phase 30: Initialize Global Consistency Sentinel
        if (chainContext.params.globalSentinelEnabled !== false) {
          const sentinel = new GlobalStateSentinel(updatedContext, chainContext.params);
          sentinel.setOnAssessmentUpdate((assessment) => {
            setDriftAssessment(assessment);
            
            // Auto-stop mining if critical drift detected
            if (assessment.healthLevel === "CRITICAL_DRIFT" && assessment.forkSuspected) {
              if (isMining) {
                handleStopMining();
              }
              if (clusterMining) {
                handleStopClusterMining();
              }
              if (autoMining) {
                setAutoMining(false);
              }
            }
          });
          sentinel.start();
          setGlobalSentinel(sentinel);
          logger.debug("[GlobalSentinel] Initialized and started");
        }

        // Phase 31: Initialize Mainnet Stability components
        // 1. Long-range Divergence Detector
        const { LongRangeDetector } = await import("../core/longRangeDetector.js");
        const detector = new LongRangeDetector(updatedContext, p2pNode);
        detector.setOnDivergenceDetected(async (result) => {
          console.error("[Phase 31] Long-range divergence detected:", result);
          // Auto-repair: download snapshot from checkpoint height
          try {
            // Try to download snapshot at checkpoint height via GSN
            const { loadAllSnapshotMeta } = await import("../core/snapshot.js");
            const allMetas = loadAllSnapshotMeta();
            // Find snapshot closest to majority height
            const closestMeta = allMetas
              .filter(m => m.height <= result.majorityHeight)
              .sort((a, b) => b.height - a.height)[0];
            
            if (closestMeta) {
              logger.debug(`[Phase 31] Found snapshot at height ${closestMeta.height} for repair`);
              setError(locale === "zh" 
                ? `⚠️ 检测到长程分叉，建议重置链并同步到高度 ${result.majorityHeight}（快照高度：${closestMeta.height}）` 
                : `⚠️ Long-range fork detected, recommend resetting chain and syncing to height ${result.majorityHeight} (snapshot at ${closestMeta.height})`);
            } else {
              setError(locale === "zh" 
                ? `⚠️ 检测到长程分叉，建议重置链并同步到高度 ${result.majorityHeight}` 
                : `⚠️ Long-range fork detected, recommend resetting chain and syncing to height ${result.majorityHeight}`);
            }
          } catch (e) {
            console.error("[Phase 31] Failed to repair divergence:", e);
            setError(locale === "zh" 
              ? `⚠️ 检测到长程分叉，建议重置链并同步到高度 ${result.majorityHeight}` 
              : `⚠️ Long-range fork detected, recommend resetting chain and syncing to height ${result.majorityHeight}`);
          }
        });
        detector.start();
        setLongRangeDetector(detector);
        if (typeof window !== "undefined") {
          (window as any).longRangeDetector = detector;
        }

        // 2. Height Consensus Manager
        const { HeightConsensusManager } = await import("../core/heightConsensus.js");
        const consensus = new HeightConsensusManager(updatedContext, p2pNode);
        consensus.setOnConsensusAction(async (result) => {
          if (result.action === "SYNC") {
            logger.debug("[Phase 31] Height consensus: forcing sync");
            // Request blocks to sync
            if (p2pNode.broadcast) {
              const localTip = updatedContext.storage.getTip();
              if (localTip) {
                p2pNode.broadcast("REQUEST_BLOCKS", {
                  fromHeight: localTip.header.height + 1,
                  toHeight: result.majorityHeight,
                });
              }
            }
          } else if (result.action === "STOP_MINING") {
            if (isMining) handleStopMining();
            if (clusterMining) handleStopClusterMining();
            if (autoMining) setAutoMining(false);
            setError(t("forkDetection.forkDetected"));
          }
        });
        consensus.start();
        setHeightConsensus(consensus);
        if (typeof window !== "undefined") {
          (window as any).heightConsensus = consensus;
        }

        // 3. Anti-Invalid-Mining
        const { AntiInvalidMining } = await import("../core/antiInvalidMining.js");
        const antiInvalid = new AntiInvalidMining(updatedContext);
        setAntiInvalidMining(antiInvalid);

        // 4. Checkpoint Lock
        const { CheckpointLock } = await import("../core/checkpointLock.js");
        const lock = new CheckpointLock(updatedContext);
        await lock.initializeFromChain();
        setCheckpointLock(lock);

        // 5. Signal Reconciliation
        const { SignalReconciliation } = await import("../core/signalReconciliation.js");
        const reconciliation = new SignalReconciliation(updatedContext, p2pNode, bootstrapUrl);
        reconciliation.start();
        setSignalReconciliation(reconciliation);
      }
      
      // Phase 20: Update GSN stats periodically
      const updateGsnStats = () => {
        if (!chainContext || !isP2PConnected) return;
        const downloaderStats = snapshotDownloader.getRankerStats();
        const seederStats = snapshotSeeder.getCacheStats();
        setGsnStats({
          downloader: {
            totalSources: downloaderStats.totalSources,
            averageLatency: downloaderStats.averageLatency,
            averageIntegrity: downloaderStats.averageIntegrity,
            averageTrust: downloaderStats.averageTrust,
          },
          seeder: {
            cachedCount: seederStats.cachedCount,
            totalSize: seederStats.totalSize,
          },
        });
      };
      const gsnStatsInterval = setInterval(updateGsnStats, 3000);
      updateGsnStats();
      
      // Store interval for cleanup
      (p2pNode as any).gsnStatsInterval = gsnStatsInterval;
      
      // Cleanup function for GSN stats
      const cleanupGsn = () => {
        if ((p2pNode as any).gsnStatsInterval) {
          clearInterval((p2pNode as any).gsnStatsInterval);
          (p2pNode as any).gsnStatsInterval = null;
        }
      };
      
      // Store cleanup function
      if (!(p2pNode as any).cleanupFunctions) {
        (p2pNode as any).cleanupFunctions = [];
      }
      (p2pNode as any).cleanupFunctions.push(cleanupGsn);
      
      setIsP2PConnected(true);
      setError(""); // Clear any previous errors
      
      // Phase 32: Immediately request bootstrap data from signal server
      if (chainContext) {
        const localTip = chainContext.storage.getTip();
        const localHeight = localTip?.header.height ?? -1;
        const peerCount = p2pNode.getPeerCount();
        
        logger.debug(`[Phase 32] Connected to P2P network. Local height: ${localHeight}, Connected peers: ${peerCount}`);
        
        // Phase 32: Request bootstrap data from signal server
        logger.debug(`[Phase 32] Requesting bootstrap data from signal server...`);
        const requestId = `${Date.now()}_${Math.random()}`;
        
        // Check if sendToSignalServer method exists
        if (typeof (p2pNode as any).sendToSignalServer === 'function') {
          logger.debug(`[Phase 32] Sending REQUEST_BOOTSTRAP via sendToSignalServer`);
          (p2pNode as any).sendToSignalServer("REQUEST_BOOTSTRAP", {
            requestId,
            wantSnapshotMeta: true,
            wantHeaders: true,
            headerCount: 200,
          });
        } else {
          // Fallback: try to send via WebSocket directly
          if ((p2pNode as any).ws && (p2pNode as any).ws.readyState === WebSocket.OPEN) {
            (p2pNode as any).ws.send(JSON.stringify({
              type: "REQUEST_BOOTSTRAP",
              requestId,
              wantSnapshotMeta: true,
              wantHeaders: true,
              headerCount: 200,
            }));
            logger.debug(`[Phase 32] Sent REQUEST_BOOTSTRAP via WebSocket directly`);
          } else {
            console.error(`[Phase 32] Cannot send REQUEST_BOOTSTRAP: WebSocket not available or not open`);
          }
        }
        
        // Also query network height using GLOBAL_VIEW_REQUEST (fallback)
        // This will work once we have peer connections
        // Removed debug log: [Sync] Querying network height
        if (peerCount > 0) {
          p2pNode.broadcast("GLOBAL_VIEW_REQUEST", {});
        } else {
          // If no peers yet, set up a periodic query
          // Removed debug log: [Sync] No peers yet
          // The GLOBAL_VIEW_REQUEST will be sent automatically once peers connect
        }
        
        // Also request blocks immediately (will be refined once we know network height)
        // Request a larger range for initial sync (height 14 is still very low)
        // But only if we have peers
        if (peerCount > 0) {
          const requestRange = 500; // Increased for better initial sync
          logger.debug(`[Sync] Requesting blocks from height ${localHeight + 1} to ${localHeight + requestRange} (${requestRange} blocks)`);
          p2pNode.broadcast("REQUEST_BLOCKS", {
            fromHeight: localHeight + 1,
            toHeight: localHeight + requestRange,
          });
          // Also try direct peer requests for better reliability
          if (p2pNode.sendToPeer) {
            const peerIds = Array.from(p2pNode.peers.keys());
            for (const peerId of peerIds) {
              const peer = p2pNode.peers.get(peerId);
              if (peer && peer.connected && peer.dataChannel && peer.dataChannel.readyState === 'open') {
                logger.debug(`[Sync] Direct request to peer ${peerId.substring(0, 16)}...`);
                p2pNode.sendToPeer(peerId, "REQUEST_BLOCKS", {
                  fromHeight: localHeight + 1,
                  toHeight: localHeight + requestRange,
                });
              }
            }
          }
        } else {
          logger.warn(`[Sync] No peers connected yet. Waiting for peer connections...`);
        }
        
        // Also request peers to get more connections
        p2pNode.requestPeers();
        
        // Log peer IDs for debugging
        if (peerCount > 0) {
          // Removed debug log: [Sync] Connected peer IDs
        } else {
          logger.warn(`[Sync] No peers connected yet. Waiting for peer connections...`);
        }
        
        // Phase 32: Listen for peer connection events to execute pending block requests
        const handlePeerConnected = (event: CustomEvent) => {
          const { peerId, peerCount: newPeerCount } = event.detail;
          logger.debug(`[Phase 32] Peer connected: ${peerId.substring(0, 16)}... (total: ${newPeerCount})`);
          
          // Get current local height
          const localTip = chainContext.storage.getTip();
          const localHeight = localTip?.header.height ?? -1;
          
          // Execute pending block request if we have one
          if (typeof window !== "undefined" && (window as any).pendingBlockRequest) {
            const pending = (window as any).pendingBlockRequest;
            logger.debug(`[Phase 32] Executing pending block request now that peer is connected: ${pending.fromHeight}-${pending.toHeight}`);
            p2pNode.broadcast("REQUEST_BLOCKS", pending);
            delete (window as any).pendingBlockRequest;
          }
          
          // Immediately query network height from the new peer
          if (newPeerCount > 0) {
            logger.debug(`[Phase 32] Querying network height from ${newPeerCount} peer(s)...`);
            p2pNode.broadcast("GLOBAL_VIEW_REQUEST", {});
            
            // If local height is 0 or very low, immediately request blocks
            // This ensures new nodes sync quickly
            if (localHeight <= 0) {
              logger.info(`[Phase 32] Local height is ${localHeight}, immediately requesting blocks from height 1 to 500`);
              p2pNode.broadcast("REQUEST_BLOCKS", {
                fromHeight: 1,
                toHeight: 500, // Request first 500 blocks
              });
              // Also try direct peer requests
              if (p2pNode.sendToPeer) {
                const peerIds = Array.from(p2pNode.peers.keys());
                for (const peerId of peerIds) {
                  const peer = p2pNode.peers.get(peerId);
                  if (peer && peer.connected && peer.dataChannel && peer.dataChannel.readyState === 'open') {
                    p2pNode.sendToPeer(peerId, "REQUEST_BLOCKS", {
                      fromHeight: 1,
                      toHeight: 500,
                    });
                  }
                }
              }
            } else if (localHeight < 100) {
              // If height is low, also request aggressively
              logger.debug(`[Phase 32] Local height is low (${localHeight}), requesting blocks aggressively`);
              p2pNode.broadcast("REQUEST_BLOCKS", {
                fromHeight: localHeight + 1,
                toHeight: localHeight + 500,
              });
            }
          }
        };
        
        // Add event listener for peer connections
        if (typeof window !== "undefined") {
          window.addEventListener('peer-connected', handlePeerConnected as EventListener);
          
          // Store cleanup function
          if (!(p2pNode as any).cleanupFunctions) {
            (p2pNode as any).cleanupFunctions = [];
          }
          (p2pNode as any).cleanupFunctions.push(() => {
            window.removeEventListener('peer-connected', handlePeerConnected as EventListener);
          });
        }
        
        // Phase 32: Add periodic sync check for nodes with height 0
        // This ensures that if initial sync fails, we retry periodically
        const syncCheckInterval = setInterval(() => {
          if (!p2pNodeRef.current) {
            clearInterval(syncCheckInterval);
            return;
          }
          
          const localTip = chainContext.storage.getTip();
          const localHeight = localTip?.header.height ?? -1;
          const peerCount = p2pNode.getPeerCount();
          
          // If we have peers but height is still 0, retry sync
          if (peerCount > 0 && localHeight <= 0) {
            logger.debug(`[Phase 32] Periodic sync check: height=${localHeight}, peers=${peerCount}, retrying sync...`);
            p2pNode.broadcast("GLOBAL_VIEW_REQUEST", {});
            p2pNode.broadcast("REQUEST_BLOCKS", {
              fromHeight: 1,
              toHeight: 500,
            });
          }
        }, 5000); // Check every 5 seconds
        
        // Store interval for cleanup
        if (!(p2pNode as any).cleanupFunctions) {
          (p2pNode as any).cleanupFunctions = [];
        }
        (p2pNode as any).cleanupFunctions.push(() => {
          clearInterval(syncCheckInterval);
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to connect to P2P network";
      setError(errorMessage);
      setIsP2PConnected(false);
      
      // Clean up on error
      if (p2pNodeRef.current) {
        const p2pNode = p2pNodeRef.current as any;
        // Run all cleanup functions
        if (p2pNode.cleanupFunctions) {
          p2pNode.cleanupFunctions.forEach((cleanup: () => void) => cleanup());
          p2pNode.cleanupFunctions = [];
        }
        // Also clear intervals directly (backup)
        if (p2pNode.finalityStatsInterval) {
          clearInterval(p2pNode.finalityStatsInterval);
        }
        if (p2pNode.peerReputationTickInterval) {
          clearInterval(p2pNode.peerReputationTickInterval);
        }
        if (p2pNode.gsnStatsInterval) {
          clearInterval(p2pNode.gsnStatsInterval);
        }
        if (p2pNode.delegatorStatsInterval) {
          clearInterval(p2pNode.delegatorStatsInterval);
        }
        p2pNodeRef.current.disconnect();
        p2pNodeRef.current = null;
      }
    }
  };

  // Disconnect from P2P network
  const handleDisconnectP2P = () => {
    // Clean up all intervals stored on P2P node
    if (p2pNodeRef.current) {
      const p2pNode = p2pNodeRef.current as any;
      // Run all cleanup functions
      if (p2pNode.cleanupFunctions) {
        p2pNode.cleanupFunctions.forEach((cleanup: () => void) => cleanup());
        p2pNode.cleanupFunctions = [];
      }
      // Also clear intervals directly (backup)
      if (p2pNode.finalityStatsInterval) {
        clearInterval(p2pNode.finalityStatsInterval);
        p2pNode.finalityStatsInterval = null;
      }
      if (p2pNode.peerReputationTickInterval) {
        clearInterval(p2pNode.peerReputationTickInterval);
        p2pNode.peerReputationTickInterval = null;
      }
      if (p2pNode.gsnStatsInterval) {
        clearInterval(p2pNode.gsnStatsInterval);
        p2pNode.gsnStatsInterval = null;
      }
      if (p2pNode.delegatorStatsInterval) {
        clearInterval(p2pNode.delegatorStatsInterval);
        p2pNode.delegatorStatsInterval = null;
      }
    }
    
    if (p2pNodeRef.current) {
      p2pNodeRef.current.disconnect();
      p2pNodeRef.current = null;
      if (chainContext) {
        const updatedContext = { ...chainContext, p2p: undefined };
        setChainContext(updatedContext);
      }
      setIsP2PConnected(false);
      setPeerCount(0);
    }
  };

  // Create and submit transaction
  const handleCreateTx = async () => {
    if (!chainContext) return;
    if (!txNamespace || !txKey) {
      setError("Namespace and key are required");
      return;
    }

    try {
      setError("");
      setIsSigning(true);

      // Phase 5: Get node address for operation owner
      const address = await getOrCreateNodeAddress();
      setNodeAddress(address); // Update displayed address

      const op: Operation = {
        type: txOpType,
        namespace: txNamespace,
        key: txKey,
        value: txOpType !== "DELETE" ? txValue : undefined,
        nonce: Date.now(),
        owner: address, // Use address as owner
      };

      // Phase 5: createTx now automatically signs the transaction
      const tx = await createTx([op]);
      
      // Add to mempool (now async with signature verification)
      const added = await mempool.addTx(tx);
      if (!added) {
        setError("Failed to add transaction to mempool (may be duplicate or invalid)");
        setIsSigning(false);
        return;
      }

      // Broadcast to P2P network
      broadcastTransaction(tx, chainContext);

      // Clear form
      setTxKey("");
      setTxValue("");

      // Force re-render
      setChainContext({ ...chainContext });
      setIsSigning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create transaction");
      setIsSigning(false);
    }
  };

  // Phase 18: Start cluster mining
  // Phase 27: Check if this instance can mine (must be LEADER)
  // Phase 30: Add mining guard checks
  // Phase 38: Check onboarding before starting
  const handleStartClusterMining = async () => {
    if (!chainContext) return;
    
    // Phase 38: Check onboarding for first-time users
    // Phase 39: Use ref to check immediately (avoids async state update issue)
    if (!onboardingCompletedRef.current && !isMining && !clusterMining) {
      setShowOnboarding(true);
      return;
    }
    
    // Prevent multiple simultaneous starts
    if (isClusterRestartingRef.current && clusterMining) {
      return;
    }
    
    // Phase 27: Only LEADER can mine
    if (!localCoordinator.canMine()) {
      const leaderId = leaderInfo?.instanceId || "unknown";
      setError(
        locale === "zh"
          ? `⚠️ 本机已有一个挖矿实例：${leaderId}，当前实例为只读模式。如需在本实例挖矿，请先在其他实例中关闭挖矿或关闭页面。`
          : `⚠️ This machine already has a mining instance: ${leaderId}. Current instance is read-only. To mine on this instance, please stop mining on other instances or close their pages.`
      );
      return;
    }
    
    // Phase 42: Register referral if pending invite address exists
    const walletStore = getMultiWalletStore();
    const miningWallet = walletStore.getMiningWallet();
    const minerAddr = miningWallet ? miningWallet.address : await getOrCreateNodeAddress();
    
    if (pendingInviteAddress && minerAddr) {
      try {
        const { getReferralSystem } = await import("../core/referralSystem.js");
        const { getOrCreateDeviceId } = await import("../core/ipSharingWeight.js");
        const referralSystem = getReferralSystem();
        const deviceId = getOrCreateDeviceId();
        
        // Get IP hash (simplified - in production would get from Shadow Node)
        const ipHash = null; // Will be set by Shadow Node
        
        const registered = referralSystem.registerReferral(
          pendingInviteAddress as any,
          minerAddr as any,
          deviceId,
          ipHash || undefined
        );
        
        if (registered) {
          // Removed debug log: [App] Referral registered
          setCurrentReferrerAddress(pendingInviteAddress);
          setPendingInviteAddress(null); // Clear pending
          
          // Save to localStorage
          localStorage.setItem("indexerchain_referrer_address", pendingInviteAddress);
          
          // Show success message
          setSuccessMessage(
            locale === "zh"
              ? `✅ 已绑定邀请地址: ${pendingInviteAddress.substring(0, 16)}...`
              : `✅ Referral address bound: ${pendingInviteAddress.substring(0, 16)}...`
          );
          setTimeout(() => setSuccessMessage(""), 5000);
        }
      } catch (error) {
        console.error("[App] Failed to register referral:", error);
        // Don't block mining if referral registration fails
      }
    }
    
    // Phase 30: Mining guard check
    const { MiningGuard } = await import("../core/miningGuard.js");
    
    const guardResult = await MiningGuard.canMineNow(
      chainContext,
      chainContext.p2p || null,
      finalityManager,
      localCoordinator.getRole(),
      minerAddr,
      bootstrapComplete // Phase 32: Pass bootstrap status
    );
    
    if (!guardResult.ok) {
      const { MiningGuard: Guard } = await import("../core/miningGuard.js");
      const message = Guard.getStatusMessage(guardResult, locale);
      
      // Don't show error for NOT_SYNCED if we're at height 0 (new chain) or bootstrap is not complete
      // These are normal states during initial sync, not errors
      const localTip = chainContext.storage.getTip();
      if (guardResult.code === "NOT_SYNCED" && (localTip?.header.height === 0 || !bootstrapComplete)) {
        // Don't set error - this is informational, not an error
        // The mining button will be disabled based on miningGuardResult
        return;
      }
      
      setError(message);
      return;
    }

    const pendingTxs = mempool.getAll();

    try {
      const prevBlock = chainContext.storage.getTip();
      if (!prevBlock) {
        setError("No previous block found");
        return;
      }

      // Phase 24: Get miner address from mining wallet
      const walletStore = getMultiWalletStore();
      const miningWallet = walletStore.getMiningWallet();
      const minerAddr = miningWallet ? miningWallet.address : await getOrCreateNodeAddress();
      const allBlocks = chainContext.storage.getAllBlocks();
      const candidateBlock = await buildCandidateBlock(
        pendingTxs,
        prevBlock,
        allBlocks,
        chainContext.params,
        minerAddr as any,
        chainContext.indexState
      );

      setClusterMining(true);
      setError("");
      
      // Reset restart flag when successfully starting
      isClusterRestartingRef.current = false;

      // Set up cluster event handlers
      minerCluster.onProgress((stats) => {
        setClusterStats({
          totalWorkers: stats.totalWorkers,
          activeWorkers: stats.activeWorkers,
          totalHashesTried: stats.totalHashesTried,
          totalHashRate: stats.totalHashRate,
          workers: stats.workers.map((w) => ({
            workerId: w.workerId,
            hashesTried: w.hashesTried,
            hashRate: w.hashRate,
            currentNonceStart: w.currentNonceStart,
            currentNonceEnd: w.currentNonceEnd,
            status: w.status as "running" | "stopped" | "exhausted" | "error", // Phase 37-E: Include error status
          })),
        });
      });

      minerCluster.onFound(async (block) => {
        // Block found by worker
        
        // Re-fetch prevBlock to ensure we have the latest tip (may have changed during mining)
        const currentTip = chainContext.storage.getTip();
        
        let shouldRestart = false;
        let blockAppended = false;
        
        // Check if block is still valid (tip may have advanced)
        if (currentTip && currentTip.header.height >= block.header.height) {
          // Block is stale - don't restart immediately, let tip change detection handle it
          // This prevents infinite restart loops when multiple workers find stale blocks
        } else {
          // Verify and append block
          const allBlocksForVerify = chainContext.storage.getAllBlocks();
          const verification = await verifyBlock(
            block,
            currentTip,
            allBlocksForVerify,
            chainContext.params
          );

          if (verification.valid) {
            const result = await appendMinedBlock(block, chainContext);
            if (result.success) {
              // Block successfully appended
              blockAppended = true;
              shouldRestart = true; // Only restart if block was successfully appended
              
              // Remove transactions from mempool
              const txIds = block.txs.map((tx) => tx.txId);
              mempool.removeTxs(txIds);

              // Update context (use functional update to avoid unnecessary re-renders)
              setChainContext((prev) => prev ? { ...prev } : prev);
              setError("");
            } else {
              // Don't show error for stale blocks (race condition is normal)
              if (!result.error?.includes("stale")) {
                setError(result.error || "Failed to append block");
              }
              // If block is stale, don't restart - tip change detection will handle it
            }
          } else {
            setError(verification.error || "Block verification failed");
          }
        }

        setClusterMining(false);

        // Auto-restart cluster mining only if block was successfully appended
        // For stale blocks, let tip change detection handle the restart (prevents infinite loops)
        if (shouldRestart && blockAppended && chainContext && !isClusterRestartingRef.current) {
          // Clear any pending restart timeout
          if (clusterRestartTimeoutRef.current) {
            clearTimeout(clusterRestartTimeoutRef.current);
            clusterRestartTimeoutRef.current = null;
          }
          
          isClusterRestartingRef.current = true;
          clusterRestartTimeoutRef.current = window.setTimeout(() => {
            // Use functional update to get latest clusterMining state
            setClusterMining((current) => {
              if (!current && !isClusterRestartingRef.current) {
                // Only restart if not already mining and not already restarting
                handleStartClusterMining();
              }
              // Reset restart flag after a delay
              setTimeout(() => {
                isClusterRestartingRef.current = false;
              }, 2000);
              return current;
            });
            clusterRestartTimeoutRef.current = null;
          }, 1500); // Increased delay to prevent rapid restarts
        }
      });

      minerCluster.onStopped((reason) => {
        if (reason === "found") {
          // Already handled in onFound (which will auto-restart)
          return;
        }
        setClusterMining(false);
        if (reason === "error") {
          setError("Cluster mining error occurred");
          // Don't auto-restart on error - user should investigate
        } else if (reason === "user") {
          setError("Cluster mining was stopped");
          if (autoMining) {
            setAutoMining(false);
          }
          // Don't auto-restart if user manually stopped
        } else if (reason === "replaced") {
          // "replaced" reason means we're restarting, don't show error
          // Auto-restart will be handled by onFound or tip change detection
        } else if (reason === "exhausted") {
          // Nonce range exhausted - this is normal, should auto-restart with new range
          // But this should be handled by MinerCluster.assignNewNonceRange
          // If we get here, it means the range wasn't reassigned, so restart mining
          if (chainContext && !isClusterRestartingRef.current) {
            isClusterRestartingRef.current = true;
            setTimeout(() => {
              setClusterMining((current) => {
                if (!current && !isClusterRestartingRef.current) {
                  handleStartClusterMining();
                }
                setTimeout(() => {
                  isClusterRestartingRef.current = false;
                }, 2000);
                return current;
              });
            }, 500);
          }
        }
      });

      // Phase 37-B: Setup global pool integration
      if (globalPoolEnabled && isP2PConnected) {
        // Setup range received handler - restart mining with new range
        workerNodeManager.onRangeReceived((_range) => {
          // If currently mining, restart with new range
          if (clusterMining) {
            // Stop current mining and restart with new range
            minerCluster.stopMining("replaced").then(() => {
              // Restart with new range
              setTimeout(() => {
                if (clusterMining) {
                  handleStartClusterMining();
                }
              }, 100);
            });
          }
        });
        
        // Phase 37-B: Setup global range exhausted handler
        minerCluster.onExhaustedGlobalRange(() => {
          // Request new range from delegator
          const nodeId = getOrCreateBrowserNodeId();
          const cores = typeof navigator !== "undefined" && "hardwareConcurrency" in navigator
            ? navigator.hardwareConcurrency || 4
            : 4;
          const capability: NodeCapability = {
            nodeId,
            workerCount: clusterWorkerCount,
            threads: cores,
            hasWebGL: typeof WebGLRenderingContext !== "undefined",
            hasWebGPU: typeof (globalThis as any).GPU !== "undefined" && (globalThis as any).GPU !== undefined,
            hasSIMD: typeof WebAssembly !== "undefined" && WebAssembly.validate !== undefined,
            estimatedHashrate: clusterStats.totalHashRate || 100_000,
            lastSeen: Date.now(),
          };
          // Request new range for worker 0 (node-level range)
          workerNodeManager.requestNonceRange(0, capability);
        });
      }

      // Phase 37-B: Get global nonce range if global pool is enabled
      let globalNonceRange: NonceRange | null = null;
      if (globalPoolEnabled && isP2PConnected) {
        // Get current range from workerNodeManager
        const currentRange = workerNodeManager.getCurrentRange?.();
        if (currentRange) {
          globalNonceRange = currentRange;
          // Using global nonce range
        } else {
          // No range yet, request one
          // No global range available, requesting
          const nodeId = getOrCreateBrowserNodeId();
          const cores = typeof navigator !== "undefined" && "hardwareConcurrency" in navigator
            ? navigator.hardwareConcurrency || 4
            : 4;
          const capability: NodeCapability = {
            nodeId,
            workerCount: clusterWorkerCount,
            threads: cores,
            hasWebGL: typeof WebGLRenderingContext !== "undefined",
            hasWebGPU: typeof (globalThis as any).GPU !== "undefined" && (globalThis as any).GPU !== undefined,
            hasSIMD: typeof WebAssembly !== "undefined" && WebAssembly.validate !== undefined,
            estimatedHashrate: clusterStats.totalHashRate || 100_000,
            lastSeen: Date.now(),
          };
          workerNodeManager.requestNonceRange(0, capability);
          // Wait a bit for range to arrive, or start in local mode
          // For now, start in local mode and switch when range arrives
          globalNonceRange = null;
        }
      }

      // Phase 37-D: Integrate with RuntimeManager if available
      if (runtimeManager) {
        minerCluster.setRuntimeManager(runtimeManager);
        // Get recommended profile and use it
        const profile = runtimeManager.getRecommendedProfile();
        const recommendedWorkerCount = Math.min(clusterWorkerCount, profile.workerCount);
        const recommendedDutyCycle = profile.dutyCycle;
        
        // Update state to match recommended values
        if (recommendedWorkerCount !== clusterWorkerCount) {
          setClusterWorkerCount(recommendedWorkerCount);
        }
        if (Math.abs(recommendedDutyCycle - dutyCycle) > 0.05) {
          // Update duty cycle if significantly different
          setDutyCycle(recommendedDutyCycle);
        }
        
        // Use recommended values
        const actualWorkerCount = Math.max(1, recommendedWorkerCount);
        const actualDutyCycle = recommendedDutyCycle;
        
        await minerCluster.startMining({
          candidateBlock,
          difficulty: candidateBlock.header.difficulty,
          workerCount: actualWorkerCount,
          dutyCycle: actualDutyCycle,
          globalNonceRange: globalNonceRange,
        });
        return;
      }
      
      // Fallback: Use manual settings if RuntimeManager not available
      // Phase 26: Start cluster mining with duty cycle
      // Ensure worker count is at least 1
      const actualWorkerCount = Math.max(1, clusterWorkerCount);
      if (actualWorkerCount !== clusterWorkerCount) {
        setClusterWorkerCount(actualWorkerCount);
      }
      
      logger.debug(`[Cluster Mining] Starting with ${actualWorkerCount} workers, duty cycle: ${dutyCycle}`);
      
      await minerCluster.startMining({
        candidateBlock,
        difficulty: candidateBlock.header.difficulty,
        workerCount: actualWorkerCount,
        dutyCycle: dutyCycle, // Phase 26: Use runtime manager duty cycle
        globalNonceRange: globalNonceRange, // Phase 37-B: Pass global nonce range
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start cluster mining");
      setClusterMining(false);
    }
  };

  // Phase 18: Stop cluster mining
  const handleStopClusterMining = async () => {
    await minerCluster.stopMining("user");
    setClusterMining(false);
    if (autoMining) {
      setAutoMining(false);
    }
  };

  // Phase 8: Start mining using Worker (single worker mode)
  // Phase 27: Check if this instance can mine (must be LEADER)
  // Phase 30: Add mining guard checks
  // Phase 38: Check onboarding before starting
  // Phase 42: Add multi-device mining protection
  const handleStartMining = async () => {
    if (!chainContext) return;
    
    // Phase 38: Check onboarding for first-time users
    // Phase 39: Use ref to check immediately (avoids async state update issue)
    if (!onboardingCompletedRef.current && !isMining && !clusterMining) {
      setShowOnboarding(true);
      return;
    }
    
    // Phase 27: Only LEADER can mine
    if (!localCoordinator.canMine()) {
      const leaderId = leaderInfo?.instanceId || "unknown";
      setError(
        locale === "zh"
          ? `⚠️ 本机已有一个挖矿实例：${leaderId}，当前实例为只读模式。如需在本实例挖矿，请先在其他实例中关闭挖矿或关闭页面。`
          : `⚠️ This machine already has a mining instance: ${leaderId}. Current instance is read-only. To mine on this instance, please stop mining on other instances or close their pages.`
      );
      return;
    }
    
    // Phase 42: Multi-device mining protection
    if (shadowNodeRef.current) {
      const shadowNode = shadowNodeRef.current;
      const sessionId = shadowNode.getSessionId();
      const nodeId = p2pNodeRef.current?.nodeId || await getOrCreateNodeAddress();
      const minerId = sessionId ? `${sessionId}-${nodeId}` : nodeId;
      
      // Check current active miner
      const currentActiveMinerId = shadowNode.getActiveMinerId();
      
      if (currentActiveMinerId && currentActiveMinerId !== minerId) {
        // Another device is mining - show dialog
        try {
          // Try to get active miner info from Shadow Node
          const shadowNodeUrl = isMainnetMode 
            ? "https://signal.indexerchain.com" 
            : (bootstrapUrl.replace("ws://", "http://").replace("wss://", "https://"));
          const response = await fetch(`${shadowNodeUrl}/shadow/${sessionId}/getActiveMiner`, {
            method: 'GET',
          });
          if (response.ok) {
            try {
              const contentType = response.headers.get('content-type');
              const text = await response.text();
              let data;
              if (contentType && contentType.includes('application/json')) {
                data = JSON.parse(text);
              } else {
                // Non-JSON response, skip
                return;
              }
              setActiveMinerInfo({
                activeMinerId: data.activeMinerId,
                lastSeen: data.activeMinerLastSeen || Date.now(),
              });
              setActiveMinerDialogOpen(true);
              return; // Wait for user decision
            } catch (parseError) {
              logger.warn("[ActiveMiner] Failed to parse response:", parseError);
            }
          }
        } catch (error) {
          logger.warn("[ActiveMiner] Failed to get active miner info:", error);
        }
      } else if (!currentActiveMinerId || currentActiveMinerId === minerId) {
        // No active miner or we are the active miner - claim it
        const claimResult = await shadowNode.claimActiveMiner(minerId);
        if (!claimResult.success) {
          if (claimResult.activeMinerId) {
            // Another device is mining
            setActiveMinerInfo({
              activeMinerId: claimResult.activeMinerId,
              lastSeen: Date.now(),
            });
            setActiveMinerDialogOpen(true);
            return;
          } else {
            setError(claimResult.error || "Failed to claim active miner");
            return;
          }
        }
      }
    }
    
    // Phase 30: Mining guard check
    const { MiningGuard } = await import("../core/miningGuard.js");
    const walletStore = getMultiWalletStore();
    const miningWallet = walletStore.getMiningWallet();
    const minerAddr = miningWallet ? miningWallet.address : await getOrCreateNodeAddress();
    
    const guardResult = await MiningGuard.canMineNow(
      chainContext,
      chainContext.p2p || null,
      finalityManager,
      localCoordinator.getRole(),
      minerAddr,
      bootstrapComplete // Phase 32: Pass bootstrap status
    );
    
    if (!guardResult.ok) {
      const { MiningGuard: Guard } = await import("../core/miningGuard.js");
      const message = Guard.getStatusMessage(guardResult, locale);
      
      // Don't show error for NOT_SYNCED if we're at height 0 (new chain) or bootstrap is not complete
      // These are normal states during initial sync, not errors
      const localTip = chainContext.storage.getTip();
      if (guardResult.code === "NOT_SYNCED" && (localTip?.header.height === 0 || !bootstrapComplete)) {
        // Production: No console logs
        // Don't set error - this is informational, not an error
        // The mining button will be disabled based on miningGuardResult
        return;
      }
      
      setError(message);
      return;
    }
    
    // Allow mining even without pending transactions (coinbase only blocks are valid)
    const pendingTxs = mempool.getAll();

    try {
      const prevBlock = chainContext.storage.getTip();
      if (!prevBlock) {
        setError("No previous block found");
        return;
      }

      // Phase 8: Build candidate block
      // Phase 15: Pass current IndexState for stateCommitment calculation
      const allBlocks = chainContext.storage.getAllBlocks();
      const candidateBlock = await buildCandidateBlock(
        pendingTxs,
        prevBlock,
        allBlocks,
        chainContext.params,
        minerAddr as any,
        chainContext.indexState,
        chainContext.p2p || undefined, // Phase 44: Pass P2P node for IP sharing weight
        chainContext // Phase 44: Pass chain context for IP sharing weight
      );

      // Set mining state immediately after candidate block is built successfully
      setIsMining(true);
      setError("");
      // Removed: setMiningHash, setMiningNonce (replaced by MiningLiveStatsCard)
      setMiningStats({ hashesTried: 0, hashRate: null, elapsedTime: 0 });
      
      // Phase 42: Start active miner heartbeat
      if (shadowNodeRef.current) {
        const shadowNode = shadowNodeRef.current;
        const sessionId = shadowNode.getSessionId();
        const nodeId = p2pNodeRef.current?.nodeId || await getOrCreateNodeAddress();
        const minerId = sessionId ? `${sessionId}-${nodeId}` : nodeId;
        
        // Clear existing heartbeat
        if (activeMinerHeartbeatRef.current) {
          clearInterval(activeMinerHeartbeatRef.current);
        }
        
        // Start heartbeat every 5 seconds
        activeMinerHeartbeatRef.current = window.setInterval(() => {
          if (shadowNodeRef.current) {
            shadowNodeRef.current.heartbeatActiveMiner(minerId).catch((err) => {
              logger.warn("[ActiveMiner] Heartbeat failed:", err);
            });
          }
        }, 5000);
      }

      // Phase 8: Start mining with Worker
      // Phase 26: Pass duty cycle to miner client
      minerClient.startMining({
        candidateBlock,
        difficulty: candidateBlock.header.difficulty,
        dutyCycle: dutyCycle, // Phase 26: Use runtime manager duty cycle
        onProgress: (event) => {
          // Use functional updates to ensure we're using the latest state
          // Removed: setMiningHash, setMiningNonce (replaced by MiningLiveStatsCard)
          const elapsed = (Date.now() - event.startedAt) / 1000;
          const hashRate = elapsed > 0 ? event.hashesTried / elapsed : null;
          setMiningStats(() => ({
            hashesTried: event.hashesTried,
            hashRate,
            elapsedTime: elapsed,
          }));
        },
        onFound: async (event) => {
          // Phase 37-C: Reconstruct full block from nonce
          const foundBlock: Block = {
            ...candidateBlock,
            header: {
              ...candidateBlock.header,
              nonce: event.nonce,
            },
            hash: event.hash,
          };

          // Phase 30: Record block as mined before verification
          try {
            const { getMiningStatsTracker } = await import("../core/miningStats.js");
            const statsTracker = getMiningStatsTracker();
            statsTracker.recordBlockMined(
              foundBlock.header.height,
              foundBlock.hash,
              minerAddr
            );
          } catch (e) {
            // Stats tracker not available, ignore
          }
          
          // Verify and append block
          const allBlocksForVerify = chainContext.storage.getAllBlocks();
          const verification = await verifyBlock(
            foundBlock,
            prevBlock,
            allBlocksForVerify,
            chainContext.params
          );

          if (verification.valid) {
            const result = await appendMinedBlock(foundBlock, chainContext);
            if (result.success) {
              // Remove transactions from mempool
              const txIds = foundBlock.txs.map((tx: Tx) => tx.txId);
              mempool.removeTxs(txIds);

              // Update lastHeightRef to prevent immediate restart
              const newTip = chainContext.storage.getTip();
              if (newTip) {
                lastHeightRef.current = newTip.header.height;
              }

              // Don't update chainContext here - let the useEffect handle it
              setError("");
            } else {
              // Phase 30: Record rejected block
              try {
                const { getMiningStatsTracker } = await import("../core/miningStats.js");
                const statsTracker = getMiningStatsTracker();
                statsTracker.recordBlockRejected(foundBlock.hash, result.error);
              } catch (e) {
                // Stats tracker not available, ignore
              }
              setError(result.error || "Failed to append block");
            }
          } else {
            // Phase 30: Record rejected block
            try {
              const { getMiningStatsTracker } = await import("../core/miningStats.js");
              const statsTracker = getMiningStatsTracker();
              statsTracker.recordBlockRejected(foundBlock.hash, verification.error);
            } catch (e) {
              // Stats tracker not available, ignore
            }
            setError(verification.error || "Block verification failed");
          }

          setIsMining(false);
          // Removed: setMiningHash, setMiningNonce (replaced by MiningLiveStatsCard)
          
          // Phase 31: Stop mining epoch
          if (antiInvalidMining) {
            antiInvalidMining.stopMiningEpoch();
          }
          
          // Don't auto-restart here - let the useEffect handle it based on tip change
          // This prevents immediate restart and gives time for state to stabilize
        },
        onStopped: (event) => {
          // Only reset mining state if not "replaced" (replaced means we're restarting with new block)
          if (event.reason !== "replaced") {
            setIsMining(false);
          }
          if (event.reason === "error") {
            setError(event.errorMessage || "Mining error occurred");
          } else if (event.reason === "user") {
            setError("Mining was stopped");
            // If auto-mining is enabled and user stopped, disable auto-mining
            if (autoMining) {
              setAutoMining(false);
            }
          }
          // "replaced" reason means we're restarting with a new block
          // Don't reset state or auto-restart here - the new block will trigger a new mining session
          // if auto-mining is enabled
        },
      });
    } catch (err) {
      setIsMining(false);
      setError(err instanceof Error ? err.message : "Failed to start mining");
      // Production: Only log errors in development
      if (process.env.NODE_ENV === 'development') {
        console.error("Failed to start mining:", err);
      }
    }
  };

  // Phase 8: Stop mining
  // Phase 42: Release active miner when stopping
  const handleStopMining = () => {
    minerClient.stopMining("user");
    setIsMining(false);
    
    // Phase 42: Release active miner
    if (shadowNodeRef.current && activeMinerHeartbeatRef.current) {
      clearInterval(activeMinerHeartbeatRef.current);
      activeMinerHeartbeatRef.current = null;
      
      const shadowNode = shadowNodeRef.current;
      const sessionId = shadowNode.getSessionId();
      const nodeId = p2pNodeRef.current?.nodeId || "";
      const minerId = sessionId ? `${sessionId}-${nodeId}` : nodeId;
      
      shadowNode.releaseActiveMiner(minerId).catch((err) => {
        logger.warn("[ActiveMiner] Failed to release active miner:", err);
      });
    }
  };

  // Phase 8: Auto-restart mining when tip changes
  // Use useRef to persist lastHeight across re-renders
  const lastHeightRef = useRef<number>(0);
  const isRestartingRef = useRef<boolean>(false); // Prevent multiple simultaneous restarts
  const isClusterRestartingRef = useRef<boolean>(false); // Prevent multiple simultaneous cluster mining restarts
  const clusterRestartTimeoutRef = useRef<number | null>(null); // Track pending restart timeout
  const chainContextRef = useRef<ChainContext | null>(chainContext);
  const isMiningRef = useRef<boolean>(isMining);
  const autoMiningRef = useRef<boolean>(autoMining);
  const clusterMiningRef = useRef<boolean>(clusterMining); // Track cluster mining state
  
  // Update refs when values change
  useEffect(() => {
    chainContextRef.current = chainContext;
  }, [chainContext]);
  
  useEffect(() => {
    isMiningRef.current = isMining;
  }, [isMining]);
  
  useEffect(() => {
    autoMiningRef.current = autoMining;
  }, [autoMining]);
  
  useEffect(() => {
    clusterMiningRef.current = clusterMining;
  }, [clusterMining]);
  
  useEffect(() => {
    if (!chainContext) return;

    const tip = chainContext.storage.getTip();
    // Initialize lastHeight only if it's 0 (first run)
    if (lastHeightRef.current === 0) {
      lastHeightRef.current = tip?.header.height ?? 0;
    }

    // Check if tip changed (new block received)
    const checkTip = () => {
      const currentContext = chainContextRef.current;
      if (!currentContext || isRestartingRef.current) return;
      
      const newTip = currentContext.storage.getTip();
      const newHeight = newTip?.header.height ?? 0;
      const currentIsMining = isMiningRef.current;
      const currentAutoMining = autoMiningRef.current;
      const currentClusterMining = clusterMiningRef.current;
      
      if (newHeight > lastHeightRef.current) {
        // Tip changed, restart mining if currently mining or auto-mining is enabled
        // Removed debug log: [App] Tip height changed
        lastHeightRef.current = newHeight;
        
        // Handle single-threaded mining restart
        if (currentIsMining) {
          isRestartingRef.current = true;
          minerClient.stopMining("replaced");
          // Restart after a short delay
          setTimeout(() => {
            const ctx = chainContextRef.current;
            const mining = isMiningRef.current;
            if (ctx && mining && !isRestartingRef.current) {
              // Double-check we're still supposed to be mining
              handleStartMining();
              setTimeout(() => {
                isRestartingRef.current = false;
              }, 2000);
            } else {
              isRestartingRef.current = false;
            }
          }, 1500);
        } else if (currentAutoMining && !currentIsMining) {
          // Auto-mining enabled but not currently mining, start it
          isRestartingRef.current = true;
          setTimeout(() => {
            const ctx = chainContextRef.current;
            const auto = autoMiningRef.current;
            const mining = isMiningRef.current;
            if (ctx && auto && !mining) {
              handleStartMining();
              setTimeout(() => {
                isRestartingRef.current = false;
              }, 2000);
            } else {
              isRestartingRef.current = false;
            }
          }, 1500);
        }
        
        // Handle cluster mining restart (always restart if cluster mining was active)
        // This ensures continuous mining when user clicks "Start Cluster Mining"
        if (currentClusterMining && !isClusterRestartingRef.current) {
          // Production: No console logs
          
          // Clear any pending restart timeout
          if (clusterRestartTimeoutRef.current) {
            clearTimeout(clusterRestartTimeoutRef.current);
            clusterRestartTimeoutRef.current = null;
          }
          
          isClusterRestartingRef.current = true;
          // Stop current cluster mining
          minerCluster.stopMining("replaced");
          // Restart after a short delay
          clusterRestartTimeoutRef.current = window.setTimeout(() => {
            const ctx = chainContextRef.current;
            const clusterMining = clusterMiningRef.current;
            if (ctx && clusterMining && !isClusterRestartingRef.current) {
              handleStartClusterMining();
            }
            // Reset restart flag after a delay
            setTimeout(() => {
              isClusterRestartingRef.current = false;
            }, 2000);
            clusterRestartTimeoutRef.current = null;
          }, 1000);
        }
      }
    };

    const interval = setInterval(checkTip, 2000); // Check every 2 seconds (less frequent)
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - we use refs to access current values

  if (loading) {
    return (
      <div className="app">
        <div className="app-main">
          <p>Initializing chain...</p>
        </div>
      </div>
    );
  }

  if (!chainContext) {
    return (
      <div className="app">
        <div className="app-main">
          <p>Failed to initialize chain</p>
        </div>
      </div>
    );
  }

  const tip = chainContext.storage.getTip();
  const height = tip?.header.height ?? 0;
  const blockCount = chainContext.storage.getAllBlocks().length;
  const pendingTxs = mempool.getAll();
  const peers = chainContext.p2p
    ? Array.from(chainContext.p2p.peers.values()).filter((p) => p.connected)
    : [];

  // Phase 42: Handle active miner dialog actions
  const handleActiveMinerTakeover = async () => {
    if (!shadowNodeRef.current || !chainContext) return;
    
    const shadowNode = shadowNodeRef.current;
    const sessionId = shadowNode.getSessionId();
    const nodeId = p2pNodeRef.current?.nodeId || await getOrCreateNodeAddress();
    const minerId = sessionId ? `${sessionId}-${nodeId}` : nodeId;
    
    // Force claim active miner
    const claimResult = await shadowNode.claimActiveMiner(minerId);
    if (claimResult.success) {
      setActiveMinerDialogOpen(false);
      // Start mining after claiming
      handleStartMining();
    } else {
      setError(claimResult.error || "Failed to take over mining");
    }
  };

  return (
    <div className="app">
      {/* Phase 42: Hard Reorg Banner */}
      <HardReorgBanner locale={locale} />
      
      {/* Phase 42: Active Miner Dialog */}
      <ActiveMinerDialog
        isOpen={activeMinerDialogOpen}
        activeMinerInfo={activeMinerInfo}
        locale={locale}
        onCancel={() => {
          setActiveMinerDialogOpen(false);
          setActiveMinerInfo(null);
        }}
        onTakeover={handleActiveMinerTakeover}
      />
      <header className="app-header">
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center", 
          width: "100%", 
          maxWidth: "1400px", 
          margin: "0 auto",
          flexWrap: "wrap",
          gap: "1rem"
        }}>
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "1rem",
            flex: "1",
            minWidth: 0
          }}>
            <img 
              src="/logo/logo.png" 
              alt="IndexerChain Logo" 
              style={{ 
                height: "48px",
                width: "48px",
                objectFit: "contain",
                flexShrink: 0
              }}
            />
            <div style={{ minWidth: 0, flex: "1" }}>
              <h1 style={{ 
                margin: 0, 
                display: "flex", 
                alignItems: "center", 
                gap: "0.5rem",
                fontSize: "clamp(1.25rem, 4vw, 2.5rem)",
                lineHeight: "1.2"
              }}>
                {t("common.appTitle")}
              </h1>
              <p className="subtitle" style={{ 
                margin: 0,
                fontSize: "clamp(0.75rem, 2vw, 1rem)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}>
                {t("common.appSubtitle")}
              </p>
            </div>
          </div>
          <div style={{ 
            display: "flex", 
            gap: "0.5rem", 
            alignItems: "center",
            flexShrink: 0
          }}>
            {/* Mobile Menu Toggle */}
            <button
              className="mobile-menu-toggle"
              onClick={() => setShowMobileMenu(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
            {/* Language Switcher */}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => setLocale("zh")}
                style={{
                  padding: "0.5rem 1rem",
                  background: locale === "zh" ? "#667eea" : "rgba(255, 255, 255, 0.2)",
                  color: "white",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: locale === "zh" ? "bold" : "normal",
                  fontSize: "clamp(0.75rem, 2vw, 0.9rem)",
                  minHeight: "44px",
                  minWidth: "44px",
                  whiteSpace: "nowrap"
                }}
              >
                {t("common.chinese")}
              </button>
              <button
                onClick={() => setLocale("en")}
                style={{
                  padding: "0.5rem 1rem",
                  background: locale === "en" ? "#667eea" : "rgba(255, 255, 255, 0.2)",
                  color: "white",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: locale === "en" ? "bold" : "normal",
                  fontSize: "clamp(0.75rem, 2vw, 0.9rem)",
                  minHeight: "44px",
                  minWidth: "44px",
                  whiteSpace: "nowrap"
                }}
              >
                {t("common.english")}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Tab Menu */}
      <div 
        className={`mobile-tab-menu ${showMobileMenu ? "active" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowMobileMenu(false);
          }
        }}
      >
        <div className="mobile-tab-menu-content">
          <div className="mobile-tab-menu-header">
            <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{t("common.appTitle")}</h2>
            <button
              className="mobile-tab-menu-close"
              onClick={() => setShowMobileMenu(false)}
              aria-label="Close menu"
            >
              ×
            </button>
          </div>
          <button
            className={`mobile-tab-button ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("overview");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.overview")}
          </button>
          <button
            className={`mobile-tab-button ${activeTab === "mining" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("mining");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.mining")}
          </button>
          <button
            className={`mobile-tab-button ${activeTab === "wallet" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("wallet");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.wallet")}
          </button>
          <button
            className={`mobile-tab-button ${activeTab === "transactions" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("transactions");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.transactions")}
          </button>
          <button
            className={`mobile-tab-button ${activeTab === "network" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("network");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.network")}
          </button>
          <button
            className={`mobile-tab-button ${activeTab === "storage" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("storage");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.storage")}
          </button>
          <button
            className={`mobile-tab-button ${activeTab === "advanced" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("advanced");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.advanced")}
          </button>
          <button
            className={`mobile-tab-button ${activeTab === "token" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("token");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.token")}
          </button>
          <button
            className={`mobile-tab-button ${activeTab === "privacy" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("privacy");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.privacy")}
          </button>
          <button
            className={`mobile-tab-button ${activeTab === "tools" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("tools");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.tools")}
          </button>
          <button
            className={`mobile-tab-button ${activeTab === "runtime" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("runtime");
              setShowMobileMenu(false);
            }}
          >
            {t("tabs.runtime")}
          </button>
        </div>
      </div>

      <main className="app-main">
        {/* Status Banner */}
        {chainContext && (
          <div style={{
            padding: "clamp(0.75rem, 2vw, 1rem)",
            marginBottom: "1.5rem",
            borderRadius: "8px",
            background: isP2PConnected && nodeAddress ? "#d4edda" : "#fff3cd",
            border: `2px solid ${isP2PConnected && nodeAddress ? "#28a745" : "#ffc107"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem"
          }}>
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: "clamp(0.5rem, 2vw, 1rem)", 
              flexWrap: "wrap",
              flex: "1",
              minWidth: 0
            }}>
              <span style={{ 
                fontSize: "clamp(1.25rem, 4vw, 1.5rem)",
                flexShrink: 0
              }}>
                {isP2PConnected && nodeAddress ? "✅" : "⚠️"}
              </span>
              <div style={{ minWidth: 0, flex: "1" }}>
                <strong style={{ 
                  fontSize: "clamp(0.9rem, 2.5vw, 1rem)", 
                  display: "block", 
                  marginBottom: "0.25rem",
                  wordBreak: "break-word"
                }}>
                  {isP2PConnected && nodeAddress 
                    ? t("banner.systemReady")
                    : t("banner.configRequired")}
                </strong>
                <div style={{ 
                  fontSize: "clamp(0.8rem, 2vw, 0.9rem)", 
                  color: "#666",
                  wordBreak: "break-word"
                }}>
                  {isP2PConnected && nodeAddress 
                    ? t("banner.networkConnected", { count: peerCount, height })
                    : !isP2PConnected && !nodeAddress
                    ? t("banner.networkDisconnected")
                    : !isP2PConnected
                    ? t("quickStart.step1Desc")
                    : t("banner.walletInitializing")}
                </div>
              </div>
            </div>
            {!isP2PConnected && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setActiveTab("network");
                  setShowMobileMenu(false);
                }}
                style={{ 
                  padding: "clamp(0.5rem, 2vw, 0.75rem) clamp(0.75rem, 3vw, 1rem)",
                  minHeight: "44px",
                  whiteSpace: "nowrap",
                  flexShrink: 0
                }}
              >
                {t("banner.configNetwork")}
              </button>
            )}
          </div>
        )}

        {/* Configuration Checker */}
        {chainContext && (
          <ConfigChecker
            chainContext={chainContext}
            isP2PConnected={isP2PConnected}
            nodeAddress={nodeAddress}
            isMining={isMining || clusterMining}
          />
        )}


        {error && (
          <div 
            className={error.includes("✅") ? "success" : "error"} 
            style={{ 
              whiteSpace: "pre-line",
              maxWidth: "100%",
              wordBreak: "break-word",
              padding: "clamp(1rem, 3vw, 1.5rem)",
              marginBottom: "1rem",
              fontSize: "clamp(0.9rem, 2.5vw, 1rem)"
            }}
          >
            <strong style={{ 
              fontSize: "clamp(1rem, 3vw, 1.2rem)", 
              display: "block", 
              marginBottom: "0.75rem" 
            }}>
              {error.includes("✅") ? "✅ Success:" : "❌ Chain Initialization Error:"}
            </strong>
            <div style={{ 
              marginBottom: "1rem", 
              fontSize: "clamp(0.9rem, 2.5vw, 1rem)", 
              lineHeight: "1.6" 
            }}>
              {error}
            </div>
            {needsReset ? (
              <div style={{ 
                marginTop: "1.5rem", 
                paddingTop: "1.5rem", 
                borderTop: "3px solid rgba(255,255,255,0.5)",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "1rem"
              }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleResetChain}
                  style={{ 
                    padding: "clamp(0.875rem, 2vw, 1.25rem) clamp(1.5rem, 4vw, 2.5rem)",
                    fontSize: "clamp(0.95rem, 2.5vw, 1.2rem)",
                    fontWeight: "bold",
                    backgroundColor: "#dc3545",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    display: "inline-block",
                    minWidth: "min(300px, 100%)",
                    width: "100%",
                    maxWidth: "100%",
                    minHeight: "44px",
                    boxShadow: "0 4px 8px rgba(0,0,0,0.3)",
                    transition: "all 0.2s"
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = "#c82333";
                    e.currentTarget.style.transform = "scale(1.05)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = "#dc3545";
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  🔄 Reset Chain (Clear All Data)
                </button>
                <p style={{ 
                  marginTop: "0.5rem", 
                  fontSize: "clamp(0.9rem, 2.5vw, 1rem)", 
                  opacity: 0.95, 
                  maxWidth: "100%", 
                  lineHeight: "1.5",
                  wordBreak: "break-word"
                }}>
                  ⚠️ <strong>{t("common.warning")}:</strong> {t("chainReset.warning")}
                </p>
              </div>
            ) : error.includes(t("localInstance.alreadyHasMiningInstance")) || error.includes("already has a mining instance") ? (
              <div style={{ 
                marginTop: "1.5rem", 
                paddingTop: "1.5rem", 
                borderTop: "3px solid rgba(255,255,255,0.5)",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "1rem"
              }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    // Force clear leader info (even if not timed out)
                    localCoordinator.clearStaleLeader(true);
                    setError("");
                    // Wait a bit for election to complete
                    setTimeout(() => {
                      const newRole = localCoordinator.getRole();
                      const leaderInfo = localCoordinator.getLeaderInfo();
                      if (newRole === "LEADER") {
                        setError(t("localInstance.clearedOldInstance"));
                        setTimeout(() => setError(""), 3000);
                      } else if (leaderInfo) {
                        // Still have a leader, might be another active instance
                        setError(t("localInstance.detectedAnotherInstance", { instanceId: leaderInfo.instanceId }));
                      } else {
                        setError(t("localInstance.cleanupFailed"));
                      }
                    }, 1500);
                  }}
                  style={{ 
                    padding: "1rem 2rem",
                    fontSize: "1rem",
                    fontWeight: "bold",
                    backgroundColor: "#007bff",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    display: "inline-block",
                    minWidth: "250px",
                    boxShadow: "0 4px 8px rgba(0,0,0,0.3)",
                    transition: "all 0.2s"
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = "#0056b3";
                    e.currentTarget.style.transform = "scale(1.05)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = "#007bff";
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  🔄 清理旧的实例信息
                </button>
                <p style={{ marginTop: "0.5rem", fontSize: "0.95rem", opacity: 0.95, maxWidth: "600px", lineHeight: "1.5" }}>
                  💡 <strong>说明：</strong>如果其他标签页/窗口已经关闭，点击此按钮可以清理旧的 LEADER 信息，让当前实例成为 LEADER。
                </p>
              </div>
            ) : null}
          </div>
        )}

        {needsReset && !error && (
          <div
            style={{
              color: "#856404",
              marginBottom: "1rem",
              padding: "1rem",
              background: "#fff3cd",
              borderRadius: "4px",
              border: "1px solid #ffc107",
            }}
          >
            <strong>⚠️ Chain Reset Required:</strong>
            <p style={{ marginTop: "0.5rem" }}>
              Your chain data is from an older version (pre-Phase 5). To use the new signature
              system, you need to reset the chain.
            </p>
            <button
              className="btn btn-secondary"
              onClick={handleResetChain}
              style={{ marginTop: "0.5rem" }}
            >
              {t("advanced.resetChain")}
            </button>
          </div>
        )}

        {/* Node Identity Bar - 显示在所有标签页上方 */}
        {chainContext && (
          <div style={{
            padding: "1rem 1.5rem",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            borderRadius: "8px",
            marginBottom: "1rem",
            boxShadow: "0 4px 15px rgba(102, 126, 234, 0.3)"
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "1.5rem"
            }}>
              {/* Left: Balance (最显眼) */}
              {nodeAddress && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  flex: "1",
                  minWidth: "200px"
                }}>
                  <div>
                    <div style={{ fontSize: "0.85rem", opacity: 0.9, marginBottom: "0.25rem" }}>
                      {t("wallet.balance")}
                    </div>
                    <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "white" }}>
                      {formatNumber(chainContext.indexState.getBalance(nodeAddress as any), 2, locale === "zh" ? "zh-CN" : "en-US")} IDC
                    </div>
                  </div>
                </div>
              )}
              
              {/* Middle: Address */}
              {nodeAddress && (
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  flex: "2",
                  minWidth: "250px"
                }}>
                  <div style={{ fontSize: "0.85rem", opacity: 0.9 }}>
                    {t("wallet.address")}
                  </div>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap"
                  }}>
                    <span style={{
                      fontSize: "0.9rem",
                      fontFamily: "monospace",
                      color: "white",
                      wordBreak: "break-all"
                    }}>
                      {formatAddress(nodeAddress, 8, 6)}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(nodeAddress);
                        setError(t("wallet.addressCopied"));
                        setTimeout(() => setError(""), 2000);
                      }}
                      style={{
                        padding: "0.4rem 0.8rem",
                        fontSize: "0.85rem",
                        background: "rgba(255, 255, 255, 0.3)",
                        color: "white",
                        border: "1px solid rgba(255, 255, 255, 0.5)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontWeight: "500",
                        whiteSpace: "nowrap",
                        transition: "all 0.2s"
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = "rgba(255, 255, 255, 0.4)";
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = "rgba(255, 255, 255, 0.3)";
                      }}
                    >
                      {t("common.copy")}
                    </button>
                  </div>
                </div>
              )}
              
              {/* Right: Node ID */}
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                minWidth: "150px"
              }}>
                <div style={{ fontSize: "0.85rem", opacity: 0.9 }}>
                  {t("wallet.nodeId")}
                </div>
                <div style={{
                  fontSize: "0.9rem",
                  fontFamily: "monospace",
                  color: "white"
                }}>
                  {formatAddress(getOrCreateBrowserNodeId(), 8, 8)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Daily Info Bar - 每日信息栏（放在余额组件下面，标签栏上面） */}
        {chainContext && nodeAddress && (() => {
          const tip = chainContext.storage.getTip();
          return (
            <DailyInfoBar
              chainContext={chainContext}
              nodeAddress={nodeAddress}
              currentHeight={tip?.header?.height || 0}
              isMining={isMining}
              clusterMining={clusterMining}
              currentReferrerAddress={currentReferrerAddress}
              locale={locale}
            />
          );
        })()}

        {/* Tab Navigation */}
        <div className="tab-container">
          <div className="tab-nav desktop-only">
            {/* P0-3: Core Tabs (Most Used) */}
            <button
              className={`tab-button ${activeTab === "overview" ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab("overview");
              }}
            >
              {t("tabs.overview")}
            </button>
            <button
              className={`tab-button ${activeTab === "mining" ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab("mining");
              }}
            >
              {t("tabs.mining")}
            </button>
            <button
              className={`tab-button ${activeTab === "wallet" ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab("wallet");
              }}
            >
              {t("tabs.wallet")}
            </button>
            <button
              className={`tab-button ${activeTab === "transactions" ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab("transactions");
              }}
            >
              {t("tabs.transactions")}
            </button>
            <button
              className={`tab-button ${activeTab === "network" ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab("network");
              }}
            >
              {t("tabs.network")}
            </button>
            
            {/* P1-1: Advanced Tabs (Less Used) - Collapsible */}
            <div style={{ 
              marginLeft: "auto", 
              display: "flex", 
              gap: "0.5rem", 
              alignItems: "center", 
              paddingLeft: "clamp(0.25rem, 1vw, 0.5rem)", 
              borderLeft: "1px solid #e0e0e0"
            }}>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setShowAdvancedTabs(!showAdvancedTabs);
                }}
                style={{
                  padding: "clamp(0.4rem, 1.5vw, 0.6rem) clamp(0.6rem, 2vw, 0.8rem)",
                  fontSize: "clamp(0.75rem, 2vw, 0.8rem)",
                  color: showAdvancedTabs ? "#667eea" : "#999",
                  background: showAdvancedTabs ? "rgba(102, 126, 234, 0.1)" : "transparent",
                  border: `1px solid ${showAdvancedTabs ? "#667eea" : "#ddd"}`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.2s ease",
                  fontWeight: showAdvancedTabs ? "500" : "400",
                  minHeight: "44px",
                  minWidth: "44px",
                }}
                onMouseEnter={(e) => {
                  if (!showAdvancedTabs) {
                    e.currentTarget.style.borderColor = "#667eea";
                    e.currentTarget.style.color = "#667eea";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!showAdvancedTabs) {
                    e.currentTarget.style.borderColor = "#ddd";
                    e.currentTarget.style.color = "#999";
                  }
                }}
                title={showAdvancedTabs ? t("advanced.hideAdvancedTabs") : t("advanced.showAdvancedTabs")}
              >
                <span style={{ marginRight: "0.3rem" }}>{showAdvancedTabs ? "▼" : "▶"}</span>
                {t("tabs.advanced")}
              </button>
            </div>
            {showAdvancedTabs && (
              <>
                <button
                  className={`tab-button ${activeTab === "storage" ? "active" : ""}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveTab("storage");
                  }}
                >
                  {t("tabs.storage")}
                </button>
                <button
                  className={`tab-button ${activeTab === "advanced" ? "active" : ""}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveTab("advanced");
                  }}
                >
                  {t("tabs.advanced")}
                </button>
                <button
                  className={`tab-button ${activeTab === "token" ? "active" : ""}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveTab("token");
                  }}
                >
                  {t("tabs.token")}
                </button>
                <button
                  className={`tab-button ${activeTab === "privacy" ? "active" : ""}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveTab("privacy");
                  }}
                >
                  {t("tabs.privacy")}
                </button>
                <button
                  className={`tab-button ${activeTab === "tools" ? "active" : ""}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveTab("tools");
                  }}
                >
                  {t("tabs.tools")}
                </button>
              </>
            )}
          </div>

          {/* Overview Tab - P0-2: Simplified with Quick Status Dashboard */}
          {activeTab === "overview" && (
            <div className="tab-content active">
              {/* Phase 39: Mining Status Banner - Top of Overview */}
              {chainContext && (
                <>
                  <MiningStatusBanner
                    chainContext={chainContext}
                    p2pNode={chainContext?.p2p || null}
                    finalityManager={finalityManager}
                    localRole={localCoordinator.getRole()}
                    bootstrapComplete={bootstrapComplete}
                    nodeAddress={nodeAddress}
                    isMining={isMining}
                    autoMining={autoMining}
                    onStartMining={handleStartMining}
                    onStopMining={handleStopMining}
                    onViewDetails={() => setActiveTab("network")}
                    locale={locale}
                  />

                  {/* Phase 39: Multi-terminal Sync Notice */}
                  <MultiTerminalSyncNotice
                    chainContext={chainContext}
                    locale={locale}
                  />

                  {/* Phase 39: Genesis Quorum Banner */}
                  <GenesisQuorumBanner
                    chainContext={chainContext}
                    p2pNode={chainContext?.p2p || null}
                    bootstrapComplete={bootstrapComplete}
                    locale={locale}
                  />

                  {/* Phase 39: Multi-terminal Sync Info */}
                  <div
                    className="status-card"
                    style={{
                      marginBottom: "1.5rem",
                      background: "rgba(23, 162, 184, 0.05)",
                      border: "1px solid #17a2b8",
                    }}
                  >
                    <div style={{ fontSize: "0.9rem", color: "#666", lineHeight: "1.6" }}>
                      {locale === "zh" ? (
                        <>
                          💡 <strong>自动同步说明：</strong>本节点的区块高度、余额和状态会自动与网络多数节点保持一致。
                          如遇高度不一致或余额异常，系统会自动暂停挖矿并进行修复。
                        </>
                      ) : (
                        <>
                          💡 <strong>Auto-Sync Info:</strong> This node's block height, balance, and state automatically
                          stay consistent with the network majority. If height inconsistency or balance anomalies are
                          detected, mining will be automatically paused and repaired.
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* P0-2: Quick Status Dashboard */}
              {chainContext && (
                <QuickStatusDashboard
                  chainContext={chainContext}
                  p2pNode={chainContext?.p2p || null}
                  isP2PConnected={isP2PConnected}
                  peerCount={peerCount}
                  nodeAddress={nodeAddress}
                  isMining={isMining}
                  clusterMining={clusterMining}
                  miningGuardResult={miningGuardResult}
                  localRole={localCoordinator.getRole()}
                  height={height}
                  locale={locale}
                  onQuickAction={(action) => {
                    setActiveTab(action);
                  }}
                />
              )}

              {/* Phase 30: Global Consistency Sentinel Panel - Collapsed by default */}
              {chainContext && chainContext.params.globalSentinelEnabled !== false && (
                <AccordionCard
                  title={t("app.globalConsistencySentinel")}
                  defaultExpanded={false}
                  locale={locale}
                >
                  <GlobalSentinelPanel
                    assessment={driftAssessment}
                    onReassess={() => {
                      if (globalSentinel) {
                        globalSentinel.performDriftCheck();
                      }
                    }}
                    onSyncFromSnapshot={async () => {
                      if (!chainContext) return;
                      try {
                        setError("");
                        if (chainContext.params.remoteSnapshotEnabled) {
                          const { syncFromRemoteSnapshot } = await import("../core/remoteSnapshot.js");
                          await syncFromRemoteSnapshot(chainContext.params, chainContext.storage);
                          setError("✅ Syncing from remote snapshot...");
                          setTimeout(() => window.location.reload(), 2000);
                        } else {
                          setError("Remote snapshot sync is not enabled. Please enable it in chain parameters.");
                        }
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to sync from snapshot");
                      }
                    }}
                    onStopMining={() => {
                      if (isMining) handleStopMining();
                      if (clusterMining) handleStopClusterMining();
                      if (autoMining) setAutoMining(false);
                      setError("✅ Mining stopped due to critical drift");
                      setTimeout(() => setError(""), 3000);
                    }}
                    locale={locale}
                  />
                </AccordionCard>
              )}
              
              {/* Phase 34: Network Health Dashboard - Collapsed by default */}
              {chainContext && (
                <AccordionCard
                  title={t("app.networkHealthStatus")}
                  defaultExpanded={false}
                  locale={locale}
                >
                  <NetworkHealthPanel
                    chainContext={chainContext}
                    p2pNode={chainContext?.p2p || null}
                    finalityManager={finalityManager}
                    localRole={localCoordinator.getRole()}
                    bootstrapComplete={bootstrapComplete}
                    locale={locale}
                  />
                </AccordionCard>
              )}

              {/* Quick Start Guide - Only show when not fully set up and not auto-connecting */}
              {(!isP2PConnected || !nodeAddress || (!isMining && !clusterMining)) && !autoConnectAttemptedRef.current && (
                <div className="status-card" style={{ 
                  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                  color: "white",
                  border: "none",
                  marginBottom: "1.5rem"
                }}>
                  <h2 style={{ color: "white", marginBottom: "1rem" }}>{t("quickStart.title")}</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {/* Step 1: Connect Network */}
                    <div style={{ 
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem",
                      background: "rgba(255, 255, 255, 0.15)",
                      borderRadius: "6px"
                    }}>
                      <span style={{ 
                        fontSize: "1.2rem",
                        background: isP2PConnected ? "#28a745" : "rgba(255, 255, 255, 0.3)",
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}>
                        {isP2PConnected ? "✓" : "1"}
                      </span>
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: "0.95rem" }}>{t("quickStart.step1Title")}</strong>
                        {!isP2PConnected && (
                          <button
                            className="btn"
                            onClick={() => {
                              setActiveTab("network");
                              setTimeout(() => {
                                if (!isP2PConnected && isMainnetMode) {
                                  handleConnectP2P();
                                }
                              }, 100);
                            }}
                            style={{ 
                              background: "white", 
                              color: "#667eea",
                              padding: "0.4rem 0.8rem",
                              fontSize: "0.85rem",
                              marginLeft: "0.5rem"
                            }}
                          >
                            {t("quickStart.step1Action")}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Step 2: Check Wallet */}
                    <div style={{ 
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem",
                      background: "rgba(255, 255, 255, 0.15)",
                      borderRadius: "6px"
                    }}>
                      <span style={{ 
                        fontSize: "1.2rem",
                        background: nodeAddress ? "#28a745" : "rgba(255, 255, 255, 0.3)",
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}>
                        {nodeAddress ? "✓" : "2"}
                      </span>
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: "0.95rem" }}>{t("quickStart.step2Title")}</strong>
                        {!nodeAddress && (
                          <span style={{ color: "#ffc107", fontSize: "0.85rem", marginLeft: "0.5rem" }}>{t("common.loading")}</span>
                        )}
                      </div>
                    </div>

                    {/* Step 3: Start Mining */}
                    <div style={{ 
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem",
                      background: "rgba(255, 255, 255, 0.15)",
                      borderRadius: "6px"
                    }}>
                      <span style={{ 
                        fontSize: "1.2rem",
                        background: (isMining || clusterMining) ? "#28a745" : "rgba(255, 255, 255, 0.3)",
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}>
                        {(isMining || clusterMining) ? "✓" : "3"}
                      </span>
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: "0.95rem" }}>{t("quickStart.step3Title")}</strong>
                        {!(isMining || clusterMining) && nodeAddress && (
                          <button
                            className="btn"
                            onClick={() => {
                              setActiveTab("mining");
                            }}
                            style={{ 
                              background: "white", 
                              color: "#667eea",
                              padding: "0.4rem 0.8rem",
                              fontSize: "0.85rem",
                              marginLeft: "0.5rem"
                            }}
                          >
                            {t("quickStart.step3Action")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Phase 27: Local Instance Status */}
              {localRole && (
                <div className="status-card" style={{ 
                  background: localRole === "LEADER" ? "#e7f3ff" : "#fff3cd",
                  border: localRole === "LEADER" ? "2px solid #667eea" : "2px solid #ffc107",
                  marginBottom: "1.5rem"
                }}>
                  <h2>🖥️ {t("overview.localInstanceStatus")}</h2>
                  <div className="status-item">
                    <span className="label">{t("overview.role")}:</span>
                    <span className="value" style={{ 
                      fontWeight: "bold",
                      color: localRole === "LEADER" ? "#667eea" : "#ffc107"
                    }}>
                      {localRole === "LEADER" 
                        ? t("overview.leader")
                        : t("overview.follower")}
                    </span>
                  </div>
                  {leaderInfo && (
                    <>
                      <div className="status-item">
                        <span className="label">{t("overview.leaderInstance")}:</span>
                        <span className="value" style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
                          {leaderInfo.instanceId.substring(0, 20)}...
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("tools.leaderHeight")}:</span>
                        <span className="value">{leaderInfo.height}</span>
                      </div>
                    </>
                  )}
                  {localRole === "FOLLOWER" && (
                    <div style={{ 
                      marginTop: "0.75rem", 
                      padding: "0.75rem", 
                      background: "rgba(255, 193, 7, 0.1)",
                      borderRadius: "4px",
                      fontSize: "0.85rem",
                      color: "#856404"
                    }}>
                      {t("tools.followerReadOnly")}
                    </div>
                  )}
                  {localConflictDetected && (
                    <div style={{ 
                      marginTop: "0.75rem", 
                      padding: "0.75rem", 
                      background: "#f8d7da",
                      borderRadius: "4px",
                      fontSize: "0.85rem",
                      color: "#721c24"
                    }}>
                      {t("localStateSync.localForkConflict")}
                    </div>
                  )}
                  
                  {/* Phase 29: Local State Sync Status */}
                  <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #ddd" }}>
                    <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
                      {t("localStateSync.title")}
                    </h3>
                    <div className="status-item">
                      <span className="label">{t("localStateSync.syncStatus")}:</span>
                      <span className="value">
                        {localStateSyncInfo.syncStatus === "synced" ? (
                          <span style={{ color: "#28a745" }}>✓ {t("localStateSync.synced")}</span>
                        ) : localStateSyncInfo.syncStatus === "syncing" ? (
                          <span style={{ color: "#ffc107" }}>⟳ {t("localStateSync.syncing")}</span>
                        ) : localStateSyncInfo.syncStatus === "out_of_sync" ? (
                          <span style={{ color: "#dc3545" }}>⚠ {t("localStateSync.outOfSync")}</span>
                        ) : (
                          <span style={{ color: "#dc3545" }}>✗ {t("localStateSync.error")}</span>
                        )}
                      </span>
                    </div>
                    {localStateSyncInfo.syncStatus === "syncing" && (
                      <div style={{ 
                        marginTop: "0.5rem", 
                        padding: "0.5rem", 
                        background: "#fff3cd", 
                        borderRadius: "4px", 
                        border: "1px solid #ffc107",
                        fontSize: "0.85rem",
                        color: "#856404"
                      }}>
                        {t("localStateSync.resyncingFromSnapshot")}
                      </div>
                    )}
                    {localStateSyncInfo.lastSyncEpoch > 0 && (
                      <>
                        <div className="status-item">
                          <span className="label">{t("localStateSync.lastSyncHeight")}:</span>
                          <span className="value">{localStateSyncInfo.lastSyncEpoch}</span>
                        </div>
                        <div className="status-item">
                          <span className="label">{t("localStateSync.lastSyncTime")}:</span>
                          <span className="value" style={{ fontSize: "0.85rem" }}>
                            {new Date(localStateSyncInfo.lastSyncTime).toLocaleTimeString()}
                          </span>
                        </div>
                      </>
                    )}
                    {localStateSyncInfo.error && (
                      <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f8d7da", borderRadius: "4px", border: "1px solid #dc3545", fontSize: "0.85rem", color: "#721c24" }}>
                        {t("localStateSync.error")}: {localStateSyncInfo.error}
                      </div>
                    )}
                    
                    {/* Consistency Check */}
                    <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #eee" }}>
                      <div className="status-item">
                        <span className="label">{t("localStateSync.consistencyCheck")}:</span>
                        <span className="value">
                          {consistencyCheck.isConsistent ? (
                            <span style={{ color: "#28a745" }}>✓ {t("localStateSync.consistent")}</span>
                          ) : (
                            <span style={{ color: "#dc3545" }}>✗ {t("localStateSync.inconsistent")}</span>
                          )}
                        </span>
                      </div>
                      {!consistencyCheck.isConsistent && (
                        <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.25rem" }}>
                          {!consistencyCheck.tipHashMatch && (
                            <div>⚠ {t("localStateSync.tipHashMismatch")}</div>
                          )}
                          {!consistencyCheck.heightMatch && (
                            <div>⚠ {t("localStateSync.heightMismatch")}</div>
                          )}
                          {!consistencyCheck.stateCommitmentMatch && (
                            <div>⚠ {t("localStateSync.stateCommitmentMismatch")}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Stats Grid */}
              <div className="grid-3" style={{ marginBottom: "1.5rem" }}>
                {/* Chain Status Card */}
                <div className="status-card">
                  <h2>📊 {t("overview.chainStatus")}</h2>
                  <div className="status-item">
                    <span className="label">{t("chain.currentHeight")}:</span>
                    <span className="value" style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#667eea" }}>
                      {height}
                    </span>
                  </div>
                  {syncStatus.networkHeight > 0 ? (
                    <>
                      <div className="status-item">
                          <span className="label">{t("localStateSync.networkHeight")}:</span>
                        <span className="value" style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#28a745" }}>
                          {syncStatus.networkHeight}
                        </span>
                      </div>
                      {syncStatus.behindBy > 0 && (
                        <div className="status-item" style={{ marginTop: "0.75rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                            <span className="label" style={{ fontSize: "0.9rem" }}>
                              {t("localStateSync.syncProgress")}
                            </span>
                            <span style={{ fontSize: "0.85rem", color: "#666" }}>
                              {syncStatus.localHeight} / {syncStatus.networkHeight} ({syncStatus.behindBy} {t("localStateSync.behind")})
                            </span>
                          </div>
                          <div style={{ 
                            width: "100%", 
                            height: "20px", 
                            background: "#e9ecef", 
                            borderRadius: "10px",
                            overflow: "hidden",
                            position: "relative"
                          }}>
                            <div style={{
                              width: `${syncStatus.progress}%`,
                              height: "100%",
                              background: syncStatus.isSyncing ? "linear-gradient(90deg, #667eea, #764ba2)" : "#28a745",
                              transition: "width 0.3s ease",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "white",
                              fontSize: "0.7rem",
                              fontWeight: "bold"
                            }}>
                              {syncStatus.progress > 10 ? `${Math.round(syncStatus.progress)}%` : ""}
                            </div>
                          </div>
                          {syncStatus.isSyncing && (
                            <div style={{ 
                              marginTop: "0.5rem", 
                              fontSize: "0.85rem", 
                              color: "#667eea",
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem"
                            }}>
                              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
                              {syncMessage || t("localStateSync.syncingMessage")}
                            </div>
                          )}
                          {syncMessage && !syncStatus.isSyncing && (
                            <div style={{ 
                              marginTop: "0.5rem", 
                              fontSize: "0.85rem", 
                              color: "#667eea",
                              padding: "0.5rem",
                              background: "#f0f0f0",
                              borderRadius: "4px"
                            }}>
                              {syncMessage}
                            </div>
                          )}
                        </div>
                      )}
                      {syncStatus.behindBy === 0 && syncStatus.networkHeight > 0 && (
                        <div style={{ 
                          marginTop: "0.5rem", 
                          padding: "0.5rem", 
                          background: "#d4edda", 
                          borderRadius: "4px", 
                          border: "1px solid #28a745",
                          fontSize: "0.85rem",
                          color: "#155724"
                        }}>
                          ✓ {t("overview.syncedToLatest")}
                        </div>
                      )}
                    </>
                  ) : isP2PConnected ? (
                    <div style={{ 
                      marginTop: "0.5rem", 
                      padding: "0.75rem", 
                      background: "#fff3cd", 
                      borderRadius: "4px", 
                      border: "1px solid #ffc107",
                      fontSize: "0.85rem",
                      color: "#856404"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                        <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
                        <strong>{t("overview.waitingForPeerConnections")}</strong>
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.25rem" }}>
                        {t("overview.waitingForPeerConnectionsDesc", { count: peerCount })}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid rgba(0,0,0,0.1)" }}>
                        {t("overview.waitingForPeerConnectionsTip")}
                      </div>
                    </div>
                  ) : null}
                  {finalityStats && (
                    <div className="status-item">
                      <span className="label">{t("network.finalizedBlocks")}:</span>
                      <span className="value" style={{ color: "#28a745", fontWeight: "bold" }}>
                        {finalityStats.finalizedCount}
                      </span>
                    </div>
                  )}
                  <div className="status-item">
                    <span className="label">{t("chain.blockCount")}:</span>
                    <span className="value">{blockCount}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("chain.pendingTxs")}:</span>
                    <span className="value">{pendingTxs.length}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("chain.mining")}:</span>
                    <span className="value">
                      {isMining || clusterMining ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>{t("status.active")}</span>
                      ) : (
                        <span style={{ color: "#666" }}>{t("status.inactive")}</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Network Status Card */}
                <div className="status-card">
                  <h2>🌐 {t("overview.networkStatus")}</h2>
                  <div className="status-item">
                    <span className="label">{t("network.status")}:</span>
                    <span className="value">
                      {isP2PConnected ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>{t("status.connected")}</span>
                      ) : (
                        <span style={{ color: "#dc3545" }}>{t("status.disconnected")}</span>
                      )}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("network.peers")}:</span>
                    <span className="value">{peerCount}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("network.mode")}:</span>
                    <span className="value">
                      {isMainnetMode ? (
                        <span style={{ color: "#28a745" }}>{t("network.mainnet")}</span>
                      ) : (
                        <span style={{ color: "#ffc107" }}>{t("network.dev")}</span>
                      )}
                    </span>
                  </div>
                  {/* Phase 30: Network Health Status */}
                  {(() => {
                    const minPeersRequired = chainContext?.params?.minPeersRequired ?? 3;
                    const isHealthy = isMainnetMode && 
                      isP2PConnected && 
                      peerCount >= minPeersRequired && 
                      miningGuardResult?.ok === true;
                    const isDegraded = isMainnetMode && 
                      isP2PConnected && 
                      (peerCount < minPeersRequired || (miningGuardResult && !miningGuardResult.ok && miningGuardResult.code === "NOT_FINALIZED"));
                    
                    return (
                      <div className="status-item" style={{ 
                        marginTop: "0.75rem", 
                        paddingTop: "0.75rem", 
                        borderTop: "1px solid #e9ecef",
                        padding: "0.75rem",
                        background: isHealthy ? "#d4edda" : isDegraded ? "#fff3cd" : "#f8d7da",
                        borderRadius: "6px",
                        border: `2px solid ${isHealthy ? "#28a745" : isDegraded ? "#ffc107" : "#dc3545"}`
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                          <span className="label" style={{ fontWeight: "bold" }}>
                            {t("networkHealth.label")}
                          </span>
                          <span className="value" style={{ 
                            color: isHealthy ? "#28a745" : isDegraded ? "#ffc107" : "#dc3545",
                            fontWeight: "bold",
                            fontSize: "1rem"
                          }}>
                            {isHealthy 
                              ? t("networkHealth.healthyOnMainnet")
                              : isDegraded
                              ? t("networkHealth.degraded")
                              : t("networkHealth.blocked")
                            }
                          </span>
                        </div>
                        {isHealthy && (
                          <div style={{ fontSize: "0.85rem", color: "#155724", marginTop: "0.25rem" }}>
                            {t("networkHealth.healthyMiningTip")}
                          </div>
                        )}
                        {/* Phase 33: Mining Ready Status with Mode */}
                        {miningGuardResult && (() => {
                          // Import MiningGuard synchronously for UI rendering
                          let modeColor = "#dc3545";
                          let modeDescription = "";
                          let statusMessage = "";
                          
                          // Use dynamic import result if available, otherwise compute inline
                          if (miningGuardResult.mode) {
                            // Determine color based on mode
                            switch (miningGuardResult.mode) {
                              case "SAFE":
                                modeColor = "#28a745";
                                modeDescription = t("networkHealth.safeMiningDesc");
                                break;
                              case "GUARDED":
                                modeColor = "#ffc107";
                                modeDescription = t("networkHealth.degradedMiningDesc");
                                break;
                              case "LOCAL_ONLY":
                                modeColor = "#17a2b8";
                                modeDescription = t("networkHealth.localOnlyMiningDesc");
                                break;
                              default:
                                modeColor = "#dc3545";
                                modeDescription = t("networkHealth.cannotMineDesc");
                            }
                            
                            // Get status message
                            if (miningGuardResult.ok) {
                              switch (miningGuardResult.mode) {
                                case "SAFE":
                                  statusMessage = locale === "zh" 
                                    ? "✅ 挖矿就绪：安全模式（网络健康）" 
                                    : "✅ Mining Ready: SAFE (Network Healthy)";
                                  break;
                                case "GUARDED":
                                  // Phase 45: First year mode: requiredQuorumScore is 40 (or <= 50 for compatibility)
                                  const isFirstYearMode = miningGuardResult.details?.requiredQuorumScore !== undefined && miningGuardResult.details.requiredQuorumScore <= 50;
                                  if (isFirstYearMode) {
                                    const independentPeers = miningGuardResult.details?.independentPeerCount || 0;
                                    const quorumScore = miningGuardResult.details?.quorumScore || 0;
                                    const requiredQuorumScore = miningGuardResult.details?.requiredQuorumScore || 40;
                                    statusMessage = `🟡 ${t("networkHealth.miningReady")}: ${t("networkHealth.guardedMode")} (${t("mainnetAdmission.firstYearMode")}, ${independentPeers} ${t("network.independentPeers")}, Quorum ${quorumScore}/${requiredQuorumScore})`;
                                  } else {
                                    const peerCount = miningGuardResult.details?.peerCount || 0;
                                    const minPeersRequired = chainContext?.params?.minPeersRequired ?? 3;
                                    const requiredPeers = miningGuardResult.details?.requiredIndependentPeers ?? miningGuardResult.details?.requiredPeers ?? minPeersRequired;
                                    statusMessage = `🟡 ${t("networkHealth.miningReady")}: ${t("networkHealth.guardedMode")} (${t("network.independentPeers")}: ${peerCount} < ${requiredPeers})`;
                                  }
                                  break;
                                case "LOCAL_ONLY":
                                  statusMessage = `🔵 ${t("networkHealth.miningReady")}: ${t("networkHealth.localOnlyMode")}`;
                                  break;
                              }
                            }
                          }
                          
                          return (
                            <>
                              <div style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                                <span className="label">{t("networkHealth.miningReady")}:</span>
                                <span className="value" style={{ 
                                  color: modeColor,
                                  fontWeight: "bold",
                                  marginLeft: "0.5rem"
                                }}>
                                  {statusMessage || (miningGuardResult.ok 
                                    ? t("networkHealth.safe")
                                    : t("networkHealth.blocked"))}
                                </span>
                                {miningGuardResult.ok && miningGuardResult.mode && (
                                  <div style={{ 
                                    marginTop: "0.25rem", 
                                    fontSize: "0.75rem", 
                                    color: "#666",
                                    paddingLeft: "0.5rem"
                                  }}>
                                    {modeDescription}
                                  </div>
                                )}
                                {!miningGuardResult.ok && miningGuardResult.reason && (
                                  <div style={{ 
                                    marginTop: "0.25rem", 
                                    fontSize: "0.75rem", 
                                    color: "#666",
                                    paddingLeft: "0.5rem"
                                  }}>
                                    {miningGuardResult.reason}
                                  </div>
                                )}
                              </div>
                              
                              {/* Health Status Indicator */}
                              <div style={{ 
                                marginTop: "1rem", 
                                padding: "0.75rem", 
                                background: miningGuardResult.ok 
                                  ? (miningGuardResult.mode === "SAFE" 
                                      ? "rgba(40, 167, 69, 0.1)" 
                                      : miningGuardResult.mode === "GUARDED"
                                      ? "rgba(255, 193, 7, 0.1)"
                                      : "rgba(23, 162, 184, 0.1)")
                                  : "rgba(220, 53, 69, 0.1)",
                                borderRadius: "6px",
                                border: `1px solid ${modeColor}`,
                                fontSize: "0.9rem"
                              }}>
                                <div style={{ fontWeight: "bold", marginBottom: "0.25rem", color: modeColor }}>
                                  {miningGuardResult.ok 
                                    ? (miningGuardResult.mode === "SAFE"
                                        ? t("networkHealth.safeMode")
                                        : miningGuardResult.mode === "GUARDED"
                                        ? t("networkHealth.guardedMode")
                                        : t("networkHealth.localOnlyMode"))
                                    : t("networkHealth.blocked")
                                  }
                                </div>
                                {miningGuardResult.ok && (
                                  <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                                    {modeDescription}
                                  </div>
                                )}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    );
                  })()}
                </div>

                {/* Wallet Status Card */}
                <div className="status-card">
                  <h2>💼 {t("overview.walletStatus")}</h2>
                  <div className="status-item">
                    <span className="label">{t("wallet.address")}:</span>
                    <span className="value" style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>
                      {nodeAddress ? formatAddress(nodeAddress, 10, 10) : t("common.loading")}
                    </span>
                  </div>
                  {nodeAddress && chainContext && (
                    <div className="status-item">
                      <span className="label">{t("wallet.balance")}:</span>
                      <span className="value" style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#667eea" }}>
                        {formatNumber(chainContext.indexState.getBalance(nodeAddress as any), 2, locale === "zh" ? "zh-CN" : "en-US")} IDC
                      </span>
                    </div>
                  )}
                  <div className="status-item">
                    <span className="label">{t("wallet.nodeId")}:</span>
                    <span className="value" style={{ fontSize: "0.8rem" }}>
                      {formatAddress(getOrCreateBrowserNodeId(), 8, 8)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Latest Block - Compact View */}
              {tip && tip.header && (
                <div className="status-card">
                  <h2>📦 {t("chain.latestBlock")}</h2>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>
                    <div className="status-item">
                      <span className="label">{t("chain.height")}:</span>
                      <span className="value" style={{ fontWeight: "bold" }}>{tip.header?.height ?? 0}</span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("chain.transactions")}:</span>
                      <span className="value">{tip.txs.length}</span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("chain.difficulty")}:</span>
                      <span className="value">{tip.header.difficulty}</span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("chain.nonce")}:</span>
                      <span className="value" style={{ fontSize: "0.85rem" }}>{formatInteger(tip.header.nonce, locale === "zh" ? "zh-CN" : "en-US")}</span>
                    </div>
                  </div>
                  <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #e9ecef" }}>
                    <span className="label">{t("chain.hash")}:</span>
                    <span className="value" style={{ fontSize: "0.75rem", wordBreak: "break-all", fontFamily: "monospace" }}>
                      {formatAddress(tip.hash, 12, 12)}
                    </span>
                  </div>
                  {tip.header.stateCommitment && (
                    <div className="status-item" style={{ marginTop: "0.5rem" }}>
                      <span className="label">{t("chain.stateCommitment")}:</span>
                      <span className="value" style={{ fontSize: "0.75rem", wordBreak: "break-all", fontFamily: "monospace" }}>
                        {tip.header.stateCommitment.substring(0, 24)}...
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Wallet Tab */}
          {activeTab === "wallet" && (
            <div className="tab-content active">
              {/* Phase 24: Multi-Wallet Manager */}
              <div className="status-card">
                <h2>💼 {t("wallet.manager")}</h2>
                <WalletManagerPanel
                  onWalletChanged={async () => {
                    // Reload address after wallet change
                    const address = await getOrCreateNodeAddress();
                    setNodeAddress(address);
                  }}
                  onError={(err) => {
                    setError(err);
                  }}
                />
              </div>
              
              {/* Phase 23: Backup & Recovery */}
              <div className="status-card">
                <h2>🔐 {t("wallet.backup")}</h2>
                <WalletBackupPanel
                  onExportSuccess={() => {
                    setError(t("wallet.exportSuccess"));
                    setTimeout(() => setError(""), 5000);
                  }}
                  onImportSuccess={async () => {
                    // Reload address after import
                    const address = await getOrCreateNodeAddress();
                    setNodeAddress(address);
                    setError(t("wallet.importSuccess"));
                    setTimeout(() => setError(""), 5000);
                  }}
                  onError={(err) => {
                    setError(err);
                  }}
                />
              </div>
            </div>
          )}

          {/* Mining Tab */}
          {activeTab === "mining" && (
            <div className="tab-content active">
              {/* Phase 38: Mining UX & Onboarding */}
              {/* Phase 38-E: Network Stage & Cold Start Banner */}
              {chainContext && bootstrapComplete && peerCount === 0 && (
                <div
                  className="status-card"
                  style={{
                    marginBottom: "1.5rem",
                    background: "rgba(255, 193, 7, 0.1)",
                    border: "2px solid #ffc107",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "1.5rem" }}>⚠️</span>
                    <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#856404" }}>
                      {t("coldStart.title")}
                    </h3>
                  </div>
                  <div style={{ fontSize: "0.9rem", color: "#856404" }}>
                    {t("coldStart.description")}
                  </div>
                </div>
              )}

              {/* Phase 38-E: Mainnet Mature Stage Requirements */}
              {/* Show admission rules for mainnet, even if mining is allowed (first year mode) */}
              {chainContext &&
                chainContext.params?.networkId === "IXC_MAINNET_V1" &&
                miningGuardResult &&
                miningGuardResult.details &&
                (miningGuardResult.details.independentPeerCount !== undefined || 
                 miningGuardResult.details.quorumScore !== undefined) && (
                  <div
                    className="status-card"
                    style={{
                      marginBottom: "1.5rem",
                      // First year mode: show green/yellow if mining allowed, red if blocked
                      background: miningGuardResult.ok 
                        ? (miningGuardResult.mode === "SAFE" ? "rgba(40, 167, 69, 0.1)" : "rgba(255, 193, 7, 0.1)")
                        : "rgba(220, 53, 69, 0.1)",
                      border: `2px solid ${
                        miningGuardResult.ok 
                          ? (miningGuardResult.mode === "SAFE" ? "#28a745" : "#ffc107")
                          : "#dc3545"
                      }`,
                    }}
                  >
                    <h3 style={{ 
                      margin: 0, 
                      marginBottom: "1rem", 
                      fontSize: "1.1rem", 
                      color: miningGuardResult.ok 
                        ? (miningGuardResult.mode === "SAFE" ? "#155724" : "#856404")
                        : "#721c24"
                    }}>
                      {t("app.mainnetAdmissionRules")}
                      {miningGuardResult.ok && miningGuardResult.details?.requiredQuorumScore !== undefined && miningGuardResult.details.requiredQuorumScore <= 50 && (
                        <span style={{ fontSize: "0.85rem", marginLeft: "0.5rem", fontWeight: "normal" }}>
                          ({t("mainnetAdmission.firstYearMode")})
                        </span>
                      )}
                    </h3>
                    <ul style={{ marginTop: "0.5rem", paddingLeft: "0", fontSize: "0.85rem", listStyle: "none" }}>
                      {miningGuardResult.details?.independentPeerCount !== undefined &&
                        miningGuardResult.details?.requiredIndependentPeers !== undefined && (() => {
                          const passed = miningGuardResult.details.independentPeerCount >= miningGuardResult.details.requiredIndependentPeers;
                          return (
                            <li style={{ 
                              marginBottom: "0.75rem",
                              padding: "0.75rem",
                              background: passed ? "rgba(40, 167, 69, 0.1)" : "rgba(220, 53, 69, 0.1)",
                              borderRadius: "6px",
                              border: `1px solid ${passed ? "#28a745" : "#dc3545"}`,
                              color: passed ? "#155724" : "#721c24"
                            }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                                <span style={{ fontSize: "1.2rem" }}>{passed ? "✅" : "❌"}</span>
                                <span style={{ fontWeight: "bold" }}>
                                  {locale === "zh"
                                    ? `规则 1: 需要至少 ${miningGuardResult.details.requiredIndependentPeers} 个独立节点 (当前: ${miningGuardResult.details.independentPeerCount})`
                                    : `Rule 1: At least ${miningGuardResult.details.requiredIndependentPeers} independent peers required (current: ${miningGuardResult.details.independentPeerCount})`}
                                </span>
                              </div>
                              <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#666", fontStyle: "italic", marginLeft: "1.75rem" }}>
                                {(() => {
                                  // Phase 45: First year mode: requiredQuorumScore is 40 (or <= 50 for compatibility)
                                  const isFirstYearMode = miningGuardResult.details?.requiredQuorumScore !== undefined && miningGuardResult.details.requiredQuorumScore <= 50;
                                  if (isFirstYearMode) {
                                    return locale === "zh"
                                      ? `💡 第一年模式：需要至少 2 个独立节点（来自不同 IP 地址）。同一台电脑的多个标签页不算独立节点。第一年规则更宽松，便于网络启动。`
                                      : `💡 First Year Mode: At least 2 independent peers (from different IP addresses) required. Multiple tabs on the same computer don't count. First year rules are more relaxed for easier network startup.`;
                                  } else {
                                    return locale === "zh"
                                      ? `💡 解释：独立节点是指来自不同 IP 地址的节点。同一台电脑的多个标签页或同一网络的节点不算独立节点。这是为了确保网络去中心化和防止单点故障。`
                                      : `💡 Explanation: Independent peers are nodes from different IP addresses. Multiple tabs on the same computer or nodes on the same network don't count as independent. This ensures network decentralization and prevents single points of failure.`;
                                  }
                                })()}
                              </div>
                            </li>
                          );
                        })()}
                      {miningGuardResult.details?.quorumScore !== undefined &&
                        miningGuardResult.details?.requiredQuorumScore !== undefined && (() => {
                          const passed = miningGuardResult.details.quorumScore >= miningGuardResult.details.requiredQuorumScore;
                          // Phase 45: First year mode: requiredQuorumScore is 40 (or <= 50 for compatibility)
                          const isFirstYearMode = miningGuardResult.details.requiredQuorumScore !== undefined && miningGuardResult.details.requiredQuorumScore <= 50;
                          return (
                            <QuorumScoreExplanation
                              passed={passed}
                              currentScore={miningGuardResult.details.quorumScore}
                              requiredScore={miningGuardResult.details.requiredQuorumScore}
                              locale={locale}
                              isFirstYearMode={isFirstYearMode}
                            />
                          );
                        })()}
                      {localRole === "FOLLOWER" && (
                        <li>
                          {locale === "zh"
                            ? t("mainnetAdmission.rule4")
                            : "Rule 4: Only LEADER tab can mine on mainnet"}
                        </li>
                      )}
                    </ul>
                  </div>
                )}

              {/* Phase 38-E: Follower Mode Warning */}
              {chainContext &&
                chainContext.params?.networkId === "IXC_MAINNET_V1" &&
                localRole === "FOLLOWER" && (
                  <div
                    className="status-card"
                    style={{
                      marginBottom: "1.5rem",
                      background: "rgba(23, 162, 184, 0.1)",
                      border: "2px solid #17a2b8",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "1.5rem" }}>ℹ️</span>
                      <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#0c5460" }}>
                        {t("app.followerMode")}
                      </h3>
                    </div>
                    <div style={{ fontSize: "0.9rem", color: "#0c5460", marginBottom: "0.5rem" }}>
                      {t("localInstance.followerModeDesc")}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#0c5460" }}>
                      {t("localInstance.followerModeTip")}
                    </div>
                  </div>
                )}

              {/* Phase 45: Mining Status Bar */}
              {chainContext && (
                <>
                  <MiningStatusBar
                    chainContext={chainContext}
                    p2pNode={p2pNodeRef.current}
                    finalityManager={finalityManager}
                    localRole={localRole}
                    bootstrapComplete={bootstrapComplete}
                    nodeAddress={nodeAddress}
                    miningWalletAddress={(() => {
                      try {
                        const walletStore = getMultiWalletStore();
                        const miningWallet = walletStore.getMiningWallet();
                        return miningWallet ? miningWallet.address : null;
                      } catch (e) {
                        return null;
                      }
                    })()}
                    isMining={isMining}
                    clusterMining={clusterMining}
                    shadowNodeClient={shadowNodeRef.current}
                    deviceId={(() => {
                      try {
                        return getOrCreateDeviceId();
                      } catch (e) {
                        return null;
                      }
                    })()}
                    onShowDetails={() => {
                      setActiveTab("network");
                      // Could also open NetworkHealthPanel directly
                    }}
                    locale={locale}
                  />

                  {/* Mining Main Card - Top-level control (操作控件放在上面) */}
                  <MiningMainCard
                    chainContext={chainContext}
                    p2pNode={p2pNodeRef.current}
                    finalityManager={finalityManager}
                    localRole={localRole}
                    bootstrapComplete={bootstrapComplete}
                    nodeAddress={nodeAddress}
                    isMining={isMining}
                    clusterMining={clusterMining}
                    miningMode={miningMode}
                    autoMining={autoMining}
                    onAutoMiningChange={(enabled) => {
                      setAutoMining(enabled);
                    }}
                    onStartMining={() => {
                      // Check if first time - show onboarding
                      // Phase 39: Use ref to check immediately (avoids async state update issue)
                      if (!onboardingCompletedRef.current && !isMining && !clusterMining) {
                        setShowOnboarding(true);
                        return;
                      }
                      
                      if (miningMode === "global-pool") {
                        // Global pool mode - handled separately
                        if (!globalPoolEnabled) {
                          setGlobalPoolEnabled(true);
                        }
                        return;
                      } else if (miningMode === "cluster" || clusterWorkerCount > 1) {
                        handleStartClusterMining();
                      } else {
                        handleStartMining();
                      }
                    }}
                    onStopMining={() => {
                      if (clusterMining) {
                        handleStopClusterMining();
                      } else {
                        handleStopMining();
                      }
                    }}
                    locale={locale}
                    pendingInviteAddress={pendingInviteAddress}
                    currentReferrerAddress={currentReferrerAddress}
                    onInviteCodeSubmit={async (code: string) => {
                      try {
                        const { parseReferralCode } = await import("../core/referralSystem.js");
                        let inviteAddress: string | null = null;
                        
                        // Try to parse as referral code (base64 encoded address)
                        inviteAddress = parseReferralCode(code);
                        
                        // If not a code, try direct address format
                        if (!inviteAddress && code.startsWith("idc_")) {
                          inviteAddress = code;
                        }
                        
                        if (inviteAddress) {
                          setPendingInviteAddress(inviteAddress);
                          setSuccessMessage(
                            locale === "zh"
                              ? `✅ 邀请地址已保存，将在开始挖矿时自动绑定`
                              : `✅ Invite address saved, will bind automatically when mining starts`
                          );
                          setTimeout(() => setSuccessMessage(""), 5000);
                        } else {
                          setError(
                            locale === "zh"
                              ? "❌ 无效的邀请码格式，请检查后重试"
                              : "❌ Invalid invite code format, please check and try again"
                          );
                        }
                      } catch (error) {
                        console.error("[App] Failed to parse invite code:", error);
                        setError(
                          locale === "zh"
                            ? "❌ 处理邀请码时出错，请重试"
                            : "❌ Error processing invite code, please try again"
                        );
                      }
                    }}
                  />

                  {/* Phase 38: Live Stats Card (挖矿时的实时统计，也是操作相关) */}
                  {(isMining || clusterMining) && tip && tip.header && (
                    <MiningLiveStatsCard
                      miningMode={miningMode}
                      currentHeight={tip.header?.height ?? 0}
                      tipHash={tip.hash}
                      totalHashRate={clusterMining ? (clusterStats.totalHashRate || 0) : (miningStats.hashRate || 0)}
                      blocksMined={_miningEffectiveness?.totalBlocksMined || 0}
                      blocksAccepted={_miningEffectiveness?.acceptedBlocks || 0}
                      blocksRejected={_miningEffectiveness?.rejectedBlocks || 0}
                      locale={locale}
                    />
                  )}

                  {/* 分隔线：操作控件和介绍性内容 */}
                  <div style={{
                    margin: "2rem 0",
                    borderTop: "2px solid #e9ecef",
                    paddingTop: "2rem"
                  }}>
                    <h3 style={{
                      margin: "0 0 1.5rem 0",
                      fontSize: "1.1rem",
                      color: "#6c757d",
                      fontWeight: "normal"
                    }}>
                      {t("app.rewardsNetworkInfo")}
                    </h3>
                  </div>

                  {/* Phase 45: Reward Breakdown Card (介绍性内容，移到下面) */}
                  <RewardBreakdownCard
                    chainContext={chainContext}
                    p2pNode={p2pNodeRef.current}
                    minerAddress={(() => {
                      try {
                        const walletStore = getMultiWalletStore();
                        const miningWallet = walletStore.getMiningWallet();
                        return miningWallet ? miningWallet.address : nodeAddress;
                      } catch (e) {
                        return nodeAddress;
                      }
                    })()}
                    locale={locale}
                  />

                  {/* Phase 45: Referral & Booster Card (介绍性内容，移到下面) */}
                  <ReferralAndBoosterCard
                    minerAddress={(() => {
                      try {
                        const walletStore = getMultiWalletStore();
                        const miningWallet = walletStore.getMiningWallet();
                        return miningWallet ? miningWallet.address : nodeAddress;
                      } catch (e) {
                        return nodeAddress;
                      }
                    })()}
                    currentHeight={tip?.header?.height || 0}
                    locale={locale}
                  />

                  {/* Phase 45: Network Mini Health Card (介绍性内容，移到下面) */}
                  <NetworkMiniHealthCard
                    chainContext={chainContext}
                    p2pNode={p2pNodeRef.current}
                    finalityManager={finalityManager}
                    localRole={localRole}
                    bootstrapComplete={bootstrapComplete}
                    nodeAddress={nodeAddress}
                    locale={locale}
                  />

                  {/* Phase 38: Advanced Settings Toggle */}
                  <div style={{ marginBottom: "1rem" }}>
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      style={{
                        padding: "0.75rem 1.5rem",
                        background: showAdvanced ? "#667eea" : "white",
                        color: showAdvanced ? "white" : "#667eea",
                        border: "1px solid #667eea",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                        fontWeight: "bold",
                      }}
                    >
                      {showAdvanced
                        ? t("app.hideAdvancedSettings")
                        : t("app.showAdvancedSettings")}
                    </button>
                  </div>

                  {/* Phase 38: Advanced Settings Panel */}
                  {showAdvanced && chainContext && (
                    <div className="status-card" style={{ marginBottom: "1.5rem" }}>
                      <h2 style={{ marginBottom: "1.5rem" }}>
                        {t("app.advancedSettings")}
                      </h2>

                      {/* Mining Mode Selector */}
                      <MiningModeSelector
                        miningMode={miningMode}
                        onModeChange={(mode) => {
                          setMiningMode(mode);
                          if (mode === "global-pool") {
                            setGlobalPoolEnabled(true);
                          } else if (mode === "cluster") {
                            // Ensure cluster worker count is set
                            if (clusterWorkerCount <= 1) {
                              setClusterWorkerCount(runtimeManager?.getDeviceCapability().recommendedWorkers || 4);
                            }
                          }
                        }}
                        isFollower={localRole === "FOLLOWER"}
                        canUseGlobalPool={miningGuardResult?.ok && (miningGuardResult.details?.quorumScore || 0) >= 200}
                        globalPoolReason={
                          miningGuardResult?.ok && (miningGuardResult.details?.quorumScore || 0) < 200
                            ? (locale === "zh"
                                ? `需要 Quorum 分数 ≥ 200 (当前: ${miningGuardResult.details?.quorumScore || 0})`
                                : `Requires Quorum score ≥ 200 (current: ${miningGuardResult.details?.quorumScore || 0})`)
                            : undefined
                        }
                        locale={locale}
                      />

                      {/* Performance Presets */}
                      {runtimeManager && (
                        <MiningAdvancedPanel
                          currentProfile={runtimeManager.getRecommendedProfile()}
                          onProfileChange={(profile) => {
                            // Apply profile to runtime manager and cluster
                            if (runtimeManager) {
                              runtimeManager.updateConfig({
                                maxWorkers: profile.workerCount,
                                dutyCycle: profile.dutyCycle,
                              });
                            }
                            setClusterWorkerCount(profile.workerCount);
                            // If mining, restart with new settings
                            if (clusterMining) {
                              handleStopClusterMining();
                              setTimeout(() => {
                                handleStartClusterMining();
                              }, 500);
                            }
                          }}
                          onCustomConfig={(workerCount, dutyCycle) => {
                            if (runtimeManager) {
                              runtimeManager.updateConfig({
                                maxWorkers: workerCount,
                                dutyCycle: dutyCycle,
                              });
                            }
                            setClusterWorkerCount(workerCount);
                            if (clusterMining) {
                              handleStopClusterMining();
                              setTimeout(() => {
                                handleStartClusterMining();
                              }, 500);
                            }
                          }}
                          deviceCapability={runtimeManager.getDeviceCapability()}
                          locale={locale}
                        />
                      )}

                      {/* Mining Readiness Chips */}
                      {miningGuardResult && (
                        <MiningReadinessChipList
                          readinessInfo={{
                            bootstrapCompleted: bootstrapComplete,
                            quorumScore: miningGuardResult.details?.quorumScore,
                            threshold: miningGuardResult.details?.requiredQuorumScore || 80,
                            uniquePeers: miningGuardResult.details?.independentPeerCount || 0,
                            localRole: localRole,
                            details: {
                              syncStatus: miningGuardResult.code === "NOT_SYNCED" ? "syncing" : "synced",
                              behindBy: miningGuardResult.details?.heightDiff || 0,
                            },
                          }}
                          onShowDetails={() => {
                            setActiveTab("network");
                          }}
                          locale={locale}
                        />
                      )}

                      {/* Warnings Panel */}
                      <MiningWarningsPanel
                        warnings={(() => {
                          const warnings: Array<{
                            type: "error" | "warning" | "info";
                            message: string;
                            source: "MiningGuard" | "MinerCluster" | "RuntimeManager";
                          }> = [];

                          // MiningGuard warnings
                          if (miningGuardResult && !miningGuardResult.ok) {
                            warnings.push({
                              type: "error",
                              message: miningGuardResult.reason || t("app.cannotMine"),
                              source: "MiningGuard",
                            });
                          }

                          // RuntimeManager warnings
                          if (runtimeManager) {
                            const metrics = runtimeManager.getPerformanceMetrics();
                            if (metrics.eventLoopLag > 200) {
                              warnings.push({
                                type: "warning",
                                message: locale === "zh"
                                  ? `事件循环延迟: ${metrics.eventLoopLag.toFixed(1)}ms`
                                  : `Event loop lag: ${metrics.eventLoopLag.toFixed(1)}ms`,
                                source: "RuntimeManager",
                              });
                            }
                            if (metrics.fps < 20) {
                              warnings.push({
                                type: "warning",
                                message: locale === "zh" ? `低 FPS: ${metrics.fps}` : `Low FPS: ${metrics.fps}`,
                                source: "RuntimeManager",
                              });
                            }
                            if (metrics.workerCrashes > 3) {
                              warnings.push({
                                type: "warning",
                                message:
                                  locale === "zh"
                                    ? `Worker 崩溃频率高: ${metrics.workerCrashes} 次/分钟`
                                    : `High crash rate: ${metrics.workerCrashes} crashes/min`,
                                source: "RuntimeManager",
                              });
                            }
                          }

                          // MinerCluster warnings
                          if (clusterMining && clusterStats.workers) {
                            const errorWorkers = clusterStats.workers.filter((w) => w.status === "error").length;
                            if (errorWorkers > 0) {
                              warnings.push({
                                type: "warning",
                                message:
                                  locale === "zh"
                                    ? `${errorWorkers} 个 Worker 出现错误，正在自动恢复`
                                    : `${errorWorkers} workers have errors, auto-recovering`,
                                source: "MinerCluster",
                              });
                            }
                          }

                          return warnings;
                        })()}
                        locale={locale}
                      />
                    </div>
                  )}
                </>
              )}

              {/* Phase 38: Onboarding Dialog */}
              {showOnboarding && runtimeManager && (
                <MiningOnboardingDialog
                  deviceCapability={runtimeManager.getDeviceCapability()}
                  onComplete={async (profile, dontShowAgain) => {
                    setShowOnboarding(false);
                    
                    // Always mark onboarding as completed for this session
                    // dontShowAgain only controls whether to persist to localStorage
                    // Phase 39: Update ref immediately to avoid async state update issue
                    onboardingCompletedRef.current = true;
                    setOnboardingCompleted(true);
                    
                    if (dontShowAgain) {
                      localStorage.setItem("mining_onboarding_completed", "true");
                    }
                    
                    // Apply profile
                    if (runtimeManager) {
                      runtimeManager.updateConfig({
                        maxWorkers: profile.workerCount,
                        dutyCycle: profile.dutyCycle,
                      });
                    }
                    setClusterWorkerCount(profile.workerCount);
                    
                    // Start mining based on mode
                    if (miningMode === "cluster" || profile.workerCount > 1) {
                      setTimeout(() => handleStartClusterMining(), 500);
                    } else {
                      setTimeout(() => handleStartMining(), 500);
                    }
                  }}
                  onCancel={() => {
                    setShowOnboarding(false);
                  }}
                  locale={locale}
                />
              )}

              {/* Phase 30: Mining Effectiveness Stats */}
              {_miningEffectiveness && _miningEffectiveness.totalBlocksMined > 0 && (() => {
                const stats = _miningEffectiveness;
                // Check if concerning: acceptedBlocks === 0 && rejectedBlocks > 0 && totalBlocksMined >= 3
                const isConcerning = stats.acceptedBlocks === 0 && stats.rejectedBlocks > 0 && stats.totalBlocksMined >= 3;
                
                if (stats.totalBlocksMined > 0) {
                  return (
                    <div className="status-card" style={{
                      background: isConcerning ? "#fff3cd" : "#d4edda",
                      border: `2px solid ${isConcerning ? "#ffc107" : "#28a745"}`,
                      marginBottom: "1rem"
                    }}>
                      <h2>📊 {t("app.miningEffectiveness")}</h2>
                      <div className="status-item">
                        <span className="label">{t("app.acceptedBlocks")}</span>
                        <span className="value" style={{ color: "#28a745", fontWeight: "bold" }}>
                          {stats.acceptedBlocks}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("app.rejectedOrphaned")}</span>
                        <span className="value" style={{ color: "#dc3545", fontWeight: "bold" }}>
                          {stats.rejectedBlocks}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("app.totalMined")}</span>
                        <span className="value">{stats.totalBlocksMined}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("app.effectiveness")}</span>
                        <span className="value" style={{ 
                          fontSize: "1.2rem", 
                          fontWeight: "bold",
                          color: stats.effectivenessRate >= 50 ? "#28a745" : stats.effectivenessRate >= 10 ? "#ffc107" : "#dc3545"
                        }}>
                          {formatPercent(stats.effectivenessRate, 1)}
                        </span>
                      </div>
                      {isConcerning && (
                        <div style={{
                          marginTop: "0.75rem",
                          padding: "0.75rem",
                          background: "#fff3cd",
                          borderRadius: "4px",
                          border: "1px solid #ffc107"
                        }}>
                          <strong style={{ color: "#856404" }}>
                            ⚠️ {t("miningWarning.wrongChainWarning")}
                          </strong>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
              
              {/* P0-1: Removed duplicate content - Mining Guide, Mining Status Banner, Mining Controls, Mining Status, Cluster Mining Stats, Global Miner Pool */}
              {/* These are now handled by Phase 38 components (MiningMainCard, MiningLiveStatsCard, MiningAdvancedPanel) */}
            </div>
          )}

          {/* Transactions Tab */}
          {activeTab === "transactions" && (
            <div className="tab-content active">
              {/* Phase 7: Transfer Form */}
              <div className="status-card">
                <h2>{t("transactions.transferIdc")}</h2>
                
                {/* Current Balance Display */}
                {nodeAddress && chainContext && (
                  <div style={{ 
                    marginBottom: "1rem", 
                    padding: "0.75rem", 
                    background: "#f0f7ff", 
                    borderRadius: "4px",
                    border: "1px solid #667eea"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: "bold", color: "#333" }}>
                        {t("transactionsExpanded.currentBalance")}:
                      </span>
                      <span style={{ fontSize: "1.3rem", fontWeight: "bold", color: "#667eea" }}>
                        {formatNumber(chainContext.indexState.getBalance(nodeAddress as any), 6, locale === "zh" ? "zh-CN" : "en-US")} IDC
                      </span>
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                      {t("transactionsExpanded.address")}: {formatAddress(nodeAddress, 10, 10)}
                    </div>
                  </div>
                )}

                {/* Success Message */}
                {successMessage && (
                  <div className="success" style={{ 
                    marginBottom: "1rem", 
                    padding: "0.75rem", 
                    borderRadius: "4px",
                    background: "#d4edda",
                    border: "1px solid #c3e6cb",
                    color: "#155724"
                  }}>
                    ✅ {successMessage}
                  </div>
                )}

                {/* Error Message */}
                {error && (
                  <div className="error" style={{ 
                    marginBottom: "1rem", 
                    padding: "0.75rem", 
                    borderRadius: "4px"
                  }}>
                    ❌ {error}
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.9rem", fontWeight: "500" }}>
                      {t("transactionsExpanded.recipientAddress")}
                    </label>
                    <input
                      type="text"
                      placeholder={t("transactions.recipient") + " (e.g., idc_...)"}
                      value={transferTo}
                      onChange={(e) => {
                        setTransferTo(e.target.value);
                        setError(""); // Clear error when typing
                        setSuccessMessage(""); // Clear success message when typing
                      }}
                      style={{ width: "100%", padding: "0.5rem" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.9rem", fontWeight: "500" }}>
                      {t("transactionsExpanded.transferAmount")} (IDC)
                    </label>
                    <input
                      type="number"
                      placeholder={t("transactions.amount")}
                      value={transferAmount}
                      onChange={(e) => {
                        setTransferAmount(e.target.value);
                        setError(""); // Clear error when typing
                        setSuccessMessage(""); // Clear success message when typing
                      }}
                      style={{ width: "100%", padding: "0.5rem" }}
                      min="0"
                      step="0.000001"
                    />
                    {transferAmount && chainContext && nodeAddress && (
                      <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                        {t("transactionsExpanded.balanceAfterTransfer")}:{" "}
                        <span style={{ 
                          fontWeight: "bold",
                          color: parseFloat(transferAmount) > chainContext.indexState.getBalance(nodeAddress as any) ? "#dc3545" : "#28a745"
                        }}>
                          {formatNumber((chainContext.indexState.getBalance(nodeAddress as any) - parseFloat(transferAmount) || 0), 6, locale === "zh" ? "zh-CN" : "en-US")} IDC
                        </span>
                        {parseFloat(transferAmount) > chainContext.indexState.getBalance(nodeAddress as any) && (
                          <span style={{ color: "#dc3545", marginLeft: "0.5rem" }}>
                            ⚠️ {t("transactionsExpanded.insufficientBalance")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      if (!chainContext || !transferTo || !transferAmount) {
                        setError(t("transactionsExpanded.pleaseEnterRecipient"));
                        setSuccessMessage("");
                        return;
                      }
                      const amount = parseFloat(transferAmount);
                      if (isNaN(amount) || amount <= 0) {
                        setError(t("transactionsExpanded.amountMustBePositive"));
                        setSuccessMessage("");
                        return;
                      }
                      // Check balance before transfer
                      if (nodeAddress && chainContext) {
                        const currentBalance = chainContext.indexState.getBalance(nodeAddress as any);
                        if (amount > currentBalance) {
                          setError(t("transactionsExpanded.insufficientBalanceError", { 
                            current: formatNumber(currentBalance, 6, locale === "zh" ? "zh-CN" : "en-US"), 
                            amount: formatNumber(amount, 6, locale === "zh" ? "zh-CN" : "en-US") 
                          }));
                          setSuccessMessage("");
                          return;
                        }
                      }
                      try {
                        setError("");
                        setSuccessMessage("");
                        setIsSigning(true);
                        const tx = await createTransferTx(transferTo as any, amount);
                        const added = await mempool.addTx(tx);
                        if (!added) {
                          setError(t("transactionsExpanded.transferFailed"));
                          setSuccessMessage("");
                          setIsSigning(false);
                          return;
                        }
                        broadcastTransaction(tx, chainContext);
                        setTransferTo("");
                        setTransferAmount("");
                        setChainContext({ ...chainContext });
                        setIsSigning(false);
                        // Show success message
                        setSuccessMessage(t("transactionsExpanded.transferSuccess", { 
                          amount: formatNumber(amount, 6, locale === "zh" ? "zh-CN" : "en-US"), 
                          recipient: formatAddress(transferTo, 10, 10) 
                        }));
                        // Clear success message after 5 seconds
                        setTimeout(() => {
                          setSuccessMessage("");
                        }, 5000);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : t("transactions.transfer"));
                        setSuccessMessage("");
                        setIsSigning(false);
                      }
                    }}
                    disabled={!!(isMining || isSigning || !transferTo || !transferAmount || (chainContext && nodeAddress && !isNaN(parseFloat(transferAmount || "0")) && parseFloat(transferAmount || "0") > chainContext.indexState.getBalance(nodeAddress as any)))}
                  >
                    {isSigning ? t("transactions.signing") : t("transactions.transferIdc")}
                  </button>
                  {isSigning && (
                    <p style={{ fontSize: "0.9rem", color: "#666", marginTop: "0.5rem" }}>
                      {t("transactionsExpanded.signingTransaction")}
                    </p>
                  )}
                </div>
              </div>

              {/* Create Transaction Form */}
              <div className="status-card">
                <h2>{t("transactions.createIndexOp")}</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div>
                    <label>
                      {t("transactions.operationType")}:
                      <select
                        value={txOpType}
                        onChange={(e) =>
                          setTxOpType(e.target.value as "PUT" | "APPEND" | "DELETE")
                        }
                        style={{ marginLeft: "0.5rem", padding: "0.25rem" }}
                      >
                        <option value="PUT">PUT</option>
                        <option value="APPEND">APPEND</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </label>
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder={t("transactions.namespace") + " (e.g., test)"}
                      value={txNamespace}
                      onChange={(e) => setTxNamespace(e.target.value)}
                      style={{ width: "100%", padding: "0.5rem" }}
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder={t("transactions.key")}
                      value={txKey}
                      onChange={(e) => setTxKey(e.target.value)}
                      style={{ width: "100%", padding: "0.5rem" }}
                    />
                  </div>
                  {txOpType !== "DELETE" && (
                    <div>
                      <input
                        type="text"
                        placeholder={t("transactions.value")}
                        value={txValue}
                        onChange={(e) => setTxValue(e.target.value)}
                        style={{ width: "100%", padding: "0.5rem" }}
                      />
                    </div>
                  )}
                  <button
                    className="btn btn-primary"
                    onClick={handleCreateTx}
                    disabled={isMining || isSigning}
                  >
                    {isSigning ? t("transactions.signing") : t("transactions.createTx")}
                  </button>
                  {isSigning && (
                    <p style={{ fontSize: "0.9rem", color: "#666", marginTop: "0.5rem" }}>
                      {t("transactionsExpanded.signingTransaction")}
                    </p>
                  )}
                </div>
              </div>

              {/* Pending Transactions */}
              {pendingTxs.length > 0 && (
                <div className="status-card">
                  <h2>{t("transactionsExpanded.pendingTransactions")} ({pendingTxs.length})</h2>
                  <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                    {pendingTxs.map((tx) => (
                      <div
                        key={tx.txId}
                        style={{
                          padding: "0.5rem",
                          marginBottom: "0.5rem",
                          background: "#f0f0f0",
                          borderRadius: "4px",
                          fontSize: "0.9rem",
                        }}
                      >
                        <div>
                          <strong>{t("transactionsExpanded.txId")}</strong> {tx.txId.substring(0, 16)}...
                        </div>
                        <div>
                          <strong>{t("transactionsExpanded.from")}</strong> {tx.ownerAddress?.substring(0, 20) || t("commonExpanded.unknown")}...
                        </div>
                        <div>
                          <strong>{t("transactionsExpanded.ops")}</strong> {tx.ops.length}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Network Tab */}
          {activeTab === "network" && (
            <div className="tab-content active">
              {/* P2P Network Section */}
              <div className="status-card">
                <h2>{t("networkExpanded.p2pNetwork")}</h2>
                <div className="status-item">
                  <span className="label">{t("networkExpanded.mode")}</span>
                  <span className="value">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      {isMainnetMode ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>{t("network.mainnet")}</span>
                      ) : (
                        <span style={{ color: "#ffc107", fontWeight: "bold" }}>{t("network.dev")}</span>
                      )}
                      {chainContext && (
                        <span style={{ fontSize: "0.75rem", color: "#999", marginLeft: "0.5rem" }}>
                          ({chainContext.params.networkId})
                        </span>
                      )}
                    </div>
                  </span>
                </div>
                <div className="status-item">
                  <span className="label">{t("networkExpanded.status")}</span>
                  <span className="value">{isP2PConnected ? t("networkExpanded.connected") : t("networkExpanded.disconnected")}</span>
                </div>
                <div className="status-item">
                  <span className="label">{t("networkExpanded.peers")}</span>
                  <span className="value">{peerCount}</span>
                </div>
                {!isP2PConnected ? (
                  <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {/* Mode Toggle */}
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={isMainnetMode}
                          onChange={(e) => {
                            const newMainnetMode = e.target.checked;
                            setIsMainnetMode(newMainnetMode);
                            
                            // Set network mode in localStorage to force mainnet networkId
                            if (newMainnetMode) {
                              localStorage.setItem("indexerchain_force_mainnet", "true");
                              setBootstrapUrl(DEFAULT_MAINNET_SIGNALING);
                              // Show warning that page needs to be refreshed
                              alert(t("networkMode.switchedToMainnet"));
                            } else {
                              localStorage.removeItem("indexerchain_force_mainnet");
                              setBootstrapUrl("ws://localhost:8080");
                              // Show warning that page needs to be refreshed
                              alert(locale === "zh"
                                ? t("networkMode.switchedToDev")
                                : "Switched to dev mode. Please refresh the page for the network ID change to take effect.");
                            }
                          }}
                        />
                        <span>{t("network.mainnetMode")}</span>
                      </label>
                    </div>
                    {/* Signaling Server URL Input */}
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        type="text"
                        placeholder={isMainnetMode 
                          ? t("networkExpanded.mainnetSignalingServer")
                          : t("networkExpanded.localSignalingServer")}
                        value={bootstrapUrl}
                        onChange={(e) => setBootstrapUrl(e.target.value)}
                        style={{ flex: 1, padding: "0.5rem" }}
                        disabled={isMainnetMode}
                      />
                      <button className="btn btn-primary" onClick={handleConnectP2P}>
                        {t("network.connect")}
                      </button>
                    </div>
                    {isMainnetMode && (
                      <div style={{ fontSize: "0.85rem", color: "#666", padding: "0.5rem", background: "#f0f0f0", borderRadius: "4px" }}>
                        💡 <strong>{t("network.mainnet")}</strong>：{t("network.mainnetDesc")}
                      </div>
                    )}
                    {!isMainnetMode && (
                      <div style={{ fontSize: "0.85rem", color: "#666", padding: "0.5rem", background: "#fff3cd", borderRadius: "4px" }}>
                        ⚠️ <strong>{t("network.devMode")}</strong>：{t("network.devModeDesc")}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.9rem", color: "#666" }}>
                      {t("overview.connectedTo")}: <code style={{ fontSize: "0.85rem" }}>{bootstrapUrl}</code>
                    </div>
                    {/* Show network mode toggle even when connected */}
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.5rem", background: "#f5f5f5", borderRadius: "4px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                        <input
                          type="checkbox"
                          checked={isMainnetMode}
                          onChange={(e) => {
                            const newMainnetMode = e.target.checked;
                            setIsMainnetMode(newMainnetMode);
                            
                            // Set network mode in localStorage to force mainnet networkId
                            if (newMainnetMode) {
                              localStorage.setItem("indexerchain_force_mainnet", "true");
                              setBootstrapUrl(DEFAULT_MAINNET_SIGNALING);
                              // Show warning that page needs to be refreshed
                              alert(locale === "zh" 
                                ? "已切换到主网模式。请先断开连接，然后刷新页面以使网络ID更改生效。\n\n注意：切换到主网后，您将连接到主网节点，但本地链数据可能需要重置。"
                                : "Switched to mainnet mode. Please disconnect first, then refresh the page for the network ID change to take effect.\n\nNote: After switching to mainnet, you will connect to mainnet nodes, but local chain data may need to be reset.");
                            } else {
                              localStorage.removeItem("indexerchain_force_mainnet");
                              setBootstrapUrl("ws://localhost:8080");
                              // Show warning that page needs to be refreshed
                              alert(t("networkMode.switchedToDevDisconnect"));
                            }
                          }}
                        />
                        <span>{t("network.mainnetMode")}</span>
                      </label>
                    </div>
                    <button className="btn btn-secondary" onClick={handleDisconnectP2P}>
                      {t("network.disconnect")}
                    </button>
                  </div>
                )}
                {peers.length > 0 && (
                  <div style={{ marginTop: "1rem" }}>
                    <strong>{t("overview.connectedPeers")}:</strong>
                    <div style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
                      {peers.map((peer) => (
                        <div key={peer.id} style={{ padding: "0.25rem 0" }}>
                          {peer.id.substring(0, 16)}... ({peer.connected ? "✓" : "✗"})
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Phase 17: Fast Relay Status */}
              {chainContext && (
                <div className="status-card">
                  <h2>📡 {t("network.fastRelay")}</h2>
                  <div className="status-item">
                    <span className="label">{t("network.headersCached")}:</span>
                    <span className="value">{relayStats.headersCached}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("network.missingBodies")}:</span>
                    <span className="value" style={{ color: relayStats.missingBodies > 0 ? "#ffc107" : "#28a745" }}>
                      {relayStats.missingBodies}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("network.pendingBodyRequests")}:</span>
                    <span className="value">{relayStats.pendingBodyRequests}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("network.receivedBodies")}:</span>
                    <span className="value">{relayStats.receivedBodyCount}</span>
                  </div>
                  {relayStats.lastHeaderDelay !== null && (
                    <div className="status-item">
                      <span className="label">{t("network.lastHeaderDelay")}:</span>
                      <span className="value" style={{ color: relayStats.lastHeaderDelay < 200 ? "#28a745" : "#ffc107" }}>
                        {relayStats.lastHeaderDelay} ms
                      </span>
                    </div>
                  )}
                  {relayStats.lastBodyDownloadTime !== null && (
                    <div className="status-item">
                      <span className="label">{t("network.lastBodyDownload")}:</span>
                      <span className="value">{relayStats.lastBodyDownloadTime} ms</span>
                    </div>
                  )}
                </div>
              )}

              {/* Phase 20: Global Snapshot Network */}
              {chainContext && isP2PConnected && (
                <div className="status-card">
                  <h2>🌍 {t("network.globalSnapshotNetwork")}</h2>
                  <div className="status-item">
                    <span className="label">{t("network.status")}:</span>
                    <span className="value">
                      {gsnEnabled ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>{t("status.active")}</span>
                      ) : (
                        <span style={{ color: "#666" }}>{t("status.inactive")}</span>
                      )}
                    </span>
                  </div>
                  {gsnStats && (
                    <>
                      <div className="status-item">
                        <span className="label">{t("network.snapshotSources")}:</span>
                        <span className="value">{gsnStats.downloader.totalSources}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.avgLatency")}:</span>
                        <span className="value">{formatInteger(gsnStats.downloader.averageLatency, locale === "zh" ? "zh-CN" : "en-US")} ms</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.avgIntegrity")}:</span>
                        <span className="value">{formatPercent(gsnStats.downloader.averageIntegrity * 100, 1)}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.cachedSnapshots")}:</span>
                        <span className="value">{gsnStats.seeder.cachedCount}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "缓存大小" : "Cache Size"}:</span>
                        <span className="value">{formatNumber(gsnStats.seeder.totalSize / 1024, 2, locale === "zh" ? "zh-CN" : "en-US")} KB</span>
                      </div>
                    </>
                  )}
                  {snapshotDownloadProgress && (
                    <>
                      <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                        <span className="label">{t("app.downloadProgress")}:</span>
                        <span className="value">{formatPercent(snapshotDownloadProgress.percent, 1)}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("app.chunks")}:</span>
                        <span className="value">
                          {snapshotDownloadProgress.receivedChunks} / {snapshotDownloadProgress.totalChunks}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("app.speed")}:</span>
                        <span className="value">
                          {formatNumber(snapshotDownloadProgress.speed / 1024, 2, locale === "zh" ? "zh-CN" : "en-US")} KB/s
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.peers")}:</span>
                        <span className="value">{snapshotDownloadProgress.peers}</span>
                      </div>
                    </>
                  )}
                  <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
                    💡 <strong>GSN:</strong> {t("app.gsnDesc")}
                    {gsnEnabled && t("app.gsnSeeding")}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Storage Tab */}
          {activeTab === "storage" && (
            <div className="tab-content active">
              {/* Phase 9: State & Storage (Snapshots) */}
              {chainContext && (
                <>
                  {/* Phase 9: State & Storage (Snapshots) */}
                  <div className="status-card">
                    <h2>💾 {t("storage.stateStorage")}</h2>
                    <div className="status-item">
                      <span className="label">{t("storage.lastSnapshotHeight")}:</span>
                      <span className="value">
                        {latestSnapshot ? latestSnapshot.height : t("common.none")}
                      </span>
                    </div>
                    {latestSnapshot && (
                      <>
                        <div className="status-item">
                          <span className="label">{t("storage.lastSnapshotTime")}:</span>
                          <span className="value">
                            {new Date(latestSnapshot.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="status-item">
                          <span className="label">{t("storage.blocksSinceSnapshot")}:</span>
                          <span className="value">
                            {Math.max(0, height - latestSnapshot.height)}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="status-item">
                      <span className="label">{t("storage.snapshotCount")}:</span>
                      <span className="value">{snapshotMetas.length}</span>
                    </div>
                    {/* Phase 12: Show snapshot type info */}
                    {latestSnapshot && (
                      <div className="status-item">
                        <span className="label">{t("storage.latestSnapshotType")}:</span>
                        <span className="value">
                          {(() => {
                            // Check if latest snapshot is full or delta
                            const latestSnapData = loadSnapshotByHeightSync(latestSnapshot.height);
                            if (latestSnapData) {
                              if (latestSnapData.full === false) {
                                return t("storage.delta") + ` (${t("storage.incremental")})`;
                              } else {
                                return t("storage.full");
                              }
                            }
                            return t("storage.unknown");
                          })()}
                        </span>
                      </div>
                    )}
                    {/* Phase 11: Compression info */}
                    {snapshotSizeInfo && (
                      <>
                        <div className="status-item">
                          <span className="label">{t("storage.latestSnapshotSize")}:</span>
                          <span className="value">
                            {formatNumber(snapshotSizeInfo.compressedSize / 1024, 2, locale === "zh" ? "zh-CN" : "en-US")} KB
                          </span>
                        </div>
                        {snapshotSizeInfo.compressionRatio > 0 && (
                          <div className="status-item">
                            <span className="label">{t("storage.compressionRatio")}:</span>
                            <span className="value" style={{ color: "#28a745", fontWeight: "bold" }}>
                              {formatPercent(snapshotSizeInfo.compressionRatio, 1)} {t("storage.reduction")}
                            </span>
                          </div>
                        )}
                        {snapshotSizeInfo.estimatedUncompressedSize > 0 && (
                          <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                            <span className="label">{t("storage.estimatedUncompressed")}:</span>
                            <span className="value">
                              {formatNumber(snapshotSizeInfo.estimatedUncompressedSize / 1024, 2, locale === "zh" ? "zh-CN" : "en-US")} KB
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {/* Phase 13: Verification info */}
                    {latestSnapshot && (
                      <>
                        {latestSnapshot.stateHash && (
                          <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                            <span className="label">{t("storage.stateHash")}:</span>
                            <span className="value" style={{ fontSize: "0.85rem", wordBreak: "break-all", fontFamily: "monospace" }}>
                              {latestSnapshot.stateHash.substring(0, 16)}...
                            </span>
                          </div>
                        )}
                        <div className="status-item">
                          <span className="label">{t("storage.verificationStatus")}:</span>
                          <span className="value">
                            {latestSnapshot.verifiedAt ? (
                              <span style={{ color: "#28a745", fontWeight: "bold" }}>✅ {t("storage.verified")}</span>
                            ) : latestSnapshot.stateHash ? (
                              <span style={{ color: "#ffc107", fontWeight: "bold" }}>⚠️ {t("storage.notVerified")}</span>
                            ) : (
                              <span style={{ color: "#666" }}>— {t("storage.noHash")}</span>
                            )}
                          </span>
                        </div>
                        {latestSnapshot.verifiedAt && (
                          <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                            <span className="label">{t("storage.lastVerified")}:</span>
                            <span className="value">
                              {new Date(latestSnapshot.verifiedAt).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {/* Phase 15: State Commitment info */}
                    {tip && tip.header.stateCommitment && (
                      <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                        <span className="label">{t("storage.stateCommitment")}:</span>
                        <span className="value" style={{ fontSize: "0.85rem", wordBreak: "break-all", fontFamily: "monospace" }}>
                          {tip.header.stateCommitment.substring(0, 16)}...
                        </span>
                      </div>
                    )}
                    {latestSnapshot && tip && (
                      <>
                        {latestSnapshot.stateCommitment && tip.header.stateCommitment && (
                          <div className="status-item">
                            <span className="label">{t("storage.commitmentMatch")}:</span>
                            <span className="value">
                              {latestSnapshot.stateCommitment === tip.header.stateCommitment ? (
                                <span style={{ color: "#28a745", fontWeight: "bold" }}>✅ {t("storage.matches")}</span>
                              ) : (
                                <span style={{ color: "#dc3545", fontWeight: "bold" }}>❌ {t("storage.mismatch")}</span>
                              )}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {/* Phase 14: Remote snapshot info */}
                    {chainContext && (
                      <>
                        <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                          <span className="label">{t("storage.remoteSnapshot")}:</span>
                          <span className="value">
                            {chainContext.remoteSnapshotUsed ? (
                              <span style={{ color: "#28a745", fontWeight: "bold" }}>✅ {t("storage.used")}</span>
                            ) : chainContext.params.remoteSnapshotEnabled ? (
                              <span style={{ color: "#666" }}>{t("storage.notUsed")}</span>
                            ) : (
                              <span style={{ color: "#999" }}>{t("storage.disabled")}</span>
                            )}
                          </span>
                        </div>
                        {chainContext.remoteSnapshotUsed && (
                          <>
                            {chainContext.params.remoteSnapshotEndpoints && chainContext.params.remoteSnapshotEndpoints.length > 0 && (
                              <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                                <span className="label">{t("storage.source")}:</span>
                                <span className="value" style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>
                                  {chainContext.params.remoteSnapshotEndpoints[0]}
                                </span>
                              </div>
                            )}
                            <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                              <span className="label">{t("storage.remoteHeight")}:</span>
                              <span className="value">{chainContext.remoteSnapshotUsed.height}</span>
                            </div>
                            {chainContext.remoteSnapshotUsed.stateHash && (
                              <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                                <span className="label">{t("storage.remoteStateHash")}:</span>
                                <span className="value" style={{ fontSize: "0.8rem", fontFamily: "monospace" }}>
                                  {chainContext.remoteSnapshotUsed.stateHash.substring(0, 16)}...
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                    <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  if (!chainContext) return;
                  const tip = chainContext.storage.getTip();
                  if (!tip || tip.header.height === 0) {
                    setError(t("storage.needAtLeastOneBlock"));
                    return;
                  }
                  try {
                    setError("");
                    const indexStateSnapshot = chainContext.indexState.toSnapshot();
                    // Phase 15: Pass stateCommitment from block header
                    await saveSnapshot(tip.header.height, tip.hash, indexStateSnapshot, undefined, true, tip.header.stateCommitment);
                    const metas = loadAllSnapshotMeta();
                    setSnapshotMetas(metas);
                    const latest = getLatestSnapshotMeta();
                    setLatestSnapshot(latest);
                    
                    // Phase 20: Update seeder cache
                    if (isP2PConnected && gsnEnabled) {
                      snapshotSeeder.updateCache(tip.header.height);
                    }
                    
                    // Update size info
                    if (latest) {
                      const info = await getSnapshotSizeInfo(latest.height);
                      setSnapshotSizeInfo(info);
                    }
                    
                    setError("");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : t("storage.failedToCreateSnapshot"));
                  }
                }}
                disabled={!chainContext || height === 0}
              >
                {t("storage.forceSnapshot")}
              </button>
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  if (window.confirm(t("storage.clearAllSnapshotsConfirm"))) {
                    clearAllSnapshots();
                    setSnapshotMetas([]);
                    setLatestSnapshot(null);
                    setSnapshotSizeInfo(null);
                    setError(t("storage.allSnapshotsCleared"));
                    setTimeout(() => setError(""), 3000);
                  }
                }}
                style={{ background: "#dc3545", color: "white" }}
              >
                {t("storage.clearSnapshots")}
              </button>
              {/* Phase 11: Recompress all snapshots */}
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  if (!chainContext) return;
                  if (isRecompressing) return;
                  
                  try {
                    setIsRecompressing(true);
                    setError("");
                    const count = await recompressAllSnapshots();
                    if (count > 0) {
                      // Reload snapshot info
                      const metas = loadAllSnapshotMeta();
                      setSnapshotMetas(metas);
                      const latest = getLatestSnapshotMeta();
                      setLatestSnapshot(latest);
                      
                      if (latest) {
                        const info = await getSnapshotSizeInfo(latest.height);
                        setSnapshotSizeInfo(info);
                      }
                      
                      setError(t("storage.recompressedSnapshots", { count }));
                      setTimeout(() => setError(""), 3000);
                    } else {
                      setError(t("storage.allSnapshotsCompressed"));
                      setTimeout(() => setError(""), 2000);
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : t("storage.failedToRecompressSnapshots"));
                  } finally {
                    setIsRecompressing(false);
                  }
                }}
                disabled={!chainContext || isRecompressing || snapshotMetas.length === 0}
                style={{ background: "#17a2b8", color: "white" }}
              >
                {isRecompressing ? t("storage.recompressing") : t("storage.recompressAll")}
              </button>
              {/* Phase 13: Verify latest snapshot */}
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  if (!chainContext || !latestSnapshot) return;
                  
                  try {
                    setError("");
                    const { verifySnapshotIntegrity, handleCorruptedSnapshot } = await import("../core/snapshotVerify.js");
                    const snapshot = await loadSnapshotByHeight(latestSnapshot.height);
                    
                    if (!snapshot) {
                      setError(t("storage.snapshotNotFound"));
                      return;
                    }
                    
                    const isValid = await verifySnapshotIntegrity(snapshot);
                    
                    if (isValid) {
                      // Reload snapshot metadata to show updated verification status
                      const metas = loadAllSnapshotMeta();
                      setSnapshotMetas(metas);
                      const latest = getLatestSnapshotMeta();
                      setLatestSnapshot(latest);
                      
                      setError(t("storage.snapshotVerifiedSuccess"));
                      setTimeout(() => setError(""), 3000);
                    } else {
                      const fallbackHeight = await handleCorruptedSnapshot(latestSnapshot.height);
                      const metas = loadAllSnapshotMeta();
                      setSnapshotMetas(metas);
                      const latest = getLatestSnapshotMeta();
                      setLatestSnapshot(latest);
                      
                      setError(t("storage.snapshotCorruptedDeleted", { fallbackHeight }));
                      setTimeout(() => setError(""), 5000);
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : t("storage.failedToVerifySnapshot"));
                  }
                }}
                disabled={!chainContext || !latestSnapshot}
                style={{ background: "#6c757d", color: "white" }}
              >
                {t("storageExpanded.verifyLatestSnapshot")}
              </button>
              {/* Phase 14: Fetch remote snapshot */}
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  if (!chainContext) return;
                  
                  if (!chainContext.params.remoteSnapshotEnabled || !chainContext.params.remoteSnapshotEndpoints || chainContext.params.remoteSnapshotEndpoints.length === 0) {
                    setError(t("storageExpanded.remoteSnapshotNotEnabled"));
                    return;
                  }
                  
                  try {
                    setError(t("storageExpanded.fetchingRemoteSnapshot"));
                    const { syncFromRemoteSnapshot } = await import("../core/remoteSnapshot.js");
                    const remoteMeta = await syncFromRemoteSnapshot(chainContext.params, chainContext.storage);
                    
                    if (remoteMeta) {
                      // Reload snapshots
                      const metas = loadAllSnapshotMeta();
                      setSnapshotMetas(metas);
                      const latest = getLatestSnapshotMeta();
                      setLatestSnapshot(latest);
                      
                      // Update chain context to show remote snapshot was used
                      setChainContext({ ...chainContext, remoteSnapshotUsed: remoteMeta });
                      
                      // Update size info
                      if (latest) {
                        const info = await getSnapshotSizeInfo(latest.height);
                        setSnapshotSizeInfo(info);
                      }
                      
                      setError(t("storageExpanded.remoteSnapshotSynced", { height: remoteMeta.height }));
                      setTimeout(() => setError(""), 5000);
                      
                      // Reload page to apply the new snapshot
                      setTimeout(() => {
                        if (window.confirm(t("storageExpanded.reloadToApply"))) {
                          window.location.reload();
                        }
                      }, 2000);
                    } else {
                      setError(t("storageExpanded.failedToFetchRemoteSnapshot"));
                      setTimeout(() => setError(""), 5000);
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : t("storageExpanded.failedToFetchRemoteSnapshot"));
                  }
                }}
                disabled={!chainContext || !chainContext.params.remoteSnapshotEnabled || !chainContext.params.remoteSnapshotEndpoints || chainContext.params.remoteSnapshotEndpoints.length === 0}
                style={{ background: "#28a745", color: "white" }}
              >
                {t("storageExpanded.fetchRemoteSnapshot")}
              </button>
                  </div>
                </div>

                {/* Phase 10: Light Node Status */}
                <div className="status-card">
                  <h2>{t("storageExpanded.lightNodeStatus")}</h2>
                  <div className="status-item">
                    <span className="label">{t("storageExpanded.lightNodeWindow")}</span>
                    <span className="value">
                      {chainContext.params.lightNodeWindow ?? 200} {t("storageExpanded.blocks")}
                      {chainContext.params.lightNodeWindow && chainContext.params.lightNodeWindow <= 20 && (
                        <span style={{ marginLeft: "0.5rem", color: "#28a745", fontSize: "0.85rem" }}>
                          {t("storageExpanded.extremePruning")}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("storageExpanded.storedBlocks")}</span>
                    <span className="value">{blockCount}</span>
                  </div>
                  {(() => {
                    const minHeight = chainContext.storage.getMinHeight();
                    const maxHeight = chainContext.storage.getMaxHeight();
                    return (
                      <>
                        <div className="status-item">
                          <span className="label">{t("storageExpanded.earliestBlockHeight")}</span>
                          <span className="value">{minHeight}</span>
                        </div>
                        <div className="status-item">
                          <span className="label">{t("storageExpanded.latestBlockHeight")}</span>
                          <span className="value">{maxHeight}</span>
                        </div>
                        {chainContext.params.lightNodeWindow && chainContext.params.lightNodeWindow > 0 && (
                          <div className="status-item">
                            <span className="label">{t("storageExpanded.storageReduction")}</span>
                            <span className="value" style={{ color: "#28a745", fontWeight: "bold" }}>
                              {height > 0
                                ? `${((1 - blockCount / Math.max(1, height + 1)) * 100).toFixed(1)}%`
                                : "0%"}
                            </span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <div style={{ marginTop: "1rem" }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        if (!chainContext) return;
                        const lightNodeWindow = chainContext.params.lightNodeWindow ?? 200;
                        if (lightNodeWindow > 0) {
                          const tip = chainContext.storage.getTip();
                          if (tip) {
                            const pruneHeight = tip.header.height - lightNodeWindow + 1;
                            if (pruneHeight > 0) {
                              chainContext.storage.pruneBlocksBefore(pruneHeight);
                              setChainContext({ ...chainContext });
                              setError(t("tools.prunedOldBlocks"));
                              setTimeout(() => setError(""), 2000);
                            }
                          }
                        }
                      }}
                      disabled={!chainContext || height === 0}
                      style={{ background: "#ffc107", color: "#000" }}
                    >
                      {t("storageExpanded.clearPrunedBlocks")}
                    </button>
                  </div>
                </div>
                </>
              )}
            </div>
          )}

          {/* Advanced Tab */}
          {activeTab === "advanced" && (
            <div className="tab-content active">
              {/* Phase 26: Runtime & Help Panel */}
              <RuntimePanel
                runtimeManager={runtimeManager}
                currentWorkers={clusterWorkerCount}
                maxWorkers={runtimeManager ? runtimeManager.getDeviceCapability().maxWorkers : 16}
                onUpdateConfig={(config) => {
                  if (runtimeManager) {
                    runtimeManager.updateConfig(config);
                    if (config.dutyCycle !== undefined) {
                      setDutyCycle(config.dutyCycle);
                    }
                  }
                }}
                onSetDutyCycle={(cycle) => {
                  setDutyCycle(cycle);
                  // Update all active miners
                  minerClient.setDutyCycle(cycle);
                  // Update cluster workers (they will pick it up on next restart)
                }}
                onSetWorkerCount={(count) => {
                  setClusterWorkerCount(count);
                }}
              />

              {/* Phase 6: Difficulty Information */}
              {tip && (
                <div className="status-card">
                  <h2>{t("advancedExpanded.difficultyStatus")}</h2>
                  <div className="status-item">
                    <span className="label">{t("advancedExpanded.currentDifficulty")}</span>
                    <span className="value">{tip.header.difficulty}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("advancedExpanded.targetBlockTime")}</span>
                    <span className="value">{chainContext.params.targetBlockTime}{t("commonExpanded.seconds")}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("advancedExpanded.blocksUntilAdjustment")}</span>
                    <span className="value">
                      {getBlocksUntilAdjustment(
                        height,
                        chainContext.params.difficultyAdjustmentInterval
                      )}
                    </span>
                  </div>
                  {(() => {
                    const allBlocks = chainContext.storage.getAllBlocks();
                    const recentBlocks = allBlocks.slice(-chainContext.params.difficultyAdjustmentInterval);
                    const avgTime = getAverageBlockTime(recentBlocks);
                    if (avgTime !== null) {
                      return (
                        <div className="status-item">
                          <span className="label">{t("advancedExpanded.averageBlockTime")} ({t("advanced.lastBlocks", { count: recentBlocks.length })}):</span>
                          <span className="value">{formatNumber(avgTime, 2, locale === "zh" ? "zh-CN" : "en-US")}{t("commonExpanded.seconds")}</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {(() => {
                    const allBlocks = chainContext.storage.getAllBlocks();
                    if (allBlocks.length >= chainContext.params.difficultyAdjustmentInterval) {
                      const explanation = explainDifficultyChange(allBlocks, chainContext.params);
                      
                      // Parse and translate the reason message
                      let translatedReason = explanation.reason;
                      
                      // Parse "Last X blocks: Ys actual vs Zs expected (ratio: W)."
                      const lastBlocksMatch = explanation.reason.match(/Last (\d+) blocks: ([\d.]+)s actual vs ([\d.]+)s expected \(ratio: ([\d.]+)\)\./);
                      if (lastBlocksMatch) {
                        const [, interval, actual, expected, ratio] = lastBlocksMatch;
                        const firstPart = t("advancedExpanded.lastBlocksActualVsExpected", {
                          interval,
                          actual,
                          expected,
                          ratio,
                        });
                        
                        // Parse difficulty change part
                        let secondPart = "";
                        if (explanation.reason.includes("Difficulty increased from")) {
                          const match = explanation.reason.match(/Difficulty increased from (\d+) to (\d+)/);
                          if (match) {
                            secondPart = t("advancedExpanded.difficultyIncreased", { current: match[1], new: match[2] });
                          }
                        } else if (explanation.reason.includes("Difficulty decreased from")) {
                          const match = explanation.reason.match(/Difficulty decreased from (\d+) to (\d+)/);
                          if (match) {
                            secondPart = t("advancedExpanded.difficultyDecreased", { current: match[1], new: match[2] });
                          }
                        } else if (explanation.reason.includes("Difficulty unchanged at")) {
                          const match = explanation.reason.match(/Difficulty unchanged at (\d+)/);
                          if (match) {
                            secondPart = t("advancedExpanded.difficultyUnchanged", { difficulty: match[1] });
                          }
                        }
                        
                        translatedReason = firstPart + " " + secondPart;
                      } else if (explanation.reason.includes("Genesis block")) {
                        translatedReason = t("advancedExpanded.genesisBlockUsingInitial");
                      } else if (explanation.reason.includes("Height") && explanation.reason.includes("< interval")) {
                        const match = explanation.reason.match(/Height (\d+) < interval (\d+)/);
                        if (match) {
                          translatedReason = t("advancedExpanded.heightLessThanInterval", { height: match[1], interval: match[2] });
                        }
                      }
                      
                      return (
                        <div style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#666" }}>
                          <strong>{t("advancedExpanded.difficultyChange")}:</strong> {translatedReason}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}

              {/* Phase 16: IDC Emission Info */}
              {chainContext && tip && (() => {
                const totalMinted = chainContext.indexState.getTotalMinted();
                const totalMintedIDC = uIDCToIDC(totalMinted);
                const maxSupplyIDC = uIDCToIDC(IDC_MAX_SUPPLY);
                const emissionStats = getEmissionStats(tip.header.height);
                const nextBlockReward = emissionStats.rawRewardIDC;
                
                return (
                  <div className="status-card">
                    <h2>{t("advanced.idcEmission")}</h2>
                    <div className="status-item">
                      <span className="label">{t("advanced.totalMinted")}:</span>
                      <span className="value" style={{ fontWeight: "bold", color: "#667eea" }}>
                        {formatNumber(totalMintedIDC, 6, locale === "zh" ? "zh-CN" : "en-US")} / {formatNumber(maxSupplyIDC, 6, locale === "zh" ? "zh-CN" : "en-US")} IDC
                      </span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("advanced.mintingProgress")}:</span>
                      <span className="value">
                        {formatPercent((totalMintedIDC / maxSupplyIDC) * 100, 4)}
                      </span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("advanced.currentEra")}:</span>
                      <span className="value">
                        {t("token.eraNumber")} {emissionStats.year} / {IDC_EMISSION_YEARS - 1}
                      </span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("advanced.blockRewardNext")}:</span>
                      <span className="value" style={{ fontWeight: "bold" }}>
                        {formatNumber(nextBlockReward, 6, locale === "zh" ? "zh-CN" : "en-US")} IDC
                      </span>
                    </div>
                    <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                      <span className="label">{t("advanced.blocksInEra")}:</span>
                      <span className="value">
                        {formatInteger(Number(emissionStats.blocksRemainingInEra), locale === "zh" ? "zh-CN" : "en-US")} {t("advanced.remaining")}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Phase 21: Peer Reputation */}
              {chainContext && chainContext.params.peerScoreEnabled && (
                <div className="status-card">
                  <h2>🔒 {t("network.peerReputation")}</h2>
                  <div className="status-item">
                    <span className="label">{t("advanced.totalPeersTracked")}:</span>
                    <span className="value">{peerScores.length}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("advanced.trusted")}:</span>
                    <span className="value" style={{ color: "#28a745" }}>
                      {peerScores.filter(p => p.trustLevel === "trusted").length}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("advanced.normal")}:</span>
                    <span className="value" style={{ color: "#666" }}>
                      {peerScores.filter(p => p.trustLevel === "normal").length}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("advanced.lowTrust")}:</span>
                    <span className="value" style={{ color: "#ffc107" }}>
                      {peerScores.filter(p => p.trustLevel === "low").length}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("advanced.banned")}:</span>
                    <span className="value" style={{ color: "#dc3545" }}>
                      {peerScores.filter(p => p.trustLevel === "banned").length}
                    </span>
                  </div>
                  {peerScores.length > 0 && (
                    <div style={{ marginTop: "1rem" }}>
                      <strong>{t("advanced.peerDetails")}:</strong>
                      <div style={{ maxHeight: "300px", overflowY: "auto", marginTop: "0.5rem" }}>
                        <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ background: "#f0f0f0", position: "sticky", top: 0 }}>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>{t("network.peerId")}</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>{t("network.score")}</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>{t("network.trustLevel")}</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>{t("network.blocksServed")}</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>{t("network.snapshotsServed")}</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>{t("network.avgLatencyMs")}</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>{t("network.workCompleted")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {peerScores
                              .sort((a, b) => b.score - a.score)
                              .map((peer) => {
                                const trustColor = 
                                  peer.trustLevel === "trusted" ? "#28a745" :
                                  peer.trustLevel === "normal" ? "#666" :
                                  peer.trustLevel === "low" ? "#ffc107" : "#dc3545";
                                return (
                                  <tr key={peer.peerId} style={{ borderBottom: "1px solid #eee" }}>
                                    <td style={{ padding: "0.5rem" }} title={peer.peerId}>
                                      {formatAddress(peer.peerId, 8, 8)}
                                    </td>
                                    <td style={{ padding: "0.5rem", fontWeight: "bold" }}>
                                      {formatNumber(peer.score, 1, locale === "zh" ? "zh-CN" : "en-US")}
                                    </td>
                                    <td style={{ padding: "0.5rem", color: trustColor }}>
                                      {peer.trustLevel}
                                    </td>
                                    <td style={{ padding: "0.5rem" }}>
                                      {peer.blocksServed} / {peer.blocksInvalid > 0 ? <span style={{ color: "#dc3545" }}>{peer.blocksInvalid}</span> : "0"}
                                    </td>
                                    <td style={{ padding: "0.5rem" }}>
                                      {peer.snapshotsServed} / {peer.snapshotsInvalid > 0 ? <span style={{ color: "#dc3545" }}>{peer.snapshotsInvalid}</span> : "0"}
                                    </td>
                                    <td style={{ padding: "0.5rem" }}>
                                      {peer.avgLatencyMs ? `${formatInteger(peer.avgLatencyMs, locale === "zh" ? "zh-CN" : "en-US")}ms` : "—"}
                                    </td>
                                    <td style={{ padding: "0.5rem" }}>
                                      {peer.workCompleted} / {peer.workFailed > 0 ? <span style={{ color: "#dc3545" }}>{peer.workFailed}</span> : "0"}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
                    💡 <strong>{t("network.peerReputation")}:</strong> {t("network.peerReputationDesc")}
                  </div>
                </div>
              )}

              {/* Phase 22: Fast Finality Status */}
              {chainContext && chainContext.params.finalityEnabled && (
                <div className="status-card">
                  <h2>⚡ {t("network.fastFinality")}</h2>
                  {finalityStats ? (
                    <>
                      <div className="status-item">
                        <span className="label">{t("network.status")}:</span>
                        <span className="value">
                          {finalityStats.committeeSize > 0 ? (
                            <span style={{ color: "#28a745", fontWeight: "bold" }}>{t("status.active")}</span>
                          ) : (
                            <span style={{ color: "#666" }}>{t("network.waitingForCommittee")}</span>
                          )}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.finalizedBlocks")}:</span>
                        <span className="value" style={{ fontWeight: "bold" }}>
                          {finalityStats.finalizedCount}
                        </span>
                      </div>
                      {tip && (() => {
                        const localHeight = tip.header.height;
                        const finalizedHeight = finalityStats.finalizedCount || 0;
                        const isFinalityInitializationPhase = finalizedHeight === 0 || localHeight < 50;
                        return isFinalityInitializationPhase ? (
                          <div className="status-item" style={{ 
                            marginTop: "0.5rem", 
                            padding: "0.5rem", 
                            background: "#fff3cd", 
                            borderRadius: "4px",
                            border: "1px solid #ffc107"
                          }}>
                            <span style={{ color: "#856404", fontSize: "0.9rem" }}>
                              🟡 {t("network.finalityInitializationMode")}
                            </span>
                          </div>
                        ) : null;
                      })()}
                      <div className="status-item">
                        <span className="label">{t("network.pendingVotes")}:</span>
                        <span className="value">
                          {finalityStats.pendingVotes}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.committeeRound")}:</span>
                        <span className="value">
                          {finalityStats.currentRound >= 0 ? finalityStats.currentRound : "—"}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.committeeSize")}:</span>
                        <span className="value">
                          {finalityStats.committeeSize} {t("network.members")}
                        </span>
                      </div>
                      {tip && (
                        <div className="status-item" style={{ marginTop: "0.5rem" }}>
                          <span className="label">{t("network.currentBlockFinality")}:</span>
                          <span className="value">
                            {finalizedBlocks.has(tip.hash) ? (
                              <span style={{ color: "#28a745", fontWeight: "bold" }}>✅ {t("network.finalized")}</span>
                            ) : finalityStats.pendingVotes > 0 ? (
                              <span style={{ color: "#ffc107" }}>⏳ {t("network.pending")} ({finalityStats.pendingVotes} {t("network.votes")})</span>
                            ) : (
                              <span style={{ color: "#dc3545" }}>❌ {t("network.unconfirmed")}</span>
                            )}
                          </span>
                        </div>
                      )}
                      {finalityManager && (
                        <div style={{ marginTop: "1rem" }}>
                          <strong>{t("network.currentCommittee")}:</strong>
                          <div style={{ maxHeight: "150px", overflowY: "auto", marginTop: "0.5rem" }}>
                            {finalityManager.getCurrentCommittee().length > 0 ? (
                              finalityManager.getCurrentCommittee().map((member: { address: string; score: number }, idx: number) => (
                                <div
                                  key={idx}
                                  style={{
                                    padding: "0.5rem",
                                    marginBottom: "0.25rem",
                                    background: "#f0f0f0",
                                    borderRadius: "4px",
                                    fontSize: "0.85rem",
                                  }}
                                >
                                  <div>
                                    <strong>{t("network.member")} #{idx + 1}:</strong> {formatAddress(member.address, 10, 10)}
                                  </div>
                                  <div>
                                    {t("network.score")}: {formatNumber(member.score, 1, locale === "zh" ? "zh-CN" : "en-US")} / 100
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div style={{ padding: "0.5rem", color: "#666", fontSize: "0.85rem" }}>
                                {t("network.noCommittee")}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: "#666", fontSize: "0.9rem" }}>
                      {t("network.notInitialized")}. {t("network.notInitializedDesc")}
                    </div>
                  )}
                  <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
                    💡 <strong>{t("network.fastFinality")}:</strong> {t("network.fastFinalityDesc")}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Token Model Tab */}
          {activeTab === "token" && (
            <div className="tab-content active">
              <div className="status-card">
                <h2>{t("token.title")}</h2>
                
                {/* Token Overview */}
                <div style={{ marginBottom: "2rem" }}>
                  <h3 style={{ color: "#667eea", marginBottom: "1rem" }}>{t("token.overview")}</h3>
                  <div className="grid-2" style={{ marginBottom: "1rem" }}>
                    <div className="status-item">
                      <span className="label">{t("token.maxSupply")}:</span>
                      <span className="value" style={{ fontWeight: "bold", color: "#667eea", fontSize: "1.1rem" }}>
                        {formatInteger(uIDCToIDC(IDC_MAX_SUPPLY), locale === "zh" ? "zh-CN" : "en-US")} IDC
                      </span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("token.decimals")}:</span>
                      <span className="value">{IDC_DECIMALS}</span>
                    </div>
                    {chainContext && (
                      <>
                        <div className="status-item">
                          <span className="label">{t("token.totalSupply")}:</span>
                          <span className="value" style={{ fontWeight: "bold" }}>
                            {formatInteger(uIDCToIDC(chainContext.indexState.getTotalMinted()), locale === "zh" ? "zh-CN" : "en-US")} IDC
                          </span>
                        </div>
                        <div className="status-item">
                          <span className="label">{t("network.issuedRatio")}:</span>
                          <span className="value">
                            {formatPercent((Number(chainContext.indexState.getTotalMinted()) / Number(IDC_MAX_SUPPLY)) * 100, 4)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Current Era Information */}
                {chainContext && (
                  <div style={{ marginBottom: "2rem" }}>
                    <h3 style={{ color: "#667eea", marginBottom: "1rem" }}>{t("token.currentEra")}</h3>
                    {(() => {
                      const stats = getEmissionStats(height);
                      return (
                        <div className="status-card" style={{ background: "#f8f9fa" }}>
                          <div className="status-item">
                            <span className="label">{t("token.eraNumber")}:</span>
                            <span className="value" style={{ fontWeight: "bold", fontSize: "1.2rem", color: "#667eea" }}>
                              {stats.year} / {IDC_EMISSION_YEARS - 1}
                            </span>
                          </div>
                          <div className="status-item">
                            <span className="label">{t("token.rewardPerBlock")}:</span>
                            <span className="value" style={{ fontWeight: "bold" }}>
                              {formatNumber(stats.rawRewardIDC, 6, locale === "zh" ? "zh-CN" : "en-US")} IDC
                            </span>
                          </div>
                          <div className="status-item">
                            <span className="label">{t("token.eraStartHeight")}:</span>
                            <span className="value">{stats.eraStartHeight.toString()}</span>
                          </div>
                          <div className="status-item">
                            <span className="label">{t("token.eraEndHeight")}:</span>
                            <span className="value">{stats.eraEndHeight.toString()}</span>
                          </div>
                          <div className="status-item">
                            <span className="label">{t("token.blocksRemaining")}:</span>
                            <span className="value">{stats.blocksRemainingInEra.toString()}</span>
                          </div>
                          <div className="status-item">
                            <span className="label">{t("token.totalEraReward")}:</span>
                            <span className="value" style={{ fontWeight: "bold" }}>
                              {formatInteger(uIDCToIDC(stats.rawReward * stats.blocksInEra), locale === "zh" ? "zh-CN" : "en-US")} IDC
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Emission Model */}
                <div style={{ marginBottom: "2rem" }}>
                  <h3 style={{ color: "#667eea", marginBottom: "1rem" }}>{t("token.emissionModel")}</h3>
                  <div className="status-card" style={{ background: "#f8f9fa" }}>
                    <p style={{ marginBottom: "1rem", lineHeight: "1.8" }}>
                      {locale === "zh" 
                        ? "IDC 采用最大化激励模型，专为浏览器挖矿优化。总供应量固定为 10 亿 IDC，通过 10 年逐步发行。第一年产出 50%（500M IDC），前 3 年产出 90%（875M IDC），最大化早期参与者的吸引力。"
                        : "IDC uses a maximized incentive model optimized for browser mining. Fixed total supply of 1 billion IDC, distributed over 10 years. First year produces 50% (500M IDC), first 3 years produce 90% (875M IDC), maximizing attraction for early adopters."}
                    </p>
                    <ul style={{ marginLeft: "1.5rem", lineHeight: "1.8" }}>
                      <li>{locale === "zh" ? "总供应量：10 亿 IDC（固定上限）" : `Total Supply: 1 billion IDC (fixed cap)`}</li>
                      <li>{locale === "zh" ? "发行周期：10 年（不是 100 年）" : `Emission Period: 10 years (not 100 years)`}</li>
                      <li>{locale === "zh" ? "区块时间：约 10 秒" : `Block Time: ~10 seconds`}</li>
                      <li>{locale === "zh" ? "第一年产出：50%（500M IDC）" : `Year 1 Output: 50% (500M IDC)`}</li>
                      <li>{locale === "zh" ? "前 3 年产出：90%（875M IDC）" : `First 3 Years: 90% (875M IDC)`}</li>
                      <li>{locale === "zh" ? "每年区块数：3,153,600 个区块" : `Blocks per Year: 3,153,600 blocks`}</li>
                    </ul>
                  </div>
                </div>

                {/* Emission Curve Table */}
                <div style={{ marginBottom: "2rem" }}>
                  <h3 style={{ color: "#667eea", marginBottom: "1rem" }}>{t("token.emissionCurve")}</h3>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", background: "white", borderRadius: "8px", overflow: "hidden" }}>
                      <thead>
                        <tr style={{ background: "#667eea", color: "white" }}>
                          <th style={{ padding: "0.75rem", textAlign: "left", border: "1px solid #ddd" }}>{t("app.year")}</th>
                          <th style={{ padding: "0.75rem", textAlign: "left", border: "1px solid #ddd" }}>{t("token.years")}</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", border: "1px solid #ddd" }}>{t("token.rewardPerBlock")}</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", border: "1px solid #ddd" }}>{t("app.yearlyOutput")}</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", border: "1px solid #ddd" }}>{t("token.cumulativeReward")}</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", border: "1px solid #ddd" }}>{t("app.cumulativePercent")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: IDC_EMISSION_YEARS }, (_, year) => {
                          const yearReward = getBlockRewardRaw(year * Number(IDC_BLOCKS_PER_YEAR));
                          const yearRewardIDC = uIDCToIDC(yearReward);
                          const totalYearReward = yearReward * IDC_BLOCKS_PER_YEAR;
                          const totalYearRewardIDC = uIDCToIDC(totalYearReward);
                          
                          // Calculate cumulative reward
                          let cumulative = 0n;
                          for (let i = 0; i <= year; i++) {
                            const yReward = getBlockRewardRaw(i * Number(IDC_BLOCKS_PER_YEAR));
                            cumulative += yReward * IDC_BLOCKS_PER_YEAR;
                          }
                          const cumulativeIDC = uIDCToIDC(cumulative);
                          const cumulativePercent = (Number(cumulative) / Number(IDC_MAX_SUPPLY)) * 100;
                          
                          const currentYear = chainContext ? getEmissionStats(height).year : 0;
                          const isCurrentYear = year === currentYear;
                          const isYear1 = year === 0;
                          const isYear1To3 = year < 3;
                          
                          return (
                            <tr 
                              key={year}
                              style={{ 
                                background: isCurrentYear ? "#fff3cd" : isYear1 ? "#d4edda" : isYear1To3 ? "#d1ecf1" : year % 2 === 0 ? "#f8f9fa" : "white",
                                border: isYear1 ? "2px solid #28a745" : isCurrentYear ? "2px solid #ffc107" : undefined
                              }}
                            >
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd", fontWeight: isCurrentYear ? "bold" : "normal" }}>
                                {year + 1}
                                {isYear1 && <span style={{ color: "#28a745", marginLeft: "0.5rem" }}>⭐</span>}
                              </td>
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd" }}>
                                {year} - {year + 1}
                              </td>
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd", textAlign: "right", fontFamily: "monospace" }}>
                                {formatNumber(yearRewardIDC, 6, locale === "zh" ? "zh-CN" : "en-US")} IDC
                              </td>
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd", textAlign: "right", fontFamily: "monospace" }}>
                                {formatInteger(totalYearRewardIDC, locale === "zh" ? "zh-CN" : "en-US")} IDC
                              </td>
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd", textAlign: "right", fontFamily: "monospace", fontWeight: "bold" }}>
                                {formatInteger(cumulativeIDC, locale === "zh" ? "zh-CN" : "en-US")} IDC
                              </td>
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd", textAlign: "right", fontFamily: "monospace", fontWeight: "bold", color: isYear1 ? "#28a745" : isYear1To3 ? "#0c5460" : undefined }}>
                                {formatPercent(cumulativePercent, 2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Transaction Fees */}
                <div style={{ marginBottom: "2rem" }}>
                  <h3 style={{ color: "#667eea", marginBottom: "1rem" }}>{t("token.transactionFees")}</h3>
                  <div className="status-card" style={{ background: "#f8f9fa" }}>
                    <div className="status-item">
                      <span className="label">{t("token.baseFee")}:</span>
                      <span className="value">{formatNumber(uIDCToIDC(IDC_BASE_FEE), 6, locale === "zh" ? "zh-CN" : "en-US")} IDC</span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("token.feePer100Bytes")}:</span>
                      <span className="value">{formatNumber(uIDCToIDC(IDC_FEE_PER_100_BYTES), 6, locale === "zh" ? "zh-CN" : "en-US")} IDC</span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("token.feeFormula")}:</span>
                      <span className="value" style={{ fontFamily: "monospace", fontSize: "0.9rem" }}>
                        Fee = {formatNumber(uIDCToIDC(IDC_BASE_FEE), 6, locale === "zh" ? "zh-CN" : "en-US")} IDC + (Size / 100) × {formatNumber(uIDCToIDC(IDC_FEE_PER_100_BYTES), 6, locale === "zh" ? "zh-CN" : "en-US")} IDC
                      </span>
                    </div>
                  </div>
                </div>

                {/* Token Economics */}
                <div style={{ marginBottom: "2rem" }}>
                  <h3 style={{ color: "#667eea", marginBottom: "1rem" }}>{t("token.economics")}</h3>
                  <div className="status-card" style={{ background: "#d4edda", border: "2px solid #28a745" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      <div>
                        <strong style={{ color: "#155724" }}>✓ {t("token.supplyCap")}</strong>
                        <p style={{ margin: "0.5rem 0 0 0", color: "#155724", fontSize: "0.9rem" }}>
                          {locale === "zh" 
                            ? "总供应量严格限制在 10 亿 IDC，永远不会超过此上限。"
                            : "Total supply is strictly capped at 1 billion IDC and will never exceed this limit."}
                        </p>
                      </div>
                      <div>
                        <strong style={{ color: "#155724" }}>✓ {locale === "zh" ? "最大化早期激励" : "Maximized Early Incentives"}</strong>
                        <p style={{ margin: "0.5rem 0 0 0", color: "#155724", fontSize: "0.9rem" }}>
                          {locale === "zh" 
                            ? "第一年产出 50%（500M IDC），前 3 年产出 90%（875M IDC），最大化早期参与者的吸引力，快速建立网络规模。"
                            : "First year produces 50% (500M IDC), first 3 years produce 90% (875M IDC), maximizing attraction for early adopters and rapidly building network scale."}
                        </p>
                      </div>
                      <div>
                        <strong style={{ color: "#155724" }}>✓ {locale === "zh" ? "奖励系数系统" : "Reward Multiplier System"}</strong>
                        <p style={{ margin: "0.5rem 0 0 0", color: "#155724", fontSize: "0.9rem" }}>
                          {locale === "zh" 
                            ? "IP 信誉分（0.3x-1.3x）和在线时长系数（0.5x-1.2x）双重激励，鼓励真实独立节点和长期稳定在线。"
                            : "Dual incentive system: IP reputation (0.3x-1.3x) and session duration (0.5x-1.2x) multipliers, encouraging genuine independent nodes and long-term stability."}
                        </p>
                      </div>
                      <div>
                        <strong style={{ color: "#155724" }}>✓ {t("token.noInflation")}</strong>
                        <p style={{ margin: "0.5rem 0 0 0", color: "#155724", fontSize: "0.9rem" }}>
                          {locale === "zh" 
                            ? "10 年发行期结束后，将不再产生新的代币，实现零通胀。"
                            : "After the 10-year emission period ends, no new tokens will be created, achieving zero inflation."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Privacy Tab */}
          {activeTab === "privacy" && (
            <div className="tab-content active">
              <PrivacyPanel
                chainContext={chainContext}
                onBroadcastTx={(tx) => {
                  if (chainContext) {
                    broadcastTransaction(tx, chainContext);
                  }
                }}
              />
            </div>
          )}

          {/* Tools Tab */}
          {activeTab === "tools" && (
            <div className="tab-content active">
              <div className="status-card">
                <h2>{t("tools.title")}</h2>
                <p style={{ marginBottom: "1.5rem", color: "#666" }}>
                  {t("tools.description")}
                </p>

                {/* Storage Information */}
                <div style={{ marginBottom: "2rem" }}>
                  <h3 style={{ marginBottom: "1rem" }}>
                    {t("tools.storageInformation")}
                  </h3>
                  <div style={{ 
                    background: "#f8f9fa", 
                    padding: "1rem", 
                    borderRadius: "6px",
                    marginBottom: "1rem"
                  }}>
                    {(() => {
                      const chainBlocksKey = "indexerchain_blocks_v1";
                      const snapshotsMetaKey = "indexerchain_snapshots_meta";
                      const snapshotKeys = Object.keys(localStorage).filter(k => k.startsWith("indexerchain_snapshot_"));
                      
                      const chainBlocksData = localStorage.getItem(chainBlocksKey);
                      const snapshotsMetaData = localStorage.getItem(snapshotsMetaKey);
                      
                      let totalSize = 0;
                      let chainBlocksSize = 0;
                      let snapshotsSize = 0;
                      let snapshotsMetaSize = 0;
                      
                      if (chainBlocksData) {
                        chainBlocksSize = new Blob([chainBlocksData]).size;
                        totalSize += chainBlocksSize;
                      }
                      
                      if (snapshotsMetaData) {
                        snapshotsMetaSize = new Blob([snapshotsMetaData]).size;
                        totalSize += snapshotsMetaSize;
                      }
                      
                      snapshotKeys.forEach(key => {
                        const data = localStorage.getItem(key);
                        if (data) {
                          const size = new Blob([data]).size;
                          snapshotsSize += size;
                          totalSize += size;
                        }
                      });
                      
                      const formatSize = (bytes: number) => {
                        if (bytes < 1024) return bytes + " B";
                        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
                        return (bytes / (1024 * 1024)).toFixed(2) + " MB";
                      };
                      
                      return (
                        <div style={{ display: "grid", gap: "0.75rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>{t("tools.chainBlocks")}</span>
                            <strong>{formatSize(chainBlocksSize)}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>{t("tools.snapshotsMetadata")}</span>
                            <strong>{formatSize(snapshotsMetaSize)}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>{t("tools.snapshots", { count: snapshotKeys.length })}</span>
                            <strong>{formatSize(snapshotsSize)}</strong>
                          </div>
                          <div style={{ 
                            display: "flex", 
                            justifyContent: "space-between",
                            paddingTop: "0.75rem",
                            borderTop: "2px solid #dee2e6",
                            marginTop: "0.5rem"
                          }}>
                            <span style={{ fontWeight: "bold" }}>
                              {t("tools.total")}
                            </span>
                            <strong style={{ fontSize: "1.1rem", color: "#667eea" }}>
                              {formatSize(totalSize)}
                            </strong>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Chain Data Management */}
                <div style={{ marginBottom: "2rem" }}>
                  <h3 style={{ marginBottom: "1rem" }}>
                    {t("tools.chainDataManagement")}
                  </h3>
                  <div style={{ display: "grid", gap: "1rem" }}>
                    <div style={{ 
                      background: "#fff3cd", 
                      padding: "1rem", 
                      borderRadius: "6px",
                      border: "1px solid #ffc107"
                    }}>
                      <h4 style={{ marginBottom: "0.5rem" }}>
                        {t("tools.resetChain")}
                      </h4>
                      <p style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#856404" }}>
                        {t("tools.resetChainDesc")}
                      </p>
                      <button
                        className="btn btn-secondary"
                        onClick={handleResetChain}
                        style={{ 
                          backgroundColor: "#dc3545",
                          color: "white",
                          border: "none",
                          padding: "0.75rem 1.5rem",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontWeight: "bold"
                        }}
                      >
                        {t("tools.resetChainButton")}
                      </button>
                    </div>

                    <div style={{ 
                      background: "#d1ecf1", 
                      padding: "1rem", 
                      borderRadius: "6px",
                      border: "1px solid #bee5eb"
                    }}>
                      <h4 style={{ marginBottom: "0.5rem" }}>
                        {t("tools.clearSnapshots")}
                      </h4>
                      <p style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#0c5460" }}>
                        {t("tools.clearSnapshotsDesc")}
                      </p>
                      <button
                        className="btn btn-secondary"
                        onClick={async () => {
                          if (window.confirm(t("tools.clearSnapshotsConfirm"))) {
                            clearAllSnapshots();
                            setError(t("tools.clearSnapshotsSuccess"));
                            setTimeout(() => setError(""), 3000);
                            window.location.reload();
                          }
                        }}
                        style={{ 
                          backgroundColor: "#17a2b8",
                          color: "white",
                          border: "none",
                          padding: "0.75rem 1.5rem",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontWeight: "bold"
                        }}
                      >
                        {t("tools.clearSnapshotsButton")}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Common Issues & Fixes */}
                <div style={{ marginBottom: "2rem" }}>
                  <h3 style={{ marginBottom: "1rem" }}>
                    {t("tools.commonIssues")}
                  </h3>
                  <div style={{ display: "grid", gap: "1rem" }}>
                    <div style={{ 
                      background: "#f8d7da", 
                      padding: "1rem", 
                      borderRadius: "6px",
                      border: "1px solid #f5c6cb"
                    }}>
                      <h4 style={{ marginBottom: "0.5rem" }}>
                        {t("tools.insufficientBalanceError")}
                      </h4>
                      <p style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#721c24" }}>
                        {t("tools.insufficientBalanceErrorDesc")}
                      </p>
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          if (window.confirm(t("tools.clearAllDataConfirm"))) {
                            localStorage.removeItem("indexerchain_blocks_v1");
                            localStorage.removeItem("indexerchain_snapshots_meta");
                            Object.keys(localStorage)
                              .filter(k => k.startsWith("indexerchain_snapshot_"))
                              .forEach(k => localStorage.removeItem(k));
                            setError(t("tools.clearAllDataSuccess"));
                            setTimeout(() => window.location.reload(), 1000);
                          }
                        }}
                        style={{ 
                          backgroundColor: "#dc3545",
                          color: "white",
                          border: "none",
                          padding: "0.75rem 1.5rem",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontWeight: "bold"
                        }}
                      >
                        {t("tools.fixBalanceError")}
                      </button>
                    </div>

                    <div style={{ 
                      background: "#fff3cd", 
                      padding: "1rem", 
                      borderRadius: "6px",
                      border: "1px solid #ffc107"
                    }}>
                      <h4 style={{ marginBottom: "0.5rem" }}>
                        {t("tools.initializationError")}
                      </h4>
                      <p style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#856404" }}>
                        {t("tools.initializationErrorDesc")}
                      </p>
                      <button
                        className="btn btn-secondary"
                        onClick={handleResetChain}
                        style={{ 
                          backgroundColor: "#ffc107",
                          color: "#333",
                          border: "none",
                          padding: "0.75rem 1.5rem",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontWeight: "bold"
                        }}
                      >
                        {t("tools.fixInitializationError")}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Storage Cleanup */}
                <div style={{ marginBottom: "2rem" }}>
                  <h3 style={{ marginBottom: "1rem" }}>
                    {t("app.storageCleanup")}
                  </h3>
                  <div style={{ 
                    background: "#e7f3ff", 
                    padding: "1rem", 
                    borderRadius: "6px",
                    border: "1px solid #b3d9ff"
                  }}>
                    <p style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#004085" }}>
                      {t("storageCleanup.checkUnusedStorage")}
                    </p>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        const allKeys = Object.keys(localStorage);
                        const chainKeys = allKeys.filter(k => 
                          k.startsWith("indexerchain_") || 
                          k.startsWith("browser_node_") ||
                          k.startsWith("node_address_")
                        );
                        const otherKeys = allKeys.filter(k => !chainKeys.includes(k));
                        
                        if (otherKeys.length === 0) {
                          alert(
                            t("storageCleanup.noUnusedStorage")
                          );
                          return;
                        }
                        
                        if (window.confirm(
                          locale === "zh" 
                            ? `发现 ${otherKeys.length} 个非链相关的存储项。是否清除？` 
                            : `Found ${otherKeys.length} non-chain storage items. Clear them?`
                        )) {
                          otherKeys.forEach(k => localStorage.removeItem(k));
                          alert(
                            locale === "zh" 
                              ? `✅ 已清除 ${otherKeys.length} 个存储项。` 
                              : `✅ Cleared ${otherKeys.length} storage items.`
                          );
                          window.location.reload();
                        }
                      }}
                      style={{ 
                        backgroundColor: "#17a2b8",
                        color: "white",
                        border: "none",
                        padding: "0.75rem 1.5rem",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontWeight: "bold"
                      }}
                    >
                      {t("app.cleanUnusedStorage")}
                    </button>
                  </div>
                </div>

                {/* Warning */}
                <div style={{ 
                  background: "#f8d7da", 
                  padding: "1rem", 
                  borderRadius: "6px",
                  border: "1px solid #f5c6cb",
                  marginTop: "2rem"
                }}>
                  <strong style={{ color: "#721c24" }}>
                    ⚠️ {t("app.warning")}
                  </strong>
                  <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#721c24" }}>
                    {locale === "zh" 
                      ? "这些操作会永久删除数据。请确保您了解操作的后果。建议在执行前备份重要数据。" 
                      : "These operations will permanently delete data. Make sure you understand the consequences. It's recommended to backup important data before proceeding."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Other tabs placeholder - to be implemented */}
          {activeTab !== "overview" && activeTab !== "wallet" && activeTab !== "mining" && activeTab !== "transactions" && activeTab !== "network" && activeTab !== "storage" && activeTab !== "advanced" && activeTab !== "token" && activeTab !== "privacy" && activeTab !== "tools" && activeTab !== "runtime" && (
            <div className="tab-content active">
              <div className="status-card">
                <h2>🚧 {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Tab</h2>
                <p>This section is being organized. Content will be moved here soon.</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
