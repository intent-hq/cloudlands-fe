/**
 * Frames registry — main process.
 *
 * A frame is an app window that holds an ordered list of machines and shows
 * one of them. Callers ask this module which machines a frame holds, which one
 * it shows, which frames hold a machine, and which renderer serves a machine
 * in a frame, instead of reading the window's backend stamp.
 *
 * Today's model backs it: the window's own web contents renders the window's
 * stamped backend, and machine-rail views (Labs) render the other machines in
 * its rail. Dependency-light on purpose, like machine-rail-state.ts, so any
 * main module can import it without main/window.ts's module graph.
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
} from './window-backend';

type WindowPredicate = (window: BrowserWindowType) => boolean;

let isNonFrameWindow: WindowPredicate = () => false;

/**
 * Tell the registry which live windows are not frames (dock and capture
 * windows). main/window.ts registers it at load, so this module needs none of
 * those windows' modules.
 */
export function setNonFrameWindowPredicate(predicate: WindowPredicate | null): void {
  isNonFrameWindow = predicate ?? (() => false);
}

/** Whether `window` is a live frame. */
function isFrame(window: BrowserWindowType | null | undefined): window is BrowserWindowType {
  return !!window && !window.isDestroyed() && !isNonFrameWindow(window);
}

/**
 * The machine the frame's own page renders (the window's backend stamp).
 * Transitional: window sessions and backend teardown still key on it until
 * frames stop having an own machine.
 */
export function frameOwnMachine(window: BrowserWindowType): string {
  return getBackendIdForWindow(window);
}

/** The machines `window` holds, in rail order; a window without a rail holds its own machine. */
export function frameMachines(window: BrowserWindowType): string[] {
  return [...readWindowRail(window).machineIds];
}

/** The machine whose renderer `window` shows (the one menu commands and input reach). */
export function shownMachine(window: BrowserWindowType): string {
  const shown = getShownRendererWebContents(window);
  return shown === window.webContents ? frameOwnMachine(window) : getBackendIdForWebContents(shown);
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
  if (isFrame(focused)) return focused;
  const main = getMainWindow();
  return isFrame(main) ? main : null;
}

/**
 * The renderer serving `machineId` in `window`: the window's own web contents
 * for its own machine, else the machine's live view. Null when `window` does
 * not hold the machine or its view has not started yet.
 */
export function rendererFor(
  window: BrowserWindowType,
  machineId: string,
): Electron.WebContents | null {
  if (window.isDestroyed()) return null;
  const [own, ...views] = getRendererWebContents(window);
  if (frameOwnMachine(window) === machineId) return own;
  return views.find((view) => getBackendIdForWebContents(view) === machineId) ?? null;
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
