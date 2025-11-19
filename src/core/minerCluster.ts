/**
 * Miner Cluster Module
 * 
 * Phase 18: Local Cluster Mining
 * Phase 37-A: Added MiningEpochManager integration
 * 
 * Manages multiple Web Worker miners for parallel mining, providing
 * high-performance local mining cluster within a single browser.
 */

import type { Block } from "./types.js";
import { MinerClient } from "./minerClient.js";
import { MiningEpochManager } from "./miningEpoch.js";
import { NodeNonceRangeManager } from "./nonceRangeManager.js";
import type { NonceRange } from "./globalNonceAllocator.js";
import type { RuntimeManager } from "./runtimeManager.js";
import { logger } from "./logger.js";

/**
 * Worker statistics
 * Phase 37-E: Added error tracking
 */
export interface WorkerStats {
  workerId: number;
  hashesTried: number;
  hashRate: number | null; // hashes per second
  currentNonceStart: bigint;
  currentNonceEnd: bigint | null;
  status: "running" | "stopped" | "exhausted" | "error"; // Phase 37-E: Added error status
  startedAt: number | null;
  errorCount: number; // Phase 37-E: Error count in last minute
  lastErrorTime: number | null; // Phase 37-E: Last error timestamp
  crashTimestamps: number[]; // Phase 37-E: Crash timestamps in last minute
}

/**
 * Cluster statistics
 */
export interface ClusterStats {
  totalWorkers: number;
  activeWorkers: number;
  totalHashesTried: bigint;
  totalHashRate: number | null; // Combined hash rate of all workers
  workers: WorkerStats[];
}

/**
 * Mining start parameters with nonce range
 * Phase 37-B: Added globalNonceRange support
 */
export interface ClusterMiningParams {
  candidateBlock: Block;
  difficulty: number;
  workerCount: number;
  nonceRangeSize?: bigint; // Default: 1,000,000,000 per worker
  dutyCycle?: number; // Phase 26: CPU duty cycle (0.0 to 1.0)
  globalNonceRange?: NonceRange | null; // Phase 37-B: Global pool range, or null for local-only mode
}

/**
 * Miner Cluster - Manages multiple Web Worker miners
 * 
 * Features:
 * - Parallel mining across multiple workers
 * - Nonce range partitioning to avoid collisions
 * - Fast response to new block headers (Phase 17)
 * - Dynamic worker management
 */
export class MinerCluster {
  private workers: MinerClient[] = [];
  private workerCount: number = 0;
  private readonly DEFAULT_NONCE_RANGE_SIZE = 1_000_000_000n; // 1 billion nonces per worker
  private workerStats: Map<number, WorkerStats> = new Map();
  private isMining: boolean = false;
  private currentCandidateBlock: Block | null = null;
  private currentDifficulty: number = 0;
  
  // Phase 37-A: Mining epoch management
  private epochManager: MiningEpochManager = new MiningEpochManager();
  
  // Phase 37-B: Node-level nonce range management
  private nodeRangeManager: NodeNonceRangeManager = new NodeNonceRangeManager();
  
  // Phase 37-D: RuntimeManager integration
  private currentDutyCycle: number = 1.0;
  private runtimeChangeUnsubscribe: (() => void) | null = null;
  
  // Phase 37-E: Error recovery configuration
  private readonly MAX_ERRORS_PER_MINUTE = 3; // Max errors before reducing worker count
  private readonly ERROR_WINDOW_MS = 60_000; // 1 minute window
  private readonly RECOVERY_DELAY_MS = 2000; // 2 seconds delay before recovery

  // Event handlers
  private onProgressHandlers: Set<(stats: ClusterStats) => void> = new Set();
  private onFoundHandlers: Set<(block: Block, workerId: number) => void> = new Set();
  private onStoppedHandlers: Set<(reason: string) => void> = new Set();
  private onExhaustedGlobalRangeHandlers: Set<() => void> = new Set(); // Phase 37-B: Global range exhausted callback

