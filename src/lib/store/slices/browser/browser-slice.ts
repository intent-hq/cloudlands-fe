import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type {
  BrowserState,
  BrowserWorkspaceState,
  BrowserZoomAction,
  RecentUrl,
} from "./browser-types";
import { MAX_RECENT_URLS } from "./browser-types";

export const emptyBrowserWorkspaceState: BrowserWorkspaceState = {
  recentUrls: [],
  currentUrl: null,
  isLoading: false,
  pendingZoomByTabId: {},
};

export const initialState: BrowserState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyBrowserWorkspaceState);

// ── Actions ──────────────────────────────────────────────────────────────

/** Request initialization of browser state for a workspace (triggers saga to load from localStorage) */
export const initBrowserWorkspace = createAction<[wsId: string]>(
  "browser/initBrowserWorkspace"
);

/** Hydrate workspace state from localStorage (called by init saga) */
export const hydrateBrowserState = createAction<[wsId: string, recentUrls: RecentUrl[]]>(
  "browser/hydrateBrowserState"
);

/** Add or move a URL to the top of the recent list */
export const addRecentUrl = createAction<
  [wsId: string, url: string, title: string | undefined, favicon: string | undefined, timestamp: string]
>("browser/addRecentUrl");

/** Update title/favicon for an existing URL */
export const updateUrlMetadata = createAction<
  [wsId: string, url: string, title: string | undefined, favicon: string | undefined]
>("browser/updateUrlMetadata");

/** Remove a URL from the recent list */
export const removeRecentUrl = createAction<[wsId: string, url: string]>(
  "browser/removeRecentUrl"
);

/** Clear all recent URLs for a workspace */
export const clearRecentUrls = createAction<[wsId: string]>(
  "browser/clearRecentUrls"
);

/**
 * Request a zoom action on a specific browser tab. Dispatched by the menu
 * zoom sagas after they resolve the focused panel + active tab. The
 * EmbeddedBrowser instance bound to that tab id consumes the request and
 * dispatches `clearBrowserTabZoomRequest` once applied.
 */
export const browserTabZoomRequested = createAction<
  [wsId: string, tabId: string, action: BrowserZoomAction]
>("browser/tabZoomRequested");

/** Clear a previously requested zoom action for a tab. */
export const clearBrowserTabZoomRequest = createAction<[wsId: string, tabId: string]>(
  "browser/clearTabZoomRequest"
);

// ── Reducer ──────────────────────────────────────────────────────────────

export const browserReducer = createReducer<BrowserState>(initialState)
  .with(hydrateBrowserState, (state, { payload: [wsId, recentUrls] }) =>
    setWorkspaceState(state, wsId, {
      ...getWorkspaceState(state, wsId),
      recentUrls,
    })
  )
  .with(addRecentUrl, (state, { payload: [wsId, url, title, favicon, timestamp] }) => {
    const ws = getWorkspaceState(state, wsId);
    const filtered = ws.recentUrls.filter((item) => item.url !== url);
    const newEntry: RecentUrl = { url, title, favicon, lastVisited: timestamp };
    const updated = [newEntry, ...filtered].slice(0, MAX_RECENT_URLS);
    return setWorkspaceState(state, wsId, { ...ws, recentUrls: updated });
  })
  .with(updateUrlMetadata, (state, { payload: [wsId, url, title, favicon] }) => {
    const ws = getWorkspaceState(state, wsId);
    const updated = ws.recentUrls.map((item) => {
      if (item.url === url) {
        return { ...item, title: title ?? item.title, favicon: favicon ?? item.favicon };
      }
      return item;
    });
    // If nothing changed, return same reference
    if (updated.every((item, i) => item === ws.recentUrls[i])) return state;
    return setWorkspaceState(state, wsId, { ...ws, recentUrls: updated });
  })
  .with(removeRecentUrl, (state, { payload: [wsId, url] }) => {
    const ws = getWorkspaceState(state, wsId);
    const updated = ws.recentUrls.filter((item) => item.url !== url);
    if (updated.length === ws.recentUrls.length) return state;
    return setWorkspaceState(state, wsId, { ...ws, recentUrls: updated });
  })
  .with(clearRecentUrls, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.recentUrls.length === 0) return state;
    return setWorkspaceState(state, wsId, { ...ws, recentUrls: [] });
  })
  .with(browserTabZoomRequested, (state, { payload: [wsId, tabId, action] }) => {
    const ws = getWorkspaceState(state, wsId);
    const existing = ws.pendingZoomByTabId[tabId];
    return setWorkspaceState(state, wsId, {
      ...ws,
      pendingZoomByTabId: {
        ...ws.pendingZoomByTabId,
        [tabId]: existing ? [...existing, action] : [action],
      },
    });
  })
  .with(clearBrowserTabZoomRequest, (state, { payload: [wsId, tabId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!(tabId in ws.pendingZoomByTabId)) return state;
    const { [tabId]: _removed, ...rest } = ws.pendingZoomByTabId;
    return setWorkspaceState(state, wsId, { ...ws, pendingZoomByTabId: rest });
  })
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));
