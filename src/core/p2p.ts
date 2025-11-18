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
  // Phase 32: Bootstrap Sync Protocol
  | "REQUEST_BOOTSTRAP" // Request bootstrap data (latest height, header, snapshot meta)
  | "BOOTSTRAP_RESPONSE" // Response with bootstrap data
  | "ROOT_TIP_UPDATE" // Root node broadcasts latest tip update
  // Phase 36: State Commit Gossip
  | "STATE_COMMIT_GOSSIP";

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

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  /**
   * Connect to bootstrap server (WebSocket signaling server)
   */
  async connect(bootstrapUrl: string): Promise<void> {
    if (this.isConnected) {
      console.warn("Already connected to P2P network");
      return;
    }

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
          console.log("Connected to signaling server");
          this.isConnected = true;

          // Send join message
          this.sendSignalingMessage({
            type: "join",
            nodeId: this.nodeId,
          });

          // Process queued messages
          this.processMessageQueue();

          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log(`[P2P] Received signaling message:`, message.type, message);
            
            // Phase 32: Check if this is a BOOTSTRAP_RESPONSE and handle it directly
            if (message.type === 'BOOTSTRAP_RESPONSE') {
              console.log(`[Phase 32] Direct handling of BOOTSTRAP_RESPONSE from WebSocket`);
              this.handleSignalingMessage(message);
            } else {
              this.handleSignalingMessage(message);
            }
          } catch (error) {
            console.error("Failed to parse signaling message:", error);
          }
        };

        this.ws.onerror = (error) => {
          clearTimeout(timeout);
          console.error("WebSocket error:", error);
          const errorMessage =
            this.ws?.readyState === WebSocket.CONNECTING
              ? `Failed to connect to signaling server at ${bootstrapUrl}.\n\nPlease ensure:\n1. The signaling server is running\n2. The URL is correct\n3. Check the server logs for errors`
              : "WebSocket connection error occurred";
          reject(new Error(errorMessage));
        };

        this.ws.onclose = (event) => {
          clearTimeout(timeout);
          console.log("Disconnected from signaling server", event.code, event.reason);
          this.isConnected = false;
          this.ws = null;

          // If connection was closed unexpectedly (not by us), reject the promise
          if (event.code !== 1000 && event.code !== 1001) {
            // 1000 = normal closure, 1001 = going away
            // Other codes indicate an error
            // 1006 = abnormal closure (server not running, network error, etc.)
            if (!this.isConnected) {
              // Only reject if we're not already connected (i.e., during initial connection)
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
   * Disconnect from P2P network
   */
  disconnect(): void {
    // Close all peer connections
    for (const peer of this.peers.values()) {
      if (peer.dataChannel) {
        peer.dataChannel.close();
      }
      peer.connection.close();
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
          console.error(`Failed to send message to peer ${peer.id}:`, error);
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
      console.warn(`[P2P] Cannot send message to peer ${peerId}: peer not connected`);
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
      console.error(`Failed to send message to peer ${peerId}:`, error);
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
      console.log(`[P2P] Sending signaling message:`, message.type, message);
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn(`[P2P] Cannot send signaling message: WebSocket not open (readyState: ${this.ws?.readyState})`);
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
      case "peers":
        // Phase 33: Handle IP hash from signal server
        if (message.ipHash) {
          // Set our own IP hash
          // Note: This is set when we receive the 'peers' response
          // We'll store it and use it for quorum scoring
          if (typeof window !== "undefined") {
            const { getQuorumManager } = require("./quorumManager.js");
            const quorumManager = getQuorumManager();
            quorumManager.setPeerIPHash(this.nodeId, message.ipHash);
          }
        }
        
        // Phase 33: Handle IP hashes for peer list
        if (message.peerIPHashes) {
          // Signal server may send IP hashes for all peers
          const peerIPHashes = message.peerIPHashes;
          if (typeof window !== "undefined") {
            const { getQuorumManager } = require("./quorumManager.js");
            const quorumManager = getQuorumManager();
            for (const [peerId, ipHash] of Object.entries(peerIPHashes)) {
              quorumManager.setPeerIPHash(peerId, ipHash as string);
            }
          }
        }
        
        // Original peer list handling
        // Received list of peers, initiate WebRTC connections
        const peerIds: string[] = message.peers || [];
        for (const peerId of peerIds) {
          if (peerId !== this.nodeId && !this.peers.has(peerId)) {
            this.initiatePeerConnection(peerId);
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

      // Phase 32: Handle bootstrap response from signal server
      case "BOOTSTRAP_RESPONSE":
        console.log(`[Phase 32] Received BOOTSTRAP_RESPONSE from signal server:`, {
          latestHeight: message.latestHeight,
          hasHeader: !!message.latestHeader,
          hasSnapshotMeta: !!message.latestSnapshotMeta,
          recentHeadersCount: message.recentHeaders?.length || 0
        });
        // Forward to message handlers
        const handlers = this.messageHandlers.get("BOOTSTRAP_RESPONSE");
        if (handlers && handlers.size > 0) {
          console.log(`[Phase 32] Forwarding BOOTSTRAP_RESPONSE to ${handlers.size} handler(s)`);
          for (const handler of handlers) {
            handler(message, "signal-server");
          }
        } else {
          console.warn(`[Phase 32] No handlers registered for BOOTSTRAP_RESPONSE`);
        }
        break;

      // Phase 32: Handle root tip update from signal server
      case "ROOT_TIP_UPDATE":
        // Forward to message handlers
        const tipHandlers = this.messageHandlers.get("ROOT_TIP_UPDATE");
        if (tipHandlers) {
          for (const handler of tipHandlers) {
            handler(message, "signal-server");
          }
        }
        break;

      default:
        console.warn("Unknown signaling message type:", message.type);
    }
  }

  /**
   * Initiate WebRTC connection to a peer
   */
  private async initiatePeerConnection(peerId: string): Promise<void> {
    if (this.peers.has(peerId)) {
      return; // Already connected or connecting
    }

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

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
        this.sendSignalingMessage({
          type: "ice-candidate",
          to: peerId,
          candidate: event.candidate,
        });
      }
    };

    // Create offer
    try {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      this.sendSignalingMessage({
        type: "offer",
        to: peerId,
        offer: offer,
      });
    } catch (error) {
      console.error(`Failed to create offer for ${peerId}:`, error);
      this.peers.delete(peerId);
    }
  }

  /**
   * Handle incoming WebRTC offer
   */
  private async handleOffer(from: string, offer: RTCSessionDescriptionInit): Promise<void> {
    let peerInfo = this.peers.get(from);

    if (!peerInfo) {
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

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

      this.sendSignalingMessage({
        type: "answer",
        to: from,
        answer: answer,
      });
    } catch (error) {
      console.error(`Failed to handle offer from ${from}:`, error);
    }
  }

  /**
   * Handle incoming WebRTC answer
   */
  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const peerInfo = this.peers.get(from);
    if (peerInfo) {
      try {
        await peerInfo.connection.setRemoteDescription(answer);
      } catch (error) {
        console.error(`Failed to set remote description for ${from}:`, error);
      }
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
        console.error(`Failed to add ICE candidate for ${from}:`, error);
      }
    }
  }

  /**
   * Setup data channel for peer communication
   */
  private setupDataChannel(dataChannel: RTCDataChannel, peerInfo: PeerInfo): void {
    peerInfo.dataChannel = dataChannel;

    dataChannel.onopen = () => {
      console.log(`Data channel opened with peer ${peerInfo.id}`);
      peerInfo.connected = true;
      peerInfo.lastSeen = Date.now();
      
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
        console.error(`Failed to parse message from ${peerInfo.id}:`, error);
      }
    };

    dataChannel.onclose = () => {
      console.log(`Data channel closed with peer ${peerInfo.id}`);
      peerInfo.connected = false;
    };

    dataChannel.onerror = (error) => {
      console.error(`Data channel error with peer ${peerInfo.id}:`, error);
      peerInfo.connected = false;
    };
  }

  /**
   * Handle message from peer
   */
  private handlePeerMessage(message: P2PMessage, sender: string): void {
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
          handler(message.data, message.sender);
        } catch (error) {
          console.error(`Error in message handler for ${message.type}:`, error);
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
    this.sendSignalingMessage({
      type: "request-peers",
    });
  }
}

