/**
 * Snapshot Seeder
 * 
 * Phase 20: Global Snapshot Network - Auto Seeding
 * 
 * Automatically seeds snapshots to other nodes in the network,
 * similar to BitTorrent seeding.
 */

import type { BrowserP2PNode } from "./p2p.js";
import type { SnapshotMeta, SnapshotData } from "./types.js";
import { chunkSnapshot, type ChunkedSnapshotInfo, type SnapshotChunk } from "./snapshotChunker.js";
import { loadSnapshotByHeightSync, loadAllSnapshotMeta } from "./snapshot.js";
import { logger } from "./logger.js";

/**
 * Seeding configuration
 */
export interface SeedingConfig {
  maxCachedSnapshots: number; // Default: 5
  autoSeed: boolean; // Default: true
}

const DEFAULT_CONFIG: SeedingConfig = {
  maxCachedSnapshots: 5,
  autoSeed: true,
};

/**
 * Cached snapshot
 */
interface CachedSnapshot {
  meta: SnapshotMeta;
  data: SnapshotData;
  chunkedInfo: ChunkedSnapshotInfo;
  chunks: SnapshotChunk[];
  lastAccessed: number;
}

/**
 * Snapshot Seeder
 * 
 * Manages automatic seeding of snapshots to other nodes
 */
export class SnapshotSeeder {
  private p2pNode: BrowserP2PNode | null = null;
  private cachedSnapshots: Map<string, CachedSnapshot> = new Map();
  private config: SeedingConfig;
  private activeRequests: Map<string, {
    nodeId: string;
    snapshotId: string;
    sentChunks: Set<number>;
    startTime: number;
  }> = new Map();
  
  constructor(config: Partial<SeedingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Initialize with P2P node
   */
  initialize(p2pNode: BrowserP2PNode): void {
    this.p2pNode = p2pNode;
    this.setupMessageHandlers();
    this.loadCachedSnapshots();
  }
  
  /**
   * Setup P2P message handlers
   */
  private setupMessageHandlers(): void {
    if (!this.p2pNode) return;
    
    // Handle REQUEST_SNAPSHOT_META
    this.p2pNode.onMessage("REQUEST_SNAPSHOT_META", (request: { targetHeight?: number }, sender: string) => {
      if (!this.config.autoSeed) return;
      
      const allMetas = loadAllSnapshotMeta();
      const targetHeight = request?.targetHeight;
      const filtered = targetHeight
        ? allMetas.filter(m => m.height <= targetHeight) // Use <= to find snapshots at or before target
        : allMetas;
      
      if (filtered.length === 0) {
        console.log(`[SnapshotSeeder] No snapshots available for target height ${targetHeight || 'any'}`);
        return;
      }
      
      // Send metadata directly to requesting peer if sendToPeer is available
      if (this.p2pNode && this.p2pNode.sendToPeer) {
        console.log(`[SnapshotSeeder] Sending ${filtered.length} snapshot metadata to ${sender.substring(0, 16)}... (target: ${targetHeight || 'any'})`);
        this.p2pNode.sendToPeer(sender, "SNAPSHOT_META", {
          metas: filtered,
          nodeId: this.p2pNode.nodeId,
        });
      } else if (this.p2pNode) {
        // Fallback to broadcast
        this.p2pNode.broadcast("SNAPSHOT_META", {
          metas: filtered,
          nodeId: this.p2pNode.nodeId,
        });
      }
    });
    
    // Handle REQUEST_SNAPSHOT
    this.p2pNode.onMessage("REQUEST_SNAPSHOT", (request: { snapshotId: string; height: number; nodeId: string }) => {
      if (!this.config.autoSeed) return;
      
      // Check if we have this snapshot cached
      const cached = this.cachedSnapshots.get(request.snapshotId);
      if (!cached) {
        // Try to load it
        const snapshotData = loadSnapshotByHeightSync(request.height);
        if (snapshotData) {
          this.cacheSnapshot(request.height, snapshotData);
          const newlyCached = this.cachedSnapshots.get(request.snapshotId);
          if (newlyCached) {
            this.startSeeding(request.nodeId, newlyCached);
          }
        }
      } else {
        // Use cached snapshot
        this.startSeeding(request.nodeId, cached);
      }
    });
  }
  
  /**
   * Load cached snapshots
   */
  private loadCachedSnapshots(): void {
    const allMetas = loadAllSnapshotMeta();
    
    // Load most recent snapshots
    const recentMetas = allMetas
      .sort((a, b) => b.height - a.height)
      .slice(0, this.config.maxCachedSnapshots);
    
    for (const meta of recentMetas) {
      const snapshotData = loadSnapshotByHeightSync(meta.height);
      if (snapshotData) {
        this.cacheSnapshot(meta.height, snapshotData);
      }
    }
    
    logger.debug(`[Phase 20] Loaded ${this.cachedSnapshots.size} snapshots for seeding`);
  }
  
  /**
   * Cache a snapshot
   */
  private cacheSnapshot(height: number, snapshotData: SnapshotData): void {
    const snapshotId = `${height}`;
    
    // Check if already cached
    if (this.cachedSnapshots.has(snapshotId)) {
      const existing = this.cachedSnapshots.get(snapshotId)!;
      existing.lastAccessed = Date.now();
      return;
    }
    
    // Load metadata
    const allMetas = loadAllSnapshotMeta();
    const meta = allMetas.find(m => m.height === height);
    if (!meta) {
      console.warn(`[Phase 20] No metadata found for snapshot ${height}`);
      return;
    }
    
    // Chunk snapshot
    const { info, chunks } = chunkSnapshot(snapshotId, snapshotData, meta);
    
    // Cache
    this.cachedSnapshots.set(snapshotId, {
      meta,
      data: snapshotData,
      chunkedInfo: info,
      chunks,
      lastAccessed: Date.now(),
    });
    
    // Evict oldest if over limit
    if (this.cachedSnapshots.size > this.config.maxCachedSnapshots) {
      const oldest = Array.from(this.cachedSnapshots.entries())
        .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)[0];
      this.cachedSnapshots.delete(oldest[0]);
    }
  }
  
