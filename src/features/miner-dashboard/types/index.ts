export interface BlockData {
    height: number;
    hash: string;
    leader: string;
    time: string;
    recipients: number;
    isSelf: boolean;
}

export type MiningStatus = 'Mining' | 'Stopped' | 'Syncing' | 'CatchingUp' | 'Waiting';

export interface MinerDashboardState {
    status: MiningStatus;
    balance: number;
    currentHeight: number;
    localHeight: number;
    networkHeight: number;
    peerCount: number;
    blocks: BlockData[];
    isLiveFeedActive: boolean;
    syncRate: number; // blocks/s
    effectiveWeight: number;
    projectedReward: number;
    onlineScore: number;
    currentEpoch: number;
    currentSlot: number;
    nextLeader: string;
    slotPreview: { leader: string; isSelf: boolean }[];
}

