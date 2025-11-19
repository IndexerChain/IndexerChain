/**
 * Phase 39: Genesis Quorum Banner
 * 
 * Special banner for Genesis phase (height = 0)
 * Shows when network is in Genesis mode and explains requirements
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { getQuorumManager } from "../../core/quorumManager.js";

interface GenesisQuorumBannerProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  bootstrapComplete: boolean;
  locale: string;
}

export function GenesisQuorumBanner({
  chainContext,
  p2pNode,
  bootstrapComplete,
  locale,
}: GenesisQuorumBannerProps) {
  const [isGenesis, setIsGenesis] = useState(false);
  const [requirements, setRequirements] = useState<{
    independentPeers: number;
    requiredPeers: number;
    bootstrapComplete: boolean;
    stablePeers: boolean;
  } | null>(null);

  const isZh = locale === "zh";

  useEffect(() => {
    if (!chainContext || !p2pNode) {
      setIsGenesis(false);
      setRequirements(null);
      return;
    }

    const checkGenesis = () => {
      const quorumManager = getQuorumManager();
      quorumManager.initialize(p2pNode, chainContext);
      const genesis = quorumManager.isGenesisPhase();
      setIsGenesis(genesis);

      if (genesis) {
        const quorumStatus = quorumManager.getQuorumStatus();
        const peers = Array.from(p2pNode.peers.values()).filter(p => p.connected);
        
        // Check if peers have been online > 2 minutes by checking quorum status
        // We'll use a simpler check: if we have peers and quorum score > 0, assume stable
        const hasStablePeers = peers.length > 0 && quorumStatus.totalScore > 0;
        
        // In Genesis phase, bootstrap is considered complete if:
        // 1. The bootstrapComplete prop is true, OR
        // 2. We've received a bootstrap response (even if height is 0, which is expected in Genesis)
        // 3. We've received a BOOTSTRAP_RESPONSE (indicated by lastBootstrapResponseTime being set)
        const isBootstrapComplete = bootstrapComplete || 
          (typeof window !== "undefined" && (
            (window as any).lastBootstrapHeight !== undefined ||
            (window as any).lastBootstrapResponseTime !== undefined
          ));

        setRequirements({
          independentPeers: quorumStatus.independentPeerCount,
          requiredPeers: 2,
          bootstrapComplete: isBootstrapComplete,
          stablePeers: hasStablePeers,
        });
      } else {
        setRequirements(null);
      }
    };

    checkGenesis();
    const interval = setInterval(checkGenesis, 5000);

    return () => clearInterval(interval);
  }, [chainContext, p2pNode, bootstrapComplete]);

  if (!isGenesis || !requirements) {
    return null;
  }

  const allRequirementsMet = 
    requirements.independentPeers >= requirements.requiredPeers &&
    requirements.bootstrapComplete &&
    requirements.stablePeers;

  return (
    <div
      className="status-card"
      style={{
        marginBottom: "1.5rem",
        background: allRequirementsMet
          ? "rgba(40, 167, 69, 0.1)"
          : "rgba(255, 193, 7, 0.1)",
        border: `2px solid ${allRequirementsMet ? "#28a745" : "#ffc107"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
        <div style={{ fontSize: "2rem" }}>🌟</div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: "1.2rem",
              fontWeight: "bold",
              marginBottom: "0.5rem",
              color: allRequirementsMet ? "#155724" : "#856404",
            }}
          >
            {isZh ? "Genesis Quorum Mode" : "Genesis Quorum Mode"}
          </div>
          <div
            style={{
              fontSize: "0.95rem",
              color: "#666",
              marginBottom: "0.75rem",
              lineHeight: "1.5",
            }}
          >
            {isZh
              ? "当前网络处于创世阶段，当有 ≥ 2 个独立节点在线并且已完成引导同步后，即可开始挖出第一个区块。"
              : "The network is currently in Genesis phase. Once there are ≥ 2 independent peers online and bootstrap sync is complete, you can start mining the first block."}
          </div>

          {!allRequirementsMet && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "white",
                borderRadius: "6px",
                fontSize: "0.9rem",
              }}
            >
              <div style={{ fontWeight: "bold", marginBottom: "0.5rem", color: "#856404" }}>
                {isZh ? "当前状态：" : "Current Status:"}
              </div>
              <ul style={{ margin: 0, paddingLeft: "1.5rem", color: "#666" }}>
                {requirements.independentPeers < requirements.requiredPeers && (
                  <li>
                    {isZh
                      ? `独立节点：${requirements.independentPeers} / ${requirements.requiredPeers}（需要至少 ${requirements.requiredPeers} 个）`
                      : `Independent Peers: ${requirements.independentPeers} / ${requirements.requiredPeers} (need at least ${requirements.requiredPeers})`}
                    <br />
                    <span style={{ fontSize: "0.85rem", fontStyle: "italic", color: "#999" }}>
                      {isZh
                        ? "💡 当前只有你一个节点在线，请再启动一台设备或让朋友连接 signal.indexerchain.com。"
                        : "💡 Currently only you are online, please start another device or ask a friend to connect to signal.indexerchain.com."}
                    </span>
                  </li>
                )}
                {!requirements.bootstrapComplete && (
                  <li>
                    {isZh ? "Bootstrap 未完成" : "Bootstrap incomplete"}
                    <br />
                    <span style={{ fontSize: "0.85rem", fontStyle: "italic", color: "#999" }}>
                      {isZh
                        ? "💡 正在同步根节点状态，请稍等..."
                        : "💡 Syncing root node state, please wait..."}
                    </span>
                  </li>
                )}
                {!requirements.stablePeers && (
                  <li>
                    {isZh ? "对等节点在线时间不足" : "Peer online duration insufficient"}
                    <br />
                    <span style={{ fontSize: "0.85rem", fontStyle: "italic", color: "#999" }}>
                      {isZh
                        ? "💡 对等节点在线时间未满 2 分钟，请稍等片刻再尝试。"
                        : "💡 Peer online duration less than 2 minutes, please wait a moment before trying again."}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {allRequirementsMet && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "white",
                borderRadius: "6px",
                fontSize: "0.9rem",
                color: "#155724",
              }}
            >
              ✅ {isZh
                ? "所有条件已满足，可以开始挖出第一个区块！"
                : "All conditions met, ready to mine the first block!"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

