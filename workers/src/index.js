/**
 * IndexerChain Signaling Server (Cloudflare Worker)
 * 
 * WebSocket-based signaling server for IndexerChain P2P networking.
 * This worker handles WebRTC signaling between browser nodes.
 * 
 * Uses Durable Objects to maintain shared state across all worker instances.
 */

/**
 * Durable Object for managing signaling room state
 * This ensures all worker instances share the same peer list
 */
export class SignalingRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.peers = new Map();
    this.bootstrapState = {
      latestHeight: 0,
      latestHeader: null,
      latestHeaderHash: "",
      recentHeaders: [],
      latestSnapshotMeta: null,
      lastUpdated: 0,
    };
  }

  async fetch(request) {
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
    server.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'join') {
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

          // Send list of existing peers to the new node
          const peerList = Array.from(this.peers.keys()).filter((id) => id !== nodeId);
          server.send(JSON.stringify({
            type: 'peers',
            peers: peerList,
            ipHash: ipHash,
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
          server.send(JSON.stringify({
            type: 'peers',
            peers: peerList,
          }));
        } else if (data.type === 'REQUEST_BOOTSTRAP') {
          console.log(`[SignalingRoom] Received REQUEST_BOOTSTRAP from ${nodeId?.substring(0, 16)}...`);
          const response = {
            type: 'BOOTSTRAP_RESPONSE',
            requestId: data.requestId || `${Date.now()}`,
            latestHeight: this.bootstrapState.latestHeight,
            latestHeader: this.bootstrapState.latestHeader,
            latestHeaderHash: this.bootstrapState.latestHeaderHash,
            recentHeaders: data.wantHeaders ? this.bootstrapState.recentHeaders.slice(-(data.headerCount || 200)) : undefined,
            latestSnapshotMeta: data.wantSnapshotMeta ? this.bootstrapState.latestSnapshotMeta : undefined,
            timestamp: Date.now(),
          };
          server.send(JSON.stringify(response));
        } else if (data.type === 'UPDATE_ROOT_TIP') {
          if (data.header && data.headerHash) {
            this.bootstrapState.latestHeight = data.header.height || this.bootstrapState.latestHeight;
            this.bootstrapState.latestHeader = data.header;
            this.bootstrapState.latestHeaderHash = data.headerHash;
            this.bootstrapState.lastUpdated = Date.now();
            
            if (this.bootstrapState.latestHeader) {
              this.bootstrapState.recentHeaders.push(this.bootstrapState.latestHeader);
              if (this.bootstrapState.recentHeaders.length > 200) {
                this.bootstrapState.recentHeaders.shift();
              }
            }
            
            // Broadcast to all peers
            const tipUpdate = {
              type: 'ROOT_TIP_UPDATE',
              latestHeight: this.bootstrapState.latestHeight,
              latestHeader: this.bootstrapState.latestHeader,
              latestHeaderHash: this.bootstrapState.latestHeaderHash,
              timestamp: Date.now(),
            };
            
            for (const [id, peer] of this.peers.entries()) {
              if (peer.readyState === WebSocket.READY_STATE_OPEN) {
                peer.send(JSON.stringify(tipUpdate));
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

export default {
  async fetch(request, env, ctx) {
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

