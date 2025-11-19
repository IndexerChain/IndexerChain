/**
 * Phase 33: Intelligent Peer Quorum Manager
 * 
 * Implements intelligent peer quorum scoring system for mining safety checks.
 * Instead of requiring a fixed number of peers (e.g., 3), this system evaluates
 * peer quality, independence, and health to determine if mining is safe.
 * 
 * Features:
 * - QuorumScore calculation (0-100) for each peer
 * - IP independence detection (same IP = 0 score)
 * - Availability tracking (online time > 2 minutes)
 * - Height reliability checks
 * - Latency measurement
 * - Finality participation tracking
 * - GSN (Global Snapshot Network) contribution tracking
 * 
 * Quorum Ready Conditions:
 * - Dev/Testnet: Total score >= 80 (2 nodes)
 * - Mainnet Cold Start: Total score >= 80 (2 nodes)
 * - Mainnet Mature: Total score >= 150 (2-3 nodes)
 * - Mainnet Capacity: Total score >= 300 (multiple nodes)
 */

import type { P2PNode } from "./p2p.js";
import type { ChainContext } from "./chain.js";
import { isMainnet } from "./networkParams.js";
import { logger } from "./logger.js";

/**
 * Phase 33: Peer quality metrics for quorum scoring
 */
export interface PeerQualityMetrics {
  peerId: string;
  ipHash?: string; // IP hash from signal server (privacy-preserving)
  connectedAt: number; // Connection timestamp
  lastSeen: number; // Last seen timestamp
  onlineDuration: number; // Total online time in milliseconds
  
  // Height reliability
  reportedHeight?: number;
  heightMatchesMajority: boolean;
  
  // Latency
  avgLatencyMs?: number; // Rolling average latency
  lastPingTime?: number; // Last ping timestamp
  lastPongTime?: number; // Last pong timestamp
  
  // Finality participation
  finalityVotesSent: number;
  finalityVotesValid: number;
  
  // GSN contribution
  snapshotChunksServed: number;
  snapshotChunksValid: number;
  
  // Calculated score
  quorumScore: number; // 0-100
  scoreBreakdown: {
    ipIndependence: number; // 0-30
    availability: number; // 0-20
    heightReliability: number; // 0-20
    latency: number; // 0-10
    finalityParticipation: number; // 0-10
    gsnContribution: number; // 0-10
  };
}

/**
 * Phase 33: Quorum status
 */
export interface QuorumStatus {
  ready: boolean;
  totalScore: number;
  requiredScore: number;
  peerCount: number;
  independentPeerCount: number; // Peers with different IP hashes
  peerMetrics: PeerQualityMetrics[];
  reason?: string; // Why quorum is not ready
}

/**
 * Phase 33: Quorum thresholds by network stage
 */
export interface QuorumThresholds {
  devnet: number; // Dev/testnet threshold
  coldStart: number; // Mainnet cold start (Day 1)
  mature: number; // Mainnet mature (normal operation)
  capacity: number; // Mainnet capacity expansion (future)
}

const DEFAULT_THRESHOLDS: QuorumThresholds = {
  devnet: 80, // Allow 2 nodes in dev/testnet
  coldStart: 80, // Allow 2 nodes during mainnet cold start
  mature: 150, // Require 2-3 quality nodes in mature mainnet
  capacity: 300, // Future: multiple validation nodes
};

/**
 * Phase 35: Mainnet admission thresholds
 */
export interface MainnetAdmissionThresholds {
  quorumScore: {
    coldStart: number;
    earlyGrowth: number;
    mature: number;
    secure: number;
  };
  independentPeers: {
    coldStart: number;
    earlyGrowth: number;
    mature: number;
    secure: number;
  };
}

const DEFAULT_MAINNET_THRESHOLDS: MainnetAdmissionThresholds = {
  quorumScore: {
    coldStart: 80,
    earlyGrowth: 150,
    mature: 250,
    secure: 400,
  },
  independentPeers: {
    coldStart: 1,
    earlyGrowth: 2,
    mature: 3,
    secure: 5,
  },
};

