/**
 * Phase 45: Reward Breakdown Card
 * 
 * Shows detailed breakdown of expected block reward:
 * - Base block reward
 * - Global multipliers (IP reputation, Session duration, ActiveBooster)
 * - IP sharing weight
 * - Referral rewards
 * - Total expected reward
 */

import { useState, useEffect } from "react";
import type { ChainContext } from "../../core/chain.js";
import type { P2PNode } from "../../core/p2p.js";
import { getBlockRewardRaw, uIDCToIDC, IDC_BLOCKS_PER_YEAR } from "../../core/idcEmission.js";
import { calculateMiningReward, getSessionTracker } from "../../core/miningRewardMultiplier.js";
import { getActiveBoosterTracker } from "../../core/activeBooster.js";
import { getReferralSystem } from "../../core/referralSystem.js";
import { getIPSharingTracker, getOrCreateDeviceId } from "../../core/ipSharingWeight.js";
import { getQuorumManager } from "../../core/quorumManager.js";

interface RewardBreakdownCardProps {
  chainContext: ChainContext | null;
  p2pNode: P2PNode | null;
  minerAddress: string | null;
  locale: string;
}

export function RewardBreakdownCard({
  chainContext,
  p2pNode,
  minerAddress,
  locale,
}: RewardBreakdownCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [rewardData, setRewardData] = useState<any>(null);
  const isZh = locale === "zh";

  useEffect(() => {
    const calculateReward = async () => {
      if (!chainContext || !minerAddress) {
        setRewardData(null);
        return;
      }

      try {
        const tip = chainContext.storage.getTip();
        if (!tip) return;

        const height = tip.header.height + 1;
        const year = Math.floor(height / Number(IDC_BLOCKS_PER_YEAR));
        
        // Base reward
        const rawBlockRewardUIDC = getBlockRewardRaw(height);
        const baseRewardIDC = uIDCToIDC(rawBlockRewardUIDC);

        // Get QuorumScore
        let quorumScore = 100;
        try {
          const quorumManager = getQuorumManager();
          if (p2pNode) {
            quorumManager.initialize(p2pNode, chainContext);
          }
          const quorumStatus = quorumManager.getQuorumStatus();
          quorumScore = quorumStatus.totalScore > 0 ? Math.max(quorumStatus.totalScore, 80) : 100;
        } catch (e) {
          console.debug("[RewardBreakdownCard] QuorumManager not available");
        }

        // Session duration
        const sessionTracker = getSessionTracker();
        const sessionDuration = sessionTracker.getTotalDuration();

        // Calculate multipliers
        const rewardBreakdown = calculateMiningReward(rawBlockRewardUIDC, quorumScore, sessionDuration);

        // ActiveBooster
        const activeBooster = getActiveBoosterTracker();
        const rawActiveBoosterMultiplier = activeBooster.getMultiplier();
        let activeBoosterCap = 2.0;
        if (year === 0) {
          activeBoosterCap = 1.5;
        } else if (year < 3) {
          activeBoosterCap = 2.0;
        } else {
          activeBoosterCap = 2.5;
        }
        const activeBoosterMultiplier = Math.min(rawActiveBoosterMultiplier, activeBoosterCap);

        // Total multiplier (before hard cap)
        const rawTotalMultiplier = rewardBreakdown.ipReputationMultiplier * 
                                   rewardBreakdown.sessionDurationMultiplier * 
                                   activeBoosterMultiplier;
        const HARD_CAP = 3.0;
        const cappedMultiplier = Math.min(rawTotalMultiplier, HARD_CAP);

        // Miner base reward (after multipliers, before IP sharing)
        const minerBaseRewardUIDC = (rawBlockRewardUIDC * BigInt(Math.floor(cappedMultiplier * 1000))) / 1000n;
        const minerBaseRewardIDC = uIDCToIDC(minerBaseRewardUIDC);

        // IP sharing weight
        let ipSharingWeight = 1.0;
        let ipSharingPosition = 1;
        try {
          const deviceId = getOrCreateDeviceId();
          const ipSharingTracker = getIPSharingTracker();
          
          if (p2pNode) {
            const quorumManager = getQuorumManager();
            quorumManager.initialize(p2pNode, chainContext);
            const quorumStatus = quorumManager.getQuorumStatus();
            const localPeer = quorumStatus.peerMetrics.find((p: any) => p.peerId === p2pNode?.nodeId);
            const ipHash = localPeer?.ipHash || deviceId;
            
            ipSharingPosition = ipSharingTracker.registerMiner(ipHash, deviceId);
            ipSharingWeight = ipSharingTracker.getSharingWeight(ipHash, deviceId);
          }
        } catch (e) {
          console.debug("[RewardBreakdownCard] Failed to calculate IP sharing weight");
        }

        // Final miner reward (after IP sharing)
        const finalMinerRewardUIDC = (minerBaseRewardUIDC * BigInt(Math.floor(ipSharingWeight * 1000))) / 1000n;
        const finalMinerRewardIDC = uIDCToIDC(finalMinerRewardUIDC);

        // Referral rewards
        const referralSystem = getReferralSystem();
        const referralRewards = referralSystem.calculateReferralRewards(
          minerAddress as any,
          finalMinerRewardUIDC,
          height
        );

        let totalReferralRewardIDC = 0;
        let level1ReferralRewardIDC = 0;
        let level2ReferralRewardIDC = 0;
        let validLevel1Count = 0;
        let validLevel2Count = 0;

        for (const refReward of referralRewards) {
          const refRewardIDC = uIDCToIDC(refReward.referralReward);
          totalReferralRewardIDC += refRewardIDC;
          if (refReward.level === 1) {
            level1ReferralRewardIDC += refRewardIDC;
            if (refReward.rewardMultiplier > 0.01) validLevel1Count++;
          } else {
            level2ReferralRewardIDC += refRewardIDC;
            if (refReward.rewardMultiplier > 0.01) validLevel2Count++;
          }
        }

        // Estimated fees (simplified - use average)
        const estimatedFeesIDC = 0; // Would need to calculate from mempool

        const totalRewardIDC = finalMinerRewardIDC + totalReferralRewardIDC + estimatedFeesIDC;

        setRewardData({
          baseRewardIDC,
          year,
          ipReputationMultiplier: rewardBreakdown.ipReputationMultiplier,
          sessionDurationMultiplier: rewardBreakdown.sessionDurationMultiplier,
          activeBoosterMultiplier,
          rawTotalMultiplier,
          cappedMultiplier,
          minerBaseRewardIDC,
          ipSharingWeight,
          ipSharingPosition,
          finalMinerRewardIDC,
          level1ReferralRewardIDC,
          level2ReferralRewardIDC,
          totalReferralRewardIDC,
          validLevel1Count,
          validLevel2Count,
          estimatedFeesIDC,
          totalRewardIDC,
          quorumScore,
          sessionDuration,
          activeBoosterDays: activeBooster.getConsecutiveDays(),
        });
      } catch (error) {
        console.error("[RewardBreakdownCard] Failed to calculate reward:", error);
        setRewardData(null);
      }
    };

    calculateReward();
    const interval = setInterval(calculateReward, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, [chainContext, p2pNode, minerAddress]);

  if (!rewardData) {
    return (
      <div className="status-card" style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ margin: 0, marginBottom: "1rem" }}>
          {isZh ? "💰 预期区块奖励" : "💰 Expected Block Reward"}
        </h3>
        <div style={{ color: "#666", fontSize: "0.9rem" }}>
          {isZh ? "计算中..." : "Calculating..."}
        </div>
      </div>
    );
  }

  return (
    <div className="status-card" style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0 }}>
          {isZh ? "💰 本设备当前预期区块奖励" : "💰 Expected Block Reward (If This Device Mines Next Block)"}
        </h3>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: "0.25rem 0.75rem",
            fontSize: "0.85rem",
            background: "#f8f9fa",
            border: "1px solid #dee2e6",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          {expanded ? (isZh ? "收起" : "Collapse") : (isZh ? "展开详情" : "Expand Details")}
        </button>
      </div>

      {/* Summary Mode (always visible) */}
      <div style={{ marginBottom: expanded ? "1rem" : 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <span style={{ color: "#666" }}>{isZh ? "基础区块奖励" : "Base Block Reward"}:</span>
          <strong>{rewardData.baseRewardIDC.toFixed(2)} IDC</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <span style={{ color: "#666" }}>{isZh ? "总乘数（封顶）" : "Total Multiplier (Capped)"}:</span>
          <strong>{rewardData.cappedMultiplier.toFixed(2)}x</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <span style={{ color: "#666" }}>{isZh ? "预期总奖励" : "Expected Total Reward"}:</span>
          <strong style={{ fontSize: "1.2rem", color: "#28a745" }}>
            ≈ {rewardData.totalRewardIDC.toFixed(2)} IDC
          </strong>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div style={{ borderTop: "1px solid #e0e0e0", paddingTop: "1rem", marginTop: "1rem" }}>
          <div style={{ marginBottom: "1rem" }}>
            <strong style={{ fontSize: "0.9rem", color: "#495057" }}>
              {isZh ? "基础区块奖励" : "Base Block Reward"}
            </strong>
            <div style={{ marginLeft: "1rem", marginTop: "0.25rem", fontSize: "0.85rem", color: "#666" }}>
              {isZh ? `基础: ${rewardData.baseRewardIDC.toFixed(2)} IDC（第${rewardData.year + 1}年）` : `Base: ${rewardData.baseRewardIDC.toFixed(2)} IDC (Year ${rewardData.year + 1})`}
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <strong style={{ fontSize: "0.9rem", color: "#495057" }}>
              {isZh ? "全局乘数（封顶 3.0x）" : "Global Multipliers (Capped at 3.0x)"}
            </strong>
            <div style={{ marginLeft: "1rem", marginTop: "0.5rem", fontSize: "0.85rem" }}>
              <div style={{ marginBottom: "0.25rem" }}>
                {isZh ? "IP 信誉系数" : "IP Reputation"}: <strong>QuorumScore {rewardData.quorumScore}</strong> → <strong>{rewardData.ipReputationMultiplier.toFixed(2)}x</strong>
              </div>
              <div style={{ marginBottom: "0.25rem" }}>
                {isZh ? "在线时长" : "Session Duration"}: <strong>{Math.floor(rewardData.sessionDuration / 60000)} min</strong> → <strong>{rewardData.sessionDurationMultiplier.toFixed(2)}x</strong>
              </div>
              <div style={{ marginBottom: "0.25rem" }}>
                {isZh ? "连续登录" : "ActiveBooster"}: <strong>{rewardData.activeBoosterDays} days</strong> → <strong>{rewardData.activeBoosterMultiplier.toFixed(2)}x</strong>
                {rewardData.year === 0 && (
                  <span style={{ color: "#666", fontSize: "0.75rem", marginLeft: "0.5rem" }}>
                    ({isZh ? "第1年上限: 1.5x" : "Year 1 Cap: 1.5x"})
                  </span>
                )}
              </div>
              <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f8f9fa", borderRadius: "4px" }}>
                {isZh ? "总乘数" : "Total Multiplier"}: <strong>raw = {rewardData.rawTotalMultiplier.toFixed(2)}x</strong> → <strong>capped = {rewardData.cappedMultiplier.toFixed(2)}x</strong>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <strong style={{ fontSize: "0.9rem", color: "#495057" }}>
              {isZh ? "矿工基础奖励" : "Miner Base Reward"}
            </strong>
            <div style={{ marginLeft: "1rem", marginTop: "0.25rem", fontSize: "0.85rem", color: "#666" }}>
              {rewardData.baseRewardIDC.toFixed(2)} × {rewardData.cappedMultiplier.toFixed(2)} = <strong>{rewardData.minerBaseRewardIDC.toFixed(2)} IDC</strong>
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <strong style={{ fontSize: "0.9rem", color: "#495057" }}>
              {isZh ? "IP 共享权重（同 IP 多设备）" : "IP Sharing Weight (Same IP Multiple Devices)"}
            </strong>
            <div style={{ marginLeft: "1rem", marginTop: "0.5rem", fontSize: "0.85rem" }}>
              <div style={{ marginBottom: "0.25rem" }}>
                {isZh ? "当前 IP 同时挖矿设备" : "Concurrent Miners on Same IP"}: <strong>{rewardData.ipSharingPosition}</strong>
              </div>
              <div style={{ marginBottom: "0.25rem" }}>
                {isZh ? "本设备权重" : "This Device Weight"}: <strong>{rewardData.ipSharingWeight.toFixed(1)}x</strong>
              </div>
              <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#fff3cd", borderRadius: "4px" }}>
                {isZh ? "最终矿工奖励" : "Final Miner Reward"}: {rewardData.minerBaseRewardIDC.toFixed(2)} × {rewardData.ipSharingWeight.toFixed(1)} = <strong>{rewardData.finalMinerRewardIDC.toFixed(2)} IDC</strong>
              </div>
            </div>
          </div>

          {(rewardData.totalReferralRewardIDC > 0 || rewardData.validLevel1Count > 0 || rewardData.validLevel2Count > 0) && (
            <div style={{ marginBottom: "1rem" }}>
              <strong style={{ fontSize: "0.9rem", color: "#495057" }}>
                {isZh ? "邀请奖励" : "Referral Rewards"}
              </strong>
              <div style={{ marginLeft: "1rem", marginTop: "0.5rem", fontSize: "0.85rem" }}>
                {rewardData.level1ReferralRewardIDC > 0 && (
                  <div style={{ marginBottom: "0.25rem" }}>
                    {isZh ? "一级邀请奖励" : "Level 1 Referral"}: <strong>+{rewardData.level1ReferralRewardIDC.toFixed(2)} IDC</strong>
                    {rewardData.validLevel1Count > 0 && (
                      <span style={{ color: "#666", fontSize: "0.75rem", marginLeft: "0.5rem" }}>
                        ({isZh ? "有效邀请" : "Valid"}: {rewardData.validLevel1Count})
                      </span>
                    )}
                  </div>
                )}
                {rewardData.level2ReferralRewardIDC > 0 && (
                  <div style={{ marginBottom: "0.25rem" }}>
                    {isZh ? "二级邀请奖励" : "Level 2 Referral"}: <strong>+{rewardData.level2ReferralRewardIDC.toFixed(2)} IDC</strong>
                    {rewardData.validLevel2Count > 0 && (
                      <span style={{ color: "#666", fontSize: "0.75rem", marginLeft: "0.5rem" }}>
                        ({isZh ? "有效邀请" : "Valid"}: {rewardData.validLevel2Count})
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ marginTop: "1rem", padding: "1rem", background: "#d4edda", borderRadius: "6px", border: "1px solid #28a745" }}>
            <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#155724", textAlign: "center" }}>
              💰 {isZh ? "如果本设备挖出下一块，预期总奖励" : "If This Device Mines Next Block, Expected Total Reward"}: <strong>≈ {rewardData.totalRewardIDC.toFixed(2)} IDC</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

