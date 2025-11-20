import { useEffect, useState } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { getEpochMs, getSlotTimeMs } from "../../core/featureFlags.js";
import { getSlotIdentity, deriveRandSeed, selectLeader } from "../../core/slotSchedule.js";
import type { Address } from "../../core/types.js";
import { useI18n } from "../../i18n/useI18n.js";
// Keep overview concise; detailed reward/weight appears on Mining page

interface OverviewDashboardProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  nodeAddress: string | null;
  locale: string;
}

export function OverviewDashboard({ chainContext, p2pNode, nodeAddress, locale }: OverviewDashboardProps) {
  const isZh = locale === "zh";
  const { t } = useI18n();
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [leader, setLeader] = useState<Address | null>(null);
  // Quorum score removed from UI to keep concise
  const [leaderPreview, setLeaderPreview] = useState<Array<{ epoch: number; slot: number; leader: string | null; me: boolean }>>([]);
  const [previewCount, setPreviewCount] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("indexerchain_preview_slots_overview");
      return raw ? Math.max(1, Number(raw)) : 10;
    } catch {
      return 10;
    }
  });
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [syncMsg, setSyncMsg] = useState<string>("");

  // Tick for slot display
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const localHeight = chainContext?.storage.getTip()?.header.height ?? 0;
  const networkHeight = (typeof window !== "undefined" && (window as any).lastRootTipHeight) || 0;
  const behindBy = Math.max(0, networkHeight - localHeight);
  const syncLabel = (() => {
    if (networkHeight <= 0) return t("miningMain.waiting");
    if (behindBy <= 1) return t("miningMain.synced");
    if (behindBy <= 50) return t("miningMain.catchingUp");
    return t("miningMain.outOfSync");
  })();
  const syncColor = behindBy <= 1 ? "#28a745" : behindBy <= 50 ? "#ffc107" : "#dc3545";

  // One-click catch-up
  const handleCatchUp = async () => {
    try {
      if (!chainContext || !p2pNode) {
        setSyncMsg(isZh ? "节点未就绪" : "Node not ready");
        return;
      }
      const local = chainContext.storage.getTip()?.header.height ?? 0;
      const network = (typeof window !== "undefined" && (window as any).lastRootTipHeight) || 0;
      if (network <= 0) {
        setSyncMsg(isZh ? "暂无网络高度" : "No network height");
        return;
      }
      const diff = network - local;
      if (diff <= 0) {
        setSyncMsg(isZh ? "已在最新高度" : "Already at latest height");
        return;
      }
      setSyncMsg((isZh ? "同步中..." : "Syncing...") + ` (${local} → ${network})`);
      // Try UnifiedSyncManager first
      try {
        const { handleRootTipUpdate } = await import("../../core/unifiedSyncManager.js");
        const rt: any = {
          latestHeight: network,
          latestHeaderHash: (typeof window !== "undefined" && (window as any).lastRootTipHash) || "",
          recentHeaders: (typeof window !== "undefined" && (window as any).lastRootTipRecentHeaders) || undefined,
          latestSnapshotMeta: (typeof window !== "undefined" && (window as any).lastRootTipSnapshotMeta) || undefined,
          stateCommitment: (typeof window !== "undefined" && (window as any).lastRootTipStateCommitment) || undefined,
        };
        const result = await handleRootTipUpdate(
          chainContext,
          p2pNode as any,
          rt,
          true,
          (msg: string) => setSyncMsg((isZh ? "同步中：" : "Syncing: ") + msg)
        );
        if (result.success) {
          setSyncMsg(isZh ? "✅ 同步完成" : "✅ Synced");
          return;
        }
      } catch {
        // fall through to broadcast
      }
      // Fallback: request up to 500 blocks
      const requestRange = Math.min(diff, 500);
      (p2pNode as any).broadcast("REQUEST_BLOCKS", {
        fromHeight: local + 1,
        toHeight: local + requestRange,
      });
      setSyncMsg(
        (isZh ? "已请求区块：" : "Requested blocks: ") +
          `${local + 1}-${local + requestRange}`
      );
    } catch (e) {
      setSyncMsg((isZh ? "失败：" : "Failed: ") + (e instanceof Error ? e.message : String(e)));
    }
  };

  const epochMs = getEpochMs();
  const slotMs = getSlotTimeMs();
  const { epochId, slotIndex } = getSlotIdentity(nowMs);
  const epochStart = Math.floor(nowMs / epochMs) * epochMs;
  const slotStart = epochStart + slotIndex * slotMs;
  const slotElapsed = Math.max(0, nowMs - slotStart);
  const slotPct = Math.max(0, Math.min(100, Math.floor((slotElapsed / Math.max(1, slotMs)) * 100)));

  // Compute expected leader from previous block coinbase recipients
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prevBlock = chainContext?.storage.getTip() || null;
        if (!prevBlock) {
          setLeader(null);
          return;
        }
        const recipients: string[] = [];
        const coinbase = prevBlock.txs?.[0];
        if (coinbase && coinbase.ownerAddress === "idc_system") {
          for (const op of coinbase.ops) {
            if (op.type === "TRANSFER" && op.to && typeof op.to === "string" && op.to.startsWith("idc_")) {
              if (!recipients.includes(op.to)) recipients.push(op.to);
            }
          }
        }
        if (recipients.length === 0) {
          // Fallback to current miner address to avoid empty set
          if (nodeAddress) recipients.push(nodeAddress);
        }
        const seed = await deriveRandSeed(prevBlock.hash, epochId, slotIndex);
        const candidates = recipients.map(a => ({ address: a as Address, weight: 1 }));
        const expected = await selectLeader(epochId, slotIndex, seed, candidates);
        if (!cancelled) setLeader(expected);
      } catch {
        if (!cancelled) setLeader(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chainContext, nodeAddress, epochId, slotIndex]);

  const meIsLeader = leader && nodeAddress && leader === (nodeAddress as any);

  // Removed quorum polling effect

  // Peer metrics
  const peerCount = (p2pNode && (p2pNode as any).getPeerCount) ? (p2pNode as any).getPeerCount() : 0;
  const openChannels = (() => {
    try {
      const peersMap: Map<string, any> = (p2pNode as any)?.peers;
      if (!peersMap) return 0;
      let open = 0;
      for (const info of Array.from(peersMap.values())) {
        if (info?.dataChannel?.readyState === "open") open++;
      }
      return open;
    } catch {
      return 0;
    }
  })();
  // Removed per-channel details to keep UI clean

  // Leader preview for next N slots
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prevBlock = chainContext?.storage.getTip() || null;
        if (!prevBlock) {
          setLeaderPreview([]);
          return;
        }
        const recipients: string[] = [];
        const coinbase = prevBlock.txs?.[0];
        if (coinbase && coinbase.ownerAddress === "idc_system") {
          for (const op of coinbase.ops) {
            if (op.type === "TRANSFER" && op.to && typeof op.to === "string" && op.to.startsWith("idc_")) {
              if (!recipients.includes(op.to)) recipients.push(op.to);
            }
          }
        }
        if (recipients.length === 0 && nodeAddress) {
          recipients.push(nodeAddress);
        }
        const candidates = recipients.map(a => ({ address: a as Address, weight: 1 }));
        const N = previewCount;
        const list: Array<{ epoch: number; slot: number; leader: string | null; me: boolean }> = [];
        let e = epochId;
        let s = slotIndex;
        for (let i = 1; i <= N; i++) {
          s += 1;
          if (s * slotMs >= epochMs) {
            e += 1;
            s = 0;
          }
          const seed = await deriveRandSeed(prevBlock.hash, e, s);
          const L = await selectLeader(e, s, seed, candidates);
          list.push({
            epoch: e,
            slot: s,
            leader: L || null,
            me: !!(L && nodeAddress && L === (nodeAddress as any)),
          });
        }
        if (!cancelled) setLeaderPreview(list);
      } catch {
        if (!cancelled) setLeaderPreview([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chainContext, nodeAddress, epochId, slotIndex, epochMs, slotMs, previewCount]);

  // Reward preview removed from overview to keep it concise

  return (
    <div
      className="status-card"
      style={{
        marginBottom: "1.5rem",
        background: "rgba(255,255,255,0.9)",
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem", gap: "0.5rem", flexWrap: "wrap" }}>
        <div style={{ fontWeight: "bold", fontSize: "1.2rem" }}>{t("tabs.overview")}</div>
        <div style={{ fontSize: "0.85rem", color: "#666" }}>
          {isZh ? "单领导微槽 + 池化分红" : "Single-leader slots + pooled rewards"}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
        {/* Chain summary */}
        <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>{isZh ? "链状态" : "Chain"}</div>
          <div style={{ fontSize: "1rem" }}>
            {isZh ? "本地高度" : "Local"}: <b>{localHeight}</b>
          </div>
          <div style={{ fontSize: "1rem" }}>
            {isZh ? "网络高度" : "Network"}: <b>{networkHeight}</b>
          </div>
          <div style={{ fontSize: "0.9rem", color: behindBy > 0 ? "#dc3545" : "#28a745" }}>
            {isZh ? "落后" : "Behind"}: {behindBy}
          </div>
          <div style={{ fontSize: "0.9rem" }}>
            {isZh ? "对等节点" : "Peers"}: <b>{peerCount}</b>
          </div>
          <div style={{ marginTop: "0.25rem" }}>
            <span
              style={{
                display: "inline-block",
                padding: "0.15rem 0.5rem",
                borderRadius: "12px",
                background: syncColor,
                color: "white",
                fontSize: "0.75rem",
                fontWeight: "bold",
              }}
              title={isZh ? "基于本地与网络高度差值" : "Based on local vs network height difference"}
            >
              {syncLabel}
            </span>
            <button
              onClick={handleCatchUp}
              style={{
                marginLeft: "0.5rem",
                padding: "0.2rem 0.6rem",
                fontSize: "0.8rem",
                borderRadius: "12px",
                border: "1px solid #17a2b8",
                background: "white",
                color: "#17a2b8",
                cursor: "pointer",
              }}
              title={t("miningMain.catchUpTitle")}
            >
              {t("miningMain.catchUp")}
            </button>
            {syncMsg && (
              <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.35rem" }}>
                {syncMsg}
              </div>
            )}
          </div>
        </div>

        {/* Slot summary */}
        <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>{isZh ? "当前槽" : "Slot"}</div>
          <div style={{ fontSize: "1rem" }}>
            {isZh ? "Epoch" : "Epoch"}: <b>{epochId}</b>
          </div>
          <div style={{ fontSize: "1rem" }}>
            {isZh ? "Slot" : "Slot"}: <b>{slotIndex}</b>
          </div>
          {/* Hide raw epoch/slot ms to reduce clutter */}
          {/* Slot progress */}
          <div style={{ marginTop: "0.5rem" }}>
            <div style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.25rem" }}>
              {isZh ? "槽进度" : "Slot progress"}: {slotPct}%
            </div>
            <div style={{ width: "100%", background: "#eee", borderRadius: "4px", height: "6px", overflow: "hidden" }}>
              <div style={{ width: `${slotPct}%`, height: "100%", background: "#17a2b8" }} />
            </div>
          </div>
        </div>

        {/* Leader summary */}
        <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>{isZh ? "领导者" : "Leader"}</div>
          <div style={{ fontSize: "1rem", wordBreak: "break-all" }}>
            {leader ? leader.substring(0, 12) + "..." : (isZh ? "未知" : "Unknown")}
          </div>
          <div style={{ fontSize: "0.9rem", color: meIsLeader ? "#28a745" : "#666" }}>
            {meIsLeader ? (isZh ? "当前为领导者" : "You are leader") : (isZh ? "非领导者" : "Not leader")}
          </div>
        </div>
      </div>

      {/* Compact control bar */}
      <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
        <div style={{ fontWeight: "bold" }}>
          {isZh ? "领导者预览" : "Leader Preview"}
        </div>
        <div style={{ fontSize: "0.85rem", color: "#666" }}>
          {isZh ? "槽数" : "Slots"}:{" "}
          <select
            value={previewCount}
            onChange={(e) => {
              const v = Math.max(1, Number(e.target.value || "10"));
              setPreviewCount(v);
              try { localStorage.setItem("indexerchain_preview_slots_overview", String(v)); } catch {}
            }}
            style={{ padding: "0.25rem 0.5rem", border: "1px solid #ddd", borderRadius: "4px" }}
          >
            {[5,10,20].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Leader preview */}
      <div style={{ marginTop: "0.5rem", background: "#fff", border: "1px solid #eee", borderRadius: "6px" }}>
        <div style={{ padding: "0.75rem", borderBottom: "1px solid #eee", fontWeight: "bold" }}>
          {isZh ? `未来 ${previewCount} 个槽` : `Next ${previewCount} slots`}
        </div>
        <div style={{ padding: "0.75rem" }}>
          {leaderPreview.length === 0 ? (
            <div style={{ fontSize: "0.9rem", color: "#666" }}>{isZh ? "暂无数据" : "No data"}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.5rem" }}>
              {leaderPreview.map((it, idx) => (
                <div
                  key={`${it.epoch}-${it.slot}-${idx}`}
                  style={{
                    background: it.me ? "rgba(40,167,69,0.1)" : "#f8f9fa",
                    border: `1px solid ${it.me ? "#28a745" : "#eee"}`,
                    borderRadius: "6px",
                    padding: "0.5rem",
                    fontSize: "0.85rem",
                  }}
                >
                  <div>
                    Epoch {it.epoch} · Slot {it.slot}
                  </div>
                  <div style={{ color: it.me ? "#28a745" : "#333" }}>
                    {it.leader ? it.leader.substring(0, 12) + "..." : (isZh ? "未知" : "Unknown")}
                    {it.me ? (isZh ? "（你）" : " (you)") : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Compact details toggle */}
      <div style={{ marginTop: "0.75rem" }}>
        <button
          onClick={() => setShowDetails(v => !v)}
          style={{
            background: "transparent",
            border: "none",
            color: "#17a2b8",
            cursor: "pointer",
            fontSize: "0.9rem",
            padding: 0,
          }}
        >
          {showDetails ? (isZh ? "收起详情 ▲" : "Hide details ▲") : (isZh ? "展开详情 ▼" : "Show details ▼")}
        </button>
      </div>
      {showDetails && (
        <div
          style={{
            marginTop: "0.5rem",
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: "6px",
            padding: "0.75rem",
            fontSize: "0.9rem",
            color: "#333",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
            <div>
              <div style={{ color: "#666", fontSize: "0.85rem" }}>{isZh ? "对等节点" : "Peers"}</div>
              <div style={{ fontWeight: "bold" }}>{peerCount}</div>
            </div>
            <div>
              <div style={{ color: "#666", fontSize: "0.85rem" }}>{isZh ? "数据通道(打开)" : "Open channels"}</div>
              <div style={{ fontWeight: "bold" }}>{openChannels}</div>
            </div>
            <div>
              <div style={{ color: "#666", fontSize: "0.85rem" }}>{isZh ? "周期/槽(ms)" : "Epoch/Slot (ms)"}</div>
              <div style={{ fontWeight: "bold" }}>{epochMs}/{slotMs}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


