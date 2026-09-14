import { BROWSER_PROTOCOLS } from '../../../shared/constants';

/**
 * Normalize what a user typed into a browser address bar. This is the single
 * normalization path for every address bar (BrowserPanel, EmbeddedBrowser,
 * BrowserViewerTabHeader) — `scripts/check-browser-address-normalization.mjs`
 * rejects inline copies. A bare host gets a protocol — `http://` for loopback
 * hosts, `https://` otherwise — and an input that still does not parse as a
 * URL yields null.
 */
export function normalizeBrowserAddressInput(input: string): string | null {
  let url = input.trim();
  if (!url) return null;
  // Only prepend a protocol if the input doesn't already have one (scheme://...).
  // This avoids turning "file:///path" into "https://file:///path".
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const isLocalhost =
      url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0');
    url = (isLocalhost ? 'http://' : 'https://') + url;
  }
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

export function isValidBrowserUrl(
  targetUrl: string,
  appOrigin = typeof window !== 'undefined' ? window.location.origin : '',
): boolean {
  if (targetUrl === 'about:blank') return true;
  if (!targetUrl) return false;

  try {
    const parsedUrl = new URL(targetUrl);
    return (
      BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.includes(parsedUrl.protocol) &&
      parsedUrl.origin !== appOrigin
    );
  } catch {
    return false;
  }
}
