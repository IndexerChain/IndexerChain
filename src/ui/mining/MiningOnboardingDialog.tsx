/**
 * Phase 38: Mining Onboarding Dialog
 * 
 * First-time mining setup wizard
 */

import { useState } from "react";
import type { DeviceCapability } from "../../core/runtimeManager.js";
import type { RuntimeMiningProfile } from "../../core/runtimeManager.js";

interface MiningOnboardingDialogProps {
  deviceCapability: DeviceCapability;
  onComplete: (profile: RuntimeMiningProfile, dontShowAgain: boolean) => void;
  onCancel: () => void;
  locale: string;
}

export function MiningOnboardingDialog({
  deviceCapability,
  onComplete,
  onCancel,
  locale,
}: MiningOnboardingDialogProps) {
  const [step, setStep] = useState<number>(1);
  const [selectedPreset, setSelectedPreset] = useState<RuntimeMiningProfile["mode"]>("balanced");
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(false);

  const isZh = locale === "zh";

  const presets: Array<{
    mode: RuntimeMiningProfile["mode"];
    label: string;
    description: string;
    workerCount: number;
    dutyCycle: number;
  }> = [
    {
      mode: "power_save",
      label: isZh ? "省电模式" : "Power Save",
      description: isZh
        ? "低 CPU 占用，适合笔记本电脑或长时间运行"
        : "Low CPU usage, suitable for laptops or long-running",
      workerCount: Math.max(1, Math.floor(deviceCapability.recommendedWorkers * 0.5)),
      dutyCycle: 0.25,
    },
    {
      mode: "balanced",
      label: isZh ? "平衡模式" : "Balanced",
      description: isZh
        ? "平衡性能和功耗，推荐日常使用"
        : "Balance performance and power, recommended for daily use",
      workerCount: deviceCapability.recommendedWorkers,
      dutyCycle: 0.5,
    },
    {
      mode: "performance",
      label: isZh ? "性能模式" : "Performance",
      description: isZh
        ? "较高 CPU 占用，提升挖矿速度"
        : "Higher CPU usage, faster mining",
      workerCount: Math.min(deviceCapability.maxWorkers, deviceCapability.recommendedWorkers * 1.5),
      dutyCycle: 0.75,
    },
  ];

  const handleNext = () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      const preset = presets.find((p) => p.mode === selectedPreset) || presets[1];
      onComplete(
        {
          workerCount: preset.workerCount,
          dutyCycle: preset.dutyCycle,
          mode: preset.mode,
        },
        dontShowAgain
      );
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "12px",
          padding: "2rem",
          maxWidth: "600px",
          width: "90%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <h2 style={{ margin: 0, marginBottom: "1.5rem", fontSize: "1.5rem" }}>
          {isZh ? "⛏️ 首次挖矿设置" : "⛏️ First-Time Mining Setup"}
        </h2>

        {/* Step 1: Environment Check */}
        {step === 1 && (
          <div>
            <h3 style={{ marginBottom: "1rem" }}>
              {isZh ? "步骤 1/3: 环境检查" : "Step 1/3: Environment Check"}
            </h3>
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ padding: "1rem", background: "#e7f3ff", borderRadius: "6px" }}>
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>{isZh ? "检测到的设备" : "Detected Device"}:</strong>{" "}
                  {deviceCapability.deviceType}
                </div>
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>{isZh ? "CPU 核心数" : "CPU Cores"}:</strong>{" "}
                  {deviceCapability.hardwareConcurrency}
                </div>
                <div>
                  <strong>{isZh ? "推荐 Worker 数" : "Recommended Workers"}:</strong>{" "}
                  {deviceCapability.recommendedWorkers}
                </div>
              </div>
            </div>
            <div
              style={{
                padding: "1rem",
                background: "#fff3cd",
                borderRadius: "6px",
                fontSize: "0.9rem",
                color: "#856404",
              }}
            >
              {isZh ? (
                <>
                  <strong>提示：</strong>
                  <ul style={{ margin: "0.5rem 0", paddingLeft: "1.5rem" }}>
                    <li>在笔记本电脑上，风扇噪音高时请使用省电模式</li>
                    <li>确保设备有良好的散热条件</li>
                    <li>不建议在电量较低的设备上长时间挖矿</li>
                  </ul>
                </>
              ) : (
                <>
                  <strong>Tips:</strong>
                  <ul style={{ margin: "0.5rem 0", paddingLeft: "1.5rem" }}>
                    <li>On laptops, use Power Save mode when fan noise is high</li>
                    <li>Ensure proper cooling for your device</li>
                    <li>Not recommended for long mining on low battery devices</li>
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Safety Notice */}
        {step === 2 && (
          <div>
            <h3 style={{ marginBottom: "1rem" }}>
              {isZh ? "步骤 2/3: 安全说明" : "Step 2/3: Safety Notice"}
            </h3>
            <div
              style={{
                padding: "1rem",
                background: "#d1ecf1",
                borderRadius: "6px",
                fontSize: "0.9rem",
                color: "#0c5460",
              }}
            >
              {isZh ? (
                <>
                  <strong>重要提示：</strong>
                  <ul style={{ margin: "0.5rem 0", paddingLeft: "1.5rem" }}>
                    <li>挖矿会占用 CPU 资源，可能导致设备发热和风扇噪音</li>
                    <li>浏览器可能变慢，可以随时点击停止按钮</li>
                    <li>不建议在电量较低的设备上长时间挖矿</li>
                    <li>如果设备过热，请立即停止挖矿</li>
                  </ul>
                </>
              ) : (
                <>
                  <strong>Important:</strong>
                  <ul style={{ margin: "0.5rem 0", paddingLeft: "1.5rem" }}>
                    <li>Mining will use CPU resources, may cause device heating and fan noise</li>
                    <li>Browser may slow down, you can stop mining anytime</li>
                    <li>Not recommended for long mining on low battery devices</li>
                    <li>If device overheats, stop mining immediately</li>
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Mode Selection */}
        {step === 3 && (
          <div>
            <h3 style={{ marginBottom: "1rem" }}>
              {isZh ? "步骤 3/3: 选择模式" : "Step 3/3: Select Mode"}
            </h3>
            <div
              style={{
                display: "grid",
                gap: "1rem",
                marginBottom: "1rem",
              }}
            >
              {presets.map((preset) => (
                <div
                  key={preset.mode}
                  onClick={() => setSelectedPreset(preset.mode)}
                  style={{
                    padding: "1rem",
                    background: selectedPreset === preset.mode ? "rgba(40, 167, 69, 0.1)" : "white",
                    border: `2px solid ${selectedPreset === preset.mode ? "#28a745" : "#e9ecef"}`,
                    borderRadius: "8px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
                    {preset.label}
                    {selectedPreset === preset.mode && (
                      <span style={{ marginLeft: "0.5rem", color: "#28a745" }}>✓</span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
                    {preset.description}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#999" }}>
                    {isZh ? "Worker 数" : "Workers"}: {preset.workerCount} |{" "}
                    {isZh ? "Duty Cycle" : "Duty Cycle"}: {preset.dutyCycle}
                  </div>
                </div>
              ))}
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
              />
              {isZh ? "不再显示此提示" : "Don't show this again"}
            </label>
          </div>
        )}

        {/* Navigation Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "2rem",
            gap: "1rem",
          }}
        >
          <button
            onClick={step === 1 ? onCancel : handleBack}
            style={{
              padding: "0.75rem 1.5rem",
              background: "white",
              color: "#667eea",
              border: "1px solid #667eea",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            {step === 1
              ? isZh
                ? "取消"
                : "Cancel"
              : isZh
              ? "上一步"
              : "Back"}
          </button>
          <button
            onClick={handleNext}
            style={{
              padding: "0.75rem 1.5rem",
              background: "#28a745",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            {step === 3
              ? isZh
                ? "完成并开始挖矿"
                : "Complete & Start Mining"
              : isZh
              ? "下一步"
              : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

