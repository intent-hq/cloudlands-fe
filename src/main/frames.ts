/**
 * Frames registry — main process.
 *
 * A frame is an app window that holds an ordered list of machines and shows
 * one of them. Its own web contents is the frame page (backdrop only, bound to
 * no machine); every machine it holds, the local one included, is a view
 * inside it. Callers ask this module which machines a frame holds, which one
 * it shows, which frames hold a machine, and which renderer serves a machine
 * in a frame, instead of reading a window's backend stamp. Dock, HUD and
 * capture windows are not frames: they keep their stamp.
 *
 * Dependency-light on purpose, like machine-rail-state.ts, so any main module
 * can import it without main/window.ts's module graph.
 */

import { app, BrowserWindow } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { readWindowRail } from './machine-rail-state';
import { getAppWindows } from './offscreen-window';
import { getMainWindow } from './state';
import {
  getBackendIdForWebContents,
  getBackendIdForWindow,
  getRendererWebContents,
  getShownRendererWebContents,
  isFrameWindow,
} from './window-backend';

/** Whether `window` is a live frame. */
export function isFrame(window: BrowserWindowType | null | undefined): boolean {
  return !!window && !window.isDestroyed() && isFrameWindow(window);
}

/** The machines `window` holds, in rail order; empty for a window that is not a frame. */
export function frameMachines(window: BrowserWindowType): string[] {
  return [...readWindowRail(window).machineIds];
}

/**
 * The machine whose renderer `window` shows (the one menu commands and input
 * reach). A window that is not a frame shows the machine it is stamped with.
 */
export function shownMachine(window: BrowserWindowType): string {
  if (!isFrameWindow(window)) return getBackendIdForWindow(window);
  const shown = getShownRendererWebContents(window);
  if (shown !== window.webContents) return getBackendIdForWebContents(shown);
  return readWindowRail(window).selectedId;
}

/** The machines `window` renders: a frame's machines, or the machine any other window is bound to. */
export function windowMachines(window: BrowserWindowType): string[] {
  return isFrameWindow(window) ? frameMachines(window) : [getBackendIdForWindow(window)];
}

/** Every live frame that holds `machineId`, in window order. */
export function framesHolding(machineId: string): BrowserWindowType[] {
  return getAppWindows().filter(
    (window) => isFrame(window) && frameMachines(window).includes(machineId),
  );
}

/** The focused frame, else the main window when it is a frame, else null. */
export function focusedFrame(): BrowserWindowType | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && isFrame(focused)) return focused;
  const main = getMainWindow();
  return main && isFrame(main) ? main : null;
}

/**
 * The view serving `machineId` in `window`. Null when `window` does not hold
 * the machine or its view has not started yet.
 */
export function rendererFor(
  window: BrowserWindowType,
  machineId: string,
): Electron.WebContents | null {
  if (window.isDestroyed() || !isFrameWindow(window)) return null;
  return (
    getRendererWebContents(window).find((view) => getBackendIdForWebContents(view) === machineId) ??
    null
  );
}

/** Live windows that are not frames (dock, HUD, capture, dev console) stamped with `machineId`. */
function otherWindowsOn(machineId: string): BrowserWindowType[] {
  return getAppWindows().filter(
    (window) =>
      !window.isDestroyed() &&
      !isFrameWindow(window) &&
      getBackendIdForWindow(window) === machineId,
  );
}

/** Whether a frame holds `machineId` or another window (dock, HUD) is bound to it. */
export function isMachineInUse(machineId: string): boolean {
  return framesHolding(machineId).length > 0 || otherWindowsOn(machineId).length > 0;
}

/** Whether any renderer serves `machineId`: a frame's view of it, or a window bound to it. */
export function isMachineRendered(machineId: string): boolean {
  return (
    framesHolding(machineId).some((frame) => rendererFor(frame, machineId) !== null) ||
    otherWindowsOn(machineId).length > 0
  );
}

/** When each frame was last focused (a rising counter, not a clock). */
const lastFocused = new WeakMap<BrowserWindowType, number>();
let focusCount = 0;
let trackingFocus = false;

/**
 * Record that `window` was just focused.
 *
 * @internal Test seam; production records focus through {@link trackFrameFocus}.
 */
export function noteFrameFocused(window: BrowserWindowType): void {
  lastFocused.set(window, ++focusCount);
}

/** Start recording which frame was focused last. Safe to call more than once. */
export function trackFrameFocus(): void {
  if (trackingFocus) return;
  trackingFocus = true;
  app.on('browser-window-focus', (_event, window) => noteFrameFocused(window));
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) noteFrameFocused(focused);
}

/**
 * Every live frame, the most recently focused first. Frames not focused since
 * {@link trackFrameFocus} started keep window order after them.
 */
export function framesByRecentFocus(): BrowserWindowType[] {
  return getAppWindows()
    .filter(isFrame)
    .sort((a, b) => (lastFocused.get(b) ?? 0) - (lastFocused.get(a) ?? 0));
}
