/**
 * Phase 38: Mining Mode Selector
 * 
 * Allows user to choose between Solo, Local Cluster, and Global Pool mining modes
 */

import { useI18n } from "../../i18n/useI18n.js";

interface MiningModeSelectorProps {
  miningMode: "solo" | "cluster" | "global-pool";
  onModeChange: (mode: "solo" | "cluster" | "global-pool") => void;
  isFollower: boolean;
  canUseGlobalPool: boolean;
  globalPoolReason?: string;
  locale: string;
}

export function MiningModeSelector({
  miningMode,
  onModeChange,
  isFollower,
  canUseGlobalPool,
  globalPoolReason,
  locale: _locale,
}: MiningModeSelectorProps) {
  const { t } = useI18n();

  const modes = [
    {
      id: "solo" as const,
      label: t("miningModeSelector.solo"),
      description: t("miningModeSelector.soloDesc"),
      icon: "⛏️",
    },
    {
      id: "cluster" as const,
      label: t("miningModeSelector.localCluster"),
      description: t("miningModeSelector.localClusterDesc"),
      icon: "⚡",
    },
    {
      id: "global-pool" as const,
      label: t("miningModeSelector.globalPool"),
      description: t("miningModeSelector.globalPoolDesc"),
      icon: "🌐",
      disabled: !canUseGlobalPool,
      disabledReason: globalPoolReason || t("miningModeSelector.requiresHigherQuorum"),
    },
  ];

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.1rem" }}>
        {t("miningModeSelector.miningMode")}
      </h3>

      {isFollower && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.75rem",
            background: "#d1ecf1",
            borderRadius: "6px",
            border: "1px solid #17a2b8",
            fontSize: "0.85rem",
            color: "#0c5460",
          }}
        >
          ⚠️ {t("miningModeSelector.followerMiningDisabled")}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
        }}
      >
        {modes.map((mode) => {
          const isSelected = miningMode === mode.id;
          const isDisabled = isFollower || mode.disabled;

          return (
            <div
              key={mode.id}
              onClick={() => !isDisabled && onModeChange(mode.id)}
              style={{
                padding: "1rem",
                background: isSelected
                  ? "rgba(40, 167, 69, 0.1)"
                  : isDisabled
                  ? "#f8f9fa"
                  : "white",
                border: `2px solid ${
                  isSelected
                    ? "#28a745"
                    : isDisabled
                    ? "#dee2e6"
                    : "#e9ecef"
                }`,
                borderRadius: "8px",
                cursor: isDisabled ? "not-allowed" : "pointer",
                opacity: isDisabled ? 0.6 : 1,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!isDisabled) {
                  e.currentTarget.style.borderColor = isSelected ? "#28a745" : "#667eea";
                }
              }}
              onMouseLeave={(e) => {
                if (!isDisabled) {
                  e.currentTarget.style.borderColor = isSelected ? "#28a745" : "#e9ecef";
                }
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  marginBottom: "0.5rem",
                }}
              >
                <div style={{ fontSize: "1.5rem" }}>{mode.icon}</div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontWeight: "bold",
                      fontSize: "1rem",
                      color: isSelected ? "#28a745" : isDisabled ? "#6c757d" : "#333",
                    }}
                  >
                    {mode.label}
                    {isSelected && (
                      <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}>✓</span>
                    )}
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: "0.85rem",
                  color: isDisabled ? "#6c757d" : "#666",
                  marginTop: "0.5rem",
                }}
              >
                {mode.description}
              </div>
              {mode.disabled && mode.disabledReason && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.5rem",
                    background: "#fff3cd",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    color: "#856404",
                  }}
                >
                  ⚠️ {mode.disabledReason}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

