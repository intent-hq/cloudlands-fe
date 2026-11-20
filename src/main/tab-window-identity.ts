/**
 * Tab window identity — main process.
 *
 * A tab window is a frame that shows one panel tab (shared/types/tab-window.ts).
 * Frame pickers skip it: deep links, notifications and "open this machine"
 * go to a normal frame, never to a tab window. The registry
 * (tab-windows.ts) also gives window.ts what a tab window saves and how it
 * comes back, through the seam below, so window.ts does not import the
 * registry's module graph.
 */

import type { BrowserWindow } from 'electron';
import type { TabWindowRecord } from '../shared/types/tab-window';

const tabWindows = new WeakSet<BrowserWindow>();

/** Mark `window` as a tab window. Call before its machine view loads. */
export function markTabWindow(window: BrowserWindow): void {
  tabWindows.add(window);
}

/** Whether `window` is a tab window. */
export function isTabWindow(window: BrowserWindow | null | undefined): boolean {
  return !!window && tabWindows.has(window);
}

/** What window.ts needs from the tab window registry. */
export interface TabWindowSessions {
  /** The record a tab window saves, or null for any other window. */
  sessionFor(window: BrowserWindow): TabWindowRecord | null;
  /**
   * A saved tab window is about to reopen on `backendId`: register it
   * (open while it restores). False when it cannot come back (its tab
   * is already in another tab window).
   */
  willRestore(record: TabWindowRecord, backendId: string): boolean;
  /** The saved tab window reopened as `window`. */
  restored(window: BrowserWindow, tabWindowId: string): void;
  /** A saved tab window could not reopen (its frame failed or was skipped). */
  restoreFailed(tabWindowId: string): void;
}

let sessions: TabWindowSessions | null = null;

/** Registered once by the tab window IPC at startup. */
export function setTabWindowSessions(next: TabWindowSessions | null): void {
  sessions = next;
}

/** The registry seam, or null before it is registered (tests, early boot). */
export function getTabWindowSessions(): TabWindowSessions | null {
  return sessions;
}
