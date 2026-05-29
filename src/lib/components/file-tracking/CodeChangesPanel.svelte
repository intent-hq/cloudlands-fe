<script lang="ts">
  import { Logger } from '$lib/utils/logger';
  const logger = new Logger({ category: 'CodeChangesPanel' });

  import {
  faList,
  faFolderTree,
  faRefresh,
  faPlus,
  faMinus,
  faArrowRight,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { TrackedChange } from '$features/file-tracking/types';
  import {
  selectCurrentStagedWorkingChanges as selectFtCurrentStagedChanges,
  selectCurrentUnstagedWorkingChanges as selectFtCurrentUnstagedChanges,
  selectCurrentCommits as selectFtCurrentCommits,
  selectCurrentLoading as selectFtCurrentLoading,
  selectMainPanelView as selectFtMainPanelView,
  selectAcceptChangesState,
} from '$lib/store/slices/changes/changes-selectors';
  import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';
  import {
  setMainPanelView as ftSetMainPanelView,
  stageChangesRequested,
  unstageChangesRequested,
  revertChangeRequested,
  loadWorkspaceDataRequested,
} from '$lib/store/slices/changes/changes-slice';


  import {
  openWorkspaceAcceptChanges,
  openWorkspaceDiff,
} from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';
  import FileChangesList from './FileChangesList.svelte';
  import VSCodeScrollablePanel from '../ui/VSCodeScrollablePanel.svelte';
  import {
  ListContainer,
  ListSection,
} from '../ui/list';
  import * as ToggleGroup from '../ui/toggle-group';
  import { Tooltip } from '../ui/tooltip';
  import { Button } from '../ui/button';
  import { Skeleton } from '../ui/skeleton';
  import { loadGitStatus } from '$lib/store/slices/git/git-slice';

  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { Switch } from '../ui/switch';
  import { selectAutoCommitEnabled } from '$lib/store/slices/workspace-settings/workspace-settings-selectors';
  import { setAutoCommitEnabled } from '$lib/store/slices/workspace-settings/workspace-settings-slice';
  import { store as appStore } from '$lib/store/store';



  interface Props {
    collapsed?: boolean;
    onCollapse?: () => void;
    workspaceId?: string;
  }

  let { collapsed = undefined, onCollapse = undefined, workspaceId = undefined }: Props = $props();

  const acceptChangesState = selectAcceptChangesState(workspaceId ?? '');
  const ftCurrentWsId$ = selectActiveWorkspaceId();
  const ftStagedChanges$ = selectFtCurrentStagedChanges();
  const ftUnstagedChanges$ = selectFtCurrentUnstagedChanges();
  const ftCommits$ = selectFtCurrentCommits();
  const ftLoading$ = selectFtCurrentLoading();
  const ftMainPanelView$ = selectFtMainPanelView();

  function getBackgroundOperation() {
    return $acceptChangesState?.backgroundOperation ?? null;
  }

  // View mode state
  let viewMode: 'list' | 'tree' = $state('list');
  let isRefreshing = $state(false);
  let localIsLoading = $state(true);

  // Combined loading state: local loading OR store loading OR workspace mismatch (switching)
  // This ensures skeleton shows during workspace transitions instead of showing empty state
  const isLoading = $derived(
    localIsLoading ||
      $ftLoading$ ||
      (workspaceId && $ftCurrentWsId$ !== workspaceId),
  );

  // Collapsed state for sections
  let unstagedCollapsed = $state(false);
  let stagedCollapsed = $state(false);

  // Auto-commit settings from Redux
  const autoCommitEnabled = selectAutoCommitEnabled(workspaceId ?? "");

  // Get working changes from FileTrackingStore - the single source of truth
  // PERF: Use store arrays directly to avoid creating new array references on every update.
  // The store already provides stats, so we don't need to map/enhance.
  // Only use empty arrays when the workspace doesn't match (edge case).
  const stagedChanges = $derived(
    $ftCurrentWsId$ !== workspaceId ? [] : ($ftStagedChanges$ ?? []),
  );
  const unstagedChanges = $derived(
    $ftCurrentWsId$ !== workspaceId ? [] : ($ftUnstagedChanges$ ?? []),
  );

  // Track selected change from main panel view
  const selectedChange = $derived(
    $ftMainPanelView$?.type === 'diff'
      ? $ftMainPanelView$.change
      : null,
  );

  let previousWorkspaceId: string | undefined = $state(undefined);

  // PERF: Simplified - just load git status. Stats come from the file tracking store.
  async function loadWorkspaceData(wsId: string) {
    // Don't set loading immediately to avoid flicker for cached data
    let shouldShowLoading = false;
    const loadingTimer = setTimeout(() => {
      shouldShowLoading = true;
      localIsLoading = true;
    }, 150); // Only show loading if operation takes more than 150ms

    try {
      appStore.dispatch(loadGitStatus(wsId));
    } finally {
      clearTimeout(loadingTimer);
      if (shouldShowLoading || localIsLoading) {
        localIsLoading = false;
      }
    }
  }

  // Watch for workspace changes
  $effect(() => {
    if (workspaceId && workspaceId !== previousWorkspaceId) {
      logger.info(
        `[CodeChangesPanel] Workspace changed from ${previousWorkspaceId} to ${workspaceId}`,
      );
      previousWorkspaceId = workspaceId;
      loadWorkspaceData(workspaceId);
    }
  });

  // Load git status on mount if we have a workspace
  onMount(async () => {
    if (workspaceId && !previousWorkspaceId) {
      previousWorkspaceId = workspaceId;
      await loadWorkspaceData(workspaceId);
    }
  });

  // PERF: Simplified refresh - just reload git status and file tracking data.
  // Stats come from the file tracking store.
  async function handleRefresh() {
    if (!workspaceId || isRefreshing) return;

    isRefreshing = true;

    try {
      // Force refresh both git status and file tracking in parallel
      const refreshPromises = Promise.all([
        new Promise<void>((resolve) => {
          appStore.dispatch(loadGitStatus(workspaceId, true));
          resolve();
        }),
        workspaceId ? (appStore.dispatch(loadWorkspaceDataRequested(workspaceId)), Promise.resolve()) : Promise.resolve(), // reload file tracking data
      ]);

      // Set a timeout for the refresh operation - use resolve, not reject
      // to avoid triggering debugger when pausing on caught exceptions
      const timeoutPromise = new Promise<void>((resolve) =>
        setTimeout(() => {
          logger.debug('Refresh taking longer than expected, continuing in background');
          resolve();
        }, 10000),
      );

      await Promise.race([refreshPromises, timeoutPromise]);
    } catch (error) {
      logger.error('Failed to refresh changes:', error as Error);
    } finally {
      // Add a small delay before clearing the refresh state to prevent UI flicker
      setTimeout(() => {
        isRefreshing = false;
      }, 300);
    }
  }

  // Group commits for display from the store (already scoped to the workspace)
  const commitHistory = $derived.by(() =>
    $ftCommits$.map((commit) => ({
      hash: commit.hash,
      message: commit.message || commit.hash?.slice(0, 7) || 'unknown',
      author: commit.author || 'unknown',
      timestamp: commit.timestamp,
      files: commit.files,
      filesChanged: commit.filesChanged || commit.files?.length || 0,
      stage: commit.stage,
      prNumber: commit.prNumber,
    })),
  );

  function handleFileClick(change: TrackedChange) {
    logger.info('[CodeChangesPanel] handleFileClick called', {
      change,
      changeId: change.id,
      file: change.file || change.relativePath,
      hasContent: !!change.content,
      oldContentLength: change.content?.oldContent?.length,
      newContentLength: change.content?.newContent?.length,
    });

    // Open diff view in main panel
    appStore.dispatch(ftSetMainPanelView({
      type: 'diff',
      change,
    }));

    logger.info('[CodeChangesPanel] setMainPanelView called with diff type');

    const filePath = change.file || change.relativePath;
    if (workspaceId) {
      appStore.dispatch(
        openWorkspaceDiff(workspaceId, change, {
          filePath,
          changeId: change.id,
        }),
      );
    }
    logger.info('[CodeChangesPanel] Dispatched openWorkspaceDiff', {
      filePath,
      changeId: change.id,
    });
  }

  async function handleStageChange(change: TrackedChange) {
    // Use the file tracking store as the single source of truth
    // The store handles optimistic updates and background syncing
    // Pass the UI change so the store can create it if it's a synthetic ID
    try {
      if (workspaceId) appStore.dispatch(stageChangesRequested(workspaceId, [change.id], [change]));
    } catch (error) {
      logger.error('[handleStageChange] Failed to stage file', error as Error);
    }
  }

  async function handleUnstageChange(change: TrackedChange) {
    // Use the file tracking store as the single source of truth
    // The store handles optimistic updates and background syncing
    // Pass the UI change so the store can create it if it's a synthetic ID
    try {
      if (workspaceId) appStore.dispatch(unstageChangesRequested(workspaceId, [change.id], [change]));
    } catch (error) {
      logger.error('[handleUnstageChange] Failed to unstage file', error as Error);
    }
  }

  async function handleStageAll() {
    if (!workspaceId || unstagedChanges.length === 0) return;

    try {
      // Stage all changes using the store (handles optimistic updates)
      // Pass the UI changes so the store can create them if they're synthetic IDs
      const changeIds = unstagedChanges.map((c) => c.id);
      if (workspaceId) appStore.dispatch(stageChangesRequested(workspaceId, changeIds, unstagedChanges));
    } catch (error) {
      logger.error('[handleStageAll] Failed to stage all files', error as Error);
    }
  }

  async function handleUnstageAll() {
    if (!workspaceId || stagedChanges.length === 0) return;

    try {
      // Unstage all changes using the store (handles optimistic updates)
      // Pass the UI changes so the store can create them if they're synthetic IDs
      const changeIds = stagedChanges.map((c) => c.id);
      if (workspaceId) appStore.dispatch(unstageChangesRequested(workspaceId, changeIds, stagedChanges));
    } catch (error) {
      logger.error('[handleUnstageAll] Failed to unstage all files', error as Error);
    }
  }

  async function handleRevertChange(change: TrackedChange) {
    if (!workspaceId) return;

    const filePath = change.relativePath || change.file;
    if (!filePath) {
      logger.error('[handleRevertChange] No file path available');
      return;
    }

    // Use optimistic revert - UI updates immediately, toast shows right away
    toast.warning('Changes reverted');

    if (!workspaceId) return;
    // Dispatch revert action - saga handles optimistic update + rollback on failure
    appStore.dispatch(revertChangeRequested(workspaceId, change));
  }

  function handleOpenAcceptChanges() {
    // Open the accept changes panel in the main panel
    appStore.dispatch(ftSetMainPanelView({ type: 'accept-changes' }));

    if (workspaceId) {
      appStore.dispatch(openWorkspaceAcceptChanges(workspaceId));
    }
    logger.info('[CodeChangesPanel] Opened accept changes panel');
  }

  // NOTE: PR fetching code was removed as the PR section is commented out in the template.
  // If PRs need to be displayed in the future, add the fetchWorkspacePRs function back.

  // Computed: whether there are any changes to accept
  const hasChangesToAccept = $derived(
    unstagedChanges.length > 0 ||
      stagedChanges.length > 0 ||
      commitHistory.length > 0,
  );

  // Computed: summary text for the accept button
  const acceptButtonText = $derived('Accept changes');
</script>

{#snippet acceptButton()}
  {#if hasChangesToAccept}
    <div class="px-2 pb-2">
      <Button
        variant="ghost-light"
        size="xs"
        class="w-full justify-center gap-2 h-8"
        onclick={handleOpenAcceptChanges}
      >
        <div class="flex-1 text-left pl-1">{acceptButtonText}</div>
        <Fa icon={faArrowRight} size="sm" class="text-ghost" />
      </Button>
    </div>
  {/if}
{/snippet}

{#snippet panelHeaderActions()}
  {@const backgroundOperation = getBackgroundOperation()}
  <div class="flex items-center gap-1">
    <!-- Background operation indicator -->
    {#if backgroundOperation}
      <Tooltip
        content={backgroundOperation.phase === 'generating'
          ? 'Generating message...'
          : 'Syncing changes...'}
      >
        <div class="flex items-center gap-1.5 px-2 py-1 text-xs text-green-600 dark:text-green-400">
          <div class="relative">
            <Fa icon={faCheck} size="xs" />
            <span
              class="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"
            ></span>
          </div>
          <span class="text-ui">
            {#if backgroundOperation.type === 'commit'}
              Committing
            {:else if backgroundOperation.type === 'add-to-pr'}
              Adding to PR
            {:else}
              Creating PR
            {/if}
          </span>
        </div>
      </Tooltip>
    {/if}

    <Tooltip content="Refresh changes">
      <Button
        variant="ghost-light"
        size="icon"
        class="h-6 w-6"
        onclick={handleRefresh}
        disabled={isRefreshing || !workspaceId}
      >
        <Fa icon={faRefresh} size="xs" class={isRefreshing ? 'animate-spin' : ''} />
      </Button>
    </Tooltip>

    <ToggleGroup.Root bind:value={viewMode} size="xs" variant="default">
      <ToggleGroup.Item value="list" size="xs" tooltip="List view">
        <Fa icon={faList} size="xs" />
      </ToggleGroup.Item>
      <ToggleGroup.Item value="tree" size="xs" tooltip="Tree view">
        <Fa icon={faFolderTree} size="xs" />
      </ToggleGroup.Item>
    </ToggleGroup.Root>

    <Tooltip content={$autoCommitEnabled ? 'Auto-commit enabled' : 'Auto-commit disabled'}>
      <div class="flex items-center gap-1.5 pl-1">
        <Switch
          size="sm"
          checked={$autoCommitEnabled}
          onCheckedChange={(checked) => {
            if (workspaceId) {
              appStore.dispatch(setAutoCommitEnabled(workspaceId, checked));
            }
          }}
        />
      </div>
    </Tooltip>
  </div>
{/snippet}

<VSCodeScrollablePanel
  title="Code Changes"
  scrollAreaClass="h-full flex-1 flex flex-col"
  contentClass="pb-0! h-full flex-1 flex flex-col"
  {collapsed}
  {onCollapse}
  headerActions={panelHeaderActions}
  beforeScroll={acceptButton}
>
  <div class="w-full flex-1">
    <!-- Loading state -->
    {#if isLoading}
      <div class="px-2 py-2">
        {#each Array(3) as { }}
          <div class="mb-3">
            <Skeleton class="h-4 w-20 mb-2" />
            <div class="space-y-1">
              {#each Array(2) as { }}
                <div class="flex items-center gap-2">
                  <Skeleton class="h-3 w-3 rounded shrink-0" />
                  <Skeleton class="h-3 flex-1" />
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="w-full flex flex-col">
        <!-- Auto-commit notice -->
        {#if $autoCommitEnabled && (stagedChanges.length > 0 || unstagedChanges.length > 0)}
          <div class="px-2 py-1.5 mb-2 text-xs text-subtle bg-muted/50 rounded">
            Auto-commit is on. Agent changes will be committed automatically.
          </div>
        {/if}

        {#if stagedChanges.length > 0}
          <ListSection
            class="mb-3 pb-3 {$autoCommitEnabled ? 'opacity-50 pointer-events-none' : ''}"
            collapsible
            collapsed={stagedCollapsed}
            onToggleCollapse={() => (stagedCollapsed = !stagedCollapsed)}
          >
            {#snippet actions()}
              <Tooltip content="Unstage all">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={$autoCommitEnabled}
                  onclick={(e) => {
                    e.stopPropagation();
                    handleUnstageAll();
                  }}
                >
                  <Fa icon={faMinus} size="xs" />
                </Button>
              </Tooltip>
            {/snippet}
            <ListContainer spacing="compact">
              <FileChangesList
                changes={stagedChanges}
                {viewMode}
                showStats={true}
                showActions={!$autoCommitEnabled}
                selectedChangeId={selectedChange?.id}
                onFileClick={handleFileClick}
                onUnstageClick={$autoCommitEnabled ? undefined : handleUnstageChange}
              />
            </ListContainer>
          </ListSection>
        {/if}

        <!-- Working Changes -->
        {#if unstagedChanges.length > 0}
          <ListSection
            class="mb-3 {$autoCommitEnabled ? 'opacity-50 pointer-events-none' : ''}"
            title="Unstaged"
            collapsible
            collapsed={unstagedCollapsed}
            onToggleCollapse={() => (unstagedCollapsed = !unstagedCollapsed)}
          >
            {#snippet actions()}
              <Tooltip content="Stage all">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={$autoCommitEnabled}
                  onclick={(e) => {
                    e.stopPropagation();
                    handleStageAll();
                  }}
                >
                  <Fa icon={faPlus} size="xs" />
                </Button>
              </Tooltip>
            {/snippet}
            <ListContainer spacing="compact">
              <FileChangesList
                changes={unstagedChanges}
                {viewMode}
                showStats={true}
                showActions={!$autoCommitEnabled}
                selectedChangeId={selectedChange?.id}
                onFileClick={handleFileClick}
                onStageClick={$autoCommitEnabled ? undefined : handleStageChange}
                onRevertClick={$autoCommitEnabled ? undefined : handleRevertChange}
              />
            </ListContainer>
          </ListSection>
        {/if}
      </div>

      <!-- {#if commitHistory.length > 0}
        <ListSection
          class="mb-3"
          title={`Commits (${commitHistory.length})`}
          icon={faHistory}
          collapsible
          collapsed={commitsCollapsed}
          onToggleCollapse={() => (commitsCollapsed = !commitsCollapsed)}
        >
          <ListContainer spacing="compact">
            {#each commitHistory as commit (commit.hash)}
              <button
                class="w-full flex items-center gap-2 px-2 py-1 hover:bg-muted/50 rounded text-left"
                onclick={async () => {
                  logger.info('Commit clicked, opening in main panel', { hash: commit.hash });

                  // Get the changes for this commit
                  const commitChanges = $ftChanges$.filter(
                    (change) => change.commitHash === commit.hash
                  );

                  // Set the main panel view to show this commit
                  appStore.dispatch(ftSetMainPanelView({
                    type: 'commit',
                    commit,
                    change: commitChanges[0], // Pass first change for context
                  }));
                }}
              >
                <div class="shrink-0">
                  {#if commit.stage === 'merged'}
                    <Fa icon={faCodeMerge} size="xs" class="text-purple-600" />
                  {:else if commit.stage === 'pr'}
                    <Fa icon={faCodePullRequest} size="xs" class="text-blue-600" />
                  {:else if commit.stage === 'pushed'}
                    <Fa icon={faCloudArrowUp} size="xs" class="text-green-600" />
                  {:else}
                    <Fa icon={faCodeCommit} size="xs" class="text-ghost" />
                  {/if}
                </div>

                <div class="flex-1 min-w-0">
                  <div class="text-xs truncate">
                    {commit.message || commit.hash?.substring(0, 7) || 'unknown'}
                  </div>
                </div>

                <div class="shrink-0 text-xs text-subtle">
                  {commit.filesChanged || commit.files?.length || 0}
                </div>
              </button>
            {/each}
          </ListContainer>
        </ListSection>
      {/if} -->

      <!-- {#if workspacePRs.length > 0}
        <ListSection
          class="mb-3"
          title="Pull Requests ({workspacePRs.length})"
          icon={faCodePullRequest}
          collapsible
          collapsed={prsCollapsed}
          onToggleCollapse={() => (prsCollapsed = !prsCollapsed)}
        >
          <ListContainer spacing="compact">
            {#each workspacePRs as pr (pr.id)}
              <a
                href={pr.htmlUrl}
                class="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 rounded text-left group"
                onclick={(e) => { e.preventDefault(); handleLink(pr.htmlUrl, { workspaceId: WorkspaceId(workspaceId!), event: e }); }}
              >
                <div class="shrink-0">
                  {#if pr.state === 'merged'}
                    <Fa icon={faCodeMerge} size="xs" class="text-purple-600" />
                  {:else if pr.state === 'open' || pr.state === 'draft'}
                    <Fa icon={faCodePullRequest} size="xs" class="text-green-600" />
                  {:else}
                    <Fa icon={faCodePullRequest} size="xs" class="text-red-600" />
                  {/if}
                </div>

                <div class="flex-1 min-w-0">
                  <div class="text-xs truncate">{pr.title}</div>
                  <div class="text-ui text-subtle">#{pr.number}</div>
                </div>

                <div class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Fa icon={faExternalLinkAlt} size="xs" class="text-ghost" />
                </div>
              </a>
            {/each}
          </ListContainer>
        </ListSection>
      {/if} -->
    {/if}
  </div>
</VSCodeScrollablePanel>
