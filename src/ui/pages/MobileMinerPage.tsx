import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/useI18n.js';
import { useMiningData } from '../../features/miner-dashboard/hooks/useMiningData.js';
import styles from './MobileMinerPage.module.css';

interface MobileMinerPageProps {
  chainContext: any;
  minerClient: any;
  nodeAddress: string | null;
  isMining: boolean;
  onToggleMining: () => void;
  p2pNode: any;
  finalityManager?: any;
  localRole?: string;
  bootstrapComplete?: boolean;
}

export const MobileMinerPage: React.FC<MobileMinerPageProps> = (props) => {
  const { t, locale } = useI18n();
  const [autoMining, setAutoMining] = useState<boolean>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('indexer_auto_mining') : null;
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch {}
    return true;
  });
  
  const [balanceVerified, setBalanceVerified] = useState<number | null>(null);
  const [lastProofHeight, setLastProofHeight] = useState<number>(0);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [signalConnected, setSignalConnected] = useState<boolean>(false);
  const [displayMining, setDisplayMining] = useState<boolean>(false);
  const [bubble, setBubble] = useState<{ text: string; visible: boolean }>({ text: '', visible: false });
  const [guardReason, setGuardReason] = useState<string>('');
  const [miningGuardOk, setMiningGuardOk] = useState<boolean>(true);
  const [statusText, setStatusText] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [localHeight, setLocalHeight] = useState<number>(0);
  const [networkHeight, setNetworkHeight] = useState<number>(0);
  
  const address = props.nodeAddress || '';
  const shortAddr = useMemo(() => {
    if (!address) return '';
    if (address.length <= 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  }, [address]);

  // Force light node mode on mobile
  useEffect(() => {
    try {
      localStorage.setItem('indexer_node_mode', 'light');
    } catch {}
  }, []);

  // Persist auto-mining
  useEffect(() => {
    try {
      localStorage.setItem('indexer_auto_mining', autoMining ? '1' : '0');
    } catch {}
  }, [autoMining]);

  // Use mining data hook
  const {
    balance,
    localHeight: hookLocalHeight,
    networkHeight: hookNetworkHeight,
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

  // Sync local height state
  useEffect(() => {
    setLocalHeight(hookLocalHeight);
    setNetworkHeight(hookNetworkHeight);
  }, [hookLocalHeight, hookNetworkHeight]);

  // Auto-start/stop based on autoMining
  useEffect(() => {
    if (!props.chainContext) return;
    if (autoMining && !props.isMining && miningGuardResult?.ok) {
      props.onToggleMining();
    } else if (!autoMining && props.isMining) {
      props.onToggleMining();
    }
  }, [autoMining, props.isMining, props.chainContext, miningGuardResult?.ok]);

  // Keep button visual consistent
  useEffect(() => {
    setDisplayMining(props.isMining || autoMining);
  }, [props.isMining, autoMining]);

  // Update mining guard status
  useEffect(() => {
    if (miningGuardResult) {
      setMiningGuardOk(!!miningGuardResult.ok);
      if (!miningGuardResult.ok) {
        if (miningGuardResult.code === 'NOT_ACTIVE_MINER') {
          setGuardReason(t('miningConsole.notActiveMinerWarning'));
        } else if (miningGuardResult.code === 'FOLLOWER_MODE') {
          setGuardReason(t('miningConsole.followerModeWarning'));
        } else {
          setGuardReason(miningGuardResult.reason || t('miningConsole.miningGuardBlocked'));
        }
      } else {
        setGuardReason('');
      }
    }
  }, [miningGuardResult, t]);

  // Light node: poll stateRoot + balance proof and verify locally
  useEffect(() => {
    const p2p = props.p2pNode;
    if (!p2p || !props.nodeAddress) return;
    let latestRoot: string | null = null;

    const onRoot = (msg: any) => {
      if (msg?.type === 'STATE_ROOT' && msg.ok) {
        latestRoot = String(msg.root || '');
      }
    };
    
    const onProof = async (msg: any) => {
      if (msg?.type !== 'BALANCE_PROOF' || !msg.ok) return;
      try {
        const { verifyBalanceProof } = await import('../../core/stateTree.js');
        const root = String(msg.root || latestRoot || '');
        const address = String(msg.address || props.nodeAddress);
        const valueStr = String(msg.value || '0');
        const h = Number(msg.height || 0) || 0;
        setVerifying(true);
        const ok = root && await verifyBalanceProof(root, address, valueStr, msg.proof);
        if (ok) {
          const val = Number(valueStr);
          if (Number.isFinite(val)) setBalanceVerified(val);
          if (h > 0) setLastProofHeight(h);
        }
        setVerifying(false);
      } catch {}
    };
    
    try { p2p.onMessage?.('STATE_ROOT' as any, onRoot); } catch {}
    try { p2p.onMessage?.('BALANCE_PROOF' as any, onProof); } catch {}

    const timer = setInterval(() => {
      try {
        const tip = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || 0;
        const target = Math.max(1, Number(tip) || 1);
        setSignalConnected(!!p2p?.ws && p2p.ws.readyState === 1);
        p2p.sendToSignalServer?.('REQUEST_STATE_ROOT', { targetHeight: target });
        p2p.sendToSignalServer?.('REQUEST_BALANCE_PROOF', { address: props.nodeAddress, targetHeight: target });
      } catch {}
    }, 1500);
    
    return () => {
      clearInterval(timer);
      try { p2p.offMessage?.('STATE_ROOT' as any, onRoot); } catch {}
      try { p2p.offMessage?.('BALANCE_PROOF' as any, onProof); } catch {}
    };
  }, [props.p2pNode, props.nodeAddress]);

  // Display balance - prioritize verified balance, fallback to chain balance
  const displayBalance = useMemo(() => {
    if (balanceVerified !== null) return balanceVerified;
    if (props.chainContext && address) {
      try {
        const chainBal = props.chainContext.indexState.getBalance(address);
        if (typeof chainBal === 'number' && Number.isFinite(chainBal)) {
          return chainBal;
        }
      } catch {}
    }
    return balance || 0;
  }, [balanceVerified, balance, props.chainContext, address]);

  const copyAddr = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // Estimate reward for bubble info
  const estimatePerBlockReward = async (): Promise<number> => {
    try {
      const ctx = props.chainContext;
      if (!ctx) return 0;
      const currentHeight = ctx.storage.getTip()?.header.height || 0;
      const mod = await import('../../core/idcEmission.js');
      const raw = mod.getBlockRewardRaw(currentHeight + 1);
      const toIDC = mod.uIDCToIDC(raw);
      return toIDC;
    } catch {
      return 0;
    }
  };

  const showBubble = (text: string) => {
    setBubble({ text, visible: true });
    setTimeout(() => setBubble({ text: '', visible: false }), 2000);
  };

  // Force a proof refresh immediately
  const requestProofNow = () => {
    try {
      const p2p = props.p2pNode as any;
      const tip = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || 0;
      const target = Math.max(1, Number(tip) || 1);
      if (p2p) {
        p2p.sendToSignalServer?.('REQUEST_STATE_ROOT', { targetHeight: target });
        if (props.nodeAddress) {
          p2p.sendToSignalServer?.('REQUEST_BALANCE_PROOF', { address: props.nodeAddress, targetHeight: target });
        }
      }
    } catch {}
  };

  const handleStartStop = async () => {
    if (!miningGuardOk && !autoMining) {
      setStatusText(`⚠️ ${guardReason || t('miningConsole.miningGuardBlocked')}`);
      showBubble(`⚠️ ${guardReason || t('miningConsole.miningGuardBlocked')}`);
      return;
    }
    
    // Auto-mining mode: normal toggle
    if (autoMining) {
      props.onToggleMining();
      return;
    }
    
    // Single-shot mine with feedback when not auto-mining
    if (!props.isMining) {
      // Show estimated reward bubble immediately
      const est = await estimatePerBlockReward();
      if (est > 0) showBubble(`+${est.toFixed(6)} IDC`);
      setStatusText(t('miningConsole.startMining'));
    } else {
      setStatusText(t('miningConsole.stopMining'));
    }
    
    props.onToggleMining();
    
    // Refresh proof after mining
    setTimeout(requestProofNow, 1000);
  };

  // Update status text based on mining state
  useEffect(() => {
    if (props.isMining) {
      setStatusText(t('miningConsole.activeMining'));
    } else if (miningGuardOk) {
      setStatusText(t('miningConsole.syncedWaiting'));
    } else {
      setStatusText(`⚠️ ${guardReason || t('miningConsole.miningGuardBlocked')}`);
    }
  }, [props.isMining, miningGuardOk, guardReason, t]);

  if (!props.chainContext) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          {t('miningConsole.initializingChain')}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.title}>{t('miningConsole.appName')}</div>
        <div className={styles.addressSection}>
          <div className={styles.addressText} title={address}>
            {shortAddr || t('miningConsole.notInitialized')}
          </div>
          <button 
            onClick={copyAddr} 
            className={styles.copyButton}
            title={copied ? t('miningConsole.addressCopied') : t('miningConsole.copyAddress')}
          >
            {copied ? '✓' : '📋'}
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className={styles.statusRow}>
        <div className={styles.statusCard}>
          <div className={styles.statusLabel}>{t('miningConsole.online')}</div>
          <div className={styles.statusValue}>
            <span className={signalConnected ? styles.statusOnline : styles.statusOffline}>
              {signalConnected ? '●' : '○'}
            </span>
            {signalConnected ? t('miningConsole.online') : t('miningConsole.offline')}
          </div>
        </div>
        <div className={styles.statusCard}>
          <div className={styles.statusLabel}>{t('miningConsole.zkVerified')}</div>
          <div className={styles.statusValue}>
            {verifying ? t('common.loading') : (lastProofHeight > 0 ? `${lastProofHeight.toLocaleString()}` : '—')}
          </div>
        </div>
      </div>

      {/* Balance Card */}
      <div className={styles.balanceCard}>
        <div className={styles.balanceLabel}>{t('miningConsole.currentBalance')}</div>
        <div className={styles.balanceAmount}>
          {displayBalance.toFixed(12)}
          <span className={styles.balanceUnit}> IDC</span>
        </div>
        {balanceVerified !== null && (
          <div className={styles.balanceNote}>
            {t('miningConsole.zkVerified')} {t('miningConsole.zkVerifiedYes')} {t('miningConsole.atHeight')} {lastProofHeight}
          </div>
        )}
      </div>

      {/* Mining Info */}
      <div className={styles.infoCard}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>{t('miningConsole.localHeight')}:</span>
          <span className={styles.infoValue}>{localHeight.toLocaleString()}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>{t('miningConsole.networkHeight')}:</span>
          <span className={styles.infoValue}>{networkHeight.toLocaleString()}</span>
        </div>
        {networkHeight > localHeight && (
          <div className={styles.syncWarning}>
            ⚠️ {t('miningMain.catchingUp')}: {networkHeight - localHeight} {locale === 'zh' ? '个区块' : 'blocks'}
          </div>
        )}
      </div>

      {/* Auto-Mining Toggle */}
      <div className={styles.autoMiningCard}>
        <label className={styles.autoMiningLabel}>
          <input 
            type="checkbox" 
            checked={autoMining} 
            onChange={(e) => setAutoMining(e.target.checked)}
            className={styles.checkbox}
          />
          <span>{t('miningConsole.autoMining')}</span>
        </label>
        <div className={styles.autoMiningDesc}>
          {t('mining.autoMiningDesc')}
        </div>
      </div>

      {/* Status Message */}
      <div className={`${styles.statusMessage} ${!miningGuardOk ? styles.statusError : ''}`}>
        {statusText || (miningGuardOk ? t('miningConsole.syncedWaiting') : `⚠️ ${guardReason}`)}
      </div>

      {/* Mining Button */}
      <div className={styles.buttonContainer}>
        <button
          onClick={handleStartStop}
          className={`${styles.miningButton} ${displayMining ? styles.miningButtonStop : styles.miningButtonStart}`}
          disabled={!miningGuardOk && !autoMining}
        >
          {displayMining ? t('miningConsole.stopMining') : t('miningConsole.startMining')}
        </button>
        {bubble.visible && (
          <div className={styles.bubble}>
            {bubble.text}
          </div>
        )}
      </div>
    </div>
  );
};