  /**
   * Get optimal worker count based on CPU cores
   * Phase 37-D: Deprecated - use RuntimeManager.getRecommendedProfile() instead
   */
  static getOptimalWorkerCount(): number {
    if (typeof navigator !== "undefined" && "hardwareConcurrency" in navigator) {
      const cores = navigator.hardwareConcurrency || 4;
      // Use cores - 1 to leave one core for UI, or at least 1
      return Math.max(1, cores - 1);
    }
    return 4; // Default fallback
  }

  /**
   * Phase 37-D: Set RuntimeManager for dynamic profile management
   */
  setRuntimeManager(runtimeManager: RuntimeManager | null): void {
    // Unsubscribe from previous runtime manager
    if (this.runtimeChangeUnsubscribe) {
      this.runtimeChangeUnsubscribe();
      this.runtimeChangeUnsubscribe = null;
    }

    if (runtimeManager) {
      // Subscribe to runtime changes
      this.runtimeChangeUnsubscribe = runtimeManager.onRuntimeChange((profile) => {
        this.configure({
          workerCount: profile.workerCount,
          dutyCycle: profile.dutyCycle,
        });
      });

      // Apply initial profile
      const initialProfile = runtimeManager.getRecommendedProfile();
      this.configure({
        workerCount: initialProfile.workerCount,
        dutyCycle: initialProfile.dutyCycle,
      });
    }
  }

  /**
   * Phase 37-D: Configure cluster with new worker count and duty cycle
   * 
   * This method can be called dynamically to adjust mining parameters
   * without stopping and restarting mining.
   */
  configure(params: { workerCount: number; dutyCycle: number }): void {
    const newWorkerCount = Math.max(1, params.workerCount);
    const newDutyCycle = Math.max(0.1, Math.min(1.0, params.dutyCycle));

    // Update duty cycle for all existing workers
    if (this.isMining) {
      for (const worker of this.workers) {
        worker.setDutyCycle(newDutyCycle);
      }
    }

    this.currentDutyCycle = newDutyCycle;

    // Adjust worker count if needed
    if (this.isMining && newWorkerCount !== this.workerCount) {
      if (newWorkerCount > this.workerCount) {
        // Add more workers
        this.addWorkers(newWorkerCount - this.workerCount);
      } else if (newWorkerCount < this.workerCount) {
        // Remove workers
        this.removeWorkers(this.workerCount - newWorkerCount);
      }
    }

    logger.debug(`[MinerCluster] Configured: workers=${newWorkerCount}, dutyCycle=${newDutyCycle.toFixed(2)}`);
  }

