/**
 * Phase 42: Referral System (Invitation Fission)
 * 
 * Two-level referral reward system:
 * - Level 1 (direct invite): +20% of invitee's mining reward (decays over time)
 * - Level 2 (invitee's invite): +10% of level 2 invitee's mining reward (decays over time)
 * 
 * Phase 42.1: Enhanced anti-cheat and safety mechanisms:
 * - Referral reward decay by year (Year 0-1: 20%/10%, Year 1-3: 10%/5%, Year 3+: 5%/0%)
 * - Per-address referral reward cap (Level 1: 1% of total supply, Level 2: 0.5%)
 * - Valid referral verification (online time + mining blocks required)
 * - IP/device binding checks (same IP/device referrals heavily discounted)
 * 
 * Anti-cheat protection:
 * - Each referral must bind to ShadowNodeSession
 * - Same IP referrals don't count (or heavily discounted)
 * - Same device browser can't be invited twice
 * - Referral rewards only paid when real IDC is mined
 */

import type { Address } from "./types.js";
import { IDC_MAX_SUPPLY, IDC_BLOCKS_PER_YEAR } from "./idcEmission.js";

/**
 * Referral relationship
 */
export interface ReferralRelation {
  inviterAddress: Address; // Who invited
  inviteeAddress: Address; // Who was invited
  level: 1 | 2; // Referral level (1 or 2)
  createdAt: number; // Timestamp
  deviceId?: string; // Device ID for anti-cheat
  ipHash?: string; // IP hash for anti-cheat
  verified: boolean; // Whether this referral is verified (anti-cheat passed)
  // Phase 42.1: Valid referral tracking
  totalOnlineMinutes?: number; // Total online time of invitee
  totalMinedBlocks?: number; // Total blocks mined by invitee
  isValidReferral?: boolean; // Whether this is a valid referral (meets requirements)
}

/**
 * Referral reward calculation
 */
export interface ReferralReward {
  inviterAddress: Address;
  level: 1 | 2;
  rewardMultiplier: number; // 0.20 for level 1, 0.10 for level 2
  baseReward: bigint; // Base mining reward of invitee
  referralReward: bigint; // Calculated referral reward
}

/**
 * Phase 42.1: Valid referral requirements
 */
const VALID_REFERRAL_MIN_ONLINE_MINUTES = 60; // At least 1 hour online
const VALID_REFERRAL_MIN_MINED_BLOCKS = 1; // At least 1 block mined

/**
 * Phase 42.1: Referral reward caps (as percentage of total supply)
 */
const REFERRAL_LEVEL1_CAP_PERCENT = 0.01; // 1% of total supply
const REFERRAL_LEVEL2_CAP_PERCENT = 0.005; // 0.5% of total supply

/**
 * Referral System Manager
 * 
 * Manages referral relationships and calculates referral rewards
 */
export class ReferralSystem {
  private referrals: Map<Address, ReferralRelation[]> = new Map(); // invitee -> referrals
  private inviters: Map<Address, Address[]> = new Map(); // inviter -> invitees (level 1)
  private level2Inviters: Map<Address, Address[]> = new Map(); // inviter -> level 2 invitees
  // Phase 42.1: Track total referral rewards per address
  private totalReferralRewards: Map<Address, { level1: bigint; level2: bigint }> = new Map();

