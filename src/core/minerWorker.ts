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
 * 
 * Phase 18: Added nonceStart and nonceEnd for cluster mining
 */
type MinerWorkerCommand =
  | {
      type: "START";
      candidateBlock: any; // Block with nonce=0, ready for mining
      difficulty: number; // Difficulty from block header
      maxIterations?: number; // Optional: max iterations per batch
      nonceStart?: number; // Phase 18: Starting nonce (default: 0)
      nonceEnd?: number; // Phase 18: Ending nonce (default: unlimited)
    }
  | { type: "STOP" };

/**
 * Worker event to main thread
 * 
 * Phase 18: Added "exhausted" reason for nonce range exhaustion
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
      reason: "user" | "replaced" | "error" | "exhausted"; // Phase 18: Added "exhausted"
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
let nonceStart: number = 0; // Phase 18: Starting nonce
let nonceEnd: number | null = null; // Phase 18: Ending nonce (null = unlimited)

// Progress reporting interval (report every N hashes or every M ms)
const PROGRESS_INTERVAL_HASHES = 1000; // Report every 1k hashes (more frequent updates)
const PROGRESS_INTERVAL_MS = 100; // Or every 100ms (more frequent updates)
let lastProgressTime = 0;

/**
 * Mining loop
 */
async function miningLoop(): Promise<void> {
  if (!isRunning || !currentBlock) {
    console.log("[Worker] Mining loop not started: isRunning=", isRunning, "currentBlock=", !!currentBlock);
    return;
  }

  console.log("[Worker] Starting mining loop, difficulty:", currentDifficulty, "nonceStart:", nonceStart);

  try {
    while (isRunning && currentBlock) {
      // Phase 18: Check if nonce range is exhausted
      if (nonceEnd !== null && nonce >= nonceEnd) {
        // Nonce range exhausted, request new range
        isRunning = false;
        self.postMessage({
          type: "STOPPED",
          reason: "exhausted",
        } as MinerWorkerEvent);
        return;
      }

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

      // Report progress periodically (more frequent updates)
      const now = Date.now();
      const shouldReport = 
        hashesTried % PROGRESS_INTERVAL_HASHES === 0 ||
        now - lastProgressTime >= PROGRESS_INTERVAL_MS ||
        hashesTried === 1; // Report first hash immediately
      
      if (shouldReport) {
        // Always report first hash to show activity
        if (hashesTried === 1) {
          console.log("[Worker] First hash computed, sending PROGRESS event");
        }
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
    console.error("[Worker] Mining loop error:", error);
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
    // Phase 18: Use nonceStart if provided, otherwise start from 0
    nonceStart = command.nonceStart ?? 0;
    nonceEnd = command.nonceEnd ?? null; // null means unlimited
    nonce = nonceStart;
    lastProgressTime = startedAt;

    console.log("[Worker] START command received, difficulty:", currentDifficulty, "nonceStart:", nonceStart);

    // Start mining loop (will send PROGRESS after first hash)
    // Use setImmediate or setTimeout to ensure async loop starts
    miningLoop().catch((error) => {
      console.error("[Worker] Mining loop promise rejected:", error);
      self.postMessage({
        type: "STOPPED",
        reason: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      } as MinerWorkerEvent);
    });
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

