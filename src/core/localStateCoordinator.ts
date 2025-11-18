/**
 * Local State Coordinator
 * 
 * Phase 29: Local Deterministic State Sync
 * 
 * Ensures complete state consistency across multiple browser instances/tabs on the same device:
 * - Block height and tip hash
 * - IndexState (balances, privacy state, notes, nullifiers, commitments)
 * - Wallet state (multi-wallet, mining wallet)
 * 
 * Uses BroadcastChannel for fast local communication and snapshot sharing for state sync.
 */

import type { ChainContext } from "./chain.js";
import type { SnapshotMeta } from "./types.js";
import { getLocalInstanceCoordinator } from "./localInstance.js";
import { getLatestSnapshotMeta, loadSnapshotByHeight } from "./snapshot.js";
import { IndexState as IndexStateClass } from "./indexState.js";
import { applyDelta } from "./snapshotDelta.js";
import { computeSnapshotStateHash } from "./snapshotVerify.js";
import { getMultiWalletStore } from "./multiWallet.js";
import { getNoteStore } from "./privacy/noteStore.js";

const BROADCAST_CHANNEL_STATE = "indexerchain_local_state_v1";
const STATE_SYNC_INTERVAL_MS = 1000; // Leader broadcasts state every 1 second
const FOLLOWER_SYNC_CHECK_INTERVAL_MS = 2000; // Followers check for updates every 2 seconds
const SYNC_TIMEOUT_MS = 5000; // Sync timeout: 5 seconds

export interface StateUpdateMessage {
  type: "STATE_UPDATE";
  epoch: number; // Block height (local epoch)
  tipHash: string;
  stateCommitment: string;
  snapshotMeta?: SnapshotMeta;
  finalizedHeight?: number;
}

export interface WalletStateSyncMessage {
  type: "WALLET_STATE_SYNC";
  currentWalletId: string | null;
  miningWalletId: string | null;
  walletList: Array<{ id: string; name: string; address: string }>;
}

export interface NoteScanStateSyncMessage {
  type: "NOTE_SCAN_STATE_SYNC";
  walletId: string;
  lastScannedHeight: number;
  noteCount: number;
  unspentNoteCount: number;
}

export interface LocalSnapshotRequest {
  type: "REQUEST_LOCAL_SNAPSHOT";
  requesterId: string;
  fromHeight?: number;
}

export interface LocalSnapshotResponse {
  type: "LOCAL_SNAPSHOT_RESPONSE";
  requesterId: string;
  snapshotMeta: SnapshotMeta;
  snapshotData?: any; // Full snapshot data
  deltaData?: string; // Delta snapshot data (if applicable)
}

export type LocalStateMessage =
  | StateUpdateMessage
  | WalletStateSyncMessage
  | NoteScanStateSyncMessage
  | LocalSnapshotRequest
  | LocalSnapshotResponse;

export interface LocalStateSyncInfo {
  lastSyncEpoch: number;
  lastSyncTime: number;
  lastSyncTipHash: string;
  lastSyncStateCommitment: string;
  syncStatus: "synced" | "syncing" | "out_of_sync" | "error";
  error?: string;
}

export type StateSyncCallback = (info: LocalStateSyncInfo) => void;
export type ConsistencyCheckCallback = (isConsistent: boolean, details: {
  tipHashMatch: boolean;
  stateCommitmentMatch: boolean;
  heightMatch: boolean;
}) => void;

export class LocalStateCoordinator {
  private instanceCoordinator = getLocalInstanceCoordinator();
  private broadcastChannel: BroadcastChannel | null = null;
  private stateSyncInterval: number | null = null;
  private followerSyncCheckInterval: number | null = null;
  
  private currentEpoch: number = 0;
  private currentTipHash: string = "";
  private currentStateCommitment: string = "";
  private currentFinalizedHeight: number = 0;
  
  private leaderEpoch: number = 0;
  private leaderTipHash: string = "";
  private leaderStateCommitment: string = "";
  
  private syncInfo: LocalStateSyncInfo = {
    lastSyncEpoch: 0,
    lastSyncTime: 0,
    lastSyncTipHash: "",
    lastSyncStateCommitment: "",
    syncStatus: "synced",
  };
  
  private stateSyncCallbacks: Set<StateSyncCallback> = new Set();
  private consistencyCheckCallbacks: Set<ConsistencyCheckCallback> = new Set();
  
