/**
 * Pure helpers for the Add-context picker: persisting the last used context
 * source to localStorage and ordering providers for display.
 *
 * Dependency-light by design — no stores, services, or side effects beyond
 * guarded localStorage access.
 */

export type ContextSource = 'linear' | 'github-issues' | 'github-prs' | 'sentry';

export type ContextSourceProvider = 'github' | 'linear' | 'sentry';

export const LAST_SOURCE_STORAGE_KEY = 'context-picker:last-source';

const ALL_SOURCES: readonly ContextSource[] = [
  'linear',
  'github-issues',
  'github-prs',
  'sentry',
];

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

export function providerOfSource(source: ContextSource): ContextSourceProvider {
  return source === 'github-issues' || source === 'github-prs' ? 'github' : source;
}

export function isContextSource(value: unknown): value is ContextSource {
  return typeof value === 'string' && (ALL_SOURCES as readonly string[]).includes(value);
}

/** Load the persisted last-used source; null when missing, invalid, or unavailable. */
export function loadLastUsedSource(): ContextSource | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LAST_SOURCE_STORAGE_KEY);
    return isContextSource(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist the last-used source; silently no-ops when localStorage is unavailable. */
export function saveLastUsedSource(source: ContextSource): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LAST_SOURCE_STORAGE_KEY, source);
  } catch {
    // localStorage unavailable (e.g., disabled or non-browser environment)
  }
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
