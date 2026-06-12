/**
 * Unified Main-Process Cache
 *
 * Map-based cache with optional TTL (per cache and per entry), LRU eviction
 * at max size, and a module-level registry powering `clearAllCaches()`.
 *
 * Expiry is lazy (checked on `get`/`has`) plus a single shared `unref()`'d
 * sweep timer for all caches; the timer stops when no TTL-using caches remain.
 */

export interface CacheOptions {
  /** Optional name for logging/debugging. */
  name?: string;
  /** Default time-to-live for entries, in ms. Default: no expiry. */
  ttlMs?: number;
  /** Maximum number of entries before LRU eviction. Default: Infinity. */
  maxSize?: number;
}

export interface CacheSetOptions {
  /** Per-entry TTL override, in ms. Overrides the cache-level `ttlMs`. */
  ttlMs?: number;
}

export interface Cache<K, V> {
  readonly name: string | undefined;
  readonly size: number;
  get(key: K): V | undefined;
  set(key: K, value: V, options?: CacheSetOptions): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  keys(): K[];
  /** Clears the cache and unregisters it from the module registry. */
  dispose(): void;
}

interface CacheEntry<V> {
  value: V;
  /** Absolute expiry timestamp in ms, or undefined for no expiry. */
  expiresAt: number | undefined;
}

interface RegisteredCache {
  usesTtl: boolean;
  sweep(): void;
  clear(): void;
}

export const SWEEP_INTERVAL_MS = 60 * 1000;

const registry = new Set<RegisteredCache>();
let sweepTimer: NodeJS.Timeout | null = null;

function anyCacheUsesTtl(): boolean {
  for (const cache of registry) {
    if (cache.usesTtl) return true;
  }
  return false;
}

function ensureSweepTimer(): void {
  if (sweepTimer !== null) return;
  sweepTimer = setInterval(() => {
    for (const cache of registry) {
      cache.sweep();
    }
    maybeStopSweepTimer();
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

function maybeStopSweepTimer(): void {
  if (sweepTimer !== null && !anyCacheUsesTtl()) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

export function createCache<K, V>(options: CacheOptions = {}): Cache<K, V> {
  const { name, ttlMs: defaultTtlMs, maxSize = Infinity } = options;
  const entries = new Map<K, CacheEntry<V>>();

  const isExpired = (entry: CacheEntry<V>): boolean =>
    entry.expiresAt !== undefined && Date.now() >= entry.expiresAt;

  const registered: RegisteredCache = {
    usesTtl: defaultTtlMs !== undefined,
    sweep() {
      for (const [key, entry] of entries) {
        if (isExpired(entry)) entries.delete(key);
      }
    },
    clear() {
      entries.clear();
    },
  };
  registry.add(registered);
  if (registered.usesTtl) ensureSweepTimer();

  return {
    name,
    get size() {
      return entries.size;
    },
    get(key: K): V | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (isExpired(entry)) {
        entries.delete(key);
        return undefined;
      }
      // Refresh recency for LRU ordering
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: K, value: V, setOptions?: CacheSetOptions): void {
      const ttlMs = setOptions?.ttlMs !== undefined ? setOptions.ttlMs : defaultTtlMs;
      if (ttlMs !== undefined && !registered.usesTtl) {
        registered.usesTtl = true;
        ensureSweepTimer();
      }
      // Delete first so re-set moves the key to most-recently-used position
      entries.delete(key);
      if (entries.size >= maxSize) {
        const oldestKey = entries.keys().next();
        if (!oldestKey.done) entries.delete(oldestKey.value);
      }
      entries.set(key, {
        value,
        expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : undefined,
      });
    },
    has(key: K): boolean {
      const entry = entries.get(key);
      if (!entry) return false;
      if (isExpired(entry)) {
        entries.delete(key);
        return false;
      }
      return true;
    },
    delete(key: K): boolean {
      return entries.delete(key);
    },
    clear(): void {
      entries.clear();
    },
    keys(): K[] {
      return Array.from(entries.keys());
    },
    dispose(): void {
      entries.clear();
      registry.delete(registered);
      maybeStopSweepTimer();
    },
  };
}

/** Clears every registered cache. */
export function clearAllCaches(): void {
  for (const cache of registry) {
    cache.clear();
  }
}

