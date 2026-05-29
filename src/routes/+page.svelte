<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';

  import { Skeleton } from '$lib/components/ui/skeleton';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import CompactWorkspaceInitializer from '$lib/components/workspace/CompactWorkspaceInitializer.svelte';

  import { loadKnownRepos } from '$lib/store/slices/known-repos/known-repos-slice';
  import {
  selectKnownRepos,
  selectKnownReposLoaded,
} from '$lib/store/slices/known-repos/known-repos-selectors';
  import {
  selectWorkspaceHasLoaded,
  selectWorkspaceItems,
  selectWorkspaceLoading,
} from '$lib/store/slices/workspace/workspace-selectors';
  import {
  toggleGroupByRepo,
  toggleShowArchived,
} from '$lib/store/slices/user-preferences/user-preferences-slice';
  import {
  selectGroupByRepo,
  selectHasCompletedProviderSetup,
  selectShowArchived,
} from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import { clearHomePageInitializerRequest } from '$lib/store/slices/deep-links/deep-links-slice';
  import { selectHomePageInitializerRequest } from '$lib/store/slices/deep-links/deep-links-selectors';
  import {
  selectNodeVersion,
  selectShowNodeWarning,
} from '$lib/store/slices/system-status/system-status-selectors';
  import {
  closeBulkArchiveConfirm,
  closeBulkDeleteArchivedConfirm,
  closeBulkDeleteWarningConfirm,
  closeDeleteWarning,
  closeRemoveRepoConfirm,
  confirmBulkArchive,
  confirmBulkDeleteArchived,
  confirmBulkDeleteWarning,
  confirmDeleteWorkspace,
  confirmRemoveRepo,
  openBulkArchiveConfirm,
  openBulkDeleteArchivedConfirm,
  openRemoveRepoConfirm,
  requestArchiveWorkspace,
  requestDeleteWorkspace,
  requestOpenWorkspace,
  requestUnarchiveWorkspace,
} from '$lib/store/slices/workspace-operations/workspace-operations-slice';
  import {
  selectBulkDeleteWorkspaceCount,
  selectPendingBulkRepoKey,
  selectPendingRemoveRepoPath,
  selectRunningAgentNamesForDelete,
  selectShowBulkArchiveConfirm,
  selectShowBulkDeleteArchivedConfirm,
  selectShowBulkDeleteWarningConfirm,
  selectShowDeleteWarning,
  selectShowRemoveRepoConfirm,
} from '$lib/store/slices/workspace-operations/workspace-operations-selectors';

  import NodeVersionWarning from '$lib/components/NodeVersionWarning.svelte';
  import WorkspaceTableView, {
    type RepoInfo,
  } from '$lib/components/workspace/WorkspaceTableView.svelte';

  import {
  faSearch,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
  import {
  tick,
  untrack,
} from 'svelte';
  import Fa from 'svelte-fa';
  import { fly } from 'svelte/transition';
  import DeleteWarningDialog from '$lib/components/modals/DeleteWarningDialog.svelte';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import { store as appStore } from '$lib/store/store';

  // Feature flag: mimic empty state for testing (set to true to test empty state UI)
  const MIMIC_EMPTY_STATE = false;


  let isInitializerExpanded = $state(false);
  let initialRepoForCreate = $state<RepoInfo | undefined>(undefined);
  let workspaceInitializer: CompactWorkspaceInitializer | null = $state(null);

  const showDeleteWarning = selectShowDeleteWarning();
  const runningAgentNamesForDelete = selectRunningAgentNamesForDelete();
  const showBulkArchiveConfirm = selectShowBulkArchiveConfirm();
  const showBulkDeleteArchivedConfirm = selectShowBulkDeleteArchivedConfirm();
  const pendingBulkRepoKey = selectPendingBulkRepoKey();
  const showBulkDeleteWarningConfirm = selectShowBulkDeleteWarningConfirm();
  const bulkDeleteWorkspaceCount = selectBulkDeleteWorkspaceCount();
  const showRemoveRepoConfirm = selectShowRemoveRepoConfirm();
  const pendingRemoveRepoPath = selectPendingRemoveRepoPath();

  // Handler for creating a workspace for a specific repo (from table group + button)
  function handleCreateForRepo(repo: RepoInfo) {
    initialRepoForCreate = repo;
    isInitializerExpanded = true;
  }

  const workspaces = selectWorkspaceItems();
  const workspaceHasLoaded = selectWorkspaceHasLoaded();
  const workspaceLoading = selectWorkspaceLoading();

  // Known repos from persistent registry (survive workspace deletion)
  const knownRepos = selectKnownRepos();
  const knownReposLoaded = selectKnownReposLoaded();
  const homePageInitializerRequest = selectHomePageInitializerRequest();

  $effect(() => {
    if (!$knownReposLoaded) {
      appStore.dispatch(loadKnownRepos());
    }
  });

  // Determine if we're in empty state (no workspaces or mimicking)
  const isEmpty = $derived(MIMIC_EMPTY_STATE || ($workspaceHasLoaded && $workspaces.length === 0));

  // Auto-expand the form when in empty state
  $effect(() => {
    if (isEmpty) {
      isInitializerExpanded = true;
    }
  });

  $effect(() => {
    const request = $homePageInitializerRequest;
    if (request) {
      isInitializerExpanded = true;
      untrack(() => {
        appStore.dispatch(clearHomePageInitializerRequest());
      });
      tick().then(() => {
        if (request.applyPrefill) {
          workspaceInitializer?.applyPrefill?.();
        }
        if (request.focus) {
          workspaceInitializer?.focus();
        }
      });
    }
  });


  const showArchived = selectShowArchived();
  const groupByRepo = selectGroupByRepo();
  const hasCompletedProviderSetup = selectHasCompletedProviderSetup();
  const nodeVersion = selectNodeVersion();
  const showNodeWarning = selectShowNodeWarning();

  let searchQuery = $state('');
  let searchExpanded = $state(false);
  let searchInputRef: HTMLInputElement | undefined = $state();
  function handleSearchBlur() {
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

  // Show skeleton during initial load or before first load completes (returning users)
  let showSkeleton = $derived(
    (!$workspaceHasLoaded || $workspaceLoading) && $workspaces.length === 0,
  );

  // Track container width for skeleton column calculation
  let skeletonContainerWidth = $state(0);
  const MIN_COLUMN_WIDTH = 380; // Match WorkspaceTableView
  const GAP = 24;

  // Calculate skeleton columns (same logic as WorkspaceTableView)
  const skeletonColumnCount = $derived(
    Math.max(1, Math.floor((skeletonContainerWidth + GAP) / (MIN_COLUMN_WIDTH + GAP))),
  );
</script>

<div class="h-full flex flex-col">
  <div
    class="home-layout flex-1 w-full min-h-0
      {isEmpty || (!$hasCompletedProviderSetup && !$workspaceHasLoaded)
      ? 'flex items-center justify-center overflow-auto px-[clamp(2rem,6.25rem,6%)]'
      : 'grid gap-15 lg:grid-cols-[minmax(40rem,1fr)_2fr] px-[clamp(2rem,6.25rem,6%)] lg:pl-[clamp(2rem,6.25rem,6%)] lg:pr-0'}"
  >
    <!-- Render nothing while workspaces are loading for users who haven't completed setup,
         or when we know the layout will redirect to /workspace/new (no workspaces + no provider setup).
         The splash screen in app.html covers the loading period. -->
    {#if !$hasCompletedProviderSetup && (!$workspaceHasLoaded || isEmpty)}
      <!-- Empty: splash / bg-sidebar visible while redirect to /workspace/new fires -->
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
                class="text-muted-foreground hover:text-foreground"
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

        <!-- Node.js version warning (shown regardless of provider setup state) -->
        {#if $showNodeWarning}
          <NodeVersionWarning nodeVersion={$nodeVersion} class="-ml-4 w-[calc(100%+32px)] mt-4" />
        {/if}
      </div>
    {/if}

    <!-- Header + Controls Bar (hidden when empty or still loading for new users) -->
    {#if !isEmpty && ($workspaceHasLoaded || $hasCompletedProviderSetup)}
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
              pressed={$groupByRepo}
              onLabel="Grouped by repo"
              offLabel="Not grouped"
              onclick={() => appStore.dispatch(toggleGroupByRepo())}
            />

            <!-- Archive toggle -->
            <Toggle
              variant="indicator"
              size="xs"
              pressed={$showArchived}
              onLabel="Showing Archived"
              offLabel="Show Archived"
              onclick={() => appStore.dispatch(toggleShowArchived())}
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
            {#if $groupByRepo}
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
                    {#each Array.from({ length: rowCount }, (_, i) => i) as i}
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
                {#each [0, 1, 2, 3, 4] as i}
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
              workspaces={$workspaces}
              showArchived={$showArchived}
              groupByRepo={$groupByRepo}
              {searchQuery}
              knownRepos={$knownRepos}
              onOpen={(workspace, event) =>
                appStore.dispatch(
                  requestOpenWorkspace({
                    workspaceId: workspace.id,
                    openInNewWindow: !!(event?.metaKey || event?.ctrlKey),
                  }),
                )}
              onDelete={(workspace) => appStore.dispatch(requestDeleteWorkspace(workspace.id))}
              onArchive={(workspace) => appStore.dispatch(requestArchiveWorkspace(workspace.id))}
              onUnarchive={(workspace) => appStore.dispatch(requestUnarchiveWorkspace(workspace.id))}
              onCreateForRepo={handleCreateForRepo}
              onBulkArchive={(repoKey) => appStore.dispatch(openBulkArchiveConfirm(repoKey))}
              onBulkDeleteArchived={(repoKey) => appStore.dispatch(openBulkDeleteArchivedConfirm(repoKey))}
              onRemoveRepo={(repoPath) => appStore.dispatch(openRemoveRepoConfirm(repoPath))}
            />
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- Delete Warning Dialog (single workspace only) -->
<DeleteWarningDialog
  open={$showDeleteWarning}
  agentNames={$runningAgentNamesForDelete}
  onDeleteAnyway={() => appStore.dispatch(confirmDeleteWorkspace())}
  onCancel={() => appStore.dispatch(closeDeleteWarning())}
/>

<!-- Bulk Archive Confirmation Dialog -->
<BulkActionConfirmDialog
  open={$showBulkArchiveConfirm}
  title="Archive All Spaces"
  description={`Are you sure you want to archive all active spaces in ${$pendingBulkRepoKey ?? 'this repo'}? You can unarchive them later.`}
  confirmText="Archive All"
  onConfirm={() => appStore.dispatch(confirmBulkArchive())}
  onCancel={() => appStore.dispatch(closeBulkArchiveConfirm())}
/>

<!-- Bulk Delete Archived Confirmation Dialog -->
<BulkActionConfirmDialog
  open={$showBulkDeleteArchivedConfirm}
  title="Delete All Archived Spaces"
  description={`This will permanently delete all archived spaces in ${$pendingBulkRepoKey ?? 'this repo'}. This action cannot be undone.`}
  confirmText="Delete All"
  variant="destructive"
  onConfirm={() => appStore.dispatch(confirmBulkDeleteArchived())}
  onCancel={() => appStore.dispatch(closeBulkDeleteArchivedConfirm())}
/>

<!-- Bulk Delete Warning Dialog (when archived spaces have running agents) -->
<BulkActionConfirmDialog
  open={$showBulkDeleteWarningConfirm}
  title="Delete Archived Spaces?"
  description={`${$bulkDeleteWorkspaceCount} archived space${$bulkDeleteWorkspaceCount === 1 ? '' : 's'} will be permanently deleted. Some have running agents that will be stopped.`}
  confirmText="Delete Anyway"
  variant="destructive"
  onConfirm={() => appStore.dispatch(confirmBulkDeleteWarning())}
  onCancel={() => appStore.dispatch(closeBulkDeleteWarningConfirm())}
/>

<!-- Remove Repo Confirmation Dialog -->
<BulkActionConfirmDialog
  open={$showRemoveRepoConfirm}
  title="Remove Repository"
  description={`Remove "${$pendingRemoveRepoPath ?? 'this repository'}" from the home page? This won't delete any files or spaces.`}
  confirmText="Remove"
  variant="destructive"
  onConfirm={() => appStore.dispatch(confirmRemoveRepo())}
  onCancel={() => appStore.dispatch(closeRemoveRepoConfirm())}
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
