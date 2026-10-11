import { appClient } from '$lib/client';
import { createSettingsSnapshotReader } from './settings-snapshot-reader';
// Svelte compatibility binding; remove at renderer cutover.
export const readSettingsSnapshot = createSettingsSnapshotReader(appClient.settings);
