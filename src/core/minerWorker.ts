/**
 * Miner Worker
 * 
 * Phase 8: Mining logic running in Web Worker to avoid blocking UI
 * 
 * This worker handles the actual PoW mining computation.
 * 
 * Note: This file is loaded as a Web Worker, so it has limited access to DOM APIs.
 * All necessary functions are implemented inline using Web Crypto API.
 */

// Worker context - no imports needed, types defined inline

/**
 * Worker command from main thread
 */
type MinerWorkerCommand =
  | {
      type: "START";
      candidateBlock: any; // Block with nonce=0, ready for mining
      difficulty: number; // Difficulty from block header
      maxIterations?: number; // Optional: max iterations per batch
    }
  | { type: "STOP" };

/**
 * Worker event to main thread
 */
type MinerWorkerEvent =
  | {
      type: "PROGRESS";
      nonce: number;
      hash: string;
      hashesTried: number; // Total hashes tried in this session
      startedAt: number; // Timestamp when mining started
    }
  | {
      type: "FOUND";
      block: any; // Complete block with valid nonce
      hash: string;
      hashesTried: number;
      startedAt: number;
      finishedAt: number;
    }
  | {
      type: "STOPPED";
      reason: "user" | "replaced" | "error";
      errorMessage?: string;
    };

/**
 * Check if hash satisfies difficulty requirement
 */
function checkDifficulty(hash: string, difficulty: number): boolean {
  const prefix = "0".repeat(difficulty);
  return hash.startsWith(prefix);
}

/**
 * Hash block header (matches crypto.ts implementation)
 * Serializes header deterministically and computes SHA-256 hash
 */
async function hashBlockHeader(header: any): Promise<string> {
  // Serialize header deterministically (matching crypto.ts format)
  // Format: version|height|prevHash|merkleRoot|timestamp|difficulty|nonce
  const parts = [
    header.version.toString(),
    header.height.toString(),
    header.prevHash,
    header.merkleRoot,
    header.timestamp.toString(),
    header.difficulty.toString(),
    (header.nonce ?? 0).toString(),
  ];

  const serialized = parts.join("|");

  // Hash with SHA-256 using Web Crypto API
  const encoder = new TextEncoder();
  const data = encoder.encode(serialized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return hashHex;
}

// Worker state
let currentBlock: any | null = null;
let currentDifficulty: number = 0;
let isRunning: boolean = false;
let hashesTried: number = 0;
let startedAt: number = 0;
let nonce: number = 0;

// Progress reporting interval (report every N hashes or every M ms)
const PROGRESS_INTERVAL_HASHES = 20000; // Report every 20k hashes
const PROGRESS_INTERVAL_MS = 200; // Or every 200ms
let lastProgressTime = 0;

/**
 * Mining loop
 */
async function miningLoop(): Promise<void> {
  if (!isRunning || !currentBlock) {
    return;
  }

  try {
    while (isRunning && currentBlock) {
      // Update nonce
      currentBlock.header.nonce = nonce;

      // Compute hash
      const hash = await hashBlockHeader(currentBlock.header);
      hashesTried++;

      // Check difficulty
      if (checkDifficulty(hash, currentDifficulty)) {
        // Found valid block!
        currentBlock.hash = hash;
        const finishedAt = Date.now();

        // Send FOUND event
        self.postMessage({
          type: "FOUND",
          block: currentBlock,
          hash,
          hashesTried,
          startedAt,
          finishedAt,
        } as MinerWorkerEvent);

        // Stop mining
        isRunning = false;
        return;
      }

      // Increment nonce
      nonce++;

      // Report progress periodically
      const now = Date.now();
      if (
        hashesTried % PROGRESS_INTERVAL_HASHES === 0 ||
        now - lastProgressTime >= PROGRESS_INTERVAL_MS
      ) {
        self.postMessage({
          type: "PROGRESS",
          nonce,
          hash,
          hashesTried,
          startedAt,
        } as MinerWorkerEvent);
        lastProgressTime = now;
      }

      // Yield control periodically to prevent blocking
      if (nonce % 5000 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } catch (error) {
    // Send error event
    self.postMessage({
      type: "STOPPED",
      reason: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    } as MinerWorkerEvent);
    isRunning = false;
  }
}

/**
 * Handle messages from main thread
 */
self.addEventListener("message", async (event: MessageEvent<MinerWorkerCommand>) => {
  const command = event.data;

  if (command.type === "START") {
    // Stop any existing mining
    if (isRunning) {
      isRunning = false;
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait a bit
    }

    // Initialize new mining session
    currentBlock = JSON.parse(JSON.stringify(command.candidateBlock)); // Deep copy
    currentDifficulty = command.difficulty;
    isRunning = true;
    hashesTried = 0;
    startedAt = Date.now();
    nonce = 0;
    lastProgressTime = startedAt;

    // Start mining loop
    miningLoop();
  } else if (command.type === "STOP") {
    // Stop mining
    isRunning = false;
    self.postMessage({
      type: "STOPPED",
      reason: "user",
    } as MinerWorkerEvent);
  }
});

// Note: Types are defined above, no need to re-export

