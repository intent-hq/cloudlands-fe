import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE transport: same seam replacement as hud-subscription.test.ts so store
// init never dials a real daemon. The REAL configured store is exercised.
vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

// Neutralize the daemon-health middleware's own 10s system.status poll (same
// rationale as hud-subscription.test.ts — deterministic wire traffic).
vi.mock('$store/renderer/middlewares/daemon-health-service', () => ({
  createDaemonHealthMiddleware:
    () => () => (next: (action: unknown) => unknown) => (action: unknown) =>
      next(action),
  disposeDaemonHealthService: () => {},
}));

import { store as appStore } from '$store/renderer/store';
import {
  hudActivated,
  hudDeactivated,
  hudGridFilterRepoPicked,
  hudGridFilterStateToggled,
} from '$store/renderer/slices/hud/hud-slice';
import { EMPTY_HUD_GRID_FILTER } from '$store/renderer/slices/hud/hud-types';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { LOCAL_CONNECTION_ID, type ConnectionRecord } from '$shared/types/connections';
import {
  HUD_GRID_FILTER_STORAGE_KEY,
  sanitizePersistedHudGridFilter,
  startHudGridFilterPersistence,
} from './hud-grid-filter-persistence';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** In-memory backing for the test-setup localStorage vi.fn() stubs. */
const storage = new Map<string, string>();

const LOCAL: ConnectionRecord = {
  id: LOCAL_CONNECTION_ID,
  label: 'This machine (local)',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
};

function remote(id: string): ConnectionRecord {
  return { id, label: id, host: '10.0.0.5', port: 4443, fingerprint: 'AA:BB', isLocal: false };
}

/** Dispatch a connections:list result binding this window to `backendId`. */
function receiveConnections(backendId: string): void {
  appStore.dispatch(
    connectionsListReceived({
      connections: [LOCAL, remote('remote-1'), remote('remote-2')],
      activeId: backendId,
      windowBackendId: backendId,
    }),
  );
}

const remoteKey = (id: string) => `backend:${id}:${HUD_GRID_FILTER_STORAGE_KEY}`;
const gridFilter = () => appStore.state.hud.gridFilter;

