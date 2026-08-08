/**
 * macOS swipe-gesture history navigation.
 *
 * On macOS, Logi Options+ (like SensibleSideButtons) does not pass mouse
 * back/forward side buttons through as button events — it converts each press
 * into a synthesized system swipe gesture, so no button-3/4 mouse event ever
 * reaches the renderer (intent-hq/monorepo#1681). Those gestures (and
 * old-style discrete three-finger trackpad swipes) surface as the Electron
 * BrowserWindow `swipe` event. This module forwards them over IPC
 * (`app:history-navigate`, payload 'back' | 'forward') so the renderer
 * performs `history.back()` / `history.forward()` — mirroring the Windows
 * `app-command` path in `src/main/app-command-navigation.ts`. The shared
 * dispatch in `$lib/utils/history-navigation.ts` dedupes same-direction calls
 * within 100ms, so mice that deliver both raw X-button events and synthesized
 * swipes cannot double-step.
 *
 * Direction mapping — 'left' means BACK, 'right' means FORWARD:
 * - SensibleSideButtons (same synthesized-gesture mechanism as Logi Options+)
 *   maps the back button to `kTLInfoSwipeLeft` and the forward button to
 *   `kTLInfoSwipeRight` (SideButtonFixer/AppDelegate.m), i.e. the system
 *   gesture that navigates BACK in Safari/Finder is the "swipe left" one.
 * - AppKit names discrete swipes the same way: NSEvent `deltaX` is +1 for
 *   swipe-left and -1 for swipe-right ("Handling Trackpad Events", NSEvent.h).
 * - Electron emits exactly those names: deltaX == 1.0 → 'left', -1.0 →
 *   'right' (shell/browser/ui/cocoa/electron_ns_window.mm,
 *   swiz_nsview_swipeWithEvent).
 * - Precedent: VS Code's macOS swipe listener maps 'left' → previous /
 *   'right' → next (windowImpl.ts, added for microsoft/vscode#116507 — the
 *   same Logitech Options mouse-button scenario).
 *
 * Attached to every window via `app.on('browser-window-created')` in
 * `src/main/index.ts`. Registration is gated to macOS: the `swipe` event is
 * darwin-only in Electron, and other platforms keep their existing paths
 * (Windows `app-command`, Linux renderer mouse events).
 */
import type { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc-registry';

export type SwipeHistoryDirection = 'back' | 'forward';

/**
 * Map a `swipe` event direction to a history direction.
 * Returns null for vertical swipes ('up' / 'down') and anything unexpected.
 */
export function historyDirectionForSwipe(direction: string): SwipeHistoryDirection | null {
  if (direction === 'left') return 'back';
  if (direction === 'right') return 'forward';
  return null;
}

/**
 * Forward horizontal `swipe` gestures on `window` to its renderer as
 * `app:history-navigate` IPC events. No-op unless `platform` is 'darwin'
 * (see the direction-mapping note above).
 */
export function attachSwipeHistoryNavigation(
  window: BrowserWindow,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'darwin') return;
  window.on('swipe', (_event, direction) => {
    const historyDirection = historyDirectionForSwipe(direction);
    if (historyDirection === null) return;
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(IPC_CHANNELS.APP.HISTORY_NAVIGATE, historyDirection);
  });
}
