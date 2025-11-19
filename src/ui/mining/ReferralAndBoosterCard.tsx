/**
 * Phase 45: Referral & Booster Card
 * 
 * Shows:
 * - Referral rewards overview (total, cap status)
 * - Referral status (invite code, valid/pending invites)
 * - ActiveBooster progress (consecutive days, next tier)
 * - Tips for maximizing rewards
 */

import { useState, useEffect } from "react";
import { getReferralSystem } from "../../core/referralSystem.js";
import { getActiveBoosterTracker } from "../../core/activeBooster.js";
import { IDC_MAX_SUPPLY, IDC_BLOCKS_PER_YEAR } from "../../core/idcEmission.js";
import { uIDCToIDC } from "../../core/idcEmission.js";

interface ReferralAndBoosterCardProps {
  minerAddress: string | null;
  currentHeight: number;
  locale: string;
}

export function ReferralAndBoosterCard({
  minerAddress,
  currentHeight,
  locale,
}: ReferralAndBoosterCardProps) {
  const [referralData, setReferralData] = useState<any>(null);
  const [activeBoosterData, setActiveBoosterData] = useState<any>(null);
  const isZh = locale === "zh";

  useEffect(() => {
    const updateData = () => {
      if (!minerAddress) {
        setReferralData(null);
        setActiveBoosterData(null);
        return;
      }

      try {
        // Get referral stats
        const referralSystem = getReferralSystem();
        const referralStats = referralSystem.getReferralStats(minerAddress as any);
        
        // Calculate referral reward caps
        const level1Cap = (IDC_MAX_SUPPLY * BigInt(10)) / 1000n; // 1% of total supply
        const level2Cap = (IDC_MAX_SUPPLY * BigInt(5)) / 1000n; // 0.5% of total supply

        // Get referral rewards (simplified - would need to track actual rewards)
        // For now, we'll show placeholder data
        const level1RewardUIDC = 0n; // Would need to track from actual rewards
        const level2RewardUIDC = 0n;
        const level1RewardIDC = uIDCToIDC(level1RewardUIDC);
        const level2RewardIDC = uIDCToIDC(level2RewardUIDC);
        const level1CapIDC = uIDCToIDC(level1Cap);
        const level2CapIDC = uIDCToIDC(level2Cap);

        setReferralData({
          level1Count: referralStats.level1Count,
          level2Count: referralStats.level2Count,
          totalInvitees: referralStats.totalInvitees,
          level1RewardIDC,
          level2RewardIDC,
          level1CapIDC,
          level2CapIDC,
          level1Percent: (level1RewardIDC / level1CapIDC) * 100,
          level2Percent: (level2RewardIDC / level2CapIDC) * 100,
        });

        // Get ActiveBooster data
        const activeBooster = getActiveBoosterTracker();
        const consecutiveDays = activeBooster.getConsecutiveDays();
        const multiplier = activeBooster.getMultiplier();
        
        // Calculate year for cap
        const year = Math.floor(currentHeight / Number(IDC_BLOCKS_PER_YEAR));
        let activeBoosterCap = 2.0;
        if (year === 0) {
          activeBoosterCap = 1.5;
        } else if (year < 3) {
          activeBoosterCap = 2.0;
        } else {
          activeBoosterCap = 2.5;
        }

        // Calculate next tier
        let nextTierDays = 0;
        let nextTierMultiplier = multiplier;
        if (consecutiveDays < 7) {
          nextTierDays = 7;
          nextTierMultiplier = 1.3;
        } else if (consecutiveDays < 30) {
          nextTierDays = 30;
          nextTierMultiplier = 2.0;
        }

        setActiveBoosterData({
          consecutiveDays,
          multiplier: Math.min(multiplier, activeBoosterCap),
          cap: activeBoosterCap,
          year,
          nextTierDays,
          nextTierMultiplier,
          isActiveToday: consecutiveDays > 0, // Simplified check
        });
      } catch (error) {
        console.error("[ReferralAndBoosterCard] Failed to update data:", error);
      }
    };

    updateData();
    const interval = setInterval(updateData, 10000);
    return () => clearInterval(interval);
  }, [minerAddress, currentHeight]);

  // Generate invite code (simplified - would use actual invite system)
  const inviteCode = minerAddress ? `${minerAddress.substring(0, 8)}...${minerAddress.substring(minerAddress.length - 6)}` : "N/A";
  const inviteLink = minerAddress ? `https://indexerchain.com/invite/${minerAddress}` : "#";

  return (
    <div className="status-card" style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ margin: 0, marginBottom: "1rem" }}>
        {isZh ? "🎯 邀请 & 裂变收益" : "🎯 Referral & Booster"}
      </h3>

      {/* Referral Rewards Overview */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#495057" }}>
          {isZh ? "我的邀请收益总览" : "My Referral Rewards Overview"}
        </h4>
        <div style={{ fontSize: "0.9rem" }}>
          <div style={{ marginBottom: "0.5rem", padding: "0.75rem", background: "#f8f9fa", borderRadius: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
              <span>{isZh ? "累计一级邀请奖励" : "Total Level 1 Referral Rewards"}:</span>
              <strong>{referralData?.level1RewardIDC.toFixed(2) || "0.00"} IDC</strong>
            </div>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {isZh ? "已占总量" : "Of Total Supply"}: {referralData?.level1Percent.toFixed(4) || "0.0000"}% ({isZh ? "上限" : "Cap"}: 1%)
            </div>
            {referralData && referralData.level1Percent >= 100 && (
              <div style={{ fontSize: "0.8rem", color: "#856404", marginTop: "0.25rem" }}>
                ⚠️ {isZh ? "超过上限后，奖励按 1% 衰减发放" : "Rewards decay to 1% after cap"}
              </div>
            )}
          </div>
          <div style={{ padding: "0.75rem", background: "#f8f9fa", borderRadius: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
              <span>{isZh ? "累计二级邀请奖励" : "Total Level 2 Referral Rewards"}:</span>
              <strong>{referralData?.level2RewardIDC.toFixed(2) || "0.00"} IDC</strong>
            </div>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {isZh ? "已占总量" : "Of Total Supply"}: {referralData?.level2Percent.toFixed(4) || "0.0000"}% ({isZh ? "上限" : "Cap"}: 0.5%)
            </div>
          </div>
        </div>
      </div>

      {/* Referral Status */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#495057" }}>
          {isZh ? "我的邀请状态" : "My Referral Status"}
        </h4>
        <div style={{ fontSize: "0.9rem" }}>
          <div style={{ marginBottom: "0.5rem" }}>
            <span style={{ color: "#666" }}>{isZh ? "我的邀请码" : "My Invite Code"}: </span>
            <code style={{ background: "#f8f9fa", padding: "0.25rem 0.5rem", borderRadius: "4px", fontFamily: "monospace" }}>
              {inviteCode}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(inviteLink)}
              style={{
                marginLeft: "0.5rem",
                padding: "0.25rem 0.5rem",
                fontSize: "0.8rem",
                background: "#007bff",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {isZh ? "复制链接" : "Copy Link"}
            </button>
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <span style={{ color: "#666" }}>{isZh ? "有效邀请人数" : "Valid Invites"}: </span>
            <strong>{referralData?.totalInvitees || 0}</strong>
            <span style={{ fontSize: "0.85rem", color: "#666", marginLeft: "0.5rem" }}>
              ({isZh ? "满足在线 ≥ 60 分钟 + 挖出 ≥ 1 块" : "Online ≥ 60 min + Mined ≥ 1 block"})
            </span>
          </div>
          <div style={{ fontSize: "0.85rem", color: "#666" }}>
            {isZh ? "待激活邀请" : "Pending Invites"}: <strong>0</strong> ({isZh ? "还未满足有效条件，只按 1/10 结算" : "Not yet valid, rewards at 1/10 rate"})
          </div>
        </div>
      </div>

      {/* ActiveBooster Progress */}
      {activeBoosterData && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h4 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#495057" }}>
            {isZh ? "ActiveBooster 进度" : "ActiveBooster Progress"}
          </h4>
          <div style={{ fontSize: "0.9rem" }}>
            <div style={{ marginBottom: "0.5rem", padding: "0.75rem", background: activeBoosterData.isActiveToday ? "#d4edda" : "#fff3cd", borderRadius: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <span>{isZh ? "今日是否签到" : "Today Active"}:</span>
                <strong>{activeBoosterData.isActiveToday ? "✅ " + (isZh ? "是" : "Yes") : "❌ " + (isZh ? "否" : "No")}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <span>{isZh ? "连续挖矿天数" : "Consecutive Days"}:</span>
                <strong>{activeBoosterData.consecutiveDays} {isZh ? "天" : "days"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{isZh ? "当前倍率" : "Current Multiplier"}:</span>
                <strong>{activeBoosterData.multiplier.toFixed(2)}x</strong>
              </div>
            </div>
            {activeBoosterData.nextTierDays > 0 && (
              <div style={{ padding: "0.75rem", background: "#e7f3ff", borderRadius: "6px", fontSize: "0.85rem", color: "#004085" }}>
                {isZh ? "下一个档位提示" : "Next Tier"}: {isZh ? "再坚持" : "Keep going for"} <strong>{activeBoosterData.nextTierDays - activeBoosterData.consecutiveDays} {isZh ? "天" : "days"}</strong>, {isZh ? "倍率从" : "multiplier from"} <strong>{activeBoosterData.multiplier.toFixed(2)}x</strong> → <strong>{activeBoosterData.nextTierMultiplier.toFixed(2)}x</strong>
              </div>
            )}
            <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#666" }}>
              {isZh ? "当前年份" : "Current Year"}: Y{activeBoosterData.year + 1} · {isZh ? "ActiveBooster 上限" : "ActiveBooster Cap"}: {activeBoosterData.cap.toFixed(1)}x
            </div>
          </div>
        </div>
      )}

      {/* Tips */}
      <div style={{ padding: "0.75rem", background: "#fff3cd", borderRadius: "6px", border: "1px solid #ffc107" }}>
        <div style={{ fontSize: "0.9rem", fontWeight: "bold", marginBottom: "0.5rem", color: "#856404" }}>
          🎯 {isZh ? "提示" : "Tips"}:
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.5rem", fontSize: "0.85rem", color: "#856404", lineHeight: "1.6" }}>
          <li>{isZh ? "邀请真实矿工，长期在线收益更高" : "Invite real miners, long-term online rewards are higher"}</li>
          <li>{isZh ? "同一 IP 多设备挖矿只会摊薄收益（权重衰减到 0.1x）" : "Multiple devices on same IP will dilute rewards (weight decays to 0.1x)"}</li>
          <li>{isZh ? "连续挖矿越久，ActiveBooster 倍率越高" : "Longer consecutive mining = higher ActiveBooster multiplier"}</li>
        </ul>
      </div>
    </div>
  );
}

