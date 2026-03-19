<script lang="ts">
  import { untrack } from 'svelte';
  import { agentClient } from '$features/agent/agent.client';
  import { sessionStore } from '$features/agent/browser';
  import Button from '$lib/components/ui/button/button.svelte';
  import {
    Dropdown,
    type DropdownItemProps,
    type DropdownOption,
  } from '$lib/components/ui/dropdown';
  import { faSettings } from '$lib/icons/faSettings';
  import {
    selectSelectedModel,
    selectAvailableModels,
    selectIsLoadingModels,
    selectLoadError,
  } from '$lib/store/slices/model/model-selectors';
  import {
    selectModel,
    retryLoadModels,
    setWorkspaceModel,
  } from '$lib/store/slices/model/model-slice';
  import { selectActiveProviderId } from '$lib/store/slices/provider-settings/provider-settings-selectors';
  import { getModelsForProvider } from '$lib/store/slices/model/model-utils';
  import { getDispatch } from '$lib/store/utils/utils';
  import {
    getProviderConfig,
    parseCompoundModelId,
    resolvePreferredModel,
  } from '$shared/config/provider-config';
  import { getAgentProvider } from '$shared/types/agent-session';
  import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
  import { cn } from '$lib/utils';
  import { createLogger } from '$lib/utils/client-logger';
  import { safeLocalStorage } from '$lib/utils/safe-storage';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { toast } from 'svelte-sonner';
  import {
    faCheck,
    faChevronDown,
    faLock,
    faRotateRight,
    faExclamationTriangle,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const logger = createLogger('ModelPicker');

  const dispatch = getDispatch();
  const activeProviderId$ = selectActiveProviderId();
  const selectedModel$ = selectSelectedModel();
  const availableModels$ = selectAvailableModels();
  const isLoadingModels$ = selectIsLoadingModels();
  const loadError$ = selectLoadError();

  interface Props {
    selectedModel?: string;
    onModelChange?: (model: string) => void;
    /** Optional provider override for non-agent contexts (e.g. specialist settings). */
    providerId?: string;
    isCompact?: boolean;
    isLocked?: boolean;
    lockedTitle?: string;
    showLockIconWhenLocked?: boolean;
    /** Defer backend update until streaming ends - UI updates immediately but IPC call is delayed */
    deferUpdate?: boolean;
    variant?: 'ghost' | 'ghost-light' | 'underline' | 'outline' | 'default';
    size?: 'xs' | 'sm' | 'icon';
    /** Optional workspace ID - if provided, model selection will also update the workspace default */
    workspaceId?: string;
    /** Optional agent ID - if provided, model selection will also update the active agent's model */
    agentId?: string;
    /** Whether to show the "Manage models" footer link */
    showManageLink?: boolean;
    /** Whether to render dropdown in a portal (escapes overflow:hidden containers) */
    portal?: boolean;
    triggerClass?: string;
    /** Default model ID to show when no model is explicitly selected (instead of "Default model" text) */
    defaultModelId?: string;
    /** Whether to show the "Default model" option at the top of the dropdown. Set to false in settings where you're configuring the actual default. */
    showDefaultOption?: boolean;
    /** Update global model store when selection changes - opt-in for places that should affect the main chat model */
    updateGlobalStore?: boolean;
  }

  let {
    selectedModel,
    onModelChange = () => {},
    providerId,
    isCompact = false,
    isLocked = false,
    lockedTitle,
    showLockIconWhenLocked = true,
    deferUpdate = false,
    variant = 'ghost-light',
    size = 'sm',
    workspaceId,
    agentId,
    showManageLink = true,
    portal = true,
    triggerClass = '',
    defaultModelId,
    showDefaultOption = false,
    updateGlobalStore = false,
  }: Props = $props();

  // Track pending model update when deferUpdate is true
  let pendingModelUpdate = $state<string | null>(null);

  // --- Effective provider resolution ---
  // For existing agents (agentId), use the agent's stored provider.
  // For new agent creation (no agentId), use the global active provider.
  // Always normalize through getProviderConfig().id so aliases like 'acp' resolve to 'auggie'.
  const effectiveProviderId = $derived.by(() => {
    if (providerId) {
      return getProviderConfig(providerId).id;
    }

    if (agentId) {
      const session = sessionStore.getSession(agentId);
      if (session) {
        const provider = getAgentProvider(session);
        if (provider) return getProviderConfig(provider).id;
      }
    }
    return $activeProviderId$;
  });

  // Whether the agent's provider differs from the global active provider
  const isAgentProviderOverride = $derived(effectiveProviderId !== $activeProviderId$);

  // --- Model list: use agent-specific models when provider differs ---
  // When the effective provider matches the active provider, use the global model store.
  // When it differs (agent locked to a different provider), fetch models locally.
  let agentProviderModels = $state<
    import('$features/auggie/auggie-models.client').AuggieModel[] | null
  >(null);
  let agentProviderLoading = $state(false);
  let agentProviderError = $state<string | null>(null);

  $effect(() => {
    const epid = effectiveProviderId;
    if (epid === $activeProviderId$) {
      // Active provider matches — use global model store, clear local override
      agentProviderModels = null;
      agentProviderLoading = false;
      agentProviderError = null;
      return;
    }

    // Agent provider differs from active — fetch models for the agent's provider
    agentProviderLoading = true;
    agentProviderError = null;
    getModelsForProvider(epid)
      .then((models) => {
        agentProviderModels = models;
        agentProviderLoading = false;
      })
      .catch((err) => {
        agentProviderError = err?.message || 'Failed to load models';
        agentProviderLoading = false;
      });
  });

  // Effective model list — agent-specific models when overriding, global otherwise
  const availableModels = $derived(agentProviderModels ?? $availableModels$);
  const isLoadingModels = $derived(
    isAgentProviderOverride ? agentProviderLoading : $isLoadingModels$,
  );
  const loadError = $derived(isAgentProviderOverride ? agentProviderError : $loadError$);

  // Provider display name for footer — reflects the effective provider, not the global one
  const providerDisplayName = $derived(getProviderConfig(effectiveProviderId).displayName);

  // Refreshing state for the refresh button
  let isRefreshing = $state(false);

  /** Handle retry button click */
  async function handleRetry() {
    if (isAgentProviderOverride) {
      // Reload models for the agent's specific provider
      agentProviderLoading = true;
      agentProviderError = null;
      try {
        agentProviderModels = await getModelsForProvider(effectiveProviderId);
      } catch (err: unknown) {
        agentProviderError = err instanceof Error ? err.message : 'Failed to load models';
      } finally {
        agentProviderLoading = false;
      }
    } else {
      dispatch(retryLoadModels());
    }
  }

  /** Handle refresh models button click */
  async function handleRefreshModels() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      if (isAgentProviderOverride) {
        agentProviderModels = await getModelsForProvider(effectiveProviderId);
      } else {
        dispatch(retryLoadModels());
      }
    } finally {
      isRefreshing = false;
    }
  }

  // Special value to represent "use default" (no override)
  const USE_DEFAULT_VALUE = '__use_default__';

  // Local model state - undefined means "use default", otherwise syncs with prop
  // When selectedModel is undefined, we show "Default model" instead of falling back to store
  let localModel = $state<string | undefined>(untrack(() => selectedModel));

  // Sync from prop when it changes externally
  $effect(() => {
    if (selectedModel !== localModel) {
      localModel = selectedModel;
    }
  });

  // When deferUpdate becomes false (streaming ends), apply any pending model update
  $effect(() => {
    if (!deferUpdate && pendingModelUpdate) {
      const model = pendingModelUpdate;
      pendingModelUpdate = null;
      logger.info('Applying deferred model update:', { model, agentId });
      void applyBackendModelUpdate(model);
    }
  });

  /** Apply the model update to the backend (IPC call) */
  async function applyBackendModelUpdate(model: string) {
    if (agentId && workspaceId) {
      try {
        const result = await agentClient.setModel(agentId, model, workspaceId);
        if (result.ok && result.data.success) {
          logger.info('Updated agent model via IPC:', { agentId, model });
        } else {
          const errorMsg = result.ok ? result.data.error : result.error;
          logger.warn('Failed to update agent model:', {
            agentId,
            model,
            error: errorMsg,
          });
          // Show error toast so the user knows why the switch was blocked
          if (errorMsg) {
            toast.error(errorMsg, { duration: 6000 });
          }
        }
      } catch (error) {
        logger.error('Error updating agent model:', { agentId, model, error });
      }
    }
  }

  async function handleModelSelect(model: string | undefined) {
    logger.debug('Model selected:', {
      model,
      previousModel: localModel,
      workspaceId,
      agentId,
      deferUpdate,
      updateGlobalStore,
    });
    // Update all state synchronously first (before any async operations)
    // This ensures the UI updates immediately while the parent syncs via onModelChange
    localModel = model;
    selectedModel = model;

    // Only update stores and callbacks if a model is explicitly selected
    if (model !== undefined) {
      // Always call the onModelChange callback
      onModelChange?.(model);

      // Only update global store if explicitly opted in
      if (!updateGlobalStore) {
        return;
      }

      dispatch(selectModel(model));

      // Also update workspace-specific model if workspaceId is provided
      if (workspaceId) {
        dispatch(setWorkspaceModel({ workspaceId, model }));
        logger.debug('Updated workspace model:', { workspaceId, model });
      }

      // If agentId is provided, update the active agent's model
      if (agentId && workspaceId) {
        // Always update local session store so model persists when drawer reopens
        sessionStore.updateSession(agentId, { model });
        logger.debug('Updated local session model:', { agentId, model });

        // If deferUpdate is true (streaming), defer the IPC call until streaming ends
        // This prevents disrupting the current stream - model will apply to next message
        if (deferUpdate) {
          pendingModelUpdate = model;
          logger.info('Model update deferred until streaming ends:', { model, agentId });
        } else {
          // Apply immediately if not streaming
          await applyBackendModelUpdate(model);
        }
      }
    }
  }

  // Whether a model is explicitly selected (vs using default)
  // Also treat the literal string "undefined" as no selection (can happen from bad String(undefined) conversion)
  const hasExplicitModel = $derived(
    localModel !== undefined &&
      localModel !== USE_DEFAULT_VALUE &&
      localModel !== 'undefined' &&
      parseCompoundModelId(localModel).modelId !== 'default',
  );

  // Get the label for a model ID from available models list
  function getModelLabel(modelId: string | undefined): string | undefined {
    if (!modelId) return undefined;
    return availableModels.find((m) => m.value === modelId)?.label || modelId;
  }

  // Get the current model label from local reactive state, with fallback mapping
  // When no model is explicitly selected, show the default model name if provided
  const currentModelLabel = $derived(
    !hasExplicitModel
      ? (defaultModelId ? getModelLabel(defaultModelId) : undefined) ||
          availableModels[0]?.label ||
          'Default model'
      : getModelLabel(localModel) || 'Default model',
  );
  const lockedButtonTitle = $derived(lockedTitle?.trim() || `Model locked: ${currentModelLabel}`);
  const shouldShowLockIconWhenLocked = $derived(isCompact || showLockIconWhenLocked);

  // Determine button size based on props
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

  // "Default model" option shown at top
  const useDefaultOption: DropdownOption = {
    value: USE_DEFAULT_VALUE,
    label: 'Default model',
    description: 'Let the specialist choose the best model',
  };

  // Flat model options - optionally include "Default model" at the top
  const flatModelOptions = $derived<DropdownOption[]>([
    ...(showDefaultOption ? [useDefaultOption] : []),
    ...availableModels.map((m) => ({
      value: m.value,
      label: m.label,
      description: m.description,
    })),
  ]);

  // The value to bind to the dropdown (convert undefined to USE_DEFAULT_VALUE)
  const dropdownValue = $derived(localModel ?? USE_DEFAULT_VALUE);

  const isSelectedModelUnavailable = $derived.by(() => {
    if (isLoadingModels) return false;
    if (!hasExplicitModel) return false;
    if (!localModel) return false;

    const values = new Set(flatModelOptions.map((opt) => opt.value));
    return !values.has(localModel);
  });

  // --- Per-agent fallback tracking (persisted to localStorage so it survives page refresh) ---
  // Keyed by agentId so warnings don't leak across agents/workspaces.
  const FALLBACK_KEY_PREFIX = 'workspaces-model-fallback:';

  type FallbackInfo = { fromModel: string; toModel: string };

  // Load persisted fallback info for this agent
  let fallbackInfo = $state<FallbackInfo | null>(null);
  $effect(() => {
    if (!agentId) {
      fallbackInfo = null;
      return;
    }

    try {
      const stored = safeLocalStorage.getItem(FALLBACK_KEY_PREFIX + agentId);
      if (stored) {
        fallbackInfo = JSON.parse(stored);
        logger.debug('Loaded fallback info from localStorage:', { agentId, fallback: stored });
      } else {
        fallbackInfo = null;
      }
    } catch {
      fallbackInfo = null;
      safeLocalStorage.removeItem(FALLBACK_KEY_PREFIX + agentId);
    }
  });

  function setFallbackInfo(info: FallbackInfo) {
    fallbackInfo = info;
    if (agentId) {
      safeLocalStorage.setJSON(FALLBACK_KEY_PREFIX + agentId, info);
    }
  }

  function clearFallbackInfo() {
    fallbackInfo = null;
    if (agentId) {
      safeLocalStorage.removeItem(FALLBACK_KEY_PREFIX + agentId);
    }
  }

  // Show warning if model is currently unavailable OR was recently auto-switched.
  // Only show on pickers tied to an existing agent (agentId) — the workspace
  // initializer creates new agents and shouldn't display fallback warnings.
  const showModelWarning = $derived(
    !!agentId && (isSelectedModelUnavailable || fallbackInfo !== null),
  );

  // Warning message to display
  const warningMessage = $derived.by(() => {
    if (isSelectedModelUnavailable) {
      return {
        title: `${localModel || 'Selected model'} is no longer available`,
        description: 'Pick another model to continue.',
      };
    }
    if (fallbackInfo) {
      return {
        title: `${fallbackInfo.fromModel} is no longer available`,
        description: `Switched to ${fallbackInfo.toModel}.`,
      };
    }
    return null;
  });

  // Auto-fallback: When the selected model becomes unavailable, automatically switch to an available model.
  // Only applies to pickers tied to an existing agent — the workspace initializer doesn't need this.
  $effect(() => {
    if (!agentId) return;
    if (!isSelectedModelUnavailable) return;
    if (flatModelOptions.length === 0) return;

    // Get the name of the unavailable model for the notification
    const unavailableModelName = localModel || 'Selected model';

    // Find a fallback model using the preference list, then the globally selected model,
    // then first available as a last resort. The preference list only contains Auggie model
    // IDs, so for other providers (e.g. OpenCode) it returns undefined — in that case, prefer
    // the user's current global selection if it's available for this provider.
    const nonDefaultOptions = flatModelOptions.filter((opt) => opt.value !== USE_DEFAULT_VALUE);
    const optionValues = nonDefaultOptions.map((opt) => opt.value);
    const preferredValue = resolvePreferredModel(MODEL_DEFAULTS.UI_MODEL_PREFERENCE, optionValues);
    const fallbackOption = preferredValue
      ? nonDefaultOptions.find((opt) => opt.value === preferredValue)
      : (nonDefaultOptions.find((opt) => opt.value === $selectedModel$) ?? nonDefaultOptions[0]);
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
    // model, the model is just the default initial model, or the model's provider
    // prefix differs from the active provider, skip the warning — the user didn't
    // lose their model, the provider just changed.
    const { providerId: unavailableProvider, modelId: unavailableBaseId } =
      parseCompoundModelId(unavailableModelName);
    const activeProvider = getProviderConfig($activeProviderId$).id;
    const isProviderSwitch =
      unavailableModelName === MODEL_DEFAULTS.UI_INITIAL_MODEL ||
      unavailableProvider !== activeProvider ||
      flatModelOptions.some((opt) => {
        const { modelId: optBaseId } = parseCompoundModelId(opt.value);
        return optBaseId === unavailableBaseId;
      });

    if (!isProviderSwitch) {
      // Store fallback info per-agent (persisted to localStorage for page refresh)
      setFallbackInfo({
        fromModel: unavailableModelName,
        toModel: fallbackModelName,
      });

      // Show toast notification explaining the switch
      toast.info(
        `${unavailableModelName} is no longer available. Switched to ${fallbackModelName}.`,
        {
          duration: 5000,
        },
      );
    } else {
      logger.info('Skipping fallback warning (provider switch detected)', {
        unavailableModel: unavailableModelName,
        unavailableBaseId,
      });
    }

    // Switch to the fallback model
    handleModelSelect(fallbackOption.value);
  });

  let dropdownOpen = $state(false);

  /** Clear the fallback warning - call when user sends a message or explicitly selects a model */
  export function clearFallbackWarning() {
    clearFallbackInfo();
  }

  function handleModelChange(value: string | string[]) {
    const modelValue = value as string;
    // User explicitly selected a model in the dropdown — clear any fallback warning
    clearFallbackInfo();
    // Convert USE_DEFAULT_VALUE back to undefined
    if (modelValue === USE_DEFAULT_VALUE) {
      handleModelSelect(undefined as unknown as string);
    } else {
      handleModelSelect(modelValue);
    }
  }

  // Expose open function for keyboard shortcut
  export function open() {
    if (!isLocked) {
      dropdownOpen = true;
    }
  }
