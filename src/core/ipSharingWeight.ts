/**
 * Phase 44: IP Sharing Weight System
 * 
 * Implements reward reduction for multiple miners on the same IP.
 * 
 * Rules:
 * - Same IP, same hour: Only 1 miner gets full reward (1.0x)
 * - 2nd miner on same IP: 0.7x reward
 * - 3rd miner on same IP: 0.3x reward
 * - 4th+ miners on same IP: 0.1x reward
 * 
 * This prevents IP-based abuse while still allowing legitimate multi-device scenarios.
 */

import type { P2PNode } from "./p2p.js";

/**
 * IP Sharing Weight multiplier based on miner position on same IP
 */
export function getIPSharingWeight(position: number): number {
  if (position <= 0) {
    return 0.0; // Invalid position
  } else if (position === 1) {
    return 1.0; // First miner: full reward
  } else if (position === 2) {
    return 0.7; // Second miner: 70% reward
  } else if (position === 3) {
    return 0.3; // Third miner: 30% reward
  } else {
    return 0.1; // Fourth+ miner: 10% reward
  }
}

/**
 * IP Sharing Tracker
 * 
 * Tracks active miners per IP to determine sharing weight.
 * Integrates with Shadow Node and P2P network.
 */
export class IPSharingTracker {
  private ipMinerMap: Map<string, Set<string>> = new Map(); // IP -> Set of miner IDs
  private minerIPMap: Map<string, string> = new Map(); // Miner ID -> IP
  private lastCleanup: number = Date.now();
  private readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Register a miner for an IP
   * 
   * @param ipHash IP hash (from QuorumManager)
   * @param minerId Miner ID (nodeId or deviceId)
   * @returns Position (1-based) of this miner on this IP
   */
  registerMiner(ipHash: string, minerId: string): number {
    // Cleanup old entries periodically
    const now = Date.now();
    if (now - this.lastCleanup > this.CLEANUP_INTERVAL_MS) {
      this.cleanup();
      this.lastCleanup = now;
    }

    // Get existing miners for this IP
    let miners = this.ipMinerMap.get(ipHash);
    if (!miners) {
      miners = new Set();
      this.ipMinerMap.set(ipHash, miners);
    }

    // Add this miner
    miners.add(minerId);
    this.minerIPMap.set(minerId, ipHash);

    // Return position (1-based)
    return miners.size;
  }

  /**
   * Get IP sharing weight for a miner
   * 
   * @param ipHash IP hash
   * @param minerId Miner ID
   * @returns Sharing weight (0.1 to 1.0)
   */
  getSharingWeight(ipHash: string, minerId: string): number {
    const miners = this.ipMinerMap.get(ipHash);
    if (!miners) {
      return 1.0; // No other miners, full reward
    }

    // Find position of this miner
    const minerArray = Array.from(miners);
    const position = minerArray.indexOf(minerId) + 1; // 1-based

    if (position === 0) {
      // Miner not found, treat as first
      return 1.0;
    }

    return getIPSharingWeight(position);
  }

  /**
   * Remove a miner (when they stop mining)
   * 
   * @param minerId Miner ID
   */
  unregisterMiner(minerId: string): void {
    const ipHash = this.minerIPMap.get(minerId);
    if (!ipHash) {
      return;
    }

    const miners = this.ipMinerMap.get(ipHash);
    if (miners) {
      miners.delete(minerId);
      if (miners.size === 0) {
        this.ipMinerMap.delete(ipHash);
      }
    }

    this.minerIPMap.delete(minerId);
  }

  /**
   * Get all miners for an IP
   * 
   * @param ipHash IP hash
   * @returns Array of miner IDs
   */
  getMinersForIP(ipHash: string): string[] {
    const miners = this.ipMinerMap.get(ipHash);
    return miners ? Array.from(miners) : [];
  }

  /**
   * Cleanup old entries (called periodically)
   */
  private cleanup(): void {
    // In a real implementation, you might want to track timestamps
    // and remove miners that haven't been active for > 1 hour
    // For now, we'll keep it simple and let the hourly cleanup handle it
  }

  /**
   * Get IP sharing statistics
   */
  getStats(): {
    totalIPs: number;
    totalMiners: number;
    ipDistribution: Array<{ ipHash: string; minerCount: number }>;
  } {
    const ipDistribution: Array<{ ipHash: string; minerCount: number }> = [];
    
    for (const [ipHash, miners] of this.ipMinerMap.entries()) {
      ipDistribution.push({
        ipHash,
        minerCount: miners.size,
      });
    }

    return {
      totalIPs: this.ipMinerMap.size,
      totalMiners: this.minerIPMap.size,
      ipDistribution: ipDistribution.sort((a, b) => b.minerCount - a.minerCount),
    };
  }
}

/**
 * Global IP sharing tracker instance
 */
let globalIPSharingTracker: IPSharingTracker | null = null;

/**
 * Get or create global IP sharing tracker
 */
export function getIPSharingTracker(): IPSharingTracker {
  if (!globalIPSharingTracker) {
    globalIPSharingTracker = new IPSharingTracker();
  }
  return globalIPSharingTracker;
}

/**
 * Get IP hash from P2P node (if available)
 */
export function getIPHashFromP2P(p2pNode: P2PNode | null): string | null {
  if (!p2pNode) {
    return null;
  }

  // Try to get IP hash from QuorumManager
  try {
    const { getQuorumManager } = require("./quorumManager.js");
    const quorumManager = getQuorumManager();
    const quorumStatus = quorumManager.getQuorumStatus();
    
    // Get local node's IP hash (if available)
    // Find peer with matching peerId
    const localPeer = quorumStatus.peerMetrics.find((p: any) => p.peerId === p2pNode.nodeId);
    return localPeer?.ipHash || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get device ID (persistent across browser sessions)
 */
export function getOrCreateDeviceId(): string {
  const STORAGE_KEY = "indexerchain_device_id_v1";
  
  if (typeof localStorage === "undefined") {
    // Fallback for non-browser environment
    return `device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  let deviceId = localStorage.getItem(STORAGE_KEY);
  if (!deviceId) {
    // Generate new device ID
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(STORAGE_KEY, deviceId);
  }

  return deviceId;
}

