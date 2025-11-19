/**
 * Local Instance Coordinator
 * 
 * Phase 27: Local Consistency & Multi-Instance Coordination
 * 
 * Coordinates multiple browser instances/tabs on the same machine to ensure:
 * - Only one LEADER instance can mine
 * - All instances share a canonical local view
 * - Clear conflict resolution rules
 * - Automatic role assignment and heartbeat
 */

export type LocalInstanceRole = "LEADER" | "FOLLOWER";

export interface LocalInstanceInfo {
  instanceId: string;        // Random UUID
  startedAt: number;         // Start timestamp
  lastSeenAt: number;        // Last heartbeat timestamp
  role: LocalInstanceRole;   // Current role
  height: number;            // Current local height
  tipHash: string;           // Current tip hash
  finalizedHeight?: number;  // Finalized height (if available)
}

export interface LeaderInfo {
  instanceId: string;
  lastSeenAt: number;
  height: number;
  tipHash: string;
  finalizedHeight?: number;
}

const STORAGE_KEY_LEADER = "indexerchain_local_leader_v1";
const STORAGE_KEY_INSTANCE = "indexerchain_local_instance_v1";
const BROADCAST_CHANNEL_NAME = "indexerchain_local";
const HEARTBEAT_INTERVAL_MS = 2000;  // Leader heartbeat: 2 seconds
const FOLLOWER_HEARTBEAT_INTERVAL_MS = 5000;  // Follower heartbeat: 5 seconds
const LEADER_TIMEOUT_MS = 5000;  // Leader timeout: 5 seconds
const ELECTION_COOLDOWN_MS = 1000;  // Cooldown after election: 1 second

export type RoleChangeCallback = (role: LocalInstanceRole, leaderInfo: LeaderInfo | null) => void;
export type LeaderChangeCallback = (leaderInfo: LeaderInfo | null) => void;
export type ConflictDetectedCallback = (localHeight: number, leaderHeight: number, finalizedHeight: number) => void;

export class LocalInstanceCoordinator {
  private instanceId: string;
  private role: LocalInstanceRole = "FOLLOWER";
  private leaderInfo: LeaderInfo | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private heartbeatInterval: number | null = null;
  private lastElectionTime: number = 0;
  
  private roleChangeCallbacks: Set<RoleChangeCallback> = new Set();
  private leaderChangeCallbacks: Set<LeaderChangeCallback> = new Set();
  private conflictCallbacks: Set<ConflictDetectedCallback> = new Set();
  
  private currentHeight: number = 0;
  private currentTipHash: string = "";
  private currentFinalizedHeight: number = 0;

  constructor() {
    // Generate or load instance ID
    this.instanceId = this.getOrCreateInstanceId();
  }

  /**
   * Initialize the coordinator
   */
  async init(): Promise<void> {
    // Load existing leader info
    this.loadLeaderInfo();
    
    // Initialize BroadcastChannel
    if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      this.broadcastChannel.onmessage = (event) => this.handleBroadcastMessage(event);
    }
    
    // Send HELLO to discover other instances
    this.broadcastHello();
    
