/**
 * Phase 42: Active Booster System
 * 
 * Rewards users for consecutive active days with hashpower multiplier.
 * 
 * Multiplier based on consecutive login days:
 * - 1 day: +5% (1.05x)
 * - 2 days: +10% (1.10x)
 * - 7 days: +30% (1.30x)
 * - 30 days: +100% (2.00x)
 * 
 * Formula: EffectiveHashPower = BaseHashPower × ActiveBooster
 * 
 * Integrated with Shadow Node for continuous tracking.
 */

/**
 * Active booster multiplier based on consecutive active days
 */
export function getActiveBoosterMultiplier(consecutiveDays: number): number {
  if (consecutiveDays <= 0) {
    return 1.0; // No bonus
  } else if (consecutiveDays === 1) {
    return 1.05; // +5%
  } else if (consecutiveDays === 2) {
    return 1.10; // +10%
  } else if (consecutiveDays < 7) {
    // Linear interpolation between 2 and 7 days
    const progress = (consecutiveDays - 2) / 5; // 0 to 1
    return 1.10 + (progress * 0.20); // 1.10 to 1.30
  } else if (consecutiveDays < 30) {
    // Linear interpolation between 7 and 30 days
    const progress = (consecutiveDays - 7) / 23; // 0 to 1
    return 1.30 + (progress * 0.70); // 1.30 to 2.00
  } else {
    return 2.00; // +100% (max at 30 days)
  }
}

/**
 * Active Booster Tracker
 * 
 * Tracks consecutive active days for hashpower multiplier calculation.
 * Integrates with Shadow Node to maintain continuity.
 */
export class ActiveBoosterTracker {
  private lastActiveDate: string | null = null; // YYYY-MM-DD format
  private consecutiveDays: number = 0;
  private shadowNodeDays: number = 0; // Days tracked by Shadow Node

  /**
   * Initialize active booster tracker
   * 
   * @param shadowNodeDays Optional: Consecutive days from Shadow Node
   * @param lastActiveDate Optional: Last active date from Shadow Node
   */
  constructor(shadowNodeDays: number = 0, lastActiveDate: string | null = null) {
    this.shadowNodeDays = shadowNodeDays;
    this.lastActiveDate = lastActiveDate;
    this.consecutiveDays = shadowNodeDays;
  }

  /**
   * Get shadow node days (for sync)
   */
  getShadowNodeDays(): number {
    return this.shadowNodeDays;
  }

  /**
   * Get current date in YYYY-MM-DD format
   */
  private getCurrentDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /**
   * Mark user as active today
   * Updates consecutive days counter
   */
  markActive(): void {
    const today = this.getCurrentDate();
    
    if (this.lastActiveDate === null) {
      // First time active
      this.consecutiveDays = 1;
      this.lastActiveDate = today;
    } else if (this.lastActiveDate === today) {
      // Already marked today, do nothing
      return;
    } else {
      // Check if yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      
      if (this.lastActiveDate === yesterdayStr) {
        // Consecutive day
        this.consecutiveDays += 1;
      } else {
        // Break in streak, reset to 1
        this.consecutiveDays = 1;
      }
      
      this.lastActiveDate = today;
    }
  }

  /**
   * Get current consecutive active days
   */
  getConsecutiveDays(): number {
    // Check if we need to reset (if last active was more than 1 day ago)
    if (this.lastActiveDate) {
      const today = this.getCurrentDate();
      const lastDate = new Date(this.lastActiveDate);
      const todayDate = new Date(today);
      const daysDiff = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDiff > 1) {
        // Streak broken, reset
        this.consecutiveDays = 0;
      }
    }
    
    return this.consecutiveDays;
  }

  /**
   * Get current active booster multiplier
   */
  getMultiplier(): number {
    const days = this.getConsecutiveDays();
    return getActiveBoosterMultiplier(days);
  }

  /**
   * Sync with Shadow Node data
   * 
   * @param shadowNodeDays Consecutive days from Shadow Node
   * @param lastActiveDate Last active date from Shadow Node
   */
  syncWithShadowNode(shadowNodeDays: number, lastActiveDate: string | null): void {
    this.shadowNodeDays = shadowNodeDays;
    this.lastActiveDate = lastActiveDate;
    this.consecutiveDays = shadowNodeDays;
  }

  /**
   * Get data for persistence
   */
  getData(): { consecutiveDays: number; lastActiveDate: string | null } {
    return {
      consecutiveDays: this.getConsecutiveDays(),
      lastActiveDate: this.lastActiveDate,
    };
  }

  /**
   * Load data from persistence
   */
  loadData(data: { consecutiveDays: number; lastActiveDate: string | null }): void {
    this.consecutiveDays = data.consecutiveDays;
    this.lastActiveDate = data.lastActiveDate;
  }
}

/**
 * Global active booster tracker instance
 */
let globalActiveBoosterTracker: ActiveBoosterTracker | null = null;

/**
 * Get or create global active booster tracker
 */
export function getActiveBoosterTracker(): ActiveBoosterTracker {
  if (!globalActiveBoosterTracker) {
    // Try to restore from localStorage
    let shadowNodeDays = 0;
    let lastActiveDate: string | null = null;
    
    if (typeof localStorage !== "undefined") {
      const storedDays = localStorage.getItem("indexerchain_consecutive_days");
      const storedDate = localStorage.getItem("indexerchain_last_active_date");
      
      if (storedDays) {
        shadowNodeDays = parseInt(storedDays, 10);
      }
      if (storedDate) {
        lastActiveDate = storedDate;
      }
    }
    
    globalActiveBoosterTracker = new ActiveBoosterTracker(shadowNodeDays, lastActiveDate);
  }
  
  return globalActiveBoosterTracker;
}

/**
 * Save active booster data to localStorage
 */
export function saveActiveBoosterData(): void {
  if (typeof localStorage === "undefined" || !globalActiveBoosterTracker) {
    return;
  }
  
  const data = globalActiveBoosterTracker.getData();
  localStorage.setItem("indexerchain_consecutive_days", data.consecutiveDays.toString());
  if (data.lastActiveDate) {
    localStorage.setItem("indexerchain_last_active_date", data.lastActiveDate);
  }
}

