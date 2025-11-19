/**
 * Phase 39: Mining Status Banner
 * 
 * Top-level mining status display for Overview tab
 * Shows: Ready/Syncing/Blocked status with main action button
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { MiningGuard } from "../../core/miningGuard.js";
import { getQuorumManager } from "../../core/quorumManager.js";
import { useI18n } from "../../i18n/useI18n.js";

interface MiningStatusBannerProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  finalityManager: any;
  localRole: "LEADER" | "FOLLOWER";
  bootstrapComplete: boolean;
  nodeAddress: string | null;
  isMining: boolean;
  onStartMining: () => void;
  onStopMining: () => void;
  onViewDetails: () => void;
  locale: string;
  autoMining?: boolean; // Auto-mining status
}

export function MiningStatusBanner({
  chainContext,
  p2pNode,
  finalityManager,
  localRole,
  bootstrapComplete,
  nodeAddress,
  isMining,
  onStartMining,
  onStopMining,
  onViewDetails,
  locale,
  autoMining = false,
}: MiningStatusBannerProps) {
  const [status, setStatus] = useState<{
    state: "READY" | "SYNCING" | "BLOCKED";
    icon: string;
    label: string;
    color: string;
    summary: string;
    canMine: boolean;
    reason?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useI18n();

  const isZh = locale === "zh";

  useEffect(() => {
    if (!chainContext || !p2pNode) {
      setStatus(null);
      setLoading(false);
      return;
    }

    const updateStatus = async () => {
      try {
        const result = await MiningGuard.canMineNow(
          chainContext,
          p2pNode,
          finalityManager,
          localRole,
          nodeAddress || undefined,
          bootstrapComplete
        );

        // Get quorum status for summary
        const quorumManager = getQuorumManager();
        quorumManager.initialize(p2pNode, chainContext);
        const quorumStatus = quorumManager.getQuorumStatus();
        const admissionStatus = quorumManager.getMainnetAdmissionStatus();
        const networkStage = quorumManager.getNetworkStage();
        const isGenesis = quorumManager.isGenesisPhase();

        // Check if syncing
        const localTip = chainContext.storage.getTip();
        const localHeight = localTip?.header.height ?? 0;
        const rootTipHeight = (typeof window !== "undefined" && (window as any).lastRootTipHeight) || 0;
        const isSyncing = rootTipHeight > 0 && localHeight < rootTipHeight - 1;

        let state: "READY" | "SYNCING" | "BLOCKED";
        let icon: string;
        let label: string;
        let color: string;
        let summary: string;
        let reason: string | undefined;

        if (isSyncing && !result.ok) {
          state = "SYNCING";
          icon = "⏳";
          label = isZh ? "正在同步..." : "Syncing...";
          color = "#ffc107";
          summary = isZh
            ? `同步中：本地高度 ${localHeight}，目标高度 ${rootTipHeight}`
            : `Syncing: Local height ${localHeight}, target ${rootTipHeight}`;
        } else if (result.ok) {
          state = "READY";
          icon = "✅";
          label = isZh ? "已准备好，可以开始挖矿" : "Ready to Mine";
          color = "#28a745";
          
          // Phase 45: First year mode: requiredQuorumScore is 40 (or <= 50 for compatibility)
          const isFirstYearMode = result.details?.requiredQuorumScore !== undefined && result.details.requiredQuorumScore <= 50;
          
          // Build summary
          const stageLabels: Record<string, string> = {
            coldStart: isZh ? "冷启动" : "Cold Start",
            earlyGrowth: isZh ? "早期增长" : "Early Growth",
            mature: isZh ? "成熟阶段" : "Mature",
            secure: isZh ? "安全阶段" : "Secure",
          };
          const stageLabel = stageLabels[networkStage] || networkStage;
          
          if (isFirstYearMode) {
            const independentPeers = result.details?.independentPeerCount || 0;
            const quorumScore = result.details?.quorumScore || 0;
            const requiredQuorumScore = result.details?.requiredQuorumScore || 40; // Phase 45: First year mode default is 40
            const modeLabel = result.mode === "SAFE" ? (isZh ? "安全模式" : "SAFE") : (isZh ? "保护模式" : "GUARDED");
            summary = isZh
              ? `第一年模式 · ${modeLabel} · ${independentPeers} 个独立节点 · Quorum ${quorumScore}/${requiredQuorumScore}`
              : `First Year Mode · ${modeLabel} · ${independentPeers} independent peers · Quorum ${quorumScore}/${requiredQuorumScore}`;
          } else if (isGenesis) {
            summary = isZh
              ? `创世阶段 · ${quorumStatus.independentPeerCount} 个独立节点 · Quorum ${quorumStatus.totalScore}/100`
              : `Genesis · ${quorumStatus.independentPeerCount} independent peers · Quorum ${quorumStatus.totalScore}/100`;
          } else {
            summary = isZh
              ? `${stageLabel} · ${quorumStatus.independentPeerCount} 个独立节点 · Quorum ${quorumStatus.totalScore}/${admissionStatus.requiredQuorumScore}`
              : `${stageLabel} · ${quorumStatus.independentPeerCount} independent peers · Quorum ${quorumStatus.totalScore}/${admissionStatus.requiredQuorumScore}`;
          }
        } else {
          state = "BLOCKED";
          icon = "⛔";
          label = t("miningStatusBanner.miningBlocked");
          color = "#dc3545";
          
          // Phase 45: First year mode: requiredQuorumScore is 40 (or <= 50 for compatibility)
          const isFirstYearModeBlocked = result.details?.requiredQuorumScore !== undefined && result.details.requiredQuorumScore <= 50;
          if (isFirstYearModeBlocked && result.reason) {
            // Translate first year rule messages
            let translatedReason = result.reason;
            
            // Check for "首年规则：需要至少 X 个独立 IP 对等节点，目前只有 Y 个"
            const peerMatch = result.reason.match(/首年规则：需要至少 (\d+) 个独立 IP 对等节点，目前只有 (\d+) 个/);
            if (peerMatch) {
              translatedReason = t("miningGuard.firstYearRuleInsufficientPeers", {
                required: peerMatch[1],
                current: peerMatch[2],
              });
            } else {
              // Check for "首年规则：{reasons}"
              const multipleReasonsMatch = result.reason.match(/首年规则：(.+)/);
              if (multipleReasonsMatch) {
                const reasons = multipleReasonsMatch[1];
                // Translate individual reasons
                let translatedReasons = reasons;
                
                // Translate "需要 ≥X 个独立对等节点（当前: Y）"
                translatedReasons = translatedReasons.replace(/需要 ≥(\d+) 个独立对等节点（当前: (\d+)）/g, (_, required, current) => {
                  return t("miningGuard.needAtLeastIndependentPeers", { required, current });
                });
                
                // Translate "Quorum 分数 X < 要求 Y"
                translatedReasons = translatedReasons.replace(/Quorum 分数 (\d+) < 要求 (\d+)/g, (_, current, required) => {
                  return t("miningGuard.quorumScoreInsufficient", { current, required });
                });
                
                // Translate "Bootstrap 未完成"
                if (translatedReasons.includes("Bootstrap 未完成")) {
                  translatedReasons = translatedReasons.replace("Bootstrap 未完成", t("miningGuard.bootstrapIncomplete"));
                }
                
                // Translate "检测到严重状态漂移"
                if (translatedReasons.includes("检测到严重状态漂移")) {
                  translatedReasons = translatedReasons.replace("检测到严重状态漂移", t("miningGuard.criticalStateDrift"));
                }
                
                translatedReason = t("miningGuard.firstYearRuleMultipleReasons", { reasons: translatedReasons });
              } else {
                // Remove "First year: " or "首年规则：" prefix for cleaner display
                translatedReason = result.reason.replace(/^(First year: |首年规则：)/i, "");
              }
            }
            
            summary = translatedReason;
          } else {
            summary = result.reason || t("miningStatusBanner.miningIsBlocked");
          }
          reason = result.reason;
        }

        setStatus({
          state,
          icon,
          label,
          color,
          summary,
          canMine: result.ok && !isSyncing && !autoMining, // Disable if auto-mining is enabled
          reason,
        });
      } catch (error) {
        console.error("[MiningStatusBanner] Failed to update status:", error);
        setStatus({
          state: "BLOCKED",
          icon: "⛔",
          label: t("miningStatusBanner.statusCheckFailed"),
          color: "#dc3545",
          summary: t("miningStatusBanner.cannotCheckStatus"),
          canMine: false,
        });
      } finally {
        setLoading(false);
      }
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [chainContext, p2pNode, finalityManager, localRole, bootstrapComplete, nodeAddress, isZh, autoMining]);

  if (loading || !status) {
    return (
      <div
        className="status-card"
        style={{
          marginBottom: "1.5rem",
          background: "rgba(108, 117, 125, 0.1)",
          border: "2px solid #6c757d",
        }}
      >
        <div style={{ padding: "1rem", textAlign: "center", color: "#666" }}>
          {isZh ? "加载中..." : "Loading..."}
        </div>
      </div>
    );
  }

  return (
    <div
      className="status-card"
      style={{
        marginBottom: "1.5rem",
        background: status.state === "READY" 
          ? "rgba(40, 167, 69, 0.1)" 
          : status.state === "SYNCING"
          ? "rgba(255, 193, 7, 0.1)"
          : "rgba(220, 53, 69, 0.1)",
        border: `2px solid ${status.color}`,
        cursor: status.canMine ? "default" : "pointer",
      }}
      onClick={!status.canMine ? onViewDetails : undefined}
      title={!status.canMine ? (isZh ? "点击查看详情" : "Click to view details") : undefined}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        {/* Status Icon and Label */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flex: 1 }}>
          <div style={{ fontSize: "2.5rem" }}>{status.icon}</div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: "1.3rem",
                fontWeight: "bold",
                color: status.color,
                marginBottom: "0.25rem",
              }}
            >
              {status.label}
            </div>
            <div style={{ fontSize: "0.9rem", color: "#666" }}>
              {status.summary}
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div>
          {isMining ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStopMining();
              }}
              style={{
                padding: "0.75rem 1.5rem",
                fontSize: "1rem",
                fontWeight: "bold",
                color: "white",
                background: "#dc3545",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#c82333";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#dc3545";
              }}
            >
              {isZh ? "停止挖矿" : "Stop Mining"}
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (status.canMine && !autoMining) {
                  onStartMining();
                } else if (autoMining) {
                  // Show message if auto-mining is enabled
                  alert(isZh ? "自动挖矿已启用，系统会在链准备就绪时自动开始挖矿。" : "Auto mining is enabled. The system will automatically start mining when the chain is ready.");
                } else {
                  onViewDetails();
                }
              }}
              disabled={!status.canMine || autoMining}
              style={{
                padding: "0.75rem 1.5rem",
                fontSize: "1rem",
                fontWeight: "bold",
                color: "white",
                background: (status.canMine && !autoMining) ? "#28a745" : "#6c757d",
                border: "none",
                borderRadius: "6px",
                cursor: (status.canMine && !autoMining) ? "pointer" : "not-allowed",
                opacity: (status.canMine && !autoMining) ? 1 : 0.6,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (status.canMine && !autoMining) {
                  e.currentTarget.style.background = "#218838";
                }
              }}
              onMouseLeave={(e) => {
                if (status.canMine && !autoMining) {
                  e.currentTarget.style.background = "#28a745";
                }
              }}
              title={autoMining 
                ? (isZh ? "自动挖矿已启用，系统会自动开始挖矿" : "Auto mining is enabled, the system will automatically start mining")
                : (!status.canMine ? (isZh ? "点击查看详情：网络健康与挖矿诊断" : "Click to view details: Network Health & Mining Diagnostics") : undefined)}
            >
              {isZh ? "开始挖矿" : "Start Mining"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

