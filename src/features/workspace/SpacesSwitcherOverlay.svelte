<script lang="ts">
  /**
   * Spaces Switcher Overlay
   *
   * A macOS Command-Tab style overlay for switching between workspaces.
   * Shows workspaces sorted by most recently viewed with the current selection highlighted.
   * Rows match the home page WorkspaceTableRow layout for visual consistency.
   * Uses a scrollable container with auto-scroll-into-view for keyboard navigation.
   */
  import { fade, fly } from 'svelte/transition';
  import { onMount, tick } from 'svelte';
  import type { Workspace } from '$shared/types';
  import { PullRequestStatus } from '$shared/types';
  import Fa from 'svelte-fa';
  import {
    faCodeCommit,
    faCodePullRequest,
    faFolder,
    faPlusMinus,
  } from '@fortawesome/free-solid-svg-icons';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import { pendingAgentsStore } from '$features/agent/services/pending-agents.store.svelte';
  import WorkspaceStatusIcon, {
    type WorkspaceDisplayStatus,
  } from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { permissionStore } from '$lib/stores/permission.store.svelte';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';

  interface Props {
    isOpen: boolean;
    /** All workspaces to display */
    workspaces: Workspace[];
    /** Selected index in the full list */
    selectedIndex: number;
    /** The currently active workspace ID */
    currentWorkspaceId?: string | null;
  }

  let { isOpen, workspaces, selectedIndex, currentWorkspaceId = null }: Props = $props();

  // Scroll container ref
  let scrollContainer: HTMLDivElement | undefined = $state();

  // Reactivity versions for subscriptions
  let activeStreamsVersion = $state(0);
  let unreadVersion = $state(0);

  onMount(() => {
    activeStreamsTracker.startPolling(2000);
    const unsubscribeStreams = activeStreamsTracker.subscribe(() => activeStreamsVersion++);
    const unsubscribeUnread = unreadTrackingService.subscribe(() => unreadVersion++);

    return () => {
      unsubscribeStreams();
      unsubscribeUnread();
    };
  });

  // Auto-scroll selected item into view when selectedIndex changes
  $effect(() => {
    if (!isOpen || !scrollContainer) return;
    // Track selectedIndex to trigger effect
    const idx = selectedIndex;
    tick().then(() => {
      const items = scrollContainer?.querySelectorAll('[data-switcher-item]');
      const target = items?.[idx];
      target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  });

  // Agent display info
  interface AgentDisplayInfo {
    id: string;
    state: AvatarState;
    specialist?: BuiltinSpecialistId | null;
    isActive: boolean;
    isUnread: boolean;
  }

  /** Dispatch selection event - keyboard manager listens for this */
  function handleWorkspaceClick(workspace: Workspace) {
    window.dispatchEvent(new CustomEvent('spaces-switcher:select', { detail: { workspace } }));
  }

  // Get display title (show "Untitled" for empty titles)
  function getDisplayTitle(workspace: Workspace): string {
    const title = workspace.title?.trim();
    return title || 'Untitled';
  }

  // Compute workspace display status (matches WorkspaceTableRow logic)
  function getWorkspaceDisplayStatus(
    ws: Workspace,
    agents: AgentDisplayInfo[],
  ): WorkspaceDisplayStatus {
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
    const total = taskStats?.total || 0;
    const completed = taskStats?.completed || 0;

    if (total > 0 && completed === total) return 'complete';

    const hasActiveAgents = agents.some((a) => a.isActive);
    const hasProgress = completed > 0 || (taskStats?.inProgress || 0) > 0;
    if (hasActiveAgents || hasProgress) return 'in_progress';

    return 'not_started';
  }

  // Get agent display info for a workspace
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

  // Derived helpers matching WorkspaceTableRow
  function hasChanges(ws: Workspace): boolean {
    return !!(ws.diffSummary && ws.diffSummary.totalFiles > 0);
  }

  function hasPR(ws: Workspace): boolean {
    const pullRequests = ws.pullRequests || [];
    return (
      pullRequests.length > 0 || !!ws.activePullRequest || ws.prStatus === PullRequestStatus.Open
    );
  }

  function getCommitCount(ws: Workspace): number {
    return ws.gitSummary?.ahead || 0;
  }
</script>

{#if isOpen && workspaces.length > 0}
  <div
    class="fixed inset-0 bg-sidebar/50 backdrop-blur-xs z-50"
    transition:fade={{ duration: 150 }}
  ></div>
  <!-- Switcher Panel -->
  <div
    class="fixed top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 w-[75vw] max-w-160 z-50"
    transition:fly={{ y: 6, duration: 200 }}
  >
    <div class="bg-background overflow-hidden border border-border shadow-lg">
      <!-- Scrollable workspace list -->
      <div
        bind:this={scrollContainer}
        class="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain"
      >
        {#each workspaces as workspace, index (workspace.id)}
          {@const isSelected = index === selectedIndex}
          {@const isCurrent = workspace.id === currentWorkspaceId}
          {@const agents = getWorkspaceAgentInfo(workspace)}
          {@const workspaceStatus = getWorkspaceDisplayStatus(workspace, agents)}
          {@const wsHasChanges = hasChanges(workspace)}
          {@const wsHasPR = hasPR(workspace)}
          {@const commitCount = getCommitCount(workspace)}
          <button
            type="button"
            data-switcher-item
            onmousedown={() => handleWorkspaceClick(workspace)}
            class="relative w-full flex items-center gap-2 pl-3 pr-5 py-2 text-left transition-colors duration-75 cursor-pointer
              {isSelected ? 'bg-muted' : 'hover:bg-muted/30'}"
          >
            <!-- Org avatar -->
            {#if workspace.repositoryOwner}
              <img
                src={`https://github.com/${workspace.repositoryOwner}.png?size=32`}
                alt={workspace.repositoryOwner}
                class="w-5 h-5 rounded-full shrink-0"
                loading="lazy"
                onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
            {:else}
              <span class="text-muted-foreground/50 shrink-0 w-5 flex justify-center">
                <Fa icon={faFolder} size="sm" />
              </span>
            {/if}

            <!-- Status indicator -->
            <div class="shrink-0 ml-0.5 mr-1">
              <WorkspaceStatusIcon status={workspaceStatus} size={12} />
            </div>

            <!-- Title -->
            <div class="flex-1 min-w-0 pr-2">
              <span
                class="text-[13px] text-foreground truncate block
                  {!workspace.title ? 'text-muted-foreground/70' : ''}
                  {isCurrent ? 'font-medium' : ''}"
              >
                {getDisplayTitle(workspace)}
              </span>
            </div>

            <!-- Line changes indicator -->
            {#if wsHasChanges}
              <span class="text-muted-foreground/50 shrink-0">
                <Fa icon={faPlusMinus} size="xs" />
              </span>
            {/if}

            <!-- Commits ahead indicator -->
            {#if commitCount > 0}
              <span class="text-muted-foreground/50 shrink-0">
                <Fa icon={faCodeCommit} size="xs" />
              </span>
            {/if}

            <!-- PR indicator -->
            {#if wsHasPR}
              <span class="text-muted-foreground/50 shrink-0">
                <Fa icon={faCodePullRequest} size="xs" />
              </span>
            {/if}

            <!-- Agent avatars -->
            {#if agents.length > 0}
              <div class="flex items-center -space-x-1.5 shrink-0">
                {#each agents.slice(0, 4) as agent (agent.id)}
                  <AugieAvatarWithState
                    agentId={agent.id}
                    state={agent.isUnread ? 'unread' : agent.state}
                    size={16}
                    specialist={agent.specialist}
                  />
                {/each}
                {#if agents.length > 4}
                  <div class="ml-1.5 text-[10px] text-muted-foreground font-medium">
                    +{agents.length - 4}
                  </div>
                {/if}
              </div>
            {/if}

            <!-- Activity time -->
            <div class="shrink-0 w-8 text-right">
              <RelativeTime
                date={workspace.lastActivity || workspace.createdAt}
                class="text-[0.82rem] text-muted-foreground/70 whitespace-nowrap"
                compact
              />
            </div>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
