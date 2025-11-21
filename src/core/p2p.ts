/**
 * P2P Network Layer
 * 
 * Implements peer-to-peer networking using WebSocket (signaling) and WebRTC (data channels)
 * 
 * Features:
 * - WebSocket signaling server connection
 * - WebRTC peer-to-peer data channels
 * - Message broadcasting (NEW_TX, NEW_BLOCK, REQUEST_BLOCKS, BLOCKS)
 * - Automatic chain synchronization
 */

import { logger } from "./logger.js";
import { ConnectionManager, type ConnectionConfig } from "./connectionManager.js";

// Types imported as needed

/**
 * P2P message types
 * 
 * Phase 17: Added fast block relay messages
 * Phase 19: Added distributed miner pool messages
 */
export type P2PMessageType =
  | "NEW_TX"
  | "NEW_BLOCK"
  | "NEW_BLOCK_HEADER" // Phase 17: Fast header broadcast
  | "REQUEST_BLOCKS"
  | "REQUEST_BLOCK_BODY" // Phase 17: Request block body by hash
  | "BLOCKS"
  | "BLOCK_BODY" // Phase 17: Block body response
  | "PING"
  | "PONG"
  // Phase 19: Distributed miner pool messages
  | "WORKER_INFO" // Worker capability information
  | "REQUEST_NONCE_RANGE" // Request nonce range from delegator
  | "NONCE_RANGE" // Allocated nonce range response
  | "WORKER_PROGRESS" // Worker progress report
  | "NONCE_RANGE_EXHAUSTED" // Worker exhausted its range
  | "DELEGATOR_ANNOUNCE" // Delegator announcement
  | "DELEGATOR_HEARTBEAT" // Delegator heartbeat
  // Phase 20: Global Snapshot Network messages
  | "REQUEST_SNAPSHOT_META" // Request snapshot metadata list
  | "SNAPSHOT_META" // Response with snapshot metadata
  | "REQUEST_SNAPSHOT" // Request specific snapshot download
  | "SNAPSHOT_CHUNK" // Snapshot data chunk
  | "SNAPSHOT_DONE" // Snapshot download complete
  | "GOSSIP_SNAPSHOT_META" // Gossip snapshot metadata
  // Phase 22: Fast Finality Layer messages
  | "REQUEST_FINALITY" // Request finality certificate for a block
  | "FINALITY_VOTE" // Finality vote from committee member
  | "FINALITY_CERT" // Finality certificate (>= 2/3 votes)
  // Phase 30: Global Consistency Sentinel messages
  | "GLOBAL_VIEW_REQUEST" // Request peer's global view (height, tipHash, finalizedHeight)
  | "GLOBAL_VIEW_RESPONSE" // Response with peer's global view
  // Phase 30: Mainnet Guardrails - Network handshake
  | "NETWORK_HANDSHAKE" // Network parameters handshake (networkId, genesisHash, chainParamsHash)
  | "NETWORK_HANDSHAKE_RESPONSE" // Response to network handshake
  // Phase 31: Mainnet Stability - Long-range detection and height consensus
  | "CHECKPOINT_REQUEST" // Request checkpoint state commitment at specific height
  | "CHECKPOINT_RESPONSE" // Response with checkpoint state commitment
  | "HEIGHT_VOTE" // Broadcast height vote for consensus
  // Phase 48: Signal bootstrap blocks over WebSocket (bypass CORS)
  | "BOOTSTRAP_BLOCKS"
  // Phase 32: Bootstrap Sync Protocol
  | "REQUEST_BOOTSTRAP" // Request bootstrap data (latest height, header, snapshot meta)
  | "BOOTSTRAP_RESPONSE" // Response with bootstrap data
  | "ROOT_TIP_UPDATE" // Root node broadcasts latest tip update
  // Phase 36: State Commit Gossip
  | "STATE_COMMIT_GOSSIP"
  // Phase 46+: P2P RootTip Gossip (decentralized rootTip propagation)
  | "ROOT_TIP_GOSSIP";

/**
 * P2P message structure
 */
export interface P2PMessage {
  type: P2PMessageType;
  data: any;
  sender: string; // Node ID
  timestamp: number;
  messageId?: string; // For deduplication
}

/**
 * Peer connection state
 */
export interface PeerInfo {
  id: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  connected: boolean;
  lastSeen: number;
  // Phase 30: Network validation
  networkValidated?: boolean;
  networkId?: string;
  genesisHash?: string;
  chainParamsHash?: string;
  // Phase 33: IP hash for quorum scoring (privacy-preserving)
  ipHash?: string;
}

/**
 * P2P Node interface
 */
export interface P2PNode {
  nodeId: string;
  peers: Map<string, PeerInfo>;
  isConnected: boolean;
  connect(bootstrapUrl: string): Promise<void>;
  disconnect(): void;
  broadcast(type: P2PMessageType, payload: any): void;
  sendToPeer?(peerId: string, type: P2PMessageType, payload: any): void; // Phase 30: Optional method for direct peer messaging
  onMessage(type: P2PMessageType, handler: (payload: any, sender: string) => void): void;
  getPeerCount(): number;
  requestPeers(): void; // Request peers from signaling server
}

/**
 * P2P Node implementation
 */
export class BrowserP2PNode implements P2PNode {
  public nodeId: string;
  public peers: Map<string, PeerInfo> = new Map();
  public isConnected: boolean = false;

