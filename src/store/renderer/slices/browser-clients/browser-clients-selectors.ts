/**
 * Browser Clients Selectors (renderer)
 */

import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { LiveClient, WorkspaceBrowserClient } from '$shared/types/browser-clients';
import type { BrowserTabHost } from '$lib/components/browser/browser-tab-host';
import {
  browserClientDisplayName,
  type BrowserClientSummary,
  type ResolvedBrowserClients,
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
  (state, wsId: string): ResolvedBrowserClients => {
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

/**
 * The host of a browser tab mirrored here (REV-2 Model 3): its display name
 * and whether it is connected. Presence comes from `client.list`; until that
 * first read lands it is unknown, and the host is reported connected so the
 * mirror does not open in the offline state only to flip back a moment later.
 * An offline host has no live hello, so its name falls back to the id.
 */
export const selectBrowserTabHost = store.createSelector(
  (state, hostClientId: string): BrowserTabHost => {
    const slice = state?.browserClients ?? initialState;
    const live = getItem(slice.liveClients, hostClientId);
    if (live) return { name: browserClientDisplayName(liveClientSummary(live)), connected: true };
    return {
      name: browserClientDisplayName({ clientId: hostClientId, connected: false }),
      connected: !slice.liveClientsLoaded,
    };
  },
);

/**
 * `browser:tab-*` event counter the panel-layout registry saga reads around
 * its `browser.listTabs` reads to detect a listing that may predate an event.
 */
export const selectWorkspaceBrowserTabsRevision = store.createSelector(
  (state, wsId: string): number =>
    (state?.browserClients?.byWorkspaceId[wsId] ?? emptyWorkspaceBrowserClientsState).tabsRevision,
);
