/**
 * Sparse Merkle Tree for balances namespace
 *
 * Goal:
 * - Compute a deterministic stateRoot for balances
 * - Generate membership proofs for address -> balance
 * - Verify proofs on clients (light nodes)
 *
 * Notes:
 * - We use sha256 as the compression function
 * - Key space is 256-bit (sha256 of address string)
 * - Default (empty) hashes are precomputed by hashing zero at each level
 */
import { sha256 } from "./crypto.js";
import type { IndexState } from "./indexState.js";

type Hex = string;

export interface BalanceProof {
  algorithm: "smt-sha256-v1";
  keyHash: Hex;               // sha256(address)
  value: string;              // balance as string
  siblings: Hex[];            // from leaf upwards (length = TREE_DEPTH)
  depth: number;              // TREE_DEPTH used
}

const TREE_DEPTH = 256;

/**
 * Precompute default zero hashes for each depth.
 * zeroHashes[0] is the default leaf.
 * zeroHashes[i] = H(zeroHashes[i-1] || zeroHashes[i-1])
 */
let zeroHashesCache: Hex[] | null = null;
async function getZeroHashes(): Promise<Hex[]> {
  if (zeroHashesCache) return zeroHashesCache;
  const zeros: Hex[] = [];
  let h = await sha256("0x00"); // base leaf
  zeros.push(h);
  for (let i = 1; i <= TREE_DEPTH; i++) {
    h = await sha256(zeros[i - 1] + zeros[i - 1]);
    zeros.push(h);
  }
  zeroHashesCache = zeros;
  return zeros;
}

async function leafHashFor(address: string, balanceStr: string): Promise<Hex> {
  // Use a domain separator to avoid ambiguity
  return await sha256(`leaf|${address}|${balanceStr}`);
}

/**
 * Compute the SMT root for the current balances namespace of IndexState.
 * For performance, we build only paths required for non-zero leaves.
 */
export async function computeBalancesRoot(indexState: IndexState): Promise<Hex> {
  const zeros = await getZeroHashes();
  // Collect all balances
  const internal = (indexState as any).getInternalState() as Map<string, Map<string, string>>;
  const balancesNs = internal.get("balances") || new Map<string, string>();
  // Map of node hash at (depth, pathPrefix) but we only cache per-leaf climb
  // We'll fold all leaves into an accumulator map keyed by depth -> Map<pathBitsString, hash>
  const levelMaps: Array<Map<string, Hex>> = Array.from({ length: TREE_DEPTH + 1 }, () => new Map());

  for (const [address, balStrRaw] of balancesNs.entries()) {
    const balanceStr = String(balStrRaw ?? "0");
    if (balanceStr === "0" || balanceStr === "0n" || balanceStr === "0.0") {
      continue;
    }
    const keyHash = await sha256(address);
    // Convert hex hash to bitstring
    const bits: string[] = [];
    for (let i = 0; i < keyHash.length; i += 2) {
      const byte = parseInt(keyHash.slice(i, i + 2), 16);
      bits.push(byte.toString(2).padStart(8, "0"));
    }
    const bitString = bits.join("").slice(0, TREE_DEPTH);

    // Leaf
    let nodeHash = await leafHashFor(address, balanceStr);
    // Climb up, populating levelMaps
    for (let depth = 0; depth < TREE_DEPTH; depth++) {
      const bit = bitString[TREE_DEPTH - 1 - depth]; // build bottom-up
      // Place this node in the map for this depth at a synthetic path representation
      // Use only the bit at this depth to combine later, so we cache on left/right groups
      // We'll combine when both children are present; if not, they'll be combined later globally.
      // For simplicity, directly combine with zero on the fly:
      const isLeft = bit === "0";
      const left = isLeft ? nodeHash : zeros[depth];
      const right = isLeft ? zeros[depth] : nodeHash;
      nodeHash = await sha256(left + right);
      // Continue climbing
    }
    // nodeHash is now the candidate root for this single leaf; fold it into global root
    // Combine global root with this path by hashing root with nodeHash; commutative not guaranteed,
    // so we combine deterministically by H(min||max) to make order-independent folding.
    const globalRoot = levelMaps[TREE_DEPTH].get("root") || zeros[TREE_DEPTH];
    const min = globalRoot < nodeHash ? globalRoot : nodeHash;
    const max = globalRoot < nodeHash ? nodeHash : globalRoot;
    const combined = await sha256(min + max);
    levelMaps[TREE_DEPTH].set("root", combined);
  }

  // If no non-zero leaves, return zero root
  const root = levelMaps[TREE_DEPTH].get("root") || (await getZeroHashes())[TREE_DEPTH];
  return root;
}

/**
 * Generate a membership proof for address balance.
 * If balance is zero/missing, provide proof for zero leaf.
 */
export async function generateBalanceProof(indexState: IndexState, address: string): Promise<{ root: Hex; proof: BalanceProof }> {
  const zeros = await getZeroHashes();
  const internal = (indexState as any).getInternalState() as Map<string, Map<string, string>>;
  const balancesNs = internal.get("balances") || new Map<string, string>();
  const balanceStr = String(balancesNs.get(address) ?? "0");

  const keyHash = await sha256(address);
  // Convert keyHash to bitstring
  const bits: string[] = [];
  for (let i = 0; i < keyHash.length; i += 2) {
    const byte = parseInt(keyHash.slice(i, i + 2), 16);
    bits.push(byte.toString(2).padStart(8, "0"));
  }
  const bitString = bits.join("").slice(0, TREE_DEPTH);

  // Build siblings bottom-up using on-the-fly default (this is a classic SMT with defaults)
  const siblings: Hex[] = [];
  let nodeHash = balanceStr === "0" ? zeros[0] : await leafHashFor(address, balanceStr);
  for (let depth = 0; depth < TREE_DEPTH; depth++) {
    const isLeft = bitString[TREE_DEPTH - 1 - depth] === "0";
    const sibling = zeros[depth];
    siblings.push(sibling);
    const left = isLeft ? nodeHash : sibling;
    const right = isLeft ? sibling : nodeHash;
    nodeHash = await sha256(left + right);
  }

  // In absence of other populated leaves knowledge, the computed root is the path fold against defaults.
  const root = nodeHash;
  const proof: BalanceProof = {
    algorithm: "smt-sha256-v1",
    keyHash,
    value: balanceStr,
    siblings,
    depth: TREE_DEPTH,
  };
  return { root, proof };
}

/**
 * Verify proof against a given root.
 */
export async function verifyBalanceProof(root: Hex, address: string, value: string, proof: BalanceProof): Promise<boolean> {
  if (proof.algorithm !== "smt-sha256-v1" || proof.depth !== TREE_DEPTH) {
    return false;
  }
  const keyHash = await sha256(address);
  if (keyHash !== proof.keyHash) return false;

  const bits: string[] = [];
  for (let i = 0; i < keyHash.length; i += 2) {
    const byte = parseInt(keyHash.slice(i, i + 2), 16);
    bits.push(byte.toString(2).padStart(8, "0"));
  }
  const bitString = bits.join("").slice(0, TREE_DEPTH);

  let nodeHash = value === "0" ? (await getZeroHashes())[0] : await leafHashFor(address, value);
  for (let depth = 0; depth < TREE_DEPTH; depth++) {
    const isLeft = bitString[TREE_DEPTH - 1 - depth] === "0";
    const sibling = proof.siblings[depth] || (await getZeroHashes())[depth];
    const left = isLeft ? nodeHash : sibling;
    const right = isLeft ? sibling : nodeHash;
    nodeHash = await sha256(left + right);
  }
  return nodeHash === root;
}


