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
import { handleReceivedBlock, handleReceivedBlocks } from "../core/sync.js";
import { GlobalStateSentinel } from "../core/globalSentinel.js";
import type { DriftAssessment } from "../core/types.js";
import { verifyTxSignature } from "../core/signatures.js";
import { verifyBlock } from "../core/verify.js";
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
  uIDCToIDC,
  IDC_MAX_SUPPLY,
  IDC_ERA_COUNT,
  IDC_DECIMALS,
  IDC_BASE_REWARD,
  IDC_BLOCKS_PER_ERA,
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
import { QuickStatusDashboard } from "./components/QuickStatusDashboard.js";
import { AccordionCard } from "./components/AccordionCard.js";
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
      console.warn("Failed to load persisted state:", e);
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
  // Phase 17: Support mainnet mode (default) and dev mode
  // Default to mainnet signaling server (can be configured)
  const [bootstrapUrl, setBootstrapUrl] = useState<string>(persistedState.bootstrapUrl ?? DEFAULT_MAINNET_SIGNALING);
  const [isMainnetMode, setIsMainnetMode] = useState<boolean>(persistedState.isMainnetMode ?? true);
  const [peerCount, setPeerCount] = useState<number>(0);
  const [isP2PConnected, setIsP2PConnected] = useState<boolean>(false);
  const [nodeAddress, setNodeAddress] = useState<string>("");
  const [isSigning, setIsSigning] = useState<boolean>(false);
  
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

  const [needsReset, setNeedsReset] = useState<boolean>(false);

  // Tab navigation state
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [showAdvancedTabs, setShowAdvancedTabs] = useState<boolean>(false); // Advanced tabs collapsed by default
  
  // Auto-expand advanced tabs if user navigates to an advanced tab
  useEffect(() => {
    const advancedTabs = ["storage", "advanced", "token", "privacy", "tools", "runtime"];
    if (advancedTabs.includes(activeTab) && !showAdvancedTabs) {
      setShowAdvancedTabs(true);
    }
  }, [activeTab, showAdvancedTabs]);

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
        console.warn("Failed to save app state:", e);
      }
    };
    saveState();
  }, [isMining, clusterMining, autoMining, bootstrapUrl, isMainnetMode, isP2PConnected]);

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
          console.log("[App] Set error (corruption):", fullErrorMsg.substring(0, 200));
        } else {
          const fullErrorMsg = `Failed to initialize chain: ${errorMsg}\n\n` +
            `If this persists, try resetting the chain using the button below.`;
          setError(fullErrorMsg);
          console.log("[App] Set error (other):", fullErrorMsg.substring(0, 200));
        }
        
        console.log("[App] Set needsReset=true, error length:", errorMsg.length);
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
      
      console.log(`[Auto-Connect] Attempting automatic connection to ${urlToUse}`, { 
        hasSavedState: !!savedState.bootstrapUrl,
        savedUrl: savedState.bootstrapUrl,
        currentUrl: bootstrapUrl,
        willUse: urlToUse
      });
      
      // If saved state has a different URL, update it first
      if (savedState.bootstrapUrl && savedState.bootstrapUrl !== bootstrapUrl) {
        console.log(`[Auto-Connect] Updating bootstrap URL from ${bootstrapUrl} to ${savedState.bootstrapUrl}`);
        setBootstrapUrl(savedState.bootstrapUrl);
        // Wait for state update, then connect
        setTimeout(() => {
          console.log(`[Auto-Connect] Connecting after URL update...`);
          handleConnectP2P();
        }, 500);
      } else {
        // Ensure bootstrapUrl is set if it's not already
        if (bootstrapUrl !== urlToUse) {
          setBootstrapUrl(urlToUse);
          setTimeout(() => {
            console.log(`[Auto-Connect] Connecting to ${urlToUse}...`);
            handleConnectP2P();
          }, 500);
        } else {
          // Connect immediately with current bootstrapUrl
          setTimeout(() => {
            console.log(`[Auto-Connect] Connecting to ${urlToUse}...`);
            handleConnectP2P();
          }, 1000); // Small delay to ensure everything is ready
        }
      }
    } else {
      console.log(`[Auto-Connect] No bootstrap URL available, skipping auto-connect`);
    }
  }, [chainContext, loading]); // Only depend on chainContext and loading to avoid re-triggering

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
        console.warn("[Phase 13] Background verification error:", error);
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
    const confirmMsg = "This will clear all chain data and snapshots, then start fresh. Continue?";
    if (!confirm(confirmMsg)) {
      return;
    }
    
    // Clear chain storage (even if chainContext is null, we can still clear)
    if (chainContext) {
      chainContext.storage.reset();
    } else {
      // If chainContext is null, clear directly from localStorage
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("indexerchain_blocks");
      }
    }
    
    // Clear all snapshots (they might be corrupted)
    clearAllSnapshots();
    
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
          console.warn("[Phase 36] Critical drift detected, starting repair...");
          repairManager.startRepair(
            driftCheck,
            () => {
              console.log("[Phase 36] State repair completed successfully");
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

  // Setup P2P message handlers
  useEffect(() => {
    if (!chainContext || !chainContext.p2p) return;

    const p2p = chainContext.p2p;

    // Handle NEW_TX messages
    p2p.onMessage("NEW_TX", async (tx: Tx, sender: string) => {
      console.log("Received NEW_TX from", sender);
      // Phase 5: Verify signature before adding
      const isValid = await verifyTxSignature(tx);
      if (!isValid) {
        console.warn("Received invalid transaction, ignoring:", tx.txId);
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
      console.log("[Phase 17] Received NEW_BLOCK_HEADER from", sender, "height:", compactHeader.height);
      const { handleReceivedBlockHeader } = await import("../core/sync.js");
      const result = await handleReceivedBlockHeader(compactHeader, chainContext, p2p, sender);
      
      if (result.handled) {
        // Phase 19: Attempt to become delegator for new block
        if (globalPoolEnabled && delegatorManager) {
          delegatorManager.attemptBecomeDelegator(compactHeader.height);
        }
        
        // Phase 17: If should restart mining, stop current mining and restart
        if (result.shouldRestartMining) {
          console.log("[Phase 17] New block header received, restarting mining...");
          
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
      console.log("[Phase 17] Received REQUEST_BLOCK_BODY from", sender, "hash:", request.hash);
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
        console.log(`[Phase 17] Block ${request.hash} not found in local storage`);
      }
    });

    // Phase 17: Handle BLOCK_BODY
    // Phase 21: Pass sender for peer reputation tracking
    p2p.onMessage("BLOCK_BODY", async (block: Block, sender: string) => {
      console.log("[Phase 17] Received BLOCK_BODY from", sender, "height:", block.header.height);
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
      console.log("Received NEW_BLOCK from", sender, "height:", block.header.height);
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
    p2p.onMessage("REQUEST_BLOCKS", async (request: { fromHeight: number; toHeight: number }, sender: string) => {
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
        // Only log when actually sending blocks
        // Send blocks directly to the requesting peer if sendToPeer is available
        if (p2p.sendToPeer) {
          p2p.sendToPeer(sender, "BLOCKS", { blocks, requestId: `${sender}_${Date.now()}` });
        } else {
          // Fallback to broadcast
          p2p.broadcast("BLOCKS", { blocks, requestId: `${sender}_${Date.now()}` });
        }
      }
    });

    // Handle BLOCKS messages (chain sync)
    // Phase 21: Pass sender for peer reputation tracking
    p2p.onMessage("BLOCKS", async (data: { blocks: Block[] }, sender: string) => {
      // Suppress frequent BLOCKS logs - only log occasionally or for significant events
      // console.log(`[Sync] Received BLOCKS from ${sender.substring(0, 16)}...`, {
      //   count: data.blocks.length,
      //   heights: data.blocks.length > 0 ? `${data.blocks[0]?.header?.height ?? '?'}-${data.blocks[data.blocks.length - 1]?.header?.height ?? '?'}` : "none",
      //   localHeight
      // });
      
      if (data.blocks.length === 0) {
        console.warn("[Sync] Received empty BLOCKS message");
        return;
      }
      
      const result = await handleReceivedBlocks(data.blocks, chainContext, sender);
      
      // Always update UI even if no blocks were appended (blocks may already exist)
      const newTip = chainContext.storage.getTip();
      const newHeight = newTip?.header.height ?? 0;
      
      if (result.success && result.appended > 0) {
        // Only log when significant progress is made (e.g., > 10 blocks or reaching milestones)
        if (result.appended > 10 || newHeight % 100 === 0) {
          console.log(`[Sync] ✅ Appended ${result.appended} blocks. New height: ${newHeight}`);
        }
        setChainContext({ ...chainContext }); // Trigger re-render
        
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
          return { ...prev, localHeight: newHeight };
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
          // Try to infer networkHeight from received blocks
          if (maxReceivedHeight > newHeight) {
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
          return { ...prev, localHeight: newHeight };
        });
        
        // If the highest received block is higher than what we have, request more
        if (maxReceivedHeight > newHeight) {
          console.log(`[Sync] Received blocks up to height ${maxReceivedHeight}, but we're at ${newHeight}, requesting more...`);
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
        console.error("[Sync] ❌ Failed to append blocks:", result.error);
      } else if (result.appended === 0) {
        console.warn("[Sync] ⚠️ No blocks appended (may already have them)");
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
              console.log(`[Auto-Connect] Saved connection state: autoConnect=true, bootstrapUrl=${bootstrapUrl}`);
            }
          } catch (e) {
            console.warn("Failed to save connection state:", e);
          }
        }
      } else {
        setPeerCount(0);
        setIsP2PConnected(false);
      }
    }, 1000);

    // Phase 28: Auto-sync check - periodically check if we're behind and request blocks
    // This helps keep nodes in sync automatically
    const autoSyncInterval = setInterval(() => {
      if (!chainContext || !p2p.isConnected) {
        return; // Not connected, skip
      }

      const peerCount = p2p.getPeerCount();
      const localTip = chainContext.storage.getTip();
      const localHeight = localTip?.header.height ?? -1;
      const now = Date.now();
      
      // Query network height periodically (every ~10 seconds) if we have peers
      // Suppress frequent auto-sync logs - only query occasionally
      if (peerCount > 0 && now % 10000 < 3000) {
        p2p.broadcast("GLOBAL_VIEW_REQUEST", {});
      }
      
      // Request blocks if we have peers
      if (peerCount > 0) {
        // Check if we have a pending block request from when we had no peers
        if (typeof window !== "undefined" && (window as any).pendingBlockRequest) {
          const pending = (window as any).pendingBlockRequest;
          console.log(`[Auto-Sync] Executing pending block request: ${pending.fromHeight}-${pending.toHeight}`);
          p2p.broadcast("REQUEST_BLOCKS", pending);
          delete (window as any).pendingBlockRequest;
        }
        
        // If we're at height 0 or very low, request more aggressively for initial sync
        if (localHeight === 0 || localHeight < 100) {
          // Request a larger range for initial sync
          const requestRange = 500; // Increased for faster initial sync
          console.log(`[Auto-Sync] Local height is ${localHeight}, requesting blocks from ${localHeight + 1} to ${localHeight + requestRange}`);
          p2p.broadcast("REQUEST_BLOCKS", {
            fromHeight: localHeight + 1,
            toHeight: localHeight + requestRange,
          });
        } else {
          // For ongoing sync, request a smaller range periodically
          const requestRange = 100; // Increased from 50
          p2p.broadcast("REQUEST_BLOCKS", {
            fromHeight: localHeight + 1,
            toHeight: localHeight + requestRange,
          });
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
            console.log(`[Auto-Sync] No peers, requesting peers and bootstrap data again...`);
            (p2p as any).sendToSignalServer("REQUEST_BOOTSTRAP", {
              requestId: `${Date.now()}_${Math.random()}`,
              wantSnapshotMeta: true,
              wantHeaders: true,
              headerCount: 200,
            });
          }
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
      
      // Handle availableFromHeight hint (when peer can't provide requested blocks)
      if (payload && typeof payload.availableFromHeight === 'number' && payload.availableFromHeight > 0) {
        const localTip = chainContext.storage.getTip();
        const localHeight = localTip?.header?.height ?? -1;
        
        // If we're requesting blocks that are pruned, update our request to start from availableFromHeight
        if (localHeight < payload.availableFromHeight && payload.height > localHeight) {
          console.log(`[Sync] Peer indicates blocks available from height ${payload.availableFromHeight}, updating request range`);
          // Request from available height instead
          p2p.broadcast("REQUEST_BLOCKS", {
            fromHeight: payload.availableFromHeight,
            toHeight: Math.min(payload.height, payload.availableFromHeight + 500),
          });
          return; // Don't process as regular GLOBAL_VIEW_RESPONSE
        }
      }
      
      // Use network height to trigger sync if we're behind
      if (payload && typeof payload.height === 'number' && payload.height > 0) {
        const networkHeight = payload.height;
        lastKnownNetworkHeight = Math.max(lastKnownNetworkHeight, networkHeight); // Track highest known height
        
        const localTip = chainContext.storage.getTip();
        const localHeight = localTip?.header.height ?? -1;
        const behindBy = networkHeight - localHeight;
        
        // Suppress frequent sync status logs - only log when height changes significantly
        // console.log(`[Sync] Network height: ${networkHeight}, Local height: ${localHeight}, Behind by: ${behindBy}`);
        
        // Update sync status (always update if we have a valid network height)
        setSyncStatus(prev => {
          // Always update networkHeight if we receive a valid response
          // Use the higher of the two network heights (in case of multiple responses)
          const finalNetworkHeight = Math.max(networkHeight, prev.networkHeight);
          const finalBehindBy = finalNetworkHeight - localHeight;
          
          return {
            isSyncing: finalBehindBy > 0,
            localHeight,
            networkHeight: finalNetworkHeight,
            behindBy: finalBehindBy,
            progress: finalNetworkHeight > 0 ? Math.min(100, Math.max(0, (localHeight / finalNetworkHeight) * 100)) : 0,
          };
        });
        
        if (networkHeight > localHeight) {
          const requestRange = Math.min(behindBy, 500); // Request up to 500 blocks at a time
          // Suppress frequent request logs
          // console.log(`[Sync] Requesting ${requestRange} blocks to catch up (from ${localHeight + 1} to ${localHeight + requestRange})`);
          p2p.broadcast("REQUEST_BLOCKS", {
            fromHeight: localHeight + 1,
            toHeight: localHeight + requestRange,
          });
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
      console.log(`[Phase 32] Received BOOTSTRAP_RESPONSE from ${sender}`, {
        latestHeight: payload.latestHeight,
        latestHeaderHash: payload.latestHeaderHash?.substring(0, 16) + "...",
        hasHeader: !!payload.latestHeader,
        hasSnapshotMeta: !!payload.latestSnapshotMeta,
        recentHeadersCount: payload.recentHeaders?.length || 0
      });
      
      // Phase 37: Store rootTip info for debug overlay
      if (typeof window !== "undefined" && payload.latestHeight > 0) {
        (window as any).lastRootTipHeight = payload.latestHeight;
        (window as any).lastRootTipHash = payload.latestHeaderHash || "";
        (window as any).lastBootstrapResponseTime = Date.now();
        (window as any).lastRootTipTrustLevel = payload.trustLevel || 'root-only';
        (window as any).lastRootTipStateCommitment = payload.stateCommitment || null;
      }
      
      if (!chainContext) {
        console.warn(`[Phase 32] No chainContext available, ignoring BOOTSTRAP_RESPONSE`);
        return;
      }
      
      const localTip = chainContext.storage.getTip();
      const localHeight = localTip?.header.height ?? -1;
      const networkHeight = payload.latestHeight || 0;
      
      // Phase 32: If bootstrap state is empty (latestHeight: 0), fall back to P2P query
      if (networkHeight === 0 || !payload.latestHeader) {
        console.log(`[Phase 32] Bootstrap state is empty (height: ${networkHeight}), falling back to P2P network query`);
        
        // Mark bootstrap as complete (even though we don't have valid data)
        // This allows mining guard to proceed, but we'll rely on P2P for sync
        setBootstrapComplete(true);
        
        // Query network height via P2P (if we have peers)
        const peerCount = p2p.getPeerCount();
        if (peerCount > 0) {
          console.log(`[Phase 32] Querying network height from ${peerCount} peer(s) via GLOBAL_VIEW_REQUEST`);
          p2p.broadcast("GLOBAL_VIEW_REQUEST", {});
        } else {
          console.log(`[Phase 32] No peers available yet, requesting peers more aggressively...`);
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
          console.log(`[Phase 32] Requesting blocks aggressively for initial sync (local height: ${localHeight})`);
          if (peerCount > 0) {
            p2p.broadcast("REQUEST_BLOCKS", {
              fromHeight: localHeight + 1,
              toHeight: localHeight + 500,
            });
          } else {
            // Store request for when peers connect
            console.log(`[Phase 32] Storing block request for when peers connect`);
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
        const { getBootstrapSyncManager } = await import("../core/bootstrapSync.js");
        const bootstrapManager = getBootstrapSyncManager(chainContext);
        
        const result = await bootstrapManager.processBootstrapResponse(payload);
        
        if (result.success) {
          console.log(`[Phase 32] Bootstrap sync ${result.synced ? 'completed' : 'skipped (already up to date)'}`, result.actions);
          setBootstrapComplete(bootstrapManager.isBootstrapComplete());
          
          // Only update if we got a valid network height
          if (networkHeight > 0) {
            const behindBy = networkHeight - localHeight;
            
            setSyncStatus({
              isSyncing: behindBy > 0,
              localHeight,
              networkHeight,
              behindBy,
              progress: networkHeight > 0 ? Math.min(100, Math.max(0, (localHeight / networkHeight) * 100)) : 0,
            });
            
            console.log(`[Phase 32] Updated sync status: behindBy=${behindBy}, progress=${Math.round((localHeight / networkHeight) * 100)}%`);
          } else {
            console.warn(`[Phase 32] Bootstrap response has invalid network height (${networkHeight}), not updating sync status`);
          }
          
          // Phase 37: If we need to sync, trigger block requests immediately
          // This ensures we actually request blocks even if peers=0 (they'll be requested when peers connect)
          if (result.synced && result.newHeight && result.newHeight > localHeight) {
            const heightDiff = result.newHeight - localHeight;
            
            console.log(`[Phase 32] Bootstrap indicates we need to sync: ${heightDiff} blocks behind (local: ${localHeight}, target: ${result.newHeight})`);
            
            // Request blocks via P2P (if we have peers)
            const peerCount = p2p.getPeerCount();
            if (peerCount > 0) {
              console.log(`[Phase 32] Requesting ${heightDiff} blocks from ${peerCount} peer(s) to sync to height ${result.newHeight}`);
              p2p.broadcast("REQUEST_BLOCKS", {
                fromHeight: localHeight + 1,
                toHeight: result.newHeight,
              });
            } else {
              // Store request for when peers connect
              console.log(`[Phase 32] No peers yet, storing block request for when peers connect`);
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
              console.log(`[Phase 32] Large height difference (${heightDiff}), triggering snapshot sync`);
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

    // Phase 32: Handle ROOT_TIP_UPDATE from signal server
    p2p.onMessage("ROOT_TIP_UPDATE", async (payload: any, _sender: string) => {
      if (!chainContext) return;
      
      // Handle both old format (payload.latestHeight) and new format (payload.rootTip)
      const rootTip = payload.rootTip || payload;
      const rootHeight = rootTip.latestHeight || payload.latestHeight || 0;
      const rootHeader = rootTip.latestHeader || payload.latestHeader;
      const rootHeaderHash = rootTip.latestHeaderHash || payload.latestHeaderHash;
      const recentHeaders = rootTip.recentHeaders || payload.recentHeaders;
      const snapshotMeta = rootTip.latestSnapshotMeta || payload.latestSnapshotMeta;
      
      const localTip = chainContext.storage.getTip();
      const localHeight = localTip?.header.height ?? -1;
      
      console.log(`[Phase 32] Received ROOT_TIP_UPDATE: root height=${rootHeight}, local height=${localHeight}, hasHeader=${!!rootHeader}, recentHeaders=${recentHeaders?.length || 0}`);
      
      // Phase 37: Store rootTip info for debug overlay
      if (typeof window !== "undefined" && rootHeight > 0) {
        (window as any).lastRootTipHeight = rootHeight;
        (window as any).lastRootTipHash = rootHeaderHash || "";
        (window as any).lastBootstrapResponseTime = Date.now();
        (window as any).lastRootTipTrustLevel = rootTip.trustLevel || payload.trustLevel || 'root-only';
        (window as any).lastRootTipStateCommitment = rootTip.stateCommitment || payload.stateCommitment || null;
      }
      
      // Use BootstrapSyncManager to handle the update
      if (rootHeight > 0 && rootHeader && rootHeaderHash) {
        try {
          const { BootstrapSyncManager } = await import("../core/bootstrapSync.js");
          const bootstrapManager = new BootstrapSyncManager(chainContext);
          
          // Convert to BootstrapResponse format
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
            console.log(`[Phase 32] Bootstrap sync from ROOT_TIP_UPDATE: ${result.actions.join(", ")}`);
            if (result.newHeight) {
              console.log(`[Phase 32] Synced to height ${result.newHeight}`);
            }
            // Phase 37: Mark bootstrap as complete after successful sync
            setBootstrapComplete(true);
            console.log(`[Phase 37] Bootstrap sync from ROOT_TIP_UPDATE successful, marking bootstrapComplete=true`);
          } else {
            console.warn(`[Phase 32] Bootstrap sync from ROOT_TIP_UPDATE failed: ${result.error}`);
          }
        } catch (error) {
          console.error(`[Phase 32] Error processing ROOT_TIP_UPDATE:`, error);
        }
      }
      
      // Also trigger block request if we're still behind (fallback)
      if (rootHeight > localHeight) {
        const heightDiff = rootHeight - localHeight;
        if (heightDiff > 200) { // Only request if significantly behind
          console.log(`[Phase 32] Root tip update: behind by ${heightDiff} blocks, requesting sync`);
          p2p.broadcast("REQUEST_BLOCKS", {
            fromHeight: localHeight + 1,
            toHeight: rootHeight,
          });
        }
      }
    });

    // Phase 37: Handle peer-connected event to execute pending block requests
    if (typeof window !== "undefined") {
      window.addEventListener("peer-connected", (event: any) => {
        const { peerCount } = event.detail || {};
        console.log(`[Phase 37] Peer connected event: peerCount=${peerCount}`);
        
        // Execute pending bootstrap block request if we have one
        const pendingRequest = (window as any).pendingBootstrapBlockRequest;
        if (pendingRequest && peerCount > 0) {
          const { fromHeight, toHeight, requestedAt } = pendingRequest;
          const age = Date.now() - requestedAt;
          
          // Only execute if request is recent (< 5 minutes)
          if (age < 300000) {
            console.log(`[Phase 37] Executing pending bootstrap block request: ${fromHeight} to ${toHeight} (age: ${Math.round(age / 1000)}s)`);
            p2p.broadcast("REQUEST_BLOCKS", {
              fromHeight,
              toHeight,
            });
            delete (window as any).pendingBootstrapBlockRequest;
          } else {
            console.log(`[Phase 37] Pending bootstrap block request expired (age: ${Math.round(age / 1000)}s), removing`);
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
        console.warn(`[NetworkHandshake] Disconnecting peer ${sender}: networkId mismatch (${payload.networkId} vs ${localNetworkInfo.networkId})`);
        const peer = p2p.peers.get(sender);
        if (peer && peer.connection) {
          peer.connection.close();
          p2p.peers.delete(sender);
        }
        return;
      }
      
      if (payload.genesisHash !== localNetworkInfo.genesisHash) {
        console.warn(`[NetworkHandshake] Disconnecting peer ${sender}: genesisHash mismatch`);
        const peer = p2p.peers.get(sender);
        if (peer && peer.connection) {
          peer.connection.close();
          p2p.peers.delete(sender);
        }
        return;
      }
      
      if (payload.chainParamsHash !== localNetworkInfo.chainParamsHash) {
        console.warn(`[NetworkHandshake] Disconnecting peer ${sender}: chainParamsHash mismatch`);
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
        console.warn(`[NetworkHandshake] Peer ${sender} network parameters mismatch, disconnecting`);
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
        console.warn("[Phase 30] Failed to check mining readiness:", e);
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
    if (!chainContext || !bootstrapUrl) {
      setError("Please enter a bootstrap server URL (e.g., ws://localhost:8080)");
      return;
    }

    try {
      setError("");
      // Save bootstrap URL when connecting (state will be saved by useEffect)
      const nodeId = getOrCreateBrowserNodeId();
      const p2pNode = new BrowserP2PNode(nodeId);
      p2pNodeRef.current = p2pNode;

      await p2pNode.connect(bootstrapUrl);
      p2pNode.requestPeers();

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
          console.log(`[Phase 22] Block ${blockHash.substring(0, 16)}... finalized with certificate`);
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
              console.warn("[GlobalSentinel] Critical drift with fork detected, stopping mining...");
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
          console.log("[GlobalSentinel] Initialized and started");
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
              console.log(`[Phase 31] Found snapshot at height ${closestMeta.height} for repair`);
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
            console.log("[Phase 31] Height consensus: forcing sync");
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
            console.warn("[Phase 31] Height consensus: stopping mining due to fork");
            if (isMining) handleStopMining();
            if (clusterMining) handleStopClusterMining();
            if (autoMining) setAutoMining(false);
            setError(locale === "zh" 
              ? "⚠️ 检测到分叉，已自动停止挖矿" 
              : "⚠️ Fork detected, mining stopped automatically");
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
        
        console.log(`[Phase 32] Connected to P2P network. Local height: ${localHeight}, Connected peers: ${peerCount}`);
        
        // Phase 32: Request bootstrap data from signal server
        console.log(`[Phase 32] Requesting bootstrap data from signal server...`);
        const requestId = `${Date.now()}_${Math.random()}`;
        
        // Check if sendToSignalServer method exists
        if (typeof (p2pNode as any).sendToSignalServer === 'function') {
          console.log(`[Phase 32] Sending REQUEST_BOOTSTRAP via sendToSignalServer`);
          (p2pNode as any).sendToSignalServer("REQUEST_BOOTSTRAP", {
            requestId,
            wantSnapshotMeta: true,
            wantHeaders: true,
            headerCount: 200,
          });
        } else {
          console.warn(`[Phase 32] sendToSignalServer method not available, trying alternative method`);
          // Fallback: try to send via WebSocket directly
          if ((p2pNode as any).ws && (p2pNode as any).ws.readyState === WebSocket.OPEN) {
            (p2pNode as any).ws.send(JSON.stringify({
              type: "REQUEST_BOOTSTRAP",
              requestId,
              wantSnapshotMeta: true,
              wantHeaders: true,
              headerCount: 200,
            }));
            console.log(`[Phase 32] Sent REQUEST_BOOTSTRAP via WebSocket directly`);
          } else {
            console.error(`[Phase 32] Cannot send REQUEST_BOOTSTRAP: WebSocket not available or not open`);
          }
        }
        
        // Also query network height using GLOBAL_VIEW_REQUEST (fallback)
        // This will work once we have peer connections
        console.log(`[Sync] Querying network height from ${peerCount} peer(s)...`);
        if (peerCount > 0) {
          p2pNode.broadcast("GLOBAL_VIEW_REQUEST", {});
        } else {
          // If no peers yet, set up a periodic query
          console.log(`[Sync] No peers yet, will query network height once peers connect`);
          // The GLOBAL_VIEW_REQUEST will be sent automatically once peers connect
        }
        
        // Also request blocks immediately (will be refined once we know network height)
        // Request a larger range for initial sync (height 14 is still very low)
        // But only if we have peers
        if (peerCount > 0) {
          const requestRange = 500; // Increased for better initial sync
          console.log(`[Sync] Requesting blocks from height ${localHeight + 1} to ${localHeight + requestRange}`);
          p2pNode.broadcast("REQUEST_BLOCKS", {
            fromHeight: localHeight + 1,
            toHeight: localHeight + requestRange,
          });
        } else {
          console.log(`[Sync] No peers yet, will request blocks once peers connect`);
        }
        
        // Also request peers to get more connections
        p2pNode.requestPeers();
        
        // Log peer IDs for debugging
        if (peerCount > 0) {
          const peerIds = Array.from(p2pNode.peers.keys());
          console.log(`[Sync] Connected peer IDs:`, peerIds.map(id => id.substring(0, 16) + "..."));
        } else {
          console.warn(`[Sync] No peers connected yet. Waiting for peer connections...`);
        }
        
        // Phase 32: Listen for peer connection events to execute pending block requests
        const handlePeerConnected = (event: CustomEvent) => {
          const { peerId, peerCount: newPeerCount } = event.detail;
          console.log(`[Phase 32] Peer connected: ${peerId.substring(0, 16)}... (total: ${newPeerCount})`);
          
          // Get current local height
          const localTip = chainContext.storage.getTip();
          const localHeight = localTip?.header.height ?? -1;
          
          // Execute pending block request if we have one
          if (typeof window !== "undefined" && (window as any).pendingBlockRequest) {
            const pending = (window as any).pendingBlockRequest;
            console.log(`[Phase 32] Executing pending block request now that peer is connected: ${pending.fromHeight}-${pending.toHeight}`);
            p2pNode.broadcast("REQUEST_BLOCKS", pending);
            delete (window as any).pendingBlockRequest;
          }
          
          // Immediately query network height from the new peer
          if (newPeerCount > 0) {
            console.log(`[Phase 32] Querying network height from ${newPeerCount} peer(s)...`);
            p2pNode.broadcast("GLOBAL_VIEW_REQUEST", {});
            
            // If local height is 0 or very low, immediately request blocks
            // This ensures new nodes sync quickly
            if (localHeight <= 0) {
              console.log(`[Phase 32] Local height is ${localHeight}, immediately requesting blocks from height 1`);
              p2pNode.broadcast("REQUEST_BLOCKS", {
                fromHeight: 1,
                toHeight: 500, // Request first 500 blocks
              });
            } else if (localHeight < 100) {
              // If height is low, also request aggressively
              console.log(`[Phase 32] Local height is low (${localHeight}), requesting blocks aggressively`);
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
            console.log(`[Phase 32] Periodic sync check: height=${localHeight}, peers=${peerCount}, retrying sync...`);
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
    if (!onboardingCompleted && !isMining && !clusterMining) {
      setShowOnboarding(true);
      return;
    }
    
    // Prevent multiple simultaneous starts
    if (isClusterRestartingRef.current && clusterMining) {
      console.log("[Cluster Mining] Already restarting or mining, skipping duplicate start");
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
        console.log(`[Mining] Not ready to mine yet: ${message} (this is normal during initial sync)`);
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
          console.log(`[Cluster Mining] Block ${block.header.height} found but tip is now at ${currentTip.header.height}, block is stale`);
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
        workerNodeManager.onRangeReceived((range) => {
          console.log(`[Cluster Mining] Received new global nonce range: ${range.start}..${range.end}`);
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
          console.log(`[Cluster Mining] Global nonce range exhausted, requesting new range...`);
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
          console.log(`[Cluster Mining] Using global nonce range: ${currentRange.start}..${currentRange.end}`);
        } else {
          // No range yet, request one
          console.log(`[Cluster Mining] No global range available, requesting...`);
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
        
        console.log(`[Cluster Mining] RuntimeManager profile: mode=${profile.mode}, workers=${profile.workerCount}, dutyCycle=${profile.dutyCycle.toFixed(2)}`);
        console.log(`[Cluster Mining] Using: workers=${recommendedWorkerCount}, dutyCycle=${recommendedDutyCycle.toFixed(2)}`);
        
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
        console.warn(`[Cluster Mining] Worker count was ${clusterWorkerCount}, using ${actualWorkerCount} instead`);
        setClusterWorkerCount(actualWorkerCount);
      }
      
      console.log(`[Cluster Mining] Starting with ${actualWorkerCount} workers, duty cycle: ${dutyCycle}`);
      
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
  const handleStartMining = async () => {
    if (!chainContext) return;
    
    // Phase 38: Check onboarding for first-time users
    if (!onboardingCompleted && !isMining && !clusterMining) {
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
        console.log(`[Mining] Not ready to mine yet: ${message} (this is normal during initial sync)`);
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
        chainContext.indexState
      );

      setIsMining(true);
      setError("");
      // Removed: setMiningHash, setMiningNonce (replaced by MiningLiveStatsCard)
      setMiningStats({ hashesTried: 0, hashRate: null, elapsedTime: 0 });

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
          setIsMining(false);
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
          // Don't auto-restart here - the new block will trigger a new mining session
          // if auto-mining is enabled
        },
      });
    } catch (err) {
      setIsMining(false);
      setError(err instanceof Error ? err.message : "Failed to start mining");
      console.error("Failed to start mining:", err);
    }
  };

  // Phase 8: Stop mining
  const handleStopMining = () => {
    minerClient.stopMining("user");
    setIsMining(false);
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
        console.log("[App] Tip height changed:", lastHeightRef.current, "->", newHeight);
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
          console.log("[App] Tip changed during cluster mining, restarting cluster mining...");
          
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

  return (
    <div className="app">
      <header className="app-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: "1400px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <img 
              src="/logo/logo.png" 
              alt="IndexerChain Logo" 
              style={{ 
                height: "48px", 
                width: "auto",
                objectFit: "contain"
              }}
            />
            <div>
              <h1 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                IndexerChain
              </h1>
              <p className="subtitle" style={{ margin: 0 }}>Browser-Native Blockchain • Phase 24 Complete</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button
              onClick={() => setLocale("zh")}
              style={{
                padding: "0.5rem 1rem",
                background: locale === "zh" ? "#667eea" : "rgba(255, 255, 255, 0.2)",
                color: locale === "zh" ? "white" : "white",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: locale === "zh" ? "bold" : "normal",
              }}
            >
              中文
            </button>
            <button
              onClick={() => setLocale("en")}
              style={{
                padding: "0.5rem 1rem",
                background: locale === "en" ? "#667eea" : "rgba(255, 255, 255, 0.2)",
                color: locale === "en" ? "white" : "white",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: locale === "en" ? "bold" : "normal",
              }}
            >
              English
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        {/* Status Banner */}
        {chainContext && (
          <div style={{
            padding: "1rem",
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
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "1.5rem" }}>
                {isP2PConnected && nodeAddress ? "✅" : "⚠️"}
              </span>
              <div>
                <strong style={{ fontSize: "1rem", display: "block", marginBottom: "0.25rem" }}>
                  {isP2PConnected && nodeAddress 
                    ? t("banner.systemReady")
                    : t("banner.configRequired")}
                </strong>
                <div style={{ fontSize: "0.9rem", color: "#666" }}>
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
                }}
                style={{ padding: "0.5rem 1rem" }}
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

        {/* Always show debug info at top */}
        <div style={{ 
          padding: "0.75rem", 
          background: "#e9ecef", 
          fontSize: "0.85rem", 
          marginBottom: "1rem",
          borderRadius: "4px",
          border: "1px solid #dee2e6"
        }}>
          <strong>Debug Info:</strong> error={error ? `"${error.substring(0, 80)}..."` : "empty"} (length: {error.length}), needsReset={needsReset ? "true" : "false"}, loading={loading ? "true" : "false"}
        </div>

        {error && (
          <div 
            className={error.includes("✅") ? "success" : "error"} 
            style={{ 
              whiteSpace: "pre-line",
              maxWidth: "100%",
              wordBreak: "break-word",
              padding: "1.5rem",
              marginBottom: "1rem"
            }}
          >
            <strong style={{ fontSize: "1.2rem", display: "block", marginBottom: "0.75rem" }}>
              {error.includes("✅") ? "✅ Success:" : "❌ Chain Initialization Error:"}
            </strong>
            <div style={{ marginBottom: "1rem", fontSize: "1rem", lineHeight: "1.6" }}>
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
                    padding: "1.25rem 2.5rem",
                    fontSize: "1.2rem",
                    fontWeight: "bold",
                    backgroundColor: "#dc3545",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    display: "inline-block",
                    minWidth: "300px",
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
                <p style={{ marginTop: "0.5rem", fontSize: "1rem", opacity: 0.95, maxWidth: "600px", lineHeight: "1.5" }}>
                  ⚠️ <strong>Warning:</strong> This will permanently delete all chain data and snapshots, then start fresh from genesis block.
                </p>
              </div>
            ) : error.includes("本机已有一个挖矿实例") || error.includes("already has a mining instance") ? (
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
                        setError("✅ 已清理旧的实例信息，当前实例现在是 LEADER，可以开始挖矿");
                        setTimeout(() => setError(""), 3000);
                      } else if (leaderInfo) {
                        // Still have a leader, might be another active instance
                        setError(`⚠️ 检测到另一个活跃实例：${leaderInfo.instanceId}。如果确定没有其他标签页/窗口打开，请刷新页面后再试。`);
                      } else {
                        setError("⚠️ 清理完成，但选举未成功。请刷新页面重试。");
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
            ) : (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "rgba(255,255,255,0.2)", borderRadius: "4px" }}>
                Debug: needsReset is false (button should not show)
              </div>
            )}
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

        {/* Tab Navigation */}
        <div className="tab-container">
          <div className="tab-nav">
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
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center", paddingLeft: "0.5rem", borderLeft: "1px solid #e0e0e0" }}>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setShowAdvancedTabs(!showAdvancedTabs);
                }}
                style={{
                  padding: "0.4rem 0.8rem",
                  fontSize: "0.8rem",
                  color: showAdvancedTabs ? "#667eea" : "#999",
                  background: showAdvancedTabs ? "rgba(102, 126, 234, 0.1)" : "transparent",
                  border: `1px solid ${showAdvancedTabs ? "#667eea" : "#ddd"}`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.2s ease",
                  fontWeight: showAdvancedTabs ? "500" : "400",
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
                title={showAdvancedTabs ? (locale === "zh" ? "隐藏高级标签" : "Hide Advanced Tabs") : (locale === "zh" ? "显示高级标签" : "Show Advanced Tabs")}
              >
                <span style={{ marginRight: "0.3rem" }}>{showAdvancedTabs ? "▼" : "▶"}</span>
                {locale === "zh" ? "高级" : "Advanced"}
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
                  title={locale === "zh" ? "🔍 全局一致性监控" : "🔍 Global Consistency Sentinel"}
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
                  title={locale === "zh" ? "🌐 网络健康状态" : "🌐 Network Health"}
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
                      {locale === "zh" 
                        ? "⚠️ 检测到本地分叉冲突，将自动回滚并重新同步。"
                        : "⚠️ Local fork conflict detected, will auto-rollback and resync."}
                    </div>
                  )}
                  
                  {/* Phase 29: Local State Sync Status */}
                  <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #ddd" }}>
                    <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
                      {locale === "zh" ? "本地状态同步" : "Local State Sync"}
                    </h3>
                    <div className="status-item">
                      <span className="label">{locale === "zh" ? "同步状态" : "Sync Status"}:</span>
                      <span className="value">
                        {localStateSyncInfo.syncStatus === "synced" ? (
                          <span style={{ color: "#28a745" }}>✓ {locale === "zh" ? "已同步" : "Synced"}</span>
                        ) : localStateSyncInfo.syncStatus === "syncing" ? (
                          <span style={{ color: "#ffc107" }}>⟳ {locale === "zh" ? "同步中..." : "Syncing..."}</span>
                        ) : localStateSyncInfo.syncStatus === "out_of_sync" ? (
                          <span style={{ color: "#dc3545" }}>⚠ {locale === "zh" ? "未同步" : "Out of Sync"}</span>
                        ) : (
                          <span style={{ color: "#dc3545" }}>✗ {locale === "zh" ? "错误" : "Error"}</span>
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
                        {locale === "zh" 
                          ? "⚠️ 节点正在从快照同步，挖矿已禁用直到完全同步完成。"
                          : "⚠️ Node is resyncing from snapshot, mining is disabled until fully synced."}
                      </div>
                    )}
                    {localStateSyncInfo.lastSyncEpoch > 0 && (
                      <>
                        <div className="status-item">
                          <span className="label">{locale === "zh" ? "最后同步高度" : "Last Sync Height"}:</span>
                          <span className="value">{localStateSyncInfo.lastSyncEpoch}</span>
                        </div>
                        <div className="status-item">
                          <span className="label">{locale === "zh" ? "最后同步时间" : "Last Sync Time"}:</span>
                          <span className="value" style={{ fontSize: "0.85rem" }}>
                            {new Date(localStateSyncInfo.lastSyncTime).toLocaleTimeString()}
                          </span>
                        </div>
                      </>
                    )}
                    {localStateSyncInfo.error && (
                      <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f8d7da", borderRadius: "4px", border: "1px solid #dc3545", fontSize: "0.85rem", color: "#721c24" }}>
                        {locale === "zh" ? "错误" : "Error"}: {localStateSyncInfo.error}
                      </div>
                    )}
                    
                    {/* Consistency Check */}
                    <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #eee" }}>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "一致性检查" : "Consistency Check"}:</span>
                        <span className="value">
                          {consistencyCheck.isConsistent ? (
                            <span style={{ color: "#28a745" }}>✓ {locale === "zh" ? "一致" : "Consistent"}</span>
                          ) : (
                            <span style={{ color: "#dc3545" }}>✗ {locale === "zh" ? "不一致" : "Inconsistent"}</span>
                          )}
                        </span>
                      </div>
                      {!consistencyCheck.isConsistent && (
                        <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.25rem" }}>
                          {!consistencyCheck.tipHashMatch && (
                            <div>⚠ {locale === "zh" ? "Tip Hash 不匹配" : "Tip Hash mismatch"}</div>
                          )}
                          {!consistencyCheck.heightMatch && (
                            <div>⚠ {locale === "zh" ? "高度不匹配" : "Height mismatch"}</div>
                          )}
                          {!consistencyCheck.stateCommitmentMatch && (
                            <div>⚠ {locale === "zh" ? "State Commitment 不匹配" : "State Commitment mismatch"}</div>
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
                        <span className="label">{locale === "zh" ? "网络高度" : "Network Height"}:</span>
                        <span className="value" style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#28a745" }}>
                          {syncStatus.networkHeight}
                        </span>
                      </div>
                      {syncStatus.behindBy > 0 && (
                        <div className="status-item" style={{ marginTop: "0.75rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                            <span className="label" style={{ fontSize: "0.9rem" }}>
                              {locale === "zh" ? "同步进度" : "Sync Progress"}
                            </span>
                            <span style={{ fontSize: "0.85rem", color: "#666" }}>
                              {syncStatus.localHeight} / {syncStatus.networkHeight} ({syncStatus.behindBy} {locale === "zh" ? "落后" : "behind"})
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
                              {locale === "zh" ? "正在同步中..." : "Syncing..."}
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
                    const isHealthy = isMainnetMode && 
                      isP2PConnected && 
                      peerCount >= 3 && 
                      miningGuardResult?.ok === true;
                    const isDegraded = isMainnetMode && 
                      isP2PConnected && 
                      (peerCount < 3 || (miningGuardResult && !miningGuardResult.ok && miningGuardResult.code === "NOT_FINALIZED"));
                    
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
                            {locale === "zh" ? "网络健康状态:" : "Network Health:"}
                          </span>
                          <span className="value" style={{ 
                            color: isHealthy ? "#28a745" : isDegraded ? "#ffc107" : "#dc3545",
                            fontWeight: "bold",
                            fontSize: "1rem"
                          }}>
                            {isHealthy 
                              ? (locale === "zh" ? "✅ 健康 & 主网" : "✅ Healthy & On Mainnet")
                              : isDegraded
                              ? (locale === "zh" ? "⚠️ 降级" : "⚠️ Degraded")
                              : (locale === "zh" ? "🚫 已阻止" : "🚫 Blocked")
                            }
                          </span>
                        </div>
                        {isHealthy && (
                          <div style={{ fontSize: "0.85rem", color: "#155724", marginTop: "0.25rem" }}>
                            {locale === "zh" 
                              ? "只要这里显示 ✅ 健康 & 主网，你当前的挖矿就是有效的。"
                              : "As long as this shows ✅ Healthy & On Mainnet, your current mining is effective."}
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
                                modeDescription = locale === "zh" 
                                  ? "网络健康，可安全挖矿。区块将被主网接受。"
                                  : "Network healthy, safe to mine. Blocks will be accepted by mainnet.";
                                break;
                              case "GUARDED":
                                modeColor = "#ffc107";
                                modeDescription = locale === "zh"
                                  ? "低连接模式，风险挖矿。区块可能不会被主网接受。"
                                  : "Low connectivity mode, guarded mining. Blocks may not be accepted by mainnet.";
                                break;
                              case "LOCAL_ONLY":
                                modeColor = "#17a2b8";
                                modeDescription = locale === "zh"
                                  ? "本地训练模式，完全本地挖矿，不参与网络共识。"
                                  : "Local training mode, completely local mining, not participating in network consensus.";
                                break;
                              default:
                                modeColor = "#dc3545";
                                modeDescription = locale === "zh"
                                  ? "无法挖矿：不满足最低要求。"
                                  : "Cannot mine: Minimum requirements not met.";
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
                                  statusMessage = locale === "zh"
                                    ? `🟡 挖矿就绪：保护模式（对等节点不足：${miningGuardResult.details?.peerCount || 0} < ${miningGuardResult.details?.requiredPeers || 3}）`
                                    : `🟡 Mining Ready: GUARDED (Insufficient peers: ${miningGuardResult.details?.peerCount || 0} < ${miningGuardResult.details?.requiredPeers || 3})`;
                                  break;
                                case "LOCAL_ONLY":
                                  statusMessage = locale === "zh" 
                                    ? "🔵 挖矿就绪：本地训练模式" 
                                    : "🔵 Mining Ready: LOCAL-ONLY (Training Mode)";
                                  break;
                              }
                            }
                          }
                          
                          return (
                            <>
                              <div style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                                <span className="label">{locale === "zh" ? "挖矿就绪:" : "Mining Ready:"}</span>
                                <span className="value" style={{ 
                                  color: modeColor,
                                  fontWeight: "bold",
                                  marginLeft: "0.5rem"
                                }}>
                                  {statusMessage || (miningGuardResult.ok 
                                    ? (locale === "zh" ? "✅ 安全" : "✅ SAFE")
                                    : (locale === "zh" ? "🚫 已阻止" : "🚫 BLOCKED"))}
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
                                        ? (locale === "zh" ? "✅ 安全模式（网络健康）" : "✅ SAFE Mode (Network Healthy)")
                                        : miningGuardResult.mode === "GUARDED"
                                        ? (locale === "zh" ? "🟡 保护模式（低连接）" : "🟡 GUARDED Mode (Low Connectivity)")
                                        : (locale === "zh" ? "🔵 本地训练模式" : "🔵 LOCAL-ONLY Mode"))
                                    : (locale === "zh" ? "🚫 已阻止" : "🚫 BLOCKED")
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
                      {nodeAddress ? `${nodeAddress.substring(0, 20)}...` : t("common.loading")}
                    </span>
                  </div>
                  {nodeAddress && chainContext && (
                    <div className="status-item">
                      <span className="label">{t("wallet.balance")}:</span>
                      <span className="value" style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#667eea" }}>
                        {chainContext.indexState.getBalance(nodeAddress as any).toFixed(2)} IDC
                      </span>
                    </div>
                  )}
                  <div className="status-item">
                    <span className="label">{t("wallet.nodeId")}:</span>
                    <span className="value" style={{ fontSize: "0.8rem" }}>
                      {getOrCreateBrowserNodeId().substring(0, 16)}...
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
                      <span className="value" style={{ fontSize: "0.85rem" }}>{tip.header.nonce.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #e9ecef" }}>
                    <span className="label">{t("chain.hash")}:</span>
                    <span className="value" style={{ fontSize: "0.75rem", wordBreak: "break-all", fontFamily: "monospace" }}>
                      {tip.hash.substring(0, 24)}...
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
              {/* Node Identity Section */}
              <div className="status-card">
                <h2>💼 {t("overview.nodeIdentity")}</h2>
                <div className="status-item">
                  <span className="label">{t("wallet.address")}:</span>
                  <span className="value" style={{ fontSize: "0.9rem", wordBreak: "break-all" }}>
                    {nodeAddress || t("common.loading")}
                  </span>
                  {nodeAddress && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(nodeAddress);
                        setError(t("wallet.addressCopied"));
                        setTimeout(() => setError(""), 2000);
                      }}
                      style={{
                        marginLeft: "0.5rem",
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.8rem",
                        background: "#667eea",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      {t("common.copy")}
                    </button>
                  )}
                </div>
                <div className="status-item">
                  <span className="label">{t("wallet.nodeId")}:</span>
                  <span className="value" style={{ fontSize: "0.8rem" }}>
                    {getOrCreateBrowserNodeId().substring(0, 16)}...
                  </span>
                </div>
                {/* Phase 7: Balance Display */}
                {nodeAddress && chainContext && (
                  <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                    <span className="label">{t("wallet.balance")}:</span>
                    <span className="value" style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#667eea" }}>
                      {chainContext.indexState.getBalance(nodeAddress as any).toFixed(2)} IDC
                    </span>
                  </div>
                )}
              </div>
              
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
                      {locale === "zh" ? "冷启动模式" : "Cold Start Mode"}
                    </h3>
                  </div>
                  <div style={{ fontSize: "0.9rem", color: "#856404" }}>
                    {locale === "zh"
                      ? "网络处于冷启动阶段：只有少数矿工在线。你的区块仍然有效，但安全性低于成熟阶段。"
                      : "Network is in Cold Start: only a few miners online. Your blocks are still valid but security is lower than mature phase."}
                  </div>
                </div>
              )}

              {/* Phase 38-E: Mainnet Mature Stage Requirements */}
              {chainContext &&
                chainContext.params?.networkId === "IXC_MAINNET_V1" &&
                miningGuardResult &&
                !miningGuardResult.ok &&
                miningGuardResult.code !== "NOT_FINALIZED" && (
                  <div
                    className="status-card"
                    style={{
                      marginBottom: "1.5rem",
                      background: "rgba(220, 53, 69, 0.1)",
                      border: "2px solid #dc3545",
                    }}
                  >
                    <h3 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.1rem", color: "#721c24" }}>
                      {locale === "zh" ? "🚫 主网准入规则" : "🚫 Mainnet Admission Rules"}
                    </h3>
                    <div style={{ fontSize: "0.9rem", color: "#721c24" }}>
                      {locale === "zh" ? "以下规则未通过：" : "The following rules are not met:"}
                    </div>
                    <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem", fontSize: "0.85rem", color: "#721c24" }}>
                      {miningGuardResult.details?.peerCount !== undefined &&
                        miningGuardResult.details?.requiredPeers !== undefined && (
                          <li>
                            {locale === "zh"
                              ? `规则 1: 需要至少 ${miningGuardResult.details.requiredPeers} 个独立 IP (当前: ${miningGuardResult.details.peerCount})`
                              : `Rule 1: At least ${miningGuardResult.details.requiredPeers} independent IPs required (current: ${miningGuardResult.details.peerCount})`}
                          </li>
                        )}
                      {miningGuardResult.details?.quorumScore !== undefined &&
                        miningGuardResult.details?.requiredQuorumScore !== undefined && (
                          <li>
                            {locale === "zh"
                              ? `规则 2: Quorum 分数需要 ≥ ${miningGuardResult.details.requiredQuorumScore} (当前: ${miningGuardResult.details.quorumScore})`
                              : `Rule 2: Quorum score must be ≥ ${miningGuardResult.details.requiredQuorumScore} (current: ${miningGuardResult.details.quorumScore})`}
                          </li>
                        )}
                      {miningGuardResult.details?.independentPeerCount !== undefined &&
                        miningGuardResult.details?.requiredIndependentPeers !== undefined && (
                          <li>
                            {locale === "zh"
                              ? `规则 3: 需要至少 ${miningGuardResult.details.requiredIndependentPeers} 个独立节点 (当前: ${miningGuardResult.details.independentPeerCount})`
                              : `Rule 3: At least ${miningGuardResult.details.requiredIndependentPeers} independent peers required (current: ${miningGuardResult.details.independentPeerCount})`}
                          </li>
                        )}
                      {localRole === "FOLLOWER" && (
                        <li>
                          {locale === "zh"
                            ? "规则 4: 只有 LEADER 标签页可以在主网挖矿"
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
                        {locale === "zh" ? "FOLLOWER 模式" : "FOLLOWER Mode"}
                      </h3>
                    </div>
                    <div style={{ fontSize: "0.9rem", color: "#0c5460", marginBottom: "0.5rem" }}>
                      {locale === "zh"
                        ? "此标签页是 FOLLOWER。只有本机的 LEADER 标签页可以在主网挖矿。"
                        : "This tab is FOLLOWER. Only the LEADER tab on this machine can mine on mainnet."}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#0c5460" }}>
                      {locale === "zh"
                        ? "提示：关闭其他标签页后刷新本页，或找到 LEADER 标签页进行挖矿。"
                        : "Tip: Close other tabs and refresh this page, or find the LEADER tab to mine."}
                    </div>
                  </div>
                )}

              {/* Mining Main Card - Top-level control */}
              {chainContext && (
                <>
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
                    onStartMining={() => {
                      // Check if first time - show onboarding
                      if (!onboardingCompleted && !isMining && !clusterMining) {
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
                  />

                  {/* Phase 38: Live Stats Card */}
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
                        ? (locale === "zh" ? "▼ 隐藏高级设置" : "▼ Hide Advanced Settings")
                        : (locale === "zh" ? "▶ 显示高级设置" : "▶ Show Advanced Settings")}
                    </button>
                  </div>

                  {/* Phase 38: Advanced Settings Panel */}
                  {showAdvanced && chainContext && (
                    <div className="status-card" style={{ marginBottom: "1.5rem" }}>
                      <h2 style={{ marginBottom: "1.5rem" }}>
                        {locale === "zh" ? "⚙️ 高级设置" : "⚙️ Advanced Settings"}
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
                              message: miningGuardResult.reason || (locale === "zh" ? "无法挖矿" : "Cannot mine"),
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
                      <h2>📊 {locale === "zh" ? "挖矿有效性统计" : "Mining Effectiveness"}</h2>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "已接受区块:" : "Accepted Blocks:"}</span>
                        <span className="value" style={{ color: "#28a745", fontWeight: "bold" }}>
                          {stats.acceptedBlocks}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "拒绝/孤块:" : "Rejected/Orphaned:"}</span>
                        <span className="value" style={{ color: "#dc3545", fontWeight: "bold" }}>
                          {stats.rejectedBlocks}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "总挖矿数:" : "Total Mined:"}</span>
                        <span className="value">{stats.totalBlocksMined}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "有效率:" : "Effectiveness:"}</span>
                        <span className="value" style={{ 
                          fontSize: "1.2rem", 
                          fontWeight: "bold",
                          color: stats.effectivenessRate >= 50 ? "#28a745" : stats.effectivenessRate >= 10 ? "#ffc107" : "#dc3545"
                        }}>
                          {stats.effectivenessRate.toFixed(1)}%
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
                            ⚠️ {locale === "zh" 
                              ? "警告：你的节点可能在错误链或孤立网络上挖矿，请检查网络连接和同步状态。" 
                              : "Warning: Your node may be mining on the wrong chain or isolated network. Please check network connection and sync status."}
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
                        {chainContext.indexState.getBalance(nodeAddress as any).toFixed(6)} IDC
                      </span>
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                      {t("transactionsExpanded.address")}: {nodeAddress.substring(0, 20)}...
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
                          {(chainContext.indexState.getBalance(nodeAddress as any) - parseFloat(transferAmount) || 0).toFixed(6)} IDC
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
                            current: currentBalance.toFixed(6), 
                            amount: amount.toFixed(6) 
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
                          amount: amount.toFixed(6), 
                          recipient: transferTo.substring(0, 20) 
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
                    {isMainnetMode ? (
                      <span style={{ color: "#28a745", fontWeight: "bold" }}>{t("network.mainnet")}</span>
                    ) : (
                      <span style={{ color: "#ffc107", fontWeight: "bold" }}>{t("network.dev")}</span>
                    )}
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
                            setIsMainnetMode(e.target.checked);
                            if (e.target.checked) {
                              setBootstrapUrl(DEFAULT_MAINNET_SIGNALING);
                            } else {
                              setBootstrapUrl("ws://localhost:8080");
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
                        <span className="value">{gsnStats.downloader.averageLatency.toFixed(0)} ms</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.avgIntegrity")}:</span>
                        <span className="value">{(gsnStats.downloader.averageIntegrity * 100).toFixed(1)}%</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.cachedSnapshots")}:</span>
                        <span className="value">{gsnStats.seeder.cachedCount}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "缓存大小" : "Cache Size"}:</span>
                        <span className="value">{(gsnStats.seeder.totalSize / 1024).toFixed(2)} KB</span>
                      </div>
                    </>
                  )}
                  {snapshotDownloadProgress && (
                    <>
                      <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                        <span className="label">{locale === "zh" ? "下载进度" : "Download Progress"}:</span>
                        <span className="value">{snapshotDownloadProgress.percent.toFixed(1)}%</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "块数" : "Chunks"}:</span>
                        <span className="value">
                          {snapshotDownloadProgress.receivedChunks} / {snapshotDownloadProgress.totalChunks}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "速度" : "Speed"}:</span>
                        <span className="value">
                          {(snapshotDownloadProgress.speed / 1024).toFixed(2)} KB/s
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.peers")}:</span>
                        <span className="value">{snapshotDownloadProgress.peers}</span>
                      </div>
                    </>
                  )}
                  <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
                    💡 <strong>GSN:</strong> {locale === "zh" ? "所有节点通过 P2P 自动共享快照。" : "All nodes automatically share snapshots via P2P."}
                    {gsnEnabled && (locale === "zh" ? " 您正在向其他节点提供快照。" : " You are seeding snapshots to other nodes.")}
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
                        {latestSnapshot ? latestSnapshot.height : (locale === "zh" ? "无" : "None")}
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
                            {(snapshotSizeInfo.compressedSize / 1024).toFixed(2)} KB
                          </span>
                        </div>
                        {snapshotSizeInfo.compressionRatio > 0 && (
                          <div className="status-item">
                            <span className="label">{t("storage.compressionRatio")}:</span>
                            <span className="value" style={{ color: "#28a745", fontWeight: "bold" }}>
                              {snapshotSizeInfo.compressionRatio.toFixed(1)}% {t("storage.reduction")}
                            </span>
                          </div>
                        )}
                        {snapshotSizeInfo.estimatedUncompressedSize > 0 && (
                          <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                            <span className="label">{t("storage.estimatedUncompressed")}:</span>
                            <span className="value">
                              {(snapshotSizeInfo.estimatedUncompressedSize / 1024).toFixed(2)} KB
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
                        <span className="label">State Commitment:</span>
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
                                <span className="label">Source:</span>
                                <span className="value" style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>
                                  {chainContext.params.remoteSnapshotEndpoints[0]}
                                </span>
                              </div>
                            )}
                            <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                              <span className="label">Remote Height:</span>
                              <span className="value">{chainContext.remoteSnapshotUsed.height}</span>
                            </div>
                            {chainContext.remoteSnapshotUsed.stateHash && (
                              <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                                <span className="label">Remote StateHash:</span>
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
                    setError("Need at least one block (after genesis) to create snapshot");
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
                    setError(err instanceof Error ? err.message : "Failed to create snapshot");
                  }
                }}
                disabled={!chainContext || height === 0}
              >
                Force Snapshot
              </button>
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  if (window.confirm("Clear all snapshots? Next startup will rebuild from genesis.")) {
                    clearAllSnapshots();
                    setSnapshotMetas([]);
                    setLatestSnapshot(null);
                    setSnapshotSizeInfo(null);
                    setError("All snapshots cleared. Next startup will rebuild from genesis.");
                    setTimeout(() => setError(""), 3000);
                  }
                }}
                style={{ background: "#dc3545", color: "white" }}
              >
                Clear Snapshots
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
                      
                      setError(`Recompressed ${count} snapshot(s)`);
                      setTimeout(() => setError(""), 3000);
                    } else {
                      setError("All snapshots are already compressed");
                      setTimeout(() => setError(""), 2000);
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to recompress snapshots");
                  } finally {
                    setIsRecompressing(false);
                  }
                }}
                disabled={!chainContext || isRecompressing || snapshotMetas.length === 0}
                style={{ background: "#17a2b8", color: "white" }}
              >
                {isRecompressing ? "Recompressing..." : "Recompress All"}
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
                      setError("Snapshot not found or already deleted");
                      return;
                    }
                    
                    const isValid = await verifySnapshotIntegrity(snapshot);
                    
                    if (isValid) {
                      // Reload snapshot metadata to show updated verification status
                      const metas = loadAllSnapshotMeta();
                      setSnapshotMetas(metas);
                      const latest = getLatestSnapshotMeta();
                      setLatestSnapshot(latest);
                      
                      setError("✅ Snapshot verified successfully!");
                      setTimeout(() => setError(""), 3000);
                    } else {
                      const fallbackHeight = await handleCorruptedSnapshot(latestSnapshot.height);
                      const metas = loadAllSnapshotMeta();
                      setSnapshotMetas(metas);
                      const latest = getLatestSnapshotMeta();
                      setLatestSnapshot(latest);
                      
                      setError(`❌ Snapshot corrupted and deleted. Next startup will use snapshot at height ${fallbackHeight} or replay from genesis.`);
                      setTimeout(() => setError(""), 5000);
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to verify snapshot");
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
                          <span className="label">{t("advancedExpanded.averageBlockTime")} (last {recentBlocks.length}):</span>
                          <span className="value">{avgTime.toFixed(2)}{t("commonExpanded.seconds")}</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {(() => {
                    const allBlocks = chainContext.storage.getAllBlocks();
                    if (allBlocks.length >= chainContext.params.difficultyAdjustmentInterval) {
                      const explanation = explainDifficultyChange(allBlocks, chainContext.params);
                      return (
                        <div style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#666" }}>
                          <strong>{t("advancedExpanded.difficultyChange")}:</strong> {explanation.reason}
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
                    <h2>💰 IDC Emission</h2>
                    <div className="status-item">
                      <span className="label">Total Minted:</span>
                      <span className="value" style={{ fontWeight: "bold", color: "#667eea" }}>
                        {totalMintedIDC.toFixed(6)} / {maxSupplyIDC.toFixed(6)} IDC
                      </span>
                    </div>
                    <div className="status-item">
                      <span className="label">Minting Progress:</span>
                      <span className="value">
                        {((totalMintedIDC / maxSupplyIDC) * 100).toFixed(4)}%
                      </span>
                    </div>
                    <div className="status-item">
                      <span className="label">Current Era:</span>
                      <span className="value">
                        Era {emissionStats.era} / {IDC_ERA_COUNT - 1}
                      </span>
                    </div>
                    <div className="status-item">
                      <span className="label">Block Reward (next):</span>
                      <span className="value" style={{ fontWeight: "bold" }}>
                        {nextBlockReward.toFixed(6)} IDC
                      </span>
                    </div>
                    <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                      <span className="label">Blocks in Era:</span>
                      <span className="value">
                        {Number(emissionStats.blocksRemainingInEra).toLocaleString()} remaining
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
                    <span className="label">{locale === "zh" ? "跟踪的节点总数" : "Total Peers Tracked"}:</span>
                    <span className="value">{peerScores.length}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">{locale === "zh" ? "信任" : "Trusted"}:</span>
                    <span className="value" style={{ color: "#28a745" }}>
                      {peerScores.filter(p => p.trustLevel === "trusted").length}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{locale === "zh" ? "正常" : "Normal"}:</span>
                    <span className="value" style={{ color: "#666" }}>
                      {peerScores.filter(p => p.trustLevel === "normal").length}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{locale === "zh" ? "低信任" : "Low Trust"}:</span>
                    <span className="value" style={{ color: "#ffc107" }}>
                      {peerScores.filter(p => p.trustLevel === "low").length}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{locale === "zh" ? "已禁止" : "Banned"}:</span>
                    <span className="value" style={{ color: "#dc3545" }}>
                      {peerScores.filter(p => p.trustLevel === "banned").length}
                    </span>
                  </div>
                  {peerScores.length > 0 && (
                    <div style={{ marginTop: "1rem" }}>
                      <strong>{locale === "zh" ? "节点详情" : "Peer Details"}:</strong>
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
                                      {peer.peerId.substring(0, 16)}...
                                    </td>
                                    <td style={{ padding: "0.5rem", fontWeight: "bold" }}>
                                      {peer.score.toFixed(1)}
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
                                      {peer.avgLatencyMs ? `${peer.avgLatencyMs.toFixed(0)}ms` : "—"}
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
                            <span style={{ color: "#666" }}>{locale === "zh" ? "等待委员会" : "Waiting for Committee"}</span>
                          )}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.finalizedBlocks")}:</span>
                        <span className="value" style={{ fontWeight: "bold" }}>
                          {finalityStats.finalizedCount}
                        </span>
                      </div>
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
                              <span style={{ color: "#ffc107" }}>⏳ {t("network.pending")} ({finalityStats.pendingVotes} {locale === "zh" ? "票" : "votes"})</span>
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
                                    <strong>{locale === "zh" ? "成员" : "Member"} #{idx + 1}:</strong> {member.address.substring(0, 20)}...
                                  </div>
                                  <div>
                                    {t("network.score")}: {member.score.toFixed(1)} / 100
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
                        {uIDCToIDC(IDC_MAX_SUPPLY).toLocaleString()} IDC
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
                            {uIDCToIDC(chainContext.indexState.getTotalMinted()).toLocaleString()} IDC
                          </span>
                        </div>
                        <div className="status-item">
                          <span className="label">{locale === "zh" ? "已发行比例" : "Issued Ratio"}:</span>
                          <span className="value">
                            {((Number(chainContext.indexState.getTotalMinted()) / Number(IDC_MAX_SUPPLY)) * 100).toFixed(4)}%
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
                              {stats.era} / {IDC_ERA_COUNT - 1}
                            </span>
                          </div>
                          <div className="status-item">
                            <span className="label">{t("token.rewardPerBlock")}:</span>
                            <span className="value" style={{ fontWeight: "bold" }}>
                              {stats.rawRewardIDC.toFixed(6)} IDC
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
                              {uIDCToIDC(stats.rawReward * stats.blocksInEra).toLocaleString()} IDC
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
                        ? "IDC 采用类似比特币的减半发行模型，总供应量固定为 10 亿 IDC，通过 10 个时代（每个时代 10 年）逐步发行。每个时代结束后，区块奖励减半。"
                        : "IDC uses a Bitcoin-like halving emission model with a fixed total supply of 1 billion IDC, distributed over 10 eras (10 years each). Block rewards halve at the end of each era."}
                    </p>
                    <ul style={{ marginLeft: "1.5rem", lineHeight: "1.8" }}>
                      <li>{locale === "zh" ? "总供应量：10 亿 IDC（固定上限）" : `Total Supply: 1 billion IDC (fixed cap)`}</li>
                      <li>{locale === "zh" ? "发行周期：100 年（10 个时代）" : `Emission Period: 100 years (10 eras)`}</li>
                      <li>{locale === "zh" ? "区块时间：约 10 秒" : `Block Time: ~10 seconds`}</li>
                      <li>{locale === "zh" ? "减半机制：每 10 年减半一次" : `Halving: Every 10 years`}</li>
                      <li>{locale === "zh" ? "时代区块数：31,536,000 个区块" : `Blocks per Era: 31,536,000 blocks`}</li>
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
                          <th style={{ padding: "0.75rem", textAlign: "left", border: "1px solid #ddd" }}>{t("token.eraNumber")}</th>
                          <th style={{ padding: "0.75rem", textAlign: "left", border: "1px solid #ddd" }}>{t("token.years")}</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", border: "1px solid #ddd" }}>{t("token.rewardPerBlock")}</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", border: "1px solid #ddd" }}>{t("token.totalEraReward")}</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", border: "1px solid #ddd" }}>{t("token.cumulativeReward")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: IDC_ERA_COUNT }, (_, era) => {
                          const eraReward = IDC_BASE_REWARD >> BigInt(era);
                          const eraRewardIDC = uIDCToIDC(eraReward);
                          const totalEraReward = eraReward * IDC_BLOCKS_PER_ERA;
                          const totalEraRewardIDC = uIDCToIDC(totalEraReward);
                          
                          // Calculate cumulative reward
                          let cumulative = 0n;
                          for (let i = 0; i <= era; i++) {
                            const eReward = IDC_BASE_REWARD >> BigInt(i);
                            cumulative += eReward * IDC_BLOCKS_PER_ERA;
                          }
                          const cumulativeIDC = uIDCToIDC(cumulative);
                          
                          return (
                            <tr 
                              key={era}
                              style={{ 
                                background: era === (chainContext ? getEmissionStats(height).era : 0) ? "#fff3cd" : era % 2 === 0 ? "#f8f9fa" : "white"
                              }}
                            >
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd", fontWeight: era === (chainContext ? getEmissionStats(height).era : 0) ? "bold" : "normal" }}>
                                {era}
                              </td>
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd" }}>
                                {era * 10} - {(era + 1) * 10}
                              </td>
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd", textAlign: "right", fontFamily: "monospace" }}>
                                {eraRewardIDC.toFixed(6)} IDC
                              </td>
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd", textAlign: "right", fontFamily: "monospace" }}>
                                {totalEraRewardIDC.toLocaleString()} IDC
                              </td>
                              <td style={{ padding: "0.75rem", border: "1px solid #ddd", textAlign: "right", fontFamily: "monospace", fontWeight: "bold" }}>
                                {cumulativeIDC.toLocaleString()} IDC
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
                      <span className="value">{uIDCToIDC(IDC_BASE_FEE).toFixed(6)} IDC</span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("token.feePer100Bytes")}:</span>
                      <span className="value">{uIDCToIDC(IDC_FEE_PER_100_BYTES).toFixed(6)} IDC</span>
                    </div>
                    <div className="status-item">
                      <span className="label">{t("token.feeFormula")}:</span>
                      <span className="value" style={{ fontFamily: "monospace", fontSize: "0.9rem" }}>
                        Fee = {uIDCToIDC(IDC_BASE_FEE).toFixed(6)} IDC + (Size / 100) × {uIDCToIDC(IDC_FEE_PER_100_BYTES).toFixed(6)} IDC
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
                        <strong style={{ color: "#155724" }}>✓ {t("token.deflationary")}</strong>
                        <p style={{ margin: "0.5rem 0 0 0", color: "#155724", fontSize: "0.9rem" }}>
                          {locale === "zh" 
                            ? "通过减半机制，区块奖励每 10 年减半，使代币发行速度逐渐降低，具有通缩特性。"
                            : "Through halving mechanism, block rewards halve every 10 years, gradually reducing emission rate with deflationary characteristics."}
                        </p>
                      </div>
                      <div>
                        <strong style={{ color: "#155724" }}>✓ {t("token.noInflation")}</strong>
                        <p style={{ margin: "0.5rem 0 0 0", color: "#155724", fontSize: "0.9rem" }}>
                          {locale === "zh" 
                            ? "100 年发行期结束后，将不再产生新的代币，实现零通胀。"
                            : "After the 100-year emission period ends, no new tokens will be created, achieving zero inflation."}
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
                    {locale === "zh" ? "🧹 存储清理" : "🧹 Storage Cleanup"}
                  </h3>
                  <div style={{ 
                    background: "#e7f3ff", 
                    padding: "1rem", 
                    borderRadius: "6px",
                    border: "1px solid #b3d9ff"
                  }}>
                    <p style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#004085" }}>
                      {locale === "zh" 
                        ? "检查并清理未使用的本地存储数据。这不会影响链数据。" 
                        : "Check and clean up unused local storage data. This won't affect chain data."}
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
                            locale === "zh" 
                              ? "没有发现未使用的存储数据。" 
                              : "No unused storage data found."
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
                      {locale === "zh" ? "🧹 清理未使用的存储" : "🧹 Clean Unused Storage"}
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
                    ⚠️ {locale === "zh" ? "警告" : "Warning"}
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
