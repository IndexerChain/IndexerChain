/**
 * ZK-driven All-Light-Node types
 */

export type FinalityLevel = "none" | "zk-finalized" | "super-finalized";

export interface ZkBlockHeader {
  height: number;
  prevHash: string;
  blockHash: string;

  // Timing / randomness / leader
  timestamp: number;
  epoch: number;
  slot: number;
  proposer: string;

  // ZK
  zkStateRoot: string;
  zkProofHash: string;
  zkVerified: boolean;

  // Pool / payout
  payoutRoot: string;
  poolEpochId: string;

  // Network safety
  quorumScore: number;
  finalityLevel: FinalityLevel;
}

export interface PoolRewardEntry {
  address: string;
  amount: string; // IDC as string
  weight: number;
}

export interface PoolCoinbase {
  totalReward: string; // IDC as string
  entries: PoolRewardEntry[];
  payoutRoot: string;
}


