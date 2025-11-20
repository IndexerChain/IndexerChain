/**
 * Committee Election
 * 
 * Phase 22: Fast Finality Layer - Committee member selection
 * 
 * Elects committee members based on peer reputation and random selection
 */

import type { Address, PeerScore, ChainParams } from "../types.js";

/**
 * Committee member information
 */
export interface CommitteeMember {
  address: Address;
  peerId: string;
  score: number;
  trustLevel: PeerScore["trustLevel"];
}

/**
 * Elect committee members for a given round
 * 
 * Uses a combination of:
 * - Peer reputation scores (Phase 21)
 * - Random selection based on block hash (deterministic)
 * - Trust level filtering (only trusted/normal peers)
 * 
 * @param blockHash Hash of the block used as random seed
 * @param allPeers All available peers with their scores
 * @param params Chain parameters
 * @returns Array of elected committee members
 */
export function electCommittee(
  blockHash: string,
  allPeers: Array<{ peerId: string; address: Address; score: PeerScore }>,
  params: ChainParams
): CommitteeMember[] {
  const committeeSize = params.finalityCommitteeSize ?? 11;
  
  // Filter peers by trust level and score (only normal or trusted peers)
  const eligiblePeers = allPeers.filter(
    (peer) =>
      peer.score.trustLevel === "trusted" ||
      (peer.score.trustLevel === "normal" && peer.score.score >= 40)
  );
  
  if (eligiblePeers.length === 0) {
    return [];
  }
  
  // Use block hash as random seed for deterministic selection
  const seed = blockHash.substring(0, 16); // Use first 16 hex chars as seed
  const seedNumber = parseInt(seed, 16);
  
  // Weight peers by their reputation score
  // Higher score = higher probability of being selected
  const weightedPeers: Array<{ peer: typeof eligiblePeers[0]; weight: number; cumulative: number }> = [];
  let totalWeight = 0;
  
  for (const peer of eligiblePeers) {
    // Weight = score^2 to favor high-reputation peers more
    const weight = Math.pow(peer.score.score / 100, 2);
    totalWeight += weight;
    weightedPeers.push({
      peer,
      weight,
      cumulative: totalWeight,
    });
  }
  
  // Select committee members using weighted random selection
  const selected: CommitteeMember[] = [];
  const usedIndices = new Set<number>();
  
  // Use a simple PRNG based on seed
  let prngState = seedNumber;
  const prng = () => {
    prngState = (prngState * 1103515245 + 12345) & 0x7fffffff;
    return prngState / 0x7fffffff;
  };
  
  while (selected.length < committeeSize && selected.length < eligiblePeers.length) {
    const random = prng() * totalWeight;
    
    // Find peer based on cumulative weight
    for (let i = 0; i < weightedPeers.length; i++) {
      if (usedIndices.has(i)) continue;
      
      if (random <= weightedPeers[i].cumulative) {
        const peer = weightedPeers[i].peer;
        selected.push({
          address: peer.address,
          peerId: peer.peerId,
          score: peer.score.score,
          trustLevel: peer.score.trustLevel,
        });
        usedIndices.add(i);
        break;
      }
    }
    
    // If we couldn't find a peer (shouldn't happen), break
    if (selected.length === 0 || selected.length === selected.length) {
      break;
    }
  }
  
  return selected;
}

/**
 * Check if a node is in the committee for a given round
 * 
 * @param nodeAddress Address of the node to check
 * @param blockHash Hash of the block used for election
 * @param allPeers All available peers
 * @param params Chain parameters
 * @returns true if node is in committee
 */
export function isInCommittee(
  nodeAddress: Address,
  blockHash: string,
  allPeers: Array<{ peerId: string; address: Address; score: PeerScore }>,
  params: ChainParams
): boolean {
  const committee = electCommittee(blockHash, allPeers, params);
  return committee.some((member) => member.address === nodeAddress);
}

/**
 * Get committee round number for a block height
 * 
 * Committee is re-elected every N blocks
 * 
 * @param blockHeight Block height
 * @param params Chain parameters
 * @returns Committee round number
 */
export function getCommitteeRound(blockHeight: number, params: ChainParams): number {
  const interval = params.finalityCommitteeRoundInterval ?? 10;
  return Math.floor(blockHeight / interval);
}

