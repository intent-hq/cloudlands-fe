import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { ProviderModelsResult } from '$features/providers/provider-models.client';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

export type ModelLoadingStatus = 'success' | 'loading' | 'error';

/**
 * The model-list reply's optional labels (`warning`, `stale`, `warningKind`,
 * …), derived from the shared `GetModelsEnvelope` through the client's
 * `ProviderModelsResult` — the store's single declaration, so a new reply
 * label reaches the loading state (and the model picker) without a store edit.
 * See `GetModelsEnvelope` (PROTOCOL §6.7, §5.30) for each label's meaning;
 * `buildLoadingState` owns how labels carry across loading states.
 */
export type ModelReplyLabels = Omit<ProviderModelsResult, 'models'>;

export type ModelLoadingState = ModelReplyLabels & {
  status: ModelLoadingStatus;
  retryAttempt: number;
  error?: string;
};

export type ModelFallbackInfo = {
  fromModel: string;
  toModel: string;
};

export type ModelState = {
  availableModels: Collection<AuggieModel, 'value'>;
  /**
   * Provider the current `availableModels` catalog was loaded for ('' before
   * the first load). Bare model ids re-attribute to whatever the default
   * provider currently is, so consumers need this explicit provenance to know
   * whether the global catalog belongs to a given provider (e.g. the model
   * picker's disabled-provider fallback group).
   */
  availableModelsProviderId: string;
  loadingState: Record<string, ModelLoadingState>;
  providerModels: Record<string, string>;
  /** Existing host-execution connection context, including reconnect identity. */
  selectionConnection: string | null;
  /**
   * Reasoning-effort level paired with the default-model setting
   * (`model.defaultReasoningEffort`, PROTOCOL §5.12). '' means unset — the
   * daemon then leaves new agents on the model default. The level vocabulary
   * is provider-owned, so the value is mirrored verbatim.
   */
  defaultReasoningEffort: string;
  modelPickerCollapsedGroups: string[];
  fallbackInfoByAgentId: Record<string, ModelFallbackInfo>;
  /**
   * Default provider id — the provider leg of the default model triple
   * (`model.defaultProvider`, PROTOCOL §5.12; '' before hydration).
   * Updated only by daemon receipts, never by selection intents or catalogs.
   */
  defaultProviderId: string;
};
