/**
 * Finality Vote
 * 
 * Phase 22: Fast Finality Layer - Vote creation and verification
 * 
 * Handles creating and verifying finality votes from committee members
 */

import type { Address } from "../types.js";

/**
 * Encode vote data for signing
 */
export function encodeVoteForSigning(
  blockHash: string,
  blockHeight: number,
  committeeRound: number
): Uint8Array {
  // Create a deterministic encoding for signing
  const data = JSON.stringify({
    blockHash,
    blockHeight,
    committeeRound,
    type: "FINALITY_VOTE",
  });
  return new TextEncoder().encode(data);
}

/**
 * Create a finality vote signature
 * 
 * @param blockHash Hash of the block being voted on
 * @param blockHeight Height of the block
 * @param committeeRound Committee round number
 * @param privateKey Private key of the committee member
 * @returns Finality vote with signature
 */
export async function createFinalityVote(
  blockHash: string,
  blockHeight: number,
  committeeRound: number,
  signerAddress: Address,
  privateKey: CryptoKey
): Promise<{
  blockHash: string;
  blockHeight: number;
  committeeRound: number;
  signerAddress: Address;
  signature: string;
  timestamp: number;
}> {
  const data = encodeVoteForSigning(blockHash, blockHeight, committeeRound);
  
  // Sign using ECDSA
  // Create a new Uint8Array to ensure proper type
  const dataArray = new Uint8Array(data);
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    privateKey,
    dataArray
  );
  
  // Convert to base64
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  return {
    blockHash,
    blockHeight,
    committeeRound,
    signerAddress,
    signature: signatureBase64,
    timestamp: Date.now(),
  };
}

/**
 * Verify a finality vote signature
 * 
 * @param vote Finality vote to verify
 * @param publicKey Public key of the signer (as JWK)
 * @returns true if signature is valid
 */
export async function verifyFinalityVote(
  vote: {
    blockHash: string;
    blockHeight: number;
    committeeRound: number;
    signerAddress: Address;
    signature: string;
  },
  publicKey: JsonWebKey
): Promise<boolean> {
  try {
    const data = encodeVoteForSigning(
      vote.blockHash,
      vote.blockHeight,
      vote.committeeRound
    );
    
    // Import public key
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      publicKey,
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["verify"]
    );
    
    // Decode signature
    const signatureBytes = Uint8Array.from(atob(vote.signature), c => c.charCodeAt(0));
    
    // Create a new Uint8Array to ensure proper type
    const dataArray = new Uint8Array(data);
    
    // Verify signature
    return await crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: "SHA-256",
      },
      cryptoKey,
      signatureBytes,
      dataArray
    );
  } catch (error) {
    console.warn("[Phase 22] Finality vote verification failed:", error);
    return false;
  }
}

