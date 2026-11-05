/**
 * Pure helper ordering onboarding provider cards into three tiers:
 *
 *   1. Immediately usable — `available === true` and `authenticated === true`.
 *   2. Installed but not logged in — `available === true` and
 *      `authenticated !== true` (logged out or auth unknown).
 *   3. Not detected — `available !== true`, or no status received yet.
 *
 * Within each tier, Anthropic (Claude Code) comes first, then OpenAI
 * (Codex), then the remaining providers in catalog order.
 *
 * Tiers are computed from the last-known status only. In-flight refresh
 * flags are deliberately not an input: the agent-availability slice keeps
 * the previous status in `providerStatusMap` while a background re-check
 * runs, so a tier-1 provider stays tier 1 until a fresh status actually
 * reports it not-installed or logged-out (sticky tiers, no demotion
 * mid-probe).
 */
export interface OnboardingProviderTierStatus {
  available?: boolean;
  /** Tri-state auth verdict: true / false / undefined (unknown). */
  authenticated?: boolean;
}

const PRIORITY_PROVIDER_IDS: readonly string[] = ['claude-code', 'codex'];

/** Tier rank for a provider given its last-known status (1 = first). */
export function getOnboardingProviderTier(
  status: OnboardingProviderTierStatus | undefined,
): 1 | 2 | 3 {
  if (status?.available !== true) return 3;
  return status.authenticated === true ? 1 : 2;
}

function priorityRank(id: string): number {
  const index = PRIORITY_PROVIDER_IDS.indexOf(id);
  return index === -1 ? PRIORITY_PROVIDER_IDS.length : index;
}

/**
 * Order `providers` by tier, then by vendor priority. Ties keep the input
 * (catalog) order.
 */
export function orderOnboardingProviders<T extends { id: string }>(
  providers: readonly T[],
  statusMap: Record<string, OnboardingProviderTierStatus | undefined>,
): T[] {
  return providers
    .map((provider, index) => ({
      provider,
      index,
      tier: getOnboardingProviderTier(statusMap[provider.id]),
      priority: priorityRank(provider.id),
    }))
    .sort((a, b) => a.tier - b.tier || a.priority - b.priority || a.index - b.index)
    .map(({ provider }) => provider);
}
