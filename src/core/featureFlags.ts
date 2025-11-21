/**
 * Feature flags and tunables for phased rollout.
 * 
 * Read order:
 * - globalThis overrides (e.g., window.POOLED_REWARDS_ENABLED)
 * - localStorage (e.g., indexerchain_pooled_rewards)
 * - import.meta.env (Vite) variables
 * - provided default
 */

function readBooleanFromAny(
  winKey: string,
  lsKey: string,
  envKey: string,
  defaultValue: boolean
): boolean {
  try {
    const g: any = globalThis as any;
    if (g && typeof g[winKey] !== "undefined") {
      return !!g[winKey];
    }
  } catch {}
  try {
    const v = localStorage.getItem(lsKey);
    if (v !== null) {
      return v === "1" || v.toLowerCase() === "true";
    }
  } catch {}
  try {
    const envVal = (import.meta as any)?.env?.[envKey];
    if (typeof envVal !== "undefined") {
      return envVal === "1" || String(envVal).toLowerCase() === "true";
    }
  } catch {}
  return defaultValue;
}

function readNumberFromAny(
  winKey: string,
  lsKey: string,
  envKey: string,
  defaultValue: number
): number {
  try {
    const g: any = globalThis as any;
    const v = g?.[winKey];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  try {
    const v = localStorage.getItem(lsKey);
    if (v !== null) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  try {
    const envVal = (import.meta as any)?.env?.[envKey];
    if (typeof envVal !== "undefined") {
      const n = Number(envVal);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  return defaultValue;
}

export function isPooledRewardsEnabled(): boolean {
  return readBooleanFromAny(
    "POOLED_REWARDS_ENABLED",
    "indexerchain_pooled_rewards",
    "VITE_POOLED_REWARDS_ENABLED",
    false
  );
}

export function getSlotTimeMs(): number {
  return readNumberFromAny(
    "SLOT_TIME_MS",
    "indexerchain_slot_time_ms",
    "VITE_SLOT_TIME_MS",
    50
  );
}

export function getEpochMs(): number {
  return readNumberFromAny(
    "EPOCH_MS",
    "indexerchain_epoch_ms",
    "VITE_EPOCH_MS",
    1000
  );
}

export function getSlotsPerEpoch(): number {
  const epoch = getEpochMs();
  const slot = getSlotTimeMs();
  const s = Math.max(1, Math.floor(epoch / Math.max(1, slot)));
  return s;
}

export function isSlotLeaderModeEnabled(): boolean {
  return readBooleanFromAny(
    "SLOT_LEADER_ENABLED",
    "indexerchain_slot_leader_enabled",
    "VITE_SLOT_LEADER_ENABLED",
    true
  );
}

export function isProposerEnforceEnabled(): boolean {
  return readBooleanFromAny(
    "PROPOSER_ENFORCE_ENABLED",
    "indexerchain_proposer_enforce_enabled",
    "VITE_PROPOSER_ENFORCE_ENABLED",
    true
  );
}

export function isSnapshotSeedingEnabled(): boolean {
  return readBooleanFromAny(
    "SNAPSHOT_SEEDING_ENABLED",
    "indexerchain_snapshot_seeding_enabled",
    "VITE_SNAPSHOT_SEEDING_ENABLED",
    true
  );
}

export function getSnapshotSeedingIntervalBlocks(): number {
  return readNumberFromAny(
    "SNAPSHOT_SEED_INTERVAL",
    "indexerchain_snapshot_seed_interval",
    "VITE_SNAPSHOT_SEED_INTERVAL",
    2048
  );
}


