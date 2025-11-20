/**
 * Phase 49: Complete Chain Reset Script
 * 
 * This script performs a complete reset of the chain:
 * 1. Clears all bootstrap blocks from signal server
 * 2. Resets rootTip to new genesis block
 * 3. Provides instructions for clearing local storage
 * 
 * Usage:
 *   node scripts/reset-chain-complete.js
 */

import WebSocket from 'ws';

// Import from dist (built) directory
async function loadModules() {
  try {
    // Try dist first (after build)
    const genModule = await import('../dist/core/genesis.js');
    const paramsModule = await import('../dist/core/networkParams.js');
    return {
      createGenesisBlock: genModule.createGenesisBlock,
      MAINNET_PARAMS: paramsModule.MAINNET_PARAMS,
    };
  } catch (error) {
    console.error('❌ Failed to load modules from dist. Please run: npm run build');
    throw error;
  }
}

const SIGNALING_URL = 'wss://signal.indexerchain.com';
const SIGNALING_HTTP = 'https://signal.indexerchain.com';

async function clearBootstrapBlocks() {
  console.log('Step 1: Clearing bootstrap blocks from signal server...');
  
  try {
    const response = await fetch(`${SIGNALING_HTTP}/admin/clear-bootstrap-blocks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ Cleared ${result.deleted || 0} bootstrap blocks (height ${result.from || 0}-${result.to || 0})`);
      return true;
    } else {
      console.error('❌ Failed to clear bootstrap blocks:', result.error || result.reason);
      return false;
    }
  } catch (error) {
    console.error('❌ Error clearing bootstrap blocks:', error);
    return false;
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
  console.log('🔄 Phase 49: Complete Chain Reset Script');
  console.log('==========================================\n');
  console.log('⚠️  WARNING: This will reset the entire chain!');
  console.log('   - All bootstrap blocks will be cleared');
  console.log('   - RootTip will be reset to genesis');
  console.log('   - All browsers will need to clear localStorage\n');
  
  try {
    // Step 1: Clear bootstrap blocks
    const cleared = await clearBootstrapBlocks();
    if (!cleared) {
      console.log('⚠️  Continuing with rootTip reset despite bootstrap clear failure...\n');
    }
    
    // Step 2: Load modules and generate new genesis block
    console.log('Step 2: Loading modules and generating new genesis block...');
    const { createGenesisBlock, MAINNET_PARAMS } = await loadModules();
    const params = MAINNET_PARAMS;
    const genesisBlock = await createGenesisBlock(params);
    
    console.log('✅ New Genesis Block Generated:');
    console.log(`   Hash: ${genesisBlock.hash}`);
    console.log(`   Timestamp: ${new Date(params.genesisTimestamp * 1000).toISOString()}`);
    console.log(`   State Commitment: ${genesisBlock.header.stateCommitment?.substring(0, 32)}...`);
    console.log('');
    
    // Step 3: Reset rootTip
    console.log('Step 3: Resetting rootTip on signaling server...');
    console.log(`   URL: ${SIGNALING_URL}\n`);
    
    await resetRootTip({
      header: genesisBlock.header,
      hash: genesisBlock.hash,
      stateCommitment: genesisBlock.header.stateCommitment,
    });
    
    console.log('✅ Complete chain reset finished!');
    console.log('');
    console.log('📋 Next Steps:');
    console.log('1. Clear browser localStorage:');
    console.log('   - Open browser console');
    console.log('   - Run: localStorage.clear()');
    console.log('   - Refresh the page');
    console.log('');
    console.log('2. Or use the browser reset script:');
    console.log('   - Copy the code from RESET_INSTRUCTIONS.md');
    console.log('   - Paste into browser console');
    console.log('   - Execute');
    console.log('');
    console.log('3. Verify reset:');
    console.log('   - Check rootTip height is 0');
    console.log('   - Check local height is 0');
    console.log('   - Check bootstrap blocks range is empty');
    
  } catch (error) {
    console.error('❌ Chain reset failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (typeof require !== 'undefined' && require.main === module) {
  main();
}

// Export for use in other scripts
if (typeof module !== 'undefined') {
  module.exports = { clearBootstrapBlocks, resetRootTip, main };
}

