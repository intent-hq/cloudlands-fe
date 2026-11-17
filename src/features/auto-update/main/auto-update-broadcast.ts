/**
 * Auto-Update Renderer Broadcast
 *
 * Delivers auto-update events (toasts, status changes, progress) to every
 * live workspace window instead of a single tracked main-window ref — the
 * user may be focused on a secondary window when an update lands. The HUD
 * pop-out is explicitly excluded: it must never receive update toasts.
 */

import { BrowserWindow } from 'electron';
import { isHudWindow, isTrackedHudWindow } from '../../../main/hud-window';
import { getRendererWebContents } from '../../../main/window-backend';

/**
 * Send an auto-update event to all live (non-destroyed) windows,
 * skipping HUD windows (any backend).
 */
export function broadcastToRenderers(channel: string, ...args: unknown[]): void {
  // isHudWindow() is URL-based and misses a newly registered HUD that is
  // still on about:blank, so also exclude tracked HUD windows —
  // isTrackedHudWindow() covers them even mid-navigation.
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    if (isTrackedHudWindow(window) || isHudWindow(window)) continue;
    for (const contents of getRendererWebContents(window)) {
      if (!contents.isDestroyed()) contents.send(channel, ...args);
    }
  }
}
