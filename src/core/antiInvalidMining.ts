/**
 * Phase 31: Anti-Invalid-Mining Mechanism
 * 
 * Prevents invalid mining by:
 * 1. Wrong-Nonce Detection
 * 2. Invalid-Header Pre-Check
 * 3. Double-Header Protection
 */

import type { Block, BlockHeader } from "./types.js";
import type { ChainContext } from "./chain.js";
import { hashBlockHeader } from "./crypto.js";
import { calcMerkleRoot } from "./merkle.js";
import { logger } from "./logger.js";

/**
 * Mining epoch tracking
 */
interface MiningEpoch {
  tipHash: string;
  height: number;
  timestamp: number;
}

/**
 * Header validation result
 */
export interface HeaderValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Anti-Invalid-Mining Manager
 */
export class AntiInvalidMining {
  private currentMiningEpoch: MiningEpoch | null = null;
  private lastValidatedHeader: BlockHeader | null = null;

  constructor(private chainContext: ChainContext) {}

  /**
   * Start mining epoch (called when mining starts)
   */
  startMiningEpoch(): void {
    const tip = this.chainContext.storage.getTip();
    if (!tip) {
      throw new Error("Cannot start mining epoch: no tip block");
    }

    this.currentMiningEpoch = {
      tipHash: tip.hash,
      height: tip.header.height,
      timestamp: Date.now(),
    };

    logger.debug(`[Phase 31] Started mining epoch at height ${tip.header.height}, tipHash: ${tip.hash.substring(0, 16)}...`);
  }

  /**
   * Stop mining epoch (called when mining stops)
   */
  stopMiningEpoch(): void {
    if (this.currentMiningEpoch) {
      logger.debug(`[Phase 31] Stopped mining epoch at height ${this.currentMiningEpoch.height}`);
      this.currentMiningEpoch = null;
    }
  }

  /**
   * Check if mining should be stopped due to new block
   */
  shouldStopMining(): boolean {
    if (!this.currentMiningEpoch) {
      return false;
    }

    const tip = this.chainContext.storage.getTip();
    if (!tip) {
      return false;
    }

    // If tip hash changed, we're mining on an old block
    if (tip.hash !== this.currentMiningEpoch.tipHash) {
      console.warn(`[Phase 31] Tip hash changed during mining. Old: ${this.currentMiningEpoch.tipHash.substring(0, 16)}..., New: ${tip.hash.substring(0, 16)}...`);
      return true;
    }

    // If height increased, we're mining on an old block
    if (tip.header.height > this.currentMiningEpoch.height) {
      console.warn(`[Phase 31] Tip height increased during mining. Old: ${this.currentMiningEpoch.height}, New: ${tip.header.height}`);
      return true;
    }

    return false;
  }

  /**
   * Validate block header before mining
   */
  async validateHeaderBeforeMining(candidateBlock: Block): Promise<HeaderValidationResult> {
    const errors: string[] = [];
    const tip = this.chainContext.storage.getTip();

    if (!tip) {
      errors.push("No tip block found");
      return { valid: false, errors };
    }

    // Check 1: prevHash must match tip hash
    if (candidateBlock.header.prevHash !== tip.hash) {
      errors.push(`prevHash mismatch: expected ${tip.hash.substring(0, 16)}..., got ${candidateBlock.header.prevHash.substring(0, 16)}...`);
    }

    // Check 2: Height must be tip.height + 1
    const expectedHeight = tip.header.height + 1;
    if (candidateBlock.header.height !== expectedHeight) {
      errors.push(`Height mismatch: expected ${expectedHeight}, got ${candidateBlock.header.height}`);
    }

    // Check 3: Timestamp must be reasonable (not too old, not too far in future)
    const now = Math.floor(Date.now() / 1000);
    const maxFutureTime = now + 60; // Allow 60 seconds in future
    const minPastTime = tip.header.timestamp; // Must be after previous block

    if (candidateBlock.header.timestamp < minPastTime) {
      errors.push(`Timestamp too old: ${candidateBlock.header.timestamp} < ${minPastTime}`);
    }
    if (candidateBlock.header.timestamp > maxFutureTime) {
      errors.push(`Timestamp too far in future: ${candidateBlock.header.timestamp} > ${maxFutureTime}`);
    }

    // Check 4: Merkle root must match transactions
    const txIds = candidateBlock.txs.map(tx => tx.txId);
    const expectedMerkleRoot = await calcMerkleRoot(txIds);
    if (candidateBlock.header.merkleRoot !== expectedMerkleRoot) {
      errors.push(`Merkle root mismatch: expected ${expectedMerkleRoot.substring(0, 16)}..., got ${candidateBlock.header.merkleRoot.substring(0, 16)}...`);
    }

    // Check 5: Difficulty must match expected
    const allBlocks = this.chainContext.storage.getAllBlocks();
    const { getNextDifficulty } = await import("./difficulty.js");
    const expectedDifficulty = getNextDifficulty(allBlocks, this.chainContext.params);
    if (candidateBlock.header.difficulty !== expectedDifficulty) {
      errors.push(`Difficulty mismatch: expected ${expectedDifficulty}, got ${candidateBlock.header.difficulty}`);
    }

    // Check 6: State commitment must be computed (if enabled)
    if (this.chainContext.params.version >= 1) {
      // State commitment is optional but should be present if computed
      // We'll validate it's correct in blockBuilder, so just check it exists
      if (!candidateBlock.header.stateCommitment) {
        // This is a warning, not an error, as state commitment might be computed later
        console.warn("[Phase 31] Block header missing stateCommitment");
      }
    }

    // Check 7: Verify this isn't a duplicate header we've seen before
    if (this.lastValidatedHeader) {
      const lastHeaderHash = await hashBlockHeader({ ...this.lastValidatedHeader, nonce: this.lastValidatedHeader.nonce || 0 });
      const candidateHeaderHash = await hashBlockHeader({ ...candidateBlock.header, nonce: candidateBlock.header.nonce || 0 });
      
      if (lastHeaderHash === candidateHeaderHash && candidateBlock.header.height === this.lastValidatedHeader.height) {
        errors.push("Duplicate header detected (same header as previous mining attempt)");
      }
    }

    const valid = errors.length === 0;
    
    if (valid) {
      // Store last validated header
      this.lastValidatedHeader = { ...candidateBlock.header };
    }

    return { valid, errors };
  }

  /**
   * Validate nonce range (for cluster mining)
   */
  validateNonceRange(nonceStart: bigint, nonceEnd: bigint, delegatorSignature?: string): boolean {
    // Check 1: Nonce range must be valid
    if (nonceStart >= nonceEnd) {
      console.error("[Phase 31] Invalid nonce range: start >= end");
      return false;
    }

    // Check 2: Nonce range must not be too large (prevent abuse)
    const maxRange = BigInt(Number.MAX_SAFE_INTEGER);
    if (nonceEnd - nonceStart > maxRange) {
      console.error("[Phase 31] Nonce range too large");
      return false;
    }

    // Check 3: If delegator signature provided, verify it
    // This would require delegator public key and signature verification
    // For now, we'll just check that signature exists if delegator is used
    if (delegatorSignature) {
      // TODO: Verify ECDSA signature from delegator
      // This requires delegator public key and signature verification logic
      logger.debug("[Phase 31] Delegator signature provided (verification not yet implemented)");
    }

    return true;
  }

  /**
   * Get current mining epoch
   */
  getCurrentMiningEpoch(): MiningEpoch | null {
    return this.currentMiningEpoch;
  }
}

