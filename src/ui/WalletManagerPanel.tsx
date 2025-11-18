/**
 * Wallet Manager Panel Component
 * 
 * Phase 24: Multi-Account Architecture
 * 
 * UI component for managing multiple wallets
 */

import { useState, useEffect, useRef } from "react";
import { getMultiWalletStore, type Wallet } from "../core/multiWallet.js";
import { downloadBackupFile, readBackupFile } from "../core/walletBackup.js";

interface WalletManagerPanelProps {
  onWalletChanged?: () => void;
  onError?: (error: string) => void;
}

export function WalletManagerPanel({
  onWalletChanged,
  onError,
}: WalletManagerPanelProps) {
  const walletStore = getMultiWalletStore();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [currentWallet, setCurrentWallet] = useState<Wallet | null>(null);
  const [miningWallet, setMiningWallet] = useState<Wallet | null>(null);
  const [newWalletName, setNewWalletName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [exportingWalletId, setExportingWalletId] = useState<string | null>(null);
  const [exportPassword, setExportPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [importPassword, setImportPassword] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshWallets = () => {
    const allWallets = walletStore.listWallets();
    setWallets(allWallets);
    setCurrentWallet(walletStore.getCurrentWallet());
    setMiningWallet(walletStore.getMiningWallet());
  };

  useEffect(() => {
    refreshWallets();
  }, []);

  const handleCreateWallet = async () => {
    if (!newWalletName.trim()) {
      onError?.("Please enter a wallet name");
      return;
    }
    try {
      setIsCreating(true);
      await walletStore.createWallet(newWalletName.trim());
      setNewWalletName("");
      refreshWallets();
      onWalletChanged?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to create wallet");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSwitchWallet = (walletId: string) => {
    try {
      walletStore.setCurrentWallet(walletId);
      refreshWallets();
      onWalletChanged?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to switch wallet");
    }
  };

  const handleSetMiningWallet = (walletId: string) => {
    try {
      walletStore.setMiningWallet(walletId);
      refreshWallets();
      onWalletChanged?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to set mining wallet");
    }
  };

  const handleRenameWallet = (walletId: string) => {
    if (!editingName.trim()) {
      setEditingWalletId(null);
      return;
    }
    try {
      walletStore.renameWallet(walletId, editingName.trim());
      setEditingWalletId(null);
      setEditingName("");
      refreshWallets();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to rename wallet");
    }
  };

  const handleDeleteWallet = (walletId: string) => {
    if (!window.confirm(`Delete wallet "${wallets.find(w => w.id === walletId)?.name}"? This cannot be undone.`)) {
      return;
    }
    try {
      walletStore.deleteWallet(walletId);
      refreshWallets();
      onWalletChanged?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to delete wallet");
    }
  };

  const handleExportWallet = async (walletId: string) => {
    if (!exportPassword) {
      onError?.("Please enter a password");
      return;
    }
    try {
      setExportingWalletId(walletId);
      const backupData = await walletStore.exportEncryptedWallet(walletId, exportPassword);
      downloadBackupFile(backupData, `wallet-${wallets.find(w => w.id === walletId)?.name || walletId}-${Date.now()}.idcbackup`);
      setExportPassword("");
      setExportingWalletId(null);
      onError?.("✅ Wallet exported successfully!");
      setTimeout(() => onError?.(""), 3000);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to export wallet");
      setExportingWalletId(null);
    }
  };

  const handleImportWallet = async (file: File) => {
    if (!importPassword) {
      onError?.("Please enter the backup password");
      return;
    }
    try {
      setImporting(true);
      const backupData = await readBackupFile(file);
      await walletStore.importEncryptedWallet(backupData, importPassword);
      setImportPassword("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      refreshWallets();
      onWalletChanged?.();
      onError?.("✅ Wallet imported successfully!");
      setTimeout(() => onError?.(""), 3000);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to import wallet");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Current & Mining Wallet Info */}
      <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "4px", border: "1px solid #dee2e6" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          📋 Active Wallets
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.9rem" }}>
          <div>
            <strong>Current Wallet:</strong>{" "}
            <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
              {currentWallet ? `${currentWallet.name} (${currentWallet.address.substring(0, 20)}...)` : "None"}
            </span>
          </div>
          <div>
            <strong>Mining Wallet:</strong>{" "}
            <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
              {miningWallet ? `${miningWallet.name} (${miningWallet.address.substring(0, 20)}...)` : "None"}
            </span>
          </div>
        </div>
      </div>

      {/* Wallet List */}
      <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "4px", border: "1px solid #dee2e6" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          💼 Wallet List ({wallets.length})
        </h4>
        {wallets.length === 0 ? (
          <div style={{ fontSize: "0.9rem", color: "#666", padding: "1rem", textAlign: "center" }}>
            No wallets yet. Create your first wallet below.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {wallets.map((wallet) => (
              <div
                key={wallet.id}
                style={{
                  padding: "0.75rem",
                  background: wallet.id === currentWallet?.id ? "#e7f3ff" : "white",
                  borderRadius: "4px",
                  border: wallet.id === currentWallet?.id ? "2px solid #667eea" : "1px solid #ddd",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div>
                    {editingWalletId === wallet.id ? (
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          style={{ padding: "0.25rem", fontSize: "0.9rem" }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleRenameWallet(wallet.id);
                            } else if (e.key === "Escape") {
                              setEditingWalletId(null);
                              setEditingName("");
                            }
                          }}
                          autoFocus
                        />
                        <button
                          onClick={() => handleRenameWallet(wallet.id)}
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => {
                            setEditingWalletId(null);
                            setEditingName("");
                          }}
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                        >
                          ✗
                        </button>
                      </div>
                    ) : (
                      <strong style={{ fontSize: "0.95rem" }}>{wallet.name}</strong>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.25rem", fontSize: "0.75rem" }}>
                    {wallet.id === currentWallet?.id && (
                      <span style={{ background: "#667eea", color: "white", padding: "0.2rem 0.4rem", borderRadius: "3px" }}>
                        Current
                      </span>
                    )}
                    {wallet.id === miningWallet?.id && (
                      <span style={{ background: "#28a745", color: "white", padding: "0.2rem 0.4rem", borderRadius: "3px" }}>
                        Mining
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: "0.8rem", color: "#666", fontFamily: "monospace", marginBottom: "0.5rem", wordBreak: "break-all" }}>
                  {wallet.address}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {wallet.id !== currentWallet?.id && (
                    <button
                      onClick={() => handleSwitchWallet(wallet.id)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "#667eea", color: "white", border: "none", borderRadius: "3px", cursor: "pointer" }}
                    >
                      Set as Current
                    </button>
                  )}
                  {wallet.id !== miningWallet?.id && (
                    <button
                      onClick={() => handleSetMiningWallet(wallet.id)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "#28a745", color: "white", border: "none", borderRadius: "3px", cursor: "pointer" }}
                    >
                      Set as Mining
                    </button>
                  )}
                  {editingWalletId !== wallet.id && (
                    <button
                      onClick={() => {
                        setEditingWalletId(wallet.id);
                        setEditingName(wallet.name);
                      }}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "#ffc107", color: "#000", border: "none", borderRadius: "3px", cursor: "pointer" }}
                    >
                      Rename
                    </button>
                  )}
                  {exportingWalletId === wallet.id ? (
                    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                      <input
                        type="password"
                        placeholder="Password"
                        value={exportPassword}
                        onChange={(e) => setExportPassword(e.target.value)}
                        style={{ padding: "0.25rem", fontSize: "0.8rem", width: "100px" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleExportWallet(wallet.id);
                          }
                        }}
                      />
                      <button
                        onClick={() => handleExportWallet(wallet.id)}
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                      >
                        Export
                      </button>
                      <button
                        onClick={() => {
                          setExportingWalletId(null);
                          setExportPassword("");
                        }}
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                      >
                        ✗
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setExportingWalletId(wallet.id)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "#17a2b8", color: "white", border: "none", borderRadius: "3px", cursor: "pointer" }}
                    >
                      Export
                    </button>
                  )}
                  {wallets.length > 1 && (
                    <button
                      onClick={() => handleDeleteWallet(wallet.id)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "#dc3545", color: "white", border: "none", borderRadius: "3px", cursor: "pointer" }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create New Wallet */}
      <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "4px", border: "1px solid #dee2e6" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          ➕ Create New Wallet
        </h4>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="text"
            placeholder="Wallet name"
            value={newWalletName}
            onChange={(e) => setNewWalletName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCreateWallet();
              }
            }}
            style={{ flex: 1, padding: "0.5rem" }}
            disabled={isCreating}
          />
          <button
            onClick={handleCreateWallet}
            disabled={isCreating || !newWalletName.trim()}
            style={{ padding: "0.5rem 1rem", background: "#667eea", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
          >
            {isCreating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>

      {/* Import Wallet */}
      <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "4px", border: "1px solid #dee2e6" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          📥 Import Wallet
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <input
            type="file"
            accept=".idcbackup,application/json"
            ref={fileInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleImportWallet(file);
              }
            }}
            style={{ padding: "0.5rem" }}
            disabled={importing}
          />
          <input
            type="password"
            placeholder="Backup password"
            value={importPassword}
            onChange={(e) => setImportPassword(e.target.value)}
            style={{ padding: "0.5rem" }}
            disabled={importing}
          />
        </div>
      </div>
    </div>
  );
}

