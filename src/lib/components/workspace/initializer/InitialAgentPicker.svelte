<script lang="ts">
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';

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
  } from '$store/renderer/slices/model/model-selectors';
  import { selectWorkspaceInitializerHydrated } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { faPlus, faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import {
    getProviderAvailability,
    type ProviderAvailabilityResult,
  } from '$features/providers/provider-availability.client';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import {
    selectEffectiveDefaultProviderId,
    selectNormalizedProviderId,
    selectProviderCatalogEntries,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import {
    selectProviderModelsCacheEntry,
    selectProviderModelsCacheMap,
  } from '$store/renderer/slices/provider-models/provider-models-selectors';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { appClient } from '$lib/client';
  import { createLogger } from '$lib/utils/client-logger';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('InitialAgentPicker');
  const defaultProviderId$ = selectEffectiveDefaultProviderId();
  const catalogEntries$ = selectProviderCatalogEntries();
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
  const activeProviderId$ = selectActiveProviderId();
  const selectedModel$ = selectSelectedModel();
  const availableModels$ = selectAvailableModels();
  const availableModelsProviderId$ = selectAvailableModelsProviderId();
  const providerModelsCacheMap$ = selectProviderModelsCacheMap();

  interface Props {
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
    /** Callback when model changes */
    onModelChange?: (model: string | undefined) => void;
    /** Callback when reasoning effort changes */
    onReasoningEffortChange?: (effort: string | undefined) => void;
    /** Callback when team mode changes */
    onTeamModeChange?: (isTeamMode: boolean) => void;
    /** Callback when provider changes (called when auto-selected) */
    onProviderChange?: (providerId: string) => void;
  }

  let {
    selectedSpecialist = $bindable<string | null>($orchestrator$?.id ?? null),
    selectedModel = $bindable<string | undefined>(undefined),
    modelWasOverridden = $bindable<boolean>(false),
    selectedReasoningEffort = $bindable<string | undefined>(undefined),
    isTeamMode = $bindable<boolean>(true),
    selectedProvider = $bindable<string>($activeProviderId$ || $defaultProviderId$),
    onSpecialistChange,
    onModelChange,
    onReasoningEffortChange,
    onTeamModeChange,
    onProviderChange,
  }: Props = $props();

  function updateReasoningEffort(effort: string | undefined) {
    if (selectedReasoningEffort === effort) return;
    selectedReasoningEffort = effort;
    onReasoningEffortChange?.(effort);
  }

  function reconcileReasoningEffort(model: string | undefined) {
    void $availableModels$;
    if (!selectedReasoningEffort || !model) return;
    let levels = selectModelEffortLevels.select(appStore.state, model);
    if (levels === undefined) {
      const split = splitLegacyCompoundId(model);
      const providerId = split.providerId ?? $defaultProviderId$;
      const modelId = split.modelId;
      const normalizedProviderId = selectNormalizedProviderId.select(appStore.state, providerId);
      const cachedModels = selectProviderModelsCacheEntry.select(
        appStore.state,
        normalizedProviderId,
      )?.models;
      levels = cachedModels?.find(
        (row) => row.value === model || row.value === modelId,
      )?.effortLevels;
    }
    if (levels === undefined) return;
    if (!levels.includes(selectedReasoningEffort)) updateReasoningEffort(undefined);
  }

  function handleReasoningChange(effort: string | null) {
    updateReasoningEffort(effort ?? undefined);
    return true;
  }

  // Provider availability state (for auto-selection only, no UI picker)
  let providerAvailability = $state<ProviderAvailabilityResult | null>(null);

  // Map provider IDs to keys used in ProviderAvailabilityResult
  const providerAvailabilityKeyMap: Record<
    string,
    keyof ProviderAvailabilityResult['providers']
  > = {
    auggie: 'auggie',
    'claude-code': 'claudeCode',
    codex: 'codex',
    mock: 'mock',
    opencode: 'opencode',
    droid: 'droid',
    grok: 'grok',
    unsloth: 'unsloth',
    cortex: 'cortex',
    pi: 'pi',
  };

  // The availability entry for a provider, or undefined when the check has
  // not completed or the result carries no entry for it (unknown provider).
  function providerAvailabilityEntry(providerId: string) {
    if (!providerAvailability) return undefined;
    const key = providerAvailabilityKeyMap[providerId];
    return key ? providerAvailability.providers[key] : undefined;
  }

  // Helper to get provider availability from result (handles different key formats)
  function getProviderAvailable(providerId: string): boolean {
    return providerAvailabilityEntry(providerId)?.available ?? false;
  }

  // Available providers derived from availability check - dynamically from the catalog
  const availableProviders = $derived.by(() => {
    if (!providerAvailability) return [];
    return $catalogEntries$
      .filter((provider) => getProviderAvailable(provider.id))
      .map((provider) => ({ id: provider.id }));
  });

  // Auto-select first available provider if current selection is unavailable
  // BUT: Don't override if the provider matches the user's explicit choice from the active provider selector
  $effect(() => {
    if (providerAvailability && availableProviders.length > 0) {
      const isSelectedAvailable = availableProviders.some((p) => p.id === selectedProvider);
      if (!isSelectedAvailable) {
        // Check if this is the user's explicit choice from the provider store.
        // '' (unresolved — settings not hydrated / providers.active unset) is
        // never an explicit choice, so it must not block the auto-select.
        const userExplicitChoice = $activeProviderId$;
        if (selectedProvider && selectedProvider === userExplicitChoice) {
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
    if (selectedModel) {
      const modelProvider = splitLegacyCompoundId(selectedModel).providerId ?? $defaultProviderId$;
      if (modelProvider !== provider) {
        logger.debug('Clearing stale model override (provider mismatch):', {
          selectedModel,
          modelProvider,
          currentProvider: provider,
        });
        selectedModel = undefined;
        modelWasOverridden = false;
        onModelChange?.(undefined);
        reconcileReasoningEffort(resolveEffectiveModel(selectedSpecialist));
      }
    }
  });

  // Specialists offered in the single-agent dropdown: the modal-pickable set
  // (GitHub gating + `hidden` + `role: internal` excluded) minus the
  // orchestrator, which is represented by the team card.
  const customSpecialists = $derived(
    filterModalPickableSpecialists($specialists$, $isGitHubAuth$).filter(
      (s) => s.id !== orchestratorId,
    ),
  );

  // Avatar row for the team card: the orchestrator's declared teamAgents,
  // resolved against the specialist set for their `icon` metadata. Unknown
  // ids still render (AgentAvatar degrades to its fallback design); absent
  // teamAgents yields an empty row (orchestrator avatar only). Duplicate ids
  // are collapsed — they would break the keyed each rendering the row.
  const teamAgentAvatars = $derived(
    [...new Set(orchestrator?.teamAgents ?? [])].map((id) => ({
      id,
      icon: $specialists$.find((s) => s.id === id)?.icon,
    })),
  );

  // Whether an id maps to the mode cards rather than a dropdown row:
  // General (null), the orchestrator (team card), or a role-internal
  // team specialist.
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

  // Daemon-resolved default-model previews per provider context (PROTOCOL
  // §5.11): `specialist.list` with the form's selected provider returns
  // additive `resolvedModel`/`resolvedProvider` fields computed by the same
  // resolver a no-model create uses, so the picker displays exactly what the
  // daemon would pin. Absent resolvedModel means "Provider default". The
  // store's specialist view carries the daemon-default-provider context, so
  // it serves as the fallback until the per-provider fetch lands.
  let resolvedModelsByProvider = $state<Record<string, Record<string, string | undefined>>>({});

  // Bumped on every store specialist-view refresh; in-flight fetches from an
  // older generation are dropped so they can't overwrite fresher previews.
  let previewsGeneration = 0;

  // Invalidate cached previews whenever the store's specialist view refreshes
  // (daemon `specialists:changed` → list subscription refetch), so the
  // resolvedModel preview tracks specialist/settings changes while the picker
  // stays mounted. The fetch effect below then refetches on demand.
  $effect(() => {
    void $specialists$;
    previewsGeneration += 1;
    resolvedModelsByProvider = {};
  });

  $effect(() => {
    const provider = selectedProvider;
    if (!provider || provider in resolvedModelsByProvider) return;
    const generation = previewsGeneration;
    void (async () => {
      try {
        const defs = await appClient.specialists.list(provider);
        if (generation !== previewsGeneration || defs.length === 0) return;
        const byId: Record<string, string | undefined> = {};
        for (const def of defs) byId[def.id] = def.resolvedModel;
        resolvedModelsByProvider = { ...resolvedModelsByProvider, [provider]: byId };
      } catch (error) {
        logger.debug('Failed to fetch resolved-model previews:', { provider, error });
      }
    })();
  });

  // Helper to resolve the displayed default model for a given specialist:
  // the daemon-computed `resolvedModel` preview in the form's provider
  // context (undefined ⇒ provider CLI default, rendered "Provider default").
  // With no specialist (General), show the global store selection — it
  // mirrors the daemon's `model.providerDefaults`/`model.default` settings
  // that the resolver applies for a specialist-less create.
  function resolveEffectiveModel(specialist: string | null): string | undefined {
    if (!specialist) return $selectedModel$;
    const providerView = resolvedModelsByProvider[selectedProvider];
    if (providerView) return providerView[specialist];
    return $specialists$.find((s) => s.id === specialist)?.resolvedModel;
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
      selectedProvider in resolvedModelsByProvider;
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
  function knownModelsForProvider(providerId: string): Array<{ value: string }> | undefined {
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
    const providerId = split.providerId ?? $defaultProviderId$;
    const modelId = split.modelId;
    if (providerAvailabilityEntry(providerId)?.available === false) return true;
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

  // Snapshot of mode-specific state so switching modes preserves selections
  interface ModeSnapshot {
    model: string | undefined;
    provider: string;
    modelOverridden: boolean;
    specialist: string | null; // only used by single-agent mode, but keep it uniform
  }

  const defaultProvider = $activeProviderId$ || $defaultProviderId$;

  // `specialist` is never restored from this snapshot (selectTeamMode always
  // re-resolves the live orchestrator id), so it starts null.
  let lastTeamMode = $state<ModeSnapshot>({
    model: undefined,
    provider: defaultProvider,
    modelOverridden: false,
    specialist: null,
  });

  let lastSingleAgent = $state<ModeSnapshot>({
    model: undefined,
    provider: defaultProvider,
    modelOverridden: false,
    specialist: null,
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
  const specialistDisplayDescription = $derived(
    currentSpecialistInfo?.description ??
      m.workspace_initialAgentPicker_noSpecializedBehavior_description(),
  );

  function selectTeamMode() {
    if (isTeamMode) return;
    // Team mode requires an orchestrator; the card is hidden without one.
    if (orchestratorId === null) return;
    // Save single-agent state
    lastSingleAgent = {
      model: selectedModel,
      provider: selectedProvider,
      modelOverridden: modelWasOverridden,
      specialist: selectedSpecialist,
    };

    isTeamMode = true;
    selectedSpecialist = orchestratorId;
    // Restore provider BEFORE model to prevent the provider-mismatch $effect from clearing it
    selectedProvider = lastTeamMode.provider;
    selectedModel = lastTeamMode.modelOverridden ? lastTeamMode.model : undefined;
    modelWasOverridden = lastTeamMode.modelOverridden;
    onTeamModeChange?.(true);
    onSpecialistChange?.(orchestratorId);
    if (lastTeamMode.modelOverridden) {
      onModelChange?.(selectedModel);
      onProviderChange?.(selectedProvider);
    }
    reconcileReasoningEffort(selectedModel ?? teamModeModel);
  }

  function selectSingleAgentMode() {
    if (isTeamMode) {
      // Save team mode state
      lastTeamMode = {
        model: selectedModel,
        provider: selectedProvider,
        modelOverridden: modelWasOverridden,
        specialist: orchestratorId,
      };

      isTeamMode = false;
      selectedSpecialist = lastSingleAgent.specialist;
      // Restore provider BEFORE model
      selectedProvider = lastSingleAgent.provider;
      selectedModel = lastSingleAgent.model;
      modelWasOverridden = lastSingleAgent.modelOverridden;
      onTeamModeChange?.(false);
      onSpecialistChange?.(selectedSpecialist);
      if (lastSingleAgent.modelOverridden) {
        onModelChange?.(selectedModel);
        onProviderChange?.(selectedProvider);
      }
      reconcileReasoningEffort(selectedModel ?? singleAgentModel);
    }
    // If already in single-agent mode, do nothing (specialist dropdown handles changes)
  }

  function handleSpecialistSelect(specialistId: string | null) {
    isTeamMode = false;
    selectedSpecialist = specialistId;
    lastSingleAgent.specialist = specialistId;
    // Always reset model when switching specialists — let defaultModelId drive the display
    selectedModel = undefined;
    modelWasOverridden = false;
    // Reset provider to default when clearing model override
    const defaultProv = $activeProviderId$ || $defaultProviderId$;
    if (selectedProvider !== defaultProv) {
      selectedProvider = defaultProv;
      onProviderChange?.(defaultProv);
    }
    onTeamModeChange?.(false);
    onSpecialistChange?.(specialistId);
    onModelChange?.(undefined);
    reconcileReasoningEffort(resolveEffectiveModel(specialistId));
    specialistDropdownOpen = false;
  }

  function handleModelChange(model: string | undefined) {
    const explicitModel = model || undefined;
    selectedModel = explicitModel;
    modelWasOverridden = !!explicitModel;
    modelOverriddenThisSession = !!explicitModel;

    // Update provider to match the selected model's provider
    if (explicitModel) {
      const providerId = splitLegacyCompoundId(explicitModel).providerId ?? $defaultProviderId$;
      if (providerId !== selectedProvider) {
        selectedProvider = providerId;
        onProviderChange?.(providerId);
      }
    }

    reconcileReasoningEffort(
      explicitModel ?? resolveEffectiveModel(isTeamMode ? selectedSpecialist : displayedSpecialist),
    );
    onModelChange?.(explicitModel);
  }

  async function openSpecialistSettings() {
    await navigateToSettings({ view: 'create-specialist' });
    specialistDropdownOpen = false;
  }
</script>

<!-- Agent mode cards -->
<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
  <!-- Team orchestration card — hidden when the resolved set has no orchestrator -->
  {#if orchestrator}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="agent-card min-w-0 {isTeamMode
        ? 'border-input bg-accent/60'
        : 'border-border bg-card hover:bg-muted/50'}"
      onclick={selectTeamMode}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectTeamMode();
        }
      }}
      role="button"
      tabindex="0"
      aria-pressed={isTeamMode}
    >
      <div class="text-sm font-medium text-foreground">
        {m.workspace_initialAgentPicker_teamMode_label()}
      </div>
      <div class="flex items-center gap-1 py-1.5">
        <AgentAvatar agentId="blank" size={22} specialist={orchestrator.id} icon={orchestrator.icon} />
        {#if teamAgentAvatars.length > 0}
          <span class="text-subtle text-xs mx-0.5">→</span>
          {#each teamAgentAvatars as teamAgent (teamAgent.id)}
            <AgentAvatar agentId="blank" size={22} specialist={teamAgent.id} icon={teamAgent.icon} />
          {/each}
        {/if}
      </div>
      <div class="text-sm text-subtle leading-snug">
        {m.workspace_initialAgentPicker_teamMode_description()}
      </div>
      <div
        class="model-picker-row {isTeamMode ? '' : 'opacity-0 pointer-events-none'}"
        inert={!isTeamMode}
        onclick={(event) => event.stopPropagation()}
        onkeydown={(event) => event.stopPropagation()}
      >
        <span class="text-sm text-subtle">{m.workspace_initialAgentPicker_using_before()}</span>
        {#key teamModeModel}
          <ModelPicker
            selectedModel={modelWasOverridden ? selectedModel : undefined}
            onModelChange={handleModelChange}
            variant="ghost-light"
            size="xs"
            showReasoning
            reasoningEffort={selectedReasoningEffort ?? null}
            onReasoningChange={handleReasoningChange}
            showManageLink={true}
            defaultModelId={teamModeModel}
            defaultModelLabel={m.chat_modelPicker_providerDefault_label()}
            fallbackToCatalogDefault
            fallbackProviderId={selectedProvider}
            noticeClass="basis-full w-full max-w-full mt-1.5"
            silentFallback
            portal={false}
            modalAware={true}
            collisionBoundary="[data-model-picker-collision-boundary]"
          />
        {/key}
      </div>
    </div>
  {/if}

  <!-- Single agent card -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="agent-card min-w-0 {!isTeamMode
      ? 'border-input bg-accent/60'
      : 'border-border bg-card hover:bg-muted/50'}"
    onclick={selectSingleAgentMode}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectSingleAgentMode();
      }
    }}
    role="button"
    tabindex="0"
    aria-pressed={!isTeamMode}
  >
    <div class="text-sm font-medium text-foreground">
      {m.workspace_initialAgentPicker_singleAgent_label()}
    </div>
    <!-- Specialist selector dropdown -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-full"
      onclick={(e) => {
        if (!isTeamMode) e.stopPropagation();
      }}
    >
      <DropdownMenu
        class="w-full"
        bind:open={specialistDropdownOpen}
        align="start"
        side="bottom"
        contentClass="p-0!"
      >
        {#snippet trigger({ props })}
          <button
            {...isTeamMode ? {} : props}
            type="button"
            tabindex={isTeamMode ? -1 : 0}
            onclick={(e) => {
              if (isTeamMode) {
                // First click selects single-agent mode — let it bubble to the parent card
                return;
              }
              e.stopPropagation();
              (props.onclick as ((event: MouseEvent) => void) | undefined)?.(e);
            }}
            class="specialist-trigger"
          >
            <AgentAvatar
              agentId="blank"
              variant="standard"
              specialist={currentSpecialistInfo ? displayedSpecialist : null}
              icon={currentSpecialistInfo?.icon}
            />
            <div class="flex flex-col min-w-0 flex-1">
              <span class="font-medium text-foreground text-sm leading-tight"
                >{specialistDisplayLabel}</span
              >
              <span class="text-xs text-subtle leading-tight truncate"
                >{specialistDisplayDescription}</span
              >
            </div>
            <Fa icon={faChevronDown} class="text-ghost h-2.5! w-2.5! shrink-0" />
          </button>
        {/snippet}

        {#snippet content()}
          <div class="min-w-[220px] max-h-[300px] overflow-y-auto">
            <!-- General (blank) option -->
            <button
              type="button"
              class="specialist-option {selectedSpecialist === null ||
              (selectedSpecialist && isTeamRoleId(selectedSpecialist))
                ? 'specialist-option-selected'
                : ''}"
              onclick={() => handleSpecialistSelect(null)}
            >
              <AgentAvatar agentId="blank" variant="standard" />
              <div class="flex flex-col min-w-0">
                <span class="font-medium text-foreground text-sm"
                  >{m.workspace_initialAgentPicker_general_label()}</span
                >
                <span class="text-xs text-subtle"
                  >{m.workspace_initialAgentPicker_noSpecializedBehavior_description()}</span
                >
              </div>
            </button>

            {#if customSpecialists.length > 0}
              <div class="h-px bg-border"></div>

              {#each customSpecialists as specialist (specialist.id)}
                <button
                  type="button"
                  class="specialist-option {selectedSpecialist === specialist.id
                    ? 'specialist-option-selected'
                    : ''}"
                  onclick={() => handleSpecialistSelect(specialist.id)}
                >
                  <AgentAvatar
                    agentId="blank"
                    variant="standard"
                    specialist={specialist.id}
                    icon={specialist.icon}
                  />
                  <div class="flex flex-col min-w-0">
                    <span class="font-medium text-foreground text-sm">{specialist.name}</span>
                    <span class="text-xs text-subtle truncate">{specialist.description}</span>
                  </div>
                </button>
              {/each}
            {/if}

            <!-- Create new specialist link -->
            <button
              type="button"
              class="sticky bottom-0 border-t border-border bg-background px-4 gap-3 py-1 z-10 w-full flex items-center text-subtle cursor-pointer"
              onclick={openSpecialistSettings}
            >
              <Fa icon={faPlus} class="ml-0.5 mr-0.5 opacity-60" size={10} />
              <span class="text-sm">{m.workspace_initialAgentPicker_manageSpecialists_label()}</span
              >
            </button>
          </div>
        {/snippet}
      </DropdownMenu>
    </div>

    <p class="text-sm text-subtle leading-snug">
      {m.workspace_initialAgentPicker_singleAgent_description()}
    </p>

    <div
      class="model-picker-row {!isTeamMode ? '' : 'opacity-0 pointer-events-none'}"
      inert={isTeamMode}
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <span class="text-sm text-subtle">{m.workspace_initialAgentPicker_using_before()}</span>
      {#key singleAgentModel}
        <ModelPicker
          selectedModel={modelWasOverridden ? selectedModel : undefined}
          onModelChange={handleModelChange}
          variant="ghost-light"
          size="xs"
          showReasoning
          reasoningEffort={selectedReasoningEffort ?? null}
          onReasoningChange={handleReasoningChange}
          showManageLink={true}
          defaultModelId={singleAgentModel}
          defaultModelLabel={m.chat_modelPicker_providerDefault_label()}
          fallbackToCatalogDefault
          fallbackProviderId={selectedProvider}
          noticeClass="basis-full w-full max-w-full mt-1.5"
          silentFallback
          portal={false}
          modalAware={true}
          collisionBoundary="[data-model-picker-collision-boundary]"
        />
      {/key}
    </div>
  </div>
</div>

<style>
  .agent-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    min-height: 9.75rem;
    padding: 1rem;
    border-width: 1px;
    border-style: solid;
    border-radius: var(--radius-lg);
    cursor: pointer;
    text-align: left;
    transition:
      background-color var(--motion-fast),
      border-color var(--motion-fast),
      box-shadow var(--motion-fast);
  }

  .agent-card:focus-visible {
    outline: none;
    border-color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-accent) 72%, var(--color-card));
  }

  .model-picker-row {
    display: flex;
    /* Wrap so ModelPicker's provider notice lands on its own full-width line
       below the "using <picker>" row instead of inline next to the trigger. */
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    margin-top: auto;
    padding-top: 0.375rem;
    width: 100%;
  }

  .specialist-trigger {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-background);
    cursor: pointer;
    text-align: left;
  }

  .specialist-trigger:hover {
    background: var(--color-muted);
  }

  .specialist-trigger:focus-visible {
    outline: none;
    border-color: var(--color-foreground);
    background: var(--color-muted);
  }

  .specialist-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    border-radius: 0.25rem;
    transition: background-color 0.1s ease;
  }

  .specialist-option:hover {
    background: color-mix(in srgb, var(--color-muted, hsl(var(--muted))) 60%, transparent);
  }

  .specialist-option:focus-visible {
    outline: none;
    background: color-mix(in srgb, var(--color-muted, hsl(var(--muted))) 75%, transparent);
  }

  @media (forced-colors: active) {
    .agent-card:focus-visible,
    .specialist-trigger:focus-visible {
      border-color: Highlight;
      background: Canvas;
    }

    .specialist-option:focus-visible {
      background: Highlight;
      color: HighlightText;
    }
  }

  .specialist-option-selected {
    background: color-mix(in srgb, var(--color-muted, hsl(var(--muted))) 40%, transparent);
  }
</style>
