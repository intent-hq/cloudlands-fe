<script lang="ts">
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { selectUnreadAgentIdsByWorkspace } from '$store/renderer/slices/unread-tracking/unread-tracking-selectors';

  import {
  selectAgentIsResponding,
  selectAgentIsWaiting,
  selectAgentSession,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import {
  buildRepoPathLookup,
  getGroupKey,
} from './utils/workspace-grouping';
  import { onMount } from 'svelte';
  import { quintOut } from 'svelte/easing';
  import {
  scale,
  slide,
} from 'svelte/transition';
  import {
  compareWorkspaceActivityDisplayTimeDesc,
  getWorkspaceActivityDisplayTime,
} from '$shared/utils/workspace-activity-time';
  import WorkspaceTableCollapseButton from './WorkspaceTableCollapseButton.svelte';
  import WorkspaceTableGroupHeader from './WorkspaceTableGroupHeader.svelte';
  import WorkspaceTableOlderToggle from './WorkspaceTableOlderToggle.svelte';
  import WorkspaceTableRow from './WorkspaceTableRow.svelte';
  import { store as appStore } from '$store/renderer/store';

  // Safe non-deferred transition functions replacing crossfade.
  //
  // crossfade returns *deferred* transitions (functions), and Svelte's internal
  // facade for deferred transitions calls `a.reset()` on an animation object
  // that is assigned in a microtask. If called before the microtask runs
  // (during {#each} reconciliation), it crashes with:
  //   "Cannot read properties of undefined (reading 'reset')"
  //
  // By returning plain AnimationConfig objects, Svelte takes the non-deferred
  // code path which uses safe no-op handlers.

  function send(node: Element, _params: { key: any }) {
    return scale(node, { duration: 200, start: 0.95, easing: quintOut });
  }


  function receive(node: Element, _params: { key: any }) {
    return scale(node, { duration: 200, start: 0.95, easing: quintOut });
  }

  // Local agent display info with computed avatar state
  interface AgentDisplayInfo {
    id: string;
    state: AvatarState;
    specialist?: 'spec-writer' | 'implementor' | 'verifier' | null;
    isActive: boolean;
    isUnread: boolean;
  }

  export interface RepoInfo {
    repoPath?: string;
    isGithub: boolean;
    owner?: string;
    name?: string;
    defaultBranch?: string;
  }

  interface Props {
    workspaces: Workspace[];
    showArchived: boolean;
    groupByRepo: boolean;
    searchQuery: string;
    knownRepos?: { path: string; name: string; owner?: string }[];
    onOpen: (workspace: Workspace, event?: MouseEvent) => void;
    onDelete?: (workspace: Workspace) => void;
    onArchive?: (workspace: Workspace) => void;
    onUnarchive?: (workspace: Workspace) => void;
    onCreateForRepo?: (repo: RepoInfo) => void;
    onBulkArchive?: (repoKey: string) => void;
    onBulkDeleteArchived?: (repoKey: string) => void;
    onRemoveRepo?: (repoPath: string) => void;
  }

  let {
    workspaces,
    showArchived,
    groupByRepo,
    searchQuery,
    knownRepos = [],
    onOpen,
    onDelete,
    onArchive,
    onUnarchive,
    onCreateForRepo,
    onBulkArchive,
    onBulkDeleteArchived,
    onRemoveRepo,
  }: Props = $props();

  // Track streaming state for reactivity. Unread state comes from a Redux selector readable.
  let activeStreamsVersion = $state(0);
  const unreadAgentIdsByWorkspace$ = selectUnreadAgentIdsByWorkspace();

  onMount(() => {
    // Start polling for active streams (if not already started)
    activeStreamsTracker.startPolling();
    const unsubStreams = activeStreamsTracker.subscribe(() => {
      activeStreamsVersion++;
    });

    return () => {
      unsubStreams();
    };
  });

  // Get agent display info for a workspace from its member agent IDs
  // Only returns agents that are ACTIVE (streaming/busy) or have UNREAD messages
  function getWorkspaceAgentInfo(ws: Workspace): AgentDisplayInfo[] {
    // Reference version for reactivity
    void activeStreamsVersion;
    const memberAgentIds = ws.agentSummary?.agentIds ?? [];

    if (memberAgentIds.length === 0) {
      return [];
    }

    // Get unread agent IDs for this workspace
    const unreadAgentIds = new Set($unreadAgentIdsByWorkspace$[ws.id] ?? []);
    const reduxState = appStore.state;

    return memberAgentIds
      .map((agentId) => {
        const loadedSession = selectAgentSession.select(reduxState, agentId);
        const isWaiting = loadedSession
          ? selectAgentIsWaiting.select(reduxState, agentId)
          : false;
        const isResponding = loadedSession
          ? selectAgentIsResponding.select(reduxState, agentId)
          : activeStreamsTracker.isAgentStreaming(agentId);
        const isUnread = unreadAgentIds.has(agentId);
        const sessionStatus = loadedSession?.status as string | undefined;

        // Determine avatar state using canonical selectors when the session is
        // loaded; otherwise fall back to streaming-tracker data only.
        let state: AvatarState = 'idle';
        if (sessionStatus === 'error' || sessionStatus === 'failed') {
          state = 'failed';
        } else if (isWaiting) {
          state = 'waiting';
        } else if (isResponding) {
          state = 'running';
        }

        return {
          id: agentId,
          state,
          specialist: (loadedSession?.metadata?.specialist ?? null) as AgentDisplayInfo['specialist'],
          isActive: isResponding && !isWaiting,
          isUnread,
        };
      })
      .filter((agent) => agent.isActive || agent.isUnread); // Only show active or unread agents
  }

  // Track collapsed groups
  let collapsedGroups = $state<Set<string>>(new Set());

  function toggleGroup(key: string) {
    if (collapsedGroups.has(key)) {
      collapsedGroups = new Set([...collapsedGroups].filter((k) => k !== key));
    } else {
      collapsedGroups = new Set([...collapsedGroups, key]);
    }
  }

  // Track which groups have their "older" bucket expanded. Collapsed by default.
  let expandedOlderGroups = $state<Set<string>>(new Set());

  function toggleOlder(key: string) {
    if (expandedOlderGroups.has(key)) {
      expandedOlderGroups = new Set([...expandedOlderGroups].filter((k) => k !== key));
    } else {
      expandedOlderGroups = new Set([...expandedOlderGroups, key]);
    }
  }

  const RECENT_CAP = 10;

  // Split a group's workspaces into recent (first N non-archived) and older
  // buckets. Archived workspaces are always classified as older regardless of
  // position. When searching, the split is bypassed so every match renders in
  // a single list.
  function partitionByRecency(list: Workspace[]): { recent: Workspace[]; older: Workspace[] } {
    if (searchQuery) {
      return { recent: list, older: [] };
    }
    const recent: Workspace[] = [];
    const older: Workspace[] = [];
    for (const ws of list) {
      if (ws.status === WorkspaceStatusEnum.Archived) {
        older.push(ws);
        continue;
      }
      if (recent.length < RECENT_CAP) {
        recent.push(ws);
      } else {
        older.push(ws);
      }
    }
    return { recent, older };
  }

  // Filter workspaces
  let filteredWorkspaces = $derived.by(() => {
    return workspaces.filter((ws) => {
      if (ws.status === WorkspaceStatusEnum.Deleted) return false;
      if (!showArchived && ws.status === WorkspaceStatusEnum.Archived) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const title = ws.title?.toLowerCase() || '';
        const repo = ws.repositoryName?.toLowerCase() || '';
        const owner = ws.repositoryOwner?.toLowerCase() || '';
        if (!title.includes(q) && !repo.includes(q) && !owner.includes(q)) return false;
      }
      return true;
    });
  });

  // Build a lookup from repositoryPath → {owner, name} so workspaces missing
  // owner/name can be merged into the correct group instead of creating duplicates.
  // Only use active workspaces to avoid stale metadata from archived/deleted workspaces
  // polluting the lookup (e.g. a reused path mapping to the wrong group).
  const repoPathToGithubInfo = $derived.by(() => {
    const active = workspaces.filter(
      (w) => w.status !== WorkspaceStatusEnum.Archived && w.status !== WorkspaceStatusEnum.Deleted,
    );
    return buildRepoPathLookup(active, knownRepos);
  });

  // Group workspaces by repository
  type GroupedWorkspaces = {
    key: string;
    label: string;
    isGithub: boolean;
    owner?: string;
    repoPath?: string;
    workspaces: Workspace[];
  }[];

  // Get the most recent activity timestamp for a group
  function getGroupMostRecentActivity(workspaces: Workspace[]): number {
    if (workspaces.length === 0) return 0;
    return Math.max(...workspaces.map(getWorkspaceActivityDisplayTime));
  }

  // Masonry layout configuration
  let clientWidth = $state(0);
  const MIN_COLUMN_WIDTH = 380; // Adjusted threshold for 2-column layout
  const GAP = 36; // match row/header/vertical gap height

  // Calculate number of columns based on container width, but never more than the number of groups
  const columnCount = $derived.by(() => {
    const maxByWidth = Math.max(1, Math.floor((clientWidth + GAP) / (MIN_COLUMN_WIDTH + GAP)));
    // Don't have more columns than groups (repos)
    const groupCount = groupedWorkspaces.length;
    return groupCount > 0 ? Math.min(maxByWidth, groupCount) : maxByWidth;
  });

  let groupedWorkspaces = $derived.by((): GroupedWorkspaces => {
    const sorted = [...filteredWorkspaces].sort(compareWorkspaceActivityDisplayTimeDesc);

    if (!groupByRepo) {
      return [
        {
          key: 'all',
          label: 'All Spaces',
          isGithub: false,
          workspaces: sorted,
        },
      ];
    }

    const groups: Record<
      string,
      {
        workspaces: Workspace[];
        label: string;
        isGithub: boolean;
        owner?: string;
        repoPath?: string;
      }
    > = {};

    // Seed groups from known repos so they appear even with 0 workspaces
    // Skip seeding when searching — only show groups that have matching workspaces
    if (!searchQuery) {
      for (const repo of knownRepos) {
        const isGithub = !!repo.owner;
        const key = isGithub ? `${repo.owner}/${repo.name}` : repo.path;
        const label = isGithub ? `${repo.owner}/${repo.name}` : repo.name;
        if (!groups[key]) {
          groups[key] = { workspaces: [], label, isGithub, owner: repo.owner, repoPath: repo.path };
        }
      }
    }

    sorted.forEach((ws) => {
      const { key, label, isGithub, owner } = getGroupKey(ws, repoPathToGithubInfo);
      if (!groups[key]) {
        groups[key] = { workspaces: [], label, isGithub, owner, repoPath: ws.repositoryPath };
      }
      groups[key].workspaces.push(ws);
    });

    // Convert to array and sort groups by most recent activity (descending)
    // Groups with workspaces sort by activity; empty groups sort to the end
    return Object.entries(groups)
      .map(([key, value]) => ({
        key,
        label: value.label,
        isGithub: value.isGithub,
        owner: value.owner,
        repoPath: value.repoPath,
        workspaces: value.workspaces,
      }))
      .sort(
        (a, b) =>
          getGroupMostRecentActivity(b.workspaces) - getGroupMostRecentActivity(a.workspaces),
      );
  });

  // Height constants for masonry calculations (all same height for visual consistency)
  const HEADER_HEIGHT = 40;
  const ROW_HEIGHT = 40;
  const TABLE_GAP = 40;
  // Calculate height of a group table
  function getGroupHeight(group: GroupedWorkspaces[number], isCollapsed: boolean): number {
    if (isCollapsed) return HEADER_HEIGHT;
    let visibleRows: number;
    if (searchQuery) {
      visibleRows = group.workspaces.length;
    } else {
      const split = partitionByRecency(group.workspaces);
      visibleRows =
        split.older.length > 2
          ? split.recent.length + 1 // +1 for the "Show N older workspaces" toggle row
          : split.recent.length + split.older.length;
    }
    return HEADER_HEIGHT + visibleRows * ROW_HEIGHT;
  }

  // Create a layout key that changes ONLY when view settings change
  // NOT when workspaces are added/deleted/archived
  const layoutKey = $derived(`${searchQuery}|${groupByRepo}|${showArchived}|${columnCount}`);

  // Cache the masonry column assignments, only recalculate when layoutKey changes
  let cachedMasonryColumns = $state<string[][]>([]); // 2D: columns of group keys
  let lastLayoutKey = $state('');

  $effect(() => {
    // Only recalculate if layout key changed (not just workspace content)
    if (layoutKey === lastLayoutKey) return;
    lastLayoutKey = layoutKey;

    const groups = groupedWorkspaces;
    const cols = columnCount;

    if (cols <= 1 || groups.length <= 1) {
      cachedMasonryColumns = [groups.map((g) => g.key)];
      return;
    }

    // Track which column each group goes into and column heights
    const columnHeights: number[] = new Array(cols).fill(0);
    const columnKeys: string[][] = Array.from({ length: cols }, () => []);

    // Place each group (already sorted by recency) into the shortest column
    // Use expanded height for all groups (don't factor in collapsed state)
    for (const group of groups) {
      const height = getGroupHeight(group, false) + TABLE_GAP;

      // Find the shortest column
      let shortestCol = 0;
      for (let c = 1; c < cols; c++) {
        if (columnHeights[c] < columnHeights[shortestCol]) {
          shortestCol = c;
        }
      }

      columnKeys[shortestCol].push(group.key);
      columnHeights[shortestCol] += height;
    }

    cachedMasonryColumns = columnKeys;
  });

  // Use cached column assignments but with updated workspace data
  // This keeps groups in their assigned columns but reflects deleted/archived workspaces
  const masonryOrderedColumns = $derived.by((): GroupedWorkspaces[] => {
    // Build a map of current groups for quick lookup
    const currentGroupsMap = new Map(groupedWorkspaces.map((g) => [g.key, g]));

    // Build columns from cache, resolving keys to current group data
    const columns: GroupedWorkspaces[] = cachedMasonryColumns.map((columnKeys) => {
      const activeGroups: GroupedWorkspaces = [];
      const emptyGroups: GroupedWorkspaces = [];
      for (const key of columnKeys) {
        const g = currentGroupsMap.get(key);
        if (g && (g.workspaces.length > 0 || !!g.repoPath)) {
          if (g.workspaces.length > 0) {
            activeGroups.push(g);
          } else {
            emptyGroups.push(g);
          }
        }
      }
      // Active groups first, empty groups last within each column
      return [...activeGroups, ...emptyGroups];
    });

    // Find new groups not in any cached column and place in shortest column
    const allCachedKeys = new Set(cachedMasonryColumns.flat());
    for (const group of groupedWorkspaces) {
      if (!allCachedKeys.has(group.key) && (group.workspaces.length > 0 || group.repoPath)) {
        if (columns.length === 0) {
          columns.push([group]);
        } else {
          let shortestIdx = 0;
          let shortestHeight = Infinity;
          for (let i = 0; i < columns.length; i++) {
            const height = columns[i].reduce(
              (sum, g) => sum + getGroupHeight(g, false) + TABLE_GAP,
              0,
            );
            if (height < shortestHeight) {
              shortestHeight = height;
              shortestIdx = i;
            }
          }
          columns[shortestIdx].push(group);
        }
      }
    }

    return columns;
  });

  function handleCreateForRepo(group: GroupedWorkspaces[number]) {
    if (!onCreateForRepo) return;

    // Get repo info from the first workspace in the group, or from the group itself (known repos)
    const firstWs = group.workspaces[0];
    // When the group was resolved via lookup, group.label is "owner/name".
    // Extract just the repo name to avoid producing invalid GitHub URLs.
    const fallbackName = group.isGithub ? group.label.split('/').pop() || group.label : group.label;
    const repoInfo: RepoInfo = {
      repoPath: firstWs?.repositoryPath || group.repoPath,
      isGithub: group.isGithub,
      owner: group.owner,
      name: firstWs?.repositoryName || fallbackName,
    };

    onCreateForRepo(repoInfo);
  }


