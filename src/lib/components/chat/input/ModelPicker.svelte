<script lang="ts">
  import { truncatedTitle } from '$lib/actions/observe-overflow';
  import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';
  /* eslint-disable max-lines */
  import { selectCanAdministerHost } from '$store/renderer/slices/principal/principal-selectors';
  const canAdministerHost$ = selectCanAdministerHost();
  import { onDestroy, onMount, untrack } from 'svelte';
  import { writable, derived } from 'svelte/store';

  import { useAgentSession } from '$lib/hooks/useAgentSession.svelte';
  import { selectAgentReasoningEffort } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { isQuickActionProviderSwitchBlocked } from '$store/renderer/slices/background-agent-settings/quick-action-provider-switch';
  import { backgroundProviderSwitchBlocked } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';

  import Button from '$lib/components/ui/button/button.svelte';
  import {
    Dropdown,
    type DropdownGroupProps,
    type DropdownItemProps,
    type DropdownOption,
  } from '$lib/components/ui/dropdown';
  import ProviderIcon, {
    hasProviderIcon,
  } from '$features/agent/components/AgentProviderIcon.svelte';
  import { faSettings } from '$lib/icons/phosphor-icons';
  import ModelPickerEmptyState from './ModelPickerEmptyState.svelte';
  import EffortGauge from './EffortGauge.svelte';
  import EffortPicker from './EffortPicker.svelte';
  import ModelPickerGroupHeader from './ModelPickerGroupHeader.svelte';
  import ModelPickerLegacyGroupHeader from './ModelPickerLegacyGroupHeader.svelte';
  import ModelPickerProviderNotice, {
    createProviderWarningNotice,
    type ProviderWarningNotice,
  } from './ModelPickerProviderNotice.svelte';
  import ModelProviderErrorItem from './ModelProviderErrorItem.svelte';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { createAgentModelMutator } from './agent-model-mutator';
  import {
    selectAgentModelMutationPending,
    selectAgentModelMutations,
  } from '$store/renderer/slices/agent-model/agent-model-selectors';
  import {
    agentModelMutationRequested,
    agentModelMutationConsumed,
  } from '$store/renderer/slices/agent-model/agent-model-slice';

  import {
    selectAvailableModels,
    selectAvailableModelsProviderId,
    selectModelFallbackInfo,
    selectModelPickerCollapsedGroups,
    selectIsLoadingModels,
    selectLoadError,
    selectAgentModelEffortLevels,
  } from '$store/renderer/slices/model/model-selectors';
  import {
    clearModelFallbackInfo,
    selectModel,
    setModelFallbackInfo,
    setModelPickerGroupCollapsed,
  } from '$store/renderer/slices/model/model-slice';
  import type { ModelFallbackInfo } from '$store/renderer/slices/model/model-types';
  import {
    selectDaemonHealth,
    selectIsDaemonAppOwned,
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { ensureProvidersChecked } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import {
    selectIsProviderModelAccessAllowed,
    selectActiveProviderId,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import {
    selectContextDefaultProvider,
    selectContextReadinessLoaded,
    selectContextSelectedModel,
    selectContextProviderWarnings,
    selectContextProviderStaleFlags,
    selectContextProviderWarningKinds,
    selectContextProviderEntries,
    selectContextModelProviderIds,
    selectContextAvailableProviderIds,
    selectContextEnabledProviders,
    selectWorkspaceCatalogEpoch,
  } from '$store/renderer/slices/provider-catalog/workspace-catalog-selectors';
  import { ensureWorkspaceCatalogRequested } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import {
    selectProviderCatalogDefaultNames,
    selectProviderCatalogProfiles,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { selectProfileSignInStatuses } from '$store/renderer/slices/provider-settings/provider-profile-status-selectors';
  import { providerProfileSummaryStatusesEnsured } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    expandProviderIdsWithProfiles,
    findProfileByRef,
    isProviderProfileRef,
    providerRefBaseId,
    providerRefLabelParts,
  } from '$shared/provider-profiles';
  import { formatProviderRefLabel, providerRefProfileName } from '$shared/provider-ref-label';
  import {
    providerModelsObserved,
    providerModelsReleased,
    providerModelsRequested,
  } from '$store/renderer/slices/provider-models/provider-models-slice';
  import {
    selectProviderModelsCacheMap,
    selectLearnedModelDisplayName,
    selectLearnedModelNames,
    selectProviderModelsRequests,
  } from '$store/renderer/slices/provider-models/provider-models-selectors';

  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import { modelIdForDisplay, resolveModelDisplayName } from '$shared/utils/model-display-name';
  import { selectHidesAgentCreationActions } from '$store/renderer/slices/workspace/workspace-selectors';
  import { getAgentProvider } from '$shared/types/agent-session';
  import { formatProviderLoadError, type ProviderLoadError } from './model-picker-provider-errors';
  import { AUGGIE_LEGACY_GROUP_KEY, buildGroupedModelOptions } from './model-picker-groups';
  import {
    filterDefaultPseudoOptions,
    findModelFallbackOption,
    isProviderDisabledInSettings as isProviderDisabledInSettingsForContext,
    isProviderEnabled as isProviderEnabledForContext,
    isUserProviderSettled,
    normalizeModelIdForMatch as normalizeModelIdForMatchForContext,
    toDropdownOptions,
  } from './model-picker-utils';
  import { cn } from '$lib/utils';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { createLogger } from '$lib/utils/client-logger';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { notify } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { Indicator } from '$lib/components/ui/menu';
  import {
    faArrowsRotate,
    faChevronDown,
    faLock,
    faPlus,
    faXmark,
    faTriangleExclamation,
    faCircleInfo,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const logger = createLogger('ModelPicker');

  // Catalog-backed local shims for the legacy provider-config helpers, so the
  // picker's many call sites keep their shape. Reads are reactive via the
  // defaultProviderId$ subscription above plus the appStore.state lookups.
  function isProviderEnabled(ids: string[], id: string) {
    return isProviderEnabledForContext(ids, id, workspaceId);
  }
  function isProviderDisabledInSettings(enabled: Record<string, boolean>, id: string) {
    return isProviderDisabledInSettingsForContext(enabled, id, workspaceId);
  }
  function normalizeModelIdForMatch(id: string, provider?: string) {
    return normalizeModelIdForMatchForContext(id, provider, workspaceId);
  }
  function normalizeProviderId(providerId: string): string {
    void $providerCatalogEntries$;
    return (
      $providerCatalogEntries$.find(
        (p) => p.id === providerId || p.legacyAliases?.includes(providerId),
      )?.id ?? providerId
    );
  }
  // Group/tab label: bare names until a base has offered profiles, then
  // `<Provider> · Default` / `<Provider> · <Profile>` (§5.54). A profile
  // reference always names its profile.
  function providerDisplayName(providerId: string): string {
    void $providerCatalogEntries$;
    const baseId = normalizeProviderId(providerRefBaseId(providerId));
    const baseName = $providerCatalogEntries$.find((p) => p.id === baseId)?.displayName ?? baseId;
    const isProfile = isProviderProfileRef(providerId);
    return formatProviderRefLabel(
      isProfile ? providerId : baseId,
      baseName,
      $providerProfiles$,
      baseId,
      $providerDefaultNames$,
    );
  }
  function baseProviderDisplayName(providerId: string): string {
    const baseId = normalizeProviderId(providerRefBaseId(providerId));
    return $providerCatalogEntries$.find((p) => p.id === baseId)?.displayName ?? baseId;
  }
  function isProfileSignedOut(providerRef: string): boolean {
    const profile = findProfileByRef($providerProfiles$, providerRef);
    return !!profile && $profileSignInStatuses$[profile.id] === 'error';
  }
  function providerTabLabel(providerId: string): string {
    const label = providerDisplayName(providerId);
    return isProfileSignedOut(providerId)
      ? m.chat_modelPicker_profileSignedOut_ariaLabel({ provider: label })
      : label;
  }
  function baseHasProfiles(providerId: string): boolean {
    const baseId = normalizeProviderId(providerRefBaseId(providerId));
    return $providerProfiles$.some((profile) => profile.baseProviderId === baseId);
  }
  function profileInitial(providerRef: string): string {
    const name = findProfileByRef($providerProfiles$, providerRef)?.name.trim() ?? '';
    return name ? [...name][0].toLocaleUpperCase() : '?';
  }
  function parseCompoundModelId(compoundModelId: string): {
    providerId: string;
    modelId: string;
  } {
    const { providerId, modelId } = splitLegacyCompoundId(compoundModelId);
    return { providerId: providerId ?? $defaultProviderId$, modelId };
  }

  function hasResolvedProvider(providerId: string): boolean {
    void $providerCatalogEntries$;
    // A profile reference resolves only while its profile is saved (§5.54);
    // a deleted one needs an explicit replacement, never a substitute.
    if (isProviderProfileRef(providerId)) {
      return (
        !!findProfileByRef($providerProfiles$, providerId) &&
        hasResolvedProvider(providerRefBaseId(providerId))
      );
    }
    return $providerCatalogEntries$.some((p) => p.id === normalizeProviderId(providerId));
  }

  const antigravityModelsAllowed$ = selectIsProviderModelAccessAllowed('antigravity');
  // Antigravity sign-in is a guest-local fact; a guest-locked picker reads the
  // host catalog regardless (`isGuestLocked` is declared with the props below
  // and only read once the picker is rendering).
  function canUseProviderModels(providerId: string, allowLoadedCatalog = false): boolean {
    if (workspaceId && isGuestLocked && providerId) return true;
    // An existing models.list response has its own provider provenance. Keep
    // its labels during registry hydration; writes still require a registry row.
    if (
      !hasResolvedProvider(providerId) &&
      !(allowLoadedCatalog && providerId && providerId === $availableModelsProviderId$)
    )
      return false;
    return (
      normalizeProviderId(providerId) !== 'antigravity' ||
      (workspaceId ? $modelFetchProviderIds$.includes(providerId) : $antigravityModelsAllowed$) ||
      isGuestLocked
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
  // trigger is ensure-once and the middleware coalesces overlapping bulk
  // checks, so multiple pickers mounting concurrently cause no duplicate probes.
  onMount(() => {
    if (!workspaceId) appStore.dispatch(ensureProvidersChecked());
  });

  interface Props {
    selectedModel?: string | null;
    /**
     * Called on every user pick. `model` keeps the picked row's raw value for
     * backward compatibility (bare for the default provider, legacy
     * `provider:model` otherwise); `pick` carries the resolved triple legs —
     * the bare model id and its owning provider — so consumers never parse
     * the model string for a provider. Absent on the "use default" pick
     * (`model === ''`).
     */
    onModelChange?: (model: string, pick?: { providerId: string; modelId: string }) => void;
    /**
     * Optional go/no-go gate invoked before a user-picked model change is
     * applied. Called with the current and target model ids when they differ;
     * returning (or resolving) false reverts the dropdown selection and skips
     * the change entirely. Auto-fallback selections bypass this gate.
     */
    confirmModelChange?: (
      from: string | null | undefined,
      to: string | null,
      labels?: { from: string; to: string; fromProviderId?: string; toProviderId?: string },
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
  }

  let {
    selectedModel,
    onModelChange = () => {},
    confirmModelChange,
    providerId,
    allowProviderSwitch = true,
    isCompact = false,
    isLocked = false,
    lockedTitle,
    showLockIconWhenLocked = true,
    deferUpdate = false,
    variant = 'ghost-light',
    size = 'sm',
    workspaceId,
    agentId,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    showManageLink = true,
    portal = true,
    modalAware = false,
    collisionBoundary = null,
    triggerClass = '',
    defaultModelId,
    defaultModelLabel,
    fallbackToCatalogDefault = false,
    fallbackProviderId,
    showDefaultOption = false,
    defaultOptionLabel,
    defaultOptionDescription,
    formatDefaultModelLabel,
    updateGlobalStore = false,
    updateGlobalDefault = false,
    silentFallback = false,
    showReasoning = false,
    reasoningEffort,
    defaultReasoningEffort,
    onReasoningChange,
    reasoningDisabled = false,
  }: Props = $props();

  const workspaceIdStore = writable(untrack(() => workspaceId) ?? '');
  const defaultProviderId$ = selectContextDefaultProvider(workspaceIdStore);
  const directActiveProviderId$ = selectActiveProviderId();
  const activeProviderId$ = derived(
    [workspaceIdStore, defaultProviderId$, directActiveProviderId$],
    ([id, scoped, direct]) => (id ? scoped : direct),
  );
  const providerCatalogEntries$ = selectContextProviderEntries(workspaceIdStore);
  // Named profiles (§5.54) ride their base provider's availability: each
  // available base is followed by its profile references, which the picker
  // then treats as providers of their own (catalog fetch, group, tab).
  const providerProfiles$ = selectProviderCatalogProfiles(workspaceIdStore);
  const providerDefaultNames$ = selectProviderCatalogDefaultNames(workspaceIdStore);
  const baseModelFetchProviderIds$ = selectContextModelProviderIds(workspaceIdStore);
  const baseAvailableEnabledProviderIds$ = selectContextAvailableProviderIds(workspaceIdStore);
  // A signed-out profile stays selectable but is flagged (§5.54 status mapping:
  // `error` = signed out). Each listed profile is probed once, not forced.
  const profileSignInStatuses$ = selectProfileSignInStatuses();
  $effect(() => {
    const profiles = $providerProfiles$;
    if (profiles.length === 0 || isGuestLocked || !$canAdministerHost$) return;
    appStore.dispatch(
      providerProfileSummaryStatusesEnsured(
        profiles.map(({ id, providerRef }) => ({ id, providerRef })),
      ),
    );
  });
  const modelFetchProviderIds$ = derived(
    [baseModelFetchProviderIds$, providerProfiles$],
    ([ids, profiles]) => expandProviderIdsWithProfiles(ids, profiles),
  );
  const availableEnabledProviderIds$ = derived(
    [baseAvailableEnabledProviderIds$, providerProfiles$],
    ([ids, profiles]) => expandProviderIdsWithProfiles(ids, profiles),
  );
  const enabledProviders$ = selectContextEnabledProviders(workspaceIdStore);
  const selectedModel$ = selectContextSelectedModel(workspaceIdStore);
  const hasCheckedOnce$ = selectContextReadinessLoaded(workspaceIdStore);
  const allProviderWarnings$ = selectContextProviderWarnings(workspaceIdStore);
  const allProviderStaleFlags$ = selectContextProviderStaleFlags(workspaceIdStore);
  const allProviderWarningKinds$ = selectContextProviderWarningKinds(workspaceIdStore);
  const workspaceCatalogEpoch$ = selectWorkspaceCatalogEpoch();
  $effect(() => {
    // An open picker can outlive its workspace lifecycle subscription. Refresh
    // its own context when settings or the backend invalidate the registry.
    void $workspaceCatalogEpoch$;
    if (workspaceId) appStore.dispatch(ensureWorkspaceCatalogRequested(workspaceId));
  });

  const agentSession$ = useAgentSession(() => agentId);

  type ModelPick = { providerId: string; modelId: string };
  type ModelChange = {
    pick: ModelPick;
    previous: { model: string | null | undefined; providerId: string };
    agentId: string;
    workspaceId: string;
    revision: number;
    connection: string | null;
  };
  let pendingModelUpdate = $state<ModelChange | null>(null);
  const mutationConsumerId = crypto.randomUUID();
  const mutationPending$ = selectAgentModelMutationPending(mutationConsumerId);
  const mutations$ = selectAgentModelMutations(mutationConsumerId);
  let submittedModelChange = $state<{ requestId: string; change: ModelChange } | null>(null);
  const isApplyingModelUpdate = $derived($mutationPending$);
  let localPickedProviderId = $state<string | null>(null);
  let modelChangeRevision = 0;
  let confirmationRevision = 0;
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
    modelChangeRevision++;
    confirmationRevision++;
    pendingModelUpdate = null;
    if (submittedModelChange)
      appStore.dispatch(
        agentModelMutationConsumed(submittedModelChange.requestId, mutationConsumerId),
      );
  });

  // Provider from the prop or agent session, or null when neither determines
  // one (fetching then uses the active provider; the trigger icon prefers the
  // displayed model's provider).
  const explicitProviderId = $derived.by(() => {
    if (updateGlobalStore) {
      const selection = currentSessionSelection();
      if (selection) return selection.providerId;
    }
    if (providerId) return normalizeProviderId(providerId);
    if (agentId && workspaceId) {
      const session = $agentSession$;
      if (session) {
        const provider = getAgentProvider(session, $defaultProviderId$);
        if (provider) return normalizeProviderId(provider);
      }
    }
    return null;
  });

  const effectiveProviderId = $derived(explicitProviderId ?? $activeProviderId$);

  // A guest window (multiplayer w4) or a `collaborator` seat cannot change an
  // agent's model, and its local provider availability says nothing about the
  // host: the agent-bound picker renders read-only with the host catalog
  // label and no availability warnings (intent#5378). The selector fails
  // closed while the window's identity is still the boot-time default.
  const isWorkspaceCollaborator$ = selectHidesAgentCreationActions(workspaceIdStore);
  $effect(() => {
    workspaceIdStore.set(workspaceId ?? '');
  });
  const isGuestLocked = $derived(!!agentId && !!workspaceId && $isWorkspaceCollaborator$);
  const effectiveLocked = $derived(isLocked || isGuestLocked);

  // §5.54 profile state the daemon reports on this agent's AgentLite row.
  const boundSession = $derived(
    agentId && !isGuestLocked && $agentSession$?.id === agentId ? $agentSession$ : undefined,
  );
  const usingEarlierProfileSettings = $derived(boundSession?.usingEarlierProfileSettings === true);
  // Effort callbacks retain the compatibility lock funnel. Model intents below
  // carry the same live lease to the shared saga owner.
  const mutate = createAgentModelMutator({
    isLocked: () => effectiveLocked || destroyed,
    consumerId: mutationConsumerId,
  });

  import { store as appStore } from '$store/renderer/store';

  // The saga owns the catalog and request generations. Read-through cache rows
  // render synchronously on remount while the owner revalidates in the background.
  const providerCatalogs$ = selectProviderModelsCacheMap(workspaceIdStore);
  const learnedModelNames$ = selectLearnedModelNames();
  const providerRequests$ = selectProviderModelsRequests(workspaceIdStore);
  const catalogObserverId = crypto.randomUUID();
  const catalogProviderIds = $derived(
    $modelFetchProviderIds$.filter((id) => canUseProviderModels(id)).map(normalizeProviderId),
  );
  const allProviderModels = $derived.by(() => {
    const models: Record<string, DropdownOption[]> = {};
    for (const pid of catalogProviderIds) {
      const entry = $providerCatalogs$[pid];
      if (entry) models[pid] = toDropdownOptions(entry.models);
    }
    return models;
  });
  const allProviderErrors = $derived.by(() => {
    const errors: Record<string, ProviderLoadError> = {};
    for (const pid of catalogProviderIds) {
      const request = $providerRequests$[pid];
      if (request?.error) {
        errors[pid] = formatProviderLoadError(pid, request.error);
      }
    }
    return errors;
  });
  const allProviderLoading = $derived(
    Object.fromEntries(
      catalogProviderIds.map((pid) => [
        pid,
        ($providerRequests$[pid]?.status === 'loading' &&
          $providerRequests$[pid]?.mode !== 'silentRetry') ||
          (!$providerCatalogs$[pid] && !allProviderErrors[pid]),
      ]),
    ),
  );
  const allProvidersLoaded = $derived(
    Object.values(allProviderLoading).every((loading) => !loading),
  );

  function hasProviderResult(providerId: string): boolean {
    return (
      Object.prototype.hasOwnProperty.call(allProviderModels, providerId) ||
      Boolean(allProviderErrors[providerId])
    );
  }

  const isEffectiveProviderAvailable = $derived(
    isProviderEnabled($availableEnabledProviderIds$, effectiveProviderId),
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
  const isEffectiveProviderDisabled = $derived(
    !!agentId &&
      !isGuestLocked &&
      isProviderDisabledInSettings($enabledProviders$, effectiveProviderId),
  );

  // Providers whose models the picker may offer. The available+enabled set
  // always admits the default provider (`model.defaultProvider`) even when it
  // was disabled in settings, so its catalog keeps loading for the fetch and
  // warning paths — but the daemon refuses every turn on a disabled provider
  // and a disabled default has no re-home target, so its rows must not be
  // selectable (intent#5737). Same settings blind spot as above for guests.
  const selectableProviderIds = $derived(
    $availableEnabledProviderIds$.filter(
      (pid) =>
        (allowProviderSwitch || normalizeProviderId(pid) === effectiveProviderId) &&
        (isGuestLocked || !isProviderDisabledInSettings($enabledProviders$, pid)),
    ),
  );

  // The per-agent fetch is only needed when the effective provider's models
  // aren't already covered by the all-providers fetch because the agent's
  // provider is since unavailable. Skipping it otherwise avoids a duplicate fetch.
  // A guest-locked picker always runs it: the all-providers fetch follows the
  // guest's local availability, so this is its only route to the host catalog.
  const usesAgentProviderFetch = $derived(
    canUseProviderModels(effectiveProviderId) &&
      (isGuestLocked ||
        (workspaceId
          ? !$modelFetchProviderIds$.includes(effectiveProviderId)
          : effectiveProviderId !== $activeProviderId$ && !isEffectiveProviderAvailable)),
  );

  const agentProviderModels = $derived(
    usesAgentProviderFetch ? ($providerCatalogs$[effectiveProviderId]?.models ?? null) : null,
  );
  const agentProviderError = $derived.by(() => {
    const request = $providerRequests$[effectiveProviderId];
    return usesAgentProviderFetch && request?.error
      ? formatProviderLoadError(effectiveProviderId, request.error).displayText
      : null;
  });
  const agentProviderLoading = $derived(
    usesAgentProviderFetch && !agentProviderModels && !agentProviderError,
  );
  const observedProviderIds = $derived([
    ...new Set([...catalogProviderIds, ...(usesAgentProviderFetch ? [effectiveProviderId] : [])]),
  ]);

  // Prop/selector binding only: the registered owner handles debounce,
  // replacement, reconnect invalidation and cancellation for this observer.
  $effect(() => {
    appStore.dispatch(providerModelsObserved(catalogObserverId, observedProviderIds, workspaceId));
  });
  onDestroy(() => appStore.dispatch(providerModelsReleased(catalogObserverId)));

  // Models for the effective provider: the per-agent fetch result when the
  // agent's provider differs from the active one, the global store otherwise.
  const availableModels = $derived(
    !canUseProviderModels(
      workspaceId || agentProviderModels ? effectiveProviderId : $availableModelsProviderId$,
      true,
    ) || agentProviderLoading
      ? []
      : (agentProviderModels ??
          (agentProviderError
            ? []
            : workspaceId
              ? (allProviderModels[effectiveProviderId] ?? []).map(({ data, ...option }) => ({
                  ...data,
                  ...option,
                }))
              : $availableModels$)),
  );
  // Which provider `availableModels` was loaded for: the per-agent fetch is
  // for the effective provider by construction; the global catalog carries
  // explicit provenance ('' before the first load).
  const availableModelsProviderId = $derived(
    workspaceId || (!agentProviderLoading && agentProviderModels)
      ? effectiveProviderId
      : $availableModelsProviderId$,
  );
  const isLoadingModels = $derived(
    canUseProviderModels(effectiveProviderId) &&
      (agentProviderLoading ||
        (!hasProviderResult(effectiveProviderId) &&
          ($isLoadingModels$ || allProviderLoading[effectiveProviderId] || !allProvidersLoaded))),
  );
  const loadError = $derived(workspaceId ? agentProviderError : $loadError$);

  // Provider display name for footer — reflects the effective provider, not the global one

  // Track which provider groups are collapsed in the dropdown (persisted through Redux sagas)
  const collapsedGroups = $derived(new Set($collapsedGroupKeys$));

  function toggleGroup(key: string) {
    appStore.dispatch(setModelPickerGroupCollapsed(key, !collapsedGroups.has(key)));
  }

  const refreshingProviders = $derived(
    new Set(
      Object.values($providerRequests$)
        .filter((request) => request.status === 'loading' && request.mode === 'refresh')
        .map((request) => request.providerId),
    ),
  );

  function handleRefreshProvider(providerId: string) {
    if (!canUseProviderModels(providerId)) return;
    if (refreshingProviders.has(providerId)) return;
    appStore.dispatch(providerModelsRequested(providerId, 'refresh', workspaceId));
  }

  function handleRetry() {
    for (const providerId of observedProviderIds) {
      appStore.dispatch(providerModelsRequested(providerId, 'retry', workspaceId));
    }
  }

  const USE_DEFAULT_VALUE = '__use_default__';

  // Settings/spawn callers own their draft. Agent callers only use it while
  // their optimistic/deferred request is live; accepted selections render
  // directly from Redux, even if a parent's prop has not caught up yet.
  let draftModel = $state<string | null | undefined>(
    untrack(() => (updateGlobalDefault ? undefined : selectedModel)),
  );
  const localModel = $derived.by(() => {
    // The global default owner already publishes its accepted/rolled-back
    // selection through Redux. Never keep a competing draft for Settings.
    if (updateGlobalDefault) return $selectedModel$;
    const change = pendingModelUpdate ?? submittedModelChange?.change;
    if (change && isCurrentModelChange(change)) return draftModel;
    const selection = updateGlobalStore ? currentSessionSelection() : undefined;
    return selection ? selection.model : draftModel;
  });
  let userChangedModel = $state(false);
  let propModelAtLocalChange = $state<string | null | undefined>(undefined);

  // Keep a draft selection until its owning parent catches up.
  $effect(() => {
    if (updateGlobalDefault) return;
    if (selectedModel === draftModel) {
      userChangedModel = false;
      propModelAtLocalChange = undefined;
      return;
    }

    if (
      userChangedModel &&
      (selectedModel === undefined || selectedModel === propModelAtLocalChange)
    ) {
      return;
    }

    draftModel = selectedModel;
    localPickedProviderId = null;
    pendingModelUpdate = null;
    modelChangeRevision++;
    confirmationRevision++;
    userChangedModel = false;
    propModelAtLocalChange = undefined;
  });

  function currentSessionSelection(): ModelChange['previous'] | undefined {
    const session = $agentSession$;
    if (!agentId || !workspaceId || session?.id !== agentId || session.workspaceId !== workspaceId)
      return undefined;
    const provider = getAgentProvider(session, $defaultProviderId$);
    if (!provider) return undefined;
    // An omitted model on a present session is authoritative Auto, not missing data.
    return { model: session.model, providerId: normalizeProviderId(provider) };
  }

  // The parent mirrors optimistic picks, so only the session can acknowledge
  // an agent selection. Once acknowledged, follow later provider-only updates.
  $effect(() => {
    if (!localPickedProviderId || pendingModelUpdate) return;
    const selection = currentSessionSelection();
    if (
      selection?.providerId === localPickedProviderId &&
      (selection.model === localModel ||
        (selection.model &&
          localModel &&
          splitLegacyCompoundId(selection.model).modelId ===
            splitLegacyCompoundId(localModel).modelId))
    ) {
      localPickedProviderId = null;
    }
  });

  // A live owner → collaborator role change must not let a deferred update
  // queued during streaming reach the backend once streaming ends.
  $effect(() => {
    if (effectiveLocked && pendingModelUpdate) {
      restoreLocalSelection(pendingModelUpdate);
      pendingModelUpdate = null;
      modelChangeRevision++;
    }
  });

  $effect(() => {
    if (!deferUpdate && !isApplyingModelUpdate && pendingModelUpdate) {
      const change = pendingModelUpdate;
      pendingModelUpdate = null;
      void applyBackendModelUpdate(change);
    }
  });

  // Keep the selected row's provider through confirmation and asynchronous work.
  // Persisted compound IDs still carry an explicit provider at the input boundary.
  function resolvePickedTriple(model: string, rowProviderId?: string): ModelPick {
    const { providerId: legacyProviderId, modelId } = splitLegacyCompoundId(model);
    return {
      providerId: normalizeProviderId(legacyProviderId || rowProviderId || effectiveProviderId),
      modelId,
    };
  }

  function isCurrentModelChange(change: ModelChange): boolean {
    return (
      !destroyed &&
      change.revision === modelChangeRevision &&
      change.agentId === agentId &&
      change.workspaceId === workspaceId &&
      change.connection === selectPrincipalConnectionContext.select(appStore.state)
    );
  }

  function restoreLocalSelection(change: ModelChange) {
    if (!isCurrentModelChange(change)) return;
    // A rejected request must not restore an old snapshot over a newer
    // authoritative selection received while the request was in flight.
    const selection = currentSessionSelection() ?? change.previous;
    draftModel = selection.model;
    localPickedProviderId = selection.providerId;
    propModelAtLocalChange = selectedModel;
    userChangedModel = true;
    dropdownValue = currentDropdownValue();
    onModelChange?.(
      localModel ?? '',
      localModel
        ? {
            providerId: selection.providerId,
            modelId: splitLegacyCompoundId(localModel).modelId,
          }
        : undefined,
    );
  }

  function applyBackendModelUpdate(change: ModelChange) {
    if (!isCurrentModelChange(change) || isApplyingModelUpdate) return;
    if (!hasResolvedProvider(change.pick.providerId)) {
      restoreLocalSelection(change);
      return;
    }
    const requestId = crypto.randomUUID();
    submittedModelChange = { requestId, change };
    const canWrite = () =>
      isCurrentModelChange(change) &&
      !effectiveLocked &&
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

  $effect(() => {
    const submitted = submittedModelChange;
    if (!submitted) return;
    const outcome = $mutations$.find((entry) => entry.requestId === submitted.requestId);
    if (!outcome || outcome.status === 'pending') return;
    untrack(() => {
      submittedModelChange = null;
      appStore.dispatch(agentModelMutationConsumed(outcome.requestId, mutationConsumerId));
      if (!isCurrentModelChange(submitted.change)) return;
      if (
        outcome.status === 'cancelled' ||
        (outcome.status === 'failure' && !outcome.modelAccepted)
      ) {
        restoreLocalSelection(submitted.change);
        if (outcome.status === 'failure' && outcome.error && !effectiveLocked)
          notify.error(outcome.error, { duration: 6000 });
      }
    });
  });

  async function handleModelSelect(model: string | undefined, picked?: ModelPick) {
    if (effectiveLocked || destroyed || isApplyingModelUpdate) {
      dropdownValue = currentDropdownValue();
      return;
    }
    const pick = model === undefined ? undefined : (picked ?? resolvePickedTriple(model));
    if (pick && (!hasResolvedProvider(pick.providerId) || !canUseProviderModels(pick.providerId))) {
      dropdownValue = currentDropdownValue();
      return;
    }
    // A rejected global provider switch must not become an optimistic local
    // selection or invoke the caller's model/effort reconciliation callback.
    if (
      updateGlobalDefault &&
      pick &&
      isQuickActionProviderSwitchBlocked(appStore.state.backgroundAgentSettings, pick.providerId)
    ) {
      dropdownValue = currentDropdownValue();
      appStore.dispatch(backgroundProviderSwitchBlocked(pick.providerId));
      return;
    }
    if (updateGlobalDefault) {
      if (!$canAdministerHost$) return;
      // Defaults have one Redux-rendered selection. Dispatch before returning
      // from the click; never stage a component draft or an agent request.
      onModelChange?.(model ?? '', pick);
      if (pick && !effectiveLocked && !destroyed && $canAdministerHost$)
        appStore.dispatch(selectModel(pick.modelId, pick.providerId));
      return;
    }
    const previous = pendingModelUpdate?.previous ?? {
      model: localModel,
      providerId: selectedModelProviderId || effectiveProviderId,
    };
    const revision = ++modelChangeRevision;
    if (isEffectiveProviderDisabled || disabledProviderSnapshot) {
      disabledProviderSnapshot = null;
      reHomeAnnouncementSuppressed = true;
    }
    propModelAtLocalChange = selectedModel;
    userChangedModel = true;
    draftModel = model;
    localPickedProviderId = pick?.providerId ?? null;

    if (!pick || model === undefined) {
      pendingModelUpdate = null;
      onModelChange?.('');
      return;
    }
    onModelChange?.(model, pick);
    if (effectiveLocked || destroyed) return;
    if (!updateGlobalStore || !agentId || !workspaceId) return;
    const change: ModelChange = {
      pick,
      previous,
      agentId,
      workspaceId,
      revision,
      connection: selectPrincipalConnectionContext.select(appStore.state),
    };
    if (deferUpdate) pendingModelUpdate = change;
    else await applyBackendModelUpdate(change);
  }

  // Whether a model is explicitly selected (vs using default)
  // Also treat the literal string "undefined" as no selection (can happen from bad String(undefined) conversion)
  // Only the bare "default" string is the "use default" sentinel (delegation-chain guard);
  // provider-prefixed ids like "claude-code:default" are explicit catalog selections.
  const hasExplicitModel = $derived(
    localModel !== undefined &&
      localModel !== null &&
      localModel !== USE_DEFAULT_VALUE &&
      localModel !== 'undefined' &&
      localModel !== 'default',
  );

  // Settings owns the default provider even when a bare model contains a colon.
  // Other display callers may still carry a recognized legacy provider prefix.
  // This identity is for labels/icons only; catalog/session gates stay authoritative.
  const selectedModelDisplayProviderId = $derived.by(() => {
    if (updateGlobalDefault) return normalizeProviderId(effectiveProviderId);
    if (localPickedProviderId) return normalizeProviderId(localPickedProviderId);
    if (explicitProviderId) return explicitProviderId;
    const prefix = localModel ? splitLegacyCompoundId(localModel).providerId : undefined;
    return normalizeProviderId(
      prefix && hasResolvedProvider(prefix) ? prefix : effectiveProviderId,
    );
  });

  // Live labels retain precedence; remembered names affect display only.
  function getModelLabel(
    modelId: string | undefined,
    provider = selectedModelDisplayProviderId,
  ): string | undefined {
    if (!modelId) return undefined;
    provider = normalizeProviderId(provider);
    const bareId = modelIdForDisplay(modelId, provider, normalizeProviderId);
    const lookup = (id: string): string | undefined => {
      const target = modelIdForDisplay(id, provider, normalizeProviderId);
      const find = (models: { value: string; label: string }[], catalogProvider: string) => {
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
      for (const [rowProvider, models] of Object.entries(allProviderModels)) {
        const label = find(models, rowProvider);
        if (label) return label;
      }
      return find(availableModels, availableModelsProviderId);
    };
    // Subscribe to the shared Redux names, including discoveries made by another picker.
    void $learnedModelNames$;
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
    const fromAll = allProviderModels[normalizedId]?.find((opt) => Boolean(opt.data?.isDefault));
    if (fromAll) return fromAll;
    if (
      availableModelsProviderId !== '' &&
      normalizeProviderId(availableModelsProviderId) === normalizedId
    ) {
      const row = availableModels.find((model) => 'isDefault' in model && model.isDefault);
      if (row) return toDropdownOptions([row])[0];
    }
    return undefined;
  }

  // Opt-in display fallback (fallbackToCatalogDefault): no explicit selection
  // and no daemon-resolved preview (defaultModelId) — show the isDefault row
  // of the provider the consumer creates with (fallbackProviderId, else the
  // effective provider) while the preview is absent (daemon catalog cache
  // cold / preview fetch not landed) instead of the generic defaultModelLabel.
  const catalogDefaultFallbackOption = $derived.by(() =>
    fallbackToCatalogDefault && !defaultModelId
      ? findCatalogDefaultOption(fallbackProviderId ?? effectiveProviderId)
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
    const fromAll = allProviderModels[normalizedId];
    if (fromAll && fromAll.length > 0) return firstCurrentRow(fromAll);
    if (
      availableModelsProviderId !== '' &&
      normalizeProviderId(availableModelsProviderId) === normalizedId &&
      availableModels.length > 0
    ) {
      return firstCurrentRow(toDropdownOptions(availableModels));
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
  const legacyDefaultMappedOption = $derived.by(() =>
    hasExplicitModel && localModel ? mapDefaultPseudoSelection(localModel) : undefined,
  );

  // D2 mapping for a daemon-resolved `<provider>:default` preview
  // (defaultModelId from an older daemon) — same exposure as the explicit
  // selection: an exact-id match would resolve to the hidden pseudo-row.
  const defaultModelIdMappedOption = $derived.by(() =>
    defaultModelId ? mapDefaultPseudoSelection(defaultModelId) : undefined,
  );

  const defaultModelDisplayProviderId = $derived.by(() => {
    const owner = explicitProviderId || fallbackProviderId;
    if (owner) return normalizeProviderId(owner);
    const prefix = defaultModelId ? splitLegacyCompoundId(defaultModelId).providerId : undefined;
    return normalizeProviderId(
      prefix && hasResolvedProvider(prefix) ? prefix : $defaultProviderId$,
    );
  });

  function formatResolvedDefaultLabel(model: string): string {
    if (formatDefaultModelLabel) return formatDefaultModelLabel(model);
    return showDefaultOption ? m.chat_modelPicker_defaultModelPreview_label({ model }) : model;
  }

  const currentModelLabel = $derived.by(() => {
    if (hasExplicitModel) {
      return localModel
        ? (legacyDefaultMappedOption?.label ??
            getModelLabel(localModel) ??
            modelIdForDisplay(localModel, selectedModelDisplayProviderId, normalizeProviderId))
        : (defaultModelLabel ?? m.chat_modelPicker_defaultModel_label());
    }

    // Unresolvable defaultModelId (models not loaded yet): prefer the caller's
    // defaultModelLabel (e.g. "Provider default"), then the bare model id. A
    // `<provider>:default` preview maps to its D2 row's label first.
    if (defaultModelId) {
      const provider = defaultModelDisplayProviderId;
      const resolvedLabel =
        defaultModelIdMappedOption?.label ?? getModelLabel(defaultModelId, provider);
      if (resolvedLabel) return formatResolvedDefaultLabel(resolvedLabel);
      return defaultModelLabel ?? modelIdForDisplay(defaultModelId, provider, normalizeProviderId);
    }
    if (catalogDefaultFallbackOption) {
      return formatResolvedDefaultLabel(catalogDefaultFallbackOption.label);
    }
    return defaultModelLabel ?? m.chat_modelPicker_defaultModel_label();
  });

  const triggerProviderId = $derived.by(() => {
    if (localModel && hasExplicitModel) {
      // Provider identity belongs to the selection, including colliding bare IDs.
      return selectedModelDisplayProviderId;
    }
    if (explicitProviderId) return explicitProviderId;
    // No explicit provider or model — show the displayed default model's provider.
    if (defaultModelId) return defaultModelDisplayProviderId;
    if (catalogDefaultFallbackOption) {
      return parseCompoundModelId(catalogDefaultFallbackOption.value).providerId;
    }
    return $activeProviderId$;
  });

  const isTriggerLabelResolved = $derived.by(() => {
    if (!hasExplicitModel || !localModel) return true; // "Default model" text, no need for skeleton
    // A `<provider>:default` selection mapped to its D2 row renders that
    // row's label — resolved even while other providers are still loading.
    if (legacyDefaultMappedOption) return true;
    if (getModelLabel(localModel)) return true;
    // The disabled-provider warning derives from settings alone and must not
    // wait behind the disabled provider's catalog, which may never load.
    if (isSelectedModelProviderDisabled) return true;
    if (!isLoadingModels && allProvidersLoaded) return true;
    if (selectedCatalogOption) return true;
    for (const models of Object.values(allProviderModels)) {
      if (models.some((m) => m.value === localModel)) return true;
    }
    return availableModels.some((m) => m.value === localModel);
  });

  const shouldShowLockIconWhenLocked = $derived(isCompact || showLockIconWhenLocked);

  const buttonSize = $derived(isCompact ? 'icon' : size);
  const buttonClass = $derived(
    cn(
      isCompact
        ? 'h-8 w-8 p-0 flex items-center justify-center'
        : size === 'xs'
          ? ''
          : 'h-8 min-w-[140px] justify-between',
      'text-muted-foreground hover:text-foreground transition-colors',
    ),
  );

  const useDefaultOption: DropdownOption = {
    value: USE_DEFAULT_VALUE,
    get label() {
      return defaultOptionLabel ?? m.chat_modelPicker_defaultModel_label();
    },
    get description() {
      return defaultOptionDescription ?? m.chat_modelPicker_defaultModel_description();
    },
  };

  // Same provenance gate as the grouped fallback: only offer the shared
  // catalog for a disabled effective provider when it was loaded for it.
  const fallbackModelsMatchEffectiveProvider = $derived(
    availableModelsProviderId !== '' &&
      normalizeProviderId(availableModelsProviderId) === normalizeProviderId(effectiveProviderId),
  );

  const flatModelOptions = $derived<DropdownOption[]>([
    ...(showDefaultOption ? [useDefaultOption] : []),
    ...selectableProviderIds.flatMap((pid) => allProviderModels[normalizeProviderId(pid)] ?? []),
    // Keep the agent's current provider selectable while it is merely
    // unavailable, so the selected model isn't treated as unavailable — but
    // not once it was disabled in settings (see isEffectiveProviderDisabled).
    ...(isEffectiveProviderAvailable ||
    isEffectiveProviderDisabled ||
    !fallbackModelsMatchEffectiveProvider
      ? []
      : toDropdownOptions(availableModels)),
  ]);

  function findCatalogOption(
    modelId: string,
    bareProviderId = selectedModelProviderId || effectiveProviderId,
  ): DropdownOption | undefined {
    const lookup = (id: string) => {
      const target = normalizeModelIdForMatch(splitLegacyCompoundId(id).modelId, bareProviderId);
      for (const providerId of selectableProviderIds) {
        const rowProviderId = normalizeProviderId(providerId);
        const found = allProviderModels[rowProviderId]?.find(
          (option) => normalizeModelIdForMatch(option.value, rowProviderId) === target,
        );
        if (found) return found;
      }
      if (
        !isEffectiveProviderAvailable &&
        !isEffectiveProviderDisabled &&
        fallbackModelsMatchEffectiveProvider
      ) {
        return toDropdownOptions(availableModels).find(
          (option) => normalizeModelIdForMatch(option.value, availableModelsProviderId) === target,
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

  const selectedCatalogOption = $derived.by(() => {
    const selectedId = hasExplicitModel ? localModel : defaultModelId;
    if (!selectedId) return catalogDefaultFallbackOption;
    // The mapped row wins for `<provider>:default` — an exact-id match would
    // resolve to the hidden pseudo-row when an older daemon still serves one.
    const mappedOption = hasExplicitModel ? legacyDefaultMappedOption : defaultModelIdMappedOption;
    if (mappedOption) return mappedOption;
    return findCatalogOption(
      selectedId,
      hasExplicitModel
        ? selectedModelProviderId
        : normalizeProviderId(
            splitLegacyCompoundId(selectedId).providerId ||
              fallbackProviderId ||
              effectiveProviderId,
          ),
    );
  });

  const hasLoadedModelOptions = $derived(
    flatModelOptions.some((option) => option.value !== USE_DEFAULT_VALUE && !option.disabled),
  );

  const providerLoadWarnings = $derived.by<ProviderLoadError[]>(() => {
    return $availableEnabledProviderIds$
      .map((pid) => allProviderErrors[normalizeProviderId(pid)])
      .filter((error): error is ProviderLoadError => Boolean(error));
  });

  // Read the workspace-scoped catalog, including degraded successful responses.
  const activeProviderIssue = $derived.by<ProviderLoadError | null>(() => {
    const providerId = activeBrowseProviderId || preferredBrowseProviderId;
    const error = $providerRequests$[providerId]?.error;
    if (error) return formatProviderLoadError(providerId, error);
    const warning = $providerCatalogs$[providerId]?.warning;
    if (warning) return formatProviderLoadError(providerId, warning);
    if (loadError && providerId === effectiveProviderId)
      return formatProviderLoadError(providerId, loadError);
    return null;
  });
  const nonBlockingProviderWarnings = $derived(
    activeProviderIssue && (allProviderModels[activeProviderIssue.providerId]?.length ?? 0) > 0
      ? [activeProviderIssue]
      : [],
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
  const hasNoAvailableProvider = $derived(
    !providerId &&
      !isGuestLocked &&
      $hasCheckedOnce$ &&
      $daemonHealth$ === 'healthy' &&
      $availableEnabledProviderIds$.length === 0,
  );

  // Per-instance call-frequency guard only; the stable toast id below is the
  // authoritative dedupe — every mounted ModelPicker (and every re-fire of the
  // condition) updates the same single toast instead of stacking a new one.
  let noProviderToastShown = false;

  function openProviderSettings() {
    if (!$canAdministerHost$) return;
    dropdownOpen = false;
    void navigateToSettings({ tab: 'accounts', hash: 'providers' }).catch((error: unknown) => {
      logger.error('Failed to open provider settings from model picker', error);
    });
  }

  $effect(() => {
    if (hasNoAvailableProvider) {
      if (!noProviderToastShown) {
        noProviderToastShown = true;
        notify.error(
          !$canAdministerHost$
            ? m.hostExecution_providerSetup_description()
            : m.chat_modelPicker_noProviderAvailable_toast(),
          {
            id: 'no-provider-available',
            duration: 6000,
            action: !$canAdministerHost$
              ? undefined
              : {
                  label: m.chat_modelPicker_noProviderAvailable_openSettings_label(),
                  onClick: openProviderSettings,
                },
          },
        );
      }
    } else {
      noProviderToastShown = false;
    }
  });

  const blockingLoadError = $derived.by<ProviderLoadError | null>(() => {
    if (loadError) {
      return formatProviderLoadError(effectiveProviderId, loadError);
    }

    if (hasLoadedModelOptions || providerLoadWarnings.length === 0) {
      return null;
    }

    if (providerLoadWarnings.length === 1) {
      return providerLoadWarnings[0];
    }

    return {
      providerId: 'multiple',
      providerName: m.chat_modelPicker_modelProviders_label(),
      details: providerLoadWarnings.map((error) => error.details).join('\n\n'),
      message: providerLoadWarnings.map((error) => error.displayText).join('; '),
      displayText: providerLoadWarnings.map((error) => error.displayText).join('; '),
    };
  });

  const groupedModelOptions = $derived.by(() => {
    void $providerCatalogEntries$;
    // Group labels read the renamed Default (catalog `defaultNames`).
    void $providerDefaultNames$;
    return buildGroupedModelOptions({
      workspaceId,
      showDefaultOption,
      useDefaultOption,
      effectiveProviderId,
      availableModels,
      availableModelsProviderId,
      enabledProviderIds: selectableProviderIds,
      effectiveProviderDisabled: isEffectiveProviderDisabled,
      allProviderModels,
      allProviderLoading,
      allProviderErrors,
      allProviderWarnings: $allProviderWarnings$,
      profiles: $providerProfiles$,
    }).filter(
      (group) => group.key === 'default' || canUseProviderModels(group.parentKey ?? group.key),
    );
  });
  let legacyModelsExpanded = $state(false);
  let modelSearchValue = $state('');
  const onlyLegacyAuggieModels = $derived(
    groupedModelOptions.some((group) => group.key === AUGGIE_LEGACY_GROUP_KEY) &&
      !groupedModelOptions.some((group) => group.key === 'auggie'),
  );
  const legacyToggleDisabled = $derived(
    modelSearchValue.trim().length > 0 || onlyLegacyAuggieModels,
  );
  const legacyModelsVisible = $derived(legacyModelsExpanded || legacyToggleDisabled);

  // The value bound to the dropdown (convert undefined to USE_DEFAULT_VALUE).
  // Bound state rather than derived so a rejected confirmModelChange can
  // revert the dropdown's internal selection back to the current model.
  // A legacy `<provider>:default` selection has no catalog row of its own,
  // so the mapped isDefault row shows as selected instead.
  let dropdownValue = $state(untrack(() => localModel ?? USE_DEFAULT_VALUE));
  function currentDropdownValue() {
    if (
      hasExplicitModel &&
      activeBrowseProviderId &&
      selectedModelProviderId &&
      activeBrowseProviderId !== selectedModelProviderId
    )
      return '';
    return (
      (hasExplicitModel ? selectedCatalogOption?.value : undefined) ??
      localModel ??
      USE_DEFAULT_VALUE
    );
  }
  $effect(() => {
    // A fast rejection can restore the same authoritative value within one
    // render turn. Also observe the dropdown's attempted write so its row
    // selection cannot outlive that rejected attempt.
    const value = currentDropdownValue();
    if (dropdownValue !== value) dropdownValue = value;
  });

  // Keep an explicit local choice until the daemon/parent has caught up.
  // Existing bare session IDs belong to that session's provider, even when
  // another provider advertises the same model ID.
  const selectedModelProviderId = $derived(
    hasExplicitModel && localModel
      ? ((updateGlobalDefault ? null : localPickedProviderId) ??
          normalizeProviderId(
            explicitProviderId ||
              splitLegacyCompoundId(localModel).providerId ||
              effectiveProviderId,
          ))
      : '',
  );

  // Provider the daemon resolves the selected model against on send: a legacy
  // compound prefix, else the agent's own provider. Catalog ownership is not
  // authoritative here — a bare id shared by several catalogs would be
  // attributed to the default provider while the agent still runs elsewhere.
  const selectedModelGateProviderId = $derived.by(() => {
    const legacyProviderId =
      hasExplicitModel && localModel ? splitLegacyCompoundId(localModel).providerId : '';
    return (
      (updateGlobalDefault ? null : localPickedProviderId) ??
      normalizeProviderId(explicitProviderId || legacyProviderId || effectiveProviderId)
    );
  });

  // The next turn needs an explicit replacement (§5.54): the daemon flags it,
  // or the catalog shows the selected profile was removed. A new pick
  // supersedes the flagged reference. Never resolved by switching accounts.
  const replacementRequired = $derived.by(() => {
    if (!boundSession) return null;
    const flagged = boundSession.providerReplacementRequired;
    if (
      flagged &&
      boundSession.provider === flagged.providerRef &&
      (!localPickedProviderId || localPickedProviderId === flagged.providerRef)
    )
      return flagged;
    const gate = selectedModelGateProviderId;
    if (
      isProviderProfileRef(gate) &&
      $providerCatalogEntries$.length > 0 &&
      !findProfileByRef($providerProfiles$, gate)
    )
      return { providerRef: gate, reason: 'profile-missing' as const };
    return null;
  });

  // The provider the selected model is sent through was disabled in settings —
  // the pre-send warning state.
  const isSelectedModelProviderDisabled = $derived(
    !!agentId &&
      !isGuestLocked &&
      isProviderDisabledInSettings($enabledProviders$, selectedModelGateProviderId),
  );

  const providerTabIds = $derived.by(() => [
    ...new Set([
      ...selectableProviderIds.map((id) => normalizeProviderId(id)),
      ...groupedModelOptions
        .filter((group) => group.key !== 'default')
        .map((group) => group.parentKey ?? group.key),
    ]),
  ]);
  const preferredBrowseProviderId = $derived(
    providerTabIds.includes(selectedModelProviderId)
      ? selectedModelProviderId
      : providerTabIds.includes(normalizeProviderId(effectiveProviderId))
        ? normalizeProviderId(effectiveProviderId)
        : (providerTabIds[0] ?? ''),
  );
  let activeBrowseProviderId = $state('');
  let providerBrowseChanged = $state(false);
  const providerTabsEnabled = $derived(activeBrowseProviderId !== '');

  $effect(() => {
    if (
      !providerTabIds.includes(activeBrowseProviderId) ||
      (dropdownOpen && !providerBrowseChanged)
    ) {
      activeBrowseProviderId = preferredBrowseProviderId;
    }
  });

  $effect(() => {
    if (dropdownOpen) {
      activeBrowseProviderId = untrack(() => preferredBrowseProviderId);
    } else {
      providerBrowseChanged = false;
    }
  });

  // The "install Codex CLI" notice lives inside the open picker and only on
  // the Codex tab being browsed: it concerns Codex's list alone, so it must not
  // repeat under every closed picker or on other providers' tabs.
  // A stale warning (PROTOCOL §5.30 `stale: true`) accompanies the daemon's
  // last-known-good list after a transient probe failure: the models on screen
  // are real and usable, so the notice would be wrong there.
  // The notice shows only when the daemon labels the warning `warningKind:
  // "cli-missing"` (§5.30); every other degraded warning — an adapter crash,
  // a timeout, missing Node.js — keeps the generic failure row with Details
  // and Retry, never an install prompt keyed on the warning text.
  // Named Codex profiles (§5.54) have their own catalogs and get the same rule.
  function hasCatalogModels(providerId: string): boolean {
    return (
      (allProviderModels[providerId]?.length ?? 0) > 0 ||
      (normalizeProviderId(effectiveProviderId) === providerId &&
        (agentProviderModels?.length ?? 0) > 0)
    );
  }
  // Same browsed provider as `activeProviderIssue` (falls back to the
  // preferred tab before the first browse), limited to enabled providers.
  const codexFallbackWarning = $derived.by<ProviderWarningNotice | null>(() => {
    const providerId = normalizeProviderId(activeBrowseProviderId || preferredBrowseProviderId);
    if (!providerId || providerRefBaseId(providerId) !== 'codex') return null;
    if (!$availableEnabledProviderIds$.some((id) => normalizeProviderId(id) === providerId))
      return null;
    if ($allProviderStaleFlags$[providerId] && hasCatalogModels(providerId)) return null;
    if ($allProviderWarningKinds$[providerId] !== 'cli-missing') return null;
    return createProviderWarningNotice(providerId, $allProviderWarnings$[providerId]);
  });
  // The notice restates the catalog's fallback warning, so drop the generic
  // row for it; a request error on the same provider still gets its own row.
  const footerProviderWarnings = $derived(
    codexFallbackWarning &&
      !$providerRequests$[activeBrowseProviderId || preferredBrowseProviderId]?.error
      ? []
      : nonBlockingProviderWarnings,
  );

  // Display groups — every picker browses one provider at a time.
  const displayGroups = $derived.by(() => {
    // Once every catalog attempt settles without usable models, use the
    // existing terminal error/Retry surface rather than disabled error rows.
    // Pending retries and partial/cached success keep their groups/default row.
    if (
      !hasLoadedModelOptions &&
      blockingLoadError &&
      allProvidersLoaded &&
      !agentProviderLoading &&
      observedProviderIds.every(
        (pid) =>
          $providerRequests$[pid]?.status !== 'loading' &&
          ($providerCatalogs$[pid]?.models.length ?? 0) === 0,
      )
    )
      return [];
    return groupedModelOptions
      .filter((group) => {
        const providerKey = group.parentKey ?? group.key;
        return (
          !providerTabsEnabled || group.key === 'default' || providerKey === activeBrowseProviderId
        );
      })
      .map((group) => ({
        ...group,
        options:
          group.key === AUGGIE_LEGACY_GROUP_KEY
            ? legacyModelsVisible
              ? group.options
              : []
            : providerTabsEnabled || !collapsedGroups.has(group.key)
              ? group.options
              : [],
      }));
  });

  // True while a settled fetch result for the selected model's own provider is
  // still outstanding but expected. `allProvidersLoaded` is not enough: on boot
  // the availability list is empty, so fetchAllProviderModels([]) marks
  // "loaded" with an empty catalog and the model looks unavailable before its
  // provider was ever queried.
  const isSelectedModelProviderPending = $derived.by(() => {
    const modelProvider = selectedModelProviderId;
    if (!modelProvider) return false;
    if (!canUseProviderModels(modelProvider)) return false;
    if (hasProviderResult(modelProvider)) return false;
    if (allProviderLoading[modelProvider]) return true;
    // Availability hasn't been probed yet — an empty enabled list is "unknown".
    if (!$hasCheckedOnce$) return true;
    if (isProviderEnabled($availableEnabledProviderIds$, modelProvider)) return true;
    // Not enabled: the per-agent fetch is the only source of a result.
    if (usesAgentProviderFetch && normalizeProviderId(effectiveProviderId) === modelProvider) {
      return agentProviderLoading || (agentProviderModels === null && agentProviderError === null);
    }
    return false;
  });

  const isSelectedModelMissingFromCatalog = $derived.by(() => {
    if (!hasExplicitModel) return false;
    if (!localModel) return false;
    // Legacy `<provider>:default` mapped to the provider's isDefault row —
    // not missing, it renders as that model.
    if (legacyDefaultMappedOption) return false;

    return !selectedCatalogOption;
  });

  // Follow the daemon's re-home (intent#5737): while the agent's provider is
  // disabled the warning derives from settings alone; when the session then
  // lands on another provider (the daemon moves it on the next send and the
  // agent-updated event refreshes `explicitProviderId`), announce the switch
  // once with the existing fallback toast and keep the from/to note in the
  // picker. The FE never performs the switch itself. A user pick in the
  // meantime, or the provider being re-enabled, cancels the announcement.
  let disabledProviderSnapshot = $state<{
    agentId: string;
    providerId: string;
    fromModel: string;
  } | null>(null);
  // Set by an explicit pick while the provider is disabled: the user chose
  // the switch, so the daemon's re-home must not be announced as its own.
  let reHomeAnnouncementSuppressed = $state(false);

  // The agent-updated event that re-homes the agent refreshes the session's
  // provider and model together, but the `selectedModel` prop can land in a
  // later flush. Until the prop matches the session model the old model is
  // stale, so neither the announcement nor the auto-fallback may act on it.
  // A re-home onto the provider default lands with no `model` on the AgentLite
  // row (§5.5 omits it), so an absent model on a present session means "no
  // pinned model", and the prop must catch up to that too.
  const isAwaitingReHomedModel = $derived.by(() => {
    const snapshot = disabledProviderSnapshot;
    if (!snapshot || snapshot.agentId !== agentId || isEffectiveProviderDisabled) return false;
    const session = $agentSession$;
    if (!session) return false;
    const sessionModel = session.model;
    const sessionModelId =
      typeof sessionModel === 'string' ? splitLegacyCompoundId(sessionModel).modelId : '';
    const localModelId =
      hasExplicitModel && localModel ? splitLegacyCompoundId(localModel).modelId : '';
    return sessionModelId !== localModelId;
  });

  const isSelectedModelMissingAfterLoad = $derived.by(() => {
    if (isGuestLocked) return false;
    // Settings-derived: does not wait for catalog loads or availability probes.
    if (isSelectedModelProviderDisabled) return true;
    if (isAwaitingReHomedModel) return false;
    // A cleared registry is unknown until its replacement arrives, even if
    // the last successful models.list response is still cached.
    if (!$hasCheckedOnce$) return false;
    if (!canUseProviderModels(selectedModelProviderId || effectiveProviderId)) return true;
    if (isLoadingModels) return false;
    if (!allProvidersLoaded) return false;
    if (isSelectedModelProviderPending) return false;
    return isSelectedModelMissingFromCatalog;
  });

  const isSelectedModelUnavailable = $derived.by(() => {
    if (!isSelectedModelMissingAfterLoad) return false;
    if (isSelectedModelProviderDisabled) return true;
    const provider = selectedModelGateProviderId;
    // A hydrated registry can establish that a historical provider no longer
    // resolves, even though that provider can never return a model catalog.
    if ($providerCatalogEntries$.length > 0 && !hasResolvedProvider(provider)) return true;
    const catalog = $providerCatalogs$[provider];
    const request = $providerRequests$[provider];
    // A failed probe or a degraded/last-good list cannot establish removal.
    // Keep the user's model and effort until this provider has a fresh result.
    if (!catalog || catalog.stale || catalog.warning) return false;
    if (request?.error || request?.status === 'loading' || request?.status === 'cancelled')
      return false;
    return true;
  });

  // --- Per-agent fallback tracking (persisted through Redux sagas so it survives page refresh) ---
  // Keyed by agentId so warnings don't leak across agents/workspaces.
  const agentIdStore = writable('');
  const fallbackInfo$ = selectModelFallbackInfo(agentIdStore);
  const reasoningEffort$ = (
    'withStore' in selectAgentReasoningEffort
      ? selectAgentReasoningEffort.withStore(appStore)
      : selectAgentReasoningEffort
  )(agentIdStore);
  const agentModelEffortLevels$ = (
    'withStore' in selectAgentModelEffortLevels
      ? selectAgentModelEffortLevels.withStore(appStore)
      : selectAgentModelEffortLevels
  )(agentIdStore);

  const selectedModelEffortLevels = $derived.by<string[]>(() => {
    if (
      !onReasoningChange &&
      Array.isArray($agentModelEffortLevels$) &&
      $agentModelEffortLevels$.length > 0
    ) {
      return $agentModelEffortLevels$;
    }
    const levels = selectedCatalogOption?.data?.effortLevels;
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

  const reasoningLevels = $derived(showReasoning ? selectedModelEffortLevels : []);
  const showReasoningFooter = $derived(showReasoning && reasoningLevels.length > 0);
  const persistedReasoningEffort = $derived(
    onReasoningChange ? (reasoningEffort ?? null) : ($reasoningEffort$ ?? null),
  );
  const inheritedReasoningLabel = $derived(
    defaultReasoningEffort && reasoningLevels.includes(defaultReasoningEffort)
      ? m.chat_modelPicker_defaultModelPreview_label({
          model: reasoningLevelLabel(defaultReasoningEffort),
        })
      : undefined,
  );
  const currentReasoningEffort = $derived(
    persistedReasoningEffort && reasoningLevels.includes(persistedReasoningEffort)
      ? persistedReasoningEffort
      : null,
  );
  const currentReasoningLabel = $derived(
    persistedReasoningEffort && !reasoningLevels.includes(persistedReasoningEffort)
      ? m.chat_effortPicker_unavailable_label({
          level: reasoningLevelLabel(persistedReasoningEffort),
        })
      : currentReasoningEffort
        ? reasoningLevelLabel(currentReasoningEffort)
        : (inheritedReasoningLabel ?? m.chat_effortPicker_level_auto()),
  );
  const currentReasoningLevelIndex = $derived(
    currentReasoningEffort ? reasoningLevels.indexOf(currentReasoningEffort) : -1,
  );
  const showTriggerReasoningGauge = $derived(
    showReasoningFooter && currentReasoningEffort !== 'none',
  );
  const triggerLabel = $derived(currentModelLabel);
  // The selection's configuration (§5.54): its profile name next to the model
  // once its base provider has profiles (`Default` for the original one).
  const triggerProfileName = $derived.by(() => {
    const ref = triggerProviderId;
    if (!ref) return undefined;
    const baseId = normalizeProviderId(providerRefBaseId(ref));
    const isProfile = isProviderProfileRef(ref);
    return providerRefProfileName(
      providerRefLabelParts(
        isProfile ? ref : baseId,
        $providerProfiles$,
        baseId,
        $providerDefaultNames$,
      ),
    );
  });
  const modelAccessibleLabel = $derived(
    triggerProfileName
      ? m.chat_modelPicker_modelWithProfile_ariaLabel({
          model: currentModelLabel,
          provider: providerDisplayName(triggerProviderId),
        })
      : currentModelLabel,
  );
  const triggerAccessibleLabel = $derived(
    [
      modelAccessibleLabel,
      ...(showReasoningFooter ? [currentReasoningLabel] : []),
      ...(usingEarlierProfileSettings ? [m.chat_modelPicker_earlierSettings_label()] : []),
    ].join(' · '),
  );
  // Restart guidance names whoever owns the daemon: Intent for the app's own
  // sidecar, intentd on the provider host otherwise. A reconnect never applies.
  const earlierSettingsDescription = $derived(
    !usingEarlierProfileSettings
      ? ''
      : selectIsDaemonAppOwned.select(appStore.state)
        ? m.chat_modelPicker_earlierSettingsLocal_description()
        : m.chat_modelPicker_earlierSettingsRemote_description(),
  );
  const lockedButtonTitle = $derived(
    isGuestLocked
      ? m.chat_modelPicker_guestLocked_title()
      : lockedTitle?.trim() ||
          m.chat_modelPicker_modelLocked_title({ model: triggerAccessibleLabel }),
  );
  // The in-flight commit window is announced with `aria-busy` and re-entry is
  // ignored in `handleReasoningSelect`; it must not feed the HTML `disabled`
  // attribute, which would drop focus from the effort trigger (intent#4159).
  let updatingReasoningEffort = $state(false);
  const reasoningControlDisabled = $derived(
    reasoningDisabled ||
      effectiveLocked ||
      !hasResolvedProvider(selectedModelGateProviderId) ||
      isApplyingModelUpdate ||
      pendingModelUpdate !== null ||
      (!onReasoningChange && (!agentId || !workspaceId)) ||
      reasoningLevels.length === 0,
  );
  const refreshProviderId = $derived(activeBrowseProviderId || preferredBrowseProviderId);
  const showDropdownFooter = $derived(
    showReasoningFooter ||
      codexFallbackWarning !== null ||
      (!allProvidersLoaded && Object.keys(allProviderModels).length > 0) ||
      activeProviderIssue !== null ||
      refreshingProviders.has(refreshProviderId),
  );

  const railProviderIds = $derived(providerTabIds);
  let pointerInteraction = $state(false);

  function clearModelSearch(event: MouseEvent) {
    modelSearchValue = '';
    (event.currentTarget as HTMLElement)
      .closest('[data-slot="dropdown-content"]')
      ?.querySelector<HTMLInputElement>('[role="searchbox"]')
      ?.focus();
  }

  function selectProviderTab(providerId: string) {
    providerBrowseChanged = true;
    activeBrowseProviderId = providerId;
  }

  function handleProviderTabKeydown(event: KeyboardEvent, providerId: string) {
    const currentIndex = railProviderIds.indexOf(providerId);
    if (currentIndex < 0) return;

    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      nextIndex = (currentIndex + 1) % railProviderIds.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + railProviderIds.length) % railProviderIds.length;
    }
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = railProviderIds.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    event.stopPropagation();
    selectProviderTab(railProviderIds[nextIndex] ?? providerId);
    const tabs = (event.currentTarget as HTMLButtonElement)
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[nextIndex]?.focus();
  }

  async function handleReasoningSelect(value: string | null): Promise<boolean> {
    if (reasoningControlDisabled || updatingReasoningEffort) return false;
    const previous = persistedReasoningEffort;
    if (value === previous) return true;

    updatingReasoningEffort = true;
    try {
      if (onReasoningChange) {
        return (await onReasoningChange(value)) !== false;
      }
      if (!agentId || !workspaceId) return false;
      return await mutate.applyEffort(agentId, workspaceId, value, previous);
    } finally {
      updatingReasoningEffort = false;
    }
  }

  $effect(() => {
    agentIdStore.set(agentId ?? '');
  });

  function setFallbackInfo(info: ModelFallbackInfo) {
    if (agentId) {
      appStore.dispatch(setModelFallbackInfo(agentId, info));
    }
  }

  function clearFallbackInfo() {
    if (agentId) {
      appStore.dispatch(clearModelFallbackInfo(agentId));
    }
  }

  // Show warning if model is currently unavailable OR was recently auto-switched.
  // Only show on pickers tied to an existing agent (agentId) — the workspace
  // initializer creates new agents and shouldn't display fallback warnings.
  const showModelWarning = $derived(
    !!agentId &&
      !isGuestLocked &&
      (replacementRequired !== null || isSelectedModelUnavailable || $fallbackInfo$ !== null),
  );

  // Warning message to display
  const warningMessage = $derived.by(() => {
    // Settings > Agents toggles the base provider; messages name that toggle.
    if (replacementRequired) {
      const provider = baseProviderDisplayName(replacementRequired.providerRef);
      return {
        title: m.chat_modelPicker_replacementRequired_title(),
        description:
          replacementRequired.reason === 'provider-disabled'
            ? m.chat_modelPicker_replacementProviderDisabled_description({ provider })
            : m.chat_modelPicker_replacementProfileMissing_description({ provider }),
      };
    }
    if (isSelectedModelProviderDisabled) {
      return {
        title: m.chat_modelPicker_noLongerAvailable_title({ model: currentModelLabel }),
        description: m.chat_modelPicker_providerDisabled_description({
          provider: baseProviderDisplayName(selectedModelGateProviderId),
        }),
      };
    }
    if (isSelectedModelUnavailable) {
      return {
        title: m.chat_modelPicker_noLongerAvailable_title({
          model: localModel || m.chat_modelPicker_selectedModel_fallback(),
        }),
        description: m.chat_modelPicker_pickAnother_description(),
      };
    }
    const fallbackInfo = $fallbackInfo$;
    if (fallbackInfo) {
      return {
        title: m.chat_modelPicker_noLongerAvailable_title({ model: fallbackInfo.fromModel }),
        description: m.chat_modelPicker_switchedTo_description({ model: fallbackInfo.toModel }),
      };
    }
    return null;
  });

  // Keep warnings, icon-only labels, and reasoning details available on hover.
  const triggerTitle = $derived(
    showModelWarning && warningMessage
      ? m.chat_modelPicker_warning_tooltip({
          title: warningMessage.title,
          description: warningMessage.description,
        })
      : usingEarlierProfileSettings
        ? m.chat_modelPicker_warning_tooltip({
            title: triggerAccessibleLabel,
            description: earlierSettingsDescription,
          })
        : isCompact || showReasoningFooter || triggerProfileName
          ? triggerAccessibleLabel
          : undefined,
  );

  // Re-home announcement (see `disabledProviderSnapshot`).
  $effect(() => {
    if (!agentId) {
      disabledProviderSnapshot = null;
      reHomeAnnouncementSuppressed = false;
      return;
    }
    const currentProviderId = normalizeProviderId(effectiveProviderId);
    if (isEffectiveProviderDisabled) {
      if (!disabledProviderSnapshot && !untrack(() => reHomeAnnouncementSuppressed)) {
        disabledProviderSnapshot = {
          agentId,
          providerId: currentProviderId,
          fromModel: untrack(() => currentModelLabel),
        };
      }
      return;
    }
    reHomeAnnouncementSuppressed = false;
    const snapshot = disabledProviderSnapshot;
    if (!snapshot) return;
    if (isAwaitingReHomedModel) return;
    disabledProviderSnapshot = null;
    if (snapshot.agentId !== agentId) return;
    if (snapshot.providerId === currentProviderId) return;
    const toModel = untrack(() => currentModelLabel);
    logger.info('Agent re-homed by the daemon after its provider was disabled:', {
      agentId,
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
    return findModelFallbackOption({
      workspaceId,
      options: flatModelOptions,
      excludeValue: USE_DEFAULT_VALUE,
      restrictToProvider,
      globallySelectedModel: $selectedModel$,
    });
  }

  // Auto-fallback: When the selected model becomes unavailable, automatically switch to an available model.
  // Only applies to pickers tied to an existing agent — onboarding doesn't need this.
  $effect(() => {
    if (!agentId) return;
    if (isGuestLocked) return;
    // A disabled provider is re-homed by the daemon on the next send; the FE
    // must not `agent.setModel` its way around the gate (intent#5737).
    if (isSelectedModelProviderDisabled) return;
    // A removed/disabled profile needs the user's explicit replacement (§5.54).
    if (replacementRequired) return;
    if (isApplyingModelUpdate || pendingModelUpdate) return;
    if (!canUseProviderModels(selectedModelProviderId || effectiveProviderId)) return;
    if (!isSelectedModelUnavailable) return;
    if (flatModelOptions.length === 0) return;

    // Guard against transient unavailability. This effect writes the session
    // model (via handleModelSelect), which PERMANENTLY overwrites the
    // persisted model on the agent session — including across restarts.
    // Only proceed once we're confident the user's provider has truly settled;
    // otherwise a slow/empty per-provider fetch during boot or refresh would
    // silently replace the user's picked model (e.g. Sonnet 4.6 → GPT 5.4).
    const { providerId: rawModelProvider } = parseCompoundModelId(localModel ?? '');
    const modelProvider = normalizeProviderId(rawModelProvider);
    if (
      !isUserProviderSettled({
        workspaceId,
        agentProviderModels,
        agentProviderError,
        enabledProviderIds: $availableEnabledProviderIds$,
        allProviderModels,
        modelProvider,
      })
    ) {
      logger.debug('Skipping auto-fallback: user provider has not settled yet', {
        modelProvider,
        localModel,
      });
      return;
    }

    // Get the name of the unavailable model for the notification
    const unavailableModelName = localModel || m.chat_modelPicker_selectedModel_fallback();

    const unavailableProvider = selectedModelGateProviderId;

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
    const activeProvider = normalizeProviderId($activeProviderId$);
    const isProviderSwitch =
      unavailableModelProvider !== activeProvider ||
      flatModelOptions.some((opt) => {
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

  let silentRetryAttemptedForProvider: string | null = null;

  // Silent fallback for onboarding-style pickers (no agentId)
  // When a model doesn't exist, fall back to a same-provider model (with one retry)
  // Guard to prevent the retry fetch from re-firing indefinitely if the model
  // remains unavailable after the retry (e.g., provider ID normalization mismatch).
  let silentFallbackRetried = $state(false);

  // Reset the retry guard when the user picks a new model
  $effect(() => {
    void localModel; // track localModel
    silentFallbackRetried = false;
  });

  $effect(() => {
    if (!silentFallback) return;
    if (isGuestLocked) return;
    if (isApplyingModelUpdate || pendingModelUpdate) return;
    if (!canUseProviderModels(selectedModelProviderId || effectiveProviderId)) return;
    if (!isSelectedModelMissingAfterLoad) return;
    if (!isLoadingModels && flatModelOptions.length === 0) return;

    const currentProvider = selectedModelGateProviderId;

    // Try same-provider fallback first
    const fallbackOption = isSelectedModelUnavailable
      ? findFallbackOption(currentProvider)
      : undefined;
    if (fallbackOption) {
      logger.info('Workspace initializer: falling back to same-provider model', {
        unavailableModel: localModel,
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
    if (silentFallbackRetried) return;
    silentFallbackRetried = true;

    // No same-provider model available — retry the fetch once, then warn
    if (silentRetryAttemptedForProvider === currentProvider) return;
    silentRetryAttemptedForProvider = currentProvider;

    appStore.dispatch(providerModelsRequested(currentProvider, 'silentRetry', workspaceId));
  });

  let dropdownOpen = $state(false);
  let dropdownRef = $state<{
    focusTrigger: () => void;
    dismissAndFocusTrigger: () => void;
    openAndFocusSearch: () => Promise<void>;
  } | null>(null);

  $effect(() => {
    if (!modalAware || !dropdownOpen) return;
    return pushEscapeLayer(() => {
      dropdownRef?.dismissAndFocusTrigger();
    });
  });

  let detailsError = $state<ProviderLoadError | null>(null);
  let detailsOpen = $state(false);

  function showProviderDetails(error: ProviderLoadError) {
    // The footer is removed when its dropdown closes. Restore focus to the
    // stable picker trigger before opening the dialog so dismissal returns there.
    dropdownRef?.dismissAndFocusTrigger();
    detailsError = error;
    detailsOpen = true;
  }

  /** Clear the fallback warning - call when user sends a message or explicitly selects a model */
  export function clearFallbackWarning() {
    clearFallbackInfo();
  }

  async function handleModelChange(value: string | string[], event?: MouseEvent) {
    if (effectiveLocked || destroyed || isApplyingModelUpdate) {
      dropdownValue = currentDropdownValue();
      return;
    }
    const connection = selectPrincipalConnectionContext.select(appStore.state);
    const modelValue = value as string;
    const pick =
      modelValue === USE_DEFAULT_VALUE
        ? undefined
        : resolvePickedTriple(modelValue, activeBrowseProviderId);
    if (pick && !allowProviderSwitch && pick.providerId !== effectiveProviderId) {
      dropdownValue = currentDropdownValue();
      return;
    }
    const fromProviderId = selectedModelProviderId || effectiveProviderId;
    const confirmation = ++confirmationRevision;
    // Gate user-picked changes to a *different* model behind the optional
    // confirmation callback (mid-conversation switch warning). Re-selecting
    // the current model is never gated; picking "Default model" while an
    // explicit model is selected is gated too — the agent still restarts on
    // the provider default (a null `to` in the gate means "provider default").
    const isActualChange =
      modelValue === USE_DEFAULT_VALUE
        ? hasExplicitModel
        : !localModel ||
          pick?.providerId !== fromProviderId ||
          normalizeModelIdForMatch(modelValue, pick?.providerId ?? effectiveProviderId) !==
            normalizeModelIdForMatch(localModel, fromProviderId);
    if (isActualChange && confirmModelChange) {
      const confirmed = await confirmModelChange(
        localModel,
        modelValue === USE_DEFAULT_VALUE ? null : modelValue,
        {
          from: currentModelLabel,
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
        confirmation !== confirmationRevision ||
        effectiveLocked ||
        destroyed
      ) {
        dropdownValue = currentDropdownValue();
        return;
      }
    }
    // Combined model/effort pickers keep the panel for the next choice. When
    // closing a model-only picker, restore keyboard/modal focus to its trigger.
    if (!showReasoning && (modalAware || !event)) {
      queueMicrotask(() => {
        dropdownOpen = false;
        dropdownRef?.focusTrigger();
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
  export function open() {
    if (!effectiveLocked) {
      pointerInteraction = false;
      void dropdownRef?.openAndFocusSearch();
    }
  }
</script>

<svelte:window
  onpointerdown={() => (pointerInteraction = true)}
  onkeydown={() => (pointerInteraction = false)}
/>

{#if effectiveLocked}
  <!-- Show locked state without dropdown -->
  <Button
    {variant}
    size={buttonSize}
    class={cn(buttonClass, 'cursor-default')}
    title={lockedButtonTitle}
    tooltip={lockedButtonTitle}
    aria-label={triggerAccessibleLabel}
    disabled={true}
  >
    {#if isCompact}
      <Fa icon={faLock} class="h-4 w-4" />
    {:else if size === 'xs'}
      {#if shouldShowLockIconWhenLocked}
        <Fa icon={faLock} class="h-3.5 w-3.5" />
      {/if}
      {#if hasProviderIcon(triggerProviderId)}
        <ProviderIcon providerId={triggerProviderId} class="size-3.5" />
      {/if}
      <span class="flex-1 text-left truncate">{triggerLabel}</span>
      {#if triggerProfileName}
        <span class="min-w-0 max-w-24 shrink truncate text-subtle" aria-hidden="true"
          >{triggerProfileName}</span
        >
      {/if}
      {#if showTriggerReasoningGauge}
        <EffortGauge
          value={currentReasoningLevelIndex}
          max={Math.max(1, reasoningLevels.length - 1)}
          centered={currentReasoningEffort === null}
          testId="model-reasoning-effort-gauge"
          class="[&_line]:transition-none!"
        />
      {/if}
    {:else}
      <span class={cn('flex items-center', shouldShowLockIconWhenLocked && 'gap-1.5')}>
        {#if shouldShowLockIconWhenLocked}
          <Fa icon={faLock} class="h-3.5 w-3.5" />
        {/if}
        {#if hasProviderIcon(triggerProviderId)}
          <ProviderIcon providerId={triggerProviderId} class="size-3.5" />
        {/if}
        <span class="text-xs truncate">{triggerLabel}</span>
        {#if triggerProfileName}
          <span class="text-xs min-w-0 max-w-24 shrink truncate text-subtle" aria-hidden="true"
            >{triggerProfileName}</span
          >
        {/if}
        {#if showTriggerReasoningGauge}
          <EffortGauge
            value={currentReasoningLevelIndex}
            max={Math.max(1, reasoningLevels.length - 1)}
            centered={currentReasoningEffort === null}
            testId="model-reasoning-effort-gauge"
            class="[&_line]:transition-none!"
          />
        {/if}
      </span>
    {/if}
  </Button>
{:else}
  {#snippet groupHeader({ group, groupIndex }: DropdownGroupProps)}
    {#if group.key === AUGGIE_LEGACY_GROUP_KEY}
      <ModelPickerLegacyGroupHeader
        {group}
        {groupIndex}
        expanded={legacyModelsVisible}
        disabled={legacyToggleDisabled}
        onToggle={() => {
          if (!legacyToggleDisabled) legacyModelsExpanded = !legacyModelsExpanded;
        }}
      />
    {:else if !providerTabsEnabled}
      <ModelPickerGroupHeader
        {group}
        {groupIndex}
        collapsed={collapsedGroups.has(group.key)}
        refreshing={refreshingProviders.has(group.key)}
        onToggle={toggleGroup}
        onRefresh={handleRefreshProvider}
      />
    {:else if group.key !== 'default' && baseHasProfiles(group.parentKey ?? group.key)}
      <!-- Tabs show icons only; name the configuration being browsed (§5.54). -->
      <div
        class="truncate px-2 pt-1.5 pb-0.5 text-xs text-subtle"
        data-testid="model-picker-profile-group"
      >
        {group.label}
      </div>
      {#if isProfileSignedOut(group.key)}
        <!-- Same cue as a provider's sign-in failure; the models stay selectable. -->
        <div
          class="flex items-start gap-2 px-2 pb-1 text-xs"
          role="status"
          data-testid="model-picker-profile-signed-out"
        >
          <ModelProviderErrorItem
            providerId={group.key}
            providerLabel={group.label}
            error={m.settings_providerProfiles_statusError_label()}
            hint={m.chat_modelPicker_profileSignedOut_hint()}
            compact={true}
          />
        </div>
      {/if}
    {/if}
  {/snippet}

  {#snippet dropdownFooter()}
    {#if codexFallbackWarning}
      <div class="px-3 py-2">
        <ModelPickerProviderNotice
          warning={codexFallbackWarning.message}
          docsUrl={codexFallbackWarning.docsUrl}
          show={true}
          variant="warning"
          class="max-w-none"
        />
      </div>
    {/if}
    {#if !allProvidersLoaded && Object.keys(allProviderModels).length > 0}
      <div class="px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
        <IntentMarkLoader size={12} />
        <span>{m.chat_modelPicker_loadingMore_label()}</span>
      </div>
    {/if}
    {#if footerProviderWarnings.length > 0}
      <div class="px-3 py-2 space-y-1.5 text-xs">
        {#each footerProviderWarnings as warning (warning.providerId)}
          <div class="flex items-start gap-2 text-muted-foreground" role="status">
            <ModelProviderErrorItem
              providerId={warning.providerId}
              providerLabel={warning.providerName}
              error={warning.message}
              hint={warning.hint}
              compact={true}
            />
          </div>
        {/each}
      </div>
    {/if}
    {#if activeProviderIssue || refreshingProviders.has(refreshProviderId)}
      <div class="flex flex-wrap items-center gap-2 px-3 py-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={refreshingProviders.has(refreshProviderId)}
          aria-label={m.chat_modelPicker_retry_label()}
          aria-busy={refreshingProviders.has(refreshProviderId)}
          onclick={() => handleRefreshProvider(refreshProviderId)}
        >
          {#if refreshingProviders.has(refreshProviderId)}<IntentMarkLoader size={12} />{/if}
          {m.chat_modelPicker_retry_label()}
        </Button>
        {#if activeProviderIssue}
          <Button
            type="button"
            variant="link"
            size="sm"
            onclick={() => activeProviderIssue && showProviderDetails(activeProviderIssue)}
          >
            {m.chat_modelPicker_errorDetails_label()}
          </Button>
        {/if}
      </div>
    {/if}
    {#if showReasoningFooter}
      <div class="w-full min-w-0 px-3 py-2" data-testid="model-reasoning-section">
        <EffortPicker
          mode="embedded"
          class="w-full min-w-0 gap-2! [&>div]:w-24 [&>span]:min-w-0 [&>span>span]:truncate"
          {agentId}
          {workspaceId}
          effortLevels={reasoningLevels}
          effort={persistedReasoningEffort}
          autoLabel={inheritedReasoningLabel}
          disabled={reasoningControlDisabled}
          busy={updatingReasoningEffort}
          {modalAware}
          onEffortChange={handleReasoningSelect}
        />
      </div>
    {/if}
  {/snippet}

  <Dropdown
    bind:this={dropdownRef}
    bind:value={dropdownValue}
    bind:searchValue={modelSearchValue}
    defaultHighlightValue={defaultModelIdMappedOption?.value ??
      defaultModelId ??
      catalogDefaultFallbackOption?.value}
    bind:open={dropdownOpen}
    groups={displayGroups}
    onchange={handleModelChange}
    closeOnSelect={!showReasoning}
    variant={variant === 'outline' ? 'outline' : variant === 'default' ? 'default' : 'ghost'}
    size={size === 'xs' ? 'xs' : 'sm'}
    searchable={!hasNoAvailableProvider}
    searchChrome
    placeholder={m.ui_dropdown_search_ariaLabel()}
    class="min-w-0 max-w-full"
    headerClass={cn('model-picker-header border-b-0!', !hasNoAvailableProvider && 'pt-9')}
    triggerClass={cn(
      'max-w-full px-2!',
      (variant === 'outline' || variant === 'default') && 'w-full justify-between border-border!',
      triggerClass,
    )}
    contentClass={cn(
      'model-picker-panel max-w-[calc(100vw-16px)] bg-popover! text-foreground! w-96 h-[360px] min-h-0 flex flex-col rounded-xl pl-12',
      pointerInteraction && 'model-picker-pointer',
    )}
    contentMaxHeight={360}
    fillContentHeight
    animate={false}
    {portal}
    {collisionBoundary}
    {groupHeader}
    footer={showDropdownFooter ? dropdownFooter : undefined}
  >
    {#snippet trigger({
      open: _open,

      value: _value,
    }: {
      open: boolean;
      value: string | string[] | undefined;
    })}
      <span
        class={cn(
          'inline-flex items-center gap-2 truncate min-w-0',
          (variant === 'outline' || variant === 'default') && 'flex-1',
        )}
        title={isTriggerLabelResolved ? triggerTitle : ''}
        aria-label={isTriggerLabelResolved ? triggerAccessibleLabel : undefined}
      >
        {#if isCompact}
          <Fa icon={faSettings} class="h-4 w-4" />
        {:else if isTriggerLabelResolved}
          {#if showModelWarning}
            <Fa icon={faTriangleExclamation} class="h-3 w-3 text-warning-ink shrink-0" />
          {:else if usingEarlierProfileSettings}
            <Fa icon={faCircleInfo} class="h-3 w-3 text-muted-foreground shrink-0" />
          {/if}
          {#if hasProviderIcon(triggerProviderId)}
            <ProviderIcon providerId={triggerProviderId} class="size-3.5" />
          {/if}
          <span class="truncate" use:truncatedTitle={triggerTitle ? undefined : triggerLabel}
            >{triggerLabel}</span
          >
          {#if triggerProfileName}
            <span
              class="min-w-0 max-w-24 shrink truncate text-subtle"
              aria-hidden="true"
              data-testid="model-picker-profile">{triggerProfileName}</span
            >
          {/if}
          {#if showTriggerReasoningGauge}
            <EffortGauge
              value={currentReasoningLevelIndex}
              max={Math.max(1, reasoningLevels.length - 1)}
              centered={currentReasoningEffort === null}
              testId="model-reasoning-effort-gauge"
              class="[&_line]:transition-none!"
            />
          {/if}
        {:else}
          <div class="h-3.5 w-24 bg-muted/50 rounded-sm animate-pulse"></div>
        {/if}
      </span>
      {#if variant === 'outline' || variant === 'default'}
        <Fa icon={faChevronDown} class="h-2 w-2 opacity-50 shrink-0" />
      {/if}
    {/snippet}

    {#snippet header()}
      <div
        class="absolute inset-y-0 left-0 flex w-12 flex-col items-center gap-1 border-r border-border bg-muted/20 py-2"
        data-testid="model-provider-rail"
      >
        <div
          class="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto"
          role="tablist"
          aria-orientation="vertical"
          aria-label={m.chat_modelPicker_modelProviders_label()}
          data-testid="model-provider-tabs"
        >
          {#each railProviderIds as providerTabId (providerTabId)}
            <Button
              variant="ghost"
              size="icon-sm"
              iconOnly={true}
              role="tab"
              aria-selected={providerTabId === activeBrowseProviderId}
              aria-label={providerTabLabel(providerTabId)}
              title={providerTabLabel(providerTabId)}
              tabindex={providerTabId === activeBrowseProviderId ? 0 : -1}
              class={cn(
                'relative text-muted-foreground hover:bg-muted/40',
                providerTabId === activeBrowseProviderId && 'bg-muted text-foreground',
              )}
              onclick={() => selectProviderTab(providerTabId)}
              onkeydown={(event) => handleProviderTabKeydown(event, providerTabId)}
            >
              <ProviderIcon providerId={providerTabId} class="size-4" size={16} />
              {#if isProfileSignedOut(providerTabId)}
                <span
                  class="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warning"
                  aria-hidden="true"
                ></span>
              {/if}
              {#if isProviderProfileRef(providerTabId)}
                <!-- Tells same-provider profile tabs apart; the tab's label names it. -->
                <span
                  class="absolute right-0 bottom-0 min-w-3 rounded-sm bg-popover px-0.5 text-ui-sm leading-3 font-medium text-foreground"
                  aria-hidden="true">{profileInitial(providerTabId)}</span
                >
              {/if}
            </Button>
          {/each}
        </div>
        {#if !hasNoAvailableProvider && $canAdministerHost$}
          <Button
            variant="ghost"
            size="icon-sm"
            iconOnly={true}
            aria-label={m.chat_modelPicker_noProviderAvailable_openSettings_label()}
            class="text-muted-foreground hover:bg-muted/40"
            data-testid="model-provider-settings-button"
            onclick={openProviderSettings}
          >
            <Fa icon={faPlus} class="size-3 text-muted-foreground/50" />
          </Button>
        {/if}
      </div>
      {#if modelSearchValue}
        <Button
          variant="ghost"
          size="icon-xs"
          iconOnly
          class="absolute right-10 top-1.5 z-20"
          aria-label={m.chat_modelPicker_clearSearch_ariaLabel()}
          onclick={clearModelSearch}
        >
          <Fa icon={faXmark} class="size-3" />
        </Button>
      {/if}
      {#if refreshProviderId}
        <Button
          variant="ghost"
          size="icon-xs"
          iconOnly={true}
          title={m.chat_modelPicker_refreshGroup_title({
            group: providerDisplayName(refreshProviderId),
          })}
          aria-label={m.chat_modelPicker_refreshGroup_title({
            group: providerDisplayName(refreshProviderId),
          })}
          class={cn(
            'absolute right-2 top-1.5 text-subtle hover:bg-muted/40',
            refreshingProviders.has(refreshProviderId) && 'opacity-50!',
          )}
          data-testid="model-provider-refresh-button"
          aria-busy={refreshingProviders.has(refreshProviderId)}
          disabled={refreshingProviders.has(refreshProviderId)}
          onclick={() => void handleRefreshProvider(refreshProviderId)}
        >
          {#if refreshingProviders.has(refreshProviderId)}
            <IntentMarkLoader size={12} />
          {:else}
            <Fa
              icon={faArrowsRotate}
              size={10}
              class="text-subtle transition-transform duration-spring-slow ease-spring-slow motion-reduce:transition-none"
            />
          {/if}
        </Button>
      {/if}
      {#if showModelWarning && warningMessage}
        <div class="px-3 py-2.5 border-b border-border bg-warning/5">
          <div class="flex items-start gap-2" role="alert">
            <Fa icon={faTriangleExclamation} class="h-3.5 w-3.5 text-warning-ink mt-0.5 shrink-0" />
            <div class="min-w-0">
              <div class="text-xs font-medium text-foreground leading-tight">
                {warningMessage.title}
              </div>
              <div class="text-xs text-subtle mt-0.5 leading-tight">
                {warningMessage.description}
              </div>
            </div>
          </div>
        </div>
      {:else if usingEarlierProfileSettings}
        <div class="px-3 py-2.5 border-b border-border" data-testid="model-picker-earlier-settings">
          <div class="flex items-start gap-2" role="status">
            <Fa icon={faCircleInfo} class="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div class="min-w-0">
              <div class="text-xs font-medium text-foreground leading-tight">
                {m.chat_modelPicker_earlierSettings_label()}
              </div>
              <div class="text-xs text-subtle mt-0.5 leading-tight">
                {earlierSettingsDescription}
              </div>
            </div>
          </div>
        </div>
      {/if}
    {/snippet}

    {#snippet item({ option, selected }: DropdownItemProps)}
      {@const providerLoadError = option.data?.providerLoadError as ProviderLoadError | undefined}
      {@const providerLoading = option.data?.providerLoading as boolean | undefined}

      <div class="flex items-center gap-2.5 w-full min-w-0 py-1">
        {#if providerLoading}
          <div class="flex items-center gap-2 text-muted-foreground text-sm">
            <IntentMarkLoader size={12} />
            <span>{option.label}</span>
          </div>
        {:else if providerLoadError}
          <ModelProviderErrorItem
            providerId={providerLoadError.providerId}
            providerLabel={providerLoadError.providerName}
            error={providerLoadError.message}
            hint={providerLoadError.hint}
          />
        {:else}
          <div class="flex-1 min-w-0">
            <span
              class={cn(
                'block truncate text-sm font-normal',
                option.value === USE_DEFAULT_VALUE && 'text-muted-foreground',
              )}
            >
              {option.label}
            </span>
            {#if option.description}
              <div
                class="text-xs text-subtle truncate mt-0.5"
                use:truncatedTitle={option.description}
              >
                {option.description}
              </div>
            {/if}
          </div>
          <Indicator state={selected ? 'checked' : 'empty'} />
        {/if}
      </div>
    {/snippet}

    {#snippet empty()}
      <ModelPickerEmptyState
        {isLoadingModels}
        blockingLoadError={activeProviderIssue ?? blockingLoadError}
        retryInFooter={activeProviderIssue !== null || refreshingProviders.has(refreshProviderId)}
        {hasNoAvailableProvider}
        hostManaged={!$canAdministerHost$}
        onOpenProviderSettings={openProviderSettings}
        onRetry={handleRetry}
      />
    {/snippet}
  </Dropdown>
{/if}

<ContentDialog
  bind:open={detailsOpen}
  title={m.chat_modelPicker_errorDetails_title({ provider: detailsError?.providerName ?? '' })}
  onCloseAutoFocus={(event) => {
    event.preventDefault();
    dropdownRef?.focusTrigger();
  }}
>
  <pre
    class="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] type-caption font-mono text-foreground">{detailsError?.details}</pre>
</ContentDialog>

<style>
  :global(.model-picker-panel > div:has(> input[role='searchbox'])) {
    position: absolute;
    top: 0.25rem;
    left: 3.5rem;
    right: 2.5rem;
    width: auto;
    padding: 0;
    z-index: 10;
    background: transparent;
    border-radius: var(--radius-medium);
  }
  :global(.model-picker-panel > div:has(> input[role='searchbox']) > svg) {
    display: none;
  }
  :global(.model-picker-panel input[role='searchbox']) {
    height: 2rem;
    padding: 0 1.75rem 0 0.25rem;
    border: 0;
    background: transparent;
    box-shadow: none;
    outline: none;
    border-radius: var(--radius-medium);
    caret-color: var(--color-foreground);
  }
  :global(.model-picker-panel.model-picker-pointer) {
    transition: opacity var(--spring-fast) var(--spring-fast-ease);
    @starting-style {
      opacity: 0;
    }
  }
  @container style(--motion-reduced: 1) {
    :global(.model-picker-panel.model-picker-pointer) {
      transition: none;
    }
  }
</style>
