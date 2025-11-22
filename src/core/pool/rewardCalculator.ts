export interface RewardInput {
  address: string;
  balanceIDC: number;
  onlineScore: number;     // 0..1
  stabilityScore: number;  // 0..1
}

export interface RewardSplit {
  address: string;
  amountIDC: number;
  weight: number;
}

export function computeWeight(inp: RewardInput, params?: { base?: number; stakeScale?: number; stabilityScale?: number }): number {
  const base = params?.base ?? 1;
  const stakeScale = params?.stakeScale ?? 1;
  const stabilityScale = params?.stabilityScale ?? 1;
  const stakeTerm = Math.sqrt(Math.max(0, inp.balanceIDC)) * stakeScale;
  const stabilityTerm = Math.max(0, Math.min(1, inp.stabilityScore)) * stabilityScale;
  return Math.max(0, base + stakeTerm + stabilityTerm);
}

export function splitReward(totalIDC: number, inputs: RewardInput[], params?: { base?: number; stakeScale?: number; stabilityScale?: number }): RewardSplit[] {
  const weights = inputs.map((x) => ({ address: x.address, weight: computeWeight(x, params) }));
  const sumW = weights.reduce((a, b) => a + b.weight, 0);
  if (sumW <= 0) {
    return inputs.map((x) => ({ address: x.address, amountIDC: 0, weight: 0 }));
  }
  return weights.map((w) => ({
    address: w.address,
    weight: w.weight,
    amountIDC: (w.weight / sumW) * totalIDC,
  }));
}


