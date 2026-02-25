<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { deepLinkStore } from '$features/deeplink/deeplink.store.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import type { KnownRepo } from '$features/workspace/main/repo-registry';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import CompactWorkspaceInitializer from '$lib/components/workspace/CompactWorkspaceInitializer.svelte';
  import ProviderStatusPanel from '$lib/components/ProviderStatusPanel.svelte';
  import OnboardingWelcome from '$lib/components/onboarding/OnboardingWelcome.svelte';
  import { activeProviderStore } from '$lib/stores/active-provider.store.svelte';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import StarterPromptButton from '$lib/components/workspace/StarterPromptButton.svelte';
  import WorkspaceTableView, {
    type RepoInfo,
  } from '$lib/components/workspace/WorkspaceTableView.svelte';

  import type { StarterPrompt } from '$lib/data/starter-prompts';
  import { type Workspace, WorkspaceStatusEnum } from '$shared/types';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { faSearch, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { onMount, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import { fly } from 'svelte/transition';
  import { replaceState } from '$app/navigation';
  import { hasRunningAgents, getRunningAgentNames } from '$lib/utils/delete-warning-utils';
  import DeleteWarningDialog from '$lib/components/modals/DeleteWarningDialog.svelte';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';

  // Feature flag: mimic empty state for testing (set to true to test empty state UI)
  const MIMIC_EMPTY_STATE = false;

  let isInitializerExpanded = $state(false);
  let initialRepoForCreate = $state<RepoInfo | undefined>(undefined);
  let workspaceInitializer: CompactWorkspaceInitializer | null = $state(null);

  // Delete warning dialog state
  let showDeleteWarning = $state(false);
  let pendingDeleteWorkspace = $state<Workspace | null>(null);
  let runningAgentNamesForDelete = $state<string[]>([]);

  // Bulk archive dialog state
  let showBulkArchiveConfirm = $state(false);

  // Bulk delete archived dialog state
  let showBulkDeleteArchivedConfirm = $state(false);

  // Track which repo group the bulk action applies to
  let pendingBulkRepoKey = $state<string | undefined>(undefined);

  // Track pending bulk delete when showing warning dialog
  let pendingBulkDeleteRepoKey = $state<string | null>(null);

  // Bulk delete with running agents warning dialog state
  let showBulkDeleteWarningConfirm = $state(false);
  let bulkDeleteWorkspaceCount = $state(0);

  // Handler for creating a workspace for a specific repo (from table group + button)
  function handleCreateForRepo(repo: RepoInfo) {
    initialRepoForCreate = repo;
    isInitializerExpanded = true;
  }

  // Handler for starter prompt selection
  async function handleStarterPromptSelect(prompt: StarterPrompt) {
    // Prefill the form via sessionStorage (same pattern as deep links)
    sessionStorage.setItem(
      'workspace-prefill',
      JSON.stringify({
        repoPath: `~/Developer/${prompt.repoName}`,
        isNewRepo: true,
        prompt: prompt.prompt,
      }),
    );

    // Expand the form and trigger a reload of prefill data
    isInitializerExpanded = true;

    // Use tick to ensure the component is mounted, then set content
    await tick();
    if (workspaceInitializer) {
      workspaceInitializer.applyStarterPrompt(prompt);
    }
  }

  // Reactive binding to workspace items - needed for Svelte 5 reactivity with class getters
  const workspaces = $derived(workspaceStore.items);

  // Known repos from persistent registry (survive workspace deletion)
  let knownRepos = $state<KnownRepo[]>([]);

  // Load known repos on mount
  onMount(async () => {
    try {
      const result = await invoke<{ success: boolean; data?: KnownRepo[] }>(
        IPC_CHANNELS.WORKSPACE.GET_RECENT_REPOSITORIES,
        {},
      );
      if (result?.success && Array.isArray(result.data)) {
        knownRepos = result.data;
      }
    } catch {
      // Silently ignore - known repos are a nice-to-have
    }
  });

  // Determine if we're in empty state (no workspaces or mimicking)
  const isEmpty = $derived(
    MIMIC_EMPTY_STATE || (workspaceStore.hasLoaded && workspaces.length === 0),
  );

  // Auto-expand the form when in empty state
  $effect(() => {
    if (isEmpty) {
      isInitializerExpanded = true;
    }
  });

  // Expand form when navigating with ?create=true param
  $effect(() => {
    if (page.url.searchParams.has('create')) {
      isInitializerExpanded = true;
      // Explicitly focus the form (handles the case where it's already expanded)
      tick().then(() => {
        workspaceInitializer?.focus();
      });
      // Clean up the URL param
      const url = new URL(window.location.href);
      url.searchParams.delete('create');
      replaceState(url.pathname + url.search, {});
    }
  });

  // Clear current workspace when on home page
  $effect(() => {
    workspaceStore.close();
  });

  // Reactive effect for deep link actions (fires when pendingAction changes)
  $effect(() => {
    const pendingAction = deepLinkStore.pendingAction;
    if (pendingAction && pendingAction.type === 'create') {
      if (pendingAction.params) {
        sessionStorage.setItem(
          'workspace-prefill',
          JSON.stringify({
            repoPath: pendingAction.params.repo || '',
            branch: pendingAction.params.branch || 'main',
          }),
        );
      }
      // Expand the form and apply prefill data
      isInitializerExpanded = true;
      // Use tick to ensure the component is mounted, then apply prefill
      tick().then(() => {
        if (workspaceInitializer) {
          workspaceInitializer.applyPrefill?.();
        }
      });
      deepLinkStore.clearPendingAction();
    }
  });

  // Handle deep link from URL query parameter (avoids IPC timing race)
  onMount(async () => {
    const deepLinkParam = page.url.searchParams.get('deepLink');
    if (deepLinkParam) {
      try {
        const action = JSON.parse(decodeURIComponent(deepLinkParam));
        if (action && action.type === 'create' && action.params) {
          sessionStorage.setItem(
            'workspace-prefill',
            JSON.stringify({
              repoPath: action.params.repo || '',
              branch: action.params.branch || 'main',
            }),
          );
          isInitializerExpanded = true;
          await tick();
          workspaceInitializer?.applyPrefill?.();
        }
      } catch (e) {
        console.error('Failed to parse deep link from URL:', e);
      }
      // Clean up the URL to remove the query parameter
      replaceState('/', {});
    }
  });

  // Event listener for open-create-workspace-modal
  onMount(() => {
    const handleOpenForm = () => {
      isInitializerExpanded = true;
    };
    window.addEventListener('open-create-workspace-modal', handleOpenForm);
    return () => window.removeEventListener('open-create-workspace-modal', handleOpenForm);
  });

  // Preference keys for localStorage
  const PREF_SHOW_ARCHIVED = 'workspace-list:showArchived';
  const PREF_GROUP_BY_REPO = 'workspace-list:groupByRepo';
  const PREF_COMPLETED_PROVIDER_SETUP = 'workspace-list:completedProviderSetup';
  const PREF_COMPLETED_ONBOARDING = 'workspace-list:completedOnboarding';

  // Load persisted preferences
  function loadPref<T>(key: string, defaultValue: T): T {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return defaultValue;
      return JSON.parse(stored) as T;
    } catch {
      return defaultValue;
    }
  }

  // UI State with persisted defaults
  let showArchived = $state(loadPref(PREF_SHOW_ARCHIVED, false));
  let groupByRepo = $state(loadPref(PREF_GROUP_BY_REPO, true));
  let hasCompletedProviderSetup = $state(loadPref(PREF_COMPLETED_PROVIDER_SETUP, false));
  let hasCompletedOnboarding = $state(loadPref(PREF_COMPLETED_ONBOARDING, false));

  // True when the onboarding welcome should be shown (first-time users who haven't seen it yet).
  const showOnboarding = $derived(!hasCompletedOnboarding && isEmpty);

  // True when the provider setup panel should be shown (first-time users with no workspaces).
  // Wait for workspaces to load before deciding — avoids flashing the panel for users who have spaces.
  // Only show after onboarding is complete.
  const showProviderPanel = $derived(
    !hasCompletedProviderSetup && isEmpty && hasCompletedOnboarding,
  );

  // Persist preferences when they change
  $effect(() => {
    localStorage.setItem(PREF_SHOW_ARCHIVED, JSON.stringify(showArchived));
  });
  $effect(() => {
    localStorage.setItem(PREF_GROUP_BY_REPO, JSON.stringify(groupByRepo));
  });
  $effect(() => {
    localStorage.setItem(PREF_COMPLETED_PROVIDER_SETUP, JSON.stringify(hasCompletedProviderSetup));
  });

  let searchQuery = $state('');
  let searchExpanded = $state(false);
  let searchInputRef: HTMLInputElement | undefined = $state();
  let didJustBlur = $state(false);

  function handleSearchBlur() {
    didJustBlur = true;
    // Only collapse if empty
    if (!searchQuery) {
      searchExpanded = false;
    }
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      searchQuery = '';
      searchExpanded = false;
      searchInputRef?.blur();
    }
  }

  // Show skeleton only during initial load
  let showSkeleton = $derived(workspaceStore.loading && workspaces.length === 0);

  // Track container width for skeleton column calculation
  let skeletonContainerWidth = $state(0);
  const MIN_COLUMN_WIDTH = 380; // Match WorkspaceTableView
  const GAP = 24;

  // Calculate skeleton columns (same logic as WorkspaceTableView)
  const skeletonColumnCount = $derived(
    Math.max(1, Math.floor((skeletonContainerWidth + GAP) / (MIN_COLUMN_WIDTH + GAP))),
  );

  async function openWorkspace(workspace: Workspace, event?: MouseEvent) {
    const route = `/workspace/${workspace.id}`;

    // Command-click (or Ctrl-click on non-Mac) opens in new window
    if (event?.metaKey || event?.ctrlKey) {
      try {
        await invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route });
      } catch (error) {
        // Fallback to regular navigation if IPC fails
        console.warn('Failed to open new window, navigating instead:', error);
        goto(route);
      }
      return;
    }

    // Small delay to ensure any pending store updates are complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    await workspaceStore.setCurrentWorkspace(workspace.id);
    goto(route);
  }

  async function deleteWorkspace(workspace: Workspace) {
    // Check if workspace has running agents
    if (hasRunningAgents(workspace.id)) {
      // Show warning dialog instead of deleting immediately
      pendingDeleteWorkspace = workspace;
      runningAgentNamesForDelete = getRunningAgentNames(workspace.id);
      showDeleteWarning = true;
      return;
    }

    // No running agents, proceed with deletion
    await performDelete(workspace);
  }

  async function performDelete(workspace: Workspace) {
    await workspaceStore.deleteWithUndo(workspace.id, workspace.title);
  }

  async function archiveWorkspace(workspace: Workspace) {
    const { toast } = await import('svelte-sonner');

    const workspaceTitle = workspace.title || 'space';
    const workspaceId = workspace.id;

    // Let the store's archive() method handle the optimistic update by changing status to Archived.
    // The WorkspaceTableView filter will hide it since showArchived is false by default.
    const result = await workspaceStore.archive(workspaceId);
    if (result.ok) {
      toast.warning(`Archived space ${workspaceTitle}`, {
        duration: 15000,
        action: {
          label: 'Undo',
          onClick: async () => {
            await workspaceStore.unarchive(workspaceId);
          },
        },
      });
    } else {
      toast.error('Failed to archive space');
    }
  }

  async function unarchiveWorkspace(workspace: Workspace) {
    const { toast } = await import('svelte-sonner');

    const workspaceTitle = workspace.title || 'space';
    const workspaceId = workspace.id;

    const result = await workspaceStore.unarchive(workspaceId);
    if (result.ok) {
      toast.success(`Unarchived space ${workspaceTitle}`);
      await workspaceStore.load();
    } else {
      toast.error('Failed to unarchive space');
    }
  }

  // Helper to check if a workspace matches a repo key (used for per-repo bulk actions)
  function workspaceMatchesRepoKey(ws: Workspace, repoKey: string): boolean {
    if (ws.repositoryOwner && ws.repositoryName) {
      return `${ws.repositoryOwner}/${ws.repositoryName}` === repoKey;
    } else if (ws.repositoryPath) {
      return ws.repositoryPath === repoKey;
    }
    return repoKey === 'unknown';
  }

  async function archiveAllWorkspaces() {
    // Snapshot repo key before any await to prevent race conditions
    const repoKey = pendingBulkRepoKey;
    if (!repoKey) {
      console.error('archiveAllWorkspaces called without a repo key');
      return;
    }

    const { toast } = await import('svelte-sonner');

    // Find all non-archived workspaces, filtered by repo
    const toArchive = workspaces.filter(
      (ws) =>
        ws.status !== WorkspaceStatusEnum.Archived &&
        ws.status !== WorkspaceStatusEnum.Deleted &&
        workspaceMatchesRepoKey(ws, repoKey),
    );

    if (toArchive.length === 0) {
      toast.info('No active spaces to archive');
      return;
    }

    // Archive all workspaces in parallel
    const results = await Promise.allSettled(
      toArchive.map((ws) =>
        workspaceStore.archive(ws.id).then((result) => ({ id: ws.id, result })),
      ),
    );

    const archivedIds: string[] = [];
    let failCount = 0;

    for (const settled of results) {
      if (settled.status === 'fulfilled' && settled.value.result.ok) {
        archivedIds.push(settled.value.id);
      } else {
        failCount++;
      }
    }

    if (archivedIds.length > 0) {
      toast.warning(`Archived ${archivedIds.length} space${archivedIds.length === 1 ? '' : 's'}`, {
        duration: 15000,
        action: {
          label: 'Undo',
          onClick: async () => {
            for (const id of archivedIds) {
              await workspaceStore.unarchive(id as WorkspaceId);
            }
          },
        },
      });
    }

    if (failCount > 0) {
      toast.error(`Failed to archive ${failCount} space${failCount === 1 ? '' : 's'}`);
    }
  }

  // Perform the actual bulk delete of archived workspaces (no agent check)
  // Called directly when user confirms "Delete anyway" after warning
  // Accepts explicit repo key to avoid race conditions with global state
  async function performBulkDeleteArchivedForRepo(repoKey: string | null) {
    if (!repoKey) {
      console.error('performBulkDeleteArchivedForRepo called without a repo key');
      return;
    }

    const { toast } = await import('svelte-sonner');

    // Find all archived workspaces, filtered by repo
    const toDelete = workspaces.filter(
      (ws) => ws.status === WorkspaceStatusEnum.Archived && workspaceMatchesRepoKey(ws, repoKey),
    );

    if (toDelete.length === 0) {
      toast.info('No archived spaces to delete');
      return;
    }

    // Delete all archived workspaces permanently in parallel (no undo)
    const results = await Promise.allSettled(toDelete.map((ws) => workspaceStore.delete(ws.id)));

    let deleteCount = 0;
    let failCount = 0;
    const failedIds: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const settled = results[i];
      if (settled.status === 'fulfilled' && settled.value.ok) {
        deleteCount++;
      } else {
        failCount++;
        failedIds.push(toDelete[i].id);
      }
    }

    if (deleteCount > 0) {
      toast.success(
        `Permanently deleted ${deleteCount} archived space${deleteCount === 1 ? '' : 's'}`,
      );
    }

    if (failCount > 0) {
      toast.error(`Failed to delete ${failCount} space${failCount === 1 ? '' : 's'}`);
      // Clear pending deletion flags for failed deletes so load() can restore them
      for (const id of failedIds) {
        workspaceStore.restoreToUI(id as WorkspaceId);
      }
      // Reload to restore failed deletes in the UI
      await workspaceStore.load();
    }
  }

  async function deleteAllArchivedWorkspaces() {
    // Snapshot repo key before any await to prevent race conditions
    const repoKey = pendingBulkRepoKey;
    if (!repoKey) {
      console.error('deleteAllArchivedWorkspaces called without a repo key');
      return;
    }

    const { toast } = await import('svelte-sonner');

    // Find all archived workspaces, filtered by repo
    const toDelete = workspaces.filter(
      (ws) => ws.status === WorkspaceStatusEnum.Archived && workspaceMatchesRepoKey(ws, repoKey),
    );

    if (toDelete.length === 0) {
      toast.info('No archived spaces to delete');
      return;
    }

    // Check if any archived workspaces have running agents
    const workspacesWithAgents = toDelete.filter((ws) => hasRunningAgents(ws.id));
    if (workspacesWithAgents.length > 0) {
      // Use bulk-specific warning dialog (not single-space DeleteWarningDialog)
      bulkDeleteWorkspaceCount = toDelete.length;
      pendingBulkDeleteRepoKey = repoKey;
      showBulkDeleteWarningConfirm = true;
      return;
    }

    // No agents running, proceed with delete directly
    await performBulkDeleteArchivedForRepo(repoKey);
  }

  async function openRepo() {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const result = await window.electronAPI.invoke('dialog:open', {
        directory: true,
        title: 'Select Repository Folder',
      });
      if (
        result?.success &&
        result.data &&
        !result.data.canceled &&
        result.data.filePaths?.length > 0
      ) {
        const repoPath = result.data.filePaths[0];
        sessionStorage.setItem('workspace-prefill', JSON.stringify({ repoPath }));
        isInitializerExpanded = true;
      }
    }
  }