  private ws: WebSocket | null = null;
  private messageHandlers: Map<P2PMessageType, Set<(payload: any, sender: string) => void>> =
    new Map();
  private seenMessages: Set<string> = new Set();
  private readonly MESSAGE_TTL = 60000; // 1 minute
  private connectionManager: ConnectionManager | null = null;
  private currentBootstrapUrl: string | null = null;
  private isManualDisconnect: boolean = false; // Track if disconnect was intentional
  private signalServers: string[] = []; // Phase 45: Multiple signal servers
  private currentSignalServerIndex: number = -1; // Phase 45: Current signal server index

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    // Phase 45: Load cached peers from localStorage
    this.loadCachedPeers();
  }

  /**
   * Phase 45: Connect to a single signal server (internal method)
   */
  private async connectToSingleServer(bootstrapUrl: string): Promise<void> {
    if (this.isConnected) {
      logger.warn("Already connected to P2P network");
      return;
    }

    // Phase 40: Save bootstrap URL for auto-reconnect
    this.currentBootstrapUrl = bootstrapUrl;
    this.isManualDisconnect = false;

    return new Promise((resolve, reject) => {
      try {
        // Validate URL
        if (!bootstrapUrl || (!bootstrapUrl.startsWith("ws://") && !bootstrapUrl.startsWith("wss://"))) {
          reject(new Error("Invalid WebSocket URL. Must start with ws:// or wss://"));
          return;
        }

        this.ws = new WebSocket(bootstrapUrl);

        // Set connection timeout (10 seconds)
        const timeout = setTimeout(() => {
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            this.ws.close();
            reject(
              new Error(
                `Connection timeout. Please check:\n1. Is the signaling server running?\n2. Is the URL correct? (${bootstrapUrl})\n3. Check firewall/network settings.`
              )
            );
          }
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          const connectLog = `[P2P] ✅ Connected to signaling server: ${bootstrapUrl}`;
          logger.info(connectLog);
          this.isConnected = true;

          // Send join message
          const joinLog = `[P2P] 📤 Sending JOIN message: nodeId=${this.nodeId.substring(0, 16)}...`;
          logger.info(joinLog);
          this.sendSignalingMessage({
            type: "join",
            nodeId: this.nodeId,
          });

          // Request peers immediately after joining
          // Some signal servers may not automatically send peer list
          setTimeout(() => {
            this.requestPeers();
            logger.debug("[P2P] Requested peers from signaling server");
          }, 500); // Small delay to ensure join message is processed

          // Process queued messages
          this.processMessageQueue();

          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            const msgLog = `[P2P] 📨 Received signaling message: type=${message.type}`;
            logger.info(msgLog);
            logger.debug(`[P2P] Received signaling message:`, message.type, message);
            
            // Phase 32: Check if this is a BOOTSTRAP_RESPONSE and handle it directly
            if (message.type === 'BOOTSTRAP_RESPONSE') {
              logger.info(`[Phase 32] 📦 Direct handling of BOOTSTRAP_RESPONSE from WebSocket`);
              this.handleSignalingMessage(message);
            } else {
              this.handleSignalingMessage(message);
            }
          } catch (error) {
            logger.error("Failed to parse signaling message:", error);
          }
        };

        this.ws.onerror = (error) => {
          clearTimeout(timeout);
          logger.error("WebSocket error:", error);
          const errorMessage =
            this.ws?.readyState === WebSocket.CONNECTING
              ? `Failed to connect to signaling server at ${bootstrapUrl}.\n\nPlease ensure:\n1. The signaling server is running\n2. The URL is correct\n3. Check the server logs for errors`
              : "WebSocket connection error occurred";
          reject(new Error(errorMessage));
        };

        this.ws.onclose = (event) => {
          clearTimeout(timeout);
          logger.debug("Disconnected from signaling server", event.code, event.reason);
          this.isConnected = false;
          this.ws = null;

          // Phase 40: Auto-reconnect if not manual disconnect
          // Phase 45: Try next signal server if available
          if (!this.isManualDisconnect) {
            if (this.signalServers.length > 0 && this.currentSignalServerIndex >= 0) {
              // Try next signal server
              const nextIndex = (this.currentSignalServerIndex + 1) % this.signalServers.length;
              if (nextIndex !== this.currentSignalServerIndex) {
                logger.info(`[Phase 45] Connection closed, trying next signal server (${nextIndex + 1}/${this.signalServers.length})...`);
                setTimeout(async () => {
                  try {
                    await this.connectWithMultipleServers(this.signalServers);
                  } catch (error) {
                    logger.error(`[Phase 45] Failed to reconnect to any signal server:`, error);
                    if (this.connectionManager) {
                      this.connectionManager.startReconnect();
                    }
                  }
                }, 1000);
                return;
              }
            }
            
            if (this.currentBootstrapUrl) {
              logger.info("[P2P] Connection closed unexpectedly, will attempt auto-reconnect...");
              if (this.connectionManager) {
                this.connectionManager.startReconnect();
              }
            }
          }

          // If connection was closed unexpectedly (not by us), reject the promise
          if (event.code !== 1000 && event.code !== 1001) {
            // 1000 = normal closure, 1001 = going away
            // Other codes indicate an error
            // 1006 = abnormal closure (server not running, network error, etc.)
            if (!this.isConnected && !this.isManualDisconnect) {
              // Only reject if we're not already connected (i.e., during initial connection)
              // But don't reject if we have auto-reconnect enabled
              if (!this.connectionManager) {
                let errorMsg = `Connection failed (code: ${event.code}).\n\n`;
                
                if (event.code === 1006) {
                  errorMsg += `⚠️ Code 1006: Abnormal closure - The server is likely not running.\n\n`;
                  errorMsg += `📋 To fix this:\n`;
                  errorMsg += `1. Open a terminal/command prompt\n`;
                  errorMsg += `2. Navigate to the project directory\n`;
                  errorMsg += `3. Run: npm install ws\n`;
                  errorMsg += `4. Run: node signaling-server-example.js\n`;
                  errorMsg += `5. Wait for "Signaling server started on ws://localhost:8080"\n`;
                  errorMsg += `6. Then click Connect again\n\n`;
                  errorMsg += `💡 Quick start: Use ./start-server.sh (Mac/Linux) or start-server.bat (Windows)`;
                } else {
                  errorMsg += `Possible causes:\n`;
                  errorMsg += `1. Signaling server is not running\n`;
                  errorMsg += `2. Network connectivity issues\n`;
                  errorMsg += `3. Server rejected the connection\n`;
                  errorMsg += `4. Firewall blocking the connection`;
                }
                
                reject(new Error(errorMsg));
              }
            }
          }
        };
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("Failed to create WebSocket connection")
        );
      }
    });
  }

  /**
   * Phase 45: Connect to multiple signal servers with fallback
   */
  async connectWithMultipleServers(signalServers: string[]): Promise<void> {
    if (this.isConnected) {
      logger.warn("Already connected to P2P network");
      return;
    }

    if (!signalServers || signalServers.length === 0) {
      throw new Error("No signal servers provided");
    }

    this.signalServers = [...signalServers];
    
    // Phase 45: Try cached peers first (P2P bootstrap)
    const cachedPeers = this.getCachedPeers();
    if (cachedPeers.length > 0) {
      logger.info(`[Phase 45] Found ${cachedPeers.length} cached peers, attempting direct P2P connection...`);
      // Try to connect to cached peers directly (this would require WebRTC offer/answer exchange)
      // For now, we'll still use signal server but prioritize cached peers
    }

    // Phase 45: Randomly select initial signal server
    const shuffled = [...signalServers].sort(() => Math.random() - 0.5);
    
    let lastError: Error | null = null;
    for (let i = 0; i < shuffled.length; i++) {
      const url = shuffled[i];
      this.currentSignalServerIndex = signalServers.indexOf(url);
      
      try {
        logger.info(`[Phase 45] Attempting to connect to signal server ${i + 1}/${shuffled.length}: ${url}`);
        await this.connectToSingleServer(url);
        logger.info(`[Phase 45] Successfully connected to signal server: ${url}`);
        this.currentBootstrapUrl = url;
        return;
      } catch (error) {
        logger.warn(`[Phase 45] Failed to connect to ${url}:`, error);
        lastError = error instanceof Error ? error : new Error(String(error));
        // Continue to next server
      }
    }

    // All servers failed
    throw new Error(
      `Failed to connect to any signal server. Tried ${shuffled.length} server(s). Last error: ${lastError?.message || "Unknown error"}`
    );
  }

  /**
   * Connect to bootstrap server (WebSocket signaling server)
   * Phase 45: Enhanced to support single URL or multiple URLs
   */
  async connect(bootstrapUrl: string | string[]): Promise<void> {
    if (this.isConnected) {
      logger.warn("Already connected to P2P network");
      return;
    }

    // Phase 45: Handle multiple signal servers
    if (Array.isArray(bootstrapUrl)) {
      return this.connectWithMultipleServers(bootstrapUrl);
    }

    // Single URL - use internal method
    return this.connectToSingleServer(bootstrapUrl);
  }

  /**
   * Phase 40: Setup connection manager for auto-reconnect
   */
  setupConnectionManager(config: ConnectionConfig): void {
    this.connectionManager = new ConnectionManager(config);
    
    // Setup auto-reconnect
    this.connectionManager.setupAutoReconnect(
      async () => {
        if (this.currentBootstrapUrl) {
          await this.connect(this.currentBootstrapUrl);
        }
      },
      async () => {
        // On reconnect success, restore peer connections
        logger.info("[P2P] Reconnected, restoring peer connections...");
        this.requestPeers();
      }
    );
  }

  /**
   * Disconnect from P2P network
   */
  disconnect(): void {
    this.isManualDisconnect = true;
    
    // Stop auto-reconnect
    if (this.connectionManager) {
      this.connectionManager.stopReconnect();
      this.connectionManager.clearAllHeartbeats();
    }
    
    // Close all peer connections
    for (const peer of this.peers.values()) {
      if (peer.dataChannel) {
        // Phase 38: Remove error handler before closing to avoid false error logs
        // The onerror handler will still fire, but we check for normal close operations
        try {
          peer.dataChannel.close();
        } catch (error) {
          // Ignore errors when closing (channel might already be closed)
          logger.debug(`[P2P] Data channel already closed for peer ${peer.id.substring(0, 16)}...`);
        }
      }
      try {
        peer.connection.close();
      } catch (error) {
        // Ignore errors when closing (connection might already be closed)
        logger.debug(`[P2P] Connection already closed for peer ${peer.id.substring(0, 16)}...`);
      }
    }
    this.peers.clear();

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  /**
   * Broadcast message to all peers
   */
  broadcast(type: P2PMessageType, payload: any): void {
    const message: P2PMessage = {
      type,
      data: payload,
      sender: this.nodeId,
      timestamp: Date.now(),
      messageId: `${this.nodeId}_${Date.now()}_${Math.random()}`,
    };

    // Don't broadcast to self
    // Send to all connected peers
    for (const peer of this.peers.values()) {
      if (peer.connected && peer.dataChannel && peer.dataChannel.readyState === "open") {
        try {
          peer.dataChannel.send(JSON.stringify(message));
        } catch (error) {
          logger.error(`Failed to send message to peer ${peer.id}:`, error);
        }
      }
    }
  }

  /**
   * Phase 30: Send message to a specific peer
   */
  sendToPeer(peerId: string, type: P2PMessageType, payload: any): void {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.connected || !peer.dataChannel || peer.dataChannel.readyState !== "open") {
      logger.warn(`[P2P] Cannot send message to peer ${peerId}: peer not connected`);
      return;
    }

    const message: P2PMessage = {
      type,
      data: payload,
      sender: this.nodeId,
      timestamp: Date.now(),
      messageId: `${this.nodeId}_${Date.now()}_${Math.random()}`,
    };

    try {
      peer.dataChannel.send(JSON.stringify(message));
    } catch (error) {
      logger.error(`Failed to send message to peer ${peerId}:`, error);
    }
  }

  /**
   * Register message handler
   */
  onMessage(
    type: P2PMessageType,
    handler: (payload: any, sender: string) => void
  ): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);
  }

  /**
   * Get number of connected peers
   */
  getPeerCount(): number {
    return Array.from(this.peers.values()).filter((p) => p.connected).length;
  }

  /**
   * Send signaling message (WebSocket)
   */
  private sendSignalingMessage(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      logger.debug(`[P2P] Sending signaling message:`, message.type, message);
      this.ws.send(JSON.stringify(message));
    } else {
      logger.warn(`[P2P] Cannot send signaling message: WebSocket not open (readyState: ${this.ws?.readyState})`);
    }
  }

  /**
   * Phase 32: Send message to signaling server (for bootstrap requests)
   */
  sendToSignalServer(type: string, payload: any): void {
    this.sendSignalingMessage({
      type,
      ...payload,
    });
  }

  /**
   * Handle signaling message from WebSocket
   */
  private handleSignalingMessage(message: any): void {
    switch (message.type) {
      case "JOIN_ACK":
        // Phase 37: Handle JOIN_ACK with rootTip
        const joinAckLog = `[P2P] 🔔 Received JOIN_ACK: peers=${message.peers?.length || 0}, rootTip.height=${message.rootTip?.latestHeight || 0}, hasHeader=${!!message.rootTip?.latestHeader}, recentHeaders=${message.rootTip?.recentHeaders?.length || 0}`;
        logger.info(joinAckLog);
        logger.debug(`[P2P] Received JOIN_ACK:`, {
          peerCount: message.peers?.length || 0,
          hasRootTip: !!message.rootTip,
          rootTipHeight: message.rootTip?.latestHeight || 0,
        });
        
        // Handle peers list (same as "peers" message)
        const joinAckPeerIds: string[] = message.peers || [];
        logger.debug(`[P2P] Processing ${joinAckPeerIds.length} peers from JOIN_ACK`);
        
        // Phase 45: Cache peer list from JOIN_ACK
        this.cachePeers(joinAckPeerIds);
        
        for (const peerId of joinAckPeerIds) {
          if (peerId !== this.nodeId && !this.peers.has(peerId)) {
            logger.debug(`[P2P] Initiating connection to peer: ${peerId.substring(0, 16)}...`);
            this.initiatePeerConnection(peerId);
          }
        }
        
        // Handle IP hash
        if (message.ipHash) {
          logger.debug(`[P2P] Received own IP hash in JOIN_ACK: ${message.ipHash}`);
          if (typeof window !== "undefined") {
            (async () => {
              try {
                const { getQuorumManager } = await import("./quorumManager.js");
                const quorumManager = getQuorumManager();
                quorumManager.setPeerIPHash(this.nodeId, message.ipHash);
                logger.debug(`[P2P] Set own IP hash in QuorumManager: ${this.nodeId.substring(0, 16)}... -> ${message.ipHash}`);
              } catch (error) {
                logger.warn("[P2P] Failed to set IP hash:", error);
              }
            })();
          }
        }
        
        // Phase 33: Handle IP hashes for peer list in JOIN_ACK
        if (message.peerIPHashes) {
          const peerIPHashes = message.peerIPHashes;
          logger.debug(`[P2P] Received IP hashes in JOIN_ACK for ${Object.keys(peerIPHashes).length} peer(s):`, peerIPHashes);
          if (typeof window !== "undefined") {
            (async () => {
              try {
                const { getQuorumManager } = await import("./quorumManager.js");
                const quorumManager = getQuorumManager();
                for (const [peerId, ipHash] of Object.entries(peerIPHashes)) {
                  quorumManager.setPeerIPHash(peerId, ipHash as string);
                  logger.debug(`[P2P] Set IP hash for peer ${peerId.substring(0, 16)}... from JOIN_ACK: ${ipHash}`);
                }
              } catch (error) {
                logger.warn("[P2P] Failed to set peer IP hashes from JOIN_ACK:", error);
              }
            })();
          }
        }
        
        // Handle rootTip - forward to bootstrap sync manager
        if (message.rootTip) {
          const rootTipLog = `[P2P] 📦 JOIN_ACK contains rootTip: height=${message.rootTip.latestHeight}, hasHeader=${!!message.rootTip.latestHeader}, recentHeaders=${message.rootTip.recentHeaders?.length || 0}`;
          logger.info(rootTipLog);
          
          if (message.rootTip.latestHeight > 0) {
            const validHeightLog = `[P2P] ✅ RootTip has valid height, forwarding to bootstrap handlers`;
            logger.info(validHeightLog);
          }
          
          // Phase 37: Store rootTip info for debug overlay
          if (typeof window !== "undefined") {
            (window as any).lastRootTipHeight = message.rootTip.latestHeight;
            (window as any).lastRootTipHash = message.rootTip.latestHeaderHash || "";
            (window as any).lastBootstrapResponseTime = Date.now();
            (window as any).lastRootTipTrustLevel = message.rootTip.trustLevel || 'root-only';
            (window as any).lastRootTipStateCommitment = message.rootTip.stateCommitment || null;
          }
          
          // Try to forward to registered handlers first
          const handlers = this.messageHandlers.get("ROOT_TIP_UPDATE");
          if (handlers && handlers.size > 0) {
            for (const handler of handlers) {
              handler({ rootTip: message.rootTip }, "signal-server");
            }
          } else {
            // If no handlers registered yet, queue the rootTip for later processing
            // This can happen if JOIN_ACK arrives before useEffect registers handlers
            logger.debug(`[P2P] ROOT_TIP_UPDATE handlers not yet registered, will be processed when handlers are available`);
            // Store rootTip temporarily - handlers will check for pending rootTip when they register
            if (typeof window !== "undefined") {
              (window as any).pendingRootTipFromJoinAck = message.rootTip;
            }
            // Also try to trigger handler registration check after a short delay
            setTimeout(() => {
              const delayedHandlers = this.messageHandlers.get("ROOT_TIP_UPDATE");
              if (delayedHandlers && delayedHandlers.size > 0 && typeof window !== "undefined" && (window as any).pendingRootTipFromJoinAck) {
                const pendingRootTip = (window as any).pendingRootTipFromJoinAck;
                delete (window as any).pendingRootTipFromJoinAck;
                logger.debug(`[P2P] Processing queued rootTip from JOIN_ACK`);
                for (const handler of delayedHandlers) {
                  handler({ rootTip: pendingRootTip }, "signal-server");
                }
              }
            }, 1000);
          }
        }
        break;

      case "peers":
        logger.debug(`[P2P] Received peers list:`, {
          peerCount: message.peers?.length || 0,
          peers: message.peers || [],
          hasIPHashes: !!message.peerIPHashes,
        });
        // Phase 33: Handle IP hash from signal server
        if (message.ipHash) {
          // Set our own IP hash
          // Note: This is set when we receive the 'peers' response
          // We'll store it and use it for quorum scoring
          logger.debug(`[P2P] Received own IP hash from signal server: ${message.ipHash}`);
          if (typeof window !== "undefined") {
            (async () => {
              try {
                const { getQuorumManager } = await import("./quorumManager.js");
                const quorumManager = getQuorumManager();
                quorumManager.setPeerIPHash(this.nodeId, message.ipHash);
                logger.debug(`[P2P] Set own IP hash in QuorumManager: ${this.nodeId.substring(0, 16)}... -> ${message.ipHash}`);
              } catch (error) {
                logger.warn("[P2P] Failed to set IP hash:", error);
              }
            })();
          }
        }
        
        // Phase 33: Handle IP hashes for peer list
        if (message.peerIPHashes) {
          // Signal server may send IP hashes for all peers
          const peerIPHashes = message.peerIPHashes;
          logger.debug(`[P2P] Received IP hashes for ${Object.keys(peerIPHashes).length} peer(s):`, peerIPHashes);
          if (typeof window !== "undefined") {
            (async () => {
              try {
                const { getQuorumManager } = await import("./quorumManager.js");
                const quorumManager = getQuorumManager();
                for (const [peerId, ipHash] of Object.entries(peerIPHashes)) {
                  quorumManager.setPeerIPHash(peerId, ipHash as string);
                  logger.debug(`[P2P] Set IP hash for peer ${peerId.substring(0, 16)}...: ${ipHash}`);
                }
              } catch (error) {
                logger.warn("[P2P] Failed to set peer IP hashes:", error);
              }
            })();
          }
        }
        
        // Original peer list handling
        // Received list of peers, initiate WebRTC connections
        const peerIds: string[] = message.peers || [];
        logger.debug(`[P2P] Processing ${peerIds.length} peers, current connections: ${this.peers.size}`);
        
        // Phase 45: Cache peer list to localStorage
        this.cachePeers(peerIds);
        
        if (peerIds.length === 0) {
          logger.debug("[P2P] Received empty peer list - no other nodes online (this is normal if you're the first node)");
        }
        
        for (const peerId of peerIds) {
          if (peerId !== this.nodeId && !this.peers.has(peerId)) {
            logger.debug(`[P2P] Initiating connection to peer: ${peerId.substring(0, 16)}...`);
            this.initiatePeerConnection(peerId);
          } else if (peerId === this.nodeId) {
            logger.debug(`[P2P] Skipping self: ${peerId.substring(0, 16)}...`);
          } else if (this.peers.has(peerId)) {
            logger.debug(`[P2P] Already connected/connecting to: ${peerId.substring(0, 16)}...`);
          }
        }
        break;

      case "offer":
        // Received WebRTC offer
        this.handleOffer(message.from, message.offer);
        break;

      case "answer":
        // Received WebRTC answer
        this.handleAnswer(message.from, message.answer);
        break;

      case "ice-candidate":
        // Received ICE candidate
        this.handleIceCandidate(message.from, message.candidate);
        break;

      case "new-peer":
        // Phase 37: Handle new peer notification from signal server
        // When signal server notifies us about a new peer, initiate connection
        const newPeerId = message.peerId;
        const newPeerIPHash = message.ipHash;
        
        // Phase 33: Set IP hash for new peer if provided
        if (newPeerIPHash && typeof window !== "undefined") {
          (async () => {
            try {
              const { getQuorumManager } = await import("./quorumManager.js");
              const quorumManager = getQuorumManager();
              quorumManager.setPeerIPHash(newPeerId, newPeerIPHash);
              logger.debug(`[P2P] Set IP hash for new peer ${newPeerId.substring(0, 16)}...: ${newPeerIPHash}`);
            } catch (error) {
              logger.warn("[P2P] Failed to set IP hash for new peer:", error);
            }
          })();
        }
        
        if (newPeerId && newPeerId !== this.nodeId && !this.peers.has(newPeerId)) {
          logger.debug(`[P2P] Signal server notified about new peer: ${newPeerId.substring(0, 16)}..., initiating connection`);
          this.initiatePeerConnection(newPeerId);
        }
        break;

      case "peer-left":
        // Phase 37: Handle peer disconnection notification
        const leftPeerId = message.peerId;
        if (leftPeerId && this.peers.has(leftPeerId)) {
          logger.debug(`[P2P] Signal server notified that peer left: ${leftPeerId.substring(0, 16)}...`);
          const peerInfo = this.peers.get(leftPeerId);
          if (peerInfo) {
            if (peerInfo.dataChannel) {
              try {
                peerInfo.dataChannel.close();
              } catch (error) {
                // Ignore errors when closing (channel might already be closed)
                logger.debug(`[P2P] Data channel already closed for peer ${leftPeerId.substring(0, 16)}...`);
              }
            }
            try {
              peerInfo.connection.close();
            } catch (error) {
              // Ignore errors when closing (connection might already be closed)
              logger.debug(`[P2P] Connection already closed for peer ${leftPeerId.substring(0, 16)}...`);
            }
            this.peers.delete(leftPeerId);
          }
        }
        break;

      // Phase 32: Handle bootstrap response from signal server
      case "BOOTSTRAP_RESPONSE":
        logger.debug(`[Phase 32] Received BOOTSTRAP_RESPONSE from signal server:`, {
          latestHeight: message.latestHeight,
          hasHeader: !!message.latestHeader,
          hasSnapshotMeta: !!message.latestSnapshotMeta,
          recentHeadersCount: message.recentHeaders?.length || 0,
          requestId: message.requestId,
        });
        
        // Even if latestHeight is 0, forward to handlers (they will handle it appropriately)
        const handlers = this.messageHandlers.get("BOOTSTRAP_RESPONSE");
        if (handlers && handlers.size > 0) {
          logger.debug(`[Phase 32] Forwarding BOOTSTRAP_RESPONSE to ${handlers.size} handler(s)`);
          for (const handler of handlers) {
            handler(message, "signal-server");
          }
        } else {
          logger.warn(`[Phase 32] ⚠️ No handlers registered for BOOTSTRAP_RESPONSE - bootstrap sync may not work`);
        }
        break;

      // Phase 32: Handle root tip update from signal server
      case "ROOT_TIP_UPDATE":
        logger.debug(`[Phase 32] Received ROOT_TIP_UPDATE from signal server:`, {
          latestHeight: message.rootTip?.latestHeight || message.latestHeight,
          hasHeader: !!message.rootTip?.latestHeader || !!message.latestHeader,
          timestamp: message.timestamp,
        });
        
        // Forward to message handlers
        const tipHandlers = this.messageHandlers.get("ROOT_TIP_UPDATE");
        if (tipHandlers && tipHandlers.size > 0) {
          logger.debug(`[Phase 32] Forwarding ROOT_TIP_UPDATE to ${tipHandlers.size} handler(s)`);
          for (const handler of tipHandlers) {
            handler(message, "signal-server");
          }
        } else {
          logger.warn(`[Phase 32] ⚠️ No handlers registered for ROOT_TIP_UPDATE`);
        }
        break;
      
      // Phase 48: Forward BOOTSTRAP_BLOCKS (signal-server WS response) to handlers
      case "BOOTSTRAP_BLOCKS":
        logger.debug(`[Phase 48] Received BOOTSTRAP_BLOCKS from signal server:`, {
          ok: message.ok,
          count: message.blocks?.length || 0,
          availableFromHeight: message.availableFromHeight,
          availableToHeight: message.availableToHeight,
          requestId: message.requestId,
        });
        {
          const handlers = this.messageHandlers.get("BOOTSTRAP_BLOCKS" as any);
          if (handlers && handlers.size > 0) {
            for (const handler of handlers) {
              handler(message, "signal-server");
            }
          } else {
            logger.debug(`[Phase 48] No handlers registered for BOOTSTRAP_BLOCKS (this is fine if not using WS bootstrap)`);
          }
        }
        break;
      
      // Forward SNAPSHOT_* messages from signal server to handlers (Global Snapshot via signaling fallback)
      case "SNAPSHOT_META":
      case "SNAPSHOT_CHUNK":
      case "SNAPSHOT_DONE":
        {
          const type = message.type as "SNAPSHOT_META" | "SNAPSHOT_CHUNK" | "SNAPSHOT_DONE";
          const handlers = this.messageHandlers.get(type as any);
          if (handlers && handlers.size > 0) {
            for (const handler of handlers) {
              handler(message, "signal-server");
            }
          } else {
            logger.debug(`[Phase 48] No handlers registered for ${type} (ok if relying on pure P2P)`);
          }
        }
        break;

      default:
        logger.warn("Unknown signaling message type:", message.type);
    }
  }

  /**
   * Initiate WebRTC connection to a peer
   * Uses deterministic ordering (nodeId comparison) to prevent both sides from creating offers simultaneously
   */
  private async initiatePeerConnection(peerId: string): Promise<void> {
    if (this.peers.has(peerId)) {
      const existingPeer = this.peers.get(peerId);
      const state = existingPeer?.connection.signalingState;
      logger.debug(`[P2P] Already have connection to ${peerId.substring(0, 16)}... (state: ${state}), skipping`);
      return; // Already connected or connecting
    }

    // Use deterministic ordering to decide who creates the offer
    // The node with the "smaller" nodeId creates the offer
    // This prevents both sides from creating offers simultaneously
    if (peerId < this.nodeId) {
      logger.debug(`[P2P] Peer ${peerId.substring(0, 16)}... has smaller nodeId, waiting for their offer instead of creating one`);
      // Create connection but don't create offer - wait for the other side
      const iceServers = (() => {
        const defaults = [{ urls: "stun:stun.l.google.com:19302" }];
        if (typeof window !== "undefined" && (window as any).iceServers && Array.isArray((window as any).iceServers)) {
          return (window as any).iceServers;
        }
        if (typeof localStorage !== "undefined") {
          try {
            const raw = localStorage.getItem("indexerchain_ice_servers");
            if (raw) {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) return parsed;
            }
          } catch {}
        }
        try {
          const envVal = (import.meta as any)?.env?.VITE_ICE_SERVERS;
          if (envVal) {
            const parsed = JSON.parse(envVal);
            if (Array.isArray(parsed)) return parsed;
          }
        } catch {}
        // Background fetch ICE config from signaling HTTP to improve subsequent attempts
        try {
          const httpUrl = (this.currentBootstrapUrl || "").replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
          if (httpUrl && typeof fetch !== "undefined" && !(window as any).iceServersFetching) {
            (window as any).iceServersFetching = true;
            fetch(`${httpUrl}/ice-config`)
              .then(r => r.ok ? r.json() : null)
              .then(cfg => {
                if (cfg && cfg.ok && Array.isArray(cfg.iceServers)) {
                  (window as any).iceServers = cfg.iceServers;
                }
              })
              .catch(() => {})
              .finally(() => { try { delete (window as any).iceServersFetching; } catch {} });
          }
        } catch {}
        return defaults;
      })();
      const connection = new RTCPeerConnection({ iceServers });

      const peerInfo: PeerInfo = {
        id: peerId,
        connection,
        dataChannel: null,
        connected: false,
        lastSeen: Date.now(),
      };

      this.peers.set(peerId, peerInfo);

      // Handle incoming data channel (we're the answerer)
      connection.ondatachannel = (event) => {
        this.setupDataChannel(event.channel, peerInfo);
      };

      // Handle ICE candidates
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignalingMessage({
            type: "ice-candidate",
            to: peerId,
            candidate: event.candidate,
          });
        }
      };

      // Handle connection state changes
      connection.onconnectionstatechange = () => {
        // Phase 47: Reduce log spam for connection failures
        // Connection failures are normal in P2P networks (NAT, firewall, etc.)
        // Only log if this is a new failure (not already logged)
        if (connection.connectionState === "failed" || connection.connectionState === "disconnected") {
          const failureKey = `connection_failure_${peerId}`;
          const lastFailureLog = (typeof window !== "undefined" && (window as any)[failureKey]) || 0;
          const now = Date.now();
          
          // Only log once per peer per 30 seconds to reduce spam
          if (now - lastFailureLog > 30000) {
            if (typeof window !== "undefined") {
              (window as any)[failureKey] = now;
            }
            logger.debug(`[P2P] Connection ${connection.connectionState} for ${peerId.substring(0, 16)}... (this is normal in P2P networks)`);
          }
        } else if (connection.connectionState === "connected") {
          // Clear failure log on successful connection
          const failureKey = `connection_failure_${peerId}`;
          if (typeof window !== "undefined") {
            delete (window as any)[failureKey];
          }
        }
      };

      return; // Don't create offer, wait for the other side
    }

    logger.debug(`[P2P] Creating WebRTC connection to ${peerId.substring(0, 16)}...`);
    const iceServers2 = (() => {
      const defaults = [{ urls: "stun:stun.l.google.com:19302" }];
      if (typeof window !== "undefined" && (window as any).iceServers && Array.isArray((window as any).iceServers)) {
        return (window as any).iceServers;
      }
      if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem("indexerchain_ice_servers");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
          }
        } catch {}
      }
      try {
        const envVal = (import.meta as any)?.env?.VITE_ICE_SERVERS;
        if (envVal) {
          const parsed = JSON.parse(envVal);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
      // Background fetch ICE config from signaling HTTP to improve subsequent attempts
      try {
        const httpUrl = (this.currentBootstrapUrl || "").replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
        if (httpUrl && typeof fetch !== "undefined" && !(window as any).iceServersFetching) {
          (window as any).iceServersFetching = true;
          fetch(`${httpUrl}/ice-config`)
            .then(r => r.ok ? r.json() : null)
            .then(cfg => {
              if (cfg && cfg.ok && Array.isArray(cfg.iceServers)) {
                (window as any).iceServers = cfg.iceServers;
              }
            })
            .catch(() => {})
            .finally(() => { try { delete (window as any).iceServersFetching; } catch {} });
        }
      } catch {}
      return defaults;
    })();
    const connection = new RTCPeerConnection({ iceServers: iceServers2 });

    const peerInfo: PeerInfo = {
      id: peerId,
      connection,
      dataChannel: null,
      connected: false,
      lastSeen: Date.now(),
    };

    this.peers.set(peerId, peerInfo);

    // Create data channel
    const dataChannel = connection.createDataChannel("indexerchain", {
      ordered: true,
    });

    this.setupDataChannel(dataChannel, peerInfo);

    // Handle ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        logger.debug(`[P2P] ICE candidate for ${peerId.substring(0, 16)}...:`, event.candidate.candidate?.substring(0, 50));
        this.sendSignalingMessage({
          type: "ice-candidate",
          to: peerId,
          candidate: event.candidate,
        });
      } else {
        logger.debug(`[P2P] ICE gathering complete for ${peerId.substring(0, 16)}...`);
      }
    };

    // Handle connection state changes
    connection.onconnectionstatechange = () => {
      // Phase 47: Reduce log spam for connection failures
      // Connection failures are normal in P2P networks (NAT, firewall, etc.)
      // Only log if this is a new failure (not already logged)
      if (connection.connectionState === "failed" || connection.connectionState === "disconnected") {
        const failureKey = `connection_failure_${peerId}`;
        const lastFailureLog = (typeof window !== "undefined" && (window as any)[failureKey]) || 0;
        const now = Date.now();
        
        // Only log once per peer per 30 seconds to reduce spam
        if (now - lastFailureLog > 30000) {
          if (typeof window !== "undefined") {
            (window as any)[failureKey] = now;
          }
          logger.debug(`[P2P] Connection ${connection.connectionState} for ${peerId.substring(0, 16)}... (this is normal in P2P networks)`);
        }
      } else if (connection.connectionState === "connected") {
        // Clear failure log on successful connection
        const failureKey = `connection_failure_${peerId}`;
        if (typeof window !== "undefined") {
          delete (window as any)[failureKey];
        }
      }
    };

    // Create offer
    try {
      logger.debug(`[P2P] Creating offer for ${peerId.substring(0, 16)}...`);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      logger.debug(`[P2P] Offer created, sending to signal server for ${peerId.substring(0, 16)}...`);

      this.sendSignalingMessage({
        type: "offer",
        to: peerId,
        offer: offer,
      });
    } catch (error) {
      logger.error(`[P2P] ❌ Failed to create offer for ${peerId.substring(0, 16)}...:`, error);
      this.peers.delete(peerId);
    }
  }

  /**
   * Handle incoming WebRTC offer
   */
  private async handleOffer(from: string, offer: RTCSessionDescriptionInit): Promise<void> {
    logger.debug(`[P2P] Received offer from ${from.substring(0, 16)}...`);
    let peerInfo = this.peers.get(from);

    if (!peerInfo) {
      const iceServers3 = (() => {
        const defaults = [{ urls: "stun:stun.l.google.com:19302" }];
        if (typeof window !== "undefined" && (window as any).iceServers && Array.isArray((window as any).iceServers)) {
          return (window as any).iceServers;
        }
        if (typeof localStorage !== "undefined") {
          try {
            const raw = localStorage.getItem("indexerchain_ice_servers");
            if (raw) {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) return parsed;
            }
          } catch {}
        }
        try {
          const envVal = (import.meta as any)?.env?.VITE_ICE_SERVERS;
          if (envVal) {
            const parsed = JSON.parse(envVal);
            if (Array.isArray(parsed)) return parsed;
          }
        } catch {}
        // Background fetch ICE config from signaling HTTP to improve subsequent attempts
        try {
          const httpUrl = (this.currentBootstrapUrl || "").replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
          if (httpUrl && typeof fetch !== "undefined" && !(window as any).iceServersFetching) {
            (window as any).iceServersFetching = true;
            fetch(`${httpUrl}/ice-config`)
              .then(r => r.ok ? r.json() : null)
              .then(cfg => {
                if (cfg && cfg.ok && Array.isArray(cfg.iceServers)) {
                  (window as any).iceServers = cfg.iceServers;
                }
              })
              .catch(() => {})
              .finally(() => { try { delete (window as any).iceServersFetching; } catch {} });
          }
        } catch {}
        return defaults;
      })();
      const connection = new RTCPeerConnection({ iceServers: iceServers3 });

      peerInfo = {
        id: from,
        connection,
        dataChannel: null,
        connected: false,
        lastSeen: Date.now(),
      };

      this.peers.set(from, peerInfo);

      // Handle incoming data channel
      connection.ondatachannel = (event) => {
        this.setupDataChannel(event.channel, peerInfo!);
      };

      // Handle ICE candidates
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignalingMessage({
            type: "ice-candidate",
            to: from,
            candidate: event.candidate,
          });
        }
      };
    }

    try {
      await peerInfo.connection.setRemoteDescription(offer);
      const answer = await peerInfo.connection.createAnswer();
      await peerInfo.connection.setLocalDescription(answer);
      logger.debug(`[P2P] Created answer for ${from.substring(0, 16)}..., sending to signal server`);

      this.sendSignalingMessage({
        type: "answer",
        to: from,
        answer: answer,
      });
    } catch (error) {
      logger.error(`Failed to handle offer from ${from}:`, error);
    }
  }

  /**
   * Handle incoming WebRTC answer
   */
  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const peerInfo = this.peers.get(from);
    if (!peerInfo) {
      logger.warn(`[P2P] Received answer from unknown peer: ${from.substring(0, 16)}...`);
      return;
    }

    try {
      // Check connection state - if we already have a remote offer, we're the answerer
      // and shouldn't set this answer (it's for the other direction)
      const connectionState = peerInfo.connection.signalingState;
      if (connectionState === "have-remote-offer") {
        // We're already the answerer (we received an offer and created an answer)
        // This answer is from the other side, which means they also received our offer
        // We should ignore this answer since we're already handling the connection from our side
        logger.debug(`[P2P] Ignoring answer from ${from.substring(0, 16)}... - we're already the answerer (state: ${connectionState})`);
        return;
      }

      // We're the offerer, so set the remote answer
      if (connectionState === "have-local-offer") {
        await peerInfo.connection.setRemoteDescription(answer);
        logger.debug(`[P2P] Set remote answer from ${from.substring(0, 16)}... (state: ${connectionState})`);
      } else {
        logger.debug(`[P2P] Ignoring answer from ${from.substring(0, 16)}... - unexpected state: ${connectionState}`);
      }
    } catch (error) {
      logger.error(`[P2P] Failed to set remote description for ${from.substring(0, 16)}...:`, error);
    }
  }

  /**
   * Handle ICE candidate
   */
  private async handleIceCandidate(
    from: string,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    const peerInfo = this.peers.get(from);
    if (peerInfo) {
      try {
        await peerInfo.connection.addIceCandidate(candidate);
      } catch (error) {
        logger.error(`Failed to add ICE candidate for ${from}:`, error);
      }
    }
  }

  /**
   * Setup data channel for peer communication
   */
  private setupDataChannel(dataChannel: RTCDataChannel, peerInfo: PeerInfo): void {
    peerInfo.dataChannel = dataChannel;

    dataChannel.onopen = () => {
      logger.debug(`[P2P] ✅ Data channel opened with peer ${peerInfo.id.substring(0, 16)}...`);
      peerInfo.connected = true;
      peerInfo.lastSeen = Date.now();
      logger.debug(`[P2P] Total connected peers: ${this.getPeerCount()}`);
      
      // Phase 40: Setup heartbeat for this peer
      if (this.connectionManager) {
        this.connectionManager.setupPeerHeartbeat(
          peerInfo.id,
          () => {
            // Send ping
            if (dataChannel.readyState === "open") {
              this.sendToPeer(peerInfo.id, "PING", { timestamp: Date.now() });
            }
          },
          (failedPeerId) => {
            // On heartbeat failure, try to reconnect
            logger.warn(`[P2P] Peer ${failedPeerId.substring(0, 16)}... heartbeat failed, attempting reconnection...`);
            const failedPeer = this.peers.get(failedPeerId);
            if (failedPeer && !failedPeer.connected) {
              // Remove and re-initiate connection
              this.peers.delete(failedPeerId);
              this.initiatePeerConnection(failedPeerId);
            }
          }
        );
      }
      
      // Phase 33: Log IP hash for connected peer
      if (typeof window !== "undefined") {
        (async () => {
          try {
            const { getQuorumManager } = await import("./quorumManager.js");
            const quorumManager = getQuorumManager();
            const ipHash = quorumManager.getPeerIPHash(peerInfo.id);
            const peerIPHash = (peerInfo as any).ipHash;
            logger.debug(`[P2P] Peer ${peerInfo.id.substring(0, 16)}... connected - IP hash: ${ipHash || peerIPHash || "not set"}`);
            
            // If IP hash is not set, try to get it from signal server
            if (!ipHash && !peerIPHash) {
              logger.warn(`[P2P] ⚠️ Peer ${peerInfo.id.substring(0, 16)}... has no IP hash - independent peer count may be incorrect`);
            }
          } catch (error) {
            logger.warn("[P2P] Failed to check peer IP hash:", error);
          }
        })();
      }
      
      // Phase 30: Send network handshake when data channel opens
      // This will be handled by App.tsx after P2P connection is established
      
      // Phase 32: Notify that a peer connected (for executing pending block requests)
      if (typeof window !== "undefined") {
        // Dispatch a custom event to notify App.tsx that a peer connected
        window.dispatchEvent(new CustomEvent('peer-connected', { 
          detail: { peerId: peerInfo.id, peerCount: this.getPeerCount() }
        }));
      }
    };

    dataChannel.onmessage = (event) => {
      try {
        const message: P2PMessage = JSON.parse(event.data);
        this.handlePeerMessage(message, peerInfo.id);
      } catch (error) {
        logger.error(`Failed to parse message from ${peerInfo.id}:`, error);
      }
    };

    dataChannel.onclose = () => {
      logger.debug(`[P2P] Data channel closed with peer ${peerInfo.id.substring(0, 16)}...`);
      peerInfo.connected = false;
      
      // Phase 40: Clear heartbeat when channel closes
      if (this.connectionManager) {
        this.connectionManager.clearPeerHeartbeat(peerInfo.id);
      }
    };

    dataChannel.onerror = (error) => {
      // Phase 38: Improved error handling - ignore "User-Initiated Abort" errors
      // These occur when dataChannel.close() is called, which is normal behavior
      const rtcError = (error as any).error;
      if (rtcError) {
        const errorName = rtcError.name || rtcError.constructor?.name || '';
        const errorReason = rtcError.reason || '';
        
        // Ignore normal close operations
        if (
          errorName === 'OperationError' &&
          (errorReason === 'Close called' || errorReason.includes('User-Initiated Abort'))
        ) {
          // This is a normal close operation, not a real error
          logger.debug(`[P2P] Data channel closed normally with peer ${peerInfo.id.substring(0, 16)}... (reason: ${errorReason})`);
          peerInfo.connected = false;
          return;
        }
        
        // Check if channel is already closed
        if (dataChannel.readyState === 'closed') {
          logger.debug(`[P2P] Data channel already closed with peer ${peerInfo.id.substring(0, 16)}..., ignoring error`);
          peerInfo.connected = false;
          return;
        }
      }
      
      // Only log as error if it's a real error, not a normal close
      logger.error(`[P2P] Data channel error with peer ${peerInfo.id.substring(0, 16)}...:`, error);
      peerInfo.connected = false;
    };
  }

  /**
   * Handle message from peer
   */
  private handlePeerMessage(message: P2PMessage, sender: string): void {
    // Phase 40: Handle PING/PONG for heartbeat
    if (message.type === "PING") {
      // Respond with PONG
      this.sendToPeer(sender, "PONG", { timestamp: message.data?.timestamp || Date.now() });
      // Record successful heartbeat
      if (this.connectionManager) {
        this.connectionManager.recordHeartbeatResponse(sender);
      }
      return;
    }
    
    if (message.type === "PONG") {
      // Record successful heartbeat response
      if (this.connectionManager) {
        this.connectionManager.recordHeartbeatResponse(sender);
      }
      return;
    }
    
    // Deduplication: ignore messages we've seen
    if (message.messageId && this.seenMessages.has(message.messageId)) {
      return;
    }

    // Ignore messages from self
    if (message.sender === this.nodeId) {
      return;
    }

    // Add to seen messages
    if (message.messageId) {
      this.seenMessages.add(message.messageId);
      // Clean up old messages (simple TTL)
      setTimeout(() => {
        this.seenMessages.delete(message.messageId!);
      }, this.MESSAGE_TTL);
    }

    // Update peer last seen
    const peerInfo = this.peers.get(sender);
    if (peerInfo) {
      peerInfo.lastSeen = Date.now();
    }

    // Call registered handlers
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          // Ensure data is defined - some messages might not have data field
          const handlerData = message.data !== undefined ? message.data : message;
          handler(handlerData, message.sender);
        } catch (error) {
          logger.error(`Error in message handler for ${message.type}:`, error);
        }
      }
    }
  }

  /**
   * Process queued messages (after connection established)
   */
  private processMessageQueue(): void {
    // In Phase 4, we don't queue messages before connection
    // This is a placeholder for future enhancement
  }

  /**
   * Request peers from signaling server
   */
  requestPeers(): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn("[P2P] ⚠️ Cannot request peers: not connected to signaling server");
      return;
    }
    logger.debug("[P2P] Requesting peers from signaling server");
    this.sendSignalingMessage({
      type: "request-peers",
      nodeId: this.nodeId,
    });
  }

  /**
   * Phase 45: Cache peer list to localStorage for P2P bootstrap
   */
  private cachePeers(peerIds: string[]): void {
    if (typeof window === "undefined") return;
    
    try {
      const cacheData = {
        peerIds: peerIds.filter(id => id !== this.nodeId),
        timestamp: Date.now(),
        nodeId: this.nodeId,
      };
      localStorage.setItem("indexerchain_cached_peers", JSON.stringify(cacheData));
      logger.debug(`[Phase 45] Cached ${cacheData.peerIds.length} peers to localStorage`);
    } catch (error) {
      logger.warn("[Phase 45] Failed to cache peers:", error);
    }
  }

  /**
   * Phase 45: Load cached peers from localStorage
   */
  private loadCachedPeers(): string[] {
    if (typeof window === "undefined") return [];
    
    try {
      const cached = localStorage.getItem("indexerchain_cached_peers");
      if (!cached) return [];
      
      const data = JSON.parse(cached);
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      if (Date.now() - data.timestamp > maxAge) {
        // Cache expired
        localStorage.removeItem("indexerchain_cached_peers");
        return [];
      }
      
      logger.debug(`[Phase 45] Loaded ${data.peerIds?.length || 0} cached peers from localStorage`);
      return data.peerIds || [];
    } catch (error) {
      logger.warn("[Phase 45] Failed to load cached peers:", error);
      return [];
    }
  }

  /**
   * Phase 45: Get cached peers
   */
  getCachedPeers(): string[] {
    return this.loadCachedPeers();
  }
}

