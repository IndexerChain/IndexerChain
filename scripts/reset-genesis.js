/**
 * Phase 45: Genesis Reset Script
 * 
 * This script resets the entire network to a new genesis block.
 * 
 * Usage:
 *   node scripts/reset-genesis.js [--signaling-url=wss://signal.indexerchain.com]
 */

import { createGenesisBlock } from '../src/core/genesis.js';
import { MAINNET_PARAMS } from '../src/core/networkParams.js';
import WebSocket from 'ws';

const SIGNALING_URL = process.env.SIGNALING_URL || 
  process.argv.find(arg => arg.startsWith('--signaling-url='))?.split('=')[1] ||
  'wss://signal.indexerchain.com';

async function resetGenesis() {
  console.log('🔄 Phase 45: Genesis Reset Script');
  console.log('=====================================\n');
  
  // Step 1: Generate new genesis block
  console.log('Step 1: Generating new genesis block...');
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
    
    ws.on('open', () => {
      console.log('✅ Connected to signaling server');
      console.log('   Sending RESET_ROOT_TIP message...\n');
      
      // Send reset request
      ws.send(JSON.stringify({
        type: 'RESET_ROOT_TIP',
        newGenesisHeader: genesisBlock.header,
        newGenesisHash: genesisBlock.hash,
        newStateCommitment: genesisBlock.header.stateCommitment,
      }));
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'RESET_ROOT_TIP_SUCCESS') {
          console.log('✅ RootTip reset successful!');
          console.log(`   New Genesis Hash: ${message.newGenesisHash}`);
          console.log('');
          console.log('📢 Broadcasting to all connected peers...');
          console.log('   All browsers will automatically reset on next connection.');
          console.log('');
          resolved = true;
          ws.close();
          resolve();
        } else if (message.type === 'error') {
          console.error('❌ Error:', message.message);
          resolved = true;
          ws.close();
          reject(new Error(message.message));
        } else if (message.type === 'JOIN_ACK') {
          // Connection established, but we need to wait for reset response
          console.log('   Connected as node, waiting for reset response...');
        }
      } catch (error) {
        console.error('❌ Failed to parse message:', error);
      }
    });
    
    ws.on('error', (error) => {
      if (!resolved) {
        console.error('❌ WebSocket error:', error.message);
        reject(error);
      }
    });
    
    ws.on('close', () => {
      if (!resolved) {
        console.log('⚠️  Connection closed before receiving response');
        console.log('   This might be normal if the server processed the request.');
        console.log('   Please verify by checking the rootTip manually.');
        resolve();
      }
    });
    
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

// Main execution
console.log('⚠️  WARNING: This will reset the entire network to a new genesis block!');
console.log('   This action is IRREVERSIBLE!\n');

// In production, you might want to add a confirmation prompt
if (process.argv.includes('--confirm')) {
  resetGenesis()
    .then(() => {
      console.log('✅ Genesis reset complete!');
      console.log('');
      console.log('Next steps:');
      console.log('1. Reset Shadow Sessions (if needed):');
      console.log('   curl -X POST https://signal.indexerchain.com/shadow/{sessionId}/reset');
      console.log('');
      console.log('2. Verify reset:');
      console.log('   - Check rootTip height is 0');
      console.log('   - Open browser and verify local height is 0');
      console.log('   - Verify all old blocks and state are cleared');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Genesis reset failed:', error);
      process.exit(1);
    });
} else {
  console.log('⚠️  This script requires --confirm flag to execute.');
  console.log('   Usage: node scripts/reset-genesis.js --confirm');
  console.log('');
  console.log('   Or with custom signaling URL:');
  console.log('   node scripts/reset-genesis.js --confirm --signaling-url=wss://signal.indexerchain.com');
  process.exit(1);
}

