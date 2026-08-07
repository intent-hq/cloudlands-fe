<script lang="ts">
  /**
   * ActiveWorkspacesCard - Shows workspaces split into Unread, Running, Waiting, and Pinned sections
   *
   * - Running: workspaces with active streaming agents
   * - Unread: workspaces with unread messages (edited within last 24h)
   * - Waiting: workspaces the daemon reports as in_progress with no streaming
   *   agents (agents waiting on background hooks or delegated work)
   * - Pinned: user-pinned workspaces
   *
   * Supports mark-as-read and pin/unpin actions.
   */
  import { goto } from '$app/navigation';
  import { m } from '$shared/paraglide/messages.js';
  import { openWorkspaceInNewWindow } from '../utils/openWorkspaceInNewWindow';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import {
    selectWorkspaceItems,
    selectWorkspaceHasLoaded,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { onMount } from 'svelte';
  import Header from '$lib/components/ui/Header.svelte';

  import {
  selectPinnedWorkspaceIds,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import {
  closeAll,
  togglePinWorkspace,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

  import { markWorkspaceSeen } from '$features/workspace/mark-workspace-seen';
  import { focusFirstUnreadAgent } from '$features/agent/focus-first-unread-agent';
  import {
  compareWorkspaceActivityDisplayTimeDesc,
  isWorkspaceActivityWithin,
} from '$shared/utils/workspace-activity-time';
  import { store as appStore } from '$store/renderer/store';
  import WorkspaceCard from '$lib/components/workspace/WorkspaceCard.svelte';
  import WorkspaceCardSkeleton from '../WorkspaceCardSkeleton.svelte';

  const workspaceItems = selectWorkspaceItems();
  const hasLoaded$ = selectWorkspaceHasLoaded();
  const pinnedIds$ = selectPinnedWorkspaceIds();

  interface Props {
    expanded?: boolean;
  }

  let { expanded = false }: Props = $props();

  // Direct tracker subscription for reactivity (no Redux bridge): bump a
  // local version counter when the tracker notifies so deriveds recompute.
  let activeStreamsVersion = $state(0);

  // Fetch fresh stream state when the card mounts so data is up-to-date
  onMount(() => {
    activeStreamsTracker.startPolling();
    activeStreamsTracker.fetchActiveStreams();
    return activeStreamsTracker.subscribe(() => activeStreamsVersion++);
  });

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Running workspaces (streaming agents)
  const runningWorkspaces = $derived.by(() => {
    void activeStreamsVersion;
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

  // Unread workspaces (not streaming, BE attention flag raised, updated within last day)
  const unreadWorkspaces = $derived.by(() => {
    void activeStreamsVersion;
    const now = Date.now();
    return $workspaceItems
      .filter((w) => {
        if (w.status === WorkspaceStatusEnum.Archived || w.status === WorkspaceStatusEnum.Deleted)
          return false;
        const streamingIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(w.id);
        if (streamingIds.length > 0) return false; // already in running
        if (w.attention !== 'unread') return false;
        // Only show unread if display activity is within the last day.
        return isWorkspaceActivityWithin(w, now, ONE_DAY_MS);
      })
      .map((w) => ({
        workspace: w,
        // Attention is workspace-level; show member agents as the unread set.
        unreadIds: w.agentSummary?.agentIds ?? [],
      }))
      .sort((a, b) => compareWorkspaceActivityDisplayTimeDesc(a.workspace, b.workspace));
  });

  // Waiting workspaces: the daemon promotes displayStatus to 'in_progress' when an
  // agent runs, a background hook is ACTIVE, or an idle coordinator still awaits
  // delegated agents (PROTOCOL §5.1). With no streaming agents, that leaves exactly
  // the hook-waiting / delegation-waiting cases. Unread wins over Waiting.
  const waitingWorkspaces = $derived.by(() => {
    void activeStreamsVersion;
    const unreadIds = new Set(unreadWorkspaces.map((u) => u.workspace.id));
    return $workspaceItems
      .filter((w) => {
        if (w.status === WorkspaceStatusEnum.Archived || w.status === WorkspaceStatusEnum.Deleted)
          return false;
        if (w.displayStatus !== 'in_progress') return false;
        if (activeStreamsTracker.getStreamingAgentIdsForWorkspace(w.id).length > 0) return false;
        if (unreadIds.has(w.id)) return false;
        return true;
      })
      .map((w) => ({ workspace: w }))
      .sort((a, b) => compareWorkspaceActivityDisplayTimeDesc(a.workspace, b.workspace));
  });

  // Pinned workspaces (not already in running, unread, or waiting)
  const pinnedWorkspaces = $derived.by(() => {
    void activeStreamsVersion;
    const runningIds = new Set(runningWorkspaces.map((r) => r.workspace.id));
    const unreadIds = new Set(unreadWorkspaces.map((u) => u.workspace.id));
    const waitingIds = new Set(waitingWorkspaces.map((w) => w.workspace.id));
    return $pinnedIds$
      .map((id) => $workspaceItems.find((w) => w.id === id))
      .filter((w) => {
        if (!w) return false;
        if (w.status === WorkspaceStatusEnum.Archived || w.status === WorkspaceStatusEnum.Deleted)
          return false;
        // Don't duplicate if already in running, unread, or waiting
        if (runningIds.has(w.id) || unreadIds.has(w.id) || waitingIds.has(w.id)) return false;
        return true;
      })
      .map((w) => ({ workspace: w! }));
  });

  const totalCount = $derived(
    runningWorkspaces.length +
      unreadWorkspaces.length +
      waitingWorkspaces.length +
      pinnedWorkspaces.length,
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

  const filteredWaiting = $derived.by(() => {
    if (!searchQuery.trim()) return waitingWorkspaces;
    const q = searchQuery.toLowerCase().trim();
    return waitingWorkspaces.filter(
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
    appStore.dispatch(closeAll(false));
    goto(route);
  }

  /**
   * Unread rows: navigate, then land on the first top-level agent with unread
   * messages (the helper waits for the navigation-triggered agent load). Falls
   * back to plain navigation when no foreground agent is unread, and skips the
   * focus entirely for Cmd/Ctrl-click (new window).
   */
  async function handleUnreadClick(workspaceId: string, event?: MouseEvent | KeyboardEvent) {
    await handleClick(workspaceId, event);
    if (event?.metaKey || event?.ctrlKey) return;
    focusFirstUnreadAgent(workspaceId);
  }

  function handleMarkAsRead(e: MouseEvent, workspaceId: string) {
    e.stopPropagation();
    // Daemon round-trip (`workspace.markSeen`, §5.1): the resulting
    // `workspace:attention-changed` event clears the dot on all clients.
    markWorkspaceSeen(workspaceId);
  }

  function handleTogglePin(e: MouseEvent, workspaceId: string) {
    e.stopPropagation();
    appStore.dispatch(togglePinWorkspace(workspaceId));
  }

  // Flat list of all visible workspace IDs for keyboard nav
  const allVisibleIds = $derived([
    ...filteredUnread.map((u) => u.workspace.id),
    ...filteredRunning.map((r) => r.workspace.id),
    ...filteredWaiting.map((w) => w.workspace.id),
    ...filteredPinned.map((p) => p.workspace.id),
  ]);

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
      const id = allVisibleIds[highlightedIndex];
      // Keyboard activation must match the row's own click behavior, so Unread
      // rows also land on their first unread agent.
      if (filteredUnread.some(({ workspace }) => workspace.id === id)) {
        handleUnreadClick(id);
      } else {
        handleClick(id);
      }
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
  role={$hasLoaded$ ? 'listbox' : undefined}
  aria-busy={!$hasLoaded$}
  tabindex="0"
>
  {#if !$hasLoaded$}
    <!-- Show skeleton placeholders while loading -->
    <div class="pt-2">
      {#each Array(5) as _, i (i)}
        <WorkspaceCardSkeleton />
      {/each}
    </div>
  {:else if totalCount === 0}
    <div class="px-3 py-4">
      <p class="text-sm text-subtle">{m.layout_activeCard_noActive_label()}</p>
      <p class="text-sm text-subtle mt-1 leading-tight">
        {m.layout_activeCard_pinHint_description()}
      </p>
    </div>
  {:else}
    {#if expanded && totalCount > 3}
      <div class="px-3 pt-1 pb-2">
        <input
          bind:this={searchInputEl}
          type="text"
          placeholder={m.layout_activeCard_search_placeholder()}
          bind:value={searchQuery}
          class="w-full px-2.5 py-1.5 text-sm bg-background/30 rounded-md text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
        />
      </div>
    {/if}

    <!-- Unread section -->
    {#if filteredUnread.length > 0}
      <div class="section-header px-3 pt-2 pb-1 flex items-center gap-1.5 min-w-0">
        <Header size={3} class="truncate">{m.layout_activeCard_unread_header()}</Header>
      </div>
      {#each filteredUnread as { workspace, unreadIds }, _i (workspace.id)}
        <WorkspaceCard
          {workspace}
          variant="compact"
          isUnread={true}
          isPinned={$pinnedIds$.includes(workspace.id)}
          unreadAgentIds={unreadIds}
          highlighted={keyboardNavActive && highlightedIndex === (_visibleIdIndex.get(workspace.id) ?? -1)}
          suppressHover={keyboardNavActive}
          onClick={(e) => handleUnreadClick(workspace.id, e)}
          onTogglePin={(e) => handleTogglePin(e, workspace.id)}
          onMarkAsRead={(e) => handleMarkAsRead(e, workspace.id)}
          onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
          onHover={() => { hoveredIndex = _visibleIdIndex.get(workspace.id) ?? -1; }}
        />
      {/each}
    {/if}

    <!-- Running section -->
    {#if filteredRunning.length > 0}
      <div class="section-header px-3 pt-2 pb-1 flex items-center gap-1.5 min-w-0">
        <Header size={3} class="truncate">{m.layout_activeCard_running_header()}</Header>
        <span class="text-ui text-subtle shrink-0">{runningWorkspaces.length}</span>
      </div>
      {#each filteredRunning as { workspace, streamingIds }, _i (workspace.id)}
        <WorkspaceCard
          {workspace}
          variant="compact"
          isRunning={true}
          isPinned={$pinnedIds$.includes(workspace.id)}
          streamingAgentIds={streamingIds}
          highlighted={keyboardNavActive && highlightedIndex === (_visibleIdIndex.get(workspace.id) ?? -1)}
          suppressHover={keyboardNavActive}
          onClick={(e) => handleClick(workspace.id, e)}
          onTogglePin={(e) => handleTogglePin(e, workspace.id)}
          onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
          onHover={() => { hoveredIndex = _visibleIdIndex.get(workspace.id) ?? -1; }}
        />
      {/each}
    {/if}

    <!-- Waiting section -->
    {#if filteredWaiting.length > 0}
      <div class="section-header px-3 pt-2 pb-1 flex items-center gap-1.5 min-w-0">
        <Header size={3} class="truncate">{m.layout_activeCard_waiting_header()}</Header>
        <span class="text-ui text-subtle shrink-0">{waitingWorkspaces.length}</span>
      </div>
      {#each filteredWaiting as { workspace }, _i (workspace.id)}
        <WorkspaceCard
          {workspace}
          variant="compact"
          isPinned={$pinnedIds$.includes(workspace.id)}
          highlighted={keyboardNavActive && highlightedIndex === (_visibleIdIndex.get(workspace.id) ?? -1)}
          suppressHover={keyboardNavActive}
          onClick={(e) => handleClick(workspace.id, e)}
          onTogglePin={(e) => handleTogglePin(e, workspace.id)}
          onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
          onHover={() => { hoveredIndex = _visibleIdIndex.get(workspace.id) ?? -1; }}
        />
      {/each}
    {/if}

    <!-- Pinned section -->
    {#if filteredPinned.length > 0}
      <div class="section-header px-3 pt-2 pb-1 flex items-center gap-1.5 min-w-0">
        <Header size={3} class="truncate">{m.layout_activeCard_pinned_header()}</Header>
      </div>
      {#each filteredPinned as { workspace }, _i (workspace.id)}
        <WorkspaceCard
          {workspace}
          variant="compact"
          isPinned={true}
          highlighted={keyboardNavActive && highlightedIndex === (_visibleIdIndex.get(workspace.id) ?? -1)}
          suppressHover={keyboardNavActive}
          onClick={(e) => handleClick(workspace.id, e)}
          onTogglePin={(e) => handleTogglePin(e, workspace.id)}
          onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
          onHover={() => { hoveredIndex = _visibleIdIndex.get(workspace.id) ?? -1; }}
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
