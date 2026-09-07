/**
 * Navigation reconciler of a viewer (mirror) browser tab — REV-2 Model 3.
 *
 * The host's webview is the truth; the daemon registry row carries the URL
 * the host last reported (the *canonical* URL) and the mirror renders its
 * own webview at that URL. Two flows meet in the mirror's webview, and each
 * must not re-trigger the other:
 *
 * - **Follow** (host → mirror): a canonical URL the mirror is not already
 *   targeting is loaded into the mirror webview. The navigations that load
 *   produces (including redirects) are the mirror catching up, not the user
 *   steering, so they are not forwarded.
 * - **Forward** (mirror → host): a main-frame navigation the mirror webview
 *   makes on its own (a link click, back/forward, the address bar) is
 *   forwarded to the host as `browser.navigateTab`. The host navigates and
 *   reports the new URL, which comes back as the canonical URL; since the
 *   mirror already targets it, no follow-load is issued — the loop ends.
 *
 * Every follow-load carries a monotonically increasing `seq` captured when it
 * is issued; the initial `src` load is follow #1. A result (the load's
 * settlement, a guest navigation) is attributed to a follow only while that
 * follow is the *current* one, so a superseded load's late rejection never
 * clears its successor, and a guest navigation is forwarded exactly when it
 * is a main-frame navigation not attributable to a live follow. Forwards are
 * fenced the same way: a rejected `browser.navigateTab` reloads the canonical
 * URL only if no later follow has moved the mirror on since.
 *
 * The module is pure: the component feeds it events and executes the
 * commands it returns, so every race is a unit test over an event log.
 */

export type ViewerNavigationEvent =
  /** The canonical URL (re)rendered, or the webview's readiness changed. */
  | { type: 'canonical'; url: string; webviewReady: boolean }
  /** The mirror webview navigated (`did-navigate` / `did-navigate-in-page`). */
  | { type: 'guest-navigated'; url: string; isMainFrame: boolean }
  /** A follow-load settled: `loadURL` resolved or rejected, or the initial load stopped. */
  | { type: 'follow-settled'; seq: number }
  /** The host answered a forwarded navigation (`ok: false` = rejected or failed). */
  | { type: 'forward-settled'; seq: number; ok: boolean }
  /** The user pressed refresh: reload the canonical URL here and on the host. */
  | { type: 'refresh' };

export type ViewerNavigationCommand =
  /** Load `url` into the mirror webview; report `follow-settled { seq }` when it settles. */
  | { type: 'load'; seq: number; url: string }
  /** Forward `url` to the host; report `forward-settled { seq, ok }` when it answers. */
  | { type: 'forward'; seq: number; url: string };

export interface ViewerNavigationState {
  /** Sequence of the newest follow-load issued (the initial `src` load is 1). */
  followSeq: number;
  /** The follow-load still in flight, or null once it settled. */
  activeFollowSeq: number | null;
  /** Sequence of the newest forward issued. */
  forwardSeq: number;
  /** The newest forward awaiting the host, with the follow sequence at issue time. */
  pendingForward: { seq: number; followSeq: number } | null;
  /** The canonical URL as last rendered (valid or not). */
  canonicalUrl: string | null;
  /** The URL the mirror last committed to — issued as a follow-load or forwarded. */
  targetUrl: string | null;
  /** Where the mirror webview is, as last reported by its main-frame navigations. */
  mirrorUrl: string | null;
  isValidBrowserUrl: (url: string) => boolean;
}

export function createViewerNavigationState(options: {
  isValidBrowserUrl: (url: string) => boolean;
}): ViewerNavigationState {
  return {
    followSeq: 0,
    activeFollowSeq: null,
    forwardSeq: 0,
    pendingForward: null,
    canonicalUrl: null,
    targetUrl: null,
    mirrorUrl: null,
    isValidBrowserUrl: options.isValidBrowserUrl,
  };
}

function issueFollow(state: ViewerNavigationState, url: string): ViewerNavigationCommand {
  state.followSeq += 1;
  state.activeFollowSeq = state.followSeq;
  state.targetUrl = url;
  return { type: 'load', seq: state.followSeq, url };
}

function issueForward(state: ViewerNavigationState, url: string): ViewerNavigationCommand {
  state.forwardSeq += 1;
  state.pendingForward = { seq: state.forwardSeq, followSeq: state.followSeq };
  state.targetUrl = url;
  return { type: 'forward', seq: state.forwardSeq, url };
}

/** Apply one event and return the commands to execute. Mutates `state`. */
export function applyViewerNavigationEvent(
  state: ViewerNavigationState,
  event: ViewerNavigationEvent,
): ViewerNavigationCommand[] {
  switch (event.type) {
    case 'canonical': {
      if (!event.url) return [];
      state.canonicalUrl = event.url;
      // The very first canonical URL is what the webview was created with
      // (`src`): follow #1, already loading, settled by the component.
      if (state.followSeq === 0) {
        state.followSeq = 1;
        state.activeFollowSeq = 1;
        state.targetUrl = event.url;
        return [];
      }
      if (event.url === state.targetUrl) return [];
      // Nothing is consumed while the webview cannot navigate: the readiness
      // flip re-renders the canonical URL, so the change is not lost.
      if (!event.webviewReady) return [];
      if (!state.isValidBrowserUrl(event.url)) return [];
      // The mirror already landed here on its own (a redirect the host also
      // took): adopt the target without reloading. Not while a follow is in
      // flight — the guest may still be about to leave this URL.
      if (state.activeFollowSeq === null && event.url === state.mirrorUrl) {
        state.targetUrl = event.url;
        return [];
      }
      return [issueFollow(state, event.url)];
    }

    case 'guest-navigated': {
      if (!event.isMainFrame || !event.url) return [];
      state.mirrorUrl = event.url;
      if (state.activeFollowSeq !== null) return [];
      return [issueForward(state, event.url)];
    }

    case 'follow-settled': {
      if (event.seq === state.activeFollowSeq) state.activeFollowSeq = null;
      return [];
    }

    case 'forward-settled': {
      const pending = state.pendingForward;
      if (!pending || pending.seq !== event.seq) return [];
      state.pendingForward = null;
      if (event.ok) return [];
      // The host stayed where it was: bring the mirror back to the canonical
      // URL — unless a follow already moved it on, or it is already there.
      if (state.followSeq !== pending.followSeq) return [];
      const canonical = state.canonicalUrl;
      if (!canonical || !state.isValidBrowserUrl(canonical)) return [];
      if (canonical === state.mirrorUrl) {
        state.targetUrl = canonical;
        return [];
      }
      return [issueFollow(state, canonical)];
    }

    case 'refresh': {
      const canonical = state.canonicalUrl;
      if (!canonical || !state.isValidBrowserUrl(canonical)) return [];
      // The mirror reloads as a follow so the resulting navigation is not
      // forwarded again; the host reloads by navigating to its own URL.
      return [issueFollow(state, canonical), issueForward(state, canonical)];
    }
  }
}
