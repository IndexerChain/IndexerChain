/**
 * Phase 31: Long-range Divergence Detector
 * 
 * Detects and repairs long-range forks by checking checkpoint state commitments
 * against the majority of peers.
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { logger } from "./logger.js";

/**
 * Checkpoint state commitment response from peer
 */
export interface CheckpointResponse {
  height: number;
  stateCommitment: string;
  blockHash: string;
  peerId: string;
}

/**
 * Divergence detection result
 */
export interface DivergenceResult {
  diverged: boolean;
  localHeight: number;
  localStateCommitment: string;
  majorityHeight: number;
  majorityStateCommitment: string;
  majorityBlockHash: string;
  peerCount: number;
  reason?: string;
}

/**
 * Long-range Divergence Detector
 * 
 * Periodically checks checkpoint state commitments against peers
 * and automatically repairs divergences.
 */
export class LongRangeDetector {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private checkpointResponses: Map<string, CheckpointResponse[]> = new Map();
  private onDivergenceDetected: ((result: DivergenceResult) => Promise<void>) | null = null;

  constructor(
    private chainContext: ChainContext,
    private p2pNode: P2PNode | null
  ) {}

  /**
   * Start divergence detection
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    logger.debug("[Phase 31] Starting Long-range Divergence Detector...");
    
    // Check every 5 minutes
    this.checkInterval = setInterval(() => {
      this.performCheckpointCheck().catch(err => {
        console.error("[Phase 31] Checkpoint check failed:", err);
      });
    }, 5 * 60 * 1000);
    
    // Initial check after 10 seconds
    setTimeout(() => {
      this.performCheckpointCheck().catch(err => {
        console.error("[Phase 31] Initial checkpoint check failed:", err);
      });
    }, 10000);
  }

  /**
   * Stop divergence detection
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    logger.debug("[Phase 31] Stopped Long-range Divergence Detector.");
  }

  /**
   * Set callback for when divergence is detected
   */
  setOnDivergenceDetected(callback: (result: DivergenceResult) => Promise<void>): void {
    this.onDivergenceDetected = callback;
  }

  /**
   * Handle checkpoint response from peer
   */
  onCheckpointResponse(response: CheckpointResponse): void {
    const key = `${response.height}`;
    if (!this.checkpointResponses.has(key)) {
      this.checkpointResponses.set(key, []);
    }
    
    const responses = this.checkpointResponses.get(key)!;
    
    // Avoid duplicates
    if (responses.some(r => r.peerId === response.peerId)) {
      return;
    }
    
    responses.push(response);
    
    // Keep only recent responses (limit array size to prevent memory leak)
    if (responses.length > 100) {
      responses.shift();
    }
  }

  /**
   * Perform checkpoint check
   */
  async performCheckpointCheck(): Promise<void> {
    if (!this.p2pNode || !this.p2pNode.isConnected) {
      return;
    }

    const peerCount = this.p2pNode.getPeerCount();
    if (peerCount < 3) {
      // Need at least 3 peers for reliable consensus
      return;
    }

    const localTip = this.chainContext.storage.getTip();
    if (!localTip) {
      return;
    }

    const localHeight = localTip.header.height;
    
    // Checkpoint every 1000 blocks
    const checkpointHeight = Math.floor(localHeight / 1000) * 1000;
    
    if (checkpointHeight === 0) {
      // Genesis block, no need to check
      return;
    }

    // Get local checkpoint state commitment
    const checkpointBlock = this.chainContext.storage.getBlockByHeight(checkpointHeight);
    if (!checkpointBlock) {
      console.warn(`[Phase 31] Local checkpoint block at height ${checkpointHeight} not found`);
      return;
    }

    const localStateCommitment = checkpointBlock.header.stateCommitment;
    if (!localStateCommitment) {
      console.warn(`[Phase 31] Local checkpoint block at height ${checkpointHeight} has no stateCommitment`);
      return;
    }

    // Request checkpoint from all peers
    this.checkpointResponses.delete(`${checkpointHeight}`);
    
    if (this.p2pNode.broadcast) {
      this.p2pNode.broadcast("CHECKPOINT_REQUEST", {
        height: checkpointHeight,
      });
    }

    // Wait for responses (5 seconds)
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Analyze responses
    const responses = this.checkpointResponses.get(`${checkpointHeight}`) || [];
    
    if (responses.length < 3) {
      // Not enough responses
      return;
    }

    // Find majority state commitment
    const stateCommitmentCounts = new Map<string, { count: number; blockHash: string }>();
    
    for (const response of responses) {
      const key = response.stateCommitment;
      if (!stateCommitmentCounts.has(key)) {
        stateCommitmentCounts.set(key, { count: 0, blockHash: response.blockHash });
      }
      const entry = stateCommitmentCounts.get(key)!;
      entry.count++;
    }

    // Find majority
    let majorityStateCommitment: string | null = null;
    let majorityCount = 0;
    let majorityBlockHash: string | null = null;

    for (const [stateCommitment, data] of stateCommitmentCounts.entries()) {
      if (data.count > majorityCount) {
        majorityCount = data.count;
        majorityStateCommitment = stateCommitment;
        majorityBlockHash = data.blockHash;
      }
    }

    if (!majorityStateCommitment || !majorityBlockHash) {
      return;
    }

    // Check if local matches majority
    if (localStateCommitment === majorityStateCommitment) {
      // Local is consistent with majority
      return;
    }

    // Divergence detected!
    console.warn(`[Phase 31] Divergence detected at checkpoint height ${checkpointHeight}:`, {
      localStateCommitment: localStateCommitment.substring(0, 16) + "...",
      majorityStateCommitment: majorityStateCommitment.substring(0, 16) + "...",
      majorityCount,
      totalResponses: responses.length,
    });

    const result: DivergenceResult = {
      diverged: true,
      localHeight: checkpointHeight,
      localStateCommitment,
      majorityHeight: checkpointHeight,
      majorityStateCommitment,
      majorityBlockHash,
      peerCount: responses.length,
      reason: `Local state commitment at checkpoint height ${checkpointHeight} does not match majority (${majorityCount}/${responses.length} peers)`,
    };

    // Trigger repair
    if (this.onDivergenceDetected) {
      await this.onDivergenceDetected(result);
    }
  }

  /**
   * Get latest divergence check result
   */
  getLatestCheckResult(): DivergenceResult | null {
    // This would be populated by performCheckpointCheck
    // For now, return null as we handle divergence immediately
    return null;
  }
}

