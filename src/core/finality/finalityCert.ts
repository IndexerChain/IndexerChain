/**
 * Finality Certificate
 * 
 * Phase 22: Fast Finality Layer - Certificate generation and verification
 * 
 * Handles creating and verifying finality certificates from collected votes
 */

import type { FinalityCertificate, FinalityVote, Address } from "../types.js";
import { verifyFinalityVote } from "./finalityVote.js";

/**
 * Create a finality certificate from collected votes
 * 
 * @param blockHash Hash of the block
 * @param blockHeight Height of the block
 * @param committeeRound Committee round number
 * @param votes Array of valid finality votes
 * @param threshold Minimum number of votes required (default: 2/3 of committee)
 * @returns Finality certificate if threshold is met, null otherwise
 */
export function createFinalityCertificate(
  blockHash: string,
  blockHeight: number,
  committeeRound: number,
  votes: FinalityVote[],
  threshold: number
): FinalityCertificate | null {
  // Filter votes for this specific block
  const validVotes = votes.filter(
    (vote) =>
      vote.blockHash === blockHash &&
      vote.blockHeight === blockHeight &&
      vote.committeeRound === committeeRound
  );
  
  // Remove duplicate votes from same signer
  const uniqueVotes = new Map<Address, FinalityVote>();
  for (const vote of validVotes) {
    if (!uniqueVotes.has(vote.signerAddress)) {
      uniqueVotes.set(vote.signerAddress, vote);
    }
  }
  
  const signatureCount = uniqueVotes.size;
  
  // Check if threshold is met
  if (signatureCount < threshold) {
    return null;
  }
  
  // Create certificate
  const certificate: FinalityCertificate = {
    blockHash,
    blockHeight,
    committeeRound,
    signatures: Array.from(uniqueVotes.values()).map((vote) => ({
      signer: vote.signerAddress,
      signature: vote.signature,
    })),
    createdAt: Date.now(),
    threshold,
    actualSignatures: signatureCount,
  };
  
  return certificate;
}

/**
 * Verify a finality certificate
 * 
 * @param certificate Finality certificate to verify
 * @param committeeMembers List of committee members for this round
 * @param getPublicKey Function to get public key for an address
 * @returns true if certificate is valid
 */
export async function verifyFinalityCertificate(
  certificate: FinalityCertificate,
  committeeMembers: Array<{ address: Address }>,
  getPublicKey: (address: Address) => Promise<JsonWebKey | null>
): Promise<boolean> {
  // Check threshold
  if (certificate.actualSignatures < certificate.threshold) {
    return false;
  }
  
  // Check that all signers are in the committee
  const committeeAddresses = new Set(committeeMembers.map((m) => m.address));
  for (const sig of certificate.signatures) {
    if (!committeeAddresses.has(sig.signer)) {
      return false;
    }
  }
  
  // Verify all signatures
  for (const sig of certificate.signatures) {
    const publicKey = await getPublicKey(sig.signer);
    if (!publicKey) {
      return false;
    }
    
    const vote = {
      blockHash: certificate.blockHash,
      blockHeight: certificate.blockHeight,
      committeeRound: certificate.committeeRound,
      signerAddress: sig.signer,
      signature: sig.signature,
    };
    
    const isValid = await verifyFinalityVote(vote, publicKey);
    if (!isValid) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if a block has reached finality
 * 
 * @param certificate Finality certificate (if exists)
 * @param threshold Required number of signatures
 * @returns true if block is finalized
 */
export function isBlockFinalized(
  certificate: FinalityCertificate | undefined,
  threshold: number
): boolean {
  if (!certificate) return false;
  return certificate.actualSignatures >= threshold;
}

