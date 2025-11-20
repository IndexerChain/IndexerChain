/**
 * Global Nonce Allocator
 * 
 * Phase 19: Distributed Nonce Range Allocation
 * 
 * Manages global nonce space allocation across all nodes in the network,
 * ensuring no duplicate nonce ranges are assigned to different nodes.
 */

/**
 * Node capability information
 */
export interface NodeCapability {
  nodeId: string;
  workerCount: number;
  threads: number;
  hasWebGL: boolean;
  hasWebGPU: boolean;
  hasSIMD: boolean;
  estimatedHashrate: number; // hashes per second
  lastSeen: number; // timestamp
}

/**
 * Allocated nonce range
 */
export interface NonceRange {
  start: bigint;
  end: bigint;
  nodeId: string;
  workerId: number;
  assignedAt: number;
  expiresAt: number; // Auto-expire if not renewed
}

import type { ChainParams } from "./types.js";

/**
 * Global Nonce Allocator
 * 
 * Manages the global nonce space (0 to 2^64-1) and allocates
 * non-overlapping ranges to nodes based on their capabilities.
 * 
 * Phase 21: Considers peer reputation when allocating ranges
 */
export class GlobalNonceAllocator {
  private globalPointer: bigint = 0n;
  private readonly MAX_NONCE: bigint = 0xFFFFFFFFFFFFFFFFn; // 2^64 - 1
  private readonly DEFAULT_RANGE_SIZE: bigint = 1_000_000_000n; // 1 billion
  private readonly MIN_RANGE_SIZE: bigint = 100_000_000n; // 100 million
  private readonly MAX_RANGE_SIZE: bigint = 10_000_000_000n; // 10 billion
  private params: ChainParams;
  
  // Track allocated ranges
  private allocatedRanges: Map<string, NonceRange> = new Map(); // key: `${nodeId}_${workerId}`
  private nodeCapabilities: Map<string, NodeCapability> = new Map();
  
  // Expiration tracking
  private readonly RANGE_EXPIRATION_MS = 30_000; // 30 seconds
  // private readonly HEARTBEAT_INTERVAL_MS = 5_000; // 5 seconds (for future use)

  constructor(params: ChainParams) {
    this.params = params;
  }

  /**
   * Register or update node capability
   */
  updateNodeCapability(capability: NodeCapability): void {
    capability.lastSeen = Date.now();
    this.nodeCapabilities.set(capability.nodeId, capability);
  }

  /**
   * Calculate optimal range size based on node capability
   * Phase 21: Also consider peer reputation score
   */
  private async calculateRangeSize(capability: NodeCapability): Promise<bigint> {
    // Base range size proportional to hashrate
    // Higher hashrate = larger range to reduce communication overhead
    const baseRange = this.DEFAULT_RANGE_SIZE;
    const hashrateMultiplier = Math.max(0.1, Math.min(10, capability.estimatedHashrate / 100_000)); // Normalize to 100K hash/s
    
    let rangeSize = baseRange * BigInt(Math.floor(hashrateMultiplier * 10)) / 10n;
    
    // Adjust based on worker count
    rangeSize = rangeSize * BigInt(capability.workerCount) / 4n; // Normalize to 4 workers
    
    // Phase 21: Adjust based on peer reputation
    if (this.params.peerScoreEnabled) {
      try {
        const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
        const reputationManager = getGlobalPeerReputationManager(this.params);
        const trustLevel = reputationManager.getTrustLevel(capability.nodeId);
        
        // Trusted peers get larger ranges, low/banned get smaller
        let reputationMultiplier = 1.0;
        if (trustLevel === "trusted") {
          reputationMultiplier = 1.5; // 50% larger for trusted peers
        } else if (trustLevel === "normal") {
          reputationMultiplier = 1.0; // Normal size
        } else if (trustLevel === "low") {
          reputationMultiplier = 0.5; // 50% smaller for low trust
        } else if (trustLevel === "banned") {
          reputationMultiplier = 0; // No range for banned peers
        }
        
        rangeSize = (rangeSize * BigInt(Math.floor(reputationMultiplier * 100))) / 100n;
      } catch (error) {
        // If reputation manager not available, use default
      }
    }
    
    // Clamp to min/max
    if (rangeSize < this.MIN_RANGE_SIZE) {
      rangeSize = this.MIN_RANGE_SIZE;
    }
    if (rangeSize > this.MAX_RANGE_SIZE) {
      rangeSize = this.MAX_RANGE_SIZE;
    }
    
    return rangeSize;
  }

