/**
 * useShieldedBalance Hook
 * 
 * Phase 28: React hook for computing and tracking shielded balance
 */

import { useState, useEffect } from "react";
import { getNoteStore } from "../../core/privacy/noteStore.js";
import type { ShieldedScanState } from "../../core/privacy/noteStore.js";

export interface ShieldedBalanceInfo {
  balance: number;
  noteCount: number;
  unspentCount: number;
  scanState: ShieldedScanState;
}

/**
 * Hook to get shielded balance for a wallet
 * 
 * @param walletId Wallet ID
 * @returns Shielded balance information
 */
export function useShieldedBalance(walletId: string | null): ShieldedBalanceInfo {
  const [balanceInfo, setBalanceInfo] = useState<ShieldedBalanceInfo>({
    balance: 0,
    noteCount: 0,
    unspentCount: 0,
    scanState: {
      walletId: walletId || "",
      lastScannedHeight: 0,
      autoScanEnabled: true,
    },
  });

  useEffect(() => {
    if (!walletId) {
      setBalanceInfo({
        balance: 0,
        noteCount: 0,
        unspentCount: 0,
        scanState: {
          walletId: "",
          lastScannedHeight: 0,
          autoScanEnabled: true,
        },
      });
      return;
    }

    const noteStore = getNoteStore(walletId);
    const notes = noteStore.loadNotes();
    const unspentNotes = noteStore.getUnspentNotes();
    const balance = noteStore.getShieldedBalance();
    const scanState = noteStore.getScanState();

    setBalanceInfo({
      balance,
      noteCount: notes.length,
      unspentCount: unspentNotes.length,
      scanState,
    });

    // Update when notes change (polling for now, could use events in future)
    const interval = setInterval(() => {
      const updatedNotes = noteStore.loadNotes();
      const updatedUnspent = noteStore.getUnspentNotes();
      const updatedBalance = noteStore.getShieldedBalance();
      const updatedScanState = noteStore.getScanState();

      setBalanceInfo({
        balance: updatedBalance,
        noteCount: updatedNotes.length,
        unspentCount: updatedUnspent.length,
        scanState: updatedScanState,
      });
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [walletId]);

  return balanceInfo;
}