  /**
   * Phase 37-D: Add workers dynamically
   */
  private addWorkers(count: number): void {
    if (!this.isMining || !this.currentCandidateBlock) {
      return;
    }

    const currentEpoch = this.epochManager.getCurrent();
    if (!currentEpoch) {
      return;
    }

    const nonceRangeSize = this.DEFAULT_NONCE_RANGE_SIZE;
    const startWorkerId = this.workers.length;

    for (let i = 0; i < count; i++) {
      const worker = new MinerClient();
      const workerId = startWorkerId + i;

      // Allocate nonce range
      const subRange = this.nodeRangeManager.allocateSubRange(nonceRangeSize);
      if (!subRange) {
        console.warn(`[MinerCluster] Cannot allocate range for new worker ${workerId}`);
        break;
      }

      const nonceStart = subRange.start;
      const nonceEnd = subRange.end;

      // Initialize worker stats
      this.workerStats.set(workerId, {
        workerId,
        hashesTried: 0,
        hashRate: null,
        currentNonceStart: nonceStart,
        currentNonceEnd: nonceEnd,
        status: "running",
        startedAt: Date.now(),
        errorCount: 0, // Phase 37-E: Initialize error tracking
        lastErrorTime: null,
        crashTimestamps: [],
      });

      // Set up event handlers
      worker.setEpochValidator((epochId) => this.epochManager.isValid(epochId));

      worker.onProgress((event) => {
        if (!this.epochManager.isValid(event.miningEpochId)) {
          return;
        }
        const stats = this.workerStats.get(workerId);
        if (stats) {
          const elapsed = (Date.now() - (stats.startedAt || Date.now())) / 1000;
          stats.hashesTried = event.hashesTried;
          stats.hashRate = elapsed > 0 ? event.hashesTried / elapsed : null;
          this.updateClusterStats();
        }
      });

      worker.onFound((event) => {
        if (!this.epochManager.isValid(event.miningEpochId)) {
          return;
        }
        if (!this.currentCandidateBlock) {
          return;
        }
        const foundBlock: Block = {
          ...this.currentCandidateBlock,
          header: {
            ...this.currentCandidateBlock.header,
            nonce: event.nonce,
          },
          hash: event.hash,
        };
        this.stopMining("found");
        for (const handler of this.onFoundHandlers) {
          handler(foundBlock, workerId);
        }
      });

      worker.onStopped((event) => {
        if (event.reason === "exhausted" && !this.epochManager.isValid(event.miningEpochId)) {
          return;
        }
        const stats = this.workerStats.get(workerId);
        if (stats) {
          if (event.reason === "exhausted") {
            stats.status = "exhausted";
            this.assignNewNonceRange(worker, workerId);
          } else {
            stats.status = "stopped";
          }
        }
      });

      // Start worker
      worker.startMining({
        candidateBlock: this.currentCandidateBlock,
        difficulty: this.currentDifficulty,
        nonceStart,
        nonceEnd,
        dutyCycle: this.currentDutyCycle,
        miningEpochId: currentEpoch,
      });

      this.workers.push(worker);
      this.workerCount = this.workers.length;
    }

    logger.debug(`[MinerCluster] Added ${count} workers, total: ${this.workers.length}`);
  }

  /**
   * Phase 37-D: Remove workers dynamically
   */
  private removeWorkers(count: number): void {
    const toRemove = Math.min(count, this.workers.length);
    
    for (let i = 0; i < toRemove; i++) {
      const worker = this.workers.pop();
      if (worker) {
        worker.stopMining("user");
        worker.destroy();
        
        // Remove stats
        const workerId = this.workerStats.size - 1;
        this.workerStats.delete(workerId);
      }
    }

    this.workerCount = this.workers.length;
    logger.debug(`[MinerCluster] Removed ${toRemove} workers, total: ${this.workers.length}`);
  }

