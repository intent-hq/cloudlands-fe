import { createSettingsClientRuntime } from '$lib/client/live/backend-settings-client';
import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '../backend/backend-transport';

/** Root starts before read owners and disposes after cancelling settings/read sagas. */
export const settingsRuntime = createSettingsClientRuntime({
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
});
export const settingsClient = settingsRuntime.client;
