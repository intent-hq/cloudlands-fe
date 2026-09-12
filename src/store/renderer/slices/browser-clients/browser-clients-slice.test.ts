import { describe, expect, it, vi } from 'vitest';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

import type { BrowserTab, LiveClient } from '$shared/types/browser-clients';
import {
  resolveDrivingClientSwitch,
  resolveDrivingClientView,
} from '$lib/components/workspace/driving-indicator';
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
} from './browser-clients-slice';
import {
  selectBrowserTabHost,
  selectLiveClient,
  selectLiveClients,
  selectLiveClientsLoaded,
  selectOwnClientId,
  selectWorkspaceBrowserClient,
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

  it('gates the indicator on browser tabs and two clients, except for an offline pin', () => {
    let state = browserClientsReducer(initialState, ownClientIdReceived('cli-desk'));
    state = browserClientsReducer(state, liveClientsReceived([desk, laptop]));
    state = browserClientsReducer(
      state,
      workspaceBrowserClientReceived('ws-1', {
        source: 'default',
        resolved: { clientId: 'cli-laptop', name: 'Intent Desktop' },
      }),
    );
    const twoClients = selectWorkspaceDrivingClient.select(asState(state), 'ws-1');
    // Two clients, no browser tabs: hidden — but the switch stays offered.
    expect(resolveDrivingClientView({ ...twoClients, hasBrowserTabs: false })).toBeNull();
    expect(resolveDrivingClientSwitch(twoClients)).toMatchObject({
      mode: 'elsewhere',
      canSwitchHere: true,
    });
    // Two clients with a browser tab: shown.
    expect(resolveDrivingClientView({ ...twoClients, hasBrowserTabs: true })).toMatchObject({
      mode: 'elsewhere',
      hostName: 'Intent Desktop',
      canSwitchHere: true,
    });

    // One client with a browser tab: hidden.
    state = browserClientsReducer(state, liveClientsReceived([desk]));
    state = browserClientsReducer(
      state,
      workspaceBrowserClientReceived('ws-1', {
        source: 'default',
        resolved: { clientId: 'cli-desk', name: 'Intent Desktop' },
      }),
    );
    const oneClient = selectWorkspaceDrivingClient.select(asState(state), 'ws-1');
    expect(resolveDrivingClientView({ ...oneClient, hasBrowserTabs: true })).toBeNull();

    // Offline pin, one connected client, no browser tabs: still surfaced.
    state = browserClientsReducer(
      state,
      workspaceBrowserClientReceived('ws-1', {
        source: 'workspace',
        clientId: 'cli-travel',
        resolved: null,
      }),
    );
    const offlinePin = selectWorkspaceDrivingClient.select(asState(state), 'ws-1');
    expect(resolveDrivingClientView({ ...offlinePin, hasBrowserTabs: false })).toMatchObject({
      mode: 'offline',
      canSwitchHere: true,
    });
  });

  it('advances the per-workspace tabsRevision on every browser:tab-* event', () => {
    expect(selectWorkspaceBrowserTabsRevision.select(asState(initialState), 'ws-1')).toBe(0);

    // Opened / updated rows and closed ids (even for a tab never seen here)
    // each advance the revision the registry saga compares its reads against.
    let state = browserClientsReducer(initialState, browserTabUpserted('ws-1', tab('tab-a')));
    expect(selectWorkspaceBrowserTabsRevision.select(asState(state), 'ws-1')).toBe(1);
    state = browserClientsReducer(state, browserTabUpserted('ws-1', tab('tab-a')));
    expect(selectWorkspaceBrowserTabsRevision.select(asState(state), 'ws-1')).toBe(2);
    state = browserClientsReducer(state, browserTabClosed('ws-1', 'tab-a'));
    state = browserClientsReducer(state, browserTabClosed('ws-1', 'tab-never-seen'));
    expect(selectWorkspaceBrowserTabsRevision.select(asState(state), 'ws-1')).toBe(4);

    // Other workspaces are untouched.
    expect(selectWorkspaceBrowserTabsRevision.select(asState(state), 'ws-2')).toBe(0);
    expect(state.byWorkspaceId['ws-1']?.browserClient).toBeNull();
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
    expect(selectWorkspaceBrowserTabsRevision.select(asState(state), 'ws-1')).toBe(0);
    expect(selectWorkspaceBrowserTabsRevision.select(asState(state), 'ws-2')).toBe(1);
  });
});
