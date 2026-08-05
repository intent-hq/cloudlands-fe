/**
 * Key-pin persistence for the hardware console — hydrates the 6-slot pin
 * array plus the auto-fill exclusion list from the shared
 * `hardwareConsole.state` daemon settings bag on the first dispatched
 * action and writes them back after each pin mutation.
 *
 * Assignments are STICKY: once hydration has succeeded and the workspace
 * list has loaded, the middleware reconciles the pin array against the
 * current workspaces (`reconcileKeyPins`) — auto-filled slots are promoted
 * into persisted pins so they never shuffle with activity, and pins whose
 * workspace was archived/deleted are released (and backfilled). The first
 * reconcile after boot doubles as the migration snapshot: a pre-sticky
 * activity-derived layout is captured into persisted assignments.
 *
 * The bag is shared with other hardware-console state, so writes are
 * read-modify-write on the whole bag with only the `keyPins` and
 * `excludedWorkspaceIds` fields replaced (pin changes are rare; a fresh
 * read per write keeps sibling fields safe). Persists that fire before
 * hydration settles are deferred and flushed once after a successful
 * hydrate, mirroring the workspace-initializer service, so boot-time
 * default state never clobbers the persisted daemon bag.
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
  keyPinsReconciled,
  markKeySlotUnassigned,
  pinWorkspaceToKey,
  unpinWorkspaceFromKeys,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { getItems } from '$lib/store-shim/utils/collections/collection-utils';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  isKeyAssignableWorkspace,
  keyPinsEqual,
  normalizeExcludedWorkspaceIds,
  normalizeKeyPins,
  reconcileKeyPins,
} from './key-assignment';

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

/** Read-modify-write: replace only `keyPins` + `excludedWorkspaceIds`, preserving sibling fields. */
async function persistKeyPins(
  keyPins: (string | null)[],
  excludedWorkspaceIds: string[],
): Promise<void> {
  const bag = (await readBag()) ?? {};
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, keyPins, excludedWorkspaceIds } },
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
    appStore.dispatch(
      hydrateHardwareConsoleKeyPins(
        parseKeyPins(bag.keyPins),
        normalizeExcludedWorkspaceIds(bag.excludedWorkspaceIds),
      ),
    );
    return true;
  } catch (error) {
    logger.error('Key-pin hydration failed; dispatching defaults', { error });
    appStore.dispatch(hydrateHardwareConsoleKeyPins([]));
    return false;
  }
}

/**
 * Promote the current auto-fill layout into pins when it diverges from the
 * stored pin array (sticky assignments). Dispatches `keyPinsReconciled`
 * only on an actual change (callers persist afterwards), and only once the
 * workspace list has loaded — reconciling against an empty boot-time list
 * would wrongly release every assignment.
 */
function reconcileNow(): boolean {
  const state = appStore.state;
  if (!state.workspace.hasLoaded) return false;
  const workspaces = getItems(state.workspace.workspaces).filter(
    (workspace) => workspace.id !== CHIEF_WORKSPACE_ID && isKeyAssignableWorkspace(workspace),
  );
  const reconciled = reconcileKeyPins(
    state.hardwareConsole.keyPins,
    workspaces,
    state.hardwareConsole.excludedWorkspaceIds,
  );
  if (keyPinsEqual(normalizeKeyPins(state.hardwareConsole.keyPins), reconciled)) return false;
  appStore.dispatch(keyPinsReconciled(reconciled));
  return true;
}

export function createHardwareConsoleKeyPinPersistenceMiddleware(): StoreMiddleware {
  let hydrationStarted = false;
  let hydrationSettled = false;
  let hydrationSucceeded = false;
  let persistQueued = false;

  const persistNow = (): void => {
    void persistKeyPins(
      appStore.state.hardwareConsole.keyPins,
      appStore.state.hardwareConsole.excludedWorkspaceIds,
    ).catch((error) =>
      logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} keyPins`, { error }),
    );
  };

  const schedulePersist = (): void => {
    if (!hydrationSettled) {
      persistQueued = true;
      return;
    }
    persistNow();
  };

  return () => (next) => (action) => {
    if (!hydrationStarted) {
      hydrationStarted = true;
      void hydrateOnce()
        .catch(() => false)
        .then((hydrated) => {
          hydrationSettled = true;
          hydrationSucceeded = hydrated;
          const shouldFlush = persistQueued && hydrated;
          persistQueued = false;
          // First reconcile = migration snapshot: the previously
          // activity-derived layout becomes persisted sticky assignments.
          if (hydrated && reconcileNow()) {
            persistNow();
            return;
          }
          if (shouldFlush) persistNow();
        });
    }

    const result = next(action);

    const type = typeof action?.type === 'string' ? action.type : '';
    const isPinMutation =
      type === pinWorkspaceToKey.type ||
      type === unpinWorkspaceFromKeys.type ||
      type === markKeySlotUnassigned.type;
    const canReconcile = hydrationSettled && hydrationSucceeded;

    if (isPinMutation) {
      // A pin mutation can also change auto-fill (e.g. unpinning frees a
      // slot for the next workspace); reconcile first so a single write
      // persists the final layout.
      if (canReconcile) reconcileNow();
      schedulePersist();
    } else if (canReconcile && type.startsWith('workspace/')) {
      // Sticky reconciliation: promote auto-filled slots into pins and
      // release archived/deleted workspaces as workspace state changes.
      // reconcileNow() only dispatches on an actual pin-array change.
      if (reconcileNow()) persistNow();
    }

    return result;
  };
}
