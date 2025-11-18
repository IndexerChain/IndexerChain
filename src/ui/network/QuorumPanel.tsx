/**
 * Phase 34: Quorum Status Panel
 * 
 * Displays quorum score, peer analysis, and mining readiness information
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { getQuorumManager, type QuorumStatus } from "../../core/quorumManager.js";

interface QuorumPanelProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  locale: string;
}

export function QuorumPanel({ chainContext, p2pNode, locale }: QuorumPanelProps) {
  const [quorumStatus, setQuorumStatus] = useState<QuorumStatus | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);

  const isZh = locale === "zh";

  useEffect(() => {
    if (!chainContext || !p2pNode) {
      setQuorumStatus(null);
      return;
    }

    const quorumManager = getQuorumManager();
    quorumManager.initialize(p2pNode, chainContext);

    const updateStatus = () => {
      const status = quorumManager.getQuorumStatus();
      setQuorumStatus(status);
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [chainContext, p2pNode]);

  if (!quorumStatus) {
    return null;
  }

  const getScoreColor = (score: number, required: number): string => {
    if (score < 80) return "#dc3545"; // Red
    if (score < required) return "#ffc107"; // Yellow
    if (score >= 300) return "#17a2b8"; // Blue (strong network)
    return "#28a745"; // Green
  };

  const getScoreLabel = (score: number, required: number): string => {
    if (score < 80) return isZh ? "❌ 不可挖矿" : "❌ Cannot Mine";
    if (score < required) return isZh ? "🟡 冷启动模式" : "🟡 Cold Start";
    if (score >= 300) return isZh ? "🔵 强网络" : "🔵 Strong Network";
    return isZh ? "🟢 可挖矿" : "🟢 Ready to Mine";
  };

  const scoreColor = getScoreColor(quorumStatus.totalScore, quorumStatus.requiredScore);
  const scoreLabel = getScoreLabel(quorumStatus.totalScore, quorumStatus.requiredScore);

  return (
    <div className="status-card" style={{ marginBottom: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          padding: "1rem",
          background: quorumStatus.ready ? "rgba(40, 167, 69, 0.1)" : "rgba(220, 53, 69, 0.1)",
          borderRadius: "8px",
          border: `2px solid ${scoreColor}`,
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <h3 style={{ margin: 0, marginBottom: "0.5rem", fontSize: "1.1rem" }}>
            {isZh ? "🔵 Quorum 状态" : "🔵 Quorum Status"}
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <span style={{ fontSize: "0.9rem", color: "#666" }}>
                {isZh ? "总分:" : "Total Score:"}
              </span>
              <span
                style={{
                  fontSize: "1.5rem",
                  fontWeight: "bold",
                  color: scoreColor,
                  marginLeft: "0.5rem",
                }}
              >
                {quorumStatus.totalScore}
              </span>
              <span style={{ fontSize: "0.9rem", color: "#666", marginLeft: "0.5rem" }}>
                / {quorumStatus.requiredScore}
              </span>
            </div>
            <div>
              <span style={{ fontSize: "0.9rem", color: "#666" }}>
                {isZh ? "独立 Peer:" : "Unique Peers:"}
              </span>
              <span style={{ fontSize: "1.2rem", fontWeight: "bold", marginLeft: "0.5rem" }}>
                {quorumStatus.independentPeerCount} / {quorumStatus.peerCount}
              </span>
            </div>
            <div>
              <span style={{ fontSize: "1rem", fontWeight: "bold", color: scoreColor }}>
                {scoreLabel}
              </span>
            </div>
          </div>
        </div>
        <div style={{ fontSize: "1.5rem" }}>{expanded ? "▼" : "▶"}</div>
      </div>

      {expanded && (
        <div style={{ padding: "1rem", marginTop: "1rem", background: "#f8f9fa", borderRadius: "8px" }}>
          {/* Score Breakdown */}
          <div style={{ marginBottom: "1.5rem" }}>
            <h4 style={{ margin: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
              {isZh ? "分数详情" : "Score Breakdown"}
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
              <div style={{ padding: "0.5rem", background: "white", borderRadius: "4px" }}>
                <div style={{ fontSize: "0.85rem", color: "#666" }}>
                  {isZh ? "需要分数" : "Required Score"}
                </div>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                  {quorumStatus.requiredScore}
                </div>
              </div>
              <div style={{ padding: "0.5rem", background: "white", borderRadius: "4px" }}>
                <div style={{ fontSize: "0.85rem", color: "#666" }}>
                  {isZh ? "当前分数" : "Current Score"}
                </div>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: scoreColor }}>
                  {quorumStatus.totalScore}
                </div>
              </div>
              <div style={{ padding: "0.5rem", background: "white", borderRadius: "4px" }}>
                <div style={{ fontSize: "0.85rem", color: "#666" }}>
                  {isZh ? "独立 Peer 数" : "Independent Peers"}
                </div>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                  {quorumStatus.independentPeerCount}
                </div>
              </div>
            </div>
          </div>

          {/* Peer Analysis Table */}
          {quorumStatus.peerMetrics.length > 0 && (
            <div>
              <h4 style={{ margin: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
                {isZh ? "Peer 分析表" : "Peer Analysis"}
              </h4>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ background: "#e9ecef", borderBottom: "2px solid #dee2e6" }}>
                      <th style={{ padding: "0.5rem", textAlign: "left" }}>
                        {isZh ? "Peer ID" : "Peer ID"}
                      </th>
                      <th style={{ padding: "0.5rem", textAlign: "left" }}>
                        {isZh ? "IP Hash" : "IP Hash"}
                      </th>
                      <th style={{ padding: "0.5rem", textAlign: "center" }}>
                        {isZh ? "分数" : "Score"}
                      </th>
                      <th style={{ padding: "0.5rem", textAlign: "center" }}>
                        {isZh ? "延迟" : "Latency"}
                      </th>
                      <th style={{ padding: "0.5rem", textAlign: "center" }}>
                        {isZh ? "在线时间" : "Online"}
                      </th>
                      <th style={{ padding: "0.5rem", textAlign: "center" }}>
                        {isZh ? "状态" : "Status"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {quorumStatus.peerMetrics.map((peer, idx) => {
                      const isHealthy = peer.quorumScore >= 50;
                      const statusIcon = isHealthy ? "🟢" : peer.quorumScore >= 20 ? "🟡" : "🔴";
                      
                      return (
                        <tr
                          key={peer.peerId}
                          style={{
                            borderBottom: "1px solid #dee2e6",
                            background: idx % 2 === 0 ? "white" : "#f8f9fa",
                          }}
                        >
                          <td style={{ padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                            {peer.peerId.substring(0, 16)}...
                          </td>
                          <td style={{ padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                            {peer.ipHash || "-"}
                          </td>
                          <td style={{ padding: "0.5rem", textAlign: "center", fontWeight: "bold" }}>
                            {peer.quorumScore}
                          </td>
                          <td style={{ padding: "0.5rem", textAlign: "center" }}>
                            {peer.avgLatencyMs ? `${Math.round(peer.avgLatencyMs)}ms` : "-"}
                          </td>
                          <td style={{ padding: "0.5rem", textAlign: "center" }}>
                            {Math.floor(peer.onlineDuration / 1000 / 60)}m
                          </td>
                          <td style={{ padding: "0.5rem", textAlign: "center", fontSize: "1.2rem" }}>
                            {statusIcon}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Why Quorum Not Ready */}
          {!quorumStatus.ready && quorumStatus.reason && (
            <div
              style={{
                marginTop: "1rem",
                padding: "1rem",
                background: "#fff3cd",
                borderRadius: "8px",
                border: "1px solid #ffc107",
              }}
            >
              <h4 style={{ margin: 0, marginBottom: "0.5rem", color: "#856404" }}>
                {isZh ? "❌ Quorum 不足原因" : "❌ Quorum Not Ready"}
              </h4>
              <p style={{ margin: 0, color: "#856404", fontSize: "0.9rem" }}>
                {quorumStatus.reason}
              </p>
              <div style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "#856404" }}>
                <strong>{isZh ? "如何提升:" : "How to improve:"}</strong>
                <ul style={{ margin: "0.5rem 0", paddingLeft: "1.5rem" }}>
                  <li>
                    {isZh
                      ? "连接更多来自不同 IP 的 peer"
                      : "Connect to more peers from different IPs"}
                  </li>
                  <li>
                    {isZh
                      ? "保持节点在线时间 > 2 分钟"
                      : "Keep node online for > 2 minutes"}
                  </li>
                  <li>
                    {isZh
                      ? "参与 Finality 投票和 GSN 快照服务"
                      : "Participate in Finality votes and GSN snapshot serving"}
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

