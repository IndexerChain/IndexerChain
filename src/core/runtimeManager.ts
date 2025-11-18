/**
 * Phase 26: Runtime Manager
 * 
 * Manages browser mining safety features:
 * - Worker count limits
 * - Tab visibility handling
 * - Crash recovery
 * - Multi-tab conflict detection
 * - Performance monitoring
 * - Safety protection mechanisms
 */

export interface RuntimeConfig {
  maxWorkers: number;
  dutyCycle: number;
  backgroundMode: "auto" | "manual";
  enableWakeLock: boolean;
  enableMultiTabDetection: boolean;
}

export interface PerformanceMetrics {
  eventLoopLag: number; // ms
  fps: number;
  memoryUsage: number; // MB (if available)
  workerCrashes: number; // Count in last minute
  lastCrashTime: number | null;
}

export interface DeviceCapability {
  hardwareConcurrency: number;
  recommendedWorkers: number;
  maxWorkers: number;
  deviceType: "mobile" | "tablet" | "laptop" | "desktop";
}

/**
 * Phase 26: Detect device capabilities and recommend worker count
 */
export function detectDeviceCapability(): DeviceCapability {
  const hardwareConcurrency = navigator.hardwareConcurrency || 2;
  
  // Detect device type (rough heuristic)
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isTablet = /iPad|Android/i.test(navigator.userAgent) && !isMobile;
  
  let deviceType: DeviceCapability["deviceType"];
  let recommendedWorkers: number;
  let maxWorkers: number;
  
  if (isMobile) {
    deviceType = "mobile";
    recommendedWorkers = 1;
    maxWorkers = 2;
  } else if (isTablet) {
    deviceType = "tablet";
    recommendedWorkers = 2;
    maxWorkers = 4;
  } else if (hardwareConcurrency <= 2) {
    deviceType = "laptop";
    recommendedWorkers = 2;
    maxWorkers = 4;
  } else if (hardwareConcurrency <= 4) {
    deviceType = "laptop";
    recommendedWorkers = 4;
    maxWorkers = 8;
  } else {
    deviceType = "desktop";
    recommendedWorkers = Math.min(8, hardwareConcurrency);
    maxWorkers = Math.min(16, hardwareConcurrency);
  }
  
  return {
    hardwareConcurrency,
    recommendedWorkers,
    maxWorkers,
    deviceType,
  };
}

/**
 * Phase 26: Measure event loop lag
 */
export async function measureEventLoopLag(): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => {
      const lag = performance.now() - start;
      resolve(lag);
    }, 0);
  });
}

/**
 * Phase 26: Measure FPS using requestAnimationFrame
 */
export class FPSMonitor {
  private frameCount: number = 0;
  private lastTime: number = performance.now();
  private fps: number = 60;
  private rafId: number | null = null;
  private callback: ((fps: number) => void) | null = null;

  start(callback?: (fps: number) => void): void {
    this.callback = callback || null;
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.measure();
  }

  private measure = (): void => {
    this.frameCount++;
    const currentTime = performance.now();
    const elapsed = currentTime - this.lastTime;

    if (elapsed >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastTime = currentTime;
      if (this.callback) {
        this.callback(this.fps);
      }
    }

    this.rafId = requestAnimationFrame(this.measure);
  };

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  getFPS(): number {
    return this.fps;
  }
}

/**
 * Phase 26: Multi-tab conflict detection using BroadcastChannel
 */
export class MultiTabDetector {
  private channel: BroadcastChannel;
  private isActive: boolean = false;
  private otherTabsActive: Set<string> = new Set();
  private onConflictCallback: ((otherTabs: string[]) => void) | null = null;

  constructor(channelName: string = "indexerchain-miner") {
    this.channel = new BroadcastChannel(channelName);
    this.channel.addEventListener("message", this.handleMessage);
    
    // Listen for page visibility changes
    if (typeof document !== "undefined" && document) {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          this.broadcastInactive();
        } else {
          this.broadcastActive();
        }
      });
      
      // Broadcast active on load
      this.broadcastActive();
    }
  }

  private handleMessage = (event: MessageEvent): void => {
    const { type, tabId } = event.data;
    
    if (type === "MINER_ACTIVE") {
      if (tabId !== this.getTabId()) {
        this.otherTabsActive.add(tabId);
        if (this.isActive && this.onConflictCallback) {
          this.onConflictCallback(Array.from(this.otherTabsActive));
        }
      }
    } else if (type === "MINER_INACTIVE") {
      this.otherTabsActive.delete(tabId);
    }
  };

  private getTabId(): string {
    // Generate a unique ID for this tab
    let tabId = sessionStorage.getItem("indexerchain_tab_id");
    if (!tabId) {
      tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem("indexerchain_tab_id", tabId);
    }
    return tabId;
  }

  broadcastActive(): void {
    this.isActive = true;
    this.channel.postMessage({
      type: "MINER_ACTIVE",
      tabId: this.getTabId(),
      timestamp: Date.now(),
    });
  }

  broadcastInactive(): void {
    this.isActive = false;
    this.channel.postMessage({
      type: "MINER_INACTIVE",
      tabId: this.getTabId(),
      timestamp: Date.now(),
    });
  }

  hasConflict(): boolean {
    return this.otherTabsActive.size > 0;
  }

  getOtherTabs(): string[] {
    return Array.from(this.otherTabsActive);
  }

  onConflict(callback: (otherTabs: string[]) => void): void {
    this.onConflictCallback = callback;
  }

  destroy(): void {
    this.broadcastInactive();
    this.channel.close();
  }
}

