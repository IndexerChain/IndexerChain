/**
 * Chain Initialization and High-level API
 * 
 * Provides a simple API to initialize and manage the chain
 */

import type { ChainParams, Block } from "./types.js";
import { BrowserChainStorage } from "./chainStorage.js";
import { IndexState } from "./indexState.js";
import { createGenesisBlock } from "./genesis.js";
import { verifyBlock } from "./verify.js";
import type { P2PNode } from "./p2p.js";

/**
 * Chain context containing storage, state, parameters, and P2P node
 */
export interface ChainContext {
  storage: BrowserChainStorage;
  indexState: IndexState;
  params: ChainParams;
  p2p?: P2PNode; // Optional P2P node
}

/**
 * Check if chain data needs migration (Phase 5 compatibility check)
 * 
 * Phase 5: Detects old transaction format (without signatures)
 * 
 * @param storage Chain storage
 * @returns true if migration/reset is needed
 */
export function needsMigration(storage: BrowserChainStorage): boolean {
  const blocks = storage.getAllBlocks();
  
  // Check if any transaction is missing Phase 5 fields
  for (const block of blocks) {
    for (const tx of block.txs) {
      // Phase 5 transactions must have ownerAddress, ownerPubKey, and signature
      if (!("ownerAddress" in tx) || !("ownerPubKey" in tx) || !("signature" in tx)) {
        return true; // Old format detected
      }
    }
  }
  
  return false; // All transactions are in Phase 5 format
}

/**
 * Initialize the local chain:
 * 1. Load blocks from localStorage
 * 2. Check for Phase 5 compatibility (migration needed)
 * 3. If no genesis block exists, create and write it
 * 4. Rebuild IndexState by replaying all blocks
 * 
 * @param params Chain parameters
 * @returns Chain context with storage, state, and params, and migration status
 */
export async function initChain(params: ChainParams): Promise<ChainContext & { needsReset?: boolean }> {
  const storage = new BrowserChainStorage();
  let blocks = storage.getAllBlocks();

  // Phase 5: Check if migration is needed
  const needsReset = needsMigration(storage);

  // If chain is empty, create genesis block
  if (blocks.length === 0) {
    const genesis = await createGenesisBlock(params);
    storage.appendBlock(genesis);
    blocks = [genesis];
  }

  // Rebuild index state from all blocks
  const indexState = IndexState.createEmpty();
  indexState.rebuildFromBlocks(blocks);

  return {
    storage,
    indexState,
    params,
    needsReset,
  };
}

/**
 * Get default chain parameters for development
 */
export function getDefaultChainParams(): ChainParams {
  return {
    version: 1,
    networkId: "indexerchain-dev",
    genesisTimestamp: Math.floor(Date.now() / 1000), // Unix timestamp in seconds
    initialDifficulty: 1,
    targetBlockTime: 10, // Target 10 seconds per block
    difficultyAdjustmentInterval: 10, // Adjust difficulty every 10 blocks
    blockReward: 10, // Phase 7: Block reward in IDC
    maxBlockSizeBytes: 1_000_000,
  };
}

/**
 * Append a mined block to the chain
 * 
 * This function:
 * 1. Verifies the block
 * 2. Appends to storage
 * 3. Applies block to index state
 * 4. Saves to persistence
 * 5. Broadcasts block to P2P network (if connected)
 * 
 * @param block Block to append
 * @param context Chain context
 * @returns Success result
 */
export async function appendMinedBlock(
  block: Block,
  context: ChainContext
): Promise<{ success: boolean; error?: string }> {
  // Get previous block
  const prevBlock = context.storage.getTip();

  // Phase 6: Get all blocks for difficulty verification
  const allBlocks = context.storage.getAllBlocks();

  // Verify block (with difficulty verification)
  const verification = await verifyBlock(block, prevBlock, allBlocks, context.params);
  if (!verification.valid) {
    return { success: false, error: verification.error };
  }

  try {
    // Append to storage (this also saves to persistence)
    context.storage.appendBlock(block);

    // Apply block to index state
    context.indexState.applyBlock(block);

    // Broadcast to P2P network
    if (context.p2p && context.p2p.isConnected) {
      context.p2p.broadcast("NEW_BLOCK", block);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Broadcast transaction to P2P network
 * 
 * @param tx Transaction to broadcast
 * @param context Chain context
 */
export function broadcastTransaction(tx: any, context: ChainContext): void {
  if (context.p2p && context.p2p.isConnected) {
    context.p2p.broadcast("NEW_TX", tx);
  }
}

