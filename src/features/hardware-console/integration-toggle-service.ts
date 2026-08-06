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
import { appClient } from '$lib/client';
import { HARDWARE_CONSOLE_SETTINGS_PATH } from './assignment/key-pin-persistence-service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readHardwareConsoleSettingsBag(): Promise<Record<string, unknown> | null> {
  const setting = await appClient.settings.get(HARDWARE_CONSOLE_SETTINGS_PATH);
  if (setting === null) return null;
  return isRecord(setting.value) ? setting.value : {};
}

/** Read-modify-write: replace only `enabled`, preserving sibling fields. */
export async function persistHardwareConsoleEnabled(enabled: boolean): Promise<void> {
  const bag = (await readHardwareConsoleSettingsBag()) ?? {};
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, enabled } },
  ]);
}

/** Missing/invalid persisted values mean enabled (backward compatible). */
export function parseEnabled(value: unknown): boolean {
  return value !== false;
}
