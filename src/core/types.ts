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
 * Phase 27: Added SHIELDED_TRANSFER for privacy-preserving transfers
 */
export type OpType = "PUT" | "APPEND" | "DELETE" | "TRANSFER" | "SHIELDED_TRANSFER";

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
  
  // Phase 27: Shielded transfer operation fields
  commitment?: string; // Commitment value (for SHIELDED_TRANSFER)
  nullifier?: string; // Nullifier to prevent double-spend (for SHIELDED_TRANSFER)
  oneTimePublic?: string; // One-time stealth address (for SHIELDED_TRANSFER)
  ephemeralPub?: string; // Ephemeral public key (for SHIELDED_TRANSFER)
  proof?: string; // ZK proof (Phase Z2, optional for now)
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
 * 
 * Phase 15: Added stateCommitment for verified light clients
 * Phase 22: Added finalityCert for fast finality
 */
export interface BlockHeader {
  version: number;
  height: number;
  prevHash: string;
  merkleRoot: string;
  timestamp: number; // Unix timestamp in seconds
  difficulty: number; // Current difficulty
  nonce: number; // PoW random number
  stateCommitment?: string; // Phase 15: SHA-256 hash of normalized IndexState after applying all transactions
  finalityCert?: FinalityCertificate; // Phase 22: Finality certificate for fast confirmation
  
  // Phase 48-A (Optional, non-enforcing scaffolding):
  // Slot scheduling and pooled rewards metadata. These fields are optional
  // and not used in consensus hashing/verification unless the corresponding
  // feature flag is enabled. They exist to enable gradual rollout.
  epochId?: number;      // floor(timestampMs / epochMs)
  slotIndex?: number;    // 0..(slotsPerEpoch-1)
  proposer?: Address;    // Expected leader address for this slot
  payoutRoot?: string;   // Merkle root of previous epoch's payout plan
  randSeed?: string;     // Random seed driving leader selection (derived from prev block)
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
 * Phase 37-C: Compact block header for mining
 * 
 * Contains only the fields needed for PoW mining, without the full block.
 * This reduces message passing overhead between main thread and workers.
 */
export interface MiningCompactBlockHeader {
  version: number;
  height: number;
  prevHash: string;
  merkleRoot: string;
  timestamp: number;
  difficulty: number;
  stateCommitment?: string;
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
  
  // Phase 13: Snapshot verification parameters
  snapshotVerificationSampleRate?: number; // Probability (0-1) of doing full verification on startup, e.g., 0.3
  snapshotAutoVerifyIntervalMs?: number; // Background verification interval in milliseconds, e.g., 60000
  
  // Phase 14: Remote snapshot sync parameters
  remoteSnapshotEndpoints?: string[]; // Remote snapshot server URLs, e.g., ["https://snap.indexerchain.io/api/v1/snapshots"]
  remoteSnapshotEnabled?: boolean; // Whether to enable remote snapshot sync, default false
  remoteSnapshotMinHeight?: number; // Only consider remote snapshots with height >= this value, e.g., 100
  
  // Phase 21: Peer reputation and security parameters
  peerScoreEnabled?: boolean; // Whether to enable peer reputation system, default true
  peerScoreDecayIntervalMs?: number; // Score decay check interval in milliseconds, e.g., 60_000 (1 minute)
  peerScoreHalfLifeMs?: number; // Score half-life for decay toward neutral (50), e.g., 300_000 (5 minutes)
  peerBanThreshold?: number; // Score below this value triggers ban, e.g., 20
  peerBanDurationMs?: number; // Ban duration in milliseconds, e.g., 600_000 (10 minutes)
  
  // Phase 22: Fast finality parameters
  finalityEnabled?: boolean; // Whether to enable fast finality, default true
  finalityCommitteeSize?: number; // Committee size for finality voting, e.g., 7-21, default 11
  finalityThreshold?: number; // Threshold ratio for finality (2/3), default 0.67
  finalityVoteTimeoutMs?: number; // Timeout for collecting votes, e.g., 5000 (5 seconds)
  finalityCommitteeRoundInterval?: number; // Blocks between committee re-election, e.g., 10
  
  // Phase 30: Global Consistency Sentinel parameters
  globalSentinelEnabled?: boolean; // Whether to enable global consistency sentinel, default true
  globalDriftCheckIntervalMs?: number; // Drift check interval in milliseconds, default 5000
  globalDriftCriticalBlocks?: number; // Critical drift threshold in blocks, default 10
  globalDriftMinorBlocks?: number; // Minor drift threshold in blocks, default 3
  globalMinPeersForAssessment?: number; // Minimum peers required for assessment, default 3
  globalMinReputationForVoting?: number; // Minimum reputation score for voting, default 0
  
  // Phase 33: Mining Permission Levels
  minPeersRequired?: number; // Minimum peers required for safe mining, default 3
  allowGuardedMining?: boolean; // Allow mining with < minPeers in dev/testnet mode, default false (auto-enabled for dev/testnet)
  allowLocalMining?: boolean; // Allow local-only mining (not broadcast to network), default false
  // Phase 34: Quorum Debug Mode
  quorumDebugOverride?: boolean; // Debug mode: allow mining with lower quorum requirements (dev/testnet only), default false
  // Phase 35: Mainnet Mining Admission Rules
  mainnetQuorumThresholds?: {
    coldStart: number; // Cold start phase threshold, default 80
    earlyGrowth: number; // Early growth phase threshold, default 150
    mature: number; // Mature phase threshold, default 250
    secure: number; // High security mode threshold, default 400
  };
  mainnetMinIndependentPeers?: {
    coldStart: number; // Minimum independent peers for cold start, default 1
    earlyGrowth: number; // Minimum independent peers for early growth, default 2
    mature: number; // Minimum independent peers for mature, default 3
    secure: number; // Minimum independent peers for secure mode, default 5
  };
  
