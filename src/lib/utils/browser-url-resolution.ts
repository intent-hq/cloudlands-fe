/**
 * Renderer-side companion to the `browser:resolve-url` IPC for PROGRAMMATIC
 * browser entry points (script detected-URL clicks, terminal links). URLs are
 * resolved (loopback rewrite → reachability probe → tunnel fallback in the
 * main process) BEFORE a browser tab is opened or navigated; the embedded
 * browser itself loads exactly the URL it is given (intent-hq/monorepo#2404),
 * so user-typed address-bar URLs load literally — except an EXPLICIT
 * `daemon.localhost` / `client.localhost` alias, which is unambiguous and
 * resolves the same way (intent-hq/intent#5710; see
 * `isExplicitLoopbackAliasUrl`).
 *
 * Dependency-light on purpose: the IPC boundary is injected so tests and
 * bridge-less (web) builds degrade to a passthrough resolution.
 */

/**
 * True when `url` targets one of the explicit loopback aliases the main-process
 * resolver rewrites (`daemon.localhost` → daemon host, `client.localhost` →
 * this machine); mirrors the alias branch of `classifyLoopbackHost` in
 * `features/browser/main/loopback-rewrite.ts`, which renderer code cannot
 * import. Bare `127.0.0.1` / `localhost` / `[::1]` are NOT aliases: resolving
 * them from the address bar re-tunnels an already-tunneled URL
 * (intent-hq/monorepo#2404).
 */
export function isExplicitLoopbackAliasUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'daemon.localhost' || host === 'client.localhost';
  } catch {
    return false;
  }
}

/** Wire shape of `browser:resolve-url` (`ResolvedBrowserUrl` in the main process). */
export interface ResolvedBrowserLink {
  /** Final URL to open (the rewritten URL even when `error` is set). */
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
  /** The forward was refused as owner-only (multiplayer w3); `error` is agent-facing, show localized copy instead. */
  forbidden?: boolean;
}

/** Renderer→main invoke boundary (`window.electronAPI.invoke` in Electron). */
export type BrowserResolveInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export const BROWSER_RESOLVE_URL_CHANNEL = 'browser:resolve-url';

function isResolvedBrowserLink(value: unknown): value is ResolvedBrowserLink {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { url?: unknown }).url === 'string' &&
    typeof (value as { rewritten?: unknown }).rewritten === 'boolean'
  );
}

/**
 * Fully resolve a URL through `browser:resolve-url` (rewrite → probe →
 * tunnel) before opening a browser tab on it. Never throws and never blocks
 * an open: without a bridge (web builds), on invoke failure, or on a
 * malformed response the URL passes through unresolved (`rewritten: false`),
 * matching local-mode behavior. Callers should surface `warning`/`error` to
 * the user (toast) and still open `url` — on a probe+tunnel failure it
 * carries the rewritten target, so the browser's own error page shows.
 */
export async function resolveBrowserLinkUrl(
  url: string,
  invoke: BrowserResolveInvoke | undefined,
): Promise<ResolvedBrowserLink> {
  const passthrough: ResolvedBrowserLink = { url, rewritten: false };
  if (!invoke) return passthrough;
  try {
    const result = await invoke(BROWSER_RESOLVE_URL_CHANNEL, { url });
    return isResolvedBrowserLink(result) ? result : passthrough;
  } catch {
    return passthrough;
  }
}

/**
 * Rewrite-only display resolution: apply the loopback rewrite (daemon host
 * instead of loopback in remote mode) with NO probe and NO tunnel, so UI
 * that merely DISPLAYS a URL (e.g. the script detected-URL chip) shows where
 * the link actually points without side effects. Falls back to the input URL
 * on any failure. The full resolve still runs only on click.
 */
export async function rewriteBrowserLinkForDisplay(
  url: string,
  invoke: BrowserResolveInvoke | undefined,
): Promise<string> {
  if (!invoke) return url;
  try {
    const result = await invoke(BROWSER_RESOLVE_URL_CHANNEL, { url, mode: 'rewrite-only' });
    return isResolvedBrowserLink(result) ? result.url : url;
  } catch {
    return url;
  }
}
