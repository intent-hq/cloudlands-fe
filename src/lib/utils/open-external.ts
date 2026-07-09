/**
 * Single opener for external (system-browser) URLs — every `shell:openExternal`
 * caller converges here via the host-bridge-seeder handler, so ProviderCard
 * docs links, GitHubRepoTab preview links, PanelTabBar/EmbeddedBrowser "open
 * externally", GitHubAuthModal, terminal link handlers, etc. all behave the
 * same way.
 *
 * PROTOCOL §5.14 defines `host.openExternal` as a daemon→client reverse RPC
 * ("FE-served"): the CLIENT owns opening URLs, so this never calls the daemon.
 * Resolution order:
 *   1. Validate the scheme — only http/https (`BROWSER_PROTOCOLS.EXTERNAL`)
 *      may be shell-opened; anything else throws.
 *   2. Real Electron preload bridge (`window.electronAPI.invoke`) when
 *      present — routes to main-process `shell.openExternal`
 *      (features/system/main/system.ipc.ts), the canonical desktop path.
 *   3. `window.open(url, "_blank")` — the browser-context fallback (vite dev,
 *      FE served without a preload).
 *   4. A synthetic anchor click when `window.open` is refused. Electron hosts
 *      commonly deny `window.open` from a window-open handler *after* routing
 *      the URL to the system browser themselves, so a `null` handle does not
 *      mean the URL failed to open — treating it as fatal is what produced the
 *      "Unable to open external URL in this build" regression. The anchor
 *      click is best-effort; it resolves rather than throwing.
 */
import { BROWSER_PROTOCOLS } from '$shared/constants';

export async function openExternalUrl(url: string): Promise<void> {
  if (!url) throw new Error('Missing required parameter: url');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid external URL: ${url}`);
  }
  if (!BROWSER_PROTOCOLS.EXTERNAL.includes(parsed.protocol)) {
    throw new Error(`Refusing to open non-http(s) URL externally: ${parsed.protocol}`);
  }
  if (typeof window === 'undefined') {
    throw new Error('Unable to open external URL outside a window context');
  }

  const bridge = window.electronAPI;
  if (bridge && typeof bridge.invoke === 'function') {
    try {
      const result = await bridge.invoke('shell:openExternal', { url });
      if (result && result.success === true) return;
    } catch {
      // Preload bridge refused the channel — fall through to window.open.
    }
  }

  const opened = window.open(url, '_blank');
  if (opened) {
    opened.opener = null;
    return;
  }

  // window.open was refused (popup policy / host window-open handler). Fire a
  // best-effort anchor click, which some hosts allow where window.open is
  // denied; either way the host may already have opened the URL externally.
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
