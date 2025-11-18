/**
 * Block Relay Module
 * 
 * Phase 17: Fast Block Relay
 * 
 * Implements two-phase block propagation:
 * 1. Fast header broadcast (NEW_BLOCK_HEADER)
 * 2. On-demand body fetch (REQUEST_BLOCK_BODY / BLOCK_BODY)
 */

import type { BlockHeader } from "./types";

/**
 * Compact block header for fast relay
 */
export interface CompactBlockHeader {
  height: number;
  hash: string;
  prevHash: string;
  stateCommitment: string;
  txnCount: number;
  miner: string;
  timestamp: number;
  difficulty: number;
  nonce: number;
  merkleRoot: string;
}

/**
 * Convert BlockHeader to CompactBlockHeader
 */
export function headerToCompact(header: BlockHeader, hash: string, txnCount: number, miner: string): CompactBlockHeader {
  return {
    height: header.height,
    hash,
    prevHash: header.prevHash,
    stateCommitment: header.stateCommitment || "",
    txnCount,
    miner,
    timestamp: header.timestamp,
    difficulty: header.difficulty,
    nonce: header.nonce,
    merkleRoot: header.merkleRoot,
  };
}

/**
 * Convert CompactBlockHeader back to BlockHeader
 */
export function compactToHeader(compact: CompactBlockHeader): BlockHeader {
  return {
    version: 1, // Default version
    height: compact.height,
    prevHash: compact.prevHash,
    merkleRoot: compact.merkleRoot,
    timestamp: compact.timestamp,
    difficulty: compact.difficulty,
    nonce: compact.nonce,
    stateCommitment: compact.stateCommitment,
  };
}

/**
 * Validate compact header
 */
export function validateCompactHeader(
  compact: CompactBlockHeader,
  prevHeaderHash: string | null,
  params: { targetBlockTime: number; maxBlockSizeBytes: number }
): { valid: boolean; error?: string } {
  // Check height continuity
  if (prevHeaderHash) {
    if (compact.prevHash !== prevHeaderHash) {
      return { valid: false, error: "Previous hash mismatch" };
    }
  } else if (compact.height !== 0) {
    return { valid: false, error: "First block must be genesis (height 0)" };
  }

  // Check timestamp (not too far in future)
  // Note: compact.timestamp is in seconds (Unix timestamp), Date.now() is in milliseconds
  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxFutureTime = 60; // 1 minute in seconds
  if (compact.timestamp > nowSeconds + maxFutureTime) {
    return { valid: false, error: "Timestamp too far in future" };
  }

  // Check transaction count (estimate: ~100 bytes per tx)
  const estimatedBodySize = compact.txnCount * 100;
  if (estimatedBodySize > params.maxBlockSizeBytes) {
    return { valid: false, error: `Estimated block size too large: ${estimatedBodySize} bytes` };
  }

  // Check required fields
  if (!compact.stateCommitment) {
    return { valid: false, error: "Missing stateCommitment" };
  }

  return { valid: true };
}

/**
 * Check if header should trigger mining restart
 */
export function shouldRestartMining(compact: CompactBlockHeader, currentTipHeight: number): boolean {
  // Only restart if this is the next block after current tip
  return compact.height === currentTipHeight + 1;
}

/**
 * Request block body from peers
 */
export interface BlockBodyRequest {
  hash: string;
  height: number;
  requestedAt: number;
  requestedFrom?: string; // Peer ID that was requested from
}

/**
 * Track pending body requests
 */
export class BlockBodyRequestTracker {
  private pending: Map<string, BlockBodyRequest> = new Map(); // hash -> request
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds

  /**
   * Add a pending request
   */
  addRequest(hash: string, height: number, peerId?: string): void {
    this.pending.set(hash, {
      hash,
      height,
      requestedAt: Date.now(),
      requestedFrom: peerId,
    });
  }

  /**
   * Remove a request (body received)
   */
  removeRequest(hash: string): void {
    this.pending.delete(hash);
  }

  /**
   * Check if request is pending
   */
  isPending(hash: string): boolean {
    return this.pending.has(hash);
  }

  /**
   * Get expired requests
   */
  getExpiredRequests(): BlockBodyRequest[] {
    const now = Date.now();
    const expired: BlockBodyRequest[] = [];
    
    for (const request of this.pending.values()) {
      if (now - request.requestedAt > this.REQUEST_TIMEOUT) {
        expired.push(request);
      }
    }
    
    return expired;
  }

  /**
   * Get all pending requests
   */
  getAllPending(): BlockBodyRequest[] {
    return Array.from(this.pending.values());
  }

  /**
   * Clear all requests
   */
  clear(): void {
    this.pending.clear();
  }
}

/**
 * Global body request tracker
 */
export const globalBodyRequestTracker = new BlockBodyRequestTracker();

