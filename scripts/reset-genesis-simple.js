/**
 * Phase 45: Simple Genesis Reset Script
 * 
 * This script resets the rootTip to new genesis block
 */

import WebSocket from 'ws';

const SIGNALING_URL = 'wss://signal.indexerchain.com';

async function generateGenesisBlock() {
  // Import the genesis creation function
  // In browser, this would be from the built bundle
  // In Node.js, we need to use dynamic import
  
  try {
    // Try to use the built version
    const { createGenesisBlock } = await import('../dist/core/genesis.js');
    const { MAINNET_PARAMS } = await import('../dist/core/networkParams.js');
    
    const params = MAINNET_PARAMS;
    const genesisBlock = await createGenesisBlock(params);
    
    return {
      header: genesisBlock.header,
      hash: genesisBlock.hash,
      stateCommitment: genesisBlock.header.stateCommitment,
    };
  } catch (error) {
    console.error('Failed to import modules:', error);
    throw error;
  }
}

async function resetRootTip(genesisData) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIGNALING_URL);
    
    let resolved = false;
    
    ws.onopen = () => {
      console.log('✅ Connected to signaling server');
      console.log('   Sending RESET_ROOT_TIP message...\n');
      
      // Send reset request
      ws.send(JSON.stringify({
        type: 'RESET_ROOT_TIP',
        newGenesisHeader: genesisData.header,
        newGenesisHash: genesisData.hash,
        newStateCommitment: genesisData.stateCommitment,
      }));
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'RESET_ROOT_TIP_SUCCESS') {
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
        } else if (message.type === 'JOIN_ACK') {
          console.log('   Connected as node, waiting for reset response...');
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
}

async function main() {
  console.log('🔄 Phase 45: Genesis Reset Script');
  console.log('=====================================\n');
  
  try {
    // Step 1: Generate new genesis block
    console.log('Step 1: Generating new genesis block...');
    const genesisData = await generateGenesisBlock();
    
    console.log('✅ New Genesis Block Generated:');
    console.log(`   Hash: ${genesisData.hash}`);
    console.log(`   State Commitment: ${genesisData.stateCommitment?.substring(0, 32)}...`);
    console.log('');
    
    // Step 2: Reset rootTip
    console.log('Step 2: Resetting rootTip on signaling server...');
    console.log(`   URL: ${SIGNALING_URL}\n`);
    
    await resetRootTip(genesisData);
    
    console.log('✅ Genesis reset complete!');
    console.log('');
    console.log('Next steps:');
    console.log('1. All browsers will automatically reset on next connection');
    console.log('2. Verify reset by checking rootTip height is 0');
    console.log('3. Open browser and verify local height is 0');
    
  } catch (error) {
    console.error('❌ Genesis reset failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (typeof require !== 'undefined' && require.main === module) {
  main();
}

// Export for use in other scripts
if (typeof module !== 'undefined') {
  module.exports = { generateGenesisBlock, resetRootTip, main };
}

