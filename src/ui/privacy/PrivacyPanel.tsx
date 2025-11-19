/**
 * Privacy Panel
 * 
 * Phase 28: UI for shielded transfers and privacy features
 */

import { useState, useEffect } from "react";
import { useI18n } from "../../i18n/useI18n.js";
import { formatAddress, formatNumber } from "../../utils/format.js";
import { getMultiWalletStore } from "../../core/multiWallet.js";
import { getStealthKeyStore } from "../../core/privacy/stealthKeyStore.js";
import { getNoteStore } from "../../core/privacy/noteStore.js";
import { useShieldedBalance } from "../hooks/useShieldedBalance.js";
import { createShieldedTransferTx } from "../../core/privacy/shieldedTxBuilder.js";
import { scanBlocksForNotes } from "../../core/privacy/noteScanner.js";
import type { ChainContext } from "../../core/chain.js";
import type { Note } from "../../core/privacy/types.js";

interface PrivacyPanelProps {
  chainContext: ChainContext | null;
  onBroadcastTx: (tx: any) => void;
}

export function PrivacyPanel({ chainContext, onBroadcastTx }: PrivacyPanelProps) {
  const { locale } = useI18n();
  const walletStore = getMultiWalletStore();
  const currentWallet = walletStore.getCurrentWallet();
  const walletId = currentWallet?.id || null;

  // Shielded balance
  const balanceInfo = useShieldedBalance(walletId);

  // Stealth keys
  const [stealthKeys, setStealthKeys] = useState<{ pubView: JsonWebKey; pubSpend: JsonWebKey } | null>(null);

  // Notes list
  const [notes, setNotes] = useState<Note[]>([]);

  // Send form
  const [recipientPubView, setRecipientPubView] = useState<string>("");
  const [recipientPubSpend, setRecipientPubSpend] = useState<string>("");
  const [sendAmount, setSendAmount] = useState<string>("");
  const [memo, setMemo] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string>("");
  const [sendSuccess, setSendSuccess] = useState<string>("");

  // Scan controls
  const [rescanFromHeight, setRescanFromHeight] = useState<string>("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<string>("");

  // Load stealth keys and notes
  useEffect(() => {
    if (!walletId) {
      setStealthKeys(null);
      setNotes([]);
      return;
    }

    const loadData = async () => {
      const stealthKeyStore = getStealthKeyStore();
      const keys = await stealthKeyStore.getOrCreateStealthKeys(walletId);
      setStealthKeys({
        pubView: keys.pubView,
        pubSpend: keys.pubSpend,
      });

      const noteStore = getNoteStore(walletId);
      const loadedNotes = noteStore.loadNotes();
      setNotes(loadedNotes);
    };

    loadData();
  }, [walletId]);

  // Handle send shielded transfer
  const handleSend = async () => {
    if (!walletId || !chainContext) {
      setSendError(locale === "zh" ? "钱包或链上下文未初始化" : "Wallet or chain context not initialized");
      return;
    }

    if (!recipientPubView || !recipientPubSpend) {
      setSendError(locale === "zh" ? "请输入接收者的公钥" : "Please enter recipient public keys");
      return;
    }

    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) {
      setSendError(locale === "zh" ? "金额必须为正数" : "Amount must be positive");
      return;
    }

    if (amount > balanceInfo.balance) {
      setSendError(
        locale === "zh"
          ? `余额不足。当前隐私余额: ${balanceInfo.balance.toFixed(2)} IDC`
          : `Insufficient balance. Current shielded balance: ${balanceInfo.balance.toFixed(2)} IDC`
      );
      return;
    }

    setIsSending(true);
    setSendError("");
    setSendSuccess("");

    try {
      // Parse recipient public keys
      let recipientPubViewJwk: JsonWebKey;
      let recipientPubSpendJwk: JsonWebKey;

      try {
        recipientPubViewJwk = JSON.parse(recipientPubView);
        recipientPubSpendJwk = JSON.parse(recipientPubSpend);
      } catch {
        setSendError(locale === "zh" ? "公钥格式无效（应为 JSON）" : "Invalid public key format (should be JSON)");
        setIsSending(false);
        return;
      }

      // Create shielded transfer transaction
      const tx = await createShieldedTransferTx(
        walletId,
        recipientPubViewJwk,
        recipientPubSpendJwk,
        amount
      );

      // Broadcast transaction
      onBroadcastTx(tx);

      setSendSuccess(
        locale === "zh"
          ? `隐私转账已创建并广播！交易 ID: ${tx.txId.substring(0, 16)}...`
          : `Shielded transfer created and broadcast! Tx ID: ${tx.txId.substring(0, 16)}...`
      );

      // Clear form
      setRecipientPubView("");
      setRecipientPubSpend("");
      setSendAmount("");
      setMemo("");

      // Refresh notes
      const noteStore = getNoteStore(walletId);
      setNotes(noteStore.loadNotes());
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : locale === "zh"
          ? "创建隐私转账失败"
          : "Failed to create shielded transfer"
      );
    } finally {
      setIsSending(false);
    }
  };

  // Handle rescan
  const handleRescan = async () => {
    if (!walletId || !chainContext) {
      return;
    }

    const fromHeight = parseInt(rescanFromHeight);
    if (isNaN(fromHeight) || fromHeight < 0) {
      setScanProgress(locale === "zh" ? "无效的起始高度" : "Invalid start height");
      return;
    }

    setIsScanning(true);
    setScanProgress(locale === "zh" ? "扫描中..." : "Scanning...");

    try {
      const stealthKeyStore = getStealthKeyStore();
      const keys = await stealthKeyStore.getOrCreateStealthKeys(walletId);

      const allBlocks = chainContext.storage.getAllBlocks();
      const tipHeight = chainContext.storage.getTip()?.header.height || 0;

      const notesFound = await scanBlocksForNotes(allBlocks, keys, walletId, fromHeight, tipHeight);

      setScanProgress(
        locale === "zh"
          ? `扫描完成！找到 ${notesFound} 个新的隐私 note`
          : `Scan complete! Found ${notesFound} new shielded notes`
      );

      // Refresh notes
      const noteStore = getNoteStore(walletId);
      setNotes(noteStore.loadNotes());
    } catch (error) {
      setScanProgress(
        error instanceof Error
          ? error.message
          : locale === "zh"
          ? "扫描失败"
          : "Scan failed"
      );
    } finally {
      setIsScanning(false);
    }
  };

  // Handle resync latest
  const handleResyncLatest = async () => {
    if (!walletId || !chainContext) {
      return;
    }

    const noteStore = getNoteStore(walletId);
    const scanState = noteStore.getScanState();
    const lastScanned = scanState.lastScannedHeight;
    const tipHeight = chainContext.storage.getTip()?.header.height || 0;

    if (lastScanned >= tipHeight) {
      setScanProgress(locale === "zh" ? "已是最新状态" : "Already up to date");
      return;
    }

    setRescanFromHeight((lastScanned + 1).toString());
    await handleRescan();
  };

  if (!currentWallet) {
    return (
      <div className="status-card">
        <h2>{locale === "zh" ? "🔒 隐私转账" : "🔒 Shielded Transfers"}</h2>
        <p>{locale === "zh" ? "请先创建或选择一个钱包" : "Please create or select a wallet first"}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Shielded Balance Section */}
      <div className="status-card">
        <h2>{locale === "zh" ? "💰 隐私余额" : "💰 Shielded Balance"}</h2>
        <div className="status-item">
          <span className="label">{locale === "zh" ? "钱包地址" : "Wallet Address"}:</span>
          <span className="value" style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>
            {currentWallet.address.substring(0, 20)}...
          </span>
        </div>
        <div className="status-item">
          <span className="label">{locale === "zh" ? "隐私余额" : "Shielded Balance"}:</span>
          <span className="value" style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#667eea" }}>
            {balanceInfo.balance.toFixed(2)} IDC
          </span>
        </div>
        <div className="status-item">
          <span className="label">{locale === "zh" ? "Note 数量" : "Note Count"}:</span>
          <span className="value">
            {balanceInfo.unspentCount} / {balanceInfo.noteCount} {locale === "zh" ? "未花费" : "unspent"}
          </span>
        </div>
        <div className="status-item">
          <span className="label">{locale === "zh" ? "扫描状态" : "Scan Status"}:</span>
          <span className="value">
            {balanceInfo.scanState.lastScannedHeight > 0
              ? locale === "zh"
                ? `已扫描至高度 ${balanceInfo.scanState.lastScannedHeight}`
                : `Scanned to height ${balanceInfo.scanState.lastScannedHeight}`
              : locale === "zh"
              ? "未扫描"
              : "Not scanned"}
          </span>
        </div>
        <details style={{ marginTop: "0.5rem" }}>
          <summary style={{ cursor: "pointer", userSelect: "none" }}>
            {locale === "zh" ? "查看 Stealth Keys" : "View Stealth Keys"}
          </summary>
          {stealthKeys && (
            <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f8f9fa", borderRadius: "4px", fontFamily: "monospace", fontSize: "0.7rem" }}>
              <div><strong>Pub View:</strong> {JSON.stringify(stealthKeys.pubView).substring(0, 80)}...</div>
              <div><strong>Pub Spend:</strong> {JSON.stringify(stealthKeys.pubSpend).substring(0, 80)}...</div>
            </div>
          )}
        </details>
      </div>

      {/* Received Notes Section */}
      <div className="status-card">
        <h2>{locale === "zh" ? "📝 收到的 Notes" : "📝 Received Notes"}</h2>
        <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            type="number"
            placeholder={locale === "zh" ? "从高度开始扫描" : "Rescan from height"}
            value={rescanFromHeight}
            onChange={(e) => setRescanFromHeight(e.target.value)}
            style={{ flex: 1, minWidth: "150px", padding: "0.5rem" }}
          />
          <button
            onClick={handleRescan}
            disabled={isScanning}
            style={{
              padding: "0.5rem 1rem",
              background: "#667eea",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: isScanning ? "not-allowed" : "pointer",
            }}
          >
            {locale === "zh" ? "🔄 重新扫描" : "🔄 Rescan"}
          </button>
          <button
            onClick={handleResyncLatest}
            disabled={isScanning}
            style={{
              padding: "0.5rem 1rem",
              background: "#28a745",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: isScanning ? "not-allowed" : "pointer",
            }}
          >
            {locale === "zh" ? "🔄 同步最新" : "🔄 Resync Latest"}
          </button>
        </div>
        {scanProgress && (
          <div style={{ padding: "0.5rem", background: "#e7f3ff", borderRadius: "4px", marginBottom: "0.5rem" }}>
            {scanProgress}
          </div>
        )}
        {notes.length === 0 ? (
          <p>{locale === "zh" ? "暂无收到的隐私 note" : "No received shielded notes"}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f8f9fa" }}>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>{locale === "zh" ? "Note ID" : "Note ID"}</th>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>{locale === "zh" ? "金额" : "Amount"}</th>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>{locale === "zh" ? "状态" : "Status"}</th>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>{locale === "zh" ? "区块高度" : "Height"}</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <tr key={note.noteId} style={{ borderTop: "1px solid #ddd" }}>
                    <td style={{ padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                      {formatAddress(note.noteId, 8, 8)}
                    </td>
                    <td style={{ padding: "0.5rem" }}>{formatNumber(note.amount, 2, locale === "zh" ? "zh-CN" : "en-US")} IDC</td>
                    <td style={{ padding: "0.5rem" }}>
                      {note.isSpent ? (locale === "zh" ? "已花费" : "Spent") : (locale === "zh" ? "未花费" : "Unspent")}
                    </td>
                    <td style={{ padding: "0.5rem" }}>{note.height || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Send Shielded Transfer Section */}
      <div className="status-card">
        <h2>{locale === "zh" ? "📤 发送隐私转账" : "📤 Send Shielded Transfer"}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: "bold" }}>
              {locale === "zh" ? "接收者 Pub View Key (JSON)" : "Recipient Pub View Key (JSON)"}:
            </label>
            <textarea
              value={recipientPubView}
              onChange={(e) => setRecipientPubView(e.target.value)}
              placeholder='{"kty":"EC","crv":"P-256",...}'
              style={{ width: "100%", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.85rem", minHeight: "60px" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: "bold" }}>
              {locale === "zh" ? "接收者 Pub Spend Key (JSON)" : "Recipient Pub Spend Key (JSON)"}:
            </label>
            <textarea
              value={recipientPubSpend}
              onChange={(e) => setRecipientPubSpend(e.target.value)}
              placeholder='{"kty":"EC","crv":"P-256",...}'
              style={{ width: "100%", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.85rem", minHeight: "60px" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: "bold" }}>
              {locale === "zh" ? "金额 (IDC)" : "Amount (IDC)"}:
            </label>
            <input
              type="number"
              value={sendAmount}
              onChange={(e) => setSendAmount(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: "bold" }}>
              {locale === "zh" ? "备注 (可选)" : "Memo (optional)"}:
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder={locale === "zh" ? "可选备注" : "Optional memo"}
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </div>
          {sendError && (
            <div style={{ padding: "0.5rem", background: "#f8d7da", color: "#721c24", borderRadius: "4px" }}>
              ⚠️ {sendError}
            </div>
          )}
          {sendSuccess && (
            <div style={{ padding: "0.5rem", background: "#d4edda", color: "#155724", borderRadius: "4px" }}>
              ✅ {sendSuccess}
            </div>
          )}
          <button
            onClick={handleSend}
            disabled={isSending || !sendAmount || !recipientPubView || !recipientPubSpend}
            style={{
              padding: "0.75rem 1.5rem",
              background: isSending ? "#ccc" : "#667eea",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: isSending ? "not-allowed" : "pointer",
              fontSize: "1rem",
              fontWeight: "bold",
            }}
          >
            {isSending
              ? locale === "zh"
                ? "创建中..."
                : "Creating..."
              : locale === "zh"
              ? "创建隐私转账"
              : "Create Shielded Transfer"}
          </button>
        </div>
      </div>

      {/* Help & Safety Section */}
      <div className="status-card">
        <h2>{locale === "zh" ? "ℹ️ 帮助与安全提示" : "ℹ️ Help & Safety"}</h2>
        <div style={{ fontSize: "0.9rem", lineHeight: "1.6" }}>
          <p>
            <strong>{locale === "zh" ? "当前隐私级别：" : "Current Privacy Level:"}</strong>
            {locale === "zh"
              ? "基础隐私结构（Phase 28）。金额和接收地址通过 commitment 隐藏，但缺少严格的零知识证明。完整 ZK 证明将在 Phase Z2 实现。"
              : "Basic privacy structure (Phase 28). Amounts and recipient addresses are hidden via commitments, but strict zero-knowledge proofs are not yet implemented. Full ZK proofs will be added in Phase Z2."}
          </p>
          <p>
            <strong>{locale === "zh" ? "备份要求：" : "Backup Requirements:"}</strong>
            {locale === "zh"
              ? "必须同时备份普通钱包私钥（使用 Phase 23 的备份机制）和 stealth view/spend keys。切换设备时需要导入钱包备份并重新扫描 note，否则无法看到旧的隐私余额。"
              : "You must backup both your regular wallet private key (using Phase 23 backup mechanism) and stealth view/spend keys. When switching devices, import the wallet backup and rescan notes, otherwise you won't see old shielded balances."}
          </p>
          <p>
            <strong>{locale === "zh" ? "轻节点模式：" : "Light Node Mode:"}</strong>
            {locale === "zh"
              ? "如果本地只保留最近 N 个区块，旧的 note 只能从快照中恢复，无法完全重扫链历史。"
              : "If you only keep the last N blocks locally, old notes can only be recovered from snapshots, not by fully rescanning chain history."}
          </p>
        </div>
      </div>
    </div>
  );
}

