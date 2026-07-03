<script lang="ts">
  import {
  LINEAR_ISSUE_FILTER_OPTIONS,
  type LinearIssueFilter,
} from '$features/linear-auth/constants';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import { Select } from '$lib/components/ui/select';
  import { safeLocalStorage } from '$lib/utils/safe-storage';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { store as appStore } from '$store/renderer/store';
  import {
  selectLinearIsAuthenticated,
  selectLinearIsAuthenticating,
  selectLinearError,
  selectLinearRequiresAugmentAuth,
} from '$store/renderer/slices/linear-auth/linear-auth-selectors';
  import {
  initializeLinearAuth,
  startLinearAuth,
  logoutLinear,
} from '$store/renderer/slices/linear-auth/linear-auth-slice';

  interface Props {
    /** Skip initialization if parent already initialized the store */
    skipInitialize?: boolean;
  }

  let { skipInitialize = false }: Props = $props();

  const isAuthenticated$ = selectLinearIsAuthenticated();
  const isAuthenticating$ = selectLinearIsAuthenticating();
  const error$ = selectLinearError();
  const requiresAugmentAuth$ = selectLinearRequiresAugmentAuth();

  let isDisconnectingLinear = $state(false);
  let issueFilter = $state<LinearIssueFilter>('all');
  let filterLoaded = $state(false);

  // PROTOCOL §5.12 classifies `linear.issueFilter` as FE-only ("Not exposed")
  // — the filter persists locally, not through daemon settings.*.
  const LINEAR_ISSUE_FILTER_STORAGE_KEY = 'linearIssueFilter';

  onMount(() => {
    if (!skipInitialize) {
      appStore.dispatch(initializeLinearAuth());
    }
    loadFilter();
  });

  function loadFilter() {
    const stored = safeLocalStorage.getItem(LINEAR_ISSUE_FILTER_STORAGE_KEY);
    if (stored && LINEAR_ISSUE_FILTER_OPTIONS.some((option) => option.value === stored)) {
      issueFilter = stored as LinearIssueFilter;
    }
    filterLoaded = true;
  }

  // Save filter when it changes (after initial load)
  $effect(() => {
    if (!filterLoaded) return;
    safeLocalStorage.setItem(LINEAR_ISSUE_FILTER_STORAGE_KEY, issueFilter);
  });

  function handleLinearConnect() {
    appStore.dispatch(startLinearAuth());
  }

  function handleLinearDisconnect() {
    isDisconnectingLinear = true;
    appStore.dispatch(logoutLinear());
    // Reset local flag after a short delay since logout is async via saga
    setTimeout(() => {
      isDisconnectingLinear = false;
    }, 500);
  }

  function handleLinearReconnect() {
    appStore.dispatch(startLinearAuth());
  }
</script>

<div class="space-y-3">
  <div class="flex items-start justify-between gap-4">
    <div class="space-y-1">
      <div class="flex items-center gap-2">
        <LinearIcon size={14} class="text-ghost" />
        <span class="text-sm text-foreground">Linear</span>
        {#if $isAuthenticated$}
          <span class="text-xs text-subtle flex items-center gap-1">
            <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
            Connected
          </span>
        {/if}
      </div>
      <p class="text-xs text-subtle pl-6">
        Create workspaces tasks directly from tickets.
      </p>
      {#if $error$}
        <p class="text-xs text-destructive-foreground pl-6">{$error$}</p>
      {/if}
    </div>

    <div class="flex items-center gap-2 text-xs">
      {#if $isAuthenticating$}
        <span class="text-subtle">Waiting for authorization...</span>
      {:else if $isAuthenticated$}
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          onclick={handleLinearReconnect}
        >
          Reconnect
        </button>
        <span class="text-ghost">·</span>
        <button
          type="button"
          class="text-muted-foreground hover:text-destructive-foreground cursor-pointer transition-colors"
          onclick={handleLinearDisconnect}
          disabled={isDisconnectingLinear}
        >
          {isDisconnectingLinear ? 'Disconnecting...' : 'Disconnect'}
        </button>
      {:else if !$requiresAugmentAuth$}
        <button
          type="button"
          class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
          onclick={handleLinearConnect}
        >
          Connect
        </button>
      {:else}
        <span class="text-xs text-subtle">Requires Augment authentication</span>
      {/if}
    </div>
  </div>

  {#if $isAuthenticated$}
    <div class="pl-6 flex items-center gap-3">
      <span class="text-xs text-subtle shrink-0">Show issues:</span>
      <Select.Root bind:value={issueFilter}>
        <Select.Trigger class="h-7 text-xs w-[180px]">
          {LINEAR_ISSUE_FILTER_OPTIONS.find((o) => o.value === issueFilter)?.label || 'Select...'}
        </Select.Trigger>
        <Select.Content>
          {#each LINEAR_ISSUE_FILTER_OPTIONS as option (option.value)}
            <Select.Item value={option.value}>
              <span class="text-xs">{option.label}</span>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  {/if}
</div>
