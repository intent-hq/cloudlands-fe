/**
 * Auto-Update Renderer Broadcast
 *
 * Delivers auto-update events (toasts, status changes, progress) to every
 * live workspace window instead of a single tracked main-window ref — the
 * user may be focused on a secondary window when an update lands. The HUD
 * pop-out is explicitly excluded: it must never receive update toasts.
 */

import { BrowserWindow } from 'electron';
import { findExistingHudWindow, isHudWindow } from '../../../main/hud-window';

/**
 * Send an auto-update event to all live (non-destroyed) windows,
 * skipping the HUD window.
 */
export function broadcastToRenderers(channel: string, ...args: unknown[]): void {
  // isHudWindow() is URL-based and misses a newly registered HUD that is
  // still on about:blank, so also exclude the tracked HUD reference —
  // findExistingHudWindow() returns it even mid-navigation.
  const hudWindow = findExistingHudWindow();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    if (window === hudWindow || isHudWindow(window)) continue;
    window.webContents.send(channel, ...args);
  }
}
