<script lang="ts">
  import { goto } from '$app/navigation';
  import { scrollFade } from '$lib/actions/scroll-fade';
  import { m } from '$shared/paraglide/messages.js';
  import { openWorkspaceInNewWindow } from '../utils/openWorkspaceInNewWindow';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import {
    selectWorkspaceItems,
    selectWorkspaceHasLoaded,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { WorkspaceStatusEnum, isWorkspaceDisplayStatus } from '$shared/types';
  import type { Workspace, WorkspaceDisplayStatus } from '$shared/types';
  import {
    buildRepoPathLookup,
    getGroupKey,
  } from '$lib/components/workspace/utils/workspace-grouping';
  import { onMount } from 'svelte';
  import Header from '$lib/components/ui/Header.svelte';

  import {
    selectPinnedWorkspaceIds,
    selectAllSpacesViewMode,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { markWorkspaceSeen } from '$features/workspace/mark-workspace-seen';

  import { togglePinWorkspace } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    compareWorkspaceActivityDisplayTimeDesc,
    getWorkspaceActivityDisplayTime,
  } from '$shared/utils/workspace-activity-time';
  import { store as appStore } from '$store/renderer/store';
  import WorkspaceCard from '$lib/components/workspace/WorkspaceCard.svelte';
  import WorkspaceCardSkeleton from '../WorkspaceCardSkeleton.svelte';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { Button } from '$lib/components/ui/button';

  function getGitHubAvatarUrl(owner: string, size: number = 24): string {
    return `https://github.com/${owner}.png?size=${size}`;
  }

  const workspaceItems = selectWorkspaceItems();
  const hasLoaded$ = selectWorkspaceHasLoaded();
  const pinnedIds$ = selectPinnedWorkspaceIds();
  const viewMode$ = selectAllSpacesViewMode();

  interface Props {
    expanded?: boolean;
    /** Whether the search input is shown (the host may hide it behind a toggle). */
    searchVisible?: boolean;
    /** Plain, activity-ordered rows for the compact hover dropdown. */
    recentsOnly?: boolean;
    /** Number of recent rows shown before expansion. */
    recentLimit?: number;
    /** Whether compact recents can search across every active workspace. */
    searchRecents?: boolean;
    /** Whether compact recents render a show-more/show-less toggle. */
    expandableRecents?: boolean;
    /** Workspace IDs omitted from default, expanded, and searched results. */
    excludedWorkspaceIds?: readonly string[];
    /** Whether compact recents announce loading with visible text. */
    showLoadingText?: boolean;
  }

  let {
    expanded = false,
    searchVisible = true,
    recentsOnly = false,
    recentLimit = 10,
    searchRecents = false,
    expandableRecents = false,
    excludedWorkspaceIds = [],
    showLoadingText = true,
  }: Props = $props();

  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let highlightedIndex = $state(-1);
  let showAllRecents = $state(false);
  const excludedWorkspaceIdSet = $derived(new Set(excludedWorkspaceIds));

  // Reset highlight when search query or view mode changes
  $effect(() => {
    void searchQuery;
    void $viewMode$;
    void recentsOnly;
    highlightedIndex = allVisibleIds.length > 0 ? 0 : -1;
  });

  // Auto-focus search when shown; clear any stale filter when hidden so the
  // list isn't invisibly filtered.
  $effect(() => {
    if (expanded && searchVisible && searchInputEl) {
      searchInputEl.focus();
    } else if (!searchVisible) {
      searchQuery = '';
    }
  });

  // Direct tracker subscription for reactivity (no Redux bridge): bump a
  // local version counter when the tracker notifies so deriveds recompute.
  let activeStreamsVersion = $state(0);

  // Fetch fresh stream state when the card mounts so data is up-to-date
  onMount(() => {
    activeStreamsTracker.startPolling();
    activeStreamsTracker.fetchActiveStreams();
    return activeStreamsTracker.subscribe(() => activeStreamsVersion++);
  });

  const recentWorkspaces = $derived.by(() =>
    $workspaceItems
      .filter(
        (workspace) =>
          !excludedWorkspaceIdSet.has(workspace.id) &&
          workspace.status !== WorkspaceStatusEnum.Archived &&
          workspace.status !== WorkspaceStatusEnum.Deleted,
      )
      .sort(compareWorkspaceActivityDisplayTimeDesc),
  );

  const filteredRecentWorkspaces = $derived.by(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return recentWorkspaces;
    return recentWorkspaces.filter(
      (workspace) =>
        (workspace.title || '').toLowerCase().includes(query) ||
        (workspace.repositoryName || '').toLowerCase().includes(query),
    );
  });

  const visibleRecentWorkspaces = $derived.by(() => {
    if (searchQuery.trim() || showAllRecents) return filteredRecentWorkspaces;
    return filteredRecentWorkspaces.slice(0, recentLimit);
  });

  const allWorkspaces = $derived.by(() => {
    void $pinnedIds$;

    return $workspaceItems
      .filter(
        (w) =>
          !excludedWorkspaceIdSet.has(w.id) &&
          w.status !== WorkspaceStatusEnum.Archived &&
          w.status !== WorkspaceStatusEnum.Deleted,
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
    // render it verbatim. The daemon owns the whole derivation — the agent-running
    // promotion to in_progress and the not-running demotion to idle included — and
    // the lite workspace.subscribe snapshot always carries the field
    // (intent-hq/intentd#743), so there is no local derivation or override.
    // Unknown wire values (a future daemon's new value) default to
    // 'not_started' so the workspace never vanishes from the grouped view.
    return isWorkspaceDisplayStatus(ws.displayStatus) ? ws.displayStatus : 'not_started';
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
      const { key, label, owner } = getGroupKey(
        ws,
        sidebarRepoPathLookup,
        m.layout_allCard_noRepository_label(),
      );

      if (!groups.has(key)) groups.set(key, { workspaces: [], owner, label });
      groups.get(key)!.workspaces.push(ws);
    }
    return [...groups.entries()].sort((a, b) => {
      const aTime = getWorkspaceActivityDisplayTime(a[1].workspaces[0]);
      const bTime = getWorkspaceActivityDisplayTime(b[1].workspaces[0]);
      return bTime - aTime;
    });
  });

  const statusLabels: Record<WorkspaceDisplayStatus, () => string> = {
    failed: () => m.layout_allCard_statusFailed_label(),
    blocked: () => m.layout_allCard_statusBlocked_label(),
    needs_attention: () => m.layout_allCard_statusNeedsAttention_label(),
    idle: () => m.layout_allCard_statusIdle_label(),
    not_started: () => m.layout_allCard_statusNoChanges_label(),
    in_progress: () => m.layout_allCard_statusInProgress_label(),
    unread: () => m.layout_allCard_statusUnread_label(),
    complete: () => m.layout_allCard_statusComplete_label(),
    pr_ready: () => m.layout_allCard_statusPrReady_label(),
    pr_open: () => m.layout_allCard_statusPrOpen_label(),
    pr_merged: () => m.layout_allCard_statusPrMerged_label(),
  };

  const statusOrder: WorkspaceDisplayStatus[] = [
    'failed',
    'blocked',
    'needs_attention',
    'idle',
    'in_progress',
    'unread',
    'pr_ready',
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
      .map((s) => [statusLabels[s](), groups.get(s)!] as [string, Workspace[]]);
  });

  function _isRunning(ws: Workspace): boolean {
    // Streaming-based UI affordance only (the running dot on the card); the
    // status grouping above renders the BE displayStatus verbatim and is never
    // influenced by this signal.
    void activeStreamsVersion;
    const streamingAgentIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
    return ws.activity === 'agent_running' || streamingAgentIds.length > 0;
  }

  function _getStreamingIds(ws: Workspace): string[] {
    void activeStreamsVersion;
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
  }

  function _isUnread(ws: Workspace): boolean {
    void activeStreamsVersion;
    const streamingIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
    if (streamingIds.length > 0) return false;
    return ws.attention === 'unread';
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
    appStore.dispatch(openWorkspaceTab(workspaceId));
    await goto(route);
  }

  function handleTogglePin(e: MouseEvent, workspaceId: string) {
    e.stopPropagation();
    appStore.dispatch(togglePinWorkspace(workspaceId));
  }

  function handleMarkAsRead(e: MouseEvent, workspaceId: string) {
    e.stopPropagation();
    // Daemon round-trip (`workspace.markSeen`, §5.1): the resulting
    // `workspace:attention-changed` event clears the dot on all clients.
    markWorkspaceSeen(workspaceId);
  }

  // Flat ordered list of workspace IDs matching the current view mode's display order
  const allVisibleIds = $derived.by(() => {
    if (recentsOnly) return visibleRecentWorkspaces.map((workspace) => workspace.id);
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
  {#if recentsOnly}
    {#if $hasLoaded$ && searchRecents && searchVisible && recentWorkspaces.length > recentLimit}
      <div class="px-2 pb-2">
        <input
          bind:this={searchInputEl}
          type="text"
          placeholder={m.layout_activeCard_search_placeholder()}
          bind:value={searchQuery}
          class="w-full rounded-md bg-background/30 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
        />
      </div>
    {/if}

    {#if !$hasLoaded$}
      {#if showLoadingText}
        <div class="px-3 py-3 text-sm text-subtle">{m.ui_spinner_loading_ariaLabel()}</div>
      {/if}
    {:else if recentWorkspaces.length === 0}
      <div class="px-3 py-3 text-sm text-subtle">{m.layout_allCard_noWorkspaces_label()}</div>
    {:else if visibleRecentWorkspaces.length === 0}
      <div class="px-3 py-3 text-sm text-subtle">{m.ui_dropdown_noResults_label()}</div>
    {:else}
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        {#each visibleRecentWorkspaces as workspace, index (workspace.id)}
          <div data-recent-space-row data-workspace-id={workspace.id}>
            <WorkspaceCard
              {workspace}
              variant="compact"
              isRunning={_isRunning(workspace)}
              isUnread={_isUnread(workspace)}
              isPinned={$pinnedIds$.includes(workspace.id)}
              streamingAgentIds={_getStreamingIds(workspace)}
              highlighted={keyboardNavActive && highlightedIndex === index}
              suppressHover={keyboardNavActive}
              onClick={(event) => handleClick(workspace.id, event)}
              onTogglePin={(event) => handleTogglePin(event, workspace.id)}
              onMarkAsRead={_isUnread(workspace)
                ? (event) => handleMarkAsRead(event, workspace.id)
                : undefined}
              onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
              onHover={() => {
                hoveredIndex = index;
              }}
            />
          </div>
        {/each}
      </div>
    {/if}

    {#if expandableRecents && !searchQuery.trim() && recentWorkspaces.length > recentLimit}
      <div class="px-2 pb-2">
        <Button
          variant="ghost-light"
          size="xs"
          class="w-full"
          aria-expanded={showAllRecents}
          data-recent-spaces-toggle
          onclick={() => (showAllRecents = !showAllRecents)}
        >
          {showAllRecents ? m.layout_allCard_showLess_label() : m.layout_allCard_showMore_label()}
        </Button>
      </div>
    {/if}
  {:else}
    {#if $hasLoaded$ && expanded && searchVisible && allWorkspaces.length > 3}
      <div class="px-2 pb-2">
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
        {#each Array(5) as _, index (index)}
          <WorkspaceCardSkeleton {index} />
        {/each}
      </div>
    {:else if allWorkspaces.length === 0}
      <div class="px-2 pb-3 text-xs text-subtle">{m.layout_allCard_noWorkspaces_label()}</div>
    {:else}
      <div class="overflow-y-auto flex-1 min-h-0 pb-2" use:scrollFade>
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
              highlighted={keyboardNavActive &&
                highlightedIndex === (_visibleIdIndex.get(workspace.id) ?? -1)}
              suppressHover={keyboardNavActive}
              onClick={(e) => handleClick(workspace.id, e)}
              onTogglePin={(e) => handleTogglePin(e, workspace.id)}
              onMarkAsRead={_isUnread(workspace)
                ? (e) => handleMarkAsRead(e, workspace.id)
                : undefined}
              onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
              onHover={() => {
                hoveredIndex = _visibleIdIndex.get(workspace.id) ?? -1;
              }}
            />
          {/each}
        {:else if $viewMode$ === 'repo'}
          {#each groupedByRepo as [, group]}
            <div class="section-header flex items-center gap-1.5 px-2 pt-2 pb-1 mt-2 min-w-0">
              {#if group.owner}
                <img
                  src={getGitHubAvatarUrl(group.owner)}
                  alt={group.owner}
                  class="size-3.5 rounded-full shrink-0"
                  loading="lazy"
                  onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                />
              {/if}
              <Header size={4} class="truncate">{group.label}</Header>
            </div>
            {#each group.workspaces as workspace, _i (workspace.id)}
              <WorkspaceCard
                {workspace}
                variant="compact"
                isRunning={_isRunning(workspace)}
                isUnread={_isUnread(workspace)}
                isPinned={$pinnedIds$.includes(workspace.id)}
                streamingAgentIds={_getStreamingIds(workspace)}
                highlighted={keyboardNavActive &&
                  highlightedIndex === (_visibleIdIndex.get(workspace.id) ?? -1)}
                suppressHover={keyboardNavActive}
                onClick={(e) => handleClick(workspace.id, e)}
                onTogglePin={(e) => handleTogglePin(e, workspace.id)}
                onMarkAsRead={_isUnread(workspace)
                  ? (e) => handleMarkAsRead(e, workspace.id)
                  : undefined}
                onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
                onHover={() => {
                  hoveredIndex = _visibleIdIndex.get(workspace.id) ?? -1;
                }}
              />
            {/each}
          {/each}
        {:else if $viewMode$ === 'status'}
          {#each groupedByStatus as [statusLabel, workspaces]}
            <div class="section-header px-2 pt-2 pb-1 mt-2 min-w-0">
              <Header size={4} class="truncate">{statusLabel}</Header>
            </div>
            {#each workspaces as workspace, _i (workspace.id)}
              <WorkspaceCard
                {workspace}
                variant="compact"
                isRunning={_isRunning(workspace)}
                isUnread={_isUnread(workspace)}
                isPinned={$pinnedIds$.includes(workspace.id)}
                streamingAgentIds={_getStreamingIds(workspace)}
                highlighted={keyboardNavActive &&
                  highlightedIndex === (_visibleIdIndex.get(workspace.id) ?? -1)}
                suppressHover={keyboardNavActive}
                onClick={(e) => handleClick(workspace.id, e)}
                onTogglePin={(e) => handleTogglePin(e, workspace.id)}
                onMarkAsRead={_isUnread(workspace)
                  ? (e) => handleMarkAsRead(e, workspace.id)
                  : undefined}
                onOpenInNewWindow={() => openWorkspaceInNewWindow(workspace.id)}
                onHover={() => {
                  hoveredIndex = _visibleIdIndex.get(workspace.id) ?? -1;
                }}
              />
            {/each}
          {/each}
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  @container (max-width: 180px) {
    .section-header {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }
  }
</style>
