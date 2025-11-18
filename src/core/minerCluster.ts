/**
 * Miner Cluster Module
 * 
 * Phase 18: Local Cluster Mining
 * 
 * Manages multiple Web Worker miners for parallel mining, providing
 * high-performance local mining cluster within a single browser.
 */

import type { Block } from "./types.js";
import { MinerClient } from "./minerClient.js";

/**
 * Worker statistics
 */
export interface WorkerStats {
  workerId: number;
  hashesTried: number;
  hashRate: number | null; // hashes per second
  currentNonceStart: bigint;
  currentNonceEnd: bigint | null;
  status: "running" | "stopped" | "exhausted";
  startedAt: number | null;
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
 */
export interface ClusterMiningParams {
  candidateBlock: Block;
  difficulty: number;
  workerCount: number;
  nonceRangeSize?: bigint; // Default: 1,000,000,000 per worker
  dutyCycle?: number; // Phase 26: CPU duty cycle (0.0 to 1.0)
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
  private nextNonceStart: bigint = 0n;
  private readonly DEFAULT_NONCE_RANGE_SIZE = 1_000_000_000n; // 1 billion nonces per worker
  private workerStats: Map<number, WorkerStats> = new Map();
  private isMining: boolean = false;
  private currentCandidateBlock: Block | null = null;
  private currentDifficulty: number = 0;

  // Event handlers
  private onProgressHandlers: Set<(stats: ClusterStats) => void> = new Set();
  private onFoundHandlers: Set<(block: Block, workerId: number) => void> = new Set();
  private onStoppedHandlers: Set<(reason: string) => void> = new Set();

  /**
   * Get optimal worker count based on CPU cores
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
   * Start cluster mining with multiple workers
   */
  async startMining(params: ClusterMiningParams): Promise<void> {
    if (this.isMining) {
      console.warn("[Phase 18] Cluster is already mining, stopping first...");
      await this.stopMining("restart");
    }

    this.currentCandidateBlock = params.candidateBlock;
    this.currentDifficulty = params.difficulty;
    this.workerCount = params.workerCount;
    this.nextNonceStart = 0n;
    this.isMining = true;

    const nonceRangeSize = params.nonceRangeSize ?? this.DEFAULT_NONCE_RANGE_SIZE;

    // Create and start workers
    this.workers = [];
    this.workerStats.clear();

    for (let i = 0; i < params.workerCount; i++) {
      const worker = new MinerClient();
      const workerId = i;
      const nonceStart = this.nextNonceStart;
      const nonceEnd = nonceStart + nonceRangeSize;
      this.nextNonceStart = nonceEnd;

      // Initialize worker stats
      this.workerStats.set(workerId, {
        workerId,
        hashesTried: 0,
        hashRate: null,
        currentNonceStart: nonceStart,
        currentNonceEnd: nonceEnd,
        status: "running",
        startedAt: Date.now(),
      });

      // Set up worker event handlers
      worker.onProgress((event) => {
        const stats = this.workerStats.get(workerId);
        if (stats) {
          const elapsed = (Date.now() - (stats.startedAt || Date.now())) / 1000;
          stats.hashesTried = event.hashesTried;
          stats.hashRate = elapsed > 0 ? event.hashesTried / elapsed : null;
          this.updateClusterStats();
        }
      });

      worker.onFound((event) => {
        // Stop all workers immediately
        this.stopMining("found");
        // Notify cluster listeners
        for (const handler of this.onFoundHandlers) {
          handler(event.block, workerId);
        }
      });

      worker.onStopped((event) => {
        const stats = this.workerStats.get(workerId);
        if (stats) {
          if (event.reason === "exhausted") {
            stats.status = "exhausted";
            // Request new nonce range and restart
            this.assignNewNonceRange(worker, workerId);
          } else {
            stats.status = "stopped";
          }
        }
      });

      // Start worker with nonce range
      worker.startMining({
        candidateBlock: params.candidateBlock,
        difficulty: params.difficulty,
        nonceStart,
        nonceEnd,
        dutyCycle: params.dutyCycle, // Phase 26: Pass duty cycle to worker
      });

      this.workers.push(worker);
    }

    // Started cluster mining
  }

  /**
   * Stop all workers
   */
  async stopMining(reason: "user" | "found" | "replaced" | "restart" = "user"): Promise<void> {
    if (!this.isMining) return;

    this.isMining = false;

    // Stop all workers
    for (const worker of this.workers) {
      worker.stopMining(reason === "replaced" || reason === "restart" ? "replaced" : "user");
    }

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
   */
  private assignNewNonceRange(worker: MinerClient, workerId: number): void {
    if (!this.isMining || !this.currentCandidateBlock) return;

    const nonceRangeSize = this.DEFAULT_NONCE_RANGE_SIZE;
    const nonceStart = this.nextNonceStart;
    const nonceEnd = nonceStart + nonceRangeSize;
    this.nextNonceStart = nonceEnd;

    const stats = this.workerStats.get(workerId);
    if (stats) {
      stats.currentNonceStart = nonceStart;
      stats.currentNonceEnd = nonceEnd;
      stats.status = "running";
      stats.startedAt = Date.now();
      stats.hashesTried = 0;
      stats.hashRate = null;
    }

    // Restart worker with new range
    // Note: dutyCycle is stored per worker, so we need to get it from the worker
    const currentDutyCycle = worker.getDutyCycle?.() ?? 1.0;
    worker.startMining({
      candidateBlock: this.currentCandidateBlock,
      difficulty: this.currentDifficulty,
      nonceStart,
      nonceEnd,
      dutyCycle: currentDutyCycle, // Phase 26: Preserve duty cycle
    });

    // Worker assigned new nonce range
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
   * Cleanup: Destroy all workers
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
  }
}

