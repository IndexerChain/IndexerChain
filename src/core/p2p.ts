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
 */
export type P2PMessageType =
  | "NEW_TX"
  | "NEW_BLOCK"
  | "REQUEST_BLOCKS"
  | "BLOCKS"
  | "PING"
  | "PONG";

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
  onMessage(type: P2PMessageType, handler: (payload: any, sender: string) => void): void;
  getPeerCount(): number;
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

    // Store bootstrap URL for reference

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(bootstrapUrl);

        this.ws.onopen = () => {
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
            this.handleSignalingMessage(message);
          } catch (error) {
            console.error("Failed to parse signaling message:", error);
          }
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log("Disconnected from signaling server");
          this.isConnected = false;
          this.ws = null;
        };
      } catch (error) {
        reject(error);
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
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Handle signaling message from WebSocket
   */
  private handleSignalingMessage(message: any): void {
    switch (message.type) {
      case "peers":
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

