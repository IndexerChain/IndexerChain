import React from 'react';
import styles from '../styles/ControlCard.module.css';
import { MiningStatus } from '../types';

interface ControlCardProps {
    status: MiningStatus;
    onToggleMining: () => void;
    error?: string;
    autoMining: boolean;
    onToggleAutoMining: (v: boolean) => void;
    isCatchingUp?: boolean;
    catchUpProgress?: string;
    syncMode?: string;
    syncRate?: number;
}

export const ControlCard: React.FC<ControlCardProps> = ({
    status,
    onToggleMining,
    error,
    autoMining,
    onToggleAutoMining,
    isCatchingUp,
    catchUpProgress,
    syncMode = 'Warp Sync',
    syncRate = 0
}) => {
    const isMining = status === 'Mining';
    const isSyncing = status === 'Syncing' || status === 'CatchingUp';
    const isWaiting = status === 'Waiting';

    let statusText = 'Stopped / Synced';
    let statusClass = '';

    if (isMining) {
        statusText = '✅ Active Mining';
        statusClass = styles.statusReady;
    } else if (isSyncing) {
        statusText = `Catching Up (${catchUpProgress || ''})`;
        statusClass = styles.statusSyncing;
    } else if (isWaiting) {
        statusText = 'Waiting for Network';
        statusClass = styles.statusSyncing;
    } else {
        statusText = '✅ Synced / Waiting';
        statusClass = styles.statusReady;
    }

    return (
        <div className={styles.card}>
            <div className={styles.header}>
                <span>挖矿控制与状态 (Mining Guard)</span>
            </div>

            <div className={styles.controlCardTop}>
                <button
                    id="toggle-mining"
                    className={`${styles.btn} ${isMining ? styles.btnDanger : styles.btnStart}`}
                    onClick={onToggleMining}
                    disabled={isSyncing && !isMining}
                >
                    {isMining ? '停止挖矿 (Stop Mining)' : '启动挖矿 (Start Mining)'}
                </button>

                <div id="mining-status-badge" className={`${styles.statusBadge} ${statusClass}`}>
                    {isSyncing && <span style={{ marginRight: 5 }}>⏳</span>}
                    {statusText}
                </div>
            </div>

            {error && (
                <div id="error-alert" className={styles.errorAlert} style={{ display: 'block' }}>
                    ⚠️ <strong>Quorum Check:</strong> {error}
                </div>
            )}

            <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: '0.9em', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        id="auto-mining-toggle"
                        checked={autoMining}
                        onChange={(e) => onToggleAutoMining(e.target.checked)}
                        style={{ marginRight: 8 }}
                    />
                    Auto-Mining Toggle (链就绪时自动开始)
                </label>
            </div>

            <button 
                id="catch-up-btn"
                className={styles.btn}
                style={{ 
                    background: '#58a6ff', 
                    color: 'white',
                    marginTop: 15,
                    width: '100%'
                }}
                disabled={!isCatchingUp}
            >
                {isCatchingUp ? `Catching Up (${catchUpProgress || ''})` : 'Synced'}
            </button>

            <p style={{ fontSize: '0.8em', color: '#58a6ff', marginTop: 5 }}>
                Sync Mode: <span id="sync-mode">{syncMode}</span> | Rate: <span id="sync-rate">{syncRate > 0 ? `${syncRate.toFixed(1)} blocks/s` : '-- blocks/s'}</span>
            </p>
        </div>
    );
};
