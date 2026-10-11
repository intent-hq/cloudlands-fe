import type { SettingsClient, SettingsSnapshot } from '$lib/client/settings-types';

/** Uncached canonical read: callers choose the fields to publish from its revision. */
export function createSettingsSnapshotReader(settings: SettingsClient) {
  return async function readSettingsSnapshot(): Promise<SettingsSnapshot> {
    return settings.listSnapshot
      ? settings.listSnapshot()
      : { settings: await settings.list(), revision: 0 };
  };
}
