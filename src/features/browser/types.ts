/**
 * Browser Feature Types
 *
 * Types for the embedded browser panel and state management.
 */

/**
 * A recently visited URL entry
 */
export interface RecentUrl {
  /** The URL that was visited */
  url: string;
  /** Page title (captured from webview) */
  title?: string;
  /** Favicon URL */
  favicon?: string;
  /** ISO timestamp of last visit */
  lastVisited: string;
}

/**
 * Browser session state for a workspace
 */
export interface BrowserState {
  /** List of recently visited URLs (max 20) */
  recentUrls: RecentUrl[];
  /** Currently displayed URL in the browser panel */
  currentUrl: string | null;
  /** Whether the browser is loading a page */
  isLoading: boolean;
}

/**
 * Console log entry from the webview (for Phase 2)
 */
export interface ConsoleLogEntry {
  /** Log level */
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  /** Log message */
  message: string;
  /** Source file (if available) */
  source?: string;
  /** Line number (if available) */
  line?: number;
  /** ISO timestamp */
  timestamp: string;
}

/** Maximum number of recent URLs to keep per workspace */
export const MAX_RECENT_URLS = 20;

/** localStorage key prefix for browser state */
export const BROWSER_STORAGE_KEY_PREFIX = 'browser-recent-';
