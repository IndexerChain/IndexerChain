/**
 * Phase 40: Connection Manager - Never Disconnect Architecture
 * 
 * Manages persistent connections with automatic reconnection:
 * - WebSocket signaling server auto-reconnect
 * - Session ID persistence
 * - Peer heartbeat monitoring
 * - Connection state recovery
 */

import { logger } from "./logger.js";

export interface ConnectionConfig {
  bootstrapUrl: string;
  reconnectInterval?: number; // ms, default 1500
  maxReconnectAttempts?: number; // -1 for infinite, default -1
  heartbeatInterval?: number; // ms, default 10000
  heartbeatTimeout?: number; // ms, default 30000
  enableSessionPersistence?: boolean; // default true
}

export interface SessionInfo {
  sessionId: string;
  nodeId: string;
  lastConnectedAt: number;
  reconnectCount: number;
}

/**
 * Connection Manager for persistent P2P connections
 */
export class ConnectionManager {
  private config: ConnectionConfig;
  private sessionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private isReconnecting: boolean = false;
  private onReconnectCallback: (() => Promise<void>) | null = null;
  private heartbeatTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private missedHeartbeats: Map<string, number> = new Map();
  private onPeerHeartbeatFailure: ((peerId: string) => void) | null = null;

  constructor(config: ConnectionConfig) {
    this.config = {
      reconnectInterval: 1500,
      maxReconnectAttempts: -1, // Infinite by default
      heartbeatInterval: 10000, // 10 seconds
      heartbeatTimeout: 30000, // 30 seconds
      enableSessionPersistence: true,
      ...config,
    };

    // Load or create session ID
    if (this.config.enableSessionPersistence) {
      this.loadSession();
    }
  }

  /**
   * Load or create session ID
   */
  private loadSession(): void {
    try {
      const saved = localStorage.getItem("indexerchain_session");
      if (saved) {
        const session: SessionInfo = JSON.parse(saved);
        this.sessionId = session.sessionId;
        logger.debug(`[ConnectionManager] Loaded session: ${this.sessionId.substring(0, 16)}...`);
      } else {
        this.createNewSession();
      }
    } catch (error) {
      logger.warn("[ConnectionManager] Failed to load session, creating new one:", error);
      this.createNewSession();
    }
  }

  /**
   * Create new session ID
   */
  private createNewSession(): void {
    // Generate UUID v4
    this.sessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    
    this.saveSession();
    logger.debug(`[ConnectionManager] Created new session: ${this.sessionId.substring(0, 16)}...`);
  }

  /**
   * Save session to localStorage
   */
  private saveSession(nodeId?: string): void {
    if (!this.sessionId) return;
    
    try {
      const session: SessionInfo = {
        sessionId: this.sessionId,
        nodeId: nodeId || "",
        lastConnectedAt: Date.now(),
        reconnectCount: this.reconnectAttempts,
      };
      localStorage.setItem("indexerchain_session", JSON.stringify(session));
    } catch (error) {
      logger.warn("[ConnectionManager] Failed to save session:", error);
    }
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Setup automatic reconnection for WebSocket
   */
  setupAutoReconnect(
    connectFn: () => Promise<void>,
    onReconnect?: () => Promise<void>
  ): void {
    this.onReconnectCallback = onReconnect || null;

    // This will be called when connection is lost
    const attemptReconnect = async () => {
      if (this.isReconnecting) return;
      
      // Check max attempts
      const maxAttempts = this.config.maxReconnectAttempts ?? -1;
      if (maxAttempts !== -1 && 
          this.reconnectAttempts >= maxAttempts) {
        logger.error(`[ConnectionManager] Max reconnect attempts (${maxAttempts}) reached`);
        return;
      }

      this.isReconnecting = true;
      this.reconnectAttempts++;

      logger.info(`[ConnectionManager] Attempting reconnect #${this.reconnectAttempts}...`);

      try {
        await connectFn();
        
        // Success - reset counters
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        // Call reconnect callback
        if (this.onReconnectCallback) {
          await this.onReconnectCallback();
        }

        logger.info(`[ConnectionManager] Reconnected successfully`);
      } catch (error) {
        logger.warn(`[ConnectionManager] Reconnect attempt ${this.reconnectAttempts} failed:`, error);
        this.isReconnecting = false;
        
        // Schedule next reconnect
        this.reconnectTimer = setTimeout(
          attemptReconnect,
          this.config.reconnectInterval || 1500
        );
      }
    };

    // Store reconnect function for external use
    (this as any).attemptReconnect = attemptReconnect;
  }

  /**
   * Start reconnection attempt
   */
  startReconnect(): void {
    if ((this as any).attemptReconnect) {
      (this as any).attemptReconnect();
    }
  }

  /**
   * Stop reconnection attempts
   */
  stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Setup heartbeat monitoring for a peer
   */
  setupPeerHeartbeat(
    peerId: string,
    sendPingFn: () => void,
    onFailure?: (peerId: string) => void
  ): void {
    // Clear existing heartbeat if any
    this.clearPeerHeartbeat(peerId);

    this.onPeerHeartbeatFailure = onFailure || null;
    this.missedHeartbeats.set(peerId, 0);

    const interval = setInterval(() => {
      try {
        sendPingFn();
        logger.debug(`[ConnectionManager] Sent heartbeat to peer ${peerId.substring(0, 16)}...`);
      } catch (error) {
        logger.warn(`[ConnectionManager] Failed to send heartbeat to ${peerId.substring(0, 16)}...:`, error);
        // Record missed heartbeat on error
        this.recordMissedHeartbeat(peerId);
      }
    }, this.config.heartbeatInterval || 10000);

    this.heartbeatTimers.set(peerId, interval);
  }

  /**
   * Record successful heartbeat response
   */
  recordHeartbeatResponse(peerId: string): void {
    this.missedHeartbeats.set(peerId, 0);
  }

  /**
   * Record missed heartbeat
   */
  recordMissedHeartbeat(peerId: string): void {
    const missed = (this.missedHeartbeats.get(peerId) || 0) + 1;
    this.missedHeartbeats.set(peerId, missed);

    if (missed >= 3) { // 3 missed heartbeats = peer is dead
      logger.warn(`[ConnectionManager] Peer ${peerId.substring(0, 16)}... missed ${missed} heartbeats, marking as failed`);
      
      if (this.onPeerHeartbeatFailure) {
        this.onPeerHeartbeatFailure(peerId);
      }
    }
  }

  /**
   * Clear heartbeat monitoring for a peer
   */
  clearPeerHeartbeat(peerId: string): void {
    const timer = this.heartbeatTimers.get(peerId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(peerId);
    }
    this.missedHeartbeats.delete(peerId);
  }

  /**
   * Clear all heartbeats
   */
  clearAllHeartbeats(): void {
    for (const [, timer] of this.heartbeatTimers.entries()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();
    this.missedHeartbeats.clear();
  }

  /**
   * Update session with node ID
   */
  updateSession(nodeId: string): void {
    this.saveSession(nodeId);
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    sessionId: string | null;
    reconnectAttempts: number;
    isReconnecting: boolean;
    activeHeartbeats: number;
  } {
    return {
      sessionId: this.sessionId,
      reconnectAttempts: this.reconnectAttempts,
      isReconnecting: this.isReconnecting,
      activeHeartbeats: this.heartbeatTimers.size,
    };
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopReconnect();
    this.clearAllHeartbeats();
  }
}

