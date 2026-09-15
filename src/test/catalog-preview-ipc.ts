// IPC fixtures used only by catalog previews. Production bridge registrations stay
// in the renderer seeders; each preview owns and tears down these temporary handlers.
import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
import type { ProviderModelInfo } from '$shared/models/wire-model-info';

export function setupModelPickerPreviewHandler(providerId: string, rows: ProviderModelInfo[]) {
  const channel = `${providerId}:get-models`;
  registerMockIpcHandler(channel, () => ({ success: true, data: rows }));
  return () => unregisterMockIpcHandler(channel);
}

export function setupProviderSelectorPreviewHandlers(availability: ProviderAvailabilityResult) {
  registerMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY, () => ({
    success: true,
    data: availability,
  }));
  registerMockIpcHandler(PROVIDERS_CHANNELS.GET_PATHS, () => ({
    success: true,
    data: { paths: {}, secondaryPaths: {} },
  }));
  return () => {
    unregisterMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY);
    unregisterMockIpcHandler(PROVIDERS_CHANNELS.GET_PATHS);
  };
}
