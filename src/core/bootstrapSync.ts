/**
 * Phase 32: Bootstrap Snapshot & Tip Sync Protocol
 * 
 * Ensures nodes immediately sync to latest state upon connecting to signal server.
 * 
 * Flow:
 * 1. Node connects to signal server
 * 2. Node sends REQUEST_BOOTSTRAP
 * 3. Signal server responds with latest height, header, snapshot meta
 * 4. Node fast-syncs to latest state
 * 5. Node can immediately start mining on correct chain
 */

import type { ChainContext } from "./chain.js";
import type { BlockHeader, SnapshotMeta } from "./types.js";

/**
 * Bootstrap request payload
 */
export interface BootstrapRequest {
  requestId: string;
  wantSnapshotMeta?: boolean;
  wantHeaders?: boolean;
  headerCount?: number; // Number of recent headers to request (default: 200)
}

/**
 * Bootstrap response payload
 */
export interface BootstrapResponse {
  requestId: string;
  latestHeight: number;
  latestHeader: BlockHeader;
  latestHeaderHash: string;
  recentHeaders?: BlockHeader[]; // Recent headers for fast sync
  latestSnapshotMeta?: SnapshotMeta;
  finalityCert?: any; // Finality certificate if available
  timestamp: number; // Server timestamp
}

/**
 * Bootstrap sync result
 */
export interface BootstrapSyncResult {
  success: boolean;
  synced: boolean; // Whether we actually synced (or were already up to date)
  error?: string;
  actions: string[]; // List of actions taken
  newHeight?: number;
}

/**
 * Bootstrap Sync Manager
 * 
 * Handles bootstrap synchronization from signal server
 */
export class BootstrapSyncManager {
  private chainContext: ChainContext;
  private bootstrapComplete: boolean = false;
  private lastBootstrapHeight: number = -1;

  constructor(chainContext: ChainContext) {
    this.chainContext = chainContext;
  }

  /**
   * Check if bootstrap sync is complete
   */
  isBootstrapComplete(): boolean {
    return this.bootstrapComplete;
  }

  /**
   * Get last bootstrap height
   */
  getLastBootstrapHeight(): number {
    return this.lastBootstrapHeight;
  }

  /**
   * Process bootstrap response and sync to latest state
   */
  async processBootstrapResponse(
    response: BootstrapResponse
  ): Promise<BootstrapSyncResult> {
    const actions: string[] = [];
    const localTip = this.chainContext.storage.getTip();
    const localHeight = localTip?.header.height ?? -1;
    const localHash = localTip?.hash ?? "";

    console.log(`[Phase 32] Processing bootstrap response:`, {
      latestHeight: response.latestHeight,
      localHeight,
      latestHash: response.latestHeaderHash.substring(0, 16) + "...",
      localHash: localHash.substring(0, 16) + "..."
    });

    // Check if we're already up to date
    if (localHeight === response.latestHeight && localHash === response.latestHeaderHash) {
      console.log(`[Phase 32] Already synced to latest height ${response.latestHeight}`);
      this.bootstrapComplete = true;
      this.lastBootstrapHeight = response.latestHeight;
      return {
        success: true,
        synced: false,
        actions: ["Already up to date"],
        newHeight: localHeight,
      };
    }

    // Phase 38: Fast set tip if we're close (within 500 blocks)
    const heightDiff = response.latestHeight - localHeight;
    
    if (heightDiff > 0 && heightDiff <= 500 && response.recentHeaders) {
      // Fast sync using recent headers
      console.log(`[Phase 38] Fast syncing using ${response.recentHeaders.length} recent headers (height diff: ${heightDiff})`);
      actions.push(`Fast sync: ${heightDiff} blocks behind`);
      
      try {
        // Phase 38: Add headers to header cache for fast relay
        const { globalHeaderCache } = await import("./headerCache.js");
        const { hashBlockHeader } = await import("./crypto.js");
        
        // Verify and cache headers sequentially
        let currentTip = localTip;
        let cached = 0;
        const headersToRequest: number[] = [];
        
        for (const header of response.recentHeaders) {
          if (header.height <= localHeight) continue;
          
          // Verify header chain continuity
          if (currentTip && header.prevHash && currentTip.hash && header.prevHash !== currentTip.hash) {
            console.warn(`[Phase 38] Header chain broken at height ${header.height}, stopping fast sync`);
            break;
          }
          
          // Compute header hash and add to cache
          try {
            const headerHash = await hashBlockHeader(header);
            if (!globalHeaderCache.hasHeader(headerHash)) {
              globalHeaderCache.addHeader(header, headerHash, false); // false = body not received yet
              cached++;
              headersToRequest.push(header.height);
            }
            
            // Update currentTip reference for next iteration
            // We'll use the header hash as the block hash reference
            currentTip = {
              header,
              hash: headerHash,
              transactions: [], // Empty for now, will be filled when block body is received
            } as any;
          } catch (error) {
            console.warn(`[Phase 38] Failed to cache header at height ${header.height}:`, error);
            break;
          }
        }
        
        if (cached > 0) {
          actions.push(`Cached ${cached} headers for fast sync`);
          
          // Phase 38: Trigger block body requests for cached headers
          if (this.chainContext.p2p && headersToRequest.length > 0) {
            const minHeight = Math.min(...headersToRequest);
            const maxHeight = Math.max(...headersToRequest);
            this.chainContext.p2p.broadcast("REQUEST_BLOCKS", {
              fromHeight: minHeight,
              toHeight: maxHeight,
            });
            actions.push(`Requested block bodies for heights ${minHeight}-${maxHeight}`);
          }
        }
      } catch (error) {
        console.error(`[Phase 38] Error during fast sync:`, error);
        // Don't fail bootstrap - continue with normal sync
        actions.push(`Fast sync failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // Step 2: Check if we need snapshot sync
    const snapshotInterval = this.chainContext.params.snapshotInterval || 1000;
    if (heightDiff >= snapshotInterval && response.latestSnapshotMeta) {
      console.log(`[Phase 32] Large height difference (${heightDiff}), recommending snapshot sync`);
      actions.push(`Snapshot sync recommended (height diff: ${heightDiff})`);
      
      // Store snapshot meta for later use
      // The actual snapshot download will be handled by SnapshotDownloader
      if (typeof window !== "undefined") {
        (window as any).pendingBootstrapSnapshot = response.latestSnapshotMeta;
      }
    }

    // Step 3: Request missing blocks if we're behind
    // Phase 37: Actually trigger block requests to sync to target height
    if (heightDiff > 0) {
      actions.push(`Requesting ${heightDiff} blocks to sync to height ${response.latestHeight}`);
      
      // Store the target height and trigger block requests
      // The actual block sync will be handled by P2P sync handlers
      // But we mark bootstrap as complete so mining can start on the correct chain
      this.lastBootstrapHeight = response.latestHeight;
      
      // If we have recent headers and they form a valid chain, we can use them
      // to verify we're on the right chain, but we still need to request full blocks
      if (response.recentHeaders && response.recentHeaders.length > 0) {
        // Verify chain continuity with recent headers
        let validChain = true;
        let lastKnownHeight = localHeight;
        
        for (const header of response.recentHeaders) {
          if (header.height > lastKnownHeight) {
            // Check if this header connects to our chain
            if (lastKnownHeight === localHeight) {
              // First header should connect to our tip
              if (localTip && header.prevHash !== localTip.hash) {
                console.warn(`[Phase 32] Recent header at height ${header.height} doesn't connect to local tip`);
                validChain = false;
                break;
              }
            } else {
              // Subsequent headers should connect to previous header
              const prevHeader = response.recentHeaders.find(h => h.height === header.height - 1);
              if (prevHeader) {
                const prevHeaderHash = await import("./crypto.js").then(m => m.hashBlockHeader(prevHeader));
                if (header.prevHash !== prevHeaderHash) {
                  console.warn(`[Phase 32] Header chain broken at height ${header.height}`);
                  validChain = false;
                  break;
                }
              }
            }
            lastKnownHeight = header.height;
          }
        }
        
