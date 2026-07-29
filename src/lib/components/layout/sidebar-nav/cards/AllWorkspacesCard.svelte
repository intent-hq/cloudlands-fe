<script lang="ts">
  import { goto } from '$app/navigation';
  import { m } from '$shared/paraglide/messages.js';
  import { openWorkspaceInNewWindow } from '../utils/openWorkspaceInNewWindow';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import {
  selectWorkspaceItems,
  selectWorkspaceActivePullRequest,
  selectWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-selectors';
  import {
  WorkspaceStatusEnum,
  PullRequestStatus,
  isWorkspaceDisplayStatus,
} from '$shared/types';
  import type { Workspace } from '$shared/types';
  import {
  buildRepoPathLookup,
  getGroupKey,
} from '$lib/components/workspace/utils/workspace-grouping';
  import {
  getWorkspaceGroupingStatus,
  isWorkspaceRunning,
  type GroupingStatus,
  type WorkspaceDisplayStatus,
} from '$lib/components/workspace/utils/workspace-status-grouping';
  import { onMount } from 'svelte';
  import { isPRMergeable as checkPRMergeable } from '$lib/utils/pr-status';
  import Header from '$lib/components/ui/Header.svelte';

  import {
  selectActiveStreamsVersion,
  selectPinnedWorkspaceIds,
  selectAllSpacesViewMode,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import {
  selectUnreadAgentIds,
  selectUnreadAgentIdsForWorkspace,
} from '$store/renderer/slices/unread-tracking/unread-tracking-selectors';
  import { clearWorkspaceUnread } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';

  import {
  closeAll,
  togglePinWorkspace,
  setAllSpacesViewMode,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import type { AllSpacesViewMode } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import {
  compareWorkspaceActivityDisplayTimeDesc,
  getWorkspaceActivityDisplayTime,
} from '$shared/utils/workspace-activity-time';
  import { store as appStore } from '$store/renderer/store';
  import WorkspaceCard from '$lib/components/workspace/WorkspaceCard.svelte';
  import WorkspaceCardSkeleton from '../WorkspaceCardSkeleton.svelte';
  import {
  selectWorkspaceTaskProgress,
  selectWorkspaceTasksByWorkspaceId,
} from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';

  function getGitHubAvatarUrl(owner: string, size: number = 24): string {
    return `https://github.com/${owner}.png?size=${size}`;
  }

  const workspaceItems = selectWorkspaceItems();
  const hasLoaded$ = selectWorkspaceHasLoaded();
  const activeStreamsVersion$ = selectActiveStreamsVersion();
  const unreadAgentIds$ = selectUnreadAgentIds();
  const pinnedIds$ = selectPinnedWorkspaceIds();
  const viewMode$ = selectAllSpacesViewMode();
  const workspaceTasksByWorkspaceId$ = selectWorkspaceTasksByWorkspaceId();

  interface Props {
    expanded?: boolean;
  }

  let { expanded = false }: Props = $props();


  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let highlightedIndex = $state(-1);

  // Reset highlight when search query or view mode changes
  $effect(() => {
    void searchQuery;
    void $viewMode$;
    highlightedIndex = filteredWorkspaces.length > 0 ? 0 : -1;
  });

  // Auto-focus search when expanded
  $effect(() => {
    if (expanded && searchInputEl) {
      searchInputEl.focus();
    }
  });

  // Fetch fresh stream state when the card mounts so data is up-to-date
  onMount(() => {
    activeStreamsTracker.fetchActiveStreams();
  });

  const allWorkspaces = $derived.by(() => {
    void $pinnedIds$;

    return $workspaceItems
      .filter(
        (w) =>
          w.status !== WorkspaceStatusEnum.Archived && w.status !== WorkspaceStatusEnum.Deleted,
      )
      .sort((a, b) => {
        const aPinned = $pinnedIds$.includes(a.id);
        const bPinned = $pinnedIds$.includes(b.id);

        if (aPinned !== bPinned) {
          return aPinned ? -1 : 1;
        }

        return compareWorkspaceActivityDisplayTimeDesc(a, b);
      });
  });

  function getDisplayStatus(ws: Workspace): WorkspaceDisplayStatus {
    // BE-owned current-cycle status (workspace.displayStatus, intent-hq/intentd#600):
    // render it verbatim when present. The daemon owns the precedence (open/draft
    // PR → open tasks → merged PR → complete), so a merged PR never masks open
    // work. Unknown wire values (a future daemon's new value) are treated as
    // absent so the workspace degrades to the local derivation below instead of
    // vanishing from the grouped view.
    if (isWorkspaceDisplayStatus(ws.displayStatus)) return ws.displayStatus;
    const pullRequests = ws.pullRequests || [];
    const activePR = selectWorkspaceActivePullRequest.select(appStore.state, ws.id);
    const hasMergedPR =
      ws.prStatus === PullRequestStatus.Merged ||
      activePR?.status === PullRequestStatus.Merged ||
      pullRequests.some((pr) => pr.status === PullRequestStatus.Merged);
    if (hasMergedPR) return 'pr_merged';
    const hasOpenPR =
      ws.prStatus === PullRequestStatus.Open ||
      ws.prStatus === PullRequestStatus.Draft ||
      pullRequests.some(
        (pr) => pr.status === PullRequestStatus.Open || pr.status === PullRequestStatus.Draft,
      ) ||
      activePR?.status === PullRequestStatus.Open ||
      activePR?.status === PullRequestStatus.Draft;
    if (hasOpenPR) {
      if (activePR && activePR.status === PullRequestStatus.Open) {
        if (checkPRMergeable(activePR)) return 'pr_ready';
      }
      return 'pr_open';
    }
    // Reference task map for reactivity when canonical tasks load
    void $workspaceTasksByWorkspaceId$;
    const taskProgress = selectWorkspaceTaskProgress.select(appStore.state, ws.id);
    if (taskProgress.total > 0) {
      if (taskProgress.completed > 0 && taskProgress.completed === taskProgress.total) {
        return 'complete';
      }
      if (taskProgress.inProgress > 0 || taskProgress.completed > 0) return 'in_progress';
    }
    return 'not_started';
  }

  const filteredWorkspaces = $derived.by(() => {
    if (!searchQuery.trim()) return allWorkspaces;
    const q = searchQuery.toLowerCase().trim();
    return allWorkspaces.filter(
      (w) =>
        (w.title || '').toLowerCase().includes(q) ||
        (w.repositoryName || '').toLowerCase().includes(q),
    );
  });

  // Load canonical tasks for listed workspaces while expanded (no-op once initialized).
  $effect(() => {
    if (!expanded) return;
    for (const ws of filteredWorkspaces) {
      appStore.dispatch(ensureWorkspaceTasksLoaded(String(ws.id)));
    }
  });

  // Build a lookup from repositoryPath → {owner, name} so workspaces missing
  // owner/name can be merged into the correct group instead of creating duplicates.
  // Only use active workspaces to avoid stale metadata from archived/deleted workspaces
  // polluting the lookup (e.g. a reused path mapping to the wrong group).
  const sidebarRepoPathLookup = $derived.by(() => {
    const active = $workspaceItems.filter(
      (w) => w.status !== WorkspaceStatusEnum.Archived && w.status !== WorkspaceStatusEnum.Deleted,
    );
    return buildRepoPathLookup(active);
  });

  const groupedByRepo = $derived.by(() => {
    const groups = new Map<string, { workspaces: Workspace[]; owner?: string; label: string }>();
    for (const ws of filteredWorkspaces) {
      const { key, label, owner } = getGroupKey(ws, sidebarRepoPathLookup, m.layout_allCard_noRepository_label());

      if (!groups.has(key)) groups.set(key, { workspaces: [], owner, label });
      groups.get(key)!.workspaces.push(ws);
    }
    return [...groups.entries()].sort((a, b) => {
      const aTime = getWorkspaceActivityDisplayTime(a[1].workspaces[0]);
      const bTime = getWorkspaceActivityDisplayTime(b[1].workspaces[0]);
      return bTime - aTime;
    });
  });

  const statusLabels: Record<GroupingStatus, () => string> = {
    idle: () => m.layout_allCard_statusIdle_label(),
    not_started: () => m.layout_allCard_statusNoChanges_label(),
    in_progress: () => m.layout_allCard_statusInProgress_label(),
    complete: () => m.layout_allCard_statusComplete_label(),
    pr_ready: () => m.layout_allCard_statusPrReady_label(),
    pr_open: () => m.layout_allCard_statusPrOpen_label(),
    pr_merged: () => m.layout_allCard_statusPrMerged_label(),
  };

  const statusOrder: GroupingStatus[] = [
    'idle',
    'in_progress',
    'pr_ready',
    'pr_open',
    'not_started',
    'complete',
    'pr_merged',
  ];

  function getGroupingStatus(ws: Workspace): GroupingStatus {
    const baseStatus = getDisplayStatus(ws);
    void $activeStreamsVersion$;
    const streamingAgentIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
    return getWorkspaceGroupingStatus(ws, baseStatus, streamingAgentIds);
  }

  const groupedByStatus = $derived.by(() => {
    const groups = new Map<GroupingStatus, Workspace[]>();
    for (const ws of filteredWorkspaces) {
      const status = getGroupingStatus(ws);
      if (!groups.has(status)) groups.set(status, []);
      groups.get(status)!.push(ws);
    }
    return statusOrder
      .filter((s) => groups.has(s))
      .map((s) => [statusLabels[s](), groups.get(s)!] as [string, Workspace[]]);
  });

  function _isRunning(ws: Workspace): boolean {
    void $activeStreamsVersion$;
    const streamingAgentIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
    return isWorkspaceRunning(ws, streamingAgentIds);
  }

  function _getStreamingIds(ws: Workspace): string[] {
    void $activeStreamsVersion$;
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
  }

  function getUnreadAgentIds(ws: Workspace): string[] {
    void $unreadAgentIds$;
    return selectUnreadAgentIdsForWorkspace.select(appStore.state, ws.id);
  }

  function _isUnread(ws: Workspace): boolean {
    void $activeStreamsVersion$;
    const streamingIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
    if (streamingIds.length > 0) return false;
    return getUnreadAgentIds(ws).length > 0;
  }

  async function handleClick(workspaceId: string, event?: MouseEvent | KeyboardEvent) {
    const route = `/workspace/${workspaceId}`;

    // Command-click (or Ctrl-click on non-Mac) opens in new window
    if (event?.metaKey || event?.ctrlKey) {
      await openWorkspaceInNewWindow(workspaceId);
      return;
    }

    keyboardNavActive = false;
    highlightedIndex = -1;
    appStore.dispatch(closeAll(false));
    goto(route);
  }

  function handleTogglePin(e: MouseEvent, workspaceId: string) {
    e.stopPropagation();
    appStore.dispatch(togglePinWorkspace(workspaceId));
  }

  function handleMarkAsRead(e: MouseEvent, workspaceId: string) {
    e.stopPropagation();
    appStore.dispatch(clearWorkspaceUnread(workspaceId));
  }

  // Flat ordered list of workspace IDs matching the current view mode's display order
  const allVisibleIds = $derived.by(() => {
    if ($viewMode$ === 'repo') {
      return groupedByRepo.flatMap(([, group]) => group.workspaces.map((w) => w.id));
    } else if ($viewMode$ === 'status') {
      return groupedByStatus.flatMap(([, workspaces]) => workspaces.map((w) => w.id));
    }
    return filteredWorkspaces.map((w) => w.id);
  });

  // Map from workspace ID to its position in the flat visible list (for highlighting)
  const _visibleIdIndex = $derived(new Map(allVisibleIds.map((id, i) => [id, i])));

  let keyboardNavActive = $state(false);
  let hoveredIndex = $state(-1);

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!keyboardNavActive && hoveredIndex >= 0) {
        highlightedIndex = hoveredIndex;
      }
      highlightedIndex = Math.min(highlightedIndex + 1, allVisibleIds.length - 1);
      keyboardNavActive = true;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!keyboardNavActive && hoveredIndex >= 0) {
        highlightedIndex = hoveredIndex;
      }
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      keyboardNavActive = true;
    } else if (
      e.key === 'Enter' &&
      highlightedIndex >= 0 &&
      highlightedIndex < allVisibleIds.length
    ) {
      e.preventDefault();
      handleClick(allVisibleIds[highlightedIndex]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      highlightedIndex = 0;
      keyboardNavActive = true;
    } else if (e.key === 'End') {
      e.preventDefault();
      highlightedIndex = Math.max(allVisibleIds.length - 1, 0);
      keyboardNavActive = true;
    }
  }

  function handleMouseMove() {
    if (keyboardNavActive) {
      keyboardNavActive = false;
      highlightedIndex = -1;
    }
  }