  /**
   * Start cluster mining with multiple workers
   * Phase 37-A: Creates new mining epoch before starting
   */
  async startMining(params: ClusterMiningParams): Promise<void> {
    if (this.isMining) {
      console.warn("[Phase 18] Cluster is already mining, stopping first...");
      await this.stopMining("restart");
    }

    // Phase 37-A: Create new mining epoch
    const tip = params.candidateBlock.header.prevHash || "genesis";
    const height = params.candidateBlock.header.height;
    const epochId = this.epochManager.newEpoch(height, tip);
    logger.debug(`[MinerCluster] Starting mining with epoch: ${epochId.substring(0, 32)}...`);

    // Phase 37-B: Set global nonce range (or null for local-only mode)
    this.nodeRangeManager.setGlobalRange(params.globalNonceRange ?? null);

    this.currentCandidateBlock = params.candidateBlock;
    this.currentDifficulty = params.difficulty;
    this.workerCount = params.workerCount;
    this.isMining = true;

    const nonceRangeSize = params.nonceRangeSize ?? this.DEFAULT_NONCE_RANGE_SIZE;

    // Create and start workers
    this.workers = [];
    this.workerStats.clear();

    for (let i = 0; i < params.workerCount; i++) {
      const worker = new MinerClient();
      const workerId = i;
      
      // Phase 37-B: Use NodeNonceRangeManager to allocate sub-range
      const subRange = this.nodeRangeManager.allocateSubRange(nonceRangeSize);
      if (!subRange) {
        // Global range exhausted
        console.warn(`[MinerCluster] Cannot allocate range for worker ${workerId}: global range exhausted`);
        if (this.nodeRangeManager.isExhausted()) {
          // Notify listeners that global range is exhausted
          for (const handler of this.onExhaustedGlobalRangeHandlers) {
            handler();
          }
        }
        break; // Stop creating more workers
      }
      
      const nonceStart = subRange.start;
      const nonceEnd = subRange.end;

      // Initialize worker stats
      this.workerStats.set(workerId, {
        workerId,
        hashesTried: 0,
        hashRate: null,
        currentNonceStart: nonceStart,
        currentNonceEnd: nonceEnd,
        status: "running",
        startedAt: Date.now(),
        errorCount: 0, // Phase 37-E: Initialize error tracking
        lastErrorTime: null,
        crashTimestamps: [],
      });

      // Phase 37-A: Set epoch validator for this worker
      worker.setEpochValidator((epochId) => this.epochManager.isValid(epochId));

      // Set up worker event handlers BEFORE starting mining
      // This ensures handlers are registered before worker starts sending events
      worker.onProgress((event) => {
        // Phase 37-A: Epoch validation is done in MinerClient, but double-check here
        if (!this.epochManager.isValid(event.miningEpochId)) {
          logger.debug(`[MinerCluster] Discarding stale PROGRESS from worker ${workerId}`);
          return;
        }

        const stats = this.workerStats.get(workerId);
        if (stats) {
          const elapsed = (Date.now() - (stats.startedAt || Date.now())) / 1000;
          stats.hashesTried = event.hashesTried;
          stats.hashRate = elapsed > 0 ? event.hashesTried / elapsed : null;
          this.updateClusterStats();
        }
      });

      worker.onFound((event) => {
        // Phase 37-A: Validate epoch before processing FOUND
        if (!this.epochManager.isValid(event.miningEpochId)) {
          logger.debug(`[MinerCluster] Discarding stale FOUND from worker ${workerId}`);
          return;
        }

        // Phase 37-C: Reconstruct full block from nonce
        if (!this.currentCandidateBlock) {
          console.error(`[MinerCluster] Cannot reconstruct block: currentCandidateBlock is null`);
          return;
        }

        // Construct complete block with found nonce
        const foundBlock: Block = {
          ...this.currentCandidateBlock,
          header: {
            ...this.currentCandidateBlock.header,
            nonce: event.nonce,
          },
          hash: event.hash,
        };

        // Stop all workers immediately
        this.stopMining("found");
        // Notify cluster listeners
        for (const handler of this.onFoundHandlers) {
          handler(foundBlock, workerId);
        }
      });

      worker.onStopped((event) => {
        // Phase 37-A: Validate epoch (but allow STOPPED from any epoch for cleanup)
        // Only discard if it's a stale exhausted/error event
        if (event.reason === "exhausted" && !this.epochManager.isValid(event.miningEpochId)) {
          logger.debug(`[MinerCluster] Discarding stale EXHAUSTED from worker ${workerId}`);
          return;
        }

        const stats = this.workerStats.get(workerId);
        if (stats) {
          if (event.reason === "exhausted") {
            stats.status = "exhausted";
            // Request new nonce range and restart
            this.assignNewNonceRange(worker, workerId);
          } else if (event.reason === "error") {
            // Phase 37-E: Handle worker error
            this.handleWorkerError(worker, workerId, event.errorMessage || "Unknown error");
          } else {
            stats.status = "stopped";
          }
        }
      });

      // Start worker with nonce range (handlers already registered above)
      logger.debug(`[MinerCluster] Starting worker ${workerId}: nonceStart=${nonceStart}, nonceEnd=${nonceEnd}, difficulty=${params.difficulty}`);
      // Phase 37-D: Use current duty cycle (may have been set by configure())
      const effectiveDutyCycle = params.dutyCycle ?? this.currentDutyCycle;
      this.currentDutyCycle = effectiveDutyCycle;

      worker.startMining({
        candidateBlock: params.candidateBlock,
        difficulty: params.difficulty,
        nonceStart,
        nonceEnd,
        dutyCycle: effectiveDutyCycle, // Phase 26: Pass duty cycle to worker
        miningEpochId: epochId, // Phase 37-A: Pass epoch ID to worker
        // Note: Do NOT pass onProgress/onFound/onStopped here - they're already registered via onProgress() above
      });

      this.workers.push(worker);
      logger.debug(`[MinerCluster] Worker ${workerId} started, total workers: ${this.workers.length}`);
    }

    // Initialize cluster stats immediately after creating workers
    this.updateClusterStats();

    // Started cluster mining
    console.log(`[Phase 18] Cluster mining started with ${this.workers.length} workers`);
  }