describe('hud-grid-filter-persistence (real store)', () => {
  let stop: (() => void) | undefined;

  beforeAll(() => appStore.init());
  beforeEach(() => {
    storage.clear();
    vi.mocked(window.localStorage.getItem).mockImplementation(
      (key: string) => storage.get(key) ?? null,
    );
    vi.mocked(window.localStorage.setItem).mockImplementation((key: string, value: string) => {
      storage.set(key, String(value));
    });
    appStore.dispatch(hudActivated());
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    appStore.dispatch(hudDeactivated());
  });

  // NOTE: must run FIRST in this file — `hasReceivedList` latches true on the
  // shared store once any test dispatches connectionsListReceived.
  it('defers hydration until the connections list arrives (id can post-date HUD mount)', async () => {
    storage.set(remoteKey('remote-1'), JSON.stringify({ repo: 'intent-hq/intentd', states: [] }));
    stop = startHudGridFilterPersistence();
    await flush();

    // No backend id yet: nothing hydrated, and changes are NOT persisted.
    expect(gridFilter()).toEqual(EMPTY_HUD_GRID_FILTER);
    appStore.dispatch(hudGridFilterRepoPicked('pre-hydration/pick'));
    await flush();
    expect(storage.get(remoteKey('remote-1'))).toBe(
      JSON.stringify({ repo: 'intent-hq/intentd', states: [] }),
    );

    // List arrives → the persisted filter for the active backend is restored.
    receiveConnections('remote-1');
    await flush();
    expect(gridFilter()).toEqual({ repo: 'intent-hq/intentd', states: [] });
  });

  it('persists filter changes under the active backend id', async () => {
    receiveConnections('remote-1');
    stop = startHudGridFilterPersistence();
    await flush();

    appStore.dispatch(hudGridFilterRepoPicked('intent-hq/monorepo'));
    appStore.dispatch(hudGridFilterStateToggled('failed'));
    await flush();

    expect(JSON.parse(storage.get(remoteKey('remote-1'))!)).toEqual({
      repo: 'intent-hq/monorepo',
      states: ['failed'],
    });
  });

  it('isolates filters per backend id — a different backend gets its own default', async () => {
    storage.set(remoteKey('remote-1'), JSON.stringify({ repo: 'r1/repo', states: ['wait'] }));
    receiveConnections('remote-2');
    stop = startHudGridFilterPersistence();
    await flush();

    // remote-2 has nothing persisted → default filter.
    expect(gridFilter()).toEqual(EMPTY_HUD_GRID_FILTER);

    // Changes land under remote-2's key; remote-1's stays untouched.
    appStore.dispatch(hudGridFilterStateToggled('blocked'));
    await flush();
    expect(JSON.parse(storage.get(remoteKey('remote-2'))!)).toEqual({
      repo: null,
      states: ['blocked'],
    });
    expect(storage.get(remoteKey('remote-1'))).toBe(
      JSON.stringify({ repo: 'r1/repo', states: ['wait'] }),
    );
  });

  it('skips the write when the active backend id changed after hydration (stale-id insurance)', async () => {
    // A backend switch destroys/recreates the HUD window, so the id should
    // never change within one start — this is the defensive skip for the case
    // where that invariant ever breaks (e.g. windows surviving a switch).
    storage.set(remoteKey('remote-1'), JSON.stringify({ repo: 'r1/repo', states: [] }));
    receiveConnections('remote-1');
    stop = startHudGridFilterPersistence();
    await flush();
    expect(gridFilter()).toEqual({ repo: 'r1/repo', states: [] });

    // Active id flips to remote-2 without a restart of the persistence loop.
    receiveConnections('remote-2');
    appStore.dispatch(hudGridFilterStateToggled('failed'));
    await flush();

    // Neither the hydrated backend's key nor the new backend's key was written.
    expect(storage.get(remoteKey('remote-1'))).toBe(
      JSON.stringify({ repo: 'r1/repo', states: [] }),
    );
    expect(storage.has(remoteKey('remote-2'))).toBe(false);
  });

  it('the local backend uses the bare (un-namespaced) key', async () => {
    storage.set(HUD_GRID_FILTER_STORAGE_KEY, JSON.stringify({ repo: 'local/repo', states: [] }));
    receiveConnections(LOCAL_CONNECTION_ID);
    stop = startHudGridFilterPersistence();
    await flush();

    expect(gridFilter()).toEqual({ repo: 'local/repo', states: [] });
    appStore.dispatch(hudGridFilterStateToggled('complete'));
    await flush();
    expect(JSON.parse(storage.get(HUD_GRID_FILTER_STORAGE_KEY)!)).toEqual({
      repo: 'local/repo',
      states: ['complete'],
    });
  });

  it('falls back to the empty filter on malformed JSON', async () => {
    storage.set(HUD_GRID_FILTER_STORAGE_KEY, '{not json');
    receiveConnections(LOCAL_CONNECTION_ID);
    stop = startHudGridFilterPersistence();
    await flush();
    expect(gridFilter()).toEqual(EMPTY_HUD_GRID_FILTER);
  });

  it('drops unknown status keys from a persisted filter (keeps the known ones)', async () => {
    storage.set(
      HUD_GRID_FILTER_STORAGE_KEY,
      JSON.stringify({ repo: 'a/b', states: ['failed', 'bogus-key', 'wait'] }),
    );
    receiveConnections(LOCAL_CONNECTION_ID);
    stop = startHudGridFilterPersistence();
    await flush();
    expect(gridFilter()).toEqual({ repo: 'a/b', states: ['failed', 'wait'] });
  });

  it('stopping before hudDeactivated leaves the last persisted value intact', async () => {
    receiveConnections(LOCAL_CONNECTION_ID);
    stop = startHudGridFilterPersistence();
    await flush();
    appStore.dispatch(hudGridFilterRepoPicked('kept/repo'));
    await flush();

    stop();
    stop = undefined;
    appStore.dispatch(hudDeactivated());
    await flush();
    expect(JSON.parse(storage.get(HUD_GRID_FILTER_STORAGE_KEY)!)).toEqual({
      repo: 'kept/repo',
      states: [],
    });
  });
});

describe('sanitizePersistedHudGridFilter', () => {
  it.each([
    ['null', null],
    ['array', ['failed']],
    ['string', 'repo'],
    ['repo wrong type', { repo: 7, states: [] }],
    ['states not an array', { repo: null, states: 'failed' }],
  ])('falls back to EMPTY on %s', (_label, value) => {
    expect(sanitizePersistedHudGridFilter(value)).toEqual(EMPTY_HUD_GRID_FILTER);
  });

  it('keeps known keys, drops unknown ones, collapses duplicates, empties blank repo', () => {
    expect(
      sanitizePersistedHudGridFilter({ repo: '', states: ['wait', 'nope', 'wait', 'failed'] }),
    ).toEqual({ repo: null, states: ['wait', 'failed'] });
  });
});
