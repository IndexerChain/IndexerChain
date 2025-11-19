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
import { MiningGuard } from "../../core/miningGuard.js";
import { useI18n } from "../../i18n/useI18n.js";

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
  locale: _locale,
}: GenesisQuorumBannerProps) {
  const [isGenesis, setIsGenesis] = useState(false);
  const [requirements, setRequirements] = useState<{
    independentPeers: number;
    requiredPeers: number;
    bootstrapComplete: boolean;
    stablePeers: boolean;
  } | null>(null);

  const { t } = useI18n();

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

        // Phase 45: First year mode: Require ≥2 independent peers, Quorum ≥40
        const isFirstYear = chainContext ? MiningGuard.isFirstYear(chainContext) : false;
        const requiredPeers = isFirstYear ? 2 : 2; // First year: min 2 peers (same as normal Genesis)
        
        setRequirements({
          independentPeers: quorumStatus.independentPeerCount,
          requiredPeers: requiredPeers,
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
            {t("genesisQuorum.bootstrapIncomplete")}
          </div>
          <div
            style={{
              fontSize: "0.95rem",
              color: "#666",
              marginBottom: "0.75rem",
              lineHeight: "1.5",
            }}
          >
            {(() => {
              const isFirstYear = chainContext ? MiningGuard.isFirstYear(chainContext) : false;
              if (isFirstYear) {
                return t("genesisQuorum.firstYearModeDesc");
              } else {
                return t("genesisQuorum.normalModeDesc");
              }
            })()}
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
                {t("genesisQuorum.currentStatus")}
              </div>
              <ul style={{ margin: 0, paddingLeft: "1.5rem", color: "#666" }}>
                {requirements.independentPeers < requirements.requiredPeers && (
                  <li>
                    {t("genesisQuorum.independentPeersStatus", { current: requirements.independentPeers, required: requirements.requiredPeers })}
                    <br />
                    <span style={{ fontSize: "0.85rem", fontStyle: "italic", color: "#999" }}>
                      💡 {t("genesisQuorum.onlyOneNodeOnline")}
                    </span>
                  </li>
                )}
                {!requirements.bootstrapComplete && (
                  <li>
                    {t("genesisQuorum.bootstrapIncomplete")}
                    <br />
                    <span style={{ fontSize: "0.85rem", fontStyle: "italic", color: "#999" }}>
                      💡 {t("genesisQuorum.syncingRootNode")}
                    </span>
                  </li>
                )}
                {!requirements.stablePeers && (
                  <li>
                    {t("genesisQuorum.peerOnlineDurationInsufficient")}
                    <br />
                    <span style={{ fontSize: "0.85rem", fontStyle: "italic", color: "#999" }}>
                      💡 {t("genesisQuorum.waitForPeerOnlineDuration")}
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
              ✅ {t("genesisQuorum.allConditionsMet")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

