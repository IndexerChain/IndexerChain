import { useEffect, useState } from "react";
import type { ChainContext } from "../../core/chain.js";
import { uIDCToIDC } from "../../core/idcEmission.js";

interface WalletSummaryCardProps {
  chainContext: ChainContext | null;
  address: string | null;
  locale: string;
}

export function WalletSummaryCard({ chainContext, address, locale }: WalletSummaryCardProps) {
  const isZh = locale === "zh";
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    try {
      if (!chainContext || !address) {
        setBalance(0);
        return;
      }
      const raw = chainContext.indexState.getBalance(address as any);
      // getBalance returns bigint of uIDC
      setBalance(uIDCToIDC(raw as unknown as bigint));
    } catch {
      setBalance(0);
    }
  }, [chainContext, address]);

  return (
    <div className="status-card" style={{ marginBottom: "1.5rem" }}>
      <h2 style={{ marginTop: 0 }}>{isZh ? "👛 钱包总览" : "👛 Wallet Overview"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <div style={{ color: "#666", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
            {isZh ? "钱包地址" : "Address"}
          </div>
          <div style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
            {address ? address : (isZh ? "未初始化" : "Not initialized")}
          </div>
        </div>
        <div>
          <div style={{ color: "#666", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
            {isZh ? "余额" : "Balance"}
          </div>
          <div style={{ fontWeight: "bold", fontSize: "1.2rem" }}>
            {balance.toFixed(6)} IDC
          </div>
        </div>
      </div>
      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
        <button
          onClick={() => {
            if (!address) return;
            try {
              navigator.clipboard.writeText(address);
            } catch {}
          }}
          style={{
            padding: "0.4rem 0.8rem",
            borderRadius: "6px",
            border: "1px solid #17a2b8",
            background: "white",
            color: "#17a2b8",
            cursor: "pointer",
          }}
        >
          {isZh ? "复制地址" : "Copy Address"}
        </button>
      </div>
    </div>
  );
}


