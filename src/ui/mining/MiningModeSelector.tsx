/**
 * Phase 38: Mining Mode Selector
 * 
 * Allows user to choose between Solo, Local Cluster, and Global Pool mining modes
 */

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
  locale,
}: MiningModeSelectorProps) {
  const isZh = locale === "zh";

  const modes = [
    {
      id: "solo" as const,
      label: isZh ? "单机挖矿" : "Solo",
      description: isZh
        ? "使用单个 Worker 进行挖矿，适合低功耗设备"
        : "Mine with a single worker, suitable for low-power devices",
      icon: "⛏️",
    },
    {
      id: "cluster" as const,
      label: isZh ? "本地集群" : "Local Cluster",
      description: isZh
        ? "使用多个 Worker 并行挖矿，提高算力"
        : "Use multiple workers for parallel mining, higher hash rate",
      icon: "⚡",
    },
    {
      id: "global-pool" as const,
      label: isZh ? "全局矿池" : "Global Pool",
      description: isZh
        ? "加入全局矿池，与其他节点协作挖矿"
        : "Join global pool, collaborate with other nodes",
      icon: "🌐",
      disabled: !canUseGlobalPool,
      disabledReason: globalPoolReason || (isZh ? "需要更高的 Quorum 分数" : "Requires higher Quorum score"),
    },
  ];

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.1rem" }}>
        {isZh ? "挖矿模式" : "Mining Mode"}
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
          {isZh
            ? "⚠️ 此实例为 FOLLOWER（只读模式），所有挖矿模式已禁用"
            : "⚠️ This instance is FOLLOWER (read-only), all mining modes are disabled"}
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

