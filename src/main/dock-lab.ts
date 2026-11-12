import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import { EmptySchema, WindowSetDockLabSchema } from './ipc-schemas';
import { createSafeValidatedHandler } from './ipc-validation-middleware';
import { getDockLabEnabledLocalPref, setDockLabEnabledLocalPref } from './local-prefs';

/** Main owns the dock Labs setting; it is off until the user turns it on. */
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
  /** Launch with the lab on: show the dock unless a hide was saved; true when shown. */
  restore(): Promise<boolean>;
  /** Whether a request came from the dock itself (its intro's "Turn off"). */
  isDock(sender: WebContents): boolean;
};

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send(WINDOW_CHANNELS.DOCK_LAB_CHANGED, { enabled });
  }
}

/** Persists, applies, and announces a change. Changes run one at a time. */
function setDockLabEnabled(
  next: boolean,
  effects: DockLabEffects,
  fromDock = false,
): Promise<boolean> {
  const change = changeChain.then(async () => {
    if (next === enabled) return;
    // From elsewhere (Settings), stop capture immediately on a requested disable,
    // even if saving fails. The cached preference stays truthful and the same
    // request remains retryable.
    if (!next && !fromDock) effects.hide();
    await setDockLabEnabledLocalPref(next);
    enabled = next;
    if (next) await effects.show();
    // The dock asking to turn itself off is the caller: close it only once the save
    // is confirmed, so a failed save leaves it (and its intro) open to retry.
    if (!next && fromDock) effects.hide();
    effects.onChange();
    broadcast();
  });
  changeChain = change.catch(() => {});
  return change.then(() => enabled);
}

let registeredEffects: DockLabEffects | null = null;

/**
 * Main's own change (the dock's Hide, the Window menu): hiding the dock is the same
 * setting as Notch dock. Like a turn-off from Settings, the dock closes at once even
 * if the save fails.
 */
export function changeDockLabEnabled(next: boolean): Promise<boolean> {
  if (!registeredEffects) return Promise.reject(new Error('Dock lab handlers are not registered'));
  return setDockLabEnabled(next, registeredEffects);
}

/**
 * Launch: with the lab on, restore the dock. A hide saved by an older build (lab on,
 * dock hidden) turns the lab off, so Settings never shows Notch dock on with no dock.
 */
export async function startDockLab(): Promise<void> {
  if (!registeredEffects || !enabled) return;
  // A failed save leaves the lab on (truthful); the launch continues.
  if (!(await registeredEffects.restore())) await changeDockLabEnabled(false).catch(() => {});
}

export function registerDockLabHandlers(effects: DockLabEffects): void {
  registeredEffects = effects;
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
      async (event, request) => ({
        enabled: await setDockLabEnabled(request.enabled, effects, effects.isDock(event.sender)),
      }),
      WINDOW_CHANNELS.SET_DOCK_LAB,
    ),
  );
}
