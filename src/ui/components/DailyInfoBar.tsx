/**
 * Daily Info Bar - 每日信息栏
 * 
 * 显示每天常用和每天都要看的信息：
 * - 今日签到状态和签到按钮
 * - 连续挖矿天数
 * - ActiveBooster倍率
 * - 邀请状态
 * - 挖矿状态（简要）
 */

import { useState, useEffect } from "react";
import { getActiveBoosterTracker, saveActiveBoosterData } from "../../core/activeBooster.js";
import { getReferralSystem, generateReferralCode } from "../../core/referralSystem.js";
import type { ChainContext } from "../../core/chain.js";
import type { Address } from "../../core/types.js";
import { useI18n } from "../../i18n/useI18n.js";
import { formatAddress } from "../../utils/format.js";

interface DailyInfoBarProps {
  chainContext: ChainContext | null;
  nodeAddress: string | null;
  currentHeight: number;
  isMining: boolean;
  clusterMining: boolean;
  currentReferrerAddress: string | null;
  locale: string;
}

export function DailyInfoBar({
  chainContext,
  nodeAddress,
  currentHeight,
  isMining,
  clusterMining,
  currentReferrerAddress,
  locale: _locale,
}: DailyInfoBarProps) {
  const [activeBoosterData, setActiveBoosterData] = useState<{
    consecutiveDays: number;
    multiplier: number;
    isActiveToday: boolean;
  } | null>(null);
  const [isCheckingIn, setIsCheckingIn] = useState<boolean>(false);
  const [referralCount, setReferralCount] = useState<number>(0);
  const [inviteCode, setInviteCode] = useState<string>("");
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  const { t } = useI18n();

  // Update ActiveBooster data
  useEffect(() => {
    const updateData = () => {
      if (!nodeAddress) {
        setActiveBoosterData(null);
        return;
      }

      try {
        const activeBooster = getActiveBoosterTracker();
        const consecutiveDays = activeBooster.getConsecutiveDays();
        const multiplier = activeBooster.getMultiplier();
        
        // Check if active today
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const lastActiveDate = (activeBooster as any).lastActiveDate;
        const isActiveToday = lastActiveDate === todayStr;
        
        setActiveBoosterData({
          consecutiveDays,
          multiplier,
          isActiveToday,
        });

        // Get referral count
        const referralSystem = getReferralSystem();
        const referralStats = referralSystem.getReferralStats(nodeAddress as any);
        setReferralCount(referralStats.totalInvitees);

        // Generate invite code
        const code = generateReferralCode(nodeAddress as Address);
        setInviteCode(code);
      } catch (error) {
      }
    };

    updateData();
    const interval = setInterval(updateData, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, [nodeAddress, currentHeight]);

  const handleCheckIn = async () => {
    setIsCheckingIn(true);
    try {
      const activeBooster = getActiveBoosterTracker();
      activeBooster.markActive();
      saveActiveBoosterData();
      
      // Update UI immediately
      const consecutiveDays = activeBooster.getConsecutiveDays();
      const multiplier = activeBooster.getMultiplier();
      
      setActiveBoosterData({
        consecutiveDays,
        multiplier,
        isActiveToday: true,
      });
    } catch (error) {
    } finally {
      setIsCheckingIn(false);
    }
  };

  const handleCopyInviteCode = async () => {
    if (!inviteCode) return;
    
    try {
      // Copy invite code to clipboard
      await navigator.clipboard.writeText(inviteCode);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
    }
  };

  if (!chainContext || !nodeAddress) {
    return null;
  }

  return (
    <div style={{
      padding: "1rem 1.5rem",
      background: "linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)",
      borderRadius: "8px",
      marginBottom: "1rem",
      border: "1px solid #dee2e6",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)"
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "1rem"
      }}>
        {/* 签到状态 */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.5rem 1rem",
          background: activeBoosterData?.isActiveToday ? "#d4edda" : "#fff3cd",
          borderRadius: "6px",
          border: `1px solid ${activeBoosterData?.isActiveToday ? "#28a745" : "#ffc107"}`,
          minWidth: "140px"
        }}>
          <span style={{ fontSize: "1.2rem" }}>
            {activeBoosterData?.isActiveToday ? "✅" : "❌"}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: "0.25rem" }}>
              {t("dailyInfo.checkIn")}
            </div>
            <div style={{ fontSize: "0.9rem", fontWeight: "bold", color: activeBoosterData?.isActiveToday ? "#155724" : "#856404" }}>
              {activeBoosterData?.isActiveToday 
                ? t("dailyInfo.checkedIn")
                : t("dailyInfo.notCheckedIn")}
            </div>
          </div>
          {!activeBoosterData?.isActiveToday && (
            <button
              onClick={handleCheckIn}
              disabled={isCheckingIn}
              style={{
                padding: "0.4rem 0.8rem",
                fontSize: "0.75rem",
                background: isCheckingIn ? "#ccc" : "#28a745",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: isCheckingIn ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                fontWeight: "500",
              }}
            >
              {isCheckingIn ? "..." : t("dailyInfo.checkInButton")}
            </button>
          )}
        </div>

        {/* 连续天数 */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.5rem 1rem",
          background: "white",
          borderRadius: "6px",
          border: "1px solid #dee2e6",
          minWidth: "120px"
        }}>
          <span style={{ fontSize: "1.2rem" }}>📅</span>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: "0.25rem" }}>
              {t("dailyInfo.consecutiveDays")}
            </div>
            <div style={{ fontSize: "0.9rem", fontWeight: "bold", color: "#333" }}>
              {activeBoosterData?.consecutiveDays || 0} {t("dailyInfo.days")}
            </div>
          </div>
        </div>

        {/* ActiveBooster倍率 */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.5rem 1rem",
          background: "white",
          borderRadius: "6px",
          border: "1px solid #dee2e6",
          minWidth: "120px"
        }}>
          <span style={{ fontSize: "1.2rem" }}>⚡</span>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: "0.25rem" }}>
              {t("dailyInfo.multiplier")}
            </div>
            <div style={{ fontSize: "0.9rem", fontWeight: "bold", color: "#667eea" }}>
              {activeBoosterData?.multiplier.toFixed(2) || "1.00"}x
            </div>
          </div>
        </div>

        {/* 邀请状态 */}
        {currentReferrerAddress && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.5rem 1rem",
            background: "#d1ecf1",
            borderRadius: "6px",
            border: "1px solid #17a2b8",
            minWidth: "140px"
          }}>
            <span style={{ fontSize: "1.2rem" }}>🎯</span>
            <div>
              <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: "0.25rem" }}>
                {t("dailyInfo.referralStatus")}
              </div>
              <div style={{ fontSize: "0.9rem", fontWeight: "bold", color: "#0c5460" }}>
                {t("dailyInfo.bound")}
              </div>
            </div>
          </div>
        )}

        {/* 邀请人数 */}
        {referralCount > 0 && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.5rem 1rem",
            background: "white",
            borderRadius: "6px",
            border: "1px solid #dee2e6",
            minWidth: "100px"
          }}>
            <span style={{ fontSize: "1.2rem" }}>👥</span>
            <div>
              <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: "0.25rem" }}>
                {t("dailyInfo.invitees")}
              </div>
              <div style={{ fontSize: "0.9rem", fontWeight: "bold", color: "#333" }}>
                {referralCount}
              </div>
            </div>
          </div>
        )}

        {/* 挖矿状态 */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.5rem 1rem",
          background: (isMining || clusterMining) ? "#d4edda" : "white",
          borderRadius: "6px",
          border: `1px solid ${(isMining || clusterMining) ? "#28a745" : "#dee2e6"}`,
          minWidth: "100px"
        }}>
          <span style={{ fontSize: "1.2rem" }}>
            {(isMining || clusterMining) ? "⛏️" : "⏸️"}
          </span>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: "0.25rem" }}>
              {t("dailyInfo.miningStatus")}
            </div>
            <div style={{ 
              fontSize: "0.9rem", 
              fontWeight: "bold", 
              color: (isMining || clusterMining) ? "#155724" : "#666"
            }}>
              {(isMining || clusterMining) 
                ? t("dailyInfo.active")
                : t("dailyInfo.stopped")}
            </div>
          </div>
        </div>

        {/* 邀请码 */}
        {inviteCode && (
          <div 
            onClick={handleCopyInviteCode}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.5rem 1rem",
              background: copySuccess ? "#d4edda" : "#e7f3ff",
              borderRadius: "6px",
              border: `1px solid ${copySuccess ? "#28a745" : "#667eea"}`,
              cursor: "pointer",
              minWidth: "160px",
              transition: "all 0.2s"
            }}
            onMouseEnter={(e) => {
              if (!copySuccess) {
                e.currentTarget.style.background = "#d0e7ff";
              }
            }}
            onMouseLeave={(e) => {
              if (!copySuccess) {
                e.currentTarget.style.background = "#e7f3ff";
              }
            }}
            title={t("dailyInfo.clickToCopyInviteCode")}
          >
            <span style={{ fontSize: "1.2rem" }}>🔗</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: "0.25rem" }}>
                {t("dailyInfo.inviteCode")}
              </div>
              <div style={{ 
                fontSize: "0.85rem", 
                fontWeight: "bold", 
                color: copySuccess ? "#155724" : "#004085",
                fontFamily: "monospace",
                wordBreak: "break-all",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}>
                {copySuccess 
                  ? t("dailyInfo.copied")
                  : formatAddress(inviteCode, 6, 6)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