  // Phase 45: Multi-Signal Resilient Network Architecture
  signalServers?: string[]; // Multiple signal server URLs for redundancy, e.g., ["wss://signal1.indexerchain.com", "wss://signal2.indexerchain.com"]
  shadowNodeUrls?: string[]; // Multiple shadow node URLs for redundancy, e.g., ["https://signal1.indexerchain.com", "https://signal2.indexerchain.com"]
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
 * Phase 13: Added integrity verification fields
 */
export interface SnapshotMeta {
  id: string; // Snapshot ID, e.g., "snap_0000123"
  height: number; // Block height at which snapshot was taken
  blockHash: string; // Hash of the block at snapshot height
  createdAt: number; // Unix timestamp in milliseconds
  version: number; // Snapshot format version
  
  // Phase 13: Integrity verification fields
  stateHash?: string; // SHA-256 hash of normalized snapshot state (64 hex chars)
  compressedSize?: number; // Compressed size in bytes
  uncompressedSize?: number; // Estimated uncompressed size in bytes
  verifiedAt?: number; // Timestamp of last successful verification (Unix timestamp in milliseconds)
  verificationVersion?: number; // Verification algorithm version (for future upgrades)
  
  // Phase 15: State commitment from block header
  stateCommitment?: string; // State commitment from the block at snapshot height (matches block.header.stateCommitment)
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

/**
 * Peer ID type
 * 
 * Phase 21: Type alias for peer identification
 */
export type PeerId = string; // P2P node ID

/**
 * Peer reputation score
 * 
 * Phase 21: Tracks peer behavior and trustworthiness
 */
export interface PeerScore {
  peerId: PeerId;
  lastSeenAt: number; // Last seen timestamp in milliseconds
  connectedAt?: number; // First connection timestamp in milliseconds
  
  // Service metrics
  blocksServed: number; // Number of valid blocks served
  blocksInvalid: number; // Number of invalid blocks sent
  snapshotsServed: number; // Number of valid snapshot chunks served
  snapshotsInvalid: number; // Number of invalid snapshot chunks sent
  headersServed: number; // Number of valid headers served
  
  // Performance / response quality
  avgLatencyMs?: number; // Rolling average latency in milliseconds
  requestsSent: number; // Total requests sent to this peer
  responsesOk: number; // Successful responses received
  responsesTimeout: number; // Timeout responses
  
  // Global miner pool metrics
  workAssigned: number; // Number of nonce ranges assigned
  workCompleted: number; // Number of ranges completed successfully
  workFailed: number; // Number of ranges that failed/abandoned
  
  // Calculated score
  score: number; // Score from 0 to 100
  trustLevel: "trusted" | "normal" | "low" | "banned";
  bannedUntil?: number; // Ban expiration timestamp (if banned)
}

/**
 * Finality vote signature
 * 
 * Phase 22: Individual committee member's vote on a block
 */
export interface FinalityVote {
  blockHash: string; // Hash of the block being voted on
  blockHeight: number; // Height of the block
  committeeRound: number; // Committee round number
  signerAddress: Address; // Address of the committee member
  signature: string; // ECDSA signature (base64 encoded)
  timestamp: number; // Vote timestamp in milliseconds
}

/**
 * Phase 30: Global Consistency Sentinel types
 * 
 * Tracks peer views and assesses local node drift from network majority
 */

/**
 * Global view summary from a peer
 */
export interface GlobalViewSummary {
  peerId: string;
  height: number;
  tipHash: string;
  finalizedHeight: number;
  stateCommitment?: string;
  reputationScore?: number;
  lastSeenAt: number;
}

/**
 * Drift assessment result
 */
export interface DriftAssessment {
  localHeight: number;
  localTipHash: string;
  localFinalizedHeight: number;
  peerCount: number;
  majorityHeight: number;
  majorityTipHash: string;
  majorityFinalizedHeight: number;
  driftBlocks: number; // localHeight 与 majorityHeight 差
  forkSuspected: boolean; // localTipHash != majorityTipHash 且高度接近
  healthLevel: "HEALTHY" | "MINOR_DRIFT" | "CRITICAL_DRIFT";
  reason: string; // 用于 UI 展示
  minPeersRequired?: number; // Minimum peers required for assessment
}

/**
 * Global view response message payload
 */
export interface GlobalViewResponse {
  height: number;
  tipHash: string;
  finalizedHeight: number;
  stateCommitment?: string;
  reputationScore?: number;
}

/**
 * Finality certificate
 * 
 * Phase 22: Certificate proving a block has reached finality (>= 2/3 committee votes)
 */
export interface FinalityCertificate {
  blockHash: string; // Hash of the finalized block
  blockHeight: number; // Height of the finalized block
  committeeRound: number; // Committee round number
  signatures: Array<{
    signer: Address; // Committee member address
    signature: string; // ECDSA signature (base64 encoded)
  }>; // Signatures from committee members
  signatureBitmap?: string; // Phase 22: Compressed bitmap of which committee members signed (optional optimization)
  createdAt: number; // Certificate creation timestamp in milliseconds
  threshold: number; // Number of signatures required (>= 2/3 of committee)
  actualSignatures: number; // Actual number of signatures collected
}
