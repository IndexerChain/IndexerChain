/**
 * Configuration Checker Component
 * 
 * Validates chain configuration and system requirements
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../core/chain.js";

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
  const [checks, setChecks] = useState<ConfigCheckResult[]>([]);
  const [expanded, setExpanded] = useState<boolean>(false);

  useEffect(() => {
    const results: ConfigCheckResult[] = [];

    // System checks
    if (typeof window === "undefined") {
      results.push({
        category: "system",
        name: "Browser Environment",
        status: "error",
        message: "Not running in browser",
      });
    } else {
      results.push({
        category: "system",
        name: "Browser Environment",
        status: "pass",
        message: "Running in browser",
      });
    }

    // WebCrypto API check
    if (typeof crypto === "undefined" || !crypto.subtle) {
      results.push({
        category: "system",
        name: "WebCrypto API",
        status: "error",
        message: "WebCrypto API not available",
        recommendation: "Use a modern browser (Chrome, Firefox, Safari, Edge)",
      });
    } else {
      results.push({
        category: "system",
        name: "WebCrypto API",
        status: "pass",
        message: "WebCrypto API available",
      });
    }

    // Web Worker support
    if (typeof Worker === "undefined") {
      results.push({
        category: "system",
        name: "Web Worker Support",
        status: "warning",
        message: "Web Workers not available",
        recommendation: "Mining will run on main thread (may block UI)",
      });
    } else {
      results.push({
        category: "system",
        name: "Web Worker Support",
        status: "pass",
        message: "Web Workers available",
      });
    }

    // localStorage support
    try {
      localStorage.setItem("test", "test");
      localStorage.removeItem("test");
      results.push({
        category: "storage",
        name: "localStorage",
        status: "pass",
        message: "localStorage available",
      });
    } catch (e) {
      results.push({
        category: "storage",
        name: "localStorage",
        status: "error",
        message: "localStorage not available",
        recommendation: "Enable cookies/localStorage in browser settings",
      });
    }

    // Chain configuration checks
    if (chainContext) {
      const params = chainContext.params;

      // Network ID
      results.push({
        category: "chain",
        name: "Network ID",
        status: "pass",
        message: `Network: ${params.networkId}`,
        value: params.networkId,
      });

      // Difficulty
      if (params.initialDifficulty < 1) {
        results.push({
          category: "chain",
          name: "Initial Difficulty",
          status: "warning",
          message: "Difficulty too low",
          value: params.initialDifficulty,
          recommendation: "Set difficulty >= 1 for security",
        });
      } else {
        results.push({
          category: "chain",
          name: "Initial Difficulty",
          status: "pass",
          message: `Difficulty: ${params.initialDifficulty}`,
          value: params.initialDifficulty,
        });
      }

      // Target block time
      if (params.targetBlockTime < 5 || params.targetBlockTime > 60) {
        results.push({
          category: "chain",
          name: "Target Block Time",
          status: "warning",
          message: "Block time outside recommended range",
          value: params.targetBlockTime,
          recommendation: "Recommended: 5-60 seconds",
        });
      } else {
        results.push({
          category: "chain",
          name: "Target Block Time",
          status: "pass",
          message: `${params.targetBlockTime}s per block`,
          value: params.targetBlockTime,
        });
      }

      // Light node window
      if (params.lightNodeWindow && params.lightNodeWindow < 10) {
        results.push({
          category: "storage",
          name: "Light Node Window",
          status: "warning",
          message: "Window too small",
          value: params.lightNodeWindow,
          recommendation: "Recommended: >= 10 blocks for safety",
        });
      } else if (params.lightNodeWindow) {
        results.push({
          category: "storage",
          name: "Light Node Window",
          status: "pass",
          message: `Keeping ${params.lightNodeWindow} recent blocks`,
          value: params.lightNodeWindow,
        });
      }

      // Snapshot interval
      if (params.snapshotInterval && params.snapshotInterval < 10) {
        results.push({
          category: "storage",
          name: "Snapshot Interval",
          status: "warning",
          message: "Interval too frequent",
          value: params.snapshotInterval,
          recommendation: "Recommended: >= 10 blocks",
        });
      } else if (params.snapshotInterval) {
        results.push({
          category: "storage",
          name: "Snapshot Interval",
          status: "pass",
          message: `Snapshot every ${params.snapshotInterval} blocks`,
          value: params.snapshotInterval,
        });
      }

      // Finality configuration
      if (params.finalityEnabled) {
        if (params.finalityCommitteeSize && (params.finalityCommitteeSize < 7 || params.finalityCommitteeSize > 21)) {
          results.push({
            category: "chain",
            name: "Finality Committee Size",
            status: "warning",
            message: "Committee size outside recommended range",
            value: params.finalityCommitteeSize,
            recommendation: "Recommended: 7-21 members",
          });
        } else {
          results.push({
            category: "chain",
            name: "Finality",
            status: "pass",
            message: `Enabled (${params.finalityCommitteeSize || 11} members)`,
            value: params.finalityEnabled,
          });
        }
      } else {
        results.push({
          category: "chain",
          name: "Finality",
          status: "warning",
          message: "Fast finality disabled",
          recommendation: "Enable for faster confirmation",
        });
      }
    } else {
      results.push({
        category: "chain",
        name: "Chain Context",
        status: "error",
        message: "Chain not initialized",
      });
    }

    // P2P checks
    if (isP2PConnected) {
      results.push({
        category: "p2p",
        name: "P2P Connection",
        status: "pass",
        message: "Connected to network",
      });
    } else {
      results.push({
        category: "p2p",
        name: "P2P Connection",
        status: "warning",
        message: "Not connected",
        recommendation: "Connect to P2P network for block sync",
      });
    }

    // Wallet checks
    if (nodeAddress) {
      results.push({
        category: "wallet",
        name: "Node Address",
        status: "pass",
        message: "Wallet initialized",
        value: nodeAddress.substring(0, 16) + "...",
      });
    } else {
      results.push({
        category: "wallet",
        name: "Node Address",
        status: "error",
        message: "Wallet not initialized",
      });
    }

    // Mining checks
    if (isMining) {
      results.push({
        category: "mining",
        name: "Mining Status",
        status: "pass",
        message: "Mining active",
      });
    }

    setChecks(results);
  }, [chainContext, isP2PConnected, nodeAddress, isMining]);

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
            <strong>Configuration Check</strong>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {passCount}/{totalCount} passed • {warningCount} warnings • {errorCount} errors
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
                {getCategoryIcon(category)} {category.toUpperCase()}
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

