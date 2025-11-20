import React from 'react';
import styles from '../styles/SlotRotationCard.module.css';

interface SlotRotationCardProps {
    currentEpoch: number;
    currentSlot: number;
    nextLeader: string;
    slotPreview: { leader: string; isSelf: boolean }[];
}

export const SlotRotationCard: React.FC<SlotRotationCardProps> = ({
    currentEpoch,
    currentSlot,
    nextLeader,
    slotPreview
}) => {
    return (
        <div className={styles.card}>
            <div className={styles.header}>
                Slot 领导者轮换 (50ms Slot)
            </div>

            <p>
                <span className={styles.dataLabel}>当前 Epoch / Slot:</span>
                <span className={styles.dataValue}>E: {currentEpoch}</span> / <span className={styles.dataValue}>S: {currentSlot}</span>
            </p>

            <p>
                <span className={styles.dataLabel}>预计 Leader (Next Slot):</span>
                <span className={styles.dataValue} style={{ color: '#4ee672' }}>{nextLeader}</span>
            </p>

            <p className={styles.dataLabel} style={{ marginTop: 15 }}>下一 5 个 Slot 预览:</p>
            <div className={styles.slotPreview}>
                {slotPreview.map((slot, index) => (
                    <span 
                        key={index} 
                        className={`${styles.slotItem} ${slot.isSelf ? styles.slotItemYou : ''}`}
                    >
                        {slot.isSelf ? 'You' : slot.leader.substring(0, 8) + '...'}
                    </span>
                ))}
            </div>
        </div>
    );
};

