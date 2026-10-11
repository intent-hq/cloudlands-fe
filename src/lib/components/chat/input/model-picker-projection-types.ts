import type { ProviderCatalogEntry } from '$shared/provider-catalog';
import type { ProviderLoadError } from './provider-load-error';

/** Only the option fields the picker projects; renderer-specific icons/callbacks stay with callers. */
export interface ModelPickerOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Source row class; the React binding translates this to className. */
  class?: string;
  data?: Record<string, unknown>;
}

export interface ModelPickerGroup {
  key: string;
  label: string;
  parentKey?: string;
  searchLabel?: string;
  options: ModelPickerOption[];
}

/**
 * An explicit read projection of the canonical provider registry and defaults.
 * Bind these reads to one state snapshot and scope. Unknown IDs remain unknown;
 * neither this contract nor the picker invents rows, aliases or a default provider.
 */
export interface ModelPickerProviderContext {
  providerIds: readonly string[];
  defaultProviderId: string;
  isHostMember: boolean;
  normalizeProviderId(providerId: string): string;
  getProviderEntry(providerId: string): ProviderCatalogEntry | undefined;
  resolveProviderEntry(providerId: string): ProviderCatalogEntry | undefined;
}

export type ProviderWarningNotice = {
  providerId: string;
  providerName: string;
  message: string;
  docsUrl?: string;
};

export interface ModelPickerOptionInput {
  value: string;
  label: string;
  description?: string;
  badges?: { color: string; label: string; variant?: string }[];
  costTier?: number;
  effortLevels?: string[];
  isDefault?: boolean;
  isLegacyModel?: boolean;
}

export interface IsUserProviderSettledParams {
  /** Models fetched for a disabled agent provider, or null while the fetch is pending. */
  agentProviderModels: readonly unknown[] | null;
  /** Error produced by the disabled agent-provider fetch, or null when none. */
  agentProviderError: string | null;
  /** Raw enabled provider ids; normalized internally through the catalog. */
  enabledProviderIds: string[];
  /** Models per normalized provider id for the "all providers" view. */
  allProviderModels: Record<string, ModelPickerOption[]>;
  /** The model's provider id, already normalized through the catalog. */
  modelProvider: string;
}

export interface FindModelFallbackOptionParams<
  Option extends ModelPickerOption = ModelPickerOption,
> {
  /** Candidate dropdown options (may include the "use default" sentinel). */
  options: Option[];
  /** Sentinel value to exclude from candidates (the "use default" option). */
  excludeValue?: string;
  /** When set, only consider options belonging to this provider. */
  restrictToProvider?: string;
  /** The user's globally selected model — the top-priority fallback pick. */
  globallySelectedModel?: string | null;
}

export interface BuildGroupedModelOptionsParams<
  Option extends ModelPickerOption = ModelPickerOption,
> {
  showDefaultOption: boolean;
  useDefaultOption: Option;
  effectiveProviderId: string;
  availableModels: ModelPickerOptionInput[];
  /**
   * Provider `availableModels` was actually loaded for ('' when unknown).
   * The disabled-effective-provider fallback group only renders those models
   * when this matches the effective provider — otherwise a stale catalog from
   * a previously active provider would show up under the wrong group label.
   */
  availableModelsProviderId: string;
  enabledProviderIds: string[];
  /**
   * The effective provider was explicitly disabled in Settings > Agents for an
   * existing agent. The disabled-effective-provider fallback group (kept since
   * cloudlands-fe#749 so a since-unavailable provider's model was not
   * orphaned) is then NOT rendered: the daemon refuses to run the agent on a
   * disabled provider and re-homes it on the next send (intent#5737), so the
   * picker must report the model as unavailable instead of keeping it
   * selectable. Defaults to false (guest windows, transient unavailability).
   */
  effectiveProviderDisabled?: boolean;
  allProviderModels: Record<string, Option[]>;
  allProviderLoading: Record<string, boolean>;
  allProviderErrors: Record<string, ProviderLoadError>;
  allProviderWarnings: Record<string, string>;
}
