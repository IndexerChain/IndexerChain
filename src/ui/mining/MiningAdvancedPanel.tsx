/**
 * Phase 38: Mining Advanced Panel
 * 
 * Advanced settings for mining: performance presets, worker count, duty cycle
 */

import { useState } from "react";
import type { RuntimeMiningProfile } from "../../core/runtimeManager.js";

interface MiningAdvancedPanelProps {
  currentProfile: RuntimeMiningProfile | null;
  onProfileChange: (profile: RuntimeMiningProfile) => void;
  onCustomConfig: (workerCount: number, dutyCycle: number) => void;
  deviceCapability: {
    hardwareConcurrency: number;
    recommendedWorkers: number;
    maxWorkers: number;
    deviceType: "mobile" | "tablet" | "laptop" | "desktop";
  };
  locale: string;
}

export function MiningAdvancedPanel({
  currentProfile,
  onProfileChange,
  onCustomConfig,
  deviceCapability,
  locale,
}: MiningAdvancedPanelProps) {
  const [showCustom, setShowCustom] = useState<boolean>(false);
  const [customWorkerCount, setCustomWorkerCount] = useState<number>(
    currentProfile?.workerCount || deviceCapability.recommendedWorkers
  );
  const [customDutyCycle, setCustomDutyCycle] = useState<number>(
    currentProfile?.dutyCycle || 0.5
  );

  const isZh = locale === "zh";

  const presets: Array<{
    mode: RuntimeMiningProfile["mode"];
    label: string;
    description: string;
    workerCount: number;
    dutyCycle: number;
    color: string;
    warning?: string;
  }> = [
    {
      mode: "power_save",
      label: isZh ? "省电模式" : "Power Save",
      description: isZh
        ? "低 CPU 占用，适合笔记本电脑或长时间运行"
        : "Low CPU usage, suitable for laptops or long-running",
      workerCount: Math.max(1, Math.floor(deviceCapability.recommendedWorkers * 0.5)),
      dutyCycle: 0.25,
      color: "#17a2b8",
    },
    {
      mode: "balanced",
      label: isZh ? "平衡模式" : "Balanced",
      description: isZh
        ? "平衡性能和功耗，推荐日常使用"
        : "Balance performance and power, recommended for daily use",
      workerCount: deviceCapability.recommendedWorkers,
      dutyCycle: 0.5,
      color: "#28a745",
    },
    {
      mode: "performance",
      label: isZh ? "性能模式" : "Performance",
      description: isZh
        ? "较高 CPU 占用，提升挖矿速度"
        : "Higher CPU usage, faster mining",
      workerCount: Math.min(deviceCapability.maxWorkers, deviceCapability.recommendedWorkers * 1.5),
      dutyCycle: 0.75,
      color: "#ffc107",
    },
    {
      mode: "extreme",
      label: isZh ? "极限模式" : "Extreme",
      description: isZh
        ? "最高性能，可能导致设备发热和风扇噪音"
        : "Maximum performance, may cause device heating and fan noise",
      workerCount: deviceCapability.maxWorkers,
      dutyCycle: 1.0,
      color: "#dc3545",
      warning: isZh
        ? "⚠️ 可能导致设备过热，请确保良好散热"
        : "⚠️ May cause device overheating, ensure proper cooling",
    },
  ];

  const handlePresetClick = (preset: typeof presets[0]) => {
    onProfileChange({
      workerCount: preset.workerCount,
      dutyCycle: preset.dutyCycle,
      mode: preset.mode,
    });
    setShowCustom(false);
  };

  const handleCustomApply = () => {
    onCustomConfig(customWorkerCount, customDutyCycle);
    setShowCustom(false);
  };

  const estimatedCPUUsage = Math.round(customDutyCycle * customWorkerCount * 10); // Rough estimate

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.1rem" }}>
        {isZh ? "性能预设" : "Performance Presets"}
      </h3>

      {/* Device Info */}
      <div
        style={{
          marginBottom: "1rem",
          padding: "0.75rem",
          background: "#e7f3ff",
          borderRadius: "6px",
          fontSize: "0.85rem",
          color: "#004085",
        }}
      >
        {isZh ? (
          <>
            检测到设备: <strong>{deviceCapability.deviceType}</strong>，CPU 核心数:{" "}
            <strong>{deviceCapability.hardwareConcurrency}</strong>，推荐 Worker 数:{" "}
            <strong>{deviceCapability.recommendedWorkers}</strong>
          </>
        ) : (
          <>
            Detected device: <strong>{deviceCapability.deviceType}</strong>, CPU cores:{" "}
            <strong>{deviceCapability.hardwareConcurrency}</strong>, Recommended workers:{" "}
            <strong>{deviceCapability.recommendedWorkers}</strong>
          </>
        )}
      </div>

      {/* Preset Buttons */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        {presets.map((preset) => {
          const isSelected =
            currentProfile?.mode === preset.mode ||
            (currentProfile?.workerCount === preset.workerCount &&
              currentProfile?.dutyCycle === preset.dutyCycle);

          return (
            <div
              key={preset.mode}
              onClick={() => handlePresetClick(preset)}
              style={{
                padding: "1rem",
                background: isSelected ? "rgba(40, 167, 69, 0.1)" : "white",
                border: `2px solid ${isSelected ? preset.color : "#e9ecef"}`,
                borderRadius: "8px",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = preset.color;
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = "#e9ecef";
                }
              }}
            >
              <div
                style={{
                  fontWeight: "bold",
                  fontSize: "1rem",
                  color: preset.color,
                  marginBottom: "0.5rem",
                }}
              >
                {preset.label}
                {isSelected && (
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}>✓</span>
                )}
              </div>
              <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
                {preset.description}
              </div>
              <div style={{ fontSize: "0.8rem", color: "#999" }}>
                {isZh ? "Worker 数" : "Workers"}: {preset.workerCount} |{" "}
                {isZh ? "Duty Cycle" : "Duty Cycle"}: {preset.dutyCycle}
              </div>
              {preset.warning && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.5rem",
                    background: "#fff3cd",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    color: "#856404",
                  }}
                >
                  {preset.warning}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom Configuration */}
      <div style={{ marginTop: "1.5rem" }}>
        <button
          onClick={() => setShowCustom(!showCustom)}
          style={{
            padding: "0.5rem 1rem",
            background: showCustom ? "#667eea" : "white",
            color: showCustom ? "white" : "#667eea",
            border: "1px solid #667eea",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
        >
          {showCustom
            ? isZh
              ? "隐藏自定义设置"
              : "Hide Custom Settings"
            : isZh
            ? "自定义设置"
            : "Custom Settings"}
        </button>

        {showCustom && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1rem",
              background: "white",
              borderRadius: "8px",
              border: "1px solid #e9ecef",
            }}
          >
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
                {isZh ? "Worker 数量" : "Worker Count"}: {customWorkerCount} (
                {isZh ? "推荐" : "Recommended"}: {deviceCapability.recommendedWorkers})
              </label>
              <input
                type="range"
                min="1"
                max={deviceCapability.maxWorkers}
                value={customWorkerCount}
                onChange={(e) => setCustomWorkerCount(parseInt(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
                {isZh ? "Duty Cycle" : "Duty Cycle"}: {customDutyCycle.toFixed(2)} (
                {isZh ? "估算 CPU 占用" : "Estimated CPU Usage"}: ≈ {estimatedCPUUsage}%)
              </label>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={customDutyCycle}
                onChange={(e) => setCustomDutyCycle(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>

            <button
              onClick={handleCustomApply}
              style={{
                padding: "0.5rem 1rem",
                background: "#28a745",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              {isZh ? "应用自定义设置" : "Apply Custom Settings"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

