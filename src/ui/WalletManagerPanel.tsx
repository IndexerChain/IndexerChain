/**
 * Wallet Manager Panel Component
 * 
 * Phase 24: Multi-Account Architecture
 * 
 * UI component for managing multiple wallets
 */

import { useState, useEffect } from "react";
import { getMultiWalletStore, type Wallet } from "../core/multiWallet.js";
import { downloadBackupFile } from "../core/walletBackup.js";
import { useI18n } from "../i18n/useI18n.js";

interface WalletManagerPanelProps {
  onWalletChanged?: () => void;
  onError?: (error: string) => void;
}

export function WalletManagerPanel({
  onWalletChanged,
  onError,
}: WalletManagerPanelProps) {
  const { t } = useI18n();
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
      onError?.(t("wallet.pleaseEnterWalletName"));
      return;
    }
    try {
      setIsCreating(true);
      await walletStore.createWallet(newWalletName.trim());
      setNewWalletName("");
      refreshWallets();
      onWalletChanged?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : t("wallet.failedToExport"));
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
      onError?.(err instanceof Error ? err.message : t("wallet.failedToExport"));
    }
  };

  const handleSetMiningWallet = (walletId: string) => {
    try {
      walletStore.setMiningWallet(walletId);
      refreshWallets();
      onWalletChanged?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : t("wallet.failedToExport"));
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
      onError?.(err instanceof Error ? err.message : t("wallet.failedToExport"));
    }
  };

  const handleDeleteWallet = (walletId: string) => {
    const walletName = wallets.find(w => w.id === walletId)?.name || "";
    if (!window.confirm(`${t("wallet.deleteConfirm")} "${walletName}"? ${t("wallet.cannotUndone")}`)) {
      return;
    }
    try {
      walletStore.deleteWallet(walletId);
      refreshWallets();
      onWalletChanged?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : t("wallet.failedToDelete"));
    }
  };

  const handleExportWallet = async (walletId: string) => {
    if (!exportPassword) {
      onError?.(t("wallet.pleaseEnterPassword"));
      return;
    }
    try {
      setExportingWalletId(walletId);
      const backupData = await walletStore.exportEncryptedWallet(walletId, exportPassword);
      downloadBackupFile(backupData, `wallet-${wallets.find(w => w.id === walletId)?.name || walletId}-${Date.now()}.idcbackup`);
      setExportPassword("");
      setExportingWalletId(null);
      onError?.(t("wallet.walletExported"));
      setTimeout(() => onError?.(""), 3000);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : t("wallet.failedToExport"));
      setExportingWalletId(null);
    }
  };


  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Current & Mining Wallet Info */}
      <div style={{ padding: "1rem", background: "var(--color-surface)", borderRadius: "4px", border: "1px solid var(--color-border)" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          {t("wallet.activeWallets")}
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.9rem" }}>
          <div>
            <strong>{t("wallet.currentWallet")}:</strong>{" "}
            <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
              {currentWallet ? `${currentWallet.name} (${currentWallet.address.substring(0, 20)}...)` : t("common.none")}
            </span>
          </div>
          <div>
            <strong>{t("wallet.miningWallet")}:</strong>{" "}
            <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
              {miningWallet ? `${miningWallet.name} (${miningWallet.address.substring(0, 20)}...)` : t("common.none")}
            </span>
          </div>
        </div>
      </div>

      {/* Wallet List */}
      <div style={{ padding: "1rem", background: "var(--color-surface)", borderRadius: "4px", border: "1px solid var(--color-border)" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          {t("wallet.walletList")} ({wallets.length})
        </h4>
        {wallets.length === 0 ? (
          <div style={{ fontSize: "0.9rem", color: "#8b949e", padding: "1rem", textAlign: "center" }}>
            {t("wallet.noWallets")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {wallets.map((wallet) => (
              <div
                key={wallet.id}
                style={{
                  padding: "0.75rem",
                  background: wallet.id === currentWallet?.id ? "rgba(88, 166, 255, 0.1)" : "var(--color-surface)",
                  borderRadius: "4px",
                  border: wallet.id === currentWallet?.id ? "2px solid var(--color-secondary)" : "1px solid var(--color-border)",
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
                          style={{ padding: "0.25rem", fontSize: "0.9rem", background: "var(--color-background)", border: "1px solid var(--color-border)", borderRadius: "4px", color: "var(--color-text)" }}
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
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "var(--color-secondary)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer" }}
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => {
                            setEditingWalletId(null);
                            setEditingName("");
                          }}
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "var(--color-secondary)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer" }}
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
                      <span style={{ background: "var(--color-secondary)", color: "white", padding: "0.2rem 0.4rem", borderRadius: "3px" }}>
                        {t("wallet.currentWallet")}
                      </span>
                    )}
                    {wallet.id === miningWallet?.id && (
                      <span style={{ background: "#238636", color: "white", padding: "0.2rem 0.4rem", borderRadius: "3px" }}>
                        {t("wallet.miningWallet")}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: "0.8rem", color: "#8b949e", fontFamily: "monospace", marginBottom: "0.5rem", wordBreak: "break-all" }}>
                  {wallet.address}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {wallet.id !== currentWallet?.id && (
                    <button
                      onClick={() => handleSwitchWallet(wallet.id)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "var(--color-secondary)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer" }}
                    >
                      {t("wallet.setAsCurrent")}
                    </button>
                  )}
                  {wallet.id !== miningWallet?.id && (
                    <button
                      onClick={() => handleSetMiningWallet(wallet.id)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "#238636", color: "white", border: "none", borderRadius: "3px", cursor: "pointer" }}
                    >
                      {t("wallet.setAsMining")}
                    </button>
                  )}
                  {editingWalletId !== wallet.id && (
                    <button
                      onClick={() => {
                        setEditingWalletId(wallet.id);
                        setEditingName(wallet.name);
                      }}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "var(--color-warning)", color: "#000", border: "none", borderRadius: "3px", cursor: "pointer" }}
                    >
                      {t("wallet.rename")}
                    </button>
                  )}
                  {exportingWalletId === wallet.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleExportWallet(wallet.id);
                      }}
                      style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}
                    >
                      <input
                        type="password"
                        placeholder={t("wallet.enterPassword")}
                        value={exportPassword}
                        onChange={(e) => setExportPassword(e.target.value)}
                        style={{ padding: "0.25rem", fontSize: "0.8rem", width: "100px", background: "var(--color-background)", border: "1px solid var(--color-border)", borderRadius: "4px", color: "var(--color-text)" }}
                      />
                      <button
                        onClick={() => handleExportWallet(wallet.id)}
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                      >
                        {t("wallet.export")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExportingWalletId(null);
                          setExportPassword("");
                        }}
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                      >
                        ✗
                      </button>
                    </form>
                  ) : (
                    <button
                      onClick={() => setExportingWalletId(wallet.id)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "var(--color-secondary)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer" }}
                    >
                      {t("wallet.export")}
                    </button>
                  )}
                  {wallets.length > 1 && (
                    <button
                      onClick={() => handleDeleteWallet(wallet.id)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "var(--color-danger)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer" }}
                    >
                      {t("wallet.delete")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create New Wallet */}
      <div style={{ padding: "1rem", background: "var(--color-surface)", borderRadius: "4px", border: "1px solid var(--color-border)" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
          ➕ {t("wallet.createNewWallet")}
        </h4>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="text"
            placeholder={t("wallet.walletName")}
            value={newWalletName}
            onChange={(e) => setNewWalletName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCreateWallet();
              }
            }}
            style={{ flex: 1, padding: "0.5rem", background: "var(--color-background)", border: "1px solid var(--color-border)", borderRadius: "4px", color: "var(--color-text)" }}
            disabled={isCreating}
          />
          <button
            onClick={handleCreateWallet}
            disabled={isCreating || !newWalletName.trim()}
            style={{ padding: "0.5rem 1rem", background: "var(--color-secondary)", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
          >
            {isCreating ? t("common.loading") : t("wallet.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

