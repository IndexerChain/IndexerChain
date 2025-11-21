import { calcMerkleRoot } from "../merkle.js";

export interface PayoutEntry {
  address: string;
  amountUIDC: string; // decimal string of uIDC
}

export function formatPayoutLeaf(address: string, amountUIDC: string): string {
  return `${address}:${amountUIDC}`;
}

export async function computePayoutRoot(entries: PayoutEntry[]): Promise<string> {
  if (!Array.isArray(entries) || entries.length === 0) {
    return await calcMerkleRoot([]);
  }
  const leaves = entries
    .map((e) => ({ addr: String(e.address || ""), amt: String(e.amountUIDC || "0") }))
    .filter((x) => x.addr && x.amt)
    .sort((a, b) => a.addr.localeCompare(b.addr))
    .map((x) => formatPayoutLeaf(x.addr, x.amt));
  return await calcMerkleRoot(leaves);
}


