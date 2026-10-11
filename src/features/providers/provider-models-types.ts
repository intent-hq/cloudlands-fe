import type { ProviderModelInfo } from '$shared/models/wire-model-info';

export type ProviderModelEntry = ProviderModelInfo;
export interface ProviderModelsResult {
  models: ProviderModelEntry[];
  warning?: string;
  stale?: boolean;
}
export interface ProviderModelsOptions {
  forceRefresh?: boolean;
  workspaceId?: string;
}

/** Existing per-provider IPC outcome, also used by the direct backend read binding. */
export interface ProviderModelsEnvelope {
  success: boolean;
  data?: ProviderModelEntry[];
  warning?: string;
  stale?: boolean;
  error?: string;
}
