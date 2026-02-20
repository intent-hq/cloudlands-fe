/**
 * Layout cache for repo visualizer
 * Caches computed pack layouts to avoid recomputation
 */

import type { FileType, ColorEncoding } from './types';

export interface CachedPosition {
  path: string;
  x: number;
  y: number;
  r: number;
  depth: number;
  color: string;
  label?: string;
  name: string;
  extension?: string;
  hasChildren: boolean;
  sortOrder: number;
}

export interface CachedLayout {
  positions: CachedPosition[];
  fileTypes: string[];
  colorExtent: [number, number];
  timestamp: number;
}

interface CacheEntry {
  hash: string;
  layout: CachedLayout;
}

// Simple LRU cache with max entries
const MAX_CACHE_ENTRIES = 10;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class LayoutCache {
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * Generate a hash for the input data
   * Only includes structural properties, not positions
   */
  hashData(
    data: FileType | null,
    colorEncoding: ColorEncoding,
    width: number,
    height: number,
    maxDepth: number,
  ): string {
    if (!data) return 'empty';

    // Create a structural fingerprint
    const countNodes = (node: FileType): number =>
      1 + (node.children?.reduce((sum, c) => sum + countNodes(c), 0) || 0);

    const getStructure = (node: FileType, depth = 0): string => {
      if (depth > 3) return `[${node.children?.length || 0}]`; // Truncate deep trees
      const childHashes =
        node.children
          ?.slice(0, 20)
          .map((c) => getStructure(c, depth + 1))
          .join(',') || '';
      return `${node.name}:${node.size}[${childHashes}]`;
    };

    const nodeCount = countNodes(data);
    const structure = getStructure(data);

    // Combine into a simple hash
    const hashString = `${nodeCount}|${width}x${height}|${maxDepth}|${colorEncoding}|${structure}`;

    // Simple string hash
    let hash = 0;
    for (let i = 0; i < hashString.length; i++) {
      const char = hashString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  get(hash: string): CachedLayout | null {
    const entry = this.cache.get(hash);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.layout.timestamp > CACHE_TTL_MS) {
      this.cache.delete(hash);
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(hash);
    this.cache.set(hash, entry);

    return entry.layout;
  }

  set(hash: string, layout: CachedLayout): void {
    // Evict oldest if at capacity
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(hash, { hash, layout });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Singleton instance
export const layoutCache = new LayoutCache();