</script>

<div class="h-full flex flex-col">
  <div
    class="home-layout flex-1 w-full min-h-0
      {isEmpty ||
    showProviderPanel ||
    showOnboarding ||
    (!workspaceStore.hasLoaded && !hasCompletedProviderSetup)
      ? 'flex items-center justify-center overflow-auto px-[clamp(2rem,6.25rem,6%)]'
      : 'grid gap-15 lg:grid-cols-[minmax(40rem,1fr)_2fr] px-[clamp(2rem,6.25rem,6%)] lg:pl-[clamp(2rem,6.25rem,6%)] lg:pr-0'}"
  >
    <!-- Wait for workspaces to load before rendering for users who haven't completed setup.
         This prevents flashing onboarding/provider setup before we know if they're a new user.
         The splash screen in app.html covers this loading period. -->
    {#if !workspaceStore.hasLoaded && (!hasCompletedProviderSetup || !hasCompletedOnboarding)}
      <!-- Empty: splash screen / bg-sidebar visible while workspaces load -->
    {:else if showOnboarding}
      <!-- Onboarding welcome for first-time users -->
      <div class="animate-entry" style="--entry-delay: 0ms">
        <OnboardingWelcome
          onComplete={() => {
            hasCompletedOnboarding = true;
            localStorage.setItem(PREF_COMPLETED_ONBOARDING, JSON.stringify(true));
          }}
        />
      </div>
    {:else if showProviderPanel}
      <div class="animate-entry" style="--entry-delay: 0ms">
        <ProviderStatusPanel
          onContinue={async (providerId) => {
            activeProviderStore.setActiveProvider(providerId);
            await modelStore.reloadModelsForProvider();
            hasCompletedProviderSetup = true;
          }}
        />
      </div>
    {:else}
      <!-- Empty state after provider setup, OR non-empty state: show workspace form -->
      <div
        class="animate-entry {isEmpty
          ? 'w-full max-w-2xl'
          : 'min-w-0'} pt-52 lg:self-start lg:sticky lg:top-0"
        style="--entry-delay: 0ms"
      >
        <div class="w-full flex items-baseline space-between mb-5 relative">
          <h1 class="text-3xl font-medium tracking-[-0.03em]">
            {isEmpty ? 'Create your first workspace' : 'Workspaces'}
          </h1>
          {#if isInitializerExpanded}
            <div class="ml-auto absolute -right-3 top-3" transition:fly={{ y: 10, duration: 200 }}>
              <Button
                onclick={() => {
                  isInitializerExpanded = false;
                }}
                variant="ghost-light"
                size="icon-xs"
                class="text-muted-foreground/60 hover:text-foreground"
                tooltip="Close formㅤESC"
              >
                <Fa icon={faXmark} />
              </Button>
            </div>
          {/if}
        </div>
        <CompactWorkspaceInitializer
          bind:this={workspaceInitializer}
          bind:isExpanded={isInitializerExpanded}
          initialRepo={initialRepoForCreate}
          showFirstTimeHints={isEmpty}
        />
      </div>
    {/if}

    <!-- Header + Controls Bar (hidden when empty, showing provider setup, onboarding, or still loading for new users) -->
    {#if !isEmpty && !showProviderPanel && !showOnboarding && (workspaceStore.hasLoaded || hasCompletedProviderSetup)}
      <div
        class="right-column animate-entry min-w-0 lg:pr-[clamp(2rem,6.25rem,6%)]"
        style="--entry-delay: 120ms"
      >
        <div class="lg:mt-51 mb-6 sticky top-0 bg-sidebar pt-2 pb-1 z-20">
          <div class="flex items-center gap-4">
            <!-- Spacer -->
            <div class="flex-1"></div>

            <!-- View toggles -->
            <Toggle
              variant="indicator"
              size="xs"
              pressed={groupByRepo}
              onLabel="Grouped by repo"
              offLabel="Not grouped"
              onclick={() => (groupByRepo = !groupByRepo)}
            />

            <!-- Archive toggle -->
            <Toggle
              variant="indicator"
              size="xs"
              pressed={showArchived}
              onLabel="Showing Archived"
              offLabel="Show Archived"
              onclick={() => (showArchived = !showArchived)}
            />

            <!-- Search - icon that expands -->
            <div
              class="relative flex items-center flex-1 h-5 transition-all duration-200 {searchExpanded
                ? 'max-w-80'
                : 'max-w-6'}"
            >
              {#if searchExpanded}
                <div
                  class="w-full flex items-center gap-1 bg-card border border-border rounded-lg overflow-hidden transition-all duration-200 -mr-8 origin-right"
                >
                  <input
                    bind:this={searchInputRef}
                    bind:value={searchQuery}
                    onblur={handleSearchBlur}
                    onkeydown={handleSearchKeydown}
                    type="text"
                    placeholder="Search..."
                    class="w-full px-3 py-1.5 text-sm bg-transparent border-none focus:outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
              {/if}
              {#if searchExpanded}
                <Button
                  variant="ghost-light"
                  size="icon-sm"
                  class="absolute right-0 z-10"
                  onclick={() => {
                    searchExpanded = false;
                    searchQuery = '';
                  }}
                  title="Search spaces"
                >
                  <Fa icon={faXmark} size="sm" />
                </Button>
              {:else}
                <Button
                  variant="ghost-light"
                  size="icon-sm"
                  class="absolute right-0 z-10"
                  onclick={async () => {
                    searchExpanded = true;
                    await tick();
                    searchInputRef?.focus();
                  }}
                  title="Search spaces"
                >
                  <Fa icon={faSearch} size="sm" />
                </Button>
              {/if}
            </div>
          </div>
        </div>

        <!-- Workspace Grid -->
        <div class="pb-32">
          {#if showSkeleton}
            {#if groupByRepo}
              <!-- Skeleton loader matching masonry grid layout - use CSS columns like the real view -->
              <div
                style="columns: {skeletonColumnCount}; column-gap: {GAP}px;"
                bind:clientWidth={skeletonContainerWidth}
              >
                {#each [4, 3] as rowCount}
                  <div
                    class="bg-background border border-border shadow-xs rounded-xl overflow-hidden break-inside-avoid mb-6"
                  >
                    <!-- Group header skeleton -->
                    <div class="flex items-center gap-2 px-3 py-3 border-b border-border/40">
                      <Skeleton class="w-4 h-4 rounded shrink-0" />
                      <Skeleton class="h-4 w-24" />
                    </div>
                    <!-- Rows -->
                    {#each Array(rowCount) as _, i}
                      <div
                        class="flex items-center w-full min-w-0 pr-4 pl-3 py-3 {i < rowCount - 1
                          ? 'border-b border-border/40'
                          : ''}"
                      >
                        <Skeleton class="w-3.5 h-3.5 rounded-full shrink-0" />
                        <Skeleton class="h-3.5 flex-1 ml-2 mr-3 max-w-32" />
                        <Skeleton class="h-3 w-8 shrink-0 ml-auto" />
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            {:else}
              <!-- Skeleton loader matching ungrouped table view -->
              <div class="w-full bg-background border border-border shadow-xs rounded-xl">
                {#each [1, 2, 3, 4, 5] as _, i}
                  <div
                    class="flex items-center w-full min-w-0 pr-5 pl-3 py-3 {i < 4
                      ? 'border-b border-border/40'
                      : ''}"
                  >
                    <!-- Icon placeholder -->
                    <Skeleton class="w-5 h-5 rounded-full shrink-0" />
                    <!-- Progress circle placeholder -->
                    <Skeleton class="w-3.5 h-3.5 rounded-full shrink-0 ml-2" />
                    <!-- Title -->
                    <Skeleton class="h-4 flex-1 ml-2 mr-4 max-w-48" />
                    <!-- Activity time -->
                    <Skeleton class="h-3 w-10 ml-auto shrink-0" />
                  </div>
                {/each}
              </div>
            {/if}
          {:else}
            <WorkspaceTableView
              {workspaces}
              {showArchived}
              {groupByRepo}
              {searchQuery}
              {knownRepos}
              onOpen={openWorkspace}
              onDelete={deleteWorkspace}
              onArchive={archiveWorkspace}
              onUnarchive={unarchiveWorkspace}
              onCreateForRepo={handleCreateForRepo}
              onBulkArchive={(repoKey) => {
                pendingBulkRepoKey = repoKey;
                showBulkArchiveConfirm = true;
              }}
              onBulkDeleteArchived={(repoKey) => {
                pendingBulkRepoKey = repoKey;
                showBulkDeleteArchivedConfirm = true;
              }}
            />
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- Delete Warning Dialog (single workspace only) -->
<DeleteWarningDialog
  bind:open={showDeleteWarning}
  agentNames={runningAgentNamesForDelete}
  onDeleteAnyway={async () => {
    if (pendingDeleteWorkspace) {
      await performDelete(pendingDeleteWorkspace);
      pendingDeleteWorkspace = null;
    }
  }}
  onCancel={() => {
    pendingDeleteWorkspace = null;
  }}
/>

<!-- Bulk Archive Confirmation Dialog -->
<BulkActionConfirmDialog
  bind:open={showBulkArchiveConfirm}
  title="Archive All Spaces"
  description={`Are you sure you want to archive all active spaces in ${pendingBulkRepoKey ?? 'this repo'}? You can unarchive them later.`}
  confirmText="Archive All"
  onConfirm={archiveAllWorkspaces}
/>

<!-- Bulk Delete Archived Confirmation Dialog -->
<BulkActionConfirmDialog
  bind:open={showBulkDeleteArchivedConfirm}
  title="Delete All Archived Spaces"
  description={`This will permanently delete all archived spaces in ${pendingBulkRepoKey ?? 'this repo'}. This action cannot be undone.`}
  confirmText="Delete All"
  variant="destructive"
  onConfirm={deleteAllArchivedWorkspaces}
/>

<!-- Bulk Delete Warning Dialog (when archived spaces have running agents) -->
<BulkActionConfirmDialog
  bind:open={showBulkDeleteWarningConfirm}
  title="Delete Archived Spaces?"
  description={`${bulkDeleteWorkspaceCount} archived space${bulkDeleteWorkspaceCount === 1 ? '' : 's'} will be permanently deleted. Some have running agents that will be stopped.`}
  confirmText="Delete Anyway"
  variant="destructive"
  onConfirm={async () => {
    // Snapshot state before clearing to avoid race conditions
    const repoKeyToDelete = pendingBulkDeleteRepoKey;

    // Clear state synchronously before async work
    showBulkDeleteWarningConfirm = false;
    pendingBulkDeleteRepoKey = null;

    // Now do the async work using the snapshot
    await performBulkDeleteArchivedForRepo(repoKeyToDelete);
  }}
  onCancel={() => {
    pendingBulkDeleteRepoKey = null;
  }}
/>

<style>
  /* Page entrance animation */
  @keyframes entry {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .animate-entry {
    animation: entry 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: var(--entry-delay, 0ms);
  }

  /* Mobile: outer container scrolls, right column doesn't */
  .home-layout:not(.flex) {
    overflow-y: auto;
  }
  .right-column {
    overflow-y: visible;
  }

  /* Desktop (lg breakpoint = 1024px): right column scrolls, outer doesn't */
  @media (min-width: 1024px) {
    .home-layout:not(.flex) {
      overflow-y: visible;
    }
    .right-column {
      overflow-y: auto;
    }
  }
</style>
