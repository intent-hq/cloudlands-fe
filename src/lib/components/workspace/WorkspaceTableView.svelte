<script lang="ts">
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { pendingAgentsStore } from '$features/agent/services/pending-agents.store.svelte';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { onMount } from 'svelte';
  import { quintOut } from 'svelte/easing';
  import { crossfade, slide } from 'svelte/transition';
  import WorkspaceTableGroupHeader from './WorkspaceTableGroupHeader.svelte';
  import WorkspaceTableRow from './WorkspaceTableRow.svelte';

  // Crossfade for workspace rows moving between groups
  const [send, receive] = crossfade({
    duration: 300,
    easing: quintOut,
  });

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
  }: Props = $props();

  // Track streaming and unread state for reactivity
  let stateVersion = $state(0);

  onMount(() => {
    // Start polling for active streams (if not already started)
    activeStreamsTracker.startPolling(2000);
    const unsubStreams = activeStreamsTracker.subscribe(() => {
      stateVersion++;
    });
    const unsubUnread = unreadTrackingService.subscribe(() => {
      stateVersion++;
    });
    return () => {
      unsubStreams();
      unsubUnread();
    };
  });

  // Get agent display info for a workspace from agentSummary + pending agents
  // Only returns agents that are ACTIVE (streaming/busy) or have UNREAD messages
  function getWorkspaceAgentInfo(ws: Workspace): AgentDisplayInfo[] {
    // Reference version for reactivity
    void stateVersion;
    // Also reference pending agents store version for reactivity
    void pendingAgentsStore.version;

    const summary = ws.agentSummary;
    const summaryAgents = summary?.agents || [];

    // Get pending agents for this workspace (newly created, not yet in agentSummary)
    const pendingAgents = pendingAgentsStore.getForWorkspace(ws.id);

    // Combine agents, avoiding duplicates (prefer summary over pending)
    const summaryAgentIds = new Set(summaryAgents.map((a) => a.id));
    const allAgents = [
      ...summaryAgents,
      ...pendingAgents.filter((pa) => !summaryAgentIds.has(pa.id)),
    ];

    if (allAgents.length === 0) {
      return [];
    }

    // Get unread agent IDs for this workspace
    const unreadAgentIds = new Set(unreadTrackingService.getUnreadAgentIdsForWorkspace(ws.id));

    return allAgents
      .map((agent) => {
        // Check if this agent is currently streaming (real-time status)
        const isStreaming = activeStreamsTracker.isAgentStreaming(agent.id);
        const isUnread = unreadAgentIds.has(agent.id);
        const isPending = pendingAgents.some((pa) => pa.id === agent.id);

        // Determine avatar state based on persisted status + real-time streaming state
        let state: AvatarState = 'idle';
        if (isStreaming || isPending) {
          // Pending agents are always shown as running
          state = 'running';
        } else if (agent.status === 'busy' || agent.status === 'processing') {
          state = 'running';
        } else if (agent.status === 'error' || agent.status === 'failed') {
          state = 'failed';
        } else if (agent.status === 'waiting') {
          state = 'waiting';
        }

        return {
          id: agent.id,
          state,
          specialist: agent.specialist,
          isActive:
            isStreaming || isPending || agent.status === 'busy' || agent.status === 'processing',
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

  // Helper to get group key for a workspace
  function getGroupKey(ws: Workspace): {
    key: string;
    label: string;
    isGithub: boolean;
    owner?: string;
  } {
    if (ws.repositoryOwner && ws.repositoryName) {
      return {
        key: `${ws.repositoryOwner}/${ws.repositoryName}`,
        label: `${ws.repositoryOwner}/${ws.repositoryName}`,
        isGithub: true,
        owner: ws.repositoryOwner,
      };
    } else if (ws.repositoryPath) {
      return {
        key: ws.repositoryPath,
        label: ws.repositoryPath.split('/').pop() || ws.repositoryPath,
        isGithub: false,
      };
    } else {
      return { key: 'unknown', label: 'Unknown Repository', isGithub: false };
    }
  }

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
    return Math.max(
      ...workspaces.map((ws) => new Date(ws.lastActivity || ws.createdAt || 0).getTime()),
    );
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
    const sorted = [...filteredWorkspaces].sort((a, b) => {
      const dateA = new Date(a.lastActivity || a.createdAt || 0).getTime();
      const dateB = new Date(b.lastActivity || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

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
      const { key, label, isGithub, owner } = getGroupKey(ws);
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
    return HEADER_HEIGHT + group.workspaces.length * ROW_HEIGHT;
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
    const repoInfo: RepoInfo = {
      repoPath: firstWs?.repositoryPath || group.repoPath,
      isGithub: group.isGithub,
      owner: group.owner,
      name: firstWs?.repositoryName || group.label,
    };

    onCreateForRepo(repoInfo);
  }


</script>

<!-- When grouped by repo, use explicit flexbox columns for masonry layout -->
{#if groupByRepo}
  <div class="flex gap-9" bind:clientWidth>
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
        <div class="flex-1 flex flex-col gap-10">
          {#each column as group (group.key)}
            {@const isCollapsed = collapsedGroups.has(group.key)}
            <div
              class="bg-background border border-border shadow-xs rounded-xl overflow-hidden"
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
                      No active spaces
                    </div>
                  {:else}
                    {#each group.workspaces as ws, wsIndex (ws.id)}
                      <div transition:slide={{ axis: 'y', duration: 150 }}>
                        <WorkspaceTableRow
                          workspace={ws}
                          agents={getWorkspaceAgentInfo(ws)}
                          isLastInGroup={wsIndex === group.workspaces.length - 1}
                          groupByRepo={true}
                          {onOpen}
                          {onDelete}
                          {onArchive}
                          {onUnarchive}
                        />
                      </div>
                    {/each}
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
        <div class="overflow-hidden" transition:slide={{ axis: 'y', duration: 150 }}>
          {#each group.workspaces as ws, wsIndex (ws.id)}
            <div transition:slide={{ axis: 'y', duration: 150 }}>
              <WorkspaceTableRow
                workspace={ws}
                agents={getWorkspaceAgentInfo(ws)}
                isLastInGroup={wsIndex === group.workspaces.length - 1}
                showRepoAvatar={!!ws.repositoryOwner}
                groupByRepo={false}
                {onOpen}
                {onDelete}
                {onArchive}
                {onUnarchive}
              />
            </div>
          {/each}
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
