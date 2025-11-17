/**
 * Core Types for Browser Index Chain
 * 
 * Defines the fundamental data structures:
 * - Operation: The smallest unit of work (PUT, APPEND, DELETE)
 * - Tx: A transaction containing multiple operations
 * - BlockHeader & Block: Block structure
 * - ChainParams: Chain configuration parameters
 */

/**
 * Operation types
 */
export type OpType = "PUT" | "APPEND" | "DELETE";

/**
 * Operation - the smallest unit on the chain
 */
export interface Operation {
  type: OpType; // Operation type
  namespace: string; // Namespace, e.g., "inscribe", "chat", "rwa"
  key: string; // Primary key, e.g., "user:0xabc" / "token:xxx"
  value?: string; // Value (JSON string)
  nonce: number; // Anti-replay incrementing counter
  owner: string; // Initiator address (public key hash / user ID)
  signature?: string; // Signature (optional for now, will add later)
}

/**
 * Transaction - a batch of operations
 */
export interface Tx {
  txId: string; // Transaction hash
  timestamp: number; // Client timestamp
  ops: Operation[]; // List of operations
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
 */
export interface ChainParams {
  version: number; // Protocol version
  networkId: string; // Network identifier, e.g., "indexerchain-dev"
  genesisTimestamp: number; // Genesis block timestamp (Unix timestamp in seconds)
  initialDifficulty: number; // Initial difficulty, e.g., 1 or 3
  targetBlockTime?: number; // Target block time in seconds, e.g., 10 (optional)
  maxBlockSizeBytes?: number; // Maximum block size in bytes, e.g., 1_000_000 (optional)
}
