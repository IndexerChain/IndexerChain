/**
 * Shielded Transaction Builder
 * 
 * Phase 28: Builds complete shielded transactions for UI
 * 
 * Creates signed transactions with SHIELDED_TRANSFER operations
 */

import type { Tx } from "../types.js";
import type { Note } from "./types.js";
import { createShieldedTransferOp } from "./shieldedTransfer.js";
import { getNoteStore } from "./noteStore.js";
import { createTx } from "../tx.js";
import { getMultiWalletStore } from "../multiWallet.js";

/**
 * Create a complete shielded transfer transaction
 * 
 * @param walletId Wallet ID
 * @param recipientPubView Recipient's public view key (JWK)
 * @param recipientPubSpend Recipient's public spend key (JWK)
 * @param amount Amount to send
 * @param memo Optional memo (for Phase Z2)
 * @returns Signed transaction ready to broadcast
 */
export async function createShieldedTransferTx(
  walletId: string,
  recipientPubView: JsonWebKey,
  recipientPubSpend: JsonWebKey,
  amount: number
): Promise<Tx> {
  // Get wallet's stealth keys
  const { getStealthKeyStore } = await import("./stealthKeyStore.js");
  const stealthKeyStore = getStealthKeyStore();
  const stealthKeys = await stealthKeyStore.getOrCreateStealthKeys(walletId);

  if (!stealthKeys) {
    throw new Error("Stealth keys not found for wallet");
  }

  // Get unspent notes
  const noteStore = getNoteStore(walletId);
  const unspentNotes = noteStore.getUnspentNotes();

  // Check balance (for Phase 28, we allow sending even if amount is 0 since we can't decrypt real amounts yet)
  // In Phase Z2, we'd do proper balance checking
  if (amount <= 0) {
    throw new Error("Amount must be positive");
  }

  // Select notes to spend (simple strategy: use first note if available)
  // In Phase Z2, we'd implement proper note selection algorithm
  const notesToSpend: Note[] = [];
  let totalSelected = 0;
  
  for (const note of unspentNotes) {
    notesToSpend.push(note);
    totalSelected += note.amount;
    // For Phase 28, we'll use one note at a time
    // In Phase Z2, we'd select multiple notes to cover the amount
    break;
  }

  // Get wallet's address and key pair from MultiWalletStore
  const walletStore = getMultiWalletStore();
  const wallet = walletStore.getWallet(walletId);
  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  const keyPair = await walletStore.getKeyPair(walletId);
  if (!keyPair) {
    throw new Error(`Private key not available for wallet ${walletId}`);
  }

  // Get nonce (use current timestamp as nonce for now)
  const nonce = Date.now();

  // Create shielded transfer operation
  const op = await createShieldedTransferOp(
    notesToSpend.length > 0 ? notesToSpend : null,
    amount,
    recipientPubView,
    recipientPubSpend,
    wallet.address,
    nonce,
    stealthKeys.privSpend
  );

  // Create transaction (createTx will sign it automatically)
  const tx = await createTx([op]);

  return tx;
}