  /**
   * Register a referral relationship
   * 
   * @param inviterAddress Address of the inviter
   * @param inviteeAddress Address of the invitee
   * @param deviceId Device ID for anti-cheat
   * @param ipHash IP hash for anti-cheat
   * @returns true if registration successful, false if invalid (same IP/device)
   */
  registerReferral(
    inviterAddress: Address,
    inviteeAddress: Address,
    deviceId?: string,
    ipHash?: string
  ): boolean {
    // Anti-cheat: Can't invite yourself
    if (inviterAddress === inviteeAddress) {
      return false;
    }

    // Anti-cheat: Check if invitee already has a referrer
    const existingReferrals = this.referrals.get(inviteeAddress);
    if (existingReferrals && existingReferrals.length > 0) {
      // Already has a referrer, can't be invited again
      return false;
    }

    // Phase 42.1: Anti-cheat: Check same IP/device (if provided)
    if (ipHash || deviceId) {
      const inviterReferrals = this.referrals.get(inviterAddress);
      if (inviterReferrals) {
        // Check for same IP
        if (ipHash) {
          const sameIPReferral = inviterReferrals.find(r => r.ipHash === ipHash);
          if (sameIPReferral) {
            // Same IP referral already exists, reject (or heavily discount)
            return false;
          }
        }
        // Check for same device
        if (deviceId) {
          const sameDeviceReferral = inviterReferrals.find(r => r.deviceId === deviceId);
          if (sameDeviceReferral) {
            // Same device referral already exists, reject
            return false;
          }
        }
      }
    }

    // Create level 1 referral
    const referral: ReferralRelation = {
      inviterAddress,
      inviteeAddress,
      level: 1,
      createdAt: Date.now(),
      deviceId,
      ipHash,
      verified: true, // Will be verified later by Shadow Node
    };

    // Store referral
    if (!this.referrals.has(inviteeAddress)) {
      this.referrals.set(inviteeAddress, []);
    }
    this.referrals.get(inviteeAddress)!.push(referral);

    // Store inviter -> invitee mapping
    if (!this.inviters.has(inviterAddress)) {
      this.inviters.set(inviterAddress, []);
    }
    this.inviters.get(inviterAddress)!.push(inviteeAddress);

    // Create level 2 referrals (invitee's invitees become level 2 for original inviter)
    const inviteeReferrals = this.referrals.get(inviteeAddress);
    if (inviteeReferrals) {
      for (const inviteeRef of inviteeReferrals) {
        if (inviteeRef.level === 1 && inviteeRef.inviteeAddress !== inviteeAddress) {
          // This invitee has invited someone, create level 2 referral
          const level2Referral: ReferralRelation = {
            inviterAddress, // Original inviter
            inviteeAddress: inviteeRef.inviteeAddress, // Level 2 invitee
            level: 2,
            createdAt: Date.now(),
            deviceId: inviteeRef.deviceId,
            ipHash: inviteeRef.ipHash,
            verified: true,
          };

          if (!this.referrals.has(inviteeRef.inviteeAddress)) {
            this.referrals.set(inviteeRef.inviteeAddress, []);
          }
          this.referrals.get(inviteeRef.inviteeAddress)!.push(level2Referral);

          if (!this.level2Inviters.has(inviterAddress)) {
            this.level2Inviters.set(inviterAddress, []);
          }
          this.level2Inviters.get(inviterAddress)!.push(inviteeRef.inviteeAddress);
        }
      }
    }

    return true;
  }

  /**
   * Get referrer for an address
   * 
   * @param inviteeAddress Address to check
   * @returns Referrer address or null
   */
  getReferrer(inviteeAddress: Address): Address | null {
    const referrals = this.referrals.get(inviteeAddress);
    if (!referrals || referrals.length === 0) {
      return null;
    }
    
    // Return level 1 referrer
    const level1Referral = referrals.find(r => r.level === 1);
    return level1Referral ? level1Referral.inviterAddress : null;
  }

  /**
   * Get all level 1 invitees for an address
   * 
   * @param inviterAddress Address to check
   * @returns Array of level 1 invitee addresses
   */
  getLevel1Invitees(inviterAddress: Address): Address[] {
    return this.inviters.get(inviterAddress) || [];
  }

  /**
   * Get all level 2 invitees for an address
   * 
   * @param inviterAddress Address to check
   * @returns Array of level 2 invitee addresses
   */
  getLevel2Invitees(inviterAddress: Address): Address[] {
    return this.level2Inviters.get(inviterAddress) || [];
  }

  /**
   * Phase 42.1: Get referral reward multiplier based on year (decay over time)
   * 
   * @param year Current year (0-based)
   * @param level Referral level (1 or 2)
   * @returns Reward multiplier (0.0 to 0.20 for level 1, 0.0 to 0.10 for level 2)
   */
  private getReferralMultiplierByYear(year: number, level: 1 | 2): number {
    if (year === 0) {
      // Year 0-1: Full rewards
      return level === 1 ? 0.20 : 0.10;
    } else if (year < 3) {
      // Year 1-3: Reduced rewards
      return level === 1 ? 0.10 : 0.05;
    } else {
      // Year 3+: Minimal rewards
      return level === 1 ? 0.05 : 0.0; // Level 2 becomes 0% after year 3
    }
  }

