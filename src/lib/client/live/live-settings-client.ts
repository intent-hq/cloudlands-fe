import { backendRequest, onBackendNotification, onBackendReconnected } from './backend-transport';
import { createSettingsClientRuntime } from './backend-settings-client';

// Svelte compatibility binding: keep the original public API until the renderer cutover.
const runtime = createSettingsClientRuntime({
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
});
export const LiveSettingsClient = runtime.SettingsClient;
export type LiveSettingsClient = InstanceType<typeof LiveSettingsClient>;
export const {
  readSetting,
  updateSettings,
  invalidateSettingsReadCache,
  resetSettingsConnectionCache,
} = runtime;
export const __resetSettingsReadCacheForTests = resetSettingsConnectionCache;
