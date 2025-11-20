import React, { useState } from 'react';
import { useMiningData } from './hooks/useMiningData';
import { ControlCard } from './components/ControlCard';
import { LiveFeedTable } from './components/LiveFeedTable';
import { SlotRotationCard } from './components/SlotRotationCard';
import { RewardWeightCard } from './components/RewardWeightCard';
import styles from './styles/dashboard.module.css';
import { ChainContext } from '../../core/chain';
import { MinerClient } from '../../core/minerClient';

interface MinerDashboardProps {
    chainContext: ChainContext | null;
    minerClient: MinerClient;
    nodeAddress: string | null;
    isMiningGlobal: boolean;
    onToggleMiningGlobal: () => void;
    p2pNode: any;
}

export const MinerDashboard: React.FC<MinerDashboardProps> = (props) => {
    const [autoMining, setAutoMining] = useState(true);
    
    const {
        status,
        balance,
        // currentHeight, // Removed unused variable
        localHeight,
        networkHeight,
        peerCount,
        blocks,
        isLiveFeedActive,
        syncRate,
        effectiveWeight,
        projectedReward,
        onlineScore,
        currentEpoch,
        currentSlot,
        nextLeader,
        slotPreview,
        toggleMining,
        toggleLiveFeed
    } = useMiningData(props);

    const isCatchingUp = status === 'CatchingUp' || status === 'Syncing';

    const copyAddress = () => {
        if (props.nodeAddress) {
            navigator.clipboard.writeText(props.nodeAddress);
            alert("Miner Address copied!");
        }
    };

    return (
        <div className={styles.dashboardGrid}>
            {/* Top Bar - Wallet & Status */}
            <div style={{ gridColumn: '1 / -1' }}>
                 <div className={styles.walletDisplayBar}>
                    <div className={styles.addressInfo}>
                        <span className={styles.balanceLabel}>Miner Address:</span>
                        <span style={{ color: '#4ee672', fontWeight: 'bold', marginLeft: 10 }}>
                            {props.nodeAddress ? `${props.nodeAddress.substring(0, 10)}...${props.nodeAddress.substring(props.nodeAddress.length - 4)}` : 'Loading...'}
                        </span>
                        <button 
                            onClick={copyAddress}
                            style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', marginLeft: 10 }}
                        >
                            📋
                        </button>
                    </div>
                    
                    <div className={styles.balanceInfo}>
                        <span className={styles.balanceLabel}>Current Balance (IDC):</span>
                        <span className={styles.balanceAmount}>{balance.toFixed(2)}</span>
                    </div>
                </div>

                <div className={styles.addressBar}>
                    <span>
                        Local Height: <span className={styles.dataValue}>{localHeight.toLocaleString()}</span> | 
                        Network Height: <span className={styles.dataValue}>{networkHeight.toLocaleString()}</span> | 
                        Peers: <span className={styles.dataValue}>{peerCount}</span>
                        {syncRate > 0 && ` | Sync Rate: ${syncRate.toFixed(1)} blocks/s`}
                    </span>
                </div>
            </div>

            {/* Left Panel - Controls & Stats */}
            <div className={styles.leftPanel}>
                <ControlCard 
                    status={status}
                    onToggleMining={toggleMining}
                    autoMining={autoMining}
                    onToggleAutoMining={setAutoMining}
                    isCatchingUp={isCatchingUp}
                    catchUpProgress={isCatchingUp ? `${localHeight} / ${networkHeight}` : undefined}
                />

                <SlotRotationCard 
                    currentEpoch={currentEpoch}
                    currentSlot={currentSlot}
                    nextLeader={nextLeader}
                    slotPreview={slotPreview}
                />

                <RewardWeightCard 
                    effectiveWeight={effectiveWeight}
                    projectedReward={projectedReward}
                    onlineScore={onlineScore}
                />
            </div>

            {/* Right Panel - Live Feed */}
            <div className={styles.blocksCard}>
                <LiveFeedTable 
                    blocks={blocks} 
                    isLiveFeedActive={isLiveFeedActive}
                    onToggleLiveFeed={toggleLiveFeed}
                />
            </div>
        </div>
    );
};
