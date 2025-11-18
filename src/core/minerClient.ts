/**
 * Miner Client
 * 
 * Phase 8: Main thread wrapper for Web Worker mining
 * 
 * Provides a clean API for UI to interact with the mining worker
 */

import type { Block } from "./types.js";

/**
 * Phase 37-C: Compact block header for mining
 */
type MiningCompactBlockHeader = {
  version: number;
  height: number;
  prevHash: string;
  merkleRoot: string;
  timestamp: number;
  difficulty: number;
  stateCommitment?: string;
};

/**
 * Worker command types (defined inline to avoid import issues)
 * 
 * Phase 18: Added nonceStart and nonceEnd for cluster mining
 * Phase 37-A: Added miningEpochId to prevent stale mining results
 * Phase 37-C: Changed from candidateBlock to header (compact block header)
 */
type MinerWorkerCommand =
  | {
      type: "START";
      header: MiningCompactBlockHeader; // Phase 37-C: Compact block header instead of full block
      difficulty: number;
      maxIterations?: number;
      nonceStart?: number; // Phase 18: Starting nonce
      nonceEnd?: number; // Phase 18: Ending nonce
      dutyCycle?: number; // Phase 26: CPU duty cycle (0.0 to 1.0)
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    }
  | { type: "STOP"; miningEpochId?: string } // Phase 37-A: Include epoch ID in STOP
  | { type: "SET_DUTY_CYCLE"; dutyCycle: number }; // Phase 26: Update duty cycle dynamically

/**
 * Worker event types (defined inline to avoid import issues)
 * 
 * Phase 18: Added "exhausted" reason
 * Phase 37-A: Added miningEpochId to all events
 */
type MinerWorkerEvent =
  | {
      type: "PROGRESS";
      nonce: number;
      hash: string;
      hashesTried: number;
      startedAt: number;
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    }
  | {
      type: "FOUND";
      nonce: number; // Phase 37-C: Only nonce, not full block
      hash: string;
      hashesTried: number;
      startedAt: number;
      finishedAt: number;
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    }
  | {
      type: "STOPPED";
      reason: "user" | "replaced" | "error" | "exhausted"; // Phase 18: Added "exhausted"
      errorMessage?: string;
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    }
  | {
      type: "EXHAUSTED"; // Phase 37-A: Separate EXHAUSTED event
      lastNonce: number;
      hashesTried: number;
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    }
  | {
      type: "ERROR"; // Phase 37-A: Separate ERROR event
      error: string;
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    };

/**
 * Progress event handler
 * Phase 37-A: Added miningEpochId
 */
export type MinerProgressHandler = (event: {
  nonce: number;
  hash: string;
  hashesTried: number;
  startedAt: number;
  miningEpochId?: string; // Phase 37-A: Mining epoch ID
}) => void;

/**
 * Found event handler
 * Phase 37-A: Added miningEpochId
 * Phase 37-C: Changed from block to nonce
 */
export type MinerFoundHandler = (event: {
  nonce: number; // Phase 37-C: Only nonce, not full block
  hash: string;
  hashesTried: number;
  startedAt: number;
  finishedAt: number;
  miningEpochId?: string; // Phase 37-A: Mining epoch ID
}) => void;

/**
 * Stopped event handler
 * 
 * Phase 18: Added "exhausted" reason
 * Phase 37-A: Added miningEpochId
 */
