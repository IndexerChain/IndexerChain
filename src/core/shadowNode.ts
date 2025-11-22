/**
 * Phase 40: Shadow Node Client - Browser-side Shadow Node integration
 * 
 * This client connects to the Shadow Node (running in Cloudflare Worker)
 * to maintain persistent connection even when browser is locked/suspended.
 * 
 * Features:
 * - Automatic session creation and persistence
 * - WebSocket connection to Shadow Node
 * - State synchronization when browser reconnects
 * - Automatic recovery from lock screen
 */

import { logger } from "./logger.js";
import type { Block, SnapshotMeta } from "./types.js";

export interface ShadowState {
  latestHeight: number;
  latestHeader: Block | null;
  latestHeaderHash: string;
  recentHeaders: Block[];
  latestSnapshotMeta: SnapshotMeta | null;
  stateCommitment: string | null;
  finalizedHeight: number;
  lastUpdated: number;
}

export interface ShadowNodeConfig {
  shadowNodeUrl: string; // e.g., "https://shadow.indexerchain.com"
  sessionId?: string; // Optional: use existing session
  nodeId: string;
  autoReconnect?: boolean; // default true
  reconnectInterval?: number; // default 5000ms
}

/**
 * Shadow Node Client
 * Manages connection to Shadow Node and state synchronization
 */
export class ShadowNodeClient {
  private config: ShadowNodeConfig;
  private sessionId: string | null = null;
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  private reconnectTimer: number | null = null;
  private cachedState: ShadowState | null = null;
  private stateUpdateHandlers: Set<(state: ShadowState) => void> = new Set();
  private connectionHandlers: Set<(connected: boolean) => void> = new Set();
  private activeMinerId: string | null = null; // Phase 41: Track active miner
  private activeMinerHandlers: Set<(activeMinerId: string | null) => void> = new Set(); // Phase 41: Active miner change handlers
  // Guard: allow disabling downstream state application while mining single-node
  private downstreamDisabled: boolean = false;

