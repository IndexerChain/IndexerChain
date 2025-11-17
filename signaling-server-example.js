/**
 * Simple WebSocket Signaling Server Example
 * 
 * This is a minimal signaling server for IndexerChain P2P networking.
 * 
 * Usage:
 *   1. Install: npm install ws
 *   2. Run: node signaling-server-example.js
 *   3. Connect browsers to: ws://localhost:8080
 * 
 * Note: This is for development/testing only. For production, use a proper
 * signaling server with authentication, rate limiting, etc.
 */

import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const peers = new Map();

console.log(`Signaling server started on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  let nodeId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'join') {
        // Node joining
        nodeId = data.nodeId;
        peers.set(nodeId, ws);
        console.log(`Node ${nodeId} joined. Total peers: ${peers.size}`);

        // Send list of existing peers
        const peerList = Array.from(peers.keys()).filter((id) => id !== nodeId);
        ws.send(
          JSON.stringify({
            type: 'peers',
            peers: peerList,
          })
        );

        // Notify other peers about new node
        for (const [id, peer] of peers.entries()) {
          if (id !== nodeId && peer.readyState === 1) { // WebSocket.OPEN = 1
            peer.send(
              JSON.stringify({
                type: 'new-peer',
                peerId: nodeId,
              })
            );
          }
        }
      } else if (data.type === 'request-peers') {
        // Request list of peers
        const peerList = Array.from(peers.keys()).filter((id) => id !== nodeId);
        ws.send(
          JSON.stringify({
            type: 'peers',
            peers: peerList,
          })
        );
      } else if (
        data.type === 'offer' ||
        data.type === 'answer' ||
        data.type === 'ice-candidate'
      ) {
        // Forward WebRTC signaling messages
        const target = peers.get(data.to);
        if (target && target.readyState === 1) { // WebSocket.OPEN = 1
          target.send(
            JSON.stringify({
              ...data,
              from: nodeId,
            })
          );
        } else {
          console.warn(`Target peer ${data.to} not found or not connected`);
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    if (nodeId) {
      peers.delete(nodeId);
      console.log(`Node ${nodeId} disconnected. Total peers: ${peers.size}`);

      // Notify other peers about disconnection
      for (const [id, peer] of peers.entries()) {
        if (peer.readyState === 1) { // WebSocket.OPEN = 1
          peer.send(
            JSON.stringify({
              type: 'peer-left',
              peerId: nodeId,
            })
          );
        }
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

wss.on('error', (error) => {
  console.error('Server error:', error);
});

