/**
 * Key-pin persistence helpers for the hardware console saga.
 *
 * Assignments are STICKY: once hydration has succeeded and the workspace
 * list has loaded, the saga reconciles the pin array against the
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
 * hydrate, mirroring the workspace-creation service, so boot-time
 * default state never clobbers the persisted daemon bag.
 *
 * Saga orchestration lives in the hardware-console slice; this module owns
 * only the daemon settings parsing and read-modify-write operations.
 */
import { appClient } from '$lib/client';
import { normalizeExcludedWorkspaceIds, normalizeKeyPins } from './key-assignment';

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

/** Read the bag for a read-modify-write, failing when the read failed so a persist can never wipe sibling fields. */
async function readBagForPersist(): Promise<Record<string, unknown>> {
  const bag = await readBag();
  if (bag === null) {
    throw new Error(
      `settings.get(${HARDWARE_CONSOLE_SETTINGS_PATH}) returned null — daemon read failed; skipping persist to avoid wiping the bag`,
    );
  }
  return bag;
}

/** Read-modify-write: replace only `keyPins` + `excludedWorkspaceIds`, preserving sibling fields. */
export async function persistHardwareConsoleKeyPins(
  keyPins: (string | null)[],
  excludedWorkspaceIds: string[],
): Promise<void> {
  const bag = await readBagForPersist();
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, keyPins, excludedWorkspaceIds } },
  ]);
}

export async function loadHardwareConsoleKeyPins(): Promise<{
  keyPins: (string | null)[];
  excludedWorkspaceIds: string[];
}> {
  const bag = await readBag();
  if (bag === null) {
    throw new Error(
      `settings.get(${HARDWARE_CONSOLE_SETTINGS_PATH}) returned null — daemon read failed`,
    );
  }
  return {
    keyPins: parseKeyPins(bag.keyPins),
    excludedWorkspaceIds: normalizeExcludedWorkspaceIds(bag.excludedWorkspaceIds),
  };
}
