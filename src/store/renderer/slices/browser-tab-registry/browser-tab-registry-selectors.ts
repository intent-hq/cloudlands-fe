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

/** Tabs closed here whose removal the daemon has not confirmed, by tab id. */
export const selectBrowserTabsClosing = store.createSelector(
  (state): Record<string, BrowserTabClosingState> => state?.browserTabRegistry?.closing ?? {},
);
