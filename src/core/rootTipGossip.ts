/**
 * Phase 46+: P2P RootTip Gossip - Decentralized RootTip Propagation
 * 
 * This module implements peer-to-peer gossip protocol for rootTip propagation,
 * eliminating the single point of failure from signal servers.
 * 
 * Key Features:
 * - Gossip rootTip updates through P2P network
 * - Prevent circular propagation (TTL, seen set)
 * - Automatic fallback when signal servers are unavailable
 * - Works alongside signal server broadcasts (not replacement)
 * 
 * Architecture:
 * - When a node mines a block: broadcast to signal server (if available) + P2P gossip
 * - When a node receives gossip: process with UnifiedSyncManager + forward to other peers
 * - Signal servers become "accelerators" rather than "requirements"
 */

import { logger } from "./logger.js";
import type { P2PNode } from "./p2p.js";
import type { BlockHeader } from "./types.js";

export interface RootTipGossipMessage {
  type: "ROOT_TIP_GOSSIP";
  rootTip: {
    latestHeight: number;
    latestHeader: BlockHeader | null;
    latestHeaderHash: string;
    recentHeaders: Array<BlockHeader | { height: number; hash: string }>;
    latestSnapshotMeta: any | null;
    stateCommitment: string | null;
    trustLevel: "root-only" | "local-majority" | "stale";
    updatedAt: number;
  };
  sender: string; // Node ID of the original sender
  ttl: number; // Time to live (hops remaining)
  seen: string[]; // Node IDs that have already seen this message
  timestamp: number;
  messageId: string; // Unique message ID for deduplication
}

export interface RootTipGossipConfig {
  maxTTL: number; // Maximum TTL (default: 5 hops)
  minTTL: number; // Minimum TTL to continue forwarding (default: 1)
  maxSeenNodes: number; // Maximum nodes to track in seen set (default: 50)
  gossipDelayMs: number; // Delay before forwarding to prevent flooding (default: 100)
}

const DEFAULT_CONFIG: RootTipGossipConfig = {
  maxTTL: 5,
  minTTL: 1,
  maxSeenNodes: 50,
  gossipDelayMs: 100,
};

/**
 * RootTip Gossip Manager
 * 
 * Manages P2P gossip propagation of rootTip updates
 */
export class RootTipGossipManager {
  private p2pNode: P2PNode | null = null;
  private config: RootTipGossipConfig;
  private seenMessages: Map<string, number> = new Map(); // messageId -> timestamp
  private seenCleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<RootTipGossipConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the gossip manager
   */
  init(p2pNode: P2PNode): void {
    this.p2pNode = p2pNode;
    
    // Cleanup old seen messages every 5 minutes
    this.seenCleanupInterval = setInterval(() => {
      this.cleanupSeenMessages();
    }, 5 * 60 * 1000);
  }

  /**
   * Cleanup old seen messages (older than 10 minutes)
   */
  private cleanupSeenMessages(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    
    for (const [messageId, timestamp] of this.seenMessages.entries()) {
      if (now - timestamp > maxAge) {
        this.seenMessages.delete(messageId);
      }
    }
  }

  /**
   * Generate unique message ID for a rootTip
   */
  private generateMessageId(rootTip: RootTipGossipMessage["rootTip"]): string {
    // Use height + hash + timestamp to create unique ID
    return `gossip_${rootTip.latestHeight}_${rootTip.latestHeaderHash.substring(0, 16)}_${rootTip.updatedAt}`;
  }

  /**
   * Broadcast rootTip via P2P gossip
   * 
   * This is called when:
   * 1. A node mines a new block
   * 2. A node receives a gossip and needs to forward it
   * 
   * @param rootTip RootTip data to gossip
   * @param isOriginalSender Whether this node is the original sender (mined the block)
   */
  async gossipRootTip(
    rootTip: RootTipGossipMessage["rootTip"],
    isOriginalSender: boolean = false
  ): Promise<void> {
    if (!this.p2pNode || !this.p2pNode.isConnected) {
      logger.debug(`[RootTipGossip] Cannot gossip: P2P not connected`);
      return;
    }

    const messageId = this.generateMessageId(rootTip);
    
    // Check if we've already seen this message
    if (this.seenMessages.has(messageId)) {
      logger.debug(`[RootTipGossip] Already seen message ${messageId.substring(0, 16)}..., skipping`);
      return;
    }

    // Mark as seen
    this.seenMessages.set(messageId, Date.now());

    // Get current node ID
    const currentNodeId = this.p2pNode.nodeId;
    
    // Build gossip message
    const gossipMessage: RootTipGossipMessage = {
      type: "ROOT_TIP_GOSSIP",
      rootTip,
      sender: isOriginalSender ? currentNodeId : rootTip.latestHeaderHash, // Use hash as sender for forwarded messages
      ttl: this.config.maxTTL,
      seen: isOriginalSender ? [currentNodeId] : [],
      timestamp: Date.now(),
      messageId,
    };

    // Get connected peers
    const peers = this.getConnectedPeers();
    
    if (peers.length === 0) {
      logger.debug(`[RootTipGossip] No peers connected, cannot gossip`);
      return;
    }

    logger.info(`[RootTipGossip] 🗣️ Broadcasting rootTip gossip: height=${rootTip.latestHeight}, peers=${peers.length}, isOriginal=${isOriginalSender}`);

    // Broadcast to all connected peers
    this.p2pNode.broadcast("ROOT_TIP_GOSSIP", gossipMessage);
  }

