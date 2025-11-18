/**
 * P2-2: Accordion Card Component
 * 
 * Reusable accordion component for collapsible content
 */

import { useState } from "react";

interface AccordionCardProps {
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  icon?: string;
  locale: string;
}

export function AccordionCard({
  title,
  defaultExpanded = false,
  children,
  icon,
}: AccordionCardProps) {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  return (
    <div
      className="status-card"
      style={{
        marginBottom: "1rem",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          padding: "0.5rem 0",
          userSelect: "none",
        }}
      >
        <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {icon && <span>{icon}</span>}
          {title}
        </h2>
        <span style={{ fontSize: "1.2rem", transition: "transform 0.2s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>
          ▶
        </span>
      </div>
      {expanded && (
        <div
          style={{
            marginTop: "1rem",
            paddingTop: "1rem",
            borderTop: "1px solid #e9ecef",
            animation: "fadeIn 0.2s ease-in",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

