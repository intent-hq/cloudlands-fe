/**
 * Power (battery) bridge seeder — the renderer's single source for "is this
 * machine on battery?", consumed by the power saga to drive `power.onBattery`.
 *
 * Three sources, chosen in this order by `createBatterySource()`:
 *
 * 1. Genuine Electron preload bridge → `power:get-battery-state` invoke
 *    (forwarded to main's powerMonitor handler) plus `power:battery-changed`
 *    events, relayed from the bridge onto the mock-router event channel so
 *    `listenSync` consumers (and tests via `emitMockIpcEvent`) share one path.
 * 2. Browser build with the Battery Status API → `navigator.getBattery()`,
 *    `onBattery = !battery.charging`, re-derived on `chargingchange`. The real
 *    Battery API is preferred over the mock router here.
 * 3. Neither (jsdom, desktop browsers without the API) → constant `false`.
 *
 * "Genuine preload" is decided by `expectsElectronPreloadBridge()` (the same
 * detector `hooks.client.ts` uses), not by `window.electronAPI` presence: the
 * dev:web build installs `$lib/browser-mock`, whose `electronAPI.invoke`
 * routes back into the mock router, so presence alone would hide the Battery
 * API branch behind the mock (intent-hq/monorepo#3606).
 *
 * The mock-router invoke handler stays deterministic: it forwards when the
 * genuine bridge exists and otherwise answers `{ onBattery: false }`, so the
 * mock IPC path never depends on host hardware.
 */
import { invoke, listenSync } from '$lib/electron-bridge';
import { expectsElectronPreloadBridge } from '$lib/utils/platform-capabilities';
import { emitMockIpcEvent, registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

interface BatteryState {
  onBattery: boolean;
}

/** Normalized battery signal: one initial read plus change notifications. */
export interface BatterySource {
  read(): Promise<boolean>;
  /** Returns the unsubscribe function. */
  subscribe(listener: (onBattery: boolean) => void): () => void;
}

/** Structural subset of the Battery Status API's `BatteryManager`. */
interface BatteryManagerLike {
  charging: boolean;
  addEventListener(type: 'chargingchange', listener: () => void): void;
  removeEventListener(type: 'chargingchange', listener: () => void): void;
}

type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryManagerLike> };

const NOT_ON_BATTERY: BatteryState = { onBattery: false };

function isBatteryState(value: unknown): value is BatteryState {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { onBattery?: unknown }).onBattery === 'boolean'
  );
}

/**
 * The real preload bridge, or `undefined` in the browser build (where
 * `window.electronAPI` is the dev mock) and in non-window contexts.
 */
function getPreloadBridge(): Window['electronAPI'] | undefined {
  if (typeof window === 'undefined' || !expectsElectronPreloadBridge()) return undefined;
  return window.electronAPI;
}

function hasPreloadBridge(): boolean {
  return typeof getPreloadBridge()?.invoke === 'function';
}

function getBatteryApi(): (() => Promise<BatteryManagerLike>) | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const getBattery = (navigator as NavigatorWithBattery).getBattery;
  return typeof getBattery === 'function' ? getBattery.bind(navigator) : undefined;
}

/** Forward `power:get-battery-state` to main over the genuine preload; deterministic otherwise. */
export function registerPowerBridge(): void {
  registerMockIpcHandler(IPC_CHANNELS.POWER.GET_BATTERY_STATE, async (payload?: unknown) => {
    const bridge = getPreloadBridge();
    if (bridge && typeof bridge.invoke === 'function') {
      return bridge.invoke(IPC_CHANNELS.POWER.GET_BATTERY_STATE, payload);
    }
    return NOT_ON_BATTERY;
  });
}

/**
 * Relay main-process `power:battery-changed` events from the real preload
 * bridge onto the mock-router event channel (same shape as the
 * `window:fullscreen` relay in window-state-bridge-seeder).
 */
export function registerBatteryChangedEventRelay(): void {
  const bridge = getPreloadBridge();
  if (bridge && typeof bridge.on === 'function') {
    bridge.on('power:battery-changed', (payload: unknown) => {
      emitMockIpcEvent('power:battery-changed', payload);
    });
  }
}

function createIpcBatterySource(): BatterySource {
  return {
    async read() {
      const result = await invoke<unknown>(IPC_CHANNELS.POWER.GET_BATTERY_STATE);
      return isBatteryState(result) ? result.onBattery : false;
    },
    subscribe(listener) {
      return listenSync<unknown>('power:battery-changed', ({ payload }) => {
        if (isBatteryState(payload)) listener(payload.onBattery);
      });
    },
  };
}

function createNavigatorBatterySource(
  getBattery: () => Promise<BatteryManagerLike>,
): BatterySource {
  return {
    async read() {
      const battery = await getBattery();
      return !battery.charging;
    },
    subscribe(listener) {
      let disposed = false;
      let cleanup: (() => void) | undefined;
      getBattery().then(
        (battery) => {
          if (disposed) return;
          const onChargingChange = () => listener(!battery.charging);
          battery.addEventListener('chargingchange', onChargingChange);
          cleanup = () => battery.removeEventListener('chargingchange', onChargingChange);
        },
        () => {
          // Battery API denied (e.g. Permissions Policy): stay silent, read() already reported it.
        },
      );
      return () => {
        disposed = true;
        cleanup?.();
      };
    },
  };
}

const NO_BATTERY_SOURCE: BatterySource = {
  read: async () => false,
  subscribe: () => () => {},
};

/** Pick the battery signal for this build: genuine Electron IPC → Battery API → none. */
export function createBatterySource(): BatterySource {
  if (hasPreloadBridge()) return createIpcBatterySource();
  const getBattery = getBatteryApi();
  if (getBattery) return createNavigatorBatterySource(getBattery);
  return NO_BATTERY_SOURCE;
}

registerPowerBridge();
registerBatteryChangedEventRelay();
