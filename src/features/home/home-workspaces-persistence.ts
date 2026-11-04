import type { HomeFilter } from './home-model';

export interface HomeIntegrationViewConfiguration {
  query: string;
  filter: 'all' | 'assigned' | 'created' | 'review-requested';
  closed: boolean;
}
export interface HomeConfiguration {
  integrationViews: {
    prs: HomeIntegrationViewConfiguration;
    linear: HomeIntegrationViewConfiguration;
  };
  repoKey: string | null;
  filter: HomeFilter;
  tab: 'workspaces' | 'prs' | 'linear';
  query: string;
  updatedWithin: 'all' | 'day' | 'week' | 'month';
  view: 'list' | 'board';
  groupBy: 'status' | 'workspace-status' | 'repository' | 'none';
  expandedGroups: Record<string, boolean>;
  moreReposExpanded: boolean;
}
/**
 * A workspace the user set aside on Home. `known` is the attention the user
 * had already seen when settling it (or after it last cleared); only attention
 * outside it brings the workspace back. `null` until the watcher records it.
 */
export interface HomeSetAsideRecord {
  at: number;
  known: string[] | null;
  knownAt: number;
}
export interface HomePersistenceDocument {
  configuration: HomeConfiguration;
  /** Additive and omitted when empty, so older documents and readers are unchanged. */
  setAside?: Record<string, HomeSetAsideRecord>;
}
/** Bounded personal state; new set-asides are refused (not evicted) at capacity. */
export const HOME_SET_ASIDE_CAPACITY = 1000;
export const HOME_SET_ASIDE_KNOWN_CAPACITY = 64;
export function defaultHomeConfiguration(): HomeConfiguration {
  return {
    integrationViews: {
      prs: { query: '', filter: 'assigned', closed: false },
      linear: { query: '', filter: 'assigned', closed: false },
    },
    repoKey: null,
    filter: 'all',
    tab: 'workspaces',
    query: '',
    updatedWithin: 'all',
    view: 'list',
    groupBy: 'status',
    expandedGroups: {},
    moreReposExpanded: false,
  };
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function member<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && choices.includes(value as T) ? (value as T) : fallback;
}
function safeKey(key: string): boolean {
  return (
    key.length > 0 && key.length <= 512 && !['__proto__', 'constructor', 'prototype'].includes(key)
  );
}
function integrationView(value: unknown, kind: 'prs' | 'linear'): HomeIntegrationViewConfiguration {
  const raw = object(value);
  const filters: HomeIntegrationViewConfiguration['filter'][] =
    kind === 'prs'
      ? ['all', 'assigned', 'created', 'review-requested']
      : ['all', 'assigned', 'created'];
  return {
    query: typeof raw.query === 'string' ? raw.query.slice(0, 2000) : '',
    filter: member(raw.filter, filters, 'assigned'),
    closed: raw.closed === true,
  };
}
export function normalizeHomeConfiguration(value: unknown): HomeConfiguration {
  const raw = object(value),
    defaults = defaultHomeConfiguration();
  const expandedGroups: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(object(raw.expandedGroups)).slice(0, 500))
    if (safeKey(key) && typeof flag === 'boolean') expandedGroups[key] = flag;
  return {
    integrationViews: {
      prs: integrationView(object(raw.integrationViews).prs, 'prs'),
      linear: integrationView(object(raw.integrationViews).linear, 'linear'),
    },
    repoKey: typeof raw.repoKey === 'string' ? raw.repoKey.slice(0, 2000) : null,
    // The former Retired chip merged into Archived (PROTOCOL §5.1).
    filter: member(
      raw.filter === 'retired' ? 'archived' : raw.filter,
      ['all', 'attention', 'pr-ready', 'running', 'waiting', 'blocked', 'unread', 'archived'],
      defaults.filter,
    ),
    tab: member(raw.tab, ['workspaces', 'prs', 'linear'], defaults.tab),
    query: typeof raw.query === 'string' ? raw.query.slice(0, 2000) : '',
    updatedWithin: member(
      raw.updatedWithin,
      ['all', 'day', 'week', 'month'],
      defaults.updatedWithin,
    ),
    view: member(raw.view, ['list', 'board'], defaults.view),
    groupBy: member(
      raw.groupBy,
      ['status', 'workspace-status', 'repository', 'none'],
      defaults.groupBy,
    ),
    expandedGroups,
    moreReposExpanded: raw.moreReposExpanded === true,
  };
}
function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}
export function normalizeHomeSetAside(value: unknown): Record<string, HomeSetAsideRecord> {
  const records: Record<string, HomeSetAsideRecord> = {};
  let count = 0;
  for (const [id, entry] of Object.entries(object(value))) {
    if (count >= HOME_SET_ASIDE_CAPACITY) break;
    const raw = object(entry);
    const at = timestamp(raw.at);
    if (!safeKey(id) || at === null) continue;
    const known = Array.isArray(raw.known)
      ? [
          ...new Set(
            raw.known.filter(
              (token): token is string =>
                typeof token === 'string' && token.length > 0 && token.length <= 512,
            ),
          ),
        ].slice(0, HOME_SET_ASIDE_KNOWN_CAPACITY)
      : null;
    records[id] = { at, known, knownAt: timestamp(raw.knownAt) ?? at };
    count += 1;
  }
  return records;
}
export function homePersistenceKey(backendId: string, principalId: string): string {
  return `home-workspaces:${JSON.stringify([backendId, principalId])}`;
}
export function readHomePersistence(value: unknown): HomePersistenceDocument {
  const raw = object(value);
  if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2)
    return { configuration: defaultHomeConfiguration() };
  // Keep automatic settings from older scoped documents, ignoring retired
  // savedViews, activeSavedViewId and workspaceIds fields entirely.
  // Never import an unscoped key into a newly authenticated account.
  const configuration = normalizeHomeConfiguration(raw.configuration ?? raw.settings ?? raw);
  const setAside = normalizeHomeSetAside(raw.setAside);
  return Object.keys(setAside).length > 0 ? { configuration, setAside } : { configuration };
}
// Version 2 stays: older builds ignore the additive `setAside` field.
export function persistedHomeState<
  T extends HomeConfiguration & { setAside?: Record<string, HomeSetAsideRecord> },
>(state: T): HomePersistenceDocument & { version: 2 } {
  const configuration = normalizeHomeConfiguration(state);
  const setAside = normalizeHomeSetAside(state.setAside);
  return Object.keys(setAside).length > 0
    ? { version: 2, configuration, setAside }
    : { version: 2, configuration };
}
