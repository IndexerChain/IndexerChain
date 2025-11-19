/**
 * IDC Emission Model
 * 
 * Phase 41: Maximized Incentive Model - Browser Mining Optimized
 * 
 * Total Supply: 1 billion IDC
 * Emission Period: 10 years (not 100 years)
 * Block Time: ~10 seconds
 * 
 * New Emission Curve: First Year 50%, 3 Years 90%
 * - Year 1: 50 IDC per block → 500M IDC (50%)
 * - Year 2: 25 IDC per block → 250M IDC (75% cumulative)
 * - Year 3: 12.5 IDC per block → 125M IDC (87.5% cumulative)
 * - Year 4: 6.25 IDC per block → 62.5M IDC (93.75% cumulative)
 * - Year 5: 3.125 IDC per block → 31.25M IDC (96.875% cumulative)
 * - Year 6-10: Linear decrease from 31.25M to 1M IDC
 * 
 * Why this design:
 * - First year 50% → Maximum attraction for early adopters
 * - Browser mining is lightweight → Needs strong incentives
 * - Short payback period for regular users
 * - Build network scale in first year
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
export const IDC_BLOCKS_PER_YEAR = BigInt(Math.floor((365 * 24 * 3600) / IDC_TARGET_BLOCK_TIME)); // 3,153,600 blocks per year
export const IDC_EMISSION_YEARS = 10; // 10 years total emission period

/**
 * Year-based block rewards (in uIDC)
 * 
 * Phase 42: First year uses decreasing curve (200 IDC → 50 IDC)
 * - Year 1: Starts at 200 IDC, decreases linearly to 50 IDC
 * - Year 2: 25 IDC = 25,000,000 uIDC per block
 * - Year 3: 12.5 IDC = 12,500,000 uIDC per block
 * - Year 4: 6.25 IDC = 6,250,000 uIDC per block
 * - Year 5: 3.125 IDC = 3,125,000 uIDC per block
 * - Year 6-10: Linear decrease
 */
const YEAR_1_START_REWARD = 200_000_000n; // 200 IDC at start of year 1
const YEAR_1_END_REWARD = 50_000_000n;    // 50 IDC at end of year 1

const YEARLY_REWARDS: bigint[] = [
  // Year 1: Calculated dynamically (200 → 50 IDC decreasing curve)
  0n,  // Placeholder, will be calculated by getYear1Reward()
  25_000_000n,  // Year 2: 25 IDC
  12_500_000n,  // Year 3: 12.5 IDC
  6_250_000n,   // Year 4: 6.25 IDC
  3_125_000n,   // Year 5: 3.125 IDC
];

// Year 6-10: Linear decrease from 3,125,000 to 1,000,000 uIDC
// Year 6: 2,500,000, Year 7: 2,000,000, Year 8: 1,500,000, Year 9: 1,250,000, Year 10: 1,000,000
const YEAR_6_TO_10_REWARDS: bigint[] = [
  2_500_000n,   // Year 6: 2.5 IDC
  2_000_000n,   // Year 7: 2.0 IDC
  1_500_000n,   // Year 8: 1.5 IDC
  1_250_000n,   // Year 9: 1.25 IDC
  1_000_000n,   // Year 10: 1.0 IDC
];

/**
 * Legacy constant for backward compatibility (deprecated)
 * @deprecated Use getBlockRewardRaw() instead
 */
export const IDC_BASE_REWARD = 50_000_000n; // uIDC (≈ 50 IDC) - Year 1 reward

/**
 * Transaction Fee Constants
 */
export const IDC_BASE_FEE = 1_000n; // 0.001 IDC in uIDC
export const IDC_FEE_PER_100_BYTES = 100n; // 0.0001 IDC per 100 bytes in uIDC

/**
 * Get the year number for a given block height
 * 
 * Year calculation: year = floor(height / blocksPerYear)
 * 
 * @param height Block height
 * @returns Year number (0-9), or IDC_EMISSION_YEARS if beyond emission period
 */
export function getYear(height: number | bigint): number {
  const heightBig = typeof height === "bigint" ? height : BigInt(height);
  const year = Number(heightBig / IDC_BLOCKS_PER_YEAR);
  
  // Cap at maximum year count
  return year >= IDC_EMISSION_YEARS ? IDC_EMISSION_YEARS : year;
}

/**
 * Get the era number for a given block height (deprecated, use getYear instead)
 * 
 * @deprecated Use getYear() instead for new emission model
 * @param height Block height
 * @returns Era number (for backward compatibility)
 */
