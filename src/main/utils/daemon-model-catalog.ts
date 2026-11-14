/**
 * Main-process accessor for the daemon's per-provider model catalog
 * (`models.list { providerId, forceRefresh }`, PROTOCOL §6.7).
 *
 * The daemon owns probing, parsing, caching (version-keyed, persisted in its
 * data dir, served indefinitely — it re-probes only on a cache miss, a
 * version-key change, or `forceRefresh`), and stale/fallback labeling for
 * every provider — the FE no
 * longer keeps its own model caches or probe implementations. This helper is
 * the single wire seam the shared `providers:get-models` IPC handler calls;
 * the reply is built by the shared `toGetModelsEnvelope` (also used by the
 * daemon/web bridge seeder).
 *
 * Backend policy: per-sender. Each call resolves the invoking window's
 * backend via `getBackendClientForIpcEvent(event)` and issues `models.list`
 * on that backend's pooled client — fail-closed (`success: false`) when the
 * window's backend has no live client; never silently retargets the primary.
 * Callers without an invoke event (main-side validation) resolve to local.
 */
import { Logger } from '../../shared/logger';
import {
  missingProviderEnvelope,
  toGetModelsEnvelope,
  toModelsListParams,
  type GetModelsEnvelope,
  type WireModelsListResult,
} from '../../shared/models/wire-model-info';
import { getBackendClientForIpcEvent } from '../../features/backend/main/backend.ipc';

const logger = new Logger('DaemonModelCatalog');

/**
 * `providers:get-models` handler body: thin call to the daemon catalog on the
 * invoking window's backend (local when `event` is absent — main-side
 * callers). A request without a provider id, a wire/transport failure, or a
 * window backend without a live pooled client produces `success: false`
 * (fail-closed, never retargets the primary) — probe/CLI failures are
 * degraded daemon-side to last-good/static data plus a `warning` (§6.7).
 */
export async function getProviderModelsEnvelope(
  params: unknown,
  event?: Electron.IpcMainInvokeEvent,
): Promise<GetModelsEnvelope> {
  const request = toModelsListParams(params);
  if (!request) return missingProviderEnvelope(params);
  try {
    const { client } = getBackendClientForIpcEvent(event);
    const result = await client.request<WireModelsListResult>('models.list', request);
    return toGetModelsEnvelope(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug('models.list request failed', { providerId: request.providerId, error: message });
    return { success: false, error: message };
  }
}
