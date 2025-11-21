import { useState, useEffect, useRef, useCallback } from 'react';
import { BlockData, MiningStatus } from '../types';
import { ChainContext } from '../../../core/chain';
import { computeEffectiveWeight } from '../../../core/rewardPoolAllocator';
import { computeOnlineScore, computeReliabilityScore, getBalanceUIDC } from '../../../core/weightSignals';
import { getBlockRewardRaw, uIDCToIDC } from '../../../core/idcEmission';
import { MiningGuard } from '../../../core/miningGuard';
import { getSlotIdentity } from '../../../core/slotSchedule';
// Block type not used after switching to live-only feed

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

    // Derived state from props + reactive polling to ensure UI updates even when not mining
    const initialLocalHeight = chainContext?.storage.getTip()?.header.height || 0;
    const [localHeight, setLocalHeight] = useState<number>(initialLocalHeight);
    const [networkHeight, setNetworkHeight] = useState<number>(
        (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || initialLocalHeight
    );
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

    // Poll tip height and network height periodically to drive UI without mining
    useEffect(() => {
        if (!chainContext) return;
        const poll = setInterval(() => {
            try {
                const tip = chainContext.storage.getTip();
                const lh = tip?.header.height || 0;
                if (lh !== localHeight) setLocalHeight(lh);
                const newNetworkHeight = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || 0;
                if (typeof newNetworkHeight === 'number' && newNetworkHeight >= 0 && newNetworkHeight !== networkHeight) {
                    setNetworkHeight(newNetworkHeight);
                }
            } catch {
                // ignore
            }
        }, 500);
        return () => clearInterval(poll);
        // Intentionally exclude localHeight/networkHeight from deps to avoid tight loops
    }, [chainContext]);

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

        // Helper: derive leader string from block content
        const deriveLeader = (block: any): { label: string; isSelf: boolean } => {
            let leaderAddr: string | null = block?.header?.proposer || null;
            // Fallback to coinbase recipient
            try {
                if (!leaderAddr && block?.txs?.length > 0) {
                    const coinbase = block.txs[0];
                    const op0 = coinbase?.ops?.[0];
                    if (op0?.type === 'TRANSFER' && op0?.to) leaderAddr = op0.to;
                }
            } catch {}
            if (!leaderAddr) return { label: 'Unknown', isSelf: false };
            const isSelf = !!nodeAddress && leaderAddr === nodeAddress;
            const short = leaderAddr.substring(0, 10) + '...';
            return { label: isSelf ? `${short} (You)` : short, isSelf };
        };

        // Live-only mode: don't preload old blocks on refresh
        // Start from current tip height and wait for new incoming blocks
        lastHeightRef.current = chainContext.storage.getTip()?.header.height || 0;
        setBlocks([]);

        // Listen to NEW_BLOCK_HEADER messages for real-time updates (ensure continuity)
        const handleNewBlock = async (compactHeader: any, _sender: string) => {
            if (!isLiveFeedActive) return;

            try {
                const targetHeight = compactHeader.height;
                if (targetHeight <= lastHeightRef.current) return;
                const b = chainContext.storage.getBlockByHeight(targetHeight);
                if (!b) return;
                const prev = chainContext.storage.getBlockByHeight(targetHeight - 1);
                const rawDelta = prev ? Math.abs(b.header.timestamp - prev.header.timestamp) : 0;
                const deltaMs = rawDelta > 1_000_000 ? rawDelta : rawDelta * 1000;
                const leaderInfo = deriveLeader(b);
                const slotVal = (() => {
                    try {
                        const t = Number(b.header.timestamp || 0);
                        const sec = Number(chainContext.params?.targetBlockTime || 10);
                        return sec > 0 ? Math.floor(t / sec) : 0;
                    } catch { return 0; }
                })();
                    // compute coinbase-derived pool reward (sum of TRANSFER amounts)
                    let poolRewardIDC = 0;
                    try {
                        const coinbase = b?.txs?.[0];
                        if (coinbase && coinbase.ownerAddress === 'idc_system' && Array.isArray(coinbase.ops)) {
                            for (const op of coinbase.ops) {
                                if (op.type === 'TRANSFER' && typeof op.amount === 'number') {
                                    poolRewardIDC += op.amount;
                                }
                            }
                        }
                    } catch {}
                    const zkRoot = (typeof window !== 'undefined' && ((window as any).lastZkStateRoot || (window as any).lastRootTipStateCommitment)) || undefined;
                    const zkFinalized = (typeof window !== 'undefined' && (window as any).lastZkFinalizedHeight >= (b?.header?.height || 0)) || false;
                    const zkProofHashVal = (b as any)?.header?.zkProofHash;
                    const row: BlockData = {
                    height: b.header.height,
                        hash: b.hash.substring(0, 10) + '...',
                        fullHash: String(b.hash || ''),
                    slot: slotVal,
                    leader: leaderInfo.label,
                    time: deltaMs > 0 ? `${deltaMs.toFixed(0)}ms` : '--',
                    recipients: b.txs.length,
                    isSelf: leaderInfo.isSelf,
                        poolRewardIDC,
                        payoutRoot: (b?.header?.payoutRoot ? String(b.header.payoutRoot) : undefined),
                        zkProofHash: (zkProofHashVal ? String(zkProofHashVal) : undefined),
                        zkRoot: zkRoot ? String(zkRoot) : undefined,
                        zkFinalized,
                };
                setBlocks(prev => [row, ...prev].slice(0, 50));

                // Update sync rate
                const now = Date.now();
                heightHistoryRef.current.push({ height: targetHeight, time: now });
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

                lastHeightRef.current = targetHeight;
            } catch (error) {
                // Ignore errors
            }
        };

        // Register message handlers
        if (p2pNode.onMessage) {
            p2pNode.onMessage('NEW_BLOCK_HEADER', handleNewBlock);
            // Direct NEW_BLOCK payloads - update UI immediately (latest only)
            p2pNode.onMessage('NEW_BLOCK', (blockPayload: any) => {
                if (!isLiveFeedActive || !blockPayload) return;
                try {
                    const b = blockPayload as any;
                    if ((b?.header?.height || 0) <= lastHeightRef.current) return;
                    const prev = chainContext.storage.getBlockByHeight((b?.header?.height || 0) - 1);
                    const rawDelta = prev ? Math.abs(b.header.timestamp - prev.header.timestamp) : 0;
                    const deltaMs = rawDelta > 1_000_000 ? rawDelta : rawDelta * 1000;
                    const leaderInfo = deriveLeader(b);
                    const slotVal = (() => {
                        try {
                            const t = Number(b.header.timestamp || 0);
                            const sec = Number(chainContext.params?.targetBlockTime || 10);
                            return sec > 0 ? Math.floor(t / sec) : 0;
                        } catch { return 0; }
                    })();
                    const row: BlockData = {
                        height: b.header.height,
                        hash: String(b.hash || '').substring(0, 10) + '...',
                        slot: slotVal,
                        leader: leaderInfo.label,
                        time: deltaMs > 0 ? `${deltaMs.toFixed(0)}ms` : '--',
                        recipients: Array.isArray(b.txs) ? b.txs.length : 0,
                        isSelf: leaderInfo.isSelf,
                    };
                    setBlocks(prev => [row, ...prev].slice(0, 50));
                    lastHeightRef.current = Math.max(lastHeightRef.current, row.height);
                } catch {}
            });
            // Batched BLOCKS payloads - append latest only (ignore historical on refresh)
            p2pNode.onMessage('BLOCKS', (payload: any) => {
                if (!isLiveFeedActive || !payload?.blocks) return;
                try {
                    const list: any[] = Array.isArray(payload.blocks) ? payload.blocks : [];
                    if (list.length === 0) return;
                    const latest = list[list.length - 1];
                    if ((latest?.header?.height || 0) <= lastHeightRef.current) return;
                    const prev = chainContext.storage.getBlockByHeight((latest?.header?.height || 0) - 1);
                    const rawDelta = prev ? Math.abs(latest.header.timestamp - prev.header.timestamp) : 0;
                    const deltaMs = rawDelta > 1_000_000 ? rawDelta : rawDelta * 1000;
                    const leaderInfo = deriveLeader(latest);
                    const slotVal = (() => {
                        try {
                            const t = Number(latest.header.timestamp || 0);
                            const sec = Number(chainContext.params?.targetBlockTime || 10);
                            return sec > 0 ? Math.floor(t / sec) : 0;
                        } catch { return 0; }
                    })();
                    // compute coinbase-derived pool reward (sum of TRANSFER amounts)
                    let poolRewardIDC2 = 0;
                    try {
                        const coinbase2 = latest?.txs?.[0];
                        if (coinbase2 && coinbase2.ownerAddress === 'idc_system' && Array.isArray(coinbase2.ops)) {
                            for (const op of coinbase2.ops) {
                                if (op.type === 'TRANSFER' && typeof op.amount === 'number') {
                                    poolRewardIDC2 += op.amount;
                                }
                            }
                        }
                    } catch {}
                    const zkRoot2 = (typeof window !== 'undefined' && ((window as any).lastZkStateRoot || (window as any).lastRootTipStateCommitment)) || undefined;
                    const zkFinalized2 = (typeof window !== 'undefined' && (window as any).lastZkFinalizedHeight >= (latest?.header?.height || 0)) || false;
                    const zkProofHashVal2 = (latest as any)?.header?.zkProofHash;
                    const row: BlockData = {
                        height: latest.header.height,
                        hash: String(latest.hash || '').substring(0, 10) + '...',
                        fullHash: String(latest.hash || ''),
                        slot: slotVal,
                        leader: leaderInfo.label,
                        time: deltaMs > 0 ? `${deltaMs.toFixed(0)}ms` : '--',
                        recipients: Array.isArray(latest.txs) ? latest.txs.length : 0,
                        isSelf: leaderInfo.isSelf,
                        poolRewardIDC: poolRewardIDC2,
                        payoutRoot: (latest?.header?.payoutRoot ? String(latest.header.payoutRoot) : undefined),
                        zkProofHash: (zkProofHashVal2 ? String(zkProofHashVal2) : undefined),
                        zkRoot: zkRoot2 ? String(zkRoot2) : undefined,
                        zkFinalized: zkFinalized2,
                    };
                    setBlocks(prev => [row, ...prev].slice(0, 50));
                    lastHeightRef.current = Math.max(lastHeightRef.current, row.height);
                } catch {}
            });
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
