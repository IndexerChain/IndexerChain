/**
 * Phase 49: Reset Signal Server Script
 * 
 * This script resets the signal server directly via HTTP API:
 * 1. Clears all bootstrap blocks
 * 2. Resets rootTip to new genesis block (via HTTP API)
 * 
 * Usage:
 *   node scripts/reset-signal-server.js [genesisHash] [genesisHeaderJSON] [stateCommitment]
 * 
 * Or provide genesis data via environment variables or stdin
 */

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
    console.error('❌ Error clearing bootstrap blocks:', error.message);
    return false;
  }
}

async function resetRootTipHTTP(genesisData) {
  console.log('Step 2: Resetting rootTip via HTTP API...');
  
  try {
    const response = await fetch(`${SIGNALING_HTTP}/admin/reset-root-tip-http`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        newGenesisHeader: genesisData.header,
        newGenesisHash: genesisData.hash,
        newStateCommitment: genesisData.stateCommitment,
      }),
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ RootTip reset successful!');
      console.log(`   New Genesis Hash: ${result.newGenesisHash}`);
      return true;
    } else {
      console.error('❌ Failed to reset rootTip:', result.error || result.message);
      return false;
    }
  } catch (error) {
    console.error('❌ Error resetting rootTip:', error.message);
    return false;
  }
}

// Default genesis block data (can be overridden)
const DEFAULT_GENESIS = {
  header: {
    version: 1,
    height: 0,
    prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
    merkleRoot: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    timestamp: Math.floor(Date.now() / 1000),
    difficulty: 1,
    nonce: 0,
  },
  hash: "0000000000000000000000000000000000000000000000000000000000000000",
  stateCommitment: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};

async function generateGenesisFromParams() {
  // Try to use tsx to run TypeScript and generate genesis
  const { execSync } = await import('child_process');
  const { promisify } = await import('util');
  const exec = promisify(execSync);
  
  try {
    console.log('   Generating genesis block from network params...');
    // Create a temporary script to generate genesis
    const fs = await import('fs');
    const path = await import('path');
    
    const tempScript = `
import { createGenesisBlock } from '../src/core/genesis.js';
import { MAINNET_PARAMS } from '../src/core/networkParams.js';

const params = MAINNET_PARAMS;
const genesisBlock = await createGenesisBlock(params);
console.log(JSON.stringify({
  header: genesisBlock.header,
  hash: genesisBlock.hash,
  stateCommitment: genesisBlock.header.stateCommitment,
}));
`;
    
    const tempPath = path.join(process.cwd(), 'scripts', 'temp-genesis.mjs');
    fs.writeFileSync(tempPath, tempScript);
    
    try {
      // Try with tsx
      const output = execSync(`npx tsx scripts/temp-genesis.mjs`, { encoding: 'utf-8', cwd: process.cwd() });
      const genesisData = JSON.parse(output.trim());
      fs.unlinkSync(tempPath);
      return genesisData;
    } catch (e) {
      // Fallback: use default
      console.log('   ⚠️  Could not generate genesis from params, using default');
      fs.unlinkSync(tempPath);
      return DEFAULT_GENESIS;
    }
  } catch (error) {
    console.log('   ⚠️  Using default genesis block');
    return DEFAULT_GENESIS;
  }
}

async function main() {
  console.log('🔄 Phase 49: Signal Server Reset Script');
  console.log('========================================\n');
  console.log('⚠️  WARNING: This will reset the signal server!');
  console.log('   - All bootstrap blocks will be cleared');
  console.log('   - RootTip will be reset to genesis');
  console.log('   - All connected browsers will receive reset notification\n');
  
  const args = process.argv.slice(2);
  
  let genesisData;
  
  if (args.length >= 3) {
    // Provided via command line
    const [hash, headerJson, stateCommitment] = args;
    try {
      genesisData = {
        hash,
        header: JSON.parse(headerJson),
        stateCommitment,
      };
      console.log('✅ Using provided genesis data');
    } catch (error) {
      console.error('❌ Invalid genesis data format:', error.message);
      process.exit(1);
    }
  } else {
    // Try to generate from params
    console.log('Step 0: Generating genesis block...');
    genesisData = await generateGenesisFromParams();
  }
  
  console.log(`   Genesis Hash: ${genesisData.hash.substring(0, 32)}...`);
  console.log(`   Timestamp: ${new Date(genesisData.header.timestamp * 1000).toISOString()}`);
  console.log(`   State Commitment: ${genesisData.stateCommitment?.substring(0, 32)}...`);
  console.log('');
  
  // Step 1: Clear bootstrap blocks
  const cleared = await clearBootstrapBlocks();
  if (!cleared) {
    console.log('⚠️  Continuing with rootTip reset despite bootstrap clear failure...\n');
  }
  
  // Step 2: Reset rootTip
  const reset = await resetRootTipHTTP(genesisData);
  
  if (reset) {
    console.log('');
    console.log('✅ Signal server reset complete!');
    console.log('');
    console.log('📋 Next Steps:');
    console.log('1. All browsers will automatically receive reset notification');
    console.log('2. Browsers should clear localStorage and refresh');
    console.log('3. Verify reset:');
    console.log('   - Check rootTip height is 0');
    console.log('   - Check bootstrap blocks range is empty');
  } else {
    console.error('❌ Signal server reset failed');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

