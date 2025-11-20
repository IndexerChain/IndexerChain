/**
 * Note Scanner
 * 
 * Phase 28: Scans blockchain for incoming shielded transfers
 * 
 * Scans transactions to find notes that belong to the current wallet
 */

import type { Block, Tx } from "../types.js";
import type { Note, StealthKeys } from "./types.js";
import { scanShieldedTransaction } from "./shieldedTransfer.js";
import { checkStealthAddress } from "./stealthAddress.js";
import { getNoteStore } from "./noteStore.js";

/**
 * Scan blocks for incoming shielded transfers
 * 
 * @param blocks Blocks to scan
 * @param keys Wallet's stealth keys
 * @param walletId Wallet ID
 * @param fromHeight Starting height (inclusive)
 * @param toHeight Ending height (inclusive, optional, defaults to latest)
 * @returns Number of notes found
 */
export async function scanBlocksForNotes(
  blocks: Block[],
  keys: StealthKeys,
  walletId: string,
  fromHeight: number,
  toHeight?: number
): Promise<number> {
  const noteStore = getNoteStore(walletId);
  let notesFound = 0;

  // Filter blocks by height range
  const blocksToScan = blocks.filter(block => {
    const height = block.header.height;
    return height >= fromHeight && (toHeight === undefined || height <= toHeight);
  });

  // Scan each block
  for (const block of blocksToScan) {
    // Scan each transaction in the block
    for (const tx of block.txs) {
      // Check for shielded transfers
      for (const op of tx.ops) {
        if (op.type === "SHIELDED_TRANSFER" && op.oneTimePublic && op.ephemeralPub && op.commitment) {
          // Check if this stealth address belongs to us
          const stealthAddress = {
            oneTimePublic: op.oneTimePublic,
            ephemeralPub: op.ephemeralPub,
          };

          try {
            const belongsToUs = await checkStealthAddress(stealthAddress, keys);
            
            if (belongsToUs) {
              // For Phase 28, we create a note with placeholder amount/random
              // In Phase Z2, these would be decrypted using the view key
              // For now, we'll need to extract amount/random from the operation
              // Since Phase 28 doesn't encrypt these yet, we'll use a simplified approach
              
              // Create note (for Phase 28, amount and random are placeholders)
              // In Phase Z2, these would be decrypted from the encrypted memo
              const note: Note = {
                noteId: `note_${op.commitment.substring(0, 16)}`,
                commitment: op.commitment,
                amount: 0, // Placeholder - would be decrypted in Phase Z2
                random: "", // Placeholder - would be decrypted in Phase Z2
                ownerPubView: keys.pubView,
                ownerPubSpend: keys.pubSpend,
                height: block.header.height,
                txId: tx.txId,
                isSpent: false,
              };

              // Check if note already exists
              const existing = noteStore.getNote(note.noteId);
              if (!existing) {
                noteStore.addNote(note);
                notesFound++;
              }
            }
          } catch (error) {
            // Continue scanning other transactions
          }
        }
      }
    }
  }

  // Update scan state
  if (blocksToScan.length > 0) {
    const maxHeight = Math.max(...blocksToScan.map(b => b.header.height));
    const currentState = noteStore.getScanState();
    if (maxHeight > currentState.lastScannedHeight) {
      noteStore.updateScanState({ lastScannedHeight: maxHeight });
    }
  }

  return notesFound;
}

/**
 * Scan a single transaction for notes
 * 
 * @param tx Transaction to scan
 * @param blockHeight Block height
 * @param keys Wallet's stealth keys
 * @param walletId Wallet ID
 * @returns Array of notes found
 */
export async function scanTransactionForNotes(
  tx: Tx,
  blockHeight: number,
  keys: StealthKeys,
  walletId: string
): Promise<Note[]> {
  const notes = await scanShieldedTransaction(tx, keys);
  
  // Update note heights and txIds
  for (const note of notes) {
    note.height = blockHeight;
    note.txId = tx.txId;
  }

  // Save notes
  const noteStore = getNoteStore(walletId);
  for (const note of notes) {
    const existing = noteStore.getNote(note.noteId);
    if (!existing) {
      noteStore.addNote(note);
    }
  }

  return notes;
}

