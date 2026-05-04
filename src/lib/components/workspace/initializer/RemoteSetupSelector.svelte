<script lang="ts">
  import { createLogger } from '$lib/utils/client-logger';
  import { Select } from '$lib/components/ui/select';
  import Button from '$lib/components/ui/button/button.svelte';
  import ServerIcon from '$lib/components/icons/ServerIcon.svelte';
  import Fa from 'svelte-fa';
  import {
    faChevronDown,
    faChevronRight,
    faPlus,
    faCheck,
    faLaptop,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import AddRemoteSetupModal from './AddRemoteSetupModal.svelte';
  import { performanceMonitor } from '$lib/utils/performance';
  import { handleError } from '$lib/utils/error-handling';
  import { debugConfig } from '$lib/config/debug';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { setWorkspaceInitializerRemoteSetups } from '$lib/store/slices/workspace-initializer/workspace-initializer-slice';
  import { selectWorkspaceInitializerRemoteSetups } from '$lib/store/slices/workspace-initializer/workspace-initializer-selectors';
  import type { WorkspaceInitializerRemoteSetup } from '$lib/store/slices/workspace-initializer/workspace-initializer-types';

  const logger = createLogger('RemoteSetupSelector');
  const dispatch = getDispatch();
  const workspaceInitializerRemoteSetups$ = selectWorkspaceInitializerRemoteSetups();

  type RemoteSetup = WorkspaceInitializerRemoteSetup;

  interface Props {
    variant?: 'default' | 'ghost';
    repoPath: string;
    compact?: boolean;
    onchange?: (event: CustomEvent<{ setup: RemoteSetup | null }>) => void;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let { variant = 'default', repoPath, compact = false, onchange }: Props = $props();

  // State
  let isExpanded = $state(false);
  let selectedSetup: RemoteSetup | null = $state(null);
  let selectedSetupId = $state('');
  let remoteSetups: RemoteSetup[] = $state($workspaceInitializerRemoteSetups$);
  let showAddModal = $state(false);

  $effect(() => {
    remoteSetups = $workspaceInitializerRemoteSetups$;
  });

  // Remote setups are hydrated from Redux; persistence is handled by the saga.
  onMount(async () => {
    performanceMonitor.start('loadRemoteSetups');

    try {
      // Simulate network delay if enabled
      if (debugConfig.get('simulateSlowNetwork')) {
        await new Promise((resolve) => setTimeout(resolve, debugConfig.get('networkDelay') || 0));
      }
    } catch (err) {
      const appError = handleError(err, {
        component: 'RemoteSetupSelector',
        action: 'loadRemoteSetups',
      });
      logger.error('Failed to load remote setups', appError);
    } finally {
      performanceMonitor.end('loadRemoteSetups');
    }

    // Fire onchange on mount so the parent always gets the correct initial value.
    // Without this, if the parent restored a stale remoteSetup from persistence
    // but the selector defaults to "Local environment" (selectedSetupId = ''),
    // the parent would never know to clear the stale value.
    const initialSetup = selectedSetupId
      ? remoteSetups.find((s) => s.id === selectedSetupId) || null
      : null;
    onchange?.(new CustomEvent('change', { detail: { setup: initialSetup } }));
  });

  // Filter setups for current repo
  const applicableSetups = $derived(
    remoteSetups.filter((s) => !s.lastUsedRepo || s.lastUsedRepo === repoPath),
  );

  const otherSetups = $derived(
    remoteSetups.filter((s) => s.lastUsedRepo && s.lastUsedRepo !== repoPath),
  );

  // Track previous selectedSetupId to detect changes from the Select component
  let previousSelectedSetupId = '';

  // React to changes in selectedSetupId from the Select component's bind:value
  $effect(() => {
    // Only react if the value actually changed (not on initial mount)
    if (selectedSetupId !== previousSelectedSetupId) {
      logger.info('selectedSetupId changed via Select', {
        from: previousSelectedSetupId,
        to: selectedSetupId,
        remoteSetupsCount: remoteSetups.length,
      });
      previousSelectedSetupId = selectedSetupId;

      // Find the setup and call selectSetup (but avoid infinite loop by checking if already selected)
      const setup = selectedSetupId
        ? remoteSetups.find((s) => s.id === selectedSetupId) || null
        : null;
      if (setup?.id !== selectedSetup?.id || (!setup && selectedSetup)) {
        logger.info('Calling selectSetup from effect', {
          setupId: setup?.id,
          setupName: setup?.name,
        });
        // Call the onchange callback directly instead of selectSetup to avoid circular updates
        selectedSetup = setup;
        onchange?.(new CustomEvent('change', { detail: { setup } }));

        // Update last used repo for this setup
        if (setup && repoPath) {
          updateSetupLastUsed(setup);
        }
      }
    }
  });

  function selectSetup(setup: RemoteSetup | null) {
    logger.info('selectSetup called', {
      setupId: setup?.id,
      setupName: setup?.name,
      host: setup?.host,
      workspacePath: setup?.workspacePath,
      isNull: setup === null,
    });
    selectedSetup = setup;
    selectedSetupId = setup?.id || '';
    onchange?.(new CustomEvent('change', { detail: { setup } }));

    // Update last used repo for this setup
    if (setup && repoPath) {
      updateSetupLastUsed(setup);
    }
  }

  function saveSetups(setups = remoteSetups) {
    dispatch(setWorkspaceInitializerRemoteSetups(setups));
  }

  function updateSetupLastUsed(setup: RemoteSetup) {
    const updatedSetup = { ...setup, lastUsedRepo: repoPath, lastUsed: new Date().toISOString() };
    const nextSetups = remoteSetups.map((s) => (s.id === setup.id ? updatedSetup : s));
    remoteSetups = nextSetups;
    selectedSetup = updatedSetup;
    saveSetups(nextSetups);
  }

  function handleAddNewSetup() {
    showAddModal = true;
  }

  function handleSaveNewSetup(setup: RemoteSetup) {
    const newSetup = {
      ...setup,
      lastUsedRepo: repoPath,
    };
    const nextSetups = [...remoteSetups, newSetup];
    remoteSetups = nextSetups;
    saveSetups(nextSetups);
    selectSetup(newSetup);
  }

  function removeSetup(id: string) {
    const nextSetups = remoteSetups.filter((s) => s.id !== id);
    remoteSetups = nextSetups;
    saveSetups(nextSetups);
    // If the removed setup was selected, clear selection
    if (selectedSetup?.id === id) {
      selectSetup(null);
    }
  }

  function toggleExpanded() {
    isExpanded = !isExpanded;
    if (!isExpanded) {
      // Clear selection when collapsing
      selectSetup(null);
    }
  }
</script>

<div class="relative">
  {#if variant === 'ghost'}
    <!-- Minimal inline variant with "Work in" + pill pattern -->
    <div class="flex items-center gap-1 text-sm text-subtle whitespace-nowrap">
      <span>Work in</span>
      <Select.Root bind:value={selectedSetupId}>
        <Select.Trigger
          variant="ghost"
          class="w-auto bg-background! px-2! py-0.5! rounded-none font-medium"
        >
          {selectedSetup?.name || 'local environment'}
        </Select.Trigger>
        <Select.Content wrapperClass="py-0!" class="max-w-[400px] min-w-[300px]" portal>
        <div class="px-4 pt-2 pb-3">
          <h2 class="text-base font-semibold text-foreground">Where should agents run?</h2>
          <p class="text-sm text-subtle mt-1">
            Run locally by default, or connect a remote machine for agents to work in directly.
          </p>
        </div>
        <Select.Item class="rounded-b-none! cursor-pointer" value="">
          <div class="flex items-center gap-2">
            <Fa icon={faLaptop} size="sm" />
            <span class="text-subtle">Local environment</span>
          </div>
        </Select.Item>
        {#each applicableSetups as setup (setup.id)}
          <Select.Item class="rounded-none! cursor-pointer" value={setup.id}>
            <div class="flex items-center gap-2 w-full cursor-pointer">
              <ServerIcon size={14} />
              <div class="flex-1 min-w-0">
                <div class="text-sm">{setup.name}</div>
                <div class="text-xs text-subtle">
                  {setup.transport === 'websocket'
                    ? setup.wsUrl
                    : `${setup.username}@${setup.host}:${setup.port}`}
                </div>
              </div>
              <button
                onclick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  removeSetup(setup.id);
                }}
                class="ml-1 p-0.5 rounded text-muted-foreground hover:text-destructive-foreground hover:bg-destructive/10"
                title="Remove setup"
              >
                <Fa icon={faXmark} size="xs" />
              </button>
            </div>
          </Select.Item>
        {/each}
        <div class="border-t border-border"></div>
        <button
          onclick={handleAddNewSetup}
          class="w-full text-left px-2 py-1.5 hover:bg-accent flex items-center gap-2 text-sm cursor-pointer rounded-b-sm"
        >
          <Fa icon={faPlus} size="sm" />
          Add remote setup...
        </button>
        </Select.Content>
      </Select.Root>
    </div>
  {:else if !isExpanded}
    <!-- Collapsed state -->
    <Button
      onclick={toggleExpanded}
      variant="ghost"
      size="sm"
      class="text-muted-foreground hover:text-foreground"
    >
      <Fa icon={faChevronRight} class="mr-1" size="sm" />
      <ServerIcon size={14} class="mr-2" />
      Configure remote setup (optional)
    </Button>
  {:else}
    <!-- Expanded state -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <Button
          onclick={toggleExpanded}
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-foreground"
        >
          <Fa icon={faChevronDown} class="mr-1" size="sm" />
          <ServerIcon size={14} class="mr-2" />
          Remote setup
        </Button>
      </div>

      <Select.Root bind:value={selectedSetupId}>
        <Select.Trigger class="w-full">
          <div class="flex items-center gap-2">
            <ServerIcon size={16} class="text-ghost" />
            <Select.Value placeholder={selectedSetup ? selectedSetup.name : 'No remote setup'} />
          </div>
        </Select.Trigger>
        <Select.Content>
          <div class="px-2 py-2">
            <p class="text-xs text-subtle mb-2">
              Connect to a remote development environment
            </p>
          </div>

          {#if applicableSetups.length > 0}
            <div class="border-t pt-1">
              <div class="px-2 py-1 text-xs text-subtle">Recent setups for this repo</div>
              {#each applicableSetups as setup (setup.id)}
                <button
                  onclick={() => selectSetup(setup)}
                  class="w-full text-left px-2 py-1.5 hover:bg-accent rounded-sm flex items-center gap-2 text-sm"
                  class:bg-accent={selectedSetup?.id === setup.id}
                >
                  <ServerIcon size={14} class="text-ghost" />
                  <div class="flex-1">
                    <div>{setup.name}</div>
                    <div class="text-xs text-subtle">
                      {setup.transport === 'websocket'
                        ? setup.wsUrl
                        : `${setup.username}@${setup.host}`}
                    </div>
                  </div>
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span
                    role="button"
                    tabindex={0}
                    onclick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      removeSetup(setup.id);
                    }}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        e.preventDefault();
                        removeSetup(setup.id);
                      }
                    }}
                    class="p-0.5 rounded text-muted-foreground hover:text-destructive-foreground hover:bg-destructive/10 cursor-pointer"
                    title="Remove setup"
                  >
                    <Fa icon={faXmark} size="xs" />
                  </span>
                  {#if selectedSetup?.id === setup.id}
                    <Fa icon={faCheck} class="text-primary" size="sm" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}

          {#if otherSetups.length > 0}
            <div class="border-t pt-1">
              <div class="px-2 py-1 text-xs text-subtle">
                Other setups (different repos)
              </div>
              {#each otherSetups as setup (setup.id)}
                <button
                  disabled
                  class="w-full text-left px-2 py-1.5 opacity-50 flex items-center gap-2 text-sm"
                >
                  <ServerIcon size={14} class="text-ghost" />
                  <div class="flex-1">
                    <div>{setup.name}</div>
                    <div class="text-xs text-subtle">
                      {setup.transport === 'websocket'
                        ? setup.wsUrl
                        : `${setup.username}@${setup.host}`}
                    </div>
                  </div>
                </button>
              {/each}
            </div>
          {/if}

          <div class="border-t pt-1">
            <Button
              onclick={handleAddNewSetup}
              variant="ghost"
              size="sm"
              class="w-full justify-start"
            >
              <Fa icon={faPlus} class="mr-2" size="sm" />
              Add new remote setup
            </Button>
          </div>
        </Select.Content>
      </Select.Root>
    </div>
  {/if}
</div>

<AddRemoteSetupModal
  isOpen={showAddModal}
  onclose={() => (showAddModal = false)}
  onsave={handleSaveNewSetup}
/>
