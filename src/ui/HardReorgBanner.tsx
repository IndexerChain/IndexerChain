/**
 * Phase 42: Hard Reorg Banner - Display fork detection and rollback notifications
 * 
 * Shows a yellow banner when a hard reorg occurs, displaying:
 * - Rollback height range
 * - Number of blocks rolled back
 * - Timestamp
 */

import { useState, useEffect } from "react";

export interface HardReorgEvent {
  from: number;
  to: number;
  rolledBack: number;
  timestamp: number;
  cause?: string;
}

interface HardReorgBannerProps {
  locale: string;
}

export function HardReorgBanner({ locale }: HardReorgBannerProps) {
  const [reorgEvent, setReorgEvent] = useState<HardReorgEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const isZh = locale === "zh";

  useEffect(() => {
    // Listen for hard reorg events
    const handleReorg = (event: CustomEvent<HardReorgEvent>) => {
      const reorgData = event.detail;
      setReorgEvent(reorgData);
      setIsVisible(true);

      // Auto-hide after 10 seconds
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 10000);

      return () => clearTimeout(timer);
    };

    // Register event listener
    const eventTarget = typeof window !== "undefined" ? window : null;
    if (eventTarget) {
      eventTarget.addEventListener("hard-reorg" as any, handleReorg as unknown as EventListener);
    }

    return () => {
      if (eventTarget) {
        eventTarget.removeEventListener("hard-reorg" as any, handleReorg as unknown as EventListener);
      }
    };
  }, []);

  if (!isVisible || !reorgEvent) {
    return null;
  }

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        background: "#fff3cd",
        borderBottom: "2px solid #ffc107",
        padding: "1rem",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flex: 1 }}>
          <div style={{ fontSize: "2rem" }}>⚠️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#856404", marginBottom: "0.25rem" }}>
              {isZh ? "发生链重组" : "Hard Reorg Detected"}
            </div>
            <div style={{ fontSize: "0.9rem", color: "#856404" }}>
              {isZh
                ? `回滚了 ${reorgEvent.rolledBack} 个区块，从高度 ${reorgEvent.from} → ${reorgEvent.to}`
                : `Rolled back ${reorgEvent.rolledBack} blocks, from height ${reorgEvent.from} → ${reorgEvent.to}`}
            </div>
            {reorgEvent.cause && (
              <div style={{ fontSize: "0.85rem", color: "#856404", marginTop: "0.25rem", fontStyle: "italic" }}>
                {isZh ? `原因: ${reorgEvent.cause}` : `Cause: ${reorgEvent.cause}`}
              </div>
            )}
            <div style={{ fontSize: "0.8rem", color: "#856404", marginTop: "0.25rem" }}>
              {formatTime(reorgEvent.timestamp)}
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsVisible(false)}
          style={{
            background: "transparent",
            border: "1px solid #856404",
            color: "#856404",
            padding: "0.5rem 1rem",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#856404";
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#856404";
          }}
        >
          {isZh ? "关闭" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}

/**
 * Emit hard reorg event
 */
export function emitHardReorgEvent(event: HardReorgEvent): void {
  if (typeof window !== "undefined") {
    const customEvent = new CustomEvent("hard-reorg", { detail: event });
    window.dispatchEvent(customEvent);
  }
}

/**
 * Record reorg to history
 */
const REORG_HISTORY_KEY = "indexerchain.reorg_history";
const MAX_HISTORY_ENTRIES = 50;

export interface ReorgHistoryEntry {
  from: number;
  to: number;
  rolledBack: number;
  timestamp: number;
  cause?: string;
}

export function recordReorgToHistory(entry: ReorgHistoryEntry): void {
  try {
    const existing = localStorage.getItem(REORG_HISTORY_KEY);
    const history: ReorgHistoryEntry[] = existing ? JSON.parse(existing) : [];
    
    history.unshift(entry); // Add to beginning
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.pop(); // Remove oldest
    }
    
    localStorage.setItem(REORG_HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.error("[HardReorgBanner] Failed to record reorg to history:", error);
  }
}

export function getReorgHistory(): ReorgHistoryEntry[] {
  try {
    const existing = localStorage.getItem(REORG_HISTORY_KEY);
    return existing ? JSON.parse(existing) : [];
  } catch (error) {
    console.error("[HardReorgBanner] Failed to get reorg history:", error);
    return [];
  }
}

