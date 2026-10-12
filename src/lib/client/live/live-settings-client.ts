import { backendRequest, onBackendNotification, onBackendReconnected } from './backend-transport';
import { createSettingsClientRuntime } from './backend-settings-client';

// Svelte compatibility binding: keep the original public API until the renderer cutover.
// Resolve source transport exports when called; remove this binding at renderer cutover.
const runtime = createSettingsClientRuntime({
  backendRequest: <T>(...args: Parameters<typeof backendRequest>): Promise<T> =>
    backendRequest<T>(...args),
  onBackendNotification: (
    ...args: Parameters<typeof onBackendNotification>
  ): ReturnType<typeof onBackendNotification> => onBackendNotification(...args),
  onBackendReconnected: (
    ...args: Parameters<typeof onBackendReconnected>
  ): ReturnType<typeof onBackendReconnected> => onBackendReconnected(...args),
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
