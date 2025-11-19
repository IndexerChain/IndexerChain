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
 * Phase 37-C: Compact block header for mining (only fields needed for PoW)
 */
type MiningCompactBlockHeader = {
  version: number;
  height: number;
  prevHash: string;
  merkleRoot: string;
  timestamp: number;
  difficulty: number;
  stateCommitment?: string;
};

/**
 * Worker command from main thread
 * 
 * Phase 18: Added nonceStart and nonceEnd for cluster mining
 * Phase 37-A: Added miningEpochId to prevent stale mining results
 * Phase 37-C: Changed from candidateBlock to header (compact block header)
 */
type MinerWorkerCommand =
  | {
      type: "START";
      header: MiningCompactBlockHeader; // Phase 37-C: Compact block header instead of full block
      difficulty: number; // Difficulty from block header (redundant but kept for compatibility)
      maxIterations?: number; // Optional: max iterations per batch
      nonceStart?: number; // Phase 18: Starting nonce (default: 0)
      nonceEnd?: number; // Phase 18: Ending nonce (default: unlimited)
      dutyCycle?: number; // Phase 26: CPU duty cycle (0.0 to 1.0)
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    }
  | { type: "STOP"; miningEpochId?: string } // Phase 37-A: Include epoch ID in STOP
  | { type: "SET_DUTY_CYCLE"; dutyCycle: number }; // Phase 26: Update duty cycle dynamically

/**
 * Worker event to main thread
 * 
 * Phase 18: Added "exhausted" reason for nonce range exhaustion
 * Phase 37-A: Added miningEpochId to all events and separate EXHAUSTED/ERROR events
 */
