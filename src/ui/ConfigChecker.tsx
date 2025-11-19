/**
 * Configuration Checker Component
 * 
 * Validates chain configuration and system requirements
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../core/chain.js";
import { formatAddress } from "../utils/format.js";
import { useI18n } from "../i18n/useI18n.js";

export interface ConfigCheckResult {
  category: "chain" | "p2p" | "wallet" | "mining" | "storage" | "system";
  name: string;
  status: "pass" | "warning" | "error";
  message: string;
  value?: string | number | boolean;
  recommendation?: string;
}

interface ConfigCheckerProps {
  chainContext: ChainContext | null;
  isP2PConnected: boolean;
  nodeAddress: string;
  isMining: boolean;
}

export function ConfigChecker({ chainContext, isP2PConnected, nodeAddress, isMining }: ConfigCheckerProps) {
  const { t } = useI18n();
  const [checks, setChecks] = useState<ConfigCheckResult[]>([]);
  const [expanded, setExpanded] = useState<boolean>(false);

  useEffect(() => {
    const results: ConfigCheckResult[] = [];

    // System checks
    if (typeof window === "undefined") {
      results.push({
        category: "system",
        name: t("configChecker.browserEnvironment"),
        status: "error",
        message: t("configChecker.notRunningInBrowser"),
      });
    } else {
      results.push({
        category: "system",
        name: t("configChecker.browserEnvironment"),
        status: "pass",
        message: t("configChecker.runningInBrowser"),
      });
    }

    // WebCrypto API check
    if (typeof crypto === "undefined" || !crypto.subtle) {
      results.push({
        category: "system",
        name: t("configChecker.webCryptoApi"),
        status: "error",
        message: t("configChecker.webCryptoApiNotAvailable"),
        recommendation: t("configChecker.webCryptoApiRecommendation"),
      });
    } else {
      results.push({
        category: "system",
        name: t("configChecker.webCryptoApi"),
        status: "pass",
        message: t("configChecker.webCryptoApiAvailable"),
      });
    }

    // Web Worker support
    if (typeof Worker === "undefined") {
      results.push({
        category: "system",
        name: t("configChecker.webWorkerSupport"),
        status: "warning",
        message: t("configChecker.webWorkersNotAvailable"),
        recommendation: t("configChecker.webWorkersRecommendation"),
      });
    } else {
      results.push({
        category: "system",
        name: t("configChecker.webWorkerSupport"),
        status: "pass",
        message: t("configChecker.webWorkersAvailable"),
      });
    }

    // localStorage support
    try {
      localStorage.setItem("test", "test");
      localStorage.removeItem("test");
      results.push({
        category: "storage",
        name: t("configChecker.localStorage"),
        status: "pass",
        message: t("configChecker.localStorageAvailable"),
      });
    } catch (e) {
      results.push({
        category: "storage",
        name: t("configChecker.localStorage"),
        status: "error",
        message: t("configChecker.localStorageNotAvailable"),
        recommendation: t("configChecker.localStorageRecommendation"),
      });
    }

    // Chain configuration checks
    if (chainContext) {
      const params = chainContext.params;

      // Network ID
      results.push({
        category: "chain",
        name: t("configChecker.networkId"),
        status: "pass",
        message: `${t("configChecker.network")}: ${params.networkId}`,
        value: params.networkId,
      });

      // Difficulty
      if (params.initialDifficulty < 1) {
        results.push({
          category: "chain",
          name: t("configChecker.initialDifficulty"),
          status: "warning",
          message: t("configChecker.difficultyTooLow"),
          value: params.initialDifficulty,
          recommendation: t("configChecker.difficultyRecommendation"),
        });
      } else {
        results.push({
          category: "chain",
          name: t("configChecker.initialDifficulty"),
          status: "pass",
          message: `${t("configChecker.difficulty")}: ${params.initialDifficulty}`,
          value: params.initialDifficulty,
        });
      }

      // Target block time
      if (params.targetBlockTime < 5 || params.targetBlockTime > 60) {
        results.push({
          category: "chain",
          name: t("configChecker.targetBlockTime"),
          status: "warning",
          message: t("configChecker.blockTimeOutsideRange"),
          value: params.targetBlockTime,
          recommendation: t("configChecker.blockTimeRecommendation"),
        });
      } else {
        results.push({
          category: "chain",
          name: t("configChecker.targetBlockTime"),
          status: "pass",
          message: t("configChecker.secondsPerBlock", { seconds: params.targetBlockTime }),
          value: params.targetBlockTime,
        });
      }

      // Light node window
      if (params.lightNodeWindow && params.lightNodeWindow < 10) {
        results.push({
          category: "storage",
          name: t("configChecker.lightNodeWindow"),
          status: "warning",
          message: t("configChecker.windowTooSmall"),
          value: params.lightNodeWindow,
          recommendation: t("configChecker.windowRecommendation"),
        });
      } else if (params.lightNodeWindow) {
        results.push({
          category: "storage",
          name: t("configChecker.lightNodeWindow"),
          status: "pass",
          message: t("configChecker.keepingRecentBlocks", { count: params.lightNodeWindow }),
          value: params.lightNodeWindow,
        });
      }

      // Snapshot interval
      if (params.snapshotInterval && params.snapshotInterval < 10) {
        results.push({
          category: "storage",
          name: t("configChecker.snapshotInterval"),
          status: "warning",
          message: t("configChecker.intervalTooFrequent"),
          value: params.snapshotInterval,
          recommendation: t("configChecker.intervalRecommendation"),
        });
      } else if (params.snapshotInterval) {
        results.push({
          category: "storage",
          name: t("configChecker.snapshotInterval"),
          status: "pass",
          message: t("configChecker.snapshotEveryBlocks", { count: params.snapshotInterval }),
          value: params.snapshotInterval,
        });
      }

      // Finality configuration
      if (params.finalityEnabled) {
        if (params.finalityCommitteeSize && (params.finalityCommitteeSize < 7 || params.finalityCommitteeSize > 21)) {
          results.push({
            category: "chain",
            name: t("configChecker.finalityCommitteeSize"),
            status: "warning",
            message: t("configChecker.committeeSizeOutsideRange"),
            value: params.finalityCommitteeSize,
            recommendation: t("configChecker.committeeSizeRecommendation"),
          });
        } else {
          results.push({
            category: "chain",
            name: t("configChecker.finality"),
            status: "pass",
            message: t("configChecker.finalityEnabled", { count: params.finalityCommitteeSize || 11 }),
            value: params.finalityEnabled,
          });
        }
      } else {
        results.push({
          category: "chain",
          name: t("configChecker.finality"),
          status: "warning",
          message: t("configChecker.finalityDisabled"),
          recommendation: t("configChecker.finalityRecommendation"),
        });
      }
    } else {
      results.push({
        category: "chain",
        name: t("configChecker.chainContext"),
        status: "error",
        message: t("configChecker.chainNotInitialized"),
      });
    }

    // P2P checks
    if (isP2PConnected) {
      results.push({
        category: "p2p",
        name: t("configChecker.p2pConnection"),
        status: "pass",
        message: t("configChecker.connectedToNetwork"),
      });
    } else {
      results.push({
        category: "p2p",
        name: t("configChecker.p2pConnection"),
        status: "warning",
        message: t("configChecker.notConnected"),
        recommendation: t("configChecker.p2pRecommendation"),
      });
    }

    // Wallet checks
    if (nodeAddress) {
      results.push({
        category: "wallet",
        name: t("configChecker.nodeAddress"),
        status: "pass",
        message: t("configChecker.walletInitialized"),
        value: formatAddress(nodeAddress, 8, 8),
      });
    } else {
      results.push({
        category: "wallet",
        name: t("configChecker.nodeAddress"),
        status: "error",
        message: t("configChecker.walletNotInitialized"),
      });
    }

    // Mining checks
    if (isMining) {
      results.push({
        category: "mining",
        name: t("configChecker.miningStatus"),
        status: "pass",
        message: t("configChecker.miningActive"),
      });
    }

    setChecks(results);
  }, [chainContext, isP2PConnected, nodeAddress, isMining, t]);

  const passCount = checks.filter((c) => c.status === "pass").length;
  const warningCount = checks.filter((c) => c.status === "warning").length;
  const errorCount = checks.filter((c) => c.status === "error").length;
  const totalCount = checks.length;
  const healthScore = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : 0;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pass":
        return "✅";
      case "warning":
        return "⚠️";
      case "error":
        return "❌";
      default:
        return "❓";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pass":
        return "#28a745";
      case "warning":
        return "#ffc107";
      case "error":
        return "#dc3545";
      default:
        return "#666";
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "chain":
        return "⛓️";
      case "p2p":
        return "🌐";
      case "wallet":
        return "💼";
      case "mining":
        return "⛏️";
      case "storage":
        return "💾";
      case "system":
        return "🖥️";
      default:
        return "📋";
    }
  };

  const getCategoryName = (category: string) => {
    switch (category) {
      case "system":
        return t("configChecker.categorySystem");
      case "storage":
        return t("configChecker.categoryStorage");
      case "chain":
        return t("configChecker.categoryChain");
      case "p2p":
        return t("configChecker.categoryP2p");
      case "wallet":
        return t("configChecker.categoryWallet");
      case "mining":
        return t("configChecker.categoryMining");
      default:
        return category.toUpperCase();
    }
  };

  const groupedChecks = checks.reduce((acc, check) => {
    if (!acc[check.category]) {
      acc[check.category] = [];
    }
    acc[check.category].push(check);
    return acc;
  }, {} as Record<string, ConfigCheckResult[]>);

  return (
    <div className="config-checker">
      <div
        className="config-checker-header"
        onClick={() => setExpanded(!expanded)}
        style={{
          cursor: "pointer",
          padding: "1rem",
          background: healthScore === 100 ? "#d4edda" : healthScore >= 70 ? "#fff3cd" : "#f8d7da",
          borderRadius: "8px",
          border: `2px solid ${healthScore === 100 ? "#28a745" : healthScore >= 70 ? "#ffc107" : "#dc3545"}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: expanded ? "1rem" : "0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.5rem" }}>
            {healthScore === 100 ? "✅" : healthScore >= 70 ? "⚠️" : "❌"}
          </span>
          <div>
            <strong>{t("configChecker.title")}</strong>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {passCount}/{totalCount} {t("configChecker.passed")} • {warningCount} {t("configChecker.warnings")} • {errorCount} {t("configChecker.errors")}
            </div>
          </div>
        </div>
        <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: getStatusColor(healthScore >= 70 ? "pass" : "error") }}>
          {healthScore}%
        </div>
      </div>

      {expanded && (
        <div className="config-checker-content" style={{ marginTop: "1rem" }}>
          {Object.entries(groupedChecks).map(([category, categoryChecks]) => (
            <div key={category} style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem", color: "#333", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {getCategoryIcon(category)} {getCategoryName(category)}
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {categoryChecks.map((check, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "0.75rem",
                      background: "#f8f9fa",
                      borderRadius: "6px",
                      borderLeft: `4px solid ${getStatusColor(check.status)}`,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                          <span>{getStatusIcon(check.status)}</span>
                          <strong>{check.name}</strong>
                          {check.value !== undefined && (
                            <span style={{ fontSize: "0.85rem", color: "#666", marginLeft: "0.5rem" }}>
                              ({check.value})
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "0.9rem", color: "#666", marginLeft: "1.5rem" }}>
                          {check.message}
                        </div>
                        {check.recommendation && (
                          <div
                            style={{
                              fontSize: "0.85rem",
                              color: "#856404",
                              marginTop: "0.25rem",
                              marginLeft: "1.5rem",
                              padding: "0.5rem",
                              background: "#fff3cd",
                              borderRadius: "4px",
                            }}
                          >
                            💡 {check.recommendation}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

