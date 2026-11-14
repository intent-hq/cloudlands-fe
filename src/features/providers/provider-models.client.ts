/**
 * Provider Models Client
 *
 * Single renderer-side client for the shared `providers:get-models` IPC
 * channel. The main-process handler (and the daemon-build mock-router bridge
 * in `model-catalog-bridge-seeder.ts`) is a thin call to the daemon's
 * per-provider catalog (`models.list { providerId, forceRefresh }`, PROTOCOL
 * §6.7) that takes the provider id, so a new provider needs no wiring here
 * (intent-hq/intent#9253).
 *
 * `forceRefresh: true` makes the daemon skip its cache read and await a fresh
 * probe — the returned promise resolves only when the probe completes, so
 * callers (the picker's per-group ↻ button) get honest spinner semantics.
 * Since the daemon serves its cached catalog indefinitely (re-probing only on
 * a cache miss or an adapter version-key change), this is the only
 * client-driven way to re-probe a cached provider.
 *
 * An empty `data` with a `warning` is an honest terminal state (e.g. droid
 * not signed in) and resolves to `{ models: [], warning }`;
 * only `success: false` (daemon unreachable) or transport failure throws.
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import { selectProviderDisplayName } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { isProviderProfileRef, providerRefBaseId } from '$shared/provider-profiles';
import type {
  GetModelsEnvelope,
  GetModelsParams,
  ProviderModelInfo,
} from '$shared/models/wire-model-info';

const logger = createLogger('ProviderModelsClient');

/** Model row shape shared by every provider's get-models envelope. */
export type ProviderModelEntry = ProviderModelInfo;

/**
 * The reply's optional labels (`warning`, `stale`, `warningKind`, …) exactly
 * as the shared `toGetModelsEnvelope` builder set them, plus the model rows —
 * derived from `GetModelsEnvelope` so a new label reaches callers without a
 * client-side copy.
 */
export type ProviderModelsResult = Omit<GetModelsEnvelope, 'success' | 'data' | 'error'> & {
  models: ProviderModelEntry[];
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return m.providers_modelsClient_unknown_error();
}

function toProviderError(providerId: string, message: string): Error {
  // An id the catalog does not know reads as itself.
  const providerName = selectProviderDisplayName.select(appStore.state, providerId) || providerId;
  return new Error(
    message.startsWith(`${providerName}:`) ? message : `${providerName}: ${message}`,
  );
}

/**
 * Invoke the model IPC channel, preferring the real Electron bridge
 * (`window.electronAPI`) so the request reaches the live main-process handler.
 * Falls back to the mock-routed invoke when no real bridge is present
 * (daemon/web builds, unit tests) — there the channel is served by
 * `model-catalog-bridge-seeder.ts`. The dev browser mock also installs a
 * `window.electronAPI` (answering `providers:get-models` with an empty catalog), so
 * the platform detector — not bridge presence — decides the transport.
 */
async function invokeModelChannel<T>(channel: string, data?: unknown): Promise<T> {
  if (isElectronPlatform() && window.electronAPI?.invoke) {
    return (await window.electronAPI.invoke(channel, data)) as T;
  }
  return await invoke<T>(channel, data);
}

/**
 * Get available models for a provider from the daemon-owned catalog.
 */
export async function getProviderModels(
  providerId: string,
  options: { forceRefresh?: boolean; workspaceId?: string } = {},
): Promise<ProviderModelsResult> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping provider models fetch - not in browser environment', { providerId });
    return { models: [] };
  }

  // A named profile (§5.54) is listed under its own reference.
  const params: GetModelsParams = { providerId: providerRefBaseId(providerId) };
  if (isProviderProfileRef(providerId)) params.providerRef = providerId;
  if (options.forceRefresh === true) params.forceRefresh = true;
  if (options.workspaceId) params.workspaceId = options.workspaceId;

  try {
    logger.debug('Getting models for provider', {
      providerId,
      forceRefresh: options.forceRefresh === true,
    });
    const result = await invokeModelChannel<GetModelsEnvelope>(
      PROVIDERS_CHANNELS.GET_MODELS,
      params,
    );

    if (!result?.success) {
      throw toProviderError(
        providerId,
        result?.error || result?.warning || m.providers_modelsClient_noResponse_error(),
      );
    }

    if (result.warning) {
      logger.warn('Provider models returned with warning', {
        providerId,
        warning: result.warning,
        stale: result.stale === true,
      });
    }

    const { success: _success, data, error: _error, ...labels } = result;
    return { ...labels, models: Array.isArray(data) ? data : [] };
  } catch (error) {
    logger.warn('Failed to get provider models', { providerId, error });
    throw toProviderError(providerId, toErrorMessage(error));
  }
}
