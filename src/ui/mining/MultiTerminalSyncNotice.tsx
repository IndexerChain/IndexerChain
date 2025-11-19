/**
 * Phase 39: Multi-terminal Sync Notice
 * 
 * Shows notices for multi-terminal synchronization scenarios:
 * - New terminal syncing
 * - FOLLOWER mode
 * - State drift repair
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import { getLocalInstanceCoordinator } from "../../core/localInstance.js";
import { getLocalStateCoordinator } from "../../core/localStateCoordinator.js";

interface MultiTerminalSyncNoticeProps {
  chainContext: ChainContext | null;
  locale: string;
}

export function MultiTerminalSyncNotice({
  chainContext,
  locale,
}: MultiTerminalSyncNoticeProps) {
  const [notices, setNotices] = useState<Array<{
    type: "syncing" | "follower" | "repair";
    message: string;
    color: string;
  }>>([]);

  const isZh = locale === "zh";

  useEffect(() => {
    if (!chainContext) {
      setNotices([]);
      return;
    }

    const updateNotices = () => {
      const newNotices: Array<{
        type: "syncing" | "follower" | "repair";
        message: string;
        color: string;
      }> = [];

      // Check FOLLOWER mode
      const instanceCoordinator = getLocalInstanceCoordinator();
      const localRole = instanceCoordinator.getRole();
      if (localRole === "FOLLOWER") {
        newNotices.push({
          type: "follower",
          message: isZh
            ? "当前窗口为只读模式（FOLLOWER），不会参与挖矿。如果要挖矿，请返回最先打开的窗口（LEADER）。"
            : "Current window is read-only mode (FOLLOWER) and will not participate in mining. To mine, please return to the first opened window (LEADER).",
          color: "#ffc107",
        });
      }

      // Check if syncing (new terminal)
      const localTip = chainContext.storage.getTip();
      const localHeight = localTip?.header.height ?? 0;
      const rootTipHeight = (typeof window !== "undefined" && (window as any).lastRootTipHeight) || 0;
      const stateCoordinator = getLocalStateCoordinator();
      const isSyncing = stateCoordinator["isSyncing"] || false;

      if (isSyncing || (rootTipHeight > 0 && localHeight < rootTipHeight - 1)) {
        newNotices.push({
          type: "syncing",
          message: isZh
            ? "正在从网络同步区块和状态（通常 1-5 秒完成）…"
            : "Syncing blocks and state from network (usually 1-5 seconds)...",
          color: "#17a2b8",
        });
      }

      // Check state repair (would need to check StateRepairManager status)
      // For now, we'll check if there's a repair in progress via window state
      if (typeof window !== "undefined" && (window as any).stateRepairInProgress) {
        newNotices.push({
          type: "repair",
          message: isZh
            ? "检测到本地状态与网络多数节点不一致，正在自动修复…修复期间已暂停挖矿以避免无效区块。"
            : "Detected local state inconsistency with network majority, auto-repairing... Mining paused during repair to avoid invalid blocks.",
          color: "#ffc107",
        });
      }

      setNotices(newNotices);
    };

    updateNotices();
    const interval = setInterval(updateNotices, 2000);

    return () => clearInterval(interval);
  }, [chainContext, isZh]);

  if (notices.length === 0) {
    return null;
  }

  return (
    <div style={{ marginBottom: "1rem" }}>
      {notices.map((notice, index) => (
        <div
          key={index}
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "0.5rem",
            background: notice.color === "#ffc107" 
              ? "rgba(255, 193, 7, 0.1)" 
              : notice.color === "#17a2b8"
              ? "rgba(23, 162, 184, 0.1)"
              : "rgba(108, 117, 125, 0.1)",
            border: `1px solid ${notice.color}`,
            borderRadius: "6px",
            fontSize: "0.9rem",
            color: "#333",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>
            {notice.type === "syncing" ? "⏳" : notice.type === "follower" ? "👁️" : "🔧"}
          </span>
          <span>{notice.message}</span>
        </div>
      ))}
    </div>
  );
}

