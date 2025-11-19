/**
 * Phase 38: Mining Main Card - Top-level mining control
 * 
 * Simple, clear interface for starting/stopping mining
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { MiningGuard } from "../../core/miningGuard.js";
import { useI18n } from "../../i18n/useI18n.js";

interface MiningMainCardProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  finalityManager: any;
  localRole: "LEADER" | "FOLLOWER";
  bootstrapComplete: boolean;
  nodeAddress: string | null;
  isMining: boolean;
  clusterMining: boolean;
  miningMode: "solo" | "cluster" | "global-pool";
  onStartMining: () => void;
  onStopMining: () => void;
  locale: string;
  // Phase 42: Referral system props
  pendingInviteAddress?: string | null;
  currentReferrerAddress?: string | null;
  onInviteCodeSubmit?: (code: string) => void;
}

export function MiningMainCard({
  chainContext,
  p2pNode,
  finalityManager,
  localRole,
  bootstrapComplete,
  nodeAddress,
  isMining,
  clusterMining,
  miningMode,
  onStartMining,
  onStopMining,
  locale,
  pendingInviteAddress,
  currentReferrerAddress,
  onInviteCodeSubmit,
}: MiningMainCardProps) {
  const [miningGuardResult, setMiningGuardResult] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [tooltip, setTooltip] = useState<string>("");
  const [inviteCodeInput, setInviteCodeInput] = useState<string>("");
  const { t } = useI18n();

  const isZh = locale === "zh";

  // Check mining readiness
  const checkMiningReadiness = async () => {
    if (!chainContext || !p2pNode) {
      setMiningGuardResult(null);
      setLoading(false);
      return;
    }

    try {
      const result = await MiningGuard.canMineNow(
        chainContext,
        p2pNode,
        finalityManager,
        localRole,
        nodeAddress || undefined,
        bootstrapComplete
      );
      setMiningGuardResult(result);
      
      // Set tooltip for disabled state
      const reasons = [];
      
      // Check if Quorum score is insufficient (even if result.ok is true)
      // First year: QuorumScore is only informational, not blocking
      if (result.details) {
        const quorumScore = result.details.quorumScore ?? 0;
        const requiredQuorumScore = result.details.requiredQuorumScore ?? 80;
        const isGenesisMode = result.details.networkStage === "GENESIS_QUORUM";
        // First year: requiredQuorumScore === 0 indicates first year mode
        const isFirstYearMode = requiredQuorumScore === 0;
        const independentPeerCount = result.details.independentPeerCount ?? 0;
        
        // First year: Show score as info only, don't block
        if (isFirstYearMode) {
          // First year: Score is informational only
          if (quorumScore < 50) {
            reasons.push(
              isZh
                ? `Quorum分数: ${quorumScore}（弱连接，但仍可挖矿）`
                : `Quorum Score: ${quorumScore} (weak connection, but mining allowed)`
            );
          } else if (quorumScore < 80) {
            reasons.push(
              isZh
                ? `Quorum分数: ${quorumScore}（连接正常）`
                : `Quorum Score: ${quorumScore} (connection normal)`
            );
          } else {
            reasons.push(
              isZh
                ? `Quorum分数: ${quorumScore}（网络健康，多人在线）`
                : `Quorum Score: ${quorumScore} (network healthy, multiple peers online)`
            );
          }
        } else if (quorumScore < requiredQuorumScore && !(isGenesisMode && independentPeerCount >= 2)) {
          // Normal mode: Block if score insufficient
          reasons.push(
            isZh
              ? `Quorum分数不足: ${quorumScore} / ${requiredQuorumScore}（需要至少 ${requiredQuorumScore} 分才能挖矿）`
              : `Insufficient Quorum Score: ${quorumScore} / ${requiredQuorumScore} (need at least ${requiredQuorumScore} to mine)`
          );
        }
      }
      
      if (!result.ok) {
        if (result.reason) reasons.push(result.reason);
        if (result.details) {
          if (result.details.independentPeerCount !== undefined) {
            reasons.push(
              isZh
                ? `独立节点: ${result.details.independentPeerCount} / ${result.details.requiredIndependentPeers || 1}`
                : `Independent Peers: ${result.details.independentPeerCount} / ${result.details.requiredIndependentPeers || 1}`
            );
          }
        }
      }
      
      setTooltip(reasons.length > 0 ? reasons.join("; ") : "");
    } catch (error) {
      console.error("[MiningMainCard] Failed to check mining readiness:", error);
      setMiningGuardResult({
        ok: false,
        reason: isZh ? "检查挖矿状态时出错" : "Error checking mining status",
      });
    } finally {
      setLoading(false);
    }
  };

  // Check readiness on mount and when dependencies change
  useEffect(() => {
    checkMiningReadiness();
    const interval = setInterval(checkMiningReadiness, 5000);
    return () => clearInterval(interval);
  }, [chainContext, p2pNode, finalityManager, localRole, bootstrapComplete, nodeAddress]);

  // Get status color and label
  const getStatus = () => {
    if (loading) {
      return {
        color: "#666",
        label: isZh ? "检查中..." : "Checking...",
        icon: "⏳",
      };
    }

    if (isMining || clusterMining) {
      return {
        color: "#28a745",
        label: isZh ? "正在挖矿" : "Mining",
        icon: "⛏️",
      };
    }

    if (!miningGuardResult) {
      return {
        color: "#666",
        label: isZh ? "未就绪" : "Not Ready",
        icon: "⚪",
      };
    }

    if (miningGuardResult.ok) {
      const mode = miningGuardResult.mode || "SAFE";
      if (mode === "SAFE") {
        return {
          color: "#28a745",
          label: isZh ? "就绪，可以挖矿" : "Ready to Mine",
          icon: "✅",
        };
      } else if (mode === "GUARDED") {
        return {
          color: "#ffc107",
          label: isZh ? "受限模式（可挖矿）" : "Limited / Degraded",
          icon: "⚠️",
        };
      } else {
        return {
          color: "#17a2b8",
          label: isZh ? "本地模式" : "Local Mode",
          icon: "🔵",
        };
      }
    } else {
      return {
        color: "#dc3545",
        label: isZh ? "未就绪" : "Not Ready",
        icon: "❌",
      };
    }
  };

  const status = getStatus();
  
  // Check if Quorum score is sufficient for mining
  // Even if canMineNow returns ok: true (e.g., in Genesis mode), we should still check Quorum
  const quorumScore = miningGuardResult?.details?.quorumScore ?? 0;
  const requiredQuorumScore = miningGuardResult?.details?.requiredQuorumScore ?? 80;
  const hasSufficientQuorum = quorumScore >= requiredQuorumScore;
  
  // First year: QuorumScore is only informational, not blocking
  // First year: requiredQuorumScore === 0 indicates first year mode
  const isFirstYearMode = requiredQuorumScore === 0;
  const isGenesisMode = miningGuardResult?.details?.networkStage === "GENESIS_QUORUM";
  const hasGenesisPeers = (miningGuardResult?.details?.independentPeerCount ?? 0) >= 2;
  
  // Only allow mining if:
  // 1. MiningGuard says it's ok AND
  // 2. Quorum score is sufficient (unless in First Year mode, Genesis mode with ≥2 independent peers)
  const canMine = miningGuardResult?.ok && 
                  !isMining && 
                  !clusterMining && 
                  (isFirstYearMode || hasSufficientQuorum || (isGenesisMode && hasGenesisPeers));
  
  const isFollowerBlocked = localRole === "FOLLOWER" && chainContext?.params?.networkId === "IXC_MAINNET_V1";

  // Get button label
  const getButtonLabel = () => {
    if (isMining || clusterMining) {
      if (clusterMining) {
        return isZh ? "停止集群挖矿" : "Stop Cluster Mining";
      }
      return isZh ? "停止挖矿" : "Stop Mining";
    }

    if (isFollowerBlocked) {
      return isZh ? "仅 LEADER 可挖矿" : "LEADER Only";
    }

    if (miningMode === "cluster") {
      return isZh ? "开始集群挖矿" : "Start Mining (Cluster)";
    } else if (miningMode === "global-pool") {
      return isZh ? "开始挖矿（全局矿池）" : "Start Mining (Global Pool)";
    } else {
      return isZh ? "开始挖矿" : "Start Mining (Solo)";
    }
  };

  const handleButtonClick = () => {
    console.log("[MiningMainCard] Button clicked", {
      isMining,
      clusterMining,
      canMine,
      isFollowerBlocked,
      miningGuardResult: miningGuardResult?.ok,
      quorumScore: miningGuardResult?.details?.quorumScore,
      requiredQuorumScore: miningGuardResult?.details?.requiredQuorumScore,
    });
    
    if (isMining || clusterMining) {
      onStopMining();
    } else if (canMine && !isFollowerBlocked) {
      onStartMining();
    } else {
      // Show feedback when button is clicked but mining cannot start
      if (!canMine) {
        console.warn("[MiningMainCard] Cannot start mining:", {
          reason: miningGuardResult?.reason,
          quorumScore: miningGuardResult?.details?.quorumScore,
          requiredQuorumScore: miningGuardResult?.details?.requiredQuorumScore,
          tooltip,
        });
        // Optionally show an alert or toast message
        if (tooltip) {
          alert(tooltip);
        }
      } else if (isFollowerBlocked) {
        alert(isZh ? "此实例是 FOLLOWER，只有 LEADER 实例可以在主网挖矿。" : "This instance is a FOLLOWER. Only the LEADER instance can mine on mainnet.");
      }
    }
  };

  return (
    <div
      className="status-card"
      style={{
        marginBottom: "1.5rem",
        background: status.color === "#28a745" 
          ? "rgba(40, 167, 69, 0.1)" 
          : status.color === "#ffc107"
          ? "rgba(255, 193, 7, 0.1)"
          : status.color === "#dc3545"
          ? "rgba(220, 53, 69, 0.1)"
          : "rgba(108, 117, 125, 0.1)",
        border: `2px solid ${status.color}`,
      }}
    >
      <h2 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.3rem" }}>
        {isZh ? "⛏️ 挖矿状态" : "⛏️ Mining Status"}
      </h2>

      {/* Status Indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          marginBottom: "1.5rem",
          padding: "1rem",
          background: "white",
          borderRadius: "8px",
        }}
      >
        <div style={{ fontSize: "3rem" }}>{status.icon}</div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: "bold",
              color: status.color,
            }}
          >
            {status.label}
          </div>
          {miningGuardResult && !miningGuardResult.ok && miningGuardResult.reason && (
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: "0.9rem",
                color: "#666",
              }}
            >
              {miningGuardResult.reason}
            </div>
          )}
        </div>
      </div>

      {/* Main Action Button */}
      <div style={{ position: "relative" }}>
        {/* Current Mining Mode Display (when mining) */}
        {(isMining || clusterMining) && (
          <div
            style={{
              marginBottom: "0.75rem",
              padding: "0.75rem 1rem",
              background: "rgba(255, 255, 255, 0.9)",
              borderRadius: "6px",
              border: "1px solid #e0e0e0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.2rem" }}>⛏️</span>
              <div>
                <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>
                  {t("mining.currentMiningMode")}
                </div>
                <div style={{ fontSize: "1rem", fontWeight: "bold", color: "#333" }}>
                  {miningMode === "solo"
                    ? t("mining.soloMining")
                    : miningMode === "cluster"
                    ? t("mining.localClusterMining")
                    : t("mining.globalPoolMining")}
                </div>
              </div>
            </div>
            <div
              style={{
                padding: "0.25rem 0.75rem",
                background: status.color,
                color: "white",
                borderRadius: "12px",
                fontSize: "0.75rem",
                fontWeight: "bold",
              }}
            >
              {status.label}
            </div>
          </div>
        )}
        
        <button
          onClick={handleButtonClick}
          // Don't disable the button - allow click to show feedback
          style={{
            width: "100%",
            padding: "1rem 2rem",
            fontSize: "1.1rem",
            fontWeight: "bold",
            borderRadius: "8px",
            border: "none",
            background: canMine || isMining || clusterMining
              ? status.color
              : "#6c757d",
            color: "white",
            cursor: "pointer",
            transition: "all 0.2s",
            opacity: canMine || isMining || clusterMining || isFollowerBlocked ? 1 : 0.7,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
          }}
          onMouseEnter={(e) => {
            if (!canMine && !isMining && !clusterMining && !isFollowerBlocked) {
              e.currentTarget.style.opacity = "0.9";
            }
          }}
          onMouseLeave={(e) => {
            if (!canMine && !isMining && !clusterMining && !isFollowerBlocked) {
              e.currentTarget.style.opacity = "0.7";
            }
          }}
          title={tooltip || undefined}
        >
          {isMining || clusterMining ? (
            <>
              <span>⏹️</span>
              {getButtonLabel()}
            </>
          ) : (
            <>
              <span>▶️</span>
              {getButtonLabel()}
            </>
          )}
        </button>
      </div>

      {/* Quick Status Hint */}
      {miningGuardResult && !miningGuardResult.ok && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "#fff3cd",
            borderRadius: "6px",
            border: "1px solid #ffc107",
            fontSize: "0.85rem",
            color: "#856404",
          }}
        >
          {miningGuardResult.reason || (isZh ? "无法开始挖矿" : "Cannot start mining")}
          {miningGuardResult.details && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
              {miningGuardResult.details.quorumScore !== undefined && (
                <div>
                  {isZh ? "Quorum分数" : "Quorum Score"}: {miningGuardResult.details.quorumScore} / {miningGuardResult.details.requiredQuorumScore || 80}
                </div>
              )}
              {miningGuardResult.details.independentPeerCount !== undefined && (
                <div>
                  {isZh ? "独立节点" : "Independent Peers"}: {miningGuardResult.details.independentPeerCount} / {miningGuardResult.details.requiredIndependentPeers || 1}
                  {miningGuardResult.details.independentPeerCount < (miningGuardResult.details.requiredIndependentPeers || 1) && (
                    <div style={{ fontSize: "0.7rem", color: "#856404", marginTop: "0.25rem", fontStyle: "italic" }}>
                      {isZh 
                        ? "💡 需要来自不同 IP 的节点（同一电脑的多个标签页不算）"
                        : "💡 Need peers from different IPs (multiple tabs on same computer don't count)"}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Follower Mode Warning */}
      {isFollowerBlocked && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "#d1ecf1",
            borderRadius: "6px",
            border: "1px solid #17a2b8",
            fontSize: "0.85rem",
            color: "#0c5460",
          }}
        >
          {isZh
            ? "⚠️ 此标签页是 FOLLOWER。只有本机的 LEADER 标签页可以在主网挖矿。"
            : "⚠️ This tab is FOLLOWER. Only the LEADER tab on this machine can mine on mainnet."}
        </div>
      )}

      {/* Phase 42: Referral Invite Code Input */}
      {!currentReferrerAddress && (
        <div
          style={{
            marginTop: "1rem",
            padding: "1rem",
            background: "rgba(102, 126, 234, 0.1)",
            borderRadius: "6px",
            border: "1px solid #667eea",
          }}
        >
          <div style={{ fontSize: "0.9rem", fontWeight: "bold", marginBottom: "0.75rem", color: "#667eea" }}>
            {isZh ? "🎯 邀请码绑定" : "🎯 Referral Code"}
          </div>
          
          {pendingInviteAddress ? (
            <div style={{ fontSize: "0.85rem", color: "#28a745" }}>
              {isZh 
                ? `✅ 待绑定邀请地址: ${pendingInviteAddress.substring(0, 16)}... (挖矿时自动绑定)`
                : `✅ Pending invite address: ${pendingInviteAddress.substring(0, 16)}... (will bind when mining starts)`}
            </div>
          ) : (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
              <input
                type="text"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
                placeholder={isZh ? "输入邀请码或邀请地址" : "Enter invite code or address"}
                style={{
                  flex: 1,
                  padding: "0.6rem",
                  fontSize: "0.85rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontFamily: "monospace",
                }}
              />
              <button
                onClick={() => {
                  if (inviteCodeInput.trim() && onInviteCodeSubmit) {
                    onInviteCodeSubmit(inviteCodeInput.trim());
                    setInviteCodeInput("");
                  }
                }}
                disabled={!inviteCodeInput.trim()}
                style={{
                  padding: "0.6rem 1rem",
                  fontSize: "0.85rem",
                  background: inviteCodeInput.trim() ? "#667eea" : "#ccc",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: inviteCodeInput.trim() ? "pointer" : "not-allowed",
                  whiteSpace: "nowrap",
                }}
              >
                {isZh ? "绑定" : "Bind"}
              </button>
            </div>
          )}
          
          <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#666", fontStyle: "italic" }}>
            {isZh
              ? "💡 绑定邀请地址后，邀请人将获得你挖矿奖励的20%作为推荐奖励"
              : "💡 After binding, your inviter will receive 20% of your mining rewards as referral bonus"}
          </div>
        </div>
      )}

      {/* Current Referrer Display */}
      {currentReferrerAddress && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "rgba(40, 167, 69, 0.1)",
            borderRadius: "6px",
            border: "1px solid #28a745",
            fontSize: "0.85rem",
            color: "#155724",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "0.25rem" }}>
            {isZh ? "✅ 已绑定邀请地址" : "✅ Referral Address Bound"}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
            {currentReferrerAddress.substring(0, 20)}...
          </div>
        </div>
      )}
    </div>
  );
}

