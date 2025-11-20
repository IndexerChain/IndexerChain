/**
 * Phase 49: Complete Chain Reset Script (Browser Console Version)
 * 
 * This script performs a complete reset of the chain from browser console:
 * 1. Clears all bootstrap blocks from signal server
 * 2. Resets rootTip to new genesis block
 * 3. Clears local storage
 * 
 * Usage:
 *   1. Open browser console (F12)
 *   2. Copy and paste this entire script
 *   3. Press Enter to execute
 */

(async function resetChainComplete() {
  console.log('🔄 Phase 49: Complete Chain Reset Script');
  console.log('==========================================\n');
  console.log('⚠️  WARNING: This will reset the entire chain!');
  console.log('   - All bootstrap blocks will be cleared');
  console.log('   - RootTip will be reset to genesis');
  console.log('   - Local storage will be cleared\n');
  
  try {
    // Step 1: Clear bootstrap blocks
    console.log('Step 1: Clearing bootstrap blocks from signal server...');
    try {
      const clearResponse = await fetch('https://signal.indexerchain.com/admin/clear-bootstrap-blocks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      const clearResult = await clearResponse.json();
      
      if (clearResult.ok) {
        console.log(`✅ Cleared ${clearResult.deleted || 0} bootstrap blocks (height ${clearResult.from || 0}-${clearResult.to || 0})`);
      } else {
        console.log('⚠️  Failed to clear bootstrap blocks:', clearResult.error || clearResult.reason);
        console.log('   Continuing with rootTip reset...\n');
      }
    } catch (error) {
      console.log('⚠️  Error clearing bootstrap blocks:', error);
      console.log('   Continuing with rootTip reset...\n');
    }
    
    // Step 2: Generate new genesis block
    console.log('Step 2: Generating new genesis block...');
    
    // Try multiple import paths for different environments
    let createGenesisBlock, MAINNET_PARAMS;
    let importError = null;
    
    // Try Vite dev server path first
    try {
      const genModule = await import('/src/core/genesis.js?import');
      const paramsModule = await import('/src/core/networkParams.js?import');
      createGenesisBlock = genModule.createGenesisBlock;
      MAINNET_PARAMS = paramsModule.MAINNET_PARAMS;
    } catch (e1) {
      importError = e1;
      // Try without ?import
      try {
        const genModule = await import('/src/core/genesis.js');
        const paramsModule = await import('/src/core/networkParams.js');
        createGenesisBlock = genModule.createGenesisBlock;
        MAINNET_PARAMS = paramsModule.MAINNET_PARAMS;
      } catch (e2) {
        // Try relative path from current location
        try {
          const baseUrl = window.location.origin;
          const genModule = await import(`${baseUrl}/src/core/genesis.js`);
          const paramsModule = await import(`${baseUrl}/src/core/networkParams.js`);
          createGenesisBlock = genModule.createGenesisBlock;
          MAINNET_PARAMS = paramsModule.MAINNET_PARAMS;
        } catch (e3) {
          console.error('❌ Failed to import modules:', e3);
          throw new Error(`Cannot import genesis modules. Tried multiple paths. Last error: ${e3.message}. Please ensure the app is fully loaded.`);
        }
      }
    }
    
    const params = MAINNET_PARAMS;
    const genesisBlock = await createGenesisBlock(params);
    
    console.log('✅ New Genesis Block Generated:');
    console.log(`   Hash: ${genesisBlock.hash}`);
    console.log(`   Timestamp: ${new Date(params.genesisTimestamp * 1000).toISOString()}`);
    console.log(`   State Commitment: ${genesisBlock.header.stateCommitment?.substring(0, 32)}...`);
    console.log('');
    
    // Step 3: Reset rootTip
    console.log('Step 3: Resetting rootTip on signaling server...');
    const SIGNALING_URL = 'wss://signal.indexerchain.com';
    
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(SIGNALING_URL);
      let resolved = false;
      let nodeId = null;
      let joined = false;
      
      ws.onopen = () => {
        console.log('✅ Connected to signaling server');
        nodeId = `reset_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        ws.send(JSON.stringify({ type: 'join', nodeId: nodeId }));
      };
      
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        if ((message.type === 'JOIN_ACK' || message.type === 'peers') && !joined) {
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
          resolved = true;
          ws.close();
          resolve(message);
        } else if (message.type === 'error') {
          console.error('❌ Error:', message.message);
          resolved = true;
          ws.close();
          reject(new Error(message.message));
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
          console.log('⚠️  Connection closed');
          resolve();
        }
      };
      
      setTimeout(() => {
        if (!resolved) {
          console.error('❌ Timeout');
          ws.close();
          reject(new Error('Timeout'));
        }
      }, 30000);
    });
    
    // Step 4: Clear local storage
    console.log('\nStep 4: Clearing local storage...');
    const keysToRemove = [
      'indexerchain_blocks_v1',
      'indexerchain_snapshots_meta_v1',
      'indexerchain_snapshot_v1_',
      'indexerchain_session_duration',
      'indexerchain_consecutive_days',
      'indexerchain_last_active_date',
      'indexerchain_device_id',
      'indexerchain_ice_servers',
    ];
    
    let cleared = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (
        keysToRemove.some(k => key.startsWith(k)) ||
        key.includes('indexerchain')
      )) {
        localStorage.removeItem(key);
        cleared++;
      }
    }
    
    console.log(`✅ Cleared ${cleared} localStorage items`);
    console.log('');
    console.log('✅ Complete chain reset finished!');
    console.log('');
    console.log('📋 Next Steps:');
    console.log('1. Refresh the page to see the reset');
    console.log('2. Verify:');
    console.log('   - RootTip height is 0');
    console.log('   - Local height is 0');
    console.log('   - Bootstrap blocks range is empty');
    
  } catch (error) {
    console.error('❌ Chain reset failed:', error);
    throw error;
  }
})();

