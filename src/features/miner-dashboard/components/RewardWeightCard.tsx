import React from 'react';
import styles from '../styles/RewardWeightCard.module.css';

interface RewardWeightCardProps {
    effectiveWeight: number;
    projectedReward: number;
    onlineScore: number;
}

export const RewardWeightCard: React.FC<RewardWeightCardProps> = ({
    effectiveWeight,
    projectedReward,
    onlineScore
}) => {
    return (
        <div className={styles.card}>
            <div className={styles.header}>
                奖励预估与权重 (Pooled Rewards)
            </div>

            <p>
                <span className={styles.dataLabel}>我的有效权重:</span>
                <span className={styles.dataValueLg}>{effectiveWeight}</span> <span style={{ fontSize: '1em', color: '#8b949e' }}>/ Total: 987.3K</span>
            </p>
            <p>
                <span className={styles.dataLabel}>预估日奖励 (IDC):</span>
                <span className={styles.dataValue}>≈ {projectedReward} IDC</span>
            </p>
            <hr className={styles.hr} />

            <p className={styles.smallInfo}>
                <span className={styles.dataLabel}>Online Score:</span>
                <span className={styles.dataValue} style={{ fontSize: '1em', color: '#4ee672' }}>{onlineScore}%</span>
            </p>
        </div>
    );
};

