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
import { SlotInfoBar } from "./SlotInfoBar.js";
import { computeEffectiveWeight } from "../../core/rewardPoolAllocator.js";
import { computeOnlineScore, getBalanceUIDC } from "../../core/weightSignals.js";
import { getBlockRewardRaw, uIDCToIDC } from "../../core/idcEmission.js";
// useState already imported above
import { MiningWeightCard } from "./MiningWeightCard.js";

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
  // Auto-mining props
  autoMining?: boolean;
  onAutoMiningChange?: (enabled: boolean) => void;
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
  autoMining = false,
  onAutoMiningChange,
}: MiningMainCardProps) {
  const [miningGuardResult, setMiningGuardResult] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [tooltip, setTooltip] = useState<string>("");
  const [inviteCodeInput, setInviteCodeInput] = useState<string>("");
  const { t } = useI18n();

  const isZh = locale === "zh";
  const [isMobile, setIsMobile] = useState<boolean>(false);
  useEffect(() => {
    const update = () => setIsMobile(typeof window !== "undefined" && window.innerWidth <= 640);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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
        // First year mode: requiredQuorumScore is <= 30
        const isFirstYearMode = requiredQuorumScore !== undefined && requiredQuorumScore <= 30;
        const independentPeerCount = result.details.independentPeerCount ?? 0;
        const firstYearRequiredScore = requiredQuorumScore || 40; // Phase 45: Default to 40 for first year
        
        // First year: Show score info (required ≥40, but display actual required score)
        if (isFirstYearMode) {
          // First year: Score must be ≥ requiredQuorumScore to mine
          if (quorumScore < firstYearRequiredScore) {
            reasons.push(
              isZh
                ? `Quorum分数不足: ${quorumScore} / ${firstYearRequiredScore}（需要 ≥${firstYearRequiredScore} 分才能挖矿）`
                : `Insufficient Quorum Score: ${quorumScore} / ${firstYearRequiredScore} (need ≥${firstYearRequiredScore} to mine)`
            );
          } else if (quorumScore < firstYearRequiredScore + 15) {
            reasons.push(
              isZh
                ? `Quorum分数: ${quorumScore}/${firstYearRequiredScore}（连接正常）`
                : `Quorum Score: ${quorumScore}/${firstYearRequiredScore} (connection normal)`
            );
          } else {
            reasons.push(
              isZh
                ? `Quorum分数: ${quorumScore}/${firstYearRequiredScore}（网络健康，多人在线）`
                : `Quorum Score: ${quorumScore}/${firstYearRequiredScore} (network healthy, multiple peers online)`
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
  // 3. Auto-mining is not enabled (if auto-mining is enabled, manual start is disabled)
  const canMine = miningGuardResult?.ok && 
                  !isMining && 
                  !clusterMining && 
                  !autoMining && // Disable manual start if auto-mining is enabled
                  (isFirstYearMode || hasSufficientQuorum || (isGenesisMode && hasGenesisPeers));
  
  const isFollowerBlocked = localRole === "FOLLOWER" && chainContext?.params?.networkId === "IXC_MAINNET_V1";

  // One-click catch up (mining page)
  const [syncMsgMine, setSyncMsgMine] = useState<string>("");
  const handleCatchUpMining = async () => {
    try {
      if (!chainContext || !p2pNode) {
        setSyncMsgMine(isZh ? "节点未就绪" : "Node not ready");
        return;
      }
      const local = chainContext.storage.getTip()?.header.height ?? 0;
      const network = (typeof window !== "undefined" && (window as any).lastRootTipHeight) || 0;
      if (network <= 0) {
        setSyncMsgMine(isZh ? "暂无网络高度" : "No network height");
        return;
      }
      const diff = network - local;
      if (diff <= 0) {
        setSyncMsgMine(isZh ? "已在最新高度" : "Already at latest height");
        return;
      }
      setSyncMsgMine((isZh ? "同步中..." : "Syncing...") + ` (${local} → ${network})`);
      try {
        const { handleRootTipUpdate } = await import("../../core/unifiedSyncManager.js");
        const rt: any = {
          latestHeight: network,
          latestHeaderHash: (typeof window !== "undefined" && (window as any).lastRootTipHash) || "",
          recentHeaders: (typeof window !== "undefined" && (window as any).lastRootTipRecentHeaders) || undefined,
          latestSnapshotMeta: (typeof window !== "undefined" && (window as any).lastRootTipSnapshotMeta) || undefined,
          stateCommitment: (typeof window !== "undefined" && (window as any).lastRootTipStateCommitment) || undefined,
        };
        const result = await handleRootTipUpdate(
          chainContext,
          p2pNode as any,
          rt,
          true,
          (msg: string) => setSyncMsgMine((isZh ? "同步中：" : "Syncing: ") + msg)
        );
        if (result.success) {
          setSyncMsgMine(isZh ? "✅ 同步完成" : "✅ Synced");
          return;
        }
      } catch {
        // fall through
      }
      const requestRange = Math.min(diff, 500);
      (p2pNode as any).broadcast("REQUEST_BLOCKS", {
        fromHeight: local + 1,
        toHeight: local + requestRange,
      });
      setSyncMsgMine(
        (isZh ? "已请求区块：" : "Requested blocks: ") +
          `${local + 1}-${local + requestRange}`
      );
    } catch (e) {
      setSyncMsgMine(t("miningMain.failedPrefix") + (e instanceof Error ? e.message : String(e)));
    }
  };

  // Get button label
  const getButtonLabel = () => {
    if (isMining || clusterMining) {
      if (clusterMining) {
        return t("miningStatus.stopClusterMining");
      }
      return t("miningStatus.stopMining");
    }

    if (isFollowerBlocked) {
      return t("miningStatus.leaderOnly");
    }

    if (miningMode === "cluster") {
      return t("miningStatus.startClusterMining");
    } else if (miningMode === "global-pool") {
      return t("miningStatus.startMiningGlobalPool");
    } else {
      return t("miningStatus.startMiningSolo");
    }
  };

  const handleButtonClick = () => {
    // Production: No console logs
    
    if (isMining || clusterMining) {
      onStopMining();
    } else if (canMine && !isFollowerBlocked && !autoMining) {
      onStartMining();
    } else {
      // Show feedback when button is clicked but mining cannot start
      if (autoMining) {
        alert(t("miningMain.autoEnabledAlert"));
      } else if (!canMine) {
        // Production: No console logs
        // Optionally show an alert or toast message
        if (tooltip) {
          alert(tooltip);
        }
      } else if (isFollowerBlocked) {
        alert(t("miningMain.followerBlockedAlert"));
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
        {"⛏️ " + t("miningStatus.mining")}
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
                {/* Sync status label (compact) */}
                <div style={{ marginTop: "0.25rem" }}>
                  {(() => {
                    const lh = chainContext?.storage.getTip()?.header.height ?? 0;
                    const nh = (typeof window !== "undefined" && (window as any).lastRootTipHeight) || 0;
                    const diff = Math.max(0, nh - lh);
                    const label = nh <= 0 ? t("miningMain.waiting")
                      : diff <= 1 ? t("miningMain.synced")
                      : diff <= 50 ? t("miningMain.catchingUp")
                      : t("miningMain.outOfSync");
                    const color = diff <= 1 ? "#28a745" : diff <= 50 ? "#ffc107" : "#dc3545";
                    return (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.15rem 0.5rem",
                          borderRadius: "12px",
                          background: color,
                          color: "white",
                          fontSize: "0.7rem",
                          fontWeight: "bold",
                        }}
                        title={`${t("miningMain.localNetworkHeightsTitle")}: ${lh}/${nh}`}
                      >
                        {label}
                      </span>
                    );
                  })()}
                  <button
                    onClick={handleCatchUpMining}
                    style={{
                      marginLeft: "0.5rem",
                      padding: "0.15rem 0.5rem",
                      fontSize: "0.75rem",
                      borderRadius: "12px",
                      border: "1px solid #17a2b8",
                      background: "white",
                      color: "#17a2b8",
                      cursor: "pointer",
                    }}
                    title={t("miningMain.catchUpTitle")}
                  >
                    {t("miningMain.catchUp")}
                  </button>
                  {syncMsgMine && (
                    <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.35rem" }}>
                      {syncMsgMine}
                    </div>
                  )}
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
        
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" }}>
          <button
            onClick={handleButtonClick}
            disabled={autoMining && !isMining && !clusterMining} // Disable if auto-mining is enabled and not currently mining
            style={{
              flex: isMobile ? "0 0 auto" : 1,
              width: isMobile ? "100%" : undefined,
              padding: "1rem 2rem",
              fontSize: "1.1rem",
              fontWeight: "bold",
              borderRadius: "8px",
              border: "none",
              background: (canMine && !autoMining) || isMining || clusterMining
                ? status.color
                : "#6c757d",
              color: "white",
              cursor: (autoMining && !isMining && !clusterMining) ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              opacity: (canMine && !autoMining) || isMining || clusterMining || isFollowerBlocked ? 1 : 0.7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
            }}
            onMouseEnter={(e) => {
              if (!canMine && !isMining && !clusterMining && !isFollowerBlocked && !autoMining) {
                e.currentTarget.style.opacity = "0.9";
              }
            }}
            onMouseLeave={(e) => {
              if (!canMine && !isMining && !clusterMining && !isFollowerBlocked && !autoMining) {
                e.currentTarget.style.opacity = "0.7";
              }
            }}
            title={autoMining && !isMining && !clusterMining 
              ? t("miningMain.autoMineEnabledTooltip")
              : (tooltip || undefined)}
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
          
          {onAutoMiningChange && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                whiteSpace: "nowrap",
                padding: "0.5rem 0.6rem",
                border: "1px solid #e0e0e0",
                borderRadius: "8px",
                background: "#fff",
                cursor: "pointer",
                flex: "0 0 auto",
                width: isMobile ? "100%" : "auto",
                justifyContent: isMobile ? "space-between" : "flex-start",
              }}
              title={t("miningMain.autoMineTitle")}
            >
              <input
                type="checkbox"
                checked={autoMining}
                onChange={(e) => {
                  if (onAutoMiningChange) onAutoMiningChange(e.target.checked);
                }}
                style={{ width: "1.1rem", height: "1.1rem", cursor: "pointer" }}
              />
              <span style={{ fontSize: "0.85rem", color: autoMining ? "#28a745" : "#666", fontWeight: autoMining ? "bold" : "normal" }}>
                {t("miningMain.autoMineShortLabel")}
              </span>
            </label>
          )}
        </div>
        
        {/* Slot & Leader info */}
        <SlotInfoBar chainContext={chainContext} nodeAddress={nodeAddress} locale={locale} />
        
        {/* Projected Reward (pooled preview) */}
        <div
          className="status-card"
          style={{
            marginTop: "0.75rem",
            background: "rgba(255,255,255,0.9)",
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "0.75rem",
          }}
        >
          {/* Timescale selector */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <div style={{ fontWeight: "bold" }}>
              {t("miningMain.projectedRewardTitle")}
            </div>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {t("miningMain.timescaleLabel")}:{" "}
              <select
                value={(() => {
                  try { return localStorage.getItem("indexerchain_reward_timescale") || "block"; } catch { return "block"; }
                })()}
                onChange={(e) => {
                  try { localStorage.setItem("indexerchain_reward_timescale", e.target.value); } catch {}
                  // force rerender
                  (e.currentTarget as any)._forceUpdateKey = Date.now();
                }}
                style={{ padding: "0.25rem 0.5rem", border: "1px solid #ddd", borderRadius: "4px" }}
              >
                <option value="block">{t("miningMain.perBlock")}</option>
                <option value="min">{t("miningMain.perMin")}</option>
                <option value="hour">{t("miningMain.perHour")}</option>
                <option value="day">{t("miningMain.perDay")}</option>
                <option value="week">{t("miningMain.perWeek")}</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "0.85rem", color: "#666" }}>{t("miningMain.baseRewardIDC")}</div>
              <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
                {uIDCToIDC(getBlockRewardRaw((chainContext?.storage.getTip()?.header.height ?? 0) + 1)).toFixed(12)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.85rem", color: "#666" }}>{t("miningMain.myEffectiveWeight")}</div>
              <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
                {(() => {
                  try {
                    const bal = getBalanceUIDC(chainContext, (nodeAddress as any) || null);
                    const online = computeOnlineScore();
                    const reliab = 80;
                    const ew = computeEffectiveWeight({
                      address: (nodeAddress as any) || "idc_unknown",
                      balanceUIDC: bal,
                      onlineScore: online,
                      reliabilityScore: reliab,
                      eligible: true,
                    });
                    return ew.toFixed(4);
                  } catch {
                    return "0.0000";
                  }
                })()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.85rem", color: "#666" }}>{isZh ? "总权重（可配置）" : "Total Weight (configurable)"}</div>
              <input
                type="number"
                value={(() => {
                  try { return Number(localStorage.getItem("indexerchain_estimated_total_weight") || "100"); } catch { return 100; }
                })()}
                min={1}
                onChange={(e) => {
                  const v = Math.max(1, Number(e.target.value || "1"));
                  try { localStorage.setItem("indexerchain_estimated_total_weight", String(v)); } catch {}
                }}
                style={{
                  width: "100%",
                  padding: "0.35rem 0.5rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "0.95rem",
                }}
              />
            </div>
          </div>
          <div style={{ marginTop: "0.5rem", fontSize: "0.95rem" }}>
            {t("miningMain.projectedRewardInline")}:{" "}
            <b>
              {(() => {
                try {
                  const total = Math.max(1, Number(localStorage.getItem("indexerchain_estimated_total_weight") || "100"));
                  const base = uIDCToIDC(getBlockRewardRaw((chainContext?.storage.getTip()?.header.height ?? 0) + 1));
                  const bal = getBalanceUIDC(chainContext, (nodeAddress as any) || null);
                  const online = computeOnlineScore();
                  const reliab = 80;
                  const ew = computeEffectiveWeight({
                    address: (nodeAddress as any) || "idc_unknown",
                    balanceUIDC: bal,
                    onlineScore: online,
                    reliabilityScore: reliab,
                    eligible: true,
                  });
                  const projPerBlock = (base * ew) / total;
                  const scale = (() => {
                    try { return localStorage.getItem("indexerchain_reward_timescale") || "block"; } catch { return "block"; }
                  })();
                  const tb = Math.max(1, chainContext?.params?.targetBlockTime || 10); // seconds
                  let factor = 1;
                  if (scale === "min") factor = 60 / tb;
                  else if (scale === "hour") factor = 3600 / tb;
                  else if (scale === "day") factor = 86400 / tb;
                  else if (scale === "week") factor = (86400 * 7) / tb;
                  const value = projPerBlock * factor;
                  const label = scale === "block" ? t("miningMain.perBlock")
                    : scale === "min" ? t("miningMain.perMin")
                    : scale === "hour" ? t("miningMain.perHour")
                    : scale === "day" ? t("miningMain.perDay")
                    : t("miningMain.perWeek");
                  return `${value.toFixed(12)} IDC (${label})`;
                } catch {
                  return `0.000000 IDC (${t("miningMain.perBlock")})`;
                }
              })()}
            </b>
          </div>
        </div>
        
        {/* Weight signals (preview of pooled rewards weighting) */}
        <MiningWeightCard
          chainContext={chainContext}
          p2pNode={p2pNode}
          nodeAddress={nodeAddress}
          locale={locale}
        />
        
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
          {(() => {
            const reason = miningGuardResult.reason || t("miningStatus.cannotStartMining");
            return (
              <>
                <div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
                  {t("miningMain.miningRequirementsHeading")}
                </div>
                <div>{reason}</div>
                {miningGuardResult.details && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
                    {miningGuardResult.details.quorumScore !== undefined && (
                      <div>
                        {t("miningStatus.quorumScore")}: {miningGuardResult.details.quorumScore} / {miningGuardResult.details.requiredQuorumScore || 30}
                      </div>
                    )}
                    {miningGuardResult.details.independentPeerCount !== undefined && (
                      <div>
                        {(() => {
                          const minPeersRequired = chainContext?.params?.minPeersRequired ?? 3;
                          const requiredPeers = miningGuardResult.details.requiredIndependentPeers || minPeersRequired;
                          return (
                            <>
                              {t("miningStatus.independentPeers")}: {miningGuardResult.details.independentPeerCount} / {requiredPeers}
                              {miningGuardResult.details.independentPeerCount < requiredPeers && (
                                <div style={{ fontSize: "0.7rem", color: "#856404", marginTop: "0.25rem", fontStyle: "italic" }}>
                                  {t("miningMain.needDifferentIPsHint")}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
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
          {t("miningMain.followerTabWarning")}
        </div>
      )}

      {/* Phase 42: Referral Invite Code Input (hidden for minimal console) */}
      {false && !currentReferrerAddress && (
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
            {t("mining.referralCodeBinding")}
          </div>
          
          {pendingInviteAddress ? (
            <div style={{ fontSize: "0.85rem", color: "#28a745" }}>
              {isZh 
                ? `✅ 已识别邀请地址: ${(pendingInviteAddress || "").substring(0, 16)}...`
                : `✅ Pending invite address: ${(pendingInviteAddress || "").substring(0, 16)}...`}
            </div>
          ) : (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", flexDirection: isMobile ? "column" : "row" }}>
              <input
                type="text"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
                placeholder={t("mining.enterInviteCodeOrAddress")}
                style={{
                  flex: isMobile ? "0 0 auto" : 1,
                  padding: "0.6rem",
                  fontSize: "0.85rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontFamily: "monospace",
                  width: isMobile ? "100%" : undefined,
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
                  width: isMobile ? "100%" : "auto",
                }}
              >
                {t("common.confirm")}
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
            {t("mining.referralAddressBound")}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
            {currentReferrerAddress.substring(0, 20)}...
          </div>
        </div>
      )}
    </div>
  );
}

