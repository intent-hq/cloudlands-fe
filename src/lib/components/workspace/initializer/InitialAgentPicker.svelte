<script lang="ts">
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  import {
  selectSpecialists,
  selectCustomSpecialistsLoaded,
  selectFileSpecialistsLoaded,
  selectEffectiveModel,
  selectEffectiveCodingAgent,
  filterPickableSpecialists,
} from '$store/renderer/slices/specialists/specialists-selectors';

  import {
  selectSelectedModel,
  selectAvailableModels,
} from '$store/renderer/slices/model/model-selectors';
  import { selectWorkspaceInitializerHydrated } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import {
  faPlus,
  faChevronDown,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import {
  getProviderAvailability,
  type ProviderAvailabilityResult,
} from '$features/providers/provider-availability.client';
  import {
  ACP_PROVIDERS,
  getDefaultProviderId,
  parseCompoundModelId,
} from '$shared/config/provider-config';
  import { resolveEffectiveModelForSpecialist } from '$lib/utils/effective-model-resolution';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { createLogger } from '$lib/utils/client-logger';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('InitialAgentPicker');
  const specialists$ = selectSpecialists();
  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  const visibleSpecialists = $derived.by(() =>
    filterPickableSpecialists($specialists$, $isGitHubAuth$),
  );
  const customSpecialistsLoaded$ = selectCustomSpecialistsLoaded();
  const fileSpecialistsLoaded$ = selectFileSpecialistsLoaded();
  const initializerHydrated$ = selectWorkspaceInitializerHydrated();
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
      droid: 'droid',
      grok: 'grok',
      cortex: 'cortex',
      pi: 'pi',
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
  // Delegates to the shared resolveEffectiveModelForSpecialist utility (also used
  // by the CompactWorkspaceInitializer submit path) so the displayed model always
  // matches the model the created agent gets. When the form's selectedProvider
  // matches the specialist's effective coding agent from Redux, the Redux-resolved
  // model wins (mirrors Settings > Agents exactly); when the user has changed the
  // provider within this form, it falls back to local tier resolution.
  function resolveEffectiveModel(specialist: string | null): string | undefined {
    const state = appStore.state;
    return resolveEffectiveModelForSpecialist({
      specialistId: specialist,
      selectedProvider,
      availableModelValues: $availableModels$.map((m) => m.value),
      globalSelectedModel: $selectedModel$,
      effectiveCodingAgent: specialist
        ? selectEffectiveCodingAgent.select(state, specialist)
        : undefined,
      effectiveModel: specialist ? selectEffectiveModel.select(state, specialist) : undefined,
      specialistInfo: specialist ? $specialists$.find((s) => s.id === specialist) : undefined,
    });
  }

  // Effective model for the team mode card (based on actual selectedSpecialist)
  const teamModeModel = $derived(resolveEffectiveModel(selectedSpecialist));

  // Effective model for the single-agent card (based on displayedSpecialist to preserve across mode switches)
  const singleAgentModel = $derived.by(() => resolveEffectiveModel(displayedSpecialist));

  // Clear stale model overrides restored from saved state.
  // When the user changes specialist defaults in Settings (e.g., spec-writer → sonnet4.5),
  // the form may still have a saved selectedModel (e.g., "opus4.6") marked as overridden
  // from a previous session when that was the default. This runs reactively (not onMount)
  // so it waits until file specialists, available models, and the parent's persisted form
  // state are all loaded — comparing before then is meaningless — and re-runs if hydration
  // re-applies a stale override after mount. A persisted "override" that matches the
  // current specialist default is not a real override; one that differs is stale. Either
  // way it is cleared so the current specialist default drives the picker. Overrides the
  // user made in this session are never cleared.
  $effect(() => {
    const dataReady =
      $fileSpecialistsLoaded$ && $availableModels$.length > 0 && $initializerHydrated$;
    if (!dataReady || modelOverriddenThisSession) return;
    // Degenerate persisted state: overridden flag set with no model. Normalize
    // so the invariant `modelWasOverridden ⇒ selectedModel set` holds.
    if (modelWasOverridden && !selectedModel) {
      logger.debug('Normalizing degenerate model-override state (flag set, no model)');
      modelWasOverridden = false;
      onModelChange?.(undefined);
      return;
    }
    if (modelWasOverridden && selectedModel) {
      const currentDefault = isTeamMode ? teamModeModel : singleAgentModel;
      if (currentDefault) {
        logger.debug('Clearing stale persisted model override:', {
          selectedModel,
          currentDefault,
        });
        selectedModel = undefined;
        modelWasOverridden = false;
        onModelChange?.(undefined);
      }
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
    modelOverriddenThisSession = true;

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
      <AuggieAvatar seed="blank" size={22} specialist="spec-writer" />
      <span class="text-subtle text-xs mx-0.5">→</span>
      <AuggieAvatar seed="blank" size={22} specialist="implementor" />
      <AuggieAvatar seed="blank" size={22} specialist="verifier" />
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
              seed="blank"
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
              <AuggieAvatar seed="blank" size={20} />
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
                    seed="blank"
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
