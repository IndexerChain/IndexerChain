/**
 * Phase 30: Global Consistency Sentinel Panel
 * 
 * Displays local node's consistency status with network majority.
 * Shows drift assessment and provides recovery options.
 */

import React from "react";
import type { DriftAssessment } from "../core/types.js";
import { useI18n } from "../i18n/useI18n.js";

interface GlobalSentinelPanelProps {
  assessment: DriftAssessment | null;
  onReassess?: () => void;
  onSyncFromSnapshot?: () => void;
  onStopMining?: () => void;
  locale?: string;
}

export const GlobalSentinelPanel: React.FC<GlobalSentinelPanelProps> = ({
  assessment,
  onReassess,
  onSyncFromSnapshot,
  onStopMining,
  locale: _locale,
}) => {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  if (!assessment) {
    return (
      <div className="status-card">
        <h2>{isZh ? "🌐 全网一致性哨兵" : "🌐 Global Consistency Sentinel"}</h2>
        <p style={{ color: "#666" }}>
          {isZh 
            ? "正在收集网络视图信息..." 
            : "Collecting network view information..."}
        </p>
      </div>
    );
  }

  const getHealthColor = (level: string) => {
    switch (level) {
      case "HEALTHY":
        return "#28a745";
      case "MINOR_DRIFT":
        return "#ffc107";
      case "CRITICAL_DRIFT":
        return "#dc3545";
      default:
        return "#666";
    }
  };

  const getHealthIcon = (level: string) => {
    switch (level) {
      case "HEALTHY":
        return "✅";
      case "MINOR_DRIFT":
        return "⚠️";
      case "CRITICAL_DRIFT":
        return "🔴";
      default:
        return "❓";
    }
  };

  return (
    <div className="status-card">
      <h2>{isZh ? "🌐 全网一致性哨兵" : "🌐 Global Consistency Sentinel"}</h2>
      
      {/* Health Status */}
      <div style={{ 
        marginBottom: "1.5rem",
        padding: "1rem",
        borderRadius: "6px",
        background: assessment.healthLevel === "HEALTHY" 
          ? "#d4edda" 
          : assessment.healthLevel === "MINOR_DRIFT"
          ? "#fff3cd"
          : "#f8d7da",
        border: `2px solid ${getHealthColor(assessment.healthLevel)}`
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "1.5rem" }}>{getHealthIcon(assessment.healthLevel)}</span>
          <strong style={{ fontSize: "1.2rem", color: getHealthColor(assessment.healthLevel) }}>
            {assessment.healthLevel === "HEALTHY" 
              ? (isZh ? "健康" : "HEALTHY")
              : assessment.healthLevel === "MINOR_DRIFT"
              ? (isZh ? "轻微漂移" : "MINOR_DRIFT")
              : (isZh ? "严重漂移" : "CRITICAL_DRIFT")}
          </strong>
        </div>
        <p style={{ margin: 0, fontSize: "0.95rem" }}>
          {assessment.reason?.includes("Not enough peers for assessment") && assessment.minPeersRequired
            ? (isZh 
                ? `评估节点数不足（${assessment.peerCount} < ${assessment.minPeersRequired}）`
                : `Not enough peers for assessment (${assessment.peerCount} < ${assessment.minPeersRequired})`)
            : assessment.reason}
        </p>
      </div>

      {/* Local View */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ marginBottom: "0.75rem" }}>
          {isZh ? "📊 本地视图" : "📊 Local View"}
        </h3>
        <div style={{ 
          background: "#f8f9fa", 
          padding: "1rem", 
          borderRadius: "6px",
          display: "grid",
          gap: "0.5rem"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{isZh ? "高度:" : "Height:"}</span>
            <strong>{assessment.localHeight}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{isZh ? "Tip Hash:" : "Tip Hash:"}</span>
            <code style={{ fontSize: "0.85rem" }}>
              {assessment.localTipHash.substring(0, 16)}...
            </code>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{isZh ? "已最终确认高度:" : "Finalized Height:"}</span>
            <strong>{assessment.localFinalizedHeight}</strong>
          </div>
          {assessment.localTipHash && assessment.localTipHash.length > 40 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{isZh ? "状态承诺:" : "State Commitment:"}</span>
              <code style={{ fontSize: "0.85rem" }}>
                {assessment.localTipHash.substring(0, 16)}...
              </code>
            </div>
          )}
        </div>
      </div>

      {/* Network Majority View */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ marginBottom: "0.75rem" }}>
          {isZh ? "🌍 网络多数视图" : "🌍 Network Majority View"}
        </h3>
        <div style={{ 
          background: "#e7f3ff", 
          padding: "1rem", 
          borderRadius: "6px",
          display: "grid",
          gap: "0.5rem"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{isZh ? "多数高度:" : "Majority Height:"}</span>
            <strong>{assessment.majorityHeight}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{isZh ? "多数 Tip Hash:" : "Majority Tip Hash:"}</span>
            <code style={{ fontSize: "0.85rem" }}>
              {assessment.majorityTipHash.substring(0, 16)}...
            </code>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{isZh ? "多数已最终确认高度:" : "Majority Finalized Height:"}</span>
            <strong>{assessment.majorityFinalizedHeight}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{isZh ? "有效对等节点数:" : "Effective Peer Count:"}</span>
            <strong>{assessment.peerCount}</strong>
          </div>
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between",
            paddingTop: "0.5rem",
            borderTop: "1px solid #b3d9ff",
            marginTop: "0.5rem"
          }}>
            <span>{isZh ? "漂移区块数:" : "Drift Blocks:"}</span>
            <strong style={{ 
              color: Math.abs(assessment.driftBlocks) > 10 ? "#dc3545" : "#666"
            }}>
              {assessment.driftBlocks > 0 ? "+" : ""}{assessment.driftBlocks}
            </strong>
          </div>
          {assessment.forkSuspected && (
            <div style={{ 
              padding: "0.75rem",
              background: "#f8d7da",
              borderRadius: "4px",
              marginTop: "0.5rem",
              border: "1px solid #f5c6cb"
            }}>
              <strong style={{ color: "#721c24" }}>
                ⚠️ {isZh ? "检测到分叉" : "Fork Detected"}
              </strong>
              <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem", color: "#721c24" }}>
                {isZh 
                  ? "本地 tip hash 与网络多数不一致，可能处于少数分叉上。" 
                  : "Local tip hash differs from network majority, may be on a minority fork."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {onReassess && (
          <button
            className="btn btn-secondary"
            onClick={onReassess}
            style={{
              backgroundColor: "#17a2b8",
              color: "white",
              border: "none",
              padding: "0.75rem 1.5rem",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            {isZh ? "🔄 重新评估" : "🔄 Re-assess Now"}
          </button>
        )}

        {assessment.healthLevel === "CRITICAL_DRIFT" && (
          <>
            {onSyncFromSnapshot && (
              <button
                className="btn btn-secondary"
                onClick={onSyncFromSnapshot}
                style={{
                  backgroundColor: "#28a745",
                  color: "white",
                  border: "none",
                  padding: "0.75rem 1.5rem",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "bold"
                }}
              >
                {isZh ? "📥 从快照同步" : "📥 Sync from Trusted Snapshot"}
              </button>
            )}
            {onStopMining && (
              <button
                className="btn btn-secondary"
                onClick={onStopMining}
                style={{
                  backgroundColor: "#dc3545",
                  color: "white",
                  border: "none",
                  padding: "0.75rem 1.5rem",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "bold"
                }}
              >
                {isZh ? "⏹️ 停止挖矿" : "⏹️ Stop Mining"}
              </button>
            )}
          </>
        )}
      </div>

      {/* Recommendations */}
      {assessment.healthLevel === "CRITICAL_DRIFT" && (
        <div style={{ 
          marginTop: "1.5rem",
          padding: "1rem",
          background: "#fff3cd",
          borderRadius: "6px",
          border: "1px solid #ffc107"
        }}>
          <strong style={{ color: "#856404" }}>
            💡 {isZh ? "建议操作" : "Recommended Actions"}
          </strong>
          <ul style={{ margin: "0.5rem 0 0 0", paddingLeft: "1.5rem", color: "#856404" }}>
            {assessment.forkSuspected && (
              <li>
                {isZh 
                  ? "检测到分叉：建议停止挖矿，避免在少数分叉上浪费算力" 
                  : "Fork detected: Stop mining to avoid wasting resources on minority fork"}
              </li>
            )}
            {Math.abs(assessment.driftBlocks) > 10 && (
              <li>
                {isZh 
                  ? `落后 ${Math.abs(assessment.driftBlocks)} 个区块：建议从远程快照同步以快速追赶` 
                  : `${Math.abs(assessment.driftBlocks)} blocks behind: Consider syncing from remote snapshot to catch up quickly`}
              </li>
            )}
            {assessment.minPeersRequired && assessment.peerCount < assessment.minPeersRequired && (
              <li>
                {isZh 
                  ? `对等节点数不足（${assessment.peerCount} < ${assessment.minPeersRequired}）：连接更多节点以获得更准确的评估` 
                  : `Insufficient peers (${assessment.peerCount} < ${assessment.minPeersRequired}): Connect to more nodes for accurate assessment`}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

