/**
 * Phase 38: Mining Advanced Panel
 * 
 * Advanced settings for mining: performance presets, worker count, duty cycle
 */

import { useState, useEffect } from "react";
import type { RuntimeMiningProfile } from "../../core/runtimeManager.js";
import { useI18n } from "../../i18n/useI18n.js";

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
  locale: _locale, // Unused - using useI18n() hook instead
}: MiningAdvancedPanelProps) {
  const { t } = useI18n();
  const [showCustom, setShowCustom] = useState<boolean>(false);
  const [selectedPresetMode, setSelectedPresetMode] = useState<RuntimeMiningProfile["mode"] | "custom" | null>(
    currentProfile?.mode || null
  );
  const [customWorkerCount, setCustomWorkerCount] = useState<number>(
    currentProfile?.workerCount || deviceCapability.recommendedWorkers
  );
  const [customDutyCycle, setCustomDutyCycle] = useState<number>(
    currentProfile?.dutyCycle || 0.5
  );

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
      label: t("mining.powerSave"),
      description: t("mining.powerSaveDesc"),
      workerCount: Math.max(1, Math.floor(deviceCapability.recommendedWorkers * 0.5)),
      dutyCycle: 0.25,
      color: "#17a2b8",
    },
    {
      mode: "balanced",
      label: t("mining.balanced"),
      description: t("mining.balancedDesc"),
      workerCount: deviceCapability.recommendedWorkers,
      dutyCycle: 0.5,
      color: "#28a745",
    },
    {
      mode: "performance",
      label: t("mining.performance"),
      description: t("mining.performanceDesc"),
      workerCount: Math.min(deviceCapability.maxWorkers, deviceCapability.recommendedWorkers * 1.5),
      dutyCycle: 0.75,
      color: "#ffc107",
    },
    {
      mode: "extreme",
      label: t("mining.extreme"),
      description: t("mining.extremeDesc"),
      workerCount: deviceCapability.maxWorkers,
      dutyCycle: 1.0,
      color: "#dc3545",
      warning: t("mining.extremeWarning"),
    },
  ];

  // Sync selectedPresetMode only on initial mount or when currentProfile mode changes to a preset
  // Don't override user's manual selection
  useEffect(() => {
    if (currentProfile?.mode && !selectedPresetMode) {
      const validModes: RuntimeMiningProfile["mode"][] = ["power_save", "balanced", "performance", "extreme"];
      if (validModes.includes(currentProfile.mode)) {
        // Only update if no preset is currently selected (initial state)
        setSelectedPresetMode(currentProfile.mode);
      }
    }
  }, [currentProfile?.mode, selectedPresetMode]);

  const handlePresetClick = (preset: typeof presets[0]) => {
    setSelectedPresetMode(preset.mode);
    onProfileChange({
      workerCount: preset.workerCount,
      dutyCycle: preset.dutyCycle,
      mode: preset.mode,
    });
    setShowCustom(false);
  };

  const handleCustomApply = () => {
    setSelectedPresetMode("custom");
    onCustomConfig(customWorkerCount, customDutyCycle);
    setShowCustom(false);
  };

  const estimatedCPUUsage = Math.round(customDutyCycle * customWorkerCount * 10); // Rough estimate

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ margin: 0, marginBottom: "1rem", fontSize: "1.1rem" }}>
        {t("mining.performancePresets")}
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
        {t("mining.detectedDevice")}: <strong>{deviceCapability.deviceType}</strong>, {t("mining.cpuCores")}:{" "}
        <strong>{deviceCapability.hardwareConcurrency}</strong>, {t("mining.recommendedWorkers")}:{" "}
        <strong>{deviceCapability.recommendedWorkers}</strong>
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
          const isSelected = selectedPresetMode === preset.mode;

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
                {t("mining.workers")}: {preset.workerCount} | {t("mining.dutyCycle")}: {preset.dutyCycle}
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
          {showCustom ? t("mining.hideCustomSettings") : t("mining.customSettings")}
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
                {t("mining.workerCountLabel")}: {customWorkerCount} ({t("mining.recommendedWorkers")}: {deviceCapability.recommendedWorkers})
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
                {t("mining.dutyCycle")}: {customDutyCycle.toFixed(2)} ({t("mining.estimatedCpuUsage")}: ≈ {estimatedCPUUsage}%)
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
              {t("mining.applyCustomSettings")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

