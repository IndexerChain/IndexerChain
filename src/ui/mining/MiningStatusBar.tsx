/**
 * Phase 45: Mining Status Bar
 * 
 * High-density status bar at the top of Mining tab showing:
 * - Mining status (can mine / cannot mine & reason)
 * - Current height (Local/Network)
 * - Mining wallet address
 * - Active Miner status (from Shadow Node)
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { MiningGuard } from "../../core/miningGuard.js";
import { useI18n } from "../../i18n/useI18n.js";

interface MiningStatusBarProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  finalityManager: any;
  localRole: "LEADER" | "FOLLOWER";
  bootstrapComplete: boolean;
  nodeAddress: string | null;
  miningWalletAddress: string | null;
  isMining: boolean;
  clusterMining: boolean;
  shadowNodeClient: any; // Shadow Node client
  deviceId: string | null;
  onShowDetails: () => void; // Callback to show NetworkHealthPanel
  locale: string;
}

export function MiningStatusBar({
  chainContext,
  p2pNode,
  finalityManager,
  localRole,
  bootstrapComplete,
  nodeAddress,
  miningWalletAddress,
  isMining,
  clusterMining,
  shadowNodeClient,
  deviceId,
  onShowDetails,
  locale: _locale,
}: MiningStatusBarProps) {
  const [miningGuardResult, setMiningGuardResult] = useState<any>(null);
  const [activeMinerId, setActiveMinerId] = useState<string | null>(null);
  const [isActiveMiner, setIsActiveMiner] = useState<boolean>(false);
  const { t } = useI18n();

  // Check mining readiness
  useEffect(() => {
    const checkStatus = async () => {
      if (!chainContext) {
        setMiningGuardResult(null);
        return;
      }

      try {
        // Check MiningGuard
        const result = await MiningGuard.canMineNow(
          chainContext,
          p2pNode,
          finalityManager,
          localRole,
          nodeAddress || undefined,
          bootstrapComplete,
          shadowNodeClient,
          deviceId || undefined
        );
        setMiningGuardResult(result);

        // Check Active Miner status
        if (shadowNodeClient) {
          const currentActiveMinerId = shadowNodeClient.getActiveMinerId();
          setActiveMinerId(currentActiveMinerId);
          
          if (currentActiveMinerId && deviceId) {
            const sessionId = shadowNodeClient.getSessionId();
            const minerId = sessionId ? `${sessionId}-${p2pNode?.nodeId || ""}` : `${deviceId}-${p2pNode?.nodeId || ""}`;
            setIsActiveMiner(currentActiveMinerId === minerId);
          } else {
            setIsActiveMiner(!currentActiveMinerId);
          }
        }
      } catch (error) {
        console.error("[MiningStatusBar] Failed to check status:", error);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [chainContext, p2pNode, finalityManager, localRole, bootstrapComplete, nodeAddress, shadowNodeClient, deviceId]);

  // Get status color and icon
  const getStatusInfo = () => {
    if (isMining || clusterMining) {
      return {
        color: "#28a745",
        icon: "🟢",
        label: t("miningStatusBar.miningLeader"),
      };
    }

    if (!miningGuardResult) {
      return {
        color: "#666",
        icon: "⚪",
        label: t("miningStatus.checking"),
      };
    }

    if (miningGuardResult.ok) {
      const mode = miningGuardResult.mode || "SAFE";
      if (mode === "SAFE") {
        return {
          color: "#28a745",
          icon: "🟢",
          label: t("miningStatusBar.readyCanMine"),
        };
      } else if (mode === "GUARDED") {
        return {
          color: "#ffc107",
          icon: "🟡",
          label: t("miningStatusBar.waitingLimitedMode"),
        };
      } else {
        return {
          color: "#17a2b8",
          icon: "🔵",
          label: t("miningStatusBar.localMode"),
        };
      }
    } else {
      // Get main reason
      const reason = miningGuardResult.reason || t("miningStatusBar.conditionsNotMet");
      return {
        color: "#dc3545",
        icon: "🔴",
        label: `${t("miningStatus.cannotStartMining")} · ${reason}`,
      };
    }
  };

  const statusInfo = getStatusInfo();
  const localHeight = chainContext?.storage.getTip()?.header.height || 0;
  // Network height would come from P2P node's reported height
  const networkHeight = localHeight; // Simplified - would get from peer heights

  // Get main blocking reason for display
  const getMainReason = () => {
    if (!miningGuardResult || miningGuardResult.ok) return null;

    if (miningGuardResult.code === "NOT_ACTIVE_MINER") {
      return t("miningStatusBar.notActiveMiner");
    }

    // First year mode: Use friendly reason message (requiredQuorumScore === 50)
    const isFirstYearMode = miningGuardResult.details?.requiredQuorumScore === 50;
    if (isFirstYearMode && miningGuardResult.reason) {
      // Remove "First year: " prefix for cleaner display
      const reason = miningGuardResult.reason.replace(/^First year: /i, "");
      return reason;
    }

    // For INSUFFICIENT_PEERS, show friendly message
    if (miningGuardResult.code === "INSUFFICIENT_PEERS") {
      const requiredPeers = miningGuardResult.details?.requiredIndependentPeers ?? miningGuardResult.details?.requiredPeers ?? 3;
      const currentPeers = miningGuardResult.details?.requiredIndependentPeers !== undefined 
        ? (miningGuardResult.details?.independentPeerCount ?? 0)
        : (miningGuardResult.details?.peerCount ?? 0);
      const peerLabel = miningGuardResult.details?.requiredIndependentPeers !== undefined
        ? t("miningStatus.independentPeers")
        : t("network.peers");
      
      // First year mode: Show friendly message
      if (isFirstYearMode) {
        if (currentPeers < 1) {
          return t("miningStatus.needAtLeastOnePeer", { current: currentPeers });
        }
        // If peers are sufficient but bootstrap not complete, show bootstrap message
        if (miningGuardResult.reason?.includes("Bootstrap")) {
          return miningGuardResult.reason.replace(/^First year: /i, "");
        }
      }
      
      // Normal mode: Show peer count
      if (currentPeers < requiredPeers) {
        return t("miningStatus.insufficientPeers", { current: currentPeers, required: requiredPeers, peerLabel });
      }
    }

    if (miningGuardResult.details?.quorumScore !== undefined && !isFirstYearMode) {
      const score = miningGuardResult.details.quorumScore;
      const required = miningGuardResult.details.requiredQuorumScore || 80;
      if (score < required) {
        return t("miningStatus.quorumScoreInsufficient", { score, required });
      }
    }

    return miningGuardResult.reason || null;
  };

  const mainReason = getMainReason();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "1rem 1.5rem",
        background: "white",
        borderRadius: "8px",
        border: `2px solid ${statusInfo.color}`,
        marginBottom: "1rem",
        flexWrap: "wrap",
        gap: "1rem",
      }}
    >
      {/* Left: Status */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flex: 1 }}>
        <span style={{ fontSize: "1.5rem" }}>{statusInfo.icon}</span>
        <div>
          <div style={{ fontWeight: "bold", color: statusInfo.color, fontSize: "1rem" }}>
            {statusInfo.label}
          </div>
          {mainReason && (
            <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
              {mainReason}
            </div>
          )}
        </div>
      </div>

      {/* Middle: Height & Wallet */}
      <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flex: 1, justifyContent: "center" }}>
        <div style={{ fontSize: "0.9rem", color: "#666" }}>
          {t("miningStatusBar.height")}: <strong style={{ color: "#333" }}>Local: {localHeight}</strong> · <strong style={{ color: "#333" }}>Network: {networkHeight}</strong>
        </div>
        {miningWalletAddress && (
          <div style={{ fontSize: "0.9rem", color: "#666" }}>
            {t("miningStatusBar.miningWallet")}: <strong style={{ color: "#333", cursor: "pointer" }} title={miningWalletAddress}>
              {miningWalletAddress.substring(0, 8)}...{miningWalletAddress.substring(miningWalletAddress.length - 6)}
            </strong>
          </div>
        )}
      </div>

      {/* Right: Active Miner Status & Details Button */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        {shadowNodeClient && (
          <div style={{ fontSize: "0.85rem", color: isActiveMiner ? "#28a745" : "#ffc107" }}>
            {isActiveMiner ? (
              <span>✅ {t("miningStatusBar.thisDeviceIsActiveMiner")}</span>
            ) : activeMinerId ? (
              <span>⚠️ {t("miningStatusBar.anotherDeviceIsMining")}</span>
            ) : (
              <span>⚪ {t("miningStatusBar.noActiveMiner")}</span>
            )}
          </div>
        )}
        <button
          onClick={onShowDetails}
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.85rem",
            background: "#f8f9fa",
            border: "1px solid #dee2e6",
            borderRadius: "6px",
            cursor: "pointer",
            color: "#495057",
          }}
        >
          {t("miningStatusBar.details")}
        </button>
      </div>
    </div>
  );
}

