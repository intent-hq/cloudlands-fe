import { describe, expect, it } from 'vitest';

import { HardwareConsoleManager, type HardwareConsoleStatus } from '../device-manager';
import { createWebHidPlatform } from '../platform';
import { watchSupportedDevicePresence } from '../presence';
import { FakeHidDevice, FakeWebHidApi, flushMicrotasks } from './fake-hid';

const CM2 = { vendorId: 0x303a, productId: 0x8297 };
const CODEX = { vendorId: 0x303a, productId: 0x8360 };

function makeManager(hid = new FakeWebHidApi()): {
  hid: FakeWebHidApi;
  manager: HardwareConsoleManager;
  statuses: HardwareConsoleStatus[];
} {
  const platform = createWebHidPlatform(hid);
  const manager = new HardwareConsoleManager(platform, { requestTimeoutMs: 200 });
  const statuses: HardwareConsoleStatus[] = [];
  manager.onStatusChange((s) => statuses.push(s));
  return { hid, manager, statuses };
}

describe('HardwareConsoleManager', () => {
  it('reports unavailable when WebHID is missing', () => {
    const manager = new HardwareConsoleManager(createWebHidPlatform(null));
    expect(manager.status).toBe('unavailable');
  });

  it('opens an already-granted device on start', async () => {
    const { hid, manager, statuses } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    expect(device.opened).toBe(true);
    expect(manager.status).toBe('connected');
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(manager.connectedDevice?.model).toBe('creator-micro-2');
  });

  it('skips granted devices without the vendor collection', async () => {
    const { hid, manager } = makeManager();
    hid.devices = [
      new FakeHidDevice(CM2.vendorId, CM2.productId, 'Keyboard', [
        { usagePage: 0x0001, usage: 0x0006 },
      ]),
    ];
    await manager.start();
    expect(manager.status).toBe('disconnected');
  });

  it('requestConnect opens the device returned by requestDevice', async () => {
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CODEX.vendorId, CODEX.productId);
    hid.requestDeviceResult = [device];
    await manager.start();
    await expect(manager.requestConnect()).resolves.toBe(true);
    expect(manager.connectedDevice?.model).toBe('codex-micro');
  });

  it('requestConnect resolves false when nothing is granted', async () => {
    const { manager } = makeManager();
    await manager.start();
    await expect(manager.requestConnect()).resolves.toBe(false);
    expect(manager.status).toBe('disconnected');
  });

  it('recovers from an open() failure', async () => {
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    device.openError = new Error('access denied');
    hid.devices = [device];
    await manager.start();
    expect(manager.status).toBe('disconnected');
  });

  it('exposes a working RPC client end to end', async () => {
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    const pending = manager.client!.call<{ fw: string }>('sys.version');
    await flushMicrotasks();
    expect(device.sentReports).toHaveLength(1);
    device.emitRpc({ id: 1, result: { fw: '0.6.0' } });
    await expect(pending).resolves.toEqual({ fw: '0.6.0' });
  });

  it('answers device-originated host.focused_app requests', async () => {
    const hid = new FakeWebHidApi();
    const platform = createWebHidPlatform(hid);
    const manager = new HardwareConsoleManager(platform, {
      focusedAppProvider: () => ({ name: 'TestApp' }),
    });
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    device.emitRpc({ method: 'host.focused_app', params: null, id: 12 });
    await flushMicrotasks();
    expect(device.sentReports).toHaveLength(1);
    const { data } = device.sentReports[0];
    const text = new TextDecoder().decode(data.slice(2, 2 + data[1]));
    expect(JSON.parse(text)).toEqual({ id: 12, result: { name: 'TestApp' } });
  });

  it('exposes bare channel-2 objects (joystick stream) via onRawMessage', async () => {
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    const raw: unknown[] = [];
    const notifications: unknown[] = [];
    manager.onRawMessage((m) => raw.push(m));
    manager.onNotification((n) => notifications.push(n));
    device.emitRpc({ a: 0.76, d: 1 });
    device.emitRpc({ m: 'v.oai.hid', p: { state: 'idle' } });
    expect(raw).toEqual([
      { a: 0.76, d: 1 },
      { m: 'v.oai.hid', p: { state: 'idle' } },
    ]);
    expect(notifications).toEqual([{ method: 'v.oai.hid', params: { state: 'idle' } }]);
    expect(device.sentReports).toHaveLength(0);
  });

  it('forwards firmware log lines and notifications', async () => {
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    const logs: string[] = [];
    const notifications: unknown[] = [];
    manager.onLog((t) => logs.push(t));
    manager.onNotification((n) => notifications.push(n));
    device.emitMessage(1, new TextEncoder().encode('fw log line'));
    device.emitRpc({ m: 'v.oai.hid', p: { state: 'idle' } });
    expect(logs).toEqual(['fw log line']);
    expect(notifications).toEqual([{ method: 'v.oai.hid', params: { state: 'idle' } }]);
  });

  it('tears down on disconnect and reconnects on replug', async () => {
    const { hid, manager, statuses } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    const pending = manager.client!.call('sys.version');
    hid.emitDisconnect(device);
    await flushMicrotasks();
    expect(manager.status).toBe('disconnected');
    expect(manager.client).toBeNull();
    await expect(pending).rejects.toThrow(/device disconnected/);

    const replugged = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.emitConnect(replugged);
    await flushMicrotasks();
    expect(manager.status).toBe('connected');
    expect(replugged.opened).toBe(true);
    expect(statuses).toEqual([
      'connecting',
      'connected',
      'disconnected',
      'connecting',
      'connected',
    ]);
  });

  it('does not attach a duplicate transport when hotplug races an in-flight open', async () => {
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    const resolvers: (() => void)[] = [];
    device.open = () =>
      new Promise((resolve) => {
        resolvers.push(() => {
          device.opened = true;
          resolve();
        });
      });
    hid.devices = [device];
    const startPromise = manager.start();
    await flushMicrotasks();
    // Same device "arrives" via hotplug while the first open() is pending.
    hid.emitConnect(device);
    await flushMicrotasks();
    for (const resolve of resolvers) resolve();
    await startPromise;
    await flushMicrotasks();
    expect(manager.status).toBe('connected');
    const raw: unknown[] = [];
    manager.onRawMessage((m) => raw.push(m));
    device.emitRpc({ a: 0.5, d: 0 });
    // A duplicate transport subscription would deliver the message twice.
    expect(raw).toEqual([{ a: 0.5, d: 0 }]);
  });

  it('ignores hotplug of unsupported devices', async () => {
    const { hid, manager } = makeManager();
    await manager.start();
    hid.emitConnect(new FakeHidDevice(0x1234, 0x5678));
    await flushMicrotasks();
    expect(manager.status).toBe('disconnected');
  });

  it('stop closes the device and unsubscribes from hotplug', async () => {
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    await manager.stop();
    expect(device.opened).toBe(false);
    expect(manager.status).toBe('disconnected');
    hid.emitConnect(new FakeHidDevice(CM2.vendorId, CM2.productId));
    await flushMicrotasks();
    expect(manager.status).toBe('disconnected');
  });
});

