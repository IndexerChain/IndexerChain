/**
 * Phase 30: Mainnet Network Parameters & Validation
 * 
 * Defines mainnet parameters and provides network validation functions
 * to ensure all nodes are on the same network.
 */

import type { ChainParams } from "./types.js";
import { sha256 } from "./crypto.js";
import { createGenesisBlock } from "./genesis.js";

/**
 * Mainnet network identifier
 */
export const MAINNET_NETWORK_ID = "IXC_MAINNET_V1";

/**
 * Mainnet chain parameters
 * These are fixed and must match across all mainnet nodes
 */
export const MAINNET_PARAMS: ChainParams = {
  version: 1,
  networkId: MAINNET_NETWORK_ID,
  genesisTimestamp: 1735689600, // Fixed timestamp: 2025-01-01 00:00:00 UTC
  initialDifficulty: 1,
  targetBlockTime: 10, // Target 10 seconds per block
  difficultyAdjustmentInterval: 10, // Adjust difficulty every 10 blocks
  blockReward: 10, // Block reward in IDC
  snapshotInterval: 50, // Create snapshot every 50 blocks
  maxSnapshotCount: 5, // Keep maximum 5 snapshots
  lightNodeWindow: 200, // Keep only recent 200 blocks (light node mode)
  fullSnapshotInterval: 5, // Create full snapshot every 5 snapshots
  maxBlockSizeBytes: 1_000_000,
  // Phase 13: Snapshot verification parameters
  snapshotVerificationSampleRate: 0.3,
  snapshotAutoVerifyIntervalMs: 60_000,
  // Phase 14: Remote snapshot sync parameters
  remoteSnapshotEnabled: true,
  remoteSnapshotMinHeight: 100,
  remoteSnapshotEndpoints: [
    // Mainnet snapshot endpoints (to be configured)
    // "https://snap.indexerchain.com/api/v1/snapshots"
  ],
  // Phase 21: Peer reputation and security parameters
  peerScoreEnabled: true,
  peerScoreDecayIntervalMs: 60_000,
  peerScoreHalfLifeMs: 300_000,
  peerBanThreshold: 20,
  peerBanDurationMs: 600_000,
  // Phase 22: Fast finality parameters
  finalityEnabled: true,
  finalityCommitteeSize: 11,
  finalityThreshold: 0.67,
  finalityVoteTimeoutMs: 5000,
  finalityCommitteeRoundInterval: 10,
  // Phase 30: Global Consistency Sentinel parameters
  globalSentinelEnabled: true,
  globalDriftCheckIntervalMs: 5000,
  globalDriftCriticalBlocks: 10,
  globalDriftMinorBlocks: 3,
  globalMinPeersForAssessment: 3,
  globalMinReputationForVoting: 0,
};

/**
 * Compute chain parameters hash
 * This hash is used to verify that all nodes have identical chain parameters
 */
