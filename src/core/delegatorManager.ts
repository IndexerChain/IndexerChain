/**
 * Delegator Manager
 * 
 * Phase 19: Distributed Miner Pool - Delegator Role
 * 
 * Manages the delegator role, which is responsible for:
 * - Allocating nonce ranges to worker nodes
 * - Coordinating global nonce space
 * - Handling worker progress reports
 */

import type { BrowserP2PNode } from "./p2p.js";
import type { ChainParams } from "./types.js";
import { GlobalNonceAllocator, type NodeCapability } from "./globalNonceAllocator.js";

/**
 * Delegator state
 */
export interface DelegatorState {
  isDelegator: boolean;
  delegatorNodeId: string | null;
  lastHeartbeat: number | null;
  blockHeight: number;
}

/**
 * Worker progress report
 */
export interface WorkerProgress {
  nodeId: string;
  workerId: number;
  hashesTried: number;
  currentNonce: bigint;
  hashRate: number; // hashes per second
  rangeStart: bigint;
  rangeEnd: bigint;
  progressPercent: number;
}

/**
 * Delegator Manager
 * 
 * Handles delegator election and nonce range allocation
 */
export class DelegatorManager {
  private allocator: GlobalNonceAllocator;
  private p2pNode: BrowserP2PNode | null = null;
  private nodeId: string;
  private params: ChainParams;
  private state: DelegatorState = {
    isDelegator: false,
    delegatorNodeId: null,
    lastHeartbeat: null,
    blockHeight: 0,
  };
  
  // Delegator election
  private readonly DELEGATOR_TIMEOUT_MS = 3_000; // 3 seconds
  private readonly HEARTBEAT_INTERVAL_MS = 1_000; // 1 second
  private heartbeatInterval: number | null = null;
  private delegatorCheckInterval: number | null = null;
  
  // Pending requests (for future use)
  // private pendingRangeRequests: Map<string, { nodeId: string; workerId: number; timestamp: number }> = new Map();
  
  // Event handlers
  private onDelegatorChangeHandlers: Set<(isDelegator: boolean) => void> = new Set();

  constructor(nodeId: string, params: ChainParams) {
    this.nodeId = nodeId;
    this.params = params;
    this.allocator = new GlobalNonceAllocator(params);
  }

  /**
   * Initialize with P2P node
   */
  initialize(p2pNode: BrowserP2PNode): void {
    this.p2pNode = p2pNode;
    this.setupMessageHandlers();
    this.startDelegatorCheck();
  }

  /**
   * Setup P2P message handlers
   */
  private setupMessageHandlers(): void {
    if (!this.p2pNode) return;

    // Handle WORKER_INFO messages
    this.p2pNode.onMessage("WORKER_INFO", (capability: NodeCapability) => {
      if (this.state.isDelegator) {
        this.allocator.updateNodeCapability(capability);
      }
    });

    // Handle REQUEST_NONCE_RANGE messages
    this.p2pNode.onMessage("REQUEST_NONCE_RANGE", async (request: { nodeId: string; workerId: number }) => {
      if (this.state.isDelegator) {
        await this.handleRangeRequest(request.nodeId, request.workerId);
      }
    });

    // Handle WORKER_PROGRESS messages
    this.p2pNode.onMessage("WORKER_PROGRESS", (progress: WorkerProgress) => {
      if (this.state.isDelegator) {
        this.handleWorkerProgress(progress);
      }
    });

    // Handle NONCE_RANGE_EXHAUSTED messages
    this.p2pNode.onMessage("NONCE_RANGE_EXHAUSTED", async (request: { nodeId: string; workerId: number }) => {
      if (this.state.isDelegator) {
        await this.handleRangeExhausted(request.nodeId, request.workerId);
      }
    });

    // Handle DELEGATOR_ANNOUNCE messages
    this.p2pNode.onMessage("DELEGATOR_ANNOUNCE", (announce: { nodeId: string; blockHeight: number; timestamp: number }) => {
      this.handleDelegatorAnnounce(announce);
    });

    // Handle DELEGATOR_HEARTBEAT messages
    this.p2pNode.onMessage("DELEGATOR_HEARTBEAT", (heartbeat: { nodeId: string; blockHeight: number; timestamp: number }) => {
      this.handleDelegatorHeartbeat(heartbeat);
    });
  }

