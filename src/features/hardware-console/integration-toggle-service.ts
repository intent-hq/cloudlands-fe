/**
 * Integration enable/disable toggle for the hardware console.
 *
 * Hydrates the `enabled` flag from the shared `hardwareConsole.state` daemon
 * settings bag on the first dispatched action and persists toggle changes
 * (read-modify-write on the whole bag with only the `enabled` field replaced
 * — sibling fields like `keyPins`, `promptUsage`, and `actionMapping`
 * survive), mirroring the key-pin persistence service.
 *
 * The toggle also drives the shared manager lifecycle: disabling stops it
 * (tears down the connection and hotplug listeners), enabling starts it
 * again. The per-feature `onStatusChange` subscriptions in the other
 * hardware-console services survive a stop/start cycle, so re-enabling
 * restores full functionality without reinstalling anything.
 *
 * Dependency-light middleware module per src/store/renderer/AGENTS.md: no
 * selector imports — state is read directly off `appStore.state`.
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import {
  hydrateHardwareConsoleEnabled,
  setHardwareConsoleEnabled,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { getHardwareConsoleManager } from './instance';
import { HARDWARE_CONSOLE_SETTINGS_PATH } from './assignment/key-pin-persistence-service';

const logger = createLogger('HardwareConsoleIntegrationToggle');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readBag(): Promise<Record<string, unknown> | null> {
  const setting = await appClient.settings.get(HARDWARE_CONSOLE_SETTINGS_PATH);
  if (setting === null) return null;
  return isRecord(setting.value) ? setting.value : {};
}

/** Read-modify-write: replace only `enabled`, preserving sibling fields. */
async function persistEnabled(enabled: boolean): Promise<void> {
  const bag = (await readBag()) ?? {};
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, enabled } },
  ]);
}

/** Missing/invalid persisted values mean enabled (backward compatible). */
export function parseEnabled(value: unknown): boolean {
  return value !== false;
}

async function hydrateOnce(): Promise<boolean> {
  try {
    const bag = await readBag();
    if (bag === null) {
      throw new Error(
        `settings.get(${HARDWARE_CONSOLE_SETTINGS_PATH}) returned null — daemon read failed`,
      );
    }
    appStore.dispatch(hydrateHardwareConsoleEnabled(parseEnabled(bag.enabled)));
    return true;
  } catch (error) {
    logger.error('Enabled-flag hydration failed; dispatching default (enabled)', { error });
    appStore.dispatch(hydrateHardwareConsoleEnabled(true));
    return false;
  }
}

/** Start or stop the shared manager to match the enabled flag. */
function applyManagerLifecycle(enabled: boolean): void {
  const manager = getHardwareConsoleManager();
  if (enabled) {
    void manager.start();
  } else {
    void manager.stop();
  }
}

/**
 * Lazily hydrates the enabled flag from the daemon bag on the first
 * dispatched action (key-pin persistence precedent), stopping the shared
 * manager when the persisted flag is off (the other hardware-console
 * middlewares start it eagerly). Toggle changes persist (deferred until
 * hydration settles) and start/stop the manager immediately.
 */
export function createHardwareConsoleIntegrationToggleMiddleware(): StoreMiddleware {
  let hydrationStarted = false;
  let hydrationSettled = false;
  let persistQueued = false;

  const persist = (): void => {
    void persistEnabled(appStore.state.hardwareConsole.enabled).catch((error) =>
      logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} enabled`, { error }),
    );
  };

  const schedulePersist = (): void => {
    if (!hydrationSettled) {
      persistQueued = true;
      return;
    }
    persist();
  };

  return () => (next) => (action) => {
    if (!hydrationStarted) {
      hydrationStarted = true;
      void hydrateOnce()
        .catch(() => false)
        .then((hydrated) => {
          hydrationSettled = true;
          const shouldFlush = persistQueued && hydrated;
          persistQueued = false;
          if (shouldFlush) persist();
          if (!appStore.state.hardwareConsole.enabled) applyManagerLifecycle(false);
        });
    }

    const result = next(action);

    if (action && action.type === setHardwareConsoleEnabled.type) {
      applyManagerLifecycle(appStore.state.hardwareConsole.enabled);
      schedulePersist();
    }

    return result;
  };
}
