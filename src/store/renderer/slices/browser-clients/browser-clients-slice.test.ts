import { describe, expect, it, vi } from 'vitest';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

import type { BrowserTab, BrowserTabListing, LiveClient } from '$shared/types/browser-clients';
import type { StoreState } from '../../types';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  browserClientsReducer,
  browserTabClosed,
  browserTabUpserted,
  initialState,
  liveClientsReceived,
  ownClientIdReceived,
  workspaceBrowserClientReceived,
  workspaceBrowserTabsReceived,
} from './browser-clients-slice';
import {
  selectLiveClient,
  selectLiveClients,
  selectLiveClientsLoaded,
  selectOwnClientId,
  selectWorkspaceBrowserClient,
  selectWorkspaceBrowserTabs,
  selectWorkspaceBrowserTabsRevision,
} from './browser-clients-selectors';

/** PROTOCOL §5.17 `client.list` rows. */
const desk: LiveClient = {
  clientId: 'cli-desk',
  name: 'Intent Desktop',
  capabilities: { browserExec: true },
  hostname: 'dev-box',
  connections: 1,
  transports: ['uds'],
  connectedAt: '2026-09-07T00:00:00.000Z',
};
const laptop: LiveClient = {
  clientId: 'cli-laptop',
  name: 'Intent Desktop',
  capabilities: { browserExec: true },
  connections: 1,
  transports: ['ws'],
  connectedAt: '2026-09-07T00:00:02.000Z',
};

const tab = (tabId: string, extra: Partial<BrowserTab> = {}): BrowserTab => ({
  tabId,
  workspaceId: 'ws-1',
  hostClientId: 'cli-desk',
  url: `https://example.com/${tabId}`,
  visibility: 'visible',
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
  ...extra,
});

const asState = (browserClients: typeof initialState): StoreState =>
  ({ browserClients }) as unknown as StoreState;

