/**
 * Header Cache Module
 * 
 * Phase 17: Fast Block Relay
 * 
 * Maintains a cache of block headers for fast fork detection and mining restart
 */

import type { BlockHeader } from "./types";

/**
 * Header cache entry
 */
export interface CachedHeader {
  header: BlockHeader;
  hash: string;
  height: number;
  receivedAt: number;
  bodyReceived: boolean; // Whether full block body has been received
}

/**
 * Header Cache implementation
 */
export class HeaderCache {
  private headers: Map<number, CachedHeader> = new Map(); // height -> header
  private headersByHash: Map<string, CachedHeader> = new Map(); // hash -> header
  private maxCacheSize: number = 1000; // Maximum number of headers to cache

  /**
   * Add or update a header in cache
   */
  addHeader(header: BlockHeader, hash: string, bodyReceived: boolean = false): void {
    const height = header.height;
    const cached: CachedHeader = {
      header,
      hash,
      height,
      receivedAt: Date.now(),
      bodyReceived,
    };

    // Remove old entry if exists
    const old = this.headers.get(height);
    if (old) {
      this.headersByHash.delete(old.hash);
    }

    this.headers.set(height, cached);
    this.headersByHash.set(hash, cached);

    // Cleanup if cache is too large
    this.cleanup();
  }

  /**
   * Get header by height
   */
  getHeaderByHeight(height: number): CachedHeader | null {
    return this.headers.get(height) ?? null;
  }

  /**
   * Get header by hash
   */
  getHeaderByHash(hash: string): CachedHeader | null {
    return this.headersByHash.get(hash) ?? null;
  }

  /**
   * Get latest header (highest height)
   */
  getLatestHeader(): CachedHeader | null {
    if (this.headers.size === 0) return null;
    
    let maxHeight = -1;
    let latest: CachedHeader | null = null;
    
    for (const cached of this.headers.values()) {
      if (cached.height > maxHeight) {
        maxHeight = cached.height;
        latest = cached;
      }
    }
    
    return latest;
  }

  /**
   * Mark header body as received
   */
  markBodyReceived(hash: string): void {
    const cached = this.headersByHash.get(hash);
    if (cached) {
      cached.bodyReceived = true;
    }
  }

  /**
   * Check if header exists
   */
  hasHeader(hash: string): boolean {
    return this.headersByHash.has(hash);
  }

  /**
   * Get headers that need body download
   */
  getHeadersNeedingBody(): CachedHeader[] {
    const result: CachedHeader[] = [];
    for (const cached of this.headers.values()) {
      if (!cached.bodyReceived) {
        result.push(cached);
      }
    }
    // Sort by height (ascending)
    return result.sort((a, b) => a.height - b.height);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    totalHeaders: number;
    headersNeedingBody: number;
    latestHeight: number | null;
  } {
    const latest = this.getLatestHeader();
    return {
      totalHeaders: this.headers.size,
      headersNeedingBody: this.getHeadersNeedingBody().length,
      latestHeight: latest?.height ?? null,
    };
  }

  /**
   * Cleanup old headers (keep only recent ones)
   */
  private cleanup(): void {
    if (this.headers.size <= this.maxCacheSize) return;

    // Sort by height and remove oldest
    const sorted = Array.from(this.headers.entries()).sort((a, b) => a[1].height - b[1].height);
    const toRemove = sorted.slice(0, sorted.length - this.maxCacheSize);
    
    for (const [height, cached] of toRemove) {
      this.headers.delete(height);
      this.headersByHash.delete(cached.hash);
    }
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.headers.clear();
    this.headersByHash.clear();
  }

  /**
   * Remove header by hash
   */
  removeHeader(hash: string): void {
    const cached = this.headersByHash.get(hash);
    if (cached) {
      this.headers.delete(cached.height);
      this.headersByHash.delete(hash);
    }
  }
}

/**
 * Global header cache instance
 */
export const globalHeaderCache = new HeaderCache();