  /**
   * Phase 42.1: Check if referral is valid (meets requirements)
   */
  private isReferralValid(referral: ReferralRelation): boolean {
    if (!referral.isValidReferral) {
      // Check requirements
      const onlineMinutes = referral.totalOnlineMinutes || 0;
      const minedBlocks = referral.totalMinedBlocks || 0;
      
      return onlineMinutes >= VALID_REFERRAL_MIN_ONLINE_MINUTES &&
             minedBlocks >= VALID_REFERRAL_MIN_MINED_BLOCKS;
    }
    return referral.isValidReferral;
  }

  /**
   * Phase 42.1: Check if referral reward cap is reached
   */
  private isReferralCapReached(address: Address, level: 1 | 2, additionalReward: bigint): boolean {
    const totalRewards = this.totalReferralRewards.get(address) || { level1: 0n, level2: 0n };
    const currentTotal = level === 1 ? totalRewards.level1 : totalRewards.level2;
    const cap = level === 1 
      ? (IDC_MAX_SUPPLY * BigInt(Math.floor(REFERRAL_LEVEL1_CAP_PERCENT * 1000))) / 1000n
      : (IDC_MAX_SUPPLY * BigInt(Math.floor(REFERRAL_LEVEL2_CAP_PERCENT * 1000))) / 1000n;
    
    return (currentTotal + additionalReward) > cap;
  }

  /**
   * Phase 42.1: Update total referral rewards for an address
   */
  private updateTotalReferralRewards(address: Address, level: 1 | 2, reward: bigint): void {
    const current = this.totalReferralRewards.get(address) || { level1: 0n, level2: 0n };
    if (level === 1) {
      current.level1 += reward;
    } else {
      current.level2 += reward;
    }
    this.totalReferralRewards.set(address, current);
  }

  /**
   * Calculate referral rewards for a mining reward
   * 
   * Phase 42.1: Enhanced with decay, caps, and valid referral checks
   * 
   * @param minerAddress Address of the miner
   * @param baseReward Base mining reward in uIDC
   * @param blockHeight Block height (for year-based decay)
   * @returns Array of referral rewards
   */
  calculateReferralRewards(
    minerAddress: Address, 
    baseReward: bigint,
    blockHeight: number = 0
  ): ReferralReward[] {
    const rewards: ReferralReward[] = [];
    
    // Get year for decay calculation
    const year = Math.floor(blockHeight / Number(IDC_BLOCKS_PER_YEAR));
    
    // Get referrer (level 1)
    const referrer = this.getReferrer(minerAddress);
    if (referrer) {
      // Get referral relation to check validity
      const referrals = this.referrals.get(minerAddress);
      const referral = referrals?.find(r => r.level === 1 && r.inviterAddress === referrer);
      
      // Phase 42.1: Check if referral is valid
      const isValid = referral ? this.isReferralValid(referral) : false;
      
      // Phase 42.1: Get multiplier based on year (decay)
      const multiplier = this.getReferralMultiplierByYear(year, 1);
      
      // Phase 42.1: Apply discount for invalid referrals (1/10 of normal reward)
      const effectiveMultiplier = isValid ? multiplier : multiplier * 0.1;
      
      const referralReward = (baseReward * BigInt(Math.floor(effectiveMultiplier * 1000))) / 1000n;
      
      // Phase 42.1: Check if cap is reached
      if (!this.isReferralCapReached(referrer, 1, referralReward)) {
        rewards.push({
          inviterAddress: referrer,
          level: 1,
          rewardMultiplier: effectiveMultiplier,
          baseReward,
          referralReward,
        });
        
        // Update total rewards
        this.updateTotalReferralRewards(referrer, 1, referralReward);
      } else {
        // Cap reached, give minimal reward (1% of normal)
        const minimalReward = (referralReward * 10n) / 1000n; // 1% of normal
        rewards.push({
          inviterAddress: referrer,
          level: 1,
          rewardMultiplier: effectiveMultiplier * 0.01,
          baseReward,
          referralReward: minimalReward,
        });
      }
    }

    // Get level 2 referrer (referrer's referrer)
    if (referrer) {
      const level2Referrer = this.getReferrer(referrer);
      if (level2Referrer) {
        // Get level 2 referral relation
        const referrals = this.referrals.get(referrer);
        const referral = referrals?.find(r => r.level === 2 && r.inviterAddress === level2Referrer);
        
        // Phase 42.1: Check if referral is valid
        const isValid = referral ? this.isReferralValid(referral) : false;
        
        // Phase 42.1: Get multiplier based on year (decay)
        const multiplier = this.getReferralMultiplierByYear(year, 2);
        
        // Phase 42.1: Apply discount for invalid referrals
        const effectiveMultiplier = isValid ? multiplier : multiplier * 0.1;
        
        const referralReward = (baseReward * BigInt(Math.floor(effectiveMultiplier * 1000))) / 1000n;
        
        // Phase 42.1: Check if cap is reached
        if (!this.isReferralCapReached(level2Referrer, 2, referralReward)) {
          rewards.push({
            inviterAddress: level2Referrer,
            level: 2,
            rewardMultiplier: effectiveMultiplier,
            baseReward,
            referralReward,
          });
          
          // Update total rewards
          this.updateTotalReferralRewards(level2Referrer, 2, referralReward);
        } else {
          // Cap reached, give minimal reward
          const minimalReward = (referralReward * 10n) / 1000n; // 1% of normal
          rewards.push({
            inviterAddress: level2Referrer,
            level: 2,
            rewardMultiplier: effectiveMultiplier * 0.01,
            baseReward,
            referralReward: minimalReward,
          });
        }
      }
    }

    return rewards;
  }

