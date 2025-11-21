import type { ChainContext } from "../core/chain.js";

type E2EResult = { ok: boolean; info?: any; error?: string };

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runWarpSync0(chainContext: ChainContext, p2p: any, timeoutMs: number = 15000): Promise<E2EResult> {
  try {
    const start = Date.now();
    const initial = chainContext.storage.getTip()?.header.height || 0;
    if (initial !== 0) {
      return { ok: true, info: { initial } };
    }
    p2p?.sendToSignalServer?.("REQUEST_BOOTSTRAP", { wantHeaders: true, headerCount: 1000, wantSnapshotMeta: true });
    for (;;) {
      const h = chainContext.storage.getTip()?.header.height || 0;
      if (h > 0) return { ok: true, info: { height: h, elapsedMs: Date.now() - start } };
      if (Date.now() - start > timeoutMs) return { ok: false, error: "WarpSync timeout" };
      await sleep(300);
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function runCatchUp(chainContext: ChainContext, p2p: any, timeoutMs: number = 15000): Promise<E2EResult> {
  try {
    const start = Date.now();
    const localH = chainContext.storage.getTip()?.header.height || 0;
    const netH = (typeof window !== "undefined" && (window as any).lastRootTipHeight) || 0;
    if (netH <= localH) return { ok: true, info: { localH, netH } };
    p2p?.broadcast?.("GLOBAL_VIEW_REQUEST", {});
    p2p?.sendToSignalServer?.("REQUEST_BOOTSTRAP_BLOCKS", { from: Math.max(1, netH - 5000), to: netH });
    for (;;) {
      const h = chainContext.storage.getTip()?.header.height || 0;
      if (h >= netH) return { ok: true, info: { height: h, elapsedMs: Date.now() - start } };
      if (Date.now() - start > timeoutMs) return { ok: false, error: "CatchUp timeout" };
      await sleep(300);
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function runNoStuck201(chainContext: ChainContext, p2p: any, timeoutMs: number = 15000): Promise<E2EResult> {
  try {
    const start = Date.now();
    let last = chainContext.storage.getTip()?.header.height || 0;
    let stagnantMs = 0;
    const tick = 300;
    for (;;) {
      const nowH = chainContext.storage.getTip()?.header.height || 0;
      if (nowH > last) {
        last = nowH;
        stagnantMs = 0;
      } else {
        stagnantMs += tick;
      }
      if (nowH > 201) return { ok: true, info: { height: nowH, elapsedMs: Date.now() - start } };
      if (stagnantMs > timeoutMs) return { ok: false, error: "Height stagnant at <=201" };
      if (Date.now() - start > timeoutMs * 2) return { ok: false, error: "NoStuck201 timeout" };
      await sleep(tick);
      // Nudge
      p2p?.sendToSignalServer?.("GLOBAL_VIEW_REQUEST", {});
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function runAllSyncE2E(chainContext: ChainContext, p2p: any): Promise<{ warp: E2EResult; catchUp: E2EResult; noStuck: E2EResult }> {
  const warp = await runWarpSync0(chainContext, p2p);
  const catchUp = await runCatchUp(chainContext, p2p);
  const noStuck = await runNoStuck201(chainContext, p2p);
  return { warp, catchUp, noStuck };
}

// Expose to window for quick manual run in dev tools
try {
  if (typeof window !== "undefined") {
    (window as any).syncE2E = {
      runWarpSync0,
      runCatchUp,
      runNoStuck201,
      runAllSyncE2E,
    };
  }
} catch {}


