/**
 * Main-process accessor for the daemon's per-provider model catalog
 * (`models.list { providerId, forceRefresh }`, PROTOCOL §6.7).
 *
 * The daemon owns probing, parsing, TTL caching (version-keyed, persisted in
 * its data dir), and stale/fallback labeling for every provider — the FE no
 * longer keeps its own model caches or probe implementations. This helper is
 * the single wire seam the per-provider `GET_MODELS` IPC handlers and the
 * main-side model-override validator (`model-pool.ts`) call into.
 */
import { Logger } from '../../shared/logger';
import {
  wireModelsToProviderModels,
  type ProviderModelInfo,
  type WireModelsListResult,
} from '../../shared/models/wire-model-info';
import { getBackendClient } from '../../features/backend/main/backend.ipc';

const logger = new Logger('DaemonModelCatalog');

export interface ProviderModelCatalog {
  models: ProviderModelInfo[];
  /** The provider id, or `"static"` on tier-table fallback. */
  source?: string;
  /** Present and `true` when the daemon served last-good data after a failed probe. */
  stale?: boolean;
  /** Human-readable reason for fallback/stale/empty data. */
  warning?: string;
}

/**
 * Fetch the daemon-resolved model catalog for one provider. Rejects with the
 * RPC error on wire/transport failure so callers can surface an honest error
 * state; probe/CLI failures never reject — the daemon degrades them to
 * last-good + `stale: true` or a static fallback with a `warning` (§6.7).
 */
export async function listProviderModels(
  providerId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<ProviderModelCatalog> {
  const params: { providerId: string; forceRefresh?: boolean } = { providerId };
  if (options.forceRefresh === true) {
    params.forceRefresh = true;
  }

  try {
    const result = await getBackendClient().request<WireModelsListResult>('models.list', params);
    const catalog: ProviderModelCatalog = {
      models: wireModelsToProviderModels(result),
    };
    if (typeof result?.source === 'string') catalog.source = result.source;
    if (result?.stale === true) catalog.stale = true;
    if (typeof result?.warning === 'string' && result.warning) catalog.warning = result.warning;
    return catalog;
  } catch (error) {
    logger.debug('models.list request failed', {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Envelope shared by every provider's `GET_MODELS` IPC handler. Mirrors the
 * historical per-provider shape (`success`/`data`/`warning`/`error`) plus the
 * daemon's `stale` flag so the renderer can label stale-served lists.
 */
export interface GetModelsEnvelope {
  success: boolean;
  data?: ProviderModelInfo[];
  warning?: string;
  stale?: boolean;
  error?: string;
}

/**
 * Uniform `GET_MODELS` handler body: thin call to the daemon catalog. Only a
 * wire/transport failure produces `success: false` — probe/CLI failures are
 * degraded daemon-side to last-good/static data plus a `warning` (§6.7).
 */
export async function getProviderModelsEnvelope(
  providerId: string,
  params?: { forceRefresh?: boolean },
): Promise<GetModelsEnvelope> {
  try {
    const catalog = await listProviderModels(providerId, {
      forceRefresh: params?.forceRefresh === true,
    });
    const envelope: GetModelsEnvelope = { success: true, data: catalog.models };
    if (catalog.warning) envelope.warning = catalog.warning;
    if (catalog.stale) envelope.stale = true;
    return envelope;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
