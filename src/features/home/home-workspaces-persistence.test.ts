import { describe, expect, it } from 'vitest';
import {
  defaultHomeConfiguration,
  readHomePersistence,
  homePersistenceKey,
  normalizeHomeConfiguration,
  persistedHomeState,
} from './home-workspaces-persistence';

// Failure cases: backend/account leakage, invalid/future schemas, unsafe map keys,
// nonfinite or extreme coordinates/zoom, stale unread values, retired saved-view fields,
// and transient selection/blob URLs surviving reload. Tests precede implementation.
describe('durable Home configuration', () => {
  // Prevent a lost style after reload or an unsupported legacy value reaching the renderer.
  it.each(['sprites', 'wireframe'] as const)(
    'restores the %s city style through the persisted document',
    (cityRendering) => {
      const state = { ...defaultHomeConfiguration(), view: 'city' as const, cityRendering };
      const saved = JSON.parse(JSON.stringify(persistedHomeState(state)));
      expect(readHomePersistence(saved).configuration).toMatchObject({
        view: 'city',
        cityRendering,
      });
    },
  );
  it('defaults new, legacy, and invalid city styles to sprites', () => {
    expect(defaultHomeConfiguration().cityRendering).toBe('sprites');
    expect(
      readHomePersistence({ version: 1, settings: { view: 'city' } }).configuration,
    ).toMatchObject({ view: 'city', cityRendering: 'sprites' });
    for (const cityRendering of [undefined, null, 'unknown', '', 1, {}, ['wireframe']]) {
      expect(normalizeHomeConfiguration({ cityRendering }).cityRendering).toBe('sprites');
    }
  });
  it('uses unambiguous backend and principal namespaces', () => {
    expect(homePersistenceKey('remote', 'alice')).not.toBe(homePersistenceKey('remote', 'bob'));
    expect(homePersistenceKey('local', 'alice')).not.toBe(homePersistenceKey('remote', 'alice'));
    expect(homePersistenceKey('a:b', 'c')).not.toBe(homePersistenceKey('a', 'b:c'));
  });
  it('round-trips automatic settings without transient or retired fields', () => {
    const config = normalizeHomeConfiguration({
      view: 'canvas',
      query: 'review',
      repoKey: 'acme/app',
      filter: 'blocked',
      groupBy: 'repository',
      updatedWithin: 'week',
      canvasMetric: 'tokens',
      canvasGroupBy: 'organization',
      canvasZoom: 1.5,
      canvasPositions: { ws: { x: 32, y: 64 } },
      expandedGroups: { done: false },
    });
    const envelope = persistedHomeState({
      ...config,
      selectedId: 'private',
      canvasImages: { ws: 'blob:secret' },
      savedViews: [{ id: 'saved', name: 'Review', configuration: config }],
      activeSavedViewId: 'saved',
    });
    expect(JSON.stringify(envelope)).not.toContain('private');
    expect(JSON.stringify(envelope)).not.toContain('blob:');
    expect(readHomePersistence(envelope)).toEqual({
      configuration: config,
    });
    expect(envelope).not.toHaveProperty('savedViews');
    expect(envelope).not.toHaveProperty('activeSavedViewId');
  });
  it('migrates scoped legacy settings and validates every field', () => {
    const migrated = readHomePersistence({
      version: 1,
      settings: { view: 'board', filter: 'unread', query: 'old' },
    });
    expect(migrated.configuration).toMatchObject({ view: 'board', filter: 'unread', query: 'old' });
    expect(
      readHomePersistence({ version: 999, configuration: { query: 'future' } }).configuration,
    ).toEqual(defaultHomeConfiguration());
    expect(readHomePersistence(null).configuration).toEqual(defaultHomeConfiguration());
    const bad = normalizeHomeConfiguration({
      view: 'bogus',
      filter: 'bogus',
      query: 42,
      repoKey: [],
      groupBy: 'bogus',
      updatedWithin: 'year',
      canvasMetric: 'bogus',
      canvasGroupBy: 'bogus',
      canvasZoom: Infinity,
      canvasPositions: { bad: { x: NaN, y: 2 }, extreme: { x: 1e99, y: 2 } },
      expandedGroups: JSON.parse('{"__proto__":true,"done":"false","idle":false}'),
    });
    expect(bad).toEqual({ ...defaultHomeConfiguration(), expandedGroups: { idle: false } });
    expect(normalizeHomeConfiguration({ view: 'canvas' }).view).toBe('list');
  });
  it('ignores retired saved views and collections while retaining automatic settings', () => {
    const stored = readHomePersistence({
      version: 2,
      configuration: { query: 'x'.repeat(3000), workspaceIds: ['old'] },
      savedViews: [{ id: 'old', name: 'Old', configuration: { view: 'board' } }],
      activeSavedViewId: 'old',
    });
    expect(stored).not.toHaveProperty('savedViews');
    expect(stored).not.toHaveProperty('activeSavedViewId');
    expect(stored.configuration).not.toHaveProperty('workspaceIds');
    expect(stored.configuration.query.length).toBe(2000);
    expect(stored.configuration.view).toBe('list');
  });
});

// Unsupported integration filters must not survive reload.
it('normalizes separate integration scopes', () => {
  const config = normalizeHomeConfiguration({
    workspaceIds: ['one', 'one', '', null, 'two'],
    integrationViews: {
      prs: { query: 'review', filter: 'review-requested', closed: true },
      linear: { query: 'bugs', filter: 'review-requested', closed: 'yes' },
    },
  });
  expect(config.integrationViews).toEqual({
    prs: { query: 'review', filter: 'review-requested', closed: true },
    linear: { query: 'bugs', filter: 'assigned', closed: false },
  });
});