  /**
   * Start seeding snapshot to a node
   */
  private startSeeding(nodeId: string, cached: CachedSnapshot): void {
    if (!this.p2pNode) return;
    
    const requestId = `${nodeId}_${cached.meta.height}`;
    
    // Check if already seeding
    if (this.activeRequests.has(requestId)) {
      return;
    }
    
    // Start seeding
    const request = {
      nodeId,
      snapshotId: `${cached.meta.height}`,
      sentChunks: new Set<number>(),
      startTime: Date.now(),
    };
    
    this.activeRequests.set(requestId, request);
    
    // Send chunks (with pipeline for speed)
    this.sendChunks(nodeId, cached, request);
  }
  
  /**
   * Send chunks to a node
   */
  private async sendChunks(nodeId: string, cached: CachedSnapshot, request: {
    nodeId: string;
    snapshotId: string;
    sentChunks: Set<number>;
    startTime: number;
  }): Promise<void> {
    if (!this.p2pNode) return;
    
    // Send chunks in batches (pipeline)
    const batchSize = 3; // Send 3 chunks at a time
    let chunkIndex = 0;
    
    const sendBatch = () => {
      let sentInBatch = 0;
      
      while (chunkIndex < cached.chunks.length && sentInBatch < batchSize) {
        const chunk = cached.chunks[chunkIndex];
        if (!request.sentChunks.has(chunk.chunkIndex)) {
          // Send chunk
          this.p2pNode!.broadcast("SNAPSHOT_CHUNK", chunk);
          request.sentChunks.add(chunk.chunkIndex);
          sentInBatch++;
        }
        chunkIndex++;
      }
      
      // Check if complete
      if (request.sentChunks.size === cached.chunks.length) {
        // Send done signal
        if (this.p2pNode) {
          this.p2pNode.broadcast("SNAPSHOT_DONE", {
            snapshotId: request.snapshotId,
          });
        }
        
        // Clean up
        this.activeRequests.delete(`${request.nodeId}_${cached.meta.height}`);
        
        const elapsed = Date.now() - request.startTime;
        logger.debug(`[Phase 20] Seeded snapshot ${request.snapshotId} to ${nodeId} in ${elapsed}ms`);
      } else if (chunkIndex < cached.chunks.length) {
        // Schedule next batch
        setTimeout(sendBatch, 10); // 10ms delay between batches
      }
    };
    
    // Start sending
    sendBatch();
  }
  
  /**
   * Gossip snapshot metadata
   */
  gossipSnapshotMeta(meta: SnapshotMeta): void {
    if (!this.p2pNode || !this.config.autoSeed) return;
    
    this.p2pNode.broadcast("GOSSIP_SNAPSHOT_META", {
      height: meta.height,
      hash: meta.blockHash,
      score: 1.0, // Can be calculated based on quality
      timestamp: Date.now(),
    });
  }
  
  /**
   * Update cached snapshots (call when new snapshot is created)
   */
  updateCache(height: number): void {
    const snapshotData = loadSnapshotByHeightSync(height);
    if (snapshotData) {
      this.cacheSnapshot(height, snapshotData);
      
      // Gossip new snapshot
      const allMetas = loadAllSnapshotMeta();
      const meta = allMetas.find(m => m.height === height);
      if (meta) {
        this.gossipSnapshotMeta(meta);
      }
    }
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): {
    cachedCount: number;
    totalSize: number;
    snapshots: Array<{ height: number; size: number; lastAccessed: number }>;
  } {
    const snapshots = Array.from(this.cachedSnapshots.values()).map(cached => ({
      height: cached.meta.height,
      size: cached.chunkedInfo.totalSize,
      lastAccessed: cached.lastAccessed,
    }));
    
    const totalSize = snapshots.reduce((sum, s) => sum + s.size, 0);
    
    return {
      cachedCount: this.cachedSnapshots.size,
      totalSize,
      snapshots,
    };
  }
  
  /**
   * Clean up old requests
   */
  cleanup(): void {
    const now = Date.now();
    const stale: string[] = [];
    
    for (const [requestId, request] of this.activeRequests.entries()) {
      if (now - request.startTime > 60_000) { // 1 minute timeout
        stale.push(requestId);
      }
    }
    
    for (const requestId of stale) {
      this.activeRequests.delete(requestId);
    }
  }
}

