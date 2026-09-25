/**
 * Battery power signal (main process).
 *
 * Mirrors Electron's `powerMonitor` battery state to every renderer window so
 * the UI can reduce motion while on battery:
 *   - query:  invoke `power:get-battery-state` → { onBattery }
 *   - push:   `power:battery-changed` { onBattery } on every on-battery /
 *             on-ac transition, and once to each new window after its first
 *             load (a send before the renderer is listening would be lost).
 *
 * The broadcaster is Electron-free (structural power monitor + window types)
 * so it is unit-testable; `setupPowerStateIPC()` wires it to the real
 * `powerMonitor`, `app` and `ipcMain`.
 */

import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron';

import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { EmptySchema } from '../../../main/ipc-schemas';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { Logger } from '../../../shared/logger';

const logger = new Logger('PowerState');

// Derived from the shared registry so a rename can't split main and renderer.
export const GET_BATTERY_STATE_CHANNEL = IPC_CHANNELS.POWER.GET_BATTERY_STATE;
export const BATTERY_CHANGED_CHANNEL = IPC_CHANNELS.POWER.BATTERY_CHANGED;

export interface BatteryState {
  onBattery: boolean;
}

/** Structural subset of Electron's powerMonitor used by the broadcaster. */
export interface PowerMonitorLike {
  isOnBatteryPower(): boolean;
  on(event: 'on-battery' | 'on-ac', listener: () => void): unknown;
}

/** Structural subset of Electron's BrowserWindow used by the broadcaster. */
export interface PowerStateWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string, payload: BatteryState): void;
    on(event: 'did-finish-load', listener: () => void): unknown;
  };
}

/**
 * Tracks the battery state and pushes { onBattery } to every live window on
 * each transition. `getWindows` is injected so tests need no Electron.
 */
export class PowerStateBroadcaster<W extends PowerStateWindow = PowerStateWindow> {
  private onBattery: boolean;

  constructor(
    private readonly monitor: PowerMonitorLike,
    private readonly getWindows: () => readonly W[],
  ) {
    this.onBattery = monitor.isOnBatteryPower();
    monitor.on('on-battery', () => this.setOnBattery(true));
    monitor.on('on-ac', () => this.setOnBattery(false));
  }

  getState(): BatteryState {
    return { onBattery: this.onBattery };
  }

  /** Push the current state to a new window once its renderer has loaded. */
  registerWindow(win: W): void {
    win.webContents.on('did-finish-load', () => this.sendTo(win));
  }

  private setOnBattery(onBattery: boolean): void {
    if (this.onBattery === onBattery) return;
    this.onBattery = onBattery;
    logger.debug(`Battery state changed → onBattery=${onBattery}`);
    for (const win of this.getWindows()) this.sendTo(win);
  }

  private sendTo(win: W): void {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(BATTERY_CHANGED_CHANNEL, this.getState());
  }
}

/** Wire the broadcaster to Electron. Call after `app` is ready. */
export function setupPowerStateIPC(): PowerStateBroadcaster<BrowserWindow> {
  const broadcaster = new PowerStateBroadcaster<BrowserWindow>(powerMonitor, () =>
    BrowserWindow.getAllWindows(),
  );
  app.on('browser-window-created', (_event, window) => broadcaster.registerWindow(window));
  ipcMain.handle(
    GET_BATTERY_STATE_CHANNEL,
    createSafeValidatedHandler(
      EmptySchema,
      async () => broadcaster.getState(),
      GET_BATTERY_STATE_CHANNEL,
    ),
  );
  return broadcaster;
}
