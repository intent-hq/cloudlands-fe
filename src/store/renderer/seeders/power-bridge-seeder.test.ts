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

const ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Cloudlands/2.3.0 Chrome/136.0.7103.115 Electron/36.4.0 Safari/537.36';

/**
 * Make `expectsElectronPreloadBridge()` true: Electron UA + Electron build
 * target. jsdom's own UA is not Electron, so the default is the browser build.
 */
function simulateElectronRuntime() {
  Object.defineProperty(navigator, 'userAgent', { value: ELECTRON_UA, configurable: true });
  vi.stubEnv('INTENT_BUILD_TARGET', 'electron');
}

function installGenuineBridge(bridge: Record<string, unknown>) {
  simulateElectronRuntime();
  (window as any).electronAPI = bridge;
}

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
    delete (navigator as any).userAgent;
    vi.unstubAllEnvs();
    resetMockIpcRouter();
  });

  it('forwards power:get-battery-state to window.electronAPI.invoke when bridged', async () => {
    const invokeSpy = vi.fn(async () => ({ onBattery: true }));
    installGenuineBridge({ invoke: invokeSpy });
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
    installGenuineBridge({
      invoke: vi.fn(),
      on: vi.fn((channel: string, cb: (payload: unknown) => void) => {
        if (channel === IPC_CHANNELS.POWER.BATTERY_CHANGED) bridgeListener = cb;
        return 'listener-1';
      }),
    });
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
    installGenuineBridge({ invoke: invokeSpy });
    registerPowerBridge();
    const source = createBatterySource();
    await expect(source.read()).resolves.toBe(true);

    invokeSpy.mockResolvedValueOnce(undefined as any);
    await expect(source.read()).resolves.toBe(false);
  });

  it('IPC source subscription stops receiving after dispose', () => {
    installGenuineBridge({ invoke: vi.fn() });
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

  it('dev:web with the browser mock installed still reads navigator.getBattery (mock electronAPI is not a preload)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const battery = makeFakeBatteryManager(false);
    const getBattery = vi.fn(async () => battery);
    (navigator as any).getBattery = getBattery;
    const { installBrowserMock } = await import('$lib/browser-mock');
    installBrowserMock();
    expect(typeof (window as any).electronAPI?.invoke).toBe('function');
    const mockInvokeSpy = vi.spyOn((window as any).electronAPI, 'invoke');
    registerPowerBridge();

    const source = createBatterySource();
    await expect(source.read()).resolves.toBe(true);
    expect(getBattery).toHaveBeenCalled();
    expect(mockInvokeSpy).not.toHaveBeenCalled();

    const received: boolean[] = [];
    const dispose = source.subscribe((onBattery) => received.push(onBattery));
    await Promise.resolve();
    battery.setCharging(true);
    expect(received).toEqual([false]);
    dispose();

    await expect(mockInvoke(IPC_CHANNELS.POWER.GET_BATTERY_STATE)).resolves.toEqual({
      onBattery: false,
    });
    expect(mockInvokeSpy).not.toHaveBeenCalled();
  });

  describe('Electron renderer: merged powerMonitor IPC || navigator.getBattery source', () => {
    it('reads true from navigator.getBattery when powerMonitor reports unknown (not on battery) and never emits', async () => {
      const invokeSpy = vi.fn(async () => ({ onBattery: false }));
      installGenuineBridge({ invoke: invokeSpy });
      registerPowerBridge();
      const battery = makeFakeBatteryManager(false);
      const getBattery = vi.fn(async () => battery);
      (navigator as any).getBattery = getBattery;

      const source = createBatterySource();
      await expect(source.read()).resolves.toBe(true);
      expect(invokeSpy).toHaveBeenCalledWith(IPC_CHANNELS.POWER.GET_BATTERY_STATE, undefined);
      expect(getBattery).toHaveBeenCalled();
    });

    it('reads true from IPC when navigator says charging', async () => {
      installGenuineBridge({ invoke: vi.fn(async () => ({ onBattery: true })) });
      registerPowerBridge();
      (navigator as any).getBattery = vi.fn(async () => makeFakeBatteryManager(true));

      const source = createBatterySource();
      await expect(source.read()).resolves.toBe(true);
    });

    it('logs the seed line with both raw source values exactly once across repeated reads', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      installGenuineBridge({ invoke: vi.fn(async () => ({ onBattery: false })) });
      registerPowerBridge();
      (navigator as any).getBattery = vi.fn(async () => makeFakeBatteryManager(false));

      const source = createBatterySource();
      await Promise.all([source.read(), source.read()]);
      await source.read();
      const lines = [...debugSpy.mock.calls, ...infoSpy.mock.calls].map((args) =>
        args.map(String).join(' '),
      );
      const seedLines = lines.filter(
        (line) =>
          /battery seed:/.test(line) && /ipc=false/.test(line) && /navigator=true/.test(line),
      );
      expect(seedLines).toHaveLength(1);
    });

    it('emits ipc || navigator on chargingchange while IPC stays silent', async () => {
      installGenuineBridge({ invoke: vi.fn(async () => ({ onBattery: false })) });
      registerPowerBridge();
      const battery = makeFakeBatteryManager(false);
      (navigator as any).getBattery = vi.fn(async () => battery);

      const source = createBatterySource();
      const received: boolean[] = [];
      const dispose = source.subscribe((onBattery) => received.push(onBattery));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(battery.listenerCount()).toBe(1);

      battery.setCharging(true);
      expect(received).toEqual([false]);
      battery.setCharging(false);
      expect(received).toEqual([false, true]);
      dispose();
    });

    it('emits true on IPC power:battery-changed while navigator says charging', async () => {
      installGenuineBridge({ invoke: vi.fn(async () => ({ onBattery: false })) });
      registerPowerBridge();
      const battery = makeFakeBatteryManager(true);
      (navigator as any).getBattery = vi.fn(async () => battery);

      const source = createBatterySource();
      const received: boolean[] = [];
      const dispose = source.subscribe((onBattery) => received.push(onBattery));
      await new Promise((resolve) => setTimeout(resolve, 0));

      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: true });
      expect(received).toEqual([true]);
      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: false });
      expect(received).toEqual([true, false]);
      dispose();
    });

    it('does not re-emit identical consecutive merged values', async () => {
      installGenuineBridge({ invoke: vi.fn(async () => ({ onBattery: false })) });
      registerPowerBridge();
      const battery = makeFakeBatteryManager(true);
      (navigator as any).getBattery = vi.fn(async () => battery);

      const source = createBatterySource();
      const received: boolean[] = [];
      const dispose = source.subscribe((onBattery) => received.push(onBattery));
      await new Promise((resolve) => setTimeout(resolve, 0));

      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: true });
      expect(received).toEqual([true]);
      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: true });
      battery.setCharging(false);
      expect(received).toEqual([true]);
      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: false });
      expect(received).toEqual([true]);
      battery.setCharging(true);
      expect(received).toEqual([true, false]);
      dispose();
    });

    it('behaves as IPC-only when navigator.getBattery rejects (no unhandled rejection)', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        installGenuineBridge({ invoke: vi.fn(async () => ({ onBattery: true })) });
        registerPowerBridge();
        (navigator as any).getBattery = vi.fn(() => Promise.reject(new Error('denied')));

        const source = createBatterySource();
        await expect(source.read()).resolves.toBe(true);

        const received: boolean[] = [];
        const dispose = source.subscribe((onBattery) => received.push(onBattery));
        await new Promise((resolve) => setTimeout(resolve, 0));
        emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: false });
        expect(received).toEqual([false]);
        dispose();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('reconciles a late IPC seed after an early chargingchange (subscribe-before-read saga order)', async () => {
      const pendingIpcReads: Array<(value: unknown) => void> = [];
      installGenuineBridge({
        invoke: vi.fn(() => new Promise((resolve) => pendingIpcReads.push(resolve))),
      });
      registerPowerBridge();
      const battery = makeFakeBatteryManager(false);
      (navigator as any).getBattery = vi.fn(async () => battery);

      const source = createBatterySource();
      const received: boolean[] = [];
      const dispose = source.subscribe((onBattery) => received.push(onBattery));
      const initialRead = source.read();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(battery.listenerCount()).toBe(1);

      battery.setCharging(true);
      expect(received).toEqual([false]);

      for (const resolve of pendingIpcReads.splice(0)) resolve({ onBattery: true });
      await expect(initialRead).resolves.toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(received.at(-1)).toBe(true);

      battery.setCharging(false);
      battery.setCharging(true);
      expect(received.at(-1)).toBe(true);
      dispose();
    });

    it('a change event beats a later-resolving seed for the same source', async () => {
      const pendingIpcReads: Array<(value: unknown) => void> = [];
      installGenuineBridge({
        invoke: vi.fn(() => new Promise((resolve) => pendingIpcReads.push(resolve))),
      });
      registerPowerBridge();
      const battery = makeFakeBatteryManager(true);
      (navigator as any).getBattery = vi.fn(async () => battery);

      const source = createBatterySource();
      const received: boolean[] = [];
      const dispose = source.subscribe((onBattery) => received.push(onBattery));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(battery.listenerCount()).toBe(1);
      expect(pendingIpcReads.length).toBeGreaterThan(0);

      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: true });
      expect(received).toEqual([true]);
      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: false });
      expect(received).toEqual([true, false]);

      for (const resolve of pendingIpcReads.splice(0)) resolve({ onBattery: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(received).toEqual([true, false]);
      battery.setCharging(false);
      expect(received).toEqual([true, false, true]);
      dispose();
    });

    it('keeps the subscription baseline in step with read() when the IPC seed rejects transiently (subscribe-before-read saga order)', async () => {
      const pendingIpcReads: Array<{
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
      }> = [];
      const invokeSpy = vi.fn(
        () => new Promise((resolve, reject) => pendingIpcReads.push({ resolve, reject })),
      );
      installGenuineBridge({ invoke: invokeSpy });
      registerPowerBridge();
      const battery = makeFakeBatteryManager(true);
      (navigator as any).getBattery = vi.fn(async () => battery);

      const source = createBatterySource();
      const received: boolean[] = [];
      const dispose = source.subscribe((onBattery) => received.push(onBattery));
      const initialRead = source.read();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(invokeSpy).toHaveBeenCalledTimes(1);

      const [first, ...rest] = pendingIpcReads.splice(0);
      first.reject(new Error('transient'));
      for (const read of rest) read.resolve({ onBattery: true });
      const initial = await initialRead;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(received).toEqual([]);

      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: false });
      expect(received.at(-1) ?? initial).toBe(false);
      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: true });
      expect(received.at(-1)).toBe(true);
      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: false });
      expect(received.at(-1)).toBe(false);
      dispose();
    });

    it('unsubscribe removes both the IPC and the chargingchange listeners', async () => {
      installGenuineBridge({ invoke: vi.fn(async () => ({ onBattery: false })) });
      registerPowerBridge();
      const battery = makeFakeBatteryManager(true);
      (navigator as any).getBattery = vi.fn(async () => battery);

      const source = createBatterySource();
      const received: boolean[] = [];
      const dispose = source.subscribe((onBattery) => received.push(onBattery));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(battery.listenerCount()).toBe(1);

      dispose();
      expect(battery.listenerCount()).toBe(0);
      emitMockIpcEvent(IPC_CHANNELS.POWER.BATTERY_CHANGED, { onBattery: true });
      battery.setCharging(false);
      expect(received).toEqual([]);
    });
  });

  it('ignores window.electronAPI when the build is the web target even under an Electron UA (<webview>)', async () => {
    simulateElectronRuntime();
    vi.stubEnv('INTENT_BUILD_TARGET', 'web');
    const invokeSpy = vi.fn(async () => ({ onBattery: true }));
    (window as any).electronAPI = { invoke: invokeSpy, on: vi.fn() };
    registerPowerBridge();
    registerBatteryChangedEventRelay();
    const battery = makeFakeBatteryManager(true);
    (navigator as any).getBattery = vi.fn(async () => battery);

    const source = createBatterySource();
    await expect(source.read()).resolves.toBe(false);
    expect(invokeSpy).not.toHaveBeenCalled();
    expect((window as any).electronAPI.on).not.toHaveBeenCalled();
    await expect(mockInvoke(IPC_CHANNELS.POWER.GET_BATTERY_STATE)).resolves.toEqual({
      onBattery: false,
    });
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
