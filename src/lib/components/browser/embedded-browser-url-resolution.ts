/**
 * Renderer-side companion to the `browser:resolve-url` IPC
 * (intent-hq/monorepo#2323): every embedded-browser load resolves through the
 * main process (loopback rewrite → reachability probe → tunnel fallback)
 * before `loadURL`, and rewritten loads keep the REQUESTED URL as the
 * user-visible tab/address-bar URL.
 *
 * Dependency-light on purpose: the IPC boundary is injected so tests and
 * bridge-less (web) builds degrade to a passthrough resolution.
 */

/** Wire shape of `browser:resolve-url` (`ResolvedBrowserUrl` in the main process). */
export interface EmbeddedBrowserResolvedUrl {
  /** Final URL to load (the rewritten URL even when `error` is set). */
  url: string;
  rewritten: boolean;
  /** Original URL as requested; present only when `rewritten` is true. */
  requestedUrl?: string;
  /** Why the URL was (or could not be) rewritten/tunneled. */
  reason?: string;
  /** True when the URL was redirected through a daemon tunnel forward. */
  tunneled?: boolean;
  /** Ambiguity warning for bare-loopback rewrites in remote mode. */
  warning?: string;
  /** Explanatory error when the remote target is unreachable and not tunnelable. */
  error?: string;
}

/** Renderer→main invoke boundary (`window.electronAPI.invoke` in Electron). */
export type EmbeddedBrowserResolveInvoke = (
  channel: string,
  ...args: unknown[]
) => Promise<unknown>;

export const BROWSER_RESOLVE_URL_CHANNEL = 'browser:resolve-url';

function isResolvedBrowserUrl(value: unknown): value is EmbeddedBrowserResolvedUrl {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { url?: unknown }).url === 'string' &&
    typeof (value as { rewritten?: unknown }).rewritten === 'boolean'
  );
}

/**
 * Resolve a URL through `browser:resolve-url`. Never throws and never blocks
 * a load: without a bridge (web builds), on invoke failure, or on a malformed
 * response the URL passes through unresolved (`rewritten: false`), matching
 * local-mode behavior.
 */
export async function resolveEmbeddedBrowserUrl(
  url: string,
  invoke: EmbeddedBrowserResolveInvoke | undefined,
): Promise<EmbeddedBrowserResolvedUrl> {
  const passthrough: EmbeddedBrowserResolvedUrl = { url, rewritten: false };
  if (!invoke) return passthrough;
  try {
    const result = await invoke(BROWSER_RESOLVE_URL_CHANNEL, { url });
    return isResolvedBrowserUrl(result) ? result : passthrough;
  } catch {
    return passthrough;
  }
}

/** What the caller should do with a resolution: load a URL, or surface an error. */
export type EmbeddedBrowserLoadPlan =
  | { kind: 'load'; url: string }
  | { kind: 'error'; detail: string };

/**
 * Decide the load action for a resolution. A rewritten target that the main
 * process reported unreachable (probe + tunnel both failed) surfaces the
 * explanatory error instead of navigating to a dead host; a passthrough URL
 * always loads (the webview's own failure UI covers local dead servers).
 */
export function planEmbeddedBrowserLoad(
  resolved: EmbeddedBrowserResolvedUrl,
): EmbeddedBrowserLoadPlan {
  if (resolved.error && resolved.rewritten) {
    return { kind: 'error', detail: resolved.error };
  }
  return { kind: 'load', url: resolved.url };
}

/**
 * Requested→resolved mapping for the CURRENT load, so navigation events
 * carrying the resolved (rewritten/tunneled) URL display as the URL the user
 * asked for. Cleared whenever the webview navigates somewhere else.
 */
export interface EmbeddedBrowserResolvedLoadState {
  requestedUrl: string | null;
  resolvedUrl: string | null;
}

export function createEmbeddedBrowserResolvedLoadState(): EmbeddedBrowserResolvedLoadState {
  return { requestedUrl: null, resolvedUrl: null };
}

/** Record the mapping for a load that is about to start. */
export function recordEmbeddedBrowserResolvedLoad(
  state: EmbeddedBrowserResolvedLoadState,
  requestedUrl: string,
  resolved: EmbeddedBrowserResolvedUrl,
): void {
  if (!resolved.rewritten || resolved.url === requestedUrl) {
    state.requestedUrl = null;
    state.resolvedUrl = null;
    return;
  }
  state.requestedUrl = requestedUrl;
  state.resolvedUrl = resolved.url;
}

function urlsEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

/**
 * URL to hand to the OS (`shell:openExternal`) for the current display URL.
 * While a rewritten load is active the display URL is the requested
 * `localhost`-style URL, which is not reachable from the user's machine in
 * remote mode — external opens must target the resolved daemon/tunnel URL.
 */
export function getEmbeddedBrowserExternalUrl(
  state: EmbeddedBrowserResolvedLoadState,
  displayUrl: string,
): string {
  if (
    state.requestedUrl !== null &&
    state.resolvedUrl !== null &&
    urlsEquivalent(displayUrl, state.requestedUrl)
  ) {
    return state.resolvedUrl;
  }
  return displayUrl;
}

/**
 * Map a webview navigation URL to its display URL. While the navigation
 * matches the resolved URL of the current load, the requested URL is
 * displayed instead; any other navigation (link click, redirect, in-page
 * route change) clears the mapping and displays the real URL. `about:blank`
 * never clears the mapping — Electron emits it for freshly created webviews
 * before the first real load commits.
 */
export function mapEmbeddedBrowserNavigationUrl(
  state: EmbeddedBrowserResolvedLoadState,
  navigatedUrl: string,
): string {
  if (!navigatedUrl || navigatedUrl === 'about:blank') return navigatedUrl;
  if (
    state.requestedUrl !== null &&
    state.resolvedUrl !== null &&
    urlsEquivalent(navigatedUrl, state.resolvedUrl)
  ) {
    return state.requestedUrl;
  }
  state.requestedUrl = null;
  state.resolvedUrl = null;
  return navigatedUrl;
}
