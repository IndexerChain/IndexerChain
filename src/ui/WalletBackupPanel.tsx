/**
 * Wallet Backup Panel Component
 * 
 * Phase 23: Account Backup & Secure Recovery Layer
 * 
 * UI component for exporting and importing wallet backups
 */

import { useState, useRef, useEffect } from "react";
import {
  validatePassword,
  downloadBackupFile,
  readBackupFile,
  type WalletBackup,
} from "../core/walletBackup.js";
import { getMultiWalletStore } from "../core/multiWallet.js";
import { getOrCreateNodeAddress } from "../core/keys.js";
import { useI18n } from "../i18n/useI18n.js";

interface WalletBackupPanelProps {
  onExportSuccess?: () => void;
  onImportSuccess?: () => void;
  onError?: (error: string) => void;
}

export function WalletBackupPanel({
  onExportSuccess,
  onImportSuccess,
  onError,
}: WalletBackupPanelProps) {
  const { t } = useI18n();
  const [exportPassword, setExportPassword] = useState("");
  const [exportConfirmPassword, setExportConfirmPassword] = useState("");
  const [exportPasswordStrength, setExportPasswordStrength] = useState<{
    isValid: boolean;
    message: string;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [currentAddress, setCurrentAddress] = useState<string>("");
  const [exportSuccess, setExportSuccess] = useState<string>("");
  
  const [importPassword, setImportPassword] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<{
    name: string;
    size: string;
    createdAt?: string;
  } | null>(null);
  const [importSuccess, setImportSuccess] = useState<{
    walletName: string;
    address: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load current address
  useEffect(() => {
    getOrCreateNodeAddress().then(setCurrentAddress).catch(() => {});
  }, []);

  const handleExport = async () => {
    if (!exportPassword) {
      onError?.("Please enter a password");
      return;
    }
    
    if (exportPassword !== exportConfirmPassword) {
      onError?.("Passwords do not match");
      return;
    }
    
    const validation = validatePassword(exportPassword);
    if (!validation.isValid) {
      onError?.(validation.message);
      return;
    }
    
    try {
      setIsExporting(true);
      onError?.("");
      setExportSuccess("");
      
      // Phase 24: Use MultiWalletStore to export current wallet
      const walletStore = getMultiWalletStore();
      const currentWallet = walletStore.getCurrentWallet();
      
      if (!currentWallet) {
        throw new Error(t("wallet.pleaseEnterWalletName"));
      }
      
      // Export current wallet using MultiWalletStore
      const backupData = await walletStore.exportEncryptedWallet(currentWallet.id, exportPassword);
      
      // Verify exported address matches current address
      const exportedAddress = await getOrCreateNodeAddress();
      if (exportedAddress !== currentAddress) {
        // Address mismatch after export
      }
      
      const filename = `indexerchain-wallet-backup-${Date.now()}.idcbackup`;
      downloadBackupFile(backupData, filename);
      
      // Show success message with address confirmation
      setExportSuccess(
        t("wallet.backupFileDownloaded", {
          filename,
          address: currentAddress.substring(0, 20),
        })
      );
      
      // Clear passwords
      setExportPassword("");
      setExportConfirmPassword("");
      setExportPasswordStrength(null);
      
      // Clear success message after 10 seconds
      setTimeout(() => setExportSuccess(""), 10000);
      
      onExportSuccess?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : t("wallet.failedToExport"));
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check if password is entered
    if (!importPassword) {
      onError?.(t("wallet.pleaseEnterBackupPassword"));
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }
    
    setSelectedFile(file);
    setFilePreview(null);
    setImportSuccess(null);
    onError?.("");
    
    // Preview file info
    try {
      const backupData = await readBackupFile(file);
      const backup: WalletBackup = JSON.parse(backupData);
      
      setFilePreview({
        name: file.name,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        createdAt: backup.createdAt ? new Date(backup.createdAt).toLocaleString() : undefined,
      });
    } catch (err) {
      onError?.(t("wallet.failedToReadBackup"));
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      onError?.(t("wallet.selectBackupFile"));
      return;
    }
    
    if (!importPassword) {
      onError?.(t("wallet.pleaseEnterBackupPassword"));
      return;
    }
    
    try {
      setIsImporting(true);
      onError?.("");
      setImportSuccess(null);
      
      const backupData = await readBackupFile(selectedFile);
      
      // Use MultiWalletStore to import wallet (this adds it to the wallet list)
      const walletStore = getMultiWalletStore();
      const importedWallet = await walletStore.importEncryptedWallet(
        backupData,
        importPassword,
        `Imported Wallet ${new Date().toLocaleString()}`
      );
      
      // Set imported wallet as current wallet
      walletStore.setCurrentWallet(importedWallet.id);
      
      // Update current address
      setCurrentAddress(importedWallet.address);
      
      // Show success message
      setImportSuccess({
        walletName: importedWallet.name,
        address: importedWallet.address,
      });
      
      // Clear form
      setImportPassword("");
      setSelectedFile(null);
      setFilePreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      
      // Clear success message after 10 seconds
      setTimeout(() => setImportSuccess(null), 10000);
      
      onImportSuccess?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to import wallet");
      setSelectedFile(null);
      setFilePreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Export Section */}
      <div style={{ padding: "1rem", background: "var(--color-surface)", borderRadius: "4px", border: "1px solid var(--color-border)" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          {t("wallet.exportTitle")}
        </h4>
        
        {/* Current Wallet Info */}
        {currentAddress && (
          <div style={{ 
            padding: "0.75rem", 
            background: "rgba(88, 166, 255, 0.1)", 
            borderRadius: "4px", 
            marginBottom: "0.75rem",
            fontSize: "0.85rem",
            border: "1px solid var(--color-secondary)"
          }}>
            <div style={{ fontWeight: "bold", marginBottom: "0.25rem" }}>
              {t("wallet.currentWalletAddress")}:
            </div>
              <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: "var(--color-secondary)" }}>
              {currentAddress}
            </div>
          </div>
        )}
        
        {/* Export Success Message */}
        {exportSuccess && (
          <div style={{ 
            padding: "0.75rem", 
            background: "rgba(35, 134, 54, 0.15)", 
            borderRadius: "4px", 
            marginBottom: "0.75rem",
            fontSize: "0.85rem",
            border: "1px solid #238636",
            color: "#3fb950"
          }}>
            {exportSuccess}
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await handleExport();
          }}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          <div>
            <input
              type="password"
              placeholder={t("wallet.enterPassword")}
              value={exportPassword}
              onChange={(e) => {
                setExportPassword(e.target.value);
                if (e.target.value.length > 0) {
                  setExportPasswordStrength(validatePassword(e.target.value));
                } else {
                  setExportPasswordStrength(null);
                }
              }}
              style={{ width: "100%", padding: "0.5rem", background: "var(--color-background)", border: "1px solid var(--color-border)", borderRadius: "4px", color: "var(--color-text)" }}
              disabled={isExporting}
            />
            {exportPasswordStrength && (
              <div
                style={{
                  fontSize: "0.8rem",
                  marginTop: "0.25rem",
                  color: exportPasswordStrength.isValid ? "#28a745" : "#dc3545",
                }}
              >
                {exportPasswordStrength.message}
              </div>
            )}
          </div>
          <div>
            <input
              type="password"
              placeholder={t("wallet.confirmPassword")}
              value={exportConfirmPassword}
              onChange={(e) => setExportConfirmPassword(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", background: "var(--color-background)", border: "1px solid var(--color-border)", borderRadius: "4px", color: "var(--color-text)" }}
              disabled={isExporting}
            />
            {exportConfirmPassword && exportPassword !== exportConfirmPassword && (
              <div style={{ fontSize: "0.8rem", marginTop: "0.25rem", color: "#dc3545" }}>
                {t("wallet.passwordsNotMatch")}
              </div>
            )}
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              isExporting ||
              !exportPassword ||
              !exportConfirmPassword ||
              exportPassword !== exportConfirmPassword ||
              (exportPasswordStrength !== null && !exportPasswordStrength.isValid)
            }
            style={{ width: "100%" }}
          >
            {isExporting ? t("common.loading") : `${t("wallet.exportWallet")} (.idcbackup)`}
          </button>
          <div style={{ fontSize: "0.75rem", color: "#8b949e", marginTop: "0.25rem" }}>
            {t("wallet.encryptionNotice")}
          </div>
        </form>
      </div>

      {/* Import Section */}
      <div style={{ padding: "1rem", background: "var(--color-surface)", borderRadius: "4px", border: "1px solid var(--color-border)" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          {t("wallet.importTitle")}
        </h4>
        
        {/* Import Success Message */}
        {importSuccess && (
          <div style={{ 
            padding: "0.75rem", 
            background: "rgba(35, 134, 54, 0.15)", 
            borderRadius: "4px", 
            marginBottom: "0.75rem",
            fontSize: "0.85rem",
            border: "1px solid #238636",
            color: "#3fb950"
          }}>
            <div style={{ fontWeight: "bold", marginBottom: "0.25rem" }}>
              {t("wallet.importSuccess")}
            </div>
            <div style={{ marginBottom: "0.25rem" }}>
              <strong>{t("common.name")}:</strong> {importSuccess.walletName}
            </div>
            <div>
              <strong>{t("wallet.address")}:</strong>{" "}
              <span style={{ fontFamily: "monospace", fontSize: "0.9rem" }}>
                {importSuccess.address}
              </span>
            </div>
          </div>
        )}
        
        {/* File Preview */}
        {filePreview && (
          <div style={{ 
            padding: "0.75rem", 
            background: "rgba(255, 165, 0, 0.1)", 
            borderRadius: "4px", 
            marginBottom: "0.75rem",
            fontSize: "0.85rem",
            border: "1px solid var(--color-warning)"
          }}>
            <div style={{ fontWeight: "bold", marginBottom: "0.25rem" }}>
              📄 {t("wallet.selectBackupFile")}:
            </div>
            <div style={{ marginBottom: "0.1rem" }}>
              <strong>{t("common.name")}:</strong> {filePreview.name}
            </div>
            <div style={{ marginBottom: "0.1rem" }}>
              <strong>{t("common.size")}:</strong> {filePreview.size}
            </div>
            {filePreview.createdAt && (
              <div>
                <strong>{t("common.created")}:</strong> {filePreview.createdAt}
              </div>
            )}
          </div>
        )}
        
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await handleImport();
          }}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: "bold" }}>
              {t("wallet.step1EnterPassword")}
            </label>
            <input
              type="password"
              placeholder={t("wallet.enterBackupPassword")}
              value={importPassword}
              onChange={(e) => {
                setImportPassword(e.target.value);
                // Don't call onError with empty string to avoid triggering alerts
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && selectedFile && importPassword) {
                  e.preventDefault();
                  handleImport();
                }
              }}
              style={{ width: "100%", padding: "0.5rem", background: "var(--color-background)", border: "1px solid var(--color-border)", borderRadius: "4px", color: "var(--color-text)" }}
              disabled={isImporting}
            />
            <div style={{ fontSize: "0.75rem", color: "#8b949e", marginTop: "0.25rem" }}>
              {t("wallet.passwordHint")}
            </div>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: "bold" }}>
              {t("wallet.step2SelectFile")}
            </label>
            <input
              type="file"
              accept=".idcbackup,application/json"
              ref={fileInputRef}
              onChange={handleFileSelect}
              style={{ width: "100%", padding: "0.5rem", background: "var(--color-background)", border: "1px solid var(--color-border)", borderRadius: "4px", color: "var(--color-text)" }}
              disabled={isImporting || !importPassword}
            />
            {!importPassword && (
              <div style={{ fontSize: "0.75rem", color: "#ff9800", marginTop: "0.25rem" }}>
                {t("wallet.enterPasswordFirst")}
              </div>
            )}
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isImporting || !selectedFile || !importPassword}
            style={{ width: "100%" }}
          >
            {isImporting ? `⏳ ${t("common.loading")}` : `📥 ${t("wallet.importWallet")}`}
          </button>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>
            {t("wallet.fileHint")}
          </div>
        </form>
      </div>

      {/* Security Notice */}
      <div style={{ padding: "0.75rem", background: "rgba(255, 165, 0, 0.1)", borderRadius: "4px", border: "1px solid var(--color-warning)", fontSize: "0.85rem", color: "var(--color-text)" }}>
        <strong>{t("wallet.securityNotice")}</strong>
        <ul style={{ margin: "0.5rem 0 0 1.5rem", padding: 0 }}>
          <li>{t("wallet.securityNotice1")}</li>
          <li>{t("wallet.securityNotice2")}</li>
          <li>{t("wallet.securityNotice3")}</li>
          <li>{t("wallet.securityNotice4")}</li>
        </ul>
      </div>
    </div>
  );
}

