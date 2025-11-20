/**
 * Phase 49: Verify Reset Status
 * 
 * Script to verify that chain reset was successful
 */

const SIGNALING_HTTP = 'https://signal.indexerchain.com';

async function checkBootstrapBlocks() {
  console.log('📋 Checking Bootstrap Blocks Status...');
  try {
    const response = await fetch(`${SIGNALING_HTTP}/bootstrap-blocks?from=1&to=10`);
    const result = await response.json();
    
    if (result.ok === false && result.reason === 'NO_BOOTSTRAP_BLOCKS') {
      console.log('  ✅ Bootstrap blocks are cleared');
      console.log(`     Range: ${result.availableFromHeight}-${result.availableToHeight}`);
      return true;
    } else {
      console.log('  ⚠️  Bootstrap blocks still exist');
      console.log(`     Range: ${result.availableFromHeight}-${result.availableToHeight}`);
      if (result.blocks) {
        console.log(`     Found ${result.blocks.length} blocks`);
      }
      return false;
    }
  } catch (error) {
    console.error('  ❌ Error checking bootstrap blocks:', error.message);
    return false;
  }
}

async function checkRootTip() {
  console.log('\n📋 Checking RootTip Status...');
  console.log('  (Note: RootTip check requires WebSocket connection)');
  console.log('  💡 Open browser console and check ROOT_TIP_UPDATE message');
  console.log('     Expected: latestHeight should be 0');
}

async function main() {
  console.log('🔍 Phase 49: Reset Verification');
  console.log('================================\n');
  
  const bootstrapCleared = await checkBootstrapBlocks();
  await checkRootTip();
  
  console.log('\n📊 Verification Summary');
  console.log('================================');
  console.log(`Bootstrap Blocks Cleared: ${bootstrapCleared ? '✅' : '❌'}`);
  console.log('');
  
  if (bootstrapCleared) {
    console.log('✅ Reset verification passed!');
    console.log('\n💡 To complete reset:');
    console.log('   1. Run reset-chain-browser.js in browser console');
    console.log('   2. Or manually clear localStorage and reset rootTip');
  } else {
    console.log('⚠️  Some checks failed. Please verify manually.');
  }
}

main().catch(console.error);

