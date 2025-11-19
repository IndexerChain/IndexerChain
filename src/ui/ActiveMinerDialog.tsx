/**
 * Phase 42: Active Miner Dialog - Multi-device mining conflict resolution
 * 
 * Shows a dialog when another device is already mining, allowing user to:
 * - Cancel and keep current device read-only
 * - Force takeover mining control
 */

import { useState } from "react";

export interface ActiveMinerInfo {
  activeMinerId: string;
  lastSeen: number;
}

interface ActiveMinerDialogProps {
  isOpen: boolean;
  activeMinerInfo: ActiveMinerInfo | null;
  locale: string;
  onCancel: () => void;
  onTakeover: () => void;
}

export function ActiveMinerDialog({
  isOpen,
  activeMinerInfo,
  locale,
  onCancel,
  onTakeover,
}: ActiveMinerDialogProps) {
  const [isTakingOver, setIsTakingOver] = useState(false);

  const isZh = locale === "zh";

  if (!isOpen || !activeMinerInfo) {
    return null;
  }

  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) {
      return isZh ? `${seconds} 秒前` : `${seconds} seconds ago`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return isZh ? `${minutes} 分钟前` : `${minutes} minutes ago`;
    }
    const hours = Math.floor(minutes / 60);
    return isZh ? `${hours} 小时前` : `${hours} hours ago`;
  };

  const handleTakeover = async () => {
    setIsTakingOver(true);
    try {
      await onTakeover();
    } finally {
      setIsTakingOver(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10001,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "white",
          borderRadius: "8px",
          padding: "2rem",
          maxWidth: "500px",
          width: "90%",
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.5rem" }}>
          {isZh ? "⚠️ 检测到另一设备正在挖矿" : "⚠️ Another Device is Mining"}
        </h2>

        <div style={{ marginBottom: "1.5rem" }}>
          <p style={{ margin: "0.5rem 0", color: "#666" }}>
            {isZh
              ? "检测到你在另一台设备上已经在挖矿。为避免分叉和浪费算力，默认只允许一个终端挖矿。"
              : "Another device is already mining for you. To avoid forks and wasted computation, only one device can mine at a time by default."}
          </p>

          <div
            style={{
              padding: "1rem",
              background: "#f8f9fa",
              borderRadius: "6px",
              marginTop: "1rem",
            }}
          >
            <div style={{ marginBottom: "0.5rem" }}>
              <strong>{isZh ? "活动挖矿设备:" : "Active Mining Device:"}</strong>
            </div>
            <div style={{ fontSize: "0.9rem", color: "#666", fontFamily: "monospace" }}>
              {activeMinerInfo.activeMinerId.substring(0, 32)}...
            </div>
            <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.5rem" }}>
              {isZh ? "最后心跳:" : "Last heartbeat:"} {formatTimeAgo(activeMinerInfo.lastSeen)}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            disabled={isTakingOver}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              background: "#6c757d",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: isTakingOver ? "not-allowed" : "pointer",
              opacity: isTakingOver ? 0.6 : 1,
            }}
          >
            {isZh ? "❌ 取消" : "❌ Cancel"}
          </button>
          <button
            onClick={handleTakeover}
            disabled={isTakingOver}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              background: "#dc3545",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: isTakingOver ? "not-allowed" : "pointer",
              opacity: isTakingOver ? 0.6 : 1,
            }}
          >
            {isTakingOver
              ? (isZh ? "接管中..." : "Taking over...")
              : (isZh ? "⚠️ 强制接管" : "⚠️ Force Takeover")}
          </button>
        </div>

        <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#856404", fontStyle: "italic" }}>
          {isZh
            ? "⚠️ 强制接管将停止另一设备的挖矿，并在此设备上开始挖矿。"
            : "⚠️ Force takeover will stop mining on the other device and start mining on this device."}
        </div>
      </div>
    </div>
  );
}

