/**
 * Compile-only migration contracts for the retained Svelte import paths.
 * Oracle: 003bc52c00dcfffe8513cd6be1b8f45011716714, before shared-renderer extraction.
 * Frozen shapes below come from that revision, not the current implementations.
 * The renderer tsconfig includes this file; no runtime imports or calls are emitted.
 * These checks preserve signatures, not runtime behavior or constructor identity.
 */
import type { selectPrincipalRevoked } from '$store/renderer/slices/principal/principal-selectors';
import type { selectIsProviderAuthenticationError } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import type { settleBackgroundSettings } from '$store/renderer/slices/background-agent-settings/sagas/settle-background-settings';
import type {
  IncompatiblePrincipalResponse,
  isRetryablePrincipalError,
} from '$lib/client/live/live-principal-client';
import type { extractConflict } from '$lib/client/live/live-support';
import type {
  ProviderModelEntry,
  ProviderModelsResult,
  getProviderModels,
} from '$features/providers/provider-models.client';
import type {
  DeltaPayload,
  SubscriptionPush,
  DeltaReconciler,
  parseSubscriptionPush,
} from '$lib/client/live/delta-subscription';
import type {
  ProviderModel,
  fetchModelsForProvider,
} from '$store/renderer/slices/model/model-utils';
import type {
  AgentModelMutatorOptions,
  AgentModelMutator,
  SkippedMutation,
  createAgentModelMutator,
  SKIPPED_MUTATION,
  isSkippedMutation,
} from '$lib/components/chat/input/agent-model-mutator';
import type {
  ModelPickerOptionInput,
  collapseCodexEffortModels,
  toDropdownOptions,
} from '$lib/components/chat/input/model-picker-utils';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AfterState<T extends unknown[]> = T extends [unknown, ...infer Args] ? Args : never;
type GeneratorResult<T> = T extends Generator<unknown, infer Result, unknown> ? Result : never;

// The original selectors return Svelte readables and expose select/effect call modes.
type FrozenReadable<T> = {
  subscribe(run: (value: T) => void, invalidate?: (value?: T) => void): () => void;
};

// Original background-agent-settings-slice.ts: ProviderBgSettings,
// BackgroundSettingsValues and backgroundSettingsSaveSettled's payload.
type FrozenProviderBgSettings = {
  defaultReasoningEffort?: string;
  typeReasoningEffortOverrides?: Record<string, string>;
  defaultModel: string;
  typeOverrides: Record<'commit' | 'pr' | 'review' | 'fast', string>;
};
type FrozenBackgroundSettingsValues = Required<FrozenProviderBgSettings> & {
  providerSettings: Record<string, FrozenProviderBgSettings>;
};
type FrozenSettlementAck = {
  generation: number;
  providerId?: string;
  revision?: number;
  authoritativeProviderId?: string;
  savedValues?: FrozenBackgroundSettingsValues;
};
// Original app-client.ts: AppliedSettingChange.
type FrozenAppliedSettingChange = {
  path: string;
  value: unknown;
  origin?: 'default' | 'file' | 'flag';
};

// Original provider-models.client.ts: ProviderModelEntry / ProviderModelsResult.
type FrozenProviderModelEntry = {
  value: string;
  label: string;
  description?: string;
  modelGroupPriority?: number;
  costTier?: number;
  badges?: { color: string; label: string; variant?: string }[];
  effortLevels?: string[];
  isDefault?: boolean;
  isLegacyModel?: boolean;
  priority?: number;
};
type FrozenProviderModelsResult = {
  models: FrozenProviderModelEntry[];
  warning?: string;
  stale?: boolean;
};

// Original delta-subscription.ts: optional delta fields and discriminated push kind.
type FrozenDeltaPayload = {
  added?: unknown[];
  updated?: unknown[];
  removedIds?: string[];
};
type FrozenSubscriptionPush = {
  subscriptionId: string;
  kind: 'snapshot' | 'delta';
  seq: number;
  snapshot?: unknown[];
  delta?: FrozenDeltaPayload;
};

// Original agent-model-mutator.ts plus agent-model-types.ts / shared/types.ts Result.
type FrozenMutatorOptions = { isLocked: () => boolean; consumerId?: string };
type FrozenSkippedMutation = { readonly skipped: true };
type FrozenAgentModelResult =
  | { ok: true; data: { success: boolean; modelId?: string; error?: string } }
  | { ok: false; error: string };
type FrozenAgentModelOutcome = {
  status: 'success' | 'failure' | 'cancelled';
  modelResult?: FrozenAgentModelResult;
  modelAccepted?: boolean;
  error?: string;
};
type FrozenAgentModelMutator = {
  selectModel(
    agentId: string,
    model: string,
    workspaceId: string,
    providerId: string,
    isCurrent?: () => boolean,
  ): Promise<FrozenAgentModelOutcome>;
  setSessionModel(agentId: string, model: string, providerId?: string): boolean;
  setModel(
    agentId: string,
    model: string,
    workspaceId: string,
    providerId?: string,
  ): Promise<FrozenAgentModelResult | FrozenSkippedMutation>;
  reconcileEffort(
    agentId: string,
    workspaceId: string,
    currentEffort: string | null | undefined,
    supportedEfforts: readonly string[] | null | undefined,
    isCurrent?: () => boolean,
  ): Promise<boolean>;
  applyEffort(
    agentId: string,
    workspaceId: string,
    effort: string | null,
    previousEffort: string | null,
  ): Promise<boolean>;
};

