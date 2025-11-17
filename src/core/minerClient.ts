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
 */
type MinerWorkerCommand =
  | {
      type: "START";
      candidateBlock: Block;
      difficulty: number;
      maxIterations?: number;
    }
  | { type: "STOP" };

/**
 * Worker event types (defined inline to avoid import issues)
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
      reason: "user" | "replaced" | "error";
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
 */
export type MinerStoppedHandler = (event: {
  reason: "user" | "replaced" | "error";
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

      // Handle messages from worker
      this.worker.onmessage = (event: MessageEvent<MinerWorkerEvent>) => {
        this.handleWorkerMessage(event.data);
      };

      // Handle worker errors
      this.worker.onerror = (error) => {
        console.error("Miner worker error:", error);
        this.isMining = false;
        this.stopStatsUpdate();
        const stoppedEvent = {
          reason: "error" as const,
          errorMessage: error.message || "Worker error",
        };
        this.stoppedHandlers.forEach((handler) => handler(stoppedEvent));
      };
    } catch (error) {
      console.error("Failed to create miner worker:", error);
      throw error;
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
        this.progressHandlers.forEach((handler) => handler(event));
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
   */
  startMining(args: {
    candidateBlock: Block;
    difficulty: number;
    onProgress?: MinerProgressHandler;
    onFound?: MinerFoundHandler;
    onStopped?: MinerStoppedHandler;
  }): void {
    if (!this.worker) {
      throw new Error("Miner worker not initialized");
    }

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
   */
  private doStartMining(args: {
    candidateBlock: Block;
    difficulty: number;
    onProgress?: MinerProgressHandler;
    onFound?: MinerFoundHandler;
    onStopped?: MinerStoppedHandler;
  }): void {
    // Register handlers
    if (args.onProgress) {
      this.progressHandlers.add(args.onProgress);
    }
    if (args.onFound) {
      this.foundHandlers.add(args.onFound);
    }
    if (args.onStopped) {
      this.stoppedHandlers.add(args.onStopped);
    }

    // Reset stats
    this.stats.hashesTried = 0;
    this.stats.startedAt = Date.now();
    this.stats.hashRate = null;

    // Send START command to worker
    if (!this.worker) {
      throw new Error("Miner worker not initialized");
    }

    const command: MinerWorkerCommand = {
      type: "START",
      candidateBlock: args.candidateBlock,
      difficulty: args.difficulty,
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
    this.worker.postMessage(command);
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

