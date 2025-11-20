import { useEffect, useState } from "react";
import type { ChainContext } from "../../core/chain.js";
import { getSlotIdentity, deriveRandSeed, selectLeader } from "../../core/slotSchedule.js";
import { getEpochMs, getSlotTimeMs } from "../../core/featureFlags.js";
import type { Address } from "../../core/types.js";

interface SlotInfoBarProps {
  chainContext: ChainContext | null;
  nodeAddress: string | null;
  locale: string;
}

export function SlotInfoBar({ chainContext, nodeAddress, locale }: SlotInfoBarProps) {
  const isZh = locale === "zh";
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [leader, setLeader] = useState<Address | null>(null);
  const [leaderPreview, setLeaderPreview] = useState<Array<{ epoch: number; slot: number; leader: string | null; me: boolean }>>([]);
  const [previewCount, setPreviewCount] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("indexerchain_slot_preview_n");
      return raw ? Math.max(1, Number(raw)) : 5;
    } catch {
      return 5;
    }
  });
  const [syncMsg, setSyncMsg] = useState<string>("");
  const [showSyncDetail, setShowSyncDetail] = useState<boolean>(false);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const { epochId, slotIndex } = getSlotIdentity(nowMs);
  const epochMs = getEpochMs();
  const slotMs = getSlotTimeMs();

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
        if (recipients.length === 0 && nodeAddress) {
          recipients.push(nodeAddress);
        }
        const seed = await deriveRandSeed(prevBlock.hash, epochId, slotIndex);
        const candidates = recipients.map(a => ({ address: a as Address, weight: 1 }));
        const expected = await selectLeader(epochId, slotIndex, seed, candidates);
        if (!cancelled) setLeader(expected);

        // Next N slots preview
        const epochMsLocal = getEpochMs();
        const slotMsLocal = getSlotTimeMs();
        let e = epochId;
        let s = slotIndex;
        const N = previewCount;
        const list: Array<{ epoch: number; slot: number; leader: string | null; me: boolean }> = [];
        for (let i = 1; i <= N; i++) {
          s += 1;
          if (s * slotMsLocal >= epochMsLocal) {
            e += 1;
            s = 0;
          }
          const seedN = await deriveRandSeed(prevBlock.hash, e, s);
          const L = await selectLeader(e, s, seedN, candidates);
          list.push({
            epoch: e,
            slot: s,
            leader: L || null,
            me: !!(L && nodeAddress && L === (nodeAddress as any)),
          });
        }
        if (!cancelled) setLeaderPreview(list);
      } catch {
        if (!cancelled) setLeader(null);
        if (!cancelled) setLeaderPreview([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chainContext, nodeAddress, epochId, slotIndex, previewCount]);

  const meIsLeader = leader && nodeAddress && leader === (nodeAddress as any);
  const localHeight = chainContext?.storage.getTip()?.header.height ?? 0;
  const networkHeight = (typeof window !== "undefined" && (window as any).lastRootTipHeight) || 0;
  const behindBy = Math.max(0, networkHeight - localHeight);
  const syncLabel = networkHeight <= 0 ? (isZh ? "等待网络" : "Waiting")
    : behindBy <= 1 ? (isZh ? "已同步" : "Synced")
    : behindBy <= 50 ? (isZh ? "追赶中" : "Catching up")
    : (isZh ? "未同步" : "Out of sync");
  const syncColor = behindBy <= 1 ? "#28a745" : behindBy <= 50 ? "#ffc107" : "#dc3545";

  // One-click catch up from Slot bar
  const handleCatchUp = async () => {
    try {
      if (!chainContext || !(chainContext as any).p2p) {
        setSyncMsg(isZh ? "节点未就绪" : "Node not ready");
        return;
      }
      const p2pNode = (chainContext as any).p2p;
      const local = localHeight;
      const network = networkHeight;
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
      try {
        const { handleRootTipUpdate } = await import("../../core/unifiedSyncManager.js");
        const result = await handleRootTipUpdate(
          chainContext,
          p2pNode,
          { latestHeight: network, latestHeaderHash: "" } as any,
          false,
          (msg: string) => setSyncMsg((isZh ? "同步中：" : "Syncing: ") + msg)
        );
        if (result.success) {
          setSyncMsg(isZh ? "✅ 同步完成" : "✅ Synced");
          return;
        }
      } catch {}
      const requestRange = Math.min(diff, 500);
      p2pNode.broadcast("REQUEST_BLOCKS", { fromHeight: local + 1, toHeight: local + requestRange });
      setSyncMsg(
        (isZh ? "已请求区块：" : "Requested blocks: ") + `${local + 1}-${local + requestRange}`
      );
    } catch (e) {
      setSyncMsg((isZh ? "失败：" : "Failed: ") + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div
      style={{
        marginTop: "0.75rem",
        padding: "0.75rem 1rem",
        background: "rgba(255, 255, 255, 0.9)",
        borderRadius: "6px",
        border: "1px solid #e0e0e0",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "auto auto auto", gap: "1rem", alignItems: "center" }}>
        <div style={{ fontSize: "0.95rem" }}>
          <b>{isZh ? "Epoch" : "Epoch"}</b>: {epochId}
        </div>
        <div style={{ fontSize: "0.95rem" }}>
          <b>{isZh ? "Slot" : "Slot"}</b>: {slotIndex}{" "}
          <span style={{ fontSize: "0.8rem", color: "#666", marginLeft: "0.25rem" }}>
            ({epochMs}/{slotMs} ms)
          </span>
        </div>
        <div style={{ fontSize: "0.95rem", textAlign: "right" }}>
          <b>{isZh ? "领导者" : "Leader"}</b>:{" "}
          <span style={{ color: meIsLeader ? "#28a745" : "#333" }}>
            {leader ? leader.substring(0, 12) + "..." : (isZh ? "未知" : "Unknown")}
            {meIsLeader ? (isZh ? "（你）" : " (you)") : ""}
          </span>
        </div>
      </div>

      {/* Sync + Catch up row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span
            onClick={() => setShowSyncDetail(v => !v)}
            style={{
              display: "inline-block",
              padding: "0.15rem 0.5rem",
              borderRadius: "12px",
              background: syncColor,
              color: "white",
              fontSize: "0.75rem",
              fontWeight: "bold",
              cursor: "pointer",
            }}
            title={`${isZh ? "本地/网络高度" : "Local/Network"}: ${localHeight}/${networkHeight}`}
          >
            {syncLabel}
          </span>
          {showSyncDetail && (
            <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "#666" }}>
              {isZh ? "本地/网络/落后" : "Local/Net/Behind"}: {localHeight}/{networkHeight}/{behindBy}
            </span>
          )}
        </div>
        <div>
          <button
            onClick={handleCatchUp}
            style={{
              padding: "0.25rem 0.6rem",
              fontSize: "0.8rem",
              borderRadius: "12px",
              border: "1px solid #17a2b8",
              background: "white",
              color: "#17a2b8",
              cursor: "pointer",
            }}
          >
            {isZh ? "一键追赶" : "Catch up"}
          </button>
        </div>
      </div>
      {syncMsg && (
        <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.35rem" }}>
          {syncMsg}
        </div>
      )}
      
      {/* Next slots preview */}
      {leaderPreview.length > 0 && (
        <div style={{ fontSize: "0.85rem", color: "#666" }}>
          <div style={{ marginBottom: "0.25rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{isZh ? `未来 ${previewCount} 槽：` : `Next ${previewCount} slots:`}</span>
            <span>
              {isZh ? "槽数" : "Slots"}:{" "}
              <select
                value={previewCount}
                onChange={(e) => {
                  const v = Math.max(1, Number(e.target.value || "5"));
                  setPreviewCount(v);
                  try { localStorage.setItem("indexerchain_slot_preview_n", String(v)); } catch {}
                }}
                style={{ padding: "0.15rem 0.4rem", border: "1px solid #ddd", borderRadius: "4px" }}
              >
                {[3,5,10].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {leaderPreview.map((it, idx) => (
              <div
                key={`${it.epoch}-${it.slot}-${idx}`}
                style={{
                  background: it.me ? "rgba(40,167,69,0.1)" : "#f8f9fa",
                  border: `1px solid ${it.me ? "#28a745" : "#eee"}`,
                  borderRadius: "4px",
                  padding: "0.25rem 0.5rem",
                }}
                title={`Epoch ${it.epoch} · Slot ${it.slot}`}
              >
                S{it.slot}: {it.leader ? it.leader.substring(0, 8) + "..." : (isZh ? "未知" : "Unknown")}
                {it.me ? (isZh ? "（你）" : " (you)") : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


