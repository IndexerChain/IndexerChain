import React, { useState, useEffect, useRef } from 'react';
import { useMiningData } from '../../features/miner-dashboard/hooks/useMiningData';
import { LiveBlockFeed } from '../components/LiveBlockFeed';
import { WalletSummaryCard } from '../wallet/WalletSummaryCard';
import { WalletManagerPanel } from '../WalletManagerPanel';
import { WalletBackupPanel } from '../WalletBackupPanel';
import { ChainContext } from '../../core/chain';
import { MinerClient } from '../../core/minerClient';
import styles from '../../features/miner-dashboard/styles/miner-console.module.css';
import { getSlotIdentity, deriveRandSeed, selectLeader } from '../../core/slotSchedule.js';
import { useI18n } from '../../i18n/useI18n.js';

// Mining Guard card - memoized to avoid refresh; only changes on explicit prop changes (clicks)
const MiningGuardCard = React.memo((props: {
    displayMining: boolean;
    guardMessage: string;
    autoMining: boolean;
    onToggleMining: () => void;
    onToggleAutoMining: (checked: boolean) => void;
    showStatusBadge?: boolean;
    lightMode?: boolean;
    t: (path: string) => string;
}) => {
    const { displayMining, guardMessage, autoMining, onToggleMining, onToggleAutoMining, showStatusBadge, lightMode, t } = props;
    return (
        <div className={`${styles.card} ${styles.controlCard}`}>
            <h3>{lightMode ? t('miningConsole.provingGuardTitle') : t('miningConsole.miningGuardTitle')}</h3>
            <div className={styles.controlCardTop}>
                <button
                    id="toggle-mining"
                    className={`${styles.btn} ${displayMining ? styles.btnDanger : styles.btnStart}`}
                    onClick={onToggleMining}
                    title={guardMessage || ''}
                >
                    {displayMining ? (lightMode ? t('miningConsole.stopProving') : t('miningConsole.stopMining')) : (lightMode ? t('miningConsole.startProving') : t('miningConsole.startMining'))}
                </button>
                {showStatusBadge !== false && (
                    <div id="mining-status-badge" className={`${styles.miningStatusBadge} ${displayMining ? styles.statusReady : styles.statusSyncing}`}>
                        {displayMining ? t('miningConsole.activeMining') : t('miningConsole.syncedWaiting')}
                    </div>
                )}
            </div>
            <div
                id="error-alert"
                className={styles.errorAlert}
                style={{ display: !displayMining && guardMessage ? 'block' : 'none' }}
            >
                {guardMessage}
            </div>
            <div style={{ marginTop: 10 }}>
                <input
                    type="checkbox"
                    id="auto-mining-toggle"
                    checked={autoMining}
                    onChange={(e) => onToggleAutoMining(e.target.checked)}
                />
                <label htmlFor="auto-mining-toggle" style={{ fontSize: '0.9em', marginLeft: 8 }}>
                    {t('miningConsole.autoMining')} ({t('mining.autoMiningDesc')})
                </label>
            </div>
        </div>
    );
}, (prev, next) => (
    prev.displayMining === next.displayMining &&
    prev.autoMining === next.autoMining &&
    prev.guardMessage === next.guardMessage &&
    prev.showStatusBadge === next.showStatusBadge
));

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
    const { t, locale, setLocale } = useI18n();
    const [activePage, setActivePage] = useState<'mining' | 'wallet'>('mining');
    const [walletRefreshKey, setWalletRefreshKey] = useState<number>(0);
    const [autoMining, setAutoMining] = useState<boolean>(() => {
        try {
            const saved = typeof window !== 'undefined' ? localStorage.getItem('indexer_auto_mining') : null;
            if (saved === '1') return true;
            if (saved === '0') return false;
        } catch {}
        return true;
    });
    const [nodeMode] = useState<'full' | 'light'>(() => {
        try {
            const saved = typeof window !== 'undefined' ? localStorage.getItem('indexer_node_mode') : null;
            if (saved === 'light' || saved === 'full') return saved as any;
        } catch {}
        return 'full';
    });
    // Removed zkVerified and zkLatencyMs - status bar removed
    const [leaderThisSlot, setLeaderThisSlot] = useState<string | null>(null);
    const [payoutProof, setPayoutProof] = useState<{
        ok: boolean;
        height?: number;
        address?: string;
        entry?: string;
        root?: string;
        leafHash?: string;
        siblings?: string[];
        positions?: ('L'|'R')[];
        verified?: boolean;
        error?: string;
    } | null>(null);
    
    // Refs for aligning card heights
    const leftPanelRef = useRef<HTMLDivElement>(null); // Left panel container (contains 3 cards)
    const rightPanelRef = useRef<HTMLDivElement>(null); // Right panel container (contains 2 cards)
    const liveBlockFeedRef = useRef<HTMLDivElement>(null);
    const provingPanelRef = useRef<HTMLDivElement>(null);
    
    // Align heights - ensure right panel (Live Block Feed + Proving Panel) total height equals left panel (3 cards) total height
    useEffect(() => {
        let lastLeftHeight = 0;
        let lastRightHeight = 0;
        let alignmentTimer: NodeJS.Timeout | null = null;
        
        const alignHeights = () => {
            if (leftPanelRef.current && rightPanelRef.current && liveBlockFeedRef.current && provingPanelRef.current) {
                // Get total height of left panel (3 cards + gaps between them)
                const leftPanelHeight = leftPanelRef.current.offsetHeight;
                
                // Get height of Live Block Feed component
                const liveBlockFeedHeight = liveBlockFeedRef.current.offsetHeight;
                
                // Only update if heights have actually changed to avoid unnecessary reflows
                if (leftPanelHeight === lastLeftHeight && liveBlockFeedHeight === lastRightHeight) {
                    return;
                }
                
                // Calculate required height for Proving Panel
                // Right panel total = Live Block Feed height + gap + Proving Panel height
                // We need: Live Block Feed height + gap + Proving Panel height = Left panel height
                // So: Proving Panel height = Left panel height - Live Block Feed height - gap
                const gap = 20; // gap between cards (from CSS: gap: calc(var(--spacing-unit) * 2) = 20px)
                const requiredProvingPanelHeight = leftPanelHeight - liveBlockFeedHeight - gap;
                
                if (requiredProvingPanelHeight > 0) {
                    const currentMinHeight = provingPanelRef.current.style.minHeight;
                    const newMinHeight = `${requiredProvingPanelHeight}px`;
                    // Only update if the value actually changed
                    if (currentMinHeight !== newMinHeight) {
                        provingPanelRef.current.style.minHeight = newMinHeight;
                        lastLeftHeight = leftPanelHeight;
                        lastRightHeight = liveBlockFeedHeight;
                    }
                } else {
                    // If calculation results in negative, remove minHeight to let it be natural
                    if (provingPanelRef.current.style.minHeight) {
                        provingPanelRef.current.style.minHeight = '';
                    }
                }
            }
        };
        
        // Debounced alignment function
        const debouncedAlign = () => {
            if (alignmentTimer) {
                clearTimeout(alignmentTimer);
            }
            alignmentTimer = setTimeout(alignHeights, 50);
        };
        
        // Initial alignment - wait for DOM to be ready
        const timer1 = setTimeout(alignHeights, 200);
        const timer2 = setTimeout(alignHeights, 500);
        const timer3 = setTimeout(alignHeights, 1000);
        
        // Observe resize changes with debouncing
        const resizeObserver = new ResizeObserver(() => {
            debouncedAlign();
        });
        
        if (leftPanelRef.current) resizeObserver.observe(leftPanelRef.current);
        if (rightPanelRef.current) resizeObserver.observe(rightPanelRef.current);
        if (liveBlockFeedRef.current) resizeObserver.observe(liveBlockFeedRef.current);
        if (provingPanelRef.current) resizeObserver.observe(provingPanelRef.current);
        
        return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
            clearTimeout(timer3);
            if (alignmentTimer) clearTimeout(alignmentTimer);
            resizeObserver.disconnect();
        };
    }, [payoutProof]);

    // Override body background when Console is active
    useEffect(() => {
        const originalBg = document.body.style.background;
        const originalColor = document.body.style.color;
        document.body.style.background = 'var(--color-background)';
        document.body.style.color = '#c9d1d9';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        
        return () => {
            document.body.style.background = originalBg;
            document.body.style.color = originalColor;
        };
    }, []);

	// Helpers for compact display
	const shortHash = (v?: string, len: number = 12) => {
		if (!v || typeof v !== 'string') return '--';
		return v.length > len ? `${v.substring(0, len)}...` : v;
	};
	const shortAddr = (a?: string, head: number = 8, tail: number = 4) => {
		if (!a || typeof a !== 'string') return '--';
		if (a.length <= head + tail) return a;
		return `${a.substring(0, head)}...${a.substring(a.length - tail)}`;
	};
	const humanLeader = (s?: string) => {
		if (!s) return '--';
		return s.startsWith('idc_') ? shortAddr(s, 8, 4) : s;
	};

    // Compute current slot leader via VRF (deterministic, equal-weighted from last coinbase recipients)
    useEffect(() => {
        let cancelled = false;
        const compute = async () => {
            try {
                const ctx = props.chainContext;
                const tip = ctx?.storage.getTip() || null;
                if (!tip) {
                    if (!cancelled) setLeaderThisSlot(null);
                    return;
                }
                const now = Date.now();
                const { epochId, slotIndex } = getSlotIdentity(now);
                const seed = await deriveRandSeed(tip.hash, epochId, slotIndex);
                const recipients: string[] = [];
                const coinbase = tip.txs?.[0];
                if (coinbase && coinbase.ownerAddress === 'idc_system') {
                    for (const op of coinbase.ops) {
                        if (op.type === 'TRANSFER' && op.to && typeof op.to === 'string' && op.to.startsWith('idc_')) {
                            if (!recipients.includes(op.to)) recipients.push(op.to);
                        }
                    }
                }
                if (recipients.length === 0 && props.nodeAddress) recipients.push(props.nodeAddress);
                const candidates = recipients.map(a => ({ address: a as any, weight: 1 }));
                const leader = await selectLeader(epochId, slotIndex, seed, candidates);
                if (!cancelled) setLeaderThisSlot(leader || null);
            } catch {
                if (!cancelled) setLeaderThisSlot(null);
            }
        };
        compute();
        const t = setInterval(compute, 500);
        return () => { cancelled = true; clearInterval(t); };
    }, [props.chainContext, props.nodeAddress]);

    // Pool Rewards: handle payout proof from Worker and verify (using positions for order)
    useEffect(() => {
        const p2p: any = props.p2pNode;
        if (!p2p) return;
        const onPayout = async (msg: any) => {
            if (!msg || msg.type !== 'PAYOUT_PROOF') return;
            if (!msg.ok) {
                setPayoutProof({ ok: false, error: msg?.reason || 'UNKNOWN' });
                return;
            }
            try {
                const entry: string = String(msg.entry || '');
                // sha256 hex
                const enc = new TextEncoder().encode(entry);
                const h = await crypto.subtle.digest('SHA-256', enc);
                let acc = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
                const siblings: string[] = Array.isArray(msg.siblings) ? msg.siblings : [];
                const positions: ('L'|'R')[] = Array.isArray(msg.positions) ? msg.positions : [];
                for (let i = 0; i < siblings.length; i++) {
                    const sib = String(siblings[i] || '');
                    const pos = positions[i] || 'R';
                    const combined = pos === 'L' ? (sib + acc) : (acc + sib);
                    const enc2 = new TextEncoder().encode(combined);
                    const h2 = await crypto.subtle.digest('SHA-256', enc2);
                    acc = Array.from(new Uint8Array(h2)).map(b => b.toString(16).padStart(2, '0')).join('');
                }
                const verified = acc === String(msg.root || '');
                setPayoutProof({
                    ok: true,
                    height: Number(msg.height || 0) || 0,
                    address: String(msg.address || ''),
                    entry,
                    root: String(msg.root || ''),
                    leafHash: String(msg.leafHash || ''),
                    siblings,
                    positions,
                    verified
                });
            } catch {
                setPayoutProof({ ok: false, error: 'VERIFY_ERROR' });
            }
        };
        try { p2p.onMessage?.('PAYOUT_PROOF' as any, onPayout); } catch {}
        return () => { try { p2p.offMessage?.('PAYOUT_PROOF' as any, onPayout); } catch {} };
    }, [props.p2pNode]);

    // Network Health panel data
    const [healthSnapshot, setHealthSnapshot] = useState<{
        local: number;
        signal: number;
        finality: number;
        p2pPeers: number;
        status: 'aligned' | 'syncing' | 'fork_detected' | 'offline';
        isSignalConnected: boolean;
        quorumScore: number;
        isIndependentIPMining: boolean; // Pool Mining Architecture: Independent IP mining status
    }>({ local: 0, signal: 0, finality: 0, p2pPeers: 0, status: 'offline', isSignalConnected: false, quorumScore: 0, isIndependentIPMining: false });
    const [quorumScoreState, setQuorumScoreState] = useState(0);
    // Async update quorumScore
    useEffect(() => {
        const updateQuorumScore = async () => {
            try {
                if (props.chainContext && props.p2pNode) {
                    const { getQuorumManager } = await import('../../core/quorumManager.js');
                    const quorumManager = getQuorumManager();
                    quorumManager.initialize(props.p2pNode, props.chainContext);
                    const quorumStatus = quorumManager.getQuorumStatus();
                    setQuorumScoreState(quorumStatus.totalScore || 0);
                }
            } catch {}
        };
        updateQuorumScore();
        const id = setInterval(updateQuorumScore, 2000);
        return () => clearInterval(id);
    }, [props.chainContext, props.p2pNode]);
    useEffect(() => {
        const id = setInterval(() => {
            const localH = props.chainContext?.storage.getTip()?.header.height || 0;
            const signalH = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || 0;
            const finalizedH = (typeof window !== 'undefined' && (window as any).lastZkFinalizedHeight) || 0;
            const peers = (() => {
                try {
                    const p = props.p2pNode;
                    return p?.peers ? p.peers.size : 0;
                } catch { return 0; }
            })();
            const isSignalConnected = (() => {
                try {
                    const p = props.p2pNode;
                    return p?.isConnected ?? false;
                } catch { return false; }
            })();
            // Pool Mining Architecture: Independent IP mining = Signal connected + QuorumScore >= 30 + peerCount === 0
            const isIndependentIPMining = isSignalConnected && quorumScoreState >= 30 && peers === 0;
            let status: 'aligned' | 'syncing' | 'fork_detected' | 'offline' = 'offline';
            if (signalH === 0 && peers === 0 && !isSignalConnected) status = 'offline';
            else if (localH >= signalH && signalH > 0) status = 'aligned';
            else if (localH < signalH) status = 'syncing';
            // naive fork detection: if we have higher local than signal by a margin
            else if (localH > signalH + 5) status = 'fork_detected';
            setHealthSnapshot({ local: localH, signal: signalH, finality: finalizedH, p2pPeers: peers, status, isSignalConnected, quorumScore: quorumScoreState, isIndependentIPMining });
        }, 1000);
        return () => clearInterval(id);
    }, [props.chainContext, props.p2pNode, quorumScoreState]);

    const {
        status,
        balance,
        localHeight,
        networkHeight,
        peerCount,
        effectiveWeight,
        projectedReward,
        toggleMining,
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

    // Reorg banner: detect local height rollback (depends on localHeight above)
    const [reorgInfo, setReorgInfo] = useState<{ from: number; to: number; count: number } | null>(null);
    const prevLocalHeightRef = useRef<number>(0);
    useEffect(() => {
        const prev = prevLocalHeightRef.current;
        if (typeof localHeight === 'number' && localHeight >= 0) {
            if (prev > 0 && localHeight < prev) {
                setReorgInfo({ from: prev, to: localHeight, count: prev - localHeight });
                setTimeout(() => setReorgInfo(null), 5000);
            }
            prevLocalHeightRef.current = localHeight;
        }
    }, [localHeight]);

    // Show guard reason / user feedback
    const [guardMessage, setGuardMessage] = useState<string>("");
    const [lightVerifiedBalance, setLightVerifiedBalance] = useState<number | null>(null);
    const [lastBalanceProofHeight, setLastBalanceProofHeight] = useState<number>(0);

    // Use local balance from IndexState for immediate UI updates (Critical for mining feedback)
    const [displayBalance, setDisplayBalance] = useState<string>("0.000000");
    const lastDisplayedBalanceRef = useRef<number>(0);
    
    // CRITICAL: Track if we've already initialized to prevent re-initialization from stale state
    const initializedRef = useRef<boolean>(false);
    const lastChainContextIdRef = useRef<string | null>(null);
    
    useEffect(() => {
        const updateBalance = () => {
            if (!props.chainContext || !props.nodeAddress) return;
            try {
                // Get balance from chain kernel (indexState) - the authoritative source
                const localBal = props.chainContext.indexState.getBalance(props.nodeAddress);
                const zkBal = lightVerifiedBalance;
                const windowBal = (typeof window !== 'undefined' && (window as any).lastLocalBalance);
                
                // Priority 1: Chain kernel balance (indexState) - the authoritative source
                // This is the real balance from the chain, always use this as baseline
                let candidate: number = 0;
                
                // Try to get balance from chain state first
                if (typeof localBal === 'number' && Number.isFinite(localBal) && localBal >= 0) {
                    candidate = localBal;
                } else if (typeof zkBal === 'number' && Number.isFinite(zkBal) && zkBal >= 0) {
                    // Fallback to ZK verified balance if indexState is not available
                    candidate = zkBal;
                } else if (typeof windowBal === 'number' && Number.isFinite(windowBal) && windowBal >= 0) {
                    // Fallback to window balance if chain state is not available
                    candidate = windowBal;
                }
                
                // Priority 2: Use window.lastLocalBalance if it's higher (preserves accumulated mining rewards)
                // This works both during active mining and after page reload (if window balance persists)
                if (typeof windowBal === 'number' && Number.isFinite(windowBal) && windowBal > candidate) {
                    candidate = windowBal;
                }
                
                // During active session: prevent rollback to avoid visual flicker
                if (initializedRef.current) {
                    // Prevent visual flicker: only update if change is significant
                    if (Math.abs(candidate - lastDisplayedBalanceRef.current) < 0.000000000001) {
                        return; // Skip update if change is negligible
                    }
                    // During active session, prevent balance from going backwards
                    // (unless it's a significant decrease, which might indicate a reorg)
                    if (candidate < lastDisplayedBalanceRef.current && 
                        (lastDisplayedBalanceRef.current - candidate) > 0.01) {
                        // Significant decrease - might be a reorg, but keep showing higher value
                        // Use window balance if available and higher
                        if (typeof windowBal === 'number' && Number.isFinite(windowBal) && windowBal > candidate) {
                            candidate = windowBal;
                        }
                        // Otherwise trust chain balance
                    }
                }
                
                // Update displayed balance
                lastDisplayedBalanceRef.current = candidate;
                setDisplayBalance(candidate.toFixed(12));
            } catch (e) {
                // ignore
            }
        };
        
        // CRITICAL: Initialize from chain kernel ONLY on first mount or when chainContext actually changes
        // Use chainContext indexState ID to detect if it's a new instance
        const currentContextId = (props.chainContext?.indexState as any)?._debugId || null;
        const isNewContext = currentContextId !== lastChainContextIdRef.current;
        
        if (props.chainContext && props.nodeAddress && (!initializedRef.current || isNewContext)) {
            try {
                const kernelBalance = props.chainContext.indexState.getBalance(props.nodeAddress);
                const windowBal = (typeof window !== 'undefined' && (window as any).lastLocalBalance);
                
                // Initialize with the maximum of chain balance and window balance
                // This preserves accumulated mining rewards across page reloads
                let initialBalance = 0;
                
                if (typeof kernelBalance === 'number' && Number.isFinite(kernelBalance) && kernelBalance >= 0) {
                    initialBalance = kernelBalance;
                }
                
                // Use window balance if it's higher (preserves mining rewards)
                if (typeof windowBal === 'number' && Number.isFinite(windowBal) && windowBal >= 0) {
                    if (windowBal > initialBalance) {
                        initialBalance = windowBal;
                    }
                }
                
                // Set initial balance
                lastDisplayedBalanceRef.current = initialBalance;
                setDisplayBalance(initialBalance.toFixed(12));
                
                // CRITICAL: Don't overwrite window.lastLocalBalance with chain balance if window balance is higher
                // This preserves accumulated mining rewards. Only update if chain balance is higher.
                if (typeof window !== 'undefined') {
                    const currentWindowBal = (window as any).lastLocalBalance;
                    if (typeof kernelBalance === 'number' && Number.isFinite(kernelBalance) && kernelBalance >= 0) {
                        // Only update window balance if chain balance is higher (new blocks confirmed)
                        if (typeof currentWindowBal !== 'number' || kernelBalance > currentWindowBal) {
                            (window as any).lastLocalBalance = kernelBalance;
                        } else {
                            // Preserve window balance if it's higher (accumulated mining rewards)
                            (window as any).lastLocalBalance = currentWindowBal;
                        }
                    } else if (typeof currentWindowBal === 'number' && Number.isFinite(currentWindowBal) && currentWindowBal >= 0) {
                        // If chain balance is not available, keep window balance
                        (window as any).lastLocalBalance = currentWindowBal;
                    }
                }
                
                initializedRef.current = true;
                lastChainContextIdRef.current = currentContextId;
            } catch (e) {
                // ignore
            }
        }
        
        // Update immediately
        updateBalance();
        
        // Update on an interval as a fallback
        const interval = setInterval(updateBalance, 500);
        // Listen for immediate balance updates from App
        const handleBalanceUpdated = (e: any) => {
            try {
                const b = typeof e?.detail?.balance === 'number' ? e.detail.balance : null;
                if (b !== null) {
                    lastDisplayedBalanceRef.current = b;
                    setDisplayBalance(b.toFixed(12));
                }
            } catch {}
        };
        // Also listen for new blocks to trigger update immediately
        const handleNewBlock = () => {
            updateBalance();
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('balanceUpdated', handleBalanceUpdated as any);
            window.addEventListener('newBlock', handleNewBlock as any);
        }
        return () => {
            clearInterval(interval);
            if (typeof window !== 'undefined') {
                window.removeEventListener('balanceUpdated', handleBalanceUpdated as any);
                window.removeEventListener('newBlock', handleNewBlock as any);
            }
        };
    }, [props.chainContext, props.nodeAddress, lightVerifiedBalance, walletRefreshKey]);

    // Sync local state with hook state
    // useEffect(() => {
    //     // isLiveFeedActive no longer synced with hook since hookIsLiveFeedActive was removed
    // }, []);

    const isMining = status === 'Mining';

    // Auto-start mining when ready and autoMining enabled
    // Also stop mining immediately when autoMining is disabled
    useEffect(() => {
        if (!props.chainContext) return;
        if (autoMining && !isMining && miningGuardResult?.ok) {
            toggleMining(); // start mining
        } else if (!autoMining && isMining) {
            // Immediately stop mining when autoMining is disabled
            toggleMining(); // stop mining
        }
    }, [autoMining, isMining, miningGuardResult?.ok]);

    // Reflect autoMining immediately in button visual state
    useEffect(() => {
        setDisplayMining(isMining || autoMining);
    }, [autoMining, isMining]);

    // Persist auto-mining toggle across refresh
    useEffect(() => {
        try {
            if (typeof window !== 'undefined') {
                localStorage.setItem('indexer_auto_mining', autoMining ? '1' : '0');
            }
        } catch {}
    }, [autoMining]);
    // Persist node mode across refresh
    useEffect(() => {
        try {
            if (typeof window !== 'undefined') {
                localStorage.setItem('indexer_node_mode', nodeMode);
            }
        } catch {}
    }, [nodeMode]);

    // Removed ZK verification status/latency mock - status bar removed

    // Keep a human-readable guard reason (we no longer block start while syncing)
    // Pool Mining Architecture: No longer require peers, only Signal/Shadow connection needed
    useEffect(() => {
        if (isMining) {
            setGuardMessage('');
            return;
        }
        // Pool Mining Architecture: Check Signal/Shadow connection instead of peer count
        // Use healthSnapshot.isSignalConnected if available, otherwise check p2pNode directly
        const isSignalConnected = healthSnapshot.isSignalConnected || (props.p2pNode?.isConnected ?? false);
        if (!isSignalConnected) {
            setGuardMessage(t('miningConsole.notConnectedToSignalServer'));
            return;
        }
        // If Signal is connected, rely on miningGuardResult for detailed status
        // (MiningGuard already checks Signal connection and sync status)
        if (miningGuardResult && !miningGuardResult.ok) {
            // Special messaging for same device/IP single-active restriction
            if (miningGuardResult.code === 'NOT_ACTIVE_MINER') {
                setGuardMessage(t('miningConsole.notActiveMinerWarning'));
                return;
            }
            if (miningGuardResult.code === 'FOLLOWER_MODE') {
                setGuardMessage(t('miningConsole.followerModeWarning'));
                return;
            }
            setGuardMessage(`⚠️ ${miningGuardResult.reason || t('miningConsole.miningGuardBlocked')}`);
            return;
        }
        setGuardMessage('');
    }, [isMining, healthSnapshot.isSignalConnected, props.p2pNode, miningGuardResult]);

    // Light node: request state root and balance proof and verify
    useEffect(() => {
        if (nodeMode !== 'light') return;
        if (!props.p2pNode || !props.nodeAddress) return;
        const p2p = props.p2pNode as any;
        let latestRoot: string | null = null;
        let latestHeight = 0;
        const onRoot = (msg: any) => {
            if (msg?.type === 'STATE_ROOT' && msg.ok) {
                latestRoot = String(msg.root || '');
                latestHeight = Number(msg.height || 0) || latestHeight;
            }
        };
        const onProof = async (msg: any) => {
            if (msg?.type !== 'BALANCE_PROOF' || !msg.ok) return;
            try {
                const { verifyBalanceProof } = await import('../../core/stateTree.js');
                const root = String(msg.root || latestRoot || '');
                const address = String(msg.address || props.nodeAddress);
                const valueStr = String(msg.value || '0');
                const ok = root && await verifyBalanceProof(root, address, valueStr, msg.proof);
                if (ok) {
                    const val = Number(valueStr);
                    if (Number.isFinite(val)) {
                        setLightVerifiedBalance(val);
                    }
                    const h = Number(msg.height || 0) || 0;
                    if (h > 0) setLastBalanceProofHeight(h);
                }
            } catch {}
        };
        try { p2p.onMessage?.('STATE_ROOT' as any, onRoot); } catch {}
        try { p2p.onMessage?.('BALANCE_PROOF' as any, onProof); } catch {}
        const timer = setInterval(() => {
            try {
                const tip = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || 0;
                const target = Math.max(1, Number(tip) || 1);
                p2p.sendToSignalServer?.('REQUEST_STATE_ROOT', { targetHeight: target });
                if (props.nodeAddress) {
                    p2p.sendToSignalServer?.('REQUEST_BALANCE_PROOF', { address: props.nodeAddress, targetHeight: target });
                }
            } catch {}
        }, 1500);
        return () => clearInterval(timer);
    }, [nodeMode, props.p2pNode, props.nodeAddress]);
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
                        (window as any).lastRootTipHeight = Math.max((window as any).lastRootTipHeight || 0, payload.latestHeight);
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
        // Handle BOOTSTRAP_BLOCKS (WS) → pass to sync pipeline (enables warp/snapshot)
        try {
            p2p.onMessage?.("BOOTSTRAP_BLOCKS", async (payload: any) => {
                try {
                    const list: any[] = Array.isArray(payload?.blocks) ? payload.blocks : [];
                    if (!ctx || list.length === 0) return;
                    if (typeof payload?.availableFromHeight === 'number') {
                        (window as any).lastAvailableFromHeight = payload.availableFromHeight;
                    }
                    if (typeof payload?.availableToHeight === 'number') {
                        (window as any).lastRootTipHeight = Math.max((window as any).lastRootTipHeight || 0, payload.availableToHeight);
                    }
                    // Process via sync manager to respect continuity and trigger warp/snapshot if needed
                    const sorted = list.slice().sort((a, b) => (a?.header?.height || 0) - (b?.header?.height || 0));
                    const { handleReceivedBlock } = await import("../../core/sync.js");
                    const local = ctx.storage.getTip()?.header.height || 0;
                    const firstHeight = sorted[0]?.header?.height || 0;
                    // If there is a large gap from local to first bootstrap height, proactively request snapshot meta
                    if (firstHeight > local + 1) {
                        try {
                            const target = Math.max(1, firstHeight - 1);
                            p2p.sendToSignalServer?.("REQUEST_BOOTSTRAP", { wantHeaders: true, headerCount: 500, wantSnapshotMeta: true });
                            // Ask connected peers for snapshot meta to enable warp sync
                            if (p2p.peers) {
                                for (const [peerId, peer] of p2p.peers) {
                                    if (peer?.connected && peer.dataChannel?.readyState === "open") {
                                        p2p.sendToPeer?.(peerId, "REQUEST_SNAPSHOT_META", {
                                            targetHeight: target,
                                            requestId: `warp_${Date.now()}_${target}`
                                        });
                                    }
                                }
                            }
                        } catch {}
                    }
                    for (const b of sorted) {
                        await handleReceivedBlock(b, ctx, p2p, "signal");
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
            alert(t('miningConsole.addressCopied'));
        }
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
        if (nodeMode === 'light') return; // Light node: skip block downloads
        const retry = setInterval(() => {
            try {
                const local = chainContext.storage.getTip()?.header.height || 0;
                const network = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || 0;
                const availableFrom = (typeof window !== 'undefined' && (window as any).lastAvailableFromHeight) || 0;
                const snapshotFrom = (typeof window !== 'undefined' && (window as any).lastRootTipSnapshotMeta?.height + 1) || 0;
                if (network === 0 || local < network) {
                    const step = 2000; // 更大的窗口，加速追赶
                    const nearWindow = 50000;
                    const fallbackFrom = Math.max(1, network > 0 ? (network - nearWindow + 1) : 1);
                    // 优先选择靠近 tip 的窗口；当 availableFrom 过小（如=1）时，自动回退到 near-tip
                    const baseFrom = Math.max(local + 1, fallbackFrom);
                    const withAvail = availableFrom > baseFrom ? availableFrom : baseFrom;
                    const effectiveFrom = snapshotFrom > withAvail ? snapshotFrom : withAvail;
                    const startFrom = Math.max(local + 1, effectiveFrom);
                    const target = Math.max(network > 0 ? network : (startFrom + step), startFrom + step);
                    // 1) 始终优先请求"顺序必需区间"：从 local+1 开始的一段，保证连续推进
                    const seqFrom = local + 1;
                    const seqTo = Math.min(seqFrom + step - 1, network || (seqFrom + step - 1));
                    if (seqFrom <= seqTo) {
                        p2pNode.broadcast?.("REQUEST_BLOCKS", { fromHeight: seqFrom, toHeight: seqTo });
                        p2pNode.sendToSignalServer?.("REQUEST_BOOTSTRAP_BLOCKS", { from: seqFrom, to: seqTo });
                    }
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
                    p2pNode.sendToSignalServer?.("REQUEST_BOOTSTRAP", { wantHeaders: true, headerCount: 1000, wantSnapshotMeta: true });
                    // 直接向信令端请求靠近 tip 的整段窗口，避免低高度被裁剪
                    p2pNode.sendToSignalServer?.("REQUEST_BOOTSTRAP_BLOCKS", { from: startFrom, to: network || (startFrom + 2 * step) });
                    p2pNode.sendToSignalServer?.("GLOBAL_VIEW_REQUEST", {});
                    // If gap is very large (>1000), also request snapshot meta from signal server
                    if (network - local > 1000) {
                        const target = Math.max(1, network - 1);
                        p2pNode.sendToSignalServer?.("REQUEST_SNAPSHOT_META", { targetHeight: target });
                    }
                }
            } catch {}
        }, 1000);
        return () => clearInterval(retry);
    }, [props.chainContext, props.p2pNode, nodeMode]); // Removed peerCount dependency - sync works via signal server even with 0 peers

    // Force warp/snapshot sync when far behind; persist flags across re-renders and auto-repair if stuck
    useEffect(() => {
        const ctx = props.chainContext as any;
        const p2p = props.p2pNode as any;
        if (!ctx || !p2p) return;
        // Light node: allow warp/snapshot when mining以便具备最新状态出块
        if (nodeMode === 'light' && status !== 'Mining') return;
        const triggeredRef = { current: false };
        const tick = async () => {
            try {
                const local = ctx.storage.getTip()?.header.height || 0;
                const network = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || 0;
                // If we're far behind, consider warp even if availableFrom is low (e.g., 1)
                const FAR_BEHIND = 500; // threshold to trigger snapshot warp
                if (!triggeredRef.current && network > 0 && (network - local >= FAR_BEHIND)) {
                    triggeredRef.current = true;
                    // Request snapshot meta from signaling server (primary) and peers (fallback)
                    try {
                        const target = Math.max(1, (network - 1));
                        // Primary: request from signal server (works even with 0 peers)
                        p2p.sendToSignalServer?.("REQUEST_SNAPSHOT_META", { targetHeight: target });
                        // Fallback: also ask peers if available
                        if (p2p.peers) {
                            for (const [peerId, peer] of p2p.peers) {
                                if (peer?.connected && peer.dataChannel?.readyState === "open") {
                                    p2p.sendToPeer?.(peerId, "REQUEST_SNAPSHOT_META", {
                                        targetHeight: target,
                                        requestId: `warp_${Date.now()}_${target}`
                                    });
                                }
                            }
                        }
                    } catch {}
                    // 如果全局有 snapshotDownloader，则直接进行一次下载尝试（不等统一管理器）
                    try {
                        const sd: any = (typeof window !== 'undefined' && (window as any).snapshotDownloader) || null;
                        if (sd) {
                            // 先请求 meta，再挑选最接近 network 的快照下载
                            const target = Math.max(1, (network - 1));
                            const metas = await sd.requestSnapshotMeta(target);
                            if (metas && metas.length > 0) {
                                const best = metas
                                  .filter((m: any) => m.height && m.height <= target)
                                  .sort((a: any, b: any) => b.height - a.height)[0] || metas[0];
                                // Ask signaling to stream snapshot chunks as well (WS), in parallel with P2P
                                try {
                                    p2p.sendToSignalServer?.("REQUEST_SNAPSHOT", {
                                        height: best.height,
                                        snapshotId: String(best.height),
                                    });
                                } catch {}
                                const snapshotData: any = await sd.downloadSnapshot(best, {}, (_p: any) => {});
                                // Persist snapshot to localStorage and update metadata, so chain can warp from this height
                                try {
                                    if (snapshotData && snapshotData.meta && typeof localStorage !== 'undefined') {
                                        const SNAPSHOT_DATA_PREFIX = "indexerchain_snapshot_v1_";
                                        const key = `${SNAPSHOT_DATA_PREFIX}${snapshotData.meta.height}`;
                                        localStorage.setItem(key, JSON.stringify(snapshotData));
                                        // Update metas list
                                        const { loadAllSnapshotMeta, saveAllSnapshotMeta } = await import("../../core/snapshot.js");
                                        const metas = loadAllSnapshotMeta().filter((m:any)=> m.height !== snapshotData.meta.height);
                                        metas.push(snapshotData.meta);
                                        saveAllSnapshotMeta(metas);
                                        // Expose to window hint
                                        (window as any).lastRootTipSnapshotMeta = snapshotData.meta;
                                        // CRITICAL: Apply snapshot state immediately so chain can continue from snapshot height
                                        try {
                                            const { IndexState } = await import("../../core/indexState.js");
                                            const { guardSnapshotApplication } = await import("../../core/stateGuards.js");
                                            const currentHeight = ctx.storage.getTip()?.header.height || 0;
                                            const snapshotHeight = snapshotData.meta.height || 0;
                                            
                                            // CRITICAL: Block snapshot application during solo mining to prevent balance rollback
                                            if (!guardSnapshotApplication(snapshotHeight, currentHeight)) {
                                                // Skip snapshot application during solo mining
                                            } else if (snapshotData.indexState) {
                                                const restoredState = IndexState.fromSnapshot(snapshotData.indexState);
                                                const restoredInternalState = (restoredState as any).getInternalState();
                                                const currentInternalState = (ctx.indexState as any).getInternalState();
                                                currentInternalState.clear();
                                                for (const [ns, kvMap] of restoredInternalState) {
                                                    const newMap = new Map(kvMap);
                                                    currentInternalState.set(ns, newMap);
                                                }
                                                // Restore privacy state
                                                const restoredCommitments = (restoredState as any).getCommitments?.() || (restoredState as any).commitments;
                                                const restoredNullifiers = (restoredState as any).getNullifierSet?.() || (restoredState as any).nullifierSet;
                                                if (restoredCommitments) {
                                                    (ctx.indexState as any).commitments = new Map(restoredCommitments);
                                                }
                                                if (restoredNullifiers) {
                                                    (ctx.indexState as any).nullifierSet = new Set(restoredNullifiers);
                                                }
                                                
                                                // CRITICAL: If local height is less than snapshot height, reset chain to snapshot height
                                                // This ensures we can continue from snapshot height
                                                if (snapshotHeight > 0 && currentHeight < snapshotHeight) {
                                                    try {
                                                        const { performHardReorg } = await import("../../core/hardReorg.js");
                                                        // Reset to snapshot height (will remove blocks above snapshot height)
                                                        // But we want to keep blocks up to snapshot height, so we need to check if snapshot block exists
                                                        const snapshotBlock = ctx.storage.getBlockByHeight(snapshotHeight);
                                                        if (!snapshotBlock || snapshotBlock.hash !== snapshotData.meta.blockHash) {
                                                            // Snapshot block doesn't exist or doesn't match, need to rewind to before snapshot
                                                            // Then we'll rebuild from snapshot + replay blocks
                                                            if (currentHeight > 0) {
                                                                await performHardReorg(ctx, Math.max(0, snapshotHeight - 1));
                                                            }
                                                        } else {
                                                            // Snapshot block exists and matches, just rewind to snapshot height
                                                            if (currentHeight > snapshotHeight) {
                                                                await performHardReorg(ctx, snapshotHeight);
                                                            }
                                                        }
                                                    } catch (reorgError) {
                                                        // If reorg fails, try to continue anyway
                                                    }
                                                }
                                            }
                                        } catch {}
                                    }
                                } catch {}
                                // After snapshot saved and applied, immediately request blocks from snapshotHeight+1
                                try {
                                    const fromH = (best.height || 0) + 1;
                                    if (fromH > 1) {
                                        // Request from signal server (primary) and peers (fallback)
                                        p2p.sendToSignalServer?.("REQUEST_BOOTSTRAP_BLOCKS", { from: fromH, to: Math.max(fromH + 10000, network || fromH + 10000) });
                                        p2p.broadcast?.("REQUEST_BLOCKS", { fromHeight: fromH, toHeight: (network || fromH + 5000) });
                                        // Hint availableFrom for the retry loop to continue from here
                                        if (typeof window !== 'undefined') {
                                            (window as any).lastAvailableFromHeight = Math.max((window as any).lastAvailableFromHeight || 0, fromH);
                                            (window as any).lastRootTipHeight = Math.max((window as any).lastRootTipHeight || 0, network || fromH);
                                        }
                                    }
                                } catch {}
                            }
                        }
                    } catch {}
                    // Force unified warp sync (will use window.snapshotDownloader if present)
                    try {
                        const { handleRootTipUpdate } = await import("../../core/unifiedSyncManager.js");
                        await handleRootTipUpdate(ctx, p2p, {
                            latestHeight: network,
                            latestHeaderHash: (typeof window !== 'undefined' && (window as any).lastRootTipHash) || "",
                            recentHeaders: [],
                            latestSnapshotMeta: (typeof window !== 'undefined' && (window as any).lastRootTipSnapshotMeta) || null,
                            stateCommitment: undefined
                        }, false, (_msg: string) => {});
                    } catch {}
                }
            } catch {}
        };
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [props.chainContext, props.p2pNode]);

    const formatAddress = (addr: string) => {
        if (!addr) return t('miningConsole.loading');
        return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
    };

    if (!props.chainContext) {
        return (
            <div className={styles.appContainer}>
                <div className={styles.sidebar}>
                    <div className={styles.logo}>{t('miningConsole.appName')}</div>
                </div>
                <div className={styles.mainContent}>
                    <div style={{ color: '#c9d1d9', padding: 20 }}>{t('miningConsole.initializingChain')}</div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.appContainer}>
            {/* Sidebar Navigation */}
            <div className={styles.sidebar}>
                <div className={styles.logo}>{t('miningConsole.appName')}</div>
                <a 
                    href="#mining" 
                    className={`${styles.navLink} ${activePage === 'mining' ? styles.active : ''}`}
                    onClick={(e) => {
                        e.preventDefault();
                        setActivePage('mining');
                    }}
                >
                    {t('miningConsole.miningMenu')}
                </a>
                <a 
                    href="#wallet" 
                    className={`${styles.navLink} ${activePage === 'wallet' ? styles.active : ''}`}
                    onClick={(e) => {
                        e.preventDefault();
                        setActivePage('wallet');
                    }}
                >
                    {t('miningConsole.walletMenu')}
                </a>
                <a href="#" className={styles.navLink} style={{ opacity: 0.6 }}>
                    {t('miningConsole.advancedMenu')}
                </a>
                
                {/* Language Switcher */}
                <div style={{ 
                    marginTop: 'auto', 
                    paddingTop: 'calc(var(--spacing-unit) * 2)',
                    borderTop: '1px solid var(--color-border)'
                }}>
                    <div 
                        className={styles.navLink}
                        onClick={() => {
                            setLocale(locale === 'zh' ? 'en' : 'zh');
                        }}
                        style={{ 
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px'
                        }}
                        title={t('miningConsole.switchLanguage')}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>🌐</span>
                            <span>{locale === 'zh' ? t('miningConsole.chinese') : t('miningConsole.english')}</span>
                        </span>
                        <span style={{ fontSize: '0.8em', opacity: 0.7 }}>
                            {locale === 'zh' ? t('miningConsole.switchToEnglish') : t('miningConsole.switchToChinese')}
                        </span>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className={styles.mainContent}>
                {/* Mining Page */}
                {activePage === 'mining' && (
                    <div className={styles.pageContent}>
                        <h1>{t('miningConsole.minerConsoleTitle')}</h1>

                        {/* Wallet Display Bar */}
                        <div className={styles.walletDisplayBar}>
                            <div className={styles.addressInfo} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span className={styles.balanceLabel} style={{ fontSize: '14px' }}>Miner Address:</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: '4px' }}>
                                    <span style={{ color: '#4ee672', fontWeight: 'bold', fontFamily: 'monospace' }}>
                                        {formatAddress(props.nodeAddress || '')}
                                    </span>
                                    <button 
                                        id="copy-address-btn"
                                        onClick={copyAddress}
                                        style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                                        title={t('miningConsole.copyAddress')}
                                    >
                                        📋
                                    </button>
                                </div>
                            </div>
                            
                            <div className={styles.balanceInfo}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                                        <span className={styles.balanceLabel}>{t('miningConsole.expectedBalance')}</span>
                                        <span className={`${styles.balanceAmount} ${styles.numeric}`} id="current-balance" style={{ color: '#4ee672', fontSize: '1.6em', lineHeight: 1 }}>
                                            {displayBalance}
                                        </span>
                                        <span style={{ color: '#8b949e', fontSize: '0.8em' }}>IDC</span>
                                    </div>
                                    {nodeMode === 'light' && (
                                        <div style={{ fontSize: '0.8em', color: '#8b949e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span>{t('miningConsole.zkVerified')}</span>
                                            <span style={{ color: lightVerifiedBalance !== null ? '#4ee672' : '#8b949e' }}>
                                                {lightVerifiedBalance !== null ? lightVerifiedBalance.toFixed(12) : t('common.loading')}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Address Bar */}
                        <div className={styles.addressBar}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ color: '#8b949e', fontSize: '0.9em' }}>{t('miningConsole.networkHeight')}</span>
                                    <span className={`${styles.dataValue} ${styles.numeric}`} id="network-height-bar" style={{ fontSize: '1.1em', minWidth: 'auto' }}>{networkHeight.toLocaleString()}</span>
                                </div>
                                <div style={{ width: '1px', height: '14px', background: 'var(--color-border)' }}></div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ color: '#8b949e', fontSize: '0.9em' }}>{t('miningConsole.peers')}</span>
                                    <span className={styles.dataValue} id="peer-count-bar" style={{ fontSize: '1.1em' }}>{peerCount}</span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {(() => {
                                    // Consider online if: has peers, or Signal Server connected, or network height > 0 (can sync)
                                    const isOnline = peerCount > 0 || healthSnapshot.isSignalConnected || networkHeight > 0;
                                    return (
                                        <>
                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isOnline ? 'var(--color-primary)' : 'var(--color-danger)' }}></div>
                                            <span style={{ color: isOnline ? '#4ee672' : '#da3633', fontSize: '0.85em', fontWeight: 500 }}>
                                                {isOnline ? 'Online' : 'Offline'}
                                            </span>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                        {/* ZK/Sync status bar removed - light node mode doesn't need these details */}

                        {/* Top Section */}
                        <div className={styles.topSection}>
                            {/* Reorg Banner */}
                            {reorgInfo && (
                                <div className={styles.card} style={{ background: 'rgba(43, 33, 17, 1)', borderColor: '#8b5e34', color: '#e3b341' }}>
                                    ⚠️ Reorg detected: rolled back {reorgInfo.count} block(s) from {reorgInfo.from} to {reorgInfo.to}. Auto resyncing...
                                </div>
                            )}

                            {/* Light Validator Info - Pool Mining Architecture */}
                            {nodeMode === 'light' && (
                                <div className={styles.card} style={{ background: 'var(--color-background)', borderColor: 'var(--color-border)' }}>
                                    <div style={{ fontWeight: 600, marginBottom: 6 }}>All-Light-Node Chain (Header + ZK)</div>
                                    <div style={{ color: '#8b949e', fontSize: 13 }}>
                                        轻节点不存储本地区块，仅通过区块头与余额证明展示余额。池化挖矿模式：所有节点共享区块奖励，按权重分配。当你开始证明时，会自动拉取并应用最新快照以具备世界状态。
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Dashboard Grid */}
                        <div className={styles.dashboardGrid}>
                            {/* Left Panel */}
                            <div className={styles.leftPanel} ref={leftPanelRef}>
                                {/* Control Card - memoized, no refresh */}
                                <MiningGuardCard
                                    displayMining={displayMining}
                                    guardMessage={miningGuardResult?.code === 'NOT_ACTIVE_MINER' ? t('miningConsole.singleDeviceMiningWarning') : guardMessage}
                                    autoMining={autoMining}
                                    showStatusBadge={nodeMode !== 'light'}
                                    lightMode={nodeMode === 'light'}
                                    onToggleMining={() => {
                                        if (autoMining) {
                                            // 自动挖矿模式：切换按钮状态
                                            setDisplayMining(prev => !prev);
                                            toggleMining();
                                        } else {
                                            // 非自动挖矿模式：只挖一次，不切换按钮状态
                                            toggleMining();
                                        }
                                    }}
                                    onToggleAutoMining={setAutoMining}
                                    t={t}
                                />

                                <WalletSummaryCard chainContext={props.chainContext} address={props.nodeAddress || null} locale={'en'} className={styles.card} styles={styles} />

                                {/* Pool Rewards (Proof) */}
                                <div className={styles.card}>
                                    <h3>Pool Rewards (Proof)</h3>
                                    <div style={{ marginBottom: 12, fontSize: 13, color: '#8b949e' }}>
                                        输入区块高度查询该块的 Merkle 奖励证明，验证您的收益确实已包含在链上。
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                        <input 
                                            type="number" 
                                            placeholder={t('miningConsole.blockHeight')}
                                            style={{ 
                                                background: 'var(--color-background)', 
                                                border: '1px solid #30363d', 
                                                color: '#c9d1d9', 
                                                padding: '6px 12px',
                                                borderRadius: 6,
                                                flex: 1
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    const h = parseInt((e.target as HTMLInputElement).value);
                                                    if (h > 0) {
                                                        setPayoutProof(null);
                                                        // Trigger proof request
                                                        props.p2pNode?.sendToSignalServer('REQUEST_PAYOUT_PROOF', { height: h, address: props.nodeAddress || undefined });
                                                    }
                                                }
                                            }}
                                        />
                                        <button 
                                            className={styles.btn}
                                            style={{ padding: '6px 12px' }}
                                            onClick={() => {
                                                const input = document.querySelector(`input[placeholder="${t('miningConsole.blockHeight')}"]`) as HTMLInputElement;
                                                const h = parseInt(input?.value);
                                                if (h > 0) {
                                                    setPayoutProof(null);
                                                    props.p2pNode?.sendToSignalServer('REQUEST_PAYOUT_PROOF', { height: h, address: props.nodeAddress || undefined });
                                                }
                                            }}
                                        >
                                            {t('miningConsole.verify')}
                                        </button>
                                    </div>
                                    {payoutProof && (
                                        <div style={{ fontSize: 12, background: payoutProof.ok ? 'rgba(46, 160, 67, 0.1)' : 'rgba(218, 54, 51, 0.1)', padding: 8, borderRadius: 4 }}>
                                            {payoutProof.ok ? (
                                                <>
                                                    <div style={{ color: '#2ea043', fontWeight: 'bold', marginBottom: 4 }}>{t('miningConsole.verified')}</div>
                                                    <div>{t('miningConsole.merkleRoot')}: {shortHash(payoutProof.root)}</div>
                                                    <div>{t('miningConsole.leaf')}: {shortHash(payoutProof.entry)}</div>
                                                </>
                                            ) : (
                                                <div style={{ color: '#da3633' }}>
                                                    {t('miningConsole.verificationFailed')}: {payoutProof.error || t('miningConsole.unknownError')}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right Panel */}
                            <div className={styles.rightPanel} ref={rightPanelRef}>
                                {/* Live Block Feed Component */}
                                <div ref={liveBlockFeedRef}>
                                    <LiveBlockFeed 
                                      chainContext={props.chainContext} 
                                      locale={'en'} 
                                      maxItems={15} 
                                      myAddress={props.nodeAddress || undefined}
                                    />
                                </div>
                                
                                {/* Proving Panel (Pool Mining) */}
                                <div className={styles.card} ref={provingPanelRef} style={{ display: 'flex', flexDirection: 'column' }}>
                                    <h3>{t('miningConsole.provingPanelTitle')}</h3>
                                    <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #30363d', fontSize: 12, color: '#8b949e', lineHeight: 1.5 }}>
                                        {t('miningConsole.poolMiningModeDesc')}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                                            <div>
                                                <div className={styles.dataLabel} style={{ marginBottom: 4 }}>{t('miningConsole.leaderOfThisSlot')}</div>
                                                <div className={`${styles.dataValue} ${styles.numeric}`} style={{ wordBreak: 'break-all' }}>
                                                  {leaderThisSlot === props.nodeAddress ? 
                                                    <span style={{color: '#2ea043', fontWeight: 'bold', fontSize: '1.1em'}}>✨ YOU ✨</span> : 
                                                    humanLeader(leaderThisSlot || undefined)}
                                                </div>
                                            </div>
                                            <div>
                                                <div className={styles.dataLabel} style={{ marginBottom: 4 }}>{t('miningConsole.myWeight')}</div>
                                                <div className={`${styles.dataValue} ${styles.numeric}`}>{(effectiveWeight ?? 0).toFixed(6)}</div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                                            <div>
                                                <div className={styles.dataLabel} style={{ marginBottom: 4 }}>{t('miningConsole.estRewardPerBlock')}</div>
                                                <div className={`${styles.dataValue} ${styles.numeric}`}>{(projectedReward ? (projectedReward / ((24 * 60 * 60) / (props.chainContext?.params?.targetBlockTime || 10))) : 0).toFixed(6)} IDC</div>
                                            </div>
                                            <div>
                                                <div className={styles.dataLabel} style={{ marginBottom: 4 }}>{t('miningConsole.estRewardPerDay')}</div>
                                                <div className={`${styles.dataValue} ${styles.numeric}`}>{(projectedReward ?? 0).toFixed(6)} IDC</div>
                                            </div>
                                        </div>
                                        {/* Spacer to push content up and ensure bottom alignment */}
                                        <div style={{ flex: 1, minHeight: '60px' }}></div>
                                    </div>
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
                                <span id="wallet-summary-balance">{balance.toFixed(12)}</span> <span style={{ fontSize: '0.6em', color: '#c9d1d9' }}>IDC</span>
                            </div>
                                    {nodeMode === 'light' && (
                                        <div style={{ marginTop: 8 }}>
                                            <span className={styles.dataLabel}>{t('miningConsole.zkVerified')}</span>{' '}
                                            <span className={styles.dataValue}>
                                                {lightVerifiedBalance !== null ? t('miningConsole.zkVerifiedYes') : t('miningConsole.zkVerifiedNo')}
                                            </span>
                                            {lightVerifiedBalance !== null && (
                                                <span style={{ marginLeft: 10, color: '#8b949e' }}>
                                                    {t('miningConsole.atHeight')} {lastBalanceProofHeight}
                                                </span>
                                            )}
                                            <div style={{ marginTop: 6, color: '#8b949e', fontSize: 13 }}>
                                                {t('miningConsole.zkVerifiedDesc')}
                                            </div>
                                        </div>
                                    )}
                            
                            <div style={{ marginTop: '1rem' }}>
                                <p className={styles.dataLabel} style={{ marginBottom: '0.5rem' }}>{t('miningConsole.mainWalletAddress')}</p>
                                <div className={styles.walletAddressBox} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span id="wallet-full-address" style={{ fontFamily: 'Consolas, Courier New, monospace', flex: 1, wordBreak: 'break-all' }} title={props.nodeAddress || ''}>
                                        {props.nodeAddress || t('miningConsole.notInitialized')}
                                    </span>
                                    <button 
                                        onClick={copyWalletAddress}
                                        style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', marginLeft: 10, padding: '4px 8px' }}
                                        title={t('miningConsole.copyAddress')}
                                    >
                                        📋
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Wallet Management Section */}
                        <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {/* Wallet Manager - Create/Manage Wallets */}
                            <div className={styles.card}>
                                <h3>{t('miningConsole.walletManagement')}</h3>
                                <WalletManagerPanel
                                    onWalletChanged={async () => {
                                        // Refresh wallet data without reloading page
                                        try {
                                            const { getOrCreateNodeAddress } = await import('../../core/keys.js');
                                            const newAddress = await getOrCreateNodeAddress();
                                            // Update global nodeAddress if available
                                            if (typeof window !== 'undefined') {
                                                (window as any).nodeAddress = newAddress;
                                            }
                                            // Trigger refresh by updating key
                                            setWalletRefreshKey(prev => prev + 1);
                                        } catch (err) {
                                            console.error('Failed to refresh wallet:', err);
                                        }
                                    }}
                                    onError={(error) => {
                                        alert(error);
                                    }}
                                />
                            </div>

                            {/* Wallet Backup - Import/Export */}
                            <div className={styles.card}>
                                <h3>{t('miningConsole.walletBackupRestore')}</h3>
                                <WalletBackupPanel
                                    onExportSuccess={() => {
                                        // Show success message
                                    }}
                                    onImportSuccess={async () => {
                                        // Refresh wallet data without reloading page
                                        try {
                                            const { getOrCreateNodeAddress } = await import('../../core/keys.js');
                                            const newAddress = await getOrCreateNodeAddress();
                                            if (typeof window !== 'undefined') {
                                                (window as any).nodeAddress = newAddress;
                                            }
                                            setWalletRefreshKey(prev => prev + 1);
                                        } catch (err) {
                                            console.error('Failed to refresh wallet:', err);
                                        }
                                    }}
                                    onError={(error) => {
                                        // Only show alert if there's an actual error message
                                        if (error && error.trim()) {
                                            alert(error);
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
