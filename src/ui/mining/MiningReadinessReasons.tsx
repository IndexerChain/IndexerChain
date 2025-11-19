/**
 * Phase 39: Mining Readiness Reasons
 * 
 * Human-readable reasons list for mining readiness
 * Shows top 3 priority reasons in a friendly format
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { MiningGuard } from "../../core/miningGuard.js";
import { getQuorumManager } from "../../core/quorumManager.js";

interface MiningReadinessReasonsProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  finalityManager: any;
  localRole: "LEADER" | "FOLLOWER";
  bootstrapComplete: boolean;
  locale: string;
}

interface ReasonItem {
  type: "success" | "warning" | "error";
  icon: string;
  title: string;
  description: string;
  priority: number;
}

export function MiningReadinessReasons({
  chainContext,
  p2pNode,
  finalityManager,
  localRole,
  bootstrapComplete,
  locale,
}: MiningReadinessReasonsProps) {
  const [reasons, setReasons] = useState<ReasonItem[]>([]);
  const [loading, setLoading] = useState(true);

  const isZh = locale === "zh";

  useEffect(() => {
    if (!chainContext || !p2pNode) {
      setReasons([]);
      setLoading(false);
      return;
    }

    const updateReasons = async () => {
      try {
        const result = await MiningGuard.canMineNow(
          chainContext,
          p2pNode,
          finalityManager,
          localRole,
          undefined,
          bootstrapComplete
        );

        const quorumManager = getQuorumManager();
        quorumManager.initialize(p2pNode, chainContext);
        const quorumStatus = quorumManager.getQuorumStatus();
        const admissionStatus = quorumManager.getMainnetAdmissionStatus();
        const isGenesis = quorumManager.isGenesisPhase();

        const reasonItems: ReasonItem[] = [];

        // Check Genesis phase
        if (isGenesis) {
          if (result.ok && quorumStatus.independentPeerCount >= 2) {
            reasonItems.push({
              type: "success",
              icon: "🌟",
              title: isZh ? "已完成 Genesis Quorum" : "Genesis Quorum Complete",
              description: isZh
                ? "当前处于创世阶段，已满足启动条件，可以挖出第一个区块。"
                : "Currently in Genesis phase, startup conditions met, ready to mine the first block.",
              priority: 1,
            });
          } else {
            if (quorumStatus.independentPeerCount < 2) {
              reasonItems.push({
                type: "error",
                icon: "❌",
                title: isZh ? "独立节点不足" : "Insufficient Independent Peers",
                description: isZh
                  ? `当前只有 ${quorumStatus.independentPeerCount} 个独立节点在线，需要至少 2 个。请再启动一台设备或让朋友连接 signal.indexerchain.com。`
                  : `Currently only ${quorumStatus.independentPeerCount} independent peer(s) online, need at least 2. Please start another device or ask a friend to connect to signal.indexerchain.com.`,
                priority: 1,
              });
            }
            if (!bootstrapComplete) {
              reasonItems.push({
                type: "error",
                icon: "❌",
                title: isZh ? "Bootstrap 未完成" : "Bootstrap Incomplete",
                description: isZh
                  ? "尚未完成根节点同步，请等待几秒或检查网络连接。"
                  : "Root node sync not complete, please wait a few seconds or check network connection.",
                priority: 2,
              });
            }
          }
        } else {
          // Normal phase reasons
          if (!bootstrapComplete) {
            reasonItems.push({
              type: "error",
              icon: "❌",
              title: isZh ? "Bootstrap 未完成" : "Bootstrap Incomplete",
              description: isZh
                ? "尚未完成根节点同步，请等待几秒或检查网络连接。"
                : "Root node sync not complete, please wait a few seconds or check network connection.",
              priority: 1,
            });
          }

          if (quorumStatus.totalScore < admissionStatus.requiredQuorumScore) {
            const scoreDiff = admissionStatus.requiredQuorumScore - quorumStatus.totalScore;
            const estimatedTime = scoreDiff > 20 ? "5-10" : "1-2";
            reasonItems.push({
              type: "error",
              icon: "❌",
              title: isZh ? "Quorum 分数不足" : "Insufficient Quorum Score",
              description: isZh
                ? `Quorum 分数 ${quorumStatus.totalScore} / ${admissionStatus.requiredQuorumScore}。目前在线节点太少，建议再启动 1 个节点或等待其他节点加入。预计约 ${estimatedTime} 分钟后可达标。`
                : `Quorum score ${quorumStatus.totalScore} / ${admissionStatus.requiredQuorumScore}. Too few nodes online, suggest starting 1 more node or waiting for others to join. Estimated ${estimatedTime} minutes to reach threshold.`,
              priority: 2,
            });
          }

          if (quorumStatus.independentPeerCount < admissionStatus.requiredIndependentPeers) {
            reasonItems.push({
              type: "error",
              icon: "❌",
              title: isZh ? "独立节点不足" : "Insufficient Independent Peers",
              description: isZh
                ? `当前 ${quorumStatus.independentPeerCount} 个独立节点，需要至少 ${admissionStatus.requiredIndependentPeers} 个。请连接到来自不同 IP 地址的节点。`
                : `Currently ${quorumStatus.independentPeerCount} independent peer(s), need at least ${admissionStatus.requiredIndependentPeers}. Please connect to nodes from different IP addresses.`,
              priority: 3,
            });
          }
        }

        // Check FOLLOWER role
        if (localRole === "FOLLOWER") {
          reasonItems.push({
            type: "warning",
            icon: "⚠️",
            title: isZh ? "当前为 FOLLOWER 实例" : "Current Instance is FOLLOWER",
            description: isZh
              ? "同一台电脑只有一个浏览器窗口可以挖矿，请到 LEADER 窗口操作。"
              : "Only one browser window per computer can mine. Please use the LEADER window.",
            priority: 1,
          });
        }

        // Check sync status
        const localTip = chainContext.storage.getTip();
        const localHeight = localTip?.header.height ?? 0;
        const rootTipHeight = (typeof window !== "undefined" && (window as any).lastRootTipHeight) || 0;
        if (rootTipHeight > 0 && localHeight < rootTipHeight - 1) {
          reasonItems.push({
            type: "warning",
            icon: "⏳",
            title: isZh ? "正在同步区块" : "Syncing Blocks",
            description: isZh
              ? `正在从网络同步区块和状态（通常 1-5 秒完成）...`
              : `Syncing blocks and state from network (usually 1-5 seconds)...`,
            priority: 1,
          });
        }

        // Sort by priority and take top 3
        reasonItems.sort((a, b) => a.priority - b.priority);
        setReasons(reasonItems.slice(0, 3));
      } catch (error) {
        console.error("[MiningReadinessReasons] Failed to update reasons:", error);
        setReasons([]);
      } finally {
        setLoading(false);
      }
    };

    updateReasons();
    const interval = setInterval(updateReasons, 5000);

    return () => clearInterval(interval);
  }, [chainContext, p2pNode, finalityManager, localRole, bootstrapComplete, isZh]);

  if (loading || reasons.length === 0) {
    return null;
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      <div style={{ fontSize: "0.9rem", fontWeight: "bold", marginBottom: "0.75rem", color: "#333" }}>
        {isZh ? "状态说明：" : "Status Details:"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {reasons.map((reason, index) => (
          <div
            key={index}
            style={{
              padding: "0.75rem",
              borderRadius: "6px",
              background:
                reason.type === "success"
                  ? "rgba(40, 167, 69, 0.1)"
                  : reason.type === "warning"
                  ? "rgba(255, 193, 7, 0.1)"
                  : "rgba(220, 53, 69, 0.1)",
              border: `1px solid ${
                reason.type === "success"
                  ? "#28a745"
                  : reason.type === "warning"
                  ? "#ffc107"
                  : "#dc3545"
              }`,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.2rem" }}>{reason.icon}</span>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontWeight: "bold",
                    marginBottom: "0.25rem",
                    color:
                      reason.type === "success"
                        ? "#155724"
                        : reason.type === "warning"
                        ? "#856404"
                        : "#721c24",
                  }}
                >
                  {reason.title}
                </div>
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "#666",
                    lineHeight: "1.4",
                  }}
                >
                  {reason.description}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

