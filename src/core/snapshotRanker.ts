/**
 * Snapshot Ranker
 * 
 * Phase 20: Global Snapshot Network - Snapshot Source Ranking
 * 
 * Ranks snapshot sources based on multiple factors:
 * - Latency
 * - Integrity (verification success rate)
 * - Freshness (snapshot height)
 * - Trust (historical reliability)
 */

import type { SnapshotMeta, ChainParams } from "./types.js";

/**
 * Snapshot source information
 */
export interface SnapshotSource {
  nodeId: string;
  snapshotMeta: SnapshotMeta;
  latency: number; // ms
  integrityScore: number; // 0-1, based on verification success rate
  trustScore: number; // 0-1, based on historical reliability
  lastSeen: number; // timestamp
  requestCount: number; // number of times requested from this source
  successCount: number; // number of successful downloads
  failureCount: number; // number of failed downloads
}

/**
 * Ranking factors and weights
 * Phase 21: Added peerScore weight
 */
const RANKING_WEIGHTS = {
  latency: 0.25, // Lower is better
  integrity: 0.25, // Higher is better
  freshness: 0.2, // Higher height is better
  trust: 0.15, // Higher is better
  peerScore: 0.15, // Phase 21: Peer reputation score (0-100 normalized to 0-1)
};

/**
 * Snapshot Ranker
 * 
 * Manages ranking of snapshot sources
 * Phase 21: Considers peer reputation in ranking
 */
export class SnapshotRanker {
  private sources: Map<string, SnapshotSource> = new Map();
  private readonly MAX_SOURCES = 100; // Limit number of tracked sources
  private params: ChainParams | null = null;
  
  /**
   * Add or update a snapshot source
   */
  addSource(nodeId: string, snapshotMeta: SnapshotMeta, latency: number): void {
    const existing = this.sources.get(nodeId);
    
    if (existing) {
      // Update existing source
      existing.snapshotMeta = snapshotMeta;
      existing.latency = latency;
      existing.lastSeen = Date.now();
    } else {
      // Create new source
      if (this.sources.size >= this.MAX_SOURCES) {
        // Remove oldest source
        const oldest = Array.from(this.sources.values())
          .sort((a, b) => a.lastSeen - b.lastSeen)[0];
        this.sources.delete(oldest.nodeId);
      }
      
      this.sources.set(nodeId, {
        nodeId,
        snapshotMeta,
        latency,
        integrityScore: 1.0, // Start with perfect score
        trustScore: 0.5, // Start with neutral trust
        lastSeen: Date.now(),
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
      });
    }
  }
  
  /**
   * Record successful download
   */
  recordSuccess(nodeId: string): void {
    const source = this.sources.get(nodeId);
    if (source) {
      source.successCount++;
      source.requestCount++;
      // Update integrity score (exponential moving average)
      source.integrityScore = source.integrityScore * 0.9 + 1.0 * 0.1;
      // Update trust score
      source.trustScore = Math.min(1.0, source.trustScore + 0.05);
    }
  }
  
  /**
   * Record failed download
   */
  recordFailure(nodeId: string): void {
    const source = this.sources.get(nodeId);
    if (source) {
      source.failureCount++;
      source.requestCount++;
      // Update integrity score
      source.integrityScore = source.integrityScore * 0.9 + 0.0 * 0.1;
      // Update trust score (penalize more)
      source.trustScore = Math.max(0.0, source.trustScore - 0.1);
    }
  }
  
  /**
   * Get ranked sources for a specific snapshot height
   */
  getRankedSources(targetHeight?: number): SnapshotSource[] {
    const sources = Array.from(this.sources.values());
    
    // Filter by target height if specified
    const filtered = targetHeight
      ? sources.filter(s => s.snapshotMeta.height >= targetHeight)
      : sources;
    
    // Calculate scores and sort
    const ranked = filtered
      .map(source => ({
        source,
        score: this.calculateScore(source),
      }))
      .sort((a, b) => b.score - a.score)
      .map(item => item.source);
    
    return ranked;
  }
  
