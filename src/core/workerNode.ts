/**
 * Worker Node Manager
 * 
 * Phase 19: Distributed Miner Pool - Worker Node Role
 * 
 * Manages worker node behavior:
 * - Requesting nonce ranges from delegator
 * - Reporting progress
 * - Handling range exhaustion
 */

import type { BrowserP2PNode } from "./p2p.js";
import type { NodeCapability, NonceRange } from "./globalNonceAllocator.js";
import type { WorkerProgress } from "./delegatorManager.js";

/**
 * Worker node state
 */
export interface WorkerNodeState {
  currentRange: NonceRange | null;
  lastProgressReport: number;
  isRequestingRange: boolean;
  delegatorNodeId: string | null;
}

/**
 * Worker Node Manager
 * 
 * Handles worker node interactions with delegator
 */
export class WorkerNodeManager {
  private p2pNode: BrowserP2PNode | null = null;
  private nodeId: string;
  private state: WorkerNodeState = {
    currentRange: null,
    lastProgressReport: 0,
    isRequestingRange: false,
    delegatorNodeId: null,
  };
  
  // Configuration
  private readonly PROGRESS_REPORT_INTERVAL_MS = 1_000; // 1 second
  private progressReportInterval: number | null = null;
  
  // Current worker info
  private workerId: number = 0;
  private currentNonce: bigint = 0n;
  private hashesTried: number = 0;
  private hashRate: number = 0;
  private rangeStart: bigint = 0n;
  private rangeEnd: bigint = 0n;
  
  // Event handlers
  private onRangeReceivedHandlers: Set<(range: NonceRange) => void> = new Set();
  private onRangeExhaustedHandlers: Set<() => void> = new Set();

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  /**
   * Initialize with P2P node
   */
  initialize(p2pNode: BrowserP2PNode): void {
    this.p2pNode = p2pNode;
    this.setupMessageHandlers();
  }

  /**
   * Setup P2P message handlers
   */
  private setupMessageHandlers(): void {
    if (!this.p2pNode) return;

    // Handle NONCE_RANGE messages
    this.p2pNode.onMessage("NONCE_RANGE", (data: { nodeId: string; workerId: number; range: NonceRange }) => {
      if (data.nodeId === this.nodeId && data.workerId === this.workerId) {
        this.handleRangeReceived(data.range);
      }
    });

    // Handle DELEGATOR_ANNOUNCE messages
    this.p2pNode.onMessage("DELEGATOR_ANNOUNCE", (announce: { nodeId: string; blockHeight: number; timestamp: number }) => {
      this.state.delegatorNodeId = announce.nodeId;
    });

    // Handle DELEGATOR_HEARTBEAT messages
    this.p2pNode.onMessage("DELEGATOR_HEARTBEAT", (heartbeat: { nodeId: string; blockHeight: number; timestamp: number }) => {
      if (heartbeat.nodeId === this.state.delegatorNodeId) {
        // Delegator is alive
      }
    });
  }

  /**
   * Handle range received
   */
  private handleRangeReceived(range: NonceRange): void {
    this.state.currentRange = range;
    this.state.isRequestingRange = false;
    this.rangeStart = range.start;
    this.rangeEnd = range.end;
    this.currentNonce = range.start;
    this.hashesTried = 0;
    this.hashRate = 0;
    
    console.log(`[Phase 19] Worker ${this.workerId} received range [${range.start}, ${range.end})`);
    
    // Notify handlers
    for (const handler of this.onRangeReceivedHandlers) {
      handler(range);
    }
    
    // Start progress reporting
    this.startProgressReporting();
  }

  /**
   * Request nonce range from delegator
   */
  requestNonceRange(workerId: number, capability: NodeCapability): void {
    if (this.state.isRequestingRange) {
      return; // Already requesting
    }
    
    this.workerId = workerId;
    this.state.isRequestingRange = true;
    
    // Send capability info
    if (this.p2pNode) {
      this.p2pNode.broadcast("WORKER_INFO", capability);
      
      // Request range
      this.p2pNode.broadcast("REQUEST_NONCE_RANGE", {
        nodeId: this.nodeId,
        workerId,
      });
    }
    
    console.log(`[Phase 19] Worker ${workerId} requesting nonce range`);
  }

  /**
   * Update mining progress
   */
  updateProgress(nonce: bigint, hashesTried: number, hashRate: number): void {
    this.currentNonce = nonce;
    this.hashesTried = hashesTried;
    this.hashRate = hashRate;
    
    // Check if range is exhausted
    if (this.state.currentRange && nonce >= this.state.currentRange.end) {
      this.handleRangeExhausted();
    }
  }

  /**
   * Handle range exhausted
   */
  private handleRangeExhausted(): void {
    if (!this.state.currentRange) return;
    
    console.log(`[Phase 19] Worker ${this.workerId} exhausted range`);
    
    // Notify delegator
    if (this.p2pNode) {
      this.p2pNode.broadcast("NONCE_RANGE_EXHAUSTED", {
        nodeId: this.nodeId,
        workerId: this.workerId,
      });
    }
    
    // Request new range
    this.state.currentRange = null;
    this.state.isRequestingRange = true;
    
    // Notify handlers
    for (const handler of this.onRangeExhaustedHandlers) {
      handler();
    }
  }

  /**
   * Start progress reporting
   */
  private startProgressReporting(): void {
    if (this.progressReportInterval) return;
    
    this.progressReportInterval = window.setInterval(() => {
      if (!this.state.currentRange || !this.p2pNode) return;
      
      const progress: WorkerProgress = {
        nodeId: this.nodeId,
        workerId: this.workerId,
        hashesTried: this.hashesTried,
        currentNonce: this.currentNonce,
        hashRate: this.hashRate,
        rangeStart: this.rangeStart,
        rangeEnd: this.rangeEnd,
        progressPercent: this.rangeEnd > this.rangeStart
          ? Number((this.currentNonce - this.rangeStart) * 100n / (this.rangeEnd - this.rangeStart))
          : 0,
      };
      
      this.p2pNode.broadcast("WORKER_PROGRESS", progress);
      this.state.lastProgressReport = Date.now();
    }, this.PROGRESS_REPORT_INTERVAL_MS);
  }

  /**
   * Stop progress reporting
   */
  private stopProgressReporting(): void {
    if (this.progressReportInterval) {
      clearInterval(this.progressReportInterval);
      this.progressReportInterval = null;
    }
  }

  /**
   * Get current range
   */
  getCurrentRange(): NonceRange | null {
    return this.state.currentRange;
  }

  /**
   * Get current state
   */
  getState(): WorkerNodeState {
    return { ...this.state };
  }

  /**
   * Reset for new block
   */
  reset(): void {
    this.state.currentRange = null;
    this.state.isRequestingRange = false;
    this.stopProgressReporting();
  }

  /**
   * Event: Range received
   */
  onRangeReceived(handler: (range: NonceRange) => void): void {
    this.onRangeReceivedHandlers.add(handler);
  }

  /**
   * Event: Range exhausted
   */
  onRangeExhausted(handler: () => void): void {
    this.onRangeExhaustedHandlers.add(handler);
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopProgressReporting();
    this.onRangeReceivedHandlers.clear();
    this.onRangeExhaustedHandlers.clear();
  }
}

