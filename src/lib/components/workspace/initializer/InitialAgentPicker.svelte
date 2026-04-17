<script lang="ts">
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  import {
    selectSpecialists,
    selectCustomSpecialistsLoaded,
    selectUserOverrides,
    selectEffectiveModel,
    selectEffectiveCodingAgent,
    filterSpecialistsByGitHubAuth,
  } from '$lib/store/slices/specialists/specialists-selectors';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import {
    selectSelectedModel,
    selectAvailableModels,
  } from '$lib/store/slices/model/model-selectors';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { faPlus, faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import {
    getProviderAvailability,
    type ProviderAvailabilityResult,
  } from '$features/providers/provider-availability.client';
  import {
    ACP_PROVIDERS,
    getDefaultProviderId,
    getDefaultModelForProvider,
    PROVIDER_MODEL_TIERS,
    parseCompoundModelId,
  } from '$shared/config/provider-config';
  import { resolvePreferredDefaultModel } from '$lib/utils/provider-model-selection';
  import { selectActiveProviderId } from '$lib/store/slices/provider-settings/provider-settings-selectors';
  import { track } from '$lib/services/analytics';
  import { createLogger } from '$lib/utils/client-logger';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { selectGitHubAuthIsAuthenticated } from '$lib/store/slices/github-auth/github-auth-selectors';

  const logger = createLogger('InitialAgentPicker');
  const specialists$ = selectSpecialists();
  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  const visibleSpecialists = $derived.by(() =>
    filterSpecialistsByGitHubAuth($specialists$, $isGitHubAuth$),
  );
  const customSpecialistsLoaded$ = selectCustomSpecialistsLoaded();
  const userOverrides$ = selectUserOverrides();
  const activeProviderId$ = selectActiveProviderId();
  const availableModels$ = selectAvailableModels();
  const selectedModel$ = selectSelectedModel();

  interface Props {
    /** Selected specialist ID - null means blank agent */
    selectedSpecialist?: string | null;
    /** Selected model - undefined means use specialist default */
    selectedModel?: string | undefined;
    /** Whether the user explicitly overrode the model (vs using specialist default) */
    modelWasOverridden?: boolean;
    /** Whether team work mode is selected (spec-writer orchestrates) */
    isTeamMode?: boolean;
    /** Selected provider ID (auto-selected from first available) */
    selectedProvider?: string;
    /** Callback when specialist changes */
    onSpecialistChange?: (specialistId: string | null) => void;
    /** Callback when model changes */
    onModelChange?: (model: string | undefined) => void;
    /** Callback when team mode changes */
    onTeamModeChange?: (isTeamMode: boolean) => void;
    /** Callback when provider changes (called when auto-selected) */
    onProviderChange?: (providerId: string) => void;
  }

  let {
    selectedSpecialist = $bindable<string | null>('spec-writer'),
    selectedModel = $bindable<string | undefined>(undefined),
    modelWasOverridden = $bindable<boolean>(false),
    isTeamMode = $bindable<boolean>(true),
    selectedProvider = $bindable<string>($activeProviderId$ ?? getDefaultProviderId()),
    onSpecialistChange,
    onModelChange,
    onTeamModeChange,
    onProviderChange,
  }: Props = $props();

  // Provider availability state (for auto-selection only, no UI picker)
  let providerAvailability = $state<ProviderAvailabilityResult | null>(null);

  // Helper to get provider availability from result (handles different key formats)
  function getProviderAvailable(providerId: string): boolean {
    if (!providerAvailability) return false;
    // Map provider IDs to keys used in ProviderAvailabilityResult
    const keyMap: Record<string, keyof typeof providerAvailability.providers> = {
      auggie: 'auggie',
      'claude-code': 'claudeCode',
      codex: 'codex',
      mock: 'mock',
      opencode: 'opencode',
      cortex: 'cortex',
    };
    const key = keyMap[providerId];
    if (key && providerAvailability.providers[key]) {
      return providerAvailability.providers[key].available;
    }
    return false;
  }

  // Available providers derived from availability check - dynamically from ACP_PROVIDERS
  const availableProviders = $derived.by(() => {
    if (!providerAvailability) return [];
    return Object.values(ACP_PROVIDERS)
      .filter((provider) => getProviderAvailable(provider.id))
      .map((provider) => ({ id: provider.id }));
  });

  // Auto-select first available provider if current selection is unavailable
  // BUT: Don't override if the provider matches the user's explicit choice from the active provider selector
  $effect(() => {
    if (providerAvailability && availableProviders.length > 0) {
      const isSelectedAvailable = availableProviders.some((p) => p.id === selectedProvider);
      if (!isSelectedAvailable) {
        // Check if this is the user's explicit choice from the provider store
        const userExplicitChoice = $activeProviderId$;
        if (selectedProvider === userExplicitChoice) {
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

  onMount(async () => {
    // Clear stale model overrides from saved state.
    // When the user changes specialist defaults in Settings (e.g., spec-writer → sonnet4.5),
    // the form may still have a saved selectedModel (e.g., "opus4.6") marked as overridden
    // from a previous session when that was the default. Detect and clear this staleness
    // so the current specialist default is shown instead.
    if (modelWasOverridden && selectedModel) {
      const currentDefault = isTeamMode ? teamModeModel : singleAgentModel;
      if (currentDefault && selectedModel !== currentDefault) {
        selectedModel = undefined;
        modelWasOverridden = false;
        onModelChange?.(undefined);
      }
    }

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
      const { providerId: modelProvider } = parseCompoundModelId(selectedModel);
      if (modelProvider !== provider) {
        logger.debug('Clearing stale model override (provider mismatch):', {
          selectedModel,
          modelProvider,
          currentProvider: provider,
        });
        selectedModel = undefined;
        modelWasOverridden = false;
      }
    }
  });

  // Only hide the core team-mode specialists from the picker
  // (coordinator, implementor, verifier are used internally by team orchestration).
  // Other built-ins like pr-reviewer and ui-designer should be selectable.
  const builtInSpecialists = ['spec-writer', 'implementor', 'verifier'];
  const customSpecialists = $derived(
    visibleSpecialists.filter((s) => !builtInSpecialists.includes(s.id)),
  );

  // Check if selected specialist is a built-in one
  const isBuiltInSpecialist = $derived(
    selectedSpecialist === null || builtInSpecialists.includes(selectedSpecialist),
  );

  // Check if selected specialist exists (might have been deleted)
  // Only check custom specialists after overrides are loaded to avoid false negatives during init
  const selectedSpecialistExists = $derived(
    selectedSpecialist === null ||
      builtInSpecialists.includes(selectedSpecialist) ||
      $specialists$.some((s) => s.id === selectedSpecialist),
  );

  // Auto-reset to team mode if selected custom specialist was deleted
  // Only run after custom specialists are loaded to avoid resetting during initial load
  $effect(() => {
    if (
      $customSpecialistsLoaded$ &&
      !isBuiltInSpecialist &&
      !selectedSpecialistExists &&
      selectedSpecialist !== null
    ) {
      // Custom specialist was deleted, reset to team mode
      isTeamMode = true;
      selectedSpecialist = 'spec-writer';
      onTeamModeChange?.(true);
      onSpecialistChange?.('spec-writer');
    }
  });

  // Helper to resolve the effective model for a given specialist.
  // When the form's selectedProvider matches the specialist's effective coding agent
  // from Redux, delegate to selectEffectiveModel so the displayed model matches
  // Settings > Agents exactly.  When the user has changed the provider within
  // this form to something different, fall back to local tier resolution.
  function resolveEffectiveModel(specialist: string | null): string {
    const values = $availableModels$.map((m) => m.value);
    const valuesSet = new Set(values);

    if (specialist) {
      const state = getReduxStore().getState();
      const effectiveCodingAgent = selectEffectiveCodingAgent.select(state, specialist);

      // If the form's provider matches the specialist's effective coding agent,
      // use the Redux selector directly — this mirrors Settings > Agents exactly.
      if (selectedProvider === effectiveCodingAgent) {
        const reduxModel = selectEffectiveModel.select(state, specialist);
        if (reduxModel && valuesSet.has(reduxModel)) return reduxModel;
      }

      // User changed provider within the form — fall back to local tier resolution
      // User override takes priority
      const override = $userOverrides$.modelOverrides[specialist];
      if (override) return override;

      // Resolve model tier using the locally-selected provider
      const info = $specialists$.find((s) => s.id === specialist);
      if (info?.defaultModelTier && selectedProvider in PROVIDER_MODEL_TIERS) {
        const baseModel = getDefaultModelForProvider(selectedProvider, info.defaultModelTier);
        const defaultProviderId = getDefaultProviderId();
        const resolvedModel =
          selectedProvider !== defaultProviderId ? `${selectedProvider}:${baseModel}` : baseModel;
        // Validate the tier-resolved model exists in the available models.
        // PROVIDER_MODEL_TIERS may have hardcoded model names that don't match
        // the actual models returned by the provider (e.g. opencode CLI).
        if (valuesSet.has(resolvedModel)) {
          return resolvedModel;
        }
        // Tier model not available — fall through to fallback below
      }

      // Fallback to hardcoded defaultModel (custom specialists, etc.)
      if (info?.defaultModel) {
        return info.defaultModel;
      }
    }
    const fallback = resolvePreferredDefaultModel(values, $selectedModel$) ?? values[0];
    return fallback;
  }

  // Effective model for the team mode card (based on actual selectedSpecialist)
  const teamModeModel = $derived(resolveEffectiveModel(selectedSpecialist));

  // Effective model for the single-agent card (based on displayedSpecialist to preserve across mode switches)
  const singleAgentModel = $derived.by(() => resolveEffectiveModel(displayedSpecialist));



  // Specialist dropdown state
  let specialistDropdownOpen = $state(false);

  // Snapshot of mode-specific state so switching modes preserves selections
  interface ModeSnapshot {
    model: string | undefined;
    provider: string;
    modelOverridden: boolean;
    specialist: string | null; // only used by single-agent mode, but keep it uniform
  }

  const defaultProvider = $activeProviderId$ ?? getDefaultProviderId();

  let lastTeamMode = $state<ModeSnapshot>({
    model: undefined,
    provider: defaultProvider,
    modelOverridden: false,
    specialist: 'spec-writer',
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
    displayedSpecialist && !builtInSpecialists.includes(displayedSpecialist)
      ? $specialists$.find((s) => s.id === displayedSpecialist)
      : null,
  );

  // Display label and description for the specialist selector
  const specialistDisplayLabel = $derived(currentSpecialistInfo?.name ?? 'General');
  const specialistDisplayDescription = $derived(
    currentSpecialistInfo?.description ?? 'No specialized behavior',
  );

  function selectTeamMode() {
    if (isTeamMode) return;
    track('Toggled Agent Mode', { mode: 'team' });
    // Save single-agent state
    lastSingleAgent = {
      model: selectedModel,
      provider: selectedProvider,
      modelOverridden: modelWasOverridden,
      specialist: selectedSpecialist,
    };

    isTeamMode = true;
    selectedSpecialist = 'spec-writer';
    // Restore provider BEFORE model to prevent the provider-mismatch $effect from clearing it
    selectedProvider = lastTeamMode.provider;
    selectedModel = lastTeamMode.modelOverridden ? lastTeamMode.model : undefined;
    modelWasOverridden = lastTeamMode.modelOverridden;
    onTeamModeChange?.(true);
    onSpecialistChange?.('spec-writer');
    if (lastTeamMode.modelOverridden) {
      onModelChange?.(selectedModel);
      onProviderChange?.(selectedProvider);
    }
  }

  function selectSingleAgentMode() {
    if (isTeamMode) {
      track('Toggled Agent Mode', { mode: 'single' });
      // Save team mode state
      lastTeamMode = {
        model: selectedModel,
        provider: selectedProvider,
        modelOverridden: modelWasOverridden,
        specialist: 'spec-writer',
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
    const defaultProv = $activeProviderId$ ?? getDefaultProviderId();
    if (selectedProvider !== defaultProv) {
      selectedProvider = defaultProv;
      onProviderChange?.(defaultProv);
    }
    onTeamModeChange?.(false);
    onSpecialistChange?.(specialistId);
    specialistDropdownOpen = false;
  }

  function handleModelChange(model: string | undefined) {
    selectedModel = model;
    modelWasOverridden = true;

    // Update provider to match the selected model's provider
    if (model) {
      const { providerId } = parseCompoundModelId(model);
      if (providerId !== selectedProvider) {
        selectedProvider = providerId;
        onProviderChange?.(providerId);
      }
    }

    onModelChange?.(model);
  }

  async function openSpecialistSettings() {
    await navigateToSettings({ view: 'create-specialist' });
    specialistDropdownOpen = false;
  }
</script>

<!-- Agent mode cards -->
<div class="grid grid-cols-[1fr_1fr] gap-px overflow-hidden">
  <!-- Team orchestration card -->
  <button
    type="button"
    class="agent-card min-w-0 {isTeamMode ? 'agent-card-selected' : 'grayscale opacity-50'}"
    onclick={selectTeamMode}
  >
    <div class="text-sm font-medium text-foreground">Agent orchestration</div>
    <div class="flex items-center gap-1 py-1.5">
      <AuggieAvatar faceSeed="blank" colorSeed="blank" size={22} specialist="spec-writer" />
      <span class="text-subtle text-xs mx-0.5">→</span>
      <AuggieAvatar faceSeed="blank" colorSeed="blank" size={22} specialist="implementor" />
      <AuggieAvatar faceSeed="blank" colorSeed="blank" size={22} specialist="verifier" />
    </div>
    <div class="text-sm text-subtle leading-snug">
      A coordinator agent will write a spec for your task and manage the work for you across
      different agents.
    </div>
    <div
      class="model-picker-row {isTeamMode ? '' : 'opacity-0 pointer-events-none'}"
      inert={!isTeamMode}
    >
      <span class="text-sm text-subtle">using</span>
      {#key teamModeModel}
        <ModelPicker
          selectedModel={modelWasOverridden ? selectedModel : undefined}
          onModelChange={handleModelChange}
          variant="ghost-light"
          size="xs"
          triggerClass="inline-flex items-center bg-sidebar px-1.5 py-0.5 cursor-pointer text-sm font-medium text-subtle rounded-none"
          showManageLink={true}
          defaultModelId={teamModeModel}
          updateGlobalStore
          silentFallback
        />
      {/key}
    </div>
  </button>

  <!-- Single agent card -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="agent-card min-w-0 {!isTeamMode ? 'agent-card-selected' : 'grayscale opacity-50'}"
    onclick={selectSingleAgentMode}
    onkeydown={(e) => e.key === 'Enter' && selectSingleAgentMode()}
    role="button"
    tabindex="0"
  >
    <div class="text-sm font-medium text-foreground">Single agent</div>
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
        {#snippet trigger({ toggle }: { toggle: () => void })}
          <button
            type="button"
            tabindex={isTeamMode ? -1 : 0}
            onclick={(e) => {
              if (isTeamMode) {
                // First click selects single-agent mode — let it bubble to the parent card
                return;
              }
              e.stopPropagation();
              toggle();
            }}
            class="specialist-trigger"
          >
            <AuggieAvatar
              faceSeed="blank"
              colorSeed="blank"
              size={20}
              specialist={currentSpecialistInfo ? displayedSpecialist : null}
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
              (selectedSpecialist && builtInSpecialists.includes(selectedSpecialist))
                ? 'specialist-option-selected'
                : ''}"
              onclick={() => handleSpecialistSelect(null)}
            >
              <AuggieAvatar faceSeed="blank" colorSeed="blank" size={20} />
              <div class="flex flex-col min-w-0">
                <span class="font-medium text-foreground text-sm">General</span>
                <span class="text-xs text-subtle">No specialized behavior</span>
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
                  <AuggieAvatar
                    faceSeed="blank"
                    colorSeed="blank"
                    size={20}
                    specialist={specialist.id}
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
              <span class="text-sm">Create new or manage specialists</span>
            </button>
          </div>
        {/snippet}
      </DropdownMenu>
    </div>

    <p class="text-sm text-subtle leading-snug">
      Work on specific tasks with an agent of your choosing.
    </p>

    <div
      class="model-picker-row {!isTeamMode ? '' : 'opacity-0 pointer-events-none'}"
      inert={isTeamMode}
    >
      <span class="text-sm text-subtle">using</span>
      {#key singleAgentModel}
        <ModelPicker
          selectedModel={modelWasOverridden ? selectedModel : undefined}
          onModelChange={handleModelChange}
          variant="ghost-light"
          size="xs"
          triggerClass="inline-flex items-center bg-sidebar px-1.5 py-0.5 cursor-pointer text-sm font-medium text-subtle rounded-none"
          showManageLink={true}
          defaultModelId={singleAgentModel}
          updateGlobalStore
          silentFallback
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
    padding: 0.875rem 1rem;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .agent-card:hover {
    /* background: var(--color-sidebar, hsl(var(--sidebar))); */
  }

  .agent-card-selected {
    background: var(--color-background, hsl(var(--popover)));
  }

  .model-picker-row {
    display: flex;
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
    background: var(--color-sidebar, hsl(var(--sidebar)));
    cursor: pointer;
    text-align: left;
  }

  .specialist-trigger:hover {
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

  .specialist-option-selected {
    background: color-mix(in srgb, var(--color-muted, hsl(var(--muted))) 40%, transparent);
  }
</style>
