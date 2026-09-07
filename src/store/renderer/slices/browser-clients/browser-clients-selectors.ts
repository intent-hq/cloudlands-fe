/**
 * Browser Clients Selectors (renderer)
 */

import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { BrowserTab, LiveClient, WorkspaceBrowserClient } from '$shared/types/browser-clients';
import type {
  BrowserClientSummary,
  DrivingClientInput,
} from '$lib/components/workspace/driving-indicator';
import { store } from '../../store';
import { emptyWorkspaceBrowserClientsState, initialState } from './browser-clients-types';

/** This connection's own `clientId` (null until the hello probe lands). */
export const selectOwnClientId = store.createSelector(
  (state): string | null => state?.browserClients?.ownClientId ?? null,
);

/** Every connected logical client (`client.list` order). */
export const selectLiveClients = store.createSelector((state): LiveClient[] =>
  getItems(state.browserClients.liveClients),
);

export const selectLiveClientsLoaded = store.createSelector(
  (state): boolean => state?.browserClients?.liveClientsLoaded ?? false,
);

/** One connected client by id, or undefined when it is not (or no longer) listed. */
export const selectLiveClient = store.createSelector(
  (state, clientId: string): LiveClient | undefined =>
    getItem(state.browserClients.liveClients, clientId),
);

/** The workspace's effective browser client (null until the first read). */
export const selectWorkspaceBrowserClient = store.createSelector(
  (state, wsId: string): WorkspaceBrowserClient | null =>
    (state?.browserClients?.byWorkspaceId[wsId] ?? emptyWorkspaceBrowserClientsState).browserClient,
);

/**
 * Display name for the sidebar indicator: the hello host triple when the
 * client sent one, else its hello `name`; the view model falls back to a
 * shortened id when both are absent.
 */
function liveClientSummary(client: LiveClient): BrowserClientSummary {
  const name = client.prettyHostname ?? client.hostname ?? client.name;
  return { clientId: client.clientId, ...(name !== undefined ? { name } : {}), connected: true };
}

/**
 * Inputs for the workspace "driving client" indicator (REV-2): the connected
 * clients advertising `capabilities.browserExec`, this connection's own id,
 * and the daemon-resolved driving client. `driving` mirrors the daemon's
 * answer — the `resolved` client when one resolves, the pin marked offline
 * when it is set but unreachable (`source: "workspace"`, `resolved: null`),
 * and `null` when unpinned with nothing eligible or before the first read.
 */
export const selectWorkspaceDrivingClient = store.createSelector(
  (state, wsId: string): DrivingClientInput => {
    const slice = state?.browserClients ?? initialState;
    const eligibleClients = getItems(slice.liveClients)
      .filter((client) => client.capabilities.browserExec === true)
      .map(liveClientSummary);
    const browserClient = (slice.byWorkspaceId[wsId] ?? emptyWorkspaceBrowserClientsState)
      .browserClient;
    let driving: BrowserClientSummary | null = null;
    if (browserClient?.resolved) {
      const live = getItem(slice.liveClients, browserClient.resolved.clientId);
      driving = live ? liveClientSummary(live) : { ...browserClient.resolved, connected: true };
    } else if (browserClient?.source === 'workspace') {
      driving = { clientId: browserClient.clientId, connected: false };
    }
    return { eligibleClients, ownClientId: slice.ownClientId ?? '', driving };
  },
);

/** The workspace's daemon tab-registry rows. */
export const selectWorkspaceBrowserTabs = store.createSelector(
  (state, wsId: string): BrowserTab[] =>
    getItems(
      (state?.browserClients?.byWorkspaceId[wsId] ?? emptyWorkspaceBrowserClientsState).tabs,
    ),
);

/** `browser:tab-*` patch counter the saga stamps on a `browser.listTabs` read. */
export const selectWorkspaceBrowserTabsRevision = store.createSelector(
  (state, wsId: string): number =>
    (state?.browserClients?.byWorkspaceId[wsId] ?? emptyWorkspaceBrowserClientsState).tabsRevision,
);
