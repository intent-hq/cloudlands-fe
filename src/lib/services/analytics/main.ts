/**
 * Main-process analytics bridge.
 *
 * Segment runs in the renderer process, so this module forwards analytics
 * events from the main process to any open renderer window via IPC.
 * The renderer listens on the 'analytics:track-from-main' channel and
 * calls the real Segment `track()` function.
 */

import { BrowserWindow } from 'electron';
import type { AnalyticsEventName, EventProperties } from './types';

/**
 * Track an analytics event from the main process.
 *
 * Forwards the event to the first available renderer window, which has
 * the Segment client initialized. If no windows are open, the event is
 * silently dropped.
 */
export function trackMain<T extends AnalyticsEventName>(
  event: T,
  properties: EventProperties<T>,
): void {
  try {
    const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    if (windows.length > 0) {
      // Send to the first available window — Segment only needs one
      windows[0].webContents.send('analytics:track-from-main', { event, properties });
    }
  } catch {
    // Silently ignore — analytics should never break main-process logic
  }
}

