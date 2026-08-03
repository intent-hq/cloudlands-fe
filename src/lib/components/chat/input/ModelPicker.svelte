<script lang="ts">
  /* eslint-disable max-lines */
  import {
  tick,
  untrack,
} from 'svelte';
  import { writable } from 'svelte/store';

  import { agentClient } from '$features/agent/agent.client';
  import { useAgentSession } from '$lib/hooks/useAgentSession.svelte';
  import { updateSession as updateAgentSessionFields } from '$store/renderer/slices/agent-session/agent-session-slice';

  import Button from '$lib/components/ui/button/button.svelte';
  import {
  Dropdown,
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
} from '$store/renderer/slices/model/model-selectors';
  import {
  clearModelFallbackInfo,
  requestHydrateModelFallbackInfo,
  selectModel,
  setLoadingStateForProvider,
  setModelFallbackInfo,
  setModelPickerGroupCollapsed,
} from '$store/renderer/slices/model/model-slice';
  import type { ModelFallbackInfo } from '$store/renderer/slices/model/model-types';
  import { selectManagedInstallStatusByProvider } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
  import {
  selectActiveProviderId,
  selectEnabledProviderIds,
} from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import {
  getModelsForProvider,
  getModelsForProviderForLoadingState,
} from '$store/renderer/slices/model/model-utils';

  import { parseCompoundModelId as parseCompoundModelIdWithDefault } from '$shared/utils/compound-model-id';
  import {
  selectCatalogDefaultProviderId,
  selectNormalizedProviderId,
  selectProviderDisplayName,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { getAgentProvider } from '$shared/types/agent-session';
  import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
  import {
  formatProviderLoadError,
  type ProviderLoadError,
} from './model-picker-provider-errors';
  import { buildGroupedModelOptions } from './model-picker-groups';
  import {
  findModelFallbackOption,
  isProviderEnabled,
  isUserProviderSettled,
  normalizeModelIdForMatch,
  toDropdownOptions,
} from './model-picker-utils';
  import { cn } from '$lib/utils';
  import { createLogger } from '$lib/utils/client-logger';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import {
  faCheck,
  faChevronDown,
  faLock,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const logger = createLogger('ModelPicker');

  const defaultProviderId$ = selectCatalogDefaultProviderId();

  // Catalog-backed local shims for the legacy provider-config helpers, so the
  // picker's many call sites keep their shape. Reads are reactive via the
  // defaultProviderId$ subscription above plus the appStore.state lookups.
  function normalizeProviderId(providerId: string): string {
    return selectNormalizedProviderId.select(appStore.state, providerId);
  }
  function providerDisplayName(providerId: string): string {
    return selectProviderDisplayName.select(appStore.state, providerId);
  }
  function parseCompoundModelId(compoundModelId: string): {
    providerId: string;
    modelId: string;
  } {
    return parseCompoundModelIdWithDefault(compoundModelId, $defaultProviderId$);
  }

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
    selectedModel?: string | null;
    onModelChange?: (model: string) => void;
    /**
     * Optional go/no-go gate invoked before a user-picked model change is
     * applied. Called with the current and target model ids when they differ;
     * returning (or resolving) false reverts the dropdown selection and skips
     * the change entirely. Auto-fallback selections bypass this gate.
     */
    confirmModelChange?: (
      from: string | null | undefined,
      to: string | null,
    ) => boolean | Promise<boolean>;
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
    // Trigger label when no explicit model and no defaultModelId resolve
    // (e.g. "Provider default" for daemon-resolved specialist previews).
    defaultModelLabel?: string;
    showDefaultOption?: boolean;
    // Gates agent-session updates (updateAgentSessionFields, agent.setModel).
    updateGlobalStore?: boolean;
    // Gates the global selectModel dispatch (persisted default); Settings default picker only.
    updateGlobalDefault?: boolean;
    silentFallback?: boolean;
    showProviderWarningNotice?: boolean;
  }

  let {
    selectedModel,
    onModelChange = () => {},
    confirmModelChange,
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
    defaultModelLabel,
    showDefaultOption = false,
    updateGlobalStore = false,
    updateGlobalDefault = false,
    silentFallback = false,
    showProviderWarningNotice,
  }: Props = $props();

  const agentSession$ = useAgentSession(() => agentId);

  let pendingModelUpdate = $state<string | null>(null);

  // Provider from the prop or agent session, or null when neither determines
  // one (fetching then uses the active provider; the trigger icon prefers the
  // displayed model's provider).
  const explicitProviderId = $derived.by(() => {
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

  let agentProviderModels = $state<
    import('$features/auggie/auggie-models.client').AuggieModel[] | null
  >(null);
  import { store as appStore } from '$store/renderer/store';
  let agentProviderLoading = $state(false);
  let agentProviderError = $state<string | null>(null);

  function setProviderWarningState(providerId: string, warning: string | undefined) {
    const normalizedId = normalizeProviderId(providerId);
    appStore.dispatch(setLoadingStateForProvider({ providerId: normalizedId, status: 'success', warning }));
  }

  function setProviderErrorState(providerId: string, error: string) {
    const normalizedId = normalizeProviderId(providerId);
    appStore.dispatch(setLoadingStateForProvider({ providerId: normalizedId, status: 'error', error }));
  }

  function getProviderWarningNotice(
    providerId: string,
    warnings: Record<string, string>,
  ): ProviderWarningNotice | null {
    const normalizedId = normalizeProviderId(providerId);
    return createProviderWarningNotice(normalizedId, warnings[normalizedId]);
  }

  let allProviderModels = $state<Record<string, DropdownOption[]>>({});
  let allProviderErrors = $state<Record<string, ProviderLoadError>>({});
  let allProviderLoading = $state<Record<string, boolean>>({});
  let fetchGeneration = 0;
  let allProvidersLoaded = $state(false);
  let lastFetchedProviderIds = '';

  function hasProviderResult(providerId: string): boolean {
    return Object.prototype.hasOwnProperty.call(allProviderModels, providerId) || Boolean(allProviderErrors[providerId]);
  }

  function setProviderLoading(providerId: string, loading: boolean) {
    const nextLoading = {
      ...allProviderLoading,
      [providerId]: loading,
    };
    allProviderLoading = nextLoading;
    allProvidersLoaded = Object.values(nextLoading).every((isLoading) => !isLoading);
  }

  async function fetchAllProviderModels(enabledIds: string[]) {
    const key = enabledIds.slice().sort().join(',');
    if (key === lastFetchedProviderIds && allProvidersLoaded) return;
    lastFetchedProviderIds = key;

    allProvidersLoaded = false;
    const currentGen = ++fetchGeneration;

    if (enabledIds.length === 0) {
      allProviderModels = {};
      allProviderErrors = {};
      allProviderLoading = {};
      allProvidersLoaded = true;
      return;
    }

    const providerIds = enabledIds.map((pid) => normalizeProviderId(pid));
    allProviderModels = Object.fromEntries(
      Object.entries(allProviderModels).filter(([providerId]) => providerIds.includes(providerId)),
    );
    allProviderErrors = {};
    allProviderLoading = Object.fromEntries(providerIds.map((providerId) => [providerId, true]));

    await Promise.allSettled(
      providerIds.map(async (providerId) => {
        try {
          const result = await getModelsForProviderForLoadingState(providerId);
          if (fetchGeneration !== currentGen) return;
          const { [providerId]: _clearedError, ...remainingErrors } = allProviderErrors;
          allProviderErrors = remainingErrors;
          allProviderModels = {
            ...allProviderModels,
            [providerId]: toDropdownOptions(result.models),
          };
          setProviderWarningState(providerId, result.warning);
        } catch (err) {
          if (fetchGeneration !== currentGen) return;
          const providerError = formatProviderLoadError(providerId, err);
          allProviderErrors = {
            ...allProviderErrors,
            [providerId]: providerError,
          };
          setProviderErrorState(providerId, providerError.displayText);
        } finally {
          if (fetchGeneration !== currentGen) return;
          setProviderLoading(providerId, false);
        }
      }),
    );
  }

  const isEffectiveProviderEnabled = $derived(
    isProviderEnabled($enabledProviderIds$, effectiveProviderId),
  );

  // The per-agent fetch is only needed when the effective provider's models
  // aren't already covered by the all-providers fetch because the agent's
  // provider was since disabled. Skipping it otherwise avoids a duplicate fetch.
  const usesAgentProviderFetch = $derived(
    effectiveProviderId !== $activeProviderId$ && !isEffectiveProviderEnabled,
  );

  // Separate generation counter from fetchAllProviderModels: in unlocked mode
  // both fetches can run concurrently and must not cancel each other.
  let agentFetchGeneration = 0;
  async function fetchAgentProviderModels(providerId: string) {
    const currentGen = ++agentFetchGeneration;
    agentProviderLoading = true;
    agentProviderError = null;

    try {
      const result = await getModelsForProviderForLoadingState(providerId);
      if (agentFetchGeneration !== currentGen) return;
      agentProviderModels = result.models;
      setProviderWarningState(providerId, result.warning);
    } catch (err) {
      if (agentFetchGeneration !== currentGen) return;
      const providerError = formatProviderLoadError(providerId, err);
      agentProviderError = providerError.displayText;
      setProviderErrorState(providerId, providerError.displayText);
    } finally {
      if (agentFetchGeneration === currentGen) {
        agentProviderLoading = false;
      }
    }
  }

  $effect(() => {
    const epid = effectiveProviderId;
    if (!usesAgentProviderFetch) {
      ++agentFetchGeneration;
      agentProviderModels = null;
      agentProviderLoading = false;
      agentProviderError = null;
      return;
    }

    void fetchAgentProviderModels(epid);
  });

  let fetchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const providerIds = $enabledProviderIds$;
    clearTimeout(fetchDebounceTimer);
    fetchDebounceTimer = setTimeout(() => fetchAllProviderModels(providerIds), 50);
  });

  // Models for the effective provider: the per-agent fetch result when the
  // agent's provider differs from the active one, the global store otherwise.
  const availableModels = $derived(
    agentProviderLoading
      ? []
      : (agentProviderModels ?? (agentProviderError ? [] : $availableModels$)),
  );
  const isLoadingModels = $derived(
    agentProviderLoading ||
      (!hasProviderResult(effectiveProviderId) &&
        ($isLoadingModels$ || allProviderLoading[effectiveProviderId] || !allProvidersLoaded)),
  );
  const loadError = $derived($loadError$);

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
      // True force refresh: the daemon skips its cache and awaits a fresh
      // probe (PROTOCOL §6.7), so the spinner spins for the real probe
      // duration and the returned list replaces the group immediately.
      const result = await getModelsForProviderForLoadingState(providerId, { forceRefresh: true });
      if (fetchGeneration !== gen) return;
      setProviderWarningState(providerId, result.warning);
      if (providerId === effectiveProviderId && usesAgentProviderFetch) {
        agentProviderModels = result.models;
      }
      const { [providerId]: _clearedError, ...remainingErrors } = allProviderErrors;
      allProviderErrors = remainingErrors;
      allProviderModels = {
        ...allProviderModels,
        [providerId]: toDropdownOptions(result.models),
      };
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
    lastFetchedProviderIds = '';
    const requests = [fetchAllProviderModels($enabledProviderIds$)];
    if (usesAgentProviderFetch) {
      requests.push(fetchAgentProviderModels(effectiveProviderId));
    }
    await Promise.all(requests);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleRefreshModels() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      lastFetchedProviderIds = '';
      const requests = [fetchAllProviderModels($enabledProviderIds$)];
      if (usesAgentProviderFetch) {
        requests.push(fetchAgentProviderModels(effectiveProviderId));
      }
      await Promise.all(requests);
    } finally {
      isRefreshing = false;
    }
  }

  const USE_DEFAULT_VALUE = '__use_default__';

  // undefined/null means "use default" and shows "Default model" instead of falling back to store
  let localModel = $state<string | null | undefined>(untrack(() => selectedModel));
  let userChangedModel = $state(false);
  let propModelAtLocalChange = $state<string | null | undefined>(undefined);

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
    logger.debug('Model selected:', { model, previousModel: localModel, workspaceId, agentId });
    logger.debug('Model pick flags:', { deferUpdate, updateGlobalStore, updateGlobalDefault });
    // Update local state before async work so the UI responds immediately.
    propModelAtLocalChange = selectedModel;
    userChangedModel = true;
    localModel = model;

    if (model !== undefined) {
      onModelChange?.(model);

      await tick();

      if (updateGlobalDefault) appStore.dispatch(selectModel(model));
      if (!updateGlobalStore) return;

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
  // Only the bare "default" string is the "use default" sentinel (delegation-chain guard);
  // provider-prefixed ids like "claude-code:default" are explicit catalog selections.
  const hasExplicitModel = $derived(
    localModel !== undefined &&
      localModel !== null &&
      localModel !== USE_DEFAULT_VALUE &&
      localModel !== 'undefined' &&
      localModel !== 'default',
  );

  // Get the label for a model ID from available models list; undefined when
  // the id resolves to no loaded model (callers pick the fallback).
  function getModelLabel(modelId: string | undefined): string | undefined {
    if (!modelId) return undefined;
    for (const models of Object.values(allProviderModels)) {
      const found = models.find((m) => m.value === modelId);
      if (found) return found.label;
    }
    return availableModels.find((m) => m.value === modelId)?.label;
  }

  const currentModelLabel = $derived.by(() => {
    if (hasExplicitModel) {
      return localModel
        ? (getModelLabel(localModel) ?? parseCompoundModelId(localModel).modelId)
        : (defaultModelLabel ?? m.chat_modelPicker_defaultModel_label());
    }

    // Unresolvable defaultModelId (models not loaded yet): prefer the caller's
    // defaultModelLabel (e.g. "Provider default"), then the bare model id.
    return defaultModelId
      ? (getModelLabel(defaultModelId) ??
          defaultModelLabel ??
          parseCompoundModelId(defaultModelId).modelId)
      : (defaultModelLabel ?? m.chat_modelPicker_defaultModel_label());
  });

  const triggerProviderId = $derived.by(() => {
    if (localModel && hasExplicitModel) {
      return parseCompoundModelId(localModel).providerId;
    }
    if (explicitProviderId) return explicitProviderId;
    // No explicit provider or model — show the displayed default model's provider.
    if (defaultModelId) return parseCompoundModelId(defaultModelId).providerId;
    return $activeProviderId$;
  });

  const isTriggerLabelResolved = $derived.by(() => {
    if (!hasExplicitModel || !localModel) return true; // "Default model" text, no need for skeleton
    if (!isLoadingModels && allProvidersLoaded) return true;
    for (const models of Object.values(allProviderModels)) {
      if (models.some((m) => m.value === localModel)) return true;
    }
    return availableModels.some((m) => m.value === localModel);
  });

  const lockedButtonTitle = $derived(
    lockedTitle?.trim() || m.chat_modelPicker_modelLocked_title({ model: currentModelLabel }),
  );
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
      return m.chat_modelPicker_defaultModel_label();
    },
    get description() {
      return m.chat_modelPicker_defaultModel_description();
    },
  };

  const flatModelOptions = $derived<DropdownOption[]>([
    ...(showDefaultOption ? [useDefaultOption] : []),
    ...$enabledProviderIds$.flatMap((pid) => allProviderModels[normalizeProviderId(pid)] ?? []),
    // Keep the agent's current provider selectable even if it was since
    // disabled, so the selected model isn't treated as unavailable.
    ...(isEffectiveProviderEnabled ? [] : toDropdownOptions(availableModels)),
  ]);

  const hasLoadedModelOptions = $derived(
    flatModelOptions.some((option) => option.value !== USE_DEFAULT_VALUE && !option.disabled),
  );

  const providerLoadWarnings = $derived.by<ProviderLoadError[]>(() => {
    return $enabledProviderIds$
      .map((pid) => allProviderErrors[normalizeProviderId(pid)])
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
    if (typeof progress !== 'number') return m.chat_modelPicker_installMoment_label();
    return m.chat_modelPicker_downloadProgress_label({
      percent: formatInteger(Math.round(progress * 100)),
    });
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
      message: providerLoadWarnings.map((error) => error.displayText).join('; '),
      displayText: providerLoadWarnings.map((error) => error.displayText).join('; '),
    };
  });

  const groupedModelOptions = $derived.by(() =>
    buildGroupedModelOptions({
      showDefaultOption,
      useDefaultOption,
      effectiveProviderId,
      availableModels,
      enabledProviderIds: $enabledProviderIds$,
      allProviderModels,
      allProviderLoading,
      allProviderErrors,
      allProviderWarnings: $allProviderWarnings$,
    }),
  );

  // The value bound to the dropdown (convert undefined to USE_DEFAULT_VALUE).
  // Bound state rather than derived so a rejected confirmModelChange can
  // revert the dropdown's internal selection back to the current model.
  let dropdownValue = $state(untrack(() => localModel ?? USE_DEFAULT_VALUE));
  $effect(() => {
    dropdownValue = localModel ?? USE_DEFAULT_VALUE;
  });

  // Display groups — same as groupedModelOptions but with collapsed groups' options hidden
  const displayGroups = $derived(
    groupedModelOptions.map((group) => ({
      ...group,
      options: collapsedGroups.has(group.key) ? [] : group.options,
    })),
  );

  const isSelectedModelUnavailable = $derived.by(() => {
    if (isLoadingModels) return false;
    if (!allProvidersLoaded) return false;
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

  function findFallbackOption(restrictToProvider?: string): DropdownOption | undefined {
    return findModelFallbackOption({
      options: flatModelOptions,
      excludeValue: USE_DEFAULT_VALUE,
      restrictToProvider,
      preferredModels: MODEL_DEFAULTS.UI_MODEL_PREFERENCE,
      globallySelectedModel: $selectedModel$,
    });
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
    const modelProvider = normalizeProviderId(rawModelProvider);
    if (
      !isUserProviderSettled({
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
    const unavailableModelName = localModel || m.chat_modelPicker_selectedModel_fallback();

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
    const activeProvider = normalizeProviderId($activeProviderId$);
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
    const currentProvider = normalizeProviderId(rawCurrentProvider);

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
          const normalizedId = normalizeProviderId(currentProvider);
          allProviderModels = {
            ...allProviderModels,
            [normalizedId]: toDropdownOptions(models),
          };
          return;
        }
      } catch (err) {
        logger.warn('Retry fetch failed for provider', { provider: currentProvider, error: err });
      }

      const providerName = providerDisplayName(currentProvider);
      toast.warning(m.chat_modelPicker_noModelsForProvider_toast({ provider: providerName }), {
        description: m.chat_modelPicker_tryRefreshing_description(),
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

  async function handleModelChange(value: string | string[]) {
    const modelValue = value as string;
    // Gate user-picked changes to a *different* model behind the optional
    // confirmation callback (mid-conversation switch warning). Re-selecting
    // the current model is never gated; picking "Default model" while an
    // explicit model is selected is gated too — the agent still restarts on
    // the provider default (a null `to` in the gate means "provider default").
    const isActualChange =
      modelValue === USE_DEFAULT_VALUE
        ? hasExplicitModel
        : !localModel || normalizeModelIdForMatch(modelValue) !== normalizeModelIdForMatch(localModel);
    if (isActualChange && confirmModelChange) {
      const confirmed = await confirmModelChange(
        localModel,
        modelValue === USE_DEFAULT_VALUE ? null : modelValue,
      );
      if (!confirmed) {
        // Revert the dropdown's internal selection back to the current model.
        dropdownValue = localModel ?? USE_DEFAULT_VALUE;
        return;
      }
    }
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
    bind:value={dropdownValue}
    defaultHighlightValue={defaultModelId}
    bind:open={dropdownOpen}
    groups={displayGroups}
    onchange={handleModelChange}
    variant={variant === 'outline' ? 'outline' : variant === 'default' ? 'default' : 'ghost'}
    size={size === 'xs' ? 'xs' : 'sm'}
    searchable={true}
    placeholder={m.chat_modelPicker_searchModels_placeholder()}
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
      {@const providerLoading = option.data?.providerLoading as boolean | undefined}

      <div class="flex gap-2 w-full min-w-0">
        {#if providerLoading}
          <div class="flex items-center gap-2 text-muted-foreground text-sm">
            <div
              class="size-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin"
            ></div>
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
                {m.chat_modelPicker_effort_label({ levels: effortLevels.join(' · ') })}
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
          <span>{m.chat_modelPicker_loadingMore_label()}</span>
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
    warning={isCodexManagedInstallInstalling
      ? m.chat_modelPicker_codexSetupInProgress_label()
      : codexFallbackWarning?.message}
    docsUrl={isCodexManagedInstallInstalling ? undefined : codexFallbackWarning?.docsUrl}
    show={(showProviderWarningNotice ?? variant === 'default') &&
      (isCodexManagedInstallInstalling || Boolean(codexFallbackWarning))}
    title={isCodexManagedInstallInstalling ? m.chat_modelPicker_settingUpCodex_title() : undefined}
    description={isCodexManagedInstallInstalling ? codexManagedInstallProgressText : undefined}
    variant={isCodexManagedInstallInstalling ? 'progress' : 'warning'}
  />
{/if}
