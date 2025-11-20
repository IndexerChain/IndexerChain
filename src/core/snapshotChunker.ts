/**
 * Snapshot Chunker
 * 
 * Phase 20: Global Snapshot Network - Snapshot Chunking
 * 
 * Handles splitting snapshots into chunks for P2P transmission
 * and reassembling chunks back into complete snapshots.
 */

import type { SnapshotData } from "./types.js";
import { logger } from "./logger.js";

/**
 * Chunk size: 32 KB (optimal for WebRTC)
 */
export const CHUNK_SIZE = 32 * 1024; // 32 KB

/**
 * Snapshot chunk
 */
export interface SnapshotChunk {
  snapshotId: string; // snapshot height or hash
  chunkIndex: number;
  totalChunks: number;
  data: Uint8Array;
  checksum: string; // SHA-256 of chunk data
}

/**
 * Chunked snapshot metadata
 */
export interface ChunkedSnapshotInfo {
  snapshotId: string;
  totalChunks: number;
  totalSize: number;
  compressed: boolean;
  metadata: any; // Original snapshot metadata
}

/**
 * Split snapshot data into chunks
 */
export function chunkSnapshot(
  snapshotId: string,
  snapshotData: SnapshotData,
  metadata: any
): { info: ChunkedSnapshotInfo; chunks: SnapshotChunk[] } {
  // Convert snapshot data to binary
  const dataString = snapshotData.data;
  if (!dataString) {
    throw new Error("Snapshot data is missing");
  }
  const dataBytes = Uint8Array.from(atob(dataString), c => c.charCodeAt(0));
  
  const totalSize = dataBytes.length;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
  
  const chunks: SnapshotChunk[] = [];
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalSize);
    const chunkData = dataBytes.slice(start, end);
    
    // Calculate checksum for this chunk
    const checksum = computeChunkChecksum(chunkData);
    
    chunks.push({
      snapshotId,
      chunkIndex: i,
      totalChunks,
      data: chunkData,
      checksum,
    });
  }
  
  const info: ChunkedSnapshotInfo = {
    snapshotId,
    totalChunks,
    totalSize,
    compressed: snapshotData.compressed || false,
    metadata,
  };
  
  return { info, chunks };
}

/**
 * Compute checksum for a chunk (synchronous simple hash)
 * Note: For production, consider using async crypto.subtle.digest
 */
function computeChunkChecksum(data: Uint8Array): string {
  // Simple hash for now (can be upgraded to SHA-256 async)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data[i];
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(16, "0");
}

/**
 * Snapshot assembler state
 */
export interface AssemblerState {
  snapshotId: string;
  totalChunks: number;
  receivedChunks: Map<number, SnapshotChunk>;
  info: ChunkedSnapshotInfo | null;
  startTime: number;
}

/**
 * Snapshot Assembler
 * 
 * Manages reassembly of chunks into complete snapshot
 */
export class SnapshotAssembler {
  private state: AssemblerState | null = null;
  private onComplete?: (snapshotData: SnapshotData) => void;
  private onError?: (error: Error) => void;
  
  /**
   * Start assembling a snapshot
   */
  start(snapshotId: string, info: ChunkedSnapshotInfo): void {
    this.state = {
      snapshotId,
      totalChunks: info.totalChunks,
      receivedChunks: new Map(),
      info,
      startTime: Date.now(),
    };
  }
  
  /**
   * Add a chunk
   */
  addChunk(chunk: SnapshotChunk): boolean {
    if (!this.state) {
      throw new Error("Assembler not started");
    }
    
    if (chunk.snapshotId !== this.state.snapshotId) {
      return false; // Wrong snapshot
    }
    
    // Verify checksum
    const computedChecksum = computeChunkChecksum(chunk.data);
    if (computedChecksum !== chunk.checksum) {
      return false;
    }
    
    // Store chunk
    this.state.receivedChunks.set(chunk.chunkIndex, chunk);
    
    // Check if complete
    if (this.state.receivedChunks.size === this.state.totalChunks) {
      this.assemble();
      return true;
    }
    
    return false;
  }
  
  /**
   * Assemble chunks into complete snapshot
   */
  private assemble(): void {
    if (!this.state || !this.state.info) {
      return;
    }
    
    try {
      // Sort chunks by index
      const sortedChunks = Array.from(this.state.receivedChunks.values())
        .sort((a, b) => a.chunkIndex - b.chunkIndex);
      
      // Combine all chunk data
      const totalSize = sortedChunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
      const combinedData = new Uint8Array(totalSize);
      
      let offset = 0;
      for (const chunk of sortedChunks) {
        combinedData.set(chunk.data, offset);
        offset += chunk.data.length;
      }
      
      // Convert to base64 string
      const base64String = btoa(String.fromCharCode(...combinedData));
      
      // Create snapshot data
      const snapshotData: SnapshotData = {
        meta: this.state.info.metadata,
        compressed: this.state.info.compressed ?? false,
        data: base64String,
        full: true,
        // delta is only for incremental snapshots, not needed for full snapshots
      };
      
      const elapsed = Date.now() - this.state.startTime;
      logger.debug(`[Phase 20] Assembled snapshot ${this.state.snapshotId} in ${elapsed}ms`);
      
      if (this.onComplete) {
        this.onComplete(snapshotData);
      }
      
      // Reset state
      this.state = null;
    } catch (error) {
      if (this.onError) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
      this.state = null;
    }
  }
  
  /**
   * Get progress
   */
  getProgress(): { received: number; total: number; percent: number } | null {
    if (!this.state) return null;
    
    return {
      received: this.state.receivedChunks.size,
      total: this.state.totalChunks,
      percent: (this.state.receivedChunks.size / this.state.totalChunks) * 100,
    };
  }
  
  /**
   * Check if complete
   */
  isComplete(): boolean {
    if (!this.state) return false;
    return this.state.receivedChunks.size === this.state.totalChunks;
  }
  
  /**
   * Set completion callback
   */
  onCompleteCallback(callback: (snapshotData: SnapshotData) => void): void {
    this.onComplete = callback;
  }
  
  /**
   * Set error callback
   */
  onErrorCallback(callback: (error: Error) => void): void {
    this.onError = callback;
  }
  
  /**
   * Reset assembler
   */
  reset(): void {
    this.state = null;
  }
}

