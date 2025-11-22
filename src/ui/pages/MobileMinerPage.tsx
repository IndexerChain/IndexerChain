import React, { useEffect, useMemo, useState } from 'react';

interface MobileMinerPageProps {
  chainContext: any;
  minerClient: any;
  nodeAddress: string | null;
  isMining: boolean;
  onToggleMining: () => void;
  p2pNode: any;
  finalityManager?: any;
  localRole?: string;
}

export const MobileMinerPage: React.FC<MobileMinerPageProps> = (props) => {
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
  const address = props.nodeAddress || '';
  const shortAddr = useMemo(() => address ? `${address.slice(0, 10)}...${address.slice(-6)}` : '' , [address]);

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

  // Auto-start/stop based on autoMining
  useEffect(() => {
    if (!props.chainContext) return;
    if (autoMining && !props.isMining) {
      props.onToggleMining();
    } else if (!autoMining && props.isMining) {
      props.onToggleMining();
    }
  }, [autoMining, props.isMining, props.chainContext]);

  // Keep button visual consistent
  useEffect(() => {
    setDisplayMining(props.isMining || autoMining);
  }, [props.isMining, autoMining]);

  // Mining guard polling (reasons when cannot mine)
  useEffect(() => {
    let timer: any;
    const tick = async () => {
      try {
        const { MiningGuard } = await import('../../core/miningGuard.js');
        const res = await MiningGuard.canMineNow(
          props.chainContext,
          props.p2pNode,
          props.finalityManager,
          ((props.localRole as ('LEADER' | 'FOLLOWER' | undefined)) ?? 'LEADER'),
          props.nodeAddress || undefined,
          true
        );
        setMiningGuardOk(!!res?.ok);
        setGuardReason(res?.ok ? '' : (res?.reason || 'Mining guard blocked.'));
      } catch {}
    };
    tick();
    timer = setInterval(tick, 2000);
    return () => clearInterval(timer);
  }, [props.chainContext, props.p2pNode, props.finalityManager, props.localRole, props.nodeAddress]);

  // Light node: poll stateRoot + balance proof and verify locally
  useEffect(() => {
    const p2p = props.p2pNode;
    if (!p2p || !props.nodeAddress) return;
    let latestRoot: string | null = null;
    let cleanup: any[] = [];

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
    try { p2p.onMessage?.('STATE_ROOT' as any, onRoot); cleanup.push(['STATE_ROOT', onRoot]); } catch {}
    try { p2p.onMessage?.('BALANCE_PROOF' as any, onProof); cleanup.push(['BALANCE_PROOF', onProof]); } catch {}

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
    };
  }, [props.p2pNode, props.nodeAddress]);

  // When mining in light mode, pull latest snapshot to have IndexState for block production
  useEffect(() => {
    const ctx = props.chainContext as any;
    const p2p = props.p2pNode as any;
    if (!ctx || !p2p) return;
    if (!props.isMining) return;
    let triggered = false;
    const id = setInterval(async () => {
      try {
        const local = ctx.storage.getTip()?.header.height || 0;
        const network = (typeof window !== 'undefined' && (window as any).lastRootTipHeight) || 0;
        if (!triggered && network > 0 && network - local >= 500) {
          triggered = true;
          const target = Math.max(1, network - 1);
          p2p.sendToSignalServer?.('REQUEST_SNAPSHOT_META', { targetHeight: target });
          const sd: any = (typeof window !== 'undefined' && (window as any).snapshotDownloader) || null;
          if (sd) {
            const metas = await sd.requestSnapshotMeta(target);
            if (Array.isArray(metas) && metas.length > 0) {
              const best = metas.filter((m:any)=>m.height && m.height<=target).sort((a:any,b:any)=>b.height-a.height)[0] || metas[0];
              p2p.sendToSignalServer?.('REQUEST_SNAPSHOT', { height: best.height, snapshotId: String(best.height) });
              const snapshotData: any = await sd.downloadSnapshot(best, {}, ()=>{});
              try {
                if (snapshotData && snapshotData.meta && typeof localStorage !== 'undefined') {
                  const SNAPSHOT_DATA_PREFIX = 'indexerchain_snapshot_v1_';
                  localStorage.setItem(`${SNAPSHOT_DATA_PREFIX}${snapshotData.meta.height}`, JSON.stringify(snapshotData));
                  const { loadAllSnapshotMeta, saveAllSnapshotMeta } = await import('../../core/snapshot.js');
                  const metas2 = loadAllSnapshotMeta().filter((m:any)=> m.height !== snapshotData.meta.height);
                  metas2.push(snapshotData.meta);
                  saveAllSnapshotMeta(metas2);
                  (window as any).lastRootTipSnapshotMeta = snapshotData.meta;
                  // Apply IndexState immediately
                  try {
                    const { IndexState } = await import('../../core/indexState.js');
                    const restored = IndexState.fromSnapshot(snapshotData.indexState);
                    const restoredInternal = (restored as any).getInternalState();
                    const currentInternal = (ctx.indexState as any).getInternalState();
                    currentInternal.clear();
                    for (const [ns, kv] of restoredInternal) {
                      const newMap = new Map(kv);
                      currentInternal.set(ns, newMap);
                    }
                  } catch {}
                }
              } catch {}
            }
          }
        }
      } catch {}
    }, 1000);
    return () => clearInterval(id);
  }, [props.chainContext, props.p2pNode, props.isMining]);

  const displayBalance = (balanceVerified ?? (props.chainContext?.indexState?.getBalance?.(address) || 0));

  const copyAddr = async () => {
    try {
      await navigator.clipboard.writeText(address);
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
    setTimeout(() => setBubble({ text: '', visible: false }), 1200);
  };

  // Force a proof refresh immediately (not waiting for poll)
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
    // Auto-mining mode: normal toggle
    if (autoMining) {
      props.onToggleMining();
      return;
    }
    // Single-shot mine with feedback when not auto-mining
    if (!miningGuardOk) {
      setStatusText(`⚠️ ${guardReason || 'Cannot mine now'}`);
      showBubble(`⚠️ ${guardReason || 'Cannot mine now'}`);
      return;
    }
    // Show estimated reward bubble immediately
    const est = await estimatePerBlockReward();
    if (est > 0) showBubble(`+${est.toFixed(2)} IDC`);
    // Start mining briefly and stop (do not flip visual button)
    try {
      props.onToggleMining(); // start
      setStatusText('⛏️ Mining...');
      // refresh proof shortly after start
      setTimeout(requestProofNow, 600);
      setTimeout(() => {
        try { props.onToggleMining(); } catch {}
        // refresh proof after stop to reflect balance change
        requestProofNow();
        if (!guardReason) setStatusText('✅ Ready');
      }, 1600);
    } catch {}
  };

  return (
    <div style={{ background: 'var(--color-background)', color: 'var(--color-text)', width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', padding: '16px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700 }}>IndexerChain Mobile Miner</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: '12px', color: '#8b949e' }}>{shortAddr}</div>
          <button onClick={copyAddr} style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-secondary)', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}>复制</button>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 10 }}>
          <div style={{ fontSize: 11, color: '#8b949e' }}>Signal</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>
            {signalConnected ? 'Connected' : 'Connecting...'}
          </div>
        </div>
        <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 10 }}>
          <div style={{ fontSize: 11, color: '#8b949e' }}>Proof</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>
            {verifying ? 'Verifying...' : (lastProofHeight > 0 ? `Verified @ ${lastProofHeight.toLocaleString()}` : '—')}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 12, color: '#8b949e' }}>Current Balance (IDC)</div>
        <div style={{ fontSize: 28, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{displayBalance.toFixed(2)}</div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: 12 }}>
        <label style={{ fontSize: 14 }}>Auto-Mining</label>
        <input type="checkbox" checked={autoMining} onChange={(e) => setAutoMining(e.target.checked)} />
      </div>

      {/* Inline status (reason or ready/mining) */}
      <div style={{ marginTop: 10, fontSize: 13, color: miningGuardOk ? '#8b949e' : '#ffa198' }}>
        {miningGuardOk ? (statusText || '✅ Ready') : `⚠️ ${guardReason}`}
      </div>

      <div style={{ marginTop: 16, flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <button
          onClick={handleStartStop}
          style={{
            width: '100%',
            maxWidth: 480,
            padding: '18px 16px',
            background: displayMining ? 'var(--color-danger)' : '#238636',
            color: '#fff',
            border: 'none',
            borderRadius: 14,
            fontSize: 18,
            fontWeight: 700
          }}
        >
          {displayMining ? '停止挖矿 (Stop)' : '启动挖矿 (Start)'}
        </button>
        {bubble.visible && (
          <div style={{ position: 'absolute', bottom: '70%', fontSize: 20, color: '#4ee672', fontWeight: 700, animation: 'rise 1.2s ease-out' }}>
            {bubble.text}
          </div>
        )}
      </div>
      <style>{`@keyframes rise{0%{transform:translateY(0);opacity:0}30%{opacity:1}100%{transform:translateY(-30px);opacity:0}}`}</style>
    </div>
  );
};


