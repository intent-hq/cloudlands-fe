import { describe, expect, it } from 'vitest';

import { HardwareConsoleManager, type HardwareConsoleStatus } from '../device-manager';
import { createWebHidPlatform } from '../platform';
import { watchSupportedDevicePresence } from '../presence';
import { FakeHidDevice, FakeWebHidApi, flushMicrotasks } from './fake-hid';

const CM2 = { vendorId: 0x303a, productId: 0x8297 };
const CODEX = { vendorId: 0x303a, productId: 0x8360 };

/** CM2 USB enumeration coalesced into one device: all 6 usage pairs. */
const USB_COALESCED_PAIRS = [
  { usagePage: 0x0001, usage: 0x0006 },
  { usagePage: 0x000c, usage: 0x0001 },
  { usagePage: 0x0001, usage: 0x0002 },
  { usagePage: 0x0001, usage: 0x0001 },
  { usagePage: 0x0001, usage: 0x0005 },
  { usagePage: 0xff00, usage: 0x0001 },
];

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

  it('aggregates collections across a coalesced enumeration', async () => {
    // Regression (intent-hq/monorepo#1422): macOS can enumerate the CM2 as
    // ONE granted device carrying all 6 usage pairs; counting granted
    // devices (1) instead of collections (6) mislabeled USB as bluetooth.
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId, 'CM2', USB_COALESCED_PAIRS);
    hid.devices = [device];
    await manager.start();
    await expect(manager.connectedCollections()).resolves.toHaveLength(6);
  });

  it('reconnects to a remaining granted device after the connected one is removed', async () => {
    // Regression (intent-hq/monorepo#1422): when the BLE surface drops while
    // the USB surface is already granted, no WebHID connect event fires —
    // the manager must rescan instead of sitting disconnected until the
    // integration is toggled.
    const { hid, manager, statuses } = makeManager();
    const ble = new FakeHidDevice(CM2.vendorId, CM2.productId, 'CM2 (BLE)');
    const usb = new FakeHidDevice(CM2.vendorId, CM2.productId, 'CM2 (USB)', USB_COALESCED_PAIRS);
    hid.devices = [ble, usb];
    await manager.start();
    expect(ble.opened).toBe(true);
    hid.devices = [usb];
    hid.emitDisconnect(ble);
    await flushMicrotasks();
    expect(manager.status).toBe('connected');
    expect(usb.opened).toBe(true);
    expect(statuses).toEqual([
      'connecting',
      'connected',
      'disconnected',
      'connecting',
      'connected',
    ]);
  });

  it('stays disconnected after removal when no other granted device remains', async () => {
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    hid.devices = [];
    hid.emitDisconnect(device);
    await flushMicrotasks();
    expect(manager.status).toBe('disconnected');
    expect(manager.client).toBeNull();
  });

  it('does not reopen the removed device when getDevices still lists it', async () => {
    // The disconnect event can race a stale getDevices() snapshot; the
    // removal rescan must never re-open the device that just went away.
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    hid.emitDisconnect(device);
    await flushMicrotasks();
    expect(manager.status).toBe('disconnected');
  });

  it('tears down on disconnect and reconnects on replug', async () => {
    const { hid, manager, statuses } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    await manager.start();
    const pending = manager.client!.call('sys.version');
    hid.devices = [];
    hid.emitDisconnect(device);
    await flushMicrotasks();
    expect(manager.status).toBe('disconnected');
    expect(manager.client).toBeNull();
    await expect(pending).rejects.toThrow(/device disconnected/);

    const replugged = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [replugged];
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

  it('stop during an in-flight open tears down the completed connection', async () => {
    // Regression: stop() used to tear down immediately while openDevice()
    // was still awaiting device.open(); the completing open then attached
    // the transport/client and set status connected — a leaked live
    // connection on a stopped manager.
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
    const stopPromise = manager.stop();
    await flushMicrotasks();
    for (const resolve of resolvers) resolve();
    await startPromise;
    await stopPromise;
    await flushMicrotasks();
    expect(manager.status).toBe('disconnected');
    expect(device.opened).toBe(false);
    expect(manager.client).toBeNull();
    // No transport must remain attached: an inbound message on a leaked
    // subscription would still reach raw listeners.
    const raw: unknown[] = [];
    manager.onRawMessage((m) => raw.push(m));
    device.emitRpc({ a: 0.5, d: 0 });
    expect(raw).toEqual([]);
  });

  it("stop during start()'s getDevices await never opens the device", async () => {
    // Regression (intent-hq/monorepo#1434, race 1): openDevice() did not
    // re-check the lifecycle after start() awaited getDevices(), so a stop()
    // arriving in that window let the open attach a connection on a stopped
    // manager.
    const { hid, manager, statuses } = makeManager();
    const device = new FakeHidDevice(CM2.vendorId, CM2.productId);
    hid.devices = [device];
    let release: (() => void) | undefined;
    hid.getDevices = () =>
      new Promise((resolve) => {
        release = () => resolve([device]);
      });
    const startPromise = manager.start();
    await flushMicrotasks();
    const stopPromise = manager.stop();
    await flushMicrotasks();
    release!();
    await startPromise;
    await stopPromise;
    await flushMicrotasks();
    expect(device.opened).toBe(false);
    expect(manager.status).toBe('disconnected');
    expect(manager.client).toBeNull();
    expect(statuses).not.toContain('connected');
  });

  it("start during stop()'s await never ends started with a silently closed device", async () => {
    // Regression (intent-hq/monorepo#1434, race 2): a rapid OFF→ON toggle
    // parked stop() on the in-flight open while start() re-armed hotplug;
    // stop's trailing teardown then closed the device on a manager that
    // believed itself started, until a replug or another toggle cycle.
    const { hid, manager, statuses } = makeManager();
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
    const stopPromise = manager.stop();
    const restartPromise = manager.start();
    await flushMicrotasks();
    for (const resolve of resolvers.splice(0)) resolve();
    await Promise.all([startPromise, stopPromise, restartPromise]);
    await flushMicrotasks();
    // The superseded open released the device without a connected blip, and
    // stop's trailing teardown did not destroy the restarted generation.
    expect(statuses).not.toContain('connected');
    expect(manager.status).toBe('disconnected');
    expect(manager.client).toBeNull();
    expect(device.opened).toBe(false);
    // The restart left hotplug armed: a connect event reconnects normally.
    hid.emitConnect(device);
    await flushMicrotasks();
    for (const resolve of resolvers.splice(0)) resolve();
    await flushMicrotasks();
    expect(manager.status).toBe('connected');
    expect(device.opened).toBe(true);
    expect(manager.client).not.toBeNull();
  });

  it('emits no connected blip when stop supersedes an in-flight open', async () => {
    // Regression (intent-hq/monorepo#1434, race 3): the completing
    // performOpen reached setStatus('connected') before stop's teardown
    // flipped it back, so status listeners saw a momentary connected blip
    // right after a runtime disable.
    const { hid, manager, statuses } = makeManager();
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
    const stopPromise = manager.stop();
    await flushMicrotasks();
    for (const resolve of resolvers) resolve();
    await startPromise;
    await stopPromise;
    await flushMicrotasks();
    expect(statuses).toEqual(['connecting', 'disconnected']);
    expect(manager.status).toBe('disconnected');
    expect(device.opened).toBe(false);
  });

  it('requestConnect works on a never-started manager', async () => {
    // The lifecycle guard must not be a naive started check: requestConnect
    // never sets `started`, yet its open must still attach.
    const { hid, manager } = makeManager();
    const device = new FakeHidDevice(CODEX.vendorId, CODEX.productId);
    hid.requestDeviceResult = [device];
    await expect(manager.requestConnect()).resolves.toBe(true);
    expect(manager.status).toBe('connected');
    expect(device.opened).toBe(true);
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
