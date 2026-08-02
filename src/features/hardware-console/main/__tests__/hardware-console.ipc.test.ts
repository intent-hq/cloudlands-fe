import { describe, expect, it } from 'vitest';
import type { Session } from 'electron';

import { isTrustedHidOrigin, setupHardwareConsoleMain } from '../hardware-console.ipc';

type SelectHidHandler = (
  event: { preventDefault: () => void },
  details: { deviceList: { deviceId: string; vendorId: number; productId: number }[] },
  callback: (deviceId?: string) => void,
) => void;

type DevicePermissionHandler = (details: {
  deviceType: string;
  device: { vendorId?: number; productId?: number };
}) => boolean;

function makeFakeSession(): {
  session: Session;
  handlers: Map<string, SelectHidHandler>;
  getPermissionHandler: () => DevicePermissionHandler;
} {
  const handlers = new Map<string, SelectHidHandler>();
  let permissionHandler: DevicePermissionHandler | null = null;
  const session = {
    on(event: string, handler: SelectHidHandler) {
      handlers.set(event, handler);
      return session;
    },
    setDevicePermissionHandler(handler: DevicePermissionHandler) {
      permissionHandler = handler;
    },
  } as unknown as Session;
  return {
    session,
    handlers,
    getPermissionHandler: () => {
      if (!permissionHandler) throw new Error('device permission handler not registered');
      return permissionHandler;
    },
  };
}

describe('setupHardwareConsoleMain', () => {
  it('select-hid-device picks the first supported device without a chooser', () => {
    const { session, handlers } = makeFakeSession();
    setupHardwareConsoleMain(session);
    const handler = handlers.get('select-hid-device')!;
    let prevented = false;
    let selected: string | undefined = 'sentinel';
    handler(
      { preventDefault: () => (prevented = true) },
      {
        deviceList: [
          { deviceId: 'other', vendorId: 0x1234, productId: 0x5678 },
          { deviceId: 'cm2', vendorId: 0x303a, productId: 0x8297 },
          { deviceId: 'codex', vendorId: 0x303a, productId: 0x8360 },
        ],
      },
      (deviceId) => (selected = deviceId),
    );
    expect(prevented).toBe(true);
    expect(selected).toBe('cm2');
  });

  it('select-hid-device resolves with no device when nothing matches', () => {
    const { session, handlers } = makeFakeSession();
    setupHardwareConsoleMain(session);
    const handler = handlers.get('select-hid-device')!;
    let selected: string | undefined = 'sentinel';
    handler(
      { preventDefault: () => undefined },
      { deviceList: [{ deviceId: 'other', vendorId: 0x1234, productId: 0x5678 }] },
      (deviceId) => (selected = deviceId),
    );
    expect(selected).toBeUndefined();
  });

  it('device permission handler grants only supported hid devices', () => {
    const { session, getPermissionHandler } = makeFakeSession();
    setupHardwareConsoleMain(session);
    const handler = getPermissionHandler();
    expect(handler({ deviceType: 'hid', device: { vendorId: 0x303a, productId: 0x8297 } })).toBe(
      true,
    );
    expect(handler({ deviceType: 'hid', device: { vendorId: 0x303a, productId: 0x8298 } })).toBe(
      true,
    );
    expect(handler({ deviceType: 'hid', device: { vendorId: 0x303a, productId: 0x8360 } })).toBe(
      true,
    );
    expect(handler({ deviceType: 'hid', device: { vendorId: 0x303a, productId: 0x9999 } })).toBe(
      false,
    );
    expect(handler({ deviceType: 'usb', device: { vendorId: 0x303a, productId: 0x8297 } })).toBe(
      false,
    );
  });
});

describe('isTrustedHidOrigin', () => {
  it('allows the app shell and local dev origins', () => {
    expect(isTrustedHidOrigin('app://index.html')).toBe(true);
    expect(isTrustedHidOrigin('file:///index.html')).toBe(true);
    expect(isTrustedHidOrigin('http://localhost:5173')).toBe(true);
    expect(isTrustedHidOrigin('http://127.0.0.1:5173')).toBe(true);
  });

  it('rejects remote and malformed origins', () => {
    expect(isTrustedHidOrigin('https://example.com')).toBe(false);
    expect(isTrustedHidOrigin('http://evil.localhost.example.com')).toBe(false);
    expect(isTrustedHidOrigin('not a url')).toBe(false);
  });
});
