/**
 * Browser slice types — safe to import from any process.
 */

/**
 * A recently visited URL entry
 */
export type RecentUrl = {
  /** The URL that was visited */
  url: string;
  /** Page title (captured from webview) */
  title?: string;
  /** Favicon URL */
  favicon?: string;
  /** ISO timestamp of last visit */
  lastVisited: string;
};

/**
 * Zoom action requested for a specific browser tab.
 */
export type BrowserZoomAction = "in" | "out" | "reset";

/**
 * Browser state scoped to a single workspace
 */
export type BrowserWorkspaceState = {
  /** List of recently visited URLs (max 20) */
  recentUrls: RecentUrl[];
  /** Currently displayed URL in the browser panel */
  currentUrl: string | null;
  /** Whether the browser is loading a page */
  isLoading: boolean;
  /**
   * Pending zoom actions keyed by browser tab id, stored as a queue so
   * multiple requests dispatched in the same microtask are not lost. Each
   * `browserTabZoomRequested` appends to the queue; the EmbeddedBrowser
   * drains the entire queue in order and dispatches a single
   * `clearBrowserTabZoomRequest` to remove the entry. Workspace-scoped so
   * closing the workspace clears pending entries automatically.
   */
  pendingZoomByTabId: Record<string, BrowserZoomAction[]>;
};

/**
 * Root browser state (workspace-scoped)
 */
export type BrowserState = {
  byWorkspaceId: Record<string, BrowserWorkspaceState>;
};

/** Maximum number of recent URLs to keep per workspace */
export const MAX_RECENT_URLS = 20;

/** localStorage key prefix for browser state */
export const BROWSER_STORAGE_KEY_PREFIX = "browser-recent-";

