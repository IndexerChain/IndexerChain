import { useState, useEffect, useRef } from "react";
import {
  initChain,
  getDefaultChainParams,
  appendMinedBlock,
  broadcastTransaction,
  type ChainContext,
} from "../core/chain.js";
import { Mempool } from "../core/mempool.js";
import { createTx, getOrCreateBrowserNodeId } from "../core/tx.js";
import { mineBlockWithCancel, MiningCancelledError } from "../core/miner.js";
import { BrowserP2PNode } from "../core/p2p.js";
import { handleReceivedBlock, handleReceivedBlocks } from "../core/sync.js";
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

  // Form state for creating transactions
  const [txNamespace, setTxNamespace] = useState<string>("test");
  const [txKey, setTxKey] = useState<string>("");
  const [txValue, setTxValue] = useState<string>("");
  const [txOpType, setTxOpType] = useState<"PUT" | "APPEND" | "DELETE">("PUT");

  const miningCancelledRef = useRef(false);
  const p2pNodeRef = useRef<BrowserP2PNode | null>(null);

  // Initialize chain on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        const params = getDefaultChainParams();
        const context = await initChain(params);
        setChainContext(context);
        setLoading(false);
      } catch (error) {
        console.error("Failed to initialize chain:", error);
        setError("Failed to initialize chain");
        setLoading(false);
      }
    };

    initialize();
  }, []);

  // Setup P2P message handlers
  useEffect(() => {
    if (!chainContext || !chainContext.p2p) return;

    const p2p = chainContext.p2p;

    // Handle NEW_TX messages
    p2p.onMessage("NEW_TX", (tx: Tx, sender: string) => {
      console.log("Received NEW_TX from", sender);
      // Add to mempool if not already present
      if (!mempool.getAll().some((t) => t.txId === tx.txId)) {
        mempool.addTx(tx);
        setChainContext({ ...chainContext }); // Trigger re-render
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
      setError("Please enter a bootstrap server URL");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to P2P network");
      setIsP2PConnected(false);
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
      const owner = getOrCreateBrowserNodeId();

      const op: Operation = {
        type: txOpType,
        namespace: txNamespace,
        key: txKey,
        value: txOpType !== "DELETE" ? txValue : undefined,
        nonce: Date.now(),
        owner,
      };

      const tx = await createTx(owner, [op]);
      mempool.addTx(tx);

      // Broadcast to P2P network
      broadcastTransaction(tx, chainContext);

      // Clear form
      setTxKey("");
      setTxValue("");

      // Force re-render
      setChainContext({ ...chainContext });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create transaction");
    }
  };

  // Start mining
  const handleStartMining = async () => {
    if (!chainContext) return;
    if (mempool.isEmpty()) {
      setError("No pending transactions to mine");
      return;
    }

    setIsMining(true);
    setError("");
    miningCancelledRef.current = false;
    setMiningHash("");
    setMiningNonce(0);

    try {
      const pendingTxs = mempool.getAll();

      const block = await mineBlockWithCancel(
        pendingTxs,
        chainContext,
        () => miningCancelledRef.current,
        (hash, nonce) => {
          setMiningHash(hash);
          setMiningNonce(nonce);
        }
      );

      // Append mined block (this will also broadcast to P2P)
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
    } catch (err) {
      if (err instanceof MiningCancelledError) {
        setError("Mining was cancelled");
      } else {
        setError(err instanceof Error ? err.message : "Mining failed");
      }
    } finally {
      setIsMining(false);
      setMiningHash("");
      setMiningNonce(0);
    }
  };

  // Stop mining
  const handleStopMining = () => {
    miningCancelledRef.current = true;
    setIsMining(false);
  };

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
        <p className="subtitle">Phase 4: P2P Networking</p>
      </header>

      <main className="app-main">
        {error && (
          <div className="error-message" style={{ color: "red", marginBottom: "1rem" }}>
            {error}
          </div>
        )}

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
          <div className="status-item">
            <span className="label">Node ID:</span>
            <span className="value" style={{ fontSize: "0.8rem" }}>
              {getOrCreateBrowserNodeId().substring(0, 16)}...
            </span>
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

        {/* Create Transaction Form */}
        <div className="status-card">
          <h2>Create Transaction</h2>
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
              disabled={isMining}
            >
              Create Transaction
            </button>
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
                    <strong>Ops:</strong> {tx.ops.length}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mining Status */}
        {isMining && (
          <div className="status-card">
            <h2>Mining...</h2>
            <div className="status-item">
              <span className="label">Current Hash:</span>
              <span className="value" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
                {miningHash || "Computing..."}
              </span>
            </div>
            <div className="status-item">
              <span className="label">Nonce:</span>
              <span className="value">{miningNonce.toLocaleString()}</span>
            </div>
            <div className="status-item">
              <span className="label">Difficulty:</span>
              <span className="value">
                {chainContext.params.initialDifficulty} (need{" "}
                {chainContext.params.initialDifficulty} leading zeros)
              </span>
            </div>
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
            <strong>Phase 4 Complete:</strong> P2P networking, block broadcasting, and chain
            synchronization are implemented.
          </p>
          <p>
            Connect to a bootstrap server to join the network. Transactions and blocks are
            automatically broadcast to all peers.
          </p>
          <p>
            <strong>Note:</strong> You need to run a WebSocket signaling server. See README for
            details.
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;
