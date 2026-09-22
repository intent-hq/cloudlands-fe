/**
 * Pure helpers for ordering Add-context picker providers for display.
 *
 * Dependency-light by design — no stores, services, or side effects beyond
 * side effects.
 */

import type { ContextSource } from '$store/renderer/slices/issue-suggestions/issue-suggestions-types';

export type ContextSourceProvider = 'github' | 'linear' | 'sentry';

/** Alphabetical baseline order of providers. */
const ALL_PROVIDERS: readonly ContextSourceProvider[] = ['github', 'linear', 'sentry'];

/** Sources per provider; GitHub's two sources stay adjacent, Issues before PRs. */
const PROVIDER_SOURCES: Record<ContextSourceProvider, readonly ContextSource[]> = {
  github: ['github-issues', 'github-prs'],
  linear: ['linear'],
  sentry: ['sentry'],
};

export interface ProviderConnectionState {
  github: boolean;
  linear: boolean;
  sentry: boolean;
}

function providerOfSource(source: ContextSource): ContextSourceProvider {
  return source === 'github-issues' || source === 'github-prs' ? 'github' : source;
}

/**
 * Order providers by: last-used first (only if connected), then connected
 * before unconnected, alphabetical within each group.
 */
export function orderProviders(
  connected: ProviderConnectionState,
  lastUsedSource: ContextSource | null,
): ContextSourceProvider[] {
  const lastProvider = lastUsedSource ? providerOfSource(lastUsedSource) : null;
  const rank = (provider: ContextSourceProvider): number => {
    if (provider === lastProvider && connected[provider]) return 0;
    return connected[provider] ? 1 : 2;
  };
  // Array.prototype.sort is stable, so alphabetical order holds within groups.
  return [...ALL_PROVIDERS].sort((a, b) => rank(a) - rank(b));
}

/** Expand the provider order into the flat source-tab order. */
export function orderSources(
  connected: ProviderConnectionState,
  lastUsedSource: ContextSource | null,
): ContextSource[] {
  return orderProviders(connected, lastUsedSource).flatMap((p) => [...PROVIDER_SOURCES[p]]);
}

/**
 * Resolve which source should be active given current auth state:
 * - the persisted last-used source, when its provider is connected
 * - the persisted last-used source, while nothing is connected yet — with no
 *   provider connected every pane is a connect prompt, so we show the prompt
 *   for the provider the user actually uses (e.g. after a token expires)
 *   rather than the first tab in the bar. This intentionally diverges from
 *   the fresh-install default (first tab active), which only applies when no
 *   last-used preference exists.
 * - otherwise the first source in the computed provider order ('linear' as a
 *   final safety net)
 */
export function resolveActiveSource(
  connected: ProviderConnectionState,
  lastUsedSource: ContextSource | null,
): ContextSource {
  if (lastUsedSource && connected[providerOfSource(lastUsedSource)]) return lastUsedSource;
  const anyConnected = ALL_PROVIDERS.some((p) => connected[p]);
  if (lastUsedSource && !anyConnected) return lastUsedSource;
  return orderSources(connected, lastUsedSource)[0] ?? 'linear';
}