  /**
   * Allocate a new nonce range for a node/worker
   */
  async allocateRange(nodeId: string, workerId: number): Promise<NonceRange | null> {
    // Check if node already has a range for this worker
    const existingKey = `${nodeId}_${workerId}`;
    const existing = this.allocatedRanges.get(existingKey);
    
    // If existing range is still valid and not expired, return it
    if (existing && existing.expiresAt > Date.now()) {
      return existing;
    }
    
    // Get node capability
    const capability = this.nodeCapabilities.get(nodeId);
    if (!capability) {
      // Use default capability
      this.updateNodeCapability({
        nodeId,
        workerCount: 1,
        threads: 1,
        hasWebGL: false,
        hasWebGPU: false,
        hasSIMD: false,
        estimatedHashrate: 100_000,
        lastSeen: Date.now(),
      });
    }
    
    const updatedCapability = this.nodeCapabilities.get(nodeId)!;
    const rangeSize = await this.calculateRangeSize(updatedCapability);
    
    // Check if we have space
    if (this.globalPointer + rangeSize > this.MAX_NONCE) {
      // Reset to beginning (wrap around)
      this.globalPointer = 0n;
      // Clean up expired ranges
      this.cleanupExpiredRanges();
    }
    
    const start = this.globalPointer;
    const end = start + rangeSize;
    
    // Check for overlap with existing ranges
    // (In a real implementation, we'd use an interval tree, but for simplicity we'll check)
    for (const range of this.allocatedRanges.values()) {
      if (range.expiresAt > Date.now()) {
        // Check overlap
        if ((start >= range.start && start < range.end) ||
            (end > range.start && end <= range.end) ||
            (start <= range.start && end >= range.end)) {
          // Overlap detected, skip to after this range
          this.globalPointer = range.end;
          return await this.allocateRange(nodeId, workerId); // Retry
        }
      }
    }
    
    const range: NonceRange = {
      start,
      end,
      nodeId,
      workerId,
      assignedAt: Date.now(),
      expiresAt: Date.now() + this.RANGE_EXPIRATION_MS,
    };
    
    this.allocatedRanges.set(existingKey, range);
    this.globalPointer = end;
    
    
    return range;
  }

  /**
   * Renew a nonce range (extend expiration)
   */
  renewRange(nodeId: string, workerId: number): boolean {
    const key = `${nodeId}_${workerId}`;
    const range = this.allocatedRanges.get(key);
    
    if (!range) {
      return false;
    }
    
    range.expiresAt = Date.now() + this.RANGE_EXPIRATION_MS;
    return true;
  }

  /**
   * Release a nonce range
   */
  releaseRange(nodeId: string, workerId: number): void {
    const key = `${nodeId}_${workerId}`;
    this.allocatedRanges.delete(key);
  }

  /**
   * Clean up expired ranges
   */
  cleanupExpiredRanges(): void {
    const now = Date.now();
    const expired: string[] = [];
    
    for (const [key, range] of this.allocatedRanges.entries()) {
      if (range.expiresAt <= now) {
        expired.push(key);
      }
    }
    
    for (const key of expired) {
      this.allocatedRanges.delete(key);
    }
    
    if (expired.length > 0) {
    }
  }

  /**
   * Reset allocator (when new block is found)
   */
  reset(): void {
    this.globalPointer = 0n;
    this.allocatedRanges.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalAllocated: number;
    activeRanges: number;
    globalPointer: bigint;
    totalNodes: number;
  } {
    const now = Date.now();
    const activeRanges = Array.from(this.allocatedRanges.values())
      .filter(r => r.expiresAt > now).length;
    
    return {
      totalAllocated: this.allocatedRanges.size,
      activeRanges,
      globalPointer: this.globalPointer,
      totalNodes: this.nodeCapabilities.size,
    };
  }

  /**
   * Get all active ranges
   */
  getActiveRanges(): NonceRange[] {
    const now = Date.now();
    return Array.from(this.allocatedRanges.values())
      .filter(r => r.expiresAt > now);
  }

  /**
   * Get node capability
   */
  getNodeCapability(nodeId: string): NodeCapability | undefined {
    return this.nodeCapabilities.get(nodeId);
  }

  /**
   * Remove stale node capabilities
   */
  cleanupStaleNodes(maxAge: number = 60_000): void {
    const now = Date.now();
    const stale: string[] = [];
    
    for (const [nodeId, capability] of this.nodeCapabilities.entries()) {
      if (now - capability.lastSeen > maxAge) {
        stale.push(nodeId);
      }
    }
    
    for (const nodeId of stale) {
      this.nodeCapabilities.delete(nodeId);
      // Also release all ranges for this node
      for (const [key, range] of this.allocatedRanges.entries()) {
        if (range.nodeId === nodeId) {
          this.allocatedRanges.delete(key);
        }
      }
    }
    
    if (stale.length > 0) {
    }
  }
}

