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
  groupBy: 'status' | 'repository' | 'none';
  expandedGroups: Record<string, boolean>;
  moreReposExpanded: boolean;
}
export interface HomePersistenceDocument {
  configuration: HomeConfiguration;
}
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
    filter: member(
      raw.filter,
      ['all', 'attention', 'running', 'blocked', 'unread', 'archived'],
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
    groupBy: member(raw.groupBy, ['status', 'repository', 'none'], defaults.groupBy),
    expandedGroups,
    moreReposExpanded: raw.moreReposExpanded === true,
  };
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
  return { configuration: normalizeHomeConfiguration(raw.configuration ?? raw.settings ?? raw) };
}
export function persistedHomeState<T extends HomeConfiguration>(
  state: T,
): HomePersistenceDocument & { version: 2 } {
  return { version: 2, configuration: normalizeHomeConfiguration(state) };
}
