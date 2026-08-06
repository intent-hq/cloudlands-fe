/**
 * Windows mouse X-button history navigation.
 *
 * On Windows, mouse back/forward (X1/X2) presses arrive as an Electron
 * `app-command` event (`browser-backward` / `browser-forward`) on the
 * BrowserWindow and never reach the renderer as mouse events. This module
 * forwards them over IPC (`app:history-navigate`, payload 'back' | 'forward')
 * so the renderer performs `history.back()` / `history.forward()` — identical
 * behavior to the renderer mouse path in `$lib/utils/history-navigation.ts`.
 * Main deliberately does NOT call `webContents.navigationHistory` itself.
 *
 * Attached to every window via `app.on('browser-window-created')` in
 * `src/main/index.ts`. Registration is gated to Windows: Electron also emits
 * `app-command` on Linux (electron#18322), where the X buttons ALREADY reach
 * the renderer as mouse events — registering there would double-fire (two
 * history steps per press). macOS/Linux use the renderer mouse-event path only.
 */
import type { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc-registry';

export type AppCommandHistoryDirection = 'back' | 'forward';

/**
 * Map an `app-command` command name to a history direction.
 * Returns null for every command other than the two browser history ones.
 */
export function historyDirectionForAppCommand(
  command: string,
): AppCommandHistoryDirection | null {
  if (command === 'browser-backward') return 'back';
  if (command === 'browser-forward') return 'forward';
  return null;
}

/**
 * Forward `browser-backward` / `browser-forward` app-commands on `window`
 * to its renderer as `app:history-navigate` IPC events. No-op unless
 * `platform` is 'win32' (see the Linux double-fire note above).
 */
export function attachAppCommandHistoryNavigation(
  window: BrowserWindow,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') return;
  window.on('app-command', (_event, command) => {
    const direction = historyDirectionForAppCommand(command);
    if (direction === null) return;
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(IPC_CHANNELS.APP.HISTORY_NAVIGATE, direction);
  });
}
