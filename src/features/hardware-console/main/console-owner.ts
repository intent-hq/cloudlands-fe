/**
 * Hardware-console owner tracker (main process).
 *
 * Exactly one window — the "console owner" — may process decoded hardware
 * input (intent-hq/monorepo#1928). The owner is the LAST non-HUD window to
 * gain focus ("last-focused", not "currently focused": PTT must keep working
 * when the app is not frontmost), initialized to the first normal window
 * created at boot. HUD pop-outs are never the owner.
 *
 * Renderers learn their own status two ways:
 *   - query:  invoke `hardware-console:get-owner-status` → { isOwner }
 *   - push:   `hardware-console:owner-changed` with a per-webContents
 *             { isOwner } payload whenever ownership changes
 *
 * The tracker itself is Electron-free (structural window type + injected
 * HUD predicate) so it is unit-testable; `setupConsoleOwnerTracking()` wires
 * it to the real `app` events and `ipcMain`.
 */

import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { Logger } from '../../../shared/logger';
import { findExistingHudWindow, isHudWindow } from '../../../main/hud-window';

const logger = new Logger('HardwareConsoleOwner');

// Derived from the shared registry so a rename can't split main and renderer.
export const GET_OWNER_STATUS_CHANNEL = IPC_CHANNELS.HARDWARE_CONSOLE.GET_OWNER_STATUS;
export const OWNER_CHANGED_CHANNEL = IPC_CHANNELS.HARDWARE_CONSOLE.OWNER_CHANGED;

/** Structural subset of Electron's BrowserWindow used by the tracker. */
export interface ConsoleOwnerWindow {
  isDestroyed(): boolean;
  isFocused(): boolean;
  webContents: {
    id: number;
    isDestroyed(): boolean;
    send(channel: string, payload: { isOwner: boolean }): void;
  };
  on(event: 'closed', listener: () => void): void;
}

/**
 * Tracks the console-owner window and pushes per-window { isOwner } payloads
 * on every ownership change. The HUD predicate is injected so tests need no
 * Electron and the wiring can layer URL + tracked-ref HUD detection.
 */
export class ConsoleOwnerTracker<W extends ConsoleOwnerWindow = ConsoleOwnerWindow> {
  private readonly windows = new Set<W>();
  /** Non-HUD focus history, most recently focused first. */
  private focusOrder: W[] = [];
  private owner: W | null = null;

  constructor(private readonly isHud: (win: W) => boolean) {}

  /** Track a window's lifetime. The first non-HUD window becomes the boot owner. */
  registerWindow(win: W): void {
    if (this.windows.has(win) || win.isDestroyed()) return;
    this.windows.add(win);
    win.on('closed', () => this.handleClosed(win));
    if (this.owner === null && !this.isHud(win)) this.setOwner(win);
  }

  /** A window gained focus: non-HUD windows take ownership. */
  handleFocus(win: W): void {
    this.registerWindow(win);
    if (win.isDestroyed()) return;
    if (this.isHud(win)) {
      // A HUD registered before its /hud URL loaded may have been mis-assigned
      // as owner; its first recognizable focus corrects that.
      this.focusOrder = this.focusOrder.filter((w) => w !== win);
      if (this.owner === win) this.setOwner(this.fallbackOwner(win));
      return;
    }
    this.focusOrder = [win, ...this.focusOrder.filter((w) => w !== win)];
    this.setOwner(win);
  }

  /** Whether the given webContents currently owns the console. */
  isOwnerWebContentsId(webContentsId: number): boolean {
    return (
      this.owner !== null &&
      !this.owner.isDestroyed() &&
      this.owner.webContents.id === webContentsId
    );
  }

  private handleClosed(win: W): void {
    this.windows.delete(win);
    this.focusOrder = this.focusOrder.filter((w) => w !== win);
    if (this.owner === win) this.setOwner(this.fallbackOwner(win));
  }

  /**
   * Owner replacement when the owner window goes away: the focused non-HUD
   * window if any, else the most recently focused remaining non-HUD window,
   * else any remaining (never-focused) non-HUD window.
   */
  private fallbackOwner(leaving: W): W | null {
    const candidates = [...this.windows].filter(
      (w) => w !== leaving && !w.isDestroyed() && !this.isHud(w),
    );
    return (
      candidates.find((w) => w.isFocused()) ??
      this.focusOrder.find((w) => candidates.includes(w)) ??
      candidates[0] ??
      null
    );
  }

  private setOwner(next: W | null): void {
    if (next !== null && next.isDestroyed()) next = null;
    if (this.owner === next) return;
    this.owner = next;
    logger.debug(`Console owner changed → webContents ${next?.webContents.id ?? 'none'}`);
    for (const w of this.windows) {
      if (w.isDestroyed() || w.webContents.isDestroyed()) continue;
      try {
        w.webContents.send(OWNER_CHANGED_CHANNEL, { isOwner: w === this.owner });
      } catch (error) {
        // A window torn down mid-broadcast just misses a push it can't use.
        logger.debug('Failed to push owner-changed to a window', error);
      }
    }
  }
}

/**
 * Wire the tracker to the real Electron app events and register the
 * owner-status invoke handler. Call once from app.whenReady(), before any
 * windows are created.
 */
export function setupConsoleOwnerTracking(): ConsoleOwnerTracker<BrowserWindow> {
  // Layered HUD detection: URL check (loaded windows) + the tracked HUD
  // singleton ref (covers the mid-navigation about:blank race).
  const tracker = new ConsoleOwnerTracker<BrowserWindow>(
    (win) => isHudWindow(win) || findExistingHudWindow() === win,
  );
  app.on('browser-window-created', (_event, window) => tracker.registerWindow(window));
  app.on('browser-window-focus', (_event, window) => tracker.handleFocus(window));
  ipcMain.handle(GET_OWNER_STATUS_CHANNEL, (event) => ({
    isOwner: tracker.isOwnerWebContentsId(event.sender.id),
  }));
  return tracker;
}
