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
} from "../core/idcEmission.js";
import type { Operation, Block, Tx, SnapshotMeta } from "../core/types.js";
import { WalletBackupPanel } from "./WalletBackupPanel.js";
import { WalletManagerPanel } from "./WalletManagerPanel.js";
import { ConfigChecker } from "./ConfigChecker.js";
import "./index.css";

/**
 * Main App Component
 *
 * Phase 4: P2P Networking
 */
function App() {
  const [chainContext, setChainContext] = useState<ChainContext | null>(null);
  const [mempool] = useState(() => new Mempool());
  const [isMining, setIsMining] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [miningHash, setMiningHash] = useState<string>("");
  const [miningNonce, setMiningNonce] = useState<number>(0);
  const [error, setError] = useState<string>("");
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
  const [clusterWorkerCount, setClusterWorkerCount] = useState<number>(() => {
    // Default to optimal worker count based on CPU cores
    if (typeof navigator !== "undefined" && "hardwareConcurrency" in navigator) {
      const cores = navigator.hardwareConcurrency || 4;
      return Math.max(1, cores - 1);
    }
    return 4;
  });
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
  useEffect(() => {
    if (chainContext) {
      const metas = loadAllSnapshotMeta();
      setSnapshotMetas(metas);
      const latest = getLatestSnapshotMeta();
      const prevLatest = latestSnapshot;
      
      // Phase 20: If new snapshot was created, update seeder cache
      if (latest && (!prevLatest || latest.height > prevLatest.height)) {
        if (isP2PConnected && gsnEnabled && snapshotSeeder) {
          snapshotSeeder.updateCache(latest.height);
        }
      }
      
      setLatestSnapshot(latest);
      
      // Load size info for latest snapshot
      if (latest) {
        getSnapshotSizeInfo(latest.height).then((info) => {
          setSnapshotSizeInfo(info);
        });
      } else {
        setSnapshotSizeInfo(null);
      }
    }
  }, [chainContext, isP2PConnected, gsnEnabled, snapshotSeeder, latestSnapshot]);

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
      }
      
      // Setup delegator change handler
      if (delegatorManager) {
        delegatorManager.onDelegatorChange((isDelegator) => {
          setIsDelegator(isDelegator);
          if (isDelegator && delegatorManager) {
            // Update stats periodically
            const updateStats = () => {
              setDelegatorStats(delegatorManager.getStats());
            };
            const interval = setInterval(updateStats, 2000);
            updateStats();
            return () => clearInterval(interval);
          }
        });
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
      
      setIsP2PConnected(true);
      setError(""); // Clear any previous errors
      
      return () => {
        clearInterval(gsnStatsInterval);
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to connect to P2P network";
      setError(errorMessage);
      setIsP2PConnected(false);
      
      // Clean up on error
      if (p2pNodeRef.current) {
        p2pNodeRef.current.disconnect();
        p2pNodeRef.current = null;
      }
    }
  };

  // Disconnect from P2P network
  const handleDisconnectP2P = () => {
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
  const handleStartClusterMining = async () => {
    if (!chainContext) return;

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

      minerCluster.onFound(async (block, workerId) => {
        console.log(`[Phase 18] Block found by worker ${workerId}`);
        
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
        workerNodeManager.onRangeReceived((range) => {
          // Update worker with new range
          // This will be handled by modifying the cluster to use global ranges
          console.log(`[Phase 19] Worker received range [${range.start}, ${range.end})`);
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

      // Start cluster mining
      await minerCluster.startMining({
        candidateBlock,
        difficulty: candidateBlock.header.difficulty,
        workerCount: clusterWorkerCount,
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
  const handleStartMining = async () => {
    if (!chainContext) return;
    
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
      minerClient.startMining({
        candidateBlock,
        difficulty: candidateBlock.header.difficulty,
        onProgress: (event) => {
          console.log("[App] onProgress callback called:", {
            hashesTried: event.hashesTried,
            nonce: event.nonce,
            hash: event.hash.substring(0, 16) + "...",
          });
          // Use functional updates to ensure we're using the latest state
          setMiningHash((prev) => {
            console.log("[App] setMiningHash called, prev:", prev.substring(0, 16) + "...", "new:", event.hash.substring(0, 16) + "...");
            return event.hash;
          });
          setMiningNonce((prev) => {
            console.log("[App] setMiningNonce called, prev:", prev, "new:", event.nonce);
            return event.nonce;
          });
          const elapsed = (Date.now() - event.startedAt) / 1000;
          const hashRate = elapsed > 0 ? event.hashesTried / elapsed : null;
          setMiningStats((prev) => {
            const newStats = {
              hashesTried: event.hashesTried,
              hashRate,
              elapsedTime: elapsed,
            };
            console.log("[App] setMiningStats called, prev:", prev, "new:", newStats);
            return newStats;
          });
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

              // Update context
              setChainContext({ ...chainContext });
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
          
          // Auto-restart mining if auto-mining is enabled
          if (autoMining && chainContext) {
            setTimeout(() => {
              if (!isMining) {
                handleStartMining();
              }
            }, 1000);
          }
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
  useEffect(() => {
    if (!chainContext) return;

    const tip = chainContext.storage.getTip();
    let lastHeight = tip?.header.height ?? 0;

    // Check if tip changed (new block received)
    const checkTip = () => {
      const newTip = chainContext.storage.getTip();
      const newHeight = newTip?.header.height ?? 0;
      if (newHeight > lastHeight) {
        // Tip changed, restart mining if currently mining or auto-mining is enabled
        lastHeight = newHeight;
        if (isMining) {
          minerClient.stopMining("replaced");
        }
        // Restart after a short delay (allow mining even without pending transactions)
        // Only restart if currently mining or auto-mining is enabled
        if (isMining || autoMining) {
          setTimeout(() => {
            if (chainContext && (!isMining || autoMining)) {
              handleStartMining();
            }
          }, 500);
        }
      }
    };

    const interval = setInterval(checkTip, 1000); // Check every second
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainContext, isMining, autoMining]);

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
        <h1>⛓️ IndexerChain</h1>
        <p className="subtitle">Browser-Native Blockchain • Phase 24 Complete</p>
      </header>

      <main className="app-main">
        {/* Configuration Checker */}
        {chainContext && (
          <ConfigChecker
            chainContext={chainContext}
            isP2PConnected={isP2PConnected}
            nodeAddress={nodeAddress}
            isMining={isMining}
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
              Reset Chain
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
              📊 Overview
            </button>
            <button
              className={`tab-button ${activeTab === "wallet" ? "active" : ""}`}
              onClick={() => setActiveTab("wallet")}
            >
              💼 Wallet
            </button>
            <button
              className={`tab-button ${activeTab === "mining" ? "active" : ""}`}
              onClick={() => setActiveTab("mining")}
            >
              ⛏️ Mining
            </button>
            <button
              className={`tab-button ${activeTab === "transactions" ? "active" : ""}`}
              onClick={() => setActiveTab("transactions")}
            >
              💸 Transactions
            </button>
            <button
              className={`tab-button ${activeTab === "network" ? "active" : ""}`}
              onClick={() => setActiveTab("network")}
            >
              🌐 Network
            </button>
            <button
              className={`tab-button ${activeTab === "storage" ? "active" : ""}`}
              onClick={() => setActiveTab("storage")}
            >
              💾 Storage
            </button>
            <button
              className={`tab-button ${activeTab === "advanced" ? "active" : ""}`}
              onClick={() => setActiveTab("advanced")}
            >
              ⚙️ Advanced
            </button>
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="tab-content active">
              {/* Quick Stats Grid */}
              <div className="grid-3" style={{ marginBottom: "1.5rem" }}>
                {/* Chain Status Card */}
                <div className="status-card">
                  <h2>📊 Chain Status</h2>
                  <div className="status-item">
                    <span className="label">Current Height:</span>
                    <span className="value" style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#667eea" }}>
                      {height}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">Block Count:</span>
                    <span className="value">{blockCount}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Pending Txs:</span>
                    <span className="value">{pendingTxs.length}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Mining:</span>
                    <span className="value">
                      {isMining || clusterMining ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>Active</span>
                      ) : (
                        <span style={{ color: "#666" }}>Inactive</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Network Status Card */}
                <div className="status-card">
                  <h2>🌐 Network Status</h2>
                  <div className="status-item">
                    <span className="label">Connection:</span>
                    <span className="value">
                      {isP2PConnected ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>Connected</span>
                      ) : (
                        <span style={{ color: "#dc3545" }}>Disconnected</span>
                      )}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">Peers:</span>
                    <span className="value">{peerCount}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Mode:</span>
                    <span className="value">
                      {isMainnetMode ? (
                        <span style={{ color: "#28a745" }}>🌐 Mainnet</span>
                      ) : (
                        <span style={{ color: "#ffc107" }}>🔧 Dev</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Wallet Status Card */}
                <div className="status-card">
                  <h2>💼 Wallet Status</h2>
                  <div className="status-item">
                    <span className="label">Address:</span>
                    <span className="value" style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>
                      {nodeAddress ? `${nodeAddress.substring(0, 20)}...` : "Loading..."}
                    </span>
                  </div>
                  {nodeAddress && chainContext && (
                    <div className="status-item">
                      <span className="label">IDC Balance:</span>
                      <span className="value" style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#667eea" }}>
                        {chainContext.indexState.getBalance(nodeAddress as any).toFixed(2)} IDC
                      </span>
                    </div>
                  )}
                  <div className="status-item">
                    <span className="label">Node ID:</span>
                    <span className="value" style={{ fontSize: "0.8rem" }}>
                      {getOrCreateBrowserNodeId().substring(0, 16)}...
                    </span>
                  </div>
                </div>
              </div>

              {/* Latest Block */}
              {tip && (
                <div className="status-card">
                  <h2>📦 Latest Block</h2>
                  <div className="status-item">
                    <span className="label">Hash:</span>
                    <span className="value" style={{ fontSize: "0.8rem", wordBreak: "break-all", fontFamily: "monospace" }}>
                      {tip.hash.substring(0, 32)}...
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">Height:</span>
                    <span className="value">{tip.header.height}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Transactions:</span>
                    <span className="value">{tip.txs.length}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Difficulty:</span>
                    <span className="value">{tip.header.difficulty}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Nonce:</span>
                    <span className="value">{tip.header.nonce.toLocaleString()}</span>
                  </div>
                  {tip.header.stateCommitment && (
                    <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                      <span className="label">State Commitment:</span>
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
                <h2>💼 Node Identity</h2>
                <div className="status-item">
                  <span className="label">Address:</span>
                  <span className="value" style={{ fontSize: "0.9rem", wordBreak: "break-all" }}>
                    {nodeAddress || "Loading..."}
                  </span>
                  {nodeAddress && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(nodeAddress);
                        setError("Address copied to clipboard!");
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
                      Copy
                    </button>
                  )}
                </div>
                <div className="status-item">
                  <span className="label">Node ID:</span>
                  <span className="value" style={{ fontSize: "0.8rem" }}>
                    {getOrCreateBrowserNodeId().substring(0, 16)}...
                  </span>
                </div>
                {/* Phase 7: Balance Display */}
                {nodeAddress && chainContext && (
                  <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                    <span className="label">IDC Balance:</span>
                    <span className="value" style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#667eea" }}>
                      {chainContext.indexState.getBalance(nodeAddress as any).toFixed(2)} IDC
                    </span>
                  </div>
                )}
              </div>
              
              {/* Phase 24: Multi-Wallet Manager */}
              <div className="status-card">
                <h2>💼 Wallet Manager (Phase 24)</h2>
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
                <h2>🔐 Backup & Recovery (Phase 23)</h2>
                <WalletBackupPanel
                  onExportSuccess={() => {
                    setError("✅ Wallet backup exported successfully! Save the file securely.");
                    setTimeout(() => setError(""), 5000);
                  }}
                  onImportSuccess={async () => {
                    // Reload address after import
                    const address = await getOrCreateNodeAddress();
                    setNodeAddress(address);
                    setError("✅ Wallet imported successfully! Your identity has been restored.");
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
              {/* Mining Controls */}
              <div className="status-card">
                <h2>⛏️ Mining Controls</h2>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
                  {!clusterMining && !isMining ? (
                    <>
                      <button
                        className="btn btn-primary"
                        onClick={handleStartMining}
                      >
                        Start Mining (Single Worker) {pendingTxs.length > 0 ? `(${pendingTxs.length} pending)` : "(coinbase only)"}
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
                        <span style={{ fontSize: "0.9rem" }}>Auto Mining</span>
                      </label>
                    </>
                  ) : clusterMining ? (
                    <>
                      <span style={{ fontSize: "0.9rem", color: "#666" }}>
                        Cluster mining active ({clusterStats.activeWorkers} workers)
                      </span>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-secondary" onClick={handleStopMining}>
                        Stop Mining
                      </button>
                      {autoMining && (
                        <span style={{ fontSize: "0.9rem", color: "#666" }}>
                          (Auto-mining enabled - will restart after block)
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Mining Status */}
              {(isMining || miningStats.hashesTried > 0) && (
                <div className="status-card">
                  <h2>📊 Mining Status</h2>
                  {/* Debug info - remove after fixing */}
                  <div style={{ fontSize: "0.7rem", color: "#999", marginBottom: "0.5rem" }}>
                    Debug: isMining={String(isMining)}, hashesTried={miningStats.hashesTried}, hash={miningHash.substring(0, 8)}..., nonce={miningNonce}
                  </div>
                  <div className="status-item">
                    <span className="label">Status:</span>
                    <span className="value">
                      {isMining ? "Mining..." : minerClient.getIsMining() ? "Mining..." : "Stopped"}
                    </span>
                  </div>
                  {tip && (
                    <div className="status-item">
                      <span className="label">Current Difficulty:</span>
                      <span className="value">
                        {tip.header.difficulty} (need {tip.header.difficulty} leading zeros)
                      </span>
                    </div>
                  )}
                  <div className="status-item">
                    <span className="label">Estimated Hashrate:</span>
                    <span className="value" style={{ fontWeight: "bold", color: "#667eea" }}>
                      {miningStats.hashRate
                        ? `${(miningStats.hashRate / 1000).toFixed(2)} K hash/s`
                        : "Calculating..."}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">Total Hashes Tried:</span>
                    <span className="value">{miningStats.hashesTried.toLocaleString()}</span>
                  </div>
                  {miningStats.elapsedTime > 0 && (
                    <div className="status-item">
                      <span className="label">Elapsed Time:</span>
                      <span className="value">{miningStats.elapsedTime.toFixed(1)}s</span>
                    </div>
                  )}
                  {isMining && (
                    <>
                      <div className="status-item">
                        <span className="label">Current Hash:</span>
                        <span className="value" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
                          {miningHash || "Computing..."}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">Current Nonce:</span>
                        <span className="value">{miningNonce.toLocaleString()}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Phase 18: Cluster Mining Control */}
              {chainContext && (
                <div className="status-card">
                  <h2>🔥 Cluster Mining (Phase 18)</h2>
                  <div className="status-item">
                    <span className="label">Mode:</span>
                    <span className="value">
                      {clusterMining ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>Active</span>
                      ) : (
                        <span style={{ color: "#666" }}>Inactive</span>
                      )}
                    </span>
                  </div>
                  {!clusterMining && (
                    <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <label>
                          Worker Count:
                          <input
                            type="range"
                            min="1"
                            max={typeof navigator !== "undefined" && "hardwareConcurrency" in navigator 
                              ? Math.max(1, (navigator.hardwareConcurrency || 4) * 2)
                              : 32}
                            value={clusterWorkerCount}
                            onChange={(e) => setClusterWorkerCount(parseInt(e.target.value))}
                            style={{ marginLeft: "0.5rem", width: "200px" }}
                          />
                          <span style={{ marginLeft: "0.5rem", fontWeight: "bold" }}>
                            {clusterWorkerCount}
                          </span>
                        </label>
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "#666" }}>
                        Optimal: {MinerCluster.getOptimalWorkerCount()} workers (CPU cores - 1)
                      </div>
                      <button
                        className="btn btn-primary"
                        onClick={handleStartClusterMining}
                        disabled={!chainContext || clusterMining}
                      >
                        Start Cluster Mining {pendingTxs.length > 0 ? `(${pendingTxs.length} pending)` : "(coinbase only)"}
                      </button>
                    </div>
                  )}
                  {clusterMining && (
                    <>
                      <div className="status-item">
                        <span className="label">Total Hashrate:</span>
                        <span className="value" style={{ fontWeight: "bold", color: "#667eea" }}>
                          {clusterStats.totalHashRate
                            ? `${(clusterStats.totalHashRate / 1000).toFixed(2)} K hash/s`
                            : "Calculating..."}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">Active Workers:</span>
                        <span className="value">
                          {clusterStats.activeWorkers} / {clusterStats.totalWorkers}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">Total Hashes Tried:</span>
                        <span className="value">{clusterStats.totalHashesTried.toString()}</span>
                      </div>
                      {clusterStats.workers.length > 0 && (
                        <div style={{ marginTop: "1rem" }}>
                          <strong>Worker Details:</strong>
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
                                  <strong>Worker #{worker.workerId}:</strong>{" "}
                                  <span style={{ color: worker.status === "running" ? "#28a745" : "#666" }}>
                                    {worker.status}
                                  </span>
                                </div>
                                <div>
                                  Hashrate: {worker.hashRate ? `${(worker.hashRate / 1000).toFixed(2)} K hash/s` : "—"}
                                </div>
                                <div>
                                  Nonce Range: {worker.currentNonceStart.toString()} -{" "}
                                  {worker.currentNonceEnd ? worker.currentNonceEnd.toString() : "∞"}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div style={{ marginTop: "1rem" }}>
                        <button
                          className="btn btn-secondary"
                          onClick={handleStopClusterMining}
                        >
                          Stop Cluster Mining
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Phase 19: Global Miner Pool */}
              {chainContext && isP2PConnected && (
                <div className="status-card">
                  <h2>🌐 Global Miner Pool (Phase 19)</h2>
                  <div className="status-item">
                    <span className="label">Mode:</span>
                    <span className="value">
                      {globalPoolEnabled ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>Enabled</span>
                      ) : (
                        <span style={{ color: "#666" }}>Disabled</span>
                      )}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">Role:</span>
                    <span className="value">
                      {isDelegator ? (
                        <span style={{ color: "#667eea", fontWeight: "bold" }}>Delegator</span>
                      ) : (
                        <span style={{ color: "#666" }}>Worker Node</span>
                      )}
                    </span>
                  </div>
                  {isDelegator && delegatorStats && (
                    <>
                      <div className="status-item">
                        <span className="label">Active Ranges:</span>
                        <span className="value">{delegatorStats.activeRanges}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">Total Nodes:</span>
                        <span className="value">{delegatorStats.totalNodes}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">Global Pointer:</span>
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
                        Enable Global Pool
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
                        Disable Global Pool
                      </button>
                    </div>
                  )}
                  <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
                    💡 <strong>Global Pool:</strong> All nodes coordinate nonce ranges to avoid duplicate work.
                    {isDelegator && " You are the delegator for this block."}
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
                <h2>💸 Transfer IDC</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div>
                    <input
                      type="text"
                      placeholder="Recipient Address (e.g., idc_...)"
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                      style={{ width: "100%", padding: "0.5rem" }}
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      placeholder="Amount (IDC)"
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      style={{ width: "100%", padding: "0.5rem" }}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      if (!chainContext || !transferTo || !transferAmount) {
                        setError("Please enter recipient address and amount");
                        return;
                      }
                      const amount = parseFloat(transferAmount);
                      if (isNaN(amount) || amount <= 0) {
                        setError("Amount must be a positive number");
                        return;
                      }
                      try {
                        setError("");
                        setIsSigning(true);
                        const tx = await createTransferTx(transferTo as any, amount);
                        const added = await mempool.addTx(tx);
                        if (!added) {
                          setError("Failed to add transfer transaction");
                          setIsSigning(false);
                          return;
                        }
                        broadcastTransaction(tx, chainContext);
                        setTransferTo("");
                        setTransferAmount("");
                        setChainContext({ ...chainContext });
                        setIsSigning(false);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to create transfer");
                        setIsSigning(false);
                      }
                    }}
                    disabled={isMining || isSigning || !transferTo || !transferAmount}
                  >
                    {isSigning ? "Signing..." : "Transfer IDC"}
                  </button>
                </div>
              </div>

              {/* Create Transaction Form */}
              <div className="status-card">
                <h2>📝 Create Transaction (Index Operations)</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div>
                    <label>
                      Operation Type:
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
                      placeholder="Namespace (e.g., test)"
                      value={txNamespace}
                      onChange={(e) => setTxNamespace(e.target.value)}
                      style={{ width: "100%", padding: "0.5rem" }}
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="Key"
                      value={txKey}
                      onChange={(e) => setTxKey(e.target.value)}
                      style={{ width: "100%", padding: "0.5rem" }}
                    />
                  </div>
                  {txOpType !== "DELETE" && (
                    <div>
                      <input
                        type="text"
                        placeholder="Value"
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
                    {isSigning ? "Signing..." : "Create Transaction"}
                  </button>
                  {isSigning && (
                    <p style={{ fontSize: "0.9rem", color: "#666", marginTop: "0.5rem" }}>
                      Signing transaction with your private key...
                    </p>
                  )}
                </div>
              </div>

              {/* Pending Transactions */}
              {pendingTxs.length > 0 && (
                <div className="status-card">
                  <h2>⏳ Pending Transactions ({pendingTxs.length})</h2>
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
                        <span>Mainnet Mode (自动连接主网)</span>
                      </label>
                    </div>
                    {/* Signaling Server URL Input */}
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        type="text"
                        placeholder={isMainnetMode ? "Mainnet Signaling Server (wss://...)" : "Local Signaling Server (ws://localhost:8080)"}
                        value={bootstrapUrl}
                        onChange={(e) => setBootstrapUrl(e.target.value)}
                        style={{ flex: 1, padding: "0.5rem" }}
                        disabled={isMainnetMode}
                      />
                      <button className="btn btn-primary" onClick={handleConnectP2P}>
                        Connect
                      </button>
                    </div>
                    {isMainnetMode && (
                      <div style={{ fontSize: "0.85rem", color: "#666", padding: "0.5rem", background: "#f0f0f0", borderRadius: "4px" }}>
                        💡 <strong>主网模式</strong>：将自动连接到公共 IndexerChain 主网，和全球用户一起挖矿。
                        <br />
                        如需本地测试，请取消勾选 "Mainnet Mode"。
                      </div>
                    )}
                    {!isMainnetMode && (
                      <div style={{ fontSize: "0.85rem", color: "#666", padding: "0.5rem", background: "#fff3cd", borderRadius: "4px" }}>
                        ⚠️ <strong>开发模式</strong>：连接到本地信令服务器，用于开发、测试或私有链。
                        <br />
                        需要先运行 <code>node signaling-server-example.js</code>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.9rem", color: "#666" }}>
                      Connected to: <code style={{ fontSize: "0.85rem" }}>{bootstrapUrl}</code>
                    </div>
                    <button className="btn btn-secondary" onClick={handleDisconnectP2P}>
                      Disconnect
                    </button>
                  </div>
                )}
                {peers.length > 0 && (
                  <div style={{ marginTop: "1rem" }}>
                    <strong>Connected Peers:</strong>
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
                  <h2>📡 Fast Relay Status</h2>
                  <div className="status-item">
                    <span className="label">Headers Cached:</span>
                    <span className="value">{relayStats.headersCached}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Missing Bodies:</span>
                    <span className="value" style={{ color: relayStats.missingBodies > 0 ? "#ffc107" : "#28a745" }}>
                      {relayStats.missingBodies}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">Pending Body Requests:</span>
                    <span className="value">{relayStats.pendingBodyRequests}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Received Bodies:</span>
                    <span className="value">{relayStats.receivedBodyCount}</span>
                  </div>
                  {relayStats.lastHeaderDelay !== null && (
                    <div className="status-item">
                      <span className="label">Last Header Delay:</span>
                      <span className="value" style={{ color: relayStats.lastHeaderDelay < 200 ? "#28a745" : "#ffc107" }}>
                        {relayStats.lastHeaderDelay} ms
                      </span>
                    </div>
                  )}
                  {relayStats.lastBodyDownloadTime !== null && (
                    <div className="status-item">
                      <span className="label">Last Body Download:</span>
                      <span className="value">{relayStats.lastBodyDownloadTime} ms</span>
                    </div>
                  )}
                </div>
              )}

              {/* Phase 20: Global Snapshot Network */}
              {chainContext && isP2PConnected && (
                <div className="status-card">
                  <h2>🌍 Global Snapshot Network (Phase 20)</h2>
                  <div className="status-item">
                    <span className="label">Status:</span>
                    <span className="value">
                      {gsnEnabled ? (
                        <span style={{ color: "#28a745", fontWeight: "bold" }}>Active</span>
                      ) : (
                        <span style={{ color: "#666" }}>Disabled</span>
                      )}
                    </span>
                  </div>
                  {gsnStats && (
                    <>
                      <div className="status-item">
                        <span className="label">Snapshot Sources:</span>
                        <span className="value">{gsnStats.downloader.totalSources}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">Avg Latency:</span>
                        <span className="value">{gsnStats.downloader.averageLatency.toFixed(0)} ms</span>
                      </div>
                      <div className="status-item">
                        <span className="label">Avg Integrity:</span>
                        <span className="value">{(gsnStats.downloader.averageIntegrity * 100).toFixed(1)}%</span>
                      </div>
                      <div className="status-item">
                        <span className="label">Cached Snapshots:</span>
                        <span className="value">{gsnStats.seeder.cachedCount}</span>
                      </div>
                      <div className="status-item">
                        <span className="label">Cache Size:</span>
                        <span className="value">{(gsnStats.seeder.totalSize / 1024).toFixed(2)} KB</span>
                      </div>
                    </>
                  )}
                  {snapshotDownloadProgress && (
                    <>
                      <div className="status-item" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #ddd" }}>
                        <span className="label">Download Progress:</span>
                        <span className="value">{snapshotDownloadProgress.percent.toFixed(1)}%</span>
                      </div>
                      <div className="status-item">
                        <span className="label">Chunks:</span>
                        <span className="value">
                          {snapshotDownloadProgress.receivedChunks} / {snapshotDownloadProgress.totalChunks}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">Speed:</span>
                        <span className="value">
                          {(snapshotDownloadProgress.speed / 1024).toFixed(2)} KB/s
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">Peers:</span>
                        <span className="value">{snapshotDownloadProgress.peers}</span>
                      </div>
                    </>
                  )}
                  <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
                    💡 <strong>GSN:</strong> All nodes automatically share snapshots via P2P.
                    {gsnEnabled && " You are seeding snapshots to other nodes."}
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
                    <h2>💾 State & Storage</h2>
                    <div className="status-item">
                      <span className="label">Last Snapshot Height:</span>
                      <span className="value">
                        {latestSnapshot ? latestSnapshot.height : "None"}
                      </span>
                    </div>
                    {latestSnapshot && (
                      <>
                        <div className="status-item">
                          <span className="label">Last Snapshot Time:</span>
                          <span className="value">
                            {new Date(latestSnapshot.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="status-item">
                          <span className="label">Blocks Since Snapshot:</span>
                          <span className="value">
                            {Math.max(0, height - latestSnapshot.height)}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="status-item">
                      <span className="label">Snapshot Count:</span>
                      <span className="value">{snapshotMetas.length}</span>
                    </div>
                    {/* Phase 12: Show snapshot type info */}
                    {latestSnapshot && (
                      <div className="status-item">
                        <span className="label">Latest Snapshot Type:</span>
                        <span className="value">
                          {(() => {
                            // Check if latest snapshot is full or delta
                            const latestSnapData = loadSnapshotByHeightSync(latestSnapshot.height);
                            if (latestSnapData) {
                              if (latestSnapData.full === false) {
                                return "Delta (Incremental)";
                              } else {
                                return "Full";
                              }
                            }
                            return "Unknown";
                          })()}
                        </span>
                      </div>
                    )}
                    {/* Phase 11: Compression info */}
                    {snapshotSizeInfo && (
                      <>
                        <div className="status-item">
                          <span className="label">Latest Snapshot Size:</span>
                          <span className="value">
                            {(snapshotSizeInfo.compressedSize / 1024).toFixed(2)} KB
                          </span>
                        </div>
                        {snapshotSizeInfo.compressionRatio > 0 && (
                          <div className="status-item">
                            <span className="label">Compression Ratio:</span>
                            <span className="value" style={{ color: "#28a745", fontWeight: "bold" }}>
                              {snapshotSizeInfo.compressionRatio.toFixed(1)}% reduction
                            </span>
                          </div>
                        )}
                        {snapshotSizeInfo.estimatedUncompressedSize > 0 && (
                          <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                            <span className="label">Estimated Uncompressed:</span>
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
                            <span className="label">State Hash:</span>
                            <span className="value" style={{ fontSize: "0.85rem", wordBreak: "break-all", fontFamily: "monospace" }}>
                              {latestSnapshot.stateHash.substring(0, 16)}...
                            </span>
                          </div>
                        )}
                        <div className="status-item">
                          <span className="label">Verification Status:</span>
                          <span className="value">
                            {latestSnapshot.verifiedAt ? (
                              <span style={{ color: "#28a745", fontWeight: "bold" }}>✅ Verified</span>
                            ) : latestSnapshot.stateHash ? (
                              <span style={{ color: "#ffc107", fontWeight: "bold" }}>⚠️ Not Verified Yet</span>
                            ) : (
                              <span style={{ color: "#666" }}>— No Hash</span>
                            )}
                          </span>
                        </div>
                        {latestSnapshot.verifiedAt && (
                          <div className="status-item" style={{ fontSize: "0.9rem", color: "#666" }}>
                            <span className="label">Last Verified:</span>
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
                            <span className="label">Commitment Match:</span>
                            <span className="value">
                              {latestSnapshot.stateCommitment === tip.header.stateCommitment ? (
                                <span style={{ color: "#28a745", fontWeight: "bold" }}>✅ Matches</span>
                              ) : (
                                <span style={{ color: "#dc3545", fontWeight: "bold" }}>❌ Mismatch</span>
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
                          <span className="label">Remote Snapshot:</span>
                          <span className="value">
                            {chainContext.remoteSnapshotUsed ? (
                              <span style={{ color: "#28a745", fontWeight: "bold" }}>✅ Used</span>
                            ) : chainContext.params.remoteSnapshotEnabled ? (
                              <span style={{ color: "#666" }}>Not Used</span>
                            ) : (
                              <span style={{ color: "#999" }}>Disabled</span>
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
                  <h2>🔒 Peer Reputation & Security (Phase 21)</h2>
                  <div className="status-item">
                    <span className="label">Total Peers Tracked:</span>
                    <span className="value">{peerScores.length}</span>
                  </div>
                  <div className="status-item">
                    <span className="label">Trusted:</span>
                    <span className="value" style={{ color: "#28a745" }}>
                      {peerScores.filter(p => p.trustLevel === "trusted").length}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">Normal:</span>
                    <span className="value" style={{ color: "#666" }}>
                      {peerScores.filter(p => p.trustLevel === "normal").length}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">Low Trust:</span>
                    <span className="value" style={{ color: "#ffc107" }}>
                      {peerScores.filter(p => p.trustLevel === "low").length}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="label">Banned:</span>
                    <span className="value" style={{ color: "#dc3545" }}>
                      {peerScores.filter(p => p.trustLevel === "banned").length}
                    </span>
                  </div>
                  {peerScores.length > 0 && (
                    <div style={{ marginTop: "1rem" }}>
                      <strong>Peer Details:</strong>
                      <div style={{ maxHeight: "300px", overflowY: "auto", marginTop: "0.5rem" }}>
                        <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ background: "#f0f0f0", position: "sticky", top: 0 }}>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>Peer ID</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>Score</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>Trust</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>Blocks</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>Snapshots</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>Latency</th>
                              <th style={{ padding: "0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>Work</th>
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
                    💡 <strong>Peer Reputation:</strong> Tracks peer behavior to prioritize reliable nodes and penalize misbehaving ones.
                  </div>
                </div>
              )}

              {/* Phase 22: Fast Finality Status */}
              {chainContext && chainContext.params.finalityEnabled && (
                <div className="status-card">
                  <h2>⚡ Fast Finality Status (Phase 22)</h2>
                  {finalityStats ? (
                    <>
                      <div className="status-item">
                        <span className="label">Status:</span>
                        <span className="value">
                          {finalityStats.committeeSize > 0 ? (
                            <span style={{ color: "#28a745", fontWeight: "bold" }}>Active</span>
                          ) : (
                            <span style={{ color: "#666" }}>Waiting for Committee</span>
                          )}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">Finalized Blocks:</span>
                        <span className="value" style={{ fontWeight: "bold" }}>
                          {finalityStats.finalizedCount}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">Pending Votes:</span>
                        <span className="value">
                          {finalityStats.pendingVotes}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">Committee Round:</span>
                        <span className="value">
                          {finalityStats.currentRound >= 0 ? finalityStats.currentRound : "—"}
                        </span>
                      </div>
                      <div className="status-item">
                        <span className="label">Committee Size:</span>
                        <span className="value">
                          {finalityStats.committeeSize} members
                        </span>
                      </div>
                      {tip && (
                        <div className="status-item" style={{ marginTop: "0.5rem" }}>
                          <span className="label">Current Block Finality:</span>
                          <span className="value">
                            {finalizedBlocks.has(tip.hash) ? (
                              <span style={{ color: "#28a745", fontWeight: "bold" }}>✅ Finalized</span>
                            ) : finalityStats.pendingVotes > 0 ? (
                              <span style={{ color: "#ffc107" }}>⏳ Pending ({finalityStats.pendingVotes} votes)</span>
                            ) : (
                              <span style={{ color: "#dc3545" }}>❌ Unconfirmed</span>
                            )}
                          </span>
                        </div>
                      )}
                      {finalityManager && (
                        <div style={{ marginTop: "1rem" }}>
                          <strong>Current Committee:</strong>
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
                                    <strong>Member #{idx + 1}:</strong> {member.address.substring(0, 20)}...
                                  </div>
                                  <div>
                                    Score: {member.score.toFixed(1)} / 100
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div style={{ padding: "0.5rem", color: "#666", fontSize: "0.85rem" }}>
                                No committee elected yet
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: "#666", fontSize: "0.9rem" }}>
                      Finality manager not initialized. Connect to P2P network to enable finality.
                    </div>
                  )}
                  <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
                    💡 <strong>Fast Finality:</strong> Blocks reach finality (irreversibility) within 300-800ms through committee voting. 
                    Committee members are elected based on peer reputation scores.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Other tabs placeholder - to be implemented */}
          {activeTab !== "overview" && activeTab !== "wallet" && activeTab !== "mining" && activeTab !== "transactions" && activeTab !== "network" && activeTab !== "storage" && activeTab !== "advanced" && (
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
