/**
 * Pure predicate deciding whether a provider card is visible in the
 * onboarding AgentGrid.
 *
 * Onboarding offers provider types only: a named profile reference
 * (`codex@<id>`, §5.54) never gets a card, even if a caller feeds one in.
 *
 * Two gates, both default-deny:
 *   1. Feature code — providers with `requiresFeatureCode` are hidden unless
 *      the feature code is activated.
 *   2. Env var — providers with `requiresEnvVar` are hidden unless the
 *      main-process availability check reports them `available === true`.
 *      The renderer never reads `process.env`; the main-side
 *      provider-availability service default-denies env-var-gated providers
 *      when the variable is unset and reports `available: true` when set
 *      (e.g. Mock (E2E) in E2E builds with `MOCK_AGENT_SCRIPT_PATH`).
 *
 * Inputs are plain values / callbacks so this stays a dependency-light pure
 * function suitable for unit testing.
 */
import { isProviderProfileRef } from '$shared/provider-profiles';

export interface IsOnboardingProviderVisibleInput {
  /** Gating fields from the provider's `ACPProviderConfig`. */
  provider: { id?: string; requiresEnvVar?: string; requiresFeatureCode?: string };
  /** Whether the given feature code is activated (from Redux state). */
  isFeatureEnabled: (featureCode: string) => boolean;
  /** Availability status reported for the provider; undefined = not checked yet. */
  status?: { available?: boolean };
}

export function isOnboardingProviderVisible(input: IsOnboardingProviderVisibleInput): boolean {
  const { provider, isFeatureEnabled, status } = input;
  if (provider.id !== undefined && isProviderProfileRef(provider.id)) return false;
  if (provider.requiresFeatureCode && !isFeatureEnabled(provider.requiresFeatureCode)) {
    return false;
  }
  if (provider.requiresEnvVar && status?.available !== true) {
    return false;
  }
  return true;
}
