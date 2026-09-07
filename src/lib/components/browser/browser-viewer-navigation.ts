/**
 * Navigation bookkeeping of a viewer (mirror) browser tab — REV-2 Model 3.
 *
 * The host's webview is the truth; the daemon registry row carries the URL
 * the host last reported (the *canonical* URL) and the mirror renders its
 * own webview at that URL. Two flows meet in the mirror's webview, and each
 * must not re-trigger the other:
 *
 * - **Follow** (host → mirror): a canonical URL the mirror is not already
 *   showing is loaded into the mirror webview. The navigations that load
 *   produces (including redirects) are the mirror catching up, not the user
 *   steering, so they are not forwarded.
 * - **Forward** (mirror → host): a navigation the mirror webview makes on its
 *   own (a link click, back/forward) is forwarded to the host as
 *   `browser.navigateTab`. The host navigates and reports the new URL, which
 *   comes back as the canonical URL; since the mirror already shows it, no
 *   follow-load is issued — the loop terminates.
 *
 * A canonical URL is applied at most once (`appliedCanonicalUrl`), so a
 * redirect on the mirror (canonical `/a`, mirror lands on `/a/`) does not
 * make every later reconcile re-load `/a` and redirect again.
 */

export interface ViewerNavigationState {
  /** The canonical URL last consumed by the reconcile (loaded or already shown). */
  appliedCanonicalUrl: string | null;
  /** Where the mirror webview is, as last reported by its navigation events. */
  mirrorUrl: string | null;
  /** A follow-load is in flight; its navigations are follows, not forwards. */
  following: boolean;
}

export interface ViewerFollowDecision {
  shouldLoad: boolean;
  targetUrl: string | null;
}

export function createViewerNavigationState(): ViewerNavigationState {
  return { appliedCanonicalUrl: null, mirrorUrl: null, following: false };
}

/**
 * The canonical URL (re)rendered: decide whether the mirror webview must load
 * it. Nothing is consumed while the webview is not ready — the readiness
 * flip re-runs the reconcile — so a canonical change that lands during the
 * mirror's initial load is not lost. The very first canonical URL is what
 * the webview was created with (`src`), so it is recorded as shown, not
 * loaded again.
 */
export function reconcileViewerCanonicalUrl(
  state: ViewerNavigationState,
  canonicalUrl: string,
  options: { webviewReady: boolean; isValidBrowserUrl: (url: string) => boolean },
): ViewerFollowDecision {
  const noLoad: ViewerFollowDecision = { shouldLoad: false, targetUrl: null };
  if (!canonicalUrl) return noLoad;
  if (state.appliedCanonicalUrl === null) {
    state.appliedCanonicalUrl = canonicalUrl;
    state.mirrorUrl = canonicalUrl;
    return noLoad;
  }
  if (canonicalUrl === state.appliedCanonicalUrl) return noLoad;
  if (!options.webviewReady) return noLoad;
  state.appliedCanonicalUrl = canonicalUrl;
  if (canonicalUrl === state.mirrorUrl) return noLoad;
  if (!options.isValidBrowserUrl(canonicalUrl)) return noLoad;
  state.following = true;
  return { shouldLoad: true, targetUrl: canonicalUrl };
}

/**
 * The mirror webview navigated (`did-navigate` / `did-navigate-in-page`).
 * Returns whether to forward the URL to the host: not while a follow-load is
 * in flight, and not for the URL the host already reports.
 */
export function recordViewerNavigation(
  state: ViewerNavigationState,
  navigatedUrl: string,
): { forward: boolean } {
  state.mirrorUrl = navigatedUrl;
  if (state.following) return { forward: false };
  if (navigatedUrl === state.appliedCanonicalUrl) return { forward: false };
  return { forward: true };
}

/** A follow-load settled (`did-stop-loading`, or `loadURL` rejected). */
export function completeViewerFollow(state: ViewerNavigationState): void {
  state.following = false;
}
