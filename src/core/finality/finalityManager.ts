/**
 * Finality Manager
 * 
 * Phase 22: Fast Finality Layer - Main manager for finality operations
 * 
 * Handles:
 * - Committee election
 * - Vote collection
 * - Certificate generation
 * - Finality verification
 */

import type {
  ChainParams,
  Address,
  FinalityVote,
  FinalityCertificate,
  PeerScore,
} from "../types.js";
import type { BrowserP2PNode } from "../p2p.js";
import { electCommittee, getCommitteeRound, isInCommittee } from "./committeeElection.js";
import { createFinalityVote } from "./finalityVote.js";
import { createFinalityCertificate } from "./finalityCert.js";
import { getOrCreateNodeKeyPair, getOrCreateNodeAddress } from "../keys.js";

/**
 * Finality manager state
 */
interface FinalityState {
  currentCommittee: Array<{ address: Address; peerId: string; score: number }>;
  currentRound: number;
  pendingVotes: Map<string, FinalityVote[]>; // blockHash -> votes
  finalizedBlocks: Set<string>; // blockHash -> finalized
  voteTimeouts: Map<string, number>; // blockHash -> timeout ID
}

/**
 * Finality Manager
 * 
 * Manages the fast finality layer for IndexerChain
 */
export class FinalityManager {
  private params: ChainParams;
  private p2pNode: BrowserP2PNode | null = null;
  private state: FinalityState;
  private nodeAddress: Address | null = null;
  private nodePrivateKey: CryptoKey | null = null;
  
  // Callbacks
  private onFinalizedCallbacks: Set<(blockHash: string, certificate: FinalityCertificate) => void> = new Set();
  
  constructor(params: ChainParams) {
    this.params = params;
    this.state = {
      currentCommittee: [],
      currentRound: -1,
      pendingVotes: new Map(),
      finalizedBlocks: new Set(),
      voteTimeouts: new Map(),
    };
  }
  
  /**
   * Initialize with P2P node
   */
  async initialize(p2pNode: BrowserP2PNode): Promise<void> {
    this.p2pNode = p2pNode;
    
    // Get node identity
    const keyPair = await getOrCreateNodeKeyPair();
    this.nodeAddress = await getOrCreateNodeAddress();
    this.nodePrivateKey = keyPair.privateKey;
    
    // Setup message handlers
    this.setupMessageHandlers();
  }
  
  /**
   * Setup P2P message handlers
   */
  private setupMessageHandlers(): void {
    if (!this.p2pNode) return;
    
    // Handle FINALITY_VOTE messages
    this.p2pNode.onMessage("FINALITY_VOTE", async (vote: FinalityVote) => {
      await this.handleReceivedVote(vote);
    });
    
    // Handle FINALITY_CERT messages
    this.p2pNode.onMessage("FINALITY_CERT", async (cert: FinalityCertificate) => {
      await this.handleReceivedCertificate(cert);
    });
    
    // Handle REQUEST_FINALITY messages
    this.p2pNode.onMessage("REQUEST_FINALITY", async (_request: { blockHash: string; blockHeight: number }) => {
      // If we have a certificate for this block, send it
      // This will be handled when we store certificates
    });
  }
  
  /**
   * Handle new block header (trigger finality process)
   */
  async handleNewBlockHeader(
    blockHash: string,
    blockHeight: number,
    allPeers: Array<{ peerId: string; address: Address; score: PeerScore }>
  ): Promise<void> {
    if (!this.params.finalityEnabled) return;
    if (!this.p2pNode || !this.nodeAddress || !this.nodePrivateKey) return;
    
    // Check if already finalized
    if (this.state.finalizedBlocks.has(blockHash)) {
      return;
    }
    
    // Get committee round
    const committeeRound = getCommitteeRound(blockHeight, this.params);
    
    // Check if committee needs to be re-elected
    if (this.state.currentRound !== committeeRound) {
      // Elect new committee
      const committee = electCommittee(blockHash, allPeers, this.params);
      this.state.currentCommittee = committee.map((m) => ({
        address: m.address,
        peerId: m.peerId,
        score: m.score,
      }));
      this.state.currentRound = committeeRound;
    }
    
    // Check if this node is in the committee
    const inCommittee = isInCommittee(this.nodeAddress, blockHash, allPeers, this.params);
    
    if (inCommittee) {
      // Create and broadcast vote
      const vote = await createFinalityVote(
        blockHash,
        blockHeight,
        committeeRound,
        this.nodeAddress,
        this.nodePrivateKey
      );
      
      // Broadcast vote
      this.p2pNode.broadcast("FINALITY_VOTE", vote);
      
      // Also add to our own pending votes
      this.addVote(vote);
    }
    
    // Request finality from other nodes (if not in committee)
    if (!inCommittee) {
      this.p2pNode.broadcast("REQUEST_FINALITY", {
        blockHash,
        blockHeight,
      });
    }
    
    // Set timeout for vote collection
    const timeout = this.params.finalityVoteTimeoutMs ?? 5000;
    const timeoutId = window.setTimeout(() => {
      this.checkFinality(blockHash, blockHeight, committeeRound);
    }, timeout) as unknown as number;
    
    this.state.voteTimeouts.set(blockHash, timeoutId);
  }
  
