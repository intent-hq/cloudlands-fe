/**
 * Platform seam for WebHID access.
 *
 * The transport core is written against this small interface instead of
 * `navigator.hid` directly. The behavior difference between builds lives
 * entirely outside this module:
 *  - Electron: the main process auto-grants our VID/PIDs
 *    (`select-hid-device` handler), so `requestDevice()` resolves silently.
 *  - Web: `requestDevice()` opens the browser chooser and must be called
 *    from a user gesture.
 *  - No WebHID (`navigator.hid` absent): `createWebHidPlatform()` returns
 *    `null` and the feature is disabled.
 */

import {
  HARDWARE_CONSOLE_HID_FILTERS,
  hasVendorCollection,
  isSupportedHardwareConsoleDevice,
} from './supported-devices';
import type { HidConnectionEventLike, HidDeviceLike, WebHidApiLike } from './webhid-types';

export interface HidPlatform {
  /** Devices the page already has permission for. */
  getDevices(): Promise<HidDeviceLike[]>;
  /**
   * Ask for access to a supported device. Silent in Electron; shows the
   * chooser (and requires a user gesture) on the web build. Resolves `null`
   * when nothing suitable was granted.
   */
  requestDevice(): Promise<HidDeviceLike | null>;
  onConnect(listener: (device: HidDeviceLike) => void): () => void;
  onDisconnect(listener: (device: HidDeviceLike) => void): () => void;
}

/** Pick the supported vendor-collection HIDDevice out of a device list. */
export function selectVendorDevice(devices: readonly HidDeviceLike[]): HidDeviceLike | null {
  return (
    devices.find(
      (d) =>
        isSupportedHardwareConsoleDevice(d.vendorId, d.productId) &&
        hasVendorCollection(d.collections),
    ) ?? null
  );
}

/** Read `navigator.hid` if the runtime exposes WebHID; `null` otherwise. */
export function getNavigatorHid(): WebHidApiLike | null {
  if (typeof navigator === 'undefined') return null;
  const hid = (navigator as { hid?: WebHidApiLike }).hid;
  return hid ?? null;
}

/**
 * Create the WebHID-backed platform, or `null` when WebHID is unavailable
 * (feature disabled). Pass a custom `hid` for tests.
 */
export function createWebHidPlatform(
  hid: WebHidApiLike | null = getNavigatorHid(),
): HidPlatform | null {
  if (!hid) return null;
  const subscribe = (
    type: 'connect' | 'disconnect',
    listener: (device: HidDeviceLike) => void,
  ): (() => void) => {
    const wrapped = (event: HidConnectionEventLike): void => listener(event.device);
    hid.addEventListener(type, wrapped);
    return () => hid.removeEventListener(type, wrapped);
  };
  return {
    getDevices: () => hid.getDevices(),
    requestDevice: async () => {
      const granted = await hid.requestDevice({ filters: [...HARDWARE_CONSOLE_HID_FILTERS] });
      return selectVendorDevice(granted);
    },
    onConnect: (listener) => subscribe('connect', listener),
    onDisconnect: (listener) => subscribe('disconnect', listener),
  };
}
