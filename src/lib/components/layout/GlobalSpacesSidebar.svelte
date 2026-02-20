<script lang="ts">
  /**
   * GlobalSpacesSidebar - Sleek hover-expandable sidebar for non-home pages
   *
   * Shows a thin strip of space status indicators that expands on hover to reveal
   * full details including labels, status, agents, and line changes.
   */

  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { faHome, faPlus } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';

  // State management
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { spaceOrdering } from '$features/layout/space-ordering.svelte';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import { getLineStats, type LineStats } from '$features/file-tracking/file-tracking.client';

  // Components
  import { Tooltip } from '$lib/components/ui/tooltip';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';

  // Utils
  import { formatRelativeTime } from '$lib/utils/timeFormatting';

  interface Props {
    currentWorkspaceId?: string;
  }

  let { currentWorkspaceId }: Props = $props();

  // Hover state for expansion
  let isExpanded = $state(false);
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  // Reactivity versions for subscriptions
  let activeStreamsVersion = $state(0);
  let unreadVersion = $state(0);
  let lineStatsVersion = $state(0);

  // Cache for line stats
  let lineStatsCache = new SvelteMap<string, LineStats>();

  // Get all non-archived workspaces ordered by most recently updated
  const orderedWorkspaces = $derived.by(() => {
    const allWorkspaces = workspaceStore.items.filter(
      (w) => w.status !== WorkspaceStatusEnum.Archived,
    );

    // Sort by updatedAt timestamp (most recent first)
    return [...allWorkspaces].sort((a, b) => {
      const aUpdated = new Date(a.updatedAt).getTime();
      const bUpdated = new Date(b.updatedAt).getTime();
      return bUpdated - aUpdated;
    });
  });

  // Fetch line stats for all workspaces
  async function refreshLineStats() {
    for (const workspace of orderedWorkspaces) {
      try {
        const stats = await getLineStats(workspace.id);
        lineStatsCache.set(workspace.id, stats);
      } catch {
        if (!lineStatsCache.has(workspace.id)) {
          lineStatsCache.set(workspace.id, { additions: 0, deletions: 0 });
        }
      }
    }
    lineStatsVersion++;
  }

  // Track when current workspace changes (e.g., direct navigation)
  // Use a ref to track the last workspace we updated to avoid infinite loops
  let lastTrackedWorkspaceId: string | undefined;

  $effect(() => {
    if (currentWorkspaceId && currentWorkspaceId !== lastTrackedWorkspaceId) {
      lastTrackedWorkspaceId = currentWorkspaceId;
      spaceOrdering.openSpace(currentWorkspaceId);
    }
  });

  onMount(() => {
    activeStreamsTracker.startPolling(2000);
    const unsubscribeStreams = activeStreamsTracker.subscribe(() => activeStreamsVersion++);
    const unsubscribeUnread = unreadTrackingService.subscribe(() => unreadVersion++);

    refreshLineStats();
    const lineStatsInterval = setInterval(refreshLineStats, 5000);

    return () => {
      unsubscribeStreams();
      unsubscribeUnread();
      if (hoverTimeout) clearTimeout(hoverTimeout);
      clearInterval(lineStatsInterval);
    };
  });

  // Helper functions
  function isWorkspaceStreaming(workspaceId: string): boolean {
    activeStreamsVersion;
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId).length > 0;
  }

  function getStreamingAgentIds(workspaceId: string): string[] {
    activeStreamsVersion;
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId);
  }

  function getUnreadAgentIds(workspaceId: string): string[] {
    unreadVersion;
    const streaming = getStreamingAgentIds(workspaceId);
    return unreadTrackingService
      .getUnreadAgentIdsForWorkspace(workspaceId)
      .filter((id) => !streaming.includes(id));
  }

  function hasUnreadMessages(workspaceId: string): boolean {
    return getUnreadAgentIds(workspaceId).length > 0;
  }

  function getLineChanges(workspaceId: string): LineStats {
    lineStatsVersion;
    return lineStatsCache.get(workspaceId) || { additions: 0, deletions: 0 };
  }

  async function handleSpaceClick(workspaceId: string, event?: MouseEvent) {
    const route = `/workspace/${workspaceId}`;

    // Command-click (or Ctrl-click on non-Mac) opens in new window
    if (event?.metaKey || event?.ctrlKey) {
      try {
        await invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route });
      } catch (error) {
        // Fallback to regular navigation if IPC fails
        console.warn('Failed to open new window, navigating instead:', error);
        goto(route);
      }
      return;
    }

    spaceOrdering.openSpace(workspaceId);
    // Clear unread status for all agents in this workspace since user is navigating to it
    unreadTrackingService.clearUnreadForWorkspace(workspaceId);
    goto(route);
  }

  function handleMouseEnter() {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    isExpanded = true;
  }

  function handleMouseLeave() {
    // hoverTimeout = setTimeout(() => {
    isExpanded = false;
    // }, 150);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="global-spaces-sidebar"
  class:expanded={isExpanded}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  <!-- Home button -->
  <div class="shrink-0 px-1.5 pb-2 pt-2.75">
    <Tooltip content="Home" side="right" delayDuration={isExpanded ? 500 : 200}>
      <button
        class="w-full flex items-center gap-3.5 px-1.5 py-1.5 rounded-md cursor-pointer
               text-muted-foreground hover:text-foreground"
        onclick={() => goto('/')}
      >
        <div class="flex items-center justify-center shrink-0">
          <Fa icon={faHome} class="opacity-60" />
        </div>
        <span class="space-label text-sm font-medium">Spaces</span>
      </button>
    </Tooltip>
  </div>

  <!-- Divider -->
  <!-- <div class="mx-2 border-t border-border mb-2"></div> -->

  <!-- Spaces list -->
  <div class="spaces-list flex-1 overflow-y-auto overflow-x-hidden px-1">
    {#each orderedWorkspaces as workspace (workspace.id)}
      {@const isActive = workspace.id === currentWorkspaceId}
      {@const streaming = isWorkspaceStreaming(workspace.id)}
      {@const streamingAgents = getStreamingAgentIds(workspace.id)}
      {@const unreadAgents = getUnreadAgentIds(workspace.id)}
      {@const hasUnread = unreadAgents.length > 0}
      {@const lineChanges = getLineChanges(workspace.id)}
      {@const hasChanges = lineChanges.additions > 0 || lineChanges.deletions > 0}

      {@const initials = (workspace.title || 'U')
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase())
        .join('')}
      {@const hasStreamingAgent = streamingAgents.length > 0}
      {@const hasUnreadAgent = !isActive && unreadAgents.length > 0}

      <Tooltip
        content={workspace.title || 'Untitled'}
        side="right"
        delayDuration={isExpanded ? 1000 : 200}
        class="w-full"
      >
        <button
          class="w-full flex h-14 gap-2 px-1 py-1 rounded-md cursor-pointer
                 group
                 "
          onclick={(e) => handleSpaceClick(workspace.id, e)}
        >
          <!-- Status indicator: 2-letter initials with optional blue/green indicator -->
          <div class="relative size-7 flex items-center justify-center shrink-0">
            <!-- Initials -->
            <div
              class="mt-2 size-7 rounded-md flex items-center justify-center text-[10px] font-semibold
                     {isActive
                ? 'bg-muted-foreground/20 text-foreground'
                : 'bg-muted-foreground/10 text-muted-foreground/50 group-hover:text-foreground'}"
            >
              {initials}
            </div>
            <!-- Status indicator dot -->
            {#if hasStreamingAgent}
              <div
                class="absolute top-0.5 -right-0.5 size-1.5 rounded-full bg-green-500 animate-pulse"
              ></div>
            {:else if hasUnreadAgent}
              <div class="absolute top-0.5 -right-0.5 size-1.5 rounded-full bg-blue-500"></div>
            {/if}
          </div>

          <!-- Labels (visible when expanded) -->
          <div class="space-label flex-1 min-w-0 text-left">
            <div class="w-full flex items-center">
              <div
                class="flex-1 text-sm truncate
                     {isActive
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground group-hover:text-foreground'}"
                title={workspace.title || 'Untitled'}
              >
                {workspace.title || 'Untitled'}
              </div>

              <!-- Status row: line changes, agents -->
              <div class="flex items-center gap-1.5 mt-0.5">
                {#if hasChanges}
                  <LineChangesBadge
                    additions={lineChanges.additions}
                    deletions={lineChanges.deletions}
                    size="xxs"
                  />
                {/if}

                <!-- Agent avatars -->
                {#if streamingAgents.length > 0 || unreadAgents.length > 0}
                  <div class="flex items-center -space-x-1">
                    {#each streamingAgents.slice(0, 3) as agentId (agentId)}
                      <AugieAvatarWithState {agentId} size={14} state="running" />
                    {/each}
                    {#each unreadAgents.slice(0, 3 - streamingAgents.length) as agentId (agentId)}
                      <AugieAvatarWithState {agentId} size={14} state="unread" />
                    {/each}
                  </div>
                {/if}
              </div>
            </div>

            <!-- org/repo + last updated -->
            <div
              class="flex items-center w-full justify-between gap-1.5 text-xs text-muted-foreground/50"
            >
              <span class="truncate">{workspace.repositoryName}</span>
              <span class="shrink-0">{formatRelativeTime(workspace.updatedAt)}</span>
            </div>
          </div>
        </button>
      </Tooltip>
    {/each}
  </div>
</div>

<style>
  .global-spaces-sidebar {
    width: 40px;
    height: 100%;
    display: flex;
    flex-direction: column;
    /* background: hsl(var(--sidebar)); */
    border-right: 1px solid hsl(var(--border) / 0.5);
    transition: width 0.15s ease-out;
    overflow: hidden;
    z-index: 50;
    height: 100%;
  }

  .global-spaces-sidebar.expanded {
    width: 200px;
    /* background: hsl(var(--sidebar));
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.1); */
    /* border-right: 1px solid hsl(var(--border)); */
  }

  /* Hide labels when collapsed */
  .space-label {
    white-space: nowrap;
    overflow: hidden;
    max-width: 0;
    opacity: 0;
    transition:
      opacity 0.1s ease-out,
      max-width 0.15s ease-out;
  }

  .global-spaces-sidebar.expanded .space-label {
    opacity: 1;
    max-width: 160px;
  }

  /* Hide scrollbar */
  .spaces-list {
    scrollbar-width: none;
  }
  .spaces-list::-webkit-scrollbar {
    display: none;
  }
</style>
