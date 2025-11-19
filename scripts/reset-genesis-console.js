/**
 * Phase 45: Genesis Reset Script (Browser Console)
 * 
 * Copy and paste this ENTIRE code into the browser console.
 * This version is completely self-contained and doesn't require any imports.
 */

(async function resetGenesisFromConsole() {
  console.log('🔄 Phase 45: Genesis Reset Script');
  console.log('=====================================\n');
  
  // Helper function: SHA-256 hash
  async function sha256(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  
  // Helper function: Calculate merkle root for empty array
  async function calcMerkleRoot(txIds) {
    if (txIds.length === 0) {
      // Empty merkle root is hash of empty string
      return await sha256('');
    }
    // For non-empty, we'd build a tree, but genesis has no transactions
    return await sha256('');
  }
  
  // Helper function: Hash block header
  async function hashBlockHeader(header) {
    // Serialize header deterministically
    const parts = [
      header.version || 1,
      header.height || 0,
      header.prevHash || '0'.repeat(64),
      header.merkleRoot || '',
      header.timestamp || 0,
      header.difficulty || 1,
      header.nonce || 0,
    ];
    
    // Include stateCommitment if present
    if (header.stateCommitment) {
      parts.push(header.stateCommitment);
    }
    
    const serialized = parts.join('|');
    return await sha256(serialized);
  }
  
  // Helper function: Compute state commitment for empty state
  async function computeEmptyStateCommitment() {
    // Empty state is just an empty object
    const emptyState = {};
    const stateStr = JSON.stringify(emptyState);
    return await sha256(stateStr);
  }
  
  try {
    // Step 1: Generate new genesis block
    console.log('Step 1: Generating new genesis block...');
    
    // Mainnet parameters (Phase 45: New genesis timestamp)
    const MAINNET_PARAMS = {
      version: 1,
      networkId: "IXC_MAINNET_V1",
      genesisTimestamp: 1710000000, // 2024-03-10 00:00:00 UTC
      initialDifficulty: 1,
      targetBlockTime: 10,
      difficultyAdjustmentInterval: 10,
      blockReward: 10,
    };
    
    // Create genesis block
    const txs = [];
    const txIds = [];
    const merkleRoot = await calcMerkleRoot(txIds);
    const stateCommitment = await computeEmptyStateCommitment();
    
    const header = {
      version: MAINNET_PARAMS.version,
      height: 0,
      prevHash: "0".repeat(64),
      merkleRoot: merkleRoot,
      timestamp: MAINNET_PARAMS.genesisTimestamp,
      difficulty: MAINNET_PARAMS.initialDifficulty,
      nonce: 0,
      stateCommitment: stateCommitment,
    };
    
    const hash = await hashBlockHeader(header);
    
    const genesisBlock = {
      header,
      txs,
      hash,
    };
    
    console.log('✅ New Genesis Block Generated:');
    console.log(`   Hash: ${genesisBlock.hash}`);
    console.log(`   Timestamp: ${new Date(MAINNET_PARAMS.genesisTimestamp * 1000).toISOString()}`);
    console.log(`   State Commitment: ${genesisBlock.header.stateCommitment.substring(0, 32)}...`);
    console.log(`   Network ID: ${MAINNET_PARAMS.networkId}`);
    console.log('');
    
    // Step 2: Connect to signaling server and reset rootTip
    console.log('Step 2: Connecting to signaling server...');
    const SIGNALING_URL = 'wss://signal.indexerchain.com';
    console.log(`   URL: ${SIGNALING_URL}`);
    
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(SIGNALING_URL);
      
      let resolved = false;
      let nodeId = null;
      let joined = false;
      
      ws.onopen = () => {
        console.log('✅ Connected to signaling server');
        console.log('   Joining as node...');
        
        // First, join as a node
        nodeId = `reset_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        ws.send(JSON.stringify({
          type: 'join',
          nodeId: nodeId,
        }));
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if ((message.type === 'JOIN_ACK' || message.type === 'peers') && !joined) {
            // Now we're connected, send reset request
            joined = true;
            console.log('   Sending RESET_ROOT_TIP message...\n');
            ws.send(JSON.stringify({
              type: 'RESET_ROOT_TIP',
              newGenesisHeader: genesisBlock.header,
              newGenesisHash: genesisBlock.hash,
              newStateCommitment: genesisBlock.header.stateCommitment,
            }));
          } else if (message.type === 'RESET_ROOT_TIP_SUCCESS') {
            console.log('✅ RootTip reset successful!');
            console.log(`   New Genesis Hash: ${message.newGenesisHash}`);
            console.log('');
            console.log('📢 Broadcasting to all connected peers...');
            console.log('   All browsers will automatically reset on next connection.');
            console.log('');
            resolved = true;
            ws.close();
            resolve(message);
          } else if (message.type === 'error') {
            console.error('❌ Error:', message.message);
            resolved = true;
            ws.close();
            reject(new Error(message.message));
          }
        } catch (error) {
          console.error('❌ Failed to parse message:', error);
        }
      };
      
      ws.onerror = (error) => {
        if (!resolved) {
          console.error('❌ WebSocket error:', error);
          reject(error);
        }
      };
      
      ws.onclose = () => {
        if (!resolved) {
          console.log('⚠️  Connection closed before receiving response');
          console.log('   This might be normal if the server processed the request.');
          console.log('   Please verify by checking the rootTip manually.');
          resolve();
        }
      };
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (!resolved) {
          console.error('❌ Timeout: No response from server after 30 seconds');
          ws.close();
          reject(new Error('Timeout'));
        }
      }, 30000);
    });
  } catch (error) {
    console.error('❌ Failed to reset genesis:', error);
    console.error('   Error details:', error.message);
    throw error;
  }
})().then(() => {
  console.log('');
  console.log('✅ Genesis reset complete!');
  console.log('');
  console.log('Next steps:');
  console.log('1. All browsers will automatically reset on next connection');
  console.log('2. Verify reset by checking rootTip height is 0');
  console.log('3. Refresh the page to see the reset');
}).catch((error) => {
  console.error('❌ Genesis reset failed:', error);
});
