import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { Collection } from '$lib/store-shim/utils/collections/collection-utils';

export type ModelLoadingStatus = 'success' | 'loading' | 'error';

export type ModelLoadingState = {
  status: ModelLoadingStatus;
  retryAttempt: number;
  error?: string;
  warning?: string;
};

export type ModelFallbackInfo = {
  fromModel: string;
  toModel: string;
};

export type ModelState = {
  availableModels: Collection<AuggieModel, 'value'>;
  loadingState: Record<string, ModelLoadingState>;
  providerModels: Record<string, string>;
  modelPickerCollapsedGroups: string[];
  fallbackInfoByAgentId: Record<string, ModelFallbackInfo>;
};
