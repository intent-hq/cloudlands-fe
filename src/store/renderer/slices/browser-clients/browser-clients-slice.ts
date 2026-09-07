/**
 * Browser Clients Slice (renderer)
 *
 * Renderer mirror of the daemon-owned REV-2 browser-client routing state
 * (PROTOCOL §5.17 `client.list`, `workspace.getBrowserClient` /
 * `workspace.setBrowserClient`, `browser.*` tab registry). The saga performs
 * the reads/writes through `appClient`; the daemon-events-bridge dispatches
 * `refreshLiveClientsRequested` on `client:connected` / `client:disconnected`
 * and the `browserTab*` patches on `browser:tab-*` events. Pure mirror — no
 * routing decisions are made here; the daemon owns them.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  addItem,
  getItem,
  removeItem,
  replaceItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  BrowserTab,
  BrowserTabListing,
  LiveClient,
  WorkspaceBrowserClient,
} from '$shared/types/browser-clients';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import type { BrowserClientsState } from './browser-clients-types';
import {
  createBrowserTabCollection,
  createLiveClientCollection,
  emptyWorkspaceBrowserClientsState,
  initialState,
} from './browser-clients-types';

export type { BrowserClientsState } from './browser-clients-types';
export { initialState } from './browser-clients-types';

// ---------------------------------------------------------------------------
// Actions — saga triggers
// ---------------------------------------------------------------------------

/** Learn this connection's own clientId and read the live client list. */
export const hydrateBrowserClientsRequested = createAction(
  'browserClients/hydrateBrowserClientsRequested',
);

/** Re-read `client.list` (bridge: `client:connected` / `client:disconnected`). */
export const refreshLiveClientsRequested = createAction(
  'browserClients/refreshLiveClientsRequested',
);

/** Read `workspace.getBrowserClient` for one workspace. */
export const fetchWorkspaceBrowserClientRequested = createAction<[wsId: string]>(
  'browserClients/fetchWorkspaceBrowserClientRequested',
);

/** Pin (`clientId`) or clear (`null`) the workspace's browser client. */
export const setWorkspaceBrowserClientRequested = createAction<
  [wsId: string, clientId: string | null]
>('browserClients/setWorkspaceBrowserClientRequested');

/** Read `browser.listTabs` for one workspace. */
export const fetchWorkspaceBrowserTabsRequested = createAction<[wsId: string]>(
  'browserClients/fetchWorkspaceBrowserTabsRequested',
);

// ---------------------------------------------------------------------------
// Actions — state updates
// ---------------------------------------------------------------------------

export const ownClientIdReceived = createAction<[clientId: string]>(
  'browserClients/ownClientIdReceived',
);

export const liveClientsReceived = createAction<[clients: LiveClient[]]>(
  'browserClients/liveClientsReceived',
);

export const workspaceBrowserClientReceived = createAction<
  [wsId: string, browserClient: WorkspaceBrowserClient]
>('browserClients/workspaceBrowserClientReceived');

/**
 * `browser.listTabs` snapshot. `revision` is the workspace's `tabsRevision`
 * when the read was issued; the reducer drops the snapshot if a `browser:tab-*`
 * patch advanced it in the meantime (the saga then re-reads).
 */
export const workspaceBrowserTabsReceived = createAction<
  [wsId: string, tabs: BrowserTabListing[], revision: number]
>('browserClients/workspaceBrowserTabsReceived');

/** `browser:tab-opened` / `browser:tab-updated`: the daemon's row for the tab. */
export const browserTabUpserted = createAction<[wsId: string, tab: BrowserTab]>(
  'browserClients/browserTabUpserted',
);

/** `browser:tab-closed`: the row was removed or tombstoned. */
export const browserTabClosed = createAction<[wsId: string, tabId: string]>(
  'browserClients/browserTabClosed',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyWorkspaceBrowserClientsState,
);

export const browserClientsReducer = createReducer<BrowserClientsState>(initialState);
browserClientsReducer.with(ownClientIdReceived, (state, { payload: [clientId] }) =>
  state.ownClientId === clientId ? state : { ...state, ownClientId: clientId },
);
browserClientsReducer.with(liveClientsReceived, (state, { payload: [clients] }) => ({
  ...state,
  liveClients: createLiveClientCollection(clients),
  liveClientsLoaded: true,
}));
browserClientsReducer.with(
  workspaceBrowserClientReceived,
  (state, { payload: [wsId, browserClient] }) =>
    setWorkspaceState(state, wsId, { ...getWorkspaceState(state, wsId), browserClient }),
);
browserClientsReducer.with(
  workspaceBrowserTabsReceived,
  (state, { payload: [wsId, tabs, revision] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.tabsRevision !== revision) return state;
    return setWorkspaceState(state, wsId, { ...ws, tabs: createBrowserTabCollection(tabs) });
  },
);
browserClientsReducer.with(browserTabUpserted, (state, { payload: [wsId, tab] }) => {
  const ws = getWorkspaceState(state, wsId);
  // The event row is the canonical registry row (an omitted optional field
  // was cleared), so it replaces the entry outright — `upsertItem` would
  // merge and retain cleared fields. Only the `browser.listTabs` presence
  // decoration, which event payloads never carry, is kept from the last read.
  const existing = getItem(ws.tabs, tab.tabId) as BrowserTabListing | undefined;
  if (!existing) {
    return setWorkspaceState(state, wsId, {
      ...ws,
      tabs: addItem(ws.tabs, tab),
      tabsRevision: ws.tabsRevision + 1,
    });
  }
  const next: BrowserTab | BrowserTabListing =
    'hostConnected' in existing
      ? {
          ...tab,
          hostConnected: existing.hostConnected,
          ...(existing.hostName !== undefined ? { hostName: existing.hostName } : {}),
        }
      : tab;
  return setWorkspaceState(state, wsId, {
    ...ws,
    tabs: replaceItem(ws.tabs, tab.tabId, next),
    tabsRevision: ws.tabsRevision + 1,
  });
});
browserClientsReducer.with(browserTabClosed, (state, { payload: [wsId, tabId] }) => {
  const ws = getWorkspaceState(state, wsId);
  // Bump the revision even for an unknown tabId: the row may be in a
  // `browser.listTabs` snapshot still in flight, which must not resurrect it.
  return setWorkspaceState(state, wsId, {
    ...ws,
    tabs: getItem(ws.tabs, tabId) ? removeItem(ws.tabs, tabId) : ws.tabs,
    tabsRevision: ws.tabsRevision + 1,
  });
});
browserClientsReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
browserClientsReducer.with(workspaceDeleted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
browserClientsReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
