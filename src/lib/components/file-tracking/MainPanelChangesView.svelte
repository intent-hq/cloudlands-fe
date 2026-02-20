<script lang="ts">
  /**
   * Main Panel Changes View - Enhanced Version
   *
   * Displays changes from various sources (activity logs, agent turns, commits)
   * with improved filtering, grouping, and navigation capabilities.
   */

  import type { TrackedChange, MainPanelViewType } from '$features/file-tracking/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import FileChangesList from './FileChangesList.svelte';
  import InteractiveDiffView from './InteractiveDiffView.svelte';
  import AgentTurnSummaryCard from '$lib/components/agent/AgentTurnSummaryCard.svelte';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { LOCKED_TOOLTIP } from '$lib/utils/agent-lock-utils';
  import {
    faList,
    faLayerGroup,
    faCodeBranch,
    faRobot,
    faHistory,
    faChevronDown,
    faChevronRight,
    faCodeCommit,
    faMagicWandSparkles,
    faEye,
    faTimes,
    faPlus,
    faMinus,
  } from '@fortawesome/free-solid-svg-icons';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Label } from '$lib/components/ui/label';
  import { gitStore } from '$features/git/git.store.svelte';
  import type { WorkspaceEvent } from '$features/events/types';
  import { invoke } from '$lib/electron-bridge';
  import { GitFileStatus } from '$shared/types';
  import { createLogger } from '$lib/utils/client-logger';
  import FileActionsDropdown from '$lib/components/ui/FileActionsDropdown.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { createCommitMessageExecutor } from '$features/agent/background-agent-executor.svelte';
  import { toast } from 'svelte-sonner';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { crossfade, slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  const logger = createLogger('MainPanelChangesView');

  // Track if we're in the middle of a workspace switch to disable animations
  let isWorkspaceSwitching = $state(false);

  // Create crossfade animation for staging/unstaging with protection against NaN/Infinity
  const [send, receive] = crossfade({
    duration: () => (isWorkspaceSwitching ? 0 : 300),
    easing: quintOut,
    fallback(node) {
      // During workspace switches, skip animations entirely
      if (isWorkspaceSwitching) {
        return {
          duration: 0,
          css: () => '',
        };
      }

      // Guard against 0-dimension elements that cause NaN/Infinity
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return {
          duration: 0,
          css: () => '',
        };
      }

      return slide(node, { duration: 200, easing: quintOut, delay: 0, axis: 'y' });
    },
  });

  interface Props {
    viewType: MainPanelViewType;
    changes: TrackedChange[];
    title?: string; // Custom title for the view
    agentId?: string;
    agentName?: string;
    turnNumber?: number;
    event?: WorkspaceEvent;
    workspaceId?: string; // Workspace ID for loading diffs
    showSummaryCard?: boolean;
    showGrouping?: boolean; // Whether to show grouping controls
    showFiltering?: boolean; // Whether to show filtering controls
    showCommitForm?: boolean; // Whether to show commit form for change-set view
    showHeader?: boolean; // Whether to show the internal header (set false when wrapped in PanelWrapper)
    autoSelectSingle?: boolean; // If true and there's exactly one change, auto-select it and show diff
    /** Set of file paths that are locked (agent auto-commit pending) */
    lockedFilePaths?: Set<string>;
    onNavigateToFile?: (path: string) => void;
    onStageChange?: (change: TrackedChange) => void; // For staging changes
    onUnstageChange?: (change: TrackedChange) => void; // For unstaging changes
    onOpenAgent?: (agentId: string) => void; // For opening agent in drawer
  }

  let {
    viewType,
    changes = [],
    title,
    agentId,
    agentName = 'Agent',
    turnNumber,
    event,
    workspaceId,
    showSummaryCard = false,
    showGrouping = true,
    showFiltering = true,
    showCommitForm = false,
    showHeader = true,
    autoSelectSingle = false,
    lockedFilePaths = new Set<string>(),
    onNavigateToFile,
    onStageChange,
    onUnstageChange,
    onOpenAgent,
  }: Props = $props();

  // Helper to check if a file is locked
  function isFileLocked(filePath: string | undefined): boolean {
    if (!filePath) return false;
    return lockedFilePaths.has(filePath);
  }

  // State
  let selectedChange: TrackedChange | null = $state(null);
  let viewMode: 'list' | 'diff' | 'summary' = $state('list');
  let groupBy: 'none' | 'directory' | 'type' = $state('none');
  let filterMode: 'all' | 'modified' | 'created' | 'deleted' = $state('all');
  let expandedGroups = $state(new Set<string>());

  // Track the event ID to detect when a different event is selected
  let lastEventId: string | null = $state(null);

  // Detect workspace switches and temporarily disable animations
  let workspaceSwitchTimeout: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    // Read workspaceId to create dependency
    void workspaceId;

    // When workspace changes, set switching flag and clear after a short delay
    if (workspaceSwitchTimeout) {
      clearTimeout(workspaceSwitchTimeout);
    }
    isWorkspaceSwitching = true;
    workspaceSwitchTimeout = setTimeout(() => {
      isWorkspaceSwitching = false;
      workspaceSwitchTimeout = null;
    }, 300); // Disable animations for 300ms during workspace switch
  });

  // Reset view state when the event changes (e.g., clicking a different activity log item)
  // Also auto-select single change if autoSelectSingle is enabled
  $effect(() => {
    const currentEventId = event?.id ?? null;
    if (currentEventId !== lastEventId) {
      logger.info('[MainPanelChangesView] Event changed, resetting view state', {
        previousEventId: lastEventId,
        newEventId: currentEventId,
        autoSelectSingle,
        changesCount: changes.length,
      });
      lastEventId = currentEventId;

      // If autoSelectSingle is enabled and there's exactly one change, show it directly
      if (autoSelectSingle && changes.length === 1) {
        selectedChange = changes[0];
        viewMode = 'diff';
      } else {
        // Reset to list view when switching events
        selectedChange = null;
        viewMode = 'list';
      }
    }
  });

  // Commit form state
  let commitMessage = $state('');
  let isCommitting = $state(false);

  // Background agent executor for commit message generation
  const commitExecutor = createCommitMessageExecutor({
    onResult: (result, context) => {
      commitMessage = result;
      // Only show toast for freshly generated results, not restored ones
      if (!context?.isRestored) {
        toast.success('Commit message generated!');
      }
    },
    onError: (error) => {
      // Don't show toast for "all models exhausted" - it's shown in chat
      const isModelsExhausted =
        error.message.includes('No available models') ||
        error.message.includes('all models exhausted') ||
        error.message.includes('All models unavailable');
      if (!isModelsExhausted) {
        toast.error(`Failed to generate: ${error.message}`);
      }
    },
  });

  // Calculate statistics
  let totalAdditions = $derived(changes.reduce((sum, c) => sum + (c.stats?.additions || 0), 0));
  let totalDeletions = $derived(changes.reduce((sum, c) => sum + (c.stats?.deletions || 0), 0));
  let filesByType = $derived.by(() => {
    const types = new Map<string, number>();
    changes.forEach((c) => {
      const ext = c.file ? c.file.split('.').pop() || 'unknown' : 'unknown';
      types.set(ext, (types.get(ext) || 0) + 1);
    });
    return types;
  });

  // Get unstaged changes for commit panel
  let unstagedChanges = $derived.by(() => {
    if (viewType === 'change-set' && workspaceId) {
      // Get unstaged files from gitStore
      return gitStore.unstagedFiles.map((file, index) => {
        // Map git status to change type
        let type: 'added' | 'modified' | 'deleted' = 'modified';
        if (file.status === GitFileStatus.Added || file.status === GitFileStatus.Untracked) {
          type = 'added';
        } else if (file.status === GitFileStatus.Deleted) {
          type = 'deleted';
        }

        return {
          id: `unstaged-${index}-${file.path}`,
          file: file.path,
          relativePath: file.path,
          stage: 'unstaged' as const,
          type,
          stats: {
            additions: 0, // Git status doesn't provide line stats
            deletions: 0,
          },
          attribution: {
            manual: true,
            timestamp: Date.now(),
          },
          timestamp: new Date(),
        } as TrackedChange;
      });
    }
    return [];
  });

  // Filter changes
  let filteredChanges = $derived.by(() => {
    logger.info('[MainPanelChangesView] Filtering changes', {
      viewType,
      changesCount: changes.length,
      filterMode,
      showFiltering,
      changes,
    });

    // If filtering is disabled, always return all changes
    if (!showFiltering || filterMode === 'all') return changes;

    return changes.filter((c) => {
      // Filter based on file action and stats
      switch (filterMode) {
        case 'created':
          // New files have additions but no deletions
          return c.stats?.additions && !c.stats?.deletions;
        case 'deleted':
          // Deleted files have deletions but no additions
          return c.stats?.deletions && !c.stats?.additions;
        case 'modified':
          // Modified files have both additions and deletions
          return c.stats?.additions && c.stats?.deletions;
        default:
          return true;
      }
    });
  });

  // Group changes
  let groupedChanges = $derived.by(() => {
    // If grouping is disabled, treat as no grouping
    if (!showGrouping || groupBy === 'none') {
      return [{ key: 'all', label: 'All Files', changes: filteredChanges }];
    }

    const groups = new Map<string, TrackedChange[]>();

    filteredChanges.forEach((change) => {
      let key: string;
      if (groupBy === 'directory') {
        const parts = change.file ? change.file.split('/') : [];
        key = parts.length > 1 ? parts.slice(0, -1).join('/') : '/';
      } else {
        key = change.file ? change.file.split('.').pop() || 'unknown' : 'unknown';
      }

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(change);
    });

    return Array.from(groups.entries())
      .map(([key, changes]) => ({
        key,
        label: key,
        changes,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  // Get display title - use provided title or derive from view type
  let displayTitle = $derived.by(() => {
    if (title) return title;

    switch (viewType) {
      case 'staged':
        return 'Staged Changes';
      case 'unstaged':
        return 'Unstaged Changes';
      case 'agent':
        if (turnNumber !== undefined) {
          return `${agentName} - Turn ${turnNumber}`;
        }
        return `${agentName} Changes`;
      case 'commit':
        return 'Commit Changes';
      case 'activity':
        if (event) {
          const eventData = (event as any).data || {};
          return event.type === 'file:changed'
            ? `Changes to ${eventData.path ? eventData.path.split('/').pop() || 'Unknown' : 'Unknown'}`
            : event.type === 'agent:completed'
              ? `Agent Turn ${eventData.turnNumber || ''}`
              : 'Activity Changes';
        }
        return 'Activity Changes';
      default:
        return 'Changes';
    }
  });

  // Get appropriate icon
  let icon = $derived(
    viewType === 'agent'
      ? faRobot
      : viewType === 'commit'
        ? faCodeBranch
        : viewType === 'activity'
          ? faHistory
          : viewType === 'change-set'
            ? faCodeCommit
            : viewType === 'staged'
              ? faPlus
              : viewType === 'unstaged'
                ? faMinus
                : faLayerGroup,
  );

  // Get workspace folder path for VSCode opening
  let workspaceFolderPath = $derived.by(() => {
    if (!workspaceId) return '';
    const workspace = workspaceStore.findById(WorkspaceId(WorkspaceId(workspaceId)));
    return workspace?.worktreePath || workspace?.repositoryPath || workspace?.path || '';
  });

  async function handleFileClick(change: TrackedChange) {
    logger.info('[handleFileClick] File clicked', {
      file: change.file,
      hasOldContent: !!change.content?.oldContent,
      hasNewContent: !!change.content?.newContent,
      hasDiff: !!change.content?.diff,
      viewType,
      workspaceId,
    });

    // For activity events, prioritize using the stored diff from the event
    // This is the historical diff that was captured when the event occurred
    // Don't try to fetch from git as that would show the current state, not the historical state
    if (viewType === 'activity' && change.content?.diff) {
      logger.info('[handleFileClick] Activity event - using stored diff from event', {
        file: change.file,
        diffLength: change.content.diff.length,
      });
      selectedChange = change;
      viewMode = 'diff';
      return;
    }

    // If the change doesn't have content, try to load it
    if (!change.content?.oldContent && !change.content?.newContent && workspaceId) {
      logger.info('[handleFileClick] No content found, attempting to load diff for:', change.file);

      try {
        // For staged/unstaged, use the appropriate flag
        let staged: boolean | undefined;

        if (viewType === 'staged') {
          staged = true;
        } else if (viewType === 'unstaged') {
          staged = false;
        } else if (viewType === 'activity') {
          // For activity events without stored diff, try to load current unstaged diff as fallback
          staged = false;
        }

        const response = await invoke<any>('diffs:get', {
          workspaceId,
          filePath: change.file || change.relativePath,
          staged,
        });

        logger.info('[handleFileClick] Diff response:', response);

        if ((response.ok || response.success) && response.data) {
          // Update the change with the loaded content
          change = {
            ...change,
            content: {
              oldContent: response.data.oldContent || '',
              newContent: response.data.newContent || '',
              diff: response.data.diff || change.content?.diff, // Preserve existing diff if available
            },
          };
        } else if (!response.ok && viewType === 'activity') {
          // For activity events, if we can't load the current diff,
          // show a message that the historical diff isn't available
          logger.warn('[handleFileClick] No content available for historical activity event');
          change = {
            ...change,
            content: {
              oldContent: '',
              newContent: '',
              diff: '// Content not available for this historical change\n// The file may have been modified since this event was recorded',
            },
          };
        }
      } catch (error) {
        logger.error('[handleFileClick] Failed to load diff:', error);

        // For activity events, show the unavailable message
        if (viewType === 'activity') {
          logger.info('[handleFileClick] No diff available, showing unavailable message');
          change = {
            ...change,
            content: {
              oldContent: '',
              newContent: '',
              diff: '// Content not available for this historical change\n// The file may have been modified since this event was recorded',
            },
          };
          selectedChange = change;
          viewMode = 'diff';
          return;
        }
      }
    }

    logger.info('[handleFileClick] Setting selectedChange and viewMode', {
      file: change.file,
      hasContent: !!(change.content?.oldContent || change.content?.newContent),
      hasDiff: !!change.content?.diff,
      contentKeys: change.content ? Object.keys(change.content) : [],
      viewMode: 'diff',
    });

    selectedChange = change;
    viewMode = 'diff';

    // For activity events, show the inline diff - don't navigate away
    // For other view types, notify parent to navigate to the file
    if (onNavigateToFile && viewType !== 'activity') {
      onNavigateToFile(change.relativePath || change.file);
    }
  }

  function handleBackToList() {
    selectedChange = null;
    viewMode = 'list';
  }

  // Handle keyboard shortcuts
  function handleKeyDown(event: KeyboardEvent) {
    // Close diff view on Escape
    if (event.key === 'Escape' && viewMode === 'diff') {
      handleBackToList();
    }
  }

  // Add keyboard listener when component is mounted
  $effect(() => {
    if (viewMode === 'diff') {
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  });

  async function handleStageChange(change: TrackedChange) {
    // Use prop callback if provided, otherwise use store directly
    if (onStageChange) {
      onStageChange(change);
      return;
    }
    // Use the file tracking store as the single source of truth
    // The store handles optimistic updates and background syncing
    // Pass the change so the store can create it if it's a synthetic ID
    try {
      await fileTrackingStore.stageChanges([change.id], [change]);
      logger.info('[handleStageChange] Staged file via store', { file: change.file });
    } catch (error) {
      logger.error('[handleStageChange] Failed to stage file', error);
      toast.error('Failed to stage file');
    }
  }

  async function handleUnstageChange(change: TrackedChange) {
    // Use prop callback if provided, otherwise use store directly
    if (onUnstageChange) {
      onUnstageChange(change);
      return;
    }
    // Use the file tracking store as the single source of truth
    // The store handles optimistic updates and background syncing
    // Pass the change so the store can create it if it's a synthetic ID
    try {
      await fileTrackingStore.unstageChanges([change.id], [change]);
      logger.info('[handleUnstageChange] Unstaged file via store', { file: change.file });
    } catch (error) {
      logger.error('[handleUnstageChange] Failed to unstage file', error);
      toast.error('Failed to unstage file');
    }
  }

  function toggleGroup(key: string) {
    if (expandedGroups.has(key)) {
      expandedGroups.delete(key);
    } else {
      expandedGroups.add(key);
    }
    expandedGroups = new Set(expandedGroups);
  }

  // Commit functionality
  async function handleCommit() {
    if (!commitMessage.trim() || !workspaceId) {
      return;
    }

    isCommitting = true;
    try {
      logger.info('[handleCommit] Committing changes', {
        message: commitMessage,
        workspaceId,
      });

      // Commit the changes
      await gitStore.commit(WorkspaceId(workspaceId), commitMessage);

      // Clear the commit message
      commitMessage = '';

      // Note: The backend now does a forced sync after commit, so we don't need to refresh here
      // Calling refresh here would trigger another sync that gets throttled

      // Clear the main panel view to go back
      fileTrackingStore.clearMainPanelView();

      logger.info('[handleCommit] Commit successful');
    } catch (error) {
      logger.error('[handleCommit] Failed to commit:', error);
      // Show error message to user
      const errorMessage = error instanceof Error ? error.message : 'Failed to commit changes';
      window.dispatchEvent(
        new CustomEvent('show-toast', {
          detail: {
            message: errorMessage,
            type: 'error',
          },
        }),
      );
    } finally {
      isCommitting = false;
    }
  }
</script>

<div class="flex flex-col h-full">
  <!-- Header (optional - hidden when wrapped in PanelWrapper) -->
  {#if showHeader}
    <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
      <div class="flex items-center gap-3">
        <Fa {icon} class="text-muted-foreground" />
        <h2 class="text-md font-semibold">{displayTitle}</h2>

        <span class="text-sm text-muted-foreground">
          ({filteredChanges.length}
          {filteredChanges.length === 1 ? 'file' : 'files'})
        </span>

        {#if totalAdditions > 0 || totalDeletions > 0}
          <LineChangesBadge additions={totalAdditions} deletions={totalDeletions} size="sm" />
        {/if}
      </div>

      <div class="flex items-center gap-2">
        <!-- Open In picker when viewing a specific file -->
        {#if viewMode === 'diff' && selectedChange && workspaceFolderPath && workspaceId}
          <FileActionsDropdown
            filePath={selectedChange.file}
            {workspaceId}
            isDirectory={false}
            {workspaceFolderPath}
            isDiff={true}
            variant="outline"
            size="sm"
            label="Open In"
            isCompact={false}
          />
          <div class="w-px h-5 bg-border"></div>
        {/if}

        <!-- Filter Dropdown -->
        {#if showFiltering}
          <select
            bind:value={filterMode}
            class="text-xs px-2 py-1 rounded border border-border bg-background"
          >
            <option value="all">All Changes</option>
            <option value="modified">Modified</option>
            <option value="created">Created</option>
            <option value="deleted">Deleted</option>
          </select>
        {/if}

        <!-- Group By Dropdown -->
        {#if showGrouping}
          <select
            bind:value={groupBy}
            class="text-xs px-2 py-1 rounded border border-border bg-background"
          >
            <option value="none">No Grouping</option>
            <option value="directory">By Directory</option>
            <option value="type">By Type</option>
          </select>
        {/if}

        {#if viewMode === 'diff' && selectedChange}
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="sm" onclick={handleBackToList} class="gap-2">
              <Fa icon={faList} size="xs" />
              <span>Back to list</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onclick={handleBackToList}
              class="p-1.5"
              title="Close diff view (Esc)"
            >
              <Fa icon={faTimes} />
            </Button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Summary Card (if enabled) -->
  {#if showSummaryCard && viewType === 'agent' && agentId && viewMode === 'list'}
    <div class="p-4 border-b border-border bg-muted/30">
      <AgentTurnSummaryCard
        turnNumber={turnNumber || 0}
        {agentId}
        {agentName}
        timestamp={new Date().toISOString()}
        status="completed"
        fileChanges={filteredChanges.map((c) => ({
          path: c.file,
          additions: c.stats?.additions || 0,
          deletions: c.stats?.deletions || 0,
          action: 'modify' as any,
        }))}
        onClick={() => (viewMode = 'summary')}
      />
    </div>
  {/if}

  <!-- Commit Form (if enabled for change-set view) -->
  {#if showCommitForm && viewType === 'change-set'}
    <div class="py-4 px-6 bg-muted/10">
      <div class="space-y-3">
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <Label for="commit-message" class="text-sm font-medium">Commit Message</Label>
          </div>
          <div class="relative w-full">
            <div class="absolute top-1 right-1 flex items-center gap-1 z-10">
              <Button
                variant="ghost-light"
                size="xs"
                onclick={async () => {
                  if (workspaceId) {
                    const workspace = workspaceStore.findById(
                      WorkspaceId(WorkspaceId(workspaceId)),
                    );
                    if (workspace) {
                      await commitExecutor.execute(workspace);
                    }
                  }
                }}
                disabled={commitExecutor.status === 'running' || changes.length === 0}
                class="gap-1.5 hover:bg-transparent!"
                tooltip={commitExecutor.status === 'running'
                  ? 'Generating commit message...'
                  : 'Generate commit message'}
              >
                {#if commitExecutor.status === 'running'}
                  <Fa icon={faSpinner} size="xs" class="animate-spin" />
                {:else}
                  <Fa icon={faMagicWandSparkles} size="xs" />
                {/if}
              </Button>
              {#if commitExecutor.agentId && (commitExecutor.status === 'running' || commitExecutor.status === 'success')}
                <Button
                  variant="ghost"
                  size="xs"
                  onclick={() => {
                    if (onOpenAgent && commitExecutor.agentId) {
                      onOpenAgent(commitExecutor.agentId);
                    }
                  }}
                  class="gap-1.5"
                  title="View thought process"
                  tooltip="View thought process"
                >
                  <Fa icon={faEye} size="xs" />
                </Button>
              {/if}
            </div>
            <Textarea
              id="commit-message"
              bind:value={commitMessage}
              placeholder="Enter your commit message..."
              class="mt-1.5 min-h-[100px] resize-none"
              disabled={isCommitting || commitExecutor.status === 'running'}
            />
          </div>
        </div>

        <div class="flex items-center justify-between">
          <div class="text-sm text-muted-foreground">
            {#if changes.length === 0}
              No changes to commit
            {:else}
              {changes.length} {changes.length === 1 ? 'file' : 'files'} will be committed
            {/if}
          </div>

          <Button
            variant="default"
            size="sm"
            onclick={handleCommit}
            disabled={!commitMessage.trim() || changes.length === 0 || isCommitting}
            class="gap-2"
          >
            <Fa icon={faCodeCommit} size="sm" />
            {isCommitting ? 'Committing...' : 'Commit Changes'}
          </Button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Content -->
  <div class="flex-1 overflow-hidden relative">
    {#if fileTrackingStore.loading && viewType === 'change-set' && changes.length === 0}
      <!-- Loading skeleton only when no data is loaded yet -->
      <div class="p-6 space-y-4">
        <div class="space-y-2">
          {#each Array(3) as _}
            <div class="flex items-center gap-3">
              <Skeleton class="h-4 w-4 rounded" />
              <Skeleton class="h-4 flex-1" />
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <!-- Show loading spinner overlay when refreshing with existing data -->
      {#if fileTrackingStore.loading && viewType === 'change-set' && changes.length > 0}
        <div class="absolute top-2 right-2 z-10">
          <Fa icon={faSpinner} class="animate-spin text-muted-foreground" size="sm" />
        </div>
      {/if}

      {#if viewMode === 'list'}
        <!-- Grouped File List -->
        {#if showGrouping && groupBy !== 'none'}
          <div class="h-full overflow-y-auto">
            {#each groupedChanges as group (group.key)}
              {@const isExpanded = expandedGroups.has(group.key)}
              {@const groupAdditions = group.changes.reduce(
                (sum, c) => sum + (c.stats?.additions || 0),
                0,
              )}
              {@const groupDeletions = group.changes.reduce(
                (sum, c) => sum + (c.stats?.deletions || 0),
                0,
              )}

              <div class="border-b border-border">
                <button
                  class="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                  onclick={() => toggleGroup(group.key)}
                >
                  <div class="flex items-center gap-2">
                    <Fa
                      icon={isExpanded ? faChevronDown : faChevronRight}
                      size="xs"
                      class="transition-transform"
                    />
                    <span class="font-medium text-sm">{group.label}</span>
                    <span class="text-xs text-muted-foreground">({group.changes.length})</span>
                  </div>
                  <LineChangesBadge
                    additions={groupAdditions}
                    deletions={groupDeletions}
                    size="xs"
                  />
                </button>

                {#if isExpanded}
                  <div class="pl-6">
                    <FileChangesList
                      changes={group.changes}
                      viewMode={fileTrackingStore.fileListViewMode === 'flat' ? 'list' : 'tree'}
                      showStats={true}
                      showActions={viewType === 'staged' ||
                        viewType === 'unstaged' ||
                        viewType === 'change-set'}
                      onFileClick={handleFileClick}
                      onStageClick={viewType === 'unstaged' ? handleStageChange : undefined}
                      onUnstageClick={viewType === 'staged' || viewType === 'change-set'
                        ? handleUnstageChange
                        : undefined}
                    />
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <!-- Regular File List or Commit Panel with Staged/Unstaged -->
          {#if viewType === 'change-set'}
            <!-- Commit Panel: Show staged and unstaged separately -->
            <div class="h-full overflow-y-auto">
              <!-- Staged Changes Section -->
              {#if filteredChanges.length > 0}
                <div class="p-4 pb-2">
                  <div class="flex items-center justify-between mb-2">
                    <h3 class="text-sm font-medium text-foreground">Staged Changes</h3>
                    <span class="text-xs text-muted-foreground">({filteredChanges.length})</span>
                  </div>
                  <div class="space-y-1">
                    {#each filteredChanges as change (change.id)}
                      {@const locked = isFileLocked(change.relativePath || change.file)}
                      <div
                        in:receive={{ key: change.id }}
                        out:send={{ key: change.id }}
                        class="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group"
                      >
                        <button
                          onclick={() => handleUnstageChange(change)}
                          disabled={locked}
                          class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded {locked
                            ? 'cursor-not-allowed opacity-50'
                            : 'hover:bg-destructive/10'}"
                          title={locked ? LOCKED_TOOLTIP : 'Unstage this file'}
                        >
                          <Fa icon={faMinus} size="xs" class="text-destructive" />
                        </button>
                        <button
                          onclick={() => handleFileClick(change)}
                          class="flex-1 text-left flex items-center gap-2"
                        >
                          <span class="text-sm truncate">{change.file}</span>
                          <LineChangesBadge
                            additions={change.stats?.additions || 0}
                            deletions={change.stats?.deletions || 0}
                            size="xs"
                          />
                        </button>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- Unstaged Changes Section -->
              {#if unstagedChanges.length > 0}
                <div class="p-4 pt-2 border-t border-border/50">
                  <div class="flex items-center justify-between mb-2">
                    <h3 class="text-sm font-medium text-muted-foreground">Unstaged Changes</h3>
                    <span class="text-xs text-muted-foreground">({unstagedChanges.length})</span>
                  </div>
                  <div class="space-y-1 opacity-60">
                    {#each unstagedChanges as change (change.id)}
                      {@const locked = isFileLocked(change.relativePath || change.file)}
                      <div
                        in:receive={{ key: change.id }}
                        out:send={{ key: change.id }}
                        class="flex items-center gap-2 p-2 rounded-md hover:bg-muted/30 group"
                      >
                        <button
                          onclick={() => handleStageChange(change)}
                          disabled={locked}
                          class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded {locked
                            ? 'cursor-not-allowed opacity-50'
                            : 'hover:bg-success/10'}"
                          title={locked ? LOCKED_TOOLTIP : 'Stage this file'}
                        >
                          <Fa icon={faPlus} size="xs" class="text-success" />
                        </button>
                        <button
                          onclick={() => handleFileClick(change)}
                          class="flex-1 text-left flex items-center gap-2"
                        >
                          <span class="text-sm truncate">{change.file}</span>
                          <LineChangesBadge
                            additions={change.stats?.additions || 0}
                            deletions={change.stats?.deletions || 0}
                            size="xs"
                          />
                        </button>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {:else}
            <!-- Other views: Regular file list -->
            <div class="h-full overflow-y-auto p-4">
              <FileChangesList
                changes={filteredChanges}
                viewMode={fileTrackingStore.fileListViewMode === 'flat' ? 'list' : 'tree'}
                showStats={true}
                showActions={viewType === 'staged' || viewType === 'unstaged'}
                onFileClick={handleFileClick}
                onStageClick={viewType === 'unstaged' ? handleStageChange : undefined}
                onUnstageClick={viewType === 'staged' ? handleUnstageChange : undefined}
              />
            </div>
          {/if}
        {/if}
      {:else if viewMode === 'diff' && selectedChange}
        <!-- Diff view -->
        <div class="relative h-full">
          <!-- Floating close button in top-right corner -->
          <Button
            variant="ghost"
            size="sm"
            onclick={handleBackToList}
            class="absolute top-2 right-2 z-10 p-1.5 bg-background/95 backdrop-blur-sm border border-border shadow-sm hover:bg-muted"
            title="Close diff view (Esc)"
          >
            <Fa icon={faTimes} size="sm" />
          </Button>

          <InteractiveDiffView
            change={selectedChange}
            showStagingControls={viewType !== 'agent' && viewType !== 'activity'}
            showAttribution={viewType === 'agent'}
            locked={isFileLocked(selectedChange?.relativePath || selectedChange?.file)}
            onStage={viewType === 'unstaged' ? handleStageChange : undefined}
            onUnstage={viewType === 'staged' ? handleUnstageChange : undefined}
            {workspaceId}
          />
        </div>
      {:else if viewMode === 'summary'}
        <!-- Summary view for agent turns -->
        <div class="p-6 space-y-4">
          <h3 class="text-lg font-medium">Turn Summary</h3>
          <div class="grid grid-cols-2 gap-4">
            <div class="p-4 rounded-lg border bg-card">
              <p class="text-sm text-muted-foreground mb-1">Files Changed</p>
              <p class="text-2xl font-bold">{filteredChanges.length}</p>
            </div>
            <div class="p-4 rounded-lg border bg-card">
              <p class="text-sm text-muted-foreground mb-1">Lines Modified</p>
              <div class="flex items-center gap-2">
                <span class="text-green-500 font-bold">+{totalAdditions}</span>
                <span class="text-red-500 font-bold">-{totalDeletions}</span>
              </div>
            </div>
          </div>

          <div class="space-y-2">
            <h4 class="text-sm font-medium">File Types Modified</h4>
            <div class="flex flex-wrap gap-2">
              {#each Array.from(filesByType.entries()) as [type, count] (type)}
                <span class="px-2 py-1 text-xs rounded-full bg-muted">
                  .{type} ({count})
                </span>
              {/each}
            </div>
          </div>

          <Button variant="outline" size="sm" onclick={() => (viewMode = 'list')} class="w-full">
            View File List
          </Button>
        </div>
      {/if}
    {/if}
  </div>
</div>
