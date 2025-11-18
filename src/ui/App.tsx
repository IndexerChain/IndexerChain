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
import type { NodeCapability } from "../core/globalNonceAllocator.js";
import { SnapshotDownloader } from "../core/snapshotDownloader.js";
import { SnapshotSeeder } from "../core/snapshotSeeder.js";
import { BrowserP2PNode } from "../core/p2p.js";
import { handleReceivedBlock, handleReceivedBlocks } from "../core/sync.js";
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
import { RuntimeManager } from "../core/runtimeManager.js";
import { useI18n } from "../i18n/useI18n.js";
import { getLocalInstanceCoordinator, type LocalInstanceRole, type LeaderInfo } from "../core/localInstance.js";
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
  const [isMining, setIsMining] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [miningHash, setMiningHash] = useState<string>("");
  const [miningNonce, setMiningNonce] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>(""); // Success message for transfers
  // Phase 17: Support mainnet mode (default) and dev mode
  // Default to mainnet signaling server (can be configured)
  const DEFAULT_MAINNET_SIGNALING = "wss://signal.indexerchain.com"; // Custom domain configured
  const [bootstrapUrl, setBootstrapUrl] = useState<string>(DEFAULT_MAINNET_SIGNALING);
  const [isMainnetMode, setIsMainnetMode] = useState<boolean>(true);
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
  const [clusterMining, setClusterMining] = useState<boolean>(false);
  
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
      return deviceCap.recommendedWorkers;
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
      status: "running" | "stopped" | "exhausted";
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
  const [isDelegator, setIsDelegator] = useState<boolean>(false);
  const [globalPoolEnabled, setGlobalPoolEnabled] = useState<boolean>(false);
  const [delegatorStats, setDelegatorStats] = useState<{
    totalAllocated: number;
    activeRanges: number;
    globalPointer: bigint;
    totalNodes: number;
  } | null>(null);

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
  
  // Auto-mining option
  const [autoMining, setAutoMining] = useState<boolean>(false);

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
      }
    }
  }, [chainContext, finalityStats]);

  // Form state for creating transactions
  const [txNamespace, setTxNamespace] = useState<string>("test");
  const [txKey, setTxKey] = useState<string>("");
  const [txValue, setTxValue] = useState<string>("");
  const [txOpType, setTxOpType] = useState<"PUT" | "APPEND" | "DELETE">("PUT");

  const p2pNodeRef = useRef<BrowserP2PNode | null>(null);

  const [needsReset, setNeedsReset] = useState<boolean>(false);

  // Tab navigation state
  const [activeTab, setActiveTab] = useState<string>("overview");

  // Initialize chain on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        const params = getDefaultChainParams();
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
      } catch (error) {
        console.error("Failed to initialize chain:", error);
        setError("Failed to initialize chain");
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

  // Auto-mining: Start mining automatically when chain is ready
  useEffect(() => {
    if (autoMining && chainContext && !isMining) {
      const tip = chainContext.storage.getTip();
      if (tip) {
        // Small delay to ensure everything is initialized
        const timer = setTimeout(() => {
          handleStartMining();
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [autoMining, chainContext, isMining]);

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

  // Handle chain reset (for Phase 5 migration)
  const handleResetChain = () => {
    if (!chainContext) return;
    
    if (confirm("This will clear all chain data and start fresh. Continue?")) {
      chainContext.storage.reset();
      setNeedsReset(false);
      // Reload page to reinitialize
      window.location.reload();
    }
  };

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
          setChainContext({ ...chainContext }); // Trigger re-render
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
    p2p.onMessage("REQUEST_BLOCKS", async (request: { fromHeight: number; toHeight: number }, sender: string) => {
      console.log("Received REQUEST_BLOCKS from", sender, request);
      const blocks: Block[] = [];
      for (let h = request.fromHeight; h <= request.toHeight; h++) {
        const block = chainContext.storage.getBlockByHeight(h);
        if (block) {
          blocks.push(block);
        }
      }
      if (blocks.length > 0) {
        p2p.broadcast("BLOCKS", { blocks, requestId: `${sender}_${Date.now()}` });
      }
    });

    // Handle BLOCKS messages (chain sync)
    // Phase 21: Pass sender for peer reputation tracking
    p2p.onMessage("BLOCKS", async (data: { blocks: Block[] }, sender: string) => {
      console.log("Received BLOCKS from", sender, "count:", data.blocks.length);
      const result = await handleReceivedBlocks(data.blocks, chainContext, sender);
      if (result.success && result.appended > 0) {
        setChainContext({ ...chainContext }); // Trigger re-render
      }
    });

    // Update peer count periodically
    const interval = setInterval(() => {
      if (p2p.isConnected) {
        setPeerCount(p2p.getPeerCount());
        setIsP2PConnected(true);
      } else {
        setPeerCount(0);
        setIsP2PConnected(false);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [chainContext, mempool]);

  // Connect to P2P network
  const handleConnectP2P = async () => {
    if (!chainContext || !bootstrapUrl) {
      setError("Please enter a bootstrap server URL (e.g., ws://localhost:8080)");
      return;
    }

    try {
      setError("");
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
        delegatorManager.onDelegatorChange((isDelegator) => {
          setIsDelegator(isDelegator);
          // Clear previous interval if exists
          if (delegatorStatsInterval) {
            clearInterval(delegatorStatsInterval);
            delegatorStatsInterval = null;
          }
          if (isDelegator && delegatorManager) {
            // Update stats periodically
            const updateStats = () => {
              setDelegatorStats(delegatorManager.getStats());
            };
            delegatorStatsInterval = setInterval(updateStats, 2000);
            updateStats();
          }
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
  const handleStartClusterMining = async () => {
    if (!chainContext) return;
    
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
            status: w.status,
          })),
        });
      });

      minerCluster.onFound(async (block) => {
        // Block found by worker
        
        // Verify and append block
        const allBlocksForVerify = chainContext.storage.getAllBlocks();
        const verification = await verifyBlock(
          block,
          prevBlock,
          allBlocksForVerify,
          chainContext.params
        );

        if (verification.valid) {
          const result = await appendMinedBlock(block, chainContext);
          if (result.success) {
            // Remove transactions from mempool
            const txIds = block.txs.map((tx) => tx.txId);
            mempool.removeTxs(txIds);

            // Update context
            setChainContext({ ...chainContext });
            setError("");
          } else {
            setError(result.error || "Failed to append block");
          }
        } else {
          setError(verification.error || "Block verification failed");
        }

        setClusterMining(false);

        // Auto-restart cluster mining if auto-mining is enabled
        if (autoMining && chainContext) {
          setTimeout(() => {
            if (!clusterMining) {
              handleStartClusterMining();
            }
          }, 1000);
        }
      });

      minerCluster.onStopped((reason) => {
        if (reason === "found") {
          // Already handled in onFound
          return;
        }
        setClusterMining(false);
        if (reason === "error") {
          setError("Cluster mining error occurred");
        } else if (reason === "user") {
          setError("Cluster mining was stopped");
          if (autoMining) {
            setAutoMining(false);
          }
        }
        // "replaced" reason means we're restarting, don't show error
        if (reason === "replaced" && autoMining && chainContext) {
          setTimeout(() => {
            if (!clusterMining) {
              handleStartClusterMining();
            }
          }, 100);
        }
      });

      // Phase 19: If global pool enabled, use allocated ranges
      if (globalPoolEnabled && isP2PConnected) {
        // Setup range received handler
        workerNodeManager.onRangeReceived(() => {
          // Update worker with new range
          // This will be handled by modifying the cluster to use global ranges
        });
        
        // Setup range exhausted handler
        workerNodeManager.onRangeExhausted(() => {
          // Request new range
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
          // Find which worker exhausted (we'll track this)
          // For now, request for all workers
          for (let i = 0; i < clusterWorkerCount; i++) {
            workerNodeManager.requestNonceRange(i, capability);
          }
        });
      }

      // Phase 26: Start cluster mining with duty cycle
      await minerCluster.startMining({
        candidateBlock,
        difficulty: candidateBlock.header.difficulty,
        workerCount: clusterWorkerCount,
        dutyCycle: dutyCycle, // Phase 26: Use runtime manager duty cycle
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
  const handleStartMining = async () => {
    if (!chainContext) return;
    
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
    
    // Allow mining even without pending transactions (coinbase only blocks are valid)
    const pendingTxs = mempool.getAll();

    try {
      const prevBlock = chainContext.storage.getTip();
      if (!prevBlock) {
        setError("No previous block found");
        return;
      }

      // Phase 24: Get miner address from mining wallet (can be different from current wallet)
      const walletStore = getMultiWalletStore();
      const miningWallet = walletStore.getMiningWallet();
      const minerAddr = miningWallet ? miningWallet.address : await getOrCreateNodeAddress();

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
      setMiningHash("");
      setMiningNonce(0);
      setMiningStats({ hashesTried: 0, hashRate: null, elapsedTime: 0 });

      // Phase 8: Start mining with Worker
      // Phase 26: Pass duty cycle to miner client
      minerClient.startMining({
        candidateBlock,
        difficulty: candidateBlock.header.difficulty,
        dutyCycle: dutyCycle, // Phase 26: Use runtime manager duty cycle
        onProgress: (event) => {
          // Use functional updates to ensure we're using the latest state
          setMiningHash(() => event.hash);
          setMiningNonce(() => event.nonce);
          const elapsed = (Date.now() - event.startedAt) / 1000;
          const hashRate = elapsed > 0 ? event.hashesTried / elapsed : null;
          setMiningStats(() => ({
            hashesTried: event.hashesTried,
            hashRate,
            elapsedTime: elapsed,
          }));
        },
        onFound: async (event) => {
          // Verify and append block
          const allBlocksForVerify = chainContext.storage.getAllBlocks();
          const verification = await verifyBlock(
            event.block,
            prevBlock,
            allBlocksForVerify,
            chainContext.params
          );

          if (verification.valid) {
            const result = await appendMinedBlock(event.block, chainContext);
            if (result.success) {
              // Remove transactions from mempool
              const txIds = event.block.txs.map((tx) => tx.txId);
              mempool.removeTxs(txIds);

              // Update lastHeightRef to prevent immediate restart
              const newTip = chainContext.storage.getTip();
              if (newTip) {
                lastHeightRef.current = newTip.header.height;
              }

              // Don't update chainContext here - let the useEffect handle it
              setError("");
            } else {
              setError(result.error || "Failed to append block");
            }
          } else {
            setError(verification.error || "Block verification failed");
          }

          setIsMining(false);
          setMiningHash("");
          setMiningNonce(0);
          
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
  const chainContextRef = useRef<ChainContext | null>(chainContext);
  const isMiningRef = useRef<boolean>(isMining);
  const autoMiningRef = useRef<boolean>(autoMining);
  
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
      
      if (newHeight > lastHeightRef.current) {
        // Tip changed, restart mining if currently mining or auto-mining is enabled
        console.log("[App] Tip height changed:", lastHeightRef.current, "->", newHeight);
        lastHeightRef.current = newHeight;
        
        // Only restart if we're actually mining (not just auto-mining enabled)
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

        {needsReset && (
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

        {error && (
          <div className={error.includes("✅") ? "success" : "error"} style={{ whiteSpace: "pre-line" }}>
            <strong>{error.includes("✅") ? "Success:" : "Error:"}</strong>
            <br />
            {error}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="tab-container">
          <div className="tab-nav">
            <button
              className={`tab-button ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              {t("tabs.overview")}
            </button>
            <button
              className={`tab-button ${activeTab === "wallet" ? "active" : ""}`}
              onClick={() => setActiveTab("wallet")}
            >
              {t("tabs.wallet")}
            </button>
            <button
              className={`tab-button ${activeTab === "mining" ? "active" : ""}`}
              onClick={() => setActiveTab("mining")}
            >
              {t("tabs.mining")}
            </button>
            <button
              className={`tab-button ${activeTab === "transactions" ? "active" : ""}`}
              onClick={() => setActiveTab("transactions")}
            >
              {t("tabs.transactions")}
            </button>
            <button
              className={`tab-button ${activeTab === "network" ? "active" : ""}`}
              onClick={() => setActiveTab("network")}
            >
              {t("tabs.network")}
            </button>
            <button
              className={`tab-button ${activeTab === "storage" ? "active" : ""}`}
              onClick={() => setActiveTab("storage")}
            >
              {t("tabs.storage")}
            </button>
            <button
              className={`tab-button ${activeTab === "advanced" ? "active" : ""}`}
              onClick={() => setActiveTab("advanced")}
            >
              {t("tabs.advanced")}
            </button>
            <button
              className={`tab-button ${activeTab === "token" ? "active" : ""}`}
              onClick={() => setActiveTab("token")}
            >
              {t("tabs.token")}
            </button>
            <button
              className={`tab-button ${activeTab === "privacy" ? "active" : ""}`}
              onClick={() => setActiveTab("privacy")}
            >
              {locale === "zh" ? "🔒 隐私" : "🔒 Privacy"}
            </button>
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="tab-content active">
              {/* Quick Start Guide */}
              {(!isP2PConnected || (!isMining && !clusterMining)) && (
                <div className="status-card" style={{ 
                  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                  color: "white",
                  border: "none",
                  marginBottom: "1.5rem"
                }}>
                  <h2 style={{ color: "white", marginBottom: "1rem" }}>{t("quickStart.title")}</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {/* Step 1: Connect Network */}
                    <div style={{ 
                      background: "rgba(255, 255, 255, 0.15)", 
                      padding: "1rem", 
                      borderRadius: "8px",
                      border: isP2PConnected ? "2px solid #28a745" : "2px solid rgba(255, 255, 255, 0.3)"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ 
                            fontSize: "1.5rem", 
                            background: isP2PConnected ? "#28a745" : "rgba(255, 255, 255, 0.3)",
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}>
                            {isP2PConnected ? "✓" : "1"}
                          </span>
                          <strong style={{ fontSize: "1.1rem" }}>{t("quickStart.step1Title")}</strong>
                        </div>
                        {isP2PConnected ? (
                          <span style={{ color: "#28a745", fontWeight: "bold" }}>{t("quickStart.step1Completed")}</span>
                        ) : (
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
                              padding: "0.5rem 1rem",
                              fontSize: "0.9rem"
                            }}
                          >
                            {t("quickStart.step1Action")}
                          </button>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: "0.9rem", opacity: 0.9 }}>
                        {isP2PConnected 
                          ? t("quickStart.networkConnected", { 
                              mode: isMainnetMode ? t("network.mainnet") : t("network.dev"),
                              count: peerCount 
                            })
                          : t("quickStart.step1Desc")}
                      </p>
                    </div>

                    {/* Step 2: Check Wallet */}
                    <div style={{ 
                      background: "rgba(255, 255, 255, 0.15)", 
                      padding: "1rem", 
                      borderRadius: "8px",
                      border: nodeAddress ? "2px solid #28a745" : "2px solid rgba(255, 255, 255, 0.3)"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ 
                            fontSize: "1.5rem", 
                            background: nodeAddress ? "#28a745" : "rgba(255, 255, 255, 0.3)",
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}>
                            {nodeAddress ? "✓" : "2"}
                          </span>
                          <strong style={{ fontSize: "1.1rem" }}>{t("quickStart.step2Title")}</strong>
                        </div>
                        {nodeAddress ? (
                          <span style={{ color: "#28a745", fontWeight: "bold" }}>{t("quickStart.step2Completed")}</span>
                        ) : (
                          <span style={{ color: "#ffc107", fontWeight: "bold" }}>{t("common.loading")}</span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: "0.9rem", opacity: 0.9 }}>
                        {nodeAddress 
                          ? `${t("wallet.address")}: ${nodeAddress.substring(0, 20)}... (${t("wallet.balance")}: ${chainContext ? chainContext.indexState.getBalance(nodeAddress as any).toFixed(2) : "0"} IDC)`
                          : t("quickStart.walletInitializing")}
                      </p>
                    </div>

                    {/* Step 3: Start Mining */}
                    <div style={{ 
                      background: "rgba(255, 255, 255, 0.15)", 
                      padding: "1rem", 
                      borderRadius: "8px",
                      border: (isMining || clusterMining) ? "2px solid #28a745" : "2px solid rgba(255, 255, 255, 0.3)"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ 
                            fontSize: "1.5rem", 
                            background: (isMining || clusterMining) ? "#28a745" : "rgba(255, 255, 255, 0.3)",
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}>
                            {(isMining || clusterMining) ? "✓" : "3"}
                          </span>
                          <strong style={{ fontSize: "1.1rem" }}>{t("quickStart.step3Title")}</strong>
                        </div>
                        {(isMining || clusterMining) ? (
                          <span style={{ color: "#28a745", fontWeight: "bold" }}>{t("quickStart.step3Mining")}</span>
                        ) : (
                          <button
                            className="btn"
                            onClick={() => {
                              setActiveTab("mining");
                            }}
                            disabled={!nodeAddress}
                            style={{ 
                              background: nodeAddress ? "white" : "rgba(255, 255, 255, 0.5)", 
                              color: nodeAddress ? "#667eea" : "rgba(255, 255, 255, 0.7)",
                              padding: "0.5rem 1rem",
                              fontSize: "0.9rem",
                              cursor: nodeAddress ? "pointer" : "not-allowed"
                            }}
                          >
                            {t("quickStart.step3Action")}
                          </button>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: "0.9rem", opacity: 0.9 }}>
                        {(isMining || clusterMining) 
                          ? t("quickStart.miningStarted", { 
                              hashRate: clusterMining && clusterStats.totalHashRate 
                                ? (clusterStats.totalHashRate / 1000).toFixed(2) + " K hash/s"
                                : miningStats.hashRate 
                                ? (miningStats.hashRate / 1000).toFixed(2) + " K hash/s"
                                : t("mining.calculating")
                            })
                          : t("quickStart.miningNotStarted")}
                      </p>
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
                  <h2>🖥️ {locale === "zh" ? "本地实例状态" : "Local Instance Status"}</h2>
                  <div className="status-item">
                    <span className="label">{locale === "zh" ? "角色" : "Role"}:</span>
                    <span className="value" style={{ 
                      fontWeight: "bold",
                      color: localRole === "LEADER" ? "#667eea" : "#ffc107"
                    }}>
                      {localRole === "LEADER" 
                        ? (locale === "zh" ? "主节点 (LEADER)" : "Leader")
                        : (locale === "zh" ? "跟随节点 (FOLLOWER)" : "Follower")}
                    </span>
                  </div>
                  {leaderInfo && (
                    <>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "Leader 实例" : "Leader Instance"}:</span>
                        <span className="value" style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
                          {leaderInfo.instanceId.substring(0, 20)}...
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "Leader 高度" : "Leader Height"}:</span>
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
                      {locale === "zh" 
                        ? "⚠️ 当前实例为只读模式。如需挖矿，请先在其他实例中关闭挖矿或关闭页面。"
                        : "⚠️ Current instance is read-only. To mine, please stop mining on other instances or close their pages."}
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
                  {finalityStats && (
                    <div className="status-item">
                      <span className="label">{locale === "zh" ? "已最终确认高度" : "Finalized Height"}:</span>
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
                    <>
                      <div className="status-item">
                        <span className="label">{t("wallet.balance")}:</span>
                        <span className="value" style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#667eea" }}>
                          {chainContext.indexState.getBalance(nodeAddress as any).toFixed(2)} IDC
                        </span>
                      </div>
                      {/* Balance Debug Info */}
                      <div className="status-item" style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
                        <details style={{ cursor: "pointer" }}>
                          <summary style={{ userSelect: "none" }}>
                            {locale === "zh" ? "🔍 余额诊断" : "🔍 Balance Debug"}
                          </summary>
                          <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f8f9fa", borderRadius: "4px", fontFamily: "monospace", fontSize: "0.7rem" }}>
                            <div><strong>{locale === "zh" ? "地址" : "Address"}:</strong> {nodeAddress}</div>
                            <div><strong>{locale === "zh" ? "区块高度" : "Block Height"}:</strong> {tip?.header.height ?? 0}</div>
                            <div><strong>{locale === "zh" ? "区块数量" : "Block Count"}:</strong> {chainContext.storage.getAllBlocks().length}</div>
                            <div><strong>{locale === "zh" ? "余额 (balances namespace)" : "Balance (balances namespace)"}:</strong> {chainContext.indexState.get("balances", nodeAddress) ?? (locale === "zh" ? "未设置" : "not set")}</div>
                            <div><strong>{locale === "zh" ? "P2P 连接" : "P2P Connection"}:</strong> {isP2PConnected ? (peerCount > 0 ? (locale === "zh" ? `已连接 (${peerCount} 个节点)` : `Connected (${peerCount} peers)`) : (locale === "zh" ? "未连接" : "Not connected")) : (locale === "zh" ? "未初始化" : "Not initialized")}</div>
                            {tip && (
                              <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                                <div><strong>{locale === "zh" ? "最新区块哈希" : "Latest Block Hash"}:</strong> {tip.hash.substring(0, 20)}...</div>
                                <div><strong>{locale === "zh" ? "最新区块时间" : "Latest Block Time"}:</strong> {new Date(tip.header.timestamp * 1000).toLocaleString()}</div>
                              </div>
                            )}
                            {/* Force Sync Button */}
                            {isP2PConnected && peerCount > 0 && chainContext.p2p && (
                              <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                                <button
                                  onClick={async () => {
                                    try {
                                      const localTip = chainContext.storage.getTip();
                                      const localHeight = localTip?.header.height ?? -1;
                                      // Request blocks from network
                                      chainContext.p2p!.broadcast("REQUEST_BLOCKS", {
                                        fromHeight: localHeight + 1,
                                        toHeight: localHeight + 100, // Request up to 100 blocks ahead
                                      });
                                      setError(locale === "zh" ? "已请求同步区块，请等待..." : "Requested block sync, please wait...");
                                      setTimeout(() => setError(""), 3000);
                                    } catch (err) {
                                      setError(err instanceof Error ? err.message : "Failed to request sync");
                                    }
                                  }}
                                  style={{
                                    padding: "0.25rem 0.5rem",
                                    fontSize: "0.7rem",
                                    background: "#667eea",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "3px",
                                    cursor: "pointer",
                                  }}
                                >
                                  {locale === "zh" ? "🔄 强制同步区块" : "🔄 Force Sync Blocks"}
                                </button>
                              </div>
                            )}
                          </div>
                        </details>
                      </div>
                    </>
                  )}
                  <div className="status-item">
                    <span className="label">{t("wallet.nodeId")}:</span>
                    <span className="value" style={{ fontSize: "0.8rem" }}>
                      {getOrCreateBrowserNodeId().substring(0, 16)}...
                    </span>
                  </div>
                </div>
              </div>

              {/* Latest Block */}
              {tip && (
                <div className="status-card">
                  <h2>📦 {t("chain.latestBlock")}</h2>
                  <div className="status-item">
                    <span className="label">{t("chain.hash")}:</span>
                    <span className="value" style={{ fontSize: "0.8rem", wordBreak: "break-all", fontFamily: "monospace" }}>
                      {tip.hash.substring(0, 32)}...
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("chain.height")}:</span>
                    <span className="value">{tip.header.height}</span>
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
                    <span className="value">{tip.header.nonce.toLocaleString()}</span>
                  </div>
                  {tip.header.stateCommitment && (
                    <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                      <span className="label">{t("chain.stateCommitment")}:</span>
                      <span className="value" style={{ fontSize: "0.8rem", wordBreak: "break-all", fontFamily: "monospace" }}>
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
              {/* Mining Guide */}
              {!isMining && !clusterMining && (
                <div className="status-card" style={{ 
                  background: "#e7f3ff",
                  border: "2px solid #667eea",
                  marginBottom: "1.5rem"
                }}>
                  <h2 style={{ color: "#667eea", marginBottom: "1rem" }}>{t("mining.guide")}</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div>
                      <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem", color: "#333" }}>{t("mining.whatIsMining")}</h3>
                      <p style={{ fontSize: "0.9rem", color: "#666", lineHeight: "1.6", margin: 0 }}>
                        {t("mining.whatIsMiningDesc")}
                      </p>
                    </div>
                    <div>
                      <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem", color: "#333" }}>{t("mining.steps")}</h3>
                      <ol style={{ fontSize: "0.9rem", color: "#666", lineHeight: "1.8", margin: 0, paddingLeft: "1.5rem" }}>
                        <li>{t("mining.step1")}</li>
                        <li>{t("mining.step2")}</li>
                        <li>{t("mining.step3")}
                          <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
                            <li>{t("mining.step3Single")}</li>
                            <li>{t("mining.step3Cluster")}</li>
                          </ul>
                        </li>
                        <li>{t("mining.step4")}</li>
                      </ol>
                    </div>
                    <div style={{ 
                      background: "#fff3cd", 
                      padding: "0.75rem", 
                      borderRadius: "6px",
                      border: "1px solid #ffc107"
                    }}>
                      <strong style={{ color: "#856404" }}>{t("mining.tips")}</strong>
                      <ul style={{ margin: "0.5rem 0 0 0", paddingLeft: "1.5rem", fontSize: "0.9rem", color: "#856404" }}>
                        <li>{t("mining.tip1")}</li>
                        <li>{t("mining.tip2")}</li>
                        <li>{t("mining.tip3")}</li>
                        <li>{t("mining.tip4")}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Mining Status Banner */}
              {(isMining || clusterMining) && (
                <div className="status-card" style={{ 
                  background: "linear-gradient(135deg, #28a745 0%, #20c997 100%)",
                  color: "white",
                  border: "none",
                  marginBottom: "1.5rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <h2 style={{ color: "white", margin: 0, marginBottom: "0.5rem" }}>{t("mining.active")}</h2>
                      <div style={{ fontSize: "0.9rem", opacity: 0.9 }}>
                        {clusterMining ? (
                          <>
                            {locale === "zh" ? "集群模式" : "Cluster Mode"} • {clusterStats.activeWorkers} {locale === "zh" ? "个工作线程" : "workers"} • 
                            {t("mining.hashRate")} {clusterStats.totalHashRate ? (clusterStats.totalHashRate / 1000).toFixed(2) + " K hash/s" : t("mining.calculating")} • 
                            {locale === "zh" ? "已尝试" : "Tried"}: {clusterStats.totalHashesTried.toString()} {locale === "zh" ? "次哈希" : "hashes"}
                          </>
                        ) : (
                          <>
                            {locale === "zh" ? "单线程模式" : "Single Thread Mode"} • 
                            {t("mining.hashRate")} {miningStats.hashRate ? (miningStats.hashRate / 1000).toFixed(2) + " K hash/s" : t("mining.calculating")} • 
                            {locale === "zh" ? "已尝试" : "Tried"}: {miningStats.hashesTried.toLocaleString()} {locale === "zh" ? "次哈希" : "hashes"}
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn"
                      onClick={clusterMining ? handleStopClusterMining : handleStopMining}
                      style={{ 
                        background: "white", 
                        color: "#28a745",
                        padding: "0.75rem 1.5rem",
                        fontSize: "1rem",
                        fontWeight: "bold"
                      }}
                    >
                      停止挖矿
                    </button>
                  </div>
                </div>
              )}

              {/* Mining Controls */}
              <div className="status-card">
                <h2>{t("mining.controls")}</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {/* Single Worker Mode */}
                  <div style={{ 
                    padding: "1rem", 
                    background: "#f8f9fa", 
                    borderRadius: "8px",
                    border: isMining ? "2px solid #28a745" : "1px solid #dee2e6"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                      <div>
                        <h3 style={{ fontSize: "1rem", margin: 0, marginBottom: "0.25rem" }}>{t("mining.singleWorker")}</h3>
                        <p style={{ fontSize: "0.85rem", color: "#666", margin: 0 }}>
                          {t("mining.singleWorkerDesc")}
                        </p>
                      </div>
                      {isMining && (
                        <span style={{ 
                          background: "#28a745", 
                          color: "white", 
                          padding: "0.25rem 0.75rem", 
                          borderRadius: "4px",
                          fontSize: "0.85rem",
                          fontWeight: "bold"
                        }}>
                          运行中
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                      {!isMining && !clusterMining ? (
                        <>
                          <button
                            className="btn btn-primary"
                            onClick={handleStartMining}
                            disabled={!nodeAddress || !localCoordinator.canMine()}
                            style={{ 
                              fontSize: "1rem", 
                              padding: "0.75rem 1.5rem",
                              opacity: (!nodeAddress || !localCoordinator.canMine()) ? 0.5 : 1,
                              cursor: (!nodeAddress || !localCoordinator.canMine()) ? "not-allowed" : "pointer"
                            }}
                            title={!localCoordinator.canMine() 
                              ? (locale === "zh" 
                                  ? "本机已有一个挖矿实例，当前实例为只读模式"
                                  : "This machine already has a mining instance, current instance is read-only")
                              : ""}
                          >
                            {t("mining.startMining")} {pendingTxs.length > 0 ? `(${t("mining.pendingTxs", { count: pendingTxs.length })})` : `(${t("mining.coinbaseOnly")})`}
                            {!localCoordinator.canMine() && (
                              <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", opacity: 0.8 }}>
                                ({locale === "zh" ? "只读" : "Read-only"})
                              </span>
                            )}
                          </button>
                          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={autoMining}
                              onChange={(e) => {
                                setAutoMining(e.target.checked);
                                if (e.target.checked && chainContext && !isMining && !clusterMining) {
                                  setTimeout(() => handleStartMining(), 500);
                                }
                              }}
                            />
                            <span style={{ fontSize: "0.9rem" }}>{t("mining.autoMining")}</span>
                          </label>
                        </>
                      ) : isMining ? (
                        <>
                          <button className="btn btn-secondary" onClick={handleStopMining}>
                            {t("mining.stopMining")}
                          </button>
                          {autoMining && (
                            <span style={{ fontSize: "0.9rem", color: "#666" }}>
                              ({t("mining.autoMiningDesc")})
                            </span>
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Cluster Mining Mode */}
                  {chainContext && (
                    <div style={{ 
                      padding: "1rem", 
                      background: "#f8f9fa", 
                      borderRadius: "8px",
                      border: clusterMining ? "2px solid #28a745" : "1px solid #dee2e6"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                        <div>
                          <h3 style={{ fontSize: "1rem", margin: 0, marginBottom: "0.25rem" }}>{t("mining.clusterMining")}</h3>
                          <p style={{ fontSize: "0.85rem", color: "#666", margin: 0 }}>
                            {t("mining.clusterMiningDesc")}
                          </p>
                        </div>
                        {clusterMining && (
                          <span style={{ 
                            background: "#28a745", 
                            color: "white", 
                            padding: "0.25rem 0.75rem", 
                            borderRadius: "4px",
                            fontSize: "0.85rem",
                            fontWeight: "bold"
                          }}>
                            运行中
                          </span>
                        )}
                      </div>
                      {!clusterMining && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <label style={{ fontSize: "0.9rem", minWidth: "100px" }}>
                              {t("mining.workerCount")}
                            </label>
                            <input
                              type="range"
                              min="1"
                              max={typeof navigator !== "undefined" && "hardwareConcurrency" in navigator 
                                ? Math.max(1, (navigator.hardwareConcurrency || 4) * 2)
                                : 32}
                              value={clusterWorkerCount}
                              onChange={(e) => setClusterWorkerCount(parseInt(e.target.value))}
                              style={{ flex: 1 }}
                            />
                            <span style={{ fontWeight: "bold", minWidth: "40px", textAlign: "right" }}>
                              {clusterWorkerCount}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "#666" }}>
                            {t("mining.optimalWorkers", { count: MinerCluster.getOptimalWorkerCount() })}
                          </div>
                          <button
                            className="btn btn-primary"
                            onClick={handleStartClusterMining}
                            disabled={!chainContext || clusterMining || !nodeAddress || !localCoordinator.canMine()}
                            style={{ 
                              fontSize: "1rem", 
                              padding: "0.75rem 1.5rem",
                              opacity: (!chainContext || clusterMining || !nodeAddress || !localCoordinator.canMine()) ? 0.5 : 1,
                              cursor: (!chainContext || clusterMining || !nodeAddress || !localCoordinator.canMine()) ? "not-allowed" : "pointer"
                            }}
                            title={!localCoordinator.canMine() 
                              ? (locale === "zh" 
                                  ? "本机已有一个挖矿实例，当前实例为只读模式"
                                  : "This machine already has a mining instance, current instance is read-only")
                              : ""}
                          >
                            {t("mining.startClusterMining")} {pendingTxs.length > 0 ? `(${t("mining.pendingTxs", { count: pendingTxs.length })})` : `(${t("mining.coinbaseOnly")})`}
                            {!localCoordinator.canMine() && (
                              <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", opacity: 0.8 }}>
                                ({locale === "zh" ? "只读" : "Read-only"})
                              </span>
                            )}
                          </button>
                        </div>
                      )}
                      {clusterMining && (
                        <div style={{ marginTop: "0.75rem" }}>
                          <button
                            className="btn btn-secondary"
                            onClick={handleStopClusterMining}
                            style={{ fontSize: "1rem", padding: "0.75rem 1.5rem" }}
                          >
                            {t("mining.stopClusterMining")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Mining Status */}
              {(isMining || miningStats.hashesTried > 0) && (
                <div className="status-card">
                  <h2>{t("mining.status")}</h2>
                  <div className="status-item">
                    <span className="label">{t("status.status")}:</span>
                    <span className="value">
                      {isMining ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>⛏️ {t("status.mining")}...</span>
                      ) : minerClient.getIsMining() ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>⛏️ {t("status.mining")}...</span>
                      ) : (
                        <span style={{ color: "#666" }}>{t("status.stopped")}</span>
                      )}
                    </span>
                  </div>
                  {tip && (
                    <div className="status-item">
                      <span className="label">{t("mining.difficulty")}</span>
                      <span className="value">
                        {t("mining.difficultyDesc", { difficulty: tip.header.difficulty })}
                      </span>
                    </div>
                  )}
                  <div className="status-item">
                    <span className="label">{t("mining.hashRate")}</span>
                    <span className="value" style={{ fontWeight: "bold", color: "#667eea", fontSize: "1.1rem" }}>
                      {miningStats.hashRate
                        ? `${(miningStats.hashRate / 1000).toFixed(2)} K hash/s`
                        : t("mining.calculating")}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{t("mining.hashesTried")}</span>
                    <span className="value">{miningStats.hashesTried.toLocaleString()}</span>
                  </div>
                  {miningStats.elapsedTime > 0 && (
                    <div className="status-item">
                      <span className="label">{t("mining.elapsedTime")}</span>
                      <span className="value">{miningStats.elapsedTime.toFixed(1)} {locale === "zh" ? "秒" : "s"}</span>
                    </div>
                  )}
                  {isMining && (
                    <>
                      <div className="status-item">
                        <span className="label">{t("mining.currentHash")}</span>
                        <span className="value" style={{ fontSize: "0.8rem", wordBreak: "break-all", fontFamily: "monospace" }}>
                          {miningHash || t("mining.calculating")}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("mining.currentNonce")}</span>
                        <span className="value" style={{ fontFamily: "monospace" }}>{miningNonce.toLocaleString()}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Phase 18: Cluster Mining Stats */}
              {chainContext && clusterMining && (
                <div className="status-card">
                  <h2>{t("mining.clusterStats")}</h2>
                  {clusterMining && (
                    <>
                      <div className="status-item">
                        <span className="label">{t("mining.totalHashRate")}</span>
                        <span className="value" style={{ fontWeight: "bold", color: "#667eea", fontSize: "1.1rem" }}>
                          {clusterStats.totalHashRate
                            ? `${(clusterStats.totalHashRate / 1000).toFixed(2)} K hash/s`
                            : t("mining.calculating")}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("mining.activeWorkers")}</span>
                        <span className="value">
                          {clusterStats.activeWorkers} / {clusterStats.totalWorkers}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("mining.totalHashes")}</span>
                        <span className="value">{clusterStats.totalHashesTried.toString()}</span>
                      </div>
                      {clusterStats.workers.length > 0 && (
                        <div style={{ marginTop: "1rem" }}>
                          <strong>{t("mining.workerDetails")}</strong>
                          <div style={{ maxHeight: "200px", overflowY: "auto", marginTop: "0.5rem" }}>
                            {clusterStats.workers.map((worker) => (
                              <div
                                key={worker.workerId}
                                style={{
                                  padding: "0.5rem",
                                  marginBottom: "0.25rem",
                                  background: "#f0f0f0",
                                  borderRadius: "4px",
                                  fontSize: "0.85rem",
                                }}
                              >
                                <div>
                                  <strong>{t("mining.workerStatus", { id: worker.workerId })}</strong>{" "}
                                  <span style={{ color: worker.status === "running" ? "#28a745" : "#666" }}>
                                    {worker.status === "running" ? t("mining.running") : worker.status === "stopped" ? t("mining.stopped") : t("mining.exhausted")}
                                  </span>
                                </div>
                                <div>
                                  {t("mining.hashRate")} {worker.hashRate ? `${(worker.hashRate / 1000).toFixed(2)} K hash/s` : "—"}
                                </div>
                                <div style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                                  {t("mining.nonceRange")} {worker.currentNonceStart.toString()} -{" "}
                                  {worker.currentNonceEnd ? worker.currentNonceEnd.toString() : "∞"}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Phase 19: Global Miner Pool */}
              {chainContext && isP2PConnected && (
                <div className="status-card">
                  <h2>🌐 {t("network.globalPool")}</h2>
                  <div className="status-item">
                    <span className="label">{locale === "zh" ? "模式" : "Mode"}:</span>
                    <span className="value">
                      {globalPoolEnabled ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>{locale === "zh" ? "已启用" : "Enabled"}</span>
                      ) : (
                        <span style={{ color: "#666" }}>{locale === "zh" ? "已禁用" : "Disabled"}</span>
                      )}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">{locale === "zh" ? "角色" : "Role"}:</span>
                    <span className="value">
                      {isDelegator ? (
                        <span style={{ color: "#667eea", fontWeight: "bold" }}>{locale === "zh" ? "委托者" : "Delegator"}</span>
                      ) : (
                        <span style={{ color: "#666" }}>{locale === "zh" ? "工作节点" : "Worker Node"}</span>
                      )}
                    </span>
                  </div>
                  {isDelegator && delegatorStats && (
                    <>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "活跃范围" : "Active Ranges"}:</span>
                        <span className="value">{delegatorStats.activeRanges}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{locale === "zh" ? "总节点数" : "Total Nodes"}:</span>
                        <span className="value">{delegatorStats.totalNodes}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">{t("network.globalPointer")}:</span>
                        <span className="value" style={{ fontSize: "0.85rem", fontFamily: "monospace" }}>
                          {delegatorStats.globalPointer.toString()}
                        </span>
                      </div>
                    </>
                  )}
                  {!globalPoolEnabled && (
                    <div style={{ marginTop: "1rem" }}>
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          setGlobalPoolEnabled(true);
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
                          for (let i = 0; i < clusterWorkerCount; i++) {
                            workerNodeManager.requestNonceRange(i, capability);
                          }
                        }}
                      >
                        {t("network.enableGlobalPool")}
                      </button>
                    </div>
                  )}
                  {globalPoolEnabled && (
                    <div style={{ marginTop: "1rem" }}>
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setGlobalPoolEnabled(false);
                          workerNodeManager.reset();
                        }}
                      >
                        {t("network.disableGlobalPool")}
                      </button>
                    </div>
                  )}
                  <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
                    💡 <strong>{t("network.globalPool")}:</strong> {t("network.globalPoolDesc")}
                    {isDelegator && ` ${t("network.isDelegator")}`}
                  </div>
                </div>
              )}
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
                        {locale === "zh" ? "当前余额" : "Current Balance"}:
                      </span>
                      <span style={{ fontSize: "1.3rem", fontWeight: "bold", color: "#667eea" }}>
                        {chainContext.indexState.getBalance(nodeAddress as any).toFixed(6)} IDC
                      </span>
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                      {locale === "zh" ? "地址" : "Address"}: {nodeAddress.substring(0, 20)}...
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
                      {locale === "zh" ? "收款地址" : "Recipient Address"}
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
                      {locale === "zh" ? "转账金额" : "Transfer Amount"} (IDC)
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
                        {locale === "zh" ? "转账后余额" : "Balance after transfer"}:{" "}
                        <span style={{ 
                          fontWeight: "bold",
                          color: parseFloat(transferAmount) > chainContext.indexState.getBalance(nodeAddress as any) ? "#dc3545" : "#28a745"
                        }}>
                          {(chainContext.indexState.getBalance(nodeAddress as any) - parseFloat(transferAmount) || 0).toFixed(6)} IDC
                        </span>
                        {parseFloat(transferAmount) > chainContext.indexState.getBalance(nodeAddress as any) && (
                          <span style={{ color: "#dc3545", marginLeft: "0.5rem" }}>
                            ⚠️ {locale === "zh" ? "余额不足" : "Insufficient balance"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      if (!chainContext || !transferTo || !transferAmount) {
                        setError(locale === "zh" ? "请输入收款地址和金额" : "Please enter recipient address and amount");
                        setSuccessMessage("");
                        return;
                      }
                      const amount = parseFloat(transferAmount);
                      if (isNaN(amount) || amount <= 0) {
                        setError(locale === "zh" ? "金额必须是正数" : "Amount must be a positive number");
                        setSuccessMessage("");
                        return;
                      }
                      // Check balance before transfer
                      if (nodeAddress && chainContext) {
                        const currentBalance = chainContext.indexState.getBalance(nodeAddress as any);
                        if (amount > currentBalance) {
                          setError(locale === "zh" 
                            ? `余额不足。当前余额: ${currentBalance.toFixed(6)} IDC，转账金额: ${amount.toFixed(6)} IDC`
                            : `Insufficient balance. Current: ${currentBalance.toFixed(6)} IDC, Transfer: ${amount.toFixed(6)} IDC`);
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
                          setError(locale === "zh" ? "添加转账交易失败（可能是重复交易或无效交易）" : "Failed to add transfer transaction (may be duplicate or invalid)");
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
                        setSuccessMessage(locale === "zh" 
                          ? `转账交易已创建并广播！金额: ${amount.toFixed(6)} IDC，接收者: ${transferTo.substring(0, 20)}...`
                          : `Transfer transaction created and broadcast! Amount: ${amount.toFixed(6)} IDC, Recipient: ${transferTo.substring(0, 20)}...`);
                        // Clear success message after 5 seconds
                        setTimeout(() => {
                          setSuccessMessage("");
                        }, 5000);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : (locale === "zh" ? "创建转账失败" : "Failed to create transfer"));
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
                      {locale === "zh" ? "正在使用私钥签名交易..." : "Signing transaction with your private key..."}
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
                      {locale === "zh" ? "正在使用私钥签名交易..." : "Signing transaction with your private key..."}
                    </p>
                  )}
                </div>
              </div>

              {/* Pending Transactions */}
              {pendingTxs.length > 0 && (
                <div className="status-card">
                  <h2>⏳ {t("transactions.pending")} ({pendingTxs.length})</h2>
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
                          <strong>TxID:</strong> {tx.txId.substring(0, 16)}...
                        </div>
                        <div>
                          <strong>From:</strong> {tx.ownerAddress?.substring(0, 20) || "Unknown"}...
                        </div>
                        <div>
                          <strong>Ops:</strong> {tx.ops.length}
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
                <h2>🌐 P2P Network</h2>
                <div className="status-item">
                  <span className="label">Mode:</span>
                  <span className="value">
                    {isMainnetMode ? (
                      <span style={{ color: "#28a745", fontWeight: "bold" }}>🌐 Mainnet</span>
                    ) : (
                      <span style={{ color: "#ffc107", fontWeight: "bold" }}>🔧 Dev Mode</span>
                    )}
                  </span>
                </div>
                <div className="status-item">
                  <span className="label">Status:</span>
                  <span className="value">{isP2PConnected ? "Connected" : "Disconnected"}</span>
                </div>
                <div className="status-item">
                  <span className="label">Peers:</span>
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
                          ? (locale === "zh" ? "主网信令服务器 (wss://...)" : "Mainnet Signaling Server (wss://...)")
                          : (locale === "zh" ? "本地信令服务器 (ws://localhost:8080)" : "Local Signaling Server (ws://localhost:8080)")}
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
                Verify Latest Snapshot
              </button>
              {/* Phase 14: Fetch remote snapshot */}
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  if (!chainContext) return;
                  
                  if (!chainContext.params.remoteSnapshotEnabled || !chainContext.params.remoteSnapshotEndpoints || chainContext.params.remoteSnapshotEndpoints.length === 0) {
                    setError("Remote snapshot sync is not enabled. Please configure remoteSnapshotEndpoints in chain params.");
                    return;
                  }
                  
                  try {
                    setError("Fetching remote snapshot...");
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
                      
                      setError(`✅ Remote snapshot synced successfully from height ${remoteMeta.height}!`);
                      setTimeout(() => setError(""), 5000);
                      
                      // Reload page to apply the new snapshot
                      setTimeout(() => {
                        if (window.confirm("Remote snapshot downloaded. Reload page to apply it?")) {
                          window.location.reload();
                        }
                      }, 2000);
                    } else {
                      setError("❌ Failed to fetch remote snapshot from any configured source.");
                      setTimeout(() => setError(""), 5000);
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to fetch remote snapshot");
                  }
                }}
                disabled={!chainContext || !chainContext.params.remoteSnapshotEnabled || !chainContext.params.remoteSnapshotEndpoints || chainContext.params.remoteSnapshotEndpoints.length === 0}
                style={{ background: "#28a745", color: "white" }}
              >
                      Fetch Remote Snapshot
                    </button>
                  </div>
                </div>

                {/* Phase 10: Light Node Status */}
                <div className="status-card">
                  <h2>💡 Light Node Status</h2>
                  <div className="status-item">
                    <span className="label">Light Node Window:</span>
                    <span className="value">
                      {chainContext.params.lightNodeWindow ?? 200} blocks
                      {chainContext.params.lightNodeWindow && chainContext.params.lightNodeWindow <= 20 && (
                        <span style={{ marginLeft: "0.5rem", color: "#28a745", fontSize: "0.85rem" }}>
                          (Extreme Pruning - Phase 15)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">Stored Blocks:</span>
                    <span className="value">{blockCount}</span>
                  </div>
                  {(() => {
                    const minHeight = chainContext.storage.getMinHeight();
                    const maxHeight = chainContext.storage.getMaxHeight();
                    return (
                      <>
                        <div className="status-item">
                          <span className="label">Earliest Block Height:</span>
                          <span className="value">{minHeight}</span>
                        </div>
                        <div className="status-item">
                          <span className="label">Latest Block Height:</span>
                          <span className="value">{maxHeight}</span>
                        </div>
                        {chainContext.params.lightNodeWindow && chainContext.params.lightNodeWindow > 0 && (
                          <div className="status-item">
                            <span className="label">Storage Reduction:</span>
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
                              setError("Pruned old blocks");
                              setTimeout(() => setError(""), 2000);
                            }
                          }
                        }
                      }}
                      disabled={!chainContext || height === 0}
                      style={{ background: "#ffc107", color: "#000" }}
                    >
                      Clear Pruned Blocks
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
                  <h2>⚙️ Difficulty Status</h2>
                  <div className="status-item">
                    <span className="label">Current Difficulty:</span>
                    <span className="value">{tip.header.difficulty}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Target Block Time:</span>
                    <span className="value">{chainContext.params.targetBlockTime}s</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Blocks Until Adjustment:</span>
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
                          <span className="label">Avg Block Time (last {recentBlocks.length}):</span>
                          <span className="value">{avgTime.toFixed(2)}s</span>
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
                          <strong>Next Adjustment:</strong> {explanation.reason}
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

          {/* Other tabs placeholder - to be implemented */}
          {activeTab !== "overview" && activeTab !== "wallet" && activeTab !== "mining" && activeTab !== "transactions" && activeTab !== "network" && activeTab !== "storage" && activeTab !== "advanced" && activeTab !== "token" && activeTab !== "privacy" && activeTab !== "runtime" && (
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
