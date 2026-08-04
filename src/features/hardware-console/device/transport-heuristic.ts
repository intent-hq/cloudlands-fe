/**
 * USB-vs-Bluetooth inference for the hardware console.
 *
 * WebHID does not expose the underlying bus, but the top-level HID
 * collections the device enumerates differ per transport: the Creator
 * Micro 2 exposes 6 usage pairs over USB and 4 over Bluetooth (live-verified
 * by cm2-probe `enumerate`). Inference works on the flattened collection
 * list across all granted devices matching the VID/PID, because macOS may
 * enumerate the pairs as sibling `HIDDevice`s (one collection each) or
 * coalesce them onto a single `IOHIDDevice` (intent-hq/monorepo#1422) —
 * counting granted devices is therefore not reliable. Note the inference
 * describes the granted surfaces, not the active connection: with both
 * surfaces granted and physically present (USB plugged in while BLE is
 * still the live link) the label reads USB. Platform-neutral, no
 * DOM/Electron dependencies.
 */

import type { HidCollectionInfoLike } from './webhid-types';

export type HardwareConsoleTransport = 'usb' | 'bluetooth' | 'unknown';

/** Collections only present on the USB enumeration; the BLE surface exposes
 *  neither mouse {1,2}, pointer {1,1}, nor gamepad {1,5}. */
const USB_ONLY_COLLECTIONS: readonly HidCollectionInfoLike[] = [
  { usagePage: 0x0001, usage: 0x0002 },
  { usagePage: 0x0001, usage: 0x0001 },
  { usagePage: 0x0001, usage: 0x0005 },
];

/**
 * Infer the transport from the flattened top-level collections of all
 * granted HID devices matching the connected device's VID/PID: any USB-only
 * collection means USB; otherwise fall back to the per-transport pair
 * counts (6 over USB, 4 over Bluetooth — see module doc).
 */
export function inferTransportFromCollections(
  collections: readonly HidCollectionInfoLike[],
): HardwareConsoleTransport {
  if (collections.length === 0) return 'unknown';
  const hasUsbOnly = collections.some((c) =>
    USB_ONLY_COLLECTIONS.some((u) => u.usagePage === c.usagePage && u.usage === c.usage),
  );
  if (hasUsbOnly) return 'usb';
  return collections.length >= 5 ? 'usb' : 'bluetooth';
}
