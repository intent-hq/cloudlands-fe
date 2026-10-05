/**
 * Integration enable/disable toggle for the hardware console.
 *
 * Hydrates the `enabled` flag from the shared `hardwareConsole.state` daemon
 * settings bag on the first dispatched action and persists toggle changes
 * (read-modify-write on the whole bag with only the `enabled` field replaced
 * — sibling fields like `keyPins`, `promptUsage`, and `actionMapping`
 * survive), mirroring the key-pin persistence service.
 *
 * The app-owned hardware-console saga owns hydration, persistence ordering,
 * and the shared manager lifecycle. This module keeps the dependency-light
 * settings helpers used by that saga.
 */
import { persistHardwareConsoleSettingsPatch } from './settings-bag';

/** Read-modify-write: replace only `enabled`, preserving sibling fields. */
export async function persistHardwareConsoleEnabled(enabled: boolean): Promise<void> {
  await persistHardwareConsoleSettingsPatch({ enabled });
}

/** Missing/invalid persisted values mean enabled (backward compatible). */
export function parseEnabled(value: unknown): boolean {
  return value !== false;
}
