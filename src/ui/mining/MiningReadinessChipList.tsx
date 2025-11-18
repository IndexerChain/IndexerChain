/**
 * Phase 38: Mining Readiness Chip List
 * 
 * Simplified display of key mining readiness checks
 */

interface MiningReadinessChipListProps {
  readinessInfo: any;
  onShowDetails: () => void;
  locale: string;
}

export function MiningReadinessChipList({
  readinessInfo,
  onShowDetails,
  locale,
}: MiningReadinessChipListProps) {
  const isZh = locale === "zh";

  if (!readinessInfo) {
    return null;
  }

  const chips: Array<{
    key: string;
    icon: string;
    label: string;
    status: "ok" | "warning" | "error";
  }> = [];

  // Bootstrap status
  chips.push({
    key: "bootstrap",
    icon: readinessInfo.bootstrapCompleted ? "✅" : "⏳",
    label: isZh
      ? `Bootstrap: ${readinessInfo.bootstrapCompleted ? "完成" : "进行中"}`
      : `Bootstrap: ${readinessInfo.bootstrapCompleted ? "OK" : "Pending"}`,
    status: readinessInfo.bootstrapCompleted ? "ok" : "warning",
  });

  // Quorum status
  if (readinessInfo.quorumScore !== undefined) {
    const quorumOk = readinessInfo.quorumScore >= readinessInfo.threshold;
    chips.push({
      key: "quorum",
      icon: quorumOk ? "✅" : "⚠️",
      label: isZh
        ? `Quorum: ${readinessInfo.quorumScore} / ${readinessInfo.threshold} (独立 IP: ${readinessInfo.uniquePeers || 0})`
        : `Quorum: ${readinessInfo.quorumScore} / ${readinessInfo.threshold} (Independent IPs: ${readinessInfo.uniquePeers || 0})`,
      status: quorumOk ? "ok" : "warning",
    });
  }

  // Height consensus
  if (readinessInfo.details?.syncStatus === "syncing") {
    chips.push({
      key: "height",
      icon: "⚠️",
      label: isZh
        ? `高度同步: 本地落后 ${readinessInfo.details.behindBy || 0} 个区块`
        : `Height Consensus: local is ${readinessInfo.details.behindBy || 0} blocks behind`,
      status: "warning",
    });
  }

  // Local role
  if (readinessInfo.localRole === "FOLLOWER") {
    chips.push({
      key: "role",
      icon: "❌",
      label: isZh
        ? "本地角色: FOLLOWER (仅 LEADER 可在主网挖矿)"
        : "Local role: FOLLOWER (only LEADER can mine on mainnet)",
      status: "error",
    });
  }

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
          {isZh ? "挖矿就绪检查" : "Mining Readiness Checks"}
        </h3>
        <button
          onClick={onShowDetails}
          style={{
            padding: "0.25rem 0.75rem",
            background: "transparent",
            color: "#667eea",
            border: "1px solid #667eea",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          {isZh ? "查看详情" : "View Details"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        {chips.map((chip) => (
          <div
            key={chip.key}
            style={{
              padding: "0.5rem 0.75rem",
              background:
                chip.status === "ok"
                  ? "rgba(40, 167, 69, 0.1)"
                  : chip.status === "warning"
                  ? "rgba(255, 193, 7, 0.1)"
                  : "rgba(220, 53, 69, 0.1)",
              border: `1px solid ${
                chip.status === "ok"
                  ? "#28a745"
                  : chip.status === "warning"
                  ? "#ffc107"
                  : "#dc3545"
              }`,
              borderRadius: "6px",
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span>{chip.icon}</span>
            <span>{chip.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

