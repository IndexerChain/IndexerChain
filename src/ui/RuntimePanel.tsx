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
        issues.push(`Event loop lag: ${metrics.eventLoopLag.toFixed(1)}ms`);
      }
      if (metrics.fps < 20) {
        issues.push(`Low FPS: ${metrics.fps}`);
      }
      if (metrics.workerCrashes > 3) {
        issues.push(`High crash rate: ${metrics.workerCrashes} crashes/min`);
      }
      setSafetyIssues(issues);
    }, 1000);

    return () => clearInterval(interval);
  }, [runtimeManager, currentWorkers]);

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
        alert("Wake Lock API not supported or permission denied");
      }
    }
  };

  if (!runtimeManager || !config || !metrics || !deviceCap) {
    return (
      <div className="status-card">
        <h3>Runtime & Help</h3>
        <p>Initializing...</p>
      </div>
    );
  }

  const cpuUsagePercent = Math.round(dutyCycle * 100);
  const isBackground = document.hidden;

  return (
    <div className="status-card">
      <h3>🔧 Runtime & Help</h3>

      {/* Safety Warnings */}
      {safetyIssues.length > 0 && (
        <div className="error" style={{ marginBottom: "1rem", padding: "0.75rem" }}>
          <strong>⚠️ Safety Issues Detected:</strong>
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
          <strong>⚠️ Multi-tab Conflict:</strong>
          <p style={{ margin: "0.5rem 0 0 0" }}>
            Another tab is mining ({otherTabs.length} tab{otherTabs.length > 1 ? "s" : ""}).
            Consider stopping mining in other tabs to avoid resource conflicts.
          </p>
        </div>
      )}

      {/* Background Mode Indicator */}
      {isBackground && (
        <div className="info" style={{ marginBottom: "1rem", padding: "0.75rem" }}>
          <strong>📱 Background Mode:</strong>
          <p style={{ margin: "0.5rem 0 0 0" }}>
            Tab is in background. Mining is automatically throttled.
          </p>
        </div>
      )}

      {/* Device Info */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>Device Capability</h4>
        <div className="grid-2" style={{ marginTop: "0.5rem" }}>
          <div>
            <strong>Type:</strong> {deviceCap.deviceType}
          </div>
          <div>
            <strong>CPU Cores:</strong> {deviceCap.hardwareConcurrency}
          </div>
          <div>
            <strong>Recommended Workers:</strong> {deviceCap.recommendedWorkers}
          </div>
          <div>
            <strong>Max Workers:</strong> {deviceCap.maxWorkers}
          </div>
        </div>
      </div>

      {/* CPU Control */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>CPU Usage Control</h4>
        <div style={{ marginTop: "0.5rem" }}>
          <label>
            Duty Cycle: {cpuUsagePercent}%
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
            💾 Power Save
          </button>
          <button onClick={() => handlePreset("balanced")} className="button-secondary">
            ⚖️ Balanced
          </button>
          <button onClick={() => handlePreset("performance")} className="button-secondary">
            ⚡ Performance
          </button>
          <button onClick={() => handlePreset("extreme")} className="button-secondary">
            🔥 Extreme
          </button>
        </div>
      </div>

      {/* Worker Count Control */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>Worker Count</h4>
        <div style={{ marginTop: "0.5rem" }}>
          <label>
            Workers: {workerCount} / {maxWorkers}
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
              ⚠️ Worker count exceeds recommended ({deviceCap.recommendedWorkers}).
              This may cause performance issues.
            </div>
          )}
        </div>
      </div>

      {/* Performance Metrics */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>Performance Metrics</h4>
        <div className="grid-2" style={{ marginTop: "0.5rem" }}>
          <div>
            <strong>Event Loop Lag:</strong>{" "}
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
            <strong>Worker Crashes:</strong> {metrics.workerCrashes} / min
          </div>
          <div>
            <strong>Last Crash:</strong>{" "}
            {metrics.lastCrashTime
              ? new Date(metrics.lastCrashTime).toLocaleTimeString()
              : "Never"}
          </div>
        </div>
      </div>

      {/* Background Mode Settings */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>Background Mode</h4>
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
            Auto (throttle when background)
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
            Manual (no auto-throttle)
          </label>
        </div>
      </div>

      {/* Wake Lock */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h4>Persistent Background Mining</h4>
        <div style={{ marginTop: "0.5rem" }}>
          <button
            onClick={handleWakeLockToggle}
            className={wakeLockActive ? "button-secondary" : "button"}
            disabled={!config.enableWakeLock}
          >
            {wakeLockActive ? "🔒 Release Wake Lock" : "🔓 Request Wake Lock"}
          </button>
          <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#666" }}>
            Prevents browser from pausing mining when tab is in background.
            <br />
            <strong>Warning:</strong> High battery consumption!
          </p>
        </div>
      </div>

      {/* Help Section */}
      <div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "1px solid #ddd" }}>
        <h4>💡 Help & Tips</h4>
        <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
          <li>
            <strong>Duty Cycle:</strong> Controls CPU usage. Lower values reduce CPU
            usage but also reduce mining speed.
          </li>
          <li>
            <strong>Worker Count:</strong> More workers = more parallel mining, but
            higher CPU usage.
          </li>
          <li>
            <strong>Event Loop Lag:</strong> Should be &lt; 200ms. Higher values
            indicate UI lag.
          </li>
          <li>
            <strong>FPS:</strong> Should be &gt; 20. Lower values indicate UI
            stuttering.
          </li>
          <li>
            <strong>Multi-tab Conflict:</strong> Only one tab should mine at a time to
            avoid resource conflicts.
          </li>
        </ul>
      </div>
    </div>
  );
};

