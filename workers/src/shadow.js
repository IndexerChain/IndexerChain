/**
 * Phase 40: Shadow Node - Mobile Persistent Connection Architecture
 * 
 * Shadow Node runs in Cloudflare Worker and maintains persistent connection
 * even when mobile browser is locked/suspended.
 * 
 * Responsibilities:
 * - Keep WebSocket connection alive (never disconnect)
 * - Receive ROOT_TIP_UPDATE from signaling server
 * - Maintain session persistence
 * - Cache latest rootTip, headers, state commitments
 * - Sync state to browser when it reconnects
 */

/**
 * Shadow Session Durable Object
 * Each browser node has one shadow session
 */
export class ShadowSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessionId = null;
    this.nodeId = null;
    this.ws = null;
    this.isConnected = false;
    
    // Cached state (latest from signaling server)
    this.cachedState = {
      latestHeight: 0,
      latestHeader: null,
      latestHeaderHash: "",
      recentHeaders: [],
      latestSnapshotMeta: null,
      stateCommitment: null,
      finalizedHeight: 0,
      lastUpdated: 0,
    };
    
    // Phase 41: Active miner tracking
    this.activeMinerId = null; // nodeId of the device currently mining
    this.activeMinerLastSeen = 0; // timestamp when active miner was last seen
    
    // Heartbeat tracking
    this.lastHeartbeat = Date.now();
    this.heartbeatInterval = null;
    
    // Browser connection (when browser is active)
    this.browserWs = null;
  }

  /**
   * Load session from persistent storage
   */
  async loadSession() {
    try {
      const stored = await this.state.storage.get('session');
      if (stored) {
        this.sessionId = stored.sessionId;
        this.nodeId = stored.nodeId;
        this.cachedState = stored.cachedState || this.cachedState;
        this.activeMinerId = stored.activeMinerId || null;
        this.activeMinerLastSeen = stored.activeMinerLastSeen || 0;
        console.log(`[ShadowSession] Loaded session: ${this.sessionId?.substring(0, 16)}...`);
        return true;
      }
    } catch (error) {
      console.error(`[ShadowSession] Failed to load session:`, error);
    }
    return false;
  }

  /**
   * Save session to persistent storage
   */
  async saveSession() {
    try {
      await this.state.storage.put('session', {
        sessionId: this.sessionId,
        nodeId: this.nodeId,
        cachedState: this.cachedState,
        activeMinerId: this.activeMinerId,
        activeMinerLastSeen: this.activeMinerLastSeen,
        lastUpdated: Date.now(),
      });
    } catch (error) {
      console.error(`[ShadowSession] Failed to save session:`, error);
    }
  }

  /**
   * Phase 45: Reset shadow state to new genesis
   * This clears all cached state and resets to height 0
   */
  async resetShadowState() {
    console.log(`[ShadowSession] 🔄 Resetting shadow state to new genesis`);
    
    // Reset cached state to genesis
    this.cachedState = {
      latestHeight: 0,
      latestHeader: null,
      latestHeaderHash: "",
      recentHeaders: [],
      latestSnapshotMeta: null,
      stateCommitment: null,
      finalizedHeight: 0,
      lastUpdated: Date.now(),
    };
    
    // Clear active miner (new chain, no active miner)
    this.activeMinerId = null;
    this.activeMinerLastSeen = 0;
    
    // Clear persistent storage
    try {
      await this.state.storage.delete('height');
      await this.state.storage.delete('tipHash');
      await this.state.storage.delete('stateCommitment');
      await this.state.storage.delete('snapshotMeta');
      await this.state.storage.delete('recentHeaders');
      await this.state.storage.delete('activeMinerId');
      
      // Save reset state
      await this.saveSession();
      
      console.log(`[ShadowSession] ✅ Shadow state reset complete`);
    } catch (error) {
      console.error(`[ShadowSession] Failed to reset shadow state:`, error);
      throw error;
    }
  }

  /**
   * Connect to signaling server as shadow node
   */
  async connectToSignaling() {
    if (this.isConnected) {
      return;
    }

    const signalingUrl = this.env.SIGNALING_URL || 'wss://signal.indexerchain.com';
    
    try {
      // Create WebSocket connection to signaling server
      // Note: In Cloudflare Workers, we need to use fetch with upgrade header
      // For now, we'll use a different approach - connect via the signaling room
      
      console.log(`[ShadowSession] Connecting to signaling server for session ${this.sessionId?.substring(0, 16)}...`);
      
      // We'll maintain connection through periodic pings
      this.startHeartbeat();
      this.isConnected = true;
    } catch (error) {
      console.error(`[ShadowSession] Failed to connect to signaling:`, error);
      this.isConnected = false;
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(() => {
      this.lastHeartbeat = Date.now();
      
      // Ping signaling server to maintain connection
      // This will be handled by the main signaling room
      this.pingSignaling();
    }, 30000); // Every 30 seconds
  }

  /**
   * Ping signaling server
   */
  async pingSignaling() {
    // This will be handled by forwarding to the signaling room
    // For now, we just update last heartbeat
    this.lastHeartbeat = Date.now();
  }

  /**
   * Update cached state from ROOT_TIP_UPDATE
   */
  updateCachedState(rootTip) {
    if (!rootTip) return;
    
    this.cachedState = {
      latestHeight: rootTip.latestHeight || this.cachedState.latestHeight,
      latestHeader: rootTip.latestHeader || this.cachedState.latestHeader,
      latestHeaderHash: rootTip.latestHeaderHash || this.cachedState.latestHeaderHash,
      recentHeaders: rootTip.recentHeaders || this.cachedState.recentHeaders,
      latestSnapshotMeta: rootTip.latestSnapshotMeta || this.cachedState.latestSnapshotMeta,
      stateCommitment: rootTip.stateCommitment || this.cachedState.stateCommitment,
      finalizedHeight: rootTip.finalizedHeight || this.cachedState.finalizedHeight,
      lastUpdated: Date.now(),
    };
    
    // Save to storage
    this.saveSession();
    
    // Forward to browser if connected
    if (this.browserWs && this.browserWs.readyState === WebSocket.READY_STATE_OPEN) {
      this.browserWs.send(JSON.stringify({
        type: 'SHADOW_STATE_UPDATE',
        state: this.cachedState,
      }));
    }
  }

  /**
   * Handle WebSocket connection from browser
   */
  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    
    // Handle WebSocket upgrade requests
    if (upgradeHeader === 'websocket') {
      return this.handleBrowserConnection(request);
    }
    
    // Handle HTTP requests
    const url = new URL(request.url);
    
    // Extract path after /shadow/{sessionId} if present
    let path = url.pathname;
    if (path.startsWith('/shadow/')) {
      const parts = path.split('/');
      // Remove /shadow/{sessionId} prefix
      path = '/' + parts.slice(3).join('/') || '/';
    }
    
    if (path === '/init' && request.method === 'POST') {
      return this.handleInit(request);
    }
    
    if (path === '/sync' && request.method === 'GET') {
      return this.handleSync(request);
    }
    
    if (path === '/ping' && request.method === 'POST') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        lastHeartbeat: this.lastHeartbeat,
        cachedState: this.cachedState,
        activeMinerId: this.activeMinerId, // Phase 41: Return active miner info
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
    // Phase 41: Handle active miner management
    if (path === '/setActiveMiner' && request.method === 'POST') {
      return this.handleSetActiveMiner(request);
    }
    
    if (path === '/getActiveMiner' && request.method === 'GET') {
      return new Response(JSON.stringify({
        activeMinerId: this.activeMinerId,
        activeMinerLastSeen: this.activeMinerLastSeen,
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
    // Phase 45: Handle shadow state reset
    if (path === '/reset' && request.method === 'POST') {
      try {
        await this.resetShadowState();
        return new Response(JSON.stringify({
          success: true,
          message: 'Shadow state reset to genesis',
        }), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message,
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }
    
    // If path is just /shadow/{sessionId} or /, it's a WebSocket connection attempt
    if ((path === '/' || path === '') && upgradeHeader !== 'websocket') {
      return new Response(JSON.stringify({ 
        service: 'Shadow Session',
        sessionId: this.sessionId?.substring(0, 16) + '...',
        status: 'ready',
        usage: 'Connect via WebSocket or POST /init',
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
    return new Response('Not Found', { 
      status: 404,
      headers: { 
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  /**
   * Initialize shadow session
   */
  async handleInit(request) {
    try {
      const data = await request.json();
      const { sessionId, nodeId } = data;
      
      if (!sessionId || !nodeId) {
      return new Response(JSON.stringify({ error: 'Missing sessionId or nodeId' }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
      }
      
      this.sessionId = sessionId;
      this.nodeId = nodeId;
      
      // Load existing session if available
      await this.loadSession();
      
      // Connect to signaling server
      await this.connectToSignaling();
      
      // Save session
      await this.saveSession();
      
      return new Response(JSON.stringify({
        success: true,
        sessionId: this.sessionId,
        cachedState: this.cachedState,
        activeMinerId: this.activeMinerId, // Phase 41: Return active miner info
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      console.error(`[ShadowSession] Init error:`, error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  /**
   * Handle sync request (browser wants latest state)
   */
  async handleSync(request) {
    return new Response(JSON.stringify({
      success: true,
      cachedState: this.cachedState,
      lastHeartbeat: this.lastHeartbeat,
      isConnected: this.isConnected,
      activeMinerId: this.activeMinerId, // Phase 41: Return active miner info
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  /**
   * Phase 41: Handle active miner management
   * Actions: 'claim', 'release', 'heartbeat'
   */
  async handleSetActiveMiner(request) {
    try {
      const data = await request.json();
      const { nodeId, action } = data;
      
      if (!nodeId || !action) {
        return new Response(JSON.stringify({ 
          error: 'Missing nodeId or action' 
        }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      
      if (action === 'claim') {
        // Check if another miner is already active
        if (this.activeMinerId && this.activeMinerId !== nodeId) {
          return new Response(JSON.stringify({ 
            error: 'Another device is already mining',
            activeMinerId: this.activeMinerId,
          }), {
            status: 409, // Conflict
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
        
        // Claim active miner status
        this.activeMinerId = nodeId;
        this.activeMinerLastSeen = Date.now();
        await this.saveSession();
        
        return new Response(JSON.stringify({ 
          success: true,
          activeMinerId: this.activeMinerId,
        }), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } else if (action === 'release') {
        // Release active miner status (only if we are the active miner)
        if (this.activeMinerId === nodeId) {
          this.activeMinerId = null;
          this.activeMinerLastSeen = 0;
          await this.saveSession();
        }
        
        return new Response(JSON.stringify({ 
          success: true,
        }), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } else if (action === 'heartbeat') {
        // Update last seen time for active miner
        if (this.activeMinerId === nodeId) {
          this.activeMinerLastSeen = Date.now();
          await this.saveSession();
        }
        
        return new Response(JSON.stringify({ 
          success: true,
        }), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } else {
        return new Response(JSON.stringify({ 
          error: `Unknown action: ${action}` 
        }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    } catch (error) {
      console.error(`[ShadowSession] Error handling setActiveMiner:`, error);
      return new Response(JSON.stringify({ 
        error: error.message || 'Internal server error' 
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  /**
   * Handle WebSocket connection from browser
   */
  async handleBrowserConnection(request) {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    
    this.browserWs = server;
    
    // Handle messages from browser
    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'SYNC_REQUEST') {
          // Browser wants latest state
          server.send(JSON.stringify({
            type: 'SYNC_RESPONSE',
            cachedState: this.cachedState,
            lastHeartbeat: this.lastHeartbeat,
          }));
        } else if (data.type === 'PING') {
          // Heartbeat from browser
          server.send(JSON.stringify({
            type: 'PONG',
            timestamp: Date.now(),
          }));
        } else if (data.type === 'ROOT_TIP_UPDATE') {
          // Browser received new root tip, update cache
          this.updateCachedState(data.rootTip);
        }
      } catch (error) {
        console.error(`[ShadowSession] Error handling browser message:`, error);
      }
    });
    
    server.addEventListener('close', () => {
      this.browserWs = null;
      console.log(`[ShadowSession] Browser disconnected`);
    });
    
    // Send initial state to browser
    server.send(JSON.stringify({
      type: 'SHADOW_CONNECTED',
      cachedState: this.cachedState,
    }));
    
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

/**
 * Shadow Node Worker
 * Routes requests to ShadowSession Durable Objects
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }
    
    // Extract sessionId from path or query
    let sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId && url.pathname.startsWith('/shadow/')) {
      // Extract from path: /shadow/{sessionId}/...
      const parts = url.pathname.split('/');
      sessionId = parts[2];
    }
    
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Missing sessionId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Get or create ShadowSession Durable Object
    const sessionIdObj = env.SHADOW_SESSION.idFromName(sessionId);
    const session = env.SHADOW_SESSION.get(sessionIdObj);
    
    // Forward request to session
    return session.fetch(request);
  },
};