export async function computeChainParamsHash(params: ChainParams): Promise<string> {
  // Create a normalized copy of params (exclude runtime-only fields)
  const normalizedParams: any = {
    version: params.version,
    networkId: params.networkId,
    genesisTimestamp: params.genesisTimestamp,
    initialDifficulty: params.initialDifficulty,
    targetBlockTime: params.targetBlockTime,
    difficultyAdjustmentInterval: params.difficultyAdjustmentInterval,
    blockReward: params.blockReward,
    snapshotInterval: params.snapshotInterval,
    maxSnapshotCount: params.maxSnapshotCount,
    lightNodeWindow: params.lightNodeWindow,
    fullSnapshotInterval: params.fullSnapshotInterval,
    maxBlockSizeBytes: params.maxBlockSizeBytes,
    snapshotVerificationSampleRate: params.snapshotVerificationSampleRate,
    snapshotAutoVerifyIntervalMs: params.snapshotAutoVerifyIntervalMs,
    remoteSnapshotEnabled: params.remoteSnapshotEnabled,
    remoteSnapshotMinHeight: params.remoteSnapshotMinHeight,
    remoteSnapshotEndpoints: params.remoteSnapshotEndpoints ? [...params.remoteSnapshotEndpoints].sort() : [],
    peerScoreEnabled: params.peerScoreEnabled,
    peerScoreDecayIntervalMs: params.peerScoreDecayIntervalMs,
    peerScoreHalfLifeMs: params.peerScoreHalfLifeMs,
    peerBanThreshold: params.peerBanThreshold,
    peerBanDurationMs: params.peerBanDurationMs,
    finalityEnabled: params.finalityEnabled,
    finalityCommitteeSize: params.finalityCommitteeSize,
    finalityThreshold: params.finalityThreshold,
    finalityVoteTimeoutMs: params.finalityVoteTimeoutMs,
    finalityCommitteeRoundInterval: params.finalityCommitteeRoundInterval,
    globalSentinelEnabled: params.globalSentinelEnabled,
    globalDriftCheckIntervalMs: params.globalDriftCheckIntervalMs,
    globalDriftCriticalBlocks: params.globalDriftCriticalBlocks,
    globalDriftMinorBlocks: params.globalDriftMinorBlocks,
    globalMinPeersForAssessment: params.globalMinPeersForAssessment,
    globalMinReputationForVoting: params.globalMinReputationForVoting,
  };
  
  const jsonString = JSON.stringify(normalizedParams);
  return await sha256(jsonString);
}

/**
 * Compute mainnet genesis hash
 * This is computed once and then hardcoded
 */
let cachedMainnetGenesisHash: string | null = null;

export async function getMainnetGenesisHash(): Promise<string> {
  if (cachedMainnetGenesisHash) {
    return cachedMainnetGenesisHash;
  }
  
  const genesis = await createGenesisBlock(MAINNET_PARAMS);
  cachedMainnetGenesisHash = genesis.hash;
  return cachedMainnetGenesisHash;
}

/**
 * Network validation result
 */
export interface NetworkValidationResult {
  valid: boolean;
  reason?: string;
  networkId?: string;
  genesisHash?: string;
  chainParamsHash?: string;
}

/**
 * Validate network parameters match mainnet
 */
export async function validateMainnetParams(params: ChainParams): Promise<NetworkValidationResult> {
  // Check networkId
  if (params.networkId !== MAINNET_NETWORK_ID) {
    return {
      valid: false,
      reason: `Network ID mismatch: expected ${MAINNET_NETWORK_ID}, got ${params.networkId}`,
      networkId: params.networkId,
    };
  }

  // Check genesis timestamp
  if (params.genesisTimestamp !== MAINNET_PARAMS.genesisTimestamp) {
    return {
      valid: false,
      reason: `Genesis timestamp mismatch: expected ${MAINNET_PARAMS.genesisTimestamp}, got ${params.genesisTimestamp}`,
      networkId: params.networkId,
    };
  }

  // Compute and compare chain params hash
  const paramsHash = await computeChainParamsHash(params);
  const mainnetParamsHash = await computeChainParamsHash(MAINNET_PARAMS);
  
  if (paramsHash !== mainnetParamsHash) {
    return {
      valid: false,
      reason: `Chain parameters hash mismatch. This node may be on a different network configuration.`,
      networkId: params.networkId,
      chainParamsHash: paramsHash,
    };
  }

  // Compute genesis hash
  const genesisHash = await getMainnetGenesisHash();
  
  return {
    valid: true,
    networkId: params.networkId,
    genesisHash,
    chainParamsHash: paramsHash,
  };
}

/**
 * Get network info for handshake
 */
export async function getNetworkInfo(params: ChainParams): Promise<{
  networkId: string;
  genesisHash: string;
  chainParamsHash: string;
}> {
  const genesisHash = params.networkId === MAINNET_NETWORK_ID
    ? await getMainnetGenesisHash()
    : (await createGenesisBlock(params)).hash;
  
  const chainParamsHash = await computeChainParamsHash(params);
  
  return {
    networkId: params.networkId,
    genesisHash,
    chainParamsHash,
  };
}

/**
 * Check if params represent mainnet
 */
export function isMainnet(params: ChainParams): boolean {
  return params.networkId === MAINNET_NETWORK_ID;
}

