/**
 * Phase 36: State Commit Gossip
 * 
 * Broadcasts and collects state commitments from all peers to ensure
 * cross-peer state consistency. Each node broadcasts its state commitment
 * every 10 seconds and maintains a table of peer state commitments.
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { getQuorumManager } from "./quorumManager.js";

/**
 * State commit information from a peer
 */
export interface PeerStateCommit {
  peerId: string;
  height: number;
  stateCommitment: string;
  tipHash: string;
  timestamp: number;
  ipHash?: string; // Phase 33: IP hash for independence check
}

/**
 * State commit table (grouped by height)
 */
export interface StateCommitTable {
  [height: number]: PeerStateCommit[];
}

/**
 * State Commit Gossip Manager
 * 
 * Manages broadcasting and collecting state commitments from peers
 */
export class StateCommitGossip {
  private chainContext: ChainContext | null = null;
  private p2pNode: P2PNode | null = null;
  private stateCommitTable: StateCommitTable = {};
  private broadcastInterval: any = null;
  private readonly BROADCAST_INTERVAL_MS = 10000; // Broadcast every 10 seconds
  private readonly MAX_TABLE_AGE_MS = 60000; // Remove entries older than 60 seconds

  private static instance: StateCommitGossip;

  private constructor() {}

  static getInstance(): StateCommitGossip {
    if (!StateCommitGossip.instance) {
      StateCommitGossip.instance = new StateCommitGossip();
    }
    return StateCommitGossip.instance;
  }

  /**
   * Initialize the gossip manager
   */
  initialize(chainContext: ChainContext, p2pNode: P2PNode): void {
    this.chainContext = chainContext;
    this.p2pNode = p2pNode;
    this.startBroadcasting();
  }

  /**
   * Start broadcasting state commitments
   */
  private startBroadcasting(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }

    this.broadcastInterval = setInterval(() => {
      this.broadcastStateCommit();
    }, this.BROADCAST_INTERVAL_MS);