  /**
   * Handle range request
   * Phase 21: Consider peer reputation when allocating ranges
   */
  private async handleRangeRequest(nodeId: string, workerId: number): Promise<void> {
    // Phase 21: Check if peer is banned
    if (this.params.peerScoreEnabled) {
      const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
      const reputationManager = getGlobalPeerReputationManager(this.params);
      if (reputationManager.isBanned(nodeId)) {
        console.log(`[Phase 21] Rejecting range request from banned peer: ${nodeId.substring(0, 16)}...`);
        return;
      }
    }
    
    const range = await this.allocator.allocateRange(nodeId, workerId);
    
    if (range && this.p2pNode) {
      // Phase 21: Record work assigned
      if (this.params.peerScoreEnabled) {
        const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
        const reputationManager = getGlobalPeerReputationManager(this.params);
        reputationManager.onWorkAssigned(nodeId);
      }
      
      this.p2pNode.broadcast("NONCE_RANGE", {
        nodeId,
        workerId,
        range,
      });
      console.log(`[Phase 19] Delegator allocated range to ${nodeId} worker ${workerId}`);
    }
  }

  /**
   * Handle worker progress
   * Phase 21: Track worker performance for reputation
   */
  private handleWorkerProgress(progress: WorkerProgress): void {
    // Renew the range expiration
    this.allocator.renewRange(progress.nodeId, progress.workerId);
    
    // Update node capability if hashrate changed significantly
    const capability = this.allocator.getNodeCapability(progress.nodeId);
    if (capability) {
      const hashrateDiff = Math.abs(capability.estimatedHashrate - progress.hashRate);
      const threshold = capability.estimatedHashrate * 0.2;
      if (hashrateDiff > threshold) {
        // Hashrate changed by more than 20%, update
        this.allocator.updateNodeCapability({
          ...capability,
          estimatedHashrate: progress.hashRate,
        });
      }
    }
    
    // Phase 21: Note that worker is making progress (positive signal)
    // We don't penalize here, only reward on completion
  }

  /**
   * Handle range exhausted
   * Phase 21: Record work completion for reputation
   */
  private async handleRangeExhausted(nodeId: string, workerId: number): Promise<void> {
    // Phase 21: Record work completed (normal exhaustion means they finished the range)
    if (this.params.peerScoreEnabled) {
      const { getGlobalPeerReputationManager } = await import("./peerReputation.js");
      const reputationManager = getGlobalPeerReputationManager(this.params);
      reputationManager.onWorkCompleted(nodeId);
    }
    
    // Release old range and allocate new one
    this.allocator.releaseRange(nodeId, workerId);
    await this.handleRangeRequest(nodeId, workerId);
  }

  /**
   * Handle delegator announce
   */
  private handleDelegatorAnnounce(announce: { nodeId: string; blockHeight: number; timestamp: number }): void {
    if (announce.blockHeight > this.state.blockHeight) {
      // New block, reset state
      this.state.blockHeight = announce.blockHeight;
      this.state.delegatorNodeId = announce.nodeId;
      this.state.lastHeartbeat = announce.timestamp;
      
      if (announce.nodeId === this.nodeId) {
        // We are the delegator
        this.becomeDelegator(announce.blockHeight);
      } else {
        // Someone else is delegator
        this.stopBeingDelegator();
      }
    } else if (announce.blockHeight === this.state.blockHeight && announce.timestamp < (this.state.lastHeartbeat || 0)) {
      // Earlier timestamp for same block, they win
      this.state.delegatorNodeId = announce.nodeId;
      this.state.lastHeartbeat = announce.timestamp;
      
      if (announce.nodeId === this.nodeId) {
        this.becomeDelegator(announce.blockHeight);
      } else {
        this.stopBeingDelegator();
      }
    }
  }

  /**
   * Handle delegator heartbeat
   */
  private handleDelegatorHeartbeat(heartbeat: { nodeId: string; blockHeight: number; timestamp: number }): void {
    if (heartbeat.nodeId === this.state.delegatorNodeId && heartbeat.blockHeight === this.state.blockHeight) {
      this.state.lastHeartbeat = heartbeat.timestamp;
    }
  }

