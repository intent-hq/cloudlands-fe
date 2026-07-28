/**
 * Pure helper ordering onboarding provider cards into three tiers while
 * preserving the caller-supplied (mount-time shuffled) order within each
 * tier:
 *
 *   1. Immediately usable — `available === true` and `authenticated === true`.
 *   2. Installed but not logged in — `available === true` and
 *      `authenticated !== true` (logged out or auth unknown).
 *   3. Not detected — `available !== true`, or no status received yet.
 *
 * Tiers are computed from the last-known status only. In-flight refresh
 * flags are deliberately not an input: the agent-availability slice keeps
 * the previous status in `providerStatusMap` while a background re-check
 * runs, so a tier-1 provider stays tier 1 until a fresh status actually
 * reports it not-installed or logged-out (sticky tiers, no demotion
 * mid-probe).
 *
 * Inputs are plain values so this stays a dependency-light pure function
 * suitable for unit testing.
 */
export interface OnboardingProviderTierStatus {
  available?: boolean;
  /** Tri-state auth verdict: true / false / undefined (unknown). */
  authenticated?: boolean;
}

/** Tier rank for a provider given its last-known status (1 = first). */
export function getOnboardingProviderTier(
  status: OnboardingProviderTierStatus | undefined,
): 1 | 2 | 3 {
  if (status?.available !== true) return 3;
  return status.authenticated === true ? 1 : 2;
}

/**
 * Stable-partition `providers` by tier rank. Within each tier the input
 * order is preserved, so the per-mount shuffle survives status updates.
 */
export function orderOnboardingProviders<T extends { id: string }>(
  providers: readonly T[],
  statusMap: Record<string, OnboardingProviderTierStatus | undefined>,
): T[] {
  const tiers: [T[], T[], T[]] = [[], [], []];
  for (const provider of providers) {
    tiers[getOnboardingProviderTier(statusMap[provider.id]) - 1].push(provider);
  }
  return tiers.flat();
}
