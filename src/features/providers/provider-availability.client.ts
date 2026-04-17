/**
 * Provider Availability Client
 *
 * Client-side functions for checking which ACP providers are available.
 * Calls the main process via IPC to check provider installations.
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';

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

    // Auto-fix active provider if it's hidden (env var gate)
    if (cachedResult.hiddenProviders && cachedResult.hiddenProviders.length > 0) {
      try {
        const { ACP_PROVIDERS } = await import('$shared/config/provider-config');
        const visibleIds = Object.keys(ACP_PROVIDERS).filter(
          (id) => !cachedResult!.hiddenProviders!.includes(id),
        );
        const { getReduxDispatch } = await import('$lib/store/redux-dispatch-bridge');
        const { validateActiveProvider } =
          await import('$lib/store/slices/provider-settings/provider-settings-slice');
        getReduxDispatch()(validateActiveProvider(visibleIds));
      } catch (e) {
        // Non-critical — store validation is best-effort
        logger.debug('Failed to validate active provider against hidden providers', { error: e });
      }
    }

    logger.debug('Provider availability fetched', {
      hasAnyProvider: cachedResult.hasAnyProvider,
      auggie: cachedResult.providers.auggie.available,
      claudeCode: cachedResult.providers.claudeCode.available,
      codex: cachedResult.providers.codex.available,
      cortex: cachedResult.providers.cortex.available,
      mock: cachedResult.providers.mock?.available ?? false,
      opencode: cachedResult.providers.opencode.available,
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
  const available: string[] = [];

  if (result.providers.auggie.available) {
    available.push('auggie');
  }
  if (result.providers.claudeCode.available) {
    available.push('claude-code');
  }
  if (result.providers.codex.available) {
    available.push('codex');
  }
  if (result.providers.mock.available) {
    available.push('mock');
  }
  if (result.providers.opencode.available) {
    available.push('opencode');
  }
  if (result.providers.cortex.available) {
    available.push('cortex');
  }

  return available;
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
    },
    hiddenProviders: [],
  };
}
