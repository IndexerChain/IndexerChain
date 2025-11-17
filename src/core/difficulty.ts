/**
 * Dynamic Difficulty Adjustment
 * 
 * Phase 6: Adjusts mining difficulty to maintain target block time
 * 
 * Algorithm:
 * - Every N blocks (difficultyAdjustmentInterval), adjust difficulty
 * - Based on actual time vs expected time for the last N blocks
 * - Clamp adjustment to ±20% per interval
 * - Minimum difficulty is 1
 */

import type { Block, ChainParams, DifficultyAdjustmentResult } from "./types.js";

/**
 * Calculate next difficulty based on recent block times
 * 
 * Formula:
 * - actualTime = time taken for last N blocks
 * - expectedTime = targetBlockTime * N
 * - ratio = actualTime / expectedTime
 * - newDifficulty = oldDifficulty * ratio (clamped to ±20%)
 * 
 * @param blocks All blocks in the chain (ordered by height)
 * @param params Chain parameters
 * @returns New difficulty value
 */
export function getNextDifficulty(
  blocks: Block[],
  params: ChainParams
): number {
  const currentHeight = blocks.length - 1;

  // If chain is too short, use initial difficulty
  if (currentHeight < 0) {
    return params.initialDifficulty;
  }

  // If height is less than adjustment interval, use initial difficulty
  if (currentHeight < params.difficultyAdjustmentInterval) {
    return params.initialDifficulty;
  }

  // Get the last N blocks (where N = difficultyAdjustmentInterval)
  const interval = params.difficultyAdjustmentInterval;
  const recentBlocks = blocks.slice(-interval);

  if (recentBlocks.length < 2) {
    // Not enough blocks, use current difficulty
    return blocks[blocks.length - 1].header.difficulty;
  }

  // Calculate actual time taken for these blocks
  const firstBlock = recentBlocks[0];
  const lastBlock = recentBlocks[recentBlocks.length - 1];
  const actualTime = lastBlock.header.timestamp - firstBlock.header.timestamp;

  // Calculate expected time
  const expectedTime = params.targetBlockTime * interval;

  // Calculate ratio
  const ratio = actualTime / expectedTime;

  // Get current difficulty
  const currentDifficulty = lastBlock.header.difficulty;

  // Calculate raw new difficulty
  const rawDifficulty = currentDifficulty * ratio;

  // Clamp to ±20% change
  const minDifficulty = currentDifficulty * 0.8;
  const maxDifficulty = currentDifficulty * 1.2;
  const clampedDifficulty = Math.max(minDifficulty, Math.min(maxDifficulty, rawDifficulty));

  // Round to integer and ensure minimum of 1
  const newDifficulty = Math.max(1, Math.round(clampedDifficulty));

  return newDifficulty;
}

/**
 * Explain difficulty change (for UI/debugging)
 * 
 * @param blocks All blocks in the chain
 * @param params Chain parameters
 * @returns Explanation of difficulty adjustment
 */
export function explainDifficultyChange(
  blocks: Block[],
  params: ChainParams
): DifficultyAdjustmentResult {
  const currentHeight = blocks.length - 1;

  if (currentHeight < 0) {
    return {
      newDifficulty: params.initialDifficulty,
      reason: "Genesis block - using initial difficulty",
    };
  }

  if (currentHeight < params.difficultyAdjustmentInterval) {
    return {
      newDifficulty: params.initialDifficulty,
      reason: `Height ${currentHeight} < interval ${params.difficultyAdjustmentInterval} - using initial difficulty`,
    };
  }

  const currentDifficulty = blocks[blocks.length - 1].header.difficulty;
  const newDifficulty = getNextDifficulty(blocks, params);

  const interval = params.difficultyAdjustmentInterval;
  const recentBlocks = blocks.slice(-interval);
  const firstBlock = recentBlocks[0];
  const lastBlock = recentBlocks[recentBlocks.length - 1];
  const actualTime = lastBlock.header.timestamp - firstBlock.header.timestamp;
  const expectedTime = params.targetBlockTime * interval;
  const ratio = actualTime / expectedTime;

  let reason = `Last ${interval} blocks: ${actualTime}s actual vs ${expectedTime}s expected (ratio: ${ratio.toFixed(2)}). `;
  
  if (newDifficulty > currentDifficulty) {
    reason += `Difficulty increased from ${currentDifficulty} to ${newDifficulty} (blocks too slow)`;
  } else if (newDifficulty < currentDifficulty) {
    reason += `Difficulty decreased from ${currentDifficulty} to ${newDifficulty} (blocks too fast)`;
  } else {
    reason += `Difficulty unchanged at ${newDifficulty}`;
  }

  return {
    newDifficulty,
    reason,
  };
}

/**
 * Get average block time for recent blocks
 * 
 * @param blocks Recent blocks
 * @returns Average block time in seconds, or null if not enough blocks
 */
export function getAverageBlockTime(blocks: Block[]): number | null {
  if (blocks.length < 2) {
    return null;
  }

  const firstBlock = blocks[0];
  const lastBlock = blocks[blocks.length - 1];
  const totalTime = lastBlock.header.timestamp - firstBlock.header.timestamp;
  const blockCount = blocks.length - 1; // Number of intervals

  if (blockCount === 0) {
    return null;
  }

  return totalTime / blockCount;
}

/**
 * Get blocks until next difficulty adjustment
 * 
 * @param currentHeight Current chain height
 * @param interval Difficulty adjustment interval
 * @returns Number of blocks until next adjustment
 */
export function getBlocksUntilAdjustment(
  currentHeight: number,
  interval: number
): number {
  if (currentHeight < 0) {
    return interval;
  }

  const nextAdjustmentHeight =
    Math.floor(currentHeight / interval) * interval + interval;
  return nextAdjustmentHeight - currentHeight;
}

