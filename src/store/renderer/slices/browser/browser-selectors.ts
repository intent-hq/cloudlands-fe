import { store } from "../../store";
import { emptyBrowserWorkspaceState } from "./browser-slice";
import type {
  BrowserWorkspaceState,
  BrowserZoomAction,
  RecentUrl,
} from "./browser-types";

const selectBrowserWorkspaceState = store.createSelector<
  [wsId: string],
  BrowserWorkspaceState
>((state, wsId) => {
  return state.browser.byWorkspaceId[wsId] ?? emptyBrowserWorkspaceState;
});

export const selectBrowserRecentUrls = store.createSelector<[wsId: string], RecentUrl[]>(
  (state, wsId) => {
    return selectBrowserWorkspaceState.select(state, wsId).recentUrls;
  }
);

/**
 * Pending zoom action queue for a specific browser tab, or null when
 * empty. The EmbeddedBrowser subscriber drains the entire queue in order
 * and dispatches `clearBrowserTabZoomRequest` once to remove the entry.
 */
export const selectPendingBrowserZoom = store.createSelector<
  [wsId: string, tabId: string],
  BrowserZoomAction[] | null
>((state, wsId, tabId) => {
  const queue = selectBrowserWorkspaceState.select(state, wsId).pendingZoomByTabId[tabId];
  return queue && queue.length > 0 ? queue : null;
});

