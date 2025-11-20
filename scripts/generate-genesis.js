/**
 * Phase 49: Generate Genesis Block Data
 * 
 * Generates correct genesis block data for reset
 * 
 * Usage:
 *   npx tsx scripts/generate-genesis.js
 *   or
 *   node scripts/generate-genesis.js (after build)
 */

async function generateGenesis() {
  try {
    // Try to import from source (with tsx) or dist (after build)
    let createGenesisBlock, MAINNET_PARAMS;
    
    try {
      // Try source first (requires tsx)
      const genModule = await import('../src/core/genesis.js');
      const paramsModule = await import('../src/core/networkParams.js');
      createGenesisBlock = genModule.createGenesisBlock;
      MAINNET_PARAMS = paramsModule.MAINNET_PARAMS;
    } catch (e1) {
      try {
        // Try dist (after build)
        const genModule = await import('../dist/core/genesis.js');
        const paramsModule = await import('../dist/core/networkParams.js');
        createGenesisBlock = genModule.createGenesisBlock;
        MAINNET_PARAMS = paramsModule.MAINNET_PARAMS;
      } catch (e2) {
        console.error('❌ Cannot import modules. Please run: npm run build');
        console.error('   Or install tsx: npm install -D tsx');
        process.exit(1);
      }
    }
    
    const params = MAINNET_PARAMS;
    const genesisBlock = await createGenesisBlock(params);
    
    const genesisData = {
      header: genesisBlock.header,
      hash: genesisBlock.hash,
      stateCommitment: genesisBlock.header.stateCommitment,
    };
    
    console.log(JSON.stringify(genesisData, null, 2));
    return genesisData;
  } catch (error) {
    console.error('❌ Failed to generate genesis:', error);
    process.exit(1);
  }
}

generateGenesis();

