/**
 * Wallet Backup Panel Component
 * 
 * Phase 23: Account Backup & Secure Recovery Layer
 * 
 * UI component for exporting and importing wallet backups
 */

import { useState, useRef } from "react";
import {
  exportWallet,
  importWallet,
  validatePassword,
  downloadBackupFile,
  readBackupFile,
} from "../core/walletBackup.js";

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
  const [exportPassword, setExportPassword] = useState("");
  const [exportConfirmPassword, setExportConfirmPassword] = useState("");
  const [exportPasswordStrength, setExportPasswordStrength] = useState<{
    isValid: boolean;
    message: string;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  
  const [importPassword, setImportPassword] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      
      const backupData = await exportWallet(exportPassword);
      downloadBackupFile(backupData);
      
      // Clear passwords
      setExportPassword("");
      setExportConfirmPassword("");
      setExportPasswordStrength(null);
      
      onExportSuccess?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to export wallet");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (file: File) => {
    if (!importPassword) {
      onError?.("Please enter your backup password");
      return;
    }
    
    try {
      setIsImporting(true);
      onError?.("");
      
      const backupData = await readBackupFile(file);
      const success = await importWallet(importPassword, backupData);
      
      if (success) {
        setImportPassword("");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        onImportSuccess?.();
      } else {
        onError?.("Failed to import wallet");
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to import wallet");
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImport(file);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Export Section */}
      <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "4px", border: "1px solid #dee2e6" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          🔐 Export Wallet
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div>
            <input
              type="password"
              placeholder="Enter password (min 8 characters)"
              value={exportPassword}
              onChange={(e) => {
                setExportPassword(e.target.value);
                if (e.target.value.length > 0) {
                  setExportPasswordStrength(validatePassword(e.target.value));
                } else {
                  setExportPasswordStrength(null);
                }
              }}
              style={{ width: "100%", padding: "0.5rem" }}
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
              placeholder="Confirm password"
              value={exportConfirmPassword}
              onChange={(e) => setExportConfirmPassword(e.target.value)}
              style={{ width: "100%", padding: "0.5rem" }}
              disabled={isExporting}
            />
            {exportConfirmPassword && exportPassword !== exportConfirmPassword && (
              <div style={{ fontSize: "0.8rem", marginTop: "0.25rem", color: "#dc3545" }}>
                Passwords do not match
              </div>
            )}
          </div>
          <button
            className="btn btn-primary"
            onClick={handleExport}
            disabled={
              isExporting ||
              !exportPassword ||
              !exportConfirmPassword ||
              exportPassword !== exportConfirmPassword ||
              (exportPasswordStrength !== null && !exportPasswordStrength.isValid)
            }
            style={{ width: "100%" }}
          >
            {isExporting ? "Exporting..." : "Export Wallet (.idcbackup)"}
          </button>
          <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
            💡 Your private key will be encrypted with PBKDF2 (200k iterations) + AES-GCM.
            Save the backup file securely - you'll need it to recover your wallet.
          </div>
        </div>
      </div>

      {/* Import Section */}
      <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "4px", border: "1px solid #dee2e6" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          ♻️ Import Wallet
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div>
            <input
              type="file"
              accept=".idcbackup,application/json"
              ref={fileInputRef}
              onChange={handleFileSelect}
              style={{ width: "100%", padding: "0.5rem" }}
              disabled={isImporting}
            />
          </div>
          <div>
            <input
              type="password"
              placeholder="Enter backup password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              style={{ width: "100%", padding: "0.5rem" }}
              disabled={isImporting}
            />
          </div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>
            💡 Select your .idcbackup file and enter the password you used when exporting.
            Your wallet identity will be restored to this browser.
          </div>
        </div>
      </div>

      {/* Security Notice */}
      <div style={{ padding: "0.75rem", background: "#fff3cd", borderRadius: "4px", border: "1px solid #ffc107", fontSize: "0.85rem" }}>
        <strong>⚠️ Security Notice:</strong>
        <ul style={{ margin: "0.5rem 0 0 1.5rem", padding: 0 }}>
          <li>Backup files are encrypted - never share your password</li>
          <li>Store backups in a secure location (password manager, encrypted drive)</li>
          <li>Without the backup file and password, you cannot recover your wallet</li>
          <li>This is a zero-trust system - no server stores your keys</li>
        </ul>
      </div>
    </div>
  );
}

