/**
 * Browser Clients Slice (renderer)
 *
 * Renderer mirror of the daemon-owned REV-2 browser-client routing state
 * (PROTOCOL §5.17 `client.list`, `workspace.getBrowserClient` /
 * `workspace.setBrowserClient`, `browser.*` tab commands). The saga performs
 * the reads/writes through `appClient`; the daemon-events-bridge dispatches
 * `refreshLiveClientsRequested` on `client:connected` / `client:disconnected`
 * and `browserTabUpserted` / `browserTabClosed` on `browser:tab-*` events,
 * which only advance the workspace's `tabsRevision` — the tab rows themselves
 * live in the panel-layout browser-tab registry. Pure mirror — no routing
 * decisions are made here; the daemon owns them.
 */

import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { BrowserTab, LiveClient, WorkspaceBrowserClient } from '$shared/types/browser-clients';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import type { BrowserClientsState } from './browser-clients-types';
import {
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

/**
 * Forward a viewer's navigation to the tab's host (`browser.navigateTab`,
 * REV-2 Model 3). The canonical URL follows the host's `browser:tab-updated`
 * echo, not this request; the action's promise settles with the host's
 * answer so the mirror can reload the canonical URL when the host rejected.
 */
export const navigateBrowserTabRequested = createAsyncAction<[tabId: string, url: string], void>(
  'browserClients/navigateBrowserTab',
  'browserClients/navigateBrowserTabRequested',
);

/**
 * Close a tab hosted elsewhere (`browser.closeTab`). `force` tombstones the
 * row while the host is offline; the local mirror goes with the
 * `browser:tab-closed` echo, not with this request.
 */
export const closeBrowserTabRequested = createAction<[tabId: string, force: boolean]>(
  'browserClients/closeBrowserTabRequested',
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
 * `browser:tab-opened` / `browser:tab-updated`: the daemon's row for the tab.
 * The panel-layout registry saga reacts to the action; here it only bumps
 * `tabsRevision`.
 */
export const browserTabUpserted = createAction<[wsId: string, tab: BrowserTab]>(
  'browserClients/browserTabUpserted',
);

/**
 * `browser:tab-closed`: the row was removed or tombstoned. The panel-layout
 * registry saga reacts to the action; here it only bumps `tabsRevision`.
 */
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
function bumpTabsRevision(state: BrowserClientsState, wsId: string): BrowserClientsState {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, tabsRevision: ws.tabsRevision + 1 });
}
browserClientsReducer.with(browserTabUpserted, (state, { payload: [wsId] }) =>
  bumpTabsRevision(state, wsId),
);
// Bump the revision even for an unknown tabId: the row may be in a
// `browser.listTabs` read still in flight, which must not resurrect it.
browserClientsReducer.with(browserTabClosed, (state, { payload: [wsId] }) =>
  bumpTabsRevision(state, wsId),
);
browserClientsReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
browserClientsReducer.with(workspaceDeleted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
browserClientsReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
