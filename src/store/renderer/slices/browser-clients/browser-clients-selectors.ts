/**
 * Browser Clients Selectors (renderer)
 */

import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { BrowserTab, LiveClient, WorkspaceBrowserClient } from '$shared/types/browser-clients';
import { store } from '../../store';
import { emptyWorkspaceBrowserClientsState } from './browser-clients-types';

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

/** The workspace's daemon tab-registry rows. */
export const selectWorkspaceBrowserTabs = store.createSelector(
  (state, wsId: string): BrowserTab[] =>
    getItems(
      (state?.browserClients?.byWorkspaceId[wsId] ?? emptyWorkspaceBrowserClientsState).tabs,
    ),
);
