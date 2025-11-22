export function isSoloMiningLightNode(): boolean {
  try {
    const g: any = (typeof window !== "undefined") ? (window as any) : {};
    if (typeof g.__soloMiningMode === "boolean") return g.__soloMiningMode;
    const isMining = !!g.__isMining;
    const peers = Number(g.__peerCount || 0);
    return isMining && peers === 0;
  } catch {
    return false;
  }
}

export function guardExternalStateWrite(actionName: string): boolean {
  if (isSoloMiningLightNode()) {
    try { console.warn(`[StateGuard] Blocked external state write: ${actionName} (solo mining mode)`); } catch {}
    return false;
  }
  return true;
}