/**
 * Phase 35: Network stage
 */
export type NetworkStage = "coldStart" | "earlyGrowth" | "mature" | "secure";

/**
 * Phase 35: Mainnet admission status
 */
export interface MainnetAdmissionStatus {
  stage: NetworkStage;
  quorumScore: number;
  requiredQuorumScore: number;
  independentPeers: number;
  requiredIndependentPeers: number;
  admissionReady: boolean;
  reasons: string[];
  suggestions: string[];
}

/**
 * Phase 33: Quorum Manager
 * 
 * Manages peer quorum scoring and determines if mining is safe
 */
export class QuorumManager {
  private p2pNode: P2PNode | null = null;
  private chainContext: ChainContext | null = null;
  private peerMetrics: Map<string, PeerQualityMetrics> = new Map();
  private updateInterval: number | null = null;
  private readonly UPDATE_INTERVAL_MS = 5000; // Update every 5 seconds
  private readonly MIN_ONLINE_DURATION_MS = 120000; // 2 minutes minimum online time
  private readonly MAX_LATENCY_MS = 200; // 200ms max latency for full score
  private readonly IP_HASH_KEY = "indexerchain_peer_ip_hashes"; // localStorage key for IP hash tracking
  
  // Track last logged values to avoid spam
  private lastLoggedStatus: {
    peerCount: number;
    independentPeerCount: number;
    totalScore: number;
  } | null = null;
  private lastLoggedAdmission: {
    stage: string;
    peerCount: number;
    independentPeerCount: number;
    totalScore: number;
  } | null = null;

  /**
   * Initialize quorum manager
   */
  initialize(p2pNode: P2PNode | null, chainContext: ChainContext | null): void {
    this.p2pNode = p2pNode;
    this.chainContext = chainContext;
    
    // Start periodic updates
    this.startUpdates();
  }

  /**
   * Start periodic quorum score updates
   */
  private startUpdates(): void {
    if (this.updateInterval) {
      if (typeof window !== "undefined") {
        clearInterval(this.updateInterval);
      }
    }
    
    if (typeof window !== "undefined") {
      this.updateInterval = window.setInterval(() => {
        this.updateQuorumScores();
      }, this.UPDATE_INTERVAL_MS);
    }
    
    // Initial update
    this.updateQuorumScores();
  }

