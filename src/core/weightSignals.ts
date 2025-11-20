/**
 * Phase 48-D: Stability / Online score signals for reward weighting
 *
 * Provides helper functions to compute:
 * - OnlineScore: session duration + active booster, normalized to 0..100
 * - ReliabilityScore: derived from quorum total score, clamped 0..100
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { getSessionTracker } from "./miningRewardMultiplier.js";
import { getActiveBoosterTracker } from "./activeBooster.js";
import { IDCToUIDC } from "./idcEmission.js";
import type { Address } from "./types.js";

export function computeOnlineScore(): number {
  const sessionMs = getSessionTracker().getTotalDuration();
  const minutes = sessionMs / 60000;
  // Map minutes to 0..70 segment
  // 0 min -> 10 pts (basic), 10 min -> 30, 60 min -> 70, >60 clamp at 70
  let timeScore = 10;
  if (minutes >= 60) timeScore = 70;
  else if (minutes >= 10) {
    const progress = (minutes - 10) / 50; // 0..1
    timeScore = 30 + progress * 40; // 30..70
  } else {
    // 0..10 min map to 10..30
    const progress = Math.max(0, minutes) / 10;
    timeScore = 10 + progress * 20;
  }

  // Active booster days 0..30+ -> 0..30 pts
  const active = getActiveBoosterTracker();
  const days = Math.max(0, Math.min(30, active.getConsecutiveDays?.() ?? 0));
  const boosterScore = (days / 30) * 30;

  const total = Math.max(0, Math.min(100, timeScore + boosterScore));
  return Math.round(total);
}

export async function computeReliabilityScore(
  chainContext: ChainContext | null,
  p2pNode: P2PNode | null
): Promise<number> {
  try {
    if (!chainContext || !p2pNode) return 0;
    const { getQuorumManager } = await import("./quorumManager.js");
    const qm = getQuorumManager();
    qm.initialize(p2pNode, chainContext);
    const status = qm.getQuorumStatus();
    const s = Math.max(0, Math.min(100, status.totalScore ?? 0));
    return Math.round(s);
  } catch {
    return 0;
  }
}

export function getBalanceUIDC(chainContext: ChainContext | null, address: Address | null): bigint {
  try {
    if (!chainContext || !address) return 0n;
    const balIDC = chainContext.indexState.getBalance(address as any) || 0;
    return IDCToUIDC(balIDC);
  } catch {
    return 0n;
  }
}


