/**
 * Shutdown-time hardware-console lighting clear (main-process side).
 *
 * The console connection lives in the renderer (WebHID), so on quit the main
 * process asks every renderer to send the off-frame before windows are closed:
 * it broadcasts `hardware-console:clear-lighting` to all non-destroyed windows
 * and waits for a `hardware-console:clear-lighting-done` ack from each, bounded
 * by an overall timeout. Fail-soft by design — zero windows, a wedged renderer,
 * or a missing ack must never throw or delay shutdown beyond the timeout.
 *
 * The Electron objects are injected (structural types below) so the wait logic
 * is unit-testable without an electron mock; src/main/index.ts passes the real
 * `BrowserWindow.getAllWindows()` and `ipcMain`.
 */

import { Logger } from '../../../shared/logger';

const logger = new Logger('HardwareConsoleShutdown');

// i18n-ignore (wire/IPC constants)
export const CLEAR_LIGHTING_CHANNEL = 'hardware-console:clear-lighting';
// i18n-ignore (wire/IPC constants)
export const CLEAR_LIGHTING_DONE_CHANNEL = 'hardware-console:clear-lighting-done';

/** Overall ack wait budget — shutdown proceeds regardless once it elapses. */
export const CLEAR_LIGHTING_TIMEOUT_MS = 750;

/** Structural subset of Electron's BrowserWindow used here. */
export interface ClearLightingWindow {
  isDestroyed(): boolean;
  webContents: {
    id: number;
    isDestroyed(): boolean;
    send(channel: string): void;
  };
}

/** Structural subset of Electron's ipcMain used here. */
export interface ClearLightingIpc {
  on(channel: string, listener: (event: { sender: { id: number } }) => void): void;
  removeListener(channel: string, listener: (event: { sender: { id: number } }) => void): void;
}

/**
 * Broadcast the clear-lighting request and wait (bounded) for per-window acks.
 * Always resolves; never rejects.
 */
export async function requestHardwareConsoleLightingClear(
  windows: ClearLightingWindow[],
  ipc: ClearLightingIpc,
  timeoutMs: number = CLEAR_LIGHTING_TIMEOUT_MS,
): Promise<void> {
  try {
    const targets = windows.filter((w) => !w.isDestroyed() && !w.webContents.isDestroyed());
    if (targets.length === 0) {
      logger.debug('No windows to ask for a lighting clear; skipping');
      return;
    }

    const pending = new Set(targets.map((t) => t.webContents.id));

    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (timedOut: boolean) => {
        if (timer !== undefined) clearTimeout(timer);
        ipc.removeListener(CLEAR_LIGHTING_DONE_CHANNEL, onDone);
        if (timedOut) {
          logger.info(
            `Lighting clear ack timeout after ${timeoutMs}ms (${pending.size} window(s) pending); proceeding with shutdown`,
          );
        } else {
          logger.debug('All windows acked lighting clear');
        }
        resolve();
      };

      const onDone = (event: { sender: { id: number } }) => {
        pending.delete(event.sender.id);
        if (pending.size === 0) finish(false);
      };

      ipc.on(CLEAR_LIGHTING_DONE_CHANNEL, onDone);
      timer = setTimeout(() => finish(true), timeoutMs);

      for (const target of targets) {
        try {
          target.webContents.send(CLEAR_LIGHTING_CHANNEL);
        } catch (error) {
          // A window torn down mid-broadcast can't ack; don't wait for it.
          pending.delete(target.webContents.id);
          logger.debug('Failed to send clear-lighting request to a window', error);
        }
      }
      if (pending.size === 0) finish(false);
    });
  } catch (error) {
    logger.info(
      'Lighting clear request failed; proceeding with shutdown',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