    // Broadcast immediately
    this.broadcastStateCommit();
  }

  /**
   * Broadcast our state commitment to all peers
   */
  private broadcastStateCommit(): void {
    if (!this.chainContext || !this.p2pNode || !this.p2pNode.isConnected) {
      return;
    }

    const tip = this.chainContext.storage.getTip();
    if (!tip) {
      return;
    }

    const stateCommitment = tip.header.stateCommitment || "";
    const tipHash = tip.hash;
    const height = tip.header.height;

    // Get our IP hash from quorum manager
    const quorumManager = getQuorumManager();
    const ourIPHash = quorumManager.getPeerIPHash(this.p2pNode.nodeId) || "";

    const messageData = {
      height,
      stateCommitment,
      tipHash,
      peerId: this.p2pNode.nodeId,
      ipHash: ourIPHash,
      timestamp: Date.now(),
    };

    // Broadcast to all connected peers using P2P broadcast method
    // This ensures proper message format (type + data)
    if (this.p2pNode.broadcast) {
      this.p2pNode.broadcast("STATE_COMMIT_GOSSIP", messageData);
    } else {
      // Fallback: send directly via dataChannel (legacy format)
      const peers = Array.from(this.p2pNode.peers.values()).filter(p => p.connected);
      for (const peer of peers) {
        if (peer.dataChannel && peer.dataChannel.readyState === "open") {
          try {
            // Send in P2PMessage format
            const message = {
              type: "STATE_COMMIT_GOSSIP",
              data: messageData,
              sender: this.p2pNode.nodeId,
              messageId: `${this.p2pNode.nodeId}_${Date.now()}_${Math.random()}`,
            };
            peer.dataChannel.send(JSON.stringify(message));
          } catch (error) {
          }
        }
      }
    }

    // Also store our own state commit in the table
    this.handleStateCommit({
      peerId: this.p2pNode.nodeId,
      height,
      stateCommitment,
      tipHash,
      timestamp: Date.now(),
      ipHash: ourIPHash,
    });
  }

  /**
   * Handle incoming state commit from a peer
   */
  handleStateCommit(commit: PeerStateCommit): void {
    if (!this.stateCommitTable[commit.height]) {
      this.stateCommitTable[commit.height] = [];
    }

    // Remove old entry for this peer at this height (if exists)
    const table = this.stateCommitTable[commit.height];
    const existingIndex = table.findIndex(c => c.peerId === commit.peerId);
    if (existingIndex >= 0) {
      table.splice(existingIndex, 1);
    }

    // Add new entry
    table.push(commit);

    // Clean up old entries
    this.cleanupOldEntries();
  }

  /**
   * Clean up old entries from the table
   */
  private cleanupOldEntries(): void {
    const now = Date.now();
    for (const height in this.stateCommitTable) {
      this.stateCommitTable[height] = this.stateCommitTable[height].filter(
        commit => now - commit.timestamp < this.MAX_TABLE_AGE_MS
      );

      // Remove empty arrays
      if (this.stateCommitTable[height].length === 0) {
        delete this.stateCommitTable[height];
      }
    }
  }

  /**
   * Get state commit table for a specific height
   */
  getStateCommitsForHeight(height: number): PeerStateCommit[] {
    return this.stateCommitTable[height] || [];
  }

  /**
   * Get the latest height with state commits
   */
  getLatestHeight(): number {
    const heights = Object.keys(this.stateCommitTable).map(Number).sort((a, b) => b - a);
    return heights[0] || 0;
  }

  /**
   * Get majority state commitment for a height
   * Returns the state commitment that appears most frequently (weighted by independent IPs)
   */
  getMajorityStateCommit(height: number): {
    stateCommitment: string;
    tipHash: string;
    count: number;
    independentCount: number;
    quorum: number; // Percentage of independent peers
  } | null {
    const commits = this.getStateCommitsForHeight(height);
    if (commits.length === 0) {
      return null;
    }

    // Group by state commitment
    const groups: Map<string, { commits: PeerStateCommit[]; ipHashes: Set<string> }> = new Map();

    for (const commit of commits) {
      const key = `${commit.stateCommitment}:${commit.tipHash}`;
      if (!groups.has(key)) {
        groups.set(key, { commits: [], ipHashes: new Set() });
      }
      const group = groups.get(key)!;
      group.commits.push(commit);
      if (commit.ipHash) {
        group.ipHashes.add(commit.ipHash);
      }
    }

    // Find the group with the most independent peers
    let maxIndependentCount = 0;
    let majorityGroup: { commits: PeerStateCommit[]; ipHashes: Set<string> } | null = null;
    let majorityKey: string | null = null;

    for (const [key, group] of groups.entries()) {
      const independentCount = group.ipHashes.size;
      if (independentCount > maxIndependentCount) {
        maxIndependentCount = independentCount;
        majorityGroup = group;
        majorityKey = key;
      }
    }

    if (!majorityGroup || !majorityKey) {
      return null;
    }

    // Get total independent peer count (from quorum manager)
    const quorumManager = getQuorumManager();
    const totalIndependentPeers = quorumManager.getQuorumStatus?.()?.independentPeerCount || 1;

    const [stateCommitment, tipHash] = majorityKey.split(":");
    const quorum = totalIndependentPeers > 0
      ? (maxIndependentCount / totalIndependentPeers) * 100
      : 0;

    return {
      stateCommitment,
      tipHash,
      count: majorityGroup.commits.length,
      independentCount: maxIndependentCount,
      quorum,
    };
  }

  /**
   * Get full state commit table
   */
  getStateCommitTable(): StateCommitTable {
    return { ...this.stateCommitTable };
  }

  /**
   * Check if we've received state commits recently
   */
  hasRecentStateCommits(maxAgeMs: number = 30000): boolean {
    const now = Date.now();
    const latestHeight = this.getLatestHeight();
    const commits = this.getStateCommitsForHeight(latestHeight);
    
    if (commits.length === 0) {
      return false;
    }

    // Check if any commit is recent
    return commits.some(commit => now - commit.timestamp < maxAgeMs);
  }

  /**
   * Destroy the gossip manager
   */
  destroy(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
    this.stateCommitTable = {};
    this.chainContext = null;
    this.p2pNode = null;
  }
}

/**
 * Get the singleton instance
 */
export const getStateCommitGossip = () => StateCommitGossip.getInstance();