  /**
   * Stop all workers
   * Phase 37-A: Resets mining epoch when stopping
   */
  async stopMining(reason: "user" | "found" | "replaced" | "restart" = "user"): Promise<void> {
    if (!this.isMining) return;

    this.isMining = false;

    // Phase 37-A: Reset epoch after stopping workers

    // Stop all workers
    for (const worker of this.workers) {
      worker.stopMining(reason === "replaced" || reason === "restart" ? "replaced" : "user");
    }

    // Phase 37-A: Reset epoch after stopping workers
    this.epochManager.reset();

    // Update stats
    for (const stats of this.workerStats.values()) {
      stats.status = "stopped";
    }

    // Notify listeners
    for (const handler of this.onStoppedHandlers) {
      handler(reason);
    }

    // Stopped cluster mining
  }

  /**
   * Assign new nonce range to a worker that exhausted its range
   * Phase 37-A: Uses current epoch ID when restarting worker
   * Phase 37-B: Uses NodeNonceRangeManager to allocate sub-range
   */
  private assignNewNonceRange(worker: MinerClient, workerId: number): void {
    if (!this.isMining || !this.currentCandidateBlock) return;

    // Phase 37-A: Check if epoch is still valid
    const currentEpoch = this.epochManager.getCurrent();
    if (!currentEpoch) {
      logger.debug(`[MinerCluster] Cannot assign new range: epoch is not active`);
      return;
    }

    // Phase 37-B: Allocate new sub-range from NodeNonceRangeManager
    const nonceRangeSize = this.DEFAULT_NONCE_RANGE_SIZE;
    const subRange = this.nodeRangeManager.allocateSubRange(nonceRangeSize);
    
    if (!subRange) {
      // Global range exhausted
      logger.debug(`[MinerCluster] Cannot assign new range to worker ${workerId}: global range exhausted`);
      if (this.nodeRangeManager.isExhausted()) {
        // Notify listeners that global range is exhausted
        for (const handler of this.onExhaustedGlobalRangeHandlers) {
          handler();
        }
      }
      return;
    }

    const nonceStart = subRange.start;
    const nonceEnd = subRange.end;

    const stats = this.workerStats.get(workerId);
    if (stats) {
      stats.currentNonceStart = nonceStart;
      stats.currentNonceEnd = nonceEnd;
      stats.status = "running";
      stats.startedAt = Date.now();
      stats.hashesTried = 0;
      stats.hashRate = null;
      // Phase 37-E: Reset error tracking when assigning new range
      stats.errorCount = 0;
      stats.lastErrorTime = null;
      stats.crashTimestamps = [];
    }

    // Restart worker with new range
    worker.startMining({
      candidateBlock: this.currentCandidateBlock,
      difficulty: this.currentDifficulty,
      nonceStart,
      nonceEnd,
      dutyCycle: this.currentDutyCycle, // Phase 37-D: Use current duty cycle
      miningEpochId: currentEpoch, // Phase 37-A: Use current epoch ID
    });

    // Worker assigned new nonce range
  }

