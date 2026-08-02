/**
 * USB-vs-Bluetooth inference for the hardware console.
 *
 * WebHID does not expose the underlying bus, but the number of top-level HID
 * collections the device enumerates differs per transport: the Creator
 * Micro 2 exposes 6 usage pairs over USB and 4 over Bluetooth (live-verified
 * by cm2-probe `enumerate`). Each usage pair surfaces as one granted
 * `HIDDevice`, so counting the granted siblings of the connected device is a
 * workable heuristic. Platform-neutral, no DOM/Electron dependencies.
 */

export type HardwareConsoleTransport = 'usb' | 'bluetooth' | 'unknown';

/**
 * Infer the transport from the number of granted HID collections matching
 * the connected device's VID/PID (see module doc for the counts).
 */
export function inferTransportFromCollectionCount(count: number): HardwareConsoleTransport {
  if (count >= 5) return 'usb';
  if (count >= 1) return 'bluetooth';
  return 'unknown';
}
