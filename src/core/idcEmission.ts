/**
 * IDC Emission Model
 * 
 * Phase 16: Bitcoin-like halving emission schedule
 * 
 * Total Supply: 1 billion IDC
 * Emission Period: 100 years (10 eras, each 10 years)
 * Block Time: ~10 seconds
 * 
 * Emission curve: Each era halves the block reward
 * - Era 0 (0-10 years): ~15.87 IDC per block
 * - Era 1 (10-20 years): ~7.94 IDC per block
 * - ...
 * - Era 9 (90-100 years): ~0.031 IDC per block
 * 
 * All calculations use pure integer arithmetic (BigInt) for millisecond performance.
 */

/**
 * IDC Currency Constants
 */
export const IDC_DECIMALS = 6; // 1 IDC = 10^6 uIDC (micro IDC)
export const IDC_MAX_SUPPLY = 1_000_000_000n * 10n ** BigInt(IDC_DECIMALS); // 1 billion IDC in uIDC

/**
 * Mining Emission Constants
 */
export const IDC_TARGET_BLOCK_TIME = 10; // seconds (matches ChainParams.targetBlockTime)
export const IDC_BLOCKS_PER_ERA = BigInt(Math.floor((10 * 365 * 24 * 3600) / IDC_TARGET_BLOCK_TIME)); // 31,536,000 blocks per era
export const IDC_ERA_COUNT = 10; // 10 eras = 100 years

/**
 * Base reward per block (in uIDC)
 * 
 * Calculated to distribute ~1 billion IDC over 10 eras with halving:
 * baseReward * blocksPerEra * (1 + 1/2 + 1/4 + ... + 1/2^9) ≈ 1 billion IDC
 * 
 * Result: ~15,870,394 uIDC per block in Era 0
 */
export const IDC_BASE_REWARD = 15_870_394n; // uIDC (≈ 15.870394 IDC)

/**
 * Transaction Fee Constants
 */
export const IDC_BASE_FEE = 1_000n; // 0.001 IDC in uIDC
export const IDC_FEE_PER_100_BYTES = 100n; // 0.0001 IDC per 100 bytes in uIDC

/**
 * Get the era number for a given block height
 * 
 * Era calculation: era = floor(height / blocksPerEra)
 * 
 * @param height Block height
 * @returns Era number (0-9), or IDC_ERA_COUNT if beyond emission period
 */
export function getEra(height: number | bigint): number {
  const heightBig = typeof height === "bigint" ? height : BigInt(height);
  const era = Number(heightBig / IDC_BLOCKS_PER_ERA);
  
  // Cap at maximum era count
  return era >= IDC_ERA_COUNT ? IDC_ERA_COUNT : era;
}

/**
 * Get raw block reward for a given height (before cap check)
 * 
 * Reward calculation: baseReward >> era (bit shift for division by 2^era)
 * 
 * This is O(1) integer arithmetic - millisecond performance.
 * 
 * @param height Block height
 * @returns Block reward in uIDC (0 if beyond emission period)
 */
export function getBlockRewardRaw(height: number | bigint): bigint {
  const era = getEra(height);
  
  // Beyond emission period - no reward
  if (era >= IDC_ERA_COUNT) {
    return 0n;
  }
  
  // Calculate reward: baseReward / 2^era using bit shift
  const reward = IDC_BASE_REWARD >> BigInt(era);
  
  return reward; // Returns in uIDC
}

/**
 * Get capped block reward (respecting max supply limit)
 * 
 * Ensures total supply never exceeds IDC_MAX_SUPPLY.
 * 
 * @param height Block height
 * @param totalIssued Total IDC already issued (in uIDC)
 * @returns Block reward in uIDC (capped to remaining supply)
 */
export function getCappedBlockReward(
  height: number | bigint,
  totalIssued: bigint
): bigint {
  const raw = getBlockRewardRaw(height);
  
  // No reward if beyond emission period
  if (raw === 0n) {
    return 0n;
  }
  
  // No reward if max supply already reached
  if (totalIssued >= IDC_MAX_SUPPLY) {
    return 0n;
  }
  
  // Calculate remaining supply
  const remaining = IDC_MAX_SUPPLY - totalIssued;
  
  // Return minimum of raw reward and remaining supply
  return raw <= remaining ? raw : remaining;
}

/**
 * Convert uIDC to IDC (for display)
 * 
 * @param uIDC Amount in micro IDC
 * @returns Amount in IDC (as number)
 */
export function uIDCToIDC(uIDC: bigint): number {
  return Number(uIDC) / 10 ** IDC_DECIMALS;
}

/**
 * Convert IDC to uIDC
 * 
 * @param idc Amount in IDC
 * @returns Amount in micro IDC
 */
export function IDCToUIDC(idc: number): bigint {
  return BigInt(Math.floor(idc * 10 ** IDC_DECIMALS));
}

/**
 * Estimate transaction fee based on transaction size
 * 
 * Fee formula: baseFee + (txSize / 100) * feePer100Bytes
 * 
 * This is O(1) - just JSON stringify length calculation.
 * 
 * @param tx Transaction
 * @returns Fee in uIDC
 */
export function estimateTxFee(tx: any): bigint {
  // Calculate transaction size (approximate)
  const txSize = BigInt(JSON.stringify(tx).length);
  
  // Calculate extra fee units (per 100 bytes)
  const extraUnits = txSize / 100n;
  
  // Total fee: base + size-based
  const fee = IDC_BASE_FEE + extraUnits * IDC_FEE_PER_100_BYTES;
  
  return fee;
}

/**
 * Get emission statistics for a given height
 * 
 * @param height Block height
 * @returns Emission statistics
 */
export function getEmissionStats(height: number | bigint): {
  era: number;
  rawReward: bigint;
  rawRewardIDC: number;
  blocksInEra: bigint;
  blocksRemainingInEra: bigint;
  eraStartHeight: bigint;
  eraEndHeight: bigint;
} {
  const heightBig = typeof height === "bigint" ? height : BigInt(height);
  const era = getEra(height);
  
  const eraStartHeight = BigInt(era) * IDC_BLOCKS_PER_ERA;
  const eraEndHeight = eraStartHeight + IDC_BLOCKS_PER_ERA;
  const blocksRemainingInEra = eraEndHeight > heightBig ? eraEndHeight - heightBig : 0n;
  
  const rawReward = getBlockRewardRaw(height);
  
  return {
    era,
    rawReward,
    rawRewardIDC: uIDCToIDC(rawReward),
    blocksInEra: IDC_BLOCKS_PER_ERA,
    blocksRemainingInEra,
    eraStartHeight,
    eraEndHeight,
  };
}

