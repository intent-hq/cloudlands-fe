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
  };
  /** Provider IDs that are hidden because their required env var or feature code is not set */
  hiddenProviders: string[];
  /** npx availability status for npx-fallback providers */
  npx?: NpxStatus;
}