/**
 * Phase 26: Wake Lock API wrapper (for persistent background mining)
 */
export class WakeLockManager {
  private wakeLock: WakeLockSentinel | null = null;

  async request(): Promise<boolean> {
    if (!("wakeLock" in navigator)) {
      return false;
    }

    try {
      this.wakeLock = await (navigator as any).wakeLock.request("screen");
      if (this.wakeLock) {
        this.wakeLock.addEventListener("release", () => {
          this.wakeLock = null;
        });
      }
      return true;
    } catch (error) {
      console.error("[WakeLock] Failed to request wake lock:", error);
      return false;
    }
  }

  async release(): Promise<void> {
    if (this.wakeLock) {
      await this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  isActive(): boolean {
    return this.wakeLock !== null;
  }
}

/**
 * Phase 26: Runtime Manager - Main class
 */
export class RuntimeManager {
  private config: RuntimeConfig;
  private performanceMetrics: PerformanceMetrics;
  private fpsMonitor: FPSMonitor;
  private multiTabDetector: MultiTabDetector;
  private wakeLockManager: WakeLockManager;
  private deviceCapability: DeviceCapability;
  private crashWindow: number[] = []; // Timestamps of crashes in last minute
  private safetyCheckInterval: number | null = null;

  constructor(config?: Partial<RuntimeConfig>) {
    this.deviceCapability = detectDeviceCapability();
    
    this.config = {
      maxWorkers: config?.maxWorkers ?? this.deviceCapability.maxWorkers,
      dutyCycle: config?.dutyCycle ?? 1.0,
      backgroundMode: config?.backgroundMode ?? "auto",
      enableWakeLock: config?.enableWakeLock ?? false,
      enableMultiTabDetection: config?.enableMultiTabDetection ?? true,
    };

    this.performanceMetrics = {
      eventLoopLag: 0,
      fps: 60,
      memoryUsage: 0,
      workerCrashes: 0,
      lastCrashTime: null,
    };

    this.fpsMonitor = new FPSMonitor();
    this.multiTabDetector = new MultiTabDetector();
    this.wakeLockManager = new WakeLockManager();

    // Start monitoring
    this.startMonitoring();
    
    // Handle visibility changes
    if (typeof document !== "undefined" && document) {
      document.addEventListener("visibilitychange", () => {
        this.handleVisibilityChange();
      });
    }

    // Handle multi-tab conflicts
    if (this.config.enableMultiTabDetection) {
      this.multiTabDetector.onConflict((otherTabs) => {
        console.warn("[RuntimeManager] Multi-tab conflict detected:", otherTabs);
        // Emit event or callback
      });
    }
  }

  private startMonitoring(): void {
    // Monitor FPS
    this.fpsMonitor.start((fps) => {
      this.performanceMetrics.fps = fps;
    });

    // Monitor event loop lag
    setInterval(async () => {
      const lag = await measureEventLoopLag();
      this.performanceMetrics.eventLoopLag = lag;
    }, 1000);

    // Safety check interval
    this.safetyCheckInterval = window.setInterval(() => {
      this.performSafetyCheck();
    }, 2000);
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      // Tab is in background
      if (this.config.backgroundMode === "auto") {
        // Auto-reduce duty cycle and workers
        this.config.dutyCycle = Math.min(this.config.dutyCycle, 0.1);
        // Emit event for UI to handle worker reduction
      }
    } else {
      // Tab is in foreground - restore previous settings
      // (UI should handle this)
    }
  }

  private performSafetyCheck(): void {
    const metrics = this.performanceMetrics;
    const issues: string[] = [];

    // Check event loop lag
    if (metrics.eventLoopLag > 200) {
      issues.push(`Event loop lag: ${metrics.eventLoopLag.toFixed(1)}ms`);
    }

    // Check FPS
    if (metrics.fps < 20) {
      issues.push(`Low FPS: ${metrics.fps}`);
    }

    // Check crash frequency
    const recentCrashes = this.crashWindow.filter(
      (time) => Date.now() - time < 60000
    );
    this.performanceMetrics.workerCrashes = recentCrashes.length;
    
    if (recentCrashes.length > 3) {
      issues.push(`High crash rate: ${recentCrashes.length} crashes/min`);
    }

    if (issues.length > 0) {
      console.warn("[RuntimeManager] Safety issues detected:", issues);
      // Emit event or callback for UI to handle
    }
  }

  recordCrash(): void {
    const now = Date.now();
    this.crashWindow.push(now);
    // Keep only crashes from last minute
    this.crashWindow = this.crashWindow.filter((time) => now - time < 60000);
    this.performanceMetrics.lastCrashTime = now;
  }

  getConfig(): RuntimeConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<RuntimeConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  getDeviceCapability(): DeviceCapability {
    return { ...this.deviceCapability };
  }

  hasMultiTabConflict(): boolean {
    return this.multiTabDetector.hasConflict();
  }

  getOtherTabs(): string[] {
    return this.multiTabDetector.getOtherTabs();
  }

  async requestWakeLock(): Promise<boolean> {
    if (this.config.enableWakeLock) {
      return await this.wakeLockManager.request();
    }
    return false;
  }

  async releaseWakeLock(): Promise<void> {
    await this.wakeLockManager.release();
  }

  destroy(): void {
    this.fpsMonitor.stop();
    this.multiTabDetector.destroy();
    this.wakeLockManager.release();
    if (this.safetyCheckInterval !== null) {
      clearInterval(this.safetyCheckInterval);
    }
  }
}