  /**
   * Handle received rootTip gossip
   * 
   * This processes a gossip message and optionally forwards it to other peers
   * 
   * @param message Gossip message received
   * @param sender Node ID that sent this message
   * @returns Whether the message was processed and should trigger sync
   */
  async handleGossipMessage(
    message: RootTipGossipMessage,
    sender: string
  ): Promise<{ processed: boolean; shouldSync: boolean; shouldForward: boolean }> {
    const messageId = message.messageId;
    const currentNodeId = this.p2pNode?.nodeId || "";

    // Check if we've already seen this message
    if (this.seenMessages.has(messageId)) {
      logger.debug(`[RootTipGossip] Already processed message ${messageId.substring(0, 16)}..., ignoring`);
      return { processed: false, shouldSync: false, shouldForward: false };
    }

    // Mark as seen
    this.seenMessages.set(messageId, Date.now());

    // Check if we're in the seen set (circular propagation prevention)
    if (message.seen.includes(currentNodeId)) {
      logger.debug(`[RootTipGossip] Already in seen set for message ${messageId.substring(0, 16)}..., ignoring`);
      return { processed: false, shouldSync: false, shouldForward: false };
    }

    // Check TTL
    if (message.ttl <= 0) {
      logger.debug(`[RootTipGossip] TTL expired for message ${messageId.substring(0, 16)}..., ignoring`);
      return { processed: false, shouldSync: false, shouldForward: false };
    }

    // Add current node to seen set
    const updatedSeen = [...message.seen, currentNodeId];
    if (updatedSeen.length > this.config.maxSeenNodes) {
      // Remove oldest entries
      updatedSeen.shift();
    }

    // Determine if we should forward
    const shouldForward = message.ttl >= this.config.minTTL && this.p2pNode?.isConnected;

    // Forward to other peers (if TTL allows)
    if (shouldForward) {
      setTimeout(() => {
        this.forwardGossipMessage(message, updatedSeen, sender);
      }, this.config.gossipDelayMs);
    }

    logger.info(`[RootTipGossip] ✅ Processed gossip: height=${message.rootTip.latestHeight}, from=${sender.substring(0, 16)}..., ttl=${message.ttl}, willForward=${shouldForward}`);

    return {
      processed: true,
      shouldSync: true, // Always trigger sync check when receiving gossip
      shouldForward: shouldForward || false,
    };
  }

  /**
   * Forward a gossip message to other peers
   */
  private async forwardGossipMessage(
    originalMessage: RootTipGossipMessage,
    updatedSeen: string[],
    receivedFrom: string
  ): Promise<void> {
    if (!this.p2pNode || !this.p2pNode.isConnected) {
      return;
    }

    const peers = this.getConnectedPeers();
    
    // Filter out peers that have already seen this message
    const peersToForward = peers.filter(peerId => 
      !updatedSeen.includes(peerId) && peerId !== receivedFrom
    );

    if (peersToForward.length === 0) {
      logger.debug(`[RootTipGossip] No peers to forward to (all have seen or no peers)`);
      return;
    }

    // Create forwarded message with decremented TTL
    const forwardedMessage: RootTipGossipMessage = {
      ...originalMessage,
      ttl: originalMessage.ttl - 1,
      seen: updatedSeen,
      timestamp: Date.now(),
    };

    logger.debug(`[RootTipGossip] Forwarding gossip to ${peersToForward.length} peer(s), ttl=${forwardedMessage.ttl}`);

    // Forward to filtered peers
    if (this.p2pNode.sendToPeer) {
      for (const peerId of peersToForward) {
        this.p2pNode.sendToPeer(peerId, "ROOT_TIP_GOSSIP", forwardedMessage);
      }
    } else {
      // Fallback to broadcast (less efficient but works)
      this.p2pNode.broadcast("ROOT_TIP_GOSSIP", forwardedMessage);
    }
  }

  /**
   * Get list of connected peer IDs
   */
  private getConnectedPeers(): string[] {
    if (!this.p2pNode) return [];

    const peers: string[] = [];
    for (const [peerId, peer] of this.p2pNode.peers.entries()) {
      if (peer.connected && peer.dataChannel && peer.dataChannel.readyState === "open") {
        peers.push(peerId);
      }
    }
    return peers;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.seenCleanupInterval) {
      clearInterval(this.seenCleanupInterval);
      this.seenCleanupInterval = null;
    }
    this.seenMessages.clear();
  }
}

// Global singleton instance
let globalRootTipGossipManager: RootTipGossipManager | null = null;

/**
 * Get or create global RootTipGossipManager instance
 */
export function getRootTipGossipManager(config?: Partial<RootTipGossipConfig>): RootTipGossipManager {
  if (!globalRootTipGossipManager) {
    globalRootTipGossipManager = new RootTipGossipManager(config);
  }
  return globalRootTipGossipManager;
}