</script>

<!-- When grouped by repo, use explicit flexbox columns for masonry layout -->
{#if groupByRepo}
  <div class="flex min-w-0 gap-9" bind:clientWidth>
    {#if filteredWorkspaces.length === 0 && masonryOrderedColumns.flat().length === 0}
      <div
        class="w-full pt-8 text-center text-subtle text-sm"
        transition:slide={{ axis: 'y', duration: 150 }}
      >
        {#if searchQuery}
          <p>No spaces match "{searchQuery}"</p>
        {:else}
          <p>No active spaces</p>
        {/if}
      </div>
    {:else}
      {#each masonryOrderedColumns as column}
        <div class="flex-1 min-w-0 flex flex-col gap-10">
          {#each column as group (group.key)}
            {@const isCollapsed = collapsedGroups.has(group.key)}
            <div
              class="min-w-0 bg-background border border-border shadow-xs rounded-xl overflow-hidden"
              in:receive={{ key: group.key }}
              out:send={{ key: group.key }}
            >
              <!-- Group Header -->
              <WorkspaceTableGroupHeader
                label={group.label}
                isGithub={group.isGithub}
                owner={group.owner}
                {isCollapsed}
                onToggle={() => toggleGroup(group.key)}
                onNew={() => handleCreateForRepo(group)}
                onBulkArchive={group.workspaces.length > 5 ? () => onBulkArchive?.(group.key) : undefined}
                onBulkDeleteArchived={group.workspaces.length > 5 ? () => onBulkDeleteArchived?.(group.key) : undefined}
              />

              <!-- Group Items -->
              {#if !isCollapsed}
                <div class="overflow-hidden" transition:slide={{ axis: 'y', duration: 150 }}>
                  {#if group.workspaces.length === 0}
                    <div class="px-3 py-3 text-xs text-subtle text-center">
                      No active spaces.{#if onRemoveRepo && group.repoPath && !workspaces.some((ws) => ws.repositoryPath === group.repoPath || (ws.repositoryOwner && ws.repositoryName && `${ws.repositoryOwner}/${ws.repositoryName}` === group.key))}
                        {' '}<button
                          class="text-muted-foreground/70 hover:text-destructive underline cursor-pointer"
                          onclick={() => onRemoveRepo?.(group.repoPath!)}
                        >Remove</button>.
                      {/if}
                    </div>
                  {:else}
                    {@const split = partitionByRecency(group.workspaces)}
                    {@const showToggle = split.older.length > 2}
                    {@const recentRows = showToggle
                      ? split.recent
                      : [...split.recent, ...split.older]}
                    {@const olderRows = showToggle ? split.older : []}
                    {@const isOlderExpanded = expandedOlderGroups.has(group.key)}
                    {#each recentRows as ws, wsIndex (ws.id)}
                      <div transition:slide={{ axis: 'y', duration: 150 }}>
                        <WorkspaceTableRow
                          workspace={ws}
                          agents={getWorkspaceAgentInfo(ws)}
                          isLastInGroup={wsIndex === recentRows.length - 1 && !showToggle}
                          groupByRepo={true}
                          {onOpen}
                          {onDelete}
                          {onArchive}
                          {onUnarchive}
                        />
                      </div>
                    {/each}
                    {#if showToggle}
                      {#if isOlderExpanded}
                        <div
                          class="overflow-hidden"
                          transition:slide={{ axis: 'y', duration: 150 }}
                        >
                          {#each olderRows as ws (ws.id)}
                            <div transition:slide={{ axis: 'y', duration: 150 }}>
                              <WorkspaceTableRow
                                workspace={ws}
                                agents={getWorkspaceAgentInfo(ws)}
                                isLastInGroup={false}
                                groupByRepo={true}
                                {onOpen}
                                {onDelete}
                                {onArchive}
                                {onUnarchive}
                              />
                            </div>
                          {/each}
                          <WorkspaceTableCollapseButton
                            onCollapse={() => toggleOlder(group.key)}
                          />
                        </div>
                      {:else}
                        <WorkspaceTableOlderToggle
                          count={olderRows.length}
                          onToggle={() => toggleOlder(group.key)}
                        />
                      {/if}
                    {/if}
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
{:else}
  <!-- Not grouped by repo - single container -->
  <div class="w-full bg-background border border-border shadow-xs rounded-xl">
    {#each groupedWorkspaces as group (group.key)}
      {@const isCollapsed = collapsedGroups.has(group.key)}

      <!-- Group Items -->
      {#if !isCollapsed}
        {@const split = partitionByRecency(group.workspaces)}
        {@const showToggle = split.older.length > 2}
        {@const recentRows = showToggle
          ? split.recent
          : [...split.recent, ...split.older]}
        {@const olderRows = showToggle ? split.older : []}
        {@const isOlderExpanded = expandedOlderGroups.has(group.key)}
        <div class="overflow-hidden" transition:slide={{ axis: 'y', duration: 150 }}>
          {#each recentRows as ws, wsIndex (ws.id)}
            <div transition:slide={{ axis: 'y', duration: 150 }}>
              <WorkspaceTableRow
                workspace={ws}
                agents={getWorkspaceAgentInfo(ws)}
                isLastInGroup={wsIndex === recentRows.length - 1 && !showToggle}
                showRepoAvatar={!!ws.repositoryOwner}
                groupByRepo={false}
                {onOpen}
                {onDelete}
                {onArchive}
                {onUnarchive}
              />
            </div>
          {/each}
          {#if showToggle}
            {#if isOlderExpanded}
              <div class="overflow-hidden" transition:slide={{ axis: 'y', duration: 150 }}>
                {#each olderRows as ws (ws.id)}
                  <div transition:slide={{ axis: 'y', duration: 150 }}>
                    <WorkspaceTableRow
                      workspace={ws}
                      agents={getWorkspaceAgentInfo(ws)}
                      isLastInGroup={false}
                      showRepoAvatar={!!ws.repositoryOwner}
                      groupByRepo={false}
                      {onOpen}
                      {onDelete}
                      {onArchive}
                      {onUnarchive}
                    />
                  </div>
                {/each}
                <WorkspaceTableCollapseButton
                  onCollapse={() => toggleOlder(group.key)}
                />
              </div>
            {:else}
              <WorkspaceTableOlderToggle
                count={olderRows.length}
                onToggle={() => toggleOlder(group.key)}
              />
            {/if}
          {/if}
        </div>
      {/if}
    {/each}

    {#if filteredWorkspaces.length === 0}
      <div class="py-16 text-center text-subtle">
        {#if searchQuery}
          <p class="text-[13px]">No spaces match "{searchQuery}"</p>
        {:else}
          <p class="text-[13px]">No active spaces</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}