describe('watchSupportedDevicePresence', () => {
  function makeWatcher(hid = new FakeWebHidApi()) {
    const platform = createWebHidPlatform(hid);
    const manager = new HardwareConsoleManager(platform);
    const values: boolean[] = [];
    const unsubscribe = watchSupportedDevicePresence(
      manager,
      (present) => values.push(present),
      platform,
    );
    return { hid, manager, values, unsubscribe };
  }

  it('reports absent when WebHID is unavailable', () => {
    const values: boolean[] = [];
    const manager = new HardwareConsoleManager(createWebHidPlatform(null));
    watchSupportedDevicePresence(manager, (present) => values.push(present), null);
    expect(values).toEqual([false]);
  });

  it('reports a granted supported device as present', async () => {
    const { values } = makeWatcher(
      Object.assign(new FakeWebHidApi(), {
        devices: [new FakeHidDevice(CM2.vendorId, CM2.productId)],
      }),
    );
    await flushMicrotasks();
    expect(values).toEqual([true]);
  });

  it('tracks hotplug connect and disconnect', async () => {
    const { hid, values } = makeWatcher();
    await flushMicrotasks();
    expect(values).toEqual([false]);
    const device = new FakeHidDevice(CODEX.vendorId, CODEX.productId);
    hid.devices = [device];
    hid.emitConnect(device);
    await flushMicrotasks();
    expect(values).toEqual([false, true]);
    hid.devices = [];
    hid.emitDisconnect(device);
    await flushMicrotasks();
    expect(values).toEqual([false, true, false]);
  });

  it('ignores unsupported devices', async () => {
    const { values } = makeWatcher(
      Object.assign(new FakeWebHidApi(), { devices: [new FakeHidDevice(0x1234, 0x5678)] }),
    );
    await flushMicrotasks();
    expect(values).toEqual([false]);
  });

  it('stays present after manager.stop() while the device remains plugged in', async () => {
    const { hid, manager, values } = makeWatcher();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    await flushMicrotasks();
    await manager.stop();
    await flushMicrotasks();
    expect(values.at(-1)).toBe(true);
  });

  it('reports present from manager status even when getDevices is empty', async () => {
    const { hid, manager, values } = makeWatcher();
    await manager.start();
    await flushMicrotasks();
    expect(values).toEqual([false]);
    // Device connects but never appears in getDevices(): presence must come
    // from the manager's connected status.
    hid.emitConnect(new FakeHidDevice(CM2.vendorId, CM2.productId));
    await flushMicrotasks();
    expect(manager.status).toBe('connected');
    expect(values.at(-1)).toBe(true);
  });

  it('stops emitting after unsubscribe', async () => {
    const { hid, values, unsubscribe } = makeWatcher();
    await flushMicrotasks();
    unsubscribe();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    hid.emitConnect(device);
    await flushMicrotasks();
    expect(values).toEqual([false]);
  });
});
