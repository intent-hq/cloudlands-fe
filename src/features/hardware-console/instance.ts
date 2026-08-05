/**
 * Renderer-wide shared HardwareConsoleManager singleton.
 *
 * Every hardware-console consumer (connection toasts, LED engine, input
 * wiring) must use this instance instead of constructing its own — the
 * device can only be opened once per window. `manager.start()` is
 * idempotent, so each consumer may call it defensively.
 */

import { HardwareConsoleManager } from './device/device-manager';

let manager: HardwareConsoleManager | null = null;

/**
 * Lazily create the shared manager. When WebHID is unavailable (non-Chromium
 * web build, jsdom tests) the manager reports status `unavailable` and
 * `start()` is a no-op.
 */
export function getHardwareConsoleManager(): HardwareConsoleManager {
  if (!manager) manager = new HardwareConsoleManager();
  return manager;
}
