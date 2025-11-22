import { useEffect, useMemo, useState } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { Block } from "../../core/types.js";

interface LiveBlockFeedProps {
  chainContext: ChainContext | null;
  locale: string;
  maxItems?: number;
  myAddress?: string; // Add myAddress to check for rewards
}

export function LiveBlockFeed({ chainContext, locale, maxItems = 20, myAddress }: LiveBlockFeedProps) {
  const isZh = locale === "zh";
  const [blocks, setBlocks] = useState<Block[]>([]);

  // Poll latest blocks from storage on an interval (cheap; storage is in-memory)
  useEffect(() => {
    let mounted = true;
    const update = () => {
      try {
        if (!chainContext) return;
        const all = chainContext.storage.getAllBlocks();
        const recent = all.slice(-maxItems).reverse();
        if (mounted) setBlocks(recent);
      } catch {
        // ignore
      }
    };
    update();
    const timer = setInterval(update, 500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [chainContext, maxItems]);

  const rows = useMemo(() => {
    return blocks.map((b) => {
      const h = b.header?.height ?? 0;
      const slot = (b.header as any)?.slot ?? 0;
      const hash = (b as any)?.hash || "";
      const shortHash = hash ? hash.substring(0, 10) + "..." : "";
      
      // ZK Root
      const zkRoot = (b.header as any)?.zkStateRoot || "";
      const shortZkRoot = zkRoot ? zkRoot.substring(0, 8) + "..." : "--";

      // Try proposer (single-leader), fallback to first coinbase recipient
      let leader = (b.header as any)?.proposer || "";
      // Collect pooled recipients from coinbase
      let recipients: string[] = [];
      let myReward = 0;
      let poolReward = 0;
      
      if (b.txs && b.txs.length > 0 && b.txs[0]?.ownerAddress === "idc_system") {
        for (const op of b.txs[0].ops) {
          const toAddr = (op as any)?.to;
          const amt = (op as any)?.amount || 0;
          poolReward += amt; // Sum up total pool reward
          
          if (toAddr && String(toAddr).startsWith("idc_")) {
            if (!recipients.includes(String(toAddr))) recipients.push(String(toAddr));
            // Calculate my reward share from this block locally
            if (myAddress && String(toAddr) === myAddress) {
              myReward += amt;
            }
          }
        }
      }
      
      if (!leader && recipients.length > 0) leader = recipients[0]; // fallback

      const shortLeader = leader ? String(leader).substring(0, 12) + "..." : (isZh ? "未知" : "Unknown");
      const ts = b.header?.timestamp ? new Date((b.header.timestamp as number)) : null; // timestamp is ms
      const timeDisplay = ts ? ts.toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour12: false }) : "-";
      const recipientsCount = recipients.length;
      const proofLink = (b.header as any)?.zkProofHash ? "Yes" : "No";
      
      return { h, slot, shortHash, shortZkRoot, shortLeader, timeDisplay, recipientsCount, myReward, poolReward, proofLink };
    });
  }, [blocks, isZh, locale, myAddress]);

  return (
    <div
      className="status-card"
      style={{
        marginBottom: "1rem",
        background: "#0d1117", // Dark background
        border: "1px solid #30363d", // Dark border
        borderRadius: "6px",
        padding: "0.75rem",
        color: "#c9d1d9" // Light text
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <div style={{ fontWeight: "bold", color: "#c9d1d9" }}>{isZh ? "📦 实时区块列表" : "📦 Live Block Feed"}</div>
        <div style={{ fontSize: "0.8rem", color: "#8b949e" }}>
          {isZh ? `显示最近 ${maxItems} 个` : `Showing last ${maxItems}`}
        </div>
      </div>
      <div style={{ maxHeight: "300px", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#8b949e" }}>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "高度" : "Height"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "Slot" : "Slot"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "领导者" : "Proposer"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "ZK Root" : "ZK Root"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "池奖励" : "Pool Reward"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "我的奖励" : "My Reward"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "证明" : "Proof"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "时间" : "Time"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "0.5rem 0.25rem", color: "#8b949e", fontStyle: "italic", textAlign: "center" }}>
                  {isZh ? "暂无区块" : "No blocks yet"}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={idx} style={{ borderTop: "1px solid #30363d" }}>
                  <td style={{ padding: "0.35rem 0.25rem", fontWeight: 600, color: "#c9d1d9" }}>{r.h.toLocaleString()}</td>
                  <td style={{ padding: "0.35rem 0.25rem", color: "#8b949e" }}>{r.slot}</td>
                  <td style={{ padding: "0.35rem 0.25rem", fontFamily: "monospace", color: r.shortLeader === "Unknown" ? "#8b949e" : "#58a6ff" }}>{r.shortLeader}</td>
                  <td style={{ padding: "0.35rem 0.25rem", fontFamily: "monospace", color: "#8b949e" }} title={r.shortZkRoot}>{r.shortZkRoot}</td>
                  <td style={{ padding: "0.35rem 0.25rem", color: "#c9d1d9" }}>{r.poolReward.toFixed(6)}</td>
                  <td style={{ padding: "0.35rem 0.25rem", color: r.myReward > 0 ? "#4ee672" : "#8b949e", fontWeight: r.myReward > 0 ? "bold" : "normal" }}>
                    {r.myReward > 0 ? `+${r.myReward.toFixed(6)}` : "-"}
                  </td>
                  <td style={{ padding: "0.35rem 0.25rem" }}>
                    {r.proofLink === "Yes" ? <span style={{color: "#4ee672"}} title="ZK Proof Available">✓</span> : <span style={{color: "#8b949e"}} title="Pending">⏳</span>}
                  </td>
                  <td style={{ padding: "0.35rem 0.25rem", color: "#8b949e" }}>{r.timeDisplay}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