</script>

<div
  class="flex flex-col h-full outline-none"
  onkeydown={handleSearchKeydown}
  onmousemove={handleMouseMove}
  role="listbox"
  tabindex="0"
>
  <div class="flex flex-col gap-1 px-3 pt-1 pb-1 shrink-0 w-full">
    <div class="view-mode-tabs gap-0.5 bg-slate-500/10 rounded-lg p-0.5 mb-2 w-full">
      {#each [['recent', m.layout_allCard_recent_label()], ['repo', m.layout_allCard_repo_label()], ['status', m.layout_allCard_status_label()]] as [mode, label]}
        <button
          class="view-mode-tab px-1.5 py-1 text-xs rounded-md transition-all duration-150 cursor-pointer text-center truncate
            {$viewMode$ === mode
            ? 'bg-background text-foreground font-medium shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          title={label}
          onclick={() => appStore.dispatch(setAllSpacesViewMode(mode as AllSpacesViewMode))}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>

  {#if $hasLoaded$ && expanded && allWorkspaces.length > 3}
    <div class="px-3 pb-2">
      <input
        bind:this={searchInputEl}
        type="text"
        placeholder={m.layout_activeCard_search_placeholder()}
        bind:value={searchQuery}
        class="w-full px-2.5 py-1.5 text-sm bg-background/30 rounded-md text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
      />
    </div>
  {/if}

  {#if !$hasLoaded$}
    <!-- Show skeleton placeholders while loading -->
    <div class="pb-2">
      {#each Array(5) as _, i (i)}
        <WorkspaceCardSkeleton />
      {/each}
    </div>
  {:else if allWorkspaces.length === 0}
    <div class="px-3 pb-3 text-xs text-subtle">{m.layout_allCard_noWorkspaces_label()}</div>
  {:else}
    <div class="overflow-y-auto flex-1 min-h-0 pb-2">
      {#if $viewMode$ === 'recent'}
        {#each filteredWorkspaces as workspace, i (workspace.id)}
          {#if i > 0 && !$pinnedIds$.includes(workspace.id) && $pinnedIds$.includes(filteredWorkspaces[i - 1].id)}
            <div class="border-t border-border my-1 mx-2"></div>
          {/if}
          <WorkspaceCard
            {workspace}
            variant="compact"
            isRunning={_isRunning(workspace)}
            isUnread={_isUnread(workspace)}
            isPinned={$pinnedIds$.includes(workspace.id)}
            streamingAgentIds={_getStreamingIds(workspace)}
            unreadAgentIds={getUnreadAgentIds(workspace)}
            highlighted={keyboardNavActive && highlightedIndex === (_visibleIdIndex.get(workspace.id) ?? -1)}
            suppressHover={keyboardNavActive}
            onClick={(e) => handleClick(workspace.id, e)}
            onTogglePin={(e) => handleTogglePin(e, workspace.id)}
            onMarkAsRead={_isUnread(workspace)
              ? (e) => handleMarkAsRead(e, workspace.id)
              : undefined}
            onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
            onHover={() => { hoveredIndex = _visibleIdIndex.get(workspace.id) ?? -1; }}
          />
        {/each}
      {:else if $viewMode$ === 'repo'}
        {#each groupedByRepo as [, group]}
          <div class="section-header flex items-center gap-1.5 px-3 pt-2.5 pb-1 mt-3 min-w-0">
            {#if group.owner}
              <img
                src={getGitHubAvatarUrl(group.owner)}
                alt={group.owner}
                class="size-3.5 rounded-full shrink-0"
                loading="lazy"
                onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
            {/if}
            <Header size={3} class="truncate">{group.label}</Header>
          </div>
          {#each group.workspaces as workspace, _i (workspace.id)}
            <WorkspaceCard
              {workspace}
              variant="compact"
              isRunning={_isRunning(workspace)}
              isUnread={_isUnread(workspace)}
              isPinned={$pinnedIds$.includes(workspace.id)}
              streamingAgentIds={_getStreamingIds(workspace)}
              unreadAgentIds={getUnreadAgentIds(workspace)}
              hideRepoAvatar={true}
              highlighted={keyboardNavActive && highlightedIndex === (_visibleIdIndex.get(workspace.id) ?? -1)}
              suppressHover={keyboardNavActive}
              onClick={(e) => handleClick(workspace.id, e)}
              onTogglePin={(e) => handleTogglePin(e, workspace.id)}
              onMarkAsRead={_isUnread(workspace)
                ? (e) => handleMarkAsRead(e, workspace.id)
                : undefined}
              onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
              onHover={() => { hoveredIndex = _visibleIdIndex.get(workspace.id) ?? -1; }}
            />
          {/each}
        {/each}
      {:else if $viewMode$ === 'status'}
        {#each groupedByStatus as [statusLabel, workspaces]}
          <div class="section-header px-3 pt-2 pb-1 mt-3 min-w-0">
            <Header size={3} class="truncate">{statusLabel}</Header>
          </div>
          {#each workspaces as workspace, _i (workspace.id)}
            <WorkspaceCard
              {workspace}
              variant="compact"
              isRunning={_isRunning(workspace)}
              isUnread={_isUnread(workspace)}
              isPinned={$pinnedIds$.includes(workspace.id)}
              streamingAgentIds={_getStreamingIds(workspace)}
              unreadAgentIds={getUnreadAgentIds(workspace)}
              highlighted={keyboardNavActive && highlightedIndex === (_visibleIdIndex.get(workspace.id) ?? -1)}
              suppressHover={keyboardNavActive}
              onClick={(e) => handleClick(workspace.id, e)}
              onTogglePin={(e) => handleTogglePin(e, workspace.id)}
              onMarkAsRead={_isUnread(workspace)
                ? (e) => handleMarkAsRead(e, workspace.id)
                : undefined}
              onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
              onHover={() => { hoveredIndex = _visibleIdIndex.get(workspace.id) ?? -1; }}
            />
          {/each}
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Default: horizontal tabs */
  .view-mode-tabs {
    display: flex;
    flex-direction: row;
  }
  .view-mode-tab {
    flex: 1;
  }

  /* Narrow: stack tabs vertically, tighten spacing */
  @container (max-width: 180px) {
    .view-mode-tabs {
      flex-direction: column;
    }
    .view-mode-tab {
      flex: none;
      width: 100%;
    }
    .section-header {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }
  }
</style>
