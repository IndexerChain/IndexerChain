/**
 * Phase 41: Mining Reward Multiplier System
 * 
 * Implements two reward multipliers to incentivize:
 * 1. IP Reputation Score (0.3x - 1.3x) - Based on QuorumScore
 * 2. Session Duration Multiplier (0.5x - 1.2x) - Anti-bot, rewards long-term nodes
 * 
 * Final reward = baseReward × IPReputationMultiplier × SessionDurationMultiplier
 */

// QuorumManager type not needed here, but kept for future reference
// import type { QuorumManager } from "./quorumManager.js";

/**
 * IP Reputation Multiplier based on QuorumScore
 * 
 * QuorumScore ranges: 0-200+ (from QuorumManager)
 * 
 * Multiplier mapping:
 * - < 50: 0.0x (no reward, too low quality)
 * - 50-80: 0.3x (low quality node)
 * - 80-100: 1.0x (standard node)
 * - 100-120: 1.0x (standard node)
 * - 120-150: 1.1x (good quality node)
 * - 150+: 1.3x (high quality independent node)
 */
export function getIPReputationMultiplier(quorumScore: number): number {
  if (quorumScore < 30) {
    return 0.0; // No reward for very low quality
  } else if (quorumScore < 80) {
    return 0.3; // Low quality node - reduced reward
  } else if (quorumScore < 120) {
    return 1.0; // Standard node - full reward
  } else if (quorumScore < 150) {
    return 1.1; // Good quality node - 10% bonus
  } else {
    return 1.3; // High quality independent node - 30% bonus
  }
}

/**
 * Session Duration Multiplier (anti-bot protection)
 * 
 * Rewards nodes that stay online for longer periods:
 * - 0-10 minutes: 0.5x (prevent quick script switching)
 * - 10-60 minutes: 1.0x (standard session)
 * - 60+ minutes: 1.2x (long-term stable node)
 * 
 * @param sessionDurationMs Session duration in milliseconds
 * @returns Multiplier (0.5 to 1.2)
 */
export function getSessionDurationMultiplier(sessionDurationMs: number): number {
  const minutes = sessionDurationMs / (60 * 1000);
  
  if (minutes < 10) {
    return 0.5; // Short session - reduced reward (anti-bot)
  } else if (minutes < 60) {
    return 1.0; // Standard session - full reward
  } else {
    return 1.2; // Long session - 20% bonus
  }
}

/**
 * Get combined reward multiplier
 * 
 * @param quorumScore QuorumScore from QuorumManager
 * @param sessionDurationMs Session duration in milliseconds
 * @returns Combined multiplier (0.0 to 1.56)
 */
export function getCombinedRewardMultiplier(
  quorumScore: number,
  sessionDurationMs: number
): number {
  const ipMultiplier = getIPReputationMultiplier(quorumScore);
  const sessionMultiplier = getSessionDurationMultiplier(sessionDurationMs);
  
  return ipMultiplier * sessionMultiplier;
}

/**
 * Get detailed multiplier breakdown for UI display
 */
export interface RewardMultiplierBreakdown {
  baseReward: bigint; // Base reward in uIDC
  ipReputationMultiplier: number;
  sessionDurationMultiplier: number;
  combinedMultiplier: number;
  finalReward: bigint; // Final reward after multipliers in uIDC
  quorumScore: number;
  sessionDurationMs: number;
  sessionDurationMinutes: number;
}

/**
 * Calculate final mining reward with multipliers
 * 
 * @param baseReward Base block reward in uIDC
 * @param quorumScore QuorumScore from QuorumManager
 * @param sessionDurationMs Session duration in milliseconds
 * @returns Detailed breakdown of reward calculation
 */
