import { BrowserWindow, ipcMain } from 'electron';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import { EmptySchema, WindowSetUnifiedWindowLabSchema } from './ipc-schemas';
import { createSafeValidatedHandler } from './ipc-validation-middleware';
import {
  getUnifiedWindowLabEnabledLocalPref,
  setUnifiedWindowLabEnabledLocalPref,
} from './local-prefs';

/** Main owns the Unified window Labs setting; it is off until the user turns it on. */
let enabled = false;
let changeChain: Promise<void> = Promise.resolve();

export function isUnifiedWindowLabEnabled(): boolean {
  return enabled;
}

/** Reads the persisted setting once at startup. A read failure keeps the lab off. */
export async function loadUnifiedWindowLabEnabled(): Promise<boolean> {
  try {
    enabled = await getUnifiedWindowLabEnabledLocalPref();
  } catch {
    enabled = false;
  }
  return enabled;
}

export type UnifiedWindowLabEffects = {
  /** Lab turned off: close the Unified window so it is not restored. */
  disabled(): void;
  /** Either direction: rebuild menus. */
  onChange(): void;
};

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send(WINDOW_CHANNELS.UNIFIED_WINDOW_LAB_CHANGED, { enabled });
  }
}

/** Persists, applies, and announces a change. Changes run one at a time. */
export function setUnifiedWindowLabEnabled(
  next: boolean,
  effects: UnifiedWindowLabEffects,
): Promise<boolean> {
  const change = changeChain.then(async () => {
    if (next === enabled) return;
    await setUnifiedWindowLabEnabledLocalPref(next);
    enabled = next;
    if (!next) effects.disabled();
    effects.onChange();
    broadcast();
  });
  changeChain = change.catch(() => {});
  return change.then(() => enabled);
}

export function registerUnifiedWindowLabHandlers(effects: UnifiedWindowLabEffects): void {
  ipcMain.handle(
    WINDOW_CHANNELS.GET_UNIFIED_WINDOW_LAB,
    createSafeValidatedHandler(
      EmptySchema,
      async () => ({ enabled }),
      WINDOW_CHANNELS.GET_UNIFIED_WINDOW_LAB,
    ),
  );
  ipcMain.handle(
    WINDOW_CHANNELS.SET_UNIFIED_WINDOW_LAB,
    createSafeValidatedHandler(
      WindowSetUnifiedWindowLabSchema,
      async (_event, request) => ({
        enabled: await setUnifiedWindowLabEnabled(request.enabled, effects),
      }),
      WINDOW_CHANNELS.SET_UNIFIED_WINDOW_LAB,
    ),
  );
}

export function _resetUnifiedWindowLabForTests(): void {
  enabled = false;
  changeChain = Promise.resolve();
}
