/**
 * Power (battery) bridge seeder — the renderer's single source for "is this
 * machine on battery?", consumed by the power saga to drive `power.onBattery`.
 *
 * Two underlying signals, combined by `createBatterySource()`:
 *
 * - Genuine Electron preload bridge → `power:get-battery-state` invoke
 *   (forwarded to main's powerMonitor handler) plus `power:battery-changed`
 *   events, relayed from the bridge onto the mock-router event channel so
 *   `listenSync` consumers (and tests via `emitMockIpcEvent`) share one path.
 * - Battery Status API → `navigator.getBattery()`, `onBattery =
 *   !battery.charging`, re-derived on `chargingchange`. The real Battery API
 *   is preferred over the mock router here.
 *
 * Selection:
 *
 * 1. Electron with both → merged source, `onBattery = ipc || navigator`.
 *    Electron 42's powerMonitor (Chromium `battery_level_provider_mac.mm`)
 *    yields "unknown" on Macs whose IOKit power-source entry lacks the raw
 *    capacity keys, so `isOnBatteryPower()` is false and `on-battery` never
 *    fires; on Linux powerMonitor has no battery implementation at all. The
 *    Battery Status API reads through a separate backend (IOPS / UPower), so
 *    it detects battery power there while IPC stays the instant signal where
 *    it works. Each side is guarded independently (rejection → `false`).
 * 2. Electron without the Battery API → IPC only.
 * 3. Browser build with the Battery API → Battery API only.
 * 4. Neither (jsdom, desktop browsers without the API) → constant `false`.
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
import { createLogger } from '$lib/utils/client-logger';
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

const logger = createLogger('PowerBridgeSeeder');

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

/** Read one source, treating a rejection or a non-boolean result as off-battery. */
async function readGuarded(source: BatterySource): Promise<boolean> {
  try {
    return (await source.read()) === true;
  } catch {
    return false;
  }
}

/**
 * Union of the powerMonitor IPC and Battery API signals: `onBattery` is true
 * when either side reports it. Each side's last known value is seeded from its
 * `read()` and updated by its own change events; the merged value is emitted
 * only when it actually changes. A change event beats a still-pending seed for
 * its own side, and a seed that resolves after the first emission is
 * reconciled through the same emit path so the subscriber ends on the value
 * combining everything known.
 *
 * `read()` and `subscribe()` share one initial read per source, so the
 * subscription's dedupe baseline is the same value `read()` hands the saga: a
 * second, independent read that settled differently (e.g. one transient IPC
 * rejection) would otherwise leave the baseline disagreeing with the store and
 * swallow the next genuine transition.
 */
function createMergedBatterySource(ipc: BatterySource, nav: BatterySource): BatterySource {
  let seedLogged = false;
  let ipcSeed: Promise<boolean> | undefined;
  let navigatorSeed: Promise<boolean> | undefined;
  const seedIpc = () => (ipcSeed ??= readGuarded(ipc));
  const seedNavigator = () => (navigatorSeed ??= readGuarded(nav));
  return {
    async read() {
      const [fromIpc, fromNavigator] = await Promise.all([seedIpc(), seedNavigator()]);
      if (!seedLogged) {
        seedLogged = true;
        logger.info(`battery seed: ipc=${fromIpc}, navigator=${fromNavigator}`);
      }
      return fromIpc || fromNavigator;
    },
    subscribe(listener) {
      let disposed = false;
      let fromIpc = false;
      let fromNavigator = false;
      let ipcSeen = false;
      let navigatorSeen = false;
      let last: boolean | undefined;
      const emit = () => {
        if (disposed) return;
        const merged = fromIpc || fromNavigator;
        if (merged === last) return;
        last = merged;
        listener(merged);
      };
      let seedsPending = 2;
      const seed = (apply: (value: boolean) => void) => (value: boolean) => {
        if (disposed) return;
        apply(value);
        seedsPending -= 1;
        if (last !== undefined) emit();
        else if (seedsPending === 0) last = fromIpc || fromNavigator;
      };
      const unsubscribeIpc = ipc.subscribe((onBattery) => {
        ipcSeen = true;
        fromIpc = onBattery;
        emit();
      });
      const unsubscribeNavigator = nav.subscribe((onBattery) => {
        navigatorSeen = true;
        fromNavigator = onBattery;
        emit();
      });
      seedIpc().then(
        seed((value) => {
          if (!ipcSeen) fromIpc = value;
        }),
      );
      seedNavigator().then(
        seed((value) => {
          if (!navigatorSeen) fromNavigator = value;
        }),
      );
      return () => {
        disposed = true;
        unsubscribeIpc();
        unsubscribeNavigator();
      };
    },
  };
}

const NO_BATTERY_SOURCE: BatterySource = {
  read: async () => false,
  subscribe: () => () => {},
};

/** Pick the battery signal for this build: Electron IPC merged with the Battery API → IPC → Battery API → none. */
export function createBatterySource(): BatterySource {
  const getBattery = getBatteryApi();
  if (hasPreloadBridge()) {
    const ipc = createIpcBatterySource();
    return getBattery
      ? createMergedBatterySource(ipc, createNavigatorBatterySource(getBattery))
      : ipc;
  }
  if (getBattery) return createNavigatorBatterySource(getBattery);
  return NO_BATTERY_SOURCE;
}

registerPowerBridge();
registerBatteryChangedEventRelay();
