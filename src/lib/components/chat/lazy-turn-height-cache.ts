export interface CachedTurnHeight {
  height: number;
  width: number;
}

export interface LazyTurnHeightCacheSnapshot {
  scope: string;
  size: number;
  limit: number;
  keys: string[];
}

export interface LazyTurnHeightCache {
  readonly scope: string;
  get(turnKey: string, width: number | null): number | undefined;
  set(turnKey: string, height: number, width: number): void;
  retain(turnKeys: Iterable<string>): void;
  clear(): void;
  inspect(): LazyTurnHeightCacheSnapshot;
}

export interface LazyTurnCacheScopeParts {
  workspaceId: string;
  agentId: string;
  sessionId?: string | null;
}

/**
 * Widths within this tolerance are the same wrap width: zoom / display
 * scaling rounds contentRect widths by fractions of a pixel without moving
 * where text wraps.
 */
export const WIDTH_TOLERANCE_PX = 1;
export const LAZY_TURN_HEIGHT_CACHE_LIMIT = 256;

export function createLazyTurnCacheScope(parts: LazyTurnCacheScopeParts): string {
  return JSON.stringify([parts.workspaceId, parts.agentId, parts.sessionId ?? null]);
}

export function createLazyTurnHeightCache(
  scope: string,
  limit = LAZY_TURN_HEIGHT_CACHE_LIMIT,
): LazyTurnHeightCache {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('LazyTurn height cache limit must be a positive integer');
  }
  const entries = new Map<string, CachedTurnHeight>();
  return {
    scope,
    get(turnKey, width) {
      const entry = entries.get(turnKey);
      if (!entry) return undefined;
      if (width !== null && Math.abs(entry.width - width) > WIDTH_TOLERANCE_PX) {
        entries.delete(turnKey);
        return undefined;
      }
      entries.delete(turnKey);
      entries.set(turnKey, entry);
      return entry.height;
    },
    set(turnKey, height, width) {
      if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(width) || width <= 0) return;
      entries.delete(turnKey);
      entries.set(turnKey, { height, width });
      while (entries.size > limit) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
    },
    retain(turnKeys) {
      const retained = new Set(turnKeys);
      for (const key of entries.keys()) {
        if (!retained.has(key)) entries.delete(key);
      }
    },
    clear() {
      entries.clear();
    },
    inspect() {
      return { scope, size: entries.size, limit, keys: [...entries.keys()] };
    },
  };
}