    // Perform initial election
    await this.performElection();
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Periodically check leader timeout
    setInterval(() => this.checkLeaderTimeout(), 1000);
  }

  /**
   * Get or create instance ID
   */
  private getOrCreateInstanceId(): string {
    if (typeof localStorage === "undefined") {
      return `instance_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    
    const stored = localStorage.getItem(STORAGE_KEY_INSTANCE);
    if (stored) {
      try {
        const info = JSON.parse(stored) as LocalInstanceInfo;
        return info.instanceId;
      } catch {
        // Invalid stored data, create new
      }
    }
    
    const instanceId = `instance_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const info: LocalInstanceInfo = {
      instanceId,
      startedAt: Date.now(),
      lastSeenAt: Date.now(),
      role: "FOLLOWER",
      height: 0,
      tipHash: "",
    };
    localStorage.setItem(STORAGE_KEY_INSTANCE, JSON.stringify(info));
    return instanceId;
  }

  /**
   * Load leader info from localStorage
   */
  private loadLeaderInfo(): void {
    if (typeof localStorage === "undefined") return;
    
    const stored = localStorage.getItem(STORAGE_KEY_LEADER);
    if (stored) {
      try {
        const loadedInfo = JSON.parse(stored) as LeaderInfo;
        
        // Check if this leader was manually cleared
        const clearedKey = `${STORAGE_KEY_LEADER}_cleared_${loadedInfo.instanceId}`;
        const clearedTime = localStorage.getItem(clearedKey);
        if (clearedTime) {
          const timeSinceCleared = Date.now() - parseInt(clearedTime, 10);
          // If cleared less than 10 seconds ago, ignore it
          if (timeSinceCleared < 10000) {
            console.log(`[LocalInstance] Ignoring stored leader ${loadedInfo.instanceId} - it was manually cleared ${timeSinceCleared}ms ago`);
            this.leaderInfo = null;
            localStorage.removeItem(STORAGE_KEY_LEADER);
            localStorage.removeItem(clearedKey);
            return;
          } else {
            // Clean up old flag
            localStorage.removeItem(clearedKey);
          }
        }
        
        this.leaderInfo = loadedInfo;
        
        // Check if leader is still valid (not timed out)
        const age = Date.now() - this.leaderInfo.lastSeenAt;
        if (age > LEADER_TIMEOUT_MS) {
          // Leader timed out, clear it
          console.log(`[LocalInstance] Leader ${this.leaderInfo.instanceId} timed out (age: ${age}ms), clearing`);
          this.leaderInfo = null;
          localStorage.removeItem(STORAGE_KEY_LEADER);
        } else {
          console.log(`[LocalInstance] Loaded leader ${this.leaderInfo.instanceId} (age: ${age}ms)`);
        }
      } catch {
        this.leaderInfo = null;
      }
    }
  }
  
  /**
   * Clear stale leader info (public method for manual cleanup)
   * If force is true, clears even if not timed out
   */
  clearStaleLeader(force: boolean = false): void {
    if (this.leaderInfo) {
      const age = Date.now() - this.leaderInfo.lastSeenAt;
      const oldInstanceId = this.leaderInfo.instanceId;
      
      if (force || age > LEADER_TIMEOUT_MS) {
        console.log(`[LocalInstance] ${force ? 'Force' : 'Manually'} clearing ${force && age <= LEADER_TIMEOUT_MS ? 'active' : 'stale'} leader ${oldInstanceId} (age: ${age}ms)`);
        
        // Clear leader info
        this.leaderInfo = null;
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem(STORAGE_KEY_LEADER);
          // Also set a flag to ignore any LEADER_STATUS messages from the old instance for a short time
          localStorage.setItem(`${STORAGE_KEY_LEADER}_cleared_${oldInstanceId}`, Date.now().toString());
        }
        
        // Trigger election to become leader
        this.performElection();
      } else {
        console.log(`[LocalInstance] Leader ${this.leaderInfo.instanceId} is still active (age: ${age}ms), not clearing. Use force=true to override.`);
      }
    } else {
      console.log(`[LocalInstance] No leader info to clear`);
      // Even if no leader info, try to become leader
      this.performElection();
    }
  }

  /**
   * Save leader info to localStorage
   */
  private saveLeaderInfo(info: LeaderInfo | null): void {
    if (typeof localStorage === "undefined") return;
    
    if (info) {
      localStorage.setItem(STORAGE_KEY_LEADER, JSON.stringify(info));
    } else {
      localStorage.removeItem(STORAGE_KEY_LEADER);
    }
  }

  /**
   * Broadcast HELLO message
   */
  private broadcastHello(): void {
    if (!this.broadcastChannel) return;
    
    this.broadcastChannel.postMessage({
      type: "HELLO",
      instanceId: this.instanceId,
      startedAt: Date.now(),
      height: this.currentHeight,
      tipHash: this.currentTipHash,
    });
  }

  /**
   * Handle broadcast messages
   */
  private handleBroadcastMessage(event: MessageEvent): void {
    const { type, instanceId, ...data } = event.data;
    
    // Ignore own messages
    if (instanceId === this.instanceId) return;
    
    switch (type) {
      case "HELLO":
        // Another instance is saying hello, trigger election check
        this.checkElection();
        break;
        
      case "LEADER_STATUS":
        this.handleLeaderStatus(data as LeaderInfo);
        break;
        
      case "FOLLOWER_STATUS":
        // Just for debugging, can be ignored
        break;
        
      case "ELECTION":
        // Another instance is claiming leadership, check if we should accept
        this.handleElectionClaim(data);
        break;
    }
  }

  /**
   * Handle leader status update
   */
  private handleLeaderStatus(info: LeaderInfo): void {
    // Check if this instance was manually cleared
    if (typeof localStorage !== "undefined") {
      const clearedKey = `${STORAGE_KEY_LEADER}_cleared_${info.instanceId}`;
      const clearedTime = localStorage.getItem(clearedKey);
      if (clearedTime) {
        const timeSinceCleared = Date.now() - parseInt(clearedTime, 10);
        // Ignore LEADER_STATUS from cleared instance for 10 seconds
        if (timeSinceCleared < 10000) {
          console.log(`[LocalInstance] Ignoring LEADER_STATUS from manually cleared instance ${info.instanceId} (cleared ${timeSinceCleared}ms ago)`);
          return;
        } else {
          // Clean up the flag after 10 seconds
          localStorage.removeItem(clearedKey);
        }
      }
    }
    
    const wasLeader = this.role === "LEADER";
    
    // Update leader info
    this.leaderInfo = {
      ...info,
      lastSeenAt: Date.now(),
    };
    this.saveLeaderInfo(this.leaderInfo);
    
    // If we were leader but another instance is claiming leadership, check
    if (wasLeader && info.instanceId !== this.instanceId) {
      // Another instance is claiming to be leader
      // Check if we should step down (they might have won election)
      this.checkElection();
    }
    
    // If we're follower and leader changed, notify
    if (!wasLeader && this.role === "FOLLOWER") {
      this.notifyLeaderChanged();
    }
  }

  /**
   * Handle election claim from another instance
   */
  private handleElectionClaim(data: { instanceId: string; startedAt: number }): void {
    // If we're currently leader, check if we should step down
    if (this.role === "LEADER") {
      // Compare: earlier startedAt wins, or smaller instanceId if equal
      if (
        data.startedAt < Date.now() - (Date.now() - this.lastElectionTime) ||
        (data.startedAt === Date.now() && data.instanceId < this.instanceId)
      ) {
        // They should be leader, step down
        this.setRole("FOLLOWER");
      }
    }
  }

  /**
   * Perform election
   */
  private async performElection(): Promise<void> {
    const now = Date.now();
    
    // Cooldown check
    if (now - this.lastElectionTime < ELECTION_COOLDOWN_MS) {
      return;
    }
    
    this.lastElectionTime = now;
    
    // If no leader or leader timed out, we can become leader
    if (!this.leaderInfo || (now - this.leaderInfo.lastSeenAt > LEADER_TIMEOUT_MS)) {
      // Claim leadership
      this.leaderInfo = {
        instanceId: this.instanceId,
        lastSeenAt: now,
        height: this.currentHeight,
        tipHash: this.currentTipHash,
        finalizedHeight: this.currentFinalizedHeight,
      };
      this.saveLeaderInfo(this.leaderInfo);
      this.setRole("LEADER");
      
      // Broadcast election claim
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({
          type: "ELECTION",
          instanceId: this.instanceId,
          startedAt: Date.now(),
        });
      }
    } else {
      // Leader exists and is valid, become follower
      this.setRole("FOLLOWER");
    }
  }

  /**
   * Check if election is needed
   */
  private checkElection(): void {
    if (!this.leaderInfo) {
      this.performElection();
      return;
    }
    
    const age = Date.now() - this.leaderInfo.lastSeenAt;
    if (age > LEADER_TIMEOUT_MS) {
      this.performElection();
    }
  }

  /**
   * Check leader timeout periodically
   */
  private checkLeaderTimeout(): void {
    if (this.role === "LEADER") {
      // We're leader, just update our own timestamp
      if (this.leaderInfo && this.leaderInfo.instanceId === this.instanceId) {
        this.leaderInfo.lastSeenAt = Date.now();
        this.saveLeaderInfo(this.leaderInfo);
      }
    } else {
      // We're follower, check if leader timed out
      if (this.leaderInfo) {
        const age = Date.now() - this.leaderInfo.lastSeenAt;
        if (age > LEADER_TIMEOUT_MS) {
          // Leader timed out, trigger election
          this.leaderInfo = null;
          this.saveLeaderInfo(null);
          this.performElection();
        }
      } else {
        // No leader, try to become one
        this.performElection();
      }
    }
  }

  /**
   * Set role and notify callbacks
   */
  private setRole(newRole: LocalInstanceRole): void {
    if (this.role === newRole) return;
    
    const oldRole = this.role;
    this.role = newRole;
    
    // Notify role change
    this.roleChangeCallbacks.forEach(cb => {
      try {
        cb(newRole, this.leaderInfo);
      } catch (error) {
        console.error("[LocalInstance] Role change callback error:", error);
      }
    });
    
    // If becoming leader, notify leader change
    if (newRole === "LEADER" && oldRole !== "LEADER") {
      this.notifyLeaderChanged();
    }
  }

  /**
   * Notify leader changed
   */
  private notifyLeaderChanged(): void {
    this.leaderChangeCallbacks.forEach(cb => {
      try {
        cb(this.leaderInfo);
      } catch (error) {
        console.error("[LocalInstance] Leader change callback error:", error);
      }
    });
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = window.setInterval(() => {
      this.sendHeartbeat();
    }, this.role === "LEADER" ? HEARTBEAT_INTERVAL_MS : FOLLOWER_HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Send heartbeat
   */
  private sendHeartbeat(): void {
    if (!this.broadcastChannel) return;
    
    const message: any = {
      instanceId: this.instanceId,
      height: this.currentHeight,
      tipHash: this.currentTipHash,
      finalizedHeight: this.currentFinalizedHeight,
    };
    
    if (this.role === "LEADER") {
      this.broadcastChannel.postMessage({
        type: "LEADER_STATUS",
        ...message,
      });
      
      // Update leader info
      if (this.leaderInfo && this.leaderInfo.instanceId === this.instanceId) {
        this.leaderInfo = {
          ...this.leaderInfo,
          lastSeenAt: Date.now(),
          height: this.currentHeight,
          tipHash: this.currentTipHash,
          finalizedHeight: this.currentFinalizedHeight,
        };
        this.saveLeaderInfo(this.leaderInfo);
      }
    } else {
      this.broadcastChannel.postMessage({
        type: "FOLLOWER_STATUS",
        ...message,
      });
    }
  }

  /**
   * Report local status (height, tip hash, finalized height)
   */
  reportLocalStatus(height: number, tipHash: string, finalizedHeight?: number): void {
    this.currentHeight = height;
    this.currentTipHash = tipHash;
    if (finalizedHeight !== undefined) {
      this.currentFinalizedHeight = finalizedHeight;
    }
    
    // Update heartbeat message will include this
  }

  /**
   * Get current role
   */
  getRole(): LocalInstanceRole {
    return this.role;
  }

  /**
   * Get leader info
   */
  getLeaderInfo(): LeaderInfo | null {
    return this.leaderInfo;
  }

  /**
   * Get instance ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Check if this instance can mine
   */
  canMine(): boolean {
    return this.role === "LEADER";
  }

  /**
   * Register role change callback
   */
  onRoleChange(callback: RoleChangeCallback): () => void {
    this.roleChangeCallbacks.add(callback);
    return () => {
      this.roleChangeCallbacks.delete(callback);
    };
  }

  /**
   * Register leader change callback
   */
  onLeaderChange(callback: LeaderChangeCallback): () => void {
    this.leaderChangeCallbacks.add(callback);
    return () => {
      this.leaderChangeCallbacks.delete(callback);
    };
  }

  /**
   * Register conflict detected callback
   */
  onConflictDetected(callback: ConflictDetectedCallback): () => void {
    this.conflictCallbacks.add(callback);
    return () => {
      this.conflictCallbacks.delete(callback);
    };
  }

  /**
   * Detect and notify conflict
   */
  detectConflict(localHeight: number, leaderHeight: number, finalizedHeight: number): void {
    // Check if local height is higher but on different fork
    if (localHeight > leaderHeight && this.role === "FOLLOWER") {
      this.conflictCallbacks.forEach(cb => {
        try {
          cb(localHeight, leaderHeight, finalizedHeight);
        } catch (error) {
          console.error("[LocalInstance] Conflict callback error:", error);
        }
      });
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    
    this.roleChangeCallbacks.clear();
    this.leaderChangeCallbacks.clear();
    this.conflictCallbacks.clear();
  }
}

// Global instance
let globalLocalInstanceCoordinator: LocalInstanceCoordinator | null = null;

/**
 * Get or create global LocalInstanceCoordinator
 */
export function getLocalInstanceCoordinator(): LocalInstanceCoordinator {
  if (!globalLocalInstanceCoordinator) {
    globalLocalInstanceCoordinator = new LocalInstanceCoordinator();
  }
  return globalLocalInstanceCoordinator;
}

