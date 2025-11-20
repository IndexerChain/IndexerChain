/**
 * Snapshot Downloader
 * 
 * Phase 20: Global Snapshot Network - Parallel Snapshot Download
 * 
 * Handles downloading snapshots from multiple peers in parallel,
 * similar to BitTorrent swarming.
 */

import type { BrowserP2PNode } from "./p2p.js";
import type { SnapshotMeta, SnapshotData, ChainParams } from "./types.js";
import { SnapshotAssembler, type ChunkedSnapshotInfo, type SnapshotChunk } from "./snapshotChunker.js";
import { SnapshotRanker } from "./snapshotRanker.js";
import { logger } from "./logger.js";

/**
 * Download configuration
 */
export interface DownloadConfig {
  maxParallelPeers: number; // Default: 5
  chunkSize: number; // Default: 32 KB
  timeout: number; // Default: 30 seconds
}

const DEFAULT_CONFIG: DownloadConfig = {
  maxParallelPeers: 5,
  chunkSize: 32 * 1024,
  timeout: 30_000,
};

/**
 * Download progress
 */
export interface DownloadProgress {
  snapshotId: string;
  receivedChunks: number;
  totalChunks: number;
  percent: number;
  speed: number; // bytes per second
  peers: number;
  startTime: number;
}

/**
 * Snapshot Downloader
 * 
 * Manages parallel download of snapshots from multiple peers
 */
export class SnapshotDownloader {
  private ranker: SnapshotRanker;
  private p2pNode: BrowserP2PNode | null = null;
  private params: ChainParams | null = null;
  private activeDownloads: Map<string, {
    assembler: SnapshotAssembler;
    peers: Set<string>;
    chunksByPeer: Map<string, Set<number>>;
    startTime: number;
    config: DownloadConfig;
  }> = new Map();
  
  constructor() {
    this.ranker = new SnapshotRanker();
  }
  
  /**
   * Initialize with P2P node and chain params
   * Phase 21: Added params for peer reputation
   */
  initialize(p2pNode: BrowserP2PNode, params?: ChainParams): void {
    this.p2pNode = p2pNode;
    if (params) {
      this.params = params;
      this.ranker.setParams(params);
    }
    this.setupMessageHandlers();
  }
  
  /**
   * Setup P2P message handlers
   */
  private setupMessageHandlers(): void {
    if (!this.p2pNode) return;
    
    // Handle SNAPSHOT_META responses
    this.p2pNode.onMessage("SNAPSHOT_META", (data: { metas: SnapshotMeta[]; nodeId?: string }, sender: string) => {
      if (!data || !data.metas || !Array.isArray(data.metas)) {
        return;
      }
      
      
      // Update ranker with available snapshots
      for (const meta of data.metas) {
        // Estimate latency (could be improved with actual ping)
        const latency = 100; // Placeholder
        this.ranker.addSource(sender, meta, latency);
      }
    });
    
    // Handle SNAPSHOT_CHUNK
    this.p2pNode.onMessage("SNAPSHOT_CHUNK", async (chunk: SnapshotChunk, sender: string) => {
      const download = this.activeDownloads.get(chunk.snapshotId);
      if (download) {
        const startTime = Date.now();
        // If assembler not started, we need to start it first
        // For now, we'll assume it's already started
        const added = download.assembler.addChunk(chunk);
        if (added) {
          // Download complete
          const latency = Date.now() - startTime;
          this.activeDownloads.delete(chunk.snapshotId);
          this.ranker.recordSuccess(sender);
          
          // Phase 21: Record valid snapshot chunk
          if (this.params?.peerScoreEnabled) {
            const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
            const reputationManager = getGlobalPeerReputationManager(this.params);
            reputationManager.onValidSnapshotChunkFrom(sender, latency);
          }
        } else {
          // Phase 21: Record invalid chunk (if verification fails later)
          // This will be handled when we verify the complete snapshot
        }
      }
    });
    
    // Handle SNAPSHOT_META with chunked info
    this.p2pNode.onMessage("SNAPSHOT_META", (data: { metas: SnapshotMeta[]; chunkedInfo?: ChunkedSnapshotInfo }, sender: string) => {
      // Update ranker with available snapshots
      if (data.metas) {
        for (const meta of data.metas) {
          const latency = 100; // Placeholder
          this.ranker.addSource(sender, meta, latency);
        }
      }
      
      // If chunkedInfo is provided, start assembler
      if (data.chunkedInfo) {
        const download = this.activeDownloads.get(data.chunkedInfo.snapshotId);
        if (download && !download.assembler.isComplete()) {
          download.assembler.start(data.chunkedInfo.snapshotId, data.chunkedInfo);
        }
      }
    });
    
    // Handle SNAPSHOT_DONE
    this.p2pNode.onMessage("SNAPSHOT_DONE", (data: { snapshotId: string }, sender: string) => {
      // Chunk transfer complete from this peer
      const download = this.activeDownloads.get(data.snapshotId);
      if (download) {
        download.peers.delete(sender);
      }
    });
  }
  
