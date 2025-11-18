/**
 * Peer Reputation Manager
 * 
 * Phase 21: Peer Reputation & Security Hardening
 * 
 * Manages peer reputation scores based on:
 * - Data quality (valid/invalid blocks, headers, snapshots)
 * - Online stability (connection/disconnection patterns)
 * - Service quality (response times, timeouts)
 * - Node performance (work completion in global miner pool)
 */

import type { PeerId, PeerScore, ChainParams } from "./types.js";

/**
 * Score adjustment constants
 */
const SCORE_ADJUSTMENTS = {
  VALID_BLOCK: 2,
  VALID_BLOCK_FAST: 1, // Additional bonus for latency < 200ms
  VALID_HEADER: 1,
  VALID_SNAPSHOT_CHUNK: 0.5,
  RESPONSE_OK: 0.2,
  INVALID_BLOCK: -20,
  INVALID_HEADER: -10,
  INVALID_SNAPSHOT_CHUNK: -10,
  RESPONSE_TIMEOUT: -1,
  WORK_COMPLETED: 2,
  WORK_FAILED: -5,
} as const;

const INITIAL_SCORE = 50; // Neutral starting score
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const FAST_LATENCY_THRESHOLD_MS = 200; // Latency threshold for bonus

/**
 * Peer Reputation Manager
 * 
 * Tracks and manages peer reputation scores
 */
export class PeerReputationManager {
  private scores: Map<PeerId, PeerScore> = new Map();
  private params: ChainParams;
  private lastTickTime: number = Date.now();

  constructor(params: ChainParams) {
    this.params = params;
  }

  /**
   * Get peer score (or create default if not exists)
   */
  getScore(peerId: PeerId): PeerScore {
    let score = this.scores.get(peerId);
    if (!score) {
      score = this.createDefaultScore(peerId);
      this.scores.set(peerId, score);
    }
    return score;
  }

  /**
   * Get all peer scores
   */
  getAllScores(): PeerScore[] {
    return Array.from(this.scores.values());
  }

  /**
   * Get effective score (considering ban status)
   */
  getEffectiveScore(peerId: PeerId): number {
    const score = this.getScore(peerId);
    if (this.isBanned(peerId)) {
      return 0; // Banned peers have 0 effective score
    }
    return score.score;
  }

  /**
   * Get trust level
   */
  getTrustLevel(peerId: PeerId): PeerScore["trustLevel"] {
    const score = this.getScore(peerId);
    return score.trustLevel;
  }

  /**
   * Check if peer is banned
   */
  isBanned(peerId: PeerId, now?: number): boolean {
    const score = this.getScore(peerId);
    if (score.trustLevel !== "banned") {
      return false;
    }
    const currentTime = now ?? Date.now();
    if (score.bannedUntil && currentTime < score.bannedUntil) {
      return true;
    }
    // Ban expired, restore to low trust
    if (score.bannedUntil && currentTime >= score.bannedUntil) {
      score.trustLevel = "low";
      score.bannedUntil = undefined;
    }
    return false;
  }

  /**
   * Create default score for a new peer
   */
  private createDefaultScore(peerId: PeerId): PeerScore {
    return {
      peerId,
      lastSeenAt: Date.now(),
      connectedAt: Date.now(),
      blocksServed: 0,
      blocksInvalid: 0,
      snapshotsServed: 0,
      snapshotsInvalid: 0,
      headersServed: 0,
      requestsSent: 0,
      responsesOk: 0,
      responsesTimeout: 0,
      workAssigned: 0,
      workCompleted: 0,
      workFailed: 0,
      score: INITIAL_SCORE,
      trustLevel: "normal",
    };
  }

  /**
   * Update score and clamp to valid range
   */
  private updateScore(peerId: PeerId, delta: number): void {
    const score = this.getScore(peerId);
    score.score = Math.max(SCORE_MIN, Math.min(SCORE_MAX, score.score + delta));
    this.updateTrustLevel(peerId);
  }

  /**
   * Update trust level based on score
   */
  private updateTrustLevel(peerId: PeerId): void {
    const score = this.getScore(peerId);
    const banThreshold = this.params.peerBanThreshold ?? 20;
    
    if (score.score >= 80) {
      score.trustLevel = "trusted";
    } else if (score.score >= 50) {
      score.trustLevel = "normal";
    } else if (score.score >= banThreshold) {
      score.trustLevel = "low";
    } else {
      // Score below ban threshold
      if (score.trustLevel !== "banned") {
        score.trustLevel = "banned";
        const banDuration = this.params.peerBanDurationMs ?? 600_000; // 10 minutes
        score.bannedUntil = Date.now() + banDuration;
      }
    }
  }

