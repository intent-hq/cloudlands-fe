import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('$lib/electron-bridge');

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { emitMockIpcEvent, mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import {
  createBatterySource,
  registerBatteryChangedEventRelay,
  registerPowerBridge,
} from './power-bridge-seeder';

const originalElectronAPI = (window as any).electronAPI;
const originalGetBattery = (navigator as any).getBattery;

function makeFakeBatteryManager(charging: boolean) {
  const listeners = new Set<() => void>();
  return {
    charging,
    addEventListener: vi.fn((_type: 'chargingchange', cb: () => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_type: 'chargingchange', cb: () => void) => listeners.delete(cb)),
    setCharging(next: boolean) {
      this.charging = next;
      for (const cb of listeners) cb();
    },
    listenerCount: () => listeners.size,
  };
}

describe('power-bridge-seeder', () => {
  beforeEach(() => {
    resetMockIpcRouter();
    delete (window as any).electronAPI;
    delete (navigator as any).getBattery;
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    if (originalGetBattery) (navigator as any).getBattery = originalGetBattery;
    else delete (navigator as any).getBattery;
    resetMockIpcRouter();
  });

  it('forwards power:get-battery-state to window.electronAPI.invoke when bridged', async () => {
    const invokeSpy = vi.fn(async () => ({ onBattery: true }));
    (window as any).electronAPI = { invoke: invokeSpy };
    registerPowerBridge();

    await expect(mockInvoke(IPC_CHANNELS.POWER.GET_BATTERY_STATE)).resolves.toEqual({
      onBattery: true,
    });
    expect(invokeSpy).toHaveBeenCalledWith(IPC_CHANNELS.POWER.GET_BATTERY_STATE, undefined);
  });

  it('answers { onBattery: false } deterministically without the bridge', async () => {
    registerPowerBridge();
    await expect(mockInvoke(IPC_CHANNELS.POWER.GET_BATTERY_STATE)).resolves.toEqual({
      onBattery: false,
    });
  });

  it('relays main-process power:battery-changed events onto the mock event channel', () => {
    let bridgeListener: ((payload: unknown) => void) | undefined;
    (window as any).electronAPI = {
      invoke: vi.fn(),
      on: vi.fn((channel: string, cb: (payload: unknown) => void) => {
        if (channel === IPC_CHANNELS.POWER.BATTERY_CHANGED) bridgeListener = cb;
        return 'listener-1';
      }),
    };
    registerBatteryChangedEventRelay();
    expect(bridgeListener).toBeDefined();

    const source = createBatterySource();
    const received: boolean[] = [];
    const dispose = source.subscribe((onBattery) => received.push(onBattery));
    bridgeListener!({ onBattery: true });
    bridgeListener!({ onBattery: false });
    bridgeListener!({ malformed: 1 });
    expect(received).toEqual([true, false]);
    dispose();
  });

  it('IPC source reads onBattery from the invoke result and treats malformed results as off-battery', async () => {
    const invokeSpy = vi.fn(async () => ({ onBattery: true }));
    (window as any).electronAPI = { invoke: invokeSpy };
    registerPowerBridge();
    const source = createBatterySource();
    await expect(source.read()).resolves.toBe(true);

    invokeSpy.mockResolvedValueOnce(undefined as any);
    await expect(source.read()).resolves.toBe(false);
  });

  it('IPC source subscription stops receiving after dispose', () => {
    (window as any).electronAPI = { invoke: vi.fn() };
    const source = createBatterySource();
    const received: boolean[] = [];
    const dispose = source.subscribe((onBattery) => received.push(onBattery));
    emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: true });
    dispose();
    emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: false });
    expect(received).toEqual([true]);
  });

  it('uses navigator.getBattery in a browser build: onBattery = !charging, re-derived on chargingchange', async () => {
    const battery = makeFakeBatteryManager(false);
    (navigator as any).getBattery = vi.fn(async () => battery);
    const source = createBatterySource();

    await expect(source.read()).resolves.toBe(true);

    const received: boolean[] = [];
    const dispose = source.subscribe((onBattery) => received.push(onBattery));
    await Promise.resolve();
    expect(battery.listenerCount()).toBe(1);
    battery.setCharging(true);
    battery.setCharging(false);
    expect(received).toEqual([false, true]);

    dispose();
    expect(battery.listenerCount()).toBe(0);
  });

  it('does not leak an unhandled rejection when navigator.getBattery rejects (Permissions Policy denial)', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      (navigator as any).getBattery = vi.fn(() => Promise.reject(new Error('denied')));
      const source = createBatterySource();

      await expect(source.read()).rejects.toThrow('denied');

      const listener = vi.fn();
      const dispose = source.subscribe(listener);
      await new Promise((resolve) => setTimeout(resolve, 0));
      dispose();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(listener).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('never attaches a chargingchange listener when disposed while getBattery is still pending', async () => {
    const battery = makeFakeBatteryManager(false);
    let resolveBattery!: (value: typeof battery) => void;
    (navigator as any).getBattery = vi.fn(
      () => new Promise<typeof battery>((resolve) => (resolveBattery = resolve)),
    );
    const source = createBatterySource();

    const listener = vi.fn();
    const dispose = source.subscribe(listener);
    dispose();
    resolveBattery(battery);
    await Promise.resolve();

    expect(battery.addEventListener).not.toHaveBeenCalled();
    expect(battery.listenerCount()).toBe(0);
    battery.setCharging(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('falls back to a constant off-battery source when neither bridge nor Battery API exists', async () => {
    const source = createBatterySource();
    await expect(source.read()).resolves.toBe(false);
    const listener = vi.fn();
    const dispose = source.subscribe(listener);
    dispose();
    expect(listener).not.toHaveBeenCalled();
  });
});
