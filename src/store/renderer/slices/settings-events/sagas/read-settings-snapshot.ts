import { appClient } from '$lib/client';
import type { SettingsSnapshot } from '$lib/client/app-client';

/** Uncached daemon read; callers decide which received fields to apply. */
export async function readSettingsSnapshot(): Promise<SettingsSnapshot> {
  return appClient.settings.listSnapshot
    ? appClient.settings.listSnapshot()
    : { settings: await appClient.settings.list(), revision: 0 };
}
