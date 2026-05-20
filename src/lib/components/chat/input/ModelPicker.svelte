<script lang="ts">
  import {
  tick,
  untrack,
} from 'svelte';
  import { writable } from 'svelte/store';

  import { agentClient } from '$features/agent/agent.client';
  import { useAgentSession } from '$lib/hooks/useAgentSession.svelte';
  import { updateSession as updateAgentSessionFields } from '$lib/store/slices/agent-session/agent-session-slice';

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
  import ModelPickerEmptyState from './ModelPickerEmptyState.svelte';
  import ModelPickerGroupHeader from './ModelPickerGroupHeader.svelte';
  import ModelPickerProviderNotice, {
    createProviderWarningNotice,
    type ProviderWarningNotice,
  } from './ModelPickerProviderNotice.svelte';
  import ModelProviderErrorItem from './ModelProviderErrorItem.svelte';

  import {
  selectSelectedModel,
  selectAvailableModels,
  selectModelFallbackInfo,
  selectModelPickerCollapsedGroups,
  selectIsLoadingModels,
  selectLoadError,
  selectAllProviderWarnings,
} from '$lib/store/slices/model/model-selectors';
  import {
  clearModelFallbackInfo,
  requestHydrateModelFallbackInfo,
  selectModel,
  setLoadingStateForProvider,
  setModelFallbackInfo,
  setModelPickerGroupCollapsed,
  setWorkspaceModel,
} from '$lib/store/slices/model/model-slice';
  import type { ModelFallbackInfo } from '$lib/store/slices/model/model-types';
  import { selectManagedInstallStatusByProvider } from '$lib/store/slices/agent-availability/agent-availability-selectors';
  import {
  selectActiveProviderId,
  selectEnabledProviderIds,
} from '$lib/store/slices/provider-settings/provider-settings-selectors';
  import {
  getModelsForProvider,
  getModelsForProviderForLoadingState,
} from '$lib/store/slices/model/model-utils';

  import {
  ACP_PROVIDERS,
  getDefaultProviderId,
  getProviderConfig,
  parseCompoundModelId,
  resolvePreferredModel,
} from '$shared/config/provider-config';
  import { getAgentProvider } from '$shared/types/agent-session';
  import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
  import {
  formatProviderLoadError,
  type ProviderLoadError,
} from './model-picker-provider-errors';
  import {
  isUserProviderSettled,
  toDropdownOptions,
} from './model-picker-utils';
  import { cn } from '$lib/utils';
  import { createLogger } from '$lib/utils/client-logger';
  import { toast } from 'svelte-sonner';
  import {
  faCheck,
  faChevronDown,
  faLock,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const logger = createLogger('ModelPicker');

  const activeProviderId$ = selectActiveProviderId();
  const enabledProviderIds$ = selectEnabledProviderIds();
  const selectedModel$ = selectSelectedModel();
  const availableModels$ = selectAvailableModels();
  const collapsedGroupKeys$ = selectModelPickerCollapsedGroups();
  const isLoadingModels$ = selectIsLoadingModels();
  const loadError$ = selectLoadError();
  const allProviderWarnings$ = selectAllProviderWarnings();
  const codexManagedInstallStatus$ = selectManagedInstallStatusByProvider('codex');

  interface Props {
    selectedModel?: string;
    onModelChange?: (model: string) => void;
    providerId?: string;
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
    triggerClass?: string;
    defaultModelId?: string;
    showDefaultOption?: boolean;
    updateGlobalStore?: boolean;
    silentFallback?: boolean;
    showProviderWarningNotice?: boolean;
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    showManageLink = true,
    portal = true,
    triggerClass = '',
    defaultModelId,
    showDefaultOption = false,
    updateGlobalStore = false,
    silentFallback = false,
    showProviderWarningNotice,
  }: Props = $props();

  const agentSession$ = useAgentSession(() => agentId);

  let pendingModelUpdate = $state<string | null>(null);

  const effectiveProviderId = $derived.by(() => {
    if (providerId) {
      return getProviderConfig(providerId).id;
    }

    if (agentId && workspaceId) {
      const session = $agentSession$;
      if (session) {
        const provider = getAgentProvider(session);
        if (provider) return getProviderConfig(provider).id;
      }
    }
    return $activeProviderId$;
  });

  const isAgentProviderOverride = $derived(effectiveProviderId !== $activeProviderId$);

  let agentProviderModels = $state<
    import('$features/auggie/auggie-models.client').AuggieModel[] | null
  >(null);
  import { store as appStore } from '$lib/store/store';
  let agentProviderLoading = $state(false);
  let agentProviderError = $state<string | null>(null);

  function setProviderWarningState(providerId: string, warning: string | undefined) {
    const normalizedId = getProviderConfig(providerId).id;
    appStore.dispatch(setLoadingStateForProvider({ providerId: normalizedId, status: 'success', warning }));
  }

  function setProviderErrorState(providerId: string, error: string) {
    const normalizedId = getProviderConfig(providerId).id;
    appStore.dispatch(setLoadingStateForProvider({ providerId: normalizedId, status: 'error', error }));
  }

  function getProviderWarningNotice(
    providerId: string,
    warnings: Record<string, string>,
  ): ProviderWarningNotice | null {
    const normalizedId = getProviderConfig(providerId).id;
    return createProviderWarningNotice(normalizedId, warnings[normalizedId]);
  }

  let allProviderModels = $state<Record<string, DropdownOption[]>>({});
  let allProviderErrors = $state<Record<string, ProviderLoadError>>({});
  let fetchGeneration = 0;
  let allProvidersLoaded = $state(false);
  let lastFetchedProviderIds = '';

  async function fetchAllProviderModels(enabledIds: string[]) {
    const key = enabledIds.slice().sort().join(',');
    if (key === lastFetchedProviderIds && allProvidersLoaded) return;
    lastFetchedProviderIds = key;

    allProvidersLoaded = false;
    const currentGen = ++fetchGeneration;

    if (enabledIds.length === 0) {
      allProviderErrors = {};
      allProvidersLoaded = true;
      return;
    }

    const results = await Promise.allSettled(
      enabledIds.map(async (pid) => {
        const normalizedId = getProviderConfig(pid).id;
        const result = await getModelsForProviderForLoadingState(normalizedId);
        return [normalizedId, toDropdownOptions(result.models), result.warning] as const;
      }),
    );

    if (fetchGeneration !== currentGen) return;

    const models: Record<string, DropdownOption[]> = {};
    const errors: Record<string, ProviderLoadError> = {};
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        const [pid, options, warning] = result.value;
        models[pid] = options;
        setProviderWarningState(pid, warning);
      } else {
        const providerId = getProviderConfig(enabledIds[index]).id;
        const cachedModels = allProviderModels[providerId];
        if (cachedModels && cachedModels.length > 0) {
          models[providerId] = cachedModels;
        }
        const providerError = formatProviderLoadError(providerId, result.reason);
        errors[providerId] = providerError;
        setProviderErrorState(providerId, providerError.displayText);
      }
    }

    allProviderModels = models;
    allProviderErrors = errors;
    allProvidersLoaded = true;
  }

  $effect(() => {
    const epid = effectiveProviderId;
    const currentGen = ++fetchGeneration;
    if (epid === $activeProviderId$) {
      agentProviderModels = null;
      agentProviderLoading = false;
      agentProviderError = null;
      return;
    }

    agentProviderLoading = true;
    agentProviderError = null;
    getModelsForProviderForLoadingState(epid)
      .then((result) => {
        if (fetchGeneration !== currentGen) return;
        agentProviderModels = result.models;
        setProviderWarningState(epid, result.warning);
        agentProviderLoading = false;
      })
      .catch((err) => {
        if (fetchGeneration !== currentGen) return;
        const providerError = formatProviderLoadError(epid, err);
        agentProviderError = providerError.displayText;
        setProviderErrorState(epid, providerError.displayText);
        agentProviderLoading = false;
      });
  });

  let fetchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (isAgentProviderOverride) return;
    const providerIds = $enabledProviderIds$;
    clearTimeout(fetchDebounceTimer);
    fetchDebounceTimer = setTimeout(() => fetchAllProviderModels(providerIds), 50);
  });

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

  // Track which provider groups are collapsed in the dropdown (persisted through Redux sagas)
  const collapsedGroups = $derived(new Set($collapsedGroupKeys$));

  function toggleGroup(key: string) {
    appStore.dispatch(setModelPickerGroupCollapsed(key, !collapsedGroups.has(key)));
  }

  let refreshingProviders = $state<Set<string>>(new Set());

  async function handleRefreshProvider(providerId: string) {
    if (refreshingProviders.has(providerId)) return;
    refreshingProviders = new Set([...refreshingProviders, providerId]);
    const gen = fetchGeneration;
    try {
      const result = await getModelsForProviderForLoadingState(providerId);
      if (fetchGeneration !== gen) return;
      setProviderWarningState(providerId, result.warning);
      if (isAgentProviderOverride && providerId === effectiveProviderId) {
        agentProviderModels = result.models;
      } else {
        const { [providerId]: _clearedError, ...remainingErrors } = allProviderErrors;
        allProviderErrors = remainingErrors;
        allProviderModels = {
          ...allProviderModels,
          [providerId]: toDropdownOptions(result.models),
        };
      }
    } catch (err) {
      const providerError = formatProviderLoadError(providerId, err);
      allProviderErrors = {
        ...allProviderErrors,
        [providerId]: providerError,
      };
      setProviderErrorState(providerId, providerError.displayText);
      logger.warn('Failed to refresh models for provider', { providerId, error: err });
    } finally {
      const next = new Set(refreshingProviders);
      next.delete(providerId);
      refreshingProviders = next;
    }
  }

  let isRefreshing = $state(false);

  async function handleRetry() {
    if (isAgentProviderOverride) {
      agentProviderLoading = true;
      agentProviderError = null;
      try {
        const result = await getModelsForProviderForLoadingState(effectiveProviderId);
        agentProviderModels = result.models;
        setProviderWarningState(effectiveProviderId, result.warning);
      } catch (err: unknown) {
        const providerError = formatProviderLoadError(effectiveProviderId, err);
        agentProviderError = providerError.displayText;
        setProviderErrorState(effectiveProviderId, providerError.displayText);
      } finally {
        agentProviderLoading = false;
      }
    } else {
      lastFetchedProviderIds = '';
      fetchAllProviderModels($enabledProviderIds$);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleRefreshModels() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      if (isAgentProviderOverride) {
        const result = await getModelsForProviderForLoadingState(effectiveProviderId);
        agentProviderModels = result.models;
        setProviderWarningState(effectiveProviderId, result.warning);
        agentProviderError = null;
      } else {
        lastFetchedProviderIds = '';
        fetchAllProviderModels($enabledProviderIds$);
      }
    } catch (err) {
      if (isAgentProviderOverride) {
        const providerError = formatProviderLoadError(effectiveProviderId, err);
        agentProviderError = providerError.displayText;
        setProviderErrorState(effectiveProviderId, providerError.displayText);
      }
    } finally {
      isRefreshing = false;
    }
  }

  const USE_DEFAULT_VALUE = '__use_default__';

  // undefined means "use default" and shows "Default model" instead of falling back to store
  let localModel = $state<string | undefined>(untrack(() => selectedModel));
  let userChangedModel = $state(false);
  let propModelAtLocalChange = $state<string | undefined>(undefined);

  // Keep a local user selection until the parent prop catches up to localModel.
  $effect(() => {
    if (selectedModel === localModel) {
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

    localModel = selectedModel;
    userChangedModel = false;
    propModelAtLocalChange = undefined;
  });

  $effect(() => {
    if (!deferUpdate && pendingModelUpdate) {
      const model = pendingModelUpdate;
      pendingModelUpdate = null;
      logger.info('Applying deferred model update:', { model, agentId });
      void applyBackendModelUpdate(model);
    }
  });

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
    // Update local state before async work so the UI responds immediately.
    propModelAtLocalChange = selectedModel;
    userChangedModel = true;
    localModel = model;

    if (model !== undefined) {
      onModelChange?.(model);

      await tick();

      if (!updateGlobalStore) {
        return;
      }

      appStore.dispatch(selectModel(model));

      if (workspaceId) {
        appStore.dispatch(setWorkspaceModel({ workspaceId, model }));
        logger.debug('Updated workspace model:', { workspaceId, model });
      }

      if (agentId && workspaceId) {
        appStore.dispatch(updateAgentSessionFields(agentId, { model }));
        logger.debug('Updated local session model:', { agentId, model });

        if (deferUpdate) {
          pendingModelUpdate = model;
          logger.info('Model update deferred until streaming ends:', { model, agentId });
        } else {
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

  const currentModelLabel = $derived.by(() => {
    if (hasExplicitModel) {
      return localModel
        ? (getModelLabel(localModel) ?? parseCompoundModelId(localModel).modelId)
        : 'Default model';
    }

    return defaultModelId ? (getModelLabel(defaultModelId) ?? 'Default model') : 'Default model';
  });

  const triggerProviderId = $derived.by(() => {
    if (!localModel || !hasExplicitModel) return effectiveProviderId;
    const { providerId: modelProvider } = parseCompoundModelId(localModel);
    return modelProvider;
  });

  const isTriggerLabelResolved = $derived.by(() => {
    if (!hasExplicitModel || !localModel) return true; // "Default model" text, no need for skeleton
    if (!isLoadingModels && (isAgentProviderOverride || allProvidersLoaded)) return true;
    if (!isAgentProviderOverride) {
      for (const models of Object.values(allProviderModels)) {
        if (models.some((m) => m.value === localModel)) return true;
      }
    }
    return availableModels.some((m) => m.value === localModel);
  });

  const lockedButtonTitle = $derived(lockedTitle?.trim() || `Model locked: ${currentModelLabel}`);
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
    label: 'Default model',
    description: 'Let the specialist choose the best model',
  };

  const flatModelOptions = $derived<DropdownOption[]>([
    ...(showDefaultOption ? [useDefaultOption] : []),
    ...(isAgentProviderOverride
      ? toDropdownOptions(availableModels)
      : $enabledProviderIds$.flatMap((pid) => allProviderModels[getProviderConfig(pid).id] ?? [])),
  ]);

  const hasLoadedModelOptions = $derived(
    flatModelOptions.some((option) => option.value !== USE_DEFAULT_VALUE && !option.disabled),
  );

  const providerLoadWarnings = $derived.by<ProviderLoadError[]>(() => {
    if (isAgentProviderOverride && agentProviderError) {
      return [formatProviderLoadError(effectiveProviderId, agentProviderError)];
    }

    return $enabledProviderIds$
      .map((pid) => allProviderErrors[getProviderConfig(pid).id])
      .filter((error): error is ProviderLoadError => Boolean(error));
  });

  const nonBlockingProviderWarnings = $derived(
    hasLoadedModelOptions
      ? providerLoadWarnings.filter(
          (warning) => (allProviderModels[warning.providerId]?.length ?? 0) > 0,
        )
      : [],
  );

  const providerFallbackWarnings = $derived.by<ProviderWarningNotice[]>(() => {
    const warnings = $allProviderWarnings$;

    if (isAgentProviderOverride) {
      const warning = getProviderWarningNotice(effectiveProviderId, warnings);
      return warning ? [warning] : [];
    }

    return $enabledProviderIds$
      .map((pid) => getProviderWarningNotice(pid, warnings))
      .filter((warning): warning is ProviderWarningNotice => Boolean(warning));
  });

  const codexFallbackWarning = $derived(
    providerFallbackWarnings.find((warning) => warning.providerId === 'codex') ?? null,
  );

  const isCodexManagedInstallInstalling = $derived(
    $codexManagedInstallStatus$?.managedInstallState === 'installing',
  );

  const codexManagedInstallProgressText = $derived.by(() => {
    const progress = $codexManagedInstallStatus$?.downloadProgress;
    if (typeof progress !== 'number') return 'This may take a moment.';
    return `Download progress: ${Math.round(progress * 100)}%.`;
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
      providerName: 'Model providers',
      message: providerLoadWarnings.map((error) => error.displayText).join('; '),
      displayText: providerLoadWarnings.map((error) => error.displayText).join('; '),
    };
  });

  const groupedModelOptions = $derived.by<DropdownGroup[]>(() => {
    const groups: DropdownGroup[] = [];

    if (showDefaultOption) {
      groups.push({
        key: 'default',
        label: '',
        options: [useDefaultOption],
      });
    }

    if (isAgentProviderOverride) {
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
        } else if (hasLoadedModelOptions && allProviderErrors[pid]) {
          const error = allProviderErrors[pid];
          groups.push({
            key: pid,
            label: error.providerName,
            options: [
              {
                value: `provider-error:${pid}`,
                label: error.displayText,
                description: error.hint,
                disabled: true,
                class: 'cursor-default disabled:opacity-100',
                data: { providerLoadError: error },
              },
            ],
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

  // Normalize a model ID for equivalence comparison: strip the default-provider
  // prefix so `auggie:sonnet4.6` matches bare `sonnet4.6` (and vice versa) when
  // `auggie` is the default provider. Non-default-provider prefixes are preserved
  // so `opencode:foo` still only matches the compound form.
  function normalizeModelIdForMatch(modelId: string): string {
    const defaultId = getDefaultProviderId();
    const prefix = `${defaultId}:`;
    if (modelId.startsWith(prefix)) {
      return modelId.slice(prefix.length);
    }
    return modelId;
  }

  const isSelectedModelUnavailable = $derived.by(() => {
    if (isLoadingModels) return false;
    if (!isAgentProviderOverride && !allProvidersLoaded) return false;
    if (!hasExplicitModel) return false;
    if (!localModel) return false;

    const values = new Set(flatModelOptions.map((opt) => normalizeModelIdForMatch(opt.value)));
    return !values.has(normalizeModelIdForMatch(localModel));
  });

  // --- Per-agent fallback tracking (persisted through Redux sagas so it survives page refresh) ---
  // Keyed by agentId so warnings don't leak across agents/workspaces.
  const agentIdStore = writable('');
  const fallbackInfo$ = selectModelFallbackInfo(agentIdStore);

  // Load persisted fallback info for this agent
  $effect(() => {
    agentIdStore.set(agentId ?? '');
    if (!agentId) {
      return;
    }
    appStore.dispatch(requestHydrateModelFallbackInfo(agentId));
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
    !!agentId && (isSelectedModelUnavailable || $fallbackInfo$ !== null),
  );

  // Warning message to display
  const warningMessage = $derived.by(() => {
    if (isSelectedModelUnavailable) {
      return {
        title: `${localModel || 'Selected model'} is no longer available`,
        description: 'Pick another model to continue.',
      };
    }
    const fallbackInfo = $fallbackInfo$;
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
  // Only applies to pickers tied to an existing agent — onboarding doesn't need this.
  $effect(() => {
    if (!agentId) return;
    if (!isSelectedModelUnavailable) return;
    if (flatModelOptions.length === 0) return;

    // Guard against transient unavailability. This effect dispatches
    // updateAgentSessionFields(agentId, { model }), which PERMANENTLY overwrites
    // the persisted model on the agent session — including across restarts.
    // Only proceed once we're confident the user's provider has truly settled;
    // otherwise a slow/empty per-provider fetch during boot or refresh would
    // silently replace the user's picked model (e.g. Sonnet 4.6 → GPT 5.4).
    const { providerId: rawModelProvider } = parseCompoundModelId(localModel ?? '');
    const modelProvider = getProviderConfig(rawModelProvider).id;
    if (
      !isUserProviderSettled({
        isAgentProviderOverride,
        agentProviderModels,
        agentProviderError,
        enabledProviderIds: $enabledProviderIds$,
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
      // Store fallback info per-agent (persisted through Redux sagas for page refresh)
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

      // Switch to the fallback model — only when the model genuinely disappeared.
      // During a provider switch the model isn't really missing, so skip the silent
      // switch to avoid clobbering a valid compound/bare model ID round-trip.
      handleModelSelect(fallbackOption.value);
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
    <ModelPickerGroupHeader
      {group}
      {groupIndex}
      collapsed={collapsedGroups.has(group.key)}
      refreshing={refreshingProviders.has(group.key)}
      onToggle={toggleGroup}
      onRefresh={handleRefreshProvider}
    />
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
      {@const effortLevels = option.data?.effortLevels as string[] | undefined}
      {@const providerLoadError = option.data?.providerLoadError as ProviderLoadError | undefined}

      <div class="flex gap-2 w-full min-w-0">
        {#if providerLoadError}
          <ModelProviderErrorItem
            providerId={providerLoadError.providerId}
            providerLabel={providerLoadError.providerName}
            error={providerLoadError.message}
            hint={providerLoadError.hint}
          />
        {:else}
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
              {#if selected}
                <Fa icon={faCheck} class="text-xs text-primary shrink-0" />
              {/if}
            </div>
            {#if option.description}
              <div class="text-xs text-subtle truncate mt-0.5" title={option.description}>
                {option.description}
              </div>
            {/if}
            {#if effortLevels && effortLevels.length > 0}
              <div class="text-xs text-subtle/60 truncate hidden">
                Effort: {effortLevels.join(' · ')}
              </div>
            {/if}
          </div>
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
      {#if nonBlockingProviderWarnings.length > 0}
        <div class="px-3 py-2 space-y-1.5 text-xs">
          {#each nonBlockingProviderWarnings as warning (warning.providerId)}
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
    {/snippet}

    {#snippet empty()}
      <ModelPickerEmptyState {isLoadingModels} {blockingLoadError} onRetry={handleRetry} />
    {/snippet}
  </Dropdown>

  <ModelPickerProviderNotice
    warning={isCodexManagedInstallInstalling ? 'Codex managed setup in progress' : codexFallbackWarning?.message}
    docsUrl={isCodexManagedInstallInstalling ? undefined : codexFallbackWarning?.docsUrl}
    show={(showProviderWarningNotice ?? variant === 'default') &&
      (isCodexManagedInstallInstalling || Boolean(codexFallbackWarning))}
    title={isCodexManagedInstallInstalling ? 'Setting up Codex…' : undefined}
    description={isCodexManagedInstallInstalling ? codexManagedInstallProgressText : undefined}
    variant={isCodexManagedInstallInstalling ? 'progress' : 'warning'}
  />
{/if}
