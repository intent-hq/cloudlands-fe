import { describe, expect, it } from 'vitest';

import { inferTransportFromCollections } from '../device/transport-heuristic';

/** CM2 USB enumeration: 6 usage pairs (live-verified DeviceUsagePairs). */
const USB_PAIRS = [
  { usagePage: 0x0001, usage: 0x0006 }, // keyboard
  { usagePage: 0x000c, usage: 0x0001 }, // consumer
  { usagePage: 0x0001, usage: 0x0002 }, // mouse (USB-only)
  { usagePage: 0x0001, usage: 0x0001 }, // pointer (USB-only)
  { usagePage: 0x0001, usage: 0x0005 }, // gamepad (USB-only)
  { usagePage: 0xff00, usage: 0x0001 }, // vendor
];

/** BLE surface: 4 pairs, no mouse/pointer/gamepad collections. */
const BLE_PAIRS = [
  { usagePage: 0x0001, usage: 0x0006 },
  { usagePage: 0x000c, usage: 0x0001 },
  { usagePage: 0x000c, usage: 0x0002 },
  { usagePage: 0xff00, usage: 0x0001 },
];

describe('inferTransportFromCollections', () => {
  it('labels the USB enumeration (6 pairs, split or coalesced) usb', () => {
    // Regression: macOS can coalesce the CM2 into ONE IOHIDDevice carrying
    // all 6 usage pairs; the old device-count heuristic saw 1 granted device
    // and said bluetooth (intent-hq/monorepo#1422). Inference is now over
    // the flattened collection list, identical for split and coalesced.
    expect(inferTransportFromCollections(USB_PAIRS)).toBe('usb');
  });

  it('labels the Bluetooth enumeration (4 pairs) bluetooth', () => {
    expect(inferTransportFromCollections(BLE_PAIRS)).toBe('bluetooth');
  });

  it('labels usb from a USB-only collection even in a partial enumeration', () => {
    expect(inferTransportFromCollections([{ usagePage: 0x0001, usage: 0x0002 }])).toBe('usb');
  });

  it('returns unknown for no collections', () => {
    expect(inferTransportFromCollections([])).toBe('unknown');
  });
});