// Original model-picker-utils.ts: ModelPickerOptionInput.
type FrozenModelPickerOptionInput = {
  value: string;
  label: string;
  description?: string;
  badges?: { color: string; label: string; variant?: string }[];
  costTier?: number;
  effortLevels?: string[];
  isDefault?: boolean;
  isLegacyModel?: boolean;
};

// Exported only so the compiler entry owns named assertions without runtime keepalives.
export type LegacyRendererCompatibility = {
  principalSelector: [
    Assert<Equal<AfterState<Parameters<typeof selectPrincipalRevoked.select>>, []>>,
    Assert<Equal<ReturnType<typeof selectPrincipalRevoked.select>, boolean>>,
    Assert<Equal<Parameters<typeof selectPrincipalRevoked.effect>, []>>,
    Assert<Equal<GeneratorResult<ReturnType<typeof selectPrincipalRevoked.effect>>, boolean>>,
    Assert<Equal<Parameters<typeof selectPrincipalRevoked>, []>>,
    Assert<Equal<ReturnType<typeof selectPrincipalRevoked>, FrozenReadable<boolean>>>,
  ];
  providerSelector: [
    Assert<
      Equal<
        AfterState<Parameters<typeof selectIsProviderAuthenticationError.select>>,
        [providerId: string, errorMessage: string]
      >
    >,
    Assert<Equal<ReturnType<typeof selectIsProviderAuthenticationError.select>, boolean>>,
    Assert<
      Equal<
        Parameters<typeof selectIsProviderAuthenticationError.effect>,
        [providerId: string, errorMessage: string]
      >
    >,
    Assert<
      Equal<GeneratorResult<ReturnType<typeof selectIsProviderAuthenticationError.effect>>, boolean>
    >,
    Assert<
      Equal<
        Parameters<typeof selectIsProviderAuthenticationError>,
        [providerId: string | FrozenReadable<string>, errorMessage: string | FrozenReadable<string>]
      >
    >,
    Assert<Equal<ReturnType<typeof selectIsProviderAuthenticationError>, FrozenReadable<boolean>>>,
  ];
  settlement: [
    Assert<
      Equal<
        Parameters<typeof settleBackgroundSettings>,
        [
          ack: FrozenSettlementAck,
          saved?: FrozenBackgroundSettingsValues,
          applied?: readonly FrozenAppliedSettingChange[],
        ]
      >
    >,
    Assert<Equal<GeneratorResult<ReturnType<typeof settleBackgroundSettings>>, void>>,
  ];
  principalErrors: [
    Assert<
      Equal<
        ConstructorParameters<typeof IncompatiblePrincipalResponse>,
        [message?: string, options?: { cause?: unknown }]
      >
    >,
    Assert<InstanceType<typeof IncompatiblePrincipalResponse> extends Error ? true : false>,
    Assert<Equal<typeof isRetryablePrincipalError, (error: unknown) => boolean>>,
    Assert<Equal<typeof extractConflict, (error: unknown) => { current: unknown } | undefined>>,
  ];
  providerModels: [
    Assert<Equal<ProviderModelEntry, FrozenProviderModelEntry>>,
    Assert<Equal<ProviderModelsResult, FrozenProviderModelsResult>>,
    Assert<Equal<ProviderModel, FrozenProviderModelEntry>>,
    Assert<
      Equal<
        typeof getProviderModels,
        (
          providerId: string,
          options?: { forceRefresh?: boolean; workspaceId?: string },
        ) => Promise<FrozenProviderModelsResult>
      >
    >,
    Assert<
      Equal<
        typeof fetchModelsForProvider,
        (providerId: string) => Promise<FrozenProviderModelEntry[]>
      >
    >,
  ];
  subscription: [
    Assert<Equal<DeltaPayload, FrozenDeltaPayload>>,
    Assert<Equal<SubscriptionPush, FrozenSubscriptionPush>>,
    Assert<
      Equal<
        typeof parseSubscriptionPush,
        (method: string, params: unknown) => FrozenSubscriptionPush | null
      >
    >,
    Assert<
      Equal<
        DeltaReconciler<unknown>['applyDelta'],
        (seq: number, delta: FrozenDeltaPayload) => boolean
      >
    >,
  ];
  mutator: [
    Assert<Equal<AgentModelMutatorOptions, FrozenMutatorOptions>>,
    Assert<Equal<AgentModelMutator, FrozenAgentModelMutator>>,
    Assert<Equal<SkippedMutation, FrozenSkippedMutation>>,
    Assert<Equal<typeof SKIPPED_MUTATION, FrozenSkippedMutation>>,
    Assert<Equal<typeof isSkippedMutation, (value: unknown) => value is FrozenSkippedMutation>>,
    Assert<
      Equal<
        typeof createAgentModelMutator,
        (options: FrozenMutatorOptions) => FrozenAgentModelMutator
      >
    >,
  ];
  modelPicker: [
    Assert<Equal<ModelPickerOptionInput, FrozenModelPickerOptionInput>>,
    Assert<
      Equal<
        typeof collapseCodexEffortModels,
        (models: FrozenModelPickerOptionInput[]) => FrozenModelPickerOptionInput[]
      >
    >,
    Assert<Equal<Parameters<typeof toDropdownOptions>, [models: FrozenModelPickerOptionInput[]]>>,
  ];
};
