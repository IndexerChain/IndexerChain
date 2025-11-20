import { useEffect, useMemo, useState } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { Block } from "../../core/types.js";

interface LiveBlockFeedProps {
  chainContext: ChainContext | null;
  locale: string;
  maxItems?: number;
}

export function LiveBlockFeed({ chainContext, locale, maxItems = 20 }: LiveBlockFeedProps) {
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
    const timer = setInterval(update, 1500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [chainContext, maxItems]);

  const rows = useMemo(() => {
    return blocks.map((b) => {
      const h = b.header?.height ?? 0;
      const hash = (b as any)?.hash || "";
      const shortHash = hash ? hash.substring(0, 10) + "..." : "";
      // Try proposer (single-leader), fallback to first coinbase recipient
      let leader = (b.header as any)?.proposer || "";
      // Collect pooled recipients from coinbase
      let recipients: string[] = [];
      if (!leader && b.txs && b.txs.length > 0 && b.txs[0]?.ownerAddress === "idc_system") {
        const op = b.txs[0].ops.find(op => (op as any)?.to && String((op as any).to).startsWith("idc_"));
        leader = (op as any)?.to || "";
      }
      if (b.txs && b.txs.length > 0 && b.txs[0]?.ownerAddress === "idc_system") {
        for (const op of b.txs[0].ops) {
          const toAddr = (op as any)?.to;
          if (toAddr && String(toAddr).startsWith("idc_")) {
            if (!recipients.includes(String(toAddr))) recipients.push(String(toAddr));
          }
        }
      }
      const shortLeader = leader ? String(leader).substring(0, 12) + "..." : (isZh ? "未知" : "Unknown");
      const ts = b.header?.timestamp ? new Date((b.header.timestamp as number) * 1000) : null;
      const timeDisplay = ts ? ts.toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour12: false }) : "-";
      const recipientsCount = recipients.length;
      return { h, shortHash, shortLeader, timeDisplay, recipientsCount };
    });
  }, [blocks, isZh, locale]);

  return (
    <div
      className="status-card"
      style={{
        marginBottom: "1rem",
        background: "rgba(255,255,255,0.9)",
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "0.75rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <div style={{ fontWeight: "bold" }}>{isZh ? "📦 最新出块" : "📦 Latest Blocks"}</div>
        <div style={{ fontSize: "0.8rem", color: "#666" }}>
          {isZh ? `显示最近 ${maxItems} 个` : `Showing last ${maxItems}`}
        </div>
      </div>
      <div style={{ maxHeight: "260px", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#666", fontSize: "0.85rem" }}>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "高度" : "Height"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "哈希" : "Hash"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "领导者" : "Leader"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "受益地址数" : "Recipients"}</th>
              <th style={{ padding: "0.35rem 0.25rem" }}>{isZh ? "时间" : "Time"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: "0.5rem 0.25rem", color: "#999", fontStyle: "italic" }}>
                  {isZh ? "暂无区块" : "No blocks yet"}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={idx} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: "0.35rem 0.25rem", fontWeight: 600 }}>{r.h}</td>
                  <td style={{ padding: "0.35rem 0.25rem", fontFamily: "monospace" }}>{r.shortHash}</td>
                  <td style={{ padding: "0.35rem 0.25rem", fontFamily: "monospace" }}>{r.shortLeader}</td>
                  <td style={{ padding: "0.35rem 0.25rem" }}>{r.recipientsCount || 0}</td>
                  <td style={{ padding: "0.35rem 0.25rem", color: "#666" }}>{r.timeDisplay}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

