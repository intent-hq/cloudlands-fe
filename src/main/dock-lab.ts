import { BrowserWindow, ipcMain } from 'electron';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import { EmptySchema, WindowSetDockLabSchema } from './ipc-schemas';
import { createSafeValidatedHandler } from './ipc-validation-middleware';
import { getDockLabEnabledLocalPref, setDockLabEnabledLocalPref } from './local-prefs';

/** Main owns the experimental dock Labs setting; it is off until the user turns it on. */
let enabled = false;
let changeChain: Promise<void> = Promise.resolve();

export function isDockLabEnabled(): boolean {
  return enabled;
}

/** Reads the persisted setting once at startup. A read failure keeps the lab off. */
export async function loadDockLabEnabled(): Promise<boolean> {
  try {
    enabled = await getDockLabEnabledLocalPref();
  } catch {
    enabled = false;
  }
  return enabled;
}

export type DockLabEffects = {
  /** Lab turned on: show the dock. */
  show(): Promise<void>;
  /** Lab turned off: close the dock without recording a user hide. */
  hide(): void;
  /** Either direction: rebuild the menu. */
  onChange(): void;
};

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send(WINDOW_CHANNELS.DOCK_LAB_CHANGED, { enabled });
  }
}

/** Persists, applies, and announces a change. Changes run one at a time. */
function setDockLabEnabled(next: boolean, effects: DockLabEffects): Promise<boolean> {
  const change = changeChain.then(async () => {
    if (next === enabled) return;
    // Stop capture immediately on a requested disable, even if saving fails.
    // The cached preference stays truthful and the same request remains retryable.
    if (!next) effects.hide();
    await setDockLabEnabledLocalPref(next);
    enabled = next;
    if (next) await effects.show();
    effects.onChange();
    broadcast();
  });
  changeChain = change.catch(() => {});
  return change.then(() => enabled);
}

export function registerDockLabHandlers(effects: DockLabEffects): void {
  ipcMain.handle(
    WINDOW_CHANNELS.GET_DOCK_LAB,
    createSafeValidatedHandler(
      EmptySchema,
      async () => ({ enabled }),
      WINDOW_CHANNELS.GET_DOCK_LAB,
    ),
  );
  ipcMain.handle(
    WINDOW_CHANNELS.SET_DOCK_LAB,
    createSafeValidatedHandler(
      WindowSetDockLabSchema,
      async (_event, request) => ({ enabled: await setDockLabEnabled(request.enabled, effects) }),
      WINDOW_CHANNELS.SET_DOCK_LAB,
    ),
  );
}
