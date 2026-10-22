import { describe, expect, it } from 'vitest';
import {
  homeIntegrationsReducer,
  mountHomeIntegrations,
  patchHomeIntegrations,
  searchHomeIntegrations,
} from './home-integrations-slice';

// Failure cases: mounting resets saved filters; changing kind leaks PR-only filters;
// old-account responses overwrite a fresh mount; restored search skips reset semantics.
describe('saved Home integration settings', () => {
  it('restores settings atomically at mount, rejects stale responses and keeps search reset behavior', () => {
    const initial = homeIntegrationsReducer(undefined, { type: 'init' });
    const prs = homeIntegrationsReducer(
      initial,
      mountHomeIntegrations(
        { kind: 'prs', repositories: [] },
        { query: 'review me', filter: 'review-requested', closed: true },
      ),
    );
    expect(prs).toMatchObject({
      query: 'review me',
      filter: 'review-requested',
      closed: true,
      status: 'loading',
      selectedId: null,
    });
    const linear = homeIntegrationsReducer(
      prs,
      mountHomeIntegrations(
        { kind: 'linear', repositories: [] },
        { query: 'bugs', filter: 'assigned', closed: false },
      ),
    );
    expect(linear).toMatchObject({ query: 'bugs', filter: 'assigned', closed: false, items: [] });
    expect(
      homeIntegrationsReducer(linear, patchHomeIntegrations(prs.generation, { query: 'stale' })),
    ).toBe(linear);
    const searched = homeIntegrationsReducer(
      linear,
      searchHomeIntegrations('new', 'created', false),
    );
    expect(searched).toMatchObject({
      query: 'new',
      filter: 'created',
      status: 'loading',
      generation: linear.generation + 1,
    });
    const invalid = homeIntegrationsReducer(
      searched,
      mountHomeIntegrations(
        { kind: 'linear', repositories: [] },
        { query: '', filter: 'review-requested', closed: false },
      ),
    );
    expect(invalid.filter).toBe('assigned');
  });
  it('keeps loaded rows for immediate query filtering, clears them for changed filters, and rejects stale results', () => {
    const initial = homeIntegrationsReducer(undefined, { type: 'init' });
    const mounted = homeIntegrationsReducer(
      initial,
      mountHomeIntegrations(
        { kind: 'prs', repositories: [] },
        { query: '', filter: 'all', closed: false },
      ),
    );
    const items = [
      { id: '1', title: 'Fix search', identifier: '#1', url: 'https://github.com/a/b/pull/1' },
    ];
    const loaded = homeIntegrationsReducer(
      mounted,
      patchHomeIntegrations(mounted.generation, { status: 'ready', items }),
    );
    const searching = homeIntegrationsReducer(
      loaded,
      searchHomeIntegrations('search', 'all', false),
    );
    expect(searching.items).toEqual(items);
    expect(searching.status).toBe('loading');
    expect(
      homeIntegrationsReducer(searching, patchHomeIntegrations(loaded.generation, { items: [] })),
    ).toBe(searching);
    expect(
      homeIntegrationsReducer(searching, searchHomeIntegrations('search', 'created', false)).items,
    ).toEqual([]);
    expect(
      homeIntegrationsReducer(searching, searchHomeIntegrations('search', 'all', true)).items,
    ).toEqual([]);
  });
});
