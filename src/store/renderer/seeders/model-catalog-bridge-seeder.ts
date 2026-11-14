/**
 * Model catalog bridge — routes the shared `providers:get-models` channel to
 * the daemon's per-provider model catalog (`models.list { providerId,
 * forceRefresh }`, PROTOCOL §6.7) for daemon/web builds where no Electron
 * main process serves it. Any provider id is forwarded, so a new provider
 * needs no wiring here (intent-hq/intent#9253).
 *
 * The daemon owns probing, parsing, version-keyed persisted caching, and
 * stale/fallback labeling for every provider, so this bridge is a uniform
 * thin call — the exact daemon-build counterpart of the Electron main-process
 * handler (which calls the same RPC via `daemon-model-catalog.ts`).
 *
 * Envelope semantics: the shared `toGetModelsEnvelope` builder (also used by
 * the Electron main-process handler) — `success: true` with `data` rows plus
 * optional `warning` / `stale` / `warningKind` from the daemon; only a missing
 * provider id or a wire/transport failure produces `success: false`.
 * Probe/CLI failures never error — the daemon degrades them to last-good +
 * `stale: true` or a static/default fallback with a `warning`.
 *
 * The handler is registered at import time (host-bridge-seeder idiom).
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import {
  missingProviderEnvelope,
  toGetModelsEnvelope,
  toModelsListParams,
  type GetModelsEnvelope,
  type WireModelsListResult,
} from '$shared/models/wire-model-info';
import { backendRequest } from '$lib/client/live/backend-transport';

registerMockIpcHandler(
  PROVIDERS_CHANNELS.GET_MODELS,
  async (data?: unknown): Promise<GetModelsEnvelope> => {
    const request = toModelsListParams(data);
    if (!request) return missingProviderEnvelope(data);
    try {
      const result = await backendRequest<WireModelsListResult>('models.list', request);
      return toGetModelsEnvelope(result);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
);
