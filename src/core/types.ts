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
 * Phase 9: Added snapshot parameters for fast sync
 */
export interface ChainParams {
  version: number; // Protocol version
  networkId: string; // Network identifier, e.g., "indexerchain-dev"
  genesisTimestamp: number; // Genesis block timestamp (Unix timestamp in seconds)
  initialDifficulty: number; // Initial difficulty, e.g., 1 or 3
  targetBlockTime: number; // Target block time in seconds, e.g., 10
  difficultyAdjustmentInterval: number; // Number of blocks between difficulty adjustments, e.g., 10
  blockReward: number; // Block reward in IDC (Phase 7), e.g., 10
  snapshotInterval?: number; // Phase 9: Number of blocks between snapshots, e.g., 50
  maxSnapshotCount?: number; // Phase 9: Maximum number of snapshots to keep, e.g., 5
  lightNodeWindow?: number; // Phase 10: Number of recent blocks to keep (pruned node), e.g., 200
  fullSnapshotInterval?: number; // Phase 12: Number of snapshots between full snapshots, e.g., 5
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

/**
 * Snapshot metadata
 * 
 * Phase 9: Metadata for state snapshots used for fast sync
 */
export interface SnapshotMeta {
  id: string; // Snapshot ID, e.g., "snap_0000123"
  height: number; // Block height at which snapshot was taken
  blockHash: string; // Hash of the block at snapshot height
  createdAt: number; // Unix timestamp in milliseconds
  version: number; // Snapshot format version
}

/**
 * Snapshot data
 * 
 * Phase 9: Complete snapshot including metadata and state
 * Phase 11: Support compressed format
 * Phase 12: Support incremental (delta) snapshots
 */
export interface SnapshotData {
  meta: SnapshotMeta;
  indexState?: any; // Phase 9: IndexState.toSnapshot() result (legacy format)
  compressed?: boolean; // Phase 11: Whether data is compressed
  data?: string; // Phase 11/12: Base64-encoded compressed data (full snapshot when full=true)
  full?: boolean; // Phase 12: Whether this is a full snapshot (true) or delta snapshot (false)
  delta?: string; // Phase 12: Base64-encoded compressed delta operations (when full=false)
}