export type MinerStoppedHandler = (event: {
  reason: "user" | "replaced" | "error" | "exhausted"; // Phase 18: Added "exhausted"
  errorMessage?: string;
  miningEpochId?: string; // Phase 37-A: Mining epoch ID
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
  // Phase 37-A: Mining epoch tracking
  private currentEpochId: string | null = null;
  private epochValidator?: (epochId: string | undefined | null) => boolean; // Optional validator function

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
      // Phase 37-E: Worker crash detection
      this.worker.onerror = (error) => {
        console.error("[MinerClient] Worker error:", error);
        // Notify stopped handlers with error reason
        this.isMining = false;
        this.stopStatsUpdate();
        this.stoppedHandlers.forEach((handler) => {
          handler({
            reason: "error",
            errorMessage: error.message || "Worker crashed",
            miningEpochId: this.currentEpochId ?? undefined,
          });
        });
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
   * Phase 37-A: Validate epoch ID before processing events
   */
  private handleWorkerMessage(event: MinerWorkerEvent): void {
    // Phase 37-A: Validate epoch ID if validator is provided
    if (this.epochValidator) {
      const isValid = this.epochValidator(event.miningEpochId);
      if (!isValid) {
        // Discard stale event from old epoch
        console.log(`[MinerClient] Discarding stale event from old epoch: ${event.type}, epochId=${event.miningEpochId?.substring(0, 16)}...`);
        return;
      }
    }

    switch (event.type) {
      case "PROGRESS":
        this.stats.hashesTried = event.hashesTried;
        this.updateHashRate(event.startedAt, event.hashesTried);
        // Debug: Log first few progress events
        if (event.hashesTried <= 10) {
          console.log(`[MinerClient] Received PROGRESS: hashesTried=${event.hashesTried}, handlers=${this.progressHandlers.size}`);
          if (this.progressHandlers.size === 0) {
            console.warn(`[MinerClient] WARNING: No progress handlers registered! This will cause stats not to update.`);
          }
        }
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
        // Phase 37-C: FOUND event now only contains nonce, not full block
        this.stats.hashesTried = event.hashesTried;
        this.updateHashRate(event.startedAt, event.hashesTried);
        this.isMining = false;
        this.stopStatsUpdate();
        // Notify all found handlers (they receive nonce, not full block)
        this.foundHandlers.forEach((handler) => handler(event));
        break;

      case "STOPPED":
        this.isMining = false;
        this.stopStatsUpdate();
        // Phase 18: If exhausted, we'll handle it in cluster
        // Notify all stopped handlers
        this.stoppedHandlers.forEach((handler) => handler(event));
        break;

      case "EXHAUSTED":
        // Phase 37-A: Handle EXHAUSTED as separate event
        this.isMining = false;
        this.stopStatsUpdate();
        // Convert to STOPPED event for backward compatibility
        this.stoppedHandlers.forEach((handler) => {
          handler({
            reason: "exhausted",
            errorMessage: undefined,
          });
        });
        break;

      case "ERROR":
        // Phase 37-A: Handle ERROR as separate event
        this.isMining = false;
        this.stopStatsUpdate();
        // Convert to STOPPED event for backward compatibility
        this.stoppedHandlers.forEach((handler) => {
          handler({
            reason: "error",
            errorMessage: event.error,
          });
        });
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
   * Set epoch validator function
   * Phase 37-A: Allow external validation of epoch IDs
   */
  setEpochValidator(validator: (epochId: string | undefined | null) => boolean): void {
    this.epochValidator = validator;
  }

  /**
   * Start mining
   * 
   * Phase 18: Added nonceStart and nonceEnd parameters for cluster mining
   * Phase 26: Added dutyCycle parameter for CPU control
   * Phase 37-A: Added miningEpochId parameter
   * Phase 37-C: Accepts candidateBlock but converts to compact header internally
   */
  startMining(args: {
    candidateBlock: Block; // Phase 37-C: Still accepts Block for backward compatibility, converts to header
    difficulty: number;
    nonceStart?: bigint | number; // Phase 18: Starting nonce
    nonceEnd?: bigint | number; // Phase 18: Ending nonce
    dutyCycle?: number; // Phase 26: CPU duty cycle (0.0 to 1.0)
    miningEpochId?: string; // Phase 37-A: Mining epoch ID
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
   * Phase 37-A: Added miningEpochId support
   */
  private doStartMining(args: {
    candidateBlock: Block;
    difficulty: number;
    nonceStart?: bigint | number; // Phase 18: Starting nonce
    nonceEnd?: bigint | number; // Phase 18: Ending nonce
    dutyCycle?: number; // Phase 26: CPU duty cycle (0.0 to 1.0)
    miningEpochId?: string; // Phase 37-A: Mining epoch ID
    onProgress?: MinerProgressHandler;
    onFound?: MinerFoundHandler;
    onStopped?: MinerStoppedHandler;
  }): void {
    // Only clear handlers if new ones are provided via args
    // This allows handlers registered via onProgress()/onFound()/onStopped() to persist
    if (args.onProgress) {
      // Clear and replace with new handler if provided
      this.progressHandlers.clear();
      this.progressHandlers.add(args.onProgress);
    }
    // If no onProgress provided, keep existing handlers (registered via onProgress())
    
    if (args.onFound) {
      this.foundHandlers.clear();
      this.foundHandlers.add(args.onFound);
    }
    
    if (args.onStopped) {
      this.stoppedHandlers.clear();
      this.stoppedHandlers.add(args.onStopped);
    }
    
    // Handlers registered (either from args or from onProgress()/onFound()/onStopped())

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

    // Phase 37-A: Store current epoch ID
    if (args.miningEpochId) {
      this.currentEpochId = args.miningEpochId;
    }

    // Phase 37-C: Convert Block to CompactBlockHeader
    const compactHeader: MiningCompactBlockHeader = {
      version: args.candidateBlock.header.version,
      height: args.candidateBlock.header.height,
      prevHash: args.candidateBlock.header.prevHash,
      merkleRoot: args.candidateBlock.header.merkleRoot,
      timestamp: args.candidateBlock.header.timestamp,
      difficulty: args.candidateBlock.header.difficulty,
      stateCommitment: args.candidateBlock.header.stateCommitment,
    };

    const command: MinerWorkerCommand = {
      type: "START",
      header: compactHeader, // Phase 37-C: Send compact header instead of full block
      difficulty: args.difficulty,
      // Phase 18: Convert bigint to number (nonce is stored as number in worker)
      nonceStart: args.nonceStart !== undefined ? Number(args.nonceStart) : undefined,
      nonceEnd: args.nonceEnd !== undefined ? Number(args.nonceEnd) : undefined,
      // Phase 26: Pass duty cycle to worker
      dutyCycle: this.dutyCycle,
      // Phase 37-A: Pass mining epoch ID to worker
      miningEpochId: args.miningEpochId,
    };

    console.log(`[MinerClient] Starting mining with nonceStart=${args.nonceStart}, nonceEnd=${args.nonceEnd}, dutyCycle=${this.dutyCycle}`);
    this.worker.postMessage(command);
    this.isMining = true;
    this.startStatsUpdate();
    console.log(`[MinerClient] Mining started, worker readyState: ${this.worker ? 'ready' : 'null'}`);
  }

  /**
   * Stop mining
   * Phase 37-A: Include epoch ID in STOP command
   */
  stopMining(_reason: "user" | "replaced" = "user"): void {
    if (!this.worker || !this.isMining) {
      return;
    }

    const command: MinerWorkerCommand = { 
      type: "STOP",
      miningEpochId: this.currentEpochId ?? undefined, // Phase 37-A: Include epoch ID
    };
    // Worker is checked above, but TypeScript needs explicit check
    if (this.worker) {
      this.worker.postMessage(command);
    }
    this.isMining = false;
    this.stopStatsUpdate();
    // Phase 37-A: Clear epoch ID when stopping
    this.currentEpochId = null;
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

