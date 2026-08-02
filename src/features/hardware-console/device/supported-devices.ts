/**
 * Supported hardware-console devices.
 *
 * Single source of truth for device matching, shared by the platform-neutral
 * WebHID transport (renderer) and the Electron main-process permission
 * handlers. Keep this module free of Electron and DOM dependencies.
 *
 * Protocol references: cm2-probe (Creator Micro 2, live-verified fw v0.6.0)
 * and work-louder-oai docs/PROTOCOL.md (Codex Micro, fw v0.4.1).
 */

/** Espressif vendor ID used by all Work Louder consoles we support. */
export const HARDWARE_CONSOLE_VENDOR_ID = 0x303a;

/** Vendor HID collection carrying the report-6 JSON-RPC channel. */
export const VENDOR_USAGE_PAGE = 0xff00;
export const VENDOR_USAGE = 0x0001;

export type HardwareConsoleModel = 'creator-micro-2' | 'codex-micro';

export interface SupportedHardwareConsoleDevice {
  vendorId: number;
  productId: number;
  model: HardwareConsoleModel;
  name: string;
}

export const SUPPORTED_HARDWARE_CONSOLE_DEVICES: readonly SupportedHardwareConsoleDevice[] = [
  {
    vendorId: HARDWARE_CONSOLE_VENDOR_ID,
    productId: 0x8297,
    model: 'creator-micro-2',
    name: 'Creator Micro 2',
  },
  {
    vendorId: HARDWARE_CONSOLE_VENDOR_ID,
    productId: 0x8298,
    model: 'creator-micro-2',
    name: 'Creator Micro 2',
  },
  {
    vendorId: HARDWARE_CONSOLE_VENDOR_ID,
    productId: 0x8360,
    model: 'codex-micro',
    name: 'Codex Micro',
  },
];

export function findSupportedHardwareConsoleDevice(
  vendorId: number | undefined,
  productId: number | undefined,
): SupportedHardwareConsoleDevice | undefined {
  return SUPPORTED_HARDWARE_CONSOLE_DEVICES.find(
    (d) => d.vendorId === vendorId && d.productId === productId,
  );
}

export function isSupportedHardwareConsoleDevice(
  vendorId: number | undefined,
  productId: number | undefined,
): boolean {
  return findSupportedHardwareConsoleDevice(vendorId, productId) !== undefined;
}

/**
 * WebHID `requestDevice` filters for the supported devices, scoped to the
 * vendor collection so the chooser (web build) only lists the vendor
 * interface and Electron's silent grant picks the right HIDDevice.
 */
export const HARDWARE_CONSOLE_HID_FILTERS = SUPPORTED_HARDWARE_CONSOLE_DEVICES.map((d) => ({
  vendorId: d.vendorId,
  productId: d.productId,
  usagePage: VENDOR_USAGE_PAGE,
  usage: VENDOR_USAGE,
}));

/**
 * Whether a WebHID device exposes the vendor collection (usage page 0xFF00,
 * usage 0x0001). A physical device surfaces one HIDDevice per top-level
 * collection; only the vendor one carries the report-6 channel.
 */
export function hasVendorCollection(
  collections: readonly { usagePage: number; usage: number }[],
): boolean {
  return collections.some((c) => c.usagePage === VENDOR_USAGE_PAGE && c.usage === VENDOR_USAGE);
}
