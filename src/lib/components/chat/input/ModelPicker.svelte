<script lang="ts">
  /* eslint-disable max-lines */
  import { onMount, tick, untrack } from 'svelte';
  import { writable } from 'svelte/store';

  import { agentClient } from '$features/agent/agent.client';
  import {
    applyReasoningEffort,
    reconcileAgentReasoningEffort,
  } from '$features/agent/reasoning-effort';
  import { useAgentSession } from '$lib/hooks/useAgentSession.svelte';
  import { updateSession as updateAgentSessionFields } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { selectAgentReasoningEffort } from '$store/renderer/slices/agent-session/agent-session-selectors';

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

  import {
    selectSelectedModel,
    selectAvailableModels,
    selectAvailableModelsProviderId,
    selectModelFallbackInfo,
    selectModelPickerCollapsedGroups,
    selectIsLoadingModels,
    selectLoadError,
    selectAllProviderWarnings,
    selectAllProviderStaleFlags,
    selectAgentModelEffortLevels,
  } from '$store/renderer/slices/model/model-selectors';
  import {
    clearModelFallbackInfo,
    selectModel,
    setLoadingStateForProvider,
    setModelFallbackInfo,
    setModelPickerGroupCollapsed,
  } from '$store/renderer/slices/model/model-slice';
  import type { ModelFallbackInfo } from '$store/renderer/slices/model/model-types';
  import { selectHasCheckedOnce } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
  import { selectDaemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { ensureProvidersChecked } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import {
    selectActiveProviderId,
    selectAvailableEnabledProviderIds,
    selectIsProviderModelAccessAllowed,
    selectModelFetchProviderIds,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import {
    getModelsForProvider,
    getModelsForProviderForLoadingState,
  } from '$store/renderer/slices/model/model-utils';
  import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
  import {
    selectProviderModelsCacheEntry,
    selectProviderModelsCacheMap,
    selectProviderModelsClearEpoch,
  } from '$store/renderer/slices/provider-models/provider-models-selectors';

  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import {
    selectEffectiveDefaultProviderId,
    selectNormalizedProviderId,
    selectProviderDisplayName,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { getAgentProvider } from '$shared/types/agent-session';
  import { formatProviderLoadError, type ProviderLoadError } from './model-picker-provider-errors';
  import { AUGGIE_LEGACY_GROUP_KEY, buildGroupedModelOptions } from './model-picker-groups';
  import {
    filterDefaultPseudoOptions,
    findModelFallbackOption,
    isProviderEnabled,
    isUserProviderSettled,
    normalizeModelIdForMatch,
    toDropdownOptions,
  } from './model-picker-utils';
  import { cn } from '$lib/utils';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { createLogger } from '$lib/utils/client-logger';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import {
    faArrowsRotate,
    faCheck,
    faChevronDown,
    faLock,
    faPlus,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const logger = createLogger('ModelPicker');

  const defaultProviderId$ = selectEffectiveDefaultProviderId();

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
    const { providerId, modelId } = splitLegacyCompoundId(compoundModelId);
    return { providerId: providerId ?? $defaultProviderId$, modelId };
  }

  const activeProviderId$ = selectActiveProviderId();
  const modelFetchProviderIds$ = selectModelFetchProviderIds();
  const antigravityModelsAllowed$ = selectIsProviderModelAccessAllowed('antigravity');
  function canUseProviderModels(providerId: string): boolean {
    return normalizeProviderId(providerId) !== 'antigravity' || $antigravityModelsAllowed$;
  }
  const availableEnabledProviderIds$ = selectAvailableEnabledProviderIds();
  const selectedModel$ = selectSelectedModel();
  const availableModels$ = selectAvailableModels();
  const availableModelsProviderId$ = selectAvailableModelsProviderId();
  const collapsedGroupKeys$ = selectModelPickerCollapsedGroups();
  const isLoadingModels$ = selectIsLoadingModels();
  const loadError$ = selectLoadError();
  const allProviderWarnings$ = selectAllProviderWarnings();
  const allProviderStaleFlags$ = selectAllProviderStaleFlags();
  const hasCheckedOnce$ = selectHasCheckedOnce();
  const daemonHealth$ = selectDaemonHealth();

  // The availability status map gates which providers the picker offers, but
  // outside onboarding nothing else triggers the bulk check — a fresh session
  // that never mounted AgentGrid would sit on an empty map forever. The
  // trigger is ensure-once and the middleware coalesces overlapping bulk
  // checks, so multiple pickers mounting concurrently cause no duplicate probes.
  onMount(() => {
    appStore.dispatch(ensureProvidersChecked());
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
    // inherit state). Only applied when defaultModelId is set.
    formatDefaultModelLabel?: (modelLabel: string) => string;
    // Gates agent-session updates (updateAgentSessionFields, agent.setModel).
    updateGlobalStore?: boolean;
    // Gates the global selectModel dispatch (persisted default); Settings default picker only.
    updateGlobalDefault?: boolean;
    silentFallback?: boolean;
    showReasoning?: boolean;
    reasoningEffort?: string | null;
    onReasoningChange?: (effort: string | null) => boolean | void | Promise<boolean | void>;
    reasoningDisabled?: boolean;
    showProviderWarningNotice?: boolean;
    /**
     * Extra classes for the provider notice boxes. Callers that render the
     * picker inside a flex row use this to let the notice break onto its own
     * full-width line (e.g. `basis-full w-full max-w-full` + `flex-wrap` on
     * the row) instead of sitting inline next to the trigger.
     */
    noticeClass?: string;
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
    onReasoningChange,
    reasoningDisabled = false,
    showProviderWarningNotice,
    noticeClass,
  }: Props = $props();

  // `default`-variant pickers stack the notice directly under a full-width
  // trigger, so give it a default top margin; callers can still override it.
  const resolvedNoticeClass = $derived(
    variant === 'default' ? cn('mt-2', noticeClass) : noticeClass,
  );

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

  function setProviderWarningState(
    providerId: string,
    warning: string | undefined,
    stale: boolean | undefined,
  ) {
    const normalizedId = normalizeProviderId(providerId);
    appStore.dispatch(
      setLoadingStateForProvider({ providerId: normalizedId, status: 'success', warning, stale }),
    );
  }

  function setProviderErrorState(providerId: string, error: string) {
    const normalizedId = normalizeProviderId(providerId);
    appStore.dispatch(
      setLoadingStateForProvider({ providerId: normalizedId, status: 'error', error }),
    );
  }

  function getProviderWarningNotice(
    providerId: string,
    warnings: Record<string, string>,
  ): ProviderWarningNotice | null {
    const normalizedId = normalizeProviderId(providerId);
    return createProviderWarningNotice(normalizedId, warnings[normalizedId]);
  }

  // Hydrate from the session-lifetime provider-models cache
  // (stale-while-revalidate): cached providers render their catalogs — and a
  // resolved trigger label — synchronously on mount, with no spinner/skeleton
  // frame, while the debounced background fetch below still revalidates every
  // provider and writes fresh results back through the cache. Uncached
  // providers keep the normal loading path.
  const cachedProviderCatalogs = selectProviderModelsCacheMap.select(appStore.state);
  const seededProviderModels: Record<string, DropdownOption[]> = {};
  const seededProviderLoading: Record<string, boolean> = {};
  for (const [pid, entry] of Object.entries(cachedProviderCatalogs)) {
    if (!canUseProviderModels(pid)) continue;
    seededProviderModels[pid] = toDropdownOptions(entry.models);
    seededProviderLoading[pid] = false;
  }
  // "All loaded" only when every currently-enabled provider is cache-covered;
  // otherwise the first fetch pass settles it exactly as before.
  const seededEnabledIds = $availableEnabledProviderIds$;
  const seededAllProvidersLoaded =
    seededEnabledIds.length > 0 &&
    seededEnabledIds.every((pid) =>
      Object.prototype.hasOwnProperty.call(seededProviderModels, normalizeProviderId(pid)),
    );

  let allProviderModels = $state<Record<string, DropdownOption[]>>(seededProviderModels);
  let allProviderErrors = $state<Record<string, ProviderLoadError>>({});
  let allProviderLoading = $state<Record<string, boolean>>(seededProviderLoading);
  let fetchGeneration = 0;
  const providerFetchGenerations = new Map<string, number>();
  const refreshingProviderEpochs = new Map<string, number>();
  let allProvidersLoaded = $state(seededAllProvidersLoaded);
  let lastFetchedProviderIds = '';

  function advanceProviderFetchGeneration(providerId: string): number {
    const generation = (providerFetchGenerations.get(providerId) ?? 0) + 1;
    providerFetchGenerations.set(providerId, generation);
    return generation;
  }

  function hasProviderResult(providerId: string): boolean {
    return (
      Object.prototype.hasOwnProperty.call(allProviderModels, providerId) ||
      Boolean(allProviderErrors[providerId])
    );
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
    enabledIds = enabledIds.filter(canUseProviderModels);
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

    // Epoch at fetch start: a reconnect clear that lands while these
    // responses are in flight makes them stale — the settle-time isStale()
    // check keeps them out of local state (the epoch effect's generation
    // bump can run after a pending response settles) and the reducer drops
    // any pre-clear write-through stamped below as a second line of defense.
    const cacheEpoch = selectProviderModelsClearEpoch.select(appStore.state);
    const providerIdsToFetch = providerIds.filter(
      (providerId) =>
        !refreshingProviders.has(providerId) ||
        refreshingProviderEpochs.get(providerId) !== cacheEpoch,
    );
    const fetchingProviderIds = new Set(providerIdsToFetch);
    allProviderLoading = Object.fromEntries(
      providerIds.map((providerId) => [providerId, fetchingProviderIds.has(providerId)]),
    );
    allProvidersLoaded = providerIdsToFetch.length === 0;

    await Promise.allSettled(
      providerIdsToFetch.map(async (providerId) => {
        const providerGeneration = advanceProviderFetchGeneration(providerId);
        const isStale = () =>
          fetchGeneration !== currentGen ||
          providerFetchGenerations.get(providerId) !== providerGeneration ||
          selectProviderModelsClearEpoch.select(appStore.state) !== cacheEpoch;
        try {
          const result = await getModelsForProviderForLoadingState(providerId);
          if (isStale()) return;
          const { [providerId]: _clearedError, ...remainingErrors } = allProviderErrors;
          allProviderErrors = remainingErrors;
          allProviderModels = {
            ...allProviderModels,
            [providerId]: toDropdownOptions(result.models),
          };
          // Write through to the session cache (providerId is normalized here).
          appStore.dispatch(providerModelsLoaded(providerId, result, cacheEpoch));
          setProviderWarningState(providerId, result.warning, result.stale);
        } catch (err) {
          if (isStale()) return;
          const providerError = formatProviderLoadError(providerId, err);
          allProviderErrors = {
            ...allProviderErrors,
            [providerId]: providerError,
          };
          setProviderErrorState(providerId, providerError.displayText);
        } finally {
          if (!isStale()) {
            setProviderLoading(providerId, false);
          }
        }
      }),
    );
  }

  const isEffectiveProviderAvailable = $derived(
    isProviderEnabled($availableEnabledProviderIds$, effectiveProviderId),
  );

  // The per-agent fetch is only needed when the effective provider's models
  // aren't already covered by the all-providers fetch because the agent's
  // provider is since unavailable. Skipping it otherwise avoids a duplicate fetch.
  const usesAgentProviderFetch = $derived(
    canUseProviderModels(effectiveProviderId) &&
      effectiveProviderId !== $activeProviderId$ &&
      !isEffectiveProviderAvailable,
  );

  // Separate generation counter from fetchAllProviderModels: in unlocked mode
  // both fetches can run concurrently and must not cancel each other.
  let agentFetchGeneration = 0;
  async function fetchAgentProviderModels(providerId: string) {
    const currentGen = ++agentFetchGeneration;
    if (!canUseProviderModels(providerId)) return;
    // Hydrate from the session cache (stale-while-revalidate): a cached
    // catalog renders immediately with no loading state — the all-provider
    // fetch prunes disabled providers from allProviderModels, so this path is
    // the only cache consumer for a locked/agent picker whose provider is no
    // longer enabled. The fetch below still revalidates.
    const cacheId = normalizeProviderId(providerId);
    const cached = selectProviderModelsCacheEntry.select(appStore.state, cacheId);
    if (cached) {
      agentProviderModels = cached.models;
      agentProviderLoading = false;
    } else {
      agentProviderLoading = true;
    }
    agentProviderError = null;

    // Epoch at fetch start: a reconnect clear mid-flight makes this response
    // stale for local state too, not just for the reducer write-through.
    const cacheEpoch = selectProviderModelsClearEpoch.select(appStore.state);
    const isStale = () =>
      agentFetchGeneration !== currentGen ||
      selectProviderModelsClearEpoch.select(appStore.state) !== cacheEpoch;
    try {
      const result = await getModelsForProviderForLoadingState(providerId);
      if (isStale()) return;
      agentProviderModels = result.models;
      // Write through so the next mount of this picker hydrates too.
      appStore.dispatch(providerModelsLoaded(cacheId, result, cacheEpoch));
      setProviderWarningState(providerId, result.warning, result.stale);
    } catch (err) {
      if (isStale()) return;
      const providerError = formatProviderLoadError(providerId, err);
      agentProviderError = providerError.displayText;
      setProviderErrorState(providerId, providerError.displayText);
    } finally {
      if (!isStale()) {
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
    const providerIds = $modelFetchProviderIds$;
    clearTimeout(fetchDebounceTimer);
    fetchDebounceTimer = setTimeout(() => fetchAllProviderModels(providerIds), 50);
  });

  // React to the session cache being cleared (backend reconnect, RESUB-1):
  // a mounted picker has already copied cached rows into local state and
  // fetchAllProviderModels dedups on unchanged enabled-provider ids, so
  // without this an open picker would keep the pre-reconnect catalog
  // indefinitely. Keyed on the clear EPOCH, not the map going empty: the
  // epoch increments on every providerModelsCacheCleared, so a reconnect
  // during initial load (cache already empty — an empty→empty map
  // transition) still triggers the generation bump + refetch. The fresh
  // fetches read the post-clear epoch at start, so their results land in
  // both local state and the cache.
  const providerModelsClearEpoch$ = selectProviderModelsClearEpoch();
  let lastSeenClearEpoch = selectProviderModelsClearEpoch.select(appStore.state);
  $effect(() => {
    const epoch = $providerModelsClearEpoch$;
    if (epoch === lastSeenClearEpoch) return;
    lastSeenClearEpoch = epoch;
    untrack(() => {
      lastFetchedProviderIds = '';
      void fetchAllProviderModels($availableEnabledProviderIds$);
      if (usesAgentProviderFetch) {
        void fetchAgentProviderModels(effectiveProviderId);
      }
    });
  });

  // Models for the effective provider: the per-agent fetch result when the
  // agent's provider differs from the active one, the global store otherwise.
  const availableModels = $derived(
    !canUseProviderModels(
      agentProviderModels ? effectiveProviderId : $availableModelsProviderId$,
    ) || agentProviderLoading
      ? []
      : (agentProviderModels ?? (agentProviderError ? [] : $availableModels$)),
  );
  // Which provider `availableModels` was loaded for: the per-agent fetch is
  // for the effective provider by construction; the global catalog carries
  // explicit provenance ('' before the first load).
  const availableModelsProviderId = $derived(
    !agentProviderLoading && agentProviderModels
      ? effectiveProviderId
      : $availableModelsProviderId$,
  );
  const isLoadingModels = $derived(
    canUseProviderModels(effectiveProviderId) &&
      (agentProviderLoading ||
        (!hasProviderResult(effectiveProviderId) &&
          ($isLoadingModels$ || allProviderLoading[effectiveProviderId] || !allProvidersLoaded))),
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
    if (!canUseProviderModels(providerId)) return;
    if (refreshingProviders.has(providerId)) return;
    // Epoch at fetch start: a reconnect clear mid-flight makes this response
    // stale for local state as well as for the reducer write-through.
    const cacheEpoch = selectProviderModelsClearEpoch.select(appStore.state);
    const providerGeneration = advanceProviderFetchGeneration(providerId);
    refreshingProviderEpochs.set(providerId, cacheEpoch);
    refreshingProviders = new Set([...refreshingProviders, providerId]);
    const isStale = () =>
      providerFetchGenerations.get(providerId) !== providerGeneration ||
      selectProviderModelsClearEpoch.select(appStore.state) !== cacheEpoch;
    try {
      // True force refresh: the daemon skips its cache and awaits a fresh
      // probe (PROTOCOL §6.7), so the spinner spins for the real probe
      // duration and the returned list replaces the group immediately.
      const result = await getModelsForProviderForLoadingState(providerId, { forceRefresh: true });
      if (isStale()) return;
      setProviderWarningState(providerId, result.warning, result.stale);
      if (providerId === effectiveProviderId && usesAgentProviderFetch) {
        agentProviderModels = result.models;
      }
      const { [providerId]: _clearedError, ...remainingErrors } = allProviderErrors;
      allProviderErrors = remainingErrors;
      allProviderModels = {
        ...allProviderModels,
        [providerId]: toDropdownOptions(result.models),
      };
      // Write through to the session cache (group keys are normalized ids).
      appStore.dispatch(providerModelsLoaded(providerId, result, cacheEpoch));
    } catch (err) {
      if (isStale()) return;
      const providerError = formatProviderLoadError(providerId, err);
      allProviderErrors = {
        ...allProviderErrors,
        [providerId]: providerError,
      };
      setProviderErrorState(providerId, providerError.displayText);
      logger.warn('Failed to refresh models for provider', { providerId, error: err });
    } finally {
      refreshingProviderEpochs.delete(providerId);
      const next = new Set(refreshingProviders);
      next.delete(providerId);
      refreshingProviders = next;
    }
  }

  let isRefreshing = $state(false);

  async function handleRetry() {
    lastFetchedProviderIds = '';
    const requests = [fetchAllProviderModels($availableEnabledProviderIds$)];
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
      const requests = [fetchAllProviderModels($availableEnabledProviderIds$)];
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

  // Resolve the provider owning a picked row. Catalog groups carry bare ids
  // for every provider, so a bare pick is attributed to the loaded group that
  // contains the row rather than blanket-attributed to the default provider.
  // A legacy compound prefix (persisted ids) still wins outright; when several
  // groups own the same bare id — or no loaded group owns it — the default
  // provider keeps priority (the intent-hq/monorepo#1657 contract).
  function resolvePickedTriple(model: string): { providerId: string; modelId: string } {
    const { providerId: legacyProviderId, modelId } = splitLegacyCompoundId(model);
    if (legacyProviderId) return { providerId: legacyProviderId, modelId };
    const matchesIn = (rowProviderId: string, options: { value: string }[] | undefined) =>
      Boolean(
        options?.some(
          (opt) =>
            normalizeModelIdForMatch(opt.value, rowProviderId) ===
            normalizeModelIdForMatch(modelId, rowProviderId),
        ),
      );
    const defaultNormalized = normalizeProviderId($defaultProviderId$);
    if (defaultNormalized && matchesIn(defaultNormalized, allProviderModels[defaultNormalized])) {
      return { providerId: defaultNormalized, modelId };
    }
    for (const [rowProviderId, options] of Object.entries(allProviderModels)) {
      if (matchesIn(rowProviderId, options)) return { providerId: rowProviderId, modelId };
    }
    return { providerId: $defaultProviderId$, modelId };
  }

  async function applyBackendModelUpdate(model: string) {
    if (agentId && workspaceId) {
      try {
        // Send the picked model's provider explicitly: the owning catalog
        // group's provider (legacy compound prefix wins). Without it the
        // daemon resolves a bare id against the session's current provider,
        // rejecting cross-provider picks.
        const pickedProviderId = resolvePickedTriple(model).providerId || undefined;
        const result = await agentClient.setModel(agentId, model, workspaceId, pickedProviderId);
        if (result.ok && result.data.success) {
          logger.info('Updated agent model via IPC:', { agentId, model });
          const targetOption = flatModelOptions.find(
            (option) => normalizeModelIdForMatch(option.value) === normalizeModelIdForMatch(model),
          );
          const supportedEfforts = targetOption?.data?.effortLevels as string[] | undefined;
          const currentEffort = selectAgentReasoningEffort.select(appStore.state, agentId);
          await reconcileAgentReasoningEffort(
            agentId,
            workspaceId,
            currentEffort,
            supportedEfforts,
          );
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
    if (model !== undefined && !canUseProviderModels(resolvePickedTriple(model).providerId)) {
      dropdownValue = localModel ?? USE_DEFAULT_VALUE;
      return;
    }
    logger.debug('Model selected:', { model, previousModel: localModel, workspaceId, agentId });
    logger.debug('Model pick flags:', { deferUpdate, updateGlobalStore, updateGlobalDefault });
    // Update local state before async work so the UI responds immediately.
    propModelAtLocalChange = selectedModel;
    userChangedModel = true;
    localModel = model;

    if (model === undefined) {
      // "Use default" picked — notify the parent with an empty string so it
      // can clear an explicit pin (consumers with explicit-model semantics
      // guard on falsy values; no agent/global updates apply to "default").
      // Drop any deferred update queued during streaming so it cannot apply
      // later and override this selection.
      pendingModelUpdate = null;
      onModelChange?.('');
      return;
    }

    // Resolve the pick's triple legs once at the emit boundary: the legacy
    // compound prefix when present, else the provider whose loaded catalog
    // group owns the picked bare row.
    const { providerId: pickedProviderId, modelId: pickedModelId } = resolvePickedTriple(model);
    onModelChange?.(model, { providerId: pickedProviderId, modelId: pickedModelId });

    await tick();

    if (updateGlobalDefault) appStore.dispatch(selectModel(pickedModelId, pickedProviderId));
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
  // Catalog rows now carry bare ids for every provider, while a session id
  // may be daemon-pinned bare or stored legacy-compound, so ids are compared
  // via normalizeModelIdForMatch (like selectedCatalogOption), not exact
  // string equality.
  // Legacy codex compound ids (`{model}/{effort}`) no longer exist as catalog
  // rows (the daemon collapses them to one base row + effortLevels), so on an
  // exact-id miss the base model's label is rendered with the effort suffix
  // appended — existing sessions with a stored compound id keep a sensible
  // label instead of the raw id.
  function getModelLabel(modelId: string | undefined): string | undefined {
    if (!modelId) return undefined;
    const lookup = (id: string): string | undefined => {
      const target = normalizeModelIdForMatch(id, effectiveProviderId);
      for (const [rowProviderId, models] of Object.entries(allProviderModels)) {
        const found = models.find(
          (m) => normalizeModelIdForMatch(m.value, rowProviderId) === target,
        );
        if (found) return found.label;
      }
      return availableModels.find(
        (m) => normalizeModelIdForMatch(m.value, availableModelsProviderId) === target,
      )?.label;
    };
    const exact = lookup(modelId);
    if (exact) return exact;
    const slashIndex = modelId.indexOf('/');
    if (slashIndex > 0 && slashIndex < modelId.length - 1) {
      const baseLabel = lookup(modelId.slice(0, slashIndex));
      if (baseLabel) {
        const effort = modelId.slice(slashIndex + 1);
        return `${baseLabel} (${effort.charAt(0).toUpperCase()}${effort.slice(1)})`;
      }
    }
    return undefined;
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
      const row = availableModels.find((model) => model.isDefault);
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

  const currentModelLabel = $derived.by(() => {
    if (hasExplicitModel) {
      return localModel
        ? (legacyDefaultMappedOption?.label ??
            getModelLabel(localModel) ??
            parseCompoundModelId(localModel).modelId)
        : (defaultModelLabel ?? m.chat_modelPicker_defaultModel_label());
    }

    // Unresolvable defaultModelId (models not loaded yet): prefer the caller's
    // defaultModelLabel (e.g. "Provider default"), then the bare model id. A
    // `<provider>:default` preview maps to its D2 row's label first.
    if (defaultModelId) {
      const resolvedLabel =
        defaultModelIdMappedOption?.label ??
        getModelLabel(defaultModelId) ??
        defaultModelLabel ??
        parseCompoundModelId(defaultModelId).modelId;
      return formatDefaultModelLabel ? formatDefaultModelLabel(resolvedLabel) : resolvedLabel;
    }
    if (catalogDefaultFallbackOption) {
      return formatDefaultModelLabel
        ? formatDefaultModelLabel(catalogDefaultFallbackOption.label)
        : catalogDefaultFallbackOption.label;
    }
    return defaultModelLabel ?? m.chat_modelPicker_defaultModel_label();
  });

  const triggerProviderId = $derived.by(() => {
    if (localModel && hasExplicitModel) {
      // Catalog-ownership attribution so a bare cross-provider selection
      // shows its own provider's icon, not the default provider's.
      return resolvePickedTriple(localModel).providerId;
    }
    if (explicitProviderId) return explicitProviderId;
    // No explicit provider or model — show the displayed default model's provider.
    if (defaultModelId) return parseCompoundModelId(defaultModelId).providerId;
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
    if (!isLoadingModels && allProvidersLoaded) return true;
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
    ...$availableEnabledProviderIds$.flatMap(
      (pid) => allProviderModels[normalizeProviderId(pid)] ?? [],
    ),
    // Keep the agent's current provider selectable even if it was since
    // disabled, so the selected model isn't treated as unavailable.
    ...(isEffectiveProviderAvailable || !fallbackModelsMatchEffectiveProvider
      ? []
      : toDropdownOptions(availableModels)),
  ]);

  const selectedCatalogOption = $derived.by(() => {
    const selectedId = hasExplicitModel ? localModel : defaultModelId;
    if (!selectedId) return catalogDefaultFallbackOption;
    // The mapped row wins for `<provider>:default` — an exact-id match would
    // resolve to the hidden pseudo-row when an older daemon still serves one.
    const mappedOption = hasExplicitModel ? legacyDefaultMappedOption : defaultModelIdMappedOption;
    if (mappedOption) return mappedOption;
    return flatModelOptions.find(
      (option) => normalizeModelIdForMatch(option.value) === normalizeModelIdForMatch(selectedId),
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

  const nonBlockingProviderWarnings = $derived(
    hasLoadedModelOptions
      ? providerLoadWarnings.filter(
          (warning) => (allProviderModels[warning.providerId]?.length ?? 0) > 0,
        )
      : [],
  );

  const providerFallbackWarnings = $derived.by<ProviderWarningNotice[]>(() => {
    const warnings = $allProviderWarnings$;
    return $availableEnabledProviderIds$
      .map((pid) => getProviderWarningNotice(pid, warnings))
      .filter((warning): warning is ProviderWarningNotice => Boolean(warning));
  });

  const hasCodexModels = $derived(
    (allProviderModels['codex']?.length ?? 0) > 0 ||
      (normalizeProviderId(effectiveProviderId) === 'codex' &&
        (agentProviderModels?.length ?? 0) > 0),
  );

  // A stale warning (PROTOCOL §5.30 `stale: true`) accompanies the daemon's
  // last-known-good list after a transient probe failure: the models on screen
  // are real and usable, so the "install Codex CLI" notice would be wrong.
  // The notice stays for the degraded case (warning with no codex models).
  const codexFallbackWarning = $derived(
    $allProviderStaleFlags$['codex'] && hasCodexModels
      ? null
      : (providerFallbackWarnings.find((warning) => warning.providerId === 'codex') ?? null),
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
      $hasCheckedOnce$ &&
      $daemonHealth$ === 'healthy' &&
      $availableEnabledProviderIds$.length === 0,
  );

  // Per-instance call-frequency guard only; the stable toast id below is the
  // authoritative dedupe — every mounted ModelPicker (and every re-fire of the
  // condition) updates the same single toast instead of stacking a new one.
  let noProviderToastShown = false;

  function openProviderSettings() {
    dropdownOpen = false;
    void navigateToSettings({ tab: 'accounts', hash: 'providers' }).catch((error: unknown) => {
      logger.error('Failed to open provider settings from model picker', error);
    });
  }

  $effect(() => {
    if (hasNoAvailableProvider) {
      if (!noProviderToastShown) {
        noProviderToastShown = true;
        toast.error(m.chat_modelPicker_noProviderAvailable_toast(), {
          id: 'no-provider-available',
          duration: 6000,
          action: {
            label: m.chat_modelPicker_noProviderAvailable_openSettings_label(),
            onClick: openProviderSettings,
          },
        });
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
      availableModelsProviderId,
      enabledProviderIds: $availableEnabledProviderIds$,
      allProviderModels,
      allProviderLoading,
      allProviderErrors,
      allProviderWarnings: $allProviderWarnings$,
    }).filter(
      (group) => group.key === 'default' || canUseProviderModels(group.parentKey ?? group.key),
    ),
  );
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
  $effect(() => {
    dropdownValue = legacyDefaultMappedOption?.value ?? localModel ?? USE_DEFAULT_VALUE;
  });

  // Provider the explicitly selected model belongs to ('' when inheriting).
  // Catalog rows are bare for every provider, so ownership is resolved from
  // the loaded groups (legacy compound prefix wins) — not by parsing the id.
  const selectedModelProviderId = $derived(
    hasExplicitModel && localModel
      ? normalizeProviderId(resolvePickedTriple(localModel).providerId)
      : '',
  );

  const providerTabIds = $derived.by(() => [
    ...new Set([
      ...$availableEnabledProviderIds$.map((id) => normalizeProviderId(id)),
      ...groupedModelOptions
        .filter((group) => group.key !== 'default')
        .map((group) => group.parentKey ?? group.key),
    ]),
  ]);
  const providerTabsEnabled = $derived(showReasoning && providerTabIds.length > 1);
  const preferredBrowseProviderId = $derived(
    providerTabIds.includes(selectedModelProviderId)
      ? selectedModelProviderId
      : providerTabIds.includes(normalizeProviderId(effectiveProviderId))
        ? normalizeProviderId(effectiveProviderId)
        : (providerTabIds[0] ?? ''),
  );
  let activeBrowseProviderId = $state('');

  $effect(() => {
    if (!providerTabIds.includes(activeBrowseProviderId)) {
      activeBrowseProviderId = preferredBrowseProviderId;
    }
  });

  $effect(() => {
    if (dropdownOpen && providerTabsEnabled) {
      activeBrowseProviderId = preferredBrowseProviderId;
    }
  });

  // Display groups — provider tabs replace the tall group stack in the chat picker.
  const displayGroups = $derived.by(() =>
    groupedModelOptions
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
      })),
  );

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

    const values = new Set(
      flatModelOptions.map((opt) => normalizeModelIdForMatch(opt.value, effectiveProviderId)),
    );
    return !values.has(normalizeModelIdForMatch(localModel, effectiveProviderId));
  });

  const isSelectedModelUnavailable = $derived.by(() => {
    if (!canUseProviderModels(selectedModelProviderId || effectiveProviderId)) return true;
    if (!$hasCheckedOnce$) return false;
    if (isLoadingModels) return false;
    if (!allProvidersLoaded) return false;
    if (isSelectedModelProviderPending) return false;
    return isSelectedModelMissingFromCatalog;
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
  const currentReasoningEffort = $derived(
    persistedReasoningEffort && reasoningLevels.includes(persistedReasoningEffort)
      ? persistedReasoningEffort
      : null,
  );
  const currentReasoningLabel = $derived(
    currentReasoningEffort
      ? reasoningLevelLabel(currentReasoningEffort)
      : m.chat_effortPicker_level_auto(),
  );
  const currentReasoningLevelIndex = $derived(
    currentReasoningEffort ? reasoningLevels.indexOf(currentReasoningEffort) : -1,
  );
  const showTriggerReasoningGauge = $derived(
    currentReasoningEffort !== null &&
      currentReasoningEffort !== 'none' &&
      currentReasoningLevelIndex >= 0,
  );
  const triggerLabel = $derived(currentModelLabel);
  const triggerAccessibleLabel = $derived(
    showReasoningFooter ? `${currentModelLabel} · ${currentReasoningLabel}` : currentModelLabel,
  );
  const lockedButtonTitle = $derived(
    lockedTitle?.trim() || m.chat_modelPicker_modelLocked_title({ model: triggerAccessibleLabel }),
  );
  let updatingReasoningEffort = $state(false);
  const reasoningControlDisabled = $derived(
    reasoningDisabled ||
      updatingReasoningEffort ||
      (!onReasoningChange && (!agentId || !workspaceId)) ||
      reasoningLevels.length === 0,
  );
  const showDropdownFooter = $derived(
    showReasoningFooter ||
      (!allProvidersLoaded && Object.keys(allProviderModels).length > 0) ||
      nonBlockingProviderWarnings.length > 0,
  );

  function selectProviderTab(providerId: string) {
    activeBrowseProviderId = providerId;
  }

  function handleProviderTabKeydown(event: KeyboardEvent, providerId: string) {
    const currentIndex = providerTabIds.indexOf(providerId);
    if (currentIndex < 0) return;

    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % providerTabIds.length;
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + providerTabIds.length) % providerTabIds.length;
    }
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = providerTabIds.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    event.stopPropagation();
    activeBrowseProviderId = providerTabIds[nextIndex] ?? providerId;
    const tabs = (
      event.currentTarget as HTMLButtonElement
    ).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[nextIndex]?.focus();
  }

  async function handleReasoningSelect(value: string | null): Promise<boolean> {
    if (reasoningControlDisabled) return false;
    const previous = persistedReasoningEffort;
    if (value === previous) return true;

    updatingReasoningEffort = true;
    try {
      if (onReasoningChange) {
        return (await onReasoningChange(value)) !== false;
      }
      if (!agentId || !workspaceId) return false;
      return await applyReasoningEffort(agentId, workspaceId, value, previous);
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
    !!agentId && (isSelectedModelUnavailable || $fallbackInfo$ !== null),
  );

  // The selected model isn't in the catalog yet, but its provider hasn't
  // settled — show a spinner in the trigger rather than a warning that would
  // flip back to normal a moment later (transient warning on refresh).
  const showModelLoading = $derived(
    !!agentId &&
      $fallbackInfo$ === null &&
      isSelectedModelMissingFromCatalog &&
      (!$hasCheckedOnce$ ||
        isLoadingModels ||
        !allProvidersLoaded ||
        isSelectedModelProviderPending),
  );

  const modelLoadingTitle = $derived(
    m.chat_modelPicker_loadingProviderModels_label({
      provider: providerDisplayName(selectedModelProviderId || effectiveProviderId),
    }),
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
      globallySelectedModel: $selectedModel$,
    });
  }

  // Auto-fallback: When the selected model becomes unavailable, automatically switch to an available model.
  // Only applies to pickers tied to an existing agent — onboarding doesn't need this.
  $effect(() => {
    if (!agentId) return;
    if (!canUseProviderModels(selectedModelProviderId || effectiveProviderId)) return;
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
    if (!canUseProviderModels(selectedModelProviderId || effectiveProviderId)) return;
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
      // Epoch at fetch start: a reconnect clear mid-flight makes this
      // response stale for local state as well as the cache write-through.
      const cacheEpoch = selectProviderModelsClearEpoch.select(appStore.state);
      try {
        const models = await getModelsForProvider(currentProvider);
        if (selectProviderModelsClearEpoch.select(appStore.state) !== cacheEpoch) return;
        if (models.length > 0) {
          const normalizedId = normalizeProviderId(currentProvider);
          allProviderModels = {
            ...allProviderModels,
            [normalizedId]: toDropdownOptions(models),
          };
          // Write through to the session cache like the other fetch paths.
          appStore.dispatch(providerModelsLoaded(normalizedId, { models }, cacheEpoch));
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
  let dropdownRef = $state<{
    focusTrigger: () => void;
    dismissAndFocusTrigger: () => void;
  } | null>(null);

  $effect(() => {
    if (!modalAware || !dropdownOpen) return;
    return pushEscapeLayer(() => {
      dropdownRef?.dismissAndFocusTrigger();
    });
  });

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
        : !localModel ||
          normalizeModelIdForMatch(modelValue, effectiveProviderId) !==
            normalizeModelIdForMatch(localModel, effectiveProviderId);
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
    if (modalAware) {
      queueMicrotask(() => {
        dropdownOpen = false;
        dropdownRef?.focusTrigger();
      });
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
      {#if showReasoningFooter && currentReasoningEffort === null}
        <span class="shrink-0 text-xs" data-testid="model-reasoning-strength"
          >· {currentReasoningLabel}</span
        >
      {:else if showTriggerReasoningGauge}
        <EffortGauge
          value={currentReasoningLevelIndex}
          max={Math.max(1, reasoningLevels.length - 1)}
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
        {#if showReasoningFooter && currentReasoningEffort === null}
          <span class="shrink-0 text-xs" data-testid="model-reasoning-strength"
            >· {currentReasoningLabel}</span
          >
        {:else if showTriggerReasoningGauge}
          <EffortGauge
            value={currentReasoningLevelIndex}
            max={Math.max(1, reasoningLevels.length - 1)}
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
    {/if}
  {/snippet}

  {#snippet dropdownFooter()}
    {#if showReasoningFooter}
      <div class="px-2 py-2" data-testid="model-reasoning-section">
        <EffortPicker
          mode="embedded"
          {agentId}
          {workspaceId}
          effortLevels={reasoningLevels}
          effort={persistedReasoningEffort}
          disabled={reasoningControlDisabled}
          {modalAware}
          onEffortChange={handleReasoningSelect}
        />
      </div>
    {/if}
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
    variant={variant === 'outline' ? 'outline' : variant === 'default' ? 'default' : 'ghost'}
    size={size === 'xs' ? 'xs' : 'sm'}
    searchable={!hasNoAvailableProvider}
    placeholder={m.chat_modelPicker_searchModels_placeholder()}
    class="min-w-0"
    headerClass={providerTabsEnabled ? 'bg-popover! border-b!' : 'border-b-0!'}
    triggerClass={cn(
      'max-w-full',
      (variant === 'outline' || variant === 'default') &&
        'w-full justify-between border-border! focus-visible:border-ring! focus-visible:ring-2 focus-visible:ring-ring/40',
      triggerClass,
    )}
    contentClass={cn(
      'max-w-[calc(100vw-32px)] bg-background! text-foreground!',
      '[&_[role=searchbox]]:border-b! [&_[role=searchbox]]:border-solid! [&_[role=searchbox]]:border-border!',
      showReasoning ? 'w-85 h-90 min-h-0 max-h-90 flex flex-col' : 'w-[332px]',
    )}
    contentMaxHeight={showReasoning ? 360 : undefined}
    fillContentHeight={showReasoning}
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
        title={isTriggerLabelResolved ? triggerAccessibleLabel : ''}
        aria-label={isTriggerLabelResolved ? triggerAccessibleLabel : undefined}
      >
        {#if isCompact}
          <Fa icon={faSettings} class="h-4 w-4" />
        {:else if isTriggerLabelResolved}
          {#if showModelLoading}
            <span
              class="size-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin shrink-0"
              role="status"
              aria-label={modelLoadingTitle}
              title={modelLoadingTitle}
            ></span>
          {:else if showModelWarning}
            <Fa icon={faTriangleExclamation} class="h-3 w-3 text-amber-600 shrink-0" />
          {/if}
          {#if hasProviderIcon(triggerProviderId)}
            <ProviderIcon providerId={triggerProviderId} class="size-3.5" />
          {/if}
          <span class="truncate">{triggerLabel}</span>
          {#if showReasoningFooter && currentReasoningEffort === null}
            <span class="shrink-0 text-xs" data-testid="model-reasoning-strength"
              >· {currentReasoningLabel}</span
            >
          {:else if showTriggerReasoningGauge}
            <EffortGauge
              value={currentReasoningLevelIndex}
              max={Math.max(1, reasoningLevels.length - 1)}
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
      {#if providerTabsEnabled}
        <div
          class="flex items-center gap-1 px-2 pt-2"
          role="tablist"
          aria-label={m.chat_modelPicker_modelProviders_label()}
          data-testid="model-provider-tabs"
        >
          {#each providerTabIds as providerTabId (providerTabId)}
            <Button
              variant="ghost"
              size="icon"
              iconOnly={true}
              role="tab"
              aria-selected={providerTabId === activeBrowseProviderId}
              aria-label={providerDisplayName(providerTabId)}
              tabindex={providerTabId === activeBrowseProviderId ? 0 : -1}
              class={cn(
                'text-muted-foreground hover:bg-muted/40',
                providerTabId === activeBrowseProviderId && 'bg-muted text-foreground',
              )}
              onclick={() => selectProviderTab(providerTabId)}
              onkeydown={(event) => handleProviderTabKeydown(event, providerTabId)}
            >
              <ProviderIcon providerId={providerTabId} class="size-4" size={16} />
            </Button>
          {/each}
          <Button
            variant="ghost"
            size="icon"
            iconOnly={true}
            aria-label={m.chat_modelPicker_noProviderAvailable_openSettings_label()}
            class="text-muted-foreground hover:bg-muted/40"
            data-testid="model-provider-settings-button"
            onclick={openProviderSettings}
          >
            <Fa icon={faPlus} class="size-3 text-muted-foreground/50" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            iconOnly={true}
            title={m.chat_modelPicker_refreshGroup_title({
              group: providerDisplayName(activeBrowseProviderId),
            })}
            aria-label={m.chat_modelPicker_refreshGroup_title({
              group: providerDisplayName(activeBrowseProviderId),
            })}
            class={cn(
              'ml-auto text-subtle hover:bg-muted/40',
              refreshingProviders.has(activeBrowseProviderId) && 'opacity-50! cursor-not-allowed',
            )}
            data-testid="model-provider-refresh-button"
            disabled={refreshingProviders.has(activeBrowseProviderId)}
            onclick={() => void handleRefreshProvider(activeBrowseProviderId)}
          >
            <Fa
              icon={faArrowsRotate}
              size={10}
              class={cn(
                'text-subtle transition-transform duration-500',
                refreshingProviders.has(activeBrowseProviderId) && 'animate-spin',
              )}
            />
          </Button>
        </div>
      {/if}
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
          </div>
        {/if}
      </div>
    {/snippet}

    {#snippet empty()}
      <ModelPickerEmptyState
        {isLoadingModels}
        {blockingLoadError}
        {hasNoAvailableProvider}
        onOpenProviderSettings={openProviderSettings}
        onRetry={handleRetry}
      />
    {/snippet}
  </Dropdown>

  <ModelPickerProviderNotice
    warning={codexFallbackWarning?.message}
    docsUrl={codexFallbackWarning?.docsUrl}
    show={(showProviderWarningNotice ?? variant === 'default') && Boolean(codexFallbackWarning)}
    variant="warning"
    class={resolvedNoticeClass}
  />
{/if}