  constructor(config: ShadowNodeConfig) {
    this.config = {
      autoReconnect: true,
      reconnectInterval: 5000,
      ...config,
    };
    
    // Load sessionId from localStorage if not provided
    if (!this.config.sessionId) {
      const saved = localStorage.getItem('indexerchain_shadow_session');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          this.config.sessionId = parsed.sessionId;
          this.sessionId = parsed.sessionId;
        } catch (e) {
          // Ignore parse errors
        }
      }
    } else {
      this.sessionId = this.config.sessionId;
    }
  }

  /**
   * Initialize shadow session
   */
  async initialize(): Promise<boolean> {
    try {
      // Generate sessionId if not exists
      if (!this.sessionId) {
        this.sessionId = this.generateSessionId();
        this.config.sessionId = this.sessionId;
        
        // Save to localStorage
        localStorage.setItem('indexerchain_shadow_session', JSON.stringify({
          sessionId: this.sessionId,
          nodeId: this.config.nodeId,
          createdAt: Date.now(),
        }));
      }

      // Initialize session on Shadow Node
      const response = await fetch(`${this.config.shadowNodeUrl}/init?sessionId=${this.sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          nodeId: this.config.nodeId,
        }),
      });

      // Handle 503 (Service Unavailable) gracefully - Shadow Node may not be deployed yet
      if (response.status === 503) {
        logger.warn(`[ShadowNode] Shadow Node service unavailable (503) - this is normal if Shadow Node is not deployed yet`);
        return false;
      }

      if (!response.ok) {
        // For other errors, log but don't throw - Shadow Node is optional
        logger.warn(`[ShadowNode] Failed to initialize shadow session: ${response.status} ${response.statusText}`);
        return false;
      }

      const data = await response.json();
      if (data.success) {
        this.cachedState = data.cachedState;
        logger.debug(`[ShadowNode] Session initialized: ${this.sessionId.substring(0, 16)}...`);
        
        // Connect WebSocket
        await this.connect();
        
        return true;
      } else {
        logger.warn(`[ShadowNode] Shadow session initialization returned error: ${data.error || 'Unknown error'}`);
        return false;
      }
    } catch (error) {
      // Network errors, CORS errors, etc. - Shadow Node is optional, so just log and return false
      logger.warn(`[ShadowNode] Initialization failed (non-critical):`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Connect WebSocket to Shadow Node
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.ws) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${this.config.shadowNodeUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/shadow/${this.sessionId}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          logger.debug(`[ShadowNode] Connected to shadow node`);
          this.isConnected = true;
          this.notifyConnectionHandlers(true);
          
          // Request latest state
          this.requestSync();
          
          // Start heartbeat
          this.startHeartbeat();
          
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (error) {
            logger.error(`[ShadowNode] Failed to parse message:`, error);
          }
        };

        this.ws.onerror = (error) => {
          logger.error(`[ShadowNode] WebSocket error:`, error);
          this.isConnected = false;
          this.notifyConnectionHandlers(false);
          
          if (this.config.autoReconnect) {
            this.scheduleReconnect();
          }
          
          reject(error);
        };

        this.ws.onclose = () => {
          logger.warn(`[ShadowNode] WebSocket closed`);
          this.isConnected = false;
          this.notifyConnectionHandlers(false);
          
          if (this.config.autoReconnect) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        logger.error(`[ShadowNode] Connection failed:`, error);
        reject(error);
      }
    });
  }

  /**
   * Handle messages from Shadow Node
   */
  private handleMessage(data: any) {
    if (data.type === 'SHADOW_CONNECTED') {
      logger.debug(`[ShadowNode] Shadow node confirmed connection`);
      if (data.cachedState) {
        if (!this.downstreamDisabled) {
          this.cachedState = data.cachedState;
          if (this.cachedState) {
            this.notifyStateUpdateHandlers(this.cachedState);
          }
        }
      }
    } else if (data.type === 'SHADOW_STATE_UPDATE') {
      // Shadow Node received new state from signaling server
      if (data.state) {
        if (!this.downstreamDisabled) {
          this.cachedState = data.state;
          if (this.cachedState) {
            this.notifyStateUpdateHandlers(this.cachedState);
            logger.debug(`[ShadowNode] State updated: height=${data.state.latestHeight}`);
          }
        }
      }
    } else if (data.type === 'SYNC_RESPONSE') {
      // Response to sync request
      if (data.cachedState) {
        if (!this.downstreamDisabled) {
          this.cachedState = data.cachedState;
          if (this.cachedState) {
            this.notifyStateUpdateHandlers(this.cachedState);
          }
        }
      }
    } else if (data.type === 'PONG') {
      // Heartbeat response
      // Nothing to do
    } else if (data.type === 'ACTIVE_MINER_CHANGED') {
      // Phase 41: Active miner changed
      this.activeMinerId = data.activeMinerId || null;
      this.notifyActiveMinerHandlers(this.activeMinerId);
      logger.info(`[ShadowNode] Active miner changed: ${this.activeMinerId || 'none'}`);
    }
  }

  /**
   * Request latest state from Shadow Node
   */
  requestSync(): void {
    if (this.downstreamDisabled) return; // Skip requesting downstream state while disabled
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'SYNC_REQUEST',
      }));
    }
  }

  /**
   * Send root tip update to Shadow Node (when browser receives it)
   */
  sendRootTipUpdate(rootTip: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'ROOT_TIP_UPDATE',
        rootTip: rootTip,
      }));
    }
  }

  /** Enable/disable downstream state application */
  setDownstreamSyncEnabled(enabled: boolean): void {
    this.downstreamDisabled = !enabled;
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat() {
    const heartbeat = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'PING',
          timestamp: Date.now(),
        }));
      }
    };
    
    // Send heartbeat every 30 seconds
    setInterval(heartbeat, 30000);
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.reconnectTimer = window.setTimeout(() => {
      logger.info(`[ShadowNode] Attempting to reconnect...`);
      this.connect().catch((error) => {
        logger.error(`[ShadowNode] Reconnection failed:`, error);
        this.scheduleReconnect();
      });
    }, this.config.reconnectInterval || 5000);
  }

  /**
   * Get cached state
   */
  getCachedState(): ShadowState | null {
    return this.cachedState;
  }

  /**
   * Register state update handler
   */
  onStateUpdate(handler: (state: ShadowState) => void): () => void {
    this.stateUpdateHandlers.add(handler);
    
    // Return unsubscribe function
    return () => {
      this.stateUpdateHandlers.delete(handler);
    };
  }

  /**
   * Register connection handler
   */
  onConnectionChange(handler: (connected: boolean) => void): () => void {
    this.connectionHandlers.add(handler);
    
    // Return unsubscribe function
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }

  /**
   * Notify state update handlers
   */
  private notifyStateUpdateHandlers(state: ShadowState) {
    this.stateUpdateHandlers.forEach((handler) => {
      try {
        handler(state);
      } catch (error) {
        logger.error(`[ShadowNode] State update handler error:`, error);
      }
    });
  }

  /**
   * Notify connection handlers
   */
  private notifyConnectionHandlers(connected: boolean) {
    this.connectionHandlers.forEach((handler) => {
      try {
        handler(connected);
      } catch (error) {
        logger.error(`[ShadowNode] Connection handler error:`, error);
      }
    });
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    const random = () => Math.random().toString(36).substring(2);
    return `${Date.now()}-${random()}-${random()}`;
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
    this.notifyConnectionHandlers(false);
  }

  /**
   * Check if connected
   */
  getConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Helper method to safely parse JSON response
   */
  private async safeParseJsonResponse(response: Response): Promise<any> {
    const contentType = response.headers.get('content-type');
    const text = await response.text();
    
    // If content type is not JSON or response is empty, return null
    if (!contentType || !contentType.includes('application/json')) {
      // If it's a plain text error message, return it
      if (text && text.trim()) {
        return { error: text.trim() };
      }
      return null;
    }
    
    // Try to parse as JSON
    try {
      return JSON.parse(text);
    } catch (e) {
      // If parsing fails, return the text as error
      return { error: text.trim() || 'Invalid response format' };
    }
  }

  /**
   * Phase 41: Claim active miner status
   */
  async claimActiveMiner(nodeId: string): Promise<{ success: boolean; error?: string; activeMinerId?: string }> {
    if (!this.sessionId) {
      return { success: false, error: "Session not initialized" };
    }

    try {
      const response = await fetch(`${this.config.shadowNodeUrl}/setActiveMiner?sessionId=${this.sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nodeId,
          action: 'claim',
        }),
      });

      // Handle 503 Service Unavailable or other server errors
      if (response.status === 503) {
        const data = await this.safeParseJsonResponse(response);
        const errorMsg = data?.error || 'Service temporarily unavailable. Please try again later.';
        return { success: false, error: errorMsg };
      }

      if (response.status === 409) {
        // Conflict - another miner is active
        const data = await this.safeParseJsonResponse(response);
        return { 
          success: false, 
          error: data?.error || 'Another device is already mining', 
          activeMinerId: data?.activeMinerId 
        };
      }

      if (!response.ok) {
        const data = await this.safeParseJsonResponse(response);
        const errorMsg = data?.error || `Failed to claim active miner (status: ${response.status})`;
        return { success: false, error: errorMsg };
      }

      const data = await this.safeParseJsonResponse(response);
      if (!data) {
        return { success: false, error: 'Invalid response from server' };
      }

      this.activeMinerId = data.activeMinerId || null;
      this.notifyActiveMinerHandlers(this.activeMinerId);
      return { success: true };
    } catch (error) {
      // Handle network errors, CORS errors, etc.
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Check if it's a CORS error
      if (errorMessage.includes('CORS') || errorMessage.includes('fetch')) {
        logger.warn(`[ShadowNode] CORS or network error when claiming active miner:`, error);
        return { 
          success: false, 
          error: 'Network error: Unable to connect to server. Please check your connection.' 
        };
      }
      
      logger.error(`[ShadowNode] Failed to claim active miner:`, error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Phase 41: Release active miner status
   */
  async releaseActiveMiner(nodeId: string): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    try {
      await fetch(`${this.config.shadowNodeUrl}/setActiveMiner?sessionId=${this.sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nodeId,
          action: 'release',
        }),
      });

      this.activeMinerId = null;
      this.notifyActiveMinerHandlers(null);
    } catch (error) {
      logger.error(`[ShadowNode] Failed to release active miner:`, error);
    }
  }

  /**
   * Phase 41: Send heartbeat for active miner
   */
  async heartbeatActiveMiner(nodeId: string): Promise<void> {
    if (!this.sessionId || this.activeMinerId !== nodeId) {
      return;
    }

    try {
      await fetch(`${this.config.shadowNodeUrl}/setActiveMiner?sessionId=${this.sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nodeId,
          action: 'heartbeat',
        }),
      });
    } catch (error) {
      // Ignore heartbeat errors - they're not critical
    }
  }

  /**
   * Phase 41: Get active miner ID
   */
  getActiveMinerId(): string | null {
    return this.activeMinerId;
  }

  /**
   * Phase 41: Register active miner change handler
   */
  onActiveMinerChange(handler: (activeMinerId: string | null) => void): () => void {
    this.activeMinerHandlers.add(handler);
    
    // Return unsubscribe function
    return () => {
      this.activeMinerHandlers.delete(handler);
    };
  }

  /**
   * Phase 41: Notify active miner handlers
   */
  private notifyActiveMinerHandlers(activeMinerId: string | null) {
    this.activeMinerHandlers.forEach((handler) => {
      try {
        handler(activeMinerId);
      } catch (error) {
        logger.error(`[ShadowNode] Active miner handler error:`, error);
      }
    });
  }
}

