/**
 * Phase 45: Genesis Reset Script (Browser Console Version)
 * 
 * Copy and paste this entire script into the browser console
 * after the app has loaded (so the modules are available)
 * 
 * Or run: node scripts/reset-genesis-browser.js (after building)
 */

const SIGNALING_URL = 'wss://signal.indexerchain.com';

async function resetGenesis() {
  console.log('🔄 Phase 45: Genesis Reset Script');
  console.log('=====================================\n');
  
  try {
    // Step 1: Generate new genesis block
    console.log('Step 1: Generating new genesis block...');
    
    // Import from the built bundle (in browser) or from dist (in Node.js)
    let createGenesisBlock, MAINNET_PARAMS;
    
    if (typeof window !== 'undefined') {
      // Browser environment - modules should be available globally or via import
      // Try to access from the app's global scope
      const { createGenesisBlock: createGen } = await import('/src/core/genesis.js');
      const { MAINNET_PARAMS: params } = await import('/src/core/networkParams.js');
      createGenesisBlock = createGen;
      MAINNET_PARAMS = params;
    } else {
      // Node.js environment - use dist
      const genModule = await import('../dist/core/genesis.js');
      const paramsModule = await import('../dist/core/networkParams.js');
      createGenesisBlock = genModule.createGenesisBlock;
      MAINNET_PARAMS = paramsModule.MAINNET_PARAMS;
    }
    
    const params = MAINNET_PARAMS;
    const genesisBlock = await createGenesisBlock(params);
    
    console.log('✅ New Genesis Block Generated:');
    console.log(`   Hash: ${genesisBlock.hash}`);
    console.log(`   Timestamp: ${new Date(params.genesisTimestamp * 1000).toISOString()}`);
    console.log(`   State Commitment: ${genesisBlock.header.stateCommitment?.substring(0, 32)}...`);
    console.log(`   Network ID: ${params.networkId}`);
    console.log('');
    
    // Step 2: Connect to signaling server and reset rootTip
    console.log('Step 2: Connecting to signaling server...');
    console.log(`   URL: ${SIGNALING_URL}`);
    
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(SIGNALING_URL);
      
      let resolved = false;
      let nodeId = null;
      
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
          
          if (message.type === 'JOIN_ACK' || message.type === 'peers') {
            // Now we're connected, send reset request
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
    console.error('❌ Failed to generate genesis block:', error);
    throw error;
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resetGenesis };
}

// Auto-run if in browser console or with --confirm flag
if (typeof window !== 'undefined' || process.argv.includes('--confirm')) {
  console.log('⚠️  WARNING: This will reset the entire network to a new genesis block!');
  console.log('   This action is IRREVERSIBLE!\n');
  
  resetGenesis()
    .then(() => {
      console.log('✅ Genesis reset complete!');
      console.log('');
      console.log('Next steps:');
      console.log('1. All browsers will automatically reset on next connection');
      console.log('2. Verify reset by checking rootTip height is 0');
      console.log('3. Open browser and verify local height is 0');
      if (typeof process !== 'undefined') process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Genesis reset failed:', error);
      if (typeof process !== 'undefined') process.exit(1);
    });
} else if (typeof process !== 'undefined') {
  console.log('⚠️  This script requires --confirm flag to execute.');
  console.log('   Usage: node scripts/reset-genesis-browser.js --confirm');
  console.log('');
  console.log('   Or paste the resetGenesis() function into browser console');
}