describe('browserClientsReducer', () => {
  it('records the own clientId and the client.list snapshot', () => {
    let state = browserClientsReducer(initialState, ownClientIdReceived('cli-desk'));
    state = browserClientsReducer(state, liveClientsReceived([desk, laptop]));

    expect(selectOwnClientId.select(asState(state))).toBe('cli-desk');
    expect(selectLiveClientsLoaded.select(asState(state))).toBe(true);
    expect(selectLiveClients.select(asState(state))).toEqual([desk, laptop]);
    expect(selectLiveClient.select(asState(state), 'cli-laptop')).toEqual(laptop);
  });

  it('replaces the live client list on every read so disconnected clients drop out', () => {
    let state = browserClientsReducer(initialState, liveClientsReceived([desk, laptop]));
    state = browserClientsReducer(state, liveClientsReceived([desk]));

    expect(selectLiveClients.select(asState(state))).toEqual([desk]);
    expect(selectLiveClient.select(asState(state), 'cli-laptop')).toBeUndefined();
  });

  it('stores the per-workspace browser client verbatim, null until the first read', () => {
    expect(selectWorkspaceBrowserClient.select(asState(initialState), 'ws-1')).toBeNull();

    const pinned = {
      clientId: 'cli-desk',
      source: 'workspace' as const,
      resolved: { clientId: 'cli-desk' },
    };
    let state = browserClientsReducer(initialState, workspaceBrowserClientReceived('ws-1', pinned));
    expect(selectWorkspaceBrowserClient.select(asState(state), 'ws-1')).toEqual(pinned);
    expect(selectWorkspaceBrowserClient.select(asState(state), 'ws-2')).toBeNull();

    const cleared = { source: 'default' as const, resolved: null };
    state = browserClientsReducer(state, workspaceBrowserClientReceived('ws-1', cleared));
    expect(selectWorkspaceBrowserClient.select(asState(state), 'ws-1')).toEqual(cleared);
  });

  it('mirrors browser.listTabs rows and patches them from browser:tab-* events', () => {
    const listed: BrowserTabListing = {
      ...tab('tab-a'),
      hostConnected: true,
      hostName: 'Intent Desktop',
    };
    let state = browserClientsReducer(
      initialState,
      workspaceBrowserTabsReceived('ws-1', [listed], 0),
    );
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1')).toEqual([listed]);

    // tab-updated: the event row (no presence decoration) merges over the listing.
    const moved = tab('tab-a', {
      url: 'https://example.com/next',
      updatedAt: '2026-09-07T00:00:05.000Z',
    });
    state = browserClientsReducer(state, browserTabUpserted('ws-1', moved));
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1')).toEqual([
      { ...listed, ...moved },
    ]);

    // tab-opened: a new row appends.
    state = browserClientsReducer(state, browserTabUpserted('ws-1', tab('tab-b')));
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1').map((t) => t.tabId)).toEqual([
      'tab-a',
      'tab-b',
    ]);

    // tab-closed: the row is removed; an unknown tabId leaves the rows alone.
    const rowsBefore = selectWorkspaceBrowserTabs.select(asState(state), 'ws-1');
    state = browserClientsReducer(state, browserTabClosed('ws-1', 'tab-nope'));
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1')).toEqual(rowsBefore);
    state = browserClientsReducer(state, browserTabClosed('ws-1', 'tab-a'));
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1').map((t) => t.tabId)).toEqual([
      'tab-b',
    ]);
  });

  it('drops a browser.listTabs snapshot issued before a browser:tab-* patch landed', () => {
    const listed = (tabId: string): BrowserTabListing => ({ ...tab(tabId), hostConnected: true });
    let state = browserClientsReducer(
      initialState,
      workspaceBrowserTabsReceived('ws-1', [listed('tab-a'), listed('tab-b')], 0),
    );
    expect(selectWorkspaceBrowserTabsRevision.select(asState(state), 'ws-1')).toBe(0);

    // A closed event (even for a row not yet mirrored) and an opened event
    // each advance the revision the next read must be stamped with.
    const staleRead = selectWorkspaceBrowserTabsRevision.select(asState(state), 'ws-1');
    state = browserClientsReducer(state, browserTabClosed('ws-1', 'tab-a'));
    state = browserClientsReducer(state, browserTabClosed('ws-1', 'tab-not-mirrored'));
    state = browserClientsReducer(state, browserTabUpserted('ws-1', tab('tab-c')));
    const current = selectWorkspaceBrowserTabsRevision.select(asState(state), 'ws-1');
    expect(current).toBe(staleRead + 3);

    // The snapshot from the stale read would resurrect tab-a and lose tab-c.
    const patched = state;
    state = browserClientsReducer(
      state,
      workspaceBrowserTabsReceived('ws-1', [listed('tab-a'), listed('tab-b')], staleRead),
    );
    expect(state).toBe(patched);
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1').map((t) => t.tabId)).toEqual([
      'tab-b',
      'tab-c',
    ]);

    // A snapshot stamped with the current revision applies; it does not bump it.
    state = browserClientsReducer(
      state,
      workspaceBrowserTabsReceived('ws-1', [listed('tab-b'), listed('tab-c')], current),
    );
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1').map((t) => t.tabId)).toEqual([
      'tab-b',
      'tab-c',
    ]);
    expect(selectWorkspaceBrowserTabsRevision.select(asState(state), 'ws-1')).toBe(current);
  });

  it.each([
    ['workspaceUnmounted', workspaceUnmounted('ws-1')],
    ['workspaceDeleted', workspaceDeleted('ws-1', [])],
    ['removeWorkspaceEntity', removeWorkspaceEntity('ws-1')],
  ])('clears only the affected workspace on %s', (_name, lifecycleAction) => {
    let state = browserClientsReducer(initialState, browserTabUpserted('ws-1', tab('tab-a')));
    state = browserClientsReducer(
      state,
      workspaceBrowserClientReceived('ws-1', {
        clientId: 'cli-desk',
        source: 'workspace',
        resolved: { clientId: 'cli-desk' },
      }),
    );
    state = browserClientsReducer(
      state,
      browserTabUpserted('ws-2', tab('tab-z', { workspaceId: 'ws-2' })),
    );
    state = browserClientsReducer(state, lifecycleAction);

    expect(state.byWorkspaceId['ws-1']).toBeUndefined();
    expect(selectWorkspaceBrowserClient.select(asState(state), 'ws-1')).toBeNull();
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1')).toEqual([]);
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-2').map((t) => t.tabId)).toEqual([
      'tab-z',
    ]);
  });
});
