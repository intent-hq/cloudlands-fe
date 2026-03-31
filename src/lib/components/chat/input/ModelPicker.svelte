<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { fade } from 'svelte/transition';

  import { agentClient } from '$features/agent/agent.client';
  import { sessionStore } from '$features/agent/browser';
  import Button from '$lib/components/ui/button/button.svelte';
  import {
    Dropdown,
    type DropdownGroup,
    type DropdownGroupProps,
    type DropdownItemProps,
    type DropdownOption,
  } from '$lib/components/ui/dropdown';
  import ProviderIcon from '$lib/components/ui/ProviderIcon.svelte';
  import { faSettings } from '$lib/icons/faSettings';

  import {
    selectSelectedModel,
    selectAvailableModels,
    selectIsLoadingModels,
    selectLoadError,
  } from '$lib/store/slices/model/model-selectors';
  import { selectModel, setWorkspaceModel } from '$lib/store/slices/model/model-slice';
  import {
    selectActiveProviderId,
    selectEnabledProviderIds,
  } from '$lib/store/slices/provider-settings/provider-settings-selectors';
  import { getModelsForProvider } from '$lib/store/slices/model/model-utils';
  import { getDispatch } from '$lib/store/utils/utils';
  import {
    ACP_PROVIDERS,
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
    faArrowsRotate,
    faExclamationTriangle,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const logger = createLogger('ModelPicker');

  const dispatch = getDispatch();
  const activeProviderId$ = selectActiveProviderId();
  const enabledProviderIds$ = selectEnabledProviderIds();
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
    /** When true, silently falls back to a default model if the selected model is unavailable. Used by workspace initializer. */
    silentFallback?: boolean;
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
    silentFallback = false,
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

    if (agentId && workspaceId) {
      const session = sessionStore.getSessionForWorkspace(workspaceId, agentId);
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

  // --- All-provider models for multi-provider display ---
  let allProviderModels = $state<Record<string, DropdownOption[]>>({});
  let fetchGeneration = 0;
  let allProvidersLoaded = $state(false);
  let lastFetchedProviderIds = '';

  /** Fetch models for all enabled providers, with generation tracking to discard stale results. */
  async function fetchAllProviderModels(enabledIds: string[]) {
    const key = enabledIds.slice().sort().join(',');
    if (key === lastFetchedProviderIds && allProvidersLoaded) return;
    lastFetchedProviderIds = key;

    // Don't clear existing models — keep them visible while refreshing
    allProvidersLoaded = false;
    const currentGen = ++fetchGeneration;

    if (enabledIds.length === 0) {
      allProvidersLoaded = true;
      return;
    }

    const results = await Promise.allSettled(
      enabledIds.map(async (pid) => {
        const normalizedId = getProviderConfig(pid).id;
        const models = await getModelsForProvider(normalizedId);
        return [normalizedId, toDropdownOptions(models)] as const;
      }),
    );

    // Discard stale results if a newer fetch was triggered
    if (fetchGeneration !== currentGen) return;

    const models: Record<string, DropdownOption[]> = {};
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const [pid, options] = result.value;
        if (options.length > 0) {
          models[pid] = options;
        }
      }
    }

    allProviderModels = models;
    allProvidersLoaded = true;
  }

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

  // --- Fetch models for ALL enabled providers when not locked to an agent provider ---
  let fetchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (isAgentProviderOverride) return;
    const providerIds = $enabledProviderIds$;
    // Debounce rapid provider changes (e.g., enabling multiple providers at once)
    clearTimeout(fetchDebounceTimer);
    fetchDebounceTimer = setTimeout(() => fetchAllProviderModels(providerIds), 50);
  });

  // Effective model list — agent-specific models when overriding, global otherwise
  const availableModels = $derived(
    isAgentProviderOverride
      ? agentProviderLoading
        ? []
        : (agentProviderModels ?? (agentProviderError ? [] : $availableModels$))
      : (agentProviderModels ?? $availableModels$),
  );
  const isLoadingModels = $derived(
    isAgentProviderOverride ? agentProviderLoading : $isLoadingModels$ || !allProvidersLoaded,
  );
  const loadError = $derived(isAgentProviderOverride ? agentProviderError : $loadError$);

  // Provider display name for footer — reflects the effective provider, not the global one
  const providerDisplayName = $derived(getProviderConfig(effectiveProviderId).displayName);

  // Track which provider groups are collapsed in the dropdown (persisted globally)
  const COLLAPSED_GROUPS_KEY = 'model-picker-collapsed-groups';

  function loadCollapsedGroups(): Set<string> {
    try {
      const stored = localStorage.getItem(COLLAPSED_GROUPS_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  }

  let collapsedGroups = $state<Set<string>>(loadCollapsedGroups());

  function toggleGroup(key: string) {
    collapsedGroups = new Set(collapsedGroups);
    if (collapsedGroups.has(key)) {
      collapsedGroups.delete(key);
    } else {
      collapsedGroups.add(key);
    }
    try {
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsedGroups]));
    } catch {
      // ignore storage errors
    }
  }

  // Refreshing state for per-provider refresh buttons in group headers
  let refreshingProviders = $state<Set<string>>(new Set());

  async function handleRefreshProvider(providerId: string) {
    if (refreshingProviders.has(providerId)) return;
    refreshingProviders = new Set([...refreshingProviders, providerId]);
    const gen = fetchGeneration;
    try {
      const models = await getModelsForProvider(providerId);
      if (fetchGeneration !== gen) return;
      if (isAgentProviderOverride && providerId === effectiveProviderId) {
        agentProviderModels = models;
      } else {
        allProviderModels = {
          ...allProviderModels,
          [providerId]: toDropdownOptions(models),
        };
      }
    } catch (err) {
      logger.warn('Failed to refresh models for provider', { providerId, error: err });
    } finally {
      const next = new Set(refreshingProviders);
      next.delete(providerId);
      refreshingProviders = next;
    }
  }

  // Legacy refreshing state for the refresh button (kept for handleRetry/handleRefreshModels)
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
      lastFetchedProviderIds = '';
      fetchAllProviderModels($enabledProviderIds$);
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
        lastFetchedProviderIds = '';
        fetchAllProviderModels($enabledProviderIds$);
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

      // Allow Svelte to flush prop updates (e.g., deferUpdate may have changed in the callback)
      await tick();

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
        sessionStore.updateSessionForWorkspace(workspaceId, agentId, { model });
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

  // Helper: format cost tier as dollar signs
  function formatCostTier(tier: number | undefined): string | undefined {
    if (tier === 1) return '$';
    if (tier === 2) return '$$';
    if (tier === 3) return '$$$';
    return undefined;
  }

  function toDropdownOptions(
    models: { value: string; label: string; description?: string; badges?: { color: string; label: string; variant?: string }[]; costTier?: number; effortLevels?: string[]; isDefault?: boolean }[],
  ): DropdownOption[] {
    return models.map((m) => ({
      value: m.value,
      label: m.label,
      description: m.description,
      data: {
        badges: m.badges,
        costTier: m.costTier,
        costTierLabel: formatCostTier(m.costTier),
        effortLevels: m.effortLevels,
        isDefault: m.isDefault,
      },
    }));
  }

  // Get the label for a model ID from available models list
  function getModelLabel(modelId: string | undefined): string | undefined {
    if (!modelId) return undefined;
    // Search all provider models when in multi-provider mode
    if (!isAgentProviderOverride) {
      for (const models of Object.values(allProviderModels)) {
        const found = models.find((m) => m.value === modelId);
        if (found) return found.label;
      }
    }
    return (
      availableModels.find((m) => m.value === modelId)?.label ||
      parseCompoundModelId(modelId).modelId
    );
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

  // Provider ID for the trigger icon — derived from the current model
  const triggerProviderId = $derived.by(() => {
    if (!localModel || !hasExplicitModel) return effectiveProviderId;
    const { providerId: modelProvider } = parseCompoundModelId(localModel);
    return modelProvider;
  });

  // Whether the trigger label has been resolved to a real model name (vs raw ID fallback)
  const isTriggerLabelResolved = $derived.by(() => {
    if (!hasExplicitModel || !localModel) return true; // "Default model" text, no need for skeleton
    // Once loading has settled, always show the label (even raw ID fallback) rather than shimmer forever
    if (!isLoadingModels && (isAgentProviderOverride || allProvidersLoaded)) return true;
    // Check if the model exists in any provider's loaded models
    if (!isAgentProviderOverride) {
      for (const models of Object.values(allProviderModels)) {
        if (models.some((m) => m.value === localModel)) return true;
      }
    }
    return availableModels.some((m) => m.value === localModel);
  });

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

  // Flat model options - used for non-UI logic (fallback checks, etc.)
  const flatModelOptions = $derived<DropdownOption[]>([
    ...(showDefaultOption ? [useDefaultOption] : []),
    ...(isAgentProviderOverride
      ? toDropdownOptions(availableModels)
      : $enabledProviderIds$.flatMap((pid) => allProviderModels[getProviderConfig(pid).id] ?? [])),
  ]);

  // Grouped model options for dropdown display
  const groupedModelOptions = $derived.by<DropdownGroup[]>(() => {
    const groups: DropdownGroup[] = [];

    // Add "Default model" as its own group at the top
    if (showDefaultOption) {
      groups.push({
        key: 'default',
        label: '',
        options: [useDefaultOption],
      });
    }

    if (isAgentProviderOverride) {
      // Agent locked to specific provider — show only that provider's models
      const providerConfig = getProviderConfig(effectiveProviderId);
      if (availableModels.length > 0) {
        groups.push({
          key: effectiveProviderId,
          label: providerConfig.displayName,
          options: toDropdownOptions(availableModels),
        });
      }
    } else if (allProvidersLoaded) {
      // Show all enabled providers only after ALL have loaded
      // (prevents flash where partial results cause wrong highlight)
      // Use ACP_PROVIDERS key order for consistent ordering
      const providerOrder = Object.keys(ACP_PROVIDERS);
      for (const pid of providerOrder) {
        const models = allProviderModels[pid];
        if (models && models.length > 0) {
          const providerConfig = getProviderConfig(pid);
          groups.push({
            key: pid,
            label: providerConfig.displayName,
            options: models,
          });
        }
      }
    }

    return groups;
  });

  // The value to bind to the dropdown (convert undefined to USE_DEFAULT_VALUE)
  const dropdownValue = $derived(localModel ?? USE_DEFAULT_VALUE);

  // Display groups — same as groupedModelOptions but with collapsed groups' options hidden
  const displayGroups = $derived(
    groupedModelOptions.map((group) => ({
      ...group,
      options: collapsedGroups.has(group.key) ? [] : group.options,
    })),
  );

  const isSelectedModelUnavailable = $derived.by(() => {
    if (isLoadingModels) return false;
    if (!isAgentProviderOverride && !allProvidersLoaded) return false;
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

  /** Find the best fallback option: preference list → globally selected model → first available */
  function findFallbackOption(restrictToProvider?: string): DropdownOption | undefined {
    let candidates = flatModelOptions.filter((opt) => opt.value !== USE_DEFAULT_VALUE);

    if (restrictToProvider) {
      candidates = candidates.filter((opt) => {
        const { providerId: optProvider } = parseCompoundModelId(opt.value);
        return optProvider === restrictToProvider;
      });
    }

    const optionValues = candidates.map((opt) => opt.value);
    const preferredValue = resolvePreferredModel(MODEL_DEFAULTS.UI_MODEL_PREFERENCE, optionValues);
    return preferredValue
      ? candidates.find((opt) => opt.value === preferredValue)
      : (candidates.find((opt) => opt.value === $selectedModel$) ?? candidates[0]);
  }

  // Auto-fallback: When the selected model becomes unavailable, automatically switch to an available model.
  // Only applies to pickers tied to an existing agent — the workspace initializer doesn't need this.
  $effect(() => {
    if (!agentId) return;
    if (!isSelectedModelUnavailable) return;
    if (flatModelOptions.length === 0) return;

    // Get the name of the unavailable model for the notification
    const unavailableModelName = localModel || 'Selected model';

    const unavailableProvider = localModel
      ? parseCompoundModelId(localModel).providerId
      : effectiveProviderId;

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
    // model, the model is just the default initial model, or the model's provider
    // prefix differs from the active provider, skip the warning — the user didn't
    // lose their model, the provider just changed.
    const { providerId: unavailableModelProvider, modelId: unavailableBaseId } =
      parseCompoundModelId(unavailableModelName);
    const activeProvider = getProviderConfig($activeProviderId$).id;
    const isProviderSwitch =
      unavailableModelName === MODEL_DEFAULTS.UI_INITIAL_MODEL ||
      unavailableModelProvider !== activeProvider ||
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

  let silentRetryAttemptedForProvider: string | null = null;

  // Silent fallback for workspace initializer (no agentId)
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
    if (!isSelectedModelUnavailable) return;
    if (!isLoadingModels && flatModelOptions.length === 0) return;

    const rawCurrentProvider = localModel
      ? parseCompoundModelId(localModel).providerId
      : effectiveProviderId;
    const currentProvider = getProviderConfig(rawCurrentProvider).id;

    // Try same-provider fallback first
    const fallbackOption = findFallbackOption(currentProvider);
    if (fallbackOption) {
      logger.info('Workspace initializer: falling back to same-provider model', {
        unavailableModel: localModel,
        fallbackModel: fallbackOption.value,
        provider: currentProvider,
      });
      handleModelSelect(fallbackOption.value);
      return;
    }

    // Only retry the fetch once per unavailable-model episode
    if (silentFallbackRetried) return;
    silentFallbackRetried = true;

    // No same-provider model available — retry the fetch once, then warn
    if (silentRetryAttemptedForProvider === currentProvider) return;
    silentRetryAttemptedForProvider = currentProvider;

    void (async () => {
      try {
        const models = await getModelsForProvider(currentProvider);
        if (models.length > 0) {
          const normalizedId = getProviderConfig(currentProvider).id;
          allProviderModels = {
            ...allProviderModels,
            [normalizedId]: toDropdownOptions(models),
          };
          return;
        }
      } catch (err) {
        logger.warn('Retry fetch failed for provider', { provider: currentProvider, error: err });
      }

      const providerName = getProviderConfig(currentProvider).displayName;
      toast.warning(`No models available for ${providerName}`, {
        description: 'Try refreshing or switch to another provider.',
      });
    })();
  });

  let dropdownOpen = $state(false);

  /** Clear any pending deferred model update. Used when the parent handles the IPC call itself. */
  export function clearPendingUpdate() {
    pendingModelUpdate = null;
  }

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
      <ProviderIcon providerId={triggerProviderId} class="size-3.5" />
      <span class="flex-1 text-left truncate">{currentModelLabel}</span>
    {:else}
      <span class={cn('flex items-center', shouldShowLockIconWhenLocked && 'gap-1.5')}>
        {#if shouldShowLockIconWhenLocked}
          <Fa icon={faLock} class="h-3.5 w-3.5" />
        {/if}
        <ProviderIcon providerId={triggerProviderId} class="size-3.5" />
        <span class="text-xs truncate">{currentModelLabel}</span>
      </span>
    {/if}
  </Button>
{:else}
  {#snippet groupHeader({ group, groupIndex }: DropdownGroupProps)}
    {#if group.label}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class={cn(
          'group/header px-3 text-xs font-medium text-muted-foreground flex items-center gap-2 cursor-pointer select-none',
          groupIndex > 0 && 'pt-1.5',
        )}
        role="button"
        tabindex="-1"
        aria-label="{group.label} models"
        aria-expanded={!collapsedGroups.has(group.key)}
        onclick={() => toggleGroup(group.key)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleGroup(group.key);
          }
        }}
      >
        <span>{group.label}</span>
        <span class="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost-light"
            size="xs"
            class={cn(
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:opacity-100',
              refreshingProviders.has(group.key) && 'opacity-50! cursor-not-allowed',
            )}
            onclick={(e) => {
              e.stopPropagation();
              handleRefreshProvider(group.key);
            }}
            title="Refresh {group.label} models"
            aria-label="Refresh {group.label} models"
            disabled={refreshingProviders.has(group.key)}
          >
            <Fa
              icon={faArrowsRotate}
              size={10}
              class={cn(
                'text-subtle transition-transform duration-500',
                refreshingProviders.has(group.key) && 'animate-spin',
              )}
            />
          </Button>
          <Fa
            icon={faChevronDown}
            class={cn(
              'text-subtle transition-transform duration-150',
              collapsedGroups.has(group.key) && 'rotate-90',
            )}
            size={12}
          />
        </span>
      </div>
    {/if}
  {/snippet}

  <Dropdown
    value={dropdownValue}
    defaultHighlightValue={defaultModelId}
    bind:open={dropdownOpen}
    groups={displayGroups}
    onchange={handleModelChange}
    variant={variant === 'outline' ? 'outline' : variant === 'default' ? 'default' : 'ghost'}
    size={size === 'xs' ? 'xs' : 'sm'}
    searchable={true}
    placeholder="Search models..."
    class="min-w-0"
    headerClass="border-b-0!"
    triggerClass={cn(
      'max-w-full',
      (variant === 'outline' || variant === 'default') && 'w-full justify-between',
      triggerClass,
    )}
    contentClass="w-[332px] max-w-[calc(100vw-32px)]"
    {portal}
    {groupHeader}
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
        title={isTriggerLabelResolved ? currentModelLabel : ''}
      >
        {#if isCompact}
          <Fa icon={faSettings} class="h-4 w-4" />
        {:else if isTriggerLabelResolved}
          {#if showModelWarning}
            <Fa icon={faTriangleExclamation} class="h-3 w-3 text-amber-600 shrink-0" />
          {/if}
          <ProviderIcon providerId={triggerProviderId} class="size-3.5" />
          <span class="truncate">{currentModelLabel}</span>
        {:else}
          <div class="h-3.5 w-24 bg-muted/50 rounded-sm animate-pulse"></div>
        {/if}
      </span>
      {#if variant === 'outline' || variant === 'default'}
        <Fa icon={faChevronDown} class="h-2 w-2 opacity-50 shrink-0" />
      {/if}
    {/snippet}

    {#snippet header()}
      {#if showModelWarning && warningMessage}
        <div class="px-3 py-2.5 border-b border-border bg-warning/5">
          <div class="flex items-start gap-2" role="alert">
            <Fa
              icon={faTriangleExclamation}
              class="h-3.5 w-3.5 text-warning-foreground mt-0.5 shrink-0"
            />
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
      {/if}
    {/snippet}

    {#snippet item({ option, selected }: DropdownItemProps)}
      {@const badges = option.data?.badges as
        | Array<{ color: string; label: string; variant?: string }>
        | undefined}
      {@const costTierLabel = option.data?.costTierLabel as string | undefined}
      {@const isDefaultModel = option.data?.isDefault as boolean | undefined}
      {@const effortLevels = option.data?.effortLevels as string[] | undefined}
      {@const hasRightBadges = (badges && badges.length > 0) || costTierLabel || isDefaultModel}
      <div class="flex gap-2 w-full min-w-0">
        {#if option.value !== USE_DEFAULT_VALUE}
          <ProviderIcon
            providerId={parseCompoundModelId(option.value).providerId}
            class="size-3.5 shrink-0 mt-0.5"
          />
        {/if}
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline justify-between gap-2">
            <span
              class={cn(
                'truncate text-sm font-medium',
                option.value === USE_DEFAULT_VALUE && 'italic text-muted-foreground',
                selected && 'font-medium',
              )}
            >
              {option.label}
            </span>
          </div>
          {#if option.description}
            <div class="text-xs text-subtle truncate mt-0.5" title={option.description}>{option.description}</div>
          {/if}
          {#if effortLevels && effortLevels.length > 0}
            <div class="text-xs text-subtle/60 truncate hidden">
              Effort: {effortLevels.join(' · ')}
            </div>
          {/if}
        </div>
        {#if selected}
          <Fa icon={faCheck} class="text-xs text-primary shrink-0" />
        {/if}
      </div>
    {/snippet}

    {#snippet footer()}
      {#if !allProvidersLoaded && Object.keys(allProviderModels).length > 0}
        <div class="px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
          <div
            class="size-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin"
          ></div>
          <span>Loading more models…</span>
        </div>
      {/if}
    {/snippet}

    {#snippet empty()}
      <div class="px-1 py-1" transition:fade={{ duration: 150 }}>
        {#if isLoadingModels}
          <!-- Grouped skeleton loader mimicking provider groups -->
          {#each [4, 3] as itemCount, i}
            <div>
              <!-- Skeleton group header -->
              <div class="px-3 pt-3 pb-1 flex items-center gap-2">
                <div class="size-3.5 rounded bg-muted/60 animate-pulse"></div>
                <div class="h-3 w-16 bg-muted/60 rounded animate-pulse"></div>
              </div>
              <!-- Skeleton items -->
              {#each Array(itemCount) as _, j}
                <div class="px-3 py-2 flex items-center gap-2">
                  <div class="flex-1 min-w-0">
                    <div
                      class="h-3.5 rounded bg-muted/40 animate-pulse"
                      style="width: {60 + ((j * 17 + i * 23) % 30)}%; animation-delay: {(i *
                        itemCount +
                        j) *
                        75}ms"
                    ></div>
                  </div>
                </div>
              {/each}
            </div>
          {/each}
        {:else if loadError}
          <div class="flex flex-col items-center gap-2.5 py-4 px-3">
            <div class="flex items-center gap-1.5 text-destructive-foreground">
              <Fa icon={faExclamationTriangle} class="h-3.5 w-3.5" />
              <span class="text-sm font-medium">Failed to load models</span>
            </div>
            <button
              type="button"
              class={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
                'bg-muted hover:bg-muted/80 text-foreground transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              )}
              onclick={handleRetry}
            >
              <Fa icon={faArrowsRotate} class="h-3 w-3" />
              Retry
            </button>
          </div>
        {:else}
          <div class="flex flex-col items-center gap-2.5 py-4 px-3 text-muted-foreground">
            <span class="text-sm">No models available</span>
            <button
              type="button"
              class={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
                'bg-muted hover:bg-muted/80 text-foreground transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              )}
              onclick={handleRetry}
            >
              <Fa icon={faArrowsRotate} class="h-3 w-3" />
              Retry
            </button>
          </div>
        {/if}
      </div>
    {/snippet}
  </Dropdown>
{/if}
