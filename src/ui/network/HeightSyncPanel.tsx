/**
 * Phase 41: Height Sync Panel - Unified Multi-Device Height Synchronization Display
 * 
 * Shows height synchronization status from all sources:
 * - Local Height
 * - Shadow Node Height
 * - Signal RootTip Height
 * - P2P Network Height
 * - StateLock Height
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { getHeightSyncManager, type SyncStatus } from "../../core/heightSyncManager.js";

interface HeightSyncPanelProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  locale: string;
}

export function HeightSyncPanel({
  chainContext,
  p2pNode,
  locale,
}: HeightSyncPanelProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const isZh = locale === "zh";

  useEffect(() => {
    if (!chainContext || !p2pNode) {
      setSyncStatus(null);
      setLoading(false);
      return;
    }

    const heightSyncManager = getHeightSyncManager();
    heightSyncManager.init(chainContext, p2pNode);

    const updateStatus = () => {
      const status = heightSyncManager.getSyncStatus();
      setSyncStatus(status);
      setLoading(false);
    };

    updateStatus();
    const interval = setInterval(updateStatus, 2000); // Update every 2 seconds

    return () => clearInterval(interval);
  }, [chainContext, p2pNode]);

  if (loading || !syncStatus) {
    return (
      <div className="status-card">
        <div style={{ padding: "2rem", textAlign: "center", color: "#666" }}>
          {isZh ? "加载中..." : "Loading..."}
        </div>
      </div>
    );
  }

  const getSyncStatusColor = (status: SyncStatus["syncStatus"]): string => {
    switch (status) {
      case "aligned":
        return "#28a745";
      case "syncing":
        return "#ffc107";
      case "fork_detected":
        return "#dc3545";
      case "offline":
        return "#6c757d";
    }
  };

  const getSyncStatusLabel = (status: SyncStatus["syncStatus"]): string => {
    switch (status) {
      case "aligned":
        return isZh ? "✅ 已对齐" : "✅ Fully aligned";
      case "syncing":
        return isZh ? "🔄 同步中" : "🔄 Syncing";
      case "fork_detected":
        return isZh ? "⚠️ 检测到分叉" : "⚠️ Fork detected";
      case "offline":
        return isZh ? "📴 离线" : "📴 Offline";
    }
  };

  const getSourceLabel = (type: string): string => {
    switch (type) {
      case "local":
        return isZh ? "本地" : "Local";
      case "shadow":
        return isZh ? "Shadow Node" : "Shadow Node";
      case "signal":
        return isZh ? "Signal RootTip" : "Signal RootTip";
      case "p2p":
        return isZh ? "P2P 网络" : "P2P Network";
      case "statelock":
        return isZh ? "StateLock" : "StateLock";
      default:
        return type;
    }
  };

  const getTrustLevelLabel = (trustLevel: string): string => {
    switch (trustLevel) {
      case "trusted":
        return isZh ? "✅ 可信" : "✅ Trusted";
      case "majority":
        return isZh ? "✅ 多数" : "✅ Majority";
      case "single":
        return isZh ? "⚠️ 单一来源" : "⚠️ Single";
      case "offline":
        return isZh ? "📴 离线" : "📴 Offline";
      default:
        return trustLevel;
    }
  };

  const displayInfo = getHeightSyncManager().getHeightSourceDisplay();

  return (
    <div
      className="status-card"
      style={{
        marginBottom: "1rem",
        background: "rgba(0, 123, 255, 0.05)",
        border: `1px solid ${getSyncStatusColor(syncStatus.syncStatus)}`,
      }}
    >
      <h2 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.2rem" }}>
        {isZh ? "📊 高度同步状态" : "📊 Height Sync Status"}
      </h2>

      {/* Overall Status */}
      <div
        style={{
          padding: "1rem",
          background: "white",
          borderRadius: "8px",
          marginBottom: "1rem",
          border: `2px solid ${getSyncStatusColor(syncStatus.syncStatus)}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
          <div style={{ fontSize: "2rem" }}>
            {syncStatus.syncStatus === "aligned" ? "✅" : syncStatus.syncStatus === "syncing" ? "🔄" : syncStatus.syncStatus === "fork_detected" ? "⚠️" : "📴"}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: getSyncStatusColor(syncStatus.syncStatus) }}>
              {getSyncStatusLabel(syncStatus.syncStatus)}
            </div>
            <div style={{ fontSize: "0.9rem", color: "#666", marginTop: "0.25rem" }}>
              {isZh
                ? `推荐高度: ${syncStatus.recommendedHeight} (来源: ${getSourceLabel(syncStatus.recommendedSource)})`
                : `Recommended Height: ${syncStatus.recommendedHeight} (Source: ${getSourceLabel(syncStatus.recommendedSource)})`}
            </div>
          </div>
        </div>
      </div>

      {/* Height Sources Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        {/* Local Height */}
        <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
            {isZh ? "本地高度" : "Local Height"}
          </div>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: "bold",
              color: displayInfo.local.color,
            }}
          >
            {displayInfo.local.height}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
            {displayInfo.local.status}
          </div>
        </div>

        {/* Shadow Node Height */}
        <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
            {isZh ? "Shadow Node" : "Shadow Node"}
          </div>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: "bold",
              color: displayInfo.shadow.color,
            }}
          >
            {displayInfo.shadow.height ?? "N/A"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
            {displayInfo.shadow.status}
          </div>
        </div>

        {/* Signal RootTip Height */}
        <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
            {isZh ? "Signal RootTip" : "Signal RootTip"}
          </div>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: "bold",
              color: displayInfo.signal.color,
            }}
          >
            {displayInfo.signal.height ?? "N/A"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
            {displayInfo.signal.status}
          </div>
        </div>

        {/* P2P Network Height */}
        <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
            {isZh ? "P2P 网络" : "P2P Network"}
          </div>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: "bold",
              color: displayInfo.p2p.color,
            }}
          >
            {displayInfo.p2p.height ?? "N/A"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
            {displayInfo.p2p.status}
          </div>
        </div>

        {/* StateLock Height */}
        {displayInfo.statelock.height !== null && (
          <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
            <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
              {isZh ? "StateLock" : "StateLock"}
            </div>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: "bold",
                color: displayInfo.statelock.color,
              }}
            >
              {displayInfo.statelock.height}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
              {displayInfo.statelock.status}
            </div>
          </div>
        )}
      </div>

      {/* Detailed Sources List */}
      {syncStatus.sources.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h3 style={{ margin: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
            {isZh ? "高度来源详情" : "Height Sources Details"}
          </h3>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {syncStatus.sources.map((source, idx) => (
              <div
                key={idx}
                style={{
                  padding: "0.75rem",
                  background: source.type === syncStatus.recommendedSource ? "rgba(40, 167, 69, 0.1)" : "white",
                  borderRadius: "6px",
                  border: `1px solid ${source.type === syncStatus.recommendedSource ? "#28a745" : "#ddd"}`,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <div style={{ fontSize: "1.2rem" }}>
                  {source.type === syncStatus.recommendedSource ? "⭐" : "📊"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: "bold", fontSize: "0.9rem" }}>
                    {getSourceLabel(source.type)}: {source.height}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.25rem" }}>
                    {getTrustLevelLabel(source.trustLevel)}
                    {source.stateCommitment && (
                      <span style={{ marginLeft: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                        {source.stateCommitment.substring(0, 16)}...
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync Action Hints */}
      {syncStatus.syncStatus === "syncing" && (
        <div
          style={{
            padding: "1rem",
            background: "#fff3cd",
            borderRadius: "8px",
            border: "1px solid #ffc107",
            marginTop: "1rem",
          }}
        >
          <div style={{ fontSize: "0.9rem", color: "#856404" }}>
            {isZh
              ? `🔄 正在同步到高度 ${syncStatus.recommendedHeight}...`
              : `🔄 Syncing to height ${syncStatus.recommendedHeight}...`}
          </div>
        </div>
      )}

      {syncStatus.syncStatus === "fork_detected" && (
        <div
          style={{
            padding: "1rem",
            background: "#f8d7da",
            borderRadius: "8px",
            border: "1px solid #dc3545",
            marginTop: "1rem",
          }}
        >
          <div style={{ fontSize: "0.9rem", color: "#721c24" }}>
            {isZh
              ? `⚠️ 检测到分叉，建议执行 Hard Reorg 回滚到高度 ${syncStatus.recommendedHeight}`
              : `⚠️ Fork detected, recommend performing Hard Reorg to rollback to height ${syncStatus.recommendedHeight}`}
          </div>
        </div>
      )}
    </div>
  );
}

