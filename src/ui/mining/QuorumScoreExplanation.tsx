import { useState } from "react";
import { useI18n } from "../../i18n/useI18n.js";

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
  locale: _locale,
  isFirstYearMode = false,
}: QuorumScoreExplanationProps) {
  const [showExplanation, setShowExplanation] = useState<boolean>(false);
  const { t } = useI18n();

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
          {t("quorumScore.rule2", { required: requiredScore, current: currentScore })}
          {isFirstYearMode && ` ${t("quorumScore.firstYearMode")}`}
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
            ? t("quorumScore.hideExplanation")
            : t("quorumScore.howToGetScore")}
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
            {t("quorumScore.calculationTitle")}
            {isFirstYearMode && (
              <span style={{ fontSize: "0.85rem", fontWeight: "normal", marginLeft: "0.5rem", color: "#856404" }}>
                {t("quorumScore.firstYearMode")}
              </span>
            )}
          </div>
          <div style={{ marginLeft: "0.5rem" }}>
            <div style={{ marginBottom: "0.25rem" }}>
              {t("quorumScore.ipIndependence")}
            </div>
            <div style={{ marginBottom: "0.25rem" }}>
              {t("quorumScore.availability")}
            </div>
            <div style={{ marginBottom: "0.25rem" }}>
              {isFirstYearMode
                ? t("quorumScore.heightReliabilityFirstYear")
                : t("quorumScore.heightReliability")}
            </div>
            <div style={{ marginBottom: "0.25rem" }}>
              {isFirstYearMode
                ? t("quorumScore.latencyFirstYear")
                : t("quorumScore.latency")}
            </div>
            {!isFirstYearMode && (
              <>
                <div style={{ marginBottom: "0.25rem" }}>
                  {t("quorumScore.finalityParticipation")}
                </div>
                <div style={{ marginBottom: "0.5rem" }}>
                  {t("quorumScore.gsnContribution")}
                </div>
              </>
            )}
            {isFirstYearMode && (
              <div style={{ marginBottom: "0.5rem", fontStyle: "italic", color: "#856404" }}>
                {t("quorumScore.firstYearModeNote")}
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
              {isFirstYearMode
                ? t("quorumScore.summaryFirstYear")
                : t("quorumScore.summaryNormal")}
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
                {t("quorumScore.firstYearRelaxedNote")}
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