  /**
   * Update average latency (exponential moving average)
   */
  private updateLatency(peerId: PeerId, latencyMs: number): void {
    const score = this.getScore(peerId);
    if (score.avgLatencyMs === undefined) {
      score.avgLatencyMs = latencyMs;
    } else {
      // Exponential moving average with alpha = 0.3
      score.avgLatencyMs = score.avgLatencyMs * 0.7 + latencyMs * 0.3;
    }
  }

  // ========== Event Handlers ==========

  /**
   * Peer connected
   */
  onPeerConnected(peerId: PeerId): void {
    const score = this.getScore(peerId);
    if (!score.connectedAt) {
      score.connectedAt = Date.now();
    }
    score.lastSeenAt = Date.now();
  }

  /**
   * Peer disconnected
   */
  onPeerDisconnected(peerId: PeerId): void {
    const score = this.getScore(peerId);
    score.lastSeenAt = Date.now();
  }

  /**
   * Valid block received from peer
   */
  onValidBlockFrom(peerId: PeerId, latencyMs?: number): void {
    const score = this.getScore(peerId);
    score.blocksServed++;
    score.lastSeenAt = Date.now();
    
    let adjustment = SCORE_ADJUSTMENTS.VALID_BLOCK;
    if (latencyMs !== undefined) {
      this.updateLatency(peerId, latencyMs);
      if (latencyMs < FAST_LATENCY_THRESHOLD_MS) {
        adjustment += SCORE_ADJUSTMENTS.VALID_BLOCK_FAST;
      }
    }
    
    this.updateScore(peerId, adjustment);
  }

  /**
   * Invalid block received from peer
   */
  onInvalidBlockFrom(peerId: PeerId): void {
    const score = this.getScore(peerId);
    score.blocksInvalid++;
    score.lastSeenAt = Date.now();
    this.updateScore(peerId, SCORE_ADJUSTMENTS.INVALID_BLOCK);
  }

  /**
   * Valid header received from peer
   */
  onValidHeaderFrom(peerId: PeerId, latencyMs?: number): void {
    const score = this.getScore(peerId);
    score.headersServed++;
    score.lastSeenAt = Date.now();
    
    if (latencyMs !== undefined) {
      this.updateLatency(peerId, latencyMs);
    }
    
    this.updateScore(peerId, SCORE_ADJUSTMENTS.VALID_HEADER);
  }

  /**
   * Invalid header received from peer
   */
  onInvalidHeaderFrom(peerId: PeerId): void {
    const score = this.getScore(peerId);
    score.lastSeenAt = Date.now();
    this.updateScore(peerId, SCORE_ADJUSTMENTS.INVALID_HEADER);
  }

  /**
   * Valid snapshot chunk received from peer
   */
  onValidSnapshotChunkFrom(peerId: PeerId, latencyMs?: number): void {
    const score = this.getScore(peerId);
    score.snapshotsServed++;
    score.lastSeenAt = Date.now();
    
    if (latencyMs !== undefined) {
      this.updateLatency(peerId, latencyMs);
    }
    
    this.updateScore(peerId, SCORE_ADJUSTMENTS.VALID_SNAPSHOT_CHUNK);
  }

  /**
   * Invalid snapshot chunk received from peer
   */
  onInvalidSnapshotChunkFrom(peerId: PeerId): void {
    const score = this.getScore(peerId);
    score.snapshotsInvalid++;
    score.lastSeenAt = Date.now();
    this.updateScore(peerId, SCORE_ADJUSTMENTS.INVALID_SNAPSHOT_CHUNK);
  }

  /**
   * Request sent to peer
   */
  onRequestSent(peerId: PeerId): void {
    const score = this.getScore(peerId);
    score.requestsSent++;
    score.lastSeenAt = Date.now();
  }

  /**
   * Successful response received from peer
   */
  onResponseOk(peerId: PeerId, latencyMs?: number): void {
    const score = this.getScore(peerId);
    score.responsesOk++;
    score.lastSeenAt = Date.now();
    
    if (latencyMs !== undefined) {
      this.updateLatency(peerId, latencyMs);
    }
    
    this.updateScore(peerId, SCORE_ADJUSTMENTS.RESPONSE_OK);
  }

  /**
   * Response timeout from peer
   */
  onResponseTimeout(peerId: PeerId): void {
    const score = this.getScore(peerId);
    score.responsesTimeout++;
    score.lastSeenAt = Date.now();
    this.updateScore(peerId, SCORE_ADJUSTMENTS.RESPONSE_TIMEOUT);
  }

  /**
   * Work assigned to peer (in global miner pool)
   */
  onWorkAssigned(peerId: PeerId): void {
    const score = this.getScore(peerId);
    score.workAssigned++;
    score.lastSeenAt = Date.now();
  }