  /**
   * Request snapshot metadata from peers
   */
  async requestSnapshotMeta(targetHeight?: number): Promise<SnapshotMeta[]> {
    if (!this.p2pNode) {
      throw new Error("P2P node not initialized");
    }
    
    // Broadcast request
    this.p2pNode.broadcast("REQUEST_SNAPSHOT_META", {
      targetHeight,
      timestamp: Date.now(),
    });
    
    // Wait for responses (with timeout)
    return new Promise(async (resolve) => {
      const timeout = setTimeout(async () => {
        // Return ranked sources
        const sources = await this.ranker.getRankedSources(targetHeight);
        resolve(sources.map(s => s.snapshotMeta));
      }, 2000); // 2 second timeout
      
      // Clear timeout if we get enough responses
      // (This is simplified - in production, we'd track responses)
      setTimeout(() => {
        clearTimeout(timeout);
      }, 2000);
    });
  }
  
  /**
   * Download snapshot from multiple peers
   */
  async downloadSnapshot(
    snapshotMeta: SnapshotMeta,
    config: Partial<DownloadConfig> = {},
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<SnapshotData> {
    if (!this.p2pNode) {
      throw new Error("P2P node not initialized");
    }
    
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const snapshotId = `${snapshotMeta.height}`;
    
    // Check if already downloading
    if (this.activeDownloads.has(snapshotId)) {
      throw new Error(`Snapshot ${snapshotId} is already being downloaded`);
    }
    
    // Get top sources - first try exact height, then try any available snapshot
    let sources = await this.ranker.getTopSources(finalConfig.maxParallelPeers, snapshotMeta.height);
    
    // If no sources at exact height, try to find any available snapshot (even lower height)
    if (sources.length === 0) {
      logger.debug(`[SnapshotDownloader] No sources for snapshot at height ${snapshotMeta.height}, trying to find any available snapshot...`);
      sources = await this.ranker.getTopSources(finalConfig.maxParallelPeers); // No height filter
      
      // If we found sources with different height, use the best one
      if (sources.length > 0) {
        const bestSource = sources[0];
        if (bestSource.snapshotMeta.height < snapshotMeta.height) {
          logger.info(`[SnapshotDownloader] Using available snapshot at height ${bestSource.snapshotMeta.height} instead of requested ${snapshotMeta.height}`);
          // Update snapshotMeta to use the available snapshot
          snapshotMeta = bestSource.snapshotMeta;
        }
      }
    }
    
    if (sources.length === 0) {
      // Check if we have any peers connected
      const peerCount = this.p2pNode && 'peers' in this.p2pNode ? this.p2pNode.peers.size : 0;
      const connectedPeers = peerCount > 0 && this.p2pNode && 'peers' in this.p2pNode
        ? Array.from(this.p2pNode.peers.values()).filter(p => p.connected && p.dataChannel && p.dataChannel.readyState === 'open').length
        : 0;
      
      if (connectedPeers === 0) {
        throw new Error("No peers connected. Please wait for peers to connect before downloading snapshot.");
      } else {
        throw new Error(`No available sources for snapshot at height ${snapshotMeta.height}. ${connectedPeers} peer(s) connected but none have any snapshots. Try requesting snapshot metadata from peers first.`);
      }
    }
    
    // Create assembler
    const assembler = new SnapshotAssembler();
    
    // Request snapshot info first (to get chunk count)
    // For now, we'll request from the first source
    const primarySource = sources[0];
    
    // Start download
    const download = {
      assembler,
      peers: new Set<string>(sources.map(s => s.nodeId)),
      chunksByPeer: new Map<string, Set<number>>(),
      startTime: Date.now(),
      config: finalConfig,
    };
    
    this.activeDownloads.set(snapshotId, download);
    
    // Request snapshot from all sources
    // First, we need to get chunked info to start assembler
    // For now, we'll create a placeholder info based on snapshot size
    // In production, the seeder should send this with SNAPSHOT_META
    const estimatedSize = snapshotMeta.compressedSize || 200_000; // Default estimate
    const estimatedChunks = Math.ceil(estimatedSize / finalConfig.chunkSize);
    
    const placeholderInfo: ChunkedSnapshotInfo = {
      snapshotId,
      totalChunks: estimatedChunks,
      totalSize: estimatedSize,
      compressed: true,
      metadata: snapshotMeta,
    };
    
    assembler.start(snapshotId, placeholderInfo);
    
    for (const source of sources) {
      this.p2pNode.broadcast("REQUEST_SNAPSHOT", {
        snapshotId,
        height: snapshotMeta.height,
        nodeId: source.nodeId,
      });
    }
    
    // Setup progress reporting
    const progressInterval = setInterval(() => {
      const progress = assembler.getProgress();
      if (progress && onProgress) {
        const elapsed = (Date.now() - download.startTime) / 1000;
        const speed = elapsed > 0 ? (progress.received * finalConfig.chunkSize) / elapsed : 0;
        
        onProgress({
          snapshotId,
          receivedChunks: progress.received,
          totalChunks: progress.total,
          percent: progress.percent,
          speed,
          peers: download.peers.size,
          startTime: download.startTime,
        });
      }
      
      if (assembler.isComplete()) {
        clearInterval(progressInterval);
      }
    }, 100); // Update every 100ms
    
    // Wait for completion
    return new Promise((resolve, reject) => {
      assembler.onCompleteCallback((snapshotData) => {
        clearInterval(progressInterval);
        this.activeDownloads.delete(snapshotId);
        resolve(snapshotData);
      });
      
      assembler.onErrorCallback((error) => {
        clearInterval(progressInterval);
        this.activeDownloads.delete(snapshotId);
        this.ranker.recordFailure(primarySource.nodeId);
        reject(error);
      });
      
      // Timeout
      setTimeout(() => {
        if (!assembler.isComplete()) {
          clearInterval(progressInterval);
          this.activeDownloads.delete(snapshotId);
          this.ranker.recordFailure(primarySource.nodeId);
          reject(new Error("Download timeout"));
        }
      }, finalConfig.timeout);
    });
  }
  
  /**
   * Get download progress
   */
  getProgress(snapshotId: string): DownloadProgress | null {
    const download = this.activeDownloads.get(snapshotId);
    if (!download) return null;
    
    const progress = download.assembler.getProgress();
    if (!progress) return null;
    
    const elapsed = (Date.now() - download.startTime) / 1000;
    const speed = elapsed > 0 ? (progress.received * download.config.chunkSize) / elapsed : 0;
    
    return {
      snapshotId,
      receivedChunks: progress.received,
      totalChunks: progress.total,
      percent: progress.percent,
      speed,
      peers: download.peers.size,
      startTime: download.startTime,
    };
  }
  
  /**
   * Cancel download
   */
  cancelDownload(snapshotId: string): void {
    const download = this.activeDownloads.get(snapshotId);
    if (download) {
      download.assembler.reset();
      this.activeDownloads.delete(snapshotId);
    }
  }
  
  /**
   * Get ranker statistics
   */
  getRankerStats() {
    return this.ranker.getStats();
  }
}

