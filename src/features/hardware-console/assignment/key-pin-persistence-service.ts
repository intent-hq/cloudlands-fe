/**
 * Key-pin persistence for the hardware console — hydrates the 6-slot pin
 * array from the shared `hardwareConsole.state` daemon settings bag on the
 * first dispatched action and writes it back after each pin mutation.
 *
 * The bag is shared with other hardware-console state, so writes are
 * read-modify-write on the whole bag with only the `keyPins` field replaced
 * (pin changes are rare; a fresh read per write keeps sibling fields safe).
 * Persists that fire before hydration settles are deferred and flushed once
 * after a successful hydrate, mirroring the workspace-initializer service,
 * so boot-time default state never clobbers the persisted daemon bag.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the
 * AppClient seam, the configured store, and slice actions — no selectors.
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import {
  hydrateHardwareConsoleKeyPins,
  markKeySlotUnassigned,
  pinWorkspaceToKey,
  unpinWorkspaceFromKeys,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { normalizeKeyPins } from './key-assignment';

const logger = createLogger('HardwareConsoleKeyPinPersistence');

/** Shared daemon settings bag for hardware-console state (opaque to the daemon). */
export const HARDWARE_CONSOLE_SETTINGS_PATH = 'hardwareConsole.state';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extract a tolerant pins array from the bag's `keyPins` field. */
function parseKeyPins(value: unknown): (string | null)[] {
  const raw = Array.isArray(value) ? value : [];
  return normalizeKeyPins(raw.map((pin) => (typeof pin === 'string' ? pin : null)));
}

async function readBag(): Promise<Record<string, unknown> | null> {
  const setting = await appClient.settings.get(HARDWARE_CONSOLE_SETTINGS_PATH);
  if (setting === null) return null;
  return isRecord(setting.value) ? setting.value : {};
}

/** Read-modify-write: replace only `keyPins`, preserving sibling fields. */
async function persistKeyPins(keyPins: (string | null)[]): Promise<void> {
  const bag = (await readBag()) ?? {};
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, keyPins } },
  ]);
}

async function hydrateOnce(): Promise<boolean> {
  try {
    const bag = await readBag();
    if (bag === null) {
      throw new Error(
        `settings.get(${HARDWARE_CONSOLE_SETTINGS_PATH}) returned null — daemon read failed`,
      );
    }
    appStore.dispatch(hydrateHardwareConsoleKeyPins(parseKeyPins(bag.keyPins)));
    return true;
  } catch (error) {
    logger.error('Key-pin hydration failed; dispatching defaults', { error });
    appStore.dispatch(hydrateHardwareConsoleKeyPins([]));
    return false;
  }
}

export function createHardwareConsoleKeyPinPersistenceMiddleware(): StoreMiddleware {
  let hydrationStarted = false;
  let hydrationSettled = false;
  let persistQueued = false;

  const schedulePersist = (): void => {
    if (!hydrationSettled) {
      persistQueued = true;
      return;
    }
    void persistKeyPins(appStore.state.hardwareConsole.keyPins).catch((error) =>
      logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} keyPins`, { error }),
    );
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
          if (shouldFlush) {
            void persistKeyPins(appStore.state.hardwareConsole.keyPins).catch((error) =>
              logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} keyPins`, {
                error,
              }),
            );
          }
        });
    }

    const result = next(action);

    if (
      action &&
      (action.type === pinWorkspaceToKey.type ||
        action.type === unpinWorkspaceFromKeys.type ||
        action.type === markKeySlotUnassigned.type)
    ) {
      schedulePersist();
    }

    return result;
  };
}
