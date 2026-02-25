<script lang="ts">
  import { goto } from '$app/navigation';
  import { sidebarNavStore } from '../sidebar-nav.store.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import { WorkspaceStatusEnum, PullRequestStatus } from '$shared/types';
  import type { Workspace } from '$shared/types';
  import type { WorkspaceDisplayStatus } from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import WorkspaceListItem from '../WorkspaceListItem.svelte';
  import { onMount } from 'svelte';

  function getGitHubAvatarUrl(owner: string, size: number = 24): string {
    return `https://github.com/${owner}.png?size=${size}`;
  }

  import type { AllSpacesViewMode } from '../sidebar-nav.store.svelte';
  import Header from '$lib/components/ui/Header.svelte';

  interface Props {
    expanded?: boolean;
  }

  let { expanded = false }: Props = $props();

  const viewMode = $derived(sidebarNavStore.allSpacesViewMode);

  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let highlightedIndex = $state(-1);

  // Reset highlight when search query changes
  $effect(() => {
    void searchQuery;
    highlightedIndex = filteredWorkspaces.length > 0 ? 0 : -1;
  });

  let activeStreamsVersion = $state(0);
  let unreadVersion = $state(0);

  // Auto-focus search when expanded
  $effect(() => {
    if (expanded && searchInputEl) {
      searchInputEl.focus();
    }
  });

  onMount(() => {
    activeStreamsTracker.startPolling(2000);
    const unsubStreams = activeStreamsTracker.subscribe(() => activeStreamsVersion++);
    const unsubUnread = unreadTrackingService.subscribe(() => unreadVersion++);
    return () => {
      unsubStreams();
      unsubUnread();
    };
  });

  const allWorkspaces = $derived.by(() => {
    return workspaceStore.items
      .filter(
        (w) =>
          w.status !== WorkspaceStatusEnum.Archived && w.status !== WorkspaceStatusEnum.Deleted,
      )
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  });

  function getDisplayStatus(ws: Workspace): WorkspaceDisplayStatus {
    const pullRequests = ws.pullRequests || [];
    const hasMergedPR =
      ws.prStatus === PullRequestStatus.Merged ||
      pullRequests.some((pr) => pr.status === PullRequestStatus.Merged);
    if (hasMergedPR) return 'pr_merged';
    const hasOpenPR =
      ws.prStatus === PullRequestStatus.Open ||
      ws.prStatus === PullRequestStatus.Draft ||
      pullRequests.some(
        (pr) => pr.status === PullRequestStatus.Open || pr.status === PullRequestStatus.Draft,
      ) ||
      ws.activePullRequest;
    if (hasOpenPR) return 'pr_open';
    const taskStats = ws.taskStats;
    if (taskStats) {
      if (taskStats.completed > 0 && taskStats.completed === taskStats.total) return 'complete';
      if (taskStats.inProgress > 0 || taskStats.completed > 0) return 'in_progress';
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

  const groupedByRepo = $derived.by(() => {
    const groups = new Map<string, { workspaces: Workspace[]; owner?: string }>();
    for (const ws of filteredWorkspaces) {
      const repo = ws.repositoryName || 'No Repository';
      if (!groups.has(repo)) groups.set(repo, { workspaces: [], owner: ws.repositoryOwner });
      groups.get(repo)!.workspaces.push(ws);
    }
    return [...groups.entries()].sort((a, b) => {
      const aTime = new Date(a[1].workspaces[0].updatedAt).getTime();
      const bTime = new Date(b[1].workspaces[0].updatedAt).getTime();
      return bTime - aTime;
    });
  });

  const statusLabels: Record<WorkspaceDisplayStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    complete: 'Complete',
    pr_open: 'PR Open',
    pr_merged: 'PR Merged',
  };

  const statusOrder: WorkspaceDisplayStatus[] = [
    'in_progress',
    'pr_open',
    'not_started',
    'complete',
    'pr_merged',
  ];

  const groupedByStatus = $derived.by(() => {
    const groups = new Map<WorkspaceDisplayStatus, Workspace[]>();
    for (const ws of filteredWorkspaces) {
      const status = getDisplayStatus(ws);
      if (!groups.has(status)) groups.set(status, []);
      groups.get(status)!.push(ws);
    }
    return statusOrder
      .filter((s) => groups.has(s))
      .map((s) => [statusLabels[s], groups.get(s)!] as [string, Workspace[]]);
  });

  function isRunning(ws: Workspace): boolean {
    void activeStreamsVersion;
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id).length > 0;
  }

  function getStreamingIds(ws: Workspace): string[] {
    void activeStreamsVersion;
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
  }

  function getUnreadAgentIds(ws: Workspace): string[] {
    void unreadVersion;
    return unreadTrackingService.getUnreadAgentIdsForWorkspace(ws.id);
  }

  function isUnread(ws: Workspace): boolean {
    void activeStreamsVersion;
    const streamingIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
    if (streamingIds.length > 0) return false;
    return getUnreadAgentIds(ws).length > 0;
  }

  function handleClick(workspaceId: string) {
    sidebarNavStore.closeAll();
    goto(`/workspace/${workspaceId}`);
  }

  function handleTogglePin(e: MouseEvent, workspaceId: string) {
    e.stopPropagation();
    sidebarNavStore.togglePinWorkspace(workspaceId);
  }

  function handleMarkAsRead(e: MouseEvent, workspaceId: string) {
    e.stopPropagation();
    unreadTrackingService.clearUnreadForWorkspace(workspaceId);
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    const ids = filteredWorkspaces.map((w) => w.id);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, ids.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
    } else if (e.key === 'Enter' && highlightedIndex >= 0 && highlightedIndex < ids.length) {
      e.preventDefault();
      handleClick(ids[highlightedIndex]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      highlightedIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      highlightedIndex = Math.max(ids.length - 1, 0);
    }
  }
