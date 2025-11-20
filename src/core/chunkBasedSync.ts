/**
 * Phase 43: Chunk-based Sync - Only sync missing blocks, optimize bandwidth
 * 
 * Chunk-based sync intelligently detects which blocks are already present locally
 * and only requests the missing chunks, significantly reducing bandwidth usage.
 * 
 * Features:
 * - Detect existing blocks locally before requesting
 * - Identify gaps in block sequence
 * - Request only missing chunks
 * - Integrate with parallel sync for maximum efficiency
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { logger } from "./logger.js";
import { getParallelSyncManager } from "./parallelSync.js";

export interface BlockGap {
  fromHeight: number;
  toHeight: number;
  size: number; // Number of missing blocks in this gap
}

export interface ChunkBasedSyncConfig {
  enabled: boolean; // Enable chunk-based sync (default: true)
  minGapSize: number; // Minimum gap size to trigger chunk-based sync (default: 10)
  maxChunkSize: number; // Maximum blocks per chunk (default: 100)
  useParallelSync: boolean; // Use parallel sync for chunks (default: true)
}

const DEFAULT_CONFIG: ChunkBasedSyncConfig = {
  enabled: true,
  minGapSize: 10,
  maxChunkSize: 100,
  useParallelSync: true,
};

export interface ChunkBasedSyncResult {
  success: boolean;
  requestedChunks: BlockGap[];
  skippedBlocks: number; // Number of blocks we already had
  totalBlocks: number;
  missingBlocks: number;
}

export class ChunkBasedSyncManager {
  private chainContext: ChainContext | null = null;
  private p2pNode: P2PNode | null = null;
  private config: ChunkBasedSyncConfig;

  constructor(config?: Partial<ChunkBasedSyncConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the chunk-based sync manager
   */
  init(chainContext: ChainContext, p2pNode: P2PNode): void {
    this.chainContext = chainContext;
    this.p2pNode = p2pNode;
  }

  /**
   * Detect missing blocks in a range
   * 
   * @param fromHeight Starting height (inclusive)
   * @param toHeight Ending height (inclusive)
   * @returns Array of gaps (missing block ranges)
   */
  detectMissingBlocks(fromHeight: number, toHeight: number): BlockGap[] {
    if (!this.chainContext) {
      return [];
    }

    if (fromHeight > toHeight) {
      return [];
    }

    const gaps: BlockGap[] = [];
    let gapStart: number | null = null;

    // Check each height in the range
    for (let h = fromHeight; h <= toHeight; h++) {
      const block = this.chainContext.storage.getBlockByHeight(h);
      const hasBlock = !!block;

      if (!hasBlock) {
        // Missing block - start or continue gap
        if (gapStart === null) {
          gapStart = h;
        }
      } else {
        // Have block - end gap if we were in one
        if (gapStart !== null) {
          gaps.push({
            fromHeight: gapStart,
            toHeight: h - 1,
            size: h - gapStart,
          });
          gapStart = null;
        }
      }
    }

    // Close any open gap at the end
    if (gapStart !== null) {
      gaps.push({
        fromHeight: gapStart,
        toHeight: toHeight,
        size: toHeight - gapStart + 1,
      });
    }

    return gaps;
  }

  /**
   * Split gaps into chunks for efficient syncing
   */
  private splitGapsIntoChunks(gaps: BlockGap[]): BlockGap[] {
    const chunks: BlockGap[] = [];

    for (const gap of gaps) {
      if (gap.size <= this.config.maxChunkSize) {
        // Gap fits in one chunk
        chunks.push(gap);
      } else {
        // Split gap into multiple chunks
        let currentStart = gap.fromHeight;
        while (currentStart <= gap.toHeight) {
          const chunkEnd = Math.min(currentStart + this.config.maxChunkSize - 1, gap.toHeight);
          chunks.push({
            fromHeight: currentStart,
            toHeight: chunkEnd,
            size: chunkEnd - currentStart + 1,
          });
          currentStart = chunkEnd + 1;
        }
      }
    }

    return chunks;
  }

  /**
   * Sync missing blocks using chunk-based approach
   * 
   * @param fromHeight Starting height (inclusive)
   * @param toHeight Ending height (inclusive)
   * @returns Sync result
   */
  async syncMissingBlocks(fromHeight: number, toHeight: number): Promise<ChunkBasedSyncResult> {
    if (!this.chainContext || !this.p2pNode) {
      return {
        success: false,
        requestedChunks: [],
        skippedBlocks: 0,
        totalBlocks: 0,
        missingBlocks: 0,
      };
    }

    if (!this.config.enabled) {
      // Fallback to normal sync
      return {
        success: true,
        requestedChunks: [{ fromHeight, toHeight, size: toHeight - fromHeight + 1 }],
        skippedBlocks: 0,
        totalBlocks: toHeight - fromHeight + 1,
        missingBlocks: toHeight - fromHeight + 1,
      };
    }

    const totalBlocks = toHeight - fromHeight + 1;

    // Detect missing blocks
    const gaps = this.detectMissingBlocks(fromHeight, toHeight);

    if (gaps.length === 0) {
      // All blocks are already present
      logger.info(`[ChunkBasedSync] ✅ All blocks ${fromHeight}-${toHeight} are already present locally`);
      return {
        success: true,
        requestedChunks: [],
        skippedBlocks: totalBlocks,
        totalBlocks,
        missingBlocks: 0,
      };
    }

    // Calculate statistics
    const missingBlocks = gaps.reduce((sum, gap) => sum + gap.size, 0);
    const skippedBlocks = totalBlocks - missingBlocks;

    // Split gaps into chunks
    const chunks = this.splitGapsIntoChunks(gaps);

    // Request chunks (targeted first, then fallback broadcast)
    const sendDirect = (from: number, to: number) => {
      const peers = Array.from((this.p2pNode as any).peers?.values() || [])
        .filter((p: any) => p.connected && p.dataChannel && p.dataChannel.readyState === "open");
      // Simple heuristic: take up to 3 most recently seen peers
      const topPeers = peers
        .sort((a: any, b: any) => (b.lastSeen || 0) - (a.lastSeen || 0))
        .slice(0, 3)
        .map((p: any) => p.id);
      let sent = 0;
      if (typeof (this.p2pNode as any).sendToPeer === "function") {
        for (const pid of topPeers) {
          try {
            (this.p2pNode as any).sendToPeer(pid, "REQUEST_BLOCKS", { fromHeight: from, toHeight: to });
            sent++;
          } catch {}
        }
      }
      if (sent === 0) {
        const node = this.p2pNode;
        if (node) {
          node.broadcast("REQUEST_BLOCKS", { fromHeight: from, toHeight: to });
        }
      }
    };

    if (this.config.useParallelSync && chunks.length > 1) {
      // Use parallel sync for multiple chunks (still targeted)
      const parallelSyncManager = getParallelSyncManager();
      for (const chunk of chunks) {
        parallelSyncManager.startParallelSync(chunk.fromHeight, chunk.toHeight);
        sendDirect(chunk.fromHeight, chunk.toHeight);
      }
    } else {
      // Single chunk or parallel disabled: targeted send
      for (const chunk of chunks) {
        sendDirect(chunk.fromHeight, chunk.toHeight);
      }
    }

    // Wait a bit for blocks to arrive (especially important for genesis sync)
    // Check if we're syncing from genesis (fromHeight === 1)
    if (fromHeight === 1) {
      // For genesis sync, wait longer and check multiple times
      const maxWaitTime = 5000; // 5 seconds max
      const checkInterval = 500; // Check every 500ms
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        
        // Check if we've received blocks
        const currentTip = this.chainContext.storage.getTip();
        const currentHeight = currentTip?.header.height ?? -1;
        
        // If we've received at least some blocks, we can return
        if (currentHeight >= fromHeight) {
          logger.debug(`[ChunkSync] Received blocks during wait: height=${currentHeight}, target=${toHeight}`);
          break;
        }
      }
    } else {
      // For non-genesis sync, wait a shorter time
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    }

    return {
      success: true,
      requestedChunks: chunks,
      skippedBlocks,
      totalBlocks,
      missingBlocks,
    };
  }

  /**
   * Check if a block range has any missing blocks
   */
  hasMissingBlocks(fromHeight: number, toHeight: number): boolean {
    const gaps = this.detectMissingBlocks(fromHeight, toHeight);
    return gaps.length > 0;
  }

  /**
   * Get statistics about block coverage in a range
   */
  getBlockCoverage(fromHeight: number, toHeight: number): {
    total: number;
    present: number;
    missing: number;
    coveragePercent: number;
    gaps: BlockGap[];
  } {
    const total = toHeight - fromHeight + 1;
    const gaps = this.detectMissingBlocks(fromHeight, toHeight);
    const missing = gaps.reduce((sum, gap) => sum + gap.size, 0);
    const present = total - missing;
    const coveragePercent = total > 0 ? (present / total) * 100 : 100;

    return {
      total,
      present,
      missing,
      coveragePercent,
      gaps,
    };
  }
}

// Singleton instance
let chunkBasedSyncManagerInstance: ChunkBasedSyncManager | null = null;

export function getChunkBasedSyncManager(): ChunkBasedSyncManager {
  if (!chunkBasedSyncManagerInstance) {
    chunkBasedSyncManagerInstance = new ChunkBasedSyncManager();
  }
  return chunkBasedSyncManagerInstance;
}

