/**
 * Miner Client
 * 
 * Phase 8: Main thread wrapper for Web Worker mining
 * 
 * Provides a clean API for UI to interact with the mining worker
 */

import type { Block } from "./types.js";

/**
 * Worker command types (defined inline to avoid import issues)
 * 
 * Phase 18: Added nonceStart and nonceEnd for cluster mining
 */
type MinerWorkerCommand =
  | {
      type: "START";
      candidateBlock: Block;
      difficulty: number;
      maxIterations?: number;
      nonceStart?: number; // Phase 18: Starting nonce
      nonceEnd?: number; // Phase 18: Ending nonce
      dutyCycle?: number; // Phase 26: CPU duty cycle (0.0 to 1.0)
    }
  | { type: "STOP" }
  | { type: "SET_DUTY_CYCLE"; dutyCycle: number }; // Phase 26: Update duty cycle dynamically

/**
 * Worker event types (defined inline to avoid import issues)
 * 
 * Phase 18: Added "exhausted" reason
 */
type MinerWorkerEvent =
  | {
      type: "PROGRESS";
      nonce: number;
      hash: string;
      hashesTried: number;
      startedAt: number;
    }
  | {
      type: "FOUND";
      block: Block;
      hash: string;
      hashesTried: number;
      startedAt: number;
      finishedAt: number;
    }
  | {
      type: "STOPPED";
      reason: "user" | "replaced" | "error" | "exhausted"; // Phase 18: Added "exhausted"
      errorMessage?: string;
    };

/**
 * Progress event handler
 */
export type MinerProgressHandler = (event: {
  nonce: number;
  hash: string;
  hashesTried: number;
  startedAt: number;
}) => void;

/**
 * Found event handler
 */
export type MinerFoundHandler = (event: {
  block: Block;
  hash: string;
  hashesTried: number;
  startedAt: number;
  finishedAt: number;
}) => void;

/**
 * Stopped event handler
 * 
 * Phase 18: Added "exhausted" reason
 */
export type MinerStoppedHandler = (event: {
  reason: "user" | "replaced" | "error" | "exhausted"; // Phase 18: Added "exhausted"
  errorMessage?: string;
}) => void;

/**
 * Mining statistics
 */
export interface MinerStats {
  hashesTried: number;
  startedAt: number | null;
  hashRate: number | null; // hashes per second
}

/**
 * Miner Client class
 * 
 * Manages Web Worker for mining and provides statistics
 */
export class MinerClient {
  private worker: Worker | null = null;
  private isMining: boolean = false;
  private stats: MinerStats = {
    hashesTried: 0,
    startedAt: null,
    hashRate: null,
  };
  private progressHandlers: Set<MinerProgressHandler> = new Set();
  private foundHandlers: Set<MinerFoundHandler> = new Set();
  private stoppedHandlers: Set<MinerStoppedHandler> = new Set();
  private statsUpdateInterval: number | null = null;
  // Phase 26: Duty cycle control
  private dutyCycle: number = 1.0; // 0.0 to 1.0

  constructor() {
    this.initWorker();
  }

  /**
   * Initialize Web Worker
   */
  private initWorker(): void {
    try {
      // Create worker using Vite's worker import
      this.worker = new Worker(new URL("./minerWorker.ts", import.meta.url), {
        type: "module",
      });

      // Handle messages from worker (will be set again below with logging)

      // Handle worker errors
      this.worker.onerror = (error) => {
        console.error("Miner worker error:", error);
        console.error("Worker error details:", {
          message: error.message,
          filename: error.filename,
          lineno: error.lineno,
          colno: error.colno,
        });
        this.isMining = false;
        this.stopStatsUpdate();
        const stoppedEvent = {
          reason: "error" as const,
          errorMessage: error.message || "Worker error",
        };
        this.stoppedHandlers.forEach((handler) => handler(stoppedEvent));
      };
      
      // Log successful worker initialization
      console.log("Miner worker initialized successfully");
      
      // Add message handler
      this.worker.onmessage = (event: MessageEvent<MinerWorkerEvent>) => {
        this.handleWorkerMessage(event.data);
      };
    } catch (error) {
      console.error("Failed to create miner worker:", error);
      // Don't throw - allow retry later
      this.worker = null;
    }
  }

