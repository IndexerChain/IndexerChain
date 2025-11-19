import { useState } from "react";

interface QuorumScoreExplanationProps {
  passed: boolean;
  currentScore: number;
  requiredScore: number;
  locale: string;
  isFirstYearMode?: boolean;
}

export function QuorumScoreExplanation({
  passed,
  currentScore,
  requiredScore,
  locale,
  isFirstYearMode = false,
}: QuorumScoreExplanationProps) {
  const [showExplanation, setShowExplanation] = useState<boolean>(false);
  const isZh = locale === "zh";

  return (
    <li
      style={{
        marginBottom: "0.75rem",
        padding: "0.75rem",
        background: passed ? "rgba(40, 167, 69, 0.1)" : "rgba(220, 53, 69, 0.1)",
        borderRadius: "6px",
        border: `1px solid ${passed ? "#28a745" : "#dc3545"}`,
        color: passed ? "#155724" : "#721c24",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "1.2rem" }}>{passed ? "✅" : "❌"}</span>
        <span style={{ fontWeight: "bold", flex: 1, minWidth: 0 }}>
          {isZh
            ? `规则 2: Quorum 分数需要 ≥ ${requiredScore} (当前: ${currentScore})${isFirstYearMode ? "（第一年模式）" : ""}`
            : `Rule 2: Quorum score must be ≥ ${requiredScore} (current: ${currentScore})${isFirstYearMode ? " (First Year Mode)" : ""}`}
        </span>
        <button
          onClick={() => setShowExplanation(!showExplanation)}
          style={{
            padding: "0.25rem 0.5rem",
            background: "transparent",
            border: `1px solid ${passed ? "#28a745" : "#dc3545"}`,
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "0.75rem",
            color: passed ? "#155724" : "#721c24",
            whiteSpace: "nowrap",
            minHeight: "28px",
          }}
        >
          {showExplanation
            ? (isZh ? "隐藏说明" : "Hide Explanation")
            : (isZh ? "如何获得分数？" : "How is score calculated?")}
        </button>
      </div>
      {showExplanation && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem",
            background: "rgba(255, 255, 255, 0.5)",
            borderRadius: "4px",
            fontSize: "0.85rem",
            lineHeight: "1.6",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
            {isZh ? "Quorum 分数计算方式：" : "Quorum Score Calculation:"}
            {isFirstYearMode && (
              <span style={{ fontSize: "0.85rem", fontWeight: "normal", marginLeft: "0.5rem", color: "#856404" }}>
                {isZh ? "（第一年模式）" : " (First Year Mode)"}
              </span>
            )}
          </div>
          <div style={{ marginLeft: "0.5rem" }}>
            <div style={{ marginBottom: "0.25rem" }}>
              {isZh
                ? "• IP 独立性：0-30 分（不同 IP 地址 = 30 分，相同 IP = 0 分）"
                : "• IP Independence: 0-30 points (different IP = 30, same IP = 0)"}
            </div>
            <div style={{ marginBottom: "0.25rem" }}>
              {isZh
                ? "• 可用性：0-20 分（在线 > 2 分钟 = 20 分）"
                : "• Availability: 0-20 points (online > 2 minutes = 20)"}
            </div>
            <div style={{ marginBottom: "0.25rem" }}>
              {isZh
                ? isFirstYearMode
                  ? "• 高度可靠性：0-15 分（第一年：默认 15 分，即使高度未知）"
                  : "• 高度可靠性：0-20 分（高度匹配多数 = 20 分）"
                : isFirstYearMode
                  ? "• Height Reliability: 0-15 points (First Year: default 15, even if height unknown)"
                  : "• Height Reliability: 0-20 points (height matches majority = 20)"}
            </div>
            <div style={{ marginBottom: "0.25rem" }}>
              {isZh
                ? isFirstYearMode
                  ? "• 延迟：0-10 分（第一年：默认 ≥5 分，<200ms = 10 分）"
                  : "• 延迟：0-10 分（< 200ms = 10 分）"
                : isFirstYearMode
                  ? "• Latency: 0-10 points (First Year: default ≥5, <200ms = 10)"
                  : "• Latency: 0-10 points (< 200ms = 10)"}
            </div>
            {!isFirstYearMode && (
              <>
                <div style={{ marginBottom: "0.25rem" }}>
                  {isZh
                    ? "• 最终性参与：0-10 分（参与最终性投票）"
                    : "• Finality Participation: 0-10 points (participates in finality votes)"}
                </div>
                <div style={{ marginBottom: "0.5rem" }}>
                  {isZh
                    ? "• GSN 贡献：0-10 分（提供快照区块）"
                    : "• GSN Contribution: 0-10 points (serves snapshot chunks)"}
                </div>
              </>
            )}
            {isFirstYearMode && (
              <div style={{ marginBottom: "0.5rem", fontStyle: "italic", color: "#856404" }}>
                {isZh
                  ? "• 第一年模式：最终性参与和 GSN 贡献不计分（固定 0 分）"
                  : "• First Year Mode: Finality Participation and GSN Contribution not counted (fixed 0)"}
              </div>
            )}
            <div
              style={{
                marginTop: "0.5rem",
                paddingTop: "0.5rem",
                borderTop: "1px solid rgba(0,0,0,0.1)",
                fontStyle: "italic",
                fontSize: "0.8rem",
              }}
            >
              {isZh
                ? isFirstYearMode
                  ? "第一年模式：每个节点最高 75 分（30+20+15+10），总分数 = 所有节点的分数之和。要求 ≥50 分即可挖矿。"
                  : "每个节点最高 100 分，总分数 = 所有节点的分数之和"
                : isFirstYearMode
                  ? "First Year Mode: Each peer can score up to 75 points (30+20+15+10). Total score = sum of all peer scores. Require ≥50 to mine."
                  : "Each peer can score up to 100 points. Total score = sum of all peer scores"}
            </div>
            {isFirstYearMode && (
              <div
                style={{
                  marginTop: "0.5rem",
                  padding: "0.5rem",
                  background: "rgba(255, 193, 7, 0.1)",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                  color: "#856404",
                }}
              >
                {isZh
                  ? "💡 第一年规则更宽松，便于网络启动。第二年后将自动恢复严格模式（要求 ≥100 分，3 个独立节点）。"
                  : "💡 First year rules are more relaxed for easier network startup. After year 1, strict mode will be automatically enabled (require ≥100 score, 3 independent peers)."}
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

