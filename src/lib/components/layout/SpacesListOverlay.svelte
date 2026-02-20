<script lang="ts">
  /**
   * SpacesListOverlay - Overlay that lists all spaces with activity indicators
   *
   * Shows for each recently edited space (last few days):
   * - GitHub org avatar with fallback
   * - Space title with streaming/unread indicators
   * - Task progress, agent avatars, line changes, commits, PR info
   * - Optional grouping by org/repo
   */

  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum, PullRequestStatus } from '$shared/types';
  import {
    faFolder,
    faTimes,
    faChevronDown,
    faLayerGroup,
    faList,
    faPlus,
    faServer,
    faLaptop,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount, onDestroy, tick } from 'svelte';
  import { slide } from 'svelte/transition';

  // State management
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { spaceOrdering } from '$features/layout/space-ordering.svelte';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { invoke } from '$lib/electron-bridge';
  import { pendingAgentsStore } from '$features/agent/services/pending-agents.store.svelte';
  import { sidebarWidthStore } from '$lib/stores/sidebar-width.store.svelte';
  import { layoutSettings } from '$features/layout/layout-settings.svelte';

  // Components
  import { Tooltip } from '$lib/components/ui/tooltip';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { permissionStore } from '$lib/stores/permission.store.svelte';
  import { featureCodesStore } from '$lib/stores/feature-codes.store.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import WorkspaceStatusIcon, {
    type WorkspaceDisplayStatus,
  } from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';

  // Utils
  import Button from '../ui/button/button.svelte';
  import { groupAndSortWorkspaces } from '$lib/utils/workspace-sorting';

  // Feature flag: show remote/local environment icons
  let showEnvironmentIcons = $derived(featureCodesStore.isFeatureEnabled('remote-workspaces'));

  // Agent display info with computed avatar state
  interface AgentDisplayInfo {
    id: string;
    state: AvatarState;
    specialist?: 'spec-writer' | 'implementor' | 'verifier' | null;
    isActive: boolean;
    isUnread: boolean;
  }

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    skipIntro?: boolean;
  }

  let { isOpen, onClose, skipIntro = false }: Props = $props();

  // When skipIntro is set, suppress the slide-in animation and auto-focus on
  // mount, then clear it so subsequent open/close cycles behave normally.
  let suppressIntro = $state(skipIntro);
  $effect(() => {
    if (skipIntro && isOpen) {
      suppressIntro = true;
      // Clear after a tick so the next toggle animates & focuses normally
      requestAnimationFrame(() => {
        suppressIntro = false;
      });
    }
  });

  // Preference key for localStorage
  const PREF_GROUP_BY_REPO = 'spaces-overlay:groupByRepo';

  // Load persisted preference
  function loadPref<T>(key: string, defaultValue: T): T {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return defaultValue;
      return JSON.parse(stored) as T;
    } catch {
      return defaultValue;
    }
  }

  // Grouping state
  let groupByRepo = $state(loadPref(PREF_GROUP_BY_REPO, true));

  // Persist preference when it changes
  $effect(() => {
    localStorage.setItem(PREF_GROUP_BY_REPO, JSON.stringify(groupByRepo));
  });

  // Track collapsed groups
  let collapsedGroups = $state<Set<string>>(new Set());

  // Get current workspace ID from URL
  let currentWorkspaceId = $derived(page.params?.id ?? null);

  // Keyboard navigation state
  let highlightedIndex = $state(-1);
  let overlayContainerEl = $state<HTMLDivElement | null>(null);
  let scrollContainerEl = $state<HTMLDivElement | null>(null);
  let previouslyFocusedEl: HTMLElement | null = null;

  // Hovered workspace for compact hovercard
  let hoveredWorkspaceId = $state<string | null>(null);
  let hoveredRowRect = $state<{ top: number; height: number } | null>(null);
  let hoveredWorkspace = $derived(
    hoveredWorkspaceId ? workspaceStore.items.find((w) => w.id === hoveredWorkspaceId) ?? null : null,
  );

  // Reactivity versions for subscriptions
  let activeStreamsVersion = $state(0);
  let unreadVersion = $state(0);

  // Determine if the sidebar is on the right (overlay gets independent width)
  const isSidebarRight = $derived(layoutSettings.sidebarSide === 'right');

  // When sidebar is on the right, use the overlay's own persisted width;
  // when on the left, match the sidebar width as before.
  const overlayWidth = $derived(
    isSidebarRight ? layoutSettings.spacesOverlayWidth : sidebarWidthStore.width + 1,
  );

  // Responsive breakpoints based on overlay width
  const isNarrow = $derived(overlayWidth < 250);
  const isVeryNarrow = $derived(overlayWidth < 180);
  const isTiny = $derived(overlayWidth < 150);
  /** Ultra-compact: only show status indicator dots */
  const isIndicatorOnly = $derived(overlayWidth < 50);
  /** Compact: show hovercard on hover instead of inline details */
  const isCompact = $derived(overlayWidth < 80);

  // Resize state for the overlay (only active when sidebar is on right)
  const OVERLAY_MIN_WIDTH = 10;
  const OVERLAY_COLLAPSE_THRESHOLD = 10;
  const OVERLAY_MAX_WIDTH = 800;
  let isResizing = $state(false);
  let isCollapsedByDrag = $state(false);
  let resizeStartX = $state(0);
  let resizeStartWidth = $state(0);

  function handleResizeMouseDown(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
    layoutSettings.spacesOverlayResizing = true;
    isCollapsedByDrag = false;
    resizeStartX = e.clientX;
    resizeStartWidth = layoutSettings.spacesOverlayWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleResizeMouseMove);
    document.addEventListener('mouseup', handleResizeMouseUp);
  }

  function handleResizeMouseMove(e: MouseEvent) {
    if (!isResizing) return;
    const delta = e.clientX - resizeStartX;
    const rawWidth = resizeStartWidth + delta;

    // Track collapsed state so we can hide content, but keep dragging alive
    isCollapsedByDrag = rawWidth < OVERLAY_COLLAPSE_THRESHOLD;

    const newWidth = Math.max(OVERLAY_MIN_WIDTH, Math.min(OVERLAY_MAX_WIDTH, rawWidth));
    layoutSettings.spacesOverlayWidth = newWidth;
  }

  function handleResizeMouseUp() {
    if (!isResizing) return;
    isResizing = false;
    layoutSettings.spacesOverlayResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleResizeMouseMove);
    document.removeEventListener('mouseup', handleResizeMouseUp);

    // If released while collapsed, close the overlay
    if (isCollapsedByDrag) {
      isCollapsedByDrag = false;
      onClose();
    }
  }

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

  // Group type
  type WorkspaceGroup = {
    key: string;
    label: string;
    isGithub: boolean;
    owner?: string;
    workspaces: Workspace[];
  };

  // Group workspaces by repository
  const groupedWorkspaces = $derived.by((): WorkspaceGroup[] => {
    if (!groupByRepo) {
      return [
        {
          key: 'all',
          label: 'Spaces',
          isGithub: false,
          workspaces: orderedWorkspaces,
        },
      ];
    }

    return groupAndSortWorkspaces({
      workspaces: orderedWorkspaces,
      getId: (ws) => ws.id,
      getGroupKey,
    }).map((g) => ({
      key: g.groupKey.key,
      label: g.groupKey.label,
      isGithub: g.groupKey.isGithub,
      owner: g.groupKey.owner,
      workspaces: g.workspaces,
    }));
  });

  // Toggle group collapse
  function toggleGroup(groupKey: string) {
    if (collapsedGroups.has(groupKey)) {
      collapsedGroups.delete(groupKey);
      collapsedGroups = new Set(collapsedGroups);
    } else {
      collapsedGroups.add(groupKey);
      collapsedGroups = new Set(collapsedGroups);
    }
  }

  // Flat list of visible workspace IDs for keyboard navigation
  // Respects grouping and collapsed groups
  const visibleWorkspaceIds = $derived.by(() => {
    const ids: string[] = [];
    for (const group of groupedWorkspaces) {
      if (group.key !== 'all' && collapsedGroups.has(group.key)) continue;
      for (const ws of group.workspaces) {
        ids.push(ws.id);
      }
    }
    return ids;
  });

  // Focus the overlay container when it opens, and restore focus when it closes.
  // Skip the auto-focus when the overlay is already open on mount (persisted state)
  // so it doesn't steal focus from the rest of the page on load.
  // Use a plain (non-reactive) flag so that clearing it doesn't re-trigger the effect.
  let skipInitialFocus = skipIntro && isOpen;
  $effect(() => {
    if (isOpen) {
      if (skipInitialFocus) {
        // Overlay was already open on mount — don't steal focus
        skipInitialFocus = false;
        return;
      }
      previouslyFocusedEl = document.activeElement as HTMLElement | null;
      // Set initial highlight to the current workspace, or first item
      const currentIdx = visibleWorkspaceIds.indexOf(currentWorkspaceId ?? '');
      highlightedIndex = currentIdx >= 0 ? currentIdx : 0;
      // Focus after Svelte renders the container
      tick().then(() => {
        overlayContainerEl?.focus();
      });
    } else {
      highlightedIndex = -1;
      // Restore focus to previously focused element
      previouslyFocusedEl?.focus();
      previouslyFocusedEl = null;
    }
  });

  // Scroll highlighted item into view & sync hover card with keyboard focus
  $effect(() => {
    if (highlightedIndex < 0 || !scrollContainerEl) {
      // Clear hover card when nothing is highlighted
      if (isCompact) {
        hoveredWorkspaceId = null;
        hoveredRowRect = null;
      }
      return;
    }
    const wsId = visibleWorkspaceIds[highlightedIndex];
    if (!wsId) return;
    const el = scrollContainerEl.querySelector(`[data-workspace-id="${wsId}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });

    // Keep the compact hover card in sync with keyboard navigation
    if (isCompact && el) {
      hoveredWorkspaceId = wsId;
      const rect = el.getBoundingClientRect();
      hoveredRowRect = { top: rect.top, height: rect.height };
    }
  });

  function handleOverlayKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
      case 'j': {
        e.preventDefault();
        if (visibleWorkspaceIds.length === 0) return;
        highlightedIndex = Math.min(highlightedIndex + 1, visibleWorkspaceIds.length - 1);
        break;
      }
      case 'ArrowUp':
      case 'k': {
        e.preventDefault();
        if (visibleWorkspaceIds.length === 0) return;
        highlightedIndex = Math.max(highlightedIndex - 1, 0);
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const wsId = visibleWorkspaceIds[highlightedIndex];
        if (wsId) handleSpaceClick(wsId);
        break;
      }
      case 'Escape': {
        e.preventDefault();
        onClose();
        break;
      }
      case 'Home': {
        e.preventDefault();
        highlightedIndex = 0;
        break;
      }
      case 'End': {
        e.preventDefault();
        highlightedIndex = Math.max(visibleWorkspaceIds.length - 1, 0);
        break;
      }
    }
  }

  // Check if workspace was edited in last 3 days
  function isRecentlyEdited(workspace: Workspace): boolean {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return new Date(workspace.updatedAt).getTime() > threeDaysAgo;
  }

  onMount(() => {
    activeStreamsTracker.startPolling(2000);
    const unsubscribeStreams = activeStreamsTracker.subscribe(() => activeStreamsVersion++);
    const unsubscribeUnread = unreadTrackingService.subscribe(() => unreadVersion++);

    return () => {
      unsubscribeStreams();
      unsubscribeUnread();
    };
  });

  onDestroy(() => {
    // Clean up resize listeners if component is destroyed mid-resize
    document.removeEventListener('mousemove', handleResizeMouseMove);
    document.removeEventListener('mouseup', handleResizeMouseUp);
  });

  // Helper functions
  function isWorkspaceStreaming(workspaceId: string): boolean {
    activeStreamsVersion;
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId).length > 0;
  }

  function hasUnreadMessages(workspaceId: string): boolean {
    unreadVersion;
    const streaming = activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId);
    return (
      unreadTrackingService
        .getUnreadAgentIdsForWorkspace(workspaceId)
        .filter((id) => !streaming.includes(id)).length > 0
    );
  }

  function getGitHubAvatarUrl(owner: string, size: number = 32): string {
    return `https://github.com/${owner}.png?size=${size}`;
  }

  // Get agent display info for a workspace from agentSummary + pending agents
  // Only returns agents that are ACTIVE (streaming/busy) or have UNREAD messages
  function getWorkspaceAgentInfo(ws: Workspace): AgentDisplayInfo[] {
    // Reference version for reactivity
    void activeStreamsVersion;
    void unreadVersion;
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
        const hasPermissionRequest = permissionStore.getPendingCount(agent.id) > 0;
        let state: AvatarState = 'idle';
        if (agent.status === 'error' || agent.status === 'failed') {
          state = 'failed';
        } else if (hasPermissionRequest) {
          state = 'needs-permission';
        } else if (isStreaming || isPending) {
          // Pending agents are always shown as running
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
      .filter((agent) => agent.isActive || agent.isUnread || agent.state === 'needs-permission'); // Only show active, unread, or needs-permission agents
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
    unreadTrackingService.clearUnreadForWorkspace(workspaceId);
    goto(route);
    // Keep the overlay open when sidebar is on the right (persistent panel)
    if (!isSidebarRight) {
      onClose();
    }
  }

  function handleNewSpaceForGroup(group: WorkspaceGroup, e: Event) {
    e.stopPropagation(); // Don't toggle the group collapse
    const firstWorkspace = group.workspaces[0];
    const repoPath = firstWorkspace?.repositoryPath || '';
    // Extract repo name from group key for GitHub repos (owner/name format)
    const nameParts = group.key.split('/');
    window.dispatchEvent(
      new CustomEvent('app:open-new-space-modal', {
        detail: {
          initialRepo: {
            repoPath,
            isGithub: group.isGithub,
            owner: group.owner,
            name: nameParts.length > 1 ? nameParts[1] : undefined,
          },
        },
      }),
    );
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  // Close the overlay when focus moves outside it (e.g. clicking elsewhere on the page).
  // Only applies when the sidebar is on the left (non-persistent mode).
  function handleFocusOut(e: FocusEvent) {
    if (isSidebarRight) return;
    const overlay = overlayContainerEl;
    if (!overlay) return;
    // relatedTarget is the element receiving focus.
    // null means focus went to a non-focusable element (clicked on the page background).
    // Either way, if focus isn't staying inside the overlay, close it.
    const newFocus = e.relatedTarget as Node | null;
    if (!newFocus || !overlay.contains(newFocus)) {
      onClose();
    }
  }

  // Compute workspace display status based on available data
  // Priority: PR merged > PR open > Complete > In progress > Not started
  function getWorkspaceDisplayStatus(
    ws: Workspace,
    agents: AgentDisplayInfo[],
  ): WorkspaceDisplayStatus {
    const pullRequests = ws.pullRequests || [];

    // Check for merged PR first (highest priority - work is done)
    const hasMergedPR =
      ws.prStatus === PullRequestStatus.Merged ||
      pullRequests.some((pr) => pr.status === PullRequestStatus.Merged);
    if (hasMergedPR) return 'pr_merged';

    // Check for open PR
    const hasOpenPR =
      ws.prStatus === PullRequestStatus.Open ||
      ws.prStatus === PullRequestStatus.Draft ||
      pullRequests.some(
        (pr) => pr.status === PullRequestStatus.Open || pr.status === PullRequestStatus.Draft,
      ) ||
      ws.activePullRequest;
    if (hasOpenPR) return 'pr_open';

    // Check task completion status
    const taskStats = ws.taskStats;
    const total = taskStats?.total || 0;
    const completed = taskStats?.completed || 0;
    const inProgress = taskStats?.inProgress || 0;

    // All tasks complete
    if (total > 0 && completed === total) return 'complete';

    // Has in-progress tasks or active agents
    const hasActiveAgents = agents.some((a) => a.isActive);
    if (inProgress > 0 || hasActiveAgents || completed > 0) return 'in_progress';

    // Default: not started
    return 'not_started';
  }

  // Get tooltip text for workspace status
  function getStatusTooltipText(ws: Workspace, status: WorkspaceDisplayStatus): string {
    const taskStats = ws.taskStats;
    const total = taskStats?.total || 0;
    const completed = taskStats?.completed || 0;
    const inProgress = taskStats?.inProgress || 0;

    switch (status) {
      case 'pr_merged':
        return 'PR merged';
      case 'pr_open':
        return 'PR open';
      case 'complete':
        return total > 0 ? `All ${total} tasks complete` : 'Complete';
      case 'in_progress': {
        const parts: string[] = [];
        if (completed > 0) parts.push(`${completed} complete`);
        if (inProgress > 0) parts.push(`${inProgress} in progress`);
        if (total > 0 && parts.length > 0) {
          return `${parts.join(', ')} of ${total} tasks`;
        }
        return 'In progress';
      }
      default:
        return 'Not started';
    }
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 right-auto z-40"
    onclick={handleBackdropClick}
    style="width: {isCollapsedByDrag ? 0 : overlayWidth}px;"
    transition:slide={{ axis: 'x', duration: suppressIntro ? 0 : 150 }}
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={overlayContainerEl}
      class="spaces-overlay absolute left-0 top-[30px] bottom-0 bg-sidebar border-r border-border overflow-hidden flex flex-col outline-none {isResizing ? '' : 'transition-[width] duration-150 ease-out'} {isCollapsedByDrag ? 'opacity-0' : 'opacity-100'}"
      style="width: {isCollapsedByDrag ? 0 : overlayWidth}px;"
      tabindex="0"
      role="listbox"
      aria-label="Spaces list"
      onkeydown={handleOverlayKeydown}
      onfocusout={handleFocusOut}
    >
      <!-- Header (hidden in compact/indicator-only mode) -->
      {#if !isCompact}
        <div
          class="flex items-center justify-between py-2 border-b border-border/50 transition-[padding] duration-150"
          style="padding-left: {isNarrow ? 8 : 16}px; padding-right: {isNarrow ? 4 : 8}px;"
        >
          <span
            class="font-medium transition-[font-size] duration-150"
            style="font-size: {isVeryNarrow ? 12 : 14}px;"
          >All Spaces</span>
          <div class="flex items-center">
            <Tooltip content={groupByRepo ? 'Show flat list' : 'Group by repo'} side="bottom">
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={() => (groupByRepo = !groupByRepo)}
              >
                <Fa icon={groupByRepo ? faLayerGroup : faList} size={12} />
              </Button>
            </Tooltip>
            <Button variant="ghost-light" size="icon-xs" onclick={onClose}>
              <Fa icon={faTimes} size={10} />
            </Button>
          </div>
        </div>
      {/if}

      <!-- Spaces list -->
      <div bind:this={scrollContainerEl} class="flex-1 overflow-y-auto pb-16" style="padding-top: {isIndicatorOnly ? 2 : 8}px; padding-bottom: {isIndicatorOnly ? 2 : 64}px;">
        {#each groupedWorkspaces as group (group.key)}
          {@const isCollapsed = collapsedGroups.has(group.key)}

          <!-- Group header (only show when grouping is enabled, not compact, and not the "all" group) -->
          {#if groupByRepo && group.key !== 'all' && !isCompact}
            <button
              class="group/repo w-full flex items-center gap-2 text-left cursor-pointer hover:bg-muted/30 transition-[padding] duration-150"
              style="padding: {isVeryNarrow ? 6 : 8}px {isNarrow ? 8 : 16}px;"
              onclick={() => toggleGroup(group.key)}
            >
              {#if !isVeryNarrow}
                {#if group.owner}
                  <img
                    src={getGitHubAvatarUrl(group.owner, 32)}
                    alt={group.owner}
                    class="size-4 rounded-full shrink-0"
                    loading="lazy"
                    onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                  />
                {:else}
                  <span class="text-muted-foreground/50 shrink-0 w-5 flex justify-center">
                    <Fa icon={faFolder} size="sm" />
                  </span>
                {/if}
              {/if}
              <span class="text-sm text-muted-foreground truncate flex-1">
                {group.label}
              </span>
              <!-- New space for this repo -->
              <span
                class="shrink-0 opacity-0 group-hover/repo:opacity-100 transition-opacity text-muted-foreground/50 hover:text-foreground p-0.5 rounded hover:bg-muted/50"
                role="button"
                tabindex="-1"
                title="New space for {group.label}"
                onclick={(e) => handleNewSpaceForGroup(group, e)}
                onkeydown={(e) => { if (e.key === 'Enter') handleNewSpaceForGroup(group, e); }}
              >
                <Fa icon={faPlus} size="xs" />
              </span>
              <Fa
                icon={faChevronDown}
                class="text-muted-foreground/50 w-2 h-2 transition-transform transform {isCollapsed
                  ? 'rotate-90'
                  : ''}"
              />
            </button>
          {/if}

          <!-- Workspaces in group -->
          {#if !isCollapsed || group.key === 'all'}
            {#each group.workspaces as workspace (workspace.id)}
              {@const isActive = workspace.id === currentWorkspaceId}
              {@const agents = getWorkspaceAgentInfo(workspace)}
              {@const workspaceStatus = getWorkspaceDisplayStatus(workspace, agents)}
              {@const statusTooltip = getStatusTooltipText(workspace, workspaceStatus)}

              {@const isGrouped = groupByRepo && group.key !== 'all'}
              {@const rowPl = isIndicatorOnly ? 0 : isCompact ? 4 : isGrouped
                ? isTiny ? 12 : isNarrow ? 24 : 40
                : isNarrow ? 8 : 16}
              {@const rowPr = isIndicatorOnly ? 0 : isCompact ? 4 : isGrouped
                ? isTiny ? 4 : isNarrow ? 8 : 16
                : isNarrow ? 8 : 16}
              {@const isHighlighted = visibleWorkspaceIds[highlightedIndex] === workspace.id}
              <button
                data-workspace-id={workspace.id}
                class="w-full text-left cursor-pointer transition-[padding,background-color] duration-150
                       {isIndicatorOnly ? 'flex items-center justify-center' : 'flex flex-col gap-1'}
                       {isHighlighted ? 'bg-muted' : isActive ? 'bg-background' : 'hover:bg-muted/50'}"
                style="padding: {isIndicatorOnly ? 3 : isVeryNarrow ? 6 : 8}px {rowPr}px {isIndicatorOnly ? 3 : isVeryNarrow ? 6 : 8}px {rowPl}px;"
                onclick={(e) => handleSpaceClick(workspace.id, e)}
                onmouseenter={(e) => {
                  const idx = visibleWorkspaceIds.indexOf(workspace.id);
                  if (idx >= 0) highlightedIndex = idx;
                  if (isCompact) {
                    hoveredWorkspaceId = workspace.id;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    hoveredRowRect = { top: rect.top, height: rect.height };
                  }
                }}
                onmouseleave={() => {
                  highlightedIndex = -1;
                  if (isCompact) {
                    hoveredWorkspaceId = null;
                    hoveredRowRect = null;
                  }
                }}
                role="option"
                aria-selected={isHighlighted}
              >
                {#if isIndicatorOnly}
                  <!-- Indicator-only mode: status dot with optional unread/streaming badge -->
                  <div class="relative" title={statusTooltip}>
                    <WorkspaceStatusIcon status={workspaceStatus} size={12} />
                    {#if isWorkspaceStreaming(workspace.id)}
                      <div class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-green-500 animate-pulse"></div>
                    {:else if hasUnreadMessages(workspace.id)}
                      <div class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-blue-500"></div>
                    {/if}
                  </div>
                {:else}
                  <!-- First row: Avatar, status icon, title -->
                  <div
                    class="flex items-center w-full transition-[gap] duration-150 {isCompact ? 'justify-center' : ''}"
                    style="gap: {isNarrow ? 6 : 8}px;"
                  >
                    <!-- GitHub avatar or fallback (only show when not grouped and not very narrow) -->
                    {#if !isVeryNarrow && (!groupByRepo || group.key === 'all')}
                      {#if workspace.repositoryOwner}
                        <img
                          src={getGitHubAvatarUrl(workspace.repositoryOwner, 32)}
                          alt={workspace.repositoryOwner}
                          class="size-4 rounded-full shrink-0"
                          loading="lazy"
                          onerror={(e) =>
                            ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                        />
                      {:else}
                        <span class="text-muted-foreground/50 shrink-0 w-5 flex justify-center">
                          <Fa icon={faFolder} size="sm" />
                        </span>
                      {/if}
                    {/if}

                    <!-- Workspace status indicator -->
                    <div class="shrink-0 {isCompact ? 'relative' : ''}" title={statusTooltip}>
                      <WorkspaceStatusIcon status={workspaceStatus} size={12} />
                      {#if isCompact}
                        {#if isWorkspaceStreaming(workspace.id)}
                          <div class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-green-500 animate-pulse"></div>
                        {:else if hasUnreadMessages(workspace.id)}
                          <div class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-blue-500"></div>
                        {/if}
                      {/if}
                    </div>

                    <!-- Title (hide when compact) -->
                    {#if !isCompact}
                      <div class="flex-1 min-w-0 flex items-center gap-1">
                        {#if showEnvironmentIcons}
                          <span title={workspace.environmentConfig?.type === 'remote' ? 'Remote' : 'Local'} class="shrink-0">
                            <Fa
                              icon={workspace.environmentConfig?.type === 'remote' ? faServer : faLaptop}
                              size="xs"
                              class={workspace.environmentConfig?.type === 'remote' ? 'text-blue-500' : 'text-muted-foreground/50'}
                            />
                          </span>
                        {/if}
                        <span
                          class="truncate block transition-[font-size,line-height] duration-150 {isActive
                            ? 'font-medium text-foreground'
                            : workspace.title
                              ? 'text-foreground'
                              : 'text-muted-foreground/70'}"
                          style="font-size: {isVeryNarrow ? 12 : 13}px; line-height: {isVeryNarrow ? 16 : 20}px;"
                        >
                          {workspace.title || 'Untitled'}
                        </span>
                      </div>
                    {/if}

                    <!-- Agent avatars (hide when very narrow) -->
                    {#if agents.length > 0 && !isVeryNarrow}
                      <div class="flex items-center -space-x-1.5 shrink-0">
                        {#each agents.slice(0, isNarrow ? 2 : 4) as agent (agent.id)}
                          <AugieAvatarWithState
                            agentId={agent.id}
                            state={agent.isUnread ? 'unread' : 'running'}
                            size={16}
                            specialist={agent.specialist}
                          />
                        {/each}
                        {#if agents.length > (isNarrow ? 2 : 4)}
                          <div class="ml-1 text-[10px] text-muted-foreground font-medium">
                            +{agents.length - (isNarrow ? 2 : 4)}
                          </div>
                        {/if}
                      </div>
                    {/if}

                    <!-- Activity time (hide when narrow) -->
                    {#if !isNarrow}
                      <div class="shrink-0 text-right w-8">
                        <RelativeTime
                          date={workspace.lastActivity || workspace.createdAt}
                          class="text-[11px] text-muted-foreground/50 whitespace-nowrap"
                          compact
                        />
                      </div>
                    {/if}
                  </div>
                {/if}
              </button>
            {/each}
          {/if}
        {/each}
      </div>

    </div>

    <!-- Resize handle (only when sidebar is on the right) - outside overflow-hidden container -->
    {#if isSidebarRight}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="absolute top-[30px] bottom-0 w-3 cursor-col-resize group z-50"
        style="left: {isCollapsedByDrag ? 0 : overlayWidth - 4}px;"
        onmousedown={handleResizeMouseDown}
      >
        <!-- Visible 1px line -->
        <div
          class="absolute inset-y-0 left-1/2 w-px bg-transparent group-hover:bg-primary transition-colors"
        ></div>
        <!-- Hover glow -->
        <div
          class="absolute inset-y-0 left-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-primary/10"
        ></div>
      </div>
    {/if}

    <!-- Compact mode hovercard — shows workspace info on hover when overlay is narrow -->
    {#if isCompact && hoveredWorkspace && hoveredRowRect}
      <div
        class="fixed z-50 pointer-events-none"
        style="left: {overlayWidth + 8}px; top: {hoveredRowRect.top}px;"
      >
        <WorkspaceHoverCard workspace={hoveredWorkspace} />
      </div>
    {/if}
  </div>
{/if}
