/**
 * Phase 38: Mining Warnings Panel
 * 
 * Aggregates warnings and errors from MiningGuard, MinerCluster, and RuntimeManager
 */

interface MiningWarningsPanelProps {
  warnings: Array<{
    type: "error" | "warning" | "info";
    message: string;
    source: "MiningGuard" | "MinerCluster" | "RuntimeManager";
  }>;
  locale: string;
}

export function MiningWarningsPanel({
  warnings,
  locale,
}: MiningWarningsPanelProps) {
  const isZh = locale === "zh";

  if (warnings.length === 0) {
    return (
      <div
        style={{
          padding: "0.75rem",
          background: "rgba(40, 167, 69, 0.1)",
          borderRadius: "6px",
          border: "1px solid #28a745",
          fontSize: "0.85rem",
          color: "#155724",
        }}
      >
        ✅ {isZh ? "所有系统正常" : "All systems nominal"}
      </div>
    );
  }

  const errors = warnings.filter((w) => w.type === "error");
  const warningsList = warnings.filter((w) => w.type === "warning");
  const infos = warnings.filter((w) => w.type === "info");

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.1rem" }}>
        {isZh ? "⚠️ 警告与错误" : "⚠️ Warnings & Errors"}
      </h3>

      {errors.length > 0 && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "1rem",
            background: "rgba(220, 53, 69, 0.1)",
            borderRadius: "8px",
            border: "1px solid #dc3545",
          }}
        >
          <div style={{ fontWeight: "bold", color: "#dc3545", marginBottom: "0.5rem" }}>
            {isZh ? "❌ 错误" : "❌ Errors"}
          </div>
          {errors.map((error, idx) => (
            <div key={idx} style={{ fontSize: "0.85rem", color: "#721c24", marginTop: "0.25rem" }}>
              • {error.message}
            </div>
          ))}
        </div>
      )}

      {warningsList.length > 0 && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "1rem",
            background: "rgba(255, 193, 7, 0.1)",
            borderRadius: "8px",
            border: "1px solid #ffc107",
          }}
        >
          <div style={{ fontWeight: "bold", color: "#856404", marginBottom: "0.5rem" }}>
            {isZh ? "⚠️ 警告" : "⚠️ Warnings"}
          </div>
          {warningsList.map((warning, idx) => (
            <div key={idx} style={{ fontSize: "0.85rem", color: "#856404", marginTop: "0.25rem" }}>
              • {warning.message}
            </div>
          ))}
        </div>
      )}

      {infos.length > 0 && (
        <div
          style={{
            padding: "1rem",
            background: "rgba(0, 123, 255, 0.1)",
            borderRadius: "8px",
            border: "1px solid #007bff",
          }}
        >
          <div style={{ fontWeight: "bold", color: "#004085", marginBottom: "0.5rem" }}>
            {isZh ? "ℹ️ 信息" : "ℹ️ Info"}
          </div>
          {infos.map((info, idx) => (
            <div key={idx} style={{ fontSize: "0.85rem", color: "#004085", marginTop: "0.25rem" }}>
              • {info.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

