/**
 * P0-2: Quick Status Dashboard
 * 
 * Simplified overview showing only key metrics
 */

import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { useI18n } from "../../i18n/useI18n.js";
import { formatNumber, formatAddress } from "../../utils/format.js";

interface QuickStatusDashboardProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  isP2PConnected: boolean;
  peerCount: number;
  nodeAddress: string | null;
  isMining: boolean;
  clusterMining: boolean;
  miningGuardResult: any;
  localRole: "LEADER" | "FOLLOWER";
  height: number;
  locale: string;
  onQuickAction: (action: "mining" | "network" | "wallet" | "transactions") => void;
}

export function QuickStatusDashboard({
  chainContext,
  isP2PConnected,
  peerCount,
  nodeAddress,
  isMining,
  clusterMining,
  miningGuardResult,
  localRole,
  height,
  locale: _locale,
  onQuickAction,
}: QuickStatusDashboardProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const getMiningStatus = () => {
    if (isMining || clusterMining) {
      return {
        icon: "⛏️",
        text: isZh ? "挖矿中" : "Mining",
        color: "#28a745",
      };
    }
    if (miningGuardResult?.ok) {
      return {
        icon: "✅",
        text: isZh ? "可挖矿" : "Ready",
        color: "#28a745",
      };
    }
    return {
      icon: "❌",
      text: isZh ? "不可挖矿" : "Not Ready",
      color: "#dc3545",
    };
  };

  const miningStatus = getMiningStatus();
  const balance = chainContext && nodeAddress ? formatNumber(chainContext.indexState.getBalance(nodeAddress as any), 2, locale === "zh" ? "zh-CN" : "en-US") : "0.00";

  return (
    <div
      className="status-card"
      style={{
        marginBottom: "1.5rem",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        color: "white",
        border: "none",
      }}
    >
      <h2 style={{ color: "white", margin: 0, marginBottom: "1.5rem", fontSize: "1.5rem" }}>
        {isZh ? "📊 快速状态" : "📊 Quick Status"}
      </h2>

      {/* Status Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        {/* Network Status */}
        <div
          style={{
            padding: "1rem",
            background: "rgba(255, 255, 255, 0.15)",
            borderRadius: "8px",
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ fontSize: "0.85rem", opacity: 0.9, marginBottom: "0.5rem" }}>
            {isZh ? "网络状态" : "Network"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.5rem" }}>
              {isP2PConnected ? "🟢" : "🔴"}
            </span>
            <div>
              <div style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                {isP2PConnected
                  ? isZh
                    ? `已连接 (${peerCount})`
                    : `Connected (${peerCount})`
                  : isZh
                  ? "未连接"
                  : "Disconnected"}
              </div>
              <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>
                {isZh ? `${peerCount} 个节点` : `${peerCount} peers`}
              </div>
            </div>
          </div>
        </div>

        {/* Wallet Balance */}
        <div
          style={{
            padding: "1rem",
            background: "rgba(255, 255, 255, 0.15)",
            borderRadius: "8px",
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ fontSize: "0.85rem", opacity: 0.9, marginBottom: "0.5rem" }}>
            {isZh ? "钱包余额" : "Balance"}
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
            {balance} IDC
          </div>
          {nodeAddress && (
            <div style={{ fontSize: "0.75rem", opacity: 0.8, marginTop: "0.25rem" }}>
              {formatAddress(nodeAddress, 6, 6)}
            </div>
          )}
        </div>

        {/* Mining Status */}
        <div
          style={{
            padding: "1rem",
            background: "rgba(255, 255, 255, 0.15)",
            borderRadius: "8px",
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ fontSize: "0.85rem", opacity: 0.9, marginBottom: "0.5rem" }}>
            {isZh ? "挖矿状态" : "Mining"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.5rem" }}>{miningStatus.icon}</span>
            <div>
              <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: miningStatus.color }}>
                {miningStatus.text}
              </div>
              {miningGuardResult?.ok && miningGuardResult.mode && (
                <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>
                  {miningGuardResult.mode}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chain Height */}
        <div
          style={{
            padding: "1rem",
            background: "rgba(255, 255, 255, 0.15)",
            borderRadius: "8px",
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ fontSize: "0.85rem", opacity: 0.9, marginBottom: "0.5rem" }}>
            {isZh ? "当前高度" : "Height"}
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>{height}</div>
          <div style={{ fontSize: "0.8rem", opacity: 0.8, marginTop: "0.25rem" }}>
            {localRole === "LEADER" ? (isZh ? "LEADER" : "LEADER") : (isZh ? "FOLLOWER" : "FOLLOWER")}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => onQuickAction("mining")}
          style={{
            padding: "0.75rem 1.5rem",
            background: "white",
            color: "#667eea",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.9rem",
            fontWeight: "bold",
            flex: 1,
            minWidth: "120px",
          }}
        >
          {isMining || clusterMining
            ? isZh
              ? "停止挖矿"
              : "Stop Mining"
            : isZh
            ? "开始挖矿"
            : "Start Mining"}
        </button>
        <button
          onClick={() => onQuickAction("transactions")}
          style={{
            padding: "0.75rem 1.5rem",
            background: "rgba(255, 255, 255, 0.2)",
            color: "white",
            border: "1px solid rgba(255, 255, 255, 0.3)",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.9rem",
            fontWeight: "bold",
            flex: 1,
            minWidth: "120px",
          }}
        >
          {isZh ? "创建交易" : "Create Tx"}
        </button>
        <button
          onClick={() => onQuickAction("network")}
          style={{
            padding: "0.75rem 1.5rem",
            background: "rgba(255, 255, 255, 0.2)",
            color: "white",
            border: "1px solid rgba(255, 255, 255, 0.3)",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.9rem",
            fontWeight: "bold",
            flex: 1,
            minWidth: "120px",
          }}
        >
          {isZh ? "网络详情" : "Network"}
        </button>
      </div>
    </div>
  );
}

