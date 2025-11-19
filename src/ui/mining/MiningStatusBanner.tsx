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
          label = isZh ? "当前无法挖矿" : "Mining Blocked";
          color = "#dc3545";
          
          // Phase 45: First year mode: requiredQuorumScore is 40 (or <= 50 for compatibility)
          const isFirstYearModeBlocked = result.details?.requiredQuorumScore !== undefined && result.details.requiredQuorumScore <= 50;
          if (isFirstYearModeBlocked && result.reason) {
            // Remove "First year: " prefix for cleaner display
            summary = result.reason.replace(/^First year: /i, "");
          } else {
            summary = result.reason || (isZh ? "挖矿被阻止" : "Mining is blocked");
          }
          reason = result.reason;
        }

        setStatus({
          state,
          icon,
          label,
          color,
          summary,
          canMine: result.ok && !isSyncing,
          reason,
        });
      } catch (error) {
        console.error("[MiningStatusBanner] Failed to update status:", error);
        setStatus({
          state: "BLOCKED",
          icon: "⛔",
          label: isZh ? "状态检查失败" : "Status Check Failed",
          color: "#dc3545",
          summary: isZh ? "无法检查挖矿状态" : "Cannot check mining status",
          canMine: false,
        });
      } finally {
        setLoading(false);
      }
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [chainContext, p2pNode, finalityManager, localRole, bootstrapComplete, nodeAddress, isZh]);

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
                if (status.canMine) {
                  onStartMining();
                } else {
                  onViewDetails();
                }
              }}
              disabled={!status.canMine}
              style={{
                padding: "0.75rem 1.5rem",
                fontSize: "1rem",
                fontWeight: "bold",
                color: "white",
                background: status.canMine ? "#28a745" : "#6c757d",
                border: "none",
                borderRadius: "6px",
                cursor: status.canMine ? "pointer" : "not-allowed",
                opacity: status.canMine ? 1 : 0.6,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (status.canMine) {
                  e.currentTarget.style.background = "#218838";
                }
              }}
              onMouseLeave={(e) => {
                if (status.canMine) {
                  e.currentTarget.style.background = "#28a745";
                }
              }}
              title={!status.canMine ? (isZh ? "点击查看详情：网络健康与挖矿诊断" : "Click to view details: Network Health & Mining Diagnostics") : undefined}
            >
              {isZh ? "开始挖矿" : "Start Mining"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

