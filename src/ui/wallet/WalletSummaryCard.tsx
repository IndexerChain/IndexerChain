import { useEffect, useState } from "react";
import type { ChainContext } from "../../core/chain.js";
// Balance in IndexState is stored as IDC (number)

interface WalletSummaryCardProps {
  chainContext: ChainContext | null;
  address: string | null;
  locale: string;
  className?: string; // Optional className for custom styling
  styles?: any; // Optional styles module for dark theme
}

export function WalletSummaryCard({ chainContext, address, locale, className, styles }: WalletSummaryCardProps) {
  const isZh = locale === "zh";
  const [balance, setBalance] = useState<number>(0);
  const [expectedIDC, setExpectedIDC] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    try {
      if (!chainContext || !address) {
        setBalance(0);
        return;
      }
      const raw = chainContext.indexState.getBalance(address as any);
      setBalance(typeof raw === "number" ? raw : 0);
    } catch {
      setBalance(0);
    }
  }, [chainContext, address]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      try {
        const w: any = window as any;
        const pending: number = w.expectedPendingIDC || 0;
        setExpectedIDC(pending);
      } catch {}
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Use provided className or fallback to status-card
  const cardClassName = className || "status-card";

  // Determine if we're using dark theme (when className is provided, it's likely the dark theme card)
  const isDarkTheme = className && className.includes('card');
  
  // Format address for display
  const formatAddress = (addr: string | null) => {
    if (!addr) return isZh ? "未初始化" : "Not initialized";
    if (addr.length <= 16) return addr;
    return `${addr.substring(0, 8)}...${addr.substring(addr.length - 8)}`;
  };

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // Use module styles if available, otherwise use inline styles
  const DataLabel = styles?.dataLabel ? styles.dataLabel : "dataLabel";
  const DataValue = styles?.dataValue ? styles.dataValue : "dataValue";
  const Numeric = styles?.numeric ? styles.numeric : "";

  return (
    <div className={cardClassName}>
      <h3 style={{ marginTop: 0 }}>{isZh ? "👛 钱包总览" : "👛 Wallet Overview"}</h3>
      
      {/* Address Section */}
      <div style={{ marginBottom: 16 }}>
        <div className={DataLabel} style={{ marginBottom: 4 }}>
          {isZh ? "钱包地址" : "Wallet Address"}
        </div>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 8,
          background: isDarkTheme ? 'rgba(255,255,255,0.05)' : '#f8f9fa',
          padding: '8px 12px',
          borderRadius: 6,
          border: isDarkTheme ? '1px solid #30363d' : '1px solid #e9ecef'
        }}>
          <div style={{ 
            fontFamily: "monospace", 
            wordBreak: "break-all", 
            flex: 1,
            color: isDarkTheme ? "#c9d1d9" : "#333",
            fontSize: "0.9em"
          }}>
            {formatAddress(address)}
          </div>
          <button
            onClick={handleCopyAddress}
            style={{
              background: "transparent",
              border: "none",
              color: isDarkTheme ? "#58a6ff" : "#17a2b8",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.85em",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isDarkTheme ? "rgba(88, 166, 255, 0.1)" : "rgba(23, 162, 184, 0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            title={copied ? (isZh ? "已复制!" : "Copied!") : (isZh ? "复制地址" : "Copy Address")}
          >
            {copied ? "✓" : "📋"}
          </button>
        </div>
      </div>

      {/* Balance Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 12 }}>
        <div>
          <div className={DataLabel} style={{ marginBottom: 4 }}>
            {isZh ? "最终余额" : "Final Balance"}
          </div>
          <div className={`${DataValue} ${Numeric}`} style={{ fontSize: "1.1em", color: isDarkTheme ? "#4ee672" : "#28a745" }}>
            {balance.toFixed(12)} IDC
          </div>
        </div>
        <div>
          <div className={DataLabel} style={{ marginBottom: 4 }}>
            {isZh ? "预期收益" : "Expected Reward"}
          </div>
          <div className={`${DataValue} ${Numeric}`} style={{ fontSize: "1.1em" }}>
            {expectedIDC.toFixed(12)} IDC
          </div>
        </div>
      </div>

      {/* Info Note */}
      <div style={{ 
        marginTop: 12, 
        paddingTop: 12, 
        borderTop: isDarkTheme ? '1px solid #30363d' : '1px solid #e9ecef',
        fontSize: "0.8em", 
        color: isDarkTheme ? "#8b949e" : "#666",
        lineHeight: 1.5
      }}>
        {isZh 
          ? "最终余额基于链上状态，预期收益为本地估算值（12位精度）" 
          : "Final balance is based on chain state. Expected reward is a local estimate (12 decimals)"}
      </div>
    </div>
  );
}


