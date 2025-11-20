/**
 * Phase 45: Network Mini Health Card
 * 
 * Simplified network health display for Mining tab showing only mining-relevant status:
 * - Quorum Score (current/threshold)
 * - Independent peer count
 * - Finality status (Initialization/Normal)
 * - StateLock status (Early/Locked)
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { MiningGuard } from "../../core/miningGuard.js";
import { getQuorumManager } from "../../core/quorumManager.js";

interface NetworkMiniHealthCardProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  finalityManager: any;
  localRole: "LEADER" | "FOLLOWER";
  bootstrapComplete: boolean;
  nodeAddress: string | null;
  locale: string;
}

export function NetworkMiniHealthCard({
  chainContext,
  p2pNode,
  finalityManager,
  localRole,
  bootstrapComplete,
  nodeAddress,
  locale,
}: NetworkMiniHealthCardProps) {
  const [healthData, setHealthData] = useState<any>(null);
  const isZh = locale === "zh";

  useEffect(() => {
    const updateHealth = async () => {
      if (!chainContext) {
        setHealthData(null);
        return;
      }

      try {
        // Get MiningGuard result
        const guardResult = await MiningGuard.canMineNow(
          chainContext,
          p2pNode,
          finalityManager,
          localRole,
          nodeAddress || undefined,
          bootstrapComplete
        );

        // Get QuorumManager data
        let quorumScore = 0;
        let requiredQuorumScore = 80;
        let independentPeerCount = 0;
        try {
          const quorumManager = getQuorumManager();
          if (p2pNode) {
            quorumManager.initialize(p2pNode, chainContext);
          }
          const quorumStatus = quorumManager.getQuorumStatus();
          quorumScore = quorumStatus.totalScore;
          requiredQuorumScore = quorumStatus.requiredScore;
          independentPeerCount = quorumStatus.independentPeerCount;
        } catch (e) {
        }

        // Get Finality status
        let finalityStatus = "Unknown";
        let finalityLag = 0;
        if (finalityManager) {
          try {
            const finalizedHeight = finalityManager.getFinalizedHeight() || 0;
            const tipHeight = chainContext.storage.getTip()?.header.height || 0;
            finalityLag = tipHeight - finalizedHeight;
            
            if (finalityLag <= 50) {
              finalityStatus = "Initialization";
            } else {
              finalityStatus = "Normal";
            }
          } catch (e) {
            finalityStatus = "Unknown";
          }
        }

        // Get StateLock status (simplified)
        let stateLockStatus = "Early";
        try {
          // Would need to check StateLockManager
          // For now, use network stage as proxy
          const networkStage = guardResult.details?.networkStage;
          if (networkStage === "NORMAL_FINALITY") {
            stateLockStatus = "Locked";
          }
        } catch (e) {
          // Default to Early
        }

        setHealthData({
          quorumScore,
          requiredQuorumScore,
          independentPeerCount,
          finalityStatus,
          finalityLag,
          stateLockStatus,
          networkStage: guardResult.details?.networkStage,
        });
      } catch (error) {
        setHealthData(null);
      }
    };

    updateHealth();
    const interval = setInterval(updateHealth, 5000);
    return () => clearInterval(interval);
  }, [chainContext, p2pNode, finalityManager, localRole, bootstrapComplete, nodeAddress]);

  if (!healthData) {
    return (
      <div className="status-card" style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ margin: 0, marginBottom: "1rem" }}>
          🛡️ {isZh ? "网络 & 安全状态" : "Network & Security Status"}
        </h3>
        <div style={{ color: "#666", fontSize: "0.9rem" }}>
          {isZh ? "加载中..." : "Loading..."}
        </div>
      </div>
    );
  }

  const getStatusColor = (value: number, threshold: number) => {
    if (value >= threshold) return "#28a745";
    if (value >= threshold * 0.7) return "#ffc107";
    return "#dc3545";
  };

  const quorumOk = healthData.quorumScore >= healthData.requiredQuorumScore;
  const peersOk = healthData.independentPeerCount >= 2;

  return (
    <div className="status-card" style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ margin: 0, marginBottom: "1rem" }}>
        🛡️ {isZh ? "网络 & 安全状态" : "Network & Security Status"}
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
        {/* Quorum Score */}
        <div style={{ padding: "0.75rem", background: "#f8f9fa", borderRadius: "6px", border: `2px solid ${getStatusColor(healthData.quorumScore, healthData.requiredQuorumScore)}` }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>
            🛡 {isZh ? "Quorum Score" : "Quorum Score"}
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: getStatusColor(healthData.quorumScore, healthData.requiredQuorumScore) }}>
            {healthData.quorumScore} / {healthData.requiredQuorumScore}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
            {quorumOk ? "✅ OK" : "❌ Insufficient"}
          </div>
        </div>

        {/* Independent Peers */}
        <div style={{ padding: "0.75rem", background: "#f8f9fa", borderRadius: "6px", border: `2px solid ${getStatusColor(healthData.independentPeerCount, 2)}` }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>
            🔗 {isZh ? "独立节点" : "Independent Peers"}
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: getStatusColor(healthData.independentPeerCount, 2) }}>
            {healthData.independentPeerCount}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
            {peersOk ? "✅ OK" : "❌ Need ≥ 2"}
          </div>
        </div>

        {/* Finality Status */}
        <div style={{ padding: "0.75rem", background: "#f8f9fa", borderRadius: "6px", border: "2px solid #17a2b8" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>
            🔐 {isZh ? "Finality" : "Finality"}
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#17a2b8" }}>
            {healthData.finalityStatus === "Initialization" 
              ? (isZh ? "初始化模式" : "Initialization Mode")
              : (isZh ? "正常模式" : "Normal Mode")}
          </div>
          {healthData.finalityStatus === "Initialization" && (
            <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
              {isZh ? "前 50 块放宽限制" : "First 50 blocks relaxed"}
            </div>
          )}
        </div>

        {/* StateLock Status */}
        <div style={{ padding: "0.75rem", background: "#f8f9fa", borderRadius: "6px", border: "2px solid #6c757d" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>
            📡 {isZh ? "StateLock" : "StateLock"}
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#6c757d" }}>
            {healthData.stateLockStatus === "Locked"
              ? (isZh ? "已锁定" : "Locked")
              : (isZh ? "早期阶段" : "Early Stage")}
          </div>
          {healthData.stateLockStatus === "Early" && (
            <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
              {isZh ? "StateLock 未形成，已放宽检查" : "StateLock not formed, checks relaxed"}
            </div>
          )}
        </div>
      </div>

      {/* Network Stage Info */}
      {healthData.networkStage && (
        <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#e7f3ff", borderRadius: "6px", fontSize: "0.85rem", color: "#004085" }}>
          {healthData.networkStage === "GENESIS_QUORUM" && (
            <div>
              🌟 {isZh ? "Genesis Mode" : "Genesis Mode"}: {isZh ? "当前处于创世阶段，已放宽部分安全检查，以便主网启动。" : "Currently in genesis phase, some security checks relaxed for mainnet launch."}
            </div>
          )}
          {healthData.networkStage === "FINALITY_INIT" && (
            <div>
              🔵 {isZh ? "Finality 初始化模式" : "Finality Initialization Mode"}: {isZh ? "Finality 系统正在初始化，允许挖矿。" : "Finality system initializing, mining allowed."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

