import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { GetModelsEnvelope } from '$shared/models/wire-model-info';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

export type ModelLoadingStatus = 'success' | 'loading' | 'error';

/**
 * The model-list reply's optional labels (`warning`, `stale`, `warningKind`,
 * …), derived from the shared `GetModelsEnvelope` — the store's single
 * declaration, so a new reply label reaches the loading state (and the model
 * picker) without a store edit. `buildLoadingState` owns how labels carry
 * across loading states.
 *
 * - `stale`: `warning` accompanies a last-known-good list served from the
 *   daemon's cache (PROTOCOL §5.30) rather than a degraded static fallback, so
 *   consumers can tell a transient probe failure from a missing CLI.
 * - `warningKind`: machine-readable cause of `warning` (PROTOCOL §5.30
 *   "Warning kind"); only `cli-missing` warrants the "install the CLI" notice.
 *   Absent for every other failure — never infer it from the warning text.
 */
export type ModelReplyLabels = Omit<GetModelsEnvelope, 'success' | 'data' | 'error'>;

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