</script>

{#if isLocked}
  <!-- Show locked state without dropdown -->
  <Button
    {variant}
    size={buttonSize}
    class={cn(buttonClass, 'cursor-default')}
    title={lockedButtonTitle}
    tooltip={lockedButtonTitle}
    disabled={true}
  >
    {#if isCompact}
      <Fa icon={faLock} class="h-4 w-4" />
    {:else if size === 'xs'}
      {#if shouldShowLockIconWhenLocked}
        <Fa icon={faLock} class="h-3.5 w-3.5" />
      {/if}
      <span class="flex-1 text-left truncate">{currentModelLabel}</span>
    {:else}
      <span class={cn('flex items-center', shouldShowLockIconWhenLocked && 'gap-1.5')}>
        {#if shouldShowLockIconWhenLocked}
          <Fa icon={faLock} class="h-3.5 w-3.5" />
        {/if}
        <span class="text-xs truncate">{currentModelLabel}</span>
      </span>
    {/if}
  </Button>
{:else}
  <Dropdown
    value={dropdownValue}
    bind:open={dropdownOpen}
    options={flatModelOptions}
    onchange={handleModelChange}
    variant={variant === 'outline' ? 'outline' : variant === 'default' ? 'default' : 'ghost'}
    size={size === 'xs' ? 'xs' : 'sm'}
    searchable={false}
    class="min-w-0"
    headerClass="border-b-0!"
    triggerClass={cn(
      'max-w-full',
      (variant === 'outline' || variant === 'default') && 'w-full justify-between',
      triggerClass,
    )}
    contentClass="min-w-[220px] max-w-[360px]"
    {portal}
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
          'inline-flex items-center gap-1 truncate min-w-0',
          (variant === 'outline' || variant === 'default') && 'flex-1',
        )}
        title={currentModelLabel}
      >
        {#if isCompact}
          <Fa icon={faSettings} class="h-4 w-4" />
        {:else}
          {#if showModelWarning}
            <Fa icon={faTriangleExclamation} class="h-3 w-3 text-amber-600 shrink-0" />
          {/if}
          <span class="truncate">{currentModelLabel}</span>
        {/if}
      </span>
      {#if variant === 'outline' || variant === 'default'}
        <Fa icon={faChevronDown} class="h-2 w-2 opacity-50 shrink-0" />
      {/if}
    {/snippet}

    {#snippet header()}
      {#if showModelWarning && warningMessage}
        <div class="px-2.5 py-2 border-b border-border">
          <div class="flex items-start gap-2">
            <Fa icon={faTriangleExclamation} class="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div class="min-w-0">
              <div class="text-xs font-medium text-foreground">
                {warningMessage.title}
              </div>
              <div class="text-ui text-subtle mt-0.5">
                {warningMessage.description}
              </div>
            </div>
          </div>
        </div>
      {/if}
    {/snippet}

    {#snippet item({ option, selected }: DropdownItemProps)}
      {#if isLoadingModels}
        <!-- Skeleton shimmer per-item during refresh -->
        <div class="flex items-center gap-2 w-full pointer-events-none">
          <div class="flex-1 min-w-0 flex flex-col gap-1">
            <div
              class="h-3.5 bg-muted/40 rounded animate-pulse"
              style="width: {55 + ((option.value.charCodeAt(0) || 0) % 4) * 12}%"
            ></div>
            {#if option.description}
              <div
                class="h-2.5 bg-muted/30 rounded animate-pulse"
                style="width: {35 + ((option.value.charCodeAt(1) || 0) % 3) * 12}%"
              ></div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="flex items-center gap-2 w-full">
          <div class="flex-1 min-w-0">
            <div class="truncate" class:italic={option.value === USE_DEFAULT_VALUE}>
              {option.label}
            </div>
            {#if option.description}
              <div class="text-xs text-subtle truncate">{option.description}</div>
            {/if}
          </div>
          {#if selected}
            <Fa icon={faCheck} class="text-xs text-ghost shrink-0" />
          {/if}
        </div>
      {/if}
    {/snippet}

    {#snippet footer()}
      {#if showManageLink}
        <div class="flex items-center w-full pl-3 pr-1.5 gap-2">
          <Button
            variant="plain"
            size="xs"
            class="flex-1 min-w-0 font-normal"
            onclick={() => {
              dropdownOpen = false;
              navigateToSettings({ hash: 'providers' });
            }}
            title="Change agent provider"
          >
            <span class="truncate"
              >Models from <span class="font-medium">{providerDisplayName}</span></span
            >
          </Button>
          <Button
            variant="ghost-light"
            size="icon-xs"
            onclick={handleRefreshModels}
            title="Refresh models"
            disabled={isRefreshing}
          >
            <Fa icon={faRotateRight} size={10} class={isRefreshing ? 'animate-spin' : ''} />
          </Button>
        </div>
      {/if}
    {/snippet}

    {#snippet empty()}
      <div class="px-3 py-3">
        {#if isLoadingModels}
          <!-- Skeleton loader for initial load (no items yet) -->
          <div class="flex flex-col gap-1">
            {#each Array(5) as _}
              <div class="h-8 bg-muted/50 rounded-md animate-pulse"></div>
            {/each}
          </div>
        {:else if loadError}
          <div class="flex flex-col items-center gap-2">
            <div class="flex items-center gap-1.5 text-destructive-foreground">
              <Fa icon={faExclamationTriangle} class="h-3 w-3" />
              <span class="text-xs">Failed to load models</span>
            </div>
            <button
              type="button"
              class="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
              onclick={handleRetry}
            >
              <Fa icon={faRotateRight} class="h-3 w-3" />
              Retry
            </button>
          </div>
        {:else}
          <div class="flex flex-col items-center gap-2 text-subtle">
            <span class="text-xs">No models available</span>
            <button
              type="button"
              class="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
              onclick={handleRetry}
            >
              <Fa icon={faRotateRight} class="h-3 w-3" />
              Retry
            </button>
          </div>
        {/if}
      </div>
    {/snippet}
  </Dropdown>
{/if}
