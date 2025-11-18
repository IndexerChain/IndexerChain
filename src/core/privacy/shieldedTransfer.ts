/**
 * Shielded Transfer Creation
 * 
 * Phase 27: Create privacy-preserving transactions
 * 
 * Handles:
 * - Creating commitments for outputs
 * - Generating nullifiers for inputs
 * - Generating stealth addresses for recipients
 * - Creating shielded transfer operations
 */

import type { Operation, Address, Tx } from "../types.js";
import type { Note, StealthKeys } from "./types.js";
import { createCommitment } from "./commitment.js";
import { generateStealthAddress } from "./stealthAddress.js";
import { createNullifier } from "./nullifier.js";

/**
 * Create a shielded transfer operation
 * 
 * @param fromNotes Input notes to spend (optional, for minting)
 * @param toAmount Output amount
 * @param recipientPubView Recipient's public view key (JWK)
 * @param recipientPubSpend Recipient's public spend key (JWK)
 * @param ownerAddress Sender's address (for operation owner field)
 * @param nonce Operation nonce
 * @param privSpend Sender's private spend key (for generating nullifiers)
 * @returns Shielded transfer operation
 */
export async function createShieldedTransferOp(
  fromNotes: Note[] | null,
  toAmount: number,
  recipientPubView: JsonWebKey,
  recipientPubSpend: JsonWebKey,
  ownerAddress: Address,
  nonce: number,
  privSpend?: CryptoKey
): Promise<Operation> {
  // Generate stealth address for recipient
  const stealthAddress = await generateStealthAddress(recipientPubView, recipientPubSpend);
  
  // Create commitment for output
  const outputCommitment = await createCommitment(toAmount);
  
  // Generate nullifier for each input note
  let nullifier: string | undefined;
  if (fromNotes && fromNotes.length > 0 && privSpend) {
    // For now, we only support spending one note at a time
    // Future: Support multiple inputs
    const inputNote = fromNotes[0];
    const nullifierObj = await createNullifier(inputNote, privSpend);
    nullifier = nullifierObj.nullifier;
  }
  
  // Create shielded transfer operation
  const op: Operation = {
    type: "SHIELDED_TRANSFER",
    namespace: "shielded_pool", // Privacy operations use shielded_pool namespace
    key: outputCommitment.commitment, // Key is the commitment value
    value: "", // No plain value for privacy
    nonce,
    owner: ownerAddress,
    commitment: outputCommitment.commitment,
    nullifier,
    oneTimePublic: stealthAddress.oneTimePublic,
    ephemeralPub: stealthAddress.ephemeralPub,
    proof: undefined, // Phase Z2: ZK proof
  };
  
  return op;
}

/**
 * Create a note from a shielded transfer
 * 
 * When a recipient receives a shielded transfer, they create a note locally
 * 
 * @param commitment Commitment value from the transaction
 * @param amount Amount (decrypted/known locally)
 * @param random Random blinding factor (known locally)
 * @param ownerPubView Owner's public view key
 * @param ownerPubSpend Owner's public spend key
 * @param height Block height
 * @param txId Transaction ID
 * @returns Note object
 */
export function createNote(
  commitment: string,
  amount: number,
  random: string,
  ownerPubView: JsonWebKey,
  ownerPubSpend: JsonWebKey,
  height: number,
  txId: string
): Note {
  // Generate note ID from commitment
  const noteId = `note_${commitment.substring(0, 16)}`;
  
  return {
    noteId,
    commitment,
    amount,
    random,
    ownerPubView,
    ownerPubSpend,
    height,
    txId,
    isSpent: false,
  };
}

/**
 * Scan a transaction for incoming shielded transfers
 * 
 * Recipient uses their view key to check if a transaction is for them
 * 
 * @param tx Transaction to scan
 * @param keys Recipient's stealth keys
 * @returns Array of notes found (empty if none)
 */
export async function scanShieldedTransaction(
  tx: Tx,
  keys: StealthKeys
): Promise<Note[]> {
  const notes: Note[] = [];
  
  // Check each operation in the transaction
  for (const op of tx.ops) {
    if (op.type === "SHIELDED_TRANSFER" && op.oneTimePublic && op.ephemeralPub) {
      // Note: In a full implementation, we would use checkStealthAddress
      // For Phase 27, we assume the recipient can decrypt the amount and random
      // from the transaction (this would be encrypted in Phase Z2)
      
      // For now, we create a placeholder note
      // In Phase Z2, the amount and random would be decrypted using the view key
      if (op.commitment) {
        // This is a simplified check - in reality, we'd verify the stealth address
        // For Phase 27, we'll create a note if we have the commitment
        // The actual amount and random would be decrypted in Phase Z2
        const note: Note = {
          noteId: `note_${op.commitment.substring(0, 16)}`,
          commitment: op.commitment,
          amount: 0, // Placeholder - would be decrypted in Phase Z2
          random: "", // Placeholder - would be decrypted in Phase Z2
          ownerPubView: keys.pubView,
          ownerPubSpend: keys.pubSpend,
          height: 0, // Would be set from block height
          txId: tx.txId,
        };
        notes.push(note);
      }
    }
  }
  
  return notes;
}

