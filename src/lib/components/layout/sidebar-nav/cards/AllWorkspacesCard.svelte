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
  import Fa from 'svelte-fa';
  import { faBoxArchive, faChevronDown, faTrash } from '@fortawesome/free-solid-svg-icons';
  import * as Tooltip from '$lib/components/ui/tooltip';

  import {
    selectPinnedWorkspaceIds,
    selectAllSpacesViewMode,
    selectCollapsedStatusGroupIds,
    selectShowArchivedWorkspaces,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { markWorkspaceSeen } from '$features/workspace/mark-workspace-seen';

  import {
    togglePinWorkspace,
    toggleStatusGroupCollapsed,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    compareWorkspaceActivityDisplayTimeDesc,
    getWorkspaceActivityDisplayTime,
  } from '$shared/utils/workspace-activity-time';
  import { store as appStore } from '$store/renderer/store';
  import WorkspaceCard from '$lib/components/workspace/WorkspaceCard.svelte';
  import WorkspaceCardSkeleton from '../WorkspaceCardSkeleton.svelte';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { Button } from '$lib/components/ui/button';
  import {
    openBulkArchiveConfirm,
    openBulkDeleteConfirm,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';

  const REPOSITORY_WORKSPACE_LIMIT = 3;

  function getGitHubAvatarUrl(owner: string, size: number = 24): string {
    return `https://github.com/${owner}.png?size=${size}`;
  }

  const workspaceItems = selectWorkspaceItems();
  const hasLoaded$ = selectWorkspaceHasLoaded();
  const pinnedIds$ = selectPinnedWorkspaceIds();
  const viewMode$ = selectAllSpacesViewMode();
  const collapsedStatusGroupIds$ = selectCollapsedStatusGroupIds();
  const showArchivedWorkspaces$ = selectShowArchivedWorkspaces();

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
  let expandedRepositoryKeys = $state(new Set<string>());
  const searchInputClasses =
    'box-border w-full min-w-0 rounded-md border border-border bg-background/30 px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-0';
  const excludedWorkspaceIdSet = $derived(new Set(excludedWorkspaceIds));

  // Reset highlight when search query or view mode changes
  $effect(() => {
    void searchQuery;
    void $viewMode$;
    void recentsOnly;
    void $showArchivedWorkspaces$;
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

  const discoverableWorkspaces = $derived.by(() =>
    $workspaceItems.filter(
      (workspace) =>
        !excludedWorkspaceIdSet.has(workspace.id) &&
        workspace.status !== WorkspaceStatusEnum.Deleted,
    ),
  );

  const archivedWorkspaceCount = $derived(
    discoverableWorkspaces.filter((workspace) => workspace.status === WorkspaceStatusEnum.Archived)
      .length,
  );

  const allWorkspaces = $derived.by(() => {
    void $pinnedIds$;

    return discoverableWorkspaces
      .filter(
        (workspace) =>
          $showArchivedWorkspaces$ || workspace.status !== WorkspaceStatusEnum.Archived,
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

  const discoverableRepositoryKeys = $derived.by(
    () =>
      new Set(
        discoverableWorkspaces.map(
          (workspace) =>
            getGroupKey(workspace, sidebarRepoPathLookup, m.layout_allCard_noRepository_label())
              .key,
        ),
      ),
  );

  $effect(() => {
    const validKeys = discoverableRepositoryKeys;
    const retainedKeys = [...expandedRepositoryKeys].filter((key) => validKeys.has(key));
    if (retainedKeys.length !== expandedRepositoryKeys.size) {
      expandedRepositoryKeys = new Set(retainedKeys);
    }
  });

  const visibleGroupedByRepo = $derived.by(() => {
    const searchActive = searchQuery.trim().length > 0;
    return groupedByRepo.map(([key, group]) => {
      const isExpanded = expandedRepositoryKeys.has(key);
      return {
        key,
        group,
        isExpanded,
        visibleWorkspaces:
          searchActive || isExpanded
            ? group.workspaces
            : group.workspaces.slice(0, REPOSITORY_WORKSPACE_LIMIT),
      };
    });
  });

  const statusLabels: Record<WorkspaceDisplayStatus, () => string> = {
    failed: () => m.layout_allCard_statusFailed_label(),
    blocked: () => m.layout_allCard_statusBlocked_label(),
    needs_attention: () => m.layout_allCard_statusNeedsAttention_label(),
    idle: () => m.layout_allCard_statusIdle_label(),
    not_started: () => m.layout_allCard_statusNoChanges_label(),
    in_progress: () => m.layout_allCard_statusInProgress_label(),
    complete: () => m.layout_allCard_statusComplete_label(),
    pr_queued: () => m.layout_allCard_statusPrQueued_label(),
    pr_ready: () => m.layout_allCard_statusPrReady_label(),
    pr_open: () => m.layout_allCard_statusPrOpen_label(),
    pr_merged: () => m.layout_allCard_statusPrMerged_label(),
  };

  const statusOrder: WorkspaceDisplayStatus[] = [
    'failed',
    'blocked',
    'needs_attention',
    'not_started',
    'in_progress',
    'idle',
    'complete',
    'pr_open',
    'pr_ready',
    'pr_queued',
    'pr_merged',
  ];

  const groupedByStatus = $derived.by(() => {
    const groups = new Map<WorkspaceDisplayStatus, Workspace[]>();
    const archived: Workspace[] = [];
    for (const ws of filteredWorkspaces) {
      if (ws.status === WorkspaceStatusEnum.Archived) {
        archived.push(ws);
        continue;
      }
      const status = getDisplayStatus(ws);
      if (!groups.has(status)) groups.set(status, []);
      groups.get(status)!.push(ws);
    }
    const liveGroups = statusOrder
      .filter((s) => groups.has(s))
      .map((id) => ({ id, label: statusLabels[id](), workspaces: groups.get(id)! }));
    return archived.length > 0
      ? [
          ...liveGroups,
          { id: 'archived', label: m.layout_allCard_archived_label(), workspaces: archived },
        ]
      : liveGroups;
  });

  function toggleStatusGroup(groupId: string) {
    appStore.dispatch(toggleStatusGroupCollapsed(groupId));
  }

  function openGroupArchive(event: MouseEvent, workspaces: Workspace[], groupLabel: string) {
    event.stopPropagation();
    appStore.dispatch(
      openBulkArchiveConfirm({ workspaceIds: workspaces.map(({ id }) => id), groupLabel }),
    );
  }

  function openGroupDelete(event: MouseEvent, workspaces: Workspace[], groupLabel: string) {
    event.stopPropagation();
    appStore.dispatch(
      openBulkDeleteConfirm({ workspaceIds: workspaces.map(({ id }) => id), groupLabel }),
    );
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
    // Explicit mark-all gesture (`workspace.markSeen`, §5.1): the daemon marks
    // every top-level agent conversation seen and the resulting
    // `workspace:attention-changed` event clears the dot on all clients.
    markWorkspaceSeen(workspaceId);
  }

  function toggleRepositoryGroup(key: string) {
    const nextExpandedKeys = new Set(expandedRepositoryKeys);
    if (nextExpandedKeys.has(key)) nextExpandedKeys.delete(key);
    else nextExpandedKeys.add(key);
    expandedRepositoryKeys = nextExpandedKeys;
  }

  // Flat ordered list of workspace IDs matching the current view mode's display order
  const allVisibleIds = $derived.by(() => {
    if (recentsOnly) return visibleRecentWorkspaces.map((workspace) => workspace.id);
    if ($viewMode$ === 'repo') {
      return visibleGroupedByRepo.flatMap(({ visibleWorkspaces }) =>
        visibleWorkspaces.map((workspace) => workspace.id),
      );
    } else if ($viewMode$ === 'status') {
      return groupedByStatus.flatMap((group) =>
        $collapsedStatusGroupIds$.includes(group.id)
          ? []
          : group.workspaces.map((workspace) => workspace.id),
      );
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

{#snippet groupActions(workspaces: Workspace[], groupLabel: string)}
  <div
    class="ml-auto mr-0.5 flex shrink-0 items-center gap-0.5 rounded-md bg-accent/95 px-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100"
  >
    {#if workspaces.some((workspace) => workspace.status !== WorkspaceStatusEnum.Archived)}
      <Tooltip.Tooltip content={m.layout_allCard_groupArchiveAll_tooltip()}>
        <Button
          variant="plain"
          size="icon-xs"
          iconOnly
          class="text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:border-transparent focus-visible:bg-muted/50 focus-visible:text-foreground focus-visible:ring-0"
          aria-label={m.layout_allCard_groupArchiveAll_ariaLabel({ group: groupLabel })}
          data-group-archive-all
          onclick={(event) => openGroupArchive(event, workspaces, groupLabel)}
          onkeydown={(event) => event.stopPropagation()}
        >
          <Fa icon={faBoxArchive} size="xs" />
        </Button>
      </Tooltip.Tooltip>
    {/if}
    <Tooltip.Tooltip content={m.layout_allCard_groupDeleteAll_tooltip()}>
      <Button
        variant="plain"
        size="icon-xs"
        iconOnly
        class="text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:border-transparent focus-visible:bg-muted/50 focus-visible:text-foreground focus-visible:ring-0"
        aria-label={m.layout_allCard_groupDeleteAll_ariaLabel({ group: groupLabel })}
        data-group-delete-all
        onclick={(event) => openGroupDelete(event, workspaces, groupLabel)}
        onkeydown={(event) => event.stopPropagation()}
      >
        <Fa icon={faTrash} size="xs" />
      </Button>
    </Tooltip.Tooltip>
  </div>
{/snippet}

<div
  class="flex flex-col h-full outline-none focus-visible:bg-muted/10"
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
          class={searchInputClasses}
          data-workspace-search-input
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
    {#if $hasLoaded$ && expanded && searchVisible && (discoverableWorkspaces.length > 3 || archivedWorkspaceCount > 0)}
      <div class="min-w-0 overflow-visible px-2 pb-2 pt-0.5" data-workspace-search-controls>
        <input
          bind:this={searchInputEl}
          type="text"
          placeholder={m.layout_activeCard_search_placeholder()}
          bind:value={searchQuery}
          class={searchInputClasses}
          data-workspace-search-input
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
      <div class="px-2 pb-3 text-xs text-subtle">
        {archivedWorkspaceCount > 0 && !$showArchivedWorkspaces$
          ? m.layout_activeCard_noActive_label()
          : m.layout_allCard_noWorkspaces_label()}
      </div>
    {:else if filteredWorkspaces.length === 0}
      <div class="px-2 pb-3 text-xs text-subtle">{m.ui_dropdown_noResults_label()}</div>
    {:else}
      <div
        class="overflow-y-auto flex-1 min-h-0 pt-1 pb-2"
        data-workspace-list-scroll
        use:scrollFade
      >
        {#if $viewMode$ === 'recent'}
          {#each filteredWorkspaces as workspace, i (workspace.id)}
            {#if i > 0 && !$pinnedIds$.includes(workspace.id) && $pinnedIds$.includes(filteredWorkspaces[i - 1].id)}
              <div class="border-t border-border my-1 mx-2"></div>
            {/if}
            <WorkspaceCard
              {workspace}
              variant="compact"
              isUnread={_isUnread(workspace)}
              isPinned={$pinnedIds$.includes(workspace.id)}
              trailingLabel={workspace.status === WorkspaceStatusEnum.Archived
                ? m.lib_commandPalette_archivedWorkspace_pill()
                : undefined}
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
          {#each visibleGroupedByRepo as repositoryGroup (repositoryGroup.key)}
            <div data-repository-group data-repository-key={repositoryGroup.key}>
              <div
                class="section-header group flex items-center gap-1.5 px-2 pt-2 pb-1 mt-2 min-w-0"
              >
                {#if repositoryGroup.group.owner}
                  <img
                    src={getGitHubAvatarUrl(repositoryGroup.group.owner)}
                    alt={repositoryGroup.group.owner}
                    class="size-3.5 rounded-full shrink-0"
                    loading="lazy"
                    onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                  />
                {/if}
                <Header size={4} class="min-w-0 flex-1 truncate"
                  >{repositoryGroup.group.label}</Header
                >
                {@render groupActions(
                  repositoryGroup.group.workspaces,
                  repositoryGroup.group.label,
                )}
              </div>
              {#each repositoryGroup.visibleWorkspaces as workspace, _i (workspace.id)}
                <div data-repository-space-row data-workspace-id={workspace.id}>
                  <WorkspaceCard
                    {workspace}
                    variant="compact"
                    isUnread={_isUnread(workspace)}
                    isPinned={$pinnedIds$.includes(workspace.id)}
                    trailingLabel={workspace.status === WorkspaceStatusEnum.Archived
                      ? m.lib_commandPalette_archivedWorkspace_pill()
                      : undefined}
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
                </div>
              {/each}
              {#if !searchQuery.trim() && repositoryGroup.group.workspaces.length > REPOSITORY_WORKSPACE_LIMIT}
                <div class="min-w-0 px-2 pb-1">
                  <Button
                    variant="plain"
                    type="button"
                    class="repository-group-toggle type-caption -mx-1 h-auto min-h-7 w-fit max-w-full shrink appearance-none justify-start overflow-hidden border-0 bg-transparent px-1! py-1! text-left font-normal text-muted-foreground shadow-none hover:bg-transparent hover:text-muted-foreground active:bg-transparent focus-visible:bg-transparent focus-visible:text-foreground focus-visible:underline focus-visible:outline-none focus-visible:ring-0!"
                    aria-expanded={repositoryGroup.isExpanded}
                    data-repository-group-toggle
                    onclick={() => toggleRepositoryGroup(repositoryGroup.key)}
                    onkeydown={(event) => event.stopPropagation()}
                  >
                    <span class="truncate" data-repository-group-toggle-label>
                      {repositoryGroup.isExpanded
                        ? m.layout_allCard_showLess_label()
                        : m.layout_allCard_showMore_label()}
                    </span>
                  </Button>
                </div>
              {/if}
            </div>
          {/each}
        {:else if $viewMode$ === 'status'}
          {#each groupedByStatus as group (group.id)}
            {@const isExpanded = !$collapsedStatusGroupIds$.includes(group.id)}
            <div
              class="section-header group flex items-center px-2 pt-2 pb-1 mt-2 min-w-0"
              data-status-group={group.id}
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm text-left outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                aria-expanded={isExpanded}
                aria-controls={`status-group-${group.id}`}
                data-status-group-toggle={group.id}
                onclick={() => toggleStatusGroup(group.id)}
                onkeydown={(event) => event.stopPropagation()}
              >
                <Fa
                  icon={faChevronDown}
                  size="xs"
                  class="shrink-0 text-muted-foreground transition-transform {isExpanded
                    ? ''
                    : '-rotate-90'}"
                />
                <Header size={4} class="min-w-0 flex-1 truncate">{group.label}</Header>
              </button>
              {@render groupActions(group.workspaces, group.label)}
            </div>
            <div id={`status-group-${group.id}`} hidden={!isExpanded}>
              {#each group.workspaces as workspace, _i (workspace.id)}
                <WorkspaceCard
                  {workspace}
                  variant="compact"
                  isUnread={_isUnread(workspace)}
                  isPinned={$pinnedIds$.includes(workspace.id)}
                  trailingLabel={workspace.status === WorkspaceStatusEnum.Archived
                    ? m.lib_commandPalette_archivedWorkspace_pill()
                    : undefined}
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
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  @media (forced-colors: active) {
    :global(.repository-group-toggle:focus-visible) {
      color: Highlight;
    }
  }

  @container (max-width: 180px) {
    .section-header {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }
  }
</style>
