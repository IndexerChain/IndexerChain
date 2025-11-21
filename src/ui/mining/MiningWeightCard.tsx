import { useEffect, useMemo, useState } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { computeEffectiveWeight } from "../../core/rewardPoolAllocator.js";
import { computeOnlineScore, computeReliabilityScore, getBalanceUIDC } from "../../core/weightSignals.js";

interface MiningWeightCardProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  nodeAddress: string | null;
  locale: string;
}

export function MiningWeightCard({ chainContext, p2pNode, nodeAddress, locale }: MiningWeightCardProps) {
  const isZh = locale === "zh";
  const [onlineScore, setOnlineScore] = useState<number>(0);
  const [reliabilityScore, setReliabilityScore] = useState<number>(0);

  // Refresh scores periodically
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      setOnlineScore(computeOnlineScore());
      const rel = await computeReliabilityScore(chainContext, p2pNode);
      if (alive) setReliabilityScore(rel);
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [chainContext, p2pNode]);

  const balanceUIDC = useMemo(() => getBalanceUIDC(chainContext, (nodeAddress as any) || null), [chainContext, nodeAddress]);

  const effectiveWeight = useMemo(
    () =>
      computeEffectiveWeight({
        address: (nodeAddress as any) || "idc_unknown",
        balanceUIDC,
        onlineScore,
        reliabilityScore,
        eligible: true,
      }),
    [nodeAddress, balanceUIDC, onlineScore, reliabilityScore]
  );

  if (!chainContext || !nodeAddress) {
    return null;
  }

  const balanceIDC = chainContext.indexState.getBalance(nodeAddress as any) || 0;

  return (
    <div
      className="status-card"
      style={{
        marginTop: "1rem",
        background: "rgba(255,255,255,0.9)",
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <div style={{ fontWeight: "bold" }}>{isZh ? "我的权重信号" : "My Weight Signals"}</div>
        <div style={{ fontSize: "0.85rem", color: "#666" }}>{isZh ? "池化分配（预览）" : "Pooled Allocation (Preview)"}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>{isZh ? "余额" : "Balance"}</div>
          <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>{balanceIDC.toFixed(12)} IDC</div>
        </div>
        <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>{isZh ? "在线评分" : "Online Score"}</div>
          <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>{onlineScore}/100</div>
        </div>
        <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>{isZh ? "稳定性评分" : "Reliability"}</div>
          <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>{reliabilityScore}/100</div>
        </div>
      </div>

      <div style={{ marginTop: "0.75rem", background: "#fff", border: "1px dashed #e0e0e0", padding: "0.75rem", borderRadius: "6px" }}>
        <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>{isZh ? "有效权重（预估）" : "Effective Weight (Estimated)"}</div>
        <div style={{ fontSize: "1.25rem", fontWeight: "bold" }}>{effectiveWeight.toFixed(4)}</div>
      </div>
    </div>
  );
}