  /**
   * Work completed successfully by peer
   */
  onWorkCompleted(peerId: PeerId): void {
    const score = this.getScore(peerId);
    score.workCompleted++;
    score.lastSeenAt = Date.now();
    this.updateScore(peerId, SCORE_ADJUSTMENTS.WORK_COMPLETED);
  }

  /**
   * Work failed/abandoned by peer
   */
  onWorkFailed(peerId: PeerId): void {
    const score = this.getScore(peerId);
    score.workFailed++;
    score.lastSeenAt = Date.now();
    this.updateScore(peerId, SCORE_ADJUSTMENTS.WORK_FAILED);
  }

  /**
   * Periodic tick for score decay and auto-unban
   */
  tick(now?: number): void {
    if (!this.params.peerScoreEnabled) {
      return;
    }

    const currentTime = now ?? Date.now();
    const decayInterval = this.params.peerScoreDecayIntervalMs ?? 60_000; // 1 minute
    const halfLife = this.params.peerScoreHalfLifeMs ?? 300_000; // 5 minutes

    // Only decay if enough time has passed
    if (currentTime - this.lastTickTime < decayInterval) {
      return;
    }

    const elapsed = currentTime - this.lastTickTime;
    this.lastTickTime = currentTime;

    // Decay scores toward neutral (50)
    for (const score of this.scores.values()) {
      // Skip banned peers (they will be handled separately)
      if (score.trustLevel === "banned") {
        // Check if ban expired
        if (score.bannedUntil && currentTime >= score.bannedUntil) {
          score.trustLevel = "low";
          score.bannedUntil = undefined;
        }
        continue;
      }

      // Exponential decay toward 50
      const target = INITIAL_SCORE;
      const current = score.score;
      const diff = current - target;
      
      // Calculate decay factor based on half-life
      const decayFactor = Math.pow(0.5, elapsed / halfLife);
      const newScore = target + diff * decayFactor;
      
      score.score = Math.max(SCORE_MIN, Math.min(SCORE_MAX, newScore));
      this.updateTrustLevel(score.peerId);
    }
  }

  /**
   * Reset all scores (for debugging/testing)
   */
  reset(): void {
    this.scores.clear();
  }

  /**
   * Force ban a peer (for manual intervention)
   */
  forceBan(peerId: PeerId, durationMs?: number): void {
    const score = this.getScore(peerId);
    score.trustLevel = "banned";
    const banDuration = durationMs ?? (this.params.peerBanDurationMs ?? 600_000);
    score.bannedUntil = Date.now() + banDuration;
    score.score = Math.min(score.score, (this.params.peerBanThreshold ?? 20) - 1);
  }

  /**
   * Unban a peer (for manual intervention)
   */
  unban(peerId: PeerId): void {
    const score = this.getScore(peerId);
    if (score.trustLevel === "banned") {
      score.trustLevel = "low";
      score.bannedUntil = undefined;
    }
  }

  /**
   * Load scores from persistence (localStorage)
   */
  loadFromPersistence(): void {
    try {
      const stored = localStorage.getItem("indexerchain_peer_scores_v1");
      if (!stored) return;

      const data = JSON.parse(stored) as Array<{
        peerId: PeerId;
        score: number;
        trustLevel: PeerScore["trustLevel"];
        bannedUntil?: number;
        lastSeenAt: number;
      }>;

      for (const item of data) {
        const score = this.getScore(item.peerId);
        score.score = item.score;
        score.trustLevel = item.trustLevel;
        score.bannedUntil = item.bannedUntil;
        score.lastSeenAt = item.lastSeenAt;
      }
    } catch (error) {
      console.warn("[Phase 21] Failed to load peer scores from persistence:", error);
    }
  }

  /**
   * Save scores to persistence (localStorage)
   */
  saveToPersistence(): void {
    try {
      const data = Array.from(this.scores.values()).map((score) => ({
        peerId: score.peerId,
        score: score.score,
        trustLevel: score.trustLevel,
        bannedUntil: score.bannedUntil,
        lastSeenAt: score.lastSeenAt,
      }));

      localStorage.setItem("indexerchain_peer_scores_v1", JSON.stringify(data));
    } catch (error) {
      console.warn("[Phase 21] Failed to save peer scores to persistence:", error);
    }
  }
}

/**
 * Global peer reputation manager instance
 */
let globalPeerReputationManager: PeerReputationManager | null = null;

/**
 * Get or create global peer reputation manager
 */
export function getGlobalPeerReputationManager(params: ChainParams): PeerReputationManager {
  if (!globalPeerReputationManager) {
    globalPeerReputationManager = new PeerReputationManager(params);
    globalPeerReputationManager.loadFromPersistence();
  }
  return globalPeerReputationManager;
}