export function getEra(height: number | bigint): number {
  return getYear(height);
}

/**
 * Get Year 1 block reward (decreasing curve: 200 IDC → 50 IDC)
 * 
 * Phase 42: Year 1 uses linear decrease from 200 IDC to 50 IDC
 * 
 * @param height Block height
 * @returns Block reward in uIDC for Year 1
 */
function getYear1Reward(height: number | bigint): bigint {
  const heightBig = typeof height === "bigint" ? height : BigInt(height);
  const blocksInYear1 = IDC_BLOCKS_PER_YEAR;
  const blockIndexInYear = heightBig % blocksInYear1;
  
  // Linear decrease: startReward - (startReward - endReward) * (blockIndex / blocksInYear)
  const rewardRange = YEAR_1_START_REWARD - YEAR_1_END_REWARD;
  const decreaseAmount = (rewardRange * blockIndexInYear) / blocksInYear1;
  const reward = YEAR_1_START_REWARD - decreaseAmount;
  
  // Ensure reward doesn't go below end reward
  return reward < YEAR_1_END_REWARD ? YEAR_1_END_REWARD : reward;
}

/**
 * Get raw block reward for a given height (before cap check and multipliers)
 * 
 * New reward calculation based on year:
 * - Year 1: Decreasing curve from 200 IDC to 50 IDC
 * - Year 2-5: Fixed rewards from YEARLY_REWARDS array
 * - Year 6-10: Linear decrease from YEAR_6_TO_10_REWARDS array
 * 
 * This is O(1) integer arithmetic - millisecond performance.
 * 
 * @param height Block height
 * @returns Block reward in uIDC (0 if beyond emission period)
 */
export function getBlockRewardRaw(height: number | bigint): bigint {
  const year = getYear(height);
  
  // Beyond emission period - no reward
  if (year >= IDC_EMISSION_YEARS) {
    return 0n;
  }
  
  // Year 1: Decreasing curve (200 → 50 IDC)
  if (year === 0) {
    return getYear1Reward(height);
  }
  
  // Year 2-5: Use fixed rewards (skip index 0 which is placeholder)
  if (year > 0 && year < YEARLY_REWARDS.length) {
    return YEARLY_REWARDS[year];
  }
  
  // Year 6-10: Use linear decrease rewards
  const year6To10Index = year - YEARLY_REWARDS.length;
  if (year6To10Index < YEAR_6_TO_10_REWARDS.length) {
    return YEAR_6_TO_10_REWARDS[year6To10Index];
  }
  
  // Should not reach here, but return 0 for safety
  return 0n;
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
  era: number; // Deprecated, use year instead
  year: number; // New: year number (0-9)
  rawReward: bigint;
  rawRewardIDC: number;
  blocksInEra: bigint; // Deprecated, use blocksInYear instead
  blocksInYear: bigint; // New: blocks per year
  blocksRemainingInEra: bigint; // Deprecated, use blocksRemainingInYear instead
  blocksRemainingInYear: bigint; // New: blocks remaining in current year
  eraStartHeight: bigint; // Deprecated, use yearStartHeight instead
  yearStartHeight: bigint; // New: start height of current year
  eraEndHeight: bigint; // Deprecated, use yearEndHeight instead
  yearEndHeight: bigint; // New: end height of current year
} {
  const heightBig = typeof height === "bigint" ? height : BigInt(height);
  const year = getYear(height);
  const era = year; // For backward compatibility
  
  const yearStartHeight = BigInt(year) * IDC_BLOCKS_PER_YEAR;
  const yearEndHeight = yearStartHeight + IDC_BLOCKS_PER_YEAR;
  const blocksRemainingInYear = yearEndHeight > heightBig ? yearEndHeight - heightBig : 0n;
  
  const rawReward = getBlockRewardRaw(height);
  
  return {
    era, // Backward compatibility
    year, // New field
    rawReward,
    rawRewardIDC: uIDCToIDC(rawReward),
    blocksInEra: IDC_BLOCKS_PER_YEAR, // Backward compatibility
    blocksInYear: IDC_BLOCKS_PER_YEAR, // New field
    blocksRemainingInEra: blocksRemainingInYear, // Backward compatibility
    blocksRemainingInYear, // New field
    eraStartHeight: yearStartHeight, // Backward compatibility
    yearStartHeight, // New field
    eraEndHeight: yearEndHeight, // Backward compatibility
    yearEndHeight, // New field
  };
}