  /**
   * Ensure worker is initialized, retry if needed
   */
  private ensureWorker(): void {
    if (!this.worker) {
      console.log("Worker not initialized, attempting to create...");
      this.initWorker();
      if (!this.worker) {
        throw new Error("Failed to initialize miner worker. Please refresh the page.");
      }
    }
  }

  /**
   * Handle messages from worker
   */
  private handleWorkerMessage(event: MinerWorkerEvent): void {
    switch (event.type) {
      case "PROGRESS":
        this.stats.hashesTried = event.hashesTried;
        this.updateHashRate(event.startedAt, event.hashesTried);
        // Notify all progress handlers
        this.progressHandlers.forEach((handler) => {
          try {
            handler(event);
          } catch (error) {
            console.error("[MinerClient] Error in progress handler:", error);
          }
        });
        break;

      case "FOUND":
        this.stats.hashesTried = event.hashesTried;
        this.updateHashRate(event.startedAt, event.hashesTried);
        this.isMining = false;
        this.stopStatsUpdate();
        // Notify all found handlers
        this.foundHandlers.forEach((handler) => handler(event));
        break;

      case "STOPPED":
        this.isMining = false;
        this.stopStatsUpdate();
        // Phase 18: If exhausted, we'll handle it in cluster
        // Notify all stopped handlers
        this.stoppedHandlers.forEach((handler) => handler(event));
        break;
    }
  }

  /**
   * Update hash rate calculation
   */
  private updateHashRate(startedAt: number, hashesTried: number): void {
    const elapsed = (Date.now() - startedAt) / 1000; // seconds
    if (elapsed > 0) {
      this.stats.hashRate = hashesTried / elapsed;
    }
  }

  /**
   * Start stats update interval
   */
  private startStatsUpdate(): void {
    if (this.statsUpdateInterval) {
      return; // Already running
    }

    this.statsUpdateInterval = window.setInterval(() => {
      if (this.stats.startedAt && this.isMining) {
        this.updateHashRate(this.stats.startedAt, this.stats.hashesTried);
      }
    }, 1000); // Update every second
  }

  /**
   * Stop stats update interval
   */
  private stopStatsUpdate(): void {
    if (this.statsUpdateInterval) {
      clearInterval(this.statsUpdateInterval);
      this.statsUpdateInterval = null;
    }
  }

  /**
   * Start mining
   * 
   * Phase 18: Added nonceStart and nonceEnd parameters for cluster mining
   * Phase 26: Added dutyCycle parameter for CPU control
   */
  startMining(args: {
    candidateBlock: Block;
    difficulty: number;
    nonceStart?: bigint | number; // Phase 18: Starting nonce
    nonceEnd?: bigint | number; // Phase 18: Ending nonce
    dutyCycle?: number; // Phase 26: CPU duty cycle (0.0 to 1.0)
    onProgress?: MinerProgressHandler;
    onFound?: MinerFoundHandler;
    onStopped?: MinerStoppedHandler;
  }): void {
    // Ensure worker is initialized
    this.ensureWorker();

    // Stop existing mining if any
    if (this.isMining) {
      this.stopMining("replaced");
      // Wait a bit for worker to process STOP
      setTimeout(() => {
        this.doStartMining(args);
      }, 100);
    } else {
      this.doStartMining(args);
    }
  }

