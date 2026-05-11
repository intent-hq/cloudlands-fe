<script lang="ts">
  /**
   * ActiveWorkspacesCard - Shows workspaces split into Running, Unread, and Pinned sections
   *
   * - Running: workspaces with active streaming agents
   * - Unread: workspaces with unread messages (edited within last 24h)
   * - Pinned: user-pinned workspaces
   *
   * Supports mark-as-read and pin/unpin actions.
   */
  import { goto } from '$app/navigation';
  import { openWorkspaceInNewWindow } from '../utils/openWorkspaceInNewWindow';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { selectWorkspaceItems } from '$lib/store/slices/workspace/workspace-selectors';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { onMount } from 'svelte';
  import WorkspaceListItem from '../WorkspaceListItem.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import {
    selectActiveStreamsVersion,
    selectPinnedWorkspaceIds,
  } from '$lib/store/slices/sidebar-nav/sidebar-nav-selectors';
  import { closeAll, togglePinWorkspace } from '$lib/store/slices/sidebar-nav/sidebar-nav-slice';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { selectUnreadAgentIds, selectUnreadAgentIdsForWorkspace } from '$lib/store/slices/unread-tracking/unread-tracking-selectors';
  import { clearWorkspaceUnread } from '$lib/store/slices/unread-tracking/unread-tracking-slice';
  import {
    compareWorkspaceActivityDisplayTimeDesc,
    isWorkspaceActivityWithin,
  } from '$shared/utils/workspace-activity-time';

  const dispatch = getDispatch();
  const workspaceItems = selectWorkspaceItems();
  const activeStreamsVersion$ = selectActiveStreamsVersion();
  const unreadAgentIds$ = selectUnreadAgentIds();
  const pinnedIds$ = selectPinnedWorkspaceIds();

  interface Props {
    expanded?: boolean;
  }

  let { expanded = false }: Props = $props();

  // Fetch fresh stream state when the card mounts so data is up-to-date
  onMount(() => {
    activeStreamsTracker.fetchActiveStreams();
  });

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Running workspaces (streaming agents)
  const runningWorkspaces = $derived.by(() => {
    void $activeStreamsVersion$;
    return $workspaceItems
      .filter((w) => {
        if (w.status === WorkspaceStatusEnum.Archived || w.status === WorkspaceStatusEnum.Deleted)
          return false;
        return activeStreamsTracker.getStreamingAgentIdsForWorkspace(w.id).length > 0;
      })
      .map((w) => ({
        workspace: w,
        streamingIds: activeStreamsTracker.getStreamingAgentIdsForWorkspace(w.id),
      }))
      .sort((a, b) => compareWorkspaceActivityDisplayTimeDesc(a.workspace, b.workspace));
  });

  // Unread workspaces (not streaming, has unread, updated within last day)
  const unreadWorkspaces = $derived.by(() => {
    void $activeStreamsVersion$;
    void $unreadAgentIds$;
    const now = Date.now();
    const state = getReduxStore().getState();
    return $workspaceItems
      .filter((w) => {
        if (w.status === WorkspaceStatusEnum.Archived || w.status === WorkspaceStatusEnum.Deleted)
          return false;
        const streamingIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(w.id);
        if (streamingIds.length > 0) return false; // already in running
        const wsUnreadIds = selectUnreadAgentIdsForWorkspace.select(state, w.id);
        if (wsUnreadIds.length === 0) return false;
        // Only show unread if display activity is within the last day.
        return isWorkspaceActivityWithin(w, now, ONE_DAY_MS);
      })
      .map((w) => ({
        workspace: w,
        unreadIds: selectUnreadAgentIdsForWorkspace.select(state, w.id),
      }))
      .sort((a, b) => compareWorkspaceActivityDisplayTimeDesc(a.workspace, b.workspace));
  });

  // Pinned workspaces (not already in running or unread)
  const pinnedWorkspaces = $derived.by(() => {
    void $activeStreamsVersion$;
    void $unreadAgentIds$;
    const runningIds = new Set(runningWorkspaces.map((r) => r.workspace.id));
    const unreadIds = new Set(unreadWorkspaces.map((u) => u.workspace.id));
    return $pinnedIds$
      .map((id) => $workspaceItems.find((w) => w.id === id))
      .filter((w) => {
        if (!w) return false;
        if (w.status === WorkspaceStatusEnum.Archived || w.status === WorkspaceStatusEnum.Deleted)
          return false;
        // Don't duplicate if already in running or unread
        if (runningIds.has(w.id) || unreadIds.has(w.id)) return false;
        return true;
      })
      .map((w) => ({ workspace: w! }));
  });

  const totalCount = $derived(
    runningWorkspaces.length + unreadWorkspaces.length + pinnedWorkspaces.length,
  );

  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let highlightedIndex = $state(-1);

  // Reset highlight when search query or visible list changes
  $effect(() => {
    void searchQuery;
    highlightedIndex = allVisibleIds.length > 0 ? 0 : -1;
  });

  // Auto-focus search when expanded
  $effect(() => {
    if (expanded && searchInputEl) {
      searchInputEl.focus();
    }
  });

  const filteredRunning = $derived.by(() => {
    if (!searchQuery.trim()) return runningWorkspaces;
    const q = searchQuery.toLowerCase().trim();
    return runningWorkspaces.filter(
      ({ workspace: w }) =>
        (w.title || '').toLowerCase().includes(q) ||
        (w.repositoryName || '').toLowerCase().includes(q),
    );
  });

  const filteredUnread = $derived.by(() => {
    if (!searchQuery.trim()) return unreadWorkspaces;
    const q = searchQuery.toLowerCase().trim();
    return unreadWorkspaces.filter(
      ({ workspace: w }) =>
        (w.title || '').toLowerCase().includes(q) ||
        (w.repositoryName || '').toLowerCase().includes(q),
    );
  });

  const filteredPinned = $derived.by(() => {
    if (!searchQuery.trim()) return pinnedWorkspaces;
    const q = searchQuery.toLowerCase().trim();
    return pinnedWorkspaces.filter(
      ({ workspace: w }) =>
        (w.title || '').toLowerCase().includes(q) ||
        (w.repositoryName || '').toLowerCase().includes(q),
    );
  });

  async function handleClick(workspaceId: string, event?: MouseEvent | KeyboardEvent) {
    const route = `/workspace/${workspaceId}`;

    // Command-click (or Ctrl-click on non-Mac) opens in new window
    if (event?.metaKey || event?.ctrlKey) {
      await openWorkspaceInNewWindow(workspaceId);
      return;
    }

    keyboardNavActive = false;
    highlightedIndex = -1;
    dispatch(closeAll(false));
    dispatch(clearWorkspaceUnread(workspaceId));
    goto(route);
  }

  function handleMarkAsRead(e: MouseEvent, workspaceId: string) {
    e.stopPropagation();
    dispatch(clearWorkspaceUnread(workspaceId));
  }

  function handleTogglePin(e: MouseEvent, workspaceId: string) {
    e.stopPropagation();
    dispatch(togglePinWorkspace(workspaceId));
  }

  // Flat list of all visible workspace IDs for keyboard nav
  const allVisibleIds = $derived([
    ...filteredUnread.map((u) => u.workspace.id),
    ...filteredRunning.map((r) => r.workspace.id),
    ...filteredPinned.map((p) => p.workspace.id),
  ]);

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
  class="flex flex-col pb-2 outline-none"
  onkeydown={handleSearchKeydown}
  onmousemove={handleMouseMove}
  role="listbox"
  tabindex="0"
