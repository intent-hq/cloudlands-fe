<script lang="ts">
  /**
   * SpacesSidebar - Collapsible icon sidebar
   *
   * Shows icons by default, expands to full width on hover.
   * Displays workspaces sorted by last opened, with activity indicators.
   * Can toggle between flat list (ordered by recency) and grouped by repo.
   */

  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import type { Workspace } from '$shared/types';
  import {
    faPlus,
    faGear,
    faHouse,
    faClock,
    faLayerGroup,
    faServer,
    faLaptop,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { crossfade } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  // State management
  import { workspaceTabManager } from '$features/workspace/workspace-tab-manager.svelte';
  import { spaceOrdering } from '$features/layout/space-ordering.svelte';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import { pendingAgentsStore } from '$features/agent/services/pending-agents.store.svelte';
  import { permissionStore } from '$lib/stores/permission.store.svelte';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { invoke } from '$lib/electron-bridge';

  // Components
  import { Tooltip } from '$lib/components/ui/tooltip';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { SvelteMap } from 'svelte/reactivity';
  import { onMount } from 'svelte';
  import { getLineStats, type LineStats } from '$features/file-tracking/file-tracking.client';
  import { groupAndSortWorkspaces } from '$lib/utils/workspace-sorting';
  import { featureCodesStore } from '$lib/stores/feature-codes.store.svelte';

  // Crossfade for transitioning workspaces between views
  const [send, receive] = crossfade({
    duration: 250,
    easing: quintOut,
    fallback() {
      return {
        duration: 200,
        easing: quintOut,
        css: (t) => `opacity: ${t}; transform: scale(${0.95 + 0.05 * t})`,
      };
    },
  });

  interface Props {
    workspaces: Workspace[];
    onCreateWorkspace?: () => void;
  }

  let { workspaces, onCreateWorkspace }: Props = $props();

  // Feature flag: show remote/local environment icons
  let showEnvironmentIcons = $derived(featureCodesStore.isFeatureEnabled('remote-workspaces'));

  // Hover state for expansion
  let isExpanded = $state(false);
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  // Get current workspace ID from URL
  let currentWorkspaceId = $derived(page.params?.id ?? null);

  // Track streaming state for reactivity
  let activeStreamsVersion = $state(0);
  let unreadVersion = $state(0);

  // Cache for real-time line stats per workspace
  let lineStatsCache = new SvelteMap<string, LineStats>();
  let lineStatsVersion = $state(0);
  let lineStatsRefreshInterval: ReturnType<typeof setInterval> | null = null;

  // Fetch line stats for all workspaces
  async function refreshLineStats() {
    for (const workspace of workspaces) {
      try {
        const stats = await getLineStats(workspace.id);
        lineStatsCache.set(workspace.id, stats);
      } catch {
        // Keep existing value or default
        if (!lineStatsCache.has(workspace.id)) {
          lineStatsCache.set(workspace.id, { additions: 0, deletions: 0 });
        }
      }
    }
    lineStatsVersion++;
  }

  onMount(() => {
    activeStreamsTracker.startPolling(2000);
    const unsubscribeStreams = activeStreamsTracker.subscribe(() => {
      activeStreamsVersion++;
    });
    const unsubscribeUnread = unreadTrackingService.subscribe(() => {
      unreadVersion++;
    });

    // Initial fetch of line stats
    refreshLineStats();

    // Refresh line stats periodically (every 5 seconds)
    lineStatsRefreshInterval = setInterval(refreshLineStats, 5000);

    return () => {
      unsubscribeStreams();
      unsubscribeUnread();
      if (hoverTimeout) clearTimeout(hoverTimeout);
      if (lineStatsRefreshInterval) clearInterval(lineStatsRefreshInterval);
    };
  });

  // Sync ordering with available workspaces
  $effect(() => {
    const workspaceIds = workspaces.map((w) => w.id);
    spaceOrdering.syncWithWorkspaces(workspaceIds);
  });

  let orderVersion = $state(0);

  // View mode: 'recent' (flat list by recency) or 'grouped' (grouped by repo)
  type ViewMode = 'recent' | 'grouped';
  const VIEW_MODE_STORAGE_KEY = 'spaces-sidebar-view-mode';

  function loadViewMode(): ViewMode {
    if (typeof window === 'undefined') return 'recent';
    try {
      const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (stored === 'grouped' || stored === 'recent') return stored;
    } catch {
      // Ignore
    }
    return 'recent';
  }

  let viewMode = $state<ViewMode>(loadViewMode());

  function toggleViewMode() {
    viewMode = viewMode === 'recent' ? 'grouped' : 'recent';
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // Ignore
    }
  }

  let orderedWorkspaces = $derived.by(() => {
    void orderVersion;
    const order = spaceOrdering.order;
    const workspaceMap = new SvelteMap<string, Workspace>(workspaces.map((w) => [w.id, w]));
    const ordered: Workspace[] = [];
    for (const id of order) {
      const ws = workspaceMap.get(id);
      if (ws) {
        ordered.push(ws);
        workspaceMap.delete(id);
      }
    }
    for (const ws of workspaceMap.values()) {
      ordered.push(ws);
    }
    return ordered;
  });

  // Grouped workspaces by repository (each group sorted by recency)
  interface WorkspaceGroup {
    repoKey: string;
    displayName: string;
    workspaces: Workspace[];
  }

  let groupedWorkspaces = $derived.by((): WorkspaceGroup[] => {
    void orderVersion;

    return groupAndSortWorkspaces({
      workspaces: orderedWorkspaces,
      getId: (ws) => ws.id,
      getGroupKey: (ws) => {
        const repoKey =
          ws.repositoryOwner && ws.repositoryName
            ? `${ws.repositoryOwner}/${ws.repositoryName}`
            : 'Other';
        return { key: repoKey, label: repoKey };
      },
    }).map((g) => ({
      repoKey: g.groupKey.key,
      displayName: g.groupKey.label,
      workspaces: g.workspaces,
    }));
  });

  function getWorkspaceLineChanges(workspaceId: string): { additions: number; deletions: number } {
    // Use lineStatsVersion to trigger reactivity when cache updates
    lineStatsVersion;

    // Return cached real-time stats (fetched via IPC from main process)
    const cached = lineStatsCache.get(workspaceId);
    if (cached) {
      return cached;
    }

    // Return zeros while loading
    return { additions: 0, deletions: 0 };
  }

  // Agent display info with computed avatar state
  interface AgentDisplayInfo {
    id: string;
    state: AvatarState;
    specialist?: 'spec-writer' | 'implementor' | 'verifier' | null;
    isActive: boolean;
    isUnread: boolean;
  }

  // Get agent display info for a workspace (matches pattern from other space list components)
  function getWorkspaceAgentInfo(ws: Workspace): AgentDisplayInfo[] {
    // Reference version counters for reactivity
    void activeStreamsVersion;
    void unreadVersion;
    void pendingAgentsStore.version;

    const summary = ws.agentSummary;
    const summaryAgents = summary?.agents || [];
    const pendingAgents = pendingAgentsStore.getForWorkspace(ws.id);

    const summaryAgentIds = new Set(summaryAgents.map((a) => a.id));
    const allAgents = [
      ...summaryAgents,
      ...pendingAgents.filter((pa) => !summaryAgentIds.has(pa.id)),
    ];

    if (allAgents.length === 0) return [];

    const unreadAgentIds = new Set(unreadTrackingService.getUnreadAgentIdsForWorkspace(ws.id));

    return allAgents
      .map((agent) => {
        const isStreaming = activeStreamsTracker.isAgentStreaming(agent.id);
        const isUnread = unreadAgentIds.has(agent.id);
        const isPending = pendingAgents.some((pa) => pa.id === agent.id);

        const hasPermissionRequest = permissionStore.getPendingCount(agent.id) > 0;
        let state: AvatarState = 'idle';
        if (agent.status === 'error' || agent.status === 'failed') {
          state = 'failed';
        } else if (hasPermissionRequest) {
          state = 'needs-permission';
        } else if (isStreaming || isPending) {
          state = 'running';
        } else if (agent.status === 'busy' || agent.status === 'processing') {
          state = 'running';
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
      .filter((agent) => agent.isActive || agent.isUnread || agent.state === 'needs-permission');
  }

  function getRepoDisplayName(workspace: Workspace): string | null {
    if (workspace.repositoryOwner && workspace.repositoryName) {
      return `${workspace.repositoryOwner}/${workspace.repositoryName}`;
    }
    if (workspace.repositoryPath) {
      return workspace.repositoryPath.split('/').pop() || null;
    }
    return null;
  }

  async function handleSpaceClick(workspaceId: string, event?: MouseEvent) {
    const route = `/workspace/${workspaceId}`;

    // Command-click (or Ctrl-click on non-Mac) opens in new window
    if (event?.metaKey || event?.ctrlKey) {
      try {
        await invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route });
      } catch (error) {
        console.warn('Failed to open new window, navigating instead:', error);
        goto(route);
      }
      return;
    }

    spaceOrdering.openSpace(workspaceId);
    workspaceTabManager.openTab(workspaceId);
    goto(route);
    orderVersion++;
  }

  function handleNewWorkspace() {
    onCreateWorkspace?.();
  }

  function handleSettings() {
    navigateToSettings();
  }

  function handleMouseEnter() {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    isExpanded = true;
  }

  function handleMouseLeave() {
    hoverTimeout = setTimeout(() => {
      isExpanded = false;
    }, 200);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="spaces-sidebar"
  class:expanded={isExpanded}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  <!-- Top area: traffic lights space -->
  <div class="shrink-0 h-12 app-drag-region"></div>

  <!-- Top Actions -->
  <div class="shrink-0 px-1 pb-2 flex flex-col gap-0.5">
    <Tooltip content="Home" side="right" delayDuration={300}>
      <button
        class="action-btn w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50"
        onclick={() => goto('/')}
      >
        <Fa icon={faHouse} class="w-4 h-4 shrink-0" />
        <span class="action-label text-xs truncate">Home</span>
      </button>
    </Tooltip>

    <Tooltip content="New Workspace" side="right" delayDuration={300}>
      <button
        class="action-btn w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50"
        onclick={handleNewWorkspace}
      >
        <Fa icon={faPlus} class="w-4 h-4 shrink-0" />
        <span class="action-label text-xs truncate">New Workspace</span>
      </button>
    </Tooltip>
  </div>

  <!-- Divider with view mode toggle -->
  <div class="mx-2 border-t border-border mb-2 flex items-center justify-end pt-1.5">
    <Tooltip
      content={viewMode === 'recent' ? 'Group by repository' : 'Sort by recent'}
      side="right"
      delayDuration={300}
    >
      <button
        class="view-toggle p-1 rounded transition-all cursor-pointer text-muted-foreground hover:text-muted-foreground hover:bg-muted/50"
        onclick={toggleViewMode}
      >
        <Fa icon={viewMode === 'recent' ? faLayerGroup : faClock} class="w-3 h-3" />
      </button>
    </Tooltip>
  </div>

  <!-- Workspace List -->
  <div class="flex-1 overflow-y-auto px-1">
    {#if viewMode === 'recent'}
      <!-- Flat list ordered by recency -->
      {#each orderedWorkspaces as workspace (workspace.id)}
        {@const isActive = workspace.id === currentWorkspaceId}
        {@const tooltipText = workspace.branch
          ? `${workspace.title}\n${workspace.branch}`
          : workspace.title}
        {@const agents = getWorkspaceAgentInfo(workspace)}
        {@const streaming = agents.some((a) => a.isActive)}
        {@const unread = agents.some((a) => a.isUnread)}
        {@const lineChanges = getWorkspaceLineChanges(workspace.id)}
        {@const repoName = getRepoDisplayName(workspace)}

        <div in:receive={{ key: workspace.id }} out:send={{ key: workspace.id }}>
          <Tooltip
            content={tooltipText}
            side="right"
            delayDuration={isExpanded ? 1000 : 300}
            class="w-full"
          >
            <button
              class="workspace-btn w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-pointer hover:bg-muted/50 {isActive
                ? 'bg-muted'
                : ''}"
              onclick={(e) => handleSpaceClick(workspace.id, e)}
            >
              <!-- Status indicator dot -->
              <div class="w-6 h-6 flex items-center justify-center shrink-0 relative">
                <div
                  class="w-2 h-2 rounded-full transition-colors {streaming
                    ? 'bg-blue-500 animate-pulse'
                    : unread
                      ? 'bg-orange-400'
                      : isActive
                        ? 'bg-primary'
                        : 'bg-muted-foreground/30'}"
                ></div>
              </div>

              <!-- Labels (visible when expanded) -->
              <div class="workspace-label flex-1 min-w-0 text-left">
                <div class="text-xs font-medium truncate text-foreground flex items-center gap-1">
                  {#if showEnvironmentIcons}
                    <span
                      title={workspace.environmentConfig?.type === 'remote' ? 'Remote' : 'Local'}
                    >
                      <Fa
                        icon={workspace.environmentConfig?.type === 'remote' ? faServer : faLaptop}
                        size="xs"
                        class={workspace.environmentConfig?.type === 'remote'
                          ? 'text-blue-500'
                          : 'text-subtle'}
                      />
                    </span>
                  {/if}
                  {workspace.title}
                </div>
                <!-- Repo name (when not grouped) -->
                {#if repoName}
                  <div class="text-ui text-subtle truncate">
                    {repoName}
                  </div>
                {/if}
                <!-- Stats row: line changes, agents -->
                <div class="flex items-center gap-1.5 text-ui text-subtle">
                  <LineChangesBadge
                    additions={lineChanges.additions}
                    deletions={lineChanges.deletions}
                    size="xxs"
                  />
                  {#if agents.length > 0}
                    <div class="flex items-center -space-x-1">
                      {#each agents.slice(0, 3) as agent (agent.id)}
                        <AugieAvatarWithState
                          agentId={agent.id}
                          state={agent.isUnread ? 'unread' : agent.state}
                          size={14}
                          specialist={agent.specialist}
                        />
                      {/each}
                      {#if agents.length > 3}
                        <span class="ml-1 text-ui text-subtle font-medium">
                          +{agents.length - 3}
                        </span>
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
            </button>
          </Tooltip>
        </div>
      {/each}
    {:else}
      <!-- Grouped by repository -->
      {#each groupedWorkspaces as group, groupIndex (group.repoKey)}
        <!-- Group header with spacing (no top spacing for first group) -->
        <div class="group-header px-2 pb-1 flex items-center gap-1.5" class:mt-4={groupIndex > 0}>
          <span class="group-label text-ui font-medium text-subtle truncate">
            {group.displayName}
          </span>
        </div>

        <!-- Workspaces in group -->
        {#each group.workspaces as workspace (workspace.id)}
          {@const isActive = workspace.id === currentWorkspaceId}
          {@const tooltipText = workspace.branch
            ? `${workspace.title}\n${workspace.branch}`
            : workspace.title}
          {@const agents = getWorkspaceAgentInfo(workspace)}
          {@const streaming = agents.some((a) => a.isActive)}
          {@const unread = agents.some((a) => a.isUnread)}
          {@const lineChanges = getWorkspaceLineChanges(workspace.id)}

          <div in:receive={{ key: workspace.id }} out:send={{ key: workspace.id }}>
            <Tooltip
              content={tooltipText}
              side="right"
              delayDuration={isExpanded ? 1000 : 300}
              class="w-full"
            >
              <button
                class="workspace-btn w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-pointer hover:bg-muted/50 {isActive
                  ? 'bg-muted'
                  : ''}"
                onclick={(e) => handleSpaceClick(workspace.id, e)}
              >
                <!-- Status indicator dot -->
                <div class="w-6 h-6 flex items-center justify-center shrink-0 relative">
                  <div
                    class="w-2 h-2 rounded-full transition-colors {streaming
                      ? 'bg-blue-500 animate-pulse'
                      : unread
                        ? 'bg-orange-400'
                        : isActive
                          ? 'bg-primary'
                          : 'bg-muted-foreground/30'}"
                  ></div>
                </div>

                <!-- Labels (visible when expanded) -->
                <div class="workspace-label flex-1 min-w-0 text-left">
                  <div class="text-xs font-medium truncate text-foreground flex items-center gap-1">
                    {#if showEnvironmentIcons}
                      <span
                        title={workspace.environmentConfig?.type === 'remote' ? 'Remote' : 'Local'}
                      >
                        <Fa
                          icon={workspace.environmentConfig?.type === 'remote'
                            ? faServer
                            : faLaptop}
                          size="xs"
                          class={workspace.environmentConfig?.type === 'remote'
                            ? 'text-blue-500'
                            : 'text-subtle'}
                        />
                      </span>
                    {/if}
                    {workspace.title}
                  </div>
                  <!-- Stats row: line changes, agents -->
                  <div class="flex items-center gap-1.5 text-ui text-subtle">
                    <LineChangesBadge
                      additions={lineChanges.additions}
                      deletions={lineChanges.deletions}
                      size="xxs"
                    />
                    {#if agents.length > 0}
                      <div class="flex items-center -space-x-1">
                        {#each agents.slice(0, 3) as agent (agent.id)}
                          <AugieAvatarWithState
                            agentId={agent.id}
                            state={agent.isUnread ? 'unread' : agent.state}
                            size={14}
                            specialist={agent.specialist}
                          />
                        {/each}
                        {#if agents.length > 3}
                          <span class="ml-1 text-ui text-subtle font-medium">
                            +{agents.length - 3}
                          </span>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>
              </button>
            </Tooltip>
          </div>
        {/each}
      {/each}
    {/if}
  </div>

  <!-- Bottom: Settings -->
  <div class="shrink-0 px-1 py-2 border-t border-border">
    <Tooltip content="Settings" side="right" delayDuration={300}>
      <button
        class="action-btn w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50"
        onclick={handleSettings}
      >
        <Fa icon={faGear} class="w-4 h-4 shrink-0" />
        <span class="action-label text-xs truncate">Settings</span>
      </button>
    </Tooltip>
  </div>
</div>

<style>
  .spaces-sidebar {
    width: 48px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: hsl(var(--sidebar));
    border-right: 1px solid hsl(var(--border));
    transition: width 0.15s ease-out;
    overflow: hidden;
    z-index: 50; /* Above bottom dock (z-40) */
    /* Always overlay - never affect flex layout */
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
  }

  .spaces-sidebar.expanded {
    width: 200px;
    box-shadow: 4px 0 12px rgba(0, 0, 0, 0.15);
  }

  /* Hide labels when collapsed - use visibility + max-width for smoother animation */
  .action-label,
  .workspace-label,
  .group-label {
    white-space: nowrap;
    overflow: hidden;
    max-width: 0;
    opacity: 0;
    transition:
      opacity 0.1s ease-out,
      max-width 0.15s ease-out;
  }

  .spaces-sidebar.expanded .action-label,
  .spaces-sidebar.expanded .workspace-label,
  .spaces-sidebar.expanded .group-label {
    opacity: 1;
    max-width: 150px;
  }

  /* Hide view toggle when collapsed */
  .view-toggle {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease-out;
  }

  .spaces-sidebar.expanded .view-toggle {
    opacity: 1;
    pointer-events: auto;
  }

  /* Group header hidden when collapsed */
  .group-header {
    height: 0;
    padding-top: 0;
    padding-bottom: 0;
    margin-top: 0 !important;
    overflow: hidden;
    transition:
      height 0.15s ease-out,
      padding 0.15s ease-out,
      margin 0.15s ease-out;
  }

  .spaces-sidebar.expanded .group-header {
    height: auto;
    padding-bottom: 0.25rem;
  }

  .spaces-sidebar.expanded .group-header.mt-4 {
    margin-top: 1rem !important;
  }
</style>
