/**
 * Provider Models Client
 *
 * Single renderer-side client for every provider's `<provider>:get-models`
 * IPC channel. The main-process handlers (and the daemon-build mock-router
 * bridge in `model-catalog-bridge-seeder.ts`) are uniform thin calls to the
 * daemon's per-provider catalog (`models.list { providerId, forceRefresh }`,
 * PROTOCOL §6.7), so one client covers all seven providers.
 *
 * `forceRefresh: true` makes the daemon skip its cache read and await a fresh
 * probe — the returned promise resolves only when the probe completes, so
 * callers (the picker's per-group ↻ button) get honest spinner semantics.
 *
 * An empty `data` with a `warning` is an honest terminal state (e.g. cortex
 * feature-gated, droid not signed in) and resolves to `{ models: [], warning }`;
 * only `success: false` (daemon unreachable) or transport failure throws.
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { getProviderConfig } from '$shared/config/provider-config';

const logger = createLogger('ProviderModelsClient');

/** Model row shape shared by every provider's get-models envelope. */
export interface ProviderModelEntry {
  value: string;
  label: string;
  description?: string;
  modelGroupPriority?: number;
  costTier?: number;
  badges?: Array<{ color: string; label: string; variant?: string }>;
  effortLevels?: string[];
  isDefault?: boolean;
  priority?: number;
}

export interface ProviderModelsResult {
  models: ProviderModelEntry[];
  /** Daemon-provided reason for fallback/stale/empty data (PROTOCOL §6.7). */
  warning?: string;
  /** Present and `true` when the daemon served last-good data after a failed probe. */
  stale?: boolean;
}

interface GetModelsEnvelope {
  success: boolean;
  data?: ProviderModelEntry[];
  warning?: string;
  stale?: boolean;
  error?: string;
}

/**
 * The seven uniform `<provider>:get-models` channels. Recorded in
 * `DYNAMIC_INVOKE_CALL_SITES` (ipc-channel-reconciliation.test.ts) because the
 * concrete channel is selected at runtime.
 */
const PROVIDER_MODEL_CHANNELS: Record<string, string> = {
  auggie: 'auggie:get-models',
  'claude-code': 'claude-code:get-models',
  codex: 'codex:get-models',
  cortex: 'cortex:get-models',
  droid: 'droid:get-models',
  opencode: 'opencode:get-models',
  pi: 'pi:get-models',
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}

function toProviderError(providerId: string, message: string): Error {
  // Only prefix with the display name for known providers — getProviderConfig()
  // falls back to the default provider for unknown IDs, which would mislabel
  // the error with a different provider's name.
  const providerName =
    providerId in PROVIDER_MODEL_CHANNELS
      ? getProviderConfig(providerId).displayName || providerId
      : providerId;
  return new Error(
    message.startsWith(`${providerName}:`) ? message : `${providerName}: ${message}`,
  );
}

/**
 * Invoke a provider model IPC channel, preferring the real Electron bridge
 * (`window.electronAPI`) so the request reaches the live main-process handler.
 * Falls back to the mock-routed invoke when no real bridge is present
 * (daemon/web builds, unit tests) — there the channel is served by
 * `model-catalog-bridge-seeder.ts`.
 */
async function invokeModelChannel<T>(channel: string, data?: unknown): Promise<T> {
  if (typeof window !== 'undefined' && window.electronAPI?.invoke) {
    return (await window.electronAPI.invoke(channel, data)) as T;
  }
  return await invoke<T>(channel, data);
}

/**
 * Get available models for a provider from the daemon-owned catalog.
 */
export async function getProviderModels(
  providerId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<ProviderModelsResult> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping provider models fetch - not in browser environment', { providerId });
    return { models: [] };
  }

  const channel = PROVIDER_MODEL_CHANNELS[providerId];
  if (!channel) {
    throw toProviderError(providerId, `Unsupported model provider: ${providerId}`);
  }

  try {
    logger.debug('Getting models for provider', {
      providerId,
      forceRefresh: options.forceRefresh === true,
    });
    const result = await invokeModelChannel<GetModelsEnvelope>(
      channel,
      options.forceRefresh === true ? { forceRefresh: true } : undefined,
    );

    if (!result?.success) {
      throw toProviderError(
        providerId,
        result?.error || result?.warning || 'No response from model service',
      );
    }

    if (result.warning) {
      logger.warn('Provider models returned with warning', {
        providerId,
        warning: result.warning,
        stale: result.stale === true,
      });
    }

    const models = Array.isArray(result.data) ? result.data : [];
    const outcome: ProviderModelsResult = { models };
    if (result.warning) outcome.warning = result.warning;
    if (result.stale === true) outcome.stale = true;
    return outcome;
  } catch (error) {
    logger.warn('Failed to get provider models', { providerId, error });
    throw toProviderError(providerId, toErrorMessage(error));
  }
}
