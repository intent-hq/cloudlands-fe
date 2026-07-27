/**
 * Provider Availability Client
 *
 * Client-side functions for checking which ACP providers are available.
 * Calls the main process via IPC to check provider installations.
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { getAvailableIdsFromResult } from '$shared/config/provider-config';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { store as appStore } from '$store/renderer/store';

const logger = createLogger('ProviderAvailabilityClient');

/**
 * Status for an individual provider
 */
export interface ProviderStatus {
  available: boolean;
  /** Whether the user is authenticated with this provider. undefined = unknown/not checked. */
  authenticated?: boolean;
  /**
   * Human-readable auth detail extracted from the provider's CLI (e.g. the user's
   * email or username). Populated on a best-effort basis — may be undefined even
   * when `authenticated` is true if the CLI did not surface a recognisable identity.
   */
  authDetails?: string;
  error?: string;
}

/**
 * Aggregated provider availability result
 */
export interface ProviderAvailabilityResult {
  hasAnyProvider: boolean;
  providers: {
    auggie: ProviderStatus;
    claudeCode: ProviderStatus;
    codex: ProviderStatus;
    mock: ProviderStatus;
    opencode: ProviderStatus;
    cortex: ProviderStatus;
    pi: ProviderStatus;
    droid: ProviderStatus;
    grok: ProviderStatus;
    unsloth: ProviderStatus;
  };
  /** Provider IDs that are hidden because their required env var is not set */
  hiddenProviders?: string[];
}

// Cache for provider availability to avoid repeated IPC calls
let cachedResult: ProviderAvailabilityResult | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30000; // 30 seconds cache

/**
 * Get aggregated availability status for all providers
 * @param forceRefresh - If true, bypass the cache and fetch fresh data
 */
export async function getProviderAvailability(
  forceRefresh = false,
): Promise<ProviderAvailabilityResult> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping provider availability check - not in browser environment');
    return getDefaultResult();
  }

  // Return cached result if still valid
  const now = Date.now();
  if (!forceRefresh && cachedResult && now - cacheTimestamp < CACHE_TTL_MS) {
    logger.debug('Returning cached provider availability');
    return cachedResult;
  }

  try {
    logger.debug('Checking provider availability via IPC');

    const result = await invoke<{
      success: boolean;
      data?: ProviderAvailabilityResult;
      error?: string;
    }>(PROVIDERS_CHANNELS.GET_AVAILABILITY);

    if (!result.success) {
      logger.error('Failed to get provider availability', { error: result.error });
      return getDefaultResult();
    }

    // Update cache
    cachedResult = result.data || getDefaultResult();
    cacheTimestamp = now;

    // Validate the active provider against the set of available + visible providers.
    // Hidden providers (env var gate) are excluded so they cannot be selected as active.
    try {
      const availableIds = getAvailableIdsFromResult(
        cachedResult.providers,
        cachedResult.hiddenProviders ?? [],
      );

      const { validateActiveProvider } = await import(
        '$store/renderer/slices/provider-settings/provider-settings-slice'
      );
      appStore.dispatch(validateActiveProvider(availableIds));
    } catch (e) {
      // Non-critical — store validation is best-effort
      logger.debug('Failed to validate active provider against availability', { error: e });
    }

    logger.debug('Provider availability fetched', {
      hasAnyProvider: cachedResult.hasAnyProvider,
      auggie: cachedResult.providers.auggie.available,
      claudeCode: cachedResult.providers.claudeCode.available,
      codex: cachedResult.providers.codex.available,
      cortex: cachedResult.providers.cortex.available,
      mock: cachedResult.providers.mock?.available ?? false,
      opencode: cachedResult.providers.opencode.available,
      droid: cachedResult.providers.droid?.available ?? false,
      grok: cachedResult.providers.grok?.available ?? false,
      unsloth: cachedResult.providers.unsloth?.available ?? false,
    });

    return cachedResult;
  } catch (error) {
    logger.error('Error checking provider availability', { error });
    return getDefaultResult();
  }
}

/**
 * Get a list of available provider IDs
 */
export async function getAvailableProviderIds(forceRefresh = false): Promise<string[]> {
  const result = await getProviderAvailability(forceRefresh);
  return getAvailableIdsFromResult(result.providers);
}

/**
 * Clear the cached result (useful when user installs a new provider)
 */
export function clearProviderAvailabilityCache(): void {
  cachedResult = null;
  cacheTimestamp = 0;
  logger.debug('Provider availability cache cleared');
}

/**
 * Default result when IPC fails or in non-browser environment
 */
function getDefaultResult(): ProviderAvailabilityResult {
  return {
    hasAnyProvider: false,
    providers: {
      auggie: { available: false },
      claudeCode: { available: false },
      codex: { available: false },
      cortex: { available: false },
      mock: { available: false },
      opencode: { available: false },
      pi: { available: false },
      droid: { available: false },
      grok: { available: false },
      unsloth: { available: false },
    },
    hiddenProviders: [],
  };
}