  /**
   * Stop periodic updates
   */
  destroy(): void {
    if (this.updateInterval && typeof window !== "undefined") {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Update quorum scores for all peers
   */
  private updateQuorumScores(): void {
    if (!this.p2pNode || !this.chainContext) {
      return;
    }

    const peers = this.p2pNode.peers;
    const now = Date.now();
    
    // Get network height from chain context (for height reliability check)
    const localTip = this.chainContext.storage.getTip();
    const localHeight = localTip?.header.height ?? 0;
    
    // Get majority height from global sentinel (if available)
    // For now, use local height as reference
    const majorityHeight = localHeight;
    
    // Track IP hashes (load from localStorage)
    const ipHashes = this.loadIPHashes();
    
    // Update metrics for each peer
    for (const [peerId, peerInfo] of peers.entries()) {
      if (!peerInfo.connected) {
        continue; // Skip disconnected peers
      }
      
      let metrics = this.peerMetrics.get(peerId);
      if (!metrics) {
        metrics = {
          peerId,
          connectedAt: peerInfo.lastSeen,
          lastSeen: peerInfo.lastSeen,
          onlineDuration: 0,
          heightMatchesMajority: false,
          finalityVotesSent: 0,
          finalityVotesValid: 0,
          snapshotChunksServed: 0,
          snapshotChunksValid: 0,
          quorumScore: 0,
          scoreBreakdown: {
            ipIndependence: 0,
            availability: 0,
            heightReliability: 0,
            latency: 0,
            finalityParticipation: 0,
            gsnContribution: 0,
          },
        };
        this.peerMetrics.set(peerId, metrics);
      }
      
      // Update basic metrics
      metrics.lastSeen = peerInfo.lastSeen;
      metrics.onlineDuration = now - metrics.connectedAt;
      
      // Get IP hash from peer info (set by signal server)
      if ((peerInfo as any).ipHash) {
        const ipHash = (peerInfo as any).ipHash as string;
        metrics.ipHash = ipHash;
        ipHashes[peerId] = ipHash;
      } else if (ipHashes[peerId]) {
        const ipHash = ipHashes[peerId];
        if (ipHash) {
          metrics.ipHash = ipHash;
        }
      }
      
      // Calculate score breakdown
      this.calculatePeerScore(metrics, majorityHeight, ipHashes);
    }
    
    // Save IP hashes
    this.saveIPHashes(ipHashes);
    
    // Remove metrics for disconnected peers
    for (const [peerId] of this.peerMetrics.entries()) {
      if (!peers.has(peerId) || !peers.get(peerId)?.connected) {
        this.peerMetrics.delete(peerId);
      }
    }
  }

  /**
   * Calculate quorum score for a peer
   */
  private calculatePeerScore(
    metrics: PeerQualityMetrics,
    majorityHeight: number,
    ipHashes: Record<string, string>
  ): void {
    const breakdown = metrics.scoreBreakdown;
    
    // 1. IP Independence (0-30 points)
    // Same IP as other peers = 0 points
    // Different IP = 30 points
    if (!metrics.ipHash) {
      breakdown.ipIndependence = 0; // No IP hash = cannot verify independence
    } else {
      const sameIPCount = Object.values(ipHashes).filter(hash => hash === metrics.ipHash).length;
      if (sameIPCount > 1) {
        breakdown.ipIndependence = 0; // Same IP as other peers
      } else {
        breakdown.ipIndependence = 30; // Unique IP
      }
    }
    
    // 2. Availability (0-20 points)
    // Online > 2 minutes = 20 points
    // Online < 2 minutes = proportional score
    if (metrics.onlineDuration >= this.MIN_ONLINE_DURATION_MS) {
      breakdown.availability = 20;
    } else {
      breakdown.availability = Math.floor((metrics.onlineDuration / this.MIN_ONLINE_DURATION_MS) * 20);
    }
    
    // 3. Height Reliability (0-20 points)
    // Height matches majority = 20 points
    // Height differs = proportional penalty
    if (metrics.reportedHeight !== undefined) {
      const heightDiff = Math.abs(metrics.reportedHeight - majorityHeight);
      if (heightDiff === 0) {
        breakdown.heightReliability = 20;
      } else if (heightDiff <= 3) {
        breakdown.heightReliability = 15; // Close enough
      } else if (heightDiff <= 10) {
        breakdown.heightReliability = 10; // Somewhat behind
      } else {
        breakdown.heightReliability = 0; // Too far behind
      }
    } else {
      breakdown.heightReliability = 10; // Unknown height = partial score
    }
    
    // 4. Latency (0-10 points)
    // < 200ms = 10 points
    // > 200ms = proportional score
    if (metrics.avgLatencyMs !== undefined) {
      if (metrics.avgLatencyMs <= this.MAX_LATENCY_MS) {
        breakdown.latency = 10;
      } else {
        breakdown.latency = Math.max(0, Math.floor(10 * (this.MAX_LATENCY_MS / metrics.avgLatencyMs)));
      }
    } else {
      breakdown.latency = 5; // Unknown latency = partial score
    }
    
    // 5. Finality Participation (0-10 points)
    // Participates in finality votes = 10 points
    if (metrics.finalityVotesSent > 0) {
      const validRate = metrics.finalityVotesValid / metrics.finalityVotesSent;
      breakdown.finalityParticipation = Math.floor(validRate * 10);
    } else {
      breakdown.finalityParticipation = 0; // No participation
    }
    
    // 6. GSN Contribution (0-10 points)
    // Serves snapshot chunks = 10 points
    if (metrics.snapshotChunksServed > 0) {
      const validRate = metrics.snapshotChunksValid / metrics.snapshotChunksServed;
      breakdown.gsnContribution = Math.floor(validRate * 10);
    } else {
      breakdown.gsnContribution = 0; // No contribution
    }
    
    // Calculate total score
    metrics.quorumScore = 
      breakdown.ipIndependence +
      breakdown.availability +
      breakdown.heightReliability +
      breakdown.latency +
      breakdown.finalityParticipation +
      breakdown.gsnContribution;
  }

  /**
   * Check if we're in Genesis phase (height = 0, no blocks yet)
   * Phase 38: Genesis Quorum Mode - allows mining at height 0 with minimal requirements
   */
  isGenesisPhase(): boolean {
    if (!this.chainContext) {
      return false;
    }
    
    const localTip = this.chainContext.storage.getTip();
    const localHeight = localTip?.header.height ?? 0;
    
    // Genesis phase: local height must be 0
    if (localHeight !== 0) {
      return false;
    }
    
    // Check rootTip height from signal server (if available)
    let rootTipHeight = 0;
    if (typeof window !== "undefined" && (window as any).lastRootTipHeight !== undefined) {
      rootTipHeight = (window as any).lastRootTipHeight || 0;
    }
    
    // Genesis phase: both local and rootTip must be at height 0
    return rootTipHeight === 0;
  }

  /**
   * Get quorum status
   */
  getQuorumStatus(): QuorumStatus {
    if (!this.p2pNode || !this.chainContext) {
      return {
        ready: false,
        totalScore: 0,
        requiredScore: 0,
        peerCount: 0,
        independentPeerCount: 0,
        peerMetrics: [],
        reason: "P2P node or chain context not available",
      };
    }

    const peers = Array.from(this.p2pNode.peers.values()).filter(p => p.connected);
    const peerMetrics = Array.from(this.peerMetrics.values())
      .filter(m => peers.some(p => p.id === m.peerId))
      .sort((a, b) => b.quorumScore - a.quorumScore);
    
    // Calculate independent peer count: include all peers with IP hashes + local node
    const peerIPHashes = new Set<string>();
    
    // Add IP hashes from peer metrics
    for (const metrics of peerMetrics) {
      if (metrics.ipHash) {
        peerIPHashes.add(metrics.ipHash);
      }
    }
    
    // Also check peerInfo for IP hashes (in case metrics haven't been updated yet)
    for (const peer of peers) {
      const ipHash = (peer as any).ipHash;
      if (ipHash) {
        peerIPHashes.add(ipHash);
      }
    }
    
    // Include local node's IP hash (if available)
    const localIPHash = this.getPeerIPHash(this.p2pNode.nodeId);
    if (localIPHash) {
      peerIPHashes.add(localIPHash);
    }
    
    const independentPeerCount = peerIPHashes.size;
    
    // Phase 38: Genesis Quorum Mode - special handling for height 0
    const isGenesis = this.isGenesisPhase();
    let totalScore: number;
    let genesisReason: string | undefined;
    
    if (isGenesis) {
      // Genesis mode: Check if we meet the minimal requirements
      // Requirements: ≥2 independent IPs, online >2 minutes, bootstrapComplete
      const hasEnoughIndependentPeers = independentPeerCount >= 2;
      
      // Check if peers have been online > 2 minutes
      const hasStablePeers = peerMetrics.length > 0 && 
        peerMetrics.some(m => m.onlineDuration >= this.MIN_ONLINE_DURATION_MS);
      
      // Check bootstrapComplete (stored in window or bootstrapSync)
      let bootstrapComplete = false;
      if (typeof window !== "undefined") {
        // Check if bootstrap is complete (from bootstrapSync or App.tsx)
        bootstrapComplete = (window as any).bootstrapComplete === true || 
                           (window as any).lastBootstrapHeight !== undefined;
      }
      
      if (hasEnoughIndependentPeers && hasStablePeers && bootstrapComplete) {
        // Genesis mode: Grant full score (100) to allow mining
        totalScore = 100;
        genesisReason = "Genesis phase: Network starting, minimal requirements met";
        logger.info("[QuorumManager] 🌟 Genesis Quorum Mode activated:", {
          independentPeerCount,
          peerCount: peers.length,
          bootstrapComplete,
          reason: genesisReason,
        });
      } else {
        // Genesis mode but requirements not met
        totalScore = peerMetrics.reduce((sum, m) => sum + m.quorumScore, 0);
        genesisReason = `Genesis phase: Requirements not met (independent peers: ${independentPeerCount} < 2, stable peers: ${hasStablePeers}, bootstrap: ${bootstrapComplete})`;
      }
    } else {
      // Normal mode: Calculate score normally
      totalScore = peerMetrics.reduce((sum, m) => sum + m.quorumScore, 0);
    }
    
    // Debug logging - only log when values change or in debug mode
    const currentStatus = {
      peerCount: peers.length,
      independentPeerCount,
      totalScore,
    };
    
    const hasChanged = !this.lastLoggedStatus ||
      this.lastLoggedStatus.peerCount !== currentStatus.peerCount ||
      this.lastLoggedStatus.independentPeerCount !== currentStatus.independentPeerCount ||
      Math.abs(this.lastLoggedStatus.totalScore - currentStatus.totalScore) >= 5; // Log if score changes by 5 or more
    
    if (hasChanged) {
      this.lastLoggedStatus = currentStatus;
    }
    
    // Warning if independent peer count is 0 but peers exist (always log warnings)
    if (independentPeerCount === 0 && peers.length > 0) {
      logger.warn("[QuorumManager] ⚠️ Independent peer count is 0 but peers exist - IP hashes may not be set correctly");
    }
    
    // Determine required score based on network stage
    const isMainnetNetwork = isMainnet(this.chainContext.params);
    let requiredScore: number;
    
    if (isGenesis) {
      // Genesis mode: Require 100 score (only granted if requirements met)
      requiredScore = 100;
    } else {
      // Normal mode: Use standard thresholds
      requiredScore = this.getRequiredScore(isMainnetNetwork);
    }
    
    const ready = totalScore >= requiredScore;
    
    return {
      ready,
      totalScore,
      requiredScore,
      peerCount: peers.length,
      independentPeerCount,
      peerMetrics,
      reason: ready 
        ? (isGenesis ? genesisReason : undefined)
        : (isGenesis 
          ? genesisReason || `Genesis phase: Requirements not met (score: ${totalScore} < required: ${requiredScore})`
          : `Total score ${totalScore} < required ${requiredScore}`),
    };
  }

  /**
   * Check if quorum is ready for mining
   */
  isQuorumReady(): boolean {
    return this.getQuorumStatus().ready;
  }

  /**
   * Phase 35: Get network stage based on peer count and chain height
   */
  getNetworkStage(): NetworkStage {
    if (!this.p2pNode || !this.chainContext) {
      return "coldStart";
    }

    const peerCount = this.p2pNode.getPeerCount();
    const localTip = this.chainContext.storage.getTip();
    const height = localTip?.header.height ?? 0;
    
    // Phase 35: Determine stage based on peer count and height
    // This is more sophisticated than before
    if (peerCount >= 100) {
      return "secure"; // High security mode
    } else if (peerCount >= 20) {
      return "mature"; // Mature phase
    } else if (peerCount >= 5 || height >= 1000) {
      return "earlyGrowth"; // Early growth phase
    } else {
      return "coldStart"; // Cold start phase
    }
  }

  /**
   * Phase 35: Get mainnet admission status
   */
  getMainnetAdmissionStatus(): MainnetAdmissionStatus {
    if (!this.p2pNode || !this.chainContext) {
      return {
        stage: "coldStart",
        quorumScore: 0,
        requiredQuorumScore: 0,
        independentPeers: 0,
        requiredIndependentPeers: 0,
        admissionReady: false,
        reasons: ["P2P node or chain context not available"],
        suggestions: ["Connect to P2P network"],
      };
    }

    const quorumStatus = this.getQuorumStatus();
    const stage = this.getNetworkStage();
    
    // Debug logging - only log when values change
    if (quorumStatus.peerCount > 0) {
      const currentAdmission = {
        stage,
        peerCount: quorumStatus.peerCount,
        independentPeerCount: quorumStatus.independentPeerCount,
        totalScore: quorumStatus.totalScore,
      };
      
      const hasChanged = !this.lastLoggedAdmission ||
        this.lastLoggedAdmission.stage !== currentAdmission.stage ||
        this.lastLoggedAdmission.peerCount !== currentAdmission.peerCount ||
        this.lastLoggedAdmission.independentPeerCount !== currentAdmission.independentPeerCount ||
        Math.abs(this.lastLoggedAdmission.totalScore - currentAdmission.totalScore) >= 5; // Log if score changes by 5 or more
      
      if (hasChanged) {
        this.lastLoggedAdmission = currentAdmission;
      }
    }
    
    // Get thresholds from chain params or use defaults
    const thresholds = this.chainContext.params.mainnetQuorumThresholds || DEFAULT_MAINNET_THRESHOLDS.quorumScore;
    const peerThresholds = this.chainContext.params.mainnetMinIndependentPeers || DEFAULT_MAINNET_THRESHOLDS.independentPeers;
    
    const requiredQuorumScore = thresholds[stage];
    const requiredIndependentPeers = peerThresholds[stage];
    
    const admissionReady = 
      quorumStatus.totalScore >= requiredQuorumScore &&
      quorumStatus.independentPeerCount >= requiredIndependentPeers;
    
    const reasons: string[] = [];
    const suggestions: string[] = [];
    
    if (!admissionReady) {
      if (quorumStatus.totalScore < requiredQuorumScore) {
        reasons.push(`Quorum score ${quorumStatus.totalScore} < required ${requiredQuorumScore} (${stage} stage)`);
        suggestions.push("Wait for more high-quality peers to join the network");
      }
      
      if (quorumStatus.independentPeerCount < requiredIndependentPeers) {
        reasons.push(`Independent peers ${quorumStatus.independentPeerCount} < required ${requiredIndependentPeers} (${stage} stage)`);
        suggestions.push("Connect to peers from different IP addresses");
      }
    }
    
    return {
      stage,
      quorumScore: quorumStatus.totalScore,
      requiredQuorumScore,
      independentPeers: quorumStatus.independentPeerCount,
      requiredIndependentPeers,
      admissionReady,
      reasons,
      suggestions,
    };
  }

  /**
   * Get required score based on network stage
   * Phase 34: Support quorum debug override
   * Phase 35: Use mainnet admission thresholds
   */
  private getRequiredScore(isMainnet: boolean): number {
    // Phase 34: Quorum Debug Mode (dev/testnet only)
    if (!isMainnet && this.chainContext?.params.quorumDebugOverride) {
      return 20; // Very low threshold for debugging
    }
    
    if (!isMainnet) {
      return DEFAULT_THRESHOLDS.devnet;
    }
    
    // Phase 35: Use mainnet admission thresholds
    if (isMainnet && this.chainContext) {
      const stage = this.getNetworkStage();
      const thresholds = this.chainContext.params.mainnetQuorumThresholds || DEFAULT_MAINNET_THRESHOLDS.quorumScore;
      return thresholds[stage];
    }
    
    // Fallback to old logic
    if (!this.chainContext) {
      return DEFAULT_THRESHOLDS.mature;
    }
    
    const localTip = this.chainContext.storage.getTip();
    const height = localTip?.header.height ?? 0;
    
    if (height < 100) {
      return DEFAULT_THRESHOLDS.coldStart;
    } else if (height < 1000) {
      return DEFAULT_THRESHOLDS.mature;
    } else {
      return DEFAULT_THRESHOLDS.capacity;
    }
  }

  /**
   * Update peer height (called when receiving height from peer)
   */
  updatePeerHeight(peerId: string, height: number): void {
    const metrics = this.peerMetrics.get(peerId);
    if (metrics) {
      metrics.reportedHeight = height;
    }
  }

  /**
   * Update peer latency (called when receiving pong)
   */
  updatePeerLatency(peerId: string, latencyMs: number): void {
    const metrics = this.peerMetrics.get(peerId);
    if (metrics) {
      if (metrics.avgLatencyMs === undefined) {
        metrics.avgLatencyMs = latencyMs;
      } else {
        // Rolling average
        metrics.avgLatencyMs = (metrics.avgLatencyMs * 0.7) + (latencyMs * 0.3);
      }
    }
  }

  /**
   * Record finality vote from peer
   */
  recordFinalityVote(peerId: string, valid: boolean): void {
    const metrics = this.peerMetrics.get(peerId);
    if (metrics) {
      metrics.finalityVotesSent++;
      if (valid) {
        metrics.finalityVotesValid++;
      }
    }
  }

  /**
   * Record snapshot chunk served by peer
   */
  recordSnapshotChunk(peerId: string, valid: boolean): void {
    const metrics = this.peerMetrics.get(peerId);
    if (metrics) {
      metrics.snapshotChunksServed++;
      if (valid) {
        metrics.snapshotChunksValid++;
      }
    }
  }

  /**
   * Set IP hash for a peer (called by signal server)
   */
  setPeerIPHash(peerId: string, ipHash: string): void {
    const metrics = this.peerMetrics.get(peerId);
    if (metrics) {
      metrics.ipHash = ipHash;
    }
    
    // Also update peer info
    if (this.p2pNode) {
      const peerInfo = this.p2pNode.peers.get(peerId);
      if (peerInfo) {
        (peerInfo as any).ipHash = ipHash;
      }
    }
    
    // Save to localStorage
    const ipHashes = this.loadIPHashes();
    ipHashes[peerId] = ipHash;
    this.saveIPHashes(ipHashes);
  }

  /**
   * Load IP hashes from localStorage
   */
  private loadIPHashes(): Record<string, string> {
    if (typeof localStorage === "undefined") {
      return {};
    }
    
    try {
      const stored = localStorage.getItem(this.IP_HASH_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn("[QuorumManager] Failed to load IP hashes:", e);
    }
    
    return {};
  }

  /**
   * Save IP hashes to localStorage
   */
  private saveIPHashes(ipHashes: Record<string, string>): void {
    if (typeof localStorage === "undefined") {
      return;
    }
    
    try {
      localStorage.setItem(this.IP_HASH_KEY, JSON.stringify(ipHashes));
    } catch (e) {
      console.warn("[QuorumManager] Failed to save IP hashes:", e);
    }
  }

  /**
   * Phase 36: Get IP hash for a peer
   */
  getPeerIPHash(peerId: string): string | undefined {
    const metrics = this.peerMetrics.get(peerId);
    if (metrics?.ipHash) {
      return metrics.ipHash;
    }
    
    // Try to get from peer info
    if (this.p2pNode) {
      const peerInfo = this.p2pNode.peers.get(peerId);
      if (peerInfo?.ipHash) {
        return peerInfo.ipHash;
      }
    }
    
    // Try to get from localStorage
    const ipHashes = this.loadIPHashes();
    return ipHashes[peerId];
  }
}

/**
 * Global quorum manager instance
 */
let quorumManagerInstance: QuorumManager | null = null;

/**
 * Get or create quorum manager instance
 */
export function getQuorumManager(): QuorumManager {
  if (!quorumManagerInstance) {
    quorumManagerInstance = new QuorumManager();
  }
  return quorumManagerInstance;
}