  private chainContext: ChainContext | null = null;
  private isSyncing: boolean = false;
  private pendingSnapshotRequests: Map<string, (response: LocalSnapshotResponse) => void> = new Map();

  constructor() {
    // Initialize BroadcastChannel
    if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_STATE);
      this.broadcastChannel.onmessage = (event) => this.handleBroadcastMessage(event);
    }
  }

  /**
   * Initialize the state coordinator
   */
  async init(chainContext: ChainContext): Promise<void> {
    this.chainContext = chainContext;
    
    // Get initial state
    const tip = chainContext.storage.getTip();
    if (tip) {
      this.currentEpoch = tip.header.height;
      this.currentTipHash = tip.hash;
      this.currentStateCommitment = tip.header.stateCommitment || "";
      this.currentFinalizedHeight = 0; // Will be updated from finality manager if available
    }
    
    // Start state sync based on role
    this.startStateSync();
    
    // Listen for role changes
    this.instanceCoordinator.onRoleChange(() => {
      this.startStateSync(); // Restart sync with new role
    });
  }

  /**
   * Start state sync (Leader broadcasts, Follower checks)
   */
  private startStateSync(): void {
    // Clear existing intervals
    if (this.stateSyncInterval) {
      clearInterval(this.stateSyncInterval);
      this.stateSyncInterval = null;
    }
    if (this.followerSyncCheckInterval) {
      clearInterval(this.followerSyncCheckInterval);
      this.followerSyncCheckInterval = null;
    }
    
    const role = this.instanceCoordinator.getRole();
    
    if (role === "LEADER") {
      // Leader: Broadcast state updates periodically
      this.stateSyncInterval = window.setInterval(() => {
        this.broadcastStateUpdate();
      }, STATE_SYNC_INTERVAL_MS);
      
      // Initial broadcast
      this.broadcastStateUpdate();
    } else {
      // Follower: Check for updates periodically
      this.followerSyncCheckInterval = window.setInterval(() => {
        this.checkForStateUpdate();
      }, FOLLOWER_SYNC_CHECK_INTERVAL_MS);
      
      // Initial check
      this.checkForStateUpdate();
    }
  }

  /**
   * Broadcast state update (Leader only)
   */
  private broadcastStateUpdate(): void {
    if (!this.broadcastChannel || !this.chainContext) return;
    if (this.instanceCoordinator.getRole() !== "LEADER") return;
    
    const tip = this.chainContext.storage.getTip();
    if (!tip) return;
    
    // Update current state
    this.currentEpoch = tip.header.height;
    this.currentTipHash = tip.hash;
    this.currentStateCommitment = tip.header.stateCommitment || "";
    
    // Get latest snapshot meta
    const latestSnapshot = getLatestSnapshotMeta();
    
    const message: StateUpdateMessage = {
      type: "STATE_UPDATE",
      epoch: this.currentEpoch,
      tipHash: this.currentTipHash,
      stateCommitment: this.currentStateCommitment,
      snapshotMeta: latestSnapshot || undefined,
      finalizedHeight: this.currentFinalizedHeight,
    };
    
    this.broadcastChannel.postMessage(message);
    
    // Also broadcast wallet state
    this.broadcastWalletState();
    
    // Broadcast note scan states for all wallets
    this.broadcastNoteScanStates();
  }

  /**
   * Broadcast wallet state (Leader only)
   */
  private broadcastWalletState(): void {
    if (!this.broadcastChannel || this.instanceCoordinator.getRole() !== "LEADER") return;
    
    const walletStore = getMultiWalletStore();
    const currentWallet = walletStore.getCurrentWallet();
    const miningWallet = walletStore.getMiningWallet();
    const allWallets = walletStore.listWallets();
    
    const message: WalletStateSyncMessage = {
      type: "WALLET_STATE_SYNC",
      currentWalletId: currentWallet?.id || null,
      miningWalletId: miningWallet?.id || null,
      walletList: allWallets.map(w => ({
        id: w.id,
        name: w.name,
        address: w.address,
      })),
    };
    
    this.broadcastChannel.postMessage(message);
  }

  /**
   * Broadcast note scan states for all wallets (Leader only)
   */
  private broadcastNoteScanStates(): void {
    if (!this.broadcastChannel || this.instanceCoordinator.getRole() !== "LEADER") return;
    
    const walletStore = getMultiWalletStore();
    const allWallets = walletStore.listWallets();
    
    for (const wallet of allWallets) {
      const noteStore = getNoteStore(wallet.id);
      const scanState = noteStore.getScanState();
      const notes = noteStore.loadNotes();
      const unspentNotes = noteStore.getUnspentNotes();
      
      const message: NoteScanStateSyncMessage = {
        type: "NOTE_SCAN_STATE_SYNC",
        walletId: wallet.id,
        lastScannedHeight: scanState.lastScannedHeight,
        noteCount: notes.length,
        unspentNoteCount: unspentNotes.length,
      };
      
      this.broadcastChannel.postMessage(message);
    }
  }

  /**
   * Check for state update (Follower only)
   */
  private checkForStateUpdate(): void {
    if (!this.chainContext || this.instanceCoordinator.getRole() !== "FOLLOWER") return;
    if (this.isSyncing) return; // Already syncing, skip
    
    const leaderInfo = this.instanceCoordinator.getLeaderInfo();
    if (!leaderInfo) return;
    
    // Check if we're out of sync
    const tip = this.chainContext.storage.getTip();
    const localEpoch = tip?.header.height ?? 0;
    const localTipHash = tip?.hash || "";
    const localStateCommitment = tip?.header.stateCommitment || "";
    
    // Compare with leader
    if (
      leaderInfo.height !== localEpoch ||
      leaderInfo.tipHash !== localTipHash
    ) {
      // Out of sync, trigger sync
      console.log(`[LocalStateSync] Out of sync detected. Leader: height=${leaderInfo.height}, hash=${leaderInfo.tipHash.substring(0, 16)}... Local: height=${localEpoch}, hash=${localTipHash.substring(0, 16)}...`);
      this.triggerLocalFastSync();
    } else {
      // Check state commitment if available
      if (leaderInfo.tipHash === localTipHash && localStateCommitment) {
        // We're at the same tip, verify state commitment
        this.performConsistencyCheck();
      }
    }
  }

  /**
   * Handle broadcast messages
   */
  private handleBroadcastMessage(event: MessageEvent): void {
    const message = event.data as LocalStateMessage;
    const instanceId = this.instanceCoordinator.getInstanceId();
    
    // Ignore own messages (if sender is tracked)
    if ((message as any).senderId === instanceId) return;
    
    switch (message.type) {
      case "STATE_UPDATE":
        this.handleStateUpdate(message);
        break;
      case "WALLET_STATE_SYNC":
        this.handleWalletStateSync(message);
        break;
      case "NOTE_SCAN_STATE_SYNC":
        this.handleNoteScanStateSync(message);
        break;
      case "REQUEST_LOCAL_SNAPSHOT":
        this.handleSnapshotRequest(message);
        break;
      case "LOCAL_SNAPSHOT_RESPONSE":
        this.handleSnapshotResponse(message);
        break;
    }
  }

  /**
   * Handle state update from leader
   */
  private handleStateUpdate(message: StateUpdateMessage): void {
    if (this.instanceCoordinator.getRole() === "LEADER") return; // Ignore if we're leader
    
    this.leaderEpoch = message.epoch;
    this.leaderTipHash = message.tipHash;
    this.leaderStateCommitment = message.stateCommitment;
    
    // Check if we need to sync
    const tip = this.chainContext?.storage.getTip();
    const localEpoch = tip?.header.height ?? 0;
    const localTipHash = tip?.hash || "";
    
    if (message.epoch > localEpoch || message.tipHash !== localTipHash) {
      // Need to sync
      if (!this.isSyncing) {
        this.triggerLocalFastSync();
      }
    } else if (message.epoch === localEpoch && message.tipHash === localTipHash) {
      // Same tip, verify state commitment
      const localStateCommitment = tip?.header.stateCommitment || "";
      if (message.stateCommitment && localStateCommitment && message.stateCommitment !== localStateCommitment) {
        console.warn("[LocalStateSync] State commitment mismatch at same tip! Triggering resync...");
        this.triggerLocalFastSync();
      }
    }
  }

  /**
   * Handle wallet state sync
   */
  private handleWalletStateSync(message: WalletStateSyncMessage): void {
    if (this.instanceCoordinator.getRole() === "LEADER") return; // Ignore if we're leader
    
    const walletStore = getMultiWalletStore();
    
    // Sync current wallet
    if (message.currentWalletId) {
      const currentWallet = walletStore.getCurrentWallet();
      if (currentWallet?.id !== message.currentWalletId) {
        walletStore.setCurrentWallet(message.currentWalletId);
      }
    }
    
    // Sync mining wallet
    if (message.miningWalletId) {
      const miningWallet = walletStore.getMiningWallet();
      if (miningWallet?.id !== message.miningWalletId) {
        walletStore.setMiningWallet(message.miningWalletId);
      }
    }
    
    // Note: We don't create/delete wallets here, just sync the active ones
    // Wallet creation/deletion should be done by user action
  }

  /**
   * Handle note scan state sync
   */
  private handleNoteScanStateSync(message: NoteScanStateSyncMessage): void {
    if (this.instanceCoordinator.getRole() === "LEADER") return; // Ignore if we're leader
    
    const noteStore = getNoteStore(message.walletId);
    const currentScanState = noteStore.getScanState();
    
    // Update scan state if leader is ahead
    if (message.lastScannedHeight > currentScanState.lastScannedHeight) {
      noteStore.updateScanState({
        lastScannedHeight: message.lastScannedHeight,
      });
    }
    
    // Note: We don't sync notes themselves, as they should be scanned from blocks
    // But we sync the scan progress to avoid duplicate scanning
  }

  /**
   * Trigger local fast sync (Follower requests snapshot from Leader)
   */
  private async triggerLocalFastSync(): Promise<void> {
    if (!this.chainContext || this.isSyncing) return;
    if (this.instanceCoordinator.getRole() !== "FOLLOWER") return;
    
    this.isSyncing = true;
    this.syncInfo.syncStatus = "syncing";
    this.notifyStateSync();
    
    try {
      console.log("[LocalStateSync] Starting local fast sync...");
      
      // Request snapshot from leader
      const snapshotResponse = await this.requestLocalSnapshot();
      
      if (!snapshotResponse) {
        // No snapshot available - this is normal if there's no leader or leader has no snapshot
        // We'll sync via blocks instead, which is fine
        console.log("[LocalStateSync] No snapshot available from leader, will sync via blocks instead");
        this.syncInfo = {
          lastSyncEpoch: this.leaderEpoch,
          lastSyncTime: Date.now(),
          lastSyncTipHash: this.leaderTipHash,
          lastSyncStateCommitment: this.leaderStateCommitment,
          syncStatus: "synced", // Mark as synced - we'll catch up via blocks
        };
        return; // Exit early, no error
      }
      
      // Apply snapshot to local state
      await this.applyLocalSnapshot(snapshotResponse);
      
      // Verify consistency
      const isConsistent = await this.performConsistencyCheck();
      
      if (isConsistent) {
        this.syncInfo = {
          lastSyncEpoch: this.leaderEpoch,
          lastSyncTime: Date.now(),
          lastSyncTipHash: this.leaderTipHash,
          lastSyncStateCommitment: this.leaderStateCommitment,
          syncStatus: "synced",
        };
        console.log("[LocalStateSync] Local fast sync completed successfully");
      } else {
        throw new Error("State consistency check failed after sync");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      // If it's a timeout or no snapshot available, it's not a critical error
      // This is normal when there's no leader or leader doesn't have a snapshot yet
      if (errorMsg.includes("timeout") || errorMsg.includes("Snapshot request timeout") || errorMsg.includes("Failed to receive snapshot")) {
        console.warn("[LocalStateSync] Local fast sync skipped:", errorMsg, "(this is normal if you're the only instance or leader has no snapshot)");
        this.syncInfo.syncStatus = "synced"; // Mark as synced since we'll sync via blocks instead
        this.syncInfo.error = undefined; // Clear error
      } else {
        console.error("[LocalStateSync] Local fast sync failed:", error);
        this.syncInfo.syncStatus = "error";
        this.syncInfo.error = errorMsg;
      }
    } finally {
      this.isSyncing = false;
      this.notifyStateSync();
    }
  }

  /**
   * Request local snapshot from leader
   */
  private async requestLocalSnapshot(): Promise<LocalSnapshotResponse | null> {
    if (!this.broadcastChannel) return null;
    
    return new Promise((resolve) => {
      const requestId = `${this.instanceCoordinator.getInstanceId()}_${Date.now()}`;
      const timeout = setTimeout(() => {
        this.pendingSnapshotRequests.delete(requestId);
        // Resolve with null instead of rejecting - this is not a critical error
        // It just means there's no leader available or leader doesn't have a snapshot yet
        console.warn("[LocalStateSync] Snapshot request timeout - no leader response (this is normal if you're the only instance)");
        resolve(null);
      }, SYNC_TIMEOUT_MS);
      
      this.pendingSnapshotRequests.set(requestId, (response) => {
        clearTimeout(timeout);
        this.pendingSnapshotRequests.delete(requestId);
        resolve(response);
      });
      
      const request: LocalSnapshotRequest = {
        type: "REQUEST_LOCAL_SNAPSHOT",
        requesterId: requestId,
      };
      
      this.broadcastChannel!.postMessage(request);
    });
  }

  /**
   * Handle snapshot request (Leader responds)
   */
  private async handleSnapshotRequest(message: LocalSnapshotRequest): Promise<void> {
    if (!this.broadcastChannel || !this.chainContext) return;
    if (this.instanceCoordinator.getRole() !== "LEADER") return;
    
    try {
      // Get latest snapshot
      const latestSnapshot = getLatestSnapshotMeta();
      if (!latestSnapshot) {
        console.warn("[LocalStateSync] No snapshot available to share");
        return;
      }
      
      // Load snapshot data
      const snapshotData = await loadSnapshotByHeight(latestSnapshot.height);
      if (!snapshotData) {
        console.warn("[LocalStateSync] Failed to load snapshot data");
        return;
      }
      
      // Prepare response
      const response: LocalSnapshotResponse = {
        type: "LOCAL_SNAPSHOT_RESPONSE",
        requesterId: message.requesterId,
        snapshotMeta: latestSnapshot,
        snapshotData: snapshotData.indexState || snapshotData.data,
        deltaData: snapshotData.delta,
      };
      
      this.broadcastChannel.postMessage(response);
    } catch (error) {
      console.error("[LocalStateSync] Failed to handle snapshot request:", error);
    }
  }

  /**
   * Handle snapshot response (Follower receives)
   */
  private handleSnapshotResponse(message: LocalSnapshotResponse): void {
    const handler = this.pendingSnapshotRequests.get(message.requesterId);
    if (handler) {
      handler(message);
    }
  }

  /**
   * Apply local snapshot to state
   */
  private async applyLocalSnapshot(response: LocalSnapshotResponse): Promise<void> {
    if (!this.chainContext) return;
    
    const { snapshotMeta, snapshotData, deltaData } = response;
    
    // If we have full snapshot data, restore from it
    if (snapshotData) {
      const restoredState = IndexStateClass.fromSnapshot(snapshotData);
      
      // Replace current state
      const currentInternalState = (this.chainContext.indexState as any).getInternalState();
      const restoredInternalState = (restoredState as any).getInternalState();
      
      currentInternalState.clear();
      for (const [ns, kvMap] of restoredInternalState) {
        const newMap = new Map(kvMap);
        currentInternalState.set(ns, newMap);
      }
      
      // Also restore privacy state (commitments, nullifiers)
      // These are restored via fromSnapshot, but we ensure they're set
      const restoredCommitments = (restoredState as any).getCommitments?.() || (restoredState as any).commitments;
      const restoredNullifiers = (restoredState as any).getNullifierSet?.() || (restoredState as any).nullifierSet;
      
      if (restoredCommitments) {
        (this.chainContext.indexState as any).commitments = new Map(restoredCommitments);
      }
      if (restoredNullifiers) {
        (this.chainContext.indexState as any).nullifierSet = new Set(restoredNullifiers);
      }
    }
    
    // If we have delta data, apply it
    if (deltaData) {
      await applyDelta(deltaData, (op) => {
        this.chainContext!.indexState.applyOperation(op, undefined);
      });
    }
    
    // Replay blocks from snapshot height to tip
    const tip = this.chainContext.storage.getTip();
    const tipHeight = tip?.header.height ?? 0;
    
    if (snapshotMeta.height < tipHeight) {
      // Replay blocks after snapshot
      for (let h = snapshotMeta.height + 1; h <= tipHeight; h++) {
        const block = this.chainContext.storage.getBlockByHeight(h);
        if (block) {
          this.chainContext.indexState.applyBlock(block);
        }
      }
    }
  }

  /**
   * Perform consistency check
   */
  private async performConsistencyCheck(): Promise<boolean> {
    if (!this.chainContext) return false;
    
    const tip = this.chainContext.storage.getTip();
    const localEpoch = tip?.header.height ?? 0;
    const localTipHash = tip?.hash || "";
    const localStateCommitment = tip?.header.stateCommitment || "";
    
    // Check tip hash match
    const tipHashMatch = localTipHash === this.leaderTipHash;
    
    // Check height match
    const heightMatch = localEpoch === this.leaderEpoch;
    
    // Check state commitment match
    let stateCommitmentMatch = true;
    if (this.leaderStateCommitment && localStateCommitment) {
      stateCommitmentMatch = localStateCommitment === this.leaderStateCommitment;
    } else if (this.leaderStateCommitment) {
      // Leader has commitment but we don't, compute it
      const snapshot = this.chainContext.indexState.toSnapshot();
      const computedCommitment = await computeSnapshotStateHash(snapshot);
      stateCommitmentMatch = computedCommitment === this.leaderStateCommitment;
    }
    
    const isConsistent = tipHashMatch && heightMatch && stateCommitmentMatch;
    
    // Notify consistency check
    this.consistencyCheckCallbacks.forEach(cb => {
      try {
        cb(isConsistent, {
          tipHashMatch,
          stateCommitmentMatch,
          heightMatch,
        });
      } catch (error) {
        console.error("[LocalStateSync] Consistency check callback error:", error);
      }
    });
    
    if (!isConsistent) {
      console.warn("[LocalStateSync] Consistency check failed:", {
        tipHashMatch,
        heightMatch,
        stateCommitmentMatch,
        localEpoch,
        leaderEpoch: this.leaderEpoch,
        localTipHash: localTipHash.substring(0, 16),
        leaderTipHash: this.leaderTipHash.substring(0, 16),
      });
    }
    
    return isConsistent;
  }

  /**
   * Report local state (called when state changes)
   */
  reportLocalState(height: number, tipHash: string, stateCommitment?: string, finalizedHeight?: number): void {
    this.currentEpoch = height;
    this.currentTipHash = tipHash;
    if (stateCommitment) {
      this.currentStateCommitment = stateCommitment;
    }
    if (finalizedHeight !== undefined) {
      this.currentFinalizedHeight = finalizedHeight;
    }
    
    // If we're leader, broadcast immediately
    if (this.instanceCoordinator.getRole() === "LEADER") {
      this.broadcastStateUpdate();
    }
  }

  /**
   * Get sync info
   */
  getSyncInfo(): LocalStateSyncInfo {
    return { ...this.syncInfo };
  }

  /**
   * Register state sync callback
   */
  onStateSync(callback: StateSyncCallback): () => void {
    this.stateSyncCallbacks.add(callback);
    return () => {
      this.stateSyncCallbacks.delete(callback);
    };
  }

  /**
   * Register consistency check callback
   */
  onConsistencyCheck(callback: ConsistencyCheckCallback): () => void {
    this.consistencyCheckCallbacks.add(callback);
    return () => {
      this.consistencyCheckCallbacks.delete(callback);
    };
  }

  /**
   * Notify state sync callbacks
   */
  private notifyStateSync(): void {
    this.stateSyncCallbacks.forEach(cb => {
      try {
        cb(this.syncInfo);
      } catch (error) {
        console.error("[LocalStateSync] State sync callback error:", error);
      }
    });
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.stateSyncInterval) {
      clearInterval(this.stateSyncInterval);
      this.stateSyncInterval = null;
    }
    if (this.followerSyncCheckInterval) {
      clearInterval(this.followerSyncCheckInterval);
      this.followerSyncCheckInterval = null;
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    this.stateSyncCallbacks.clear();
    this.consistencyCheckCallbacks.clear();
    this.pendingSnapshotRequests.clear();
  }
}

// Global instance
let globalLocalStateCoordinator: LocalStateCoordinator | null = null;

/**
 * Get or create global LocalStateCoordinator
 */
export function getLocalStateCoordinator(): LocalStateCoordinator {
  if (!globalLocalStateCoordinator) {
    globalLocalStateCoordinator = new LocalStateCoordinator();
  }
  return globalLocalStateCoordinator;
}

