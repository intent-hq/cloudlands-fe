/**
 * Reactive connected-state of the shared hardware-console manager for UI
 * gating (slot badges, assignment menus). Deliberately keyed off the
 * manager's `connected` status — NOT physical presence (see presence.ts):
 * assignment UI must only show while a device is actually connected and
 * driving LEDs/keys.
 */

import { readable, type Readable } from 'svelte/store';
import { getHardwareConsoleManager } from '../instance';

/**
 * Svelte readable that is `true` while the shared manager is connected.
 * Subscribe at component init; the store tracks status changes for as long
 * as it has subscribers.
 */
export function microConnectedReadable(): Readable<boolean> {
  return readable(false, (set) => {
    const manager = getHardwareConsoleManager();
    set(manager.status === 'connected');
    return manager.onStatusChange((status) => set(status === 'connected'));
  });
}
