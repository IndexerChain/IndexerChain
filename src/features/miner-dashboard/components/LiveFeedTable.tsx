import React from 'react';
import styles from '../styles/LiveFeedTable.module.css';
import { BlockData } from '../types';

interface LiveFeedTableProps {
    blocks: BlockData[];
    isLiveFeedActive: boolean;
    onToggleLiveFeed: () => void;
}

export const LiveFeedTable: React.FC<LiveFeedTableProps> = ({
    blocks,
    isLiveFeedActive,
    onToggleLiveFeed
}) => {
    return (
        <div className={styles.card}>
            <div className={styles.header}>
                <span>实时区块列表 (Live Block Feed)</span>
                <button
                    className={`${styles.liveToggleBtn} ${isLiveFeedActive ? styles.liveToggleLive : styles.liveTogglePaused}`}
                    onClick={onToggleLiveFeed}
                >
                    {isLiveFeedActive ? '实时 (Live) 🟢' : '暂停 (Paused) ⏸️'}
                </button>
            </div>

            <div className={styles.liveFeedContainer}>
                <table className={styles.liveTable}>
                    <thead>
                        <tr>
                            <th>Height</th>
                            <th>Hash</th>
                            <th>Leader</th>
                            <th>Time</th>
                            <th>Recipients</th>
                        </tr>
                    </thead>
                    <tbody>
                        {blocks.map((block) => (
                            <tr key={block.hash} className={styles.row}>
                                <td>{block.height.toLocaleString()}</td>
                                <td>{block.hash}</td>
                                <td className={block.isSelf ? styles.you : styles.other}>
                                    {block.leader}
                                </td>
                                <td>{block.time}</td>
                                <td>{block.recipients}</td>
                            </tr>
                        ))}
                        {blocks.length === 0 && (
                            <tr>
                                <td colSpan={5} style={{ textAlign: 'center', padding: 20, color: '#8b949e' }}>
                                    No blocks yet...
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