  /**
   * Phase 37-E: Handle worker error and attempt recovery
   */
  private handleWorkerError(worker: MinerClient, workerId: number, errorMessage: string): void {
    const stats = this.workerStats.get(workerId);
    if (!stats) {
      return;
    }

    const now = Date.now();
    
    // Update error tracking
    stats.status = "error";
    stats.lastErrorTime = now;
    stats.crashTimestamps.push(now);
    
    // Clean old crash timestamps (keep only last minute)
    stats.crashTimestamps = stats.crashTimestamps.filter(
      (timestamp) => now - timestamp < this.ERROR_WINDOW_MS
    );
    stats.errorCount = stats.crashTimestamps.length;

    console.warn(`[MinerCluster] Worker ${workerId} error: ${errorMessage} (errorCount: ${stats.errorCount})`);

    // Check if we should reduce worker count
    if (stats.errorCount > this.MAX_ERRORS_PER_MINUTE) {
      console.error(`[MinerCluster] Worker ${workerId} has ${stats.errorCount} errors in last minute, reducing worker count`);
      
      // Report crash to RuntimeManager if available
      // Note: RuntimeManager is not directly accessible here, but we can reduce worker count
      // The RuntimeManager will detect the reduced performance and adjust profile accordingly
      
      // Reduce worker count by 1
      if (this.workers.length > 1) {
        this.removeWorkers(1);
        // Don't try to recover this worker
        return;
      }
    }

    // Attempt to recover worker after delay
    setTimeout(() => {
      if (!this.isMining) {
        return; // Mining stopped, don't recover
      }

      const currentStats = this.workerStats.get(workerId);
      if (!currentStats || currentStats.status !== "error") {
        return; // Worker already recovered or removed
      }

      // Check if we still have the candidate block
      if (!this.currentCandidateBlock) {
        console.error(`[MinerCluster] Cannot recover worker ${workerId}: no candidate block`);
        return;
      }

      const currentEpoch = this.epochManager.getCurrent();
      if (!currentEpoch) {
        console.error(`[MinerCluster] Cannot recover worker ${workerId}: no current epoch`);
        return;
      }

      // Try to recover by assigning new nonce range
      logger.debug(`[MinerCluster] Attempting to recover worker ${workerId}...`);
      
      // Destroy old worker and create new one
      worker.destroy();
      const newWorker = new MinerClient();
      
      // Allocate new nonce range
      const subRange = this.nodeRangeManager.allocateSubRange(this.DEFAULT_NONCE_RANGE_SIZE);
      if (!subRange) {
        console.warn(`[MinerCluster] Cannot allocate range for recovered worker ${workerId}`);
        // Remove worker if we can't allocate range
        this.removeWorkers(1);
        return;
      }

      const nonceStart = subRange.start;
      const nonceEnd = subRange.end;

      // Update stats
      currentStats.status = "running";
      currentStats.currentNonceStart = nonceStart;
      currentStats.currentNonceEnd = nonceEnd;
      currentStats.startedAt = Date.now();
      // Phase 37-E: Reset error tracking on recovery
      currentStats.errorCount = 0;
      currentStats.lastErrorTime = null;
      currentStats.crashTimestamps = [];

      // Set up event handlers (same as in startMining)
      newWorker.setEpochValidator((epochId) => this.epochManager.isValid(epochId));

      newWorker.onProgress((event) => {
        if (!this.epochManager.isValid(event.miningEpochId)) {
          return;
        }
        const workerStats = this.workerStats.get(workerId);
        if (workerStats) {
          const elapsed = (Date.now() - (workerStats.startedAt || Date.now())) / 1000;
          workerStats.hashesTried = event.hashesTried;
          workerStats.hashRate = elapsed > 0 ? event.hashesTried / elapsed : null;
          this.updateClusterStats();
        }
      });

      newWorker.onFound((event) => {
        if (!this.epochManager.isValid(event.miningEpochId)) {
          return;
        }
        if (!this.currentCandidateBlock) {
          return;
        }
        const foundBlock: Block = {
          ...this.currentCandidateBlock,
          header: {
            ...this.currentCandidateBlock.header,
            nonce: event.nonce,
          },
          hash: event.hash,
        };
        this.stopMining("found");
        for (const handler of this.onFoundHandlers) {
          handler(foundBlock, workerId);
        }
      });

      newWorker.onStopped((event) => {
        if (event.reason === "exhausted" && !this.epochManager.isValid(event.miningEpochId)) {
          return;
        }
        const workerStats = this.workerStats.get(workerId);
        if (workerStats) {
          if (event.reason === "exhausted") {
            workerStats.status = "exhausted";
            this.assignNewNonceRange(newWorker, workerId);
          } else if (event.reason === "error") {
            this.handleWorkerError(newWorker, workerId, event.errorMessage || "Unknown error");
          } else {
            workerStats.status = "stopped";
          }
        }
      });

      // Replace worker in array
      this.workers[workerId] = newWorker;

      // Start recovered worker
      newWorker.startMining({
        candidateBlock: this.currentCandidateBlock,
        difficulty: this.currentDifficulty,
        nonceStart,
        nonceEnd,
        dutyCycle: this.currentDutyCycle,
        miningEpochId: currentEpoch,
      });

      logger.debug(`[MinerCluster] Worker ${workerId} recovered successfully`);
    }, this.RECOVERY_DELAY_MS);
  }

