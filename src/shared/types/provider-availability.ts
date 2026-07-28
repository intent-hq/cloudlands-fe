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
  /**
   * User-facing warning about a degraded-but-detectable state (e.g. the
   * claude CLI is installed but npx is missing, so the ACP adapter cannot
   * run). Rendered in the provider status UI.
   */
  warning?: string;
  /** Whether this provider supports npx fallback when binary is unresolved. */
  hasNpxFallback?: boolean;
}

/**
 * npx availability status for provider fallback spawning
 */
export interface NpxStatus {
  /** Resolved absolute path to npx, when found. */
  resolvedPath: string | null;
  /** Version string from `npx --version`, when successfully probed. */
  version: string | null;
  /** Whether the version meets the minimum requirement (major >= 7). */
  versionOk: boolean;
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
    cortex: ProviderStatus;
    mock: ProviderStatus;
    opencode: ProviderStatus;
    pi: ProviderStatus;
    droid: ProviderStatus;
    grok: ProviderStatus;
    unsloth: ProviderStatus;
  };
  /** Provider IDs that are hidden because their required env var or feature code is not set */
  hiddenProviders: string[];
  /** npx availability status for npx-fallback providers */
  npx?: NpxStatus;
}

/**
 * Maps ProviderAvailabilityResult property keys (camelCase) to their
 * corresponding provider IDs used everywhere else in the app.
 *
 * Single source of truth — import this instead of hard-coding
 * the camelCase↔kebab-case translation in each call site.
 */
export const PROVIDER_AVAILABILITY_KEY_TO_ID: Record<string, string> = {
  auggie: 'auggie',
  claudeCode: 'claude-code',
  codex: 'codex',
  mock: 'mock',
  opencode: 'opencode',
  pi: 'pi',
  cortex: 'cortex',
  droid: 'droid',
  grok: 'grok',
  unsloth: 'unsloth',
};

/**
 * Given a ProviderAvailabilityResult-shaped providers map and an optional set
 * of hidden provider IDs, return the list of provider IDs that are both
 * available and not hidden.
 */
export function getAvailableIdsFromResult(
  providers: Record<string, { available: boolean }>,
  hiddenProviders: string[] = [],
): string[] {
  const hidden = new Set(hiddenProviders);
  const ids: string[] = [];
  for (const [key, providerId] of Object.entries(PROVIDER_AVAILABILITY_KEY_TO_ID)) {
    if (providers[key]?.available && !hidden.has(providerId)) {
      ids.push(providerId);
    }
  }
  return ids;
}
