import React, { useState, useEffect, useRef } from 'react';
import { useMiningData } from '../../features/miner-dashboard/hooks/useMiningData';
import { ChainContext } from '../../core/chain';
import { MinerClient } from '../../core/minerClient';
import styles from '../../features/miner-dashboard/styles/miner-console.module.css';

interface MiningConsolePageProps {
    chainContext: ChainContext | null;
    minerClient: MinerClient;
    nodeAddress: string | null;
    isMining: boolean;
    onToggleMining: () => void;
    p2pNode: any;
    finalityManager?: any;
    localRole?: string;
    bootstrapComplete?: boolean;
}

export const MiningConsolePage: React.FC<MiningConsolePageProps> = (props) => {
    const [activePage, setActivePage] = useState<'mining' | 'wallet'>('mining');
    const [autoMining, setAutoMining] = useState(true);
    const [isLiveFeedActive, setIsLiveFeedActive] = useState(true);

    // Override body background when Console is active
    useEffect(() => {
        const originalBg = document.body.style.background;
        const originalColor = document.body.style.color;
        document.body.style.background = '#0d1117';
        document.body.style.color = '#c9d1d9';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        
        return () => {
            document.body.style.background = originalBg;
            document.body.style.color = originalColor;
        };
    }, []);

    const {
        status,
        balance,
        localHeight,
        networkHeight,
        peerCount,
        blocks,
        isLiveFeedActive: hookIsLiveFeedActive,
        syncRate,
        effectiveWeight,
        projectedReward,
        onlineScore,
        currentEpoch,
        currentSlot,
        nextLeader,
        slotPreview,
        toggleMining,
        setIsLiveFeedActive: setHookIsLiveFeedActive,
        miningGuardResult
    } = useMiningData({
        chainContext: props.chainContext,
        isMiningGlobal: props.isMining,
        onToggleMiningGlobal: props.onToggleMining,
        nodeAddress: props.nodeAddress,
        p2pNode: props.p2pNode,
        minerClient: props.minerClient,
        finalityManager: props.finalityManager,
        localRole: props.localRole,
        bootstrapComplete: props.bootstrapComplete
    });

    // Show guard reason / user feedback
    const [guardMessage, setGuardMessage] = useState<string>("");

    // Sync local state with hook state
    useEffect(() => {
        if (hookIsLiveFeedActive !== isLiveFeedActive) {
            setIsLiveFeedActive(hookIsLiveFeedActive);
        }
    }, [hookIsLiveFeedActive]);

    const isCatchingUp = status === 'CatchingUp' || status === 'Syncing';
    const isMining = status === 'Mining';

    // Auto-start mining when ready and autoMining enabled
    useEffect(() => {
        if (!props.chainContext) return;
        if (autoMining && !isMining && miningGuardResult?.ok) {
            toggleMining(); // start mining
        }
    }, [autoMining, isMining, miningGuardResult?.ok]);

    const handleToggleLiveFeed = () => {
        const newState = !isLiveFeedActive;
        setIsLiveFeedActive(newState);
        setHookIsLiveFeedActive(newState);
    };

    // Keep a human-readable guard reason (we no longer block start while syncing)
    useEffect(() => {
        if (isMining) {
            setGuardMessage('');
            return;
        }
        if (peerCount <= 0) {
            setGuardMessage('⚠️ No peers connected. Connect to network to start mining.');
            return;
        }
        if (miningGuardResult && !miningGuardResult.ok) {
            setGuardMessage(`⚠️ ${miningGuardResult.reason || 'Mining guard blocked.'}`);
            return;
        }
        setGuardMessage('');
    }, [isMining, peerCount, networkHeight, localHeight, miningGuardResult]);

    // Auto rebase: only when local chain is empty and network已有高度时，才执行一次性重对齐
    const autoRebasedRef = useRef(false);
    useEffect(() => {
        if (autoRebasedRef.current) return;
        if (!props.chainContext || !props.p2pNode) return;
        if (peerCount <= 0) return;
        // 仅当本地为 0 且网络有高度时重置，避免把已挖的本地区块误清空
        if (networkHeight > 0 && localHeight === 0) {
            try {
                // 不再强制 reset，仅触发引导拉取
            } catch {}
            autoRebasedRef.current = true;
            // Trigger aggressive catch-up after short delay
            setTimeout(() => {
                // Re-query network height then request blocks
                if (props.p2pNode?.broadcast) {
                    props.p2pNode.broadcast('GLOBAL_VIEW_REQUEST', {});
                }
                // Use the same catch-up routine
                handleCatchUp();
            }, 300);
        }
    }, [peerCount, localHeight, networkHeight, props.chainContext, props.p2pNode]);

    // Minimal P2P wiring for Console-only mode (ensure sync works even when App side-effects are not mounted)
    useEffect(() => {
        const ctx = props.chainContext as any;
        const p2p = props.p2pNode as any;
        if (!ctx || !p2p) return;

        // GLOBAL_VIEW_RESPONSE → update network height hint
        const onGlobalViewResponse = (data: any) => {
            try {
                const h = Number(data?.height || 0);
                if (Number.isFinite(h) && h >= 0) {
                    const prev = (window as any).lastRootTipHeight || 0;
                    (window as any).lastRootTipHeight = Math.max(prev, h);
                }
                const avail = Number(data?.availableFromHeight || 0);
                if (Number.isFinite(avail) && avail >= 0) {
                    (window as any).lastAvailableFromHeight = avail;
                }
            } catch {}
        };

        // NEW_BLOCK_HEADER → header-first relay handling
        const onNewBlockHeader = async (compactHeader: any, sender: string) => {
            try {
                const { handleReceivedBlockHeader } = await import("../../core/sync.js");
                await handleReceivedBlockHeader(compactHeader, ctx, p2p, sender);
            } catch {}
        };

        // NEW_BLOCK → append full block
        const onNewBlock = async (block: any, sender: string) => {
            try {
                const { handleReceivedBlock } = await import("../../core/sync.js");
                await handleReceivedBlock(block, ctx, p2p, sender);
            } catch {}
        };

        // BLOCKS (batch) → append each
        const onBlocks = async (payload: any, sender: string) => {
            try {
                const { handleReceivedBlock } = await import("../../core/sync.js");
                const list: any[] = Array.isArray(payload?.blocks) ? payload.blocks : [];
                for (const b of list) {
                    await handleReceivedBlock(b, ctx, p2p, sender);
                }
            } catch {}
        };

        // Register listeners (offMessage may not exist; ignore cleanup if absent)
        try { p2p.onMessage?.("GLOBAL_VIEW_RESPONSE", onGlobalViewResponse); } catch {}
        try { p2p.onMessage?.("NEW_BLOCK_HEADER", onNewBlockHeader); } catch {}
        try { p2p.onMessage?.("NEW_BLOCK", onNewBlock); } catch {}
        try { p2p.onMessage?.("BLOCKS", onBlocks); } catch {}
        // Handle BOOTSTRAP_RESPONSE to quickly raise local height from 0
        try { 
            p2p.onMessage?.("BOOTSTRAP_RESPONSE", async (payload: any) => {
                try {
                    // Update hints
                    if (typeof window !== "undefined" && payload?.latestHeight > 0) {
                        (window as any).lastRootTipHeight = payload.latestHeight;
                        (window as any).lastRootTipHash = payload.latestHeaderHash || "";
                        if (payload.availableFromHeight) {
                            (window as any).lastAvailableFromHeight = payload.availableFromHeight;
                        }
                    }
                    // Apply bootstrap data using BootstrapSyncManager
                    const { BootstrapSyncManager } = await import("../../core/bootstrapSync.js");
                    const mgr = new BootstrapSyncManager(ctx);
                    await mgr.processBootstrapResponse(payload);
                } catch {}
            }); 
        } catch {}
        // Handle BOOTSTRAP_BLOCKS (WS) → append blocks directly
        try {
            p2p.onMessage?.("BOOTSTRAP_BLOCKS", async (payload: any) => {
                try {
                    const list: any[] = Array.isArray(payload?.blocks) ? payload.blocks : [];
                    if (!ctx || list.length === 0) return;
                    // Append in ascending order
                    const sorted = list.slice().sort((a, b) => (a?.header?.height || 0) - (b?.header?.height || 0));
                    for (const b of sorted) {
                        try {
                            ctx.storage.appendBlock(b);
                            ctx.indexState.applyBlock(b);
                        } catch (e) {
                            // ignore individual failures
                        }
                    }
                    const tip = ctx.storage.getTip();
                    if (tip) {
                        (window as any).lastRootTipHeight = Math.max((window as any).lastRootTipHeight || 0, tip.header.height);
                    }
                } catch {}
            });
        } catch {}

        // Proactively query network view on mount (to peers and signal server)
        try { p2p.broadcast?.("GLOBAL_VIEW_REQUEST", {}); } catch {}
        try { p2p.sendToSignalServer?.("GLOBAL_VIEW_REQUEST", {}); } catch {}
        try { p2p.sendToSignalServer?.("REQUEST_BOOTSTRAP", { wantHeaders: true, headerCount: 500, wantSnapshotMeta: false }); } catch {}
        // Expose for debugging in console
        try { (window as any).p2p = p2p; (window as any).chainContext = ctx; } catch {}

        return () => {
            try { p2p.offMessage?.("GLOBAL_VIEW_RESPONSE", onGlobalViewResponse); } catch {}
            try { p2p.offMessage?.("NEW_BLOCK_HEADER", onNewBlockHeader); } catch {}
            try { p2p.offMessage?.("NEW_BLOCK", onNewBlock); } catch {}
            try { p2p.offMessage?.("BLOCKS", onBlocks); } catch {}
        };
    }, [props.chainContext, props.p2pNode]);

    const copyAddress = () => {
        if (props.nodeAddress) {
            navigator.clipboard.writeText(props.nodeAddress);
            alert("Miner Address copied!");
        }
    };

    const copyWalletAddress = () => {
        if (props.nodeAddress) {
            navigator.clipboard.writeText(props.nodeAddress);
            alert("Wallet Address copied!");
        }
    };

    const getSyncMode = () => {
        const diff = networkHeight - localHeight;
        if (diff > 1000) return 'Warp Sync';
        if (diff > 100) return 'Chunk Sync';
        if (diff > 0) return 'FastSync500';
        return 'Synced';
    };

    // Smooth visual state for mining button to avoid flicker during auto restarts
    const [displayMining, setDisplayMining] = useState<boolean>(false);
    const lastOkTsRef = useRef<number>(0);
    useEffect(() => {
        const now = Date.now();
        if (isMining) {
            setDisplayMining(true);
            lastOkTsRef.current = now;
            return;
        }
        const guardOk = !!(autoMining && (miningGuardResult?.ok ?? false) && peerCount > 0 && localHeight >= networkHeight);
        if (guardOk) {
            setDisplayMining(true);
            lastOkTsRef.current = now;
        } else {
            // only turn off after a grace period to avoid UI flicker
            const graceMs = 3000;
            if (now - lastOkTsRef.current > graceMs) {
                setDisplayMining(false);
            }
        }
    }, [isMining, autoMining, miningGuardResult?.ok, peerCount, localHeight, networkHeight]);

    const getStatusBadgeText = () => {
        if (displayMining) return '✅ Active Mining';
        if (isCatchingUp) {
            const diff = networkHeight - localHeight;
            return `Catching Up (${diff.toFixed(0)})`;
        }
        return '✅ Synced / Waiting';
    };

    const getStatusBadgeClass = () => {
        if (displayMining) return styles.statusReady;
        if (isCatchingUp) return styles.statusSyncing;
        return styles.statusReady;
    };
    
    // One-click Catch-up: aggressively request missing blocks
    const handleCatchUp = async () => {
        const { chainContext, p2pNode } = props;
        if (!chainContext || !p2pNode) return;
        try {
            // Ask peers for their global view first
            if (p2pNode.broadcast) {
                p2pNode.broadcast("GLOBAL_VIEW_REQUEST", {});
            }
            // Small delay to allow responses to update window.lastRootTipHeight
            setTimeout(() => {
                const local = chainContext.storage.getTip()?.header.height || 0;
                const network = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || local;
                const availableFrom = (typeof window !== 'undefined' && (window as any).lastAvailableFromHeight) || 0;
                const step = 500;
                // Fallback window near network tip to handle peer pruning (light node)
                const fallbackFrom = Math.max(1, (network > 0 ? (network - step + 1) : 1));
                // Prefer availableFromHeight if provided, otherwise probe near tip
                const startFrom = Math.max(local + 1, availableFrom > 0 ? availableFrom : fallbackFrom);
                // If network height未知，仍然向前探测一个窗口
                const target = Math.max(network > 0 ? network : (startFrom + step - 1), startFrom + step - 1);
                for (let from = startFrom; from <= target; from += step) {
                    const to = Math.min(from + step - 1, target);
                    // Broadcast range request
                    try {
                        p2pNode.broadcast("REQUEST_BLOCKS", { fromHeight: from, toHeight: to });
                    } catch {}
                    // Also try direct requests to each peer if available
                    try {
                        if (p2pNode.sendToPeer && p2pNode.peers) {
                            const peerIds: string[] = Array.from(p2pNode.peers.keys());
                            peerIds.forEach((peerId: string) => {
                                const peer = p2pNode.peers.get(peerId);
                                if (peer && peer.connected && peer.dataChannel?.readyState === "open") {
                                    p2pNode.sendToPeer(peerId, "REQUEST_BLOCKS", { fromHeight: from, toHeight: to });
                                }
                            });
                        }
                    } catch {}
                }
                // Bootstrap protocol as fallback
                try { p2pNode.broadcast?.("REQUEST_BOOTSTRAP", {}); } catch {}
            }, 300);
        } catch {
            // no-op
        }
    };

    // Persistent catch-up retry until synced
    useEffect(() => {
        const { chainContext, p2pNode } = props;
        if (!chainContext || !p2pNode) return;
        const retry = setInterval(() => {
            try {
                const local = chainContext.storage.getTip()?.header.height || 0;
                const network = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || 0;
                const availableFrom = (typeof window !== 'undefined' && (window as any).lastAvailableFromHeight) || 0;
                if (peerCount > 0 && (network === 0 || local < network)) {
                    const step = 500;
                    const fallbackFrom = Math.max(1, (network > 0 ? (network - step + 1) : 1));
                    const startFrom = Math.max(local + 1, availableFrom > 0 ? availableFrom : fallbackFrom);
                    const target = Math.max(network > 0 ? network : (startFrom + step), startFrom + step);
                    for (let from = startFrom; from <= target; from += step) {
                        const to = Math.min(from + step - 1, target);
                        p2pNode.broadcast?.("REQUEST_BLOCKS", { fromHeight: from, toHeight: to });
                        if (p2pNode.sendToPeer && p2pNode.peers) {
                            const ids: string[] = Array.from(p2pNode.peers.keys());
                            ids.forEach((id: string) => {
                                const peer = p2pNode.peers.get(id);
                                if (peer?.connected && peer.dataChannel?.readyState === "open") {
                                    p2pNode.sendToPeer(id, "REQUEST_BLOCKS", { fromHeight: from, toHeight: to });
                                }
                            });
                        }
                    }
                    // Also ask for bootstrap occasionally
                    p2pNode.broadcast?.("REQUEST_BOOTSTRAP", {});
                    p2pNode.sendToSignalServer?.("REQUEST_BOOTSTRAP", { wantHeaders: true, headerCount: 500 });
                    p2pNode.sendToSignalServer?.("REQUEST_BOOTSTRAP_BLOCKS", { from: startFrom, to: startFrom + step });
                    p2pNode.sendToSignalServer?.("GLOBAL_VIEW_REQUEST", {});
                }
            } catch {}
        }, 2000);
        return () => clearInterval(retry);
    }, [props.chainContext, props.p2pNode, peerCount]);

    const formatAddress = (addr: string) => {
        if (!addr) return 'Loading...';
        return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
    };

    if (!props.chainContext) {
        return (
            <div className={styles.appContainer}>
                <div className={styles.sidebar}>
                    <div className={styles.logo}>IndexerChain</div>
                </div>
                <div className={styles.mainContent}>
                    <div style={{ color: '#c9d1d9', padding: 20 }}>Initializing chain...</div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.appContainer}>
            {/* Sidebar Navigation */}
            <div className={styles.sidebar}>
                <div className={styles.logo}>IndexerChain</div>
                <a 
                    href="#mining" 
                    className={`${styles.navLink} ${activePage === 'mining' ? styles.active : ''}`}
                    onClick={(e) => {
                        e.preventDefault();
                        setActivePage('mining');
                    }}
                >
                    ⛏️ Mining
                </a>
                <a 
                    href="#wallet" 
                    className={`${styles.navLink} ${activePage === 'wallet' ? styles.active : ''}`}
                    onClick={(e) => {
                        e.preventDefault();
                        setActivePage('wallet');
                    }}
                >
                    💳 Wallet
                </a>
                <a href="#" className={styles.navLink} style={{ opacity: 0.6 }}>
                    ⚙️ Advanced (Hidden)
                </a>
            </div>

            {/* Main Content */}
            <div className={styles.mainContent}>
                {/* Mining Page */}
                {activePage === 'mining' && (
                    <div className={styles.pageContent}>
                        <h1>IndexerChain Miner Console</h1>

                        {/* Wallet Display Bar */}
                        <div className={styles.walletDisplayBar}>
                            <div className={styles.addressInfo}>
                                <span className={styles.balanceLabel}>Miner Address:</span>
                                <span style={{ color: '#4ee672', fontWeight: 'bold', marginLeft: 10 }}>
                                    {formatAddress(props.nodeAddress || '')}
                                </span>
                                <button 
                                    id="copy-address-btn"
                                    onClick={copyAddress}
                                    style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', marginLeft: 10 }}
                                >
                                    📋
                                </button>
                            </div>
                            
                            <div className={styles.balanceInfo}>
                                <span className={styles.balanceLabel}>Current Balance (IDC):</span>
                                <span className={styles.balanceAmount} id="current-balance">{balance.toFixed(2)}</span>
                            </div>
                        </div>

                        {/* Address Bar */}
                        <div className={styles.addressBar}>
                            <span>
                                Local Height: <span className={styles.dataValue} id="local-height-bar">{localHeight.toLocaleString()}</span> | 
                                Network Height: <span className={styles.dataValue} id="network-height-bar">{networkHeight.toLocaleString()}</span> | 
                                Peers: <span className={styles.dataValue} id="peer-count-bar">{peerCount}</span>
                            </span>
                        </div>

                        {/* Dashboard Grid */}
                        <div className={styles.dashboardGrid}>
                            {/* Left Panel */}
                            <div className={styles.leftPanel}>
                                {/* Control Card */}
                                <div className={`${styles.card} ${styles.controlCard}`}>
                                    <h3>挖矿控制与状态 (Mining Guard)</h3>

                                    <div className={styles.controlCardTop}>
                                        <button
                                            id="toggle-mining"
                                            className={`${styles.btn} ${isMining ? styles.btnDanger : styles.btnStart}`}
                                            onClick={() => {
                                                // Optimistic UI update for immediate feedback
                                                setDisplayMining(prev => !prev);
                                                toggleMining();
                                            }}
                                            disabled={false}
                                            title={guardMessage || ''}
                                        >
                                            {displayMining ? '停止挖矿 (Stop Mining)' : '启动挖矿 (Start Mining)'}
                                        </button>

                                        <div id="mining-status-badge" className={`${styles.miningStatusBadge} ${getStatusBadgeClass()}`}>
                                            {isCatchingUp && <span className={styles.spinner}>⏳</span>}
                                            {getStatusBadgeText()}
                                        </div>
                                    </div>

                                    <div
                                      id="error-alert"
                                      className={styles.errorAlert}
                                      style={{ display: !isMining && guardMessage ? 'block' : 'none' }}
                                    >
                                      {guardMessage}
                                    </div>

                                    <div style={{ marginTop: 10 }}>
                                        <input 
                                            type="checkbox" 
                                            id="auto-mining-toggle" 
                                            checked={autoMining}
                                            onChange={(e) => setAutoMining(e.target.checked)}
                                        />
                                        <label htmlFor="auto-mining-toggle" style={{ fontSize: '0.9em', marginLeft: 8 }}>
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
                                        disabled={!isCatchingUp || peerCount <= 0}
                                        onClick={handleCatchUp}
                                    >
                                        {isCatchingUp ? `Catching Up (${(networkHeight - localHeight).toFixed(0)} blocks left)` : 'Synced'}
                                    </button>

                                    {/* Secondary force-start button removed to avoid confusion */}

                                    <p style={{ fontSize: '0.8em', color: '#58a6ff', marginTop: 5 }}>
                                        Sync Mode: <span id="sync-mode">{getSyncMode()}</span> | Rate: <span id="sync-rate">{syncRate > 0 ? `${syncRate.toFixed(1)} blocks/s` : '-- blocks/s'}</span>
                                    </p>
                                </div>

                                {/* Slot Card */}
                                <div className={`${styles.card} ${styles.slotCard}`}>
                                    <h3>Slot 领导者轮换 (50ms Slot)</h3>
                                    
                                    <p>
                                        <span className={styles.dataLabel}>当前 Epoch / Slot:</span> 
                                        <span className={styles.dataValue} id="current-epoch">E: {currentEpoch}</span> / <span className={styles.dataValue} id="current-slot">S: {currentSlot}</span>
                                    </p>
                                    
                                    <p>
                                        <span className={styles.dataLabel}>预计 Leader (Next Slot):</span> 
                                        <span className={styles.dataValue} id="predicted-leader" style={{ color: '#4ee672' }}>{nextLeader}</span>
                                    </p>

                                    <p className={styles.dataLabel} style={{ marginTop: 15 }}>下一 5 个 Slot 预览:</p>
                                    <div className={styles.slotPreview} id="slot-preview">
                                        {slotPreview.map((slot, i) => (
                                            <span 
                                                key={i}
                                                className={`${styles.slotItem} ${slot.isSelf ? styles.slotItemYou : ''}`}
                                            >
                                                {slot.isSelf ? 'You' : slot.leader}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {/* Weight Card */}
                                <div className={`${styles.card} ${styles.weightCard}`}>
                                    <h3>奖励预估与权重 (Pooled Rewards)</h3>
                                    
                                    <p>
                                        <span className={styles.dataLabel}>我的有效权重:</span> 
                                        <span className={styles.dataValueLg} id="effective-weight">{effectiveWeight.toFixed(2)}</span>
                                    </p>
                                    <p>
                                        <span className={styles.dataLabel}>预估日奖励 (IDC):</span> 
                                        <span className={styles.dataValue} id="projected-reward">≈ {projectedReward.toFixed(2)} IDC</span>
                                    </p>
                                    <hr style={{ border: 0, borderTop: '1px solid #30363d', margin: '15px 0' }} />
                                    
                                    <p className={styles.smallInfo}>
                                        <span className={styles.dataLabel}>Online Score:</span> 
                                        <span className={styles.dataValue} style={{ fontSize: '1em', color: '#4ee672' }}>{onlineScore}%</span>
                                    </p>
                                </div>
                            </div>

                            {/* Right Panel - Blocks Card */}
                            <div className={`${styles.card} ${styles.blocksCard}`}>
                                <h3>
                                    <span>实时区块列表 (Live Block Feed)</span>
                                    <button 
                                        id="toggle-live-feed" 
                                        className={`${styles.liveToggleBtn} ${isLiveFeedActive ? styles.liveToggleLive : styles.liveTogglePaused}`}
                                        onClick={handleToggleLiveFeed}
                                    >
                                        {isLiveFeedActive ? '暂停 (Pause) ⏸️' : '实时 (Live) 🟢'}
                                    </button>
                                </h3>
                                <div className={styles.liveFeedContainer} id="live-feed-container">
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
                                        <tbody id="live-block-feed-body">
                                            {blocks.map((block, idx) => (
                                                <tr key={`${block.hash}-${idx}`} className={styles.tableRow}>
                                                    <td>{block.height.toLocaleString()}</td>
                                                    <td>{block.hash}</td>
                                                    <td>
                                                        <span style={{ color: block.isSelf ? '#4ee672' : '#c9d1d9' }}>
                                                            {block.leader}
                                                        </span>
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
                        </div>
                    </div>
                )}

                {/* Wallet Page */}
                {activePage === 'wallet' && (
                    <div className={styles.pageContent}>
                        <h1>Wallet Summary (Integrated)</h1>

                        <div className={styles.walletCard}>
                            <h2>当前 IDC 余额</h2>
                            <div className={styles.balanceDisplay}>
                                <span id="wallet-summary-balance">{balance.toFixed(2)}</span> <span style={{ fontSize: '0.6em', color: '#c9d1d9' }}>IDC</span>
                            </div>
                            
                            <p className={styles.dataLabel}>主钱包地址:</p>
                            <div className={styles.walletAddressBox}>
                                <span id="wallet-full-address" style={{ fontFamily: 'Consolas, Courier New, monospace' }}>
                                    {props.nodeAddress || 'Loading...'}
                                </span>
                                <button 
                                    onClick={copyWalletAddress}
                                    style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', marginLeft: 10 }}
                                >
                                    📋
                                </button>
                            </div>

                            <p style={{ marginTop: 20, color: '#8b949e' }}>
                                Tip: 钱包管理和备份功能被折叠在 <strong>Advanced</strong> 设置中。
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
