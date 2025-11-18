/**
 * Privacy Layer Types
 * 
 * Phase 27: Privacy Foundation Layer (Zcash-style for IndexerChain)
 * 
 * Defines types for stealth addresses, commitments, notes, and nullifiers
 */

/**
 * Stealth Address Keys
 * 
 * Each wallet has two key pairs:
 * - View key: For scanning incoming transactions
 * - Spend key: For spending notes
 */
export interface StealthKeys {
  // View key pair
  privView: CryptoKey; // Private view key (for scanning)
  pubView: JsonWebKey; // Public view key (for receiving)
  
  // Spend key pair
  privSpend: CryptoKey; // Private spend key (for spending)
  pubSpend: JsonWebKey; // Public spend key (for receiving)
}

/**
 * One-time Stealth Address
 * 
 * Generated for each transaction to hide the recipient's real address
 */
export interface StealthAddress {
  oneTimePublic: string; // One-time public key (on-chain)
  ephemeralPub: string; // Ephemeral public key (for decryption)
  payload?: string; // Encrypted memo (optional)
}

/**
 * Commitment
 * 
 * Pedersen Commitment: C = v * H + r * G
 * Hides the amount while allowing verification
 */
export interface Commitment {
  commitment: string; // Commitment value (hex)
  amount: number; // Plain amount (only stored locally)
  random: string; // Random blinding factor (hex)
}

/**
 * Note (Privacy Asset)
 * 
 * Represents a shielded asset in the privacy pool
 * Stored locally in the wallet, not on-chain
 */
export interface Note {
  noteId: string; // Unique note identifier
  commitment: string; // Commitment value (on-chain)
  amount: number; // Plain amount (local only)
  random: string; // Random blinding factor (local only)
  ownerPubView: JsonWebKey; // Owner's public view key
  ownerPubSpend: JsonWebKey; // Owner's public spend key
  height: number; // Block height when note was created
  txId: string; // Transaction ID that created this note
  isSpent?: boolean; // Whether this note has been spent (Phase 28)
}

/**
 * Nullifier
 * 
 * Prevents double-spending of notes
 * nullifier = hash(random + privSpend)
 */
export interface Nullifier {
  nullifier: string; // Nullifier value (hex)
  noteId: string; // Associated note ID
}

/**
 * Shielded Transfer Operation Data
 */
export interface ShieldedTransferData {
  commitment: string; // Output commitment
  nullifier?: string; // Input nullifier (if spending)
  proof?: string; // ZK proof (Phase Z2, optional for now)
}

