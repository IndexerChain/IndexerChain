/**
 * Phase 34: Network Health Dashboard
 * 
 * Comprehensive network health and mining readiness overview
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { MiningGuard, type MainnetAdmissionStatus, type NetworkStage } from "../../core/miningGuard.js";
import { QuorumPanel } from "./QuorumPanel.js";

interface NetworkHealthPanelProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  finalityManager: any;
  localRole: "LEADER" | "FOLLOWER";
  bootstrapComplete: boolean;
  locale: string;
}

export function NetworkHealthPanel({
  chainContext,
  p2pNode,
  finalityManager,
  localRole,
  bootstrapComplete,
  locale,
}: NetworkHealthPanelProps) {
  const [readinessInfo, setReadinessInfo] = useState<any>(null);
  const [admissionStatus, setAdmissionStatus] = useState<MainnetAdmissionStatus | null>(null);
  const [admissionRules, setAdmissionRules] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const isZh = locale === "zh";

  useEffect(() => {
    if (!chainContext || !p2pNode) {
      setReadinessInfo(null);
      setLoading(false);
      return;
    }

    const updateReadiness = async () => {
      try {
        const info = await MiningGuard.getMiningReadinessInfo(
          chainContext,
          p2pNode,
          finalityManager,
          localRole,
          bootstrapComplete
        );
        setReadinessInfo(info);
        
        // Phase 35: Get mainnet admission status
        if (chainContext && p2pNode) {
          const admission = await MiningGuard.getMainnetAdmissionStatus(
            chainContext,
            p2pNode,
            finalityManager,
            localRole,
            bootstrapComplete
          );
          setAdmissionStatus(admission);
          
          // Phase 35: Check all admission rules
          const { isMainnet } = await import("../../core/networkParams.js");
          if (isMainnet(chainContext.params)) {
            const rules = await MiningGuard.checkMainnetAdmissionRules(
              chainContext,
              p2pNode,
              finalityManager,
              localRole,
              bootstrapComplete
            );
            setAdmissionRules(rules);
          }
        }
      } catch (error) {
        console.error("[NetworkHealthPanel] Failed to get readiness info:", error);
      } finally {
        setLoading(false);
      }
    };

    updateReadiness();
    const interval = setInterval(updateReadiness, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [chainContext, p2pNode, finalityManager, localRole, bootstrapComplete]);

  if (loading || !readinessInfo) {
    return (
      <div className="status-card">
        <div style={{ padding: "2rem", textAlign: "center", color: "#666" }}>
          {isZh ? "加载中..." : "Loading..."}
        </div>
      </div>
    );
  }

  const getReadinessStatus = (): { icon: string; color: string; label: string } => {
    if (readinessInfo.canMine) {
      return {
        icon: "🟢",
        color: "#28a745",
        label: isZh ? "READY" : "READY",
      };
    } else if (readinessInfo.details.syncStatus === "syncing") {
      return {
        icon: "🟡",
        color: "#ffc107",
        label: isZh ? "SYNCING" : "SYNCING",
      };
    } else {
      return {
        icon: "🔴",
        color: "#dc3545",
        label: isZh ? "BLOCKED" : "BLOCKED",
      };
    }
  };

  const status = getReadinessStatus();

  return (
    <div>
      {/* Mining Readiness Overview */}
      <div
        className="status-card"
        style={{
          marginBottom: "1rem",
          background: readinessInfo.canMine
            ? "rgba(40, 167, 69, 0.1)"
            : "rgba(220, 53, 69, 0.1)",
          border: `2px solid ${status.color}`,
        }}
      >
        <h2 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.2rem" }}>
          {isZh ? "🔥 主网挖矿就绪度" : "🔥 Mining Readiness Overview"}
        </h2>
        
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "1rem",
            padding: "1rem",
            background: "white",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "3rem" }}>{status.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: status.color }}>
              {status.label}
            </div>
            <div style={{ fontSize: "0.9rem", color: "#666", marginTop: "0.25rem" }}>
              {readinessInfo.reason}
            </div>
          </div>
        </div>

        {/* Detailed Status Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "0.75rem",
            marginTop: "1rem",
          }}
        >
          <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {isZh ? "P2P 连接" : "P2P Connected"}
            </div>
            <div
              style={{
                fontSize: "1.2rem",
                fontWeight: "bold",
                color: readinessInfo.p2pConnected ? "#28a745" : "#dc3545",
              }}
            >
              {readinessInfo.p2pConnected ? "✅" : "❌"}
            </div>
          </div>

          <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {isZh ? "Bootstrap 完成" : "Bootstrap Complete"}
            </div>
            <div
              style={{
                fontSize: "1.2rem",
                fontWeight: "bold",
                color: readinessInfo.bootstrapCompleted ? "#28a745" : "#ffc107",
              }}
            >
              {readinessInfo.bootstrapCompleted ? "✅" : "⏳"}
            </div>
          </div>

          <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {isZh ? "Finality 就绪" : "Finality Ready"}
            </div>
            <div
              style={{
                fontSize: "1.2rem",
                fontWeight: "bold",
                color: readinessInfo.finalityReady ? "#28a745" : "#ffc107",
              }}
            >
              {readinessInfo.finalityReady ? "✅" : "⚠️"}
            </div>
          </div>

          <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {isZh ? "本地角色" : "Local Role"}
            </div>
            <div
              style={{
                fontSize: "1.2rem",
                fontWeight: "bold",
                color: readinessInfo.localRole === "LEADER" ? "#28a745" : "#ffc107",
              }}
            >
              {readinessInfo.localRole === "LEADER" ? "👑 LEADER" : "👥 FOLLOWER"}
            </div>
          </div>

          <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {isZh ? "钱包有效" : "Wallet Valid"}
            </div>
            <div
              style={{
                fontSize: "1.2rem",
                fontWeight: "bold",
                color: readinessInfo.details.walletValid ? "#28a745" : "#dc3545",
              }}
            >
              {readinessInfo.details.walletValid ? "✅" : "❌"}
            </div>
          </div>

          <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {isZh ? "网络验证" : "Network Validated"}
            </div>
            <div
              style={{
                fontSize: "1.2rem",
                fontWeight: "bold",
                color: readinessInfo.details.networkValidated ? "#28a745" : "#ffc107",
              }}
            >
              {readinessInfo.details.networkValidated ? "✅" : "⏳"}
            </div>
          </div>
        </div>

        {/* Detailed Check Report */}
        {!readinessInfo.canMine && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1rem",
              background: "#fff3cd",
              borderRadius: "8px",
              border: "1px solid #ffc107",
            }}
          >
            <h4 style={{ margin: 0, marginBottom: "0.75rem", color: "#856404" }}>
              {isZh ? "❌ 详细检查报告" : "❌ Detailed Check Report"}
            </h4>
            <div style={{ fontSize: "0.9rem", color: "#856404" }}>
              <div style={{ marginBottom: "0.5rem" }}>
                <strong>{isZh ? "原因:" : "Reason:"}</strong> {readinessInfo.reason}
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                <strong>{isZh ? "检查项:" : "Checks:"}</strong>
                <ul style={{ margin: "0.5rem 0", paddingLeft: "1.5rem" }}>
                  <li>
                    {isZh ? "独立 Peer:" : "Unique Peers:"} {readinessInfo.uniquePeers} (
                    {readinessInfo.uniquePeers >= 2 ? "✅" : "❌"} {isZh ? "需要 ≥2" : "need ≥2"})
                  </li>
                  <li>
                    {isZh ? "Quorum 分数:" : "Quorum Score:"} {readinessInfo.quorumScore} /{" "}
                    {readinessInfo.threshold} (
                    {readinessInfo.quorumScore >= readinessInfo.threshold ? "✅" : "❌"})
                  </li>
                  <li>
                    {isZh ? "Bootstrap 完成:" : "Bootstrap Completed:"}{" "}
                    {readinessInfo.bootstrapCompleted ? "✅" : "❌"}
                  </li>
                  <li>
                    {isZh ? "本地角色:" : "Local Role:"} {readinessInfo.localRole} (
                    {readinessInfo.localRole === "LEADER" ? "✅" : "❌"}{" "}
                    {isZh ? "需要 LEADER" : "need LEADER"})
                  </li>
                  <li>
                    {isZh ? "钱包有效:" : "Wallet Valid:"}{" "}
                    {readinessInfo.details.walletValid ? "✅" : "❌"}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Phase 35: Mainnet Admission Status */}
      {admissionStatus && chainContext && (() => {
        // Check if mainnet (synchronous check)
        const isMainnetNetwork = chainContext.params.networkId === "IXC_MAINNET_V1";
        if (!isMainnetNetwork) return null;
        
        const getStageLabel = (stage: NetworkStage): string => {
          switch (stage) {
            case "coldStart":
              return isZh ? "❄️ 冷启动阶段" : "❄️ Cold Start";
            case "earlyGrowth":
              return isZh ? "🌱 初期增长" : "🌱 Early Growth";
            case "mature":
              return isZh ? "🌳 成熟期" : "🌳 Mature";
            case "secure":
              return isZh ? "🔒 高安全模式" : "🔒 Secure Mode";
          }
        };

        const getStageColor = (stage: NetworkStage): string => {
          switch (stage) {
            case "coldStart":
              return "#17a2b8";
            case "earlyGrowth":
              return "#28a745";
            case "mature":
              return "#007bff";
            case "secure":
              return "#6f42c1";
          }
        };

        const stageColor = getStageColor(admissionStatus.stage);
        const stageLabel = getStageLabel(admissionStatus.stage);

        return (
          <div
            className="status-card"
            style={{
              marginBottom: "1rem",
              background: admissionStatus.admissionReady
                ? "rgba(40, 167, 69, 0.1)"
                : "rgba(220, 53, 69, 0.1)",
              border: `2px solid ${admissionStatus.admissionReady ? "#28a745" : "#dc3545"}`,
            }}
          >
            <h2 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.2rem" }}>
              {isZh ? "📜 主网挖矿准入规则" : "📜 Mainnet Mining Admission Rules"}
            </h2>

            {/* Network Stage */}
            <div
              style={{
                padding: "1rem",
                background: "white",
                borderRadius: "8px",
                marginBottom: "1rem",
                border: `2px solid ${stageColor}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
                <div style={{ fontSize: "2rem" }}>{stageLabel.split(" ")[0]}</div>
                <div>
                  <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: stageColor }}>
                    {stageLabel}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {isZh
                      ? `当前网络阶段：需要 ${admissionStatus.requiredIndependentPeers} 个独立 Peer，${admissionStatus.requiredQuorumScore} 分`
                      : `Current stage: Need ${admissionStatus.requiredIndependentPeers} independent peers, ${admissionStatus.requiredQuorumScore} score`}
                  </div>
                </div>
              </div>

              {/* Current Status */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
                <div style={{ padding: "0.75rem", background: "#f8f9fa", borderRadius: "6px" }}>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {isZh ? "Quorum 分数" : "Quorum Score"}
                  </div>
                  <div
                    style={{
                      fontSize: "1.5rem",
                      fontWeight: "bold",
                      color: admissionStatus.quorumScore >= admissionStatus.requiredQuorumScore ? "#28a745" : "#dc3545",
                    }}
                  >
                    {admissionStatus.quorumScore} / {admissionStatus.requiredQuorumScore}
                  </div>
                </div>

                <div style={{ padding: "0.75rem", background: "#f8f9fa", borderRadius: "6px" }}>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {isZh ? "独立 Peer" : "Independent Peers"}
                  </div>
                  <div
                    style={{
                      fontSize: "1.5rem",
                      fontWeight: "bold",
                      color: admissionStatus.independentPeers >= admissionStatus.requiredIndependentPeers ? "#28a745" : "#dc3545",
                    }}
                  >
                    {admissionStatus.independentPeers} / {admissionStatus.requiredIndependentPeers}
                  </div>
                </div>

                <div style={{ padding: "0.75rem", background: "#f8f9fa", borderRadius: "6px" }}>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {isZh ? "准入状态" : "Admission Status"}
                  </div>
                  <div
                    style={{
                      fontSize: "1.2rem",
                      fontWeight: "bold",
                      color: admissionStatus.admissionReady ? "#28a745" : "#dc3545",
                    }}
                  >
                    {admissionStatus.admissionReady ? (isZh ? "✅ 就绪" : "✅ Ready") : (isZh ? "❌ 未就绪" : "❌ Not Ready")}
                  </div>
                </div>
              </div>
            </div>

            {/* Admission Rules Check */}
            {admissionRules && (
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ margin: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
                  {isZh ? "10 条准入规则检查" : "10 Admission Rules Check"}
                </h3>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  {admissionRules.rules.map((rule: any) => (
                    <div
                      key={rule.id}
                      style={{
                        padding: "0.75rem",
                        background: rule.passed ? "rgba(40, 167, 69, 0.1)" : "rgba(220, 53, 69, 0.1)",
                        borderRadius: "6px",
                        border: `1px solid ${rule.passed ? "#28a745" : "#dc3545"}`,
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                      }}
                    >
                      <div style={{ fontSize: "1.2rem" }}>{rule.passed ? "✅" : "❌"}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: "bold", fontSize: "0.9rem" }}>
                          {rule.id}. {rule.name}
                        </div>
                        {rule.reason && (
                          <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                            {rule.reason}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reasons and Suggestions */}
            {!admissionStatus.admissionReady && (
              <div
                style={{
                  padding: "1rem",
                  background: "#fff3cd",
                  borderRadius: "8px",
                  border: "1px solid #ffc107",
                }}
              >
                <h4 style={{ margin: 0, marginBottom: "0.75rem", color: "#856404" }}>
                  {isZh ? "❌ 准入未通过原因" : "❌ Admission Not Ready"}
                </h4>
                {admissionStatus.reasons.length > 0 && (
                  <div style={{ marginBottom: "0.75rem" }}>
                    <strong style={{ color: "#856404" }}>{isZh ? "原因:" : "Reasons:"}</strong>
                    <ul style={{ margin: "0.5rem 0", paddingLeft: "1.5rem", color: "#856404" }}>
                      {admissionStatus.reasons.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {admissionStatus.suggestions.length > 0 && (
                  <div>
                    <strong style={{ color: "#856404" }}>
                      {isZh ? "建议:" : "Suggestions:"}
                    </strong>
                    <ul style={{ margin: "0.5rem 0", paddingLeft: "1.5rem", color: "#856404" }}>
                      {admissionStatus.suggestions.map((suggestion, idx) => (
                        <li key={idx}>{suggestion}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Phase 36: State Lock Status - placeholder for future implementation */}

      {/* Phase 37: Bootstrap Debug Overlay */}
      <div
        className="status-card"
        style={{
          marginBottom: "1rem",
          background: "rgba(0, 123, 255, 0.05)",
          border: "1px solid #007bff",
        }}
      >
        <h2 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.2rem" }}>
          {isZh ? "🔍 Bootstrap 调试信息" : "🔍 Bootstrap Debug Info"}
        </h2>
        
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {/* Bootstrap Status */}
          <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
            <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
              {isZh ? "Bootstrap 状态" : "Bootstrap Status"}
            </div>
            <div
              style={{
                fontSize: "1.2rem",
                fontWeight: "bold",
                color: bootstrapComplete ? "#28a745" : "#ffc107",
              }}
            >
              {bootstrapComplete ? (isZh ? "✅ 已完成" : "✅ Complete") : (isZh ? "⏳ 进行中" : "⏳ Pending")}
            </div>
          </div>

          {/* Signal Server RootTip Info */}
          {chainContext && (() => {
            const localTip = chainContext.storage.getTip();
            const localHeight = localTip?.header.height ?? -1;
            const rootTipHeight = (window as any).lastRootTipHeight || 0;
            const rootTipHash = (window as any).lastRootTipHash || "N/A";
            const lastBootstrapTime = (window as any).lastBootstrapResponseTime || null;
            
            return (
              <>
                <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
                  <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
                    {isZh ? "Signal Server RootTip" : "Signal Server RootTip"}
                  </div>
                  <div style={{ fontSize: "0.9rem" }}>
                    <div>
                      <strong>{isZh ? "高度:" : "Height:"}</strong> {rootTipHeight > 0 ? rootTipHeight : "N/A"}
                    </div>
                    <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "#666", wordBreak: "break-all" }}>
                      <strong>{isZh ? "Hash:" : "Hash:"}</strong> {rootTipHash.substring(0, 16)}...
                    </div>
                    {lastBootstrapTime && (
                      <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "#666" }}>
                        <strong>{isZh ? "更新时间:" : "Updated:"}</strong> {new Date(lastBootstrapTime).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
                  <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
                    {isZh ? "本地 Tip" : "Local Tip"}
                  </div>
                  <div style={{ fontSize: "0.9rem" }}>
                    <div>
                      <strong>{isZh ? "高度:" : "Height:"}</strong> {localHeight}
                    </div>
                    {rootTipHeight > 0 && (
                      <div style={{ marginTop: "0.25rem" }}>
                        <strong>{isZh ? "差距:" : "Behind:"}</strong>{" "}
                        <span style={{ color: rootTipHeight - localHeight > 0 ? "#dc3545" : "#28a745" }}>
                          {rootTipHeight - localHeight} {isZh ? "区块" : "blocks"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* RootTip Trust Level */}
                {(() => {
                  const trustLevel = (window as any).lastRootTipTrustLevel || 'root-only';
                  const getTrustColor = (level: string) => {
                    switch (level) {
                      case 'local-majority': return '#28a745';
                      case 'root-only': return '#ffc107';
                      case 'stale': return '#dc3545';
                      default: return '#666';
                    }
                  };
                  const getTrustLabel = (level: string) => {
                    switch (level) {
                      case 'local-majority': return isZh ? '✅ 本地多数验证' : '✅ Local Majority';
                      case 'root-only': return isZh ? '⚠️ 仅根节点' : '⚠️ Root Only';
                      case 'stale': return isZh ? '❌ 已过期' : '❌ Stale';
                      default: return level;
                    }
                  };
                  
                  return (
                    <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
                      <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
                        {isZh ? "RootTip 信任状态" : "RootTip Trust Level"}
                      </div>
                      <div
                        style={{
                          fontSize: "1rem",
                          fontWeight: "bold",
                          color: getTrustColor(trustLevel),
                        }}
                      >
                        {getTrustLabel(trustLevel)}
                      </div>
                      <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "#666" }}>
                        {trustLevel === 'root-only' && (isZh
                          ? "仅来自 Signal Server，建议与 P2P 多数对比"
                          : "From Signal Server only, recommend comparing with P2P majority")}
                        {trustLevel === 'local-majority' && (isZh
                          ? "已通过本地多数节点验证"
                          : "Verified by local majority of peers")}
                        {trustLevel === 'stale' && (isZh
                          ? "RootTip 可能已过期，建议重新同步"
                          : "RootTip may be stale, recommend re-sync")}
                      </div>
                    </div>
                  );
                })()}

                {/* Sync Status */}
                {rootTipHeight > 0 && rootTipHeight !== localHeight && (
                  <div
                    style={{
                      padding: "0.75rem",
                      background: "#fff3cd",
                      borderRadius: "6px",
                      border: "1px solid #ffc107",
                    }}
                  >
                    <div style={{ fontSize: "0.85rem", color: "#856404" }}>
                      {isZh
                        ? `⚠️ 需要同步: 本地高度 ${localHeight} < Signal Server 高度 ${rootTipHeight}`
                        : `⚠️ Sync needed: Local height ${localHeight} < Signal Server height ${rootTipHeight}`}
                    </div>
                    {(window as any).pendingBootstrapBlockRequest && (
                      <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#856404" }}>
                        {isZh ? "📋 待执行的区块请求已存储" : "📋 Pending block request stored"}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* Quorum Panel */}
      <QuorumPanel chainContext={chainContext} p2pNode={p2pNode} locale={locale} />
    </div>
  );
}

