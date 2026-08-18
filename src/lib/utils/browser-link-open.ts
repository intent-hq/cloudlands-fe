/**
 * Resolve-then-open for programmatic browser entry points (script
 * detected-URL clicks, terminal links): resolves the URL through
 * `browser:resolve-url` (rewrite → probe → tunnel) BEFORE the tab is opened,
 * surfacing resolver warnings/errors as toasts (intent-hq/monorepo#2404).
 * The embedded browser itself never resolves — it loads exactly the URL it
 * is given.
 */

import { toast } from 'svelte-sonner';
import { m } from '$shared/paraglide/messages.js';
import { resolveBrowserLinkUrl } from './browser-url-resolution';

/** Resolved open target: the URL to load plus the pre-rewrite requested URL. */
export interface ResolvedBrowserLinkTarget {
  /** Final URL to open (the rewritten target even on resolver error). */
  url: string;
  /**
   * Original URL as requested; present only when the URL was rewritten.
   * Persisted with the tab so a restart can re-run the rewrite
   * (intent-hq/monorepo#2789).
   */
  requestedUrl?: string;
}

/**
 * Resolve `rawUrl` for a programmatic browser open and surface resolver
 * feedback: `error` (rewritten target unreachable, probe + tunnel failed)
 * shows an error toast with the resolver's explanation, `warning`
 * (bare-loopback ambiguity in remote mode) shows a warning toast. Always
 * returns a URL to open — on error it is the rewritten target, so the
 * browser's own error page shows instead of a dead silent click. Rewritten
 * resolutions also carry `requestedUrl` for tab persistence.
 */
export async function resolveBrowserLinkForOpen(
  rawUrl: string,
): Promise<ResolvedBrowserLinkTarget> {
  const resolved = await resolveBrowserLinkUrl(
    rawUrl,
    typeof window !== 'undefined' ? window.electronAPI?.invoke : undefined,
  );
  if (resolved.error && resolved.rewritten) {
    toast.error(m.browser_embedded_resolveFailed_error(), { description: resolved.error });
  } else if (resolved.warning) {
    toast.warning(m.browser_linkOpen_loopbackAmbiguity_warning(), {
      description: resolved.warning,
    });
  }
  return {
    url: resolved.url,
    ...(resolved.rewritten && resolved.requestedUrl !== undefined
      ? { requestedUrl: resolved.requestedUrl }
      : {}),
  };
}
