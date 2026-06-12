import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../../shared/logger';
import { createCache } from './cache';

const logger = new Logger('ProviderModelCache');
const CACHE_DIR_NAME = 'provider-model-cache';

type PersistedModelCache<T> = {
  savedAt: number;
  models: T[];
};

export type ProviderModelCacheEntry<T> = PersistedModelCache<T>;

type ModelLike = { value: string; label: string };

function getCacheFilePath(providerId: string): string | null {
  try {
    const userDataPath = app?.getPath?.('userData');
    if (!userDataPath) return null;
    const safeProviderId = providerId.replace(/[^a-z0-9_-]/gi, '_');
    return path.join(userDataPath, CACHE_DIR_NAME, `${safeProviderId}.json`);
  } catch (error) {
    logger.debug('Provider model cache path unavailable', {
      providerId,
      error: (error as Error).message,
    });
    return null;
  }
}

function isModelLike(value: unknown): value is ModelLike {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ModelLike).value === 'string' &&
    typeof (value as ModelLike).label === 'string'
  );
}

export async function readPersistedProviderModels<T extends ModelLike>(
  providerId: string,
): Promise<ProviderModelCacheEntry<T> | null> {
  const filePath = getCacheFilePath(providerId);
  if (!filePath) return null;

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedModelCache<unknown>>;
    if (
      typeof parsed.savedAt !== 'number' ||
      !Number.isFinite(parsed.savedAt) ||
      !Array.isArray(parsed.models) ||
      !parsed.models.every(isModelLike)
    ) {
      return null;
    }
    return { savedAt: parsed.savedAt, models: parsed.models as T[] };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.debug('Failed to read persisted provider model cache', {
        providerId,
        error: (error as Error).message,
      });
    }
    return null;
  }
}

export async function writePersistedProviderModels<T extends ModelLike>(
  providerId: string,
  models: T[],
): Promise<void> {
  const filePath = getCacheFilePath(providerId);
  if (!filePath) return;

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const payload: PersistedModelCache<T> = { savedAt: Date.now(), models };
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload), 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    logger.debug('Failed to persist provider model cache', {
      providerId,
      error: (error as Error).message,
    });
  }
}

const DEFAULT_MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = 'models';

export interface ProviderModelCacheOptions<T extends ModelLike> {
  providerId: string;
  /** Staleness threshold for the cached model list. Default: 5 minutes. */
  ttlMs?: number;
  /** Live probe. Returns the fetched models, or null on failure. */
  fetch: () => Promise<T[] | null>;
}

export interface ProviderModelCache<T extends ModelLike> {
  /**
   * Hydrate from disk when the in-memory entry is absent (never hydrated, or
   * cleared via the unified cache's clear/clearAllCaches). No-op while an
   * entry exists. Never probes live.
   */
  hydrateFromDisk(): Promise<void>;
  /**
   * Stale-while-revalidate accessor: returns cached models immediately
   * (kicking off a background refresh when stale), otherwise awaits a refresh.
   */
  get(): Promise<T[] | null>;
  /** Runs the live probe; on success updates the cache and persists to disk. Deduped in-flight. */
  refresh(): Promise<T[] | null>;
  /** Synchronous peek at the currently cached models, if any. */
  peek(): T[] | null;
}

/**
 * Shared stale-while-revalidate cache for provider model lists, backed by the
 * unified main-process cache (in-memory) and the persisted JSON layer above.
 *
 * Entries are stored as `{ models, savedAt }` WITHOUT an entry TTL: the
 * unified cache drops expired entries on `get()`, but stale-while-revalidate
 * requires reading stale models while a refresh runs, so staleness is
 * computed from `savedAt` against `ttlMs` instead.
 */
export function createProviderModelCache<T extends ModelLike>(
  options: ProviderModelCacheOptions<T>,
): ProviderModelCache<T> {
  const { providerId, ttlMs = DEFAULT_MODEL_CACHE_TTL_MS, fetch } = options;
  const memory = createCache<string, ProviderModelCacheEntry<T>>({
    name: `provider-models:${providerId}`,
  });
  // Hydration is content-based rather than a sticky "hydrated once" flag, so
  // that a cleared cache (e.g. clearAllCaches under memory pressure) re-reads
  // the persisted file instead of falling through to a live probe.
  // `diskMayHaveData` bounds the disk reads: it flips to false when a hydrate
  // finds nothing persisted (avoiding an ENOENT read on every get()), and back
  // to true after a successful refresh persists fresh data. Tradeoff: if a
  // file appears on disk out-of-band while this flag is false, it is ignored
  // until the next successful refresh — acceptable since this process is the
  // only writer.
  let diskMayHaveData = true;
  let hydratePromise: Promise<void> | null = null;
  let refreshPromise: Promise<T[] | null> | null = null;

  function hydrateFromDisk(): Promise<void> {
    if (memory.has(CACHE_KEY) || !diskMayHaveData) return Promise.resolve();
    hydratePromise ??= (async () => {
      const persisted = await readPersistedProviderModels<T>(providerId);
      if (!persisted) {
        diskMayHaveData = false;
        return;
      }
      memory.set(CACHE_KEY, persisted);
      logger.info('Hydrated persisted provider model cache', {
        providerId,
        count: persisted.models.length,
      });
    })().finally(() => {
      hydratePromise = null;
    });
    return hydratePromise;
  }

  function refresh(): Promise<T[] | null> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const models = await fetch();
      if (models) {
        memory.set(CACHE_KEY, { savedAt: Date.now(), models });
        diskMayHaveData = true;
        void writePersistedProviderModels(providerId, models);
      }
      return models;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function get(): Promise<T[] | null> {
    await hydrateFromDisk();
    const entry = memory.get(CACHE_KEY);
    if (entry) {
      if (Date.now() - entry.savedAt >= ttlMs) {
        void refresh();
      }
      return entry.models;
    }
    return refresh();
  }

  function peek(): T[] | null {
    return memory.get(CACHE_KEY)?.models ?? null;
  }

  return { hydrateFromDisk, get, refresh, peek };
}