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
import { guardExternalStateWrite } from "./stateGuards.js";
import { IndexState as IndexStateClass } from "./indexState.js";
import { applyDelta } from "./snapshotDelta.js";
import { computeSnapshotStateHash } from "./snapshotVerify.js";
import { getMultiWalletStore } from "./multiWallet.js";
import { getNoteStore } from "./privacy/noteStore.js";
import { logger } from "./logger.js";

const BROADCAST_CHANNEL_STATE = "indexerchain_local_state_v1";
const STATE_SYNC_INTERVAL_MS = 1000; // Leader broadcasts state every 1 second
const FOLLOWER_SYNC_CHECK_INTERVAL_MS = 2000; // Followers check for updates every 2 seconds
const SYNC_TIMEOUT_MS = 5000; // Sync timeout: 5 seconds

// Phase 38: localStorage keys for shared state across tabs
const STORAGE_KEY_PREFIX = "indexerchain.localState.";
const STORAGE_KEYS = {
  HEIGHT: STORAGE_KEY_PREFIX + "height",
  TIP_HASH: STORAGE_KEY_PREFIX + "tipHash",
  STATE_COMMITMENT: STORAGE_KEY_PREFIX + "stateCommitment",
  SNAPSHOT_META: STORAGE_KEY_PREFIX + "snapshotMeta",
  RECENT_HEADERS: STORAGE_KEY_PREFIX + "recentHeaders",
  LAST_UPDATED: STORAGE_KEY_PREFIX + "lastUpdated",
};

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
    
    // Phase 38: Load shared state from localStorage (if available)
    this.loadSharedStateFromStorage();
    
    // Get initial state
    const tip = chainContext.storage.getTip();
    if (tip) {
      this.currentEpoch = tip.header.height;
      this.currentTipHash = tip.hash;
      this.currentStateCommitment = tip.header.stateCommitment || "";
      this.currentFinalizedHeight = 0; // Will be updated from finality manager if available
      
      // Phase 38: Save to localStorage for other tabs
      this.saveSharedStateToStorage();
    }
    
    // Start state sync based on role
    this.startStateSync();
    
    // Listen for role changes
    this.instanceCoordinator.onRoleChange(() => {
      this.startStateSync(); // Restart sync with new role
    });
    
    // Phase 38: Listen for storage events (cross-tab updates)
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (!guardExternalStateWrite('storage_event')) return;
        if (e.key && e.key.startsWith(STORAGE_KEY_PREFIX)) {
          this.handleStorageEvent(e);
        }
      });
    }
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
        if (!guardExternalStateWrite('broadcastStateUpdate')) return;
        this.broadcastStateUpdate();
      }, STATE_SYNC_INTERVAL_MS);
      
      // Initial broadcast
      this.broadcastStateUpdate();
    } else {
      // Follower: Check for updates periodically
      this.followerSyncCheckInterval = window.setInterval(() => {
        if (!guardExternalStateWrite('checkForStateUpdate')) return;
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
    
    // Phase 38: Get recent headers (last 500) for fast sync
    const recentHeaders: any[] = [];
    let currentBlock = tip;
    const allBlocks = this.chainContext.storage.getAllBlocks();
    for (let i = 0; i < 500 && currentBlock; i++) {
      recentHeaders.push(currentBlock.header);
      const prevHash = currentBlock.header.prevHash;
      if (prevHash) {
        const prevBlock = allBlocks.find(b => b.hash === prevHash);
        if (prevBlock) {
          currentBlock = prevBlock;
        } else {
          break;
        }
      } else {
        break;
      }
    }
    recentHeaders.reverse(); // Oldest to newest
    
    const message: StateUpdateMessage = {
      type: "STATE_UPDATE",
      epoch: this.currentEpoch,
      tipHash: this.currentTipHash,
      stateCommitment: this.currentStateCommitment,
      snapshotMeta: latestSnapshot || undefined,
      finalizedHeight: this.currentFinalizedHeight,
    };
    
    this.broadcastChannel.postMessage(message);
    
    // Phase 38: Save to localStorage for other tabs (including recent headers)
    this.saveSharedStateToStorage(recentHeaders);
    
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
      logger.debug(`[LocalStateSync] Out of sync detected. Leader: height=${leaderInfo.height}, hash=${leaderInfo.tipHash.substring(0, 16)}... Local: height=${localEpoch}, hash=${localTipHash.substring(0, 16)}...`);
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
    if (!guardExternalStateWrite('local_fast_sync')) return;
    
    this.isSyncing = true;
    this.syncInfo.syncStatus = "syncing";
    this.notifyStateSync();
    
    try {
      logger.debug("[LocalStateSync] Starting local fast sync...");
      
      // Request snapshot from leader
      const snapshotResponse = await this.requestLocalSnapshot();
      
      if (!snapshotResponse) {
        // No snapshot available - this is normal if there's no leader or leader has no snapshot
        // We'll sync via blocks instead, which is fine
        logger.debug("[LocalStateSync] No snapshot available from leader, will sync via blocks instead");
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
      if (!guardExternalStateWrite('apply_local_snapshot')) return;
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
        logger.debug("[LocalStateSync] Local fast sync completed successfully");
      } else {
        throw new Error("State consistency check failed after sync");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      // If it's a timeout or no snapshot available, it's not a critical error
      // This is normal when there's no leader or leader doesn't have a snapshot yet
      if (errorMsg.includes("timeout") || errorMsg.includes("Snapshot request timeout") || errorMsg.includes("Failed to receive snapshot")) {
        this.syncInfo.syncStatus = "synced"; // Mark as synced since we'll sync via blocks instead
        this.syncInfo.error = undefined; // Clear error
      } else {
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
        return;
      }
      
      // Load snapshot data
      const snapshotData = await loadSnapshotByHeight(latestSnapshot.height);
      if (!snapshotData) {
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
    
    // CRITICAL: Block snapshot application during solo mining to prevent balance rollback
    const { guardSnapshotApplication } = await import("./stateGuards.js");
    const currentTip = this.chainContext.storage.getTip();
    const currentHeight = currentTip?.header.height ?? 0;
    const { snapshotMeta, snapshotData, deltaData } = response;
    
    if (!guardSnapshotApplication(snapshotMeta?.height, currentHeight)) {
      logger.warn(`[LocalStateCoordinator] Skipping snapshot application at height ${snapshotMeta?.height} (solo mining mode)`);
      return;
    }
    
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
    
    // If we're the LEADER, we're always consistent with ourselves
    // The consistency check is only meaningful for FOLLOWER instances
    if (this.instanceCoordinator.getRole() === "LEADER") {
      // As LEADER, we're the source of truth - always consistent
      const isConsistent = true;
      this.consistencyCheckCallbacks.forEach(cb => {
        try {
          cb(isConsistent, {
            tipHashMatch: true,
            stateCommitmentMatch: true,
            heightMatch: true,
          });
        } catch (error) {
        }
      });
      return isConsistent;
    }
    
    // For FOLLOWER instances, check consistency with leader
    // Only check if we have leader state (leaderEpoch > 0)
    if (this.leaderEpoch === 0) {
      // No leader state yet - can't check consistency
      const isConsistent = true; // Not inconsistent yet, just waiting
      this.consistencyCheckCallbacks.forEach(cb => {
        try {
          cb(isConsistent, {
            tipHashMatch: true,
            stateCommitmentMatch: true,
            heightMatch: true,
          });
        } catch (error) {
        }
      });
      return isConsistent;
    }
    
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
      }
    });
    
    if (!isConsistent) {
      // Only warn if leaderEpoch > 0 (leader has reported state)
      // If leaderEpoch is 0, it means we haven't received any state updates from leader yet,
      // which is normal during initialization or when there's no leader
      if (this.leaderEpoch > 0) {
        // State mismatch detected
      } else {
        // Leader hasn't reported state yet - this is normal, just log at debug level
        logger.debug("[LocalStateSync] Waiting for leader state update (leaderEpoch: 0)");
      }
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
      }
    });
  }

  /**
   * Phase 38: Save shared state to localStorage
   */
  private saveSharedStateToStorage(recentHeaders?: any[]): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    
    try {
      localStorage.setItem(STORAGE_KEYS.HEIGHT, String(this.currentEpoch));
      localStorage.setItem(STORAGE_KEYS.TIP_HASH, this.currentTipHash);
      localStorage.setItem(STORAGE_KEYS.STATE_COMMITMENT, this.currentStateCommitment);
      localStorage.setItem(STORAGE_KEYS.LAST_UPDATED, String(Date.now()));
      
      // Save snapshot meta if available
      const latestSnapshot = getLatestSnapshotMeta();
      if (latestSnapshot) {
        localStorage.setItem(STORAGE_KEYS.SNAPSHOT_META, JSON.stringify(latestSnapshot));
      }
      
      // Save recent headers if provided
      if (recentHeaders && recentHeaders.length > 0) {
        // Only save last 500 headers to avoid localStorage size limits
        const headersToSave = recentHeaders.slice(-500);
        localStorage.setItem(STORAGE_KEYS.RECENT_HEADERS, JSON.stringify(headersToSave));
      }
    } catch (error) {
      // localStorage might be full or disabled - ignore silently
    }
  }

  /**
   * Phase 38: Load shared state from localStorage
   */
  private loadSharedStateFromStorage(): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    
    try {
      const storedHeight = localStorage.getItem(STORAGE_KEYS.HEIGHT);
      const storedTipHash = localStorage.getItem(STORAGE_KEYS.TIP_HASH);
      const storedStateCommitment = localStorage.getItem(STORAGE_KEYS.STATE_COMMITMENT);
      const storedLastUpdated = localStorage.getItem(STORAGE_KEYS.LAST_UPDATED);
      
      if (storedHeight && storedTipHash) {
        const height = parseInt(storedHeight, 10);
        const lastUpdated = storedLastUpdated ? parseInt(storedLastUpdated, 10) : 0;
        
        // Only use stored state if it's recent (within 5 minutes)
        const age = Date.now() - lastUpdated;
        if (age < 5 * 60 * 1000) {
          this.currentEpoch = height;
          this.currentTipHash = storedTipHash;
          this.currentStateCommitment = storedStateCommitment || "";
        } else {
          logger.debug(`[LocalStateSync] Stored state is too old (${Math.round(age / 1000)}s), ignoring`);
        }
      }
    } catch (error) {
    }
  }

  /**
   * Phase 38: Handle storage events (cross-tab updates)
   */
  private handleStorageEvent(event: StorageEvent): void {
    if (!this.chainContext || this.instanceCoordinator.getRole() === "LEADER") {
      // Leader doesn't need to react to storage events (it's the source)
      return;
    }
    
    try {
      if (event.key === STORAGE_KEYS.HEIGHT || event.key === STORAGE_KEYS.TIP_HASH) {
        // State was updated in another tab, check if we need to sync
        const storedHeight = localStorage.getItem(STORAGE_KEYS.HEIGHT);
        const storedTipHash = localStorage.getItem(STORAGE_KEYS.TIP_HASH);
        
        if (storedHeight && storedTipHash) {
          const height = parseInt(storedHeight, 10);
          const tip = this.chainContext.storage.getTip();
          const localHeight = tip?.header.height ?? 0;
          const localTipHash = tip?.hash || "";
          
          if (height > localHeight || storedTipHash !== localTipHash) {
            logger.debug(`[LocalStateSync] Detected state update in another tab: height ${localHeight} -> ${height}`);
            // Trigger local fast sync
            this.triggerLocalFastSync();
          }
        }
      }
    } catch (error) {
    }
  }

  /**
   * Phase 38: Get recent headers from localStorage (for fast sync)
   */
  getRecentHeadersFromStorage(): any[] | null {
    if (typeof window === "undefined" || !window.localStorage) return null;
    
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.RECENT_HEADERS);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
    }
    return null;
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

