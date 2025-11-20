import { useState, useEffect, useRef, useCallback } from 'react';
import { BlockData, MiningStatus } from '../types';
import { ChainContext } from '../../../core/chain';
import { computeEffectiveWeight } from '../../../core/rewardPoolAllocator';
import { computeOnlineScore, computeReliabilityScore, getBalanceUIDC } from '../../../core/weightSignals';
import { getBlockRewardRaw, uIDCToIDC } from '../../../core/idcEmission';
import { MiningGuard } from '../../../core/miningGuard';
import { getSlotIdentity } from '../../../core/slotSchedule';
import type { Block } from '../../../core/types';

interface UseMiningDataProps {
    chainContext: ChainContext | null;
    isMiningGlobal: boolean;
    onToggleMiningGlobal: () => void;
    nodeAddress: string | null;
    p2pNode: any;
    minerClient: any;
    finalityManager?: any;
    localRole?: string;
    bootstrapComplete?: boolean;
}

export const useMiningData = ({
    chainContext,
    isMiningGlobal,
    onToggleMiningGlobal,
    nodeAddress,
    p2pNode,
    minerClient: _minerClient,
    finalityManager,
    localRole = 'LEADER',
    bootstrapComplete = true
}: UseMiningDataProps) => {
    // Local UI state
    const [isLiveFeedActive, setIsLiveFeedActive] = useState(true);
    const [blocks, setBlocks] = useState<BlockData[]>([]);
    const [syncRate, setSyncRate] = useState(0);
    const [miningGuardResult, setMiningGuardResult] = useState<any>(null);
    const [effectiveWeight, setEffectiveWeight] = useState(0);
    const [projectedReward, setProjectedReward] = useState(0);
    const [onlineScore, setOnlineScore] = useState(0);
    const [reliabilityScore, setReliabilityScore] = useState(0);
    
    // Refs for calculation
    const lastHeightRef = useRef<number>(0);
    const heightHistoryRef = useRef<Array<{ height: number; time: number }>>([]); // Track height changes for sync rate

    // Derived state from props
    const localHeight = chainContext?.storage.getTip()?.header.height || 0;
    const networkHeight = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || localHeight;
    const peerCount = p2pNode?.getPeerCount() || 0;
    
    // Determine detailed status
    const getStatus = (): MiningStatus => {
        if (isMiningGlobal) return 'Mining';
        if (miningGuardResult && !miningGuardResult.ok) {
            const diff = networkHeight - localHeight;
            if (diff > 5) return 'CatchingUp';
            if (diff > 0) return 'Syncing';
            return 'Waiting';
        }
        if (networkHeight > localHeight + 5) return 'CatchingUp'; 
        if (networkHeight > localHeight) return 'Syncing';
        return 'Stopped';
    };

    const status = getStatus();

    // Balance - Real data from chain
    const [balance, setBalance] = useState(0);

    useEffect(() => {
        if (!chainContext || !nodeAddress) return;
        
        const updateBalance = () => {
            const bal = chainContext.indexState.getBalance(nodeAddress);
            setBalance(bal);
        };

        updateBalance();
        const interval = setInterval(updateBalance, 2000);
        return () => clearInterval(interval);
    }, [chainContext, nodeAddress]);

    // Update Mining Guard status
    useEffect(() => {
        if (!chainContext || !p2pNode) {
            setMiningGuardResult(null);
            return;
        }

        const checkMiningGuard = async () => {
            try {
                const result = await MiningGuard.canMineNow(
                    chainContext,
                    p2pNode,
                    finalityManager,
                    localRole as any,
                    nodeAddress || undefined,
                    bootstrapComplete
                );
                setMiningGuardResult(result);
            } catch (error) {
                // Ignore errors
            }
        };

        checkMiningGuard();
        const interval = setInterval(checkMiningGuard, 5000);
        return () => clearInterval(interval);
    }, [chainContext, p2pNode, finalityManager, localRole, nodeAddress, bootstrapComplete]);

    // Update weight and reward calculations
    useEffect(() => {
        if (!chainContext || !nodeAddress) return;

        const updateWeights = async () => {
            try {
                const balanceUIDC = getBalanceUIDC(chainContext, nodeAddress);
                const online = computeOnlineScore();
                const reliability = await computeReliabilityScore(chainContext, p2pNode);
                
                setOnlineScore(online);
                setReliabilityScore(reliability);

                const weight = computeEffectiveWeight({
                    address: nodeAddress,
                    balanceUIDC,
                    onlineScore: online,
                    reliabilityScore: reliability,
                    eligible: true
                });
                setEffectiveWeight(weight);

                // Calculate projected daily reward
                const currentHeight = chainContext.storage.getTip()?.header.height || 0;
                const blockRewardUIDC = getBlockRewardRaw(currentHeight + 1);
                const blockRewardIDC = uIDCToIDC(blockRewardUIDC);
                
                // Estimate total network weight (simplified - in real app this would come from network)
                // For now, use a reasonable estimate based on current network state
                const estimatedTotalWeight = 1000; // This should come from network signals
                
                // Projected reward per block = (my weight / total weight) * block reward
                const rewardPerBlock = (weight / estimatedTotalWeight) * blockRewardIDC;
                
                // Daily reward = reward per block * blocks per day
                const blocksPerDay = (24 * 60 * 60) / (chainContext.params.targetBlockTime || 10);
                const dailyReward = rewardPerBlock * blocksPerDay;
                
                setProjectedReward(dailyReward);
            } catch (error) {
                // Ignore errors
            }
        };

        updateWeights();
        const interval = setInterval(updateWeights, 10000);
        return () => clearInterval(interval);
    }, [chainContext, nodeAddress, p2pNode]);

    // Block Feed Logic - Listen to real block updates
    useEffect(() => {
        if (!chainContext || !p2pNode) return;

        // Initialize with recent blocks
        const initializeBlocks = () => {
            const allBlocks = chainContext.storage.getAllBlocks();
            const recentBlocks = allBlocks.slice(-20).reverse(); // Last 20 blocks, newest first
            
            const blockData: BlockData[] = recentBlocks.map((block: Block) => {
                const prevBlock = chainContext.storage.getBlockByHeight(block.header.height - 1);
                const blockTime = prevBlock 
                    ? (block.header.timestamp - prevBlock.header.timestamp) * 1000 // Convert to ms
                    : 0;
                
                return {
                    height: block.header.height,
                    hash: block.hash.substring(0, 10) + '...',
                    leader: block.header.proposer 
                        ? (block.header.proposer === nodeAddress 
                            ? block.header.proposer.substring(0, 10) + '... (You)'
                            : block.header.proposer.substring(0, 10) + '...')
                        : 'Unknown',
                    time: blockTime > 0 ? `${blockTime.toFixed(0)}ms` : '--',
                    recipients: block.txs.length,
                    isSelf: block.header.proposer === nodeAddress
                };
            });
            
            setBlocks(blockData);
            if (recentBlocks.length > 0) {
                lastHeightRef.current = recentBlocks[0].header.height;
            }
        };

        initializeBlocks();

        // Listen to NEW_BLOCK_HEADER messages for real-time updates
        const handleNewBlock = async (compactHeader: any, _sender: string) => {
            if (!isLiveFeedActive) return;

            try {
                // Get the actual block from storage (it should have been appended by sync handler)
                const block = chainContext.storage.getBlockByHeight(compactHeader.height);
                if (!block) return;

                const prevBlock = chainContext.storage.getBlockByHeight(block.header.height - 1);
                const blockTime = prevBlock 
                    ? (block.header.timestamp - prevBlock.header.timestamp) * 1000
                    : 0;

                const newBlock: BlockData = {
                    height: block.header.height,
                    hash: block.hash.substring(0, 10) + '...',
                    leader: block.header.proposer 
                        ? (block.header.proposer === nodeAddress 
                            ? block.header.proposer.substring(0, 10) + '... (You)'
                            : block.header.proposer.substring(0, 10) + '...')
                        : 'Unknown',
                    time: blockTime > 0 ? `${blockTime.toFixed(0)}ms` : '--',
                    recipients: block.txs.length,
                    isSelf: block.header.proposer === nodeAddress
                };

                setBlocks(prev => {
                    const newBlocks = [newBlock, ...prev].slice(0, 20);
                    return newBlocks;
                });

                // Update sync rate
                const now = Date.now();
                heightHistoryRef.current.push({ height: block.header.height, time: now });
                // Keep only last 5 seconds
                heightHistoryRef.current = heightHistoryRef.current.filter(h => now - h.time < 5000);
                
                if (heightHistoryRef.current.length >= 2) {
                    const first = heightHistoryRef.current[0];
                    const last = heightHistoryRef.current[heightHistoryRef.current.length - 1];
                    const heightDiff = last.height - first.height;
                    const timeDiff = (last.time - first.time) / 1000; // seconds
                    if (timeDiff > 0) {
                        setSyncRate(heightDiff / timeDiff);
                    }
                }

                lastHeightRef.current = block.header.height;
            } catch (error) {
                // Ignore errors
            }
        };

        // Register message handler
        if (p2pNode.onMessage) {
            p2pNode.onMessage('NEW_BLOCK_HEADER', handleNewBlock);
        }

        // Also poll for new blocks as fallback
        const pollInterval = setInterval(() => {
            const tip = chainContext.storage.getTip();
            if (tip && tip.header.height !== lastHeightRef.current) {
                handleNewBlock({ height: tip.header.height }, 'local');
            }
        }, 500);

        return () => {
            clearInterval(pollInterval);
            // Note: p2pNode.onMessage might not have an offMessage method
            // In real implementation, you'd need to unregister the handler
        };
    }, [chainContext, p2pNode, isLiveFeedActive, nodeAddress]);

    // Calculate Slot/Epoch info from current block
    const getSlotInfo = () => {
        if (!chainContext) {
            return {
                currentEpoch: 0,
                currentSlot: 0,
                nextLeader: '--',
                slotPreview: []
            };
        }

        const tip = chainContext.storage.getTip();
        if (!tip) {
            return {
                currentEpoch: 0,
                currentSlot: 0,
                nextLeader: '--',
                slotPreview: []
            };
        }

        const now = Date.now();
        const slotIdentity = getSlotIdentity(now);
        const currentEpoch = slotIdentity.epochId;
        const currentSlot = slotIdentity.slotIndex;

        // For next leader prediction, we'd need network signals
        // For now, use a simplified approach
        const nextLeader = '--'; // Would need network signals to predict
        
        // Generate slot preview (simplified - would need network signals for real prediction)
        const slotPreview = Array.from({ length: 5 }).map(() => ({
            leader: `0x${Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0')}...`,
            isSelf: Math.random() < 0.1
        }));

        return {
            currentEpoch,
            currentSlot,
            nextLeader,
            slotPreview
        };
    };

    const slotInfo = getSlotInfo();

    const toggleLiveFeed = useCallback(() => {
        setIsLiveFeedActive(prev => !prev);
    }, []);

    return {
        status,
        balance,
        currentHeight: networkHeight,
        localHeight,
        networkHeight,
        peerCount,
        blocks,
        isLiveFeedActive,
        syncRate,
        effectiveWeight,
        projectedReward,
        onlineScore,
        reliabilityScore,
        currentEpoch: slotInfo.currentEpoch,
        currentSlot: slotInfo.currentSlot,
        nextLeader: slotInfo.nextLeader,
        slotPreview: slotInfo.slotPreview,
        toggleMining: onToggleMiningGlobal,
        toggleLiveFeed,
        setIsLiveFeedActive,
        miningGuardResult
    };
};
