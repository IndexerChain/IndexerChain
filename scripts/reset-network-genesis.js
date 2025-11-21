/**
 * Reset Network to New Genesis
 * 
 * Resets signal server rootTip to genesis (height 0)
 * 
 * Usage:
 *   node scripts/reset-network-genesis.js
 */

const SIGNALING_HTTP = 'https://signal.indexerchain.com';

// Genesis block data (generated from generate-genesis.js)
const GENESIS_DATA = {
  header: {
    version: 1,
    height: 0,
    prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
    merkleRoot: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    timestamp: 1710000000,
    difficulty: 1,
    nonce: 0,
    stateCommitment: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
  },
  hash: "7273108f9aa4e978b6d5fdf59b5fc99061dc14329445d17bf7586698b2bedf79",
  stateCommitment: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
};

async function clearBootstrapBlocks() {
  console.log('Step 1: Clearing bootstrap blocks...');
  
  try {
    const response = await fetch(`${SIGNALING_HTTP}/admin/clear-bootstrap-blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ Cleared ${result.deleted || 0} bootstrap blocks`);
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

async function resetRootTip() {
  console.log('Step 2: Resetting rootTip to genesis...');
  console.log(`   Genesis Hash: ${GENESIS_DATA.hash.substring(0, 32)}...`);
  console.log(`   Height: ${GENESIS_DATA.header.height}`);
  console.log(`   Timestamp: ${new Date(GENESIS_DATA.header.timestamp * 1000).toISOString()}`);
  
  try {
    const response = await fetch(`${SIGNALING_HTTP}/admin/reset-root-tip-http`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newGenesisHeader: GENESIS_DATA.header,
        newGenesisHash: GENESIS_DATA.hash,
        newStateCommitment: GENESIS_DATA.stateCommitment,
      }),
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ RootTip reset successful!');
      console.log(`   New Genesis Hash: ${result.newGenesisHash || GENESIS_DATA.hash.substring(0, 32)}...`);
      return true;
    } else {
      console.error('❌ Failed:', result.error || result.message);
      return false;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

async function main() {
  console.log('🔄 Reset Network to New Genesis');
  console.log('================================\n');
  console.log('⚠️  WARNING: This will reset the signal server!');
  console.log('   - All bootstrap blocks will be cleared');
  console.log('   - RootTip will be reset to genesis (height 0)');
  console.log('   - All nodes will need to sync from genesis\n');
  
  const cleared = await clearBootstrapBlocks();
  if (!cleared) {
    console.log('⚠️  Continuing despite clear failure...\n');
  }
  
  const reset = await resetRootTip();
  
  if (reset) {
    console.log('');
    console.log('✅ Network reset complete!');
    console.log('');
    console.log('📋 Next Steps:');
    console.log('1. All connected nodes will receive ROOT_TIP_UPDATE automatically');
    console.log('2. Users should clear localStorage: localStorage.clear()');
    console.log('3. Refresh browser to start from genesis');
    console.log('4. Node B can start mining immediately from height 0');
    console.log('5. Node A will sync and follow Node B in real-time');
  } else {
    console.error('❌ Reset failed');
    process.exit(1);
  }
}

main().catch(console.error);

