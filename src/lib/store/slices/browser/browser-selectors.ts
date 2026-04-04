import { createSelector } from "../../utils/create-selector";
import { emptyBrowserWorkspaceState } from "./browser-slice";
import type { BrowserWorkspaceState, RecentUrl } from "./browser-types";

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

