/**
 * Physical device presence for the hardware settings section gate.
 *
 * Presence means a supported console is actually reachable: the shared
 * manager is connected/connecting, or WebHID `getDevices()` lists a granted
 * supported device (in Electron our VID/PIDs are silently granted, so this
 * reflects physical presence). Deliberately keyed off presence rather than
 * the manager's connected status, with its own hotplug subscription —
 * `manager.stop()` (integration toggle off) closes the device and drops the
 * manager's hotplug listeners, but the section must stay visible so the user
 * can re-enable the integration.
 */

import type { HardwareConsoleManager } from './device-manager';
import { createWebHidPlatform, selectVendorDevice, type HidPlatform } from './platform';

/**
 * Watch whether a supported device is physically present. Emits the current
 * value asynchronously on subscribe and again on every WebHID hotplug or
 * manager status change. Returns an unsubscribe function.
 */
export function watchSupportedDevicePresence(
  manager: HardwareConsoleManager,
  onChange: (present: boolean) => void,
  platform: HidPlatform | null = createWebHidPlatform(),
): () => void {
  if (!platform) {
    onChange(false);
    return () => {};
  }
  let disposed = false;
  const refresh = async (): Promise<void> => {
    const managerActive = manager.status === 'connected' || manager.status === 'connecting';
    const granted = await platform.getDevices();
    if (disposed) return;
    onChange(managerActive || selectVendorDevice(granted) !== null);
  };
  const unsubs = [
    platform.onConnect(() => void refresh()),
    platform.onDisconnect(() => void refresh()),
    manager.onStatusChange(() => void refresh()),
  ];
  void refresh();
  return () => {
    disposed = true;
    for (const unsub of unsubs) unsub();
  };
}