  /**
   * Internal start mining implementation
   * 
   * Phase 18: Added nonceStart and nonceEnd support
   */
  private doStartMining(args: {
    candidateBlock: Block;
    difficulty: number;
    nonceStart?: bigint | number; // Phase 18: Starting nonce
    nonceEnd?: bigint | number; // Phase 18: Ending nonce
    dutyCycle?: number; // Phase 26: CPU duty cycle (0.0 to 1.0)
    onProgress?: MinerProgressHandler;
    onFound?: MinerFoundHandler;
    onStopped?: MinerStoppedHandler;
  }): void {
    // Clear existing handlers to avoid duplicates
    this.progressHandlers.clear();
    this.foundHandlers.clear();
    this.stoppedHandlers.clear();
    
    // Register handlers
    if (args.onProgress) {
      // Registering onProgress handler
      this.progressHandlers.add(args.onProgress);
    }
    if (args.onFound) {
      this.foundHandlers.add(args.onFound);
    }
    if (args.onStopped) {
      this.stoppedHandlers.add(args.onStopped);
    }
    
    // Handlers registered

    // Reset stats
    this.stats.hashesTried = 0;
    this.stats.startedAt = Date.now();
    this.stats.hashRate = null;

    // Phase 26: Update duty cycle
    if (args.dutyCycle !== undefined) {
      this.dutyCycle = Math.max(0.0, Math.min(1.0, args.dutyCycle));
    }

    // Ensure worker is initialized
    this.ensureWorker();

    // TypeScript null check (ensureWorker throws if worker is null)
    if (!this.worker) {
      throw new Error("Worker initialization failed");
    }

    const command: MinerWorkerCommand = {
      type: "START",
      candidateBlock: args.candidateBlock,
      difficulty: args.difficulty,
      // Phase 18: Convert bigint to number (nonce is stored as number in worker)
      nonceStart: args.nonceStart !== undefined ? Number(args.nonceStart) : undefined,
      nonceEnd: args.nonceEnd !== undefined ? Number(args.nonceEnd) : undefined,
      // Phase 26: Pass duty cycle to worker
      dutyCycle: this.dutyCycle,
    };

    this.worker.postMessage(command);
    this.isMining = true;
    this.startStatsUpdate();
  }

  /**
   * Stop mining
   */
  stopMining(_reason: "user" | "replaced" = "user"): void {
    if (!this.worker || !this.isMining) {
      return;
    }

    const command: MinerWorkerCommand = { type: "STOP" };
    // Worker is checked above, but TypeScript needs explicit check
    if (this.worker) {
      this.worker.postMessage(command);
    }
    this.isMining = false;
    this.stopStatsUpdate();
  }

  /**
   * Check if currently mining
   */
  getIsMining(): boolean {
    return this.isMining;
  }

  /**
   * Get mining statistics
   */
  getStats(): MinerStats {
    return { ...this.stats };
  }

  /**
   * Add progress handler
   * 
   * Phase 18: Added for cluster mining support
   */
  onProgress(handler: MinerProgressHandler): void {
    this.progressHandlers.add(handler);
  }

  /**
   * Add found handler
   * 
   * Phase 18: Added for cluster mining support
   */
  onFound(handler: MinerFoundHandler): void {
    this.foundHandlers.add(handler);
  }

  /**
   * Add stopped handler
   * 
   * Phase 18: Added for cluster mining support
   */
  onStopped(handler: MinerStoppedHandler): void {
    this.stoppedHandlers.add(handler);
  }

  /**
   * Remove progress handler
   */
  removeProgressHandler(handler: MinerProgressHandler): void {
    this.progressHandlers.delete(handler);
  }

  /**
   * Remove found handler
   */
  removeFoundHandler(handler: MinerFoundHandler): void {
    this.foundHandlers.delete(handler);
  }

  /**
   * Remove stopped handler
   */
  removeStoppedHandler(handler: MinerStoppedHandler): void {
    this.stoppedHandlers.delete(handler);
  }

  /**
   * Phase 26: Set duty cycle dynamically (without restarting mining)
   */
  setDutyCycle(cycle: number): void {
    this.dutyCycle = Math.max(0.0, Math.min(1.0, cycle));
    if (this.worker && this.isMining) {
      const command: MinerWorkerCommand = {
        type: "SET_DUTY_CYCLE",
        dutyCycle: this.dutyCycle,
      };
      this.worker.postMessage(command);
    }
  }

  /**
   * Phase 26: Get current duty cycle
   */
  getDutyCycle(): number {
    return this.dutyCycle;
  }

  /**
   * Cleanup: stop mining and terminate worker
   */
  destroy(): void {
    this.stopMining("user");
    this.stopStatsUpdate();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.progressHandlers.clear();
    this.foundHandlers.clear();
    this.stoppedHandlers.clear();
  }
}

