/**
 * App history navigation helpers.
 *
 * Maps mouse X buttons (back/forward, `button === 3/4` on macOS/Linux) to
 * `history.back()` / `history.forward()` — the same semantics as the
 * Cmd+Left/Right shortcuts in the root layout. `navigateHistory` is exported
 * separately so other entry points (e.g. the Windows `app-command` → IPC
 * path) can dispatch the same navigation without synthesizing mouse events.
 *
 * Dependency-light on purpose: no stores, services, or side effects at import.
 */

/** Mouse back button (X1) as reported by MouseEvent.button. */
export const MOUSE_BUTTON_BACK = 3;
/** Mouse forward button (X2) as reported by MouseEvent.button. */
export const MOUSE_BUTTON_FORWARD = 4;

export type HistoryDirection = 'back' | 'forward';

/**
 * Same-direction suppression window for `navigateHistory`. On Windows the X
 * buttons can reach us twice per press — as renderer mouse events (buttons
 * 3/4, see electron#17134) AND as an `app-command` forwarded over IPC — so
 * the shared dispatch point dedupes same-direction calls landing within this
 * window to a single history step.
 */
export const NAVIGATION_DEDUPE_WINDOW_MS = 100;

let lastNavigation: { direction: HistoryDirection; at: number } | null = null;

/**
 * Navigate the app history in the given direction. Same-direction calls
 * within NAVIGATION_DEDUPE_WINDOW_MS of the last accepted call are ignored
 * (double-fire dedupe across the mouse-event and app-command → IPC paths).
 */
export function navigateHistory(direction: HistoryDirection): void {
  const now = Date.now();
  if (
    lastNavigation !== null &&
    lastNavigation.direction === direction &&
    now - lastNavigation.at < NAVIGATION_DEDUPE_WINDOW_MS
  ) {
    return;
  }
  lastNavigation = { direction, at: now };
  if (direction === 'back') {
    history.back();
  } else {
    history.forward();
  }
}

/**
 * IPC listener for the Windows path: main forwards `app-command`
 * `browser-backward` / `browser-forward` as 'back' / 'forward' over the
 * `app:history-navigate` channel (IPC_CHANNELS.APP.HISTORY_NAVIGATE). The
 * payload is untyped at the IPC boundary, so anything else is ignored.
 */
export function handleHistoryNavigateIpc(direction: unknown): void {
  if (direction === 'back' || direction === 'forward') {
    navigateHistory(direction);
  }
}

/**
 * Electron does not isolate mouse X buttons to the `<webview>` guest — the
 * host webContents can receive them while the pointer is inside the embedded
 * browser. Skip those events entirely so EmbeddedBrowser keeps navigating its
 * own webview history instead of the app history.
 */
function isWebviewEvent(e: MouseEvent): boolean {
  return e.target instanceof Element && e.target.closest('webview') !== null;
}

/**
 * `mouseup` handler: X back/forward buttons navigate history; other buttons
 * (left/middle/right) and events originating from a `<webview>` are untouched.
 */
export function handleHistoryMouseUp(e: MouseEvent): void {
  if (isWebviewEvent(e)) return;
  if (e.button === MOUSE_BUTTON_BACK) {
    e.preventDefault();
    navigateHistory('back');
  } else if (e.button === MOUSE_BUTTON_FORWARD) {
    e.preventDefault();
    navigateHistory('forward');
  }
}

/**
 * `mousedown` handler: suppress default actions (text selection, focus side
 * effects) for the X buttons only, so the buttons act purely as navigation.
 * Events originating from a `<webview>` are left untouched.
 */
export function handleHistoryMouseDown(e: MouseEvent): void {
  if (isWebviewEvent(e)) return;
  if (e.button === MOUSE_BUTTON_BACK || e.button === MOUSE_BUTTON_FORWARD) {
    e.preventDefault();
  }
}

/**
 * Register window-level mouse X-button history navigation.
 * Listens in the capture phase so component-level `stopPropagation` cannot
 * swallow X-button events before they reach the window.
 * Returns a cleanup function that removes the listeners.
 */
export function attachMouseHistoryNavigation(target: Window = window): () => void {
  target.addEventListener('mouseup', handleHistoryMouseUp, { capture: true });
  target.addEventListener('mousedown', handleHistoryMouseDown, { capture: true });
  return () => {
    target.removeEventListener('mouseup', handleHistoryMouseUp, { capture: true });
    target.removeEventListener('mousedown', handleHistoryMouseDown, { capture: true });
  };
}
