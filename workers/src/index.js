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
    // Phase 51: Track per-connection join time and nodeId->address mapping
    this.peerJoinAt = new Map(); // Map<nodeId, number>
    this.nodeAddresses = new Map(); // Map<nodeId, address>
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
    // Phase 48: Bootstrap blocks metadata (for genesis node bootstrap)
    this.bootstrapBlocksMeta = {
      availableFromHeight: 0,
      availableToHeight: 0,
      // Raise default to cover early network quickly (dev-friendly)
      maxStoredHeight: 20000, // Maximum height to store bootstrap blocks
    };
    this.initialized = false;
  }

  // Phase 51: Helpers for signals root
  getEpochMs() {
    const ms = parseInt(this.env?.EPOCH_MS || "1000", 10);
    return Number.isFinite(ms) && ms > 0 ? ms : 1000;
  }

  getEpochId(tsMs = Date.now()) {
    return Math.floor(tsMs / this.getEpochMs());
  }

  async sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(hash);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      const h = bytes[i].toString(16).padStart(2, "0");
      hex += h;
    }
    return hex;
  }

  async calcMerkleRoot(leaves) {
    // leaves: array of hex strings (already hashed or raw strings)
    // If leaves are raw strings, hash them first
    const hashed = [];
    for (const leaf of leaves) {
      const isHex = typeof leaf === "string" && /^[0-9a-fA-F]+$/.test(leaf) && leaf.length === 64;
      hashed.push(isHex ? leaf.toLowerCase() : await this.sha256Hex(String(leaf)));
    }
    if (hashed.length === 0) {
      return await this.sha256Hex("");
    }
    let level = hashed.slice();
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        next.push(await this.sha256Hex(left + right));
      }
      level = next;
    }
    return level[0];
  }

  async calcMerkleProof(leaves, targetIndex) {
    // leaves: array of hex strings (already hashed)
    // returns array of sibling hashes (hex)
    const proof = [];
    if (leaves.length === 0 || targetIndex < 0 || targetIndex >= leaves.length) {
      return proof;
    }
    let level = leaves.slice();
    let idx = targetIndex;
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        next.push(await this.sha256Hex(left + right));
        if (i === idx || i + 1 === idx) {
          const isRight = i + 1 === idx;
          const sibling = isRight ? left : right;
          proof.push(sibling);
          idx = Math.floor(i / 2);
        }
      }
      level = next;
    }
    return proof;
  }

  /**
   * Phase 51: Aggregate online ms for (epoch, address)
   */
  async addOnlineMsForAddress(epochId, address, ms) {
    if (!address || typeof address !== "string") return;
    const key = `signals:e:${epochId}:addr:${address}:ms`;
    let cur = await this.state.storage.get(key);
    const prev = typeof cur === "number" ? cur : 0;
    await this.state.storage.put(key, prev + Math.max(0, ms));
  }

  /**
   * Phase 51: Handle epoch signals query (root only)
   * GET /epoch-signals?e=<epochId>
   */
  async handleEpochSignalsRequest(epochId) {
    try {
      const prefix = `signals:e:${epochId}:addr:`;
      const list = await this.state.storage.list({ prefix });
      const pairs = [];
      for (const [key, value] of list) {
        if (typeof value !== "number") continue;
        const addr = key.slice(prefix.length).replace(/:ms$/, "");
        const ms = value;
        // Normalize: 60 minutes -> 100 points
        const online = Math.max(0, Math.min(100, Math.round((ms / (60 * 60 * 1000)) * 100)));
        const reliab = 0;
        pairs.push({ address: addr, online, reliab });
      }
      // Sort by address for determinism
      pairs.sort((a, b) => a.address.localeCompare(b.address));
      // Build leaves "addr:online:reliab"
      const leafStrs = pairs.map((p) => `${p.address}:${p.online}:${p.reliab}`);
      const leafHashes = [];
      for (const s of leafStrs) {
        leafHashes.push(await this.sha256Hex(s));
      }
      const signalsRoot = await this.calcMerkleRoot(leafHashes);
      return new Response(JSON.stringify({
        ok: true,
        epochId,
        count: pairs.length,
        signalsRoot,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  /**
   * Phase 51: Handle epoch signals proof query
   * GET /epoch-signals/proof?e=<epochId>&addr=<address>
   */
  async handleEpochSignalsProofRequest(epochId, address) {
    try {
      if (!address) {
        return new Response(JSON.stringify({ ok: false, error: "Missing address" }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      const prefix = `signals:e:${epochId}:addr:`;
      const list = await this.state.storage.list({ prefix });
      const entries = [];
      for (const [key, value] of list) {
        if (typeof value !== "number") continue;
        const addr = key.slice(prefix.length).replace(/:ms$/, "");
        const ms = value;
        const online = Math.max(0, Math.min(100, Math.round((ms / (60 * 60 * 1000)) * 100)));
        const reliab = 0;
        entries.push({ address: addr, online, reliab });
      }
      entries.sort((a, b) => a.address.localeCompare(b.address));
      const leafStrs = entries.map((p) => `${p.address}:${p.online}:${p.reliab}`);
      const leafHashes = [];
      for (const s of leafStrs) {
        leafHashes.push(await this.sha256Hex(s));
      }
      const index = entries.findIndex((e) => e.address === address);
      if (index === -1) {
        return new Response(JSON.stringify({ ok: false, error: "Address not found" }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      const proof = await this.calcMerkleProof(leafHashes, index);
      const root = await this.calcMerkleRoot(leafHashes);
      return new Response(JSON.stringify({
        ok: true,
        epochId,
        address,
        leaf: await this.sha256Hex(leafStrs[index]),
        proof,
        signalsRoot: root,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
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
   * Phase 48: Load bootstrap blocks metadata from persistent storage
   */
  async loadBootstrapBlocksMeta() {
    try {
      const meta = await this.state.storage.get('bootstrapBlocksMeta');
      if (meta) {
        this.bootstrapBlocksMeta = {
          ...this.bootstrapBlocksMeta,
          ...meta,
        };
        console.log(`[SignalingRoom] Loaded bootstrap blocks meta: from=${meta.availableFromHeight}, to=${meta.availableToHeight}`);
        return true;
      }
    } catch (error) {
      console.error(`[SignalingRoom] Failed to load bootstrap blocks meta:`, error);
    }
    return false;
  }

  /**
   * Phase 49: Clear all bootstrap blocks from storage
   */
  async clearBootstrapBlocks() {
    try {
      await this.loadBootstrapBlocksMeta();
      const from = this.bootstrapBlocksMeta.availableFromHeight || 0;
      const to = this.bootstrapBlocksMeta.availableToHeight || 0;
      
      // Delete all stored blocks
      let deleted = 0;
      for (let h = from; h <= to; h++) {
        const key = `block:${h}`;
        await this.state.storage.delete(key);
        deleted++;
      }
      
      // Reset metadata
      this.bootstrapBlocksMeta = {
        availableFromHeight: 0,
        availableToHeight: 0,
        maxStoredHeight: 256,
      };
      await this.state.storage.put('bootstrapBlocksMeta', this.bootstrapBlocksMeta);
      
      console.log(`[SignalingRoom] Cleared ${deleted} bootstrap blocks (height ${from}-${to})`);
      return { deleted, from, to };
    } catch (error) {
      console.error(`[SignalingRoom] Error clearing bootstrap blocks:`, error);
      throw error;
    }
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

  /**
   * Phase 45: Reset rootTip to new genesis block
   * This is used for chain reset (re-genesis) after economic model upgrade
   * 
   * @param newGenesisHeader The new genesis block header
   * @param newGenesisHash The new genesis block hash
   * @param newStateCommitment The new genesis state commitment
   */
  async resetRootTip(newGenesisHeader, newGenesisHash, newStateCommitment) {
    console.log(`[SignalingRoom] 🔄 Resetting rootTip to new genesis block (height 0)`);
    
    // Reset bootstrap state to genesis
    this.bootstrapState = {
      latestHeight: 0,
      latestHeader: newGenesisHeader,
      latestHeaderHash: newGenesisHash,
      recentHeaders: [newGenesisHeader], // Only genesis header
      latestSnapshotMeta: null, // No snapshots at genesis
      lastUpdated: Date.now(),
      stateCommitment: newStateCommitment,
      trustLevel: 'root-only',
    };
    
    // Save to persistent storage
    await this.saveRootTip();
    
    // Broadcast ROOT_TIP_UPDATE to all connected peers
    const tipUpdate = {
      type: 'ROOT_TIP_UPDATE',
      rootTip: {
        latestHeight: 0,
        latestHeader: newGenesisHeader,
        latestHeaderHash: newGenesisHash,
        recentHeaders: [newGenesisHeader],
        latestSnapshotMeta: null,
        updatedAt: this.bootstrapState.lastUpdated,
        stateCommitment: newStateCommitment,
        trustLevel: 'root-only',
      },
      timestamp: Date.now(),
    };
    
    console.log(`[SignalingRoom] Broadcasting ROOT_TIP_UPDATE (genesis reset) to ${this.peers.size} peer(s)`);
    for (const [id, peer] of this.peers.entries()) {
      if (peer.readyState === WebSocket.READY_STATE_OPEN) {
        try {
          peer.send(JSON.stringify(tipUpdate));
        } catch (error) {
          console.error(`[SignalingRoom] Failed to send ROOT_TIP_UPDATE to ${id.substring(0, 16)}...:`, error);
        }
      }
    }
    
    console.log(`[SignalingRoom] ✅ RootTip reset complete: height=0, hash=${newGenesisHash.substring(0, 16)}...`);
  }

  /**
   * Phase 48: Handle bootstrap blocks HTTP request
   */
  async handleBootstrapBlocksRequest(from, to) {
    try {
      // Ensure bootstrap blocks meta is loaded
      if (!this.initialized) {
        await this.loadBootstrapBlocksMeta();
      } else {
        // Reload to get latest data
        await this.loadBootstrapBlocksMeta();
      }
      
      const meta = this.bootstrapBlocksMeta;
    
    if (!meta.availableFromHeight || !meta.availableToHeight) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "NO_BOOTSTRAP_BLOCKS",
          availableFromHeight: 0,
          availableToHeight: 0,
        }),
        { 
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }
    
    const start = Math.max(from, meta.availableFromHeight);
    const end = Math.min(to, meta.availableToHeight);
    
    if (start > end) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "OUT_OF_RANGE",
          availableFromHeight: meta.availableFromHeight,
          availableToHeight: meta.availableToHeight,
          requestedFrom: from,
          requestedTo: to,
        }),
        { 
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }
    
    const blocks = [];
    for (let h = start; h <= end; h++) {
      const key = `block:${h}`;
      const block = await this.state.storage.get(key);
      if (block) {
        blocks.push(block);
      }
    }
    
      return new Response(
        JSON.stringify({
          ok: true,
          blocks,
          availableFromHeight: meta.availableFromHeight,
          availableToHeight: meta.availableToHeight,
        }),
        { 
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    } catch (error) {
      console.error(`[SignalingRoom] Error in handleBootstrapBlocksRequest:`, error);
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "INTERNAL_ERROR",
          error: error instanceof Error ? error.message : String(error),
        }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }
  }

  async fetch(request) {
    // Phase 37: Load rootTip from storage on first request (lazy initialization)
    if (!this.initialized) {
      await this.loadRootTip();
      await this.loadBootstrapBlocksMeta(); // Phase 48: Load bootstrap blocks meta
      this.initialized = true;
    }

    // Phase 49: Handle internal reset request (from HTTP API)
    const url = new URL(request.url);
    if (url.pathname === '/reset' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (body.type === 'RESET_ROOT_TIP') {
          const { newGenesisHeader, newGenesisHash, newStateCommitment } = body;
          if (!newGenesisHeader || !newGenesisHash || !newStateCommitment) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          
          await this.resetRootTip(newGenesisHeader, newGenesisHash, newStateCommitment);
          
          return new Response(JSON.stringify({
            ok: true,
            message: 'RootTip reset to new genesis block',
            newGenesisHash: newGenesisHash.substring(0, 16) + '...',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (error) {
        return new Response(JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Phase 51: Epoch signals endpoints (before WebSocket upgrade)
    if (url.pathname === '/epoch-signals' && request.method === 'GET') {
      const e = parseInt(url.searchParams.get('e') || String(this.getEpochId()), 10);
      return await this.handleEpochSignalsRequest(Number.isFinite(e) ? e : this.getEpochId());
    }
    if (url.pathname === '/epoch-signals/proof' && request.method === 'GET') {
      const e = parseInt(url.searchParams.get('e') || String(this.getEpochId()), 10);
      const addr = url.searchParams.get('addr') || '';
      return await this.handleEpochSignalsProofRequest(Number.isFinite(e) ? e : this.getEpochId(), addr);
    }

    // Phase 48: Handle bootstrap blocks HTTP request (before WebSocket upgrade check)
    if (url.pathname === '/bootstrap-blocks' && request.method === 'GET') {
      try {
        const from = parseInt(url.searchParams.get('from') || '1', 10);
        const to = parseInt(url.searchParams.get('to') || '100', 10);
        return await this.handleBootstrapBlocksRequest(from, to);
      } catch (error) {
        console.error(`[SignalingRoom] Error handling bootstrap blocks request:`, error);
        return new Response(
          JSON.stringify({
            ok: false,
            reason: "INTERNAL_ERROR",
            error: error instanceof Error ? error.message : String(error),
          }),
          { 
            status: 500, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            } 
          }
        );
      }
    }
    
    // Phase 49: Handle clear bootstrap blocks (admin only)
    if (url.pathname === '/admin/clear-bootstrap-blocks' && request.method === 'POST') {
      try {
        const result = await this.clearBootstrapBlocks();
        return new Response(JSON.stringify({
          ok: true,
          message: 'All bootstrap blocks cleared',
          deleted: result.deleted,
          from: result.from,
          to: result.to,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // Phase 48: Handle seeding bootstrap blocks (admin/dev only)
    if (url.pathname === '/seed-bootstrap-blocks' && request.method === 'POST') {
      try {
        console.log(`[SignalingRoom] seed-bootstrap-blocks request received, path: ${url.pathname}`);
        // Optional simple token protection
        const adminToken = this.env?.ADMIN_TOKEN;
        const auth = request.headers.get('authorization') || '';
        console.log(`[SignalingRoom] Admin token check: hasToken=${!!adminToken}, auth=${auth.substring(0, 20)}...`);
        if (adminToken && auth !== `Bearer ${adminToken}`) {
          return new Response(JSON.stringify({ ok: false, reason: 'UNAUTHORIZED' }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
        
        const body = await request.json();
        const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
        if (blocks.length === 0) {
          return new Response(JSON.stringify({ ok: false, reason: 'NO_BLOCKS' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
        
        let stored = 0;
        await this.loadBootstrapBlocksMeta();
        for (const block of blocks) {
          const height = block?.header?.height;
          if (typeof height !== 'number') continue;
          if (height <= 0 || height > this.bootstrapBlocksMeta.maxStoredHeight) continue;
          const key = `block:${height}`;
          await this.state.storage.put(key, block);
          // Update meta
          if (this.bootstrapBlocksMeta.availableFromHeight === 0) {
            this.bootstrapBlocksMeta.availableFromHeight = height;
          } else {
            this.bootstrapBlocksMeta.availableFromHeight = Math.min(this.bootstrapBlocksMeta.availableFromHeight, height);
          }
          this.bootstrapBlocksMeta.availableToHeight = Math.max(this.bootstrapBlocksMeta.availableToHeight, height);
          stored++;
        }
        await this.state.storage.put('bootstrapBlocksMeta', this.bootstrapBlocksMeta);
        
        return new Response(JSON.stringify({
          ok: true,
          stored,
          availableFromHeight: this.bootstrapBlocksMeta.availableFromHeight,
          availableToHeight: this.bootstrapBlocksMeta.availableToHeight,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (error) {
        console.error(`[SignalingRoom] Error handling seed-bootstrap-blocks:`, error);
        return new Response(
          JSON.stringify({ ok: false, reason: 'INTERNAL_ERROR', error: error instanceof Error ? error.message : String(error) }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      }
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
          // Phase 51: Record join time
          this.peerJoinAt.set(nodeId, Date.now());

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
        } else if (data.type === 'ANNOUNCE_ID' && data.address && nodeId) {
          // Phase 51: Map nodeId -> address and persist
          const address = String(data.address);
          this.nodeAddresses.set(nodeId, address);
          try {
            await this.state.storage.put(`addrByNodeId:${nodeId}`, address);
          } catch (e) {}
          try {
            server.send(JSON.stringify({ type: 'ANNOUNCE_ACK', ok: true }));
          } catch (e) {}
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
            // Include bootstrap range hints for clients to start from correct height
            availableFromHeight: this.bootstrapBlocksMeta?.availableFromHeight || 0,
            availableToHeight: this.bootstrapBlocksMeta?.availableToHeight || 0,
          };
          
          console.log(`[SignalingRoom] Sending BOOTSTRAP_RESPONSE: height=${response.latestHeight}, hasHeader=${!!response.latestHeader}, recentHeaders=${response.recentHeaders?.length || 0}, trustLevel=${response.trustLevel}`);
          server.send(JSON.stringify(response));
        } else if (data.type === 'GLOBAL_VIEW_REQUEST') {
          // Respond with a minimal global view from signal server (fallback when peers unavailable)
          const resp = {
            type: 'GLOBAL_VIEW_RESPONSE',
            height: this.bootstrapState.latestHeight,
            tipHash: this.bootstrapState.latestHeaderHash,
            availableFromHeight: this.bootstrapBlocksMeta?.availableFromHeight || 0,
            availableToHeight: this.bootstrapBlocksMeta?.availableToHeight || 0,
            timestamp: Date.now(),
            sender: 'signal-server',
          };
          try { server.send(JSON.stringify(resp)); } catch (e) {}
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
          const canonicalBlock = payload.canonicalBlock; // Phase 48: Optional full block for bootstrap storage
          
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

          // Phase 48: Store bootstrap block if provided and height is within range
          if (canonicalBlock && height > 0 && height <= this.bootstrapBlocksMeta.maxStoredHeight) {
            try {
              const blockKey = `block:${height}`;
              await this.state.storage.put(blockKey, canonicalBlock);
              
              // Update available range
              if (this.bootstrapBlocksMeta.availableFromHeight === 0) {
                this.bootstrapBlocksMeta.availableFromHeight = height;
              } else {
                this.bootstrapBlocksMeta.availableFromHeight = Math.min(
                  this.bootstrapBlocksMeta.availableFromHeight,
                  height
                );
              }
              this.bootstrapBlocksMeta.availableToHeight = Math.max(
                this.bootstrapBlocksMeta.availableToHeight,
                height
              );
              
              // Persist metadata
              await this.state.storage.put('bootstrapBlocksMeta', this.bootstrapBlocksMeta);
              
              console.log(`[SignalingRoom] Stored bootstrap block at height ${height} (range: ${this.bootstrapBlocksMeta.availableFromHeight}-${this.bootstrapBlocksMeta.availableToHeight})`);
            } catch (error) {
              console.error(`[SignalingRoom] Failed to store bootstrap block at height ${height}:`, error);
              // Don't fail the rootTip update if block storage fails
            }
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
        } else if (data.type === 'SEED_BOOTSTRAP_BLOCKS') {
          // Allow clients to seed a small rolling window of recent blocks (no auth)
          try {
            const blocks = Array.isArray(data.blocks) ? data.blocks : [];
            if (blocks.length === 0) {
              server.send(JSON.stringify({ type: 'SEED_BOOTSTRAP_BLOCKS_ACK', ok: false, reason: 'NO_BLOCKS' }));
              return;
            }
            await this.loadBootstrapBlocksMeta();
            let stored = 0;
            for (const block of blocks) {
              const height = block?.header?.height;
              if (typeof height !== 'number') continue;
              if (height <= 0 || height > this.bootstrapBlocksMeta.maxStoredHeight) continue;
              const key = `block:${height}`;
              await this.state.storage.put(key, block);
              if (this.bootstrapBlocksMeta.availableFromHeight === 0) {
                this.bootstrapBlocksMeta.availableFromHeight = height;
              } else {
                this.bootstrapBlocksMeta.availableFromHeight = Math.min(this.bootstrapBlocksMeta.availableFromHeight, height);
              }
              this.bootstrapBlocksMeta.availableToHeight = Math.max(this.bootstrapBlocksMeta.availableToHeight, height);
              stored++;
            }
            await this.state.storage.put('bootstrapBlocksMeta', this.bootstrapBlocksMeta);
            server.send(JSON.stringify({
              type: 'SEED_BOOTSTRAP_BLOCKS_ACK',
              ok: true,
              stored,
              availableFromHeight: this.bootstrapBlocksMeta.availableFromHeight,
              availableToHeight: this.bootstrapBlocksMeta.availableToHeight,
            }));
          } catch (error) {
            server.send(JSON.stringify({ type: 'SEED_BOOTSTRAP_BLOCKS_ACK', ok: false, reason: 'INTERNAL_ERROR' }));
          }
        } else if (data.type === 'REQUEST_BOOTSTRAP_BLOCKS') {
          try {
            // WebSocket-based bootstrap blocks (bypass CORS)
            const from = parseInt(data.from || '1', 10);
            const to = parseInt(data.to || '100', 10);
            const requestId = data.requestId || `${Date.now()}`;
            
            await this.loadBootstrapBlocksMeta();
            const meta = this.bootstrapBlocksMeta;
            
            if (!meta.availableFromHeight || !meta.availableToHeight) {
              server.send(JSON.stringify({
                type: 'BOOTSTRAP_BLOCKS',
                ok: false,
                reason: 'NO_BOOTSTRAP_BLOCKS',
                availableFromHeight: 0,
                availableToHeight: 0,
                requestId,
              }));
              return;
            }
            
            const start = Math.max(from, meta.availableFromHeight);
            const end = Math.min(to, meta.availableToHeight);
            
            if (start > end) {
              server.send(JSON.stringify({
                type: 'BOOTSTRAP_BLOCKS',
                ok: false,
                reason: 'OUT_OF_RANGE',
                availableFromHeight: meta.availableFromHeight,
                availableToHeight: meta.availableToHeight,
                requestedFrom: from,
                requestedTo: to,
                requestId,
              }));
              return;
            }
            
            const blocks = [];
            for (let h = start; h <= end; h++) {
              const key = `block:${h}`;
              const block = await this.state.storage.get(key);
              if (block) {
                blocks.push(block);
              }
            }
            
            server.send(JSON.stringify({
              type: 'BOOTSTRAP_BLOCKS',
              ok: true,
              blocks,
              availableFromHeight: meta.availableFromHeight,
              availableToHeight: meta.availableToHeight,
              requestId,
            }));
          } catch (error) {
            console.error(`[SignalingRoom] Error handling REQUEST_BOOTSTRAP_BLOCKS:`, error);
            const requestId = data.requestId || `${Date.now()}`;
            server.send(JSON.stringify({
              type: 'BOOTSTRAP_BLOCKS',
              ok: false,
              reason: 'INTERNAL_ERROR',
              error: error instanceof Error ? error.message : String(error),
              requestId,
            }));
          }
        } else if (data.type === 'RESET_ROOT_TIP') {
          // Phase 45: Handle rootTip reset request (admin only)
          // This should be protected by authentication in production
          const { newGenesisHeader, newGenesisHash, newStateCommitment } = data;
          
          if (!newGenesisHeader || !newGenesisHash || !newStateCommitment) {
            server.send(JSON.stringify({
              type: 'error',
              message: 'Missing required fields: newGenesisHeader, newGenesisHash, newStateCommitment',
            }));
            return;
          }
          
          // Reset rootTip
          await this.resetRootTip(newGenesisHeader, newGenesisHash, newStateCommitment);
          
          server.send(JSON.stringify({
            type: 'RESET_ROOT_TIP_SUCCESS',
            message: 'RootTip reset to new genesis block',
            newGenesisHash: newGenesisHash.substring(0, 16) + '...',
          }));
        } else if (data.type === 'CLEAR_BOOTSTRAP_BLOCKS') {
          // Phase 49: Handle clear bootstrap blocks request (admin only)
          try {
            await this.clearBootstrapBlocks();
            server.send(JSON.stringify({
              type: 'CLEAR_BOOTSTRAP_BLOCKS_SUCCESS',
              message: 'All bootstrap blocks cleared',
            }));
          } catch (error) {
            server.send(JSON.stringify({
              type: 'error',
              message: `Failed to clear bootstrap blocks: ${error instanceof Error ? error.message : String(error)}`,
            }));
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
    server.addEventListener('close', async () => {
      if (nodeId) {
        this.peers.delete(nodeId);
        this.peerIPHashes.delete(nodeId); // Phase 33: Remove IP hash when peer disconnects
        console.log(`[SignalingRoom] Node ${nodeId.substring(0, 16)}... disconnected. Total peers: ${this.peers.size}`);
        // Phase 51: Accumulate online ms for the current epoch using mapped address
        try {
          const joinedAt = this.peerJoinAt.get(nodeId);
          this.peerJoinAt.delete(nodeId);
          let sessionMs = 0;
          if (typeof joinedAt === 'number') {
            sessionMs = Math.max(0, Date.now() - joinedAt);
          }
          let address = this.nodeAddresses.get(nodeId);
          if (!address) {
            // Try to load from storage
            address = await this.state.storage.get(`addrByNodeId:${nodeId}`);
          }
          if (address && sessionMs > 0) {
            const epochId = this.getEpochId();
            await this.addOnlineMsForAddress(epochId, address, sessionMs);
          }
        } catch (e) {
          // ignore
        }

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
    console.log(`[Worker] Request: ${request.method} ${url.pathname}`);

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // Phase 40: Handle Shadow Node routes
    // Support /shadow/..., /init, /setActiveMiner, /getActiveMiner patterns
    const shadowNodePaths = [
      '/shadow', '/init', '/setActiveMiner', '/getActiveMiner',
      '/sync', '/ping', '/reset'
    ];
    const isShadowNodeRoute = url.pathname.startsWith('/shadow/') || 
                              shadowNodePaths.includes(url.pathname);
    
    if (isShadowNodeRoute) {
      // Extract sessionId from path or query
      let sessionId = url.searchParams.get('sessionId');
      
      if (!sessionId && url.pathname.startsWith('/shadow/')) {
        const parts = url.pathname.split('/');
        sessionId = parts[2];
      }
      
      // For /setActiveMiner and /getActiveMiner, sessionId is required
      if (!sessionId && (url.pathname === '/setActiveMiner' || url.pathname === '/getActiveMiner')) {
        return new Response(JSON.stringify({ error: 'Missing sessionId' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }
      
      if (!sessionId && url.pathname !== '/shadow' && url.pathname !== '/init') {
        return new Response(JSON.stringify({ error: 'Missing sessionId' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }
      
      // For /shadow or /init without sessionId, return info
      if (!sessionId && (url.pathname === '/shadow' || url.pathname === '/init')) {
        return new Response(JSON.stringify({ 
          service: 'Shadow Node',
          status: 'ready',
          usage: 'POST /init?sessionId=... or POST /shadow/{sessionId}/init to initialize a session',
        }), {
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }
      
      if (!sessionId) {
        return new Response(JSON.stringify({ error: 'Missing sessionId' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }
      
      // Get or create ShadowSession Durable Object
      const sessionIdObj = env.SHADOW_SESSION.idFromName(sessionId);
      const session = env.SHADOW_SESSION.get(sessionIdObj);
      
      // Forward request to session
      const response = await session.fetch(request);
      
      // For WebSocket upgrades, return the response as-is (can't modify WebSocket responses)
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket' || response.status === 101) {
        return response;
      }
      
      // For HTTP responses, add CORS headers
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // Handle keepalive endpoint for PWA persistence
    if (url.pathname === '/keepalive' && (request.method === 'POST' || request.method === 'GET')) {
      return new Response('ok', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-cache',
          ...corsHeaders,
        },
      });
    }

    // Phase 48: Handle bootstrap blocks endpoint (forward to SignalingRoom)
    // This must be before the general SignalingRoom fetch to ensure proper routing
    if (url.pathname === '/bootstrap-blocks' && request.method === 'GET') {
      try {
        const roomId = env.SIGNALING_ROOM.idFromName('main');
        const room = env.SIGNALING_ROOM.get(roomId);
        const response = await room.fetch(request);
        
        // Ensure CORS headers are present
        const newHeaders = new Headers(response.headers);
        if (!newHeaders.has('Access-Control-Allow-Origin')) {
          newHeaders.set('Access-Control-Allow-Origin', '*');
        }
        
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      } catch (error) {
        console.error(`[Worker] Error forwarding bootstrap blocks request:`, error);
        return new Response(
          JSON.stringify({
            ok: false,
            reason: "INTERNAL_ERROR",
            error: error instanceof Error ? error.message : String(error),
          }),
          { 
            status: 500, 
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders,
            } 
          }
        );
      }
    }
    
    // Phase 48: Admin seeding endpoint - forward to SignalingRoom (rewrite path)
    if (url.pathname === '/admin/seed-bootstrap-blocks' && request.method === 'POST') {
      try {
        console.log(`[Worker] Admin seed-bootstrap-blocks request received`);
        const roomId = env.SIGNALING_ROOM.idFromName('main');
        const room = env.SIGNALING_ROOM.get(roomId);
        // Read body first
        const body = await request.clone().text();
        // Rewrite path for DO - create new request with correct URL
        const newUrl = new URL('/seed-bootstrap-blocks', request.url);
        const seedRequest = new Request(newUrl.toString(), { 
          method: 'POST',
          headers: request.headers,
          body: body,
        });
        console.log(`[Worker] Forwarding to SignalingRoom: ${seedRequest.url}, body length: ${body.length}`);
        const response = await room.fetch(seedRequest);
        // Ensure CORS
        const newHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, String(v)));
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      } catch (error) {
        console.error(`[Worker] Error forwarding seed-bootstrap-blocks:`, error);
        return new Response(JSON.stringify({ ok: false, reason: 'INTERNAL_ERROR', error: error instanceof Error ? error.message : String(error) }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }
    }

    // Phase 47: Handle block download endpoint for genesis nodes
    // GET /blocks?fromHeight=1&toHeight=100
    if (url.pathname === '/blocks' && request.method === 'GET') {
      const roomId = env.SIGNALING_ROOM.idFromName('main');
      const room = env.SIGNALING_ROOM.get(roomId);
      
      // Forward to SignalingRoom to handle block request
      // We'll add a method to handle this
      const fromHeight = parseInt(url.searchParams.get('fromHeight') || '1');
      const toHeight = parseInt(url.searchParams.get('toHeight') || '100');
      
      // For now, return a message indicating this feature needs to be implemented
      // The signal server would need to store initial blocks (height 1-100) to provide this
      return new Response(JSON.stringify({ 
        error: 'Block download from signal server not yet implemented',
        note: 'Signal server currently only stores rootTip and headers, not full blocks',
        suggestion: 'Use warp sync (snapshots) or wait for peers with blocks',
        fromHeight,
        toHeight,
      }), {
        status: 501, // Not Implemented
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    // Phase 45: Handle admin endpoints for chain reset
    if (url.pathname === '/admin/reset-root-tip' && request.method === 'POST') {
      // Get or create the signaling room Durable Object
      const roomId = env.SIGNALING_ROOM.idFromName('main');
      const room = env.SIGNALING_ROOM.get(roomId);
      
      // Parse request body
      let body;
      try {
        body = await request.json();
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }
      
      const { newGenesisHeader, newGenesisHash, newStateCommitment } = body;
      
      if (!newGenesisHeader || !newGenesisHash || !newStateCommitment) {
        return new Response(JSON.stringify({ 
          error: 'Missing required fields: newGenesisHeader, newGenesisHash, newStateCommitment' 
        }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }
      
      // Forward to SignalingRoom to reset rootTip
      // We'll use a custom message type
      const resetRequest = new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({
          type: 'RESET_ROOT_TIP',
          newGenesisHeader,
          newGenesisHash,
          newStateCommitment,
        }),
      });
      
      // Note: This is a simplified approach. In production, you might want to
      // add a direct method call or use a different mechanism
      return new Response(JSON.stringify({ 
        message: 'Reset request sent. Use WebSocket RESET_ROOT_TIP message for actual reset.',
        note: 'For production, implement direct method call or admin authentication',
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    // Phase 49: Handle admin endpoint to clear bootstrap blocks
    if (url.pathname === '/admin/clear-bootstrap-blocks' && request.method === 'POST') {
      const roomId = env.SIGNALING_ROOM.idFromName('main');
      const room = env.SIGNALING_ROOM.get(roomId);
      
      // Forward to SignalingRoom to clear bootstrap blocks
      return room.fetch(new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({ type: 'CLEAR_BOOTSTRAP_BLOCKS' }),
      }));
    }

    // Phase 49: Handle admin endpoint to reset rootTip via HTTP (no WebSocket needed)
    if (url.pathname === '/admin/reset-root-tip-http' && request.method === 'POST') {
      const roomId = env.SIGNALING_ROOM.idFromName('main');
      const room = env.SIGNALING_ROOM.get(roomId);
      
      // Parse request body
      let body;
      try {
        body = await request.json();
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }
      
      const { newGenesisHeader, newGenesisHash, newStateCommitment } = body;
      
      if (!newGenesisHeader || !newGenesisHash || !newStateCommitment) {
        return new Response(JSON.stringify({ 
          error: 'Missing required fields: newGenesisHeader, newGenesisHash, newStateCommitment' 
        }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }
      
      // Forward to SignalingRoom via internal fetch
      const internalRequest = new Request('http://internal/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'RESET_ROOT_TIP',
          newGenesisHeader,
          newGenesisHash,
          newStateCommitment,
        }),
      });
      
      return room.fetch(internalRequest);
    }

    // ICE configuration endpoint (for browsers to fetch TURN/STUN list)
    if (url.pathname === '/ice-config' && request.method === 'GET') {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };
      // Read from environment variable ICE_SERVERS_JSON (set via CF secrets/vars)
      // Fallback to public STUN only
      let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
      try {
        if (env.ICE_SERVERS_JSON) {
          const parsed = JSON.parse(env.ICE_SERVERS_JSON);
          if (Array.isArray(parsed) && parsed.length > 0) {
            iceServers = parsed;
          }
        }
      } catch (e) {
        // Keep default
      }
      return new Response(JSON.stringify({ ok: true, iceServers }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
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

