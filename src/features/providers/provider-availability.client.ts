/**
 * Provider Availability Client
 *
 * Client-side functions for checking which ACP providers are available.
 * Calls the main process via IPC to check provider installations.
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { getAvailableIdsFromResult } from '$shared/types/provider-availability';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';

const logger = createLogger('ProviderAvailabilityClient');

/**
 * Status for an individual provider
 */
interface ProviderStatus {
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
    antigravity?: ProviderStatus;
  };
  /**
   * Provider IDs hidden by env-var / feature-code gating. Absent = gating
   * verdict unknown — consumers fall back to the catalog `visible` flag
   * (see the shared ProviderAvailabilityResult type).
   */
  hiddenProviders?: string[];
}

// In-flight request coalescing only — NOT a result cache. Concurrent callers
// share one IPC round-trip; once it settles the slot clears so the very next
// call always hits the daemon again. The daemon owns result caching (its own
// TTL + single-flight cache mirrors the auth-status pattern), so the renderer
// must never store — and therefore never resurface — a stale or degraded
// answer on its own.
let inFlight: Promise<ProviderAvailabilityResult> | null = null;

/**
 * Get aggregated availability status for all providers. Every call reaches
 * the daemon (via IPC) except when a call is already in flight, in which
 * case it is joined instead of firing a duplicate request.
 *
 * Throws when the daemon RPC fails, so callers get an honest "unknown"
 * signal instead of a silently fabricated all-unavailable result — never
 * cached, so the very next call retries against the daemon.
 */
export async function getProviderAvailability(): Promise<ProviderAvailabilityResult> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping provider availability check - not in browser environment');
    return getDefaultResult();
  }

  if (inFlight) {
    logger.debug('Joining in-flight provider availability request');
    return inFlight;
  }

  inFlight = (async () => {
    try {
      logger.debug('Checking provider availability via IPC');

      const result = await invoke<{
        success: boolean;
        data?: ProviderAvailabilityResult;
        error?: string;
      }>(PROVIDERS_CHANNELS.GET_AVAILABILITY);

      if (!result.success) {
        throw new Error(result.error || 'Failed to get provider availability');
      }

      const data = result.data ?? getDefaultResult();

      // Per decision D1(B), the active provider is never silently switched
      // based on availability — the agent-availability slice (populated
      // elsewhere from this same result) is the source of truth for
      // `selectIsActiveProviderAvailable` / `selectAvailableEnabledProviderIds`,
      // which the UI uses to surface a failure state instead.

      logger.debug('Provider availability fetched', {
        hasAnyProvider: data.hasAnyProvider,
        auggie: data.providers.auggie.available,
        claudeCode: data.providers.claudeCode.available,
        codex: data.providers.codex.available,
        cortex: data.providers.cortex.available,
        mock: data.providers.mock?.available ?? false,
        opencode: data.providers.opencode.available,
        droid: data.providers.droid?.available ?? false,
        grok: data.providers.grok?.available ?? false,
        unsloth: data.providers.unsloth?.available ?? false,
      });

      return data;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Get a list of available provider IDs
 */
export async function getAvailableProviderIds(): Promise<string[]> {
  const result = await getProviderAvailability();
  return getAvailableIdsFromResult(result.providers);
}

/**
 * Default result when IPC fails or in non-browser environment.
 * `hiddenProviders` is deliberately omitted: the gating verdict is unknown
 * here, and fabricating an empty list would read as "nothing hidden".
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
  };
}
