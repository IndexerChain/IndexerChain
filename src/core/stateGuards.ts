/**
 * State Guards - Prevent IndexState rollback during solo mining
 * 
 * CRITICAL: In solo mining mode, IndexState should only accumulate, never revert.
 * All snapshot restore, state hydration, and external state writes must be blocked.
 */

export function isSoloMiningLightNode(): boolean {
  try {
    const g: any = (typeof window !== "undefined") ? (window as any) : {};
    // Check explicit flag first
    if (typeof g.__soloMiningMode === "boolean") return g.__soloMiningMode;
    // Check if mining is active and no peers
    const isMining = !!g.__isMining;
    const peers = Number(g.__peerCount || 0);
    return isMining && peers === 0;
  } catch {
    return false;
  }
}

/**
 * Check if solo mining mode is active
 * This is the main guard function to use throughout the codebase
 */
export function isSoloMiningMode(): boolean {
  return isSoloMiningLightNode();
}

/**
 * Guard against external state writes during solo mining
 */
export function guardExternalStateWrite(actionName: string): boolean {
  if (isSoloMiningMode()) {
    try { 
      console.warn(`[StateGuard] 🛑 Blocked external state write: ${actionName} (solo mining mode)`); 
    } catch {}
    return false;
  }
  return true;
}

/**
 * Guard against IndexState restoration/snapshot application during solo mining
 * This is the CRITICAL guard that prevents balance rollback
 */
export function guardIndexStateRestore(actionName: string, snapshotHeight?: number, currentHeight?: number): boolean {
  if (isSoloMiningMode()) {
    try {
      const heightInfo = snapshotHeight !== undefined && currentHeight !== undefined
        ? ` (snapshot height: ${snapshotHeight}, current height: ${currentHeight})`
        : '';
      console.warn(`[StateGuard] 🛑 Blocked IndexState restore: ${actionName}${heightInfo} (solo mining mode)`);
    } catch {}
    return false;
  }
  return true;
}

/**
 * Guard against snapshot application during solo mining
 */
export function guardSnapshotApplication(snapshotHeight?: number, currentHeight?: number): boolean {
  return guardIndexStateRestore('snapshot application', snapshotHeight, currentHeight);
}

/**
 * Guard against state hydration from storage during solo mining
 */
export function guardStateHydration(actionName: string): boolean {
  if (isSoloMiningMode()) {
    try {
      console.warn(`[StateGuard] 🛑 Blocked state hydration: ${actionName} (solo mining mode)`);
    } catch {}
    return false;
  }
  return true;
}