  /**
   * Update cluster statistics and notify listeners
   */
  private updateClusterStats(): void {
    const stats = this.getStats();
    for (const handler of this.onProgressHandlers) {
      handler(stats);
    }
  }

  /**
   * Get cluster statistics
   */
  getStats(): ClusterStats {
    const workers: WorkerStats[] = Array.from(this.workerStats.values());
    const activeWorkers = workers.filter((w) => w.status === "running").length;

    // Calculate total hashes tried
    let totalHashesTried = 0n;
    for (const w of workers) {
      totalHashesTried += BigInt(w.hashesTried);
    }

    // Calculate combined hash rate
    let totalHashRate: number | null = null;
    const validRates = workers
      .map((w) => w.hashRate)
      .filter((rate): rate is number => rate !== null);
    if (validRates.length > 0) {
      totalHashRate = validRates.reduce((sum, rate) => sum + rate, 0);
    }

    return {
      totalWorkers: this.workerCount,
      activeWorkers,
      totalHashesTried,
      totalHashRate,
      workers,
    };
  }

  /**
   * Check if cluster is currently mining
   */
  isClusterMining(): boolean {
    return this.isMining;
  }

  /**
   * Get current worker count
   */
  getWorkerCount(): number {
    return this.workerCount;
  }

  /**
   * Event: Progress update
   */
  onProgress(handler: (stats: ClusterStats) => void): void {
    this.onProgressHandlers.add(handler);
  }

  /**
   * Event: Block found
   */
  onFound(handler: (block: Block, workerId: number) => void): void {
    this.onFoundHandlers.add(handler);
  }

  /**
   * Event: Mining stopped
   */
  onStopped(handler: (reason: string) => void): void {
    this.onStoppedHandlers.add(handler);
  }

  /**
   * Event: Global nonce range exhausted
   * Phase 37-B: Called when all workers have exhausted the global range
   */
  onExhaustedGlobalRange(handler: () => void): void {
    this.onExhaustedGlobalRangeHandlers.add(handler);
  }

  /**
   * Cleanup: Destroy all workers
   * Phase 37-D: Unsubscribe from RuntimeManager
   */
  destroy(): void {
    this.stopMining("user");
    for (const worker of this.workers) {
      worker.destroy();
    }
    this.workers = [];
    this.workerStats.clear();
    this.onProgressHandlers.clear();
    this.onFoundHandlers.clear();
    this.onStoppedHandlers.clear();
    
    // Phase 37-D: Unsubscribe from RuntimeManager
    if (this.runtimeChangeUnsubscribe) {
      this.runtimeChangeUnsubscribe();
      this.runtimeChangeUnsubscribe = null;
    }
  }
}

