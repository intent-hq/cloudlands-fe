/**
 * Browser Tab Registry Selectors (renderer)
 */

import { store } from '../../store';
import type {
  BrowserTabClosingState,
  WorkspaceBrowserTabRegistryState,
} from './browser-tab-registry-types';
import { emptyWorkspaceBrowserTabRegistryState } from './browser-tab-registry-types';

/** The workspace's registry lifecycle record (generation, phase, reported tabs). */
export const selectBrowserTabRegistryWorkspace = store.createSelector(
  (state, wsId: string): WorkspaceBrowserTabRegistryState =>
    state?.browserTabRegistry?.byWorkspaceId[wsId] ?? emptyWorkspaceBrowserTabRegistryState,
);

/**
 * Whether the workspace's registry rows were torn down (its tab closed or it
 * was deleted) after having been tracked: a record exists and is
 * `unmounted`. A workspace the registry never tracked has no record.
 */
export const selectIsBrowserTabRegistryTornDown = store.createSelector(
  (state, wsId: string): boolean =>
    state?.browserTabRegistry?.byWorkspaceId[wsId]?.phase === 'unmounted',
);

/** Tabs closed here whose removal the daemon has not confirmed, by tab id. */
export const selectBrowserTabsClosing = store.createSelector(
  (state): Record<string, BrowserTabClosingState> => state?.browserTabRegistry?.closing ?? {},
);
