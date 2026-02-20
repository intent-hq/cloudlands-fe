<script lang="ts">
  import {
    LINEAR_ISSUE_FILTER_OPTIONS,
    type LinearIssueFilter,
  } from '$features/linear-auth/constants';
  import { linearAuthStore } from '$features/linear-auth/renderer/linear-auth.store.svelte';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import { Select } from '$lib/components/ui/select';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';

  interface Props {
    /** Skip initialization if parent already initialized the store */
    skipInitialize?: boolean;
  }

  let { skipInitialize = false }: Props = $props();

  let isDisconnectingLinear = $state(false);
  let issueFilter = $state<LinearIssueFilter>('all');
  let filterLoaded = $state(false);

  onMount(async () => {
    if (!skipInitialize) {
      linearAuthStore.initialize();
    }
    await loadFilter();
  });

  async function loadFilter() {
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        const result = await window.electronAPI.invoke('settings:get', {
          key: 'linearIssueFilter',
        });
        if (result?.data && typeof result.data === 'string') {
          issueFilter = result.data as LinearIssueFilter;
        }
      } catch {
        // Use default filter
      }
    }
    filterLoaded = true;
  }

  // Save filter when it changes (after initial load)
  $effect(() => {
    if (!filterLoaded) return;
    const currentFilter = issueFilter;
    saveFilter(currentFilter);
  });

  async function saveFilter(filter: LinearIssueFilter) {
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        await window.electronAPI.invoke('settings:update', {
          settings: { linearIssueFilter: filter },
        });
      } catch {
        // Ignore save errors
      }
    }
  }

  async function handleLinearConnect() {
    await linearAuthStore.startAuth();
  }

  async function handleLinearDisconnect() {
    isDisconnectingLinear = true;
    try {
      await linearAuthStore.logout();
    } finally {
      isDisconnectingLinear = false;
    }
  }

  async function handleLinearReconnect() {
    await linearAuthStore.startAuth();
  }
</script>

<div class="space-y-3">
  <div class="flex items-start justify-between gap-4">
    <div class="space-y-1">
      <div class="flex items-center gap-2">
        <LinearIcon size={14} class="text-muted-foreground" />
        <span class="text-sm text-foreground">Linear</span>
        {#if linearAuthStore.state.isAuthenticated}
          <span class="text-xs text-muted-foreground flex items-center gap-1">
            <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
            Connected
          </span>
        {/if}
      </div>
      <p class="text-xs text-muted-foreground pl-6">
        Create workspaces tasks directly from tickets.
      </p>
      {#if linearAuthStore.state.error}
        <p class="text-xs text-destructive pl-6">{linearAuthStore.state.error}</p>
      {/if}
    </div>

    <div class="flex items-center gap-2 text-xs">
      {#if linearAuthStore.state.isAuthenticating}
        <span class="text-muted-foreground">Waiting for authorization...</span>
      {:else if linearAuthStore.state.isAuthenticated}
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          onclick={handleLinearReconnect}
        >
          Reconnect
        </button>
        <span class="text-muted-foreground/30">·</span>
        <button
          type="button"
          class="text-muted-foreground hover:text-destructive cursor-pointer transition-colors"
          onclick={handleLinearDisconnect}
          disabled={isDisconnectingLinear}
        >
          {isDisconnectingLinear ? 'Disconnecting...' : 'Disconnect'}
        </button>
      {:else if !linearAuthStore.state.requiresAugmentAuth}
        <button
          type="button"
          class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
          onclick={handleLinearConnect}
        >
          Connect
        </button>
      {:else}
        <span class="text-xs text-muted-foreground">Requires Augment authentication</span>
      {/if}
    </div>
  </div>

  {#if linearAuthStore.state.isAuthenticated}
    <div class="pl-6 flex items-center gap-3">
      <span class="text-xs text-muted-foreground shrink-0">Show issues:</span>
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
