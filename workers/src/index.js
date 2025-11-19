/**
 * IndexerChain Signaling Server (Cloudflare Worker)
 * 
 * WebSocket-based signaling server for IndexerChain P2P networking.
 * This worker handles WebRTC signaling between browser nodes.
 * 
 * Uses Durable Objects to maintain shared state across all worker instances.
 * 
 * Phase 40: Added Shadow Node support for mobile persistence
 */

// Phase 40: Import Shadow Node
import { ShadowSession } from './shadow.js';

/**
 * Durable Object for managing signaling room state
 * This ensures all worker instances share the same peer list
 */
export class SignalingRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.peers = new Map();
    // Phase 33: Track IP hashes for all peers
    this.peerIPHashes = new Map(); // Map<nodeId, ipHash>
    this.bootstrapState = {
      latestHeight: 0,
      latestHeader: null,
      latestHeaderHash: "",
      recentHeaders: [],
      latestSnapshotMeta: null,
      lastUpdated: 0,
      stateCommitment: null, // Phase 37: Store state commitment for verification
      trustLevel: 'root-only', // Phase 37: Trust level: 'root-only', 'local-majority', 'stale'
    };
    this.initialized = false;
  }

  /**
   * Phase 37: Load rootTip from persistent storage
   */
  async loadRootTip() {
    try {
      const stored = await this.state.storage.get('rootTip');
      if (stored) {
        console.log(`[SignalingRoom] Loaded rootTip from storage: height=${stored.latestHeight}, updatedAt=${new Date(stored.lastUpdated).toISOString()}`);
        this.bootstrapState = {
          ...this.bootstrapState,
          ...stored,
          // Ensure arrays are properly initialized
          recentHeaders: stored.recentHeaders || [],
        };
        return true;
      }
    } catch (error) {
      console.error(`[SignalingRoom] Failed to load rootTip from storage:`, error);
    }
    return false;
  }

  /**
   * Phase 37: Save rootTip to persistent storage
   */
  async saveRootTip() {
    try {
      await this.state.storage.put('rootTip', {
        latestHeight: this.bootstrapState.latestHeight,
        latestHeader: this.bootstrapState.latestHeader,
        latestHeaderHash: this.bootstrapState.latestHeaderHash,
        recentHeaders: this.bootstrapState.recentHeaders.slice(-500), // Phase 38: Save last 500 for fast sync
        latestSnapshotMeta: this.bootstrapState.latestSnapshotMeta,
        lastUpdated: this.bootstrapState.lastUpdated,
        stateCommitment: this.bootstrapState.stateCommitment,
        trustLevel: this.bootstrapState.trustLevel,
      });
      console.log(`[SignalingRoom] Saved rootTip to storage: height=${this.bootstrapState.latestHeight}`);
    } catch (error) {
      console.error(`[SignalingRoom] Failed to save rootTip to storage:`, error);
    }
  }

  async fetch(request) {
    // Phase 37: Load rootTip from storage on first request (lazy initialization)
    if (!this.initialized) {
      await this.loadRootTip();
      this.initialized = true;
    }

    // Handle WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { 
        status: 426,
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
        },
      });
    }

    // Create WebSocket pair
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    let nodeId = null;

    // Handle incoming messages
    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'join' || data.type === 'JOIN') {
          nodeId = data.nodeId;
          this.peers.set(nodeId, server);

          // Generate IP hash
          const clientIP = request.headers.get('CF-Connecting-IP') || 
                          request.headers.get('X-Forwarded-For')?.split(',')[0] || 
                          'unknown';
          
          let ipHash = '';
          for (let i = 0; i < clientIP.length; i++) {
            ipHash += String.fromCharCode((clientIP.charCodeAt(i) * 7 + 13) % 256);
          }
          ipHash = btoa(ipHash).substring(0, 16);

          console.log(`[SignalingRoom] Node ${nodeId.substring(0, 16)}... joined. Total peers: ${this.peers.size}. IP hash: ${ipHash}`);
          
          // Phase 33: Store IP hash for this peer
          this.peerIPHashes.set(nodeId, ipHash);

          // Send list of existing peers to the new node
          const peerList = Array.from(this.peers.keys()).filter((id) => id !== nodeId);
          
          // Phase 33: Build IP hashes object for all existing peers
          const peerIPHashes = {};
          for (const [id, hash] of this.peerIPHashes.entries()) {
            if (id !== nodeId) {
              peerIPHashes[id] = hash;
            }
          }
          
          // Send JOIN_ACK with peers list AND rootTip (even if peers is empty)
          server.send(JSON.stringify({
            type: 'JOIN_ACK',
            peers: peerList,
            ipHash: ipHash,
            peerIPHashes: peerIPHashes, // Phase 33: Include IP hashes for all existing peers
            // Phase 37: Include current rootTip so node can immediately sync
            // Also include trustLevel and stateCommitment for client verification
            rootTip: {
              latestHeight: this.bootstrapState.latestHeight,
              latestHeader: this.bootstrapState.latestHeader,
              latestHeaderHash: this.bootstrapState.latestHeaderHash,
              recentHeaders: this.bootstrapState.recentHeaders.slice(-500), // Phase 38: Last 500 headers for fast sync
              latestSnapshotMeta: this.bootstrapState.latestSnapshotMeta,
              updatedAt: this.bootstrapState.lastUpdated,
              stateCommitment: this.bootstrapState.stateCommitment,
              trustLevel: this.bootstrapState.trustLevel,
              stale: false,
            },
          }));

          // Also send legacy 'peers' message for backward compatibility
          server.send(JSON.stringify({
            type: 'peers',
            peers: peerList,
            ipHash: ipHash,
            peerIPHashes: peerIPHashes, // Phase 33: Include IP hashes for all existing peers
          }));

          // Notify other peers about the new node
          for (const [id, peer] of this.peers.entries()) {
            if (id !== nodeId && peer.readyState === WebSocket.READY_STATE_OPEN) {
              peer.send(JSON.stringify({
                type: 'new-peer',
                peerId: nodeId,
                ipHash: ipHash,
              }));
            }
          }
        } else if (data.type === 'request-peers') {
          const peerList = Array.from(this.peers.keys()).filter((id) => id !== nodeId);
          
          // Phase 33: Build IP hashes object for all peers
          const peerIPHashes = {};
          for (const [id, hash] of this.peerIPHashes.entries()) {
            if (id !== nodeId) {
              peerIPHashes[id] = hash;
            }
          }
          
          // Get IP hash for requesting node
          const requestingNodeIPHash = this.peerIPHashes.get(nodeId) || '';
          
          server.send(JSON.stringify({
            type: 'peers',
            peers: peerList,
            ipHash: requestingNodeIPHash, // Phase 33: Include requesting node's IP hash
            peerIPHashes: peerIPHashes, // Phase 33: Include IP hashes for all peers
          }));
        } else if (data.type === 'REQUEST_BOOTSTRAP') {
          console.log(`[SignalingRoom] Received REQUEST_BOOTSTRAP from ${nodeId?.substring(0, 16)}...`);
          console.log(`[SignalingRoom] Current rootTip: height=${this.bootstrapState.latestHeight}, hasHeader=${!!this.bootstrapState.latestHeader}, hasSnapshot=${!!this.bootstrapState.latestSnapshotMeta}`);
          
          // Phase 37: Always return rootTip, even if latestHeight is 0 (node will handle it)
          // Include trustLevel and stateCommitment for client verification
          const response = {
            type: 'BOOTSTRAP_RESPONSE',
            requestId: data.requestId || `${Date.now()}`,
            latestHeight: this.bootstrapState.latestHeight,
            latestHeader: this.bootstrapState.latestHeader,
            latestHeaderHash: this.bootstrapState.latestHeaderHash,
            recentHeaders: data.wantHeaders ? this.bootstrapState.recentHeaders.slice(-(data.headerCount || 500)) : undefined,
            latestSnapshotMeta: data.wantSnapshotMeta ? this.bootstrapState.latestSnapshotMeta : undefined,
            stateCommitment: this.bootstrapState.stateCommitment,
            trustLevel: this.bootstrapState.trustLevel,
            stale: false, // Phase 37: Can be set to true if rootTip is outdated
            timestamp: Date.now(),
          };
          
          console.log(`[SignalingRoom] Sending BOOTSTRAP_RESPONSE: height=${response.latestHeight}, hasHeader=${!!response.latestHeader}, recentHeaders=${response.recentHeaders?.length || 0}, trustLevel=${response.trustLevel}`);
          server.send(JSON.stringify(response));
        } else if (data.type === 'UPDATE_ROOT_TIP') {
          // Phase 37: Accept both old format (data.header, data.headerHash) and new format (data.payload)
          const payload = data.payload || data;
          const header = payload.header || payload.latestHeader;
          const headerHash = payload.headerHash || payload.latestHeaderHash;
          const height = header?.height || payload.latestHeight;
          const recentHeaders = payload.recentHeaders;
          const snapshotMeta = payload.latestSnapshotMeta || payload.snapshotMeta;
          const stateCommitment = payload.stateCommitment || header?.stateCommitment;
          const finalityCert = payload.finalityCert; // Optional: finality certificate
          
          // Phase 37: Basic validation
          if (!header || !headerHash || !height) {
            console.warn(`[SignalingRoom] Invalid UPDATE_ROOT_TIP: missing header/headerHash/height`);
            return;
          }

          // Phase 37: Verify height is newer
          if (height <= this.bootstrapState.latestHeight) {
            console.log(`[SignalingRoom] Ignoring UPDATE_ROOT_TIP: height ${height} <= current ${this.bootstrapState.latestHeight}`);
            return;
          }

          // Phase 37: Basic sanity checks (can be extended with more validation)
          // For now, we accept any UPDATE_ROOT_TIP with valid structure and newer height
          // In production, you might want to:
          // - Verify stateCommitment matches header.stateCommitment
          // - Check finalityCert if provided
          // - Verify sender is a trusted LEADER node (via peer reputation/IP)
          // - Check that header.prevHash connects to current tip
          
          console.log(`[SignalingRoom] Updating rootTip: ${this.bootstrapState.latestHeight} -> ${height} (from node ${nodeId?.substring(0, 16)}...)`);
          
          this.bootstrapState.latestHeight = height;
          this.bootstrapState.latestHeader = header;
          this.bootstrapState.latestHeaderHash = headerHash;
          this.bootstrapState.lastUpdated = Date.now();
          this.bootstrapState.stateCommitment = stateCommitment || header?.stateCommitment || null;
          this.bootstrapState.trustLevel = 'root-only'; // Phase 37: Default to root-only, can be upgraded to 'local-majority' if verified by multiple peers
          
          // Phase 38: Update recent headers (keep last 500 for faster sync)
          if (recentHeaders && Array.isArray(recentHeaders)) {
            this.bootstrapState.recentHeaders = recentHeaders.slice(-500);
          } else if (header) {
            this.bootstrapState.recentHeaders.push(header);
            if (this.bootstrapState.recentHeaders.length > 500) {
              this.bootstrapState.recentHeaders.shift();
            }
          }
          
          // Update snapshot meta if provided
          if (snapshotMeta) {
            this.bootstrapState.latestSnapshotMeta = snapshotMeta;
          }
          
          // Phase 37: Persist to storage
          await this.saveRootTip();
          
          // Broadcast ROOT_TIP_UPDATE to all connected peers
          const tipUpdate = {
            type: 'ROOT_TIP_UPDATE',
            rootTip: {
              latestHeight: this.bootstrapState.latestHeight,
              latestHeader: this.bootstrapState.latestHeader,
              latestHeaderHash: this.bootstrapState.latestHeaderHash,
              recentHeaders: this.bootstrapState.recentHeaders.slice(-500), // Phase 38: Last 500 for fast sync
              latestSnapshotMeta: this.bootstrapState.latestSnapshotMeta,
              updatedAt: this.bootstrapState.lastUpdated,
              stateCommitment: this.bootstrapState.stateCommitment,
              trustLevel: this.bootstrapState.trustLevel,
            },
            timestamp: Date.now(),
          };
          
          console.log(`[SignalingRoom] Broadcasting ROOT_TIP_UPDATE to ${this.peers.size} peer(s)`);
          for (const [id, peer] of this.peers.entries()) {
            if (peer.readyState === WebSocket.READY_STATE_OPEN) {
              try {
                peer.send(JSON.stringify(tipUpdate));
              } catch (error) {
                console.error(`[SignalingRoom] Failed to send ROOT_TIP_UPDATE to ${id.substring(0, 16)}...:`, error);
              }
            }
          }
        } else if (
          data.type === 'offer' ||
          data.type === 'answer' ||
          data.type === 'ice-candidate'
        ) {
          const target = this.peers.get(data.to);
          if (target && target.readyState === WebSocket.READY_STATE_OPEN) {
            target.send(JSON.stringify({
              ...data,
              from: nodeId,
            }));
          } else {
            console.warn(`[SignalingRoom] Target peer ${data.to?.substring(0, 16)}... not found or not connected`);
          }
        }
      } catch (error) {
        console.error('[SignalingRoom] Error handling message:', error);
        try {
          server.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process message',
          }));
        } catch (e) {
          // Ignore send errors
        }
      }
    });

    // Handle connection close
    server.addEventListener('close', () => {
      if (nodeId) {
        this.peers.delete(nodeId);
        this.peerIPHashes.delete(nodeId); // Phase 33: Remove IP hash when peer disconnects
        console.log(`[SignalingRoom] Node ${nodeId.substring(0, 16)}... disconnected. Total peers: ${this.peers.size}`);

        // Notify other peers
        for (const [id, peer] of this.peers.entries()) {
          if (peer.readyState === WebSocket.READY_STATE_OPEN) {
            peer.send(JSON.stringify({
              type: 'peer-left',
              peerId: nodeId,
            }));
          }
        }
      }
    });

    server.addEventListener('error', (error) => {
      console.error('[SignalingRoom] WebSocket error:', error);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

export { ShadowSession };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Phase 40: Handle Shadow Node routes
    if (url.pathname.startsWith('/shadow/') || url.pathname === '/shadow') {
      // Extract sessionId from path or query
      let sessionId = url.searchParams.get('sessionId');
      
      if (!sessionId && url.pathname.startsWith('/shadow/')) {
        const parts = url.pathname.split('/');
        sessionId = parts[2];
      }
      
      if (!sessionId && url.pathname !== '/shadow') {
        return new Response(JSON.stringify({ error: 'Missing sessionId' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // For /shadow without sessionId, return info
      if (!sessionId) {
        return new Response(JSON.stringify({ 
          service: 'Shadow Node',
          status: 'ready',
          usage: 'POST /shadow/{sessionId}/init to initialize a session',
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Get or create ShadowSession Durable Object
      const sessionIdObj = env.SHADOW_SESSION.idFromName(sessionId);
      const session = env.SHADOW_SESSION.get(sessionIdObj);
      
      // Forward request to session
      return session.fetch(request);
    }

    // Handle keepalive endpoint for PWA persistence
    if (url.pathname === '/keepalive' && request.method === 'POST') {
      return new Response('ok', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

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

    // Get or create the signaling room Durable Object
    // Use a single room ID to ensure all connections share the same state
    const roomId = env.SIGNALING_ROOM.idFromName('main');
    const room = env.SIGNALING_ROOM.get(roomId);

    // Forward the request to the Durable Object
    return room.fetch(request);
  },
};