  /**
   * Become delegator
   */
  private becomeDelegator(blockHeight: number): void {
    if (this.state.isDelegator) return;
    
    this.state.isDelegator = true;
    this.state.blockHeight = blockHeight;
    this.allocator.reset();
    
    // Start sending heartbeats
    this.startHeartbeat();
    
    // Announce ourselves
    if (this.p2pNode) {
      this.p2pNode.broadcast("DELEGATOR_ANNOUNCE", {
        nodeId: this.nodeId,
        blockHeight,
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Phase 19] Node ${this.nodeId} became delegator for block ${blockHeight}`);
    
    // Notify handlers
    for (const handler of this.onDelegatorChangeHandlers) {
      handler(true);
    }
  }

  /**
   * Stop being delegator
   */
  private stopBeingDelegator(): void {
    if (!this.state.isDelegator) return;
    
    this.state.isDelegator = false;
    this.stopHeartbeat();
    
    console.log(`[Phase 19] Node ${this.nodeId} stopped being delegator`);
    
    // Notify handlers
    for (const handler of this.onDelegatorChangeHandlers) {
      handler(false);
    }
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    
    this.heartbeatInterval = window.setInterval(() => {
      if (this.state.isDelegator && this.p2pNode) {
        this.p2pNode.broadcast("DELEGATOR_HEARTBEAT", {
          nodeId: this.nodeId,
          blockHeight: this.state.blockHeight,
          timestamp: Date.now(),
        });
      }
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Start delegator check (check if current delegator is alive)
   */
  private startDelegatorCheck(): void {
    if (this.delegatorCheckInterval) return;
    
    this.delegatorCheckInterval = window.setInterval(() => {
      if (!this.state.isDelegator && this.state.delegatorNodeId) {
        // Check if delegator is still alive
        if (this.state.lastHeartbeat && Date.now() - this.state.lastHeartbeat > this.DELEGATOR_TIMEOUT_MS) {
          // Delegator timed out, try to become delegator
          console.log(`[Phase 19] Delegator ${this.state.delegatorNodeId} timed out, attempting to become delegator`);
          this.attemptBecomeDelegator(this.state.blockHeight);
        }
      }
      
      // Cleanup
      this.allocator.cleanupExpiredRanges();
      this.allocator.cleanupStaleNodes();
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Attempt to become delegator (called when new block header received)
   */
  attemptBecomeDelegator(blockHeight: number): void {
    if (this.state.isDelegator && this.state.blockHeight === blockHeight) {
      return; // Already delegator for this block
    }
    
    // Reset state for new block
    if (this.state.blockHeight < blockHeight) {
      this.state.blockHeight = blockHeight;
      this.state.delegatorNodeId = null;
      this.state.lastHeartbeat = null;
    }
    
    // Announce ourselves as candidate
    if (this.p2pNode) {
      this.p2pNode.broadcast("DELEGATOR_ANNOUNCE", {
        nodeId: this.nodeId,
        blockHeight,
        timestamp: Date.now(),
      });
    }
    
    // Set a timeout - if no one else announces with earlier timestamp, we become delegator
    setTimeout(() => {
      if (!this.state.isDelegator && this.state.blockHeight === blockHeight) {
        // No one else became delegator, we win
        this.becomeDelegator(blockHeight);
      }
    }, 100); // Wait 100ms for other announcements
  }

  /**
   * Get current state
   */
  getState(): DelegatorState {
    return { ...this.state };
  }

  /**
   * Get allocator statistics
   */
  getStats() {
    return this.allocator.getStats();
  }

  /**
   * Event: Delegator status changed
   */
  onDelegatorChange(handler: (isDelegator: boolean) => void): void {
    this.onDelegatorChangeHandlers.add(handler);
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopHeartbeat();
    if (this.delegatorCheckInterval) {
      clearInterval(this.delegatorCheckInterval);
      this.delegatorCheckInterval = null;
    }
    this.onDelegatorChangeHandlers.clear();
  }
}

