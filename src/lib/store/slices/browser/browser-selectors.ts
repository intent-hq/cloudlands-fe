import { createSelector } from "../../utils/create-selector";
import { emptyBrowserWorkspaceState } from "./browser-slice";
import type {
  BrowserWorkspaceState,
  BrowserZoomAction,
  RecentUrl,
} from "./browser-types";

export const selectBrowserWorkspaceState = createSelector<
  [wsId: string],
  BrowserWorkspaceState
>((state, wsId) => {
  return state.browser.byWorkspaceId[wsId] ?? emptyBrowserWorkspaceState;
});

export const selectBrowserRecentUrls = createSelector<[wsId: string], RecentUrl[]>(
  (state, wsId) => {
    return selectBrowserWorkspaceState.select(state, wsId).recentUrls;
  }
);

export const selectBrowserCurrentUrl = createSelector<[wsId: string], string | null>(
  (state, wsId) => {
    return selectBrowserWorkspaceState.select(state, wsId).currentUrl;
  }
);

export const selectBrowserIsLoading = createSelector<[wsId: string], boolean>(
  (state, wsId) => {
    return selectBrowserWorkspaceState.select(state, wsId).isLoading;
  }
);

/**
 * Pending zoom action queue for a specific browser tab, or null when
 * empty. The EmbeddedBrowser subscriber drains the entire queue in order
 * and dispatches `clearBrowserTabZoomRequest` once to remove the entry.
 */
export const selectPendingBrowserZoom = createSelector<
  [wsId: string, tabId: string],
  BrowserZoomAction[] | null
>((state, wsId, tabId) => {
  const queue = selectBrowserWorkspaceState.select(state, wsId).pendingZoomByTabId[tabId];
  return queue && queue.length > 0 ? queue : null;
});

