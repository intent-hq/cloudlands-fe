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
  selectBrowserTabHost,
  selectLiveClient,
  selectLiveClients,
  selectLiveClientsLoaded,
  selectOwnClientId,
  selectWorkspaceBrowserClient,
  selectWorkspaceBrowserTabs,
  selectWorkspaceBrowserTabsRevision,
  selectWorkspaceDrivingClient,
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

  describe('selectBrowserTabHost (a mirror tab host, REV-2 Model 3)', () => {
    it('reports a listed host connected under its hello hostname, falling back to its name', () => {
      const state = browserClientsReducer(initialState, liveClientsReceived([desk, laptop]));
      expect(selectBrowserTabHost.select(asState(state), 'cli-desk')).toEqual({
        name: 'dev-box',
        connected: true,
      });
      expect(selectBrowserTabHost.select(asState(state), 'cli-laptop')).toEqual({
        name: 'Intent Desktop',
        connected: true,
      });
    });

    it('reports an unlisted host offline once client.list has been read, named by its id', () => {
      const state = browserClientsReducer(initialState, liveClientsReceived([desk]));
      expect(selectBrowserTabHost.select(asState(state), 'cli-laptop')).toEqual({
        name: 'cli-laptop',
        connected: false,
      });
    });

    it('flips a host offline and back as client.list presence changes', () => {
      let state = browserClientsReducer(initialState, liveClientsReceived([desk, laptop]));
      expect(selectBrowserTabHost.select(asState(state), 'cli-laptop').connected).toBe(true);
      state = browserClientsReducer(state, liveClientsReceived([desk]));
      expect(selectBrowserTabHost.select(asState(state), 'cli-laptop').connected).toBe(false);
      state = browserClientsReducer(state, liveClientsReceived([desk, laptop]));
      expect(selectBrowserTabHost.select(asState(state), 'cli-laptop').connected).toBe(true);
    });

    it('does not report a host offline before the first client.list read', () => {
      expect(selectBrowserTabHost.select(asState(initialState), 'cli-laptop').connected).toBe(true);
    });
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

  it('derives the driving-client indicator input from the live list and the workspace pin', () => {
    expect(selectWorkspaceDrivingClient.select(asState(initialState), 'ws-1')).toEqual({
      eligibleClients: [],
      ownClientId: '',
      driving: null,
    });

    const viewer: LiveClient = {
      clientId: 'cli-ios',
      name: 'Intent iOS',
      capabilities: {},
      connections: 1,
      transports: ['ws'],
      connectedAt: '2026-09-07T00:00:03.000Z',
    };
    let state = browserClientsReducer(initialState, ownClientIdReceived('cli-desk'));
    state = browserClientsReducer(state, liveClientsReceived([desk, laptop, viewer]));
    state = browserClientsReducer(
      state,
      workspaceBrowserClientReceived('ws-1', {
        source: 'default',
        resolved: { clientId: 'cli-laptop', name: 'Intent Desktop' },
      }),
    );
    // Only browserExec clients are eligible; the host triple wins as the name.
    expect(selectWorkspaceDrivingClient.select(asState(state), 'ws-1')).toEqual({
      eligibleClients: [
        { clientId: 'cli-desk', name: 'dev-box', connected: true },
        { clientId: 'cli-laptop', name: 'Intent Desktop', connected: true },
      ],
      ownClientId: 'cli-desk',
      driving: { clientId: 'cli-laptop', name: 'Intent Desktop', connected: true },
    });

    // Pinned but offline: the pin is surfaced as a disconnected driver.
    state = browserClientsReducer(
      state,
      workspaceBrowserClientReceived('ws-1', {
        source: 'workspace',
        clientId: 'cli-travel',
        resolved: null,
      }),
    );
    expect(selectWorkspaceDrivingClient.select(asState(state), 'ws-1').driving).toEqual({
      clientId: 'cli-travel',
      connected: false,
    });

    // Unpinned with nothing eligible resolves to no driver.
    state = browserClientsReducer(
      state,
      workspaceBrowserClientReceived('ws-1', { source: 'default', resolved: null }),
    );
    expect(selectWorkspaceDrivingClient.select(asState(state), 'ws-1').driving).toBeNull();
  });

  it('mirrors browser.listTabs rows and patches them from browser:tab-* events', () => {
    const listed: BrowserTabListing = {
      ...tab('tab-a', { title: 'Example', ownerAgentId: 'agent-1', ownerAgentName: 'Agent' }),
      hostConnected: true,
      hostName: 'Intent Desktop',
    };
    let state = browserClientsReducer(
      initialState,
      workspaceBrowserTabsReceived('ws-1', [listed], 0),
    );
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1')).toEqual([listed]);

    // tab-updated: the event row is the canonical registry row — optional
    // fields it omits (title, owner) were cleared and must not survive; only
    // the listing's presence decoration carries over.
    const moved = tab('tab-a', {
      url: 'https://example.com/next',
      updatedAt: '2026-09-07T00:00:05.000Z',
    });
    state = browserClientsReducer(state, browserTabUpserted('ws-1', moved));
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1')).toEqual([
      { ...moved, hostConnected: true, hostName: 'Intent Desktop' },
    ]);
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1')[0]).not.toHaveProperty(
      'title',
    );

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

  it('recomputes the presence decoration from client.list when a tab row moves to another host', () => {
    const listed: BrowserTabListing = {
      ...tab('tab-a', { hostClientId: 'cli-desk' }),
      hostConnected: true,
      hostName: 'Desk (hello name)',
    };
    const migrated = (hostClientId: string): BrowserTab =>
      tab('tab-a', { hostClientId, updatedAt: '2026-09-07T00:00:05.000Z' });

    // Live list read: the new host is listed → connected, with its hello name.
    let state = browserClientsReducer(initialState, liveClientsReceived([desk, laptop]));
    state = browserClientsReducer(state, workspaceBrowserTabsReceived('ws-1', [listed], 0));
    state = browserClientsReducer(state, browserTabUpserted('ws-1', migrated('cli-laptop')));
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1')).toEqual([
      { ...migrated('cli-laptop'), hostConnected: true, hostName: laptop.name },
    ]);

    // Live list read: the new host is not listed → disconnected, no stale name.
    state = browserClientsReducer(state, browserTabUpserted('ws-1', migrated('cli-gone')));
    expect(selectWorkspaceBrowserTabs.select(asState(state), 'ws-1')).toEqual([
      { ...migrated('cli-gone'), hostConnected: false },
    ]);

    // Live list never read: the decoration is dropped rather than carried over.
    let cold = browserClientsReducer(
      initialState,
      workspaceBrowserTabsReceived('ws-1', [listed], 0),
    );
    cold = browserClientsReducer(cold, browserTabUpserted('ws-1', migrated('cli-laptop')));
    expect(selectWorkspaceBrowserTabs.select(asState(cold), 'ws-1')).toEqual([
      migrated('cli-laptop'),
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