  /**
   * Set chain params (for peer reputation access)
   * Phase 21
   */
  setParams(params: ChainParams): void {
    this.params = params;
  }

  /**
   * Calculate composite score for a source
   * Phase 21: Includes peer reputation score
   */
  private calculateScore(source: SnapshotSource): number {
    // Normalize latency (lower is better, so invert)
    // Assume max latency of 5000ms
    const latencyScore = Math.max(0, 1 - source.latency / 5000);
    
    // Freshness score (higher height is better)
    // Normalize based on current height (assume max reasonable height difference)
    const freshnessScore = Math.min(1.0, source.snapshotMeta.height / 10000);
    
    // Phase 21: Get peer reputation score
    let peerScoreNormalized = 0.5; // Default neutral score
    if (this.params?.peerScoreEnabled) {
      try {
        const { getGlobalPeerReputationManager } = require("./peerReputation.js");
        const reputationManager = getGlobalPeerReputationManager(this.params);
        const effectiveScore = reputationManager.getEffectiveScore(source.nodeId);
        peerScoreNormalized = effectiveScore / 100; // Normalize 0-100 to 0-1
        
        // If peer is banned or low trust, significantly reduce score
        const trustLevel = reputationManager.getTrustLevel(source.nodeId);
        if (trustLevel === "banned") {
          peerScoreNormalized = 0; // Banned peers get 0
        } else if (trustLevel === "low") {
          peerScoreNormalized *= 0.3; // Low trust peers get 30% of their score
        }
      } catch (error) {
        // If reputation manager not available, use default
        console.warn("[Phase 21] Could not access peer reputation manager:", error);
      }
    }
    
    // Composite score
    const score =
      latencyScore * RANKING_WEIGHTS.latency +
      source.integrityScore * RANKING_WEIGHTS.integrity +
      freshnessScore * RANKING_WEIGHTS.freshness +
      source.trustScore * RANKING_WEIGHTS.trust +
      peerScoreNormalized * RANKING_WEIGHTS.peerScore;
    
    return score;
  }
  
  /**
   * Get best source for a snapshot height
   */
  getBestSource(targetHeight?: number): SnapshotSource | null {
    const ranked = this.getRankedSources(targetHeight);
    return ranked.length > 0 ? ranked[0] : null;
  }
  
  /**
   * Get top N sources
   */
  getTopSources(n: number, targetHeight?: number): SnapshotSource[] {
    const ranked = this.getRankedSources(targetHeight);
    return ranked.slice(0, n);
  }
  
  /**
   * Clean up stale sources
   */
  cleanupStale(maxAge: number = 300_000): void {
    const now = Date.now();
    const stale: string[] = [];
    
    for (const [nodeId, source] of this.sources.entries()) {
      if (now - source.lastSeen > maxAge) {
        stale.push(nodeId);
      }
    }
    
    for (const nodeId of stale) {
      this.sources.delete(nodeId);
    }
    
    if (stale.length > 0) {
      console.log(`[Phase 20] Cleaned up ${stale.length} stale snapshot sources`);
    }
  }
  
  /**
   * Get statistics
   */
  getStats(): {
    totalSources: number;
    averageLatency: number;
    averageIntegrity: number;
    averageTrust: number;
  } {
    const sources = Array.from(this.sources.values());
    
    if (sources.length === 0) {
      return {
        totalSources: 0,
        averageLatency: 0,
        averageIntegrity: 0,
        averageTrust: 0,
      };
    }
    
    const avgLatency = sources.reduce((sum, s) => sum + s.latency, 0) / sources.length;
    const avgIntegrity = sources.reduce((sum, s) => sum + s.integrityScore, 0) / sources.length;
    const avgTrust = sources.reduce((sum, s) => sum + s.trustScore, 0) / sources.length;
    
    return {
      totalSources: sources.length,
      averageLatency: avgLatency,
      averageIntegrity: avgIntegrity,
      averageTrust: avgTrust,
    };
  }
}