>
  {#if totalCount === 0}
    <div class="px-3 py-4">
      <p class="text-sm text-subtle">No active workspaces</p>
      <p class="text-sm text-subtle mt-1 leading-tight">
        Pin workspaces from All Spaces for quick access
      </p>
    </div>
  {:else}
    {#if expanded && totalCount > 3}
      <div class="px-3 pt-1 pb-2">
        <input
          bind:this={searchInputEl}
          type="text"
          placeholder="Search spaces..."
          bind:value={searchQuery}
          class="w-full px-2.5 py-1.5 text-sm bg-background/30 rounded-md text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
        />
      </div>
    {/if}

    <!-- Unread section -->
    {#if filteredUnread.length > 0}
      <div class="section-header px-3 pt-2 pb-1 flex items-center gap-1.5 min-w-0">
        <Header size={3} class="truncate">Unread</Header>
      </div>
      {#each filteredUnread as { workspace, unreadIds }, i (workspace.id)}
        <WorkspaceListItem
          {workspace}
          isUnread={true}
          unreadAgentIds={unreadIds}
          isPinned={$pinnedIds$.includes(workspace.id)}
          highlighted={keyboardNavActive && highlightedIndex === i}
          suppressHover={keyboardNavActive}
          onHover={() => (hoveredIndex = i)}
          onMarkAsRead={(e) => handleMarkAsRead(e, workspace.id)}
          onTogglePin={(e) => handleTogglePin(e, workspace.id)}
          onClick={(e) => handleClick(workspace.id, e)}
          onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
        />
      {/each}
    {/if}

    <!-- Running section -->
    {#if filteredRunning.length > 0}
      {@const unreadOffset = filteredUnread.length}
      <div class="section-header px-3 pt-2 pb-1 flex items-center gap-1.5 min-w-0">
        <Header size={3} class="truncate">Running</Header>
        <span class="text-ui text-subtle shrink-0">{runningWorkspaces.length}</span>
      </div>
      {#each filteredRunning as { workspace, streamingIds }, i (workspace.id)}
        <WorkspaceListItem
          {workspace}
          isRunning={true}
          streamingAgentIds={streamingIds}
          isPinned={$pinnedIds$.includes(workspace.id)}
          highlighted={keyboardNavActive && highlightedIndex === unreadOffset + i}
          suppressHover={keyboardNavActive}
          onHover={() => (hoveredIndex = unreadOffset + i)}
          onTogglePin={(e) => handleTogglePin(e, workspace.id)}
          onClick={(e) => handleClick(workspace.id, e)}
          onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
        />
      {/each}
    {/if}

    <!-- Pinned section -->
    {#if filteredPinned.length > 0}
      {@const pinnedOffset = filteredUnread.length + filteredRunning.length}
      <div class="section-header px-3 pt-2 pb-1 flex items-center gap-1.5 min-w-0">
        <Header size={3} class="truncate">Pinned</Header>
      </div>
      {#each filteredPinned as { workspace }, i (workspace.id)}
        <WorkspaceListItem
          {workspace}
          isPinned={true}
          highlighted={keyboardNavActive && highlightedIndex === pinnedOffset + i}
          suppressHover={keyboardNavActive}
          onHover={() => (hoveredIndex = pinnedOffset + i)}
          onTogglePin={(e) => handleTogglePin(e, workspace.id)}
          onClick={(e) => handleClick(workspace.id, e)}
          onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
        />
      {/each}
    {/if}
  {/if}
</div>

<style>
  @container (max-width: 160px) {
    .section-header {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }
  }
</style>
