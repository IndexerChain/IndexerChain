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

    // Handle incoming messages
    server.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'join') {
          // Node joining the network
          nodeId = data.nodeId;
          peers.set(nodeId, server);
          
          console.log(`[Signaling] Node ${nodeId.substring(0, 16)}... joined. Total peers: ${peers.size}`);

          // Send list of existing peers to the new node
          const peerList = Array.from(peers.keys()).filter((id) => id !== nodeId);
          server.send(JSON.stringify({
            type: 'peers',
            peers: peerList,
          }));

          // Notify other peers about the new node
          for (const [id, peer] of peers.entries()) {
            if (id !== nodeId && peer.readyState === WebSocket.READY_STATE_OPEN) {
              peer.send(JSON.stringify({
                type: 'new-peer',
                peerId: nodeId,
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

