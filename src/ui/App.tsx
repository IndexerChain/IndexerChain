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
import { buildCandidateBlock } from "../core/blockBuilder.js";
import { MinerClient } from "../core/minerClient.js";
import { BrowserP2PNode } from "../core/p2p.js";
import { handleReceivedBlock, handleReceivedBlocks } from "../core/sync.js";
import { verifyTxSignature } from "../core/signatures.js";
import { verifyBlock } from "../core/verify.js";
import {
  getAverageBlockTime,
  getBlocksUntilAdjustment,
  explainDifficultyChange,
} from "../core/difficulty.js";
import type { Operation, Block, Tx } from "../core/types.js";
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
  const [bootstrapUrl, setBootstrapUrl] = useState<string>("");
  const [peerCount, setPeerCount] = useState<number>(0);
  const [isP2PConnected, setIsP2PConnected] = useState<boolean>(false);
  const [nodeAddress, setNodeAddress] = useState<string>("");
  const [isSigning, setIsSigning] = useState<boolean>(false);
  
  // Phase 7: Transfer form state
  const [transferTo, setTransferTo] = useState<string>("");
  const [transferAmount, setTransferAmount] = useState<string>("");

  // Phase 8: Miner client and stats
  const [minerClient] = useState(() => new MinerClient());
  const [miningStats, setMiningStats] = useState<{
    hashesTried: number;
    hashRate: number | null;
    elapsedTime: number;
  }>({
    hashesTried: 0,
    hashRate: null,
    elapsedTime: 0,
  });

  // Form state for creating transactions
  const [txNamespace, setTxNamespace] = useState<string>("test");
  const [txKey, setTxKey] = useState<string>("");
  const [txValue, setTxValue] = useState<string>("");
  const [txOpType, setTxOpType] = useState<"PUT" | "APPEND" | "DELETE">("PUT");

  const p2pNodeRef = useRef<BrowserP2PNode | null>(null);

  const [needsReset, setNeedsReset] = useState<boolean>(false);

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
        
        setLoading(false);
      } catch (error) {
        console.error("Failed to initialize chain:", error);
        setError("Failed to initialize chain");
        setLoading(false);
      }
    };

    initialize();

    // Phase 8: Cleanup miner client on unmount
    return () => {
      minerClient.destroy();
    };
  }, []);

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

    // Handle NEW_BLOCK messages
    p2p.onMessage("NEW_BLOCK", async (block: Block, sender: string) => {
      console.log("Received NEW_BLOCK from", sender, "height:", block.header.height);
      const result = await handleReceivedBlock(block, chainContext, p2p);
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
    p2p.onMessage("BLOCKS", async (data: { blocks: Block[] }, sender: string) => {
      console.log("Received BLOCKS from", sender, "count:", data.blocks.length);
      const result = await handleReceivedBlocks(data.blocks, chainContext);
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

      // Update chain context with P2P node
      const updatedContext = { ...chainContext, p2p: p2pNode };
      setChainContext(updatedContext);
      setIsP2PConnected(true);
      setError(""); // Clear any previous errors
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

  // Phase 8: Start mining using Worker
  const handleStartMining = async () => {
    if (!chainContext) return;
    if (mempool.isEmpty()) {
      setError("No pending transactions to mine");
      return;
    }

    try {
      const pendingTxs = mempool.getAll();
      const prevBlock = chainContext.storage.getTip();
      if (!prevBlock) {
        setError("No previous block found");
        return;
      }

      // Phase 7: Get miner address for coinbase reward
      const minerAddr = await getOrCreateNodeAddress();

      // Phase 8: Build candidate block
      const allBlocks = chainContext.storage.getAllBlocks();
      const candidateBlock = await buildCandidateBlock(
        pendingTxs,
        prevBlock,
        allBlocks,
        chainContext.params,
        minerAddr as any
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
          setMiningHash(event.hash);
          setMiningNonce(event.nonce);
          const elapsed = (Date.now() - event.startedAt) / 1000;
          const hashRate = elapsed > 0 ? event.hashesTried / elapsed : null;
          setMiningStats({
            hashesTried: event.hashesTried,
            hashRate,
            elapsedTime: elapsed,
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
        },
        onStopped: (event) => {
          setIsMining(false);
          if (event.reason === "error") {
            setError(event.errorMessage || "Mining error occurred");
          } else if (event.reason === "user") {
            setError("Mining was stopped");
          }
          // "replaced" reason means we're restarting, don't show error
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start mining");
      setIsMining(false);
    }
  };

  // Phase 8: Stop mining
  const handleStopMining = () => {
    minerClient.stopMining("user");
    setIsMining(false);
  };

  // Phase 8: Auto-restart mining when tip changes
  useEffect(() => {
    if (!chainContext || !isMining) return;

    const tip = chainContext.storage.getTip();
    let lastHeight = tip?.header.height ?? 0;

    // Check if tip changed (new block received)
    const checkTip = () => {
      const newTip = chainContext.storage.getTip();
      const newHeight = newTip?.header.height ?? 0;
      if (newHeight > lastHeight) {
        // Tip changed, restart mining
        lastHeight = newHeight;
        minerClient.stopMining("replaced");
        // Restart after a short delay
        setTimeout(() => {
          if (mempool.getAll().length > 0 && chainContext) {
            handleStartMining();
          }
        }, 500);
      }
    };

    const interval = setInterval(checkTip, 1000); // Check every second
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainContext, isMining]);

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
        <h1>Browser Index Chain</h1>
        <p className="subtitle">Phase 8: Web Worker Mining & Performance</p>
      </header>

      <main className="app-main">
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
          <div
            className="error-message"
            style={{
              color: "red",
              marginBottom: "1rem",
              padding: "1rem",
              background: "#ffe6e6",
              borderRadius: "4px",
              border: "1px solid #ff9999",
              whiteSpace: "pre-line",
            }}
          >
            <strong>Error:</strong>
            <br />
            {error}
          </div>
        )}

        {/* Node Identity Section - Phase 5 */}
        <div className="status-card">
          <h2>Node Identity</h2>
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

        {/* P2P Network Section */}
        <div className="status-card">
          <h2>P2P Network</h2>
          <div className="status-item">
            <span className="label">Status:</span>
            <span className="value">{isP2PConnected ? "Connected" : "Disconnected"}</span>
          </div>
          <div className="status-item">
            <span className="label">Peers:</span>
            <span className="value">{peerCount}</span>
          </div>
          {!isP2PConnected ? (
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                placeholder="Bootstrap Server URL (e.g., ws://localhost:8080)"
                value={bootstrapUrl}
                onChange={(e) => setBootstrapUrl(e.target.value)}
                style={{ flex: 1, padding: "0.5rem" }}
              />
              <button className="btn btn-primary" onClick={handleConnectP2P}>
                Connect
              </button>
            </div>
          ) : (
            <div style={{ marginTop: "1rem" }}>
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

        <div className="status-card">
          <h2>Chain Status</h2>
          <div className="status-item">
            <span className="label">Current Height:</span>
            <span className="value">{height}</span>
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
            <span className="value">{isMining ? "Active" : "Inactive"}</span>
          </div>
        </div>

        {/* Phase 6: Difficulty Information */}
        {tip && (
          <div className="status-card">
            <h2>Difficulty Status</h2>
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

        {/* Phase 7: Transfer Form */}
        <div className="status-card">
          <h2>Transfer IDC</h2>
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
          <h2>Create Transaction (Index Operations)</h2>
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
            <h2>Pending Transactions ({pendingTxs.length})</h2>
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

        {/* Phase 8: Mining Status with Performance Stats */}
        {(isMining || miningStats.hashesTried > 0) && (
          <div className="status-card">
            <h2>Mining Status</h2>
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

        {/* Latest Block */}
        {tip && (
          <div className="status-card">
            <h2>Latest Block</h2>
            <div className="status-item">
              <span className="label">Hash:</span>
              <span className="value" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
                {tip.hash.substring(0, 32)}...
              </span>
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
          </div>
        )}

        {/* Actions */}
        <div className="actions">
          {!isMining ? (
            <button
              className="btn btn-primary"
              onClick={handleStartMining}
              disabled={mempool.isEmpty()}
            >
              Start Mining ({pendingTxs.length} pending)
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={handleStopMining}>
              Stop Mining
            </button>
          )}
        </div>

        {/* Info */}
        <div className="info">
          <p>
            <strong>Phase 8 Complete:</strong> Web Worker mining and performance monitoring implemented.
            Mining now runs in a background worker, keeping the UI responsive while showing real-time
            hash rate and mining statistics.
          </p>
          <p>
            The miner automatically restarts when new blocks are received. You can see your node's
            estimated hash rate, total hashes tried, and elapsed time in the Mining Status section.
          </p>
          <p>
            <strong>⚠️ Important:</strong> Before connecting, you must start the signaling server:
          </p>
          <div style={{ background: "#f0f0f0", padding: "1rem", borderRadius: "4px", marginTop: "0.5rem" }}>
            <code style={{ display: "block", marginBottom: "0.5rem" }}>
              # Install dependencies (if needed)
            </code>
            <code style={{ display: "block", marginBottom: "0.5rem" }}>
              npm install ws
            </code>
            <code style={{ display: "block", marginBottom: "0.5rem" }}>
              # Start the server
            </code>
            <code style={{ display: "block" }}>
              node signaling-server-example.js
            </code>
            <p style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
              Or use: <code>./start-server.sh</code> (Mac/Linux) or <code>start-server.bat</code> (Windows)
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
