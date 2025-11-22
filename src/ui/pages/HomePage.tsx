import { LiveBlockFeed } from "../components/LiveBlockFeed.js";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { useI18n } from "../../i18n/useI18n.js";
import { ConfigChecker } from "../ConfigChecker.js";
import { DailyInfoBar } from "../components/DailyInfoBar.js";

interface HomePageProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  nodeAddress: string | null;
  isMining: boolean;
  clusterMining: boolean;
  currentReferrerAddress: string | null;
  locale: string;
  onStartMining?: () => void;
  onCatchUp?: () => void;
}

export function HomePage({
  chainContext,
  p2pNode,
  nodeAddress,
  isMining,
  clusterMining,
  currentReferrerAddress,
  locale,
  onStartMining,
  onCatchUp,
}: HomePageProps) {
  const isZh = locale === "zh";
  const { t } = useI18n();
  const isP2PConnected = !!(p2pNode as any)?.isConnected;
  const rawNetworkHeight = (typeof window !== "undefined" && (window as any).lastRootTipHeight) || 0;
  const networkHeight = rawNetworkHeight > 0 ? rawNetworkHeight : 0;
  const peerCount = (p2pNode && (p2pNode as any).getPeerCount) ? (p2pNode as any).getPeerCount() : 0;

  return (
    <div>
      {/* Status Banner (moved from above tabs) */}
      {chainContext && (
        <div style={{
          padding: "clamp(0.75rem, 2vw, 1rem)",
          marginBottom: "1.5rem",
          borderRadius: "8px",
          background: isP2PConnected && nodeAddress ? "#d4edda" : "#fff3cd",
          border: `2px solid ${isP2PConnected && nodeAddress ? "#28a745" : "#ffc107"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem"
        }}>
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "clamp(0.5rem, 2vw, 1rem)", 
            flexWrap: "wrap",
            flex: "1",
            minWidth: 0
          }}>
            <span style={{ 
              fontSize: "clamp(1.25rem, 4vw, 1.5rem)",
              flexShrink: 0
            }}>
              {isP2PConnected && nodeAddress ? "✅" : "⚠️"}
            </span>
            <div style={{ minWidth: 0, flex: "1" }}>
              <strong style={{ 
                fontSize: "clamp(0.9rem, 2.5vw, 1rem)", 
                display: "block", 
                marginBottom: "0.25rem" 
              }}>
                {isP2PConnected && nodeAddress ? (isZh ? "已连接网络与钱包" : "Connected") : (isZh ? "待配置网络/钱包" : "Pending setup")}
              </strong>
              <div style={{ 
                fontSize: "clamp(0.85rem, 2.5vw, 0.95rem)", 
                color: isP2PConnected && nodeAddress ? "#155724" : "#856404", 
                opacity: 0.95 
              }}>
                {isP2PConnected && nodeAddress
                  ? t("banner.networkConnected", { count: peerCount, height: networkHeight })
                  : !isP2PConnected && !nodeAddress
                  ? t("banner.networkDisconnected")
                  : !isP2PConnected
                  ? t("quickStart.step1Desc")
                  : t("banner.walletInitializing")}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Configuration Checker */}
      {chainContext && (
        <ConfigChecker
          chainContext={chainContext}
          isP2PConnected={isP2PConnected}
          nodeAddress={nodeAddress || ""}
          isMining={isMining || clusterMining}
        />
      )}

      {/* Daily Info Bar */}
      {chainContext && nodeAddress && (
        <DailyInfoBar
          chainContext={chainContext}
          nodeAddress={nodeAddress}
          currentHeight={networkHeight}
          isMining={isMining}
          clusterMining={clusterMining}
          currentReferrerAddress={currentReferrerAddress || null}
          locale={locale}
        />
      )}

      {/* Hero summary */}
      <div
        className="status-card"
        style={{
          marginBottom: "1rem",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          color: "white",
          border: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>{isZh ? "首页" : "Home"}</h2>
            <div style={{ opacity: 0.9, marginTop: "0.25rem" }}>
              {isZh ? "单领导微槽 + 全网池化分红" : "Single-leader slots + pooled rewards"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {onCatchUp && (
              <button
                onClick={onCatchUp}
                style={{
                  background: "white",
                  color: "#764ba2",
                  border: "none",
                  padding: "0.5rem 0.9rem",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {isZh ? "一键追赶" : "Catch Up"}
              </button>
            )}
            {onStartMining && (
              <button
                onClick={onStartMining}
                style={{
                  background: "#28a745",
                  color: "white",
                  border: "none",
                  padding: "0.5rem 0.9rem",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {isZh ? "开始挖矿" : "Start Mining"}
              </button>
            )}
          </div>
        </div>
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: "140px" }}>
            <div style={{ opacity: 0.9 }}>{isZh ? "网络高度" : "Network Height"}</div>
            <div style={{ fontWeight: "bold", fontSize: "1.1rem" }}>{networkHeight}</div>
          </div>
          <div style={{ minWidth: "140px" }}>
            <div style={{ opacity: 0.9 }}>{isZh ? "对等节点" : "Peers"}</div>
            <div style={{ fontWeight: "bold", fontSize: "1.1rem" }}>{peerCount}</div>
          </div>
        </div>
      </div>

      {/* Live Block Feed */}
      <LiveBlockFeed chainContext={chainContext} locale={locale} />
    </div>
  );
}

