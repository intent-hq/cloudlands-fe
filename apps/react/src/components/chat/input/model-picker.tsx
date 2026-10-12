// Port of src/lib/components/chat/input/ModelPicker.svelte. Internal React integration only.
import {
  useId,
  useRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  type Ref,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useSignal, useComputed, useSignalEffect, untracked, batch } from '@preact/signals-react';
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  GearIcon,
  LockIcon,
  PlusIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react';
import { truncatedTitle } from '$lib/actions/observe-overflow';
import { Button } from '@/components/ui/button';
import {
  Dropdown,
  type DropdownHandle,
  type DropdownOption,
  type DropdownGroupProps,
  type DropdownItemProps,
} from '@/components/ui/dropdown';
import {
  AgentProviderIcon as ProviderIcon,
  hasProviderIcon,
} from '@/features/agent/components/agent-provider-icon';
import { ContentDialog } from '@/components/patterns/confirm';
import { notify } from '@/components/patterns/notify';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { Indicator } from '@/components/ui/menu';
import { cn } from '@/lib/utils';
import { pushEscapeLayer } from '$lib/utils/escapeLayers';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { modelIdForDisplay, resolveModelDisplayName } from '$shared/utils/model-display-name';
import { getAgentProvider } from '$shared/types/agent-session';
import { store as appStore } from '@/store';
import { applyReasoningEffort } from '@/features/agent/reasoning-effort';
import { selectPrincipalConnectionContext } from '@/store/principal/principal-selectors';
import { selectIsHostMember } from '@/store/host-execution/host-execution-selectors';
import { selectIsWorkspaceCollaborator } from '@/store/workspace/workspace-selectors';
import {
  selectAgentSession,
  selectAgentReasoningEffort,
} from '@/store/agent-session/agent-session-selectors';
import {
  selectAgentModelMutationPending,
  selectAgentModelMutations,
  selectAgentModelWriteSnapshot,
} from '@/store/agent-model/agent-model-selectors';
import {
  selectAvailableModels,
  selectAvailableModelsProviderId,
  selectModelFallbackInfo,
  selectModelPickerCollapsedGroups,
  selectIsLoadingModels,
  selectLoadError,
  selectAgentModelEffortLevels,
} from '@/store/model/model-selectors';
import { selectDaemonHealth } from '@/store/daemon-health/daemon-health-selectors';
import {
  selectIsProviderModelAccessAllowed,
  selectActiveProviderId,
} from '@/store/provider-settings/provider-settings-selectors';
import {
  selectContextDefaultProvider,
  selectContextReadinessLoaded,
  selectContextSelectedModel,
  selectContextProviderWarnings,
  selectContextProviderStaleFlags,
  selectContextProviderEntries,
  selectContextModelProviderIds,
  selectContextAvailableProviderIds,
  selectContextEnabledProviders,
  selectWorkspaceCatalogEpoch,
} from '@/store/provider-catalog/workspace-catalog-selectors';
import {
  selectAllCatalogProviderIds,
  selectEffectiveDefaultProviderId,
  selectNormalizedProviderId,
  selectProviderCatalogEntries,
  selectProviderCatalogEntry,
  selectResolvedProviderCatalogEntry,
} from '@/store/provider-catalog/provider-catalog-selectors';
import {
  selectProviderModelsCacheMap,
  selectLearnedModelDisplayName,
  selectLearnedModelNames,
  selectProviderModelsRequests,
} from '@/store/provider-models/provider-models-selectors';
import { isQuickActionProviderSwitchBlocked } from '../../../../../../src/store/renderer/slices/background-agent-settings/quick-action-provider-switch';
import { backgroundProviderSwitchBlocked } from '../../../../../../src/store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import {
  agentModelMutationRequested,
  agentModelMutationConsumed,
} from '../../../../../../src/store/renderer/slices/agent-model/agent-model-slice';
import {
  agentMetadataAcquired,
  agentMetadataReleased,
} from '../../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  clearModelFallbackInfo,
  selectModel,
  setModelFallbackInfo,
  setModelPickerGroupCollapsed,
} from '../../../../../../src/store/renderer/slices/model/model-slice';
import type { ModelFallbackInfo } from '../../../../../../src/store/renderer/slices/model/model-types';
import { ensureProvidersChecked } from '../../../../../../src/store/renderer/slices/agent-availability/agent-availability-slice';
import { ensureWorkspaceCatalogRequested } from '../../../../../../src/store/renderer/slices/provider-catalog/provider-catalog-slice';
import {
  providerModelsObserved,
  providerModelsReleased,
  providerModelsRequested,
} from '../../../../../../src/store/renderer/slices/provider-models/provider-models-slice';
import { ModelPickerEmptyState } from './model-picker-empty-state';
import { EffortGauge } from './effort-gauge';
import { EffortPicker } from './effort-picker';
import { ModelPickerGroupHeader } from './model-picker-group-header';
import { ModelPickerLegacyGroupHeader } from './model-picker-legacy-group-header';
import { ModelPickerProviderNotice } from './model-picker-provider-notice';
import { ModelProviderErrorItem } from './model-provider-error-item';
import {
  createModelPickerProjections,
  AUGGIE_LEGACY_GROUP_KEY,
  filterDefaultPseudoOptions,
  toDropdownOptions,
  type ProviderLoadError,
  type ProviderWarningNotice,
  type ModelPickerProviderContext,
} from './model-picker-projections';
import './model-picker.css';

const logger = createLogger('ModelPicker');

