/**
 * Droid IPC Handlers
 *
 * IPC handlers for Factory Droid CLI integration. Droid has no `models` CLI
 * subcommand — the live model list comes from the ACP session/new response
 * (see droid-acp-probe.ts).
 */

import { ipcMain } from 'electron';
import { DROID_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { probeDroidAcp } from './droid-acp-probe';
import { getDroidPath } from './droid-resolver';

const logger = new Logger('DroidIPC');

type DroidModel = {
  value: string;
  label: string;
  description?: string;
};

type DroidModelsFetch =
  | { status: 'ok'; models: DroidModel[] }
  | { status: 'not-installed' }
  | { status: 'auth-required'; error?: string }
  | { status: 'error'; error?: string };

// Model list cache — avoids re-running the ACP probe on every call.
let cachedDroidModels: DroidModel[] | null = null;
let droidModelCacheTimestamp = 0;
const DROID_MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Internal: fetch (or return cached) droid model list via the ACP probe.
 * Only successful probes with a non-empty model list are cached.
 */
async function fetchDroidModelsWithCache(): Promise<DroidModelsFetch> {
  const now = Date.now();
  if (cachedDroidModels && now - droidModelCacheTimestamp < DROID_MODEL_CACHE_TTL_MS) {
    logger.debug('Returning cached droid models', { count: cachedDroidModels.length });
    return { status: 'ok', models: cachedDroidModels };
  }

  const droidPath = await getDroidPath();
  if (!droidPath) {
    return { status: 'not-installed' };
  }

  logger.info('Getting models from droid via ACP probe', { droidPath });
  const probe = await probeDroidAcp(droidPath);
  if (!probe.ok) {
    if (probe.authRequired) {
      logger.info('Droid ACP probe reported auth required', { error: probe.error });
      return { status: 'auth-required', error: probe.error };
    }
    logger.warn('Droid ACP probe failed', { error: probe.error });
    return { status: 'error', error: probe.error };
  }

  const models: DroidModel[] = probe.models.map((m) => ({
    value: m.modelId,
    label: m.name,
    description: m.description,
  }));

  // Only cache non-empty lists so a transient empty response isn't served
  // for the full TTL — the next request re-probes instead.
  if (models.length > 0) {
    cachedDroidModels = models;
    droidModelCacheTimestamp = Date.now();
  }
  return { status: 'ok', models };
}

/**
 * Main-side accessor for the cached droid model list.
 *
 * Returns bare model value strings (the droid `modelId`s) or `null` when the
 * live list is unavailable (droid not installed, probe failed, auth required).
 * Shares the module-level 5-minute TTL cache with the IPC handler.
 */
export async function getCachedDroidModels(): Promise<string[] | null> {
  const result = await fetchDroidModelsWithCache();
  if (result.status !== 'ok') return null;
  return result.models.map((m) => m.value);
}

export function setupDroidIPC() {
  // Check if droid is available (installed)
  ipcMain.handle(DROID_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking droid availability');
      const droidPath = await getDroidPath();
      const isAvailable = droidPath !== null;
      logger.info('Droid availability check', { isAvailable, droidPath });
      return { success: true, available: isAvailable };
    } catch (error) {
      logger.info('Droid not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models from droid (live list from the ACP session/new response).
  // Caching lives in fetchDroidModelsWithCache() at module scope so the
  // main-side model-override validator can reuse the same cache.
  ipcMain.handle(DROID_CHANNELS.GET_MODELS, async () => {
    const result = await fetchDroidModelsWithCache();
    switch (result.status) {
      case 'ok': {
        if (result.models.length > 0) {
          logger.info(`Returning ${result.models.length} models from droid`, {
            modelValues: result.models.map((m) => m.value),
          });
          return { success: true, data: result.models };
        }
        logger.warn('Droid ACP probe returned no models');
        return { success: true, data: [], warning: 'No models found' };
      }
      case 'not-installed':
        return { success: true, data: [], warning: 'Droid not available' };
      case 'auth-required':
        return {
          success: true,
          data: [],
          warning: 'Droid login required — run `droid` in a terminal to sign in',
        };
      case 'error':
        return {
          success: false,
          error: result.error || 'Failed to query droid for models',
          data: [],
        };
    }
  });
}