</script>

<div
  class="flex flex-col h-full outline-none"
  onkeydown={handleSearchKeydown}
  role="listbox"
  tabindex="0"
>
  <div class="flex flex-col gap-1 px-3 pt-1 pb-1 shrink-0 w-full">
    <div class="flex items-center gap-0.5 bg-slate-500/10 rounded-lg p-0.5 mb-2 w-full">
      {#each [['recent', 'Recent'], ['repo', 'By repo'], ['status', 'By status']] as [mode, label]}
        <button
          class="flex-1 px-2.5 py-1 text-xs rounded-md transition-all duration-150 cursor-pointer text-center
            {viewMode === mode
            ? 'bg-background text-foreground font-medium shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => sidebarNavStore.setAllSpacesViewMode(mode as AllSpacesViewMode)}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>

  {#if expanded && allWorkspaces.length > 3}
    <div class="px-3 pb-2">
      <input
        bind:this={searchInputEl}
        type="text"
        placeholder="Search spaces..."
        bind:value={searchQuery}
        class="w-full px-2.5 py-1.5 text-sm bg-background/30 rounded-md text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
      />
    </div>
  {/if}

  {#if allWorkspaces.length === 0}
    <div class="px-3 pb-3 text-xs text-muted-foreground/60">No workspaces yet</div>
  {:else}
    <div class="overflow-y-auto flex-1 min-h-0 pb-2">
      {#if viewMode === 'recent'}
        {#each filteredWorkspaces as workspace, i (workspace.id)}
          <WorkspaceListItem
            {workspace}
            isRunning={isRunning(workspace)}
            streamingAgentIds={getStreamingIds(workspace)}
            unreadAgentIds={getUnreadAgentIds(workspace)}
            isUnread={isUnread(workspace)}
            isPinned={sidebarNavStore.isPinned(workspace.id)}
            highlighted={highlightedIndex === i}
            onTogglePin={(e) => handleTogglePin(e, workspace.id)}
            onMarkAsRead={isUnread(workspace)
              ? (e) => handleMarkAsRead(e, workspace.id)
              : undefined}
            onClick={() => handleClick(workspace.id)}
          />
        {/each}
      {:else if viewMode === 'repo'}
        {#each groupedByRepo as [repoName, group]}
          <div class="flex items-center gap-1.5 px-3 pt-2.5 pb-1 mt-3">
            {#if group.owner}
              <img
                src={getGitHubAvatarUrl(group.owner)}
                alt={group.owner}
                class="size-3.5 rounded-full shrink-0"
                loading="lazy"
                onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
            {/if}
            <Header size={3}>{repoName}</Header>
          </div>
          {#each group.workspaces as workspace (workspace.id)}
            <WorkspaceListItem
              {workspace}
              hideRepoAvatar
              isRunning={isRunning(workspace)}
              streamingAgentIds={getStreamingIds(workspace)}
              unreadAgentIds={getUnreadAgentIds(workspace)}
              isUnread={isUnread(workspace)}
              isPinned={sidebarNavStore.isPinned(workspace.id)}
              onTogglePin={(e) => handleTogglePin(e, workspace.id)}
              onMarkAsRead={isUnread(workspace)
                ? (e) => handleMarkAsRead(e, workspace.id)
                : undefined}
              onClick={() => handleClick(workspace.id)}
            />
          {/each}
        {/each}
      {:else if viewMode === 'status'}
        {#each groupedByStatus as [statusLabel, workspaces]}
          <div class="px-3 pt-2 pb-1 mt-3">
            <Header size={3}>{statusLabel}</Header>
          </div>
          {#each workspaces as workspace (workspace.id)}
            <WorkspaceListItem
              {workspace}
              isRunning={isRunning(workspace)}
              streamingAgentIds={getStreamingIds(workspace)}
              unreadAgentIds={getUnreadAgentIds(workspace)}
              isUnread={isUnread(workspace)}
              isPinned={sidebarNavStore.isPinned(workspace.id)}
              onTogglePin={(e) => handleTogglePin(e, workspace.id)}
              onMarkAsRead={isUnread(workspace)
                ? (e) => handleMarkAsRead(e, workspace.id)
                : undefined}
              onClick={() => handleClick(workspace.id)}
            />
          {/each}
        {/each}
      {/if}
    </div>
  {/if}
</div>
