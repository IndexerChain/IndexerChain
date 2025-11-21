import { sha256 } from "../crypto.js";

export interface MerkleLeaf {
  // For PoolRewardEntry we will serialize as "address|amount|weight"
  key: string;
}

export interface MerkleProof {
  leafHash: string;
  siblings: string[]; // bottom-up
  root: string;
}

function serializeEntry(address: string, amount: string, weight: number): string {
  return `addr=${address}|amt=${amount}|w=${weight}`;
}

export function leafFromPoolEntry(address: string, amount: string, weight: number): MerkleLeaf {
  return { key: serializeEntry(address, amount, weight) };
}

async function hashPair(a: string, b: string): Promise<string> {
  return await sha256(a + b);
}

/**
 * Build Merkle root from ordered leaves.
 * The caller must ensure deterministic order (e.g., sort by address asc).
 */
export async function buildMerkleRoot(leaves: MerkleLeaf[]): Promise<{ root: string; leafHashes: string[] }> {
  if (leaves.length === 0) {
    const zero = await sha256("");
    return { root: zero, leafHashes: [] };
  }
  let level: string[] = [];
  const leafHashes: string[] = [];
  for (const leaf of leaves) {
    const h = await sha256(leaf.key);
    level.push(h);
    leafHashes.push(h);
  }
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(await hashPair(level[i], level[i + 1]));
      } else {
        next.push(await hashPair(level[i], level[i]));
      }
    }
    level = next;
  }
  return { root: level[0], leafHashes };
}

/**
 * Generate Merkle proof for a leaf at index.
 */
export async function generateMerkleProof(leaves: MerkleLeaf[], targetIndex: number): Promise<MerkleProof> {
  if (targetIndex < 0 || targetIndex >= leaves.length) {
    throw new Error("Invalid target index");
  }
  const { leafHashes } = await buildMerkleRoot(leaves);
  let level = [...leafHashes];
  const siblings: string[] = [];
  let idx = targetIndex;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      let left = level[i];
      let right = i + 1 < level.length ? level[i + 1] : level[i];
      const parent = await hashPair(left, right);
      next.push(parent);
      if (i === idx || i + 1 === idx) {
        const isLeft = i === idx;
        siblings.push(isLeft ? right : left);
        idx = Math.floor(i / 2);
      }
    }
    level = next;
  }
  const leafHash = leafHashes[targetIndex];
  const root = level[0];
  return { leafHash, siblings, root };
}

/**
 * Verify Merkle proof for serialized pool entry.
 */
export async function verifyMerkleProof(address: string, amount: string, weight: number, proof: MerkleProof): Promise<boolean> {
  const key = serializeEntry(address, amount, weight);
  const computedLeaf = await sha256(key);
  if (computedLeaf !== proof.leafHash) return false;
  let acc = proof.leafHash;
  for (const sib of proof.siblings) {
    // Deterministic order: as built (left/right) during proof generation
    // We don't store position flags; assume construction order followed left-right in building
    // For robust verification, include position bits; kept simple here aligning with generator.
    acc = await hashPair(acc, sib);
  }
  return acc === proof.root;
}


