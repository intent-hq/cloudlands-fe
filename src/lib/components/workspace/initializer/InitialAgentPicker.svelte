<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { ActionRow } from '$lib/components/ui/menu';
  import { Combobox, type ComboboxOption } from '$lib/components/ui/combobox';
  import * as Popover from '$lib/components/ui/popover';
  import { useDialogPortalTarget } from '$lib/components/ui/dialog';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { workspacePickerStyles } from './workspace-picker-styles';
  import { canPlaceBeside } from '$lib/components/ui/overlay-positioning';
  import { cn } from '$lib/utils';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';

  import {
    selectSpecialists,
    selectCustomSpecialistsLoaded,
    selectFileSpecialistsLoaded,
    selectOrchestratorSpecialist,
    filterModalPickableSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';

  import {
    selectAvailableModels,
    selectAvailableModelsProviderId,
    selectModelEffortLevels,
    selectSelectedModel,
    selectProviderModels,
    selectDefaultReasoningEffort,
  } from '$store/renderer/slices/model/model-selectors';
  import {
    selectWorkspaceInitializerHydrated,
    selectWorkspaceInitializerRecentSpecialistIds,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { sortSpecialistsByRecency } from '$store/renderer/slices/workspace-initializer/utils/recent-specialists';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount, tick, untrack } from 'svelte';
  import {
    getProviderAvailability,
    type ProviderAvailabilityResult,
  } from '$features/providers/provider-availability.client';
  import {
    getProviderStatusFromResult,
    isProviderAuthenticationReady,
  } from '$shared/types/provider-availability';
  import {
    isProviderDisabledInSettings,
    toDropdownOptions,
  } from '$lib/components/chat/input/model-picker-utils';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import {
    selectEffectiveDefaultProviderId,
    selectNormalizedProviderId,
    selectProviderCatalogEntries,
    selectProviderCatalogProfiles,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { isProviderProfileRef } from '$shared/provider-profiles';
  import { selectProviderModelsCacheMap } from '$store/renderer/slices/provider-models/provider-models-selectors';
  import {
    selectActiveProviderId,
    selectEnabledProviders,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { createLogger } from '$lib/utils/client-logger';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { DEFAULT_NEW_WORKSPACE_SPECIALIST_ID } from '$lib/constants/specialists';
  import StartOnPicker from './StartOnPicker.svelte';
  import {
    availableInitialAgentProviders,
    defaultInitialAgentProvider,
    initialAgentDefaultModel,
    isInitialAgentProviderAvailable,
    type ProviderAvailabilityContext,
  } from './initial-agent-defaults';
  import { SpecialistDefaultPreviews } from './specialist-default-previews.svelte';
  import { writable } from 'svelte/store';
  import { buildMachineModelGroups } from '$lib/components/chat/input/model-picker-groups';
  import { expandProviderIdsWithProfiles } from '$shared/provider-profiles';
  import {
    selectProviderCatalogDefaultRemoteIncompatibility,
    selectProviderCatalogDefaultRemoteLaunch,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import {
    selectDefaultHasOverrides,
    selectRemoteMachines,
    selectRemoteMachinesVisible,
    selectRemoteModelSwitchSupport,
    selectStartOnCloud,
    selectStartOnOptions,
    selectStartOnVisible,
  } from '$features/remote-machines/remote-machines-selectors';
  import { remoteMachinesRefreshRequested } from '$features/remote-machines/remote-machines-slice';
  import {
    machineReportFreshness,
    machineReportedModels,
  } from '$features/remote-machines/remote-model-picker';
  import {
    machineModelFallback,
    resolveStartOn,
    START_ON_BACKEND,
    startOnBackendLabel,
    startOnModelMachineId,
    startOnCloudId,
  } from '$features/remote-machines/start-on';
  import { selectIsOrchestratorBackend } from '$store/renderer/slices/principal/principal-selectors';

  const logger = createLogger('InitialAgentPicker');
  // Unique per mount: the picker can render more than once on a page.
  const uid = $props.id();
  const agentLabelId = `${uid}-agent-label`;
  const agentValueId = `${uid}-agent-value`;
  const isMobile = new IsMobile();
  const dialogPortalTarget = useDialogPortalTarget();
  // Search and the management action stay fixed around the scrollable results.
  const SPECIALIST_MENU_MAX_HEIGHT =
    'min(520px, var(--bits-popover-content-available-height, calc(100dvh - 1rem)))';
  const defaultProviderId$ = selectEffectiveDefaultProviderId();
  const catalogEntries$ = selectProviderCatalogEntries();
  const providerProfiles$ = selectProviderCatalogProfiles();
  const specialists$ = selectSpecialists();
  const orchestrator$ = selectOrchestratorSpecialist();
  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  // The specialist powering the team-mode card (`role: orchestrator`, first
  // by id order). Null when the resolved set has no orchestrator — the team
  // card is then hidden and single-agent mode is forced.
  const orchestrator = $derived($orchestrator$);
  const orchestratorId = $derived(orchestrator?.id ?? null);
  const customSpecialistsLoaded$ = selectCustomSpecialistsLoaded();
  const fileSpecialistsLoaded$ = selectFileSpecialistsLoaded();
  const initializerHydrated$ = selectWorkspaceInitializerHydrated();
  const recentSpecialistIds$ = selectWorkspaceInitializerRecentSpecialistIds();
  const activeProviderId$ = selectActiveProviderId();
  const enabledProviders$ = selectEnabledProviders();
  const selectedModel$ = selectSelectedModel();
  const configuredModels$ = selectProviderModels();
  const defaultReasoningEffort$ = selectDefaultReasoningEffort();
  const availableModels$ = selectAvailableModels();
  const availableModelsProviderId$ = selectAvailableModelsProviderId();
  const providerModelsCacheMap$ = selectProviderModelsCacheMap();

  // First-launch single-agent default (mirrors the parent's init): Developer
  // when the resolved set carries it, else General.
  const defaultSingleAgentSpecialistId: string | null = $specialists$.some(
    (s) => s.id === DEFAULT_NEW_WORKSPACE_SPECIALIST_ID,
  )
    ? DEFAULT_NEW_WORKSPACE_SPECIALIST_ID
    : null;

  interface Props {
    presentation?: 'form' | 'footer';
    onNavigateAway?: () => void;
    /** Selected specialist ID - null means blank agent */
    selectedSpecialist?: string | null;
    /** Selected model - undefined means use specialist default */
    selectedModel?: string | undefined;
    /** Whether the user explicitly overrode the model (vs using specialist default) */
    modelWasOverridden?: boolean;
    /** Explicit reasoning effort for the initial agent, or undefined to inherit */
    selectedReasoningEffort?: string | undefined;
    /** Whether team work mode is selected (the orchestrator specialist coordinates) */
    isTeamMode?: boolean;
    /** Selected provider ID (auto-selected from first available) */
    selectedProvider?: string;
    /** Callback when specialist changes */
    onSpecialistChange?: (specialistId: string | null) => void;
    /**
     * Callback when model changes. `automatic` marks a model the picker chose
     * because the Start On machine can't run the current one.
     */
    onModelChange?: (model: string | undefined, automatic?: boolean) => void;
    /**
     * Remembered Start On choice: a machine id, or '' for the current backend.
     * The row resolves it against the machines available now.
     */
    startOnMachineId?: string;
    /** The user picked a Start On option. */
    onStartOnChange?: (machineId: string) => void;
    /**
     * Only the current backend can take the first agent, and why: a new
     * repository has no commit for a remote agent to start from, and a plain
     * folder has no git at all. Null when any machine can.
     */
    startOnBackendOnly?: 'new-repo' | 'plain-folder' | null;
    /** Callback when reasoning effort changes */
    onReasoningEffortChange?: (effort: string | undefined) => void;
    /** Callback when team mode changes */
    onTeamModeChange?: (isTeamMode: boolean) => void;
    /**
     * The user picked a mode, specialist, model or reasoning effort. Never fired
     * by automatic resets or effort reconciliation.
     */
    onSetupPick?: () => void;
    /** Callback when provider changes (called when auto-selected) */
    onProviderChange?: (providerId: string) => void;
  }

  let {
    presentation = 'form',
    onNavigateAway,
    selectedSpecialist = $bindable<string | null>(defaultSingleAgentSpecialistId),
    selectedModel = $bindable<string | undefined>(undefined),
    modelWasOverridden = $bindable<boolean>(false),
    selectedReasoningEffort = $bindable<string | undefined>(undefined),
    isTeamMode = $bindable<boolean>(false),
    selectedProvider = $bindable<string>($activeProviderId$ || $defaultProviderId$),
    onSpecialistChange,
    onModelChange,
    onReasoningEffortChange,
    onTeamModeChange,
    onProviderChange,
    onSetupPick,
    startOnMachineId = $bindable<string>(''),
    onStartOnChange,
    startOnBackendOnly = null,
  }: Props = $props();

  // Start On (PROTOCOL nodes.md "Placement subset"): the machine the first
  // agent starts on. The Model row then lists that machine's models.
  const startOnVisible$ = selectStartOnVisible();
  const startOnOptions$ = selectStartOnOptions();
  const startOnMachines$ = selectRemoteMachines();
  // E2B needs a configuration that brings its own key or token.
  const startOnProviderRef = writable<string | undefined>(undefined);
  $effect(() => {
    startOnProviderRef.set(selectedProvider);
  });
  const startOnCloud$ = selectStartOnCloud(startOnProviderRef);
  const startOnChoices = $derived(
    $startOnOptions$.map((option) => {
      if (option.kind !== 'cloud') return option;
      const reason = $startOnCloud$?.find(
        (entry) => startOnCloudId(entry.cloudMachineId) === option.id,
      )?.unavailableReason;
      return reason ? { ...option, disabled: true, reason, hint: undefined } : option;
    }),
  );
  const effectiveStartOn = $derived(
    $startOnVisible$ && !startOnBackendOnly
      ? resolveStartOn(startOnMachineId, $startOnMachines$, $startOnCloud$)
      : START_ON_BACKEND,
  );
  // The machine whose models the Model row lists (an orchestrator has none of its own).
  const orchestratorBackend$ = selectIsOrchestratorBackend();
  const modelMachineId = $derived(
    startOnModelMachineId(effectiveStartOn, $startOnOptions$, $orchestratorBackend$),
  );
  const startOnMachine = $derived(
    $startOnMachines$.find((machine) => machine.id === modelMachineId) ?? null,
  );
  const remoteMachinesVisible$ = selectRemoteMachinesVisible();
  const remoteSwitchSupport$ = selectRemoteModelSwitchSupport();
  const defaultRemoteIncompatibility$ = selectProviderCatalogDefaultRemoteIncompatibility();
  const defaultRemoteLaunch$ = selectProviderCatalogDefaultRemoteLaunch();
  const defaultHasOverrides$ = selectDefaultHasOverrides();
  onMount(() => {
    // Machine states change without an event; read them fresh for the row.
    if ($remoteMachinesVisible$) appStore.dispatch(remoteMachinesRefreshRequested());
  });

  function handleStartOnChange(machineId: string) {
    onSetupPick?.();
    startOnMachineId = machineId;
    onStartOnChange?.(machineId);
  }

  // A model the chosen machine can't run (missing there, or an account-folder
  // configuration), whether picked or inherited, falls back to one it can, as
  // the daemon would refuse it.
  $effect(() => {
    const machine = startOnMachine;
    if (!modelMachineId || !machine || $remoteSwitchSupport$ !== 'supported') return;
    if (machineReportFreshness(machine, Date.now()) === 'missing') return;
    const groups = buildMachineModelGroups({
      machine,
      providerRefs: expandProviderIdsWithProfiles(
        $catalogEntries$.map((entry) => entry.id),
        $providerProfiles$,
      ).filter((ref) => !isProviderDisabledInSettings($enabledProviders$, ref)),
      groupLabel: (ref) => ref,
      // A machine that lists no models for a profile offers the backend's list.
      catalogModels: Object.fromEntries(
        Object.entries($providerModelsCacheMap$).map(([ref, entry]) => [
          ref,
          toDropdownOptions(entry.models),
        ]),
      ),
      catalogProfiles: $providerProfiles$,
      defaultRemoteIncompatibility: $defaultRemoteIncompatibility$,
      defaultRemoteLaunch: $defaultRemoteLaunch$,
      allowAutoPick: true,
      defaultHasOverrides: $defaultHasOverrides$,
    });
    const fallback = machineModelFallback({
      groups,
      providerRef: selectedProvider,
      // The daemon resolves an inherited specialist/Settings model before
      // remote admission, so check it as well as an explicit override.
      model: modelWasOverridden ? selectedModel : activeDefaultModel,
    });
    if (fallback) untrack(() => applyMachineFallback(fallback));
  });

  function applyMachineFallback(pick: { providerId: string; modelId: string }) {
    overrideProvider = pick.providerId;
    overrideModel = pick.modelId;
    selectedModel = pick.modelId;
    modelWasOverridden = true;
    if (pick.providerId !== selectedProvider) {
      selectedProvider = pick.providerId;
      onProviderChange?.(pick.providerId);
    }
    reconcileReasoningEffort(pick.modelId);
    onModelChange?.(pick.modelId, true);
  }

  function updateReasoningEffort(effort: string | undefined) {
    if (selectedReasoningEffort === effort) return;
    selectedReasoningEffort = effort;
    onReasoningEffortChange?.(effort);
  }

  function modelEffortLevels(model: string | undefined): string[] | undefined {
    if (!model) return undefined;
    const split = splitLegacyCompoundId(model);
    const providerId = split.providerId ?? (selectedProvider || $defaultProviderId$);
    const normalizedProviderId = selectNormalizedProviderId.select(appStore.state, providerId);
    // A bare model name from another provider is not capability evidence.
    if (normalizedProviderId === $availableModelsProviderId$) {
      void $availableModels$;
      const levels = selectModelEffortLevels.select(appStore.state, model);
      if (levels !== undefined) return levels.length > 0 ? levels : undefined;
    }
    const row = knownModelsForProvider(providerId)?.find(
      (row) => row.value === model || row.value === split.modelId,
    );
    // Like the daemon, only a nonempty list is validation evidence. Missing
    // or empty levels can describe a provider whose capabilities are unknown.
    return row?.effortLevels?.length ? row.effortLevels : undefined;
  }

  function reconcileReasoningEffort(model: string | undefined) {
    if (!selectedReasoningEffort || !model) return;
    const levels = modelEffortLevels(model);
    if (levels !== undefined && !levels.includes(selectedReasoningEffort)) {
      updateReasoningEffort(undefined);
    }
  }

  function handleReasoningChange(effort: string | null) {
    onSetupPick?.();
    // A blank value is the wire's explicit clear. Undefined remains inheritance.
    updateReasoningEffort(effort ?? '');
    return true;
  }

  // Provider availability state (for auto-selection only, no UI picker)
  let providerAvailability = $state<ProviderAvailabilityResult | null>(null);

  const providerAvailabilityContext = $derived<ProviderAvailabilityContext>({
    availability: providerAvailability,
    enabledProviders: $enabledProviders$,
    profiles: $providerProfiles$,
  });

  function getProviderAvailable(providerId: string): boolean {
    return isInitialAgentProviderAvailable(providerId, providerAvailabilityContext);
  }

  // Available providers derived from availability check - dynamically from the catalog
  const availableProviders = $derived(
    availableInitialAgentProviders($catalogEntries$, providerAvailabilityContext),
  );

  // Auto-select first available provider if current selection is unavailable
  // BUT: Don't override if the provider matches the user's explicit choice from the active provider selector
  $effect(() => {
    const isSelectedDisabled = isProviderDisabledInSettings($enabledProviders$, selectedProvider);
    if (isSelectedDisabled) {
      const fallback = availableProviders[0]?.id ?? '';
      selectedProvider = fallback;
      onProviderChange?.(fallback);
      return;
    }
    if (providerAvailability && availableProviders.length > 0) {
      const isSelectedAvailable = isProviderProfileRef(selectedProvider)
        ? getProviderAvailable(selectedProvider)
        : availableProviders.some((p) => p.id === selectedProvider);
      if (!isSelectedAvailable) {
        // Check if this is the user's explicit choice from the provider store.
        // '' (unresolved — settings not hydrated / providers.active unset) is
        // never an explicit choice, so it must not block the auto-select.
        const userExplicitChoice = $activeProviderId$;
        if (
          !isSelectedDisabled &&
          ((selectedProvider && selectedProvider === userExplicitChoice) ||
            ((modelOverriddenThisSession || modelWasOverridden) &&
              overrideProvider === selectedProvider))
        ) {
          // User explicitly selected this provider - don't override even if availability check fails
          logger.debug('Keeping user-selected provider despite availability check:', {
            selectedProvider,
          });
          return;
        }
        // Fall back to first available provider
        const fallback = availableProviders[0].id;
        logger.debug('Auto-selecting provider:', { fallback });
        selectedProvider = fallback;
        onProviderChange?.(fallback);
      }
    }
  });

  // Tracks whether the user explicitly picked a model during this session.
  // Session overrides are genuine and must never be cleared by the stale-override check.
  let modelOverriddenThisSession = $state(false);

  // Provider the current explicit model override belongs to. In-session picks
  // record the picker-reported provider; a model arriving from restored state
  // pairs with the provider it was persisted (and restore-validated) with —
  // its legacy compound prefix when present, else the current selectedProvider.
  let overrideProvider = $state<string | undefined>(undefined);
  // The model `overrideProvider` was recorded for: a model replaced from
  // outside (e.g. the parent restoring another repository's remembered setup)
  // pairs with the provider set alongside it, not the previous model's.
  let overrideModel: string | undefined;
  $effect(() => {
    const model = selectedModel;
    if (!model) {
      overrideProvider = undefined;
      overrideModel = undefined;
      return;
    }
    if (overrideProvider === undefined || overrideModel !== model) {
      overrideProvider =
        splitLegacyCompoundId(model).providerId ?? untrack(() => selectedProvider || undefined);
      overrideModel = model;
    }
  });

  onMount(async () => {
    // Fetch provider availability — the $effect above handles auto-selection
    // once providerAvailability is set. This avoids duplicating fallback logic
    // and ensures the user's explicit provider choice is respected consistently.
    try {
      providerAvailability = await getProviderAvailability();
      logger.debug('Provider availability loaded:', providerAvailability);
    } catch (error) {
      logger.error('Failed to check provider availability:', error);
    }
  });

  // When provider changes, clear any model override that belongs to a different provider.
  // This prevents stale model selections from showing up after mid-session provider switches
  // (e.g., from provider availability auto-selection).
  $effect(() => {
    const provider = selectedProvider;
    if (selectedModel && overrideProvider && overrideProvider !== provider) {
      logger.debug('Clearing stale model override (provider mismatch):', {
        selectedModel,
        modelProvider: overrideProvider,
        currentProvider: provider,
      });
      selectedModel = undefined;
      modelWasOverridden = false;
      overrideProvider = undefined;
      onModelChange?.(undefined);
      reconcileReasoningEffort(resolveEffectiveModel(selectedSpecialist));
    }
  });

  // Retain the existing modal-pickable gates for ordinary specialists. The
  // resolved orchestrator joins them in the same list below.
  const customSpecialists = $derived(
    sortSpecialistsByRecency(
      filterModalPickableSpecialists($specialists$, $isGitHubAuth$).filter(
        (s) => s.id !== orchestratorId,
      ),
      $recentSpecialistIds$,
    ),
  );

  // Treat General, the orchestrator, and internal team specialists separately.
  function isTeamRoleId(id: string | null): boolean {
    if (id === null) return true;
    if (id === orchestratorId) return true;
    return $specialists$.some((s) => s.id === id && s.role === 'internal');
  }

  // Check if selected specialist is represented by the built-in cards
  const isBuiltInSpecialist = $derived(isTeamRoleId(selectedSpecialist));

  // Check if selected specialist exists (might have been deleted)
  // Only check custom specialists after overrides are loaded to avoid false negatives during init
  const selectedSpecialistExists = $derived(
    isBuiltInSpecialist || $specialists$.some((s) => s.id === selectedSpecialist),
  );

  // Auto-reset if selected custom specialist was deleted: back to team mode
  // when an orchestrator exists, else single-agent General.
  // Only run after custom specialists are loaded to avoid resetting during initial load
  $effect(() => {
    if (
      $customSpecialistsLoaded$ &&
      !isBuiltInSpecialist &&
      !selectedSpecialistExists &&
      selectedSpecialist !== null
    ) {
      const fallback = orchestratorId;
      isTeamMode = fallback !== null;
      selectedSpecialist = fallback;
      selectedModel = undefined;
      modelWasOverridden = false;
      onTeamModeChange?.(isTeamMode);
      onSpecialistChange?.(fallback);
      onModelChange?.(undefined);
      reconcileReasoningEffort(resolveEffectiveModel(fallback));
    }
  });

  // No orchestrator in the resolved specialist set: the team card is hidden,
  // so team mode is unrepresentable — force single-agent mode.
  $effect(() => {
    if ($customSpecialistsLoaded$ && !orchestrator && isTeamMode) {
      isTeamMode = false;
      onTeamModeChange?.(false);
      if (selectedSpecialist !== null && !$specialists$.some((s) => s.id === selectedSpecialist)) {
        selectedSpecialist = null;
        onSpecialistChange?.(null);
      }
    }
  });

  // Team mode always creates with the live orchestrator: if a refresh swaps
  // which specialist resolves as orchestrator while team mode is selected
  // (the previous selection may still exist as a non-orchestrator), re-sync
  // selectedSpecialist so creation matches the rendered card.
  $effect(() => {
    if (isTeamMode && orchestratorId !== null && selectedSpecialist !== orchestratorId) {
      selectedSpecialist = orchestratorId;
      onSpecialistChange?.(orchestratorId);
    }
  });

  // Daemon-resolved default-model previews in the form's provider context.
  const previews = new SpecialistDefaultPreviews();
  const resolvedDefaultsByProvider = $derived(previews.byProvider);

  // Invalidate cached previews whenever the store's specialist view refreshes
  // (daemon `specialists:changed` → list subscription refetch), so the
  // resolvedModel preview tracks specialist/settings changes while the picker
  // stays mounted. The fetch effect below then refetches on demand.
  $effect(() => {
    void $specialists$;
    previews.invalidate();
  });

  $effect(() => previews.load(selectedProvider));

  // The displayed default model for a given specialist (shared with the
  // workspace suggestion card).
  function resolveEffectiveModel(specialist: string | null): string | undefined {
    return initialAgentDefaultModel({
      specialist,
      provider: selectedProvider,
      providerView: resolvedDefaultsByProvider[selectedProvider],
      specialists: $specialists$,
      configuredModels: $configuredModels$,
      activeProviderId: $activeProviderId$,
      selectedModel: $selectedModel$,
    });
  }

  // Effective model for the team mode card (based on actual selectedSpecialist)
  const teamModeModel = $derived(resolveEffectiveModel(selectedSpecialist));

  // Effective model for the single-agent card (based on displayedSpecialist to preserve across mode switches)
  const singleAgentModel = $derived.by(() => resolveEffectiveModel(displayedSpecialist));

  const activeModelForReasoning = $derived(
    modelWasOverridden && selectedModel
      ? selectedModel
      : isTeamMode
        ? teamModeModel
        : singleAgentModel,
  );

  // Settings fallback is a reactive preview, never a remembered override.
  // Leave creation-time inheritance to the daemon. Specialist pins/options
  // have their own precedence and must not be relabelled as the Settings default.
  const displayedReasoningEffort = $derived.by(() => {
    if (selectedReasoningEffort !== undefined) return selectedReasoningEffort || null;
    const model = activeModelForReasoning;
    const levels = modelEffortLevels(model);
    const resolvedSpecialist = selectedSpecialist
      ? resolvedDefaultsByProvider[selectedProvider]?.[selectedSpecialist]
      : undefined;
    const storedSpecialist = $specialists$.find((row) => row.id === selectedSpecialist);
    const specialist = resolvedSpecialist ?? storedSpecialist;
    const split = model ? splitLegacyCompoundId(model) : undefined;
    // The daemon inherits the first matching option, then frontmatter, even
    // for an explicit model. An option without a provider matches any provider.
    // The resolved effort preview describes only the default model, so an
    // explicit pick must use its matching option/frontmatter instead.
    const option = specialist?.modelOptions?.find(
      (option) =>
        option.model === split?.modelId &&
        (option.provider === undefined || option.provider === selectedProvider),
    );
    const specialistEffort =
      (!modelWasOverridden ? resolvedSpecialist?.resolvedReasoningEffort : undefined) ||
      option?.reasoningEffort ||
      specialist?.reasoningEffort;
    if (specialistEffort) {
      const effort = specialistEffort.trim();
      return effort && (levels === undefined || levels.includes(effort)) ? effort : null;
    }
    if (modelWasOverridden) return null;
    // A foreign (or legacy compound) specialist pin may have been ignored by
    // the daemon. It suppresses Settings only when it is the resolved model.
    const specialistModel = resolvedSpecialist
      ? resolvedSpecialist.model
      : storedSpecialist?.defaultModel;
    if (specialistModel && specialistModel === model) return null;
    // selectSelectedModel also falls back to a catalog default. Only the
    // persisted Settings selection makes the default effort apply at creation.
    const configuredModel = $configuredModels$[selectedProvider];
    if (!split || !configuredModel) return null;
    if (split.providerId && split.providerId !== selectedProvider) return null;
    if (split.modelId !== configuredModel) return null;
    const effort = $defaultReasoningEffort$.trim();
    return effort && (levels === undefined || levels.includes(effort)) ? effort : null;
  });

  // Keep the parent-owned effort valid as async default-model previews settle.
  // For a non-default provider, wait for that provider's specialist preview so
  // the fallback store view cannot clear a level the new default supports.
  $effect(() => {
    void $availableModels$;
    if (!selectedReasoningEffort) return;
    const defaultPreviewReady =
      modelWasOverridden ||
      !selectedSpecialist ||
      selectedProvider === $defaultProviderId$ ||
      selectedProvider in resolvedDefaultsByProvider;
    if (defaultPreviewReady) reconcileReasoningEffort(activeModelForReasoning);
  });

  // Known model catalog for a provider: the session-lifetime provider-models
  // cache first, else the global availableModels catalog when it was loaded
  // for that provider. A LOADED catalog counts as evidence even when empty —
  // a successful models.list response with zero models means the provider
  // has no models, so any override for it is invalid. `undefined` means no
  // catalog has been loaded for the provider yet (no evidence). Reads the
  // reactive cache-map readable so the clearing $effect re-runs when a
  // catalog lands after its last run.
  function knownModelsForProvider(
    providerId: string,
  ): Array<{ value: string; effortLevels?: string[] }> | undefined {
    // A machine as model source (chosen, or an orchestrator's first) is the evidence.
    if (startOnMachine)
      return machineReportedModels(startOnMachine, providerId, Date.now())?.map((value) => ({
        value,
      }));
    const normalizedProviderId = selectNormalizedProviderId.select(appStore.state, providerId);
    const cachedModels = $providerModelsCacheMap$[normalizedProviderId]?.models;
    if (cachedModels) return cachedModels;
    if ($availableModelsProviderId$ === normalizedProviderId) {
      return $availableModels$;
    }
    return undefined;
  }

  // Whether a restored override is provably invalid: its provider carries an
  // availability entry reporting it unavailable, or a loaded catalog for its
  // provider lacks the model (e.g. it was retired). With no evidence either
  // way (availability check pending, provider absent from the availability
  // result, no catalog loaded for the provider) the override is kept.
  function isRestoredOverrideInvalid(model: string): boolean {
    const split = splitLegacyCompoundId(model);
    const providerId =
      overrideProvider ?? split.providerId ?? (selectedProvider || $defaultProviderId$);
    const modelId = split.modelId;
    if (isProviderDisabledInSettings($enabledProviders$, providerId)) return true;
    const entry = getProviderStatusFromResult(providerAvailability, providerId);
    if (
      entry !== undefined &&
      (!entry.available || !isProviderAuthenticationReady(providerId, entry.authenticated))
    )
      return true;
    const knownModels = knownModelsForProvider(providerId);
    if (!knownModels) return false;
    return !knownModels.some((row) => row.value === model || row.value === modelId);
  }

  // Clear invalid model overrides restored from saved state
  // (intent-hq/monorepo#2678). A persisted override is cleared only on
  // positive evidence it is invalid (see isRestoredOverrideInvalid) — a valid
  // restored override survives hydration so an explicit pick persists across
  // sessions and is submitted as the initial agent's model. This runs
  // reactively (not onMount) so it waits until file specialists and the
  // parent's persisted form state are loaded — comparing before then is
  // meaningless — and re-runs if hydration re-applies a stale override after
  // mount. Overrides the user made in this session are never cleared.
  $effect(() => {
    const dataReady = $fileSpecialistsLoaded$ && $initializerHydrated$;
    if (!dataReady || modelOverriddenThisSession) return;
    // Degenerate persisted state: overridden flag set with no model. Normalize
    // so the invariant `modelWasOverridden ⇒ selectedModel set` holds.
    if (modelWasOverridden && !selectedModel) {
      logger.debug('Normalizing degenerate model-override state (flag set, no model)');
      modelWasOverridden = false;
      onModelChange?.(undefined);
      return;
    }
    if (modelWasOverridden && selectedModel && isRestoredOverrideInvalid(selectedModel)) {
      logger.debug('Clearing invalid persisted model override:', { selectedModel });
      selectedModel = undefined;
      modelWasOverridden = false;
      onModelChange?.(undefined);
    }
  });

  // Specialist dropdown state
  let specialistDropdownOpen = $state(false);
  let agentSearchInput = $state<HTMLInputElement | null>(null);
  let agentField = $state<HTMLDivElement>();
  let agentMenuBelow = $state(false);
  $effect(() => {
    if (!specialistDropdownOpen) return;
    return pushEscapeLayer(() => {
      specialistDropdownOpen = false;
    });
  });

  // Snapshot of mode-specific state so switching modes preserves selections
  interface ModeSnapshot {
    model: string | undefined;
    provider: string;
    modelOverridden: boolean;
    reasoningEffort: string | undefined;
    specialist: string | null; // only used by single-agent mode, but keep it uniform
  }

  const defaultProvider = $activeProviderId$ || $defaultProviderId$;

  // `specialist` is never restored from this snapshot (selectTeamMode always
  // re-resolves the live orchestrator id), so it starts null.
  let lastTeamMode = $state<ModeSnapshot>({
    model: undefined,
    provider: defaultProvider,
    modelOverridden: false,
    reasoningEffort: untrack(() => selectedReasoningEffort),
    specialist: null,
  });

  // Seeded from the incoming single-agent selection so switching to team mode
  // and back restores it; in team mode there is no single-agent selection yet.
  let lastSingleAgent = $state<ModeSnapshot>({
    model: undefined,
    provider: defaultProvider,
    modelOverridden: false,
    reasoningEffort: untrack(() => selectedReasoningEffort),
    specialist: untrack(() => (isTeamMode ? null : selectedSpecialist)),
  });

  // The specialist to display in the single-agent card — uses the saved value when in team mode
  const displayedSpecialist = $derived(
    isTeamMode ? lastSingleAgent.specialist : selectedSpecialist,
  );

  // Get current specialist info for display
  const currentSpecialistInfo = $derived(
    displayedSpecialist && !isTeamRoleId(displayedSpecialist)
      ? $specialists$.find((s) => s.id === displayedSpecialist)
      : null,
  );

  // Display label and description for the specialist selector
  const specialistDisplayLabel = $derived(
    currentSpecialistInfo?.name ?? m.workspace_initialAgentPicker_general_label(),
  );
  function selectTeamMode() {
    if (isTeamMode) return;
    // Orchestration is available only when its specialist is present.
    if (orchestratorId === null) return;
    onSetupPick?.();
    // Save single-agent state
    lastSingleAgent = {
      model: selectedModel,
      provider: selectedProvider,
      modelOverridden: modelWasOverridden,
      reasoningEffort: selectedReasoningEffort,
      specialist: selectedSpecialist,
    };

    isTeamMode = true;
    selectedSpecialist = orchestratorId;
    // Restore provider BEFORE model to prevent the provider-mismatch $effect from clearing it
    selectedProvider = lastTeamMode.provider;
    selectedModel = lastTeamMode.modelOverridden ? lastTeamMode.model : undefined;
    overrideProvider = lastTeamMode.modelOverridden ? lastTeamMode.provider : undefined;
    overrideModel = lastTeamMode.modelOverridden ? selectedModel : undefined;
    modelWasOverridden = lastTeamMode.modelOverridden;
    onTeamModeChange?.(true);
    onSpecialistChange?.(orchestratorId);
    if (lastTeamMode.modelOverridden) {
      onModelChange?.(selectedModel);
      onProviderChange?.(selectedProvider);
    }
    updateReasoningEffort(lastTeamMode.reasoningEffort ?? selectedReasoningEffort);
    reconcileReasoningEffort(selectedModel ?? teamModeModel);
  }

  function selectSingleAgentMode() {
    if (isTeamMode) {
      onSetupPick?.();
      // Save team mode state
      lastTeamMode = {
        model: selectedModel,
        provider: selectedProvider,
        modelOverridden: modelWasOverridden,
        reasoningEffort: selectedReasoningEffort,
        specialist: orchestratorId,
      };

      isTeamMode = false;
      selectedSpecialist = lastSingleAgent.specialist;
      // Restore provider BEFORE model
      selectedProvider = lastSingleAgent.provider;
      selectedModel = lastSingleAgent.model;
      overrideProvider = lastSingleAgent.modelOverridden ? lastSingleAgent.provider : undefined;
      overrideModel = lastSingleAgent.modelOverridden ? selectedModel : undefined;
      modelWasOverridden = lastSingleAgent.modelOverridden;
      onTeamModeChange?.(false);
      onSpecialistChange?.(selectedSpecialist);
      if (lastSingleAgent.modelOverridden) {
        onModelChange?.(selectedModel);
        onProviderChange?.(selectedProvider);
      }
      updateReasoningEffort(lastSingleAgent.reasoningEffort ?? selectedReasoningEffort);
      reconcileReasoningEffort(selectedModel ?? singleAgentModel);
    }
    // If already in single-agent mode, do nothing (specialist dropdown handles changes)
  }

  function handleSpecialistSelect(specialistId: string | null) {
    onSetupPick?.();
    isTeamMode = false;
    selectedSpecialist = specialistId;
    lastSingleAgent.specialist = specialistId;
    // Always reset model when switching specialists — let defaultModelId drive the display
    selectedModel = undefined;
    modelWasOverridden = false;
    // Reset provider to default when clearing model override
    const fallback = defaultInitialAgentProvider({
      ...providerAvailabilityContext,
      activeProviderId: $activeProviderId$,
      defaultProviderId: $defaultProviderId$,
      availableProviders,
    });
    if (selectedProvider !== fallback) {
      selectedProvider = fallback;
      onProviderChange?.(fallback);
    }
    onTeamModeChange?.(false);
    onSpecialistChange?.(specialistId);
    onModelChange?.(undefined);
    reconcileReasoningEffort(resolveEffectiveModel(specialistId));
    specialistDropdownOpen = false;
  }

  function handleModelChange(
    model: string | undefined,
    pick?: { providerId: string; modelId: string },
  ) {
    // The picker reports the resolved triple legs on every pick: store the
    // bare model id paired with its provider (no model-string parsing here).
    const explicitModel = (pick?.modelId ?? model) || undefined;
    onSetupPick?.();
    selectedModel = explicitModel;
    modelWasOverridden = !!explicitModel;
    modelOverriddenThisSession = !!explicitModel;
    overrideProvider = explicitModel ? (pick?.providerId ?? selectedProvider) : undefined;
    overrideModel = explicitModel;

    // Update provider to match the selected model's provider
    if (explicitModel && pick?.providerId && pick.providerId !== selectedProvider) {
      selectedProvider = pick.providerId;
      onProviderChange?.(pick.providerId);
    }

    reconcileReasoningEffort(
      explicitModel ?? resolveEffectiveModel(isTeamMode ? selectedSpecialist : displayedSpecialist),
    );
    onModelChange?.(explicitModel);
  }

  // Agent menu pick. Leaving orchestration first restores the single-agent
  // snapshot (model, provider, effort), so re-picking the remembered
  // specialist keeps its model override; another specialist resets it.
  function handleAgentSelect(specialistId: string | null) {
    specialistDropdownOpen = false;
    if (isTeamMode) {
      selectSingleAgentMode();
      if (selectedSpecialist === specialistId) return;
    } else if (selectedSpecialist === specialistId) {
      return;
    }
    handleSpecialistSelect(specialistId);
  }

  function handleOrchestrationSelect() {
    specialistDropdownOpen = false;
    selectTeamMode();
  }

  // Present the orchestrator by its own name, like any other specialist.
  const orchestratorLabel = $derived(
    orchestrator?.name || m.workspace_initialAgentPicker_teamMode_label(),
  );
  const agentDisplayLabel = $derived(
    isTeamMode && orchestrator ? orchestratorLabel : specialistDisplayLabel,
  );
  const activeDefaultModel = $derived(isTeamMode ? teamModeModel : singleAgentModel);
  const agentSpecialists = $derived(
    sortSpecialistsByRecency(
      [...(orchestrator ? [orchestrator] : []), ...customSpecialists],
      $recentSpecialistIds$,
    ),
  );
  const agentOptions = $derived<ComboboxOption[]>([
    ...agentSpecialists.map((specialist) => ({
      value: specialist.id === orchestratorId ? 'orchestration' : `specialist:${specialist.id}`,
      label: specialist.name,
    })),
    { value: 'general', label: m.workspace_initialAgentPicker_general_label() },
  ]);
  const selectedAgentValue = $derived(
    isTeamMode && orchestrator
      ? 'orchestration'
      : selectedSpecialist && !isTeamRoleId(selectedSpecialist)
        ? `specialist:${selectedSpecialist}`
        : 'general',
  );

  function handleAgentCommit(value: string | string[]) {
    if (typeof value !== 'string') return;
    if (value === 'orchestration') handleOrchestrationSelect();
    else if (value === 'general') handleAgentSelect(null);
    else if (value.startsWith('specialist:')) handleAgentSelect(value.slice('specialist:'.length));
  }

  async function openSpecialistSettings() {
    specialistDropdownOpen = false;
    onNavigateAway?.();
    await tick();
    await navigateToSettings({ view: 'create-specialist' });
  }
</script>

<div
  class="agent-settings"
  class:footer={presentation === 'footer'}
  data-testid="initial-agent-picker"
>
  <div bind:this={agentField} class={presentation === 'footer' ? 'min-w-0' : 'w-full'}>
    <Popover.Root
      bind:open={specialistDropdownOpen}
      onOpenChange={(open) => {
        if (!open) return;
        // A wide field can leave neither horizontal side room for the menu.
        // Floating placement flips between sides; use below in that case.
        agentMenuBelow = !canPlaceBeside(agentField, 360);
      }}
    >
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="sm"
            type="button"
            wrapContent={false}
            active={specialistDropdownOpen}
            aria-labelledby="{agentLabelId} {agentValueId}"
            class={presentation === 'footer'
              ? 'h-9 min-w-0 max-w-36 gap-1 px-2 text-sm font-normal'
              : workspacePickerStyles.fieldTrigger}
          >
            <span
              class={presentation === 'footer' ? 'sr-only' : workspacePickerStyles.fieldLabel}
              id={agentLabelId}>{m.workspace_initialAgentPicker_agent_label()}</span
            >
            {#if presentation === 'footer'}
              {@const specialist = isTeamMode ? orchestrator : currentSpecialistInfo}
              <span class={cn('plain-agent-icon flex', workspacePickerStyles.icon)}>
                <AgentAvatar
                  agentId="blank"
                  variant="compact"
                  specialist={specialist?.id ?? null}
                  icon={specialist?.icon}
                />
              </span>
            {/if}
            <span class="min-w-0 flex-1 truncate text-left" id={agentValueId}
              >{agentDisplayLabel}</span
            >
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content
        role="dialog"
        aria-label={m.workspace_initialAgentPicker_agent_label()}
        side={presentation === 'footer'
          ? 'top'
          : isMobile.current || agentMenuBelow
            ? 'bottom'
            : 'left'}
        sideOffset={presentation === 'footer' || isMobile.current || agentMenuBelow ? 4 : 24}
        align={presentation === 'footer'
          ? 'start'
          : isMobile.current || agentMenuBelow
            ? 'end'
            : 'start'}
        preventScroll={false}
        class="flex min-h-0 w-[360px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0"
        style="max-height: {SPECIALIST_MENU_MAX_HEIGHT}"
        portalProps={{ to: dialogPortalTarget() }}
        strategy={dialogPortalTarget() ? 'absolute' : 'fixed'}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          agentSearchInput?.focus();
        }}
        onkeydown={(event) => {
          if (event.key === 'Enter') event.stopPropagation();
        }}
      >
        <Combobox
          value={selectedAgentValue}
          options={agentOptions}
          open={specialistDropdownOpen}
          bind:inputRef={agentSearchInput}
          ariaLabel={m.workspace_initialAgentPicker_agent_label()}
          searchPlaceholder={m.workspace_multiSelectSidebar_searchAgents_placeholder()}
          emptyText={m.workspace_agentsList_noSearchResults_label()}
          staticPosition
          size="compact"
          class="flex min-h-0 flex-1 flex-col gap-1 px-2 pt-1"
          inputVariant="search"
          inputClass="shrink-0"
          rowClass={workspacePickerStyles.row}
          viewportClass="min-h-0 max-h-none flex-1 p-0 pb-2"
          contentClass="flex min-h-0 max-h-none flex-1 flex-col border-0 shadow-none"
          oncommit={handleAgentCommit}
          onopenchange={(open) => {
            if (!open) specialistDropdownOpen = false;
          }}
        >
          {#snippet optionIcon(option)}
            {@const specialist = agentSpecialists.find((item) =>
              option.value === 'orchestration'
                ? item.id === orchestratorId
                : `specialist:${item.id}` === option.value,
            )}
            <span class={cn('plain-agent-icon flex', workspacePickerStyles.icon)}>
              <AgentAvatar
                agentId="blank"
                variant="compact"
                specialist={specialist?.id ?? null}
                icon={specialist?.icon}
              />
            </span>
          {/snippet}
        </Combobox>
        <div class="shrink-0 border-t border-border p-2">
          <ActionRow class={workspacePickerStyles.row} onclick={openSpecialistSettings}>
            {#snippet leading()}<Fa icon={faPlus} class={workspacePickerStyles.icon} />{/snippet}
            {#snippet title()}{m.workspace_initialAgentPicker_manageSpecialists_label()}{/snippet}
          </ActionRow>
        </div>
      </Popover.Content>
    </Popover.Root>
  </div>

  {#key activeDefaultModel}
    <ModelPicker
      selectedModel={modelWasOverridden ? selectedModel : undefined}
      providerId={selectedProvider}
      onModelChange={handleModelChange}
      variant="ghost-light"
      size="sm"
      fullWidth={presentation !== 'footer'}
      rowLabel={m.workspace_initialAgentPicker_model_label()}
      showRowLabel={presentation !== 'footer'}
      showTriggerIcons={false}
      showProfileName={false}
      menuSide={presentation === 'footer' || isMobile.current ? 'bottom' : 'left'}
      menuSideOffset={24}
      menuMaxHeight={440}
      triggerClass={presentation === 'footer'
        ? 'h-9 min-w-0 max-w-36 px-2 text-sm font-normal'
        : workspacePickerStyles.fieldTrigger}
      showReasoning
      reasoningEffort={displayedReasoningEffort}
      onReasoningChange={handleReasoningChange}
      showManageLink={true}
      defaultModelId={activeDefaultModel}
      defaultModelLabel={m.chat_modelPicker_providerDefault_label()}
      fallbackToCatalogDefault
      fallbackProviderId={selectedProvider}
      machineId={modelMachineId}
      showMachine={false}
      silentFallback
      portal={true}
      modalAware={true}
      collisionBoundary="viewport"
    />
  {/key}

  {#if $startOnVisible$}
    <StartOnPicker
      {presentation}
      value={effectiveStartOn}
      options={startOnChoices}
      onChange={handleStartOnChange}
      lockedReason={startOnBackendOnly === 'plain-folder'
        ? m.workspace_initialAgentPicker_startOnPlainFolder_description({
            backend: startOnBackendLabel($startOnOptions$),
          })
        : startOnBackendOnly === 'new-repo'
          ? m.workspace_initialAgentPicker_startOnNewRepo_description({
              backend: startOnBackendLabel($startOnOptions$),
            })
          : undefined}
    />
  {/if}
</div>

<style>
  /* Whole-row triggers stack; each owns its label and value. */
  .agent-settings {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .agent-settings.footer {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
  }

  /* Outline glyph only: no avatar tile, ink follows the row text. */
  .plain-agent-icon :global(.agent-avatar) {
    background: transparent;
    color: currentColor;
    padding: 0;
  }
</style>