export function calculateMiningReward(
  baseReward: bigint,
  quorumScore: number,
  sessionDurationMs: number
): RewardMultiplierBreakdown {
  const ipMultiplier = getIPReputationMultiplier(quorumScore);
  const sessionMultiplier = getSessionDurationMultiplier(sessionDurationMs);
  const combinedMultiplier = ipMultiplier * sessionMultiplier;
  
  // Calculate final reward (using integer arithmetic)
  // Multiply by 1000 for precision, then divide by 1000
  const finalReward = (baseReward * BigInt(Math.floor(combinedMultiplier * 1000))) / 1000n;
  
  return {
    baseReward,
    ipReputationMultiplier: ipMultiplier,
    sessionDurationMultiplier: sessionMultiplier,
    combinedMultiplier,
    finalReward,
    quorumScore,
    sessionDurationMs,
    sessionDurationMinutes: sessionDurationMs / (60 * 1000),
  };
}

/**
 * Session Duration Tracker
 * 
 * Tracks session duration for reward multiplier calculation.
 * Integrates with Shadow Node to maintain session continuity.
 */
export class SessionDurationTracker {
  private sessionStartTime: number = Date.now();
  private lastActiveTime: number = Date.now();
  private shadowNodeDuration: number = 0; // Duration from Shadow Node (if available)
  private isActive: boolean = true;

  /**
   * Initialize session tracker
   * 
   * @param shadowNodeDurationMs Optional: Duration from Shadow Node (for continuity)
   */
  constructor(shadowNodeDurationMs: number = 0) {
    this.sessionStartTime = Date.now();
    this.lastActiveTime = Date.now();
    this.shadowNodeDuration = shadowNodeDurationMs;
    this.isActive = true;
  }

  /**
   * Get total session duration including Shadow Node time
   */
  getTotalDuration(): number {
    if (!this.isActive) {
      // Session paused, return duration up to pause time
      return this.lastActiveTime - this.sessionStartTime + this.shadowNodeDuration;
    }
    
    // Active session, include current time
    return Date.now() - this.sessionStartTime + this.shadowNodeDuration;
  }

  /**
   * Pause session (e.g., when browser goes to background)
   * Shadow Node continues tracking, so we just mark as inactive
   */
  pause(): void {
    if (this.isActive) {
      this.lastActiveTime = Date.now();
      this.isActive = false;
    }
  }

  /**
   * Resume session (e.g., when browser comes to foreground)
   * Shadow Node provides the duration that passed while inactive
   */
  resume(shadowNodeDurationMs: number = 0): void {
    if (!this.isActive) {
      // Add Shadow Node duration to total
      this.shadowNodeDuration += shadowNodeDurationMs;
      this.isActive = true;
      this.lastActiveTime = Date.now();
    }
  }

  /**
   * Reset session (new session start)
   */
  reset(): void {
    this.sessionStartTime = Date.now();
    this.lastActiveTime = Date.now();
    this.shadowNodeDuration = 0;
    this.isActive = true;
  }

  /**
   * Get current session duration multiplier
   */
  getMultiplier(): number {
    const duration = this.getTotalDuration();
    return getSessionDurationMultiplier(duration);
  }
}

/**
 * Global session tracker instance
 */
let globalSessionTracker: SessionDurationTracker | null = null;

/**
 * Get or create global session tracker
 */
export function getSessionTracker(): SessionDurationTracker {
  if (!globalSessionTracker) {
    // Try to restore from localStorage (Shadow Node integration)
    const storedDuration = typeof localStorage !== "undefined"
      ? parseInt(localStorage.getItem("indexerchain_session_duration") || "0", 10)
      : 0;
    
    globalSessionTracker = new SessionDurationTracker(storedDuration);
  }
  
  return globalSessionTracker;
}

/**
 * Save session duration to localStorage (for Shadow Node continuity)
 */
export function saveSessionDuration(): void {
  if (typeof localStorage === "undefined" || !globalSessionTracker) {
    return;
  }
  
  const duration = globalSessionTracker.getTotalDuration();
  localStorage.setItem("indexerchain_session_duration", duration.toString());
}

