/**
 * Electron main-process WebHID handlers for the hardware console.
 *
 * Grants the supported Work Louder devices (see supported-devices.ts)
 * silently — no chooser UI: `select-hid-device` auto-picks the first
 * supported device, and the device permission handler persists the grant so
 * `navigator.hid.getDevices()` and hotplug `connect` events work without a
 * prompt. Everything else stays blocked.
 *
 * Only this file touches Electron; the transport core under ../device/ is
 * platform-neutral WebHID.
 */

import type { Session } from 'electron';

import { Logger } from '../../../shared/logger';
import { isSupportedHardwareConsoleDevice } from '../device/supported-devices';

const logger = new Logger('HardwareConsoleMain');

interface HidDeviceIds {
  vendorId?: number;
  productId?: number;
}

/**
 * Origins allowed to use WebHID: the app shell only (app:// protocol in
 * production, the local dev server in development). Used by the default
 * session's permission-check handler in src/main/webview-security.ts.
 */
export function isTrustedHidOrigin(urlOrOrigin: string): boolean {
  try {
    const url = new URL(urlOrOrigin);
    if (url.protocol === 'app:' || url.protocol === 'file:') return true;
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

/**
 * Register the WebHID handlers on a session. Call once for the default
 * session before any windows are created.
 */
export function setupHardwareConsoleMain(ses: Session): void {
  // Renderer navigator.hid.requestDevice() → pick a supported device with no
  // chooser UI; an empty selection (undefined) resolves the request with no
  // device.
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const selected = details.deviceList.find((d) =>
      isSupportedHardwareConsoleDevice(d.vendorId, d.productId),
    );
    logger.info('select-hid-device', {
      candidates: details.deviceList.length,
      selected: selected ? `${selected.vendorId}:${selected.productId}` : null,
    });
    callback(selected?.deviceId);
  });

  // Fired while a select-hid-device request is pending; logged for
  // diagnostics (hotplug outside a pending request surfaces via the
  // renderer's WebHID connect/disconnect events instead).
  ses.on('hid-device-added', (_event, details) => {
    if (isSupportedHardwareConsoleDevice(details.device.vendorId, details.device.productId)) {
      logger.info('Supported HID device added', {
        vendorId: details.device.vendorId,
        productId: details.device.productId,
      });
    }
  });
  ses.on('hid-device-removed', (_event, details) => {
    if (isSupportedHardwareConsoleDevice(details.device.vendorId, details.device.productId)) {
      logger.info('Supported HID device removed', {
        vendorId: details.device.vendorId,
        productId: details.device.productId,
      });
    }
  });

  // Persistent grant for our VID/PIDs: makes getDevices() return the device
  // and hotplug events fire without any prompt.
  ses.setDevicePermissionHandler((details) => {
    if (details.deviceType !== 'hid') return false;
    const device = details.device as HidDeviceIds;
    return isSupportedHardwareConsoleDevice(device.vendorId, device.productId);
  });

  logger.info('Hardware console WebHID handlers registered');
}
