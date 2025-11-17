/**
 * Core Types for Browser Index Chain
 * 
 * Defines the fundamental data structures:
 * - Operation: The smallest unit of work (PUT, APPEND, DELETE)
 * - Tx: A transaction containing multiple operations
 * - BlockHeader & Block: Block structure
 * - ChainParams: Chain configuration parameters
 * - Identity: Key pairs and addresses (Phase 5)
 */

/**
 * Address type - human-readable address derived from public key
 */
export type Address = string; // Format: "idc_" + 40 hex characters

/**
 * Key pair for node identity
 */
export interface KeyPair {
  publicKey: JsonWebKey; // WebCrypto exported JWK
  privateKey: CryptoKey; // Not persisted to disk, only in memory
}

/**
 * Serialized public key for transmission
 */
export interface SerializedPublicKey {
  alg: string; // Algorithm, e.g., "ECDSA_P256"
  format: "jwk"; // Currently fixed to jwk
  jwk: JsonWebKey; // The actual public key JWK
}

/**
 * Operation types
 * 
 * Phase 7: Added TRANSFER for native token transfers
 */
export type OpType = "PUT" | "APPEND" | "DELETE" | "TRANSFER";

/**
 * Operation - the smallest unit on the chain
 */
export interface Operation {
  type: OpType; // Operation type
  namespace: string; // Namespace, e.g., "inscribe", "chat", "rwa" (not used for TRANSFER)
  key: string; // Primary key, e.g., "user:0xabc" / "token:xxx" (not used for TRANSFER)
  value?: string; // Value (JSON string) (not used for TRANSFER)
  nonce: number; // Anti-replay incrementing counter
  owner: string; // Initiator address (public key hash / user ID)
  signature?: string; // Signature (optional for now, will add later)
  
  // Phase 7: Transfer operation fields
  to?: Address; // Recipient address (for TRANSFER)
  amount?: number; // Transfer amount in IDC (for TRANSFER)
}

/**
 * Transaction - a batch of operations
 * 
 * Phase 5: Extended with signature and identity fields
 */
export interface Tx {
  txId: string; // Transaction hash (computed from content, excluding signature)
  timestamp: number; // Client timestamp
  ops: Operation[]; // List of operations
  
  // Phase 5: Identity and signature fields
  owner: string; // Legacy field, equals ownerAddress for compatibility
  ownerAddress: Address; // Human-readable address derived from public key
  ownerPubKey: SerializedPublicKey; // Public key for verification
  signature: string; // ECDSA signature (base64 encoded)
}

/**
 * Block header
 */
export interface BlockHeader {
  version: number;
  height: number;
  prevHash: string;
  merkleRoot: string;
  timestamp: number; // Unix timestamp in seconds
  difficulty: number; // Current difficulty
  nonce: number; // PoW random number
}

/**
 * Block structure
 */
export interface Block {
  header: BlockHeader;
  txs: Tx[];
  hash: string; // Block hash
}

/**
 * Chain parameters
 * 
 * Phase 7: Added blockReward for mining rewards
 */
export interface ChainParams {
  version: number; // Protocol version
  networkId: string; // Network identifier, e.g., "indexerchain-dev"
  genesisTimestamp: number; // Genesis block timestamp (Unix timestamp in seconds)
  initialDifficulty: number; // Initial difficulty, e.g., 1 or 3
  targetBlockTime: number; // Target block time in seconds, e.g., 10
  difficultyAdjustmentInterval: number; // Number of blocks between difficulty adjustments, e.g., 10
  blockReward: number; // Block reward in IDC (Phase 7), e.g., 10
  maxBlockSizeBytes?: number; // Maximum block size in bytes, e.g., 1_000_000 (optional)
}

/**
 * Difficulty adjustment result
 * 
 * Phase 6: Result of difficulty adjustment calculation
 */
export interface DifficultyAdjustmentResult {
  newDifficulty: number;
  reason: string; // Explanation of the adjustment
}
