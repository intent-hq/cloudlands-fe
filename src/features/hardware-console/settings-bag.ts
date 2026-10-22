import { appClient } from '$lib/client';

/** Shared opaque daemon setting; fields are owned by the frontend. */
export const HARDWARE_CONSOLE_SETTINGS_PATH = 'hardwareConsole.state';

export async function readHardwareConsoleSettingsBag(): Promise<Record<string, unknown> | null> {
  const setting = await appClient.settings.get(HARDWARE_CONSOLE_SETTINGS_PATH);
  if (setting === null) return null;
  const value = setting.value;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

let pendingWrite = Promise.resolve();

/**
 * Serialize all field writers in this renderer. The daemon replaces the whole
 * bag, so each write must read after the preceding update has completed (and
 * invalidated LiveSettingsClient's cache). This is not a cross-window lock.
 */
export function persistHardwareConsoleSettingsPatch(patch: Record<string, unknown>): Promise<void> {
  const write = pendingWrite.then(async () => {
    const bag = await readHardwareConsoleSettingsBag();
    if (bag === null) {
      throw new Error(
        `settings.get(${HARDWARE_CONSOLE_SETTINGS_PATH}) returned null — daemon read failed; skipping persist to avoid wiping the bag`,
      );
    }
    await appClient.settings.update([
      { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, ...patch } },
    ]);
  });
  // Callers still receive the rejection; a failed save must not poison the queue.
  pendingWrite = write.catch(() => {});
  return write;
}
