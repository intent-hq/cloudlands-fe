<script lang="ts">
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  import {
    selectSpecialists,
    selectCustomSpecialistsLoaded,
    selectUserOverrides,
    filterSpecialistsByGitHubAuth,
  } from '$lib/store/slices/specialists/specialists-selectors';
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
  import { selectActiveProviderId } from '$lib/store/slices/active-provider/active-provider-selectors';
  import { createLogger } from '$lib/utils/client-logger';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { githubAuthStore } from '$features/github-auth/renderer/github-auth.store.svelte';

  const logger = createLogger('InitialAgentPicker');
  const specialists$ = selectSpecialists();
  const visibleSpecialists = $derived.by(() =>
    filterSpecialistsByGitHubAuth($specialists$, githubAuthStore.state.isAuthenticated)
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
      opencode: 'opencode',
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
  // BUT: Don't override if the provider matches the user's explicit choice from activeProviderStore
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
    // Fetch provider availability for auto-selection
    try {
      providerAvailability = await getProviderAvailability();
      logger.debug('Provider availability loaded:', providerAvailability);

      // Auto-select first available provider if none is set or current is unavailable
      // BUT: Don't override if the provider matches the user's explicit choice from activeProviderStore
      if (providerAvailability.hasAnyProvider) {
        const isCurrentAvailable =
          (selectedProvider === 'auggie' && providerAvailability.providers.auggie.available) ||
          (selectedProvider === 'claude-code' &&
            providerAvailability.providers.claudeCode.available) ||
          (selectedProvider === 'codex' && providerAvailability.providers.codex.available);

        if (!isCurrentAvailable) {
          // Check if this is the user's explicit choice from the provider store
          const userExplicitChoice = $activeProviderId$;
          if (selectedProvider === userExplicitChoice) {
            // User explicitly selected this provider - don't override even if availability check fails
            logger.debug('Keeping user-selected provider despite availability check:', {
              selectedProvider,
            });
            return;
          }
          // Select first available
          if (providerAvailability.providers.auggie.available) {
            selectedProvider = 'auggie';
          } else if (providerAvailability.providers.claudeCode.available) {
            selectedProvider = 'claude-code';
          } else if (providerAvailability.providers.codex.available) {
            selectedProvider = 'codex';
          }
          onProviderChange?.(selectedProvider);
        }
      }
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
  // Uses the local selectedProvider (not active-provider Redux slice) so the displayed
  // model stays in sync with the provider the user picked in this form.
  function resolveEffectiveModel(specialist: string | null): string {
    const values = $availableModels$.map((m) => m.value);
    const valuesSet = new Set(values);

    if (specialist) {
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
      if (info?.defaultModel) return info.defaultModel;
    }
    return resolvePreferredDefaultModel(values, $selectedModel$) ?? values[0];
  }

  // Effective model for the team mode card (based on actual selectedSpecialist)
  const teamModeModel = $derived(resolveEffectiveModel(selectedSpecialist));

  // Effective model for the single-agent card (based on displayedSpecialist to preserve across mode switches)
  const singleAgentModel = $derived.by(() => resolveEffectiveModel(displayedSpecialist));

  // Specialist dropdown state
  let specialistDropdownOpen = $state(false);

  // Track the last single-agent specialist/model so switching to team mode and back preserves them
  let lastSingleAgentSpecialist = $state<string | null>(null);
  let lastSingleAgentModel = $state<string | undefined>(undefined);
  let lastSingleAgentModelOverridden = $state<boolean>(false);

  // The specialist to display in the single-agent card — uses the saved value when in team mode
  const displayedSpecialist = $derived(isTeamMode ? lastSingleAgentSpecialist : selectedSpecialist);

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
    // Save the current single-agent state before switching
    if (!isTeamMode) {
      lastSingleAgentSpecialist = selectedSpecialist;
      lastSingleAgentModel = selectedModel;
      lastSingleAgentModelOverridden = modelWasOverridden;
    }
    isTeamMode = true;
    selectedSpecialist = 'spec-writer';
    // Always reset model when switching cards — let defaultModelId drive the display
    selectedModel = undefined;
    modelWasOverridden = false;
    onTeamModeChange?.(true);
    onSpecialistChange?.('spec-writer');
  }

  function selectSingleAgentMode() {
    if (isTeamMode) {
      // Switching from team mode — restore the previously selected specialist and model
      isTeamMode = false;
      selectedSpecialist = lastSingleAgentSpecialist;
      selectedModel = lastSingleAgentModel;
      modelWasOverridden = lastSingleAgentModelOverridden;
      onTeamModeChange?.(false);
      onSpecialistChange?.(selectedSpecialist);
      if (lastSingleAgentModelOverridden) {
        onModelChange?.(selectedModel);
      }
    }
    // If already in single-agent mode, do nothing (specialist dropdown handles changes)
  }

  function handleSpecialistSelect(specialistId: string | null) {
    isTeamMode = false;
    selectedSpecialist = specialistId;
    lastSingleAgentSpecialist = specialistId;
    // Always reset model when switching specialists — let defaultModelId drive the display
    selectedModel = undefined;
    modelWasOverridden = false;
    onTeamModeChange?.(false);
    onSpecialistChange?.(specialistId);
    specialistDropdownOpen = false;
  }

  function handleModelChange(model: string | undefined) {
    selectedModel = model;
    modelWasOverridden = true;
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
          {selectedModel}
          onModelChange={handleModelChange}
          variant="ghost-light"
          size="xs"
          triggerClass="inline-flex items-center bg-sidebar px-1.5 py-0.5 cursor-pointer text-sm font-medium text-subtle rounded-none"
          showManageLink={true}
          defaultModelId={teamModeModel}
          updateGlobalStore
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

        {#snippet content({ close }: { close: () => void })}
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
          {selectedModel}
          onModelChange={handleModelChange}
          variant="ghost-light"
          size="xs"
          triggerClass="inline-flex items-center bg-sidebar px-1.5 py-0.5 cursor-pointer text-sm font-medium text-subtle rounded-none"
          showManageLink={true}
          defaultModelId={singleAgentModel}
          updateGlobalStore
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
