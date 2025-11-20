/**
 * Phase 49: Test Reset Script
 * 
 * Simple test script to verify reset functionality
 */

import WebSocket from 'ws';

const SIGNALING_URL = 'wss://signal.indexerchain.com';
const SIGNALING_HTTP = 'https://signal.indexerchain.com';

async function testClearBootstrapBlocks() {
  console.log('🧪 Testing: Clear Bootstrap Blocks');
  console.log('=====================================\n');
  
  try {
    const response = await fetch(`${SIGNALING_HTTP}/admin/clear-bootstrap-blocks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ Success: Cleared ${result.deleted || 0} blocks (height ${result.from || 0}-${result.to || 0})`);
      return true;
    } else {
      console.error('❌ Failed:', result.error || result.reason);
      return false;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

async function testBootstrapBlocksStatus() {
  console.log('\n🧪 Testing: Bootstrap Blocks Status');
  console.log('=====================================\n');
  
  try {
    const response = await fetch(`${SIGNALING_HTTP}/bootstrap-blocks?from=1&to=10`);
    const result = await response.json();
    
    console.log('Response:', JSON.stringify(result, null, 2));
    
    if (result.ok === false && result.reason === 'NO_BOOTSTRAP_BLOCKS') {
      console.log('✅ Bootstrap blocks are cleared (as expected)');
      return true;
    } else if (result.ok === true && result.blocks) {
      console.log(`⚠️  Found ${result.blocks.length} blocks (range: ${result.availableFromHeight}-${result.availableToHeight})`);
      return false;
    } else {
      console.log('⚠️  Unexpected response');
      return false;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

async function testWebSocketConnection() {
  console.log('\n🧪 Testing: WebSocket Connection');
  console.log('=====================================\n');
  
  return new Promise((resolve) => {
    const ws = new WebSocket(SIGNALING_URL);
    let connected = false;
    
    ws.on('open', () => {
      console.log('✅ WebSocket connected');
      connected = true;
      ws.close();
      resolve(true);
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      resolve(false);
    });
    
    ws.on('close', () => {
      if (connected) {
        console.log('✅ WebSocket closed normally');
      }
    });
    
    setTimeout(() => {
      if (!connected) {
        console.error('❌ WebSocket connection timeout');
        ws.close();
        resolve(false);
      }
    }, 5000);
  });
}

async function main() {
  console.log('🧪 Phase 49: Reset Functionality Test');
  console.log('==========================================\n');
  
  const results = {
    clearBlocks: false,
    verifyCleared: false,
    websocket: false,
  };
  
  // Test 1: Clear bootstrap blocks
  results.clearBlocks = await testClearBootstrapBlocks();
  
  // Test 2: Verify blocks are cleared
  results.verifyCleared = await testBootstrapBlocksStatus();
  
  // Test 3: Test WebSocket connection
  results.websocket = await testWebSocketConnection();
  
  // Summary
  console.log('\n📊 Test Summary');
  console.log('=====================================');
  console.log(`Clear Bootstrap Blocks: ${results.clearBlocks ? '✅' : '❌'}`);
  console.log(`Verify Cleared: ${results.verifyCleared ? '✅' : '❌'}`);
  console.log(`WebSocket Connection: ${results.websocket ? '✅' : '❌'}`);
  console.log('');
  
  if (results.clearBlocks && results.verifyCleared && results.websocket) {
    console.log('✅ All tests passed! Reset functionality is working.');
    console.log('\n💡 Next step: Use reset-chain-complete.js or reset-chain-browser.js to perform full reset.');
  } else {
    console.log('⚠️  Some tests failed. Please check the errors above.');
  }
}

main().catch(console.error);