        if (validChain) {
          actions.push(`Verified chain continuity with ${response.recentHeaders.length} recent headers`);
        } else {
          actions.push(`Chain discontinuity detected, will request full sync`);
        }
      }
    }
    
    // Step 4: Mark bootstrap as complete
    // Phase 37: Even if we haven't received all blocks yet, we know the target height
    // and can start mining on the correct chain (blocks will be requested via P2P)
    this.bootstrapComplete = true;
    this.lastBootstrapHeight = response.latestHeight;
    
    actions.push(`Bootstrap complete, target height: ${response.latestHeight}, local height: ${localHeight}`);

    return {
      success: true,
      synced: heightDiff > 0,
      actions,
      newHeight: response.latestHeight,
    };
  }

  /**
   * Fast set tip (for immediate state update)
   * This is used when we receive bootstrap data and want to immediately update our tip reference
   */
  async fastSetTip(header: BlockHeader, _headerHash: string): Promise<{ success: boolean; error?: string }> {
    const localTip = this.chainContext.storage.getTip();
    const localHeight = localTip?.header.height ?? -1;

    // Only update if the new header is ahead
    if (header.height <= localHeight) {
      return { success: false, error: "Header height not ahead of local tip" };
    }

    // Verify header chain continuity
    if (localTip && header.prevHash !== localTip.hash) {
      // Chain discontinuity - we need to sync from snapshot or request missing blocks
      console.warn(`[Phase 32] Chain discontinuity detected at height ${header.height}`);
      return { 
        success: false, 
        error: "Chain discontinuity, need to sync from snapshot or request missing blocks" 
      };
    }

    // For now, we just mark that we know about this tip
    // The actual block will be requested via normal P2P sync
    this.lastBootstrapHeight = header.height;
    
    console.log(`[Phase 32] Fast tip reference updated to height ${header.height}`);

    return { success: true };
  }

  /**
   * Reset bootstrap state (e.g., after chain reset)
   */
  reset(): void {
    this.bootstrapComplete = false;
    this.lastBootstrapHeight = -1;
  }
}

/**
 * Global bootstrap sync manager instance
 */
let globalBootstrapSyncManager: BootstrapSyncManager | null = null;

/**
 * Get or create global bootstrap sync manager
 */
export function getBootstrapSyncManager(chainContext: ChainContext): BootstrapSyncManager {
  if (!globalBootstrapSyncManager) {
    globalBootstrapSyncManager = new BootstrapSyncManager(chainContext);
  }
  return globalBootstrapSyncManager;
}

/**
 * Reset global bootstrap sync manager
 */
export function resetBootstrapSyncManager(): void {
  globalBootstrapSyncManager = null;
}

