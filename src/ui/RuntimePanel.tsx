/**
 * Phase 26: Runtime & Help Panel
 * 
 * Provides runtime controls and safety monitoring for browser mining
 */

import React, { useState, useEffect } from "react";
import {
  RuntimeManager,
  type RuntimeConfig,
  type PerformanceMetrics,
  type DeviceCapability,
} from "../core/runtimeManager";
import { useI18n } from "../i18n/useI18n";

interface RuntimePanelProps {
  runtimeManager: RuntimeManager | null;
  currentWorkers: number;
  maxWorkers: number;
  onUpdateConfig?: (config: Partial<RuntimeConfig>) => void;
  onSetDutyCycle?: (dutyCycle: number) => void;
  onSetWorkerCount?: (count: number) => void;
}

export const RuntimePanel: React.FC<RuntimePanelProps> = ({
  runtimeManager,
  currentWorkers,
  maxWorkers,
  onUpdateConfig,
  onSetDutyCycle,
  onSetWorkerCount,
}) => {
  const { t } = useI18n();
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [deviceCap, setDeviceCap] = useState<DeviceCapability | null>(null);
  const [dutyCycle, setDutyCycle] = useState(1.0);
  const [workerCount, setWorkerCount] = useState(currentWorkers);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [multiTabConflict, setMultiTabConflict] = useState(false);
  const [otherTabs, setOtherTabs] = useState<string[]>([]);
  const [safetyIssues, setSafetyIssues] = useState<string[]>([]);

  useEffect(() => {
    if (!runtimeManager) return;

    // Load initial config
    setConfig(runtimeManager.getConfig());
    setMetrics(runtimeManager.getPerformanceMetrics());
    setDeviceCap(runtimeManager.getDeviceCapability());
    setDutyCycle(runtimeManager.getConfig().dutyCycle);
    setWorkerCount(currentWorkers);
    setMultiTabConflict(runtimeManager.hasMultiTabConflict());
    setOtherTabs(runtimeManager.getOtherTabs());

    // Update metrics periodically
    const interval = setInterval(() => {
      setMetrics(runtimeManager.getPerformanceMetrics());
      setMultiTabConflict(runtimeManager.hasMultiTabConflict());
      setOtherTabs(runtimeManager.getOtherTabs());

      // Check for safety issues
      const metrics = runtimeManager.getPerformanceMetrics();
      const issues: string[] = [];
      if (metrics.eventLoopLag > 200) {
        issues.push(`${t("advanced.eventLoopLag")}: ${metrics.eventLoopLag.toFixed(1)}ms`);
      }
      if (metrics.fps < 20) {
        issues.push(`${t("advanced.lowFps")}: ${metrics.fps}`);
      }
      if (metrics.workerCrashes > 3) {
        issues.push(`${t("advanced.highCrashRate")}: ${metrics.workerCrashes} ${t("advanced.workerCrashes")}/min`);
      }
      setSafetyIssues(issues);
    }, 1000);

    return () => clearInterval(interval);
  }, [runtimeManager, currentWorkers, t]);

  const handleDutyCycleChange = (value: number) => {
    setDutyCycle(value);
    if (onSetDutyCycle) {
      onSetDutyCycle(value);
    }
    if (runtimeManager) {
      runtimeManager.updateConfig({ dutyCycle: value });
      if (onUpdateConfig) {
        onUpdateConfig({ dutyCycle: value });
      }
    }
  };

  const handleWorkerCountChange = (value: number) => {
    const clamped = Math.max(1, Math.min(value, maxWorkers));
    setWorkerCount(clamped);
    if (onSetWorkerCount) {
      onSetWorkerCount(clamped);
    }
  };

  const handlePreset = (preset: "power-save" | "balanced" | "performance" | "extreme") => {
    let newDutyCycle: number;
    let newWorkerCount: number;

    switch (preset) {
      case "power-save":
        newDutyCycle = 0.25;
        newWorkerCount = 1;
        break;
      case "balanced":
        newDutyCycle = 0.5;
        newWorkerCount = deviceCap?.recommendedWorkers || 2;
        break;
      case "performance":
        newDutyCycle = 0.75;
        newWorkerCount = deviceCap?.recommendedWorkers || 4;
        break;
      case "extreme":
        newDutyCycle = 1.0;
        newWorkerCount = maxWorkers;
        break;
    }

    handleDutyCycleChange(newDutyCycle);
    handleWorkerCountChange(newWorkerCount);
  };

  const handleWakeLockToggle = async () => {
    if (!runtimeManager) return;
    if (wakeLockActive) {
      await runtimeManager.releaseWakeLock();
      setWakeLockActive(false);
    } else {
      const success = await runtimeManager.requestWakeLock();
      setWakeLockActive(success);
      if (!success) {
        alert(t("advanced.wakeLockNotSupported"));
      }
    }
  };

  if (!runtimeManager || !config || !metrics || !deviceCap) {
    return (
      <div className="status-card">
        <h3>{t("advanced.runtimeHelp")}</h3>
        <p>{t("advanced.initializing")}</p>
      </div>
    );
  }

  const cpuUsagePercent = Math.round(dutyCycle * 100);
  const isBackground = document.hidden;

  return (
    <div className="status-card">
      <h3>{t("advanced.runtimeHelp")}</h3>

      {/* Safety Warnings */}
      {safetyIssues.length > 0 && (
        <div className="error" style={{ marginBottom: "1rem", padding: "0.75rem" }}>
          <strong>{t("advanced.safetyIssuesDetected")}:</strong>
          <ul style={{ margin: "0.5rem 0 0 0", paddingLeft: "1.5rem" }}>
            {safetyIssues.map((issue, idx) => (
              <li key={idx}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Multi-tab Conflict Warning */}
      {multiTabConflict && (
        <div className="warning" style={{ marginBottom: "1rem", padding: "0.75rem" }}>
          <strong>{t("advanced.multiTabConflict")}:</strong>
          <p style={{ margin: "0.5rem 0 0 0" }}>
            {t("advanced.anotherTabMining", { count: otherTabs.length, plural: otherTabs.length > 1 ? "s" : "" })}.
            {t("advanced.considerStopping")}
          </p>
        </div>
      )}

      {/* Background Mode Indicator */}
      {isBackground && (
        <div className="info" style={{ marginBottom: "1rem", padding: "0.75rem" }}>
          <strong>{t("advanced.backgroundMode")}:</strong>
          <p style={{ margin: "0.5rem 0 0 0" }}>
            {t("advanced.tabInBackground")}
          </p>
        </div>
      )}

      {/* Device Info */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>{t("advanced.deviceCapability")}</h4>
        <div className="grid-2" style={{ marginTop: "0.5rem" }}>
          <div>
            <strong>{t("advanced.type")}:</strong> {deviceCap.deviceType}
          </div>
          <div>
            <strong>{t("advanced.cpuCores")}:</strong> {deviceCap.hardwareConcurrency}
          </div>
          <div>
            <strong>{t("advanced.recommendedWorkers")}:</strong> {deviceCap.recommendedWorkers}
          </div>
          <div>
            <strong>{t("advanced.maxWorkers")}:</strong> {deviceCap.maxWorkers}
          </div>
        </div>
      </div>

      {/* CPU Control */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>{t("advanced.cpuUsageControl")}</h4>
        <div style={{ marginTop: "0.5rem" }}>
          <label>
            {t("advanced.dutyCycle")}: {cpuUsagePercent}%
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={dutyCycle}
              onChange={(e) => handleDutyCycleChange(parseFloat(e.target.value))}
              style={{ width: "100%", marginTop: "0.5rem" }}
            />
          </label>
        </div>
        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button onClick={() => handlePreset("power-save")} className="button-secondary">
            {t("advanced.powerSave")}
          </button>
          <button onClick={() => handlePreset("balanced")} className="button-secondary">
            {t("advanced.balanced")}
          </button>
          <button onClick={() => handlePreset("performance")} className="button-secondary">
            {t("advanced.performance")}
          </button>
          <button onClick={() => handlePreset("extreme")} className="button-secondary">
            {t("advanced.extreme")}
          </button>
        </div>
      </div>

      {/* Worker Count Control */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>{t("advanced.workerCount")}</h4>
        <div style={{ marginTop: "0.5rem" }}>
          <label>
            {t("advanced.workers")}: {workerCount} / {maxWorkers}
            <input
              type="range"
              min="1"
              max={maxWorkers}
              step="1"
              value={workerCount}
              onChange={(e) => handleWorkerCountChange(parseInt(e.target.value))}
              style={{ width: "100%", marginTop: "0.5rem" }}
            />
          </label>
          {workerCount > deviceCap.recommendedWorkers && (
            <div className="warning" style={{ marginTop: "0.5rem", padding: "0.5rem" }}>
              {t("advanced.workerCountExceeds", { recommended: deviceCap.recommendedWorkers })}
              {t("advanced.mayCausePerformanceIssues")}
            </div>
          )}
        </div>
      </div>

      {/* Performance Metrics */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>{t("advanced.performanceMetrics")}</h4>
        <div className="grid-2" style={{ marginTop: "0.5rem" }}>
          <div>
            <strong>{t("advanced.eventLoopLag")}:</strong>{" "}
            <span className={metrics.eventLoopLag > 200 ? "error" : ""}>
              {metrics.eventLoopLag.toFixed(1)} ms
            </span>
          </div>
          <div>
            <strong>FPS:</strong>{" "}
            <span className={metrics.fps < 20 ? "error" : ""}>
              {metrics.fps}
            </span>
          </div>
          <div>
            <strong>{t("advanced.workerCrashes")}:</strong> {metrics.workerCrashes} / min
          </div>
          <div>
            <strong>{t("advanced.lastCrash")}:</strong>{" "}
            {metrics.lastCrashTime
              ? new Date(metrics.lastCrashTime).toLocaleTimeString()
              : t("advanced.never")}
          </div>
        </div>
      </div>

      {/* Background Mode Settings */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>{t("advanced.backgroundMode")}</h4>
        <div style={{ marginTop: "0.5rem" }}>
          <label>
            <input
              type="radio"
              name="backgroundMode"
              value="auto"
              checked={config.backgroundMode === "auto"}
              onChange={() => {
                runtimeManager.updateConfig({ backgroundMode: "auto" });
                if (onUpdateConfig) {
                  onUpdateConfig({ backgroundMode: "auto" });
                }
                setConfig(runtimeManager.getConfig());
              }}
            />{" "}
            {t("advanced.autoThrottleWhenBackground")}
          </label>
          <br />
          <label>
            <input
              type="radio"
              name="backgroundMode"
              value="manual"
              checked={config.backgroundMode === "manual"}
              onChange={() => {
                runtimeManager.updateConfig({ backgroundMode: "manual" });
                if (onUpdateConfig) {
                  onUpdateConfig({ backgroundMode: "manual" });
                }
                setConfig(runtimeManager.getConfig());
              }}
            />{" "}
            {t("advanced.manualNoAutoThrottle")}
          </label>
        </div>
      </div>

      {/* Wake Lock */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>{t("advanced.persistentBackgroundMining")}</h4>
        <div style={{ marginTop: "0.5rem" }}>
          <button
            onClick={handleWakeLockToggle}
            className={wakeLockActive ? "button-secondary" : "button"}
            disabled={!config.enableWakeLock}
          >
            {wakeLockActive ? t("advanced.releaseWakeLock") : t("advanced.requestWakeLock")}
          </button>
          <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#666" }}>
            {t("advanced.preventsBrowserPausing")}
            <br />
            <strong>{t("advanced.warning")}:</strong> {t("advanced.highBatteryConsumption")}
          </p>
        </div>
      </div>

      {/* Help Section */}
      <div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "1px solid #ddd" }}>
        <h4>{t("advanced.helpTips")}</h4>
        <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
          <li>
            {t("advanced.dutyCycleDesc")}
          </li>
          <li>
            {t("advanced.workerCountDesc")}
          </li>
          <li>
            {t("advanced.eventLoopLagDesc")}
          </li>
          <li>
            {t("advanced.fpsDesc")}
          </li>
          <li>
            {t("advanced.multiTabConflictDesc")}
          </li>
        </ul>
      </div>
    </div>
  );
};

