/**
 * Phase 49: Simple Signal Server Reset Script
 * 
 * Resets signal server via HTTP API (no local module imports needed)
 * 
 * Usage:
 *   node scripts/reset-signal-server-simple.js
 * 
 * This script will:
 * 1. Clear all bootstrap blocks
 * 2. Reset rootTip using default genesis (or you can provide custom genesis data)
 */

const SIGNALING_HTTP = 'https://signal.indexerchain.com';

// Default genesis block (matches MAINNET_PARAMS)
// You can modify these values if needed
const DEFAULT_GENESIS = {
  header: {
    version: 1,
    height: 0,
    prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
    merkleRoot: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // SHA256 of empty string
    timestamp: Math.floor(Date.now() / 1000), // Current timestamp
    difficulty: 1,
    nonce: 0,
  },
  hash: "", // Will be computed, but for reset we can use empty or placeholder
  stateCommitment: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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

async function resetRootTip(genesisData) {
  console.log('Step 2: Resetting rootTip...');
  
  // Ensure we have a valid hash
  let genesisHash = genesisData.hash;
  if (!genesisHash || genesisHash === '' || genesisHash.length !== 64) {
    // Try to generate genesis block properly
    console.log('   ⚠️  Hash missing or invalid, attempting to generate from params...');
    try {
      // Try to run generate-genesis script
      const { execSync } = await import('child_process');
      try {
        const output = execSync('npx tsx scripts/generate-genesis.js', { 
          encoding: 'utf-8',
          cwd: process.cwd(),
          stdio: 'pipe'
        });
        const generated = JSON.parse(output.trim());
        genesisHash = generated.hash;
        genesisData.header = generated.header;
        genesisData.stateCommitment = generated.stateCommitment;
        console.log('   ✅ Generated correct genesis block');
      } catch (e) {
        // Fallback: compute hash from header (may not match actual genesis)
        console.log('   ⚠️  Using computed hash (may not match actual genesis)');
        const crypto = await import('crypto');
        const headerStr = JSON.stringify(genesisData.header);
        genesisHash = crypto.createHash('sha256').update(headerStr).digest('hex');
      }
    } catch (error) {
      console.error('   ❌ Could not generate hash:', error.message);
      throw new Error('Invalid genesis hash');
    }
  }
  
  try {
    const response = await fetch(`${SIGNALING_HTTP}/admin/reset-root-tip-http`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newGenesisHeader: genesisData.header,
        newGenesisHash: genesisHash,
        newStateCommitment: genesisData.stateCommitment,
      }),
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ RootTip reset successful!');
      console.log(`   Genesis Hash: ${result.newGenesisHash || genesisHash.substring(0, 32)}...`);
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
  console.log('🔄 Phase 49: Signal Server Reset');
  console.log('=================================\n');
  console.log('⚠️  WARNING: This will reset the signal server!');
  console.log('   - All bootstrap blocks will be cleared');
  console.log('   - RootTip will be reset to genesis\n');
  
  // Use default genesis or allow override via environment
  const genesisData = {
    ...DEFAULT_GENESIS,
    header: {
      ...DEFAULT_GENESIS.header,
      timestamp: Math.floor(Date.now() / 1000), // Use current time
    },
  };
  
  console.log('Using genesis block:');
  console.log(`   Height: ${genesisData.header.height}`);
  console.log(`   Timestamp: ${new Date(genesisData.header.timestamp * 1000).toISOString()}`);
  console.log(`   Difficulty: ${genesisData.header.difficulty}`);
  console.log('');
  
  const cleared = await clearBootstrapBlocks();
  if (!cleared) {
    console.log('⚠️  Continuing despite clear failure...\n');
  }
  
  const reset = await resetRootTip(genesisData);
  
  if (reset) {
    console.log('');
    console.log('✅ Signal server reset complete!');
    console.log('');
    console.log('📋 Next Steps:');
    console.log('1. Browsers will receive reset notification automatically');
    console.log('2. Users should clear localStorage: localStorage.clear()');
    console.log('3. Refresh browser to see reset');
  } else {
    console.error('❌ Reset failed');
    process.exit(1);
  }
}

main().catch(console.error);