export interface ModelPickerProps {
  ref?: Ref<ModelPickerHandle>;
  /** Host must supply real settings navigation; the React settings route is not implemented. */
  onOpenProviderSettings: () => void | Promise<void>;
  selectedModel?: string | null;
  /**
   * Called on every user pick. `model` keeps the picked row's raw value for
   * backward compatibility (bare for the default provider, legacy
   * `provider:model` otherwise); `pick` carries the resolved triple legs —
   * the bare model id and its owning provider — so consumers never parse
   * the model string for a provider. Absent on the "use default" pick
   * (`model === ''`).
   */
  onModelChange?: (
    model: string,
    pick?: {
      providerId: string;
      modelId: string;
    },
  ) => void;
  /**
   * Optional go/no-go gate invoked before a user-picked model change is
   * applied. Called with the current and target model ids when they differ;
   * returning (or resolving) false reverts the dropdown selection and skips
   * the change entirely. Auto-fallback selections bypass this gate.
   */
  confirmModelChange?: (
    from: string | null | undefined,
    to: string | null,
    labels?: {
      from: string;
      to: string;
      fromProviderId?: string;
      toProviderId?: string;
    },
  ) => boolean | Promise<boolean>;
  providerId?: string;
  /** Provider-local settings cannot persist a selection owned by another provider. */
  allowProviderSwitch?: boolean;
  isCompact?: boolean;
  isLocked?: boolean;
  lockedTitle?: string;
  showLockIconWhenLocked?: boolean;
  deferUpdate?: boolean;
  variant?: 'ghost' | 'ghost-light' | 'underline' | 'outline' | 'default';
  size?: 'xs' | 'sm' | 'icon';
  workspaceId?: string;
  agentId?: string;
  /** Compatibility prop: the source always retains the owner settings affordance. */
  showManageLink?: boolean;
  portal?: boolean;
  modalAware?: boolean;
  collisionBoundary?: string | HTMLElement | null;
  triggerClass?: string;
  defaultModelId?: string;
  // Trigger label when no explicit model and no defaultModelId resolve
  // (e.g. "Provider default" for daemon-resolved specialist previews).
  defaultModelLabel?: string;
  // Opt-in display fallback for daemon-preview consumers: when no explicit
  // model is selected and no defaultModelId preview resolved (preview fetch
  // not landed yet / daemon catalog cache cold), show the effective
  // provider's isDefault-marked catalog row instead of the generic
  // defaultModelLabel. Display-only — the create path still omits the model.
  fallbackToCatalogDefault?: boolean;
  // Provider whose isDefault catalog row the fallback reads. Consumers that
  // create with a provider other than the picker's effective one (e.g.
  // InitialAgentPicker's selectedProvider) pass it so the fallback matches
  // what the daemon would pin. Defaults to the effective provider.
  fallbackProviderId?: string;
  showDefaultOption?: boolean;
  // Overrides for the "use default" dropdown option's label/description
  // (e.g. the specialist editor's "Inherit global default" wording).
  defaultOptionLabel?: string;
  defaultOptionDescription?: string;
  // Wraps the resolved defaultModelId label on the trigger when no explicit
  // model is selected (e.g. "Default ({model})" for the specialist editor's
  // inherit state). Also applies to the catalog-default fallback.
  formatDefaultModelLabel?: (modelLabel: string) => string;
  // Gates agent-session updates (session model write, agent.setModel).
  updateGlobalStore?: boolean;
  // Gates the global selectModel dispatch (persisted default); Settings default picker only.
  updateGlobalDefault?: boolean;
  silentFallback?: boolean;
  showReasoning?: boolean;
  reasoningEffort?: string | null;
  /** Display-only inherited effort; never materialized into a selection. */
  defaultReasoningEffort?: string | null;
  onReasoningChange?: (effort: string | null) => boolean | void | Promise<boolean | void>;
  reasoningDisabled?: boolean;
  showProviderWarningNotice?: boolean;
  /**
   * Extra classes for the provider notice boxes. Callers that render the
   * picker inside a flex row use this to let the notice break onto its own
   * full-width line (e.g. `basis-full w-full max-w-full` + `flex-wrap` on
   * the row) instead of sitting inline next to the trigger.
   */
  noticeClass?: string;
}
export interface ModelPickerHandle {
  open(): void;
  clearFallbackWarning(): void;
}
export function ModelPicker(props: ModelPickerProps) {
  // The app's Signals transform tracks these reads; slots are evaluated here too.
  const propsSignal = useSignal(props);
  // One atomic prop handoff prevents a retired scope's deferred choice or
  // confirmation from applying while the new scope is being rendered.
  useLayoutEffect(() => {
    const previous = propsSignal.peek();
    batch(() => {
      if (
        previous.agentId !== props.agentId ||
        previous.workspaceId !== props.workspaceId ||
        previous.providerId !== props.providerId ||
        previous.updateGlobalStore !== props.updateGlobalStore ||
        previous.updateGlobalDefault !== props.updateGlobalDefault
      ) {
        modelChangeRevision.current++;
        confirmationRevision.current++;
        pendingModelUpdate.value = null;
        if (submittedModelChange.value) {
          appStore.dispatch(
            agentModelMutationConsumed(submittedModelChange.value.requestId, mutationConsumerId),
          );
          submittedModelChange.value = null;
        }
        draftModel.value = props.updateGlobalDefault ? undefined : props.selectedModel;
        localPickedProviderId.value = null;
        userChangedModel.value = false;
        propModelAtLocalChange.value = undefined;
        disabledProviderSnapshot.value = null;
        reHomeAnnouncementSuppressed.value = false;
        silentRetryAttemptedForProvider.current = null;
        dropdownOpen.value = false;
        modelSearchValue.value = '';
      }
      if (previous.isLocked !== props.isLocked) confirmationRevision.current++;
      propsSignal.value = props;
    });
  });
  const selectedModel = useComputed(() => propsSignal.value.selectedModel);
  const onModelChange = useComputed(() => propsSignal.value.onModelChange);
  const confirmModelChange = useComputed(() => propsSignal.value.confirmModelChange);
  const providerId = useComputed(() => propsSignal.value.providerId);
  const allowProviderSwitch = useComputed(() =>
    propsSignal.value.allowProviderSwitch === undefined
      ? true
      : propsSignal.value.allowProviderSwitch,
  );
  const isCompact = useComputed(() =>
    propsSignal.value.isCompact === undefined ? false : propsSignal.value.isCompact,
  );
  const isLocked = useComputed(() =>
    propsSignal.value.isLocked === undefined ? false : propsSignal.value.isLocked,
  );
  const lockedTitle = useComputed(() => propsSignal.value.lockedTitle);
  const showLockIconWhenLocked = useComputed(() =>
    propsSignal.value.showLockIconWhenLocked === undefined
      ? true
      : propsSignal.value.showLockIconWhenLocked,
  );
  const deferUpdate = useComputed(() =>
    propsSignal.value.deferUpdate === undefined ? false : propsSignal.value.deferUpdate,
  );
  const variant = useComputed(() =>
    propsSignal.value.variant === undefined ? 'ghost-light' : propsSignal.value.variant,
  );
  const size = useComputed(() =>
    propsSignal.value.size === undefined ? 'sm' : propsSignal.value.size,
  );
  const workspaceId = useComputed(() => propsSignal.value.workspaceId);
  const agentId = useComputed(() => propsSignal.value.agentId);
  const portal = useComputed(() =>
    propsSignal.value.portal === undefined ? true : propsSignal.value.portal,
  );
  const modalAware = useComputed(() =>
    propsSignal.value.modalAware === undefined ? false : propsSignal.value.modalAware,
  );
  const collisionBoundary = useComputed(() =>
    propsSignal.value.collisionBoundary === undefined ? null : propsSignal.value.collisionBoundary,
  );
  const triggerClass = useComputed(() =>
    propsSignal.value.triggerClass === undefined ? '' : propsSignal.value.triggerClass,
  );
  const defaultModelId = useComputed(() => propsSignal.value.defaultModelId);
  const defaultModelLabel = useComputed(() => propsSignal.value.defaultModelLabel);
  const fallbackToCatalogDefault = useComputed(() =>
    propsSignal.value.fallbackToCatalogDefault === undefined
      ? false
      : propsSignal.value.fallbackToCatalogDefault,
  );
  const fallbackProviderId = useComputed(() => propsSignal.value.fallbackProviderId);
  const showDefaultOption = useComputed(() =>
    propsSignal.value.showDefaultOption === undefined ? false : propsSignal.value.showDefaultOption,
  );
  const defaultOptionLabel = useComputed(() => propsSignal.value.defaultOptionLabel);
  const defaultOptionDescription = useComputed(() => propsSignal.value.defaultOptionDescription);
  const formatDefaultModelLabel = useComputed(() => propsSignal.value.formatDefaultModelLabel);
  const updateGlobalStore = useComputed(() =>
    propsSignal.value.updateGlobalStore === undefined ? false : propsSignal.value.updateGlobalStore,
  );
  const updateGlobalDefault = useComputed(() =>
    propsSignal.value.updateGlobalDefault === undefined
      ? false
      : propsSignal.value.updateGlobalDefault,
  );
  const silentFallback = useComputed(() =>
    propsSignal.value.silentFallback === undefined ? false : propsSignal.value.silentFallback,
  );
  const showReasoning = useComputed(() =>
    propsSignal.value.showReasoning === undefined ? false : propsSignal.value.showReasoning,
  );
  const reasoningEffort = useComputed(() => propsSignal.value.reasoningEffort);
  const defaultReasoningEffort = useComputed(() => propsSignal.value.defaultReasoningEffort);
  const onReasoningChange = useComputed(() => propsSignal.value.onReasoningChange);
  const reasoningDisabled = useComputed(() =>
    propsSignal.value.reasoningDisabled === undefined ? false : propsSignal.value.reasoningDisabled,
  );
  const showProviderWarningNotice = useComputed(() => propsSignal.value.showProviderWarningNotice);
  const noticeClass = useComputed(() => propsSignal.value.noticeClass);
  const onOpenProviderSettings = useComputed(() => propsSignal.value.onOpenProviderSettings);
  const hostMember$ = selectIsHostMember();

  // Display projections use the canonical registry and the selection's explicit scope.
  function isProviderEnabled(ids: string[], id: string) {
    return pickerProjections().isProviderEnabled(ids, id);
  }
  function isProviderDisabledInSettings(enabled: Record<string, boolean>, id: string) {
    return pickerProjections().isProviderDisabledInSettings(enabled, id);
  }
  function normalizeModelIdForMatch(id: string, provider?: string) {
    return pickerProjections().normalizeModelIdForMatch(id, provider);
  }
  function normalizeProviderId(providerId: string): string {
    void providerCatalogEntries$.value;
    return (
      providerCatalogEntries$.value.find(
        (p) => p.id === providerId || p.legacyAliases?.includes(providerId),
      )?.id ?? providerId
    );
  }
  function providerDisplayName(providerId: string): string {
    void providerCatalogEntries$.value;
    return (
      providerCatalogEntries$.value.find((p) => p.id === normalizeProviderId(providerId))
        ?.displayName ?? providerId
    );
  }
  function parseCompoundModelId(compoundModelId: string): {
    providerId: string;
    modelId: string;
  } {
    const { providerId, modelId } = splitLegacyCompoundId(compoundModelId);
    return { providerId: providerId ?? defaultProviderId$.value, modelId };
  }
  function hasResolvedProvider(providerId: string): boolean {
    void providerCatalogEntries$.value;
    return providerCatalogEntries$.value.some((p) => p.id === normalizeProviderId(providerId));
  }
  const antigravityModelsAllowed$ = selectIsProviderModelAccessAllowed('antigravity');
  // Antigravity sign-in is a guest-local fact; a guest-locked picker reads the
  // host catalog regardless (`isGuestLocked` is declared with the props below
  // and only read once the picker is rendering).
  function canUseProviderModels(providerId: string, allowLoadedCatalog = false): boolean {
    if (workspaceId.value && isGuestLocked.value && providerId) return true;
    // An existing models.list response has its own provider provenance. Keep
    // its labels during registry hydration; writes still require a registry row.
    if (
      !hasResolvedProvider(providerId) &&
      !(allowLoadedCatalog && providerId && providerId === availableModelsProviderId$.value)
    )
      return false;
    return (
      normalizeProviderId(providerId) !== 'antigravity' ||
      (workspaceId.value
        ? modelFetchProviderIds$.value.includes(providerId)
        : antigravityModelsAllowed$.value) ||
      isGuestLocked.value
    );
  }
  const availableModels$ = selectAvailableModels();
  const availableModelsProviderId$ = selectAvailableModelsProviderId();
  const collapsedGroupKeys$ = selectModelPickerCollapsedGroups();
  const isLoadingModels$ = selectIsLoadingModels();
  const loadError$ = selectLoadError();
  const daemonHealth$ = selectDaemonHealth();
  // The availability status map gates which providers the picker offers, but
  // outside onboarding nothing else triggers the bulk check — a fresh session
  // that never mounted AgentGrid would sit on an empty map forever. The
  // trigger is ensure-once and the saga coalesces overlapping bulk
  // checks, so multiple pickers mounting concurrently cause no duplicate probes.
  useSignalEffect(() => {
    if (!workspaceId.value) appStore.dispatch(ensureProvidersChecked());
  });
  const workspaceIdStore = useComputed(() => workspaceId.value ?? '');
  const defaultProviderId$ = selectContextDefaultProvider(workspaceIdStore);
  const directActiveProviderId$ = selectActiveProviderId();
  const activeProviderId$ = useComputed(() =>
    workspaceId.value ? defaultProviderId$.value : directActiveProviderId$.value,
  );
  const providerCatalogEntries$ = selectContextProviderEntries(workspaceIdStore);
  const modelFetchProviderIds$ = selectContextModelProviderIds(workspaceIdStore);
  const availableEnabledProviderIds$ = selectContextAvailableProviderIds(workspaceIdStore);
  const enabledProviders$ = selectContextEnabledProviders(workspaceIdStore);
  const selectedModel$ = selectContextSelectedModel(workspaceIdStore);
  const hasCheckedOnce$ = selectContextReadinessLoaded(workspaceIdStore);
  const allProviderWarnings$ = selectContextProviderWarnings(workspaceIdStore);
  const allProviderStaleFlags$ = selectContextProviderStaleFlags(workspaceIdStore);
  const workspaceCatalogEpoch$ = selectWorkspaceCatalogEpoch();

  const globalProviderEntries$ = selectProviderCatalogEntries();
  const globalDefaultProvider$ = selectEffectiveDefaultProviderId();
  function pickerProjections() {
    // These selector signals invalidate local display projections. Snapshot reads
    // below retain the source's distinct global error/group and scoped selection contexts.
    void globalProviderEntries$.value;
    void globalDefaultProvider$.value;
    void providerCatalogEntries$.value;
    void defaultProviderId$.value;
    void hostMember$.value;
    const state = appStore.state;
    const context = (scope?: string): ModelPickerProviderContext => ({
      providerIds: scope
        ? selectProviderCatalogEntries.select(state, scope).map((entry) => entry.id)
        : selectAllCatalogProviderIds.select(state),
      defaultProviderId: selectEffectiveDefaultProviderId.select(state, scope),
      isHostMember: selectIsHostMember.select(state),
      normalizeProviderId: (id) => selectNormalizedProviderId.select(state, id, scope),
      getProviderEntry: (id) => selectProviderCatalogEntry.select(state, id, scope),
      resolveProviderEntry: (id) => selectResolvedProviderCatalogEntry.select(state, id, scope),
    });
    return createModelPickerProjections({
      globalContext: context(),
      selectionContext: context(workspaceId.value),
    });
  }
  const metadataConsumerId = useId();
  useSignalEffect(() => {
    const workspace = workspaceId.value;
    const agent = agentId.value;
    if (!workspace || !agent) return;
    appStore.dispatch(agentMetadataAcquired(metadataConsumerId, workspace, agent));
    return () => {
      appStore.dispatch(agentMetadataReleased(metadataConsumerId));
    };
  });

  useSignalEffect(() => {
    // An open picker can outlive its workspace lifecycle subscription. Refresh
    // its own context when settings or the backend invalidate the registry.
    void workspaceCatalogEpoch$.value;
    if (workspaceId.value) appStore.dispatch(ensureWorkspaceCatalogRequested(workspaceId.value));
  });
  // `default`-variant pickers stack the notice directly under a full-width
  // trigger, so give it a default top margin; callers can still override it.
  const resolvedNoticeClass = useComputed(() =>
    variant.value === 'default' ? cn('mt-2', noticeClass.value) : noticeClass.value,
  );
  const agentIdStore = useComputed(() => agentId.value ?? '');
  const agentSession$ = selectAgentSession(agentIdStore);
  type ModelPick = {
    providerId: string;
    modelId: string;
  };
  type ModelChange = {
    pick: ModelPick;
    previous: {
      model: string | null | undefined;
      providerId: string;
    };
    agentId: string;
    workspaceId: string;
    revision: number;
    connection: string | null;
  };
  const pendingModelUpdate = useSignal<ModelChange | null>(null);
  const mutationConsumerId = useId();
  const mutationPending$ = selectAgentModelMutationPending(mutationConsumerId);
  const mutations$ = selectAgentModelMutations(mutationConsumerId);
  const submittedModelChange = useSignal<{
    requestId: string;
    change: ModelChange;
  } | null>(null);
  const isApplyingModelUpdate = mutationPending$;
  const localPickedProviderId = useSignal<string | null>(null);
  const modelChangeRevision = useRef(0);
  const confirmationRevision = useRef(0);
  const destroyed = useRef(false);
  useLayoutEffect(() => {
    const lifetime = destroyed;
    const modelRevision = modelChangeRevision;
    const confirmRevision = confirmationRevision;
    lifetime.current = false;
    return () =>
      batch(() => {
        lifetime.current = true;
        modelRevision.current++;
        confirmRevision.current++;
        pendingModelUpdate.value = null;
        const submitted = submittedModelChange.peek();
        if (submitted)
          appStore.dispatch(agentModelMutationConsumed(submitted.requestId, mutationConsumerId));
        submittedModelChange.value = null;
      });
  }, [pendingModelUpdate, submittedModelChange, mutationConsumerId]);

  // Provider from the prop or agent session, or null when neither determines
  // one (fetching then uses the active provider; the trigger icon prefers the
  // displayed model's provider).
  const explicitProviderId = useComputed(() => {
    if (updateGlobalStore.value) {
      const selection = currentSessionSelection();
      if (selection) return selection.providerId;
    }
    if (providerId.value) return normalizeProviderId(providerId.value);
    if (agentId.value && workspaceId.value) {
      const session = agentSession$.value;
      if (session) {
        const provider = getAgentProvider(session, defaultProviderId$.value);
        if (provider) return normalizeProviderId(provider);
      }
    }
    return null;
  });
  const effectiveProviderId = useComputed(
    () => explicitProviderId.value ?? activeProviderId$.value,
  );
  // A guest window (multiplayer w4) or a `collaborator` seat cannot change an
  // agent's model, and its local provider availability says nothing about the
  // host: the agent-bound picker renders read-only with the host catalog
  // label and no availability warnings (intent#5378). The selector fails
  // closed while the window's identity is still the boot-time default.
  const isWorkspaceCollaborator$ = selectIsWorkspaceCollaborator(workspaceIdStore);
  const isGuestLocked = useComputed(
    () => !!agentId.value && !!workspaceId.value && isWorkspaceCollaborator$.value,
  );
  const effectiveLocked = useComputed(() => isLocked.value || isGuestLocked.value);
  function interactionLocked() {
    const current = propsSignal.peek();
    return (
      destroyed.current ||
      !!current.isLocked ||
      (!!current.agentId &&
        !!current.workspaceId &&
        selectIsWorkspaceCollaborator.select(appStore.state, current.workspaceId))
    );
  }
  function mutationPending() {
    return selectAgentModelMutationPending.select(appStore.state, mutationConsumerId);
  }
  const principalConnection$ = selectPrincipalConnectionContext();
  const previousConnection = useRef(principalConnection$.value);
  const previousLock = useRef(effectiveLocked.value);
  useSignalEffect(() => {
    const connection = principalConnection$.value;
    const locked = effectiveLocked.value;
    if (locked !== previousLock.current) {
      previousLock.current = locked;
      confirmationRevision.current++;
    }
    if (connection === previousConnection.current) return;
    previousConnection.current = connection;
    untracked(() =>
      batch(() => {
        modelChangeRevision.current++;
        confirmationRevision.current++;
        pendingModelUpdate.value = null;
        const submitted = submittedModelChange.peek();
        if (submitted)
          appStore.dispatch(agentModelMutationConsumed(submitted.requestId, mutationConsumerId));
        submittedModelChange.value = null;
        localPickedProviderId.value = null;
      }),
    );
  });

  function getProviderWarningNotice(
    providerId: string,
    warnings: Record<string, string>,
  ): ProviderWarningNotice | null {
    const normalizedId = normalizeProviderId(providerId);
    return pickerProjections().createProviderWarningNotice(normalizedId, warnings[normalizedId]);
  }
  // The saga owns the catalog and request generations. Read-through cache rows
  // render synchronously on remount while the owner revalidates in the background.
  const providerCatalogs$ = selectProviderModelsCacheMap(workspaceIdStore);
  const learnedModelNames$ = selectLearnedModelNames();
  const providerRequests$ = selectProviderModelsRequests(workspaceIdStore);
  const catalogObserverId = useId();
  const catalogProviderIds = useComputed(() =>
    modelFetchProviderIds$.value.filter((id) => canUseProviderModels(id)).map(normalizeProviderId),
  );
  const allProviderModels = useComputed(() => {
    const models: Record<string, DropdownOption[]> = {};
    for (const pid of catalogProviderIds.value) {
      const entry = providerCatalogs$.value[pid];
      if (entry) models[pid] = toDropdownOptions(entry.models);
    }
    return models;
  });
  const allProviderErrors = useComputed(() => {
    const errors: Record<string, ProviderLoadError> = {};
    for (const pid of catalogProviderIds.value) {
      const request = providerRequests$.value[pid];
      if (request?.error) {
        errors[pid] = pickerProjections().formatProviderLoadError(pid, request.error);
      }
    }
    return errors;
  });
  const allProviderLoading = useComputed(() =>
    Object.fromEntries(
      catalogProviderIds.value.map((pid) => [
        pid,
        (providerRequests$.value[pid]?.status === 'loading' &&
          providerRequests$.value[pid]?.mode !== 'silentRetry') ||
          (!providerCatalogs$.value[pid] && !allProviderErrors.value[pid]),
      ]),
    ),
  );
  const allProvidersLoaded = useComputed(() =>
    Object.values(allProviderLoading.value).every((loading) => !loading),
  );
  function hasProviderResult(providerId: string): boolean {
    return (
      Object.prototype.hasOwnProperty.call(allProviderModels.value, providerId) ||
      Boolean(allProviderErrors.value[providerId])
    );
  }
  const isEffectiveProviderAvailable = useComputed(() =>
    isProviderEnabled(availableEnabledProviderIds$.value, effectiveProviderId.value),
  );
  // An existing agent whose current provider was explicitly disabled in
  // Settings > Agents (intent#5737). Read from `providers.enabled` alone — not
  // the available+enabled set, which also drops providers whose probe failed,
  // and not a daemon event — so the picker can warn before any message is
  // sent. The daemon refuses to run the agent on a disabled provider and
  // re-homes it on the next send, so unlike the cloudlands-fe#749 policy
  // (keep a since-unavailable provider selectable) the model is reported as
  // unavailable and the disabled provider's group is not offered. A
  // guest-locked picker never sees the host's settings and stays read-only.
  const isEffectiveProviderDisabled = useComputed(
    () =>
      !!agentId.value &&
      !isGuestLocked.value &&
      isProviderDisabledInSettings(enabledProviders$.value, effectiveProviderId.value),
  );
  // Providers whose models the picker may offer. The available+enabled set
  // always admits the default provider (`model.defaultProvider`) even when it
  // was disabled in settings, so its catalog keeps loading for the fetch and
  // warning paths — but the daemon refuses every turn on a disabled provider
  // and a disabled default has no re-home target, so its rows must not be
  // selectable (intent#5737). Same settings blind spot as above for guests.
  const selectableProviderIds = useComputed(() =>
    availableEnabledProviderIds$.value.filter(
      (pid) =>
        (allowProviderSwitch.value || normalizeProviderId(pid) === effectiveProviderId.value) &&
        (isGuestLocked.value || !isProviderDisabledInSettings(enabledProviders$.value, pid)),
    ),
  );
  // The per-agent fetch is only needed when the effective provider's models
  // aren't already covered by the all-providers fetch because the agent's
  // provider is since unavailable. Skipping it otherwise avoids a duplicate fetch.
  // A guest-locked picker always runs it: the all-providers fetch follows the
  // guest's local availability, so this is its only route to the host catalog.
  const usesAgentProviderFetch = useComputed(
    () =>
      canUseProviderModels(effectiveProviderId.value) &&
      (isGuestLocked.value ||
        (workspaceId.value
          ? !modelFetchProviderIds$.value.includes(effectiveProviderId.value)
          : effectiveProviderId.value !== activeProviderId$.value &&
            !isEffectiveProviderAvailable.value)),
  );
  const agentProviderModels = useComputed(() =>
    usesAgentProviderFetch.value
      ? (providerCatalogs$.value[effectiveProviderId.value]?.models ?? null)
      : null,
  );
  const agentProviderError = useComputed(() => {
    const request = providerRequests$.value[effectiveProviderId.value];
    return usesAgentProviderFetch.value && request?.error
      ? pickerProjections().formatProviderLoadError(effectiveProviderId.value, request.error)
          .displayText
      : null;
  });
  const agentProviderLoading = useComputed(
    () => usesAgentProviderFetch.value && !agentProviderModels.value && !agentProviderError.value,
  );
  const observedProviderIds = useComputed(() => [
    ...new Set([
      ...catalogProviderIds.value,
      ...(usesAgentProviderFetch.value ? [effectiveProviderId.value] : []),
    ]),
  ]);
  // Prop/selector binding only: the registered owner handles debounce,
  // replacement, reconnect invalidation and cancellation for this observer.
  const observedWorkspace = useRef(workspaceId.value);
  useSignalEffect(() => {
    const workspace = workspaceId.value;
    const providers = observedProviderIds.value;
    if (observedWorkspace.current !== workspace) {
      appStore.dispatch(providerModelsReleased(catalogObserverId));
      observedWorkspace.current = workspace;
    }
    appStore.dispatch(providerModelsObserved(catalogObserverId, providers, workspace));
  });
  useEffect(
    () => () => {
      appStore.dispatch(providerModelsReleased(catalogObserverId));
    },
    [catalogObserverId],
  );

  // Models for the effective provider: the per-agent fetch result when the
  // agent's provider differs from the active one, the global store otherwise.
  const availableModels = useComputed(() =>
    !canUseProviderModels(
      workspaceId.value || agentProviderModels.value
        ? effectiveProviderId.value
        : availableModelsProviderId$.value,
      true,
    ) || agentProviderLoading.value
      ? []
      : (agentProviderModels.value ??
        (agentProviderError.value
          ? []
          : workspaceId.value
            ? (allProviderModels.value[effectiveProviderId.value] ?? []).map(
                ({ data, ...option }) => ({
                  ...data,
                  ...option,
                }),
              )
            : availableModels$.value)),
  );
  // Which provider `availableModels` was loaded for: the per-agent fetch is
  // for the effective provider by construction; the global catalog carries
  // explicit provenance ('' before the first load).
  const availableModelsProviderId = useComputed(() =>
    workspaceId.value || (!agentProviderLoading.value && agentProviderModels.value)
      ? effectiveProviderId.value
      : availableModelsProviderId$.value,
  );
  const isLoadingModels = useComputed(
    () =>
      canUseProviderModels(effectiveProviderId.value) &&
      (agentProviderLoading.value ||
        (!hasProviderResult(effectiveProviderId.value) &&
          (isLoadingModels$.value ||
            allProviderLoading.value[effectiveProviderId.value] ||
            !allProvidersLoaded.value))),
  );
  const loadError = useComputed(() =>
    workspaceId.value ? agentProviderError.value : loadError$.value,
  );
  // Track which provider groups are collapsed in the dropdown (persisted through Redux sagas)
  const collapsedGroups = useComputed(() => new Set(collapsedGroupKeys$.value));
  function toggleGroup(key: string) {
    appStore.dispatch(setModelPickerGroupCollapsed(key, !collapsedGroups.value.has(key)));
  }
  const refreshingProviders = useComputed(
    () =>
      new Set(
        Object.values(providerRequests$.value)
          .filter((request) => request.status === 'loading' && request.mode === 'refresh')
          .map((request) => request.providerId),
      ),
  );
  function handleRefreshProvider(providerId: string) {
    if (!canUseProviderModels(providerId)) return;
    if (refreshingProviders.value.has(providerId)) return;
    appStore.dispatch(providerModelsRequested(providerId, 'refresh', workspaceId.value));
  }
  function handleRetry() {
    for (const providerId of observedProviderIds.value) {
      appStore.dispatch(providerModelsRequested(providerId, 'retry', workspaceId.value));
    }
  }
  const USE_DEFAULT_VALUE = '__use_default__';
  // Settings/spawn callers own their draft. Agent callers only use it while
  // their optimistic/deferred request is live; accepted selections render
  // directly from Redux, even if a parent's prop has not caught up yet.
  const draftModel = useSignal<string | null | undefined>(
    untracked(() => (updateGlobalDefault.value ? undefined : selectedModel.value)),
  );
  const localModel = useComputed(() => {
    // The global default owner already publishes its accepted/rolled-back
    // selection through Redux. Never keep a competing draft for Settings.
    if (updateGlobalDefault.value) return selectedModel$.value;
    const change = pendingModelUpdate.value ?? submittedModelChange.value?.change;
    if (change && isCurrentModelChange(change)) return draftModel.value;
    const selection = updateGlobalStore.value ? currentSessionSelection() : undefined;
    return selection ? selection.model : draftModel.value;
  });
  const userChangedModel = useSignal(false);
  const propModelAtLocalChange = useSignal<string | null | undefined>(undefined);
  // Keep a draft selection until its owning parent catches up.
  useSignalEffect(() => {
    if (updateGlobalDefault.value) return;
    if (selectedModel.value === draftModel.value) {
      userChangedModel.value = false;
      propModelAtLocalChange.value = undefined;
      return;
    }
    if (
      userChangedModel.value &&
      (selectedModel.value === undefined || selectedModel.value === propModelAtLocalChange.value)
    ) {
      return;
    }
    draftModel.value = selectedModel.value;
    localPickedProviderId.value = null;
    pendingModelUpdate.value = null;
    modelChangeRevision.current++;
    confirmationRevision.current++;
    userChangedModel.value = false;
    propModelAtLocalChange.value = undefined;
  });
  function currentSessionSelection(): ModelChange['previous'] | undefined {
    const session = agentSession$.value;
    if (
      !agentId.value ||
      !workspaceId.value ||
      session?.id !== agentId.value ||
      session.workspaceId !== workspaceId.value
    )
      return undefined;
    const provider = getAgentProvider(session, defaultProviderId$.value);
    if (!provider) return undefined;
    // An omitted model on a present session is authoritative Auto, not missing data.
    return { model: session.model, providerId: normalizeProviderId(provider) };
  }
  // The parent mirrors optimistic picks, so only the session can acknowledge
  // an agent selection. Once acknowledged, follow later provider-only updates.
  useSignalEffect(() => {
    if (!localPickedProviderId.value || pendingModelUpdate.value) return;
    const selection = currentSessionSelection();
    if (
      selection?.providerId === localPickedProviderId.value &&
      (selection.model === localModel.value ||
        (selection.model &&
          localModel.value &&
          splitLegacyCompoundId(selection.model).modelId ===
            splitLegacyCompoundId(localModel.value).modelId))
    ) {
      localPickedProviderId.value = null;
    }
  });
  // A live owner → collaborator role change must not let a deferred update
  // queued during streaming reach the backend once streaming ends.
  useSignalEffect(() => {
    if (effectiveLocked.value && pendingModelUpdate.value) {
      restoreLocalSelection(pendingModelUpdate.value);
      pendingModelUpdate.value = null;
      modelChangeRevision.current++;
    }
  });
  useSignalEffect(() => {
    if (!deferUpdate.value && !isApplyingModelUpdate.value && pendingModelUpdate.value) {
      const change = pendingModelUpdate.value;
      pendingModelUpdate.value = null;
      void applyBackendModelUpdate(change);
    }
  });
  // Keep the selected row's provider through confirmation and asynchronous work.
  // Persisted compound IDs still carry an explicit provider at the input boundary.
  function resolvePickedTriple(model: string, rowProviderId?: string): ModelPick {
    const { providerId: legacyProviderId, modelId } = splitLegacyCompoundId(model);
    return {
      providerId: normalizeProviderId(
        legacyProviderId || rowProviderId || effectiveProviderId.value,
      ),
      modelId,
    };
  }
  function isCurrentModelChange(change: ModelChange): boolean {
    return (
      !destroyed.current &&
      change.revision === modelChangeRevision.current &&
      change.agentId === agentId.value &&
      change.workspaceId === workspaceId.value &&
      change.connection === selectPrincipalConnectionContext.select(appStore.state)
    );
  }
  function restoreLocalSelection(change: ModelChange) {
    return batch(() => {
      if (!isCurrentModelChange(change)) return;
      // A rejected request must not restore an old snapshot over a newer
      // authoritative selection received while the request was in flight.
      const selection = currentSessionSelection() ?? change.previous;
      draftModel.value = selection.model;
      localPickedProviderId.value = selection.providerId;
      propModelAtLocalChange.value = selectedModel.value;
      userChangedModel.value = true;
      dropdownValue.value = currentDropdownValue();
      onModelChange.value?.(
        localModel.value ?? '',
        localModel.value
          ? {
              providerId: selection.providerId,
              modelId: splitLegacyCompoundId(localModel.value).modelId,
            }
          : undefined,
      );
    });
  }
  function applyBackendModelUpdate(change: ModelChange) {
    if (!isCurrentModelChange(change) || mutationPending()) return;
    if (!hasResolvedProvider(change.pick.providerId)) {
      restoreLocalSelection(change);
      return;
    }
    const requestId = crypto.randomUUID();
    submittedModelChange.value = { requestId, change };
    const canWrite = () =>
      isCurrentModelChange(change) &&
      !interactionLocked() &&
      hasResolvedProvider(change.pick.providerId) &&
      canUseProviderModels(change.pick.providerId);
    const action = agentModelMutationRequested(
      {
        requestId,
        consumerId: mutationConsumerId,
        agentId: change.agentId,
        workspaceId: change.workspaceId,
        connection: change.connection,
        operation: {
          kind: 'model',
          model: change.pick.modelId,
          providerId: change.pick.providerId,
          commit: true,
        },
      },
      { canSend: canWrite, canMutate: canWrite },
    );
    // The correlated selector result below owns presentation, not this Promise.
    void appStore.dispatch(action).catch(() => {});
  }
  useSignalEffect(() => {
    const submitted = submittedModelChange.value;
    if (!submitted) return;
    const outcome = mutations$.value.find((entry) => entry.requestId === submitted.requestId);
    if (!outcome || outcome.status === 'pending') return;
    untracked(() => {
      submittedModelChange.value = null;
      appStore.dispatch(agentModelMutationConsumed(outcome.requestId, mutationConsumerId));
      if (!isCurrentModelChange(submitted.change)) return;
      if (
        outcome.status === 'cancelled' ||
        (outcome.status === 'failure' && !outcome.modelAccepted)
      ) {
        restoreLocalSelection(submitted.change);
        if (outcome.status === 'failure' && outcome.error && !effectiveLocked.value)
          notify.error(outcome.error, { duration: 6000 });
      }
    });
  });
  function handleModelSelect(model: string | undefined, picked?: ModelPick) {
    return batch(() => {
      if (interactionLocked() || mutationPending()) {
        dropdownValue.value = currentDropdownValue();
        return;
      }
      const pick = model === undefined ? undefined : (picked ?? resolvePickedTriple(model));
      if (
        pick &&
        (!hasResolvedProvider(pick.providerId) || !canUseProviderModels(pick.providerId))
      ) {
        dropdownValue.value = currentDropdownValue();
        return;
      }
      // A rejected global provider switch must not become an optimistic local
      // selection or invoke the caller's model/effort reconciliation callback.
      if (
        updateGlobalDefault.value &&
        pick &&
        isQuickActionProviderSwitchBlocked(appStore.state.backgroundAgentSettings, pick.providerId)
      ) {
        dropdownValue.value = currentDropdownValue();
        appStore.dispatch(backgroundProviderSwitchBlocked(pick.providerId));
        return;
      }
      if (updateGlobalDefault.value) {
        // Defaults have one Redux-rendered selection. Dispatch before returning
        // from the click; never stage a component draft or an agent request.
        onModelChange.value?.(model ?? '', pick);
        if (pick && !interactionLocked() && !selectIsHostMember.select(appStore.state))
          appStore.dispatch(selectModel(pick.modelId, pick.providerId));
        return;
      }
      const previous = pendingModelUpdate.value?.previous ?? {
        model: localModel.value,
        providerId: selectedModelProviderId.value || effectiveProviderId.value,
      };
      const revision = ++modelChangeRevision.current;
      if (isEffectiveProviderDisabled.value || disabledProviderSnapshot.value) {
        disabledProviderSnapshot.value = null;
        reHomeAnnouncementSuppressed.value = true;
      }
      propModelAtLocalChange.value = selectedModel.value;
      userChangedModel.value = true;
      draftModel.value = model;
      localPickedProviderId.value = pick?.providerId ?? null;
      if (!pick || model === undefined) {
        pendingModelUpdate.value = null;
        onModelChange.value?.('');
        return;
      }
      onModelChange.value?.(model, pick);
      if (interactionLocked()) return;
      if (!updateGlobalStore.value || !agentId.value || !workspaceId.value) return;
      const change: ModelChange = {
        pick,
        previous,
        agentId: agentId.value,
        workspaceId: workspaceId.value,
        revision,
        connection: selectPrincipalConnectionContext.select(appStore.state),
      };
      if (deferUpdate.value) pendingModelUpdate.value = change;
      else applyBackendModelUpdate(change);
    });
  }
  // Whether a model is explicitly selected (vs using default)
  // Also treat the literal string "undefined" as no selection (can happen from bad String(undefined) conversion)
  // Only the bare "default" string is the "use default" sentinel (delegation-chain guard);
  // provider-prefixed ids like "claude-code:default" are explicit catalog selections.
  const hasExplicitModel = useComputed(
    () =>
      localModel.value !== undefined &&
      localModel.value !== null &&
      localModel.value !== USE_DEFAULT_VALUE &&
      localModel.value !== 'undefined' &&
      localModel.value !== 'default',
  );
  // Settings owns the default provider even when a bare model contains a colon.
  // Other display callers may still carry a recognized legacy provider prefix.
  // This identity is for labels/icons only; catalog/session gates stay authoritative.
  const selectedModelDisplayProviderId = useComputed(() => {
    if (updateGlobalDefault.value) return normalizeProviderId(effectiveProviderId.value);
    if (localPickedProviderId.value) return normalizeProviderId(localPickedProviderId.value);
    if (explicitProviderId.value) return explicitProviderId.value;
    const prefix = localModel.value
      ? splitLegacyCompoundId(localModel.value).providerId
      : undefined;
    return normalizeProviderId(
      prefix && hasResolvedProvider(prefix) ? prefix : effectiveProviderId.value,
    );
  });
  // Live labels retain precedence; remembered names affect display only.
  function getModelLabel(
    modelId: string | undefined,
    provider = selectedModelDisplayProviderId.value,
  ): string | undefined {
    if (!modelId) return undefined;
    provider = normalizeProviderId(provider);
    const bareId = modelIdForDisplay(modelId, provider, normalizeProviderId);
    const lookup = (id: string): string | undefined => {
      const target = modelIdForDisplay(id, provider, normalizeProviderId);
      const find = (
        models: {
          value: string;
          label: string;
        }[],
        catalogProvider: string,
      ) => {
        // Catalog ownership is authoritative: a custom colon-bearing ID in
        // another provider's catalog must never supply this provider's name.
        if (normalizeProviderId(catalogProvider) !== provider) return undefined;
        const exact = models.find((row) => row.value === id);
        return (
          exact ??
          models.find(
            (row) => modelIdForDisplay(row.value, provider, normalizeProviderId) === target,
          )
        )?.label;
      };
      for (const [rowProvider, models] of Object.entries(allProviderModels.value)) {
        const label = find(models, rowProvider);
        if (label) return label;
      }
      return find(availableModels.value, availableModelsProviderId.value);
    };
    // Subscribe to the shared Redux names, including discoveries made by another picker.
    void learnedModelNames$.value;
    const learned = (id: string) =>
      selectLearnedModelDisplayName.select(appStore.state, provider, id);
    return (
      resolveModelDisplayName(modelId, lookup) ??
      (bareId !== modelId ? resolveModelDisplayName(bareId, lookup) : undefined) ??
      learned(modelId) ??
      resolveModelDisplayName(bareId, learned)
    );
  }
  // The provider's `isDefault`-marked catalog row, if its catalog is loaded
  // (the daemon resolves the 'default' pseudo-row away and marks the real row
  // `isDefault` instead). Undefined while the catalog is cold or when no row
  // carries the flag.
  function findCatalogDefaultOption(providerId: string): DropdownOption | undefined {
    const normalizedId = normalizeProviderId(providerId);
    if (!normalizedId) return undefined;
    const fromAll = allProviderModels.value[normalizedId]?.find((opt) =>
      Boolean(opt.data?.isDefault),
    );
    if (fromAll) return fromAll;
    if (
      availableModelsProviderId.value !== '' &&
      normalizeProviderId(availableModelsProviderId.value) === normalizedId
    ) {
      const row = availableModels.value.find((model) => 'isDefault' in model && model.isDefault);
      if (row) return toDropdownOptions([row])[0];
    }
    return undefined;
  }
  // Opt-in display fallback (fallbackToCatalogDefault): no explicit selection
  // and no daemon-resolved preview (defaultModelId) — show the isDefault row
  // of the provider the consumer creates with (fallbackProviderId, else the
  // effective provider) while the preview is absent (daemon catalog cache
  // cold / preview fetch not landed) instead of the generic defaultModelLabel.
  const catalogDefaultFallbackOption = useComputed(() =>
    fallbackToCatalogDefault.value && !defaultModelId.value
      ? findCatalogDefaultOption(fallbackProviderId.value ?? effectiveProviderId.value)
      : undefined,
  );
  // The provider's first known model row (pseudo-rows filtered; a sole
  // pseudo-row survives per D1). Prefers the first non-legacy row — the group
  // builder splits isLegacyModel rows into a separate legacy subgroup, so the
  // first *rendered* current row is the non-legacy one. Undefined while the
  // catalog is cold.
  function findFirstCatalogModelOption(providerId: string): DropdownOption | undefined {
    const normalizedId = normalizeProviderId(providerId);
    if (!normalizedId) return undefined;
    const firstCurrentRow = (options: DropdownOption[]): DropdownOption | undefined => {
      const filtered = filterDefaultPseudoOptions(options);
      return filtered.find((opt) => opt.data?.isLegacyModel !== true) ?? filtered[0];
    };
    const fromAll = allProviderModels.value[normalizedId];
    if (fromAll && fromAll.length > 0) return firstCurrentRow(fromAll);
    if (
      availableModelsProviderId.value !== '' &&
      normalizeProviderId(availableModelsProviderId.value) === normalizedId &&
      availableModels.value.length > 0
    ) {
      return firstCurrentRow(toDropdownOptions(availableModels.value));
    }
    return undefined;
  }
  // A `<provider>:default` id has no rendered row of its own (the picker
  // filters the pseudo-row from the list): it maps to the provider's
  // isDefault row, falling back to the first known model row (D2, mirroring
  // the daemon's cached_default_or_first_model) so the selection never
  // renders as dead/unavailable. Undefined for non-pseudo ids and while the
  // catalog is cold.
  function mapDefaultPseudoSelection(compoundId: string): DropdownOption | undefined {
    const { providerId: modelProviderId, modelId } = parseCompoundModelId(compoundId);
    if (modelId.toLowerCase() !== 'default') return undefined;
    return (
      findCatalogDefaultOption(modelProviderId) ?? findFirstCatalogModelOption(modelProviderId)
    );
  }
  // D2 mapping for a persisted `<provider>:default` selection.
  const legacyDefaultMappedOption = useComputed(() =>
    hasExplicitModel.value && localModel.value
      ? mapDefaultPseudoSelection(localModel.value)
      : undefined,
  );
  // D2 mapping for a daemon-resolved `<provider>:default` preview
  // (defaultModelId from an older daemon) — same exposure as the explicit
  // selection: an exact-id match would resolve to the hidden pseudo-row.
  const defaultModelIdMappedOption = useComputed(() =>
    defaultModelId.value ? mapDefaultPseudoSelection(defaultModelId.value) : undefined,
  );
  const defaultModelDisplayProviderId = useComputed(() => {
    const owner = explicitProviderId.value || fallbackProviderId.value;
    if (owner) return normalizeProviderId(owner);
    const prefix = defaultModelId.value
      ? splitLegacyCompoundId(defaultModelId.value).providerId
      : undefined;
    return normalizeProviderId(
      prefix && hasResolvedProvider(prefix) ? prefix : defaultProviderId$.value,
    );
  });
  function formatResolvedDefaultLabel(model: string): string {
    if (formatDefaultModelLabel.value) return formatDefaultModelLabel.value(model);
    return showDefaultOption.value
      ? m.chat_modelPicker_defaultModelPreview_label({ model })
      : model;
  }
  const currentModelLabel = useComputed(() => {
    if (hasExplicitModel.value) {
      return localModel.value
        ? (legacyDefaultMappedOption.value?.label ??
            getModelLabel(localModel.value) ??
            modelIdForDisplay(
              localModel.value,
              selectedModelDisplayProviderId.value,
              normalizeProviderId,
            ))
        : (defaultModelLabel.value ?? m.chat_modelPicker_defaultModel_label());
    }
    // Unresolvable defaultModelId (models not loaded yet): prefer the caller's
    // defaultModelLabel (e.g. "Provider default"), then the bare model id. A
    // `<provider>:default` preview maps to its D2 row's label first.
    if (defaultModelId.value) {
      const provider = defaultModelDisplayProviderId.value;
      const resolvedLabel =
        defaultModelIdMappedOption.value?.label ?? getModelLabel(defaultModelId.value, provider);
      if (resolvedLabel) return formatResolvedDefaultLabel(resolvedLabel);
      return (
        defaultModelLabel.value ??
        modelIdForDisplay(defaultModelId.value, provider, normalizeProviderId)
      );
    }
    if (catalogDefaultFallbackOption.value) {
      return formatResolvedDefaultLabel(catalogDefaultFallbackOption.value.label);
    }
    return defaultModelLabel.value ?? m.chat_modelPicker_defaultModel_label();
  });
  const triggerProviderId = useComputed(() => {
    if (localModel.value && hasExplicitModel.value) {
      // Provider identity belongs to the selection, including colliding bare IDs.
      return selectedModelDisplayProviderId.value;
    }
    if (explicitProviderId.value) return explicitProviderId.value;
    // No explicit provider or model — show the displayed default model's provider.
    if (defaultModelId.value) return defaultModelDisplayProviderId.value;
    if (catalogDefaultFallbackOption.value) {
      return parseCompoundModelId(catalogDefaultFallbackOption.value.value).providerId;
    }
    return activeProviderId$.value;
  });
  const isTriggerLabelResolved = useComputed(() => {
    if (!hasExplicitModel.value || !localModel.value) return true; // "Default model" text, no need for skeleton
    // A `<provider>:default` selection mapped to its D2 row renders that
    // row's label — resolved even while other providers are still loading.
    if (legacyDefaultMappedOption.value) return true;
    if (getModelLabel(localModel.value)) return true;
    // The disabled-provider warning derives from settings alone and must not
    // wait behind the disabled provider's catalog, which may never load.
    if (isSelectedModelProviderDisabled.value) return true;
    if (!isLoadingModels.value && allProvidersLoaded.value) return true;
    if (selectedCatalogOption.value) return true;
    for (const models of Object.values(allProviderModels.value)) {
      if (models.some((m) => m.value === localModel.value)) return true;
    }
    return availableModels.value.some((m) => m.value === localModel.value);
  });
  const shouldShowLockIconWhenLocked = useComputed(
    () => isCompact.value || showLockIconWhenLocked.value,
  );
  const buttonSize = useComputed(() => (isCompact.value ? 'icon' : size.value));
  const buttonClass = useComputed(() =>
    cn(
      isCompact.value
        ? 'h-8 w-8 p-0 flex items-center justify-center'
        : size.value === 'xs'
          ? ''
          : 'h-8 min-w-[140px] justify-between',
      'text-muted-foreground hover:text-foreground transition-colors',
    ),
  );
  const useDefaultOption: DropdownOption = {
    value: USE_DEFAULT_VALUE,
    get label() {
      return defaultOptionLabel.value ?? m.chat_modelPicker_defaultModel_label();
    },
    get description() {
      return defaultOptionDescription.value ?? m.chat_modelPicker_defaultModel_description();
    },
  };
  // Same provenance gate as the grouped fallback: only offer the shared
  // catalog for a disabled effective provider when it was loaded for it.
  const fallbackModelsMatchEffectiveProvider = useComputed(
    () =>
      availableModelsProviderId.value !== '' &&
      normalizeProviderId(availableModelsProviderId.value) ===
        normalizeProviderId(effectiveProviderId.value),
  );
  const flatModelOptions = useComputed<DropdownOption[]>(() => [
    ...(showDefaultOption.value ? [useDefaultOption] : []),
    ...selectableProviderIds.value.flatMap(
      (pid) => allProviderModels.value[normalizeProviderId(pid)] ?? [],
    ),
    // Keep the agent's current provider selectable while it is merely
    // unavailable, so the selected model isn't treated as unavailable — but
    // not once it was disabled in settings (see isEffectiveProviderDisabled).
    ...(isEffectiveProviderAvailable.value ||
    isEffectiveProviderDisabled.value ||
    !fallbackModelsMatchEffectiveProvider.value
      ? []
      : toDropdownOptions(availableModels.value)),
  ]);
  function findCatalogOption(
    modelId: string,
    bareProviderId = selectedModelProviderId.value || effectiveProviderId.value,
  ): DropdownOption | undefined {
    const lookup = (id: string) => {
      const target = normalizeModelIdForMatch(splitLegacyCompoundId(id).modelId, bareProviderId);
      for (const providerId of selectableProviderIds.value) {
        const rowProviderId = normalizeProviderId(providerId);
        const found = allProviderModels.value[rowProviderId]?.find(
          (option) => normalizeModelIdForMatch(option.value, rowProviderId) === target,
        );
        if (found) return found;
      }
      if (
        !isEffectiveProviderAvailable.value &&
        !isEffectiveProviderDisabled.value &&
        fallbackModelsMatchEffectiveProvider.value
      ) {
        return toDropdownOptions(availableModels.value).find(
          (option) =>
            normalizeModelIdForMatch(option.value, availableModelsProviderId.value) === target,
        );
      }
      return undefined;
    };
    // Persisted effort-suffixed pins refer to today's base catalog row. An
    // exact match wins so provider model IDs containing slashes stay intact.
    return (
      lookup(modelId) ??
      lookup(modelId.replace(/\/(?:none|minimal|low|medium|high|xhigh|max|ultra)$/i, ''))
    );
  }
  const selectedCatalogOption = useComputed(() => {
    const selectedId = hasExplicitModel.value ? localModel.value : defaultModelId.value;
    if (!selectedId) return catalogDefaultFallbackOption.value;
    // The mapped row wins for `<provider>:default` — an exact-id match would
    // resolve to the hidden pseudo-row when an older daemon still serves one.
    const mappedOption = hasExplicitModel.value
      ? legacyDefaultMappedOption.value
      : defaultModelIdMappedOption.value;
    if (mappedOption) return mappedOption;
    return findCatalogOption(
      selectedId,
      hasExplicitModel.value
        ? selectedModelProviderId.value
        : normalizeProviderId(
            splitLegacyCompoundId(selectedId).providerId ||
              fallbackProviderId.value ||
              effectiveProviderId.value,
          ),
    );
  });
  const hasLoadedModelOptions = useComputed(() =>
    flatModelOptions.value.some((option) => option.value !== USE_DEFAULT_VALUE && !option.disabled),
  );
  const providerLoadWarnings = useComputed<ProviderLoadError[]>(() => {
    return availableEnabledProviderIds$.value
      .map((pid) => allProviderErrors.value[normalizeProviderId(pid)])
      .filter((error): error is ProviderLoadError => Boolean(error));
  });
  // Read the workspace-scoped catalog, including degraded successful responses.
  const activeProviderIssue = useComputed<ProviderLoadError | null>(() => {
    const providerId = activeBrowseProviderId.value || preferredBrowseProviderId.value;
    const error = providerRequests$.value[providerId]?.error;
    if (error) return pickerProjections().formatProviderLoadError(providerId, error);
    const warning = providerCatalogs$.value[providerId]?.warning;
    if (warning) return pickerProjections().formatProviderLoadError(providerId, warning);
    if (loadError.value && providerId === effectiveProviderId.value)
      return pickerProjections().formatProviderLoadError(providerId, loadError.value);
    return null;
  });
  const nonBlockingProviderWarnings = useComputed(() =>
    activeProviderIssue.value &&
    (allProviderModels.value[activeProviderIssue.value.providerId]?.length ?? 0) > 0
      ? [activeProviderIssue.value]
      : [],
  );
  const providerFallbackWarnings = useComputed<ProviderWarningNotice[]>(() => {
    const warnings = allProviderWarnings$.value;
    return availableEnabledProviderIds$.value
      .map((pid) => getProviderWarningNotice(pid, warnings))
      .filter((warning): warning is ProviderWarningNotice => Boolean(warning));
  });
  const hasCodexModels = useComputed(
    () =>
      (allProviderModels.value['codex']?.length ?? 0) > 0 ||
      (normalizeProviderId(effectiveProviderId.value) === 'codex' &&
        (agentProviderModels.value?.length ?? 0) > 0),
  );
  // A stale warning (PROTOCOL §5.30 `stale: true`) accompanies the daemon's
  // last-known-good list after a transient probe failure: the models on screen
  // are real and usable, so the "install Codex CLI" notice would be wrong.
  // The notice stays for the degraded case (warning with no codex models).
  const codexFallbackWarning = useComputed(() =>
    allProviderStaleFlags$.value['codex'] && hasCodexModels.value
      ? null
      : (providerFallbackWarnings.value.find((warning) => warning.providerId === 'codex') ?? null),
  );
  // D1(B): when no provider is available at all, never fall back to a
  // default provider/model — surface an explicit failure instead.
  // Per-provider fetch failures / a single unavailable effective provider
  // are handled by the existing warning/fallback paths.
  // Gated on hasCheckedOnce: before the first availability check resolves,
  // availableEnabledProviderIds is empty by default, which is "unknown" —
  // not "confirmed unavailable" — so this must not trip during initial load.
  // Also gated on a healthy backend: the mount-time
  // ensureProvidersChecked can run its bulk probe before the daemon socket is
  // up, or while heartbeat RPCs are timing out. Those results are not
  // authoritative and can transiently empty the available-provider set until
  // the reconnect listener re-runs the check and heals the map. Daemon-down
  // and degraded failures are surfaced by the daemon-health UI instead.
  const hasNoAvailableProvider = useComputed(
    () =>
      !providerId.value &&
      !isGuestLocked.value &&
      hasCheckedOnce$.value &&
      daemonHealth$.value === 'healthy' &&
      availableEnabledProviderIds$.value.length === 0,
  );
  // Per-instance call-frequency guard only; the stable toast id below is the
  // authoritative dedupe — every mounted ModelPicker (and every re-fire of the
  // condition) updates the same single toast instead of stacking a new one.
  const noProviderToastShown = useRef(false);
  async function openProviderSettings() {
    if (selectIsHostMember.select(appStore.state)) return;
    dropdownOpen.value = false;
    try {
      await onOpenProviderSettings.value();
    } catch (error: unknown) {
      logger.error('Failed to open provider settings from model picker', error);
    }
  }

  useSignalEffect(() => {
    if (hasNoAvailableProvider.value) {
      if (!noProviderToastShown.current) {
        noProviderToastShown.current = true;
        notify.error(
          hostMember$.value
            ? m.hostExecution_providerSetup_description()
            : m.chat_modelPicker_noProviderAvailable_toast(),
          {
            id: 'no-provider-available',
            duration: 6000,
            action: hostMember$.value
              ? undefined
              : {
                  label: m.chat_modelPicker_noProviderAvailable_openSettings_label(),
                  onClick: openProviderSettings,
                },
          },
        );
      }
    } else {
      noProviderToastShown.current = false;
    }
  });
  const blockingLoadError = useComputed<ProviderLoadError | null>(() => {
    if (loadError.value) {
      return pickerProjections().formatProviderLoadError(
        effectiveProviderId.value,
        loadError.value,
      );
    }
    if (hasLoadedModelOptions.value || providerLoadWarnings.value.length === 0) {
      return null;
    }
    if (providerLoadWarnings.value.length === 1) {
      return providerLoadWarnings.value[0];
    }
    return {
      providerId: 'multiple',
      providerName: m.chat_modelPicker_modelProviders_label(),
      details: providerLoadWarnings.value.map((error) => error.details).join('\n\n'),
      message: providerLoadWarnings.value.map((error) => error.displayText).join('; '),
      displayText: providerLoadWarnings.value.map((error) => error.displayText).join('; '),
    };
  });
  const groupedModelOptions = useComputed(() =>
    pickerProjections()
      .buildGroupedModelOptions({
        showDefaultOption: showDefaultOption.value,
        useDefaultOption,
        effectiveProviderId: effectiveProviderId.value,
        availableModels: availableModels.value,
        availableModelsProviderId: availableModelsProviderId.value,
        enabledProviderIds: selectableProviderIds.value,
        effectiveProviderDisabled: isEffectiveProviderDisabled.value,
        allProviderModels: allProviderModels.value,
        allProviderLoading: allProviderLoading.value,
        allProviderErrors: allProviderErrors.value,
        allProviderWarnings: allProviderWarnings$.value,
      })
      .filter(
        (group) => group.key === 'default' || canUseProviderModels(group.parentKey ?? group.key),
      ),
  );
  const legacyModelsExpanded = useSignal(false);
  const modelSearchValue = useSignal('');
  const onlyLegacyAuggieModels = useComputed(
    () =>
      groupedModelOptions.value.some((group) => group.key === AUGGIE_LEGACY_GROUP_KEY) &&
      !groupedModelOptions.value.some((group) => group.key === 'auggie'),
  );
  const legacyToggleDisabled = useComputed(
    () => modelSearchValue.value.trim().length > 0 || onlyLegacyAuggieModels.value,
  );
  const legacyModelsVisible = useComputed(
    () => legacyModelsExpanded.value || legacyToggleDisabled.value,
  );
  // The value bound to the dropdown (convert undefined to USE_DEFAULT_VALUE).
  // Bound state rather than derived so a rejected confirmModelChange can
  // revert the dropdown's internal selection back to the current model.
  // A legacy `<provider>:default` selection has no catalog row of its own,
  // so the mapped isDefault row shows as selected instead.
  const dropdownValue = useSignal(untracked(() => localModel.value ?? USE_DEFAULT_VALUE));
  function currentDropdownValue() {
    if (
      hasExplicitModel.value &&
      activeBrowseProviderId.value &&
      selectedModelProviderId.value &&
      activeBrowseProviderId.value !== selectedModelProviderId.value
    )
      return '';
    return (
      (hasExplicitModel.value ? selectedCatalogOption.value?.value : undefined) ??
      localModel.value ??
      USE_DEFAULT_VALUE
    );
  }
  useSignalEffect(() => {
    // A fast rejection can restore the same authoritative value within one
    // render turn. Also observe the dropdown's attempted write so its row
    // selection cannot outlive that rejected attempt.
    const value = currentDropdownValue();
    if (dropdownValue.value !== value) dropdownValue.value = value;
  });
  // Keep an explicit local choice until the daemon/parent has caught up.
  // Existing bare session IDs belong to that session's provider, even when
  // another provider advertises the same model ID.
  const selectedModelProviderId = useComputed(() =>
    hasExplicitModel.value && localModel.value
      ? ((updateGlobalDefault.value ? null : localPickedProviderId.value) ??
        normalizeProviderId(
          explicitProviderId.value ||
            splitLegacyCompoundId(localModel.value).providerId ||
            effectiveProviderId.value,
        ))
      : '',
  );
  // Provider the daemon resolves the selected model against on send: a legacy
  // compound prefix, else the agent's own provider. Catalog ownership is not
  // authoritative here — a bare id shared by several catalogs would be
  // attributed to the default provider while the agent still runs elsewhere.
  const selectedModelGateProviderId = useComputed(() => {
    const legacyProviderId =
      hasExplicitModel.value && localModel.value
        ? splitLegacyCompoundId(localModel.value).providerId
        : '';
    return (
      (updateGlobalDefault.value ? null : localPickedProviderId.value) ??
      normalizeProviderId(explicitProviderId.value || legacyProviderId || effectiveProviderId.value)
    );
  });
  // The provider the selected model is sent through was disabled in settings —
  // the pre-send warning state.
  const isSelectedModelProviderDisabled = useComputed(
    () =>
      !!agentId.value &&
      !isGuestLocked.value &&
      isProviderDisabledInSettings(enabledProviders$.value, selectedModelGateProviderId.value),
  );
  const providerTabIds = useComputed(() => [
    ...new Set([
      ...selectableProviderIds.value.map((id) => normalizeProviderId(id)),
      ...groupedModelOptions.value
        .filter((group) => group.key !== 'default')
        .map((group) => group.parentKey ?? group.key),
    ]),
  ]);
  const preferredBrowseProviderId = useComputed(() =>
    providerTabIds.value.includes(selectedModelProviderId.value)
      ? selectedModelProviderId.value
      : providerTabIds.value.includes(normalizeProviderId(effectiveProviderId.value))
        ? normalizeProviderId(effectiveProviderId.value)
        : (providerTabIds.value[0] ?? ''),
  );
  const activeBrowseProviderId = useSignal('');
  const providerBrowseChanged = useSignal(false);
  const providerTabsEnabled = useComputed(() => activeBrowseProviderId.value !== '');
  useSignalEffect(() => {
    if (
      !providerTabIds.value.includes(activeBrowseProviderId.value) ||
      (dropdownOpen.value && !providerBrowseChanged.value)
    ) {
      activeBrowseProviderId.value = preferredBrowseProviderId.value;
    }
  });
  useSignalEffect(() => {
    if (dropdownOpen.value) {
      activeBrowseProviderId.value = untracked(() => preferredBrowseProviderId.value);
    } else {
      providerBrowseChanged.value = false;
    }
  });
  // Display groups — every picker browses one provider at a time.
  const displayGroups = useComputed(() => {
    // Once every catalog attempt settles without usable models, use the
    // existing terminal error/Retry surface rather than disabled error rows.
    // Pending retries and partial/cached success keep their groups/default row.
    if (
      !hasLoadedModelOptions.value &&
      blockingLoadError.value &&
      allProvidersLoaded.value &&
      !agentProviderLoading.value &&
      observedProviderIds.value.every(
        (pid) =>
          providerRequests$.value[pid]?.status !== 'loading' &&
          (providerCatalogs$.value[pid]?.models.length ?? 0) === 0,
      )
    )
      return [];
    return groupedModelOptions.value
      .filter((group) => {
        const providerKey = group.parentKey ?? group.key;
        return (
          !providerTabsEnabled.value ||
          group.key === 'default' ||
          providerKey === activeBrowseProviderId.value
        );
      })
      .map((group) => ({
        ...group,
        options:
          group.key === AUGGIE_LEGACY_GROUP_KEY
            ? legacyModelsVisible.value
              ? group.options
              : []
            : providerTabsEnabled.value || !collapsedGroups.value.has(group.key)
              ? group.options
              : [],
      }));
  });
  // True while a settled fetch result for the selected model's own provider is
  // still outstanding but expected. `allProvidersLoaded` is not enough: on boot
  // the availability list is empty, so fetchAllProviderModels([]) marks
  // "loaded" with an empty catalog and the model looks unavailable before its
  // provider was ever queried.
  const isSelectedModelProviderPending = useComputed(() => {
    const modelProvider = selectedModelProviderId.value;
    if (!modelProvider) return false;
    if (!canUseProviderModels(modelProvider)) return false;
    if (hasProviderResult(modelProvider)) return false;
    if (allProviderLoading.value[modelProvider]) return true;
    // Availability hasn't been probed yet — an empty enabled list is "unknown".
    if (!hasCheckedOnce$.value) return true;
    if (isProviderEnabled(availableEnabledProviderIds$.value, modelProvider)) return true;
    // Not enabled: the per-agent fetch is the only source of a result.
    if (
      usesAgentProviderFetch.value &&
      normalizeProviderId(effectiveProviderId.value) === modelProvider
    ) {
      return (
        agentProviderLoading.value ||
        (agentProviderModels.value === null && agentProviderError.value === null)
      );
    }
    return false;
  });
  const isSelectedModelMissingFromCatalog = useComputed(() => {
    if (!hasExplicitModel.value) return false;
    if (!localModel.value) return false;
    // Legacy `<provider>:default` mapped to the provider's isDefault row —
    // not missing, it renders as that model.
    if (legacyDefaultMappedOption.value) return false;
    return !selectedCatalogOption.value;
  });
  // Follow the daemon's re-home (intent#5737): while the agent's provider is
  // disabled the warning derives from settings alone; when the session then
  // lands on another provider (the daemon moves it on the next send and the
  // agent-updated event refreshes `explicitProviderId`), announce the switch
  // once with the existing fallback toast and keep the from/to note in the
  // picker. The FE never performs the switch itself. A user pick in the
  // meantime, or the provider being re-enabled, cancels the announcement.
  const disabledProviderSnapshot = useSignal<{
    agentId: string;
    providerId: string;
    fromModel: string;
  } | null>(null);
  // Set by an explicit pick while the provider is disabled: the user chose
  // the switch, so the daemon's re-home must not be announced as its own.
  const reHomeAnnouncementSuppressed = useSignal(false);
  // The agent-updated event that re-homes the agent refreshes the session's
  // provider and model together, but the `selectedModel` prop can land in a
  // later flush. Until the prop matches the session model the old model is
  // stale, so neither the announcement nor the auto-fallback may act on it.
  // A re-home onto the provider default lands with no `model` on the AgentLite
  // row (§5.5 omits it), so an absent model on a present session means "no
  // pinned model", and the prop must catch up to that too.
  const isAwaitingReHomedModel = useComputed(() => {
    const snapshot = disabledProviderSnapshot.value;
    if (!snapshot || snapshot.agentId !== agentId.value || isEffectiveProviderDisabled.value)
      return false;
    const session = agentSession$.value;
    if (!session) return false;
    const sessionModel = session.model;
    const sessionModelId =
      typeof sessionModel === 'string' ? splitLegacyCompoundId(sessionModel).modelId : '';
    const localModelId =
      hasExplicitModel.value && localModel.value
        ? splitLegacyCompoundId(localModel.value).modelId
        : '';
    return sessionModelId !== localModelId;
  });
  const isSelectedModelMissingAfterLoad = useComputed(() => {
    if (isGuestLocked.value) return false;
    // Settings-derived: does not wait for catalog loads or availability probes.
    if (isSelectedModelProviderDisabled.value) return true;
    if (isAwaitingReHomedModel.value) return false;
    // A cleared registry is unknown until its replacement arrives, even if
    // the last successful models.list response is still cached.
    if (!hasCheckedOnce$.value) return false;
    if (!canUseProviderModels(selectedModelProviderId.value || effectiveProviderId.value))
      return true;
    if (isLoadingModels.value) return false;
    if (!allProvidersLoaded.value) return false;
    if (isSelectedModelProviderPending.value) return false;
    return isSelectedModelMissingFromCatalog.value;
  });
  const isSelectedModelUnavailable = useComputed(() => {
    if (!isSelectedModelMissingAfterLoad.value) return false;
    if (isSelectedModelProviderDisabled.value) return true;
    const provider = selectedModelGateProviderId.value;
    // A hydrated registry can establish that a historical provider no longer
    // resolves, even though that provider can never return a model catalog.
    if (providerCatalogEntries$.value.length > 0 && !hasResolvedProvider(provider)) return true;
    const catalog = providerCatalogs$.value[provider];
    const request = providerRequests$.value[provider];
    // A failed probe or a degraded/last-good list cannot establish removal.
    // Keep the user's model and effort until this provider has a fresh result.
    if (!catalog || catalog.stale || catalog.warning) return false;
    if (request?.error || request?.status === 'loading' || request?.status === 'cancelled')
      return false;
    return true;
  });
  // --- Per-agent fallback tracking (persisted through Redux sagas so it survives page refresh) ---
  // Keyed by agentId so warnings don't leak across agents/workspaces.
  const fallbackInfo$ = selectModelFallbackInfo(agentIdStore);
  const reasoningEffort$ = selectAgentReasoningEffort(agentIdStore);
  const agentModelEffortLevels$ = selectAgentModelEffortLevels(agentIdStore);
  const selectedModelEffortLevels = useComputed<string[]>(() => {
    if (
      !onReasoningChange.value &&
      Array.isArray(agentModelEffortLevels$.value) &&
      agentModelEffortLevels$.value.length > 0
    ) {
      return agentModelEffortLevels$.value;
    }
    const levels = selectedCatalogOption.value?.data?.effortLevels;
    return Array.isArray(levels) ? (levels as string[]) : [];
  });
  const LEVEL_LABELS: Record<string, () => string> = {
    none: () => m.chat_shared_valueOff_label(),
    minimal: () => m.chat_effortPicker_level_minimal(),
    low: () => m.chat_effortPicker_level_low(),
    medium: () => m.chat_effortPicker_level_medium(),
    high: () => m.chat_effortPicker_level_high(),
    xhigh: () => m.chat_effortPicker_level_xhigh(),
    max: () => m.chat_effortPicker_level_max(),
  };
  function reasoningLevelLabel(level: string): string {
    return LEVEL_LABELS[level]?.() ?? level;
  }
  const reasoningLevels = useComputed(() =>
    showReasoning.value ? selectedModelEffortLevels.value : [],
  );
  const showReasoningFooter = useComputed(
    () => showReasoning.value && reasoningLevels.value.length > 0,
  );
  const persistedReasoningEffort = useComputed(() =>
    onReasoningChange.value ? (reasoningEffort.value ?? null) : (reasoningEffort$.value ?? null),
  );
  const inheritedReasoningLabel = useComputed(() =>
    defaultReasoningEffort.value && reasoningLevels.value.includes(defaultReasoningEffort.value)
      ? m.chat_modelPicker_defaultModelPreview_label({
          model: reasoningLevelLabel(defaultReasoningEffort.value),
        })
      : undefined,
  );
  const currentReasoningEffort = useComputed(() =>
    persistedReasoningEffort.value && reasoningLevels.value.includes(persistedReasoningEffort.value)
      ? persistedReasoningEffort.value
      : null,
  );
  const currentReasoningLabel = useComputed(() =>
    persistedReasoningEffort.value &&
    !reasoningLevels.value.includes(persistedReasoningEffort.value)
      ? m.chat_effortPicker_unavailable_label({
          level: reasoningLevelLabel(persistedReasoningEffort.value),
        })
      : currentReasoningEffort.value
        ? reasoningLevelLabel(currentReasoningEffort.value)
        : (inheritedReasoningLabel.value ?? m.chat_effortPicker_level_auto()),
  );
  const currentReasoningLevelIndex = useComputed(() =>
    currentReasoningEffort.value ? reasoningLevels.value.indexOf(currentReasoningEffort.value) : -1,
  );
  const showTriggerReasoningGauge = useComputed(
    () => showReasoningFooter.value && currentReasoningEffort.value !== 'none',
  );
  const triggerLabel = useComputed(() => currentModelLabel.value);
  const triggerAccessibleLabel = useComputed(() =>
    showReasoningFooter.value
      ? `${currentModelLabel.value} · ${currentReasoningLabel.value}`
      : currentModelLabel.value,
  );
  const lockedButtonTitle = useComputed(() =>
    isGuestLocked.value
      ? m.chat_modelPicker_guestLocked_title()
      : lockedTitle.value?.trim() ||
        m.chat_modelPicker_modelLocked_title({ model: triggerAccessibleLabel.value }),
  );
  // The in-flight commit window is announced with `aria-busy` and re-entry is
  // ignored in `handleReasoningSelect`; it must not feed the HTML `disabled`
  // attribute, which would drop focus from the effort trigger (intent#4159).
  const updatingReasoningEffort = useSignal(false);
  const reasoningControlDisabled = useComputed(
    () =>
      reasoningDisabled.value ||
      effectiveLocked.value ||
      !hasResolvedProvider(selectedModelGateProviderId.value) ||
      isApplyingModelUpdate.value ||
      pendingModelUpdate.value !== null ||
      (!onReasoningChange.value && (!agentId.value || !workspaceId.value)) ||
      reasoningLevels.value.length === 0,
  );
  const refreshProviderId = useComputed(
    () => activeBrowseProviderId.value || preferredBrowseProviderId.value,
  );
  const showDropdownFooter = useComputed(
    () =>
      showReasoningFooter.value ||
      (!allProvidersLoaded.value && Object.keys(allProviderModels.value).length > 0) ||
      activeProviderIssue.value !== null ||
      refreshingProviders.value.has(refreshProviderId.value),
  );
  const railProviderIds = useComputed(() => providerTabIds.value);
  const pointerInteraction = useSignal(false);
  function clearModelSearch(event: ReactMouseEvent<HTMLElement>) {
    return batch(() => {
      modelSearchValue.value = '';
      (event.currentTarget as HTMLElement)
        .closest('[data-slot="dropdown-content"]')
        ?.querySelector<HTMLInputElement>('[role="searchbox"]')
        ?.focus();
    });
  }
  function selectProviderTab(providerId: string) {
    return batch(() => {
      providerBrowseChanged.value = true;
      activeBrowseProviderId.value = providerId;
    });
  }
  function handleProviderTabKeydown(event: ReactKeyboardEvent<HTMLElement>, providerId: string) {
    const currentIndex = railProviderIds.value.indexOf(providerId);
    if (currentIndex < 0) return;
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      nextIndex = (currentIndex + 1) % railProviderIds.value.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + railProviderIds.value.length) % railProviderIds.value.length;
    }
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = railProviderIds.value.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    selectProviderTab(railProviderIds.value[nextIndex] ?? providerId);
    const tabs = (event.currentTarget as HTMLButtonElement)
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[nextIndex]?.focus();
  }
  async function handleReasoningSelect(value: string | null): Promise<boolean> {
    if (
      reasoningControlDisabled.value ||
      updatingReasoningEffort.value ||
      interactionLocked() ||
      mutationPending()
    )
      return false;
    const previous = persistedReasoningEffort.value;
    if (value === previous) return true;
    updatingReasoningEffort.value = true;
    const startedAgent = agentId.value;
    const startedWorkspace = workspaceId.value;
    const connection = selectPrincipalConnectionContext.select(appStore.state);
    const revision = modelChangeRevision.current;
    const canWrite = () =>
      !interactionLocked() &&
      agentId.value === startedAgent &&
      workspaceId.value === startedWorkspace &&
      revision === modelChangeRevision.current &&
      connection === selectPrincipalConnectionContext.select(appStore.state);
    try {
      if (onReasoningChange.value) {
        const accepted = await onReasoningChange.value(value);
        return canWrite() && accepted !== false;
      }
      if (!startedAgent || !startedWorkspace) return false;
      return await applyReasoningEffort(startedAgent, startedWorkspace, value, previous, {
        canSend: canWrite,
        canMutate: canWrite,
      });
    } finally {
      updatingReasoningEffort.value = false;
    }
  }
  function setFallbackInfo(info: ModelFallbackInfo) {
    if (agentId.value) {
      appStore.dispatch(setModelFallbackInfo(agentId.value, info));
    }
  }
  function clearFallbackInfo() {
    if (agentId.value) {
      appStore.dispatch(clearModelFallbackInfo(agentId.value));
    }
  }
  // Show warning if model is currently unavailable OR was recently auto-switched.
  // Only show on pickers tied to an existing agent (agentId) — the workspace
  // initializer creates new agents and shouldn't display fallback warnings.
  const showModelWarning = useComputed(
    () =>
      !!agentId.value &&
      !isGuestLocked.value &&
      (isSelectedModelUnavailable.value || fallbackInfo$.value !== null),
  );
  // Warning message to display
  const warningMessage = useComputed(() => {
    if (isSelectedModelProviderDisabled.value) {
      return {
        title: m.chat_modelPicker_noLongerAvailable_title({ model: currentModelLabel.value }),
        description: m.chat_modelPicker_providerDisabled_description({
          provider: providerDisplayName(selectedModelGateProviderId.value),
        }),
      };
    }
    if (isSelectedModelUnavailable.value) {
      return {
        title: m.chat_modelPicker_noLongerAvailable_title({
          model: localModel.value || m.chat_modelPicker_selectedModel_fallback(),
        }),
        description: m.chat_modelPicker_pickAnother_description(),
      };
    }
    const fallbackInfo = fallbackInfo$.value;
    if (fallbackInfo) {
      return {
        title: m.chat_modelPicker_noLongerAvailable_title({ model: fallbackInfo.fromModel }),
        description: m.chat_modelPicker_switchedTo_description({ model: fallbackInfo.toModel }),
      };
    }
    return null;
  });
  // Keep warnings, icon-only labels, and reasoning details available on hover.
  const triggerTitle = useComputed(() =>
    showModelWarning.value && warningMessage.value
      ? m.chat_modelPicker_warning_tooltip({
          title: warningMessage.value.title,
          description: warningMessage.value.description,
        })
      : isCompact.value || showReasoningFooter.value
        ? triggerAccessibleLabel.value
        : undefined,
  );
  // Re-home announcement (see `disabledProviderSnapshot`).
  useSignalEffect(() => {
    if (!agentId.value) {
      disabledProviderSnapshot.value = null;
      reHomeAnnouncementSuppressed.value = false;
      return;
    }
    const currentProviderId = normalizeProviderId(effectiveProviderId.value);
    if (isEffectiveProviderDisabled.value) {
      if (!disabledProviderSnapshot.value && !untracked(() => reHomeAnnouncementSuppressed.value)) {
        disabledProviderSnapshot.value = {
          agentId: agentId.value,
          providerId: currentProviderId,
          fromModel: untracked(() => currentModelLabel.value),
        };
      }
      return;
    }
    reHomeAnnouncementSuppressed.value = false;
    const snapshot = disabledProviderSnapshot.value;
    if (!snapshot) return;
    if (isAwaitingReHomedModel.value) return;
    disabledProviderSnapshot.value = null;
    if (snapshot.agentId !== agentId.value) return;
    if (snapshot.providerId === currentProviderId) return;
    const toModel = untracked(() => currentModelLabel.value);
    logger.info('Agent re-homed by the daemon after its provider was disabled:', {
      agentId: agentId.value,
      fromProvider: snapshot.providerId,
      toProvider: currentProviderId,
    });
    setFallbackInfo({ fromModel: snapshot.fromModel, toModel });
    notify.info(
      m.chat_modelPicker_unavailableSwitched_toast({ from: snapshot.fromModel, to: toModel }),
      { duration: 5000 },
    );
  });
  function findFallbackOption(restrictToProvider?: string): DropdownOption | undefined {
    return pickerProjections().findModelFallbackOption({
      options: flatModelOptions.value,
      excludeValue: USE_DEFAULT_VALUE,
      restrictToProvider,
      globallySelectedModel: selectedModel$.value,
    });
  }
  // Auto-fallback: When the selected model becomes unavailable, automatically switch to an available model.
  // Only applies to pickers tied to an existing agent — onboarding doesn't need this.
  useSignalEffect(() => {
    if (!agentId.value) return;
    if (isGuestLocked.value) return;
    // A disabled provider is re-homed by the daemon on the next send; the FE
    // must not `agent.setModel` its way around the gate (intent#5737).
    if (isSelectedModelProviderDisabled.value) return;
    if (isApplyingModelUpdate.value || pendingModelUpdate.value) return;
    if (!canUseProviderModels(selectedModelProviderId.value || effectiveProviderId.value)) return;
    if (!isSelectedModelUnavailable.value) return;
    if (flatModelOptions.value.length === 0) return;
    // Guard against transient unavailability. This effect writes the session
    // model (via handleModelSelect), which PERMANENTLY overwrites the
    // persisted model on the agent session — including across restarts.
    // Only proceed once we're confident the user's provider has truly settled;
    // otherwise a slow/empty per-provider fetch during boot or refresh would
    // silently replace the user's picked model (e.g. Sonnet 4.6 → GPT 5.4).
    const { providerId: rawModelProvider } = parseCompoundModelId(localModel.value ?? '');
    const modelProvider = normalizeProviderId(rawModelProvider);
    if (
      !pickerProjections().isUserProviderSettled({
        agentProviderModels: agentProviderModels.value,
        agentProviderError: agentProviderError.value,
        enabledProviderIds: availableEnabledProviderIds$.value,
        allProviderModels: allProviderModels.value,
        modelProvider,
      })
    ) {
      logger.debug('Skipping auto-fallback: user provider has not settled yet', {
        modelProvider,
        localModel: localModel.value,
      });
      return;
    }
    // Get the name of the unavailable model for the notification
    const unavailableModelName = localModel.value || m.chat_modelPicker_selectedModel_fallback();
    const unavailableProvider = selectedModelGateProviderId.value;
    // Find a same-provider fallback using the preference list, then the globally selected model,
    // then first available as a last resort.
    const fallbackOption = findFallbackOption(unavailableProvider);
    if (!fallbackOption) return;
    const fallbackModelName = fallbackOption.label || fallbackOption.value;
    logger.info('Auto-switching from unavailable model:', {
      unavailableModel: unavailableModelName,
      fallbackModel: fallbackOption.value,
    });
    // Determine whether this is a genuine "model disappeared" vs a provider-switch
    // artefact. During a provider switch the session may still hold a model from the
    // old provider (e.g. "haiku4.5") which doesn't match the new provider's prefixed
    // IDs (e.g. "claude-code:haiku4.5"). If the base model name matches an available
    // model, or the model's provider prefix differs from the active provider, skip
    // the warning — the user didn't lose their model, the provider just changed.
    const { providerId: unavailableModelProvider, modelId: unavailableBaseId } =
      parseCompoundModelId(unavailableModelName);
    const activeProvider = normalizeProviderId(activeProviderId$.value);
    const isProviderSwitch =
      unavailableModelProvider !== activeProvider ||
      flatModelOptions.value.some((opt) => {
        const { modelId: optBaseId } = parseCompoundModelId(opt.value);
        return optBaseId === unavailableBaseId;
      });
    if (!isProviderSwitch) {
      // Store fallback info per-agent (persisted through Redux sagas for page refresh)
      setFallbackInfo({
        fromModel: unavailableModelName,
        toModel: fallbackModelName,
      });
      // Show toast notification explaining the switch
      notify.info(
        m.chat_modelPicker_unavailableSwitched_toast({
          from: unavailableModelName,
          to: fallbackModelName,
        }),
        {
          duration: 5000,
        },
      );
      // Switch to the fallback model — only when the model genuinely disappeared.
      // During a provider switch the model isn't really missing, so skip the silent
      // switch to avoid clobbering a valid compound/bare model ID round-trip.
      handleModelSelect(
        fallbackOption.value,
        resolvePickedTriple(fallbackOption.value, unavailableProvider),
      );
    } else {
      logger.debug('Skipping auto-fallback (provider switch detected)', {
        unavailableModel: unavailableModelName,
        unavailableBaseId,
      });
    }
  });
  const silentRetryAttemptedForProvider = useRef<string | null>(null);
  // Silent fallback for onboarding-style pickers (no agentId)
  // When a model doesn't exist, fall back to a same-provider model (with one retry)
  // Guard to prevent the retry fetch from re-firing indefinitely if the model
  // remains unavailable after the retry (e.g., provider ID normalization mismatch).
  const silentFallbackRetried = useSignal(false);
  // Reset the retry guard when the user picks a new model
  useSignalEffect(() => {
    void localModel.value; // track localModel
    silentFallbackRetried.value = false;
  });
  useSignalEffect(() => {
    if (!silentFallback.value) return;
    if (isGuestLocked.value) return;
    if (isApplyingModelUpdate.value || pendingModelUpdate.value) return;
    if (!canUseProviderModels(selectedModelProviderId.value || effectiveProviderId.value)) return;
    if (!isSelectedModelMissingAfterLoad.value) return;
    if (!isLoadingModels.value && flatModelOptions.value.length === 0) return;
    const currentProvider = selectedModelGateProviderId.value;
    // Try same-provider fallback first
    const fallbackOption = isSelectedModelUnavailable.value
      ? findFallbackOption(currentProvider)
      : undefined;
    if (fallbackOption) {
      logger.info('Workspace initializer: falling back to same-provider model', {
        unavailableModel: localModel.value,
        fallbackModel: fallbackOption.value,
        provider: currentProvider,
      });
      handleModelSelect(
        fallbackOption.value,
        resolvePickedTriple(fallbackOption.value, currentProvider),
      );
      return;
    }
    // Only retry the fetch once per unavailable-model episode
    if (silentFallbackRetried.value) return;
    silentFallbackRetried.value = true;
    // No same-provider model available — retry the fetch once, then warn
    if (silentRetryAttemptedForProvider.current === currentProvider) return;
    silentRetryAttemptedForProvider.current = currentProvider;
    appStore.dispatch(providerModelsRequested(currentProvider, 'silentRetry', workspaceId.value));
  });
  const dropdownOpen = useSignal(false);
  const dropdownRef = useRef<DropdownHandle | null>(null);
  useSignalEffect(() => {
    if (!modalAware.value || !dropdownOpen.value) return;
    return pushEscapeLayer(() => {
      dropdownRef.current?.dismissAndFocusTrigger();
    });
  });
  const detailsError = useSignal<ProviderLoadError | null>(null);
  const detailsOpen = useSignal(false);
  function showProviderDetails(error: ProviderLoadError) {
    return batch(() => {
      // The footer is removed when its dropdown closes. Restore focus to the
      // stable picker trigger before opening the dialog so dismissal returns there.
      dropdownRef.current?.dismissAndFocusTrigger();
      detailsError.value = error;
      detailsOpen.value = true;
    });
  }
  /** Clear the fallback warning - call when user sends a message or explicitly selects a model */
  function clearFallbackWarning() {
    clearFallbackInfo();
  }
  async function handleModelChange(value: string | string[], event?: MouseEvent) {
    if (interactionLocked() || mutationPending()) {
      dropdownValue.value = currentDropdownValue();
      return;
    }
    const connection = selectPrincipalConnectionContext.select(appStore.state);
    const modelValue = value as string;
    const pick =
      modelValue === USE_DEFAULT_VALUE
        ? undefined
        : resolvePickedTriple(modelValue, activeBrowseProviderId.value);
    if (pick && !allowProviderSwitch.value && pick.providerId !== effectiveProviderId.value) {
      dropdownValue.value = currentDropdownValue();
      return;
    }
    const fromProviderId = selectedModelProviderId.value || effectiveProviderId.value;
    const confirmation = ++confirmationRevision.current;
    const revision = modelChangeRevision.current;
    const sessionIdentity =
      agentId.value && workspaceId.value
        ? selectAgentModelWriteSnapshot.select(appStore.state, agentId.value, workspaceId.value)
            .identity
        : undefined;
    // Gate user-picked changes to a *different* model behind the optional
    // confirmation callback (mid-conversation switch warning). Re-selecting
    // the current model is never gated; picking "Default model" while an
    // explicit model is selected is gated too — the agent still restarts on
    // the provider default (a null `to` in the gate means "provider default").
    const isActualChange =
      modelValue === USE_DEFAULT_VALUE
        ? hasExplicitModel.value
        : !localModel.value ||
          pick?.providerId !== fromProviderId ||
          normalizeModelIdForMatch(modelValue, pick?.providerId ?? effectiveProviderId.value) !==
            normalizeModelIdForMatch(localModel.value, fromProviderId);
    if (isActualChange && confirmModelChange.value) {
      const confirmed = await confirmModelChange.value(
        localModel.value,
        modelValue === USE_DEFAULT_VALUE ? null : modelValue,
        {
          from: currentModelLabel.value,
          fromProviderId,
          toProviderId: pick?.providerId ?? fromProviderId,
          to:
            modelValue === USE_DEFAULT_VALUE
              ? m.chat_modelPicker_defaultModel_label()
              : (getModelLabel(modelValue, pick?.providerId) ??
                parseCompoundModelId(modelValue).modelId),
        },
      );
      if (
        !confirmed ||
        connection !== selectPrincipalConnectionContext.select(appStore.state) ||
        confirmation !== confirmationRevision.current ||
        revision !== modelChangeRevision.current ||
        interactionLocked() ||
        (pick && !allowProviderSwitch.value && pick.providerId !== effectiveProviderId.value) ||
        (sessionIdentity !== undefined &&
          agentId.value &&
          workspaceId.value &&
          sessionIdentity !==
            selectAgentModelWriteSnapshot.select(appStore.state, agentId.value, workspaceId.value)
              .identity)
      ) {
        dropdownValue.value = currentDropdownValue();
        return;
      }
    }
    // Combined model/effort pickers keep the panel for the next choice. When
    // closing a model-only picker, restore keyboard/modal focus to its trigger.
    if (!showReasoning.value && (modalAware.value || !event)) {
      queueMicrotask(() => {
        if (destroyed.current || confirmation !== confirmationRevision.current) return;
        dropdownOpen.value = false;
        dropdownRef.current?.focusTrigger();
      });
    }
    // User explicitly selected a model in the dropdown — clear any fallback warning
    clearFallbackInfo();
    // Convert USE_DEFAULT_VALUE back to undefined
    if (modelValue === USE_DEFAULT_VALUE) {
      void handleModelSelect(undefined);
    } else {
      void handleModelSelect(modelValue, pick);
    }
  }
  // Expose open function for keyboard shortcut
  function open() {
    return batch(() => {
      if (!interactionLocked()) {
        pointerInteraction.value = false;
        void dropdownRef.current?.openAndFocusSearch();
      }
    });
  }
  useImperativeHandle(props.ref, () => ({ open, clearFallbackWarning }));
  useEffect(() => {
    const pointer = () => {
      pointerInteraction.value = true;
    };
    const keyboard = () => {
      pointerInteraction.value = false;
    };
    window.addEventListener('pointerdown', pointer);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('pointerdown', pointer);
      window.removeEventListener('keydown', keyboard);
    };
  }, [pointerInteraction]);

  // Render the slots here so their signal reads belong to this component.
  const gauge = showTriggerReasoningGauge.value ? (
    <EffortGauge
      value={currentReasoningLevelIndex.value}
      max={Math.max(1, reasoningLevels.value.length - 1)}
      centered={currentReasoningEffort.value === null}
      testId="model-reasoning-effort-gauge"
      className="[&_line]:transition-none!"
    />
  ) : null;
  const providerIcon = hasProviderIcon(triggerProviderId.value) ? (
    <ProviderIcon providerId={triggerProviderId.value} className="size-3.5" />
  ) : null;
  const triggerContent = (
    <>
      <span
        className={cn(
          'inline-flex items-center gap-2 truncate min-w-0',
          (variant.value === 'outline' || variant.value === 'default') && 'flex-1',
        )}
        title={isTriggerLabelResolved.value ? triggerTitle.value : ''}
        aria-label={isTriggerLabelResolved.value ? triggerAccessibleLabel.value : undefined}
      >
        {isCompact.value ? (
          <GearIcon className="h-4 w-4" aria-hidden="true" />
        ) : isTriggerLabelResolved.value ? (
          <>
            {showModelWarning.value && (
              <WarningIcon className="h-3 w-3 text-warning-ink shrink-0" aria-hidden="true" />
            )}
            {providerIcon}
            <TruncatedLabel
              className="truncate"
              title={triggerTitle.value ? undefined : triggerLabel.value}
            >
              {triggerLabel.value}
            </TruncatedLabel>
            {gauge}
          </>
        ) : (
          <div className="h-3.5 w-24 bg-muted/50 rounded-sm animate-pulse" />
        )}
      </span>
      {(variant.value === 'outline' || variant.value === 'default') && (
        <CaretDownIcon className="h-2 w-2 opacity-50 shrink-0" aria-hidden="true" />
      )}
    </>
  );
  const groupState = {
    legacyVisible: legacyModelsVisible.value,
    legacyDisabled: legacyToggleDisabled.value,
    providerTabs: providerTabsEnabled.value,
    collapsed: collapsedGroups.value,
    refreshing: refreshingProviders.value,
  };
  const groupHeader = ({ group, groupIndex }: DropdownGroupProps) =>
    group.key === AUGGIE_LEGACY_GROUP_KEY ? (
      <ModelPickerLegacyGroupHeader
        group={group}
        groupIndex={groupIndex}
        expanded={groupState.legacyVisible}
        disabled={groupState.legacyDisabled}
        onToggle={() => {
          if (!legacyToggleDisabled.value) legacyModelsExpanded.value = !legacyModelsExpanded.value;
        }}
      />
    ) : !groupState.providerTabs ? (
      <ModelPickerGroupHeader
        group={group}
        groupIndex={groupIndex}
        collapsed={groupState.collapsed.has(group.key)}
        refreshing={groupState.refreshing.has(group.key)}
        onToggle={toggleGroup}
        onRefresh={handleRefreshProvider}
      />
    ) : null;
  const footer = (
    <>
      {!allProvidersLoaded.value && Object.keys(allProviderModels.value).length > 0 && (
        <div className="px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
          <IntentMarkLoader size={12} />
          <span>{m.chat_modelPicker_loadingMore_label()}</span>
        </div>
      )}
      {nonBlockingProviderWarnings.value.length > 0 && (
        <div className="px-3 py-2 space-y-1.5 text-xs">
          {nonBlockingProviderWarnings.value.map((warning) => (
            <div
              key={warning.providerId}
              className="flex items-start gap-2 text-muted-foreground"
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- This is a provider diagnostic live region, not a form result.
              role="status"
            >
              <ModelProviderErrorItem
                providerId={warning.providerId}
                providerLabel={warning.providerName}
                error={warning.message}
                hint={warning.hint}
                compact
              />
            </div>
          ))}
        </div>
      )}
      {(activeProviderIssue.value || refreshingProviders.value.has(refreshProviderId.value)) && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={refreshingProviders.value.has(refreshProviderId.value)}
            aria-label={m.chat_modelPicker_retry_label()}
            aria-busy={refreshingProviders.value.has(refreshProviderId.value)}
            onClick={() => handleRefreshProvider(refreshProviderId.value)}
          >
            {refreshingProviders.value.has(refreshProviderId.value) && (
              <IntentMarkLoader size={12} />
            )}
            {m.chat_modelPicker_retry_label()}
          </Button>
          {activeProviderIssue.value && (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => {
                if (activeProviderIssue.value) showProviderDetails(activeProviderIssue.value);
              }}
            >
              {m.chat_modelPicker_errorDetails_label()}
            </Button>
          )}
        </div>
      )}
      {showReasoningFooter.value && (
        <div className="w-full min-w-0 px-3 py-2" data-testid="model-reasoning-section">
          <EffortPicker
            mode="embedded"
            className="w-full min-w-0 gap-2! [&>div]:w-24 [&>span]:min-w-0 [&>span>span]:truncate"
            agentId={agentId.value}
            workspaceId={workspaceId.value}
            effortLevels={reasoningLevels.value}
            effort={persistedReasoningEffort.value}
            autoLabel={inheritedReasoningLabel.value}
            disabled={reasoningControlDisabled.value}
            busy={updatingReasoningEffort.value}
            modalAware={modalAware.value}
            onEffortChange={handleReasoningSelect}
          />
        </div>
      )}
    </>
  );
  const header = (
    <>
      <div
        className="absolute inset-y-0 left-0 flex w-12 flex-col items-center gap-1 border-r border-border bg-muted/20 py-2"
        data-testid="model-provider-rail"
      >
        <div
          className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto"
          role="tablist"
          aria-orientation="vertical"
          aria-label={m.chat_modelPicker_modelProviders_label()}
          data-testid="model-provider-tabs"
        >
          {railProviderIds.value.map((id) => (
            <Button
              key={id}
              variant="ghost"
              size="icon-sm"
              iconOnly
              role="tab"
              aria-selected={id === activeBrowseProviderId.value}
              aria-label={providerDisplayName(id)}
              title={providerDisplayName(id)}
              tabIndex={id === activeBrowseProviderId.value ? 0 : -1}
              className={cn(
                'text-muted-foreground hover:bg-muted/40',
                id === activeBrowseProviderId.value && 'bg-muted text-foreground',
              )}
              onClick={() => selectProviderTab(id)}
              onKeyDown={(event) => handleProviderTabKeydown(event, id)}
            >
              <ProviderIcon providerId={id} className="size-4" size={16} />
            </Button>
          ))}
        </div>
        {!hasNoAvailableProvider.value && !hostMember$.value && (
          <Button
            variant="ghost"
            size="icon-sm"
            iconOnly
            aria-label={m.chat_modelPicker_noProviderAvailable_openSettings_label()}
            className="text-muted-foreground hover:bg-muted/40"
            data-testid="model-provider-settings-button"
            onClick={openProviderSettings}
          >
            <PlusIcon className="size-3 text-muted-foreground/50" aria-hidden="true" />
          </Button>
        )}
      </div>
      {modelSearchValue.value && (
        <Button
          variant="ghost"
          size="icon-xs"
          iconOnly
          className="absolute right-10 top-1.5 z-20"
          aria-label={m.chat_modelPicker_clearSearch_ariaLabel()}
          onClick={clearModelSearch}
        >
          <XIcon className="size-3" aria-hidden="true" />
        </Button>
      )}
      {refreshProviderId.value && (
        <Button
          variant="ghost"
          size="icon-xs"
          iconOnly
          title={m.chat_modelPicker_refreshGroup_title({
            group: providerDisplayName(refreshProviderId.value),
          })}
          aria-label={m.chat_modelPicker_refreshGroup_title({
            group: providerDisplayName(refreshProviderId.value),
          })}
          className={cn(
            'absolute right-2 top-1.5 text-subtle hover:bg-muted/40',
            refreshingProviders.value.has(refreshProviderId.value) && 'opacity-50!',
          )}
          data-testid="model-provider-refresh-button"
          aria-busy={refreshingProviders.value.has(refreshProviderId.value)}
          disabled={refreshingProviders.value.has(refreshProviderId.value)}
          onClick={() => handleRefreshProvider(refreshProviderId.value)}
        >
          {refreshingProviders.value.has(refreshProviderId.value) ? (
            <IntentMarkLoader size={12} />
          ) : (
            <ArrowsClockwiseIcon
              size={10}
              className="text-subtle transition-transform duration-spring-slow ease-spring-slow motion-reduce:transition-none"
              aria-hidden="true"
            />
          )}
        </Button>
      )}
      {showModelWarning.value && warningMessage.value && (
        <div className="px-3 py-2.5 border-b border-border bg-warning/5">
          <div className="flex items-start gap-2" role="alert">
            <WarningIcon
              className="h-3.5 w-3.5 text-warning-ink mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground leading-tight">
                {warningMessage.value.title}
              </div>
              <div className="text-xs text-subtle mt-0.5 leading-tight">
                {warningMessage.value.description}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
  const item = ({ option, selected }: DropdownItemProps) => {
    const providerLoadError = option.data?.providerLoadError as ProviderLoadError | undefined;
    const providerLoading = option.data?.providerLoading as boolean | undefined;
    return (
      <div className="flex items-center gap-2.5 w-full min-w-0 py-1">
        {providerLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <IntentMarkLoader size={12} />
            <span>{option.label}</span>
          </div>
        ) : providerLoadError ? (
          <ModelProviderErrorItem
            providerId={providerLoadError.providerId}
            providerLabel={providerLoadError.providerName}
            error={providerLoadError.message}
            hint={providerLoadError.hint}
          />
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <span
                className={cn(
                  'block truncate text-sm font-normal',
                  option.value === USE_DEFAULT_VALUE && 'text-muted-foreground',
                )}
              >
                {option.label}
              </span>
              {option.description && (
                <TruncatedLabel
                  className="block text-xs text-subtle truncate mt-0.5"
                  title={option.description}
                >
                  {option.description}
                </TruncatedLabel>
              )}
            </div>
            <Indicator state={selected ? 'checked' : 'empty'} />
          </>
        )}
      </div>
    );
  };
  return (
    <>
      {effectiveLocked.value ? (
        <Button
          variant={variant.value}
          size={buttonSize.value}
          className={cn(buttonClass.value, 'cursor-default')}
          title={lockedButtonTitle.value}
          tooltip={lockedButtonTitle.value}
          aria-label={triggerAccessibleLabel.value}
          disabled
        >
          {isCompact.value ? (
            <LockIcon className="h-4 w-4" aria-hidden="true" />
          ) : size.value === 'xs' ? (
            <>
              {shouldShowLockIconWhenLocked.value && (
                <LockIcon className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {providerIcon}
              <span className="flex-1 text-left truncate">{triggerLabel.value}</span>
              {gauge}
            </>
          ) : (
            <span
              className={cn('flex items-center', shouldShowLockIconWhenLocked.value && 'gap-1.5')}
            >
              {shouldShowLockIconWhenLocked.value && (
                <LockIcon className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {providerIcon}
              <span className="text-xs truncate">{triggerLabel.value}</span>
              {gauge}
            </span>
          )}
        </Button>
      ) : (
        <>
          <Dropdown
            ref={dropdownRef}
            value={dropdownValue.value}
            searchValue={modelSearchValue.value}
            onSearchValueChange={(value) => {
              modelSearchValue.value = value;
            }}
            defaultHighlightValue={
              defaultModelIdMappedOption.value?.value ??
              defaultModelId.value ??
              catalogDefaultFallbackOption.value?.value
            }
            open={dropdownOpen.value}
            onOpenChange={(value) => {
              dropdownOpen.value = value;
            }}
            groups={displayGroups.value}
            onChange={handleModelChange}
            closeOnSelect={!showReasoning.value}
            variant={
              variant.value === 'outline'
                ? 'outline'
                : variant.value === 'default'
                  ? 'default'
                  : 'ghost'
            }
            size={size.value === 'xs' ? 'xs' : 'sm'}
            searchable={!hasNoAvailableProvider.value}
            searchChrome
            placeholder={m.ui_dropdown_search_ariaLabel()}
            className="min-w-0 max-w-full"
            headerClass={cn(
              'model-picker-header border-b-0!',
              !hasNoAvailableProvider.value && 'pt-9',
            )}
            triggerClass={cn(
              'max-w-full px-2!',
              (variant.value === 'outline' || variant.value === 'default') &&
                'w-full justify-between border-border!',
              triggerClass.value,
            )}
            contentClass={cn(
              'model-picker-panel max-w-[calc(100vw-16px)] bg-popover! text-foreground! w-96 h-[360px] min-h-0 flex flex-col rounded-xl pl-12',
              pointerInteraction.value && 'model-picker-pointer',
            )}
            contentMaxHeight={360}
            fillContentHeight
            animate={false}
            portal={portal.value}
            collisionBoundary={collisionBoundary.value}
            trigger={() => triggerContent}
            groupHeader={groupHeader}
            header={header}
            item={item}
            footer={showDropdownFooter.value ? footer : undefined}
            empty={
              <ModelPickerEmptyState
                isLoadingModels={isLoadingModels.value}
                blockingLoadError={activeProviderIssue.value ?? blockingLoadError.value}
                retryInFooter={
                  activeProviderIssue.value !== null ||
                  refreshingProviders.value.has(refreshProviderId.value)
                }
                hasNoAvailableProvider={hasNoAvailableProvider.value}
                hostManaged={hostMember$.value}
                onOpenProviderSettings={openProviderSettings}
                onRetry={handleRetry}
              />
            }
          />
          <ModelPickerProviderNotice
            warning={codexFallbackWarning.value?.message}
            docsUrl={codexFallbackWarning.value?.docsUrl}
            show={
              (showProviderWarningNotice.value ?? variant.value === 'default') &&
              Boolean(codexFallbackWarning.value)
            }
            variant="warning"
            className={resolvedNoticeClass.value}
          />
        </>
      )}
      <ContentDialog
        open={detailsOpen.value}
        onOpenChange={(value) => {
          detailsOpen.value = value;
        }}
        title={m.chat_modelPicker_errorDetails_title({
          provider: detailsError.value?.providerName ?? '',
        })}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          dropdownRef.current?.focusTrigger();
        }}
      >
        <pre className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] type-caption font-mono text-foreground">
          {detailsError.value?.details}
        </pre>
      </ContentDialog>
    </>
  );
}

/** Keep the source's native title only when the label is actually truncated. */
function TruncatedLabel({
  children,
  title,
  className,
}: {
  children: string;
  title?: string;
  className: string;
}) {
  const element = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!element.current) return;
    const observer = truncatedTitle(element.current, title);
    return () => observer?.destroy?.();
  }, [title, children]);
  return (
    <span ref={element} className={className}>
      {children}
    </span>
  );
}
