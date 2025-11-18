/**
 * IndexerChain Signaling Server (Cloudflare Worker)
 * 
 * WebSocket-based signaling server for IndexerChain P2P networking.
 * This worker handles WebRTC signaling between browser nodes.
 * 
 * Note: For production, consider using Durable Objects for state persistence.
 */

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

    // Check for WebSocket upgrade
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
    
    // Accept the server WebSocket
    server.accept();
    
    // Store peer connections (in-memory, per worker instance)
    // Note: For production, use Durable Objects for persistent state
    const peers = new Map();
    let nodeId = null;
    
    // Phase 32: Bootstrap state cache (maintained by signal server)
    // In production, this should be stored in Durable Objects or KV
    // For now, we'll use in-memory cache that gets updated by connected nodes
    // NOTE: This is per-worker-instance, so it resets on worker restart
    // For production, use Durable Objects or KV for persistence
    let bootstrapState = {
      latestHeight: 0,
      latestHeader: null,
      latestHeaderHash: "",
      recentHeaders: [], // Last 200 headers
      latestSnapshotMeta: null,
      lastUpdated: 0,
    };
    
    // Log bootstrap state on worker start (for debugging)
    console.log(`[Phase 32] Worker initialized with bootstrap state: height=${bootstrapState.latestHeight}`);
    
    // Phase 32: Initialize bootstrap state from environment or default
    // In production, this would be loaded from KV or Durable Objects
    // For now, we start with empty state and let nodes update it
    // When a node sends UPDATE_ROOT_TIP, we'll update this cache

    // Handle incoming messages
    server.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'join') {
          // Node joining the network
          nodeId = data.nodeId;
          peers.set(nodeId, server);
          
          // Phase 33: Generate IP hash for quorum scoring (privacy-preserving)
          // Get client IP from request headers (Cloudflare provides CF-Connecting-IP)
          const clientIP = request.headers.get('CF-Connecting-IP') || 
                          request.headers.get('X-Forwarded-For')?.split(',')[0] || 
                          'unknown';
          
          // Create privacy-preserving IP hash (simple hash, not cryptographic)
          // In production, use a proper hash function
          let ipHash = '';
          for (let i = 0; i < clientIP.length; i++) {
            ipHash += String.fromCharCode((clientIP.charCodeAt(i) * 7 + 13) % 256);
          }
          ipHash = btoa(ipHash).substring(0, 16); // Base64 encode and take first 16 chars
          
          console.log(`[Signaling] Node ${nodeId.substring(0, 16)}... joined. Total peers: ${peers.size}. IP hash: ${ipHash}`);

          // Send list of existing peers to the new node (with IP hashes for quorum)
          const peerList = Array.from(peers.keys()).filter((id) => id !== nodeId);
          server.send(JSON.stringify({
            type: 'peers',
            peers: peerList,
            // Phase 33: Include IP hash for quorum scoring
            ipHash: ipHash,
          }));

          // Notify other peers about the new node (with IP hash)
          for (const [id, peer] of peers.entries()) {
            if (id !== nodeId && peer.readyState === WebSocket.READY_STATE_OPEN) {
              peer.send(JSON.stringify({
                type: 'new-peer',
                peerId: nodeId,
                // Phase 33: Include IP hash for quorum scoring
                ipHash: ipHash,
              }));
            }
          }
        } else if (data.type === 'request-peers') {
          // Request list of peers
          const peerList = Array.from(peers.keys()).filter((id) => id !== nodeId);
          server.send(JSON.stringify({
            type: 'peers',
            peers: peerList,
          }));
        } else if (data.type === 'REQUEST_BOOTSTRAP') {
          // Phase 32: Handle bootstrap request
          console.log(`[Phase 32] Received REQUEST_BOOTSTRAP from ${nodeId?.substring(0, 16)}...`);
          console.log(`[Phase 32] Current bootstrap state: height=${bootstrapState.latestHeight}, hasHeader=${!!bootstrapState.latestHeader}, hasSnapshot=${!!bootstrapState.latestSnapshotMeta}`);
          console.log(`[Phase 32] Request details:`, {
            requestId: data.requestId,
            wantSnapshotMeta: data.wantSnapshotMeta,
            wantHeaders: data.wantHeaders,
            headerCount: data.headerCount
          });
          
          const response = {
            type: 'BOOTSTRAP_RESPONSE',
            requestId: data.requestId || `${Date.now()}`,
            latestHeight: bootstrapState.latestHeight,
            latestHeader: bootstrapState.latestHeader,
            latestHeaderHash: bootstrapState.latestHeaderHash,
            recentHeaders: data.wantHeaders ? bootstrapState.recentHeaders.slice(-(data.headerCount || 200)) : undefined,
            latestSnapshotMeta: data.wantSnapshotMeta ? bootstrapState.latestSnapshotMeta : undefined,
            timestamp: Date.now(),
          };
          
          console.log(`[Phase 32] Preparing BOOTSTRAP_RESPONSE:`, {
            type: response.type,
            latestHeight: response.latestHeight,
            hasHeader: !!response.latestHeader,
            hasSnapshotMeta: !!response.latestSnapshotMeta,
            recentHeadersCount: response.recentHeaders?.length || 0
          });
          
          try {
            const responseStr = JSON.stringify(response);
            console.log(`[Phase 32] Sending BOOTSTRAP_RESPONSE (${responseStr.length} bytes) to WebSocket`);
            server.send(responseStr);
            console.log(`[Phase 32] ✅ Successfully sent BOOTSTRAP_RESPONSE: height=${bootstrapState.latestHeight}, hasHeader=${!!response.latestHeader}`);
          } catch (error) {
            console.error(`[Phase 32] ❌ Failed to send BOOTSTRAP_RESPONSE:`, error);
            console.error(`[Phase 32] WebSocket state:`, {
              readyState: server.readyState,
              url: server.url
            });
          }
        } else if (data.type === 'UPDATE_ROOT_TIP') {
          // Phase 32: Allow nodes to update root tip (for maintaining cache)
          // In production, this should be restricted to trusted nodes or use a different mechanism
          if (data.header && data.headerHash) {
            bootstrapState.latestHeight = data.header.height || bootstrapState.latestHeight;
            bootstrapState.latestHeader = data.header;
            bootstrapState.latestHeaderHash = data.headerHash;
            bootstrapState.lastUpdated = Date.now();
            
            // Update recent headers cache (keep last 200)
            if (bootstrapState.latestHeader) {
              bootstrapState.recentHeaders.push(bootstrapState.latestHeader);
              if (bootstrapState.recentHeaders.length > 200) {
                bootstrapState.recentHeaders.shift();
              }
            }
            
            console.log(`[Phase 32] Updated root tip to height ${bootstrapState.latestHeight}`);
            
            // Broadcast ROOT_TIP_UPDATE to all connected peers
            const tipUpdate = {
              type: 'ROOT_TIP_UPDATE',
              latestHeight: bootstrapState.latestHeight,
              latestHeader: bootstrapState.latestHeader,
              latestHeaderHash: bootstrapState.latestHeaderHash,
              timestamp: Date.now(),
            };
            
            for (const [id, peer] of peers.entries()) {
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
          // Forward WebRTC signaling messages between peers
          const target = peers.get(data.to);
          if (target && target.readyState === WebSocket.READY_STATE_OPEN) {
            target.send(JSON.stringify({
              ...data,
              from: nodeId,
            }));
          } else {
            console.warn(`[Signaling] Target peer ${data.to?.substring(0, 16)}... not found or not connected`);
          }
        }
      } catch (error) {
        console.error('[Signaling] Error handling message:', error);
        // Send error back to client
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
        peers.delete(nodeId);
        console.log(`[Signaling] Node ${nodeId.substring(0, 16)}... disconnected. Total peers: ${peers.size}`);

        // Notify other peers about disconnection
        for (const [id, peer] of peers.entries()) {
          if (peer.readyState === WebSocket.READY_STATE_OPEN) {
            peer.send(JSON.stringify({
              type: 'peer-left',
              peerId: nodeId,
            }));
          }
        }
      }
    });

    // Handle errors
    server.addEventListener('error', (error) => {
      console.error('[Signaling] WebSocket error:', error);
    });

    // Return WebSocket response
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};

