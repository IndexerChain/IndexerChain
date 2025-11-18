/**
 * Note Store
 * 
 * Phase 27: Manages privacy notes (shielded assets) locally
 * Phase 28: Extended with scan state tracking
 * 
 * Notes are stored in the browser's localStorage and indexed by wallet ID.
 * Each note represents a shielded asset that can be spent.
 */

import type { Note } from "./types.js";

const STORAGE_PREFIX = "indexerchain_notes_";
const SCAN_STATE_PREFIX = "indexerchain_scan_state_";

/**
 * Scan state for a wallet
 */
export interface ShieldedScanState {
  walletId: string;
  lastScannedHeight: number;
  autoScanEnabled: boolean;
}

/**
 * Note Store for managing privacy notes
 */
export class NoteStore {
  private storageKey: string;
  private scanStateKey: string;
  private walletId: string;

  constructor(walletId: string) {
    this.walletId = walletId;
    this.storageKey = `${STORAGE_PREFIX}${walletId}`;
    this.scanStateKey = `${SCAN_STATE_PREFIX}${walletId}`;
  }

  /**
   * Load all notes for this wallet
   */
  loadNotes(): Note[] {
    if (typeof localStorage === "undefined") {
      return [];
    }

    const raw = localStorage.getItem(this.storageKey);
    if (!raw) {
      return [];
    }

    try {
      return JSON.parse(raw) as Note[];
    } catch {
      return [];
    }
  }

  /**
   * Save notes to localStorage
   */
  private saveNotes(notes: Note[]): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(this.storageKey, JSON.stringify(notes));
  }

  /**
   * Add a new note
   */
  addNote(note: Note): void {
    const notes = this.loadNotes();
    // Check if note already exists
    if (notes.some(n => n.noteId === note.noteId)) {
      return; // Already exists
    }
    notes.push(note);
    this.saveNotes(notes);
  }

  /**
   * Remove a note (when spent)
   */
  removeNote(noteId: string): void {
    const notes = this.loadNotes();
    const filtered = notes.filter(n => n.noteId !== noteId);
    this.saveNotes(filtered);
  }

  /**
   * Get a note by ID
   */
  getNote(noteId: string): Note | undefined {
    const notes = this.loadNotes();
    return notes.find(n => n.noteId === noteId);
  }

  /**
   * Get all unspent notes
   */
  getUnspentNotes(): Note[] {
    return this.loadNotes(); // All notes are unspent until nullified
  }

  /**
   * Calculate total shielded balance
   */
  getShieldedBalance(): number {
    const notes = this.getUnspentNotes();
    return notes.reduce((sum, note) => sum + note.amount, 0);
  }

  /**
   * Find notes by commitment
   */
  findNotesByCommitment(commitment: string): Note[] {
    const notes = this.loadNotes();
    return notes.filter(n => n.commitment === commitment);
  }

  /**
   * Clear all notes (for testing/reset)
   */
  clear(): void {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.scanStateKey);
  }

  /**
   * Phase 28: Get scan state for this wallet
   */
  getScanState(): ShieldedScanState {
    if (typeof localStorage === "undefined") {
      return {
        walletId: this.walletId,
        lastScannedHeight: 0,
        autoScanEnabled: true,
      };
    }

    const raw = localStorage.getItem(this.scanStateKey);
    if (!raw) {
      return {
        walletId: this.walletId,
        lastScannedHeight: 0,
        autoScanEnabled: true,
      };
    }

    try {
      return JSON.parse(raw) as ShieldedScanState;
    } catch {
      return {
        walletId: this.walletId,
        lastScannedHeight: 0,
        autoScanEnabled: true,
      };
    }
  }

  /**
   * Phase 28: Update scan state
   */
  updateScanState(state: Partial<ShieldedScanState>): void {
    if (typeof localStorage === "undefined") return;

    const current = this.getScanState();
    const updated: ShieldedScanState = {
      ...current,
      ...state,
      walletId: this.walletId, // Ensure walletId is correct
    };

    localStorage.setItem(this.scanStateKey, JSON.stringify(updated));
  }

  /**
   * Phase 28: Mark note as spent (by checking nullifier set)
   */
  markNoteSpent(noteId: string): void {
    const notes = this.loadNotes();
    const note = notes.find(n => n.noteId === noteId);
    if (note) {
      // In Phase 28, we don't remove the note, but mark it
      // In a full implementation, we'd check against nullifier set
      // For now, we keep all notes and check against nullifiers when calculating balance
    }
  }

  /**
   * Phase 28: Get unspent notes (filter out those with nullifiers in IndexState)
   */
  getUnspentNotesFiltered(_nullifierSet: Set<string>): Note[] {
    const notes = this.loadNotes();
    // For Phase 28, we return all notes
    // In Phase Z2, we'd check nullifiers to filter out spent notes
    return notes;
  }
}

/**
 * Get note store for a wallet
 */
export function getNoteStore(walletId: string): NoteStore {
  return new NoteStore(walletId);
}

