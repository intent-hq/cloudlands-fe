// IPC fixtures used only by catalog previews. Production bridge registrations stay
// in the renderer seeders; each preview owns and tears down these temporary handlers.
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
import type {
  GetModelsEnvelope,
  ModelWarningKind,
  ProviderModelInfo,
} from '$shared/models/wire-model-info';

type ModelCatalogResponse = {
  data: ProviderModelInfo[];
  warning?: string;
  warningKind?: ModelWarningKind;
};

/**
 * Serves `<provider>:get-models`. `first`, when given, answers only the first
 * call — e.g. a degraded catalog that Retry then replaces with `rows`.
 */
export function setupModelPickerPreviewHandler(
  providerId: string,
  rows: ProviderModelInfo[],
  warning?: string,
  first?: ModelCatalogResponse,
) {
  const channel = `${providerId}:get-models`;
  let pending = first;
  return overrideMockIpcHandler(channel, (): GetModelsEnvelope => {
    const served: ModelCatalogResponse = pending ?? { data: rows, warning };
    pending = undefined;
    return {
      success: true,
      data: served.data,
      ...(served.warning ? { warning: served.warning } : {}),
      ...(served.warning && served.warningKind ? { warningKind: served.warningKind } : {}),
    };
  });
}

export function setupProviderSelectorPreviewHandlers(availability: ProviderAvailabilityResult) {
  const restoreAvailability = overrideMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY, () => ({
    success: true,
    data: availability,
  }));
  const restorePaths = overrideMockIpcHandler(PROVIDERS_CHANNELS.GET_PATHS, () => ({
    success: true,
    data: { paths: {}, secondaryPaths: {} },
  }));
  return () => {
    restorePaths();
    restoreAvailability();
  };
}