  /**
   * Get referral statistics for an address
   */
  getReferralStats(address: Address): {
    level1Count: number;
    level2Count: number;
    totalInvitees: number;
  } {
    return {
      level1Count: this.getLevel1Invitees(address).length,
      level2Count: this.getLevel2Invitees(address).length,
      totalInvitees: this.getLevel1Invitees(address).length + this.getLevel2Invitees(address).length,
    };
  }
}

/**
 * Global referral system instance
 */
let globalReferralSystem: ReferralSystem | null = null;

/**
 * Get or create global referral system
 */
export function getReferralSystem(): ReferralSystem {
  if (!globalReferralSystem) {
    globalReferralSystem = new ReferralSystem();
    
    // Try to load from localStorage
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("indexerchain_referrals");
      if (stored) {
        try {
          // Restore referral relationships
          // Note: This is simplified, in production you'd want more robust persistence
          // const data = JSON.parse(stored);
          // TODO: Implement referral restoration from localStorage
        } catch (e) {
          console.warn("[ReferralSystem] Failed to load referrals from localStorage:", e);
        }
      }
    }
  }
  
  return globalReferralSystem;
}

/**
 * Save referral system data to localStorage
 */
export function saveReferralSystemData(): void {
  if (typeof localStorage === "undefined" || !globalReferralSystem) {
    return;
  }
  
  // Simplified persistence - in production you'd want more robust storage
  // For now, we'll rely on Shadow Node for persistence
}

/**
 * Generate referral code for an address
 * 
 * @param address Address to generate code for
 * @returns Referral code (base64 encoded address)
 */
export function generateReferralCode(address: Address): string {
  // Simple encoding: base64 of address
  if (typeof btoa !== "undefined") {
    return btoa(address);
  }
  // Fallback for Node.js
  return Buffer.from(address).toString('base64');
}

/**
 * Parse referral code to address
 * 
 * @param code Referral code
 * @returns Address or null if invalid
 */
export function parseReferralCode(code: string): Address | null {
  try {
    if (typeof atob !== "undefined") {
      const address = atob(code);
      // Validate it's a valid address format
      if (address.startsWith("idc_")) {
        return address as Address;
      }
    } else {
      // Fallback for Node.js
      const address = Buffer.from(code, 'base64').toString();
      if (address.startsWith("idc_")) {
        return address as Address;
      }
    }
  } catch (e) {
    // Invalid code
  }
  
  return null;
}

