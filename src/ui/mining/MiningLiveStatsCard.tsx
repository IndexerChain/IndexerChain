/**
 * Phase 38: Mining Live Stats Card
 * 
 * Real-time mining statistics display
 */

interface MiningLiveStatsCardProps {
  miningMode: "solo" | "cluster" | "global-pool";
  currentHeight: number;
  tipHash: string;
  totalHashRate: number;
  blocksMined: number;
  blocksAccepted: number;
  blocksRejected: number;
  locale: string;
}

export function MiningLiveStatsCard({
  miningMode,
  currentHeight,
  tipHash,
  totalHashRate,
  blocksMined,
  blocksAccepted,
  blocksRejected,
  locale,
}: MiningLiveStatsCardProps) {
  const isZh = locale === "zh";

  const effectiveRate = blocksMined > 0 ? (blocksAccepted / blocksMined) * 100 : 100;
  const showWarning = effectiveRate < 80 && blocksMined > 0;

  const getModeLabel = () => {
    switch (miningMode) {
      case "solo":
        return isZh ? "单机挖矿" : "Solo";
      case "cluster":
        return isZh ? "本地集群" : "Local Cluster";
      case "global-pool":
        return isZh ? "全局矿池" : "Global Pool";
    }
  };

  return (
    <div
      className="status-card"
      style={{
        marginBottom: "1.5rem",
        background: "rgba(102, 126, 234, 0.05)",
        border: "1px solid #667eea",
      }}
    >
      <h2 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.2rem" }}>
        {isZh ? "📊 实时挖矿统计" : "📊 Live Mining Stats"}
      </h2>

      {showWarning && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.75rem",
            background: "#fff3cd",
            borderRadius: "6px",
            border: "1px solid #ffc107",
            fontSize: "0.85rem",
            color: "#856404",
          }}
        >
          ⚠️{" "}
          {isZh
            ? "警告：许多区块被拒绝。请检查网络健康状态和参数。"
            : "Warning: many blocks are being rejected. Check network health and parameters."}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
        }}
      >
        <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
            {isZh ? "当前模式" : "Current Mode"}
          </div>
          <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#667eea" }}>
            {getModeLabel()}
          </div>
        </div>

        <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
            {isZh ? "当前高度" : "Current Height"}
          </div>
          <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#333" }}>
            {currentHeight}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#999", marginTop: "0.25rem", wordBreak: "break-all" }}>
            {tipHash.substring(0, 16)}...
          </div>
        </div>

        <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
            {isZh ? "算力" : "Hashrate"}
          </div>
          <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#28a745" }}>
            {totalHashRate > 0
              ? `${(totalHashRate / 1000).toFixed(2)} K hash/s`
              : isZh
              ? "计算中..."
              : "Calculating..."}
          </div>
        </div>

        <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
            {isZh ? "区块统计" : "Block Stats"}
          </div>
          <div style={{ fontSize: "0.9rem" }}>
            <div>
              {isZh ? "已挖出" : "Mined"}: <strong>{blocksMined}</strong>
            </div>
            <div style={{ color: "#28a745" }}>
              {isZh ? "已接受" : "Accepted"}: <strong>{blocksAccepted}</strong>
            </div>
            {blocksRejected > 0 && (
              <div style={{ color: "#dc3545" }}>
                {isZh ? "已拒绝" : "Rejected"}: <strong>{blocksRejected}</strong>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "0.75rem", background: "white", borderRadius: "6px" }}>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
            {isZh ? "有效率" : "Effective Rate"}
          </div>
          <div
            style={{
              fontSize: "1.2rem",
              fontWeight: "bold",
              color: effectiveRate >= 80 ? "#28a745" : effectiveRate >= 50 ? "#ffc107" : "#dc3545",
            }}
          >
            {effectiveRate.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}