  /**
   * Handle received vote
   */
  private async handleReceivedVote(vote: FinalityVote): Promise<void> {
    // Verify vote signature (we'll need to get public key from peer)
    // For now, we'll trust votes from known peers and verify later when creating certificate
    
    // Add vote to pending votes
    this.addVote(vote);
    
    // Check if we can create a certificate now
    await this.checkFinality(vote.blockHash, vote.blockHeight, vote.committeeRound);
  }
  
  /**
   * Add vote to pending votes
   */
  private addVote(vote: FinalityVote): void {
    const votes = this.state.pendingVotes.get(vote.blockHash) || [];
    
    // Check for duplicate votes from same signer
    const existingIndex = votes.findIndex((v) => v.signerAddress === vote.signerAddress);
    if (existingIndex >= 0) {
      votes[existingIndex] = vote; // Update with latest vote
    } else {
      votes.push(vote);
    }
    
    this.state.pendingVotes.set(vote.blockHash, votes);
  }
  
  /**
   * Check if block can be finalized
   */
  private async checkFinality(
    blockHash: string,
    blockHeight: number,
    committeeRound: number
  ): Promise<void> {
    const votes = this.state.pendingVotes.get(blockHash) || [];
    const committeeSize = this.params.finalityCommitteeSize ?? 11;
    const thresholdRatio = this.params.finalityThreshold ?? 0.67;
    const threshold = Math.ceil(committeeSize * thresholdRatio);
    
    // Try to create certificate
    const certificate = createFinalityCertificate(
      blockHash,
      blockHeight,
      committeeRound,
      votes,
      threshold
    );
    
    if (certificate) {
      // Block is finalized!
      this.state.finalizedBlocks.add(blockHash);
      
      // Clear timeout
      const timeoutId = this.state.voteTimeouts.get(blockHash);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.state.voteTimeouts.delete(blockHash);
      }
      
      // Broadcast certificate
      if (this.p2pNode) {
        this.p2pNode.broadcast("FINALITY_CERT", certificate);
      }
      
      // Notify callbacks
      for (const callback of this.onFinalizedCallbacks) {
        callback(blockHash, certificate);
      }
    }
  }
  
  /**
   * Handle received certificate
   */
  private async handleReceivedCertificate(
    cert: FinalityCertificate
  ): Promise<void> {
    // Verify certificate (we'll need committee members and public keys)
    // For now, we'll trust certificates and verify later
    
    // Mark block as finalized
    this.state.finalizedBlocks.add(cert.blockHash);
    
    // Clear pending votes for this block
    this.state.pendingVotes.delete(cert.blockHash);
    
    // Clear timeout
    const timeoutId = this.state.voteTimeouts.get(cert.blockHash);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.state.voteTimeouts.delete(cert.blockHash);
    }
    
    // Notify callbacks
    for (const callback of this.onFinalizedCallbacks) {
      callback(cert.blockHash, cert);
    }
    
  }
  
  /**
   * Check if a block is finalized
   */
  isFinalized(blockHash: string): boolean {
    return this.state.finalizedBlocks.has(blockHash);
  }
  
  /**
   * Get finality certificate for a block (if exists)
   */
  getCertificate(_blockHash: string): FinalityCertificate | null {
    // We'll need to store certificates, for now return null
    // This will be implemented when we integrate with chain storage
    return null;
  }
  
  /**
   * Register callback for finalized blocks
   */
  onFinalized(callback: (blockHash: string, certificate: FinalityCertificate) => void): void {
    this.onFinalizedCallbacks.add(callback);
  }
  
  /**
   * Get current committee
   */
  getCurrentCommittee(): Array<{ address: Address; peerId: string; score: number }> {
    return [...this.state.currentCommittee];
  }
  
  /**
   * Get finality statistics
   */
  getStats(): {
    finalizedCount: number;
    pendingVotes: number;
    currentRound: number;
    committeeSize: number;
  } {
    return {
      finalizedCount: this.state.finalizedBlocks.size,
      pendingVotes: this.state.pendingVotes.size,
      currentRound: this.state.currentRound,
      committeeSize: this.state.currentCommittee.length,
    };
  }
  
  /**
   * Cleanup
   */
  destroy(): void {
    // Clear all timeouts
    for (const timeoutId of this.state.voteTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.state.voteTimeouts.clear();
    this.onFinalizedCallbacks.clear();
  }
}