type MinerWorkerEvent =
  | {
      type: "PROGRESS";
      nonce: number;
      hash: string;
      hashesTried: number; // Total hashes tried in this session
      startedAt: number; // Timestamp when mining started
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    }
  | {
      type: "FOUND";
      nonce: number; // Phase 37-C: Only return nonce, not full block
      hash: string;
      hashesTried: number;
      startedAt: number;
      finishedAt: number;
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    }
  | {
      type: "STOPPED";
      reason: "user" | "replaced" | "error" | "exhausted"; // Phase 18: Added "exhausted"
      errorMessage?: string;
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    }
  | {
      type: "EXHAUSTED"; // Phase 37-A: Separate EXHAUSTED event
      lastNonce: number;
      hashesTried: number;
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
    }
  | {
      type: "ERROR"; // Phase 37-A: Separate ERROR event
      error: string;
      miningEpochId?: string; // Phase 37-A: Mining epoch ID
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
let currentHeader: MiningCompactBlockHeader | null = null; // Phase 37-C: Store header instead of full block
let currentDifficulty: number = 0;
let isRunning: boolean = false;
let hashesTried: number = 0;
let startedAt: number = 0;
let nonce: number = 0;
let nonceStart: number = 0; // Phase 18: Starting nonce
let nonceEnd: number | null = null; // Phase 18: Ending nonce (null = unlimited)
let currentMiningEpochId: string | null = null; // Phase 37-A: Current mining epoch ID

// Phase 26: Duty Cycle CPU control
let dutyCycle: number = 1.0; // 0.0 to 1.0, default 100%
const DUTY_CYCLE_PERIOD_MS = 10; // 10ms period
let dutyCycleStartTime: number = 0;

// Progress reporting interval (report every N hashes or every M ms)
const PROGRESS_INTERVAL_HASHES = 1000; // Report every 1k hashes (more frequent updates)
const PROGRESS_INTERVAL_MS = 100; // Or every 100ms (more frequent updates)
let lastProgressTime = 0;

/**
 * Phase 26: Check if we should pause for duty cycle
 */
async function checkDutyCycle(): Promise<void> {
  if (dutyCycle >= 1.0) {
    return; // Full speed, no pause needed
  }

  const now = performance.now();
  const elapsed = now - dutyCycleStartTime;

  if (elapsed >= DUTY_CYCLE_PERIOD_MS) {
    // Reset cycle
    dutyCycleStartTime = now;
  } else {
    const activeTime = DUTY_CYCLE_PERIOD_MS * dutyCycle;
    if (elapsed >= activeTime) {
      // Pause for the rest of the cycle
      const sleepTime = DUTY_CYCLE_PERIOD_MS - elapsed;
      if (sleepTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
      }
      dutyCycleStartTime = performance.now();
    }
  }
}

/**
 * Mining loop
 * Phase 37-C: Uses compact header instead of full block
 */
async function miningLoop(): Promise<void> {
  if (!isRunning || !currentHeader) {
    // Production: No console logs
    return;
  }

  // Production: No console logs
  dutyCycleStartTime = performance.now();

  try {
    while (isRunning && currentHeader) {
      // Phase 26: Check duty cycle (CPU throttling)
      await checkDutyCycle();
      // Phase 18: Check if nonce range is exhausted
      if (nonceEnd !== null && nonce >= nonceEnd) {
        // Nonce range exhausted, request new range
        // Production: No console logs
        isRunning = false;
        // Phase 37-A: Send EXHAUSTED event with epoch ID
        self.postMessage({
          type: "EXHAUSTED",
          lastNonce: nonce,
          hashesTried,
          miningEpochId: currentMiningEpochId ?? undefined,
        } as MinerWorkerEvent);
        return;
      }

      // Phase 37-C: Create header with current nonce for hashing
      const headerWithNonce = {
        ...currentHeader,
        nonce,
      };

      // Compute hash
      const hash = await hashBlockHeader(headerWithNonce);
      hashesTried++;
      
      // Production: No debug logs

      // Check difficulty
      if (checkDifficulty(hash, currentDifficulty)) {
        // Found valid nonce!
        const finishedAt = Date.now();

        // Phase 37-C: Send FOUND event with only nonce (not full block)
        self.postMessage({
          type: "FOUND",
          nonce,
          hash,
          hashesTried,
          startedAt,
          finishedAt,
          miningEpochId: currentMiningEpochId ?? undefined,
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
        // Phase 37-A: Include epoch ID in PROGRESS event
        self.postMessage({
          type: "PROGRESS",
          nonce,
          hash,
          hashesTried,
          startedAt,
          miningEpochId: currentMiningEpochId ?? undefined,
        } as MinerWorkerEvent);
        lastProgressTime = now;
        // Production: No debug logs
      }

      // Yield control periodically to prevent blocking
      if (nonce % 5000 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } catch (error) {
    // Phase 37-A: Send ERROR event with epoch ID
    // Production: Only log errors in development
    if (process.env.NODE_ENV === 'development') {
      console.error("[Worker] Mining loop error:", error);
    }
    self.postMessage({
      type: "ERROR",
      error: error instanceof Error ? error.message : "Unknown error",
      miningEpochId: currentMiningEpochId ?? undefined,
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

    // Phase 37-C: Initialize with compact header instead of full block
    currentHeader = JSON.parse(JSON.stringify(command.header)); // Deep copy
    currentDifficulty = command.difficulty;
    isRunning = true;
    hashesTried = 0;
    startedAt = Date.now();
    // Phase 18: Use nonceStart if provided, otherwise start from 0
    nonceStart = command.nonceStart ?? 0;
    nonceEnd = command.nonceEnd ?? null; // null means unlimited
    nonce = nonceStart;
    lastProgressTime = startedAt;
    
    // Phase 26: Set duty cycle
    dutyCycle = Math.max(0.0, Math.min(1.0, command.dutyCycle ?? 1.0));
    
    // Phase 37-A: Store mining epoch ID
    currentMiningEpochId = command.miningEpochId ?? null;

    // Start mining loop (will send PROGRESS after first hash)
    // Use setImmediate or setTimeout to ensure async loop starts
    // Production: No console logs
    miningLoop().catch((error) => {
      // Production: Only log errors in development
      if (process.env.NODE_ENV === 'development') {
        console.error("[Worker] Mining loop promise rejected:", error);
      }
      self.postMessage({
        type: "STOPPED",
        reason: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      } as MinerWorkerEvent);
    });
  } else if (command.type === "STOP") {
    // Phase 37-A: Check if STOP command matches current epoch (optional validation)
    // If epoch ID is provided and doesn't match, ignore the stop command
    if (command.miningEpochId && currentMiningEpochId && command.miningEpochId !== currentMiningEpochId) {
      // Production: No console logs
      return;
    }
    
    // Stop mining
    isRunning = false;
    self.postMessage({
      type: "STOPPED",
      reason: "user",
      miningEpochId: currentMiningEpochId ?? undefined,
    } as MinerWorkerEvent);
    // Phase 37-A: Clear epoch ID when stopped
    currentMiningEpochId = null;
  } else if (command.type === "SET_DUTY_CYCLE") {
    // Phase 26: Update duty cycle dynamically
    dutyCycle = Math.max(0.0, Math.min(1.0, command.dutyCycle));
    // Reset cycle timer
    dutyCycleStartTime = performance.now();
  }
});

// Note: Types are defined above, no need to re-export

