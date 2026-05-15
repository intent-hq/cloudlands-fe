<script lang="ts">
  /**
   * Spaces Switcher Overlay
   *
   * A macOS Command-Tab style overlay for switching between workspaces.
   * Shows workspaces sorted by most recently viewed with the current selection highlighted.
   * Rows match the home page WorkspaceTableRow layout for visual consistency.
   * Uses a scrollable container with auto-scroll-into-view for keyboard navigation.
   */
  import { goto } from '$app/navigation';
  import {
  fade,
  fly,
} from 'svelte/transition';
  import {
  onMount,
  tick,
} from 'svelte';
  import type { Workspace } from '$shared/types';
  import { PullRequestStatus } from '$shared/types';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import {
  selectAgentIsResponding,
  selectAgentIsWaiting,
  selectAgentSession,
} from '$lib/store/slices/agent-session/agent-session-selectors';
  import {
  selectUnreadAgentIds,
  selectUnreadAgentIdsForWorkspace,
} from '$lib/store/slices/unread-tracking/unread-tracking-selectors';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { selectPermissionRequests } from '$lib/store/slices/permission/permission-selectors';
  import {
  closeSwitcher,
  confirmSelection,
} from '$lib/store/slices/workspace-switcher/workspace-switcher-slice';
  import {
  selectSwitcherState,
  selectSwitcherWorkspaceIds,
} from '$lib/store/slices/workspace-switcher/workspace-switcher-selectors';
  import {
  selectActiveWorkspaceId,
  selectWorkspaceItems,
} from '$lib/store/slices/workspace/workspace-selectors';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import WorkspacePhaseIndicator from '$lib/components/workspace/WorkspacePhaseIndicator.svelte';
  import { deriveWorkspacePhase } from '$lib/components/workspace/workspace-phase';
  import { isPRMergeable as checkPRMergeable } from '$lib/utils/pr-status';
  import { getWorkspaceActivityDisplayTime } from '$shared/utils/workspace-activity-time';

  const dispatch = getDispatch();
  const switcherState = selectSwitcherState();
  const switcherWorkspaceIds = selectSwitcherWorkspaceIds();
  const workspaces = selectWorkspaceItems();
  const currentWorkspaceId = selectActiveWorkspaceId();
  const unreadAgentIds$ = selectUnreadAgentIds();
  const allPermissionRequests = selectPermissionRequests();
  const isOpen = $derived(!$switcherState.selectionHandled);
  const orderedWorkspaces = $derived.by(() => {
    const byId = new Map($workspaces.map((workspace) => [workspace.id, workspace]));
    return $switcherWorkspaceIds
      .map((workspaceId) => byId.get(workspaceId as Workspace["id"]))
      .filter((workspace): workspace is Workspace => workspace != null);
  });

  // Scroll container ref
  let scrollContainer: HTMLDivElement | undefined = $state();

  // Reactivity versions for subscriptions
  let activeStreamsVersion = $state(0);

  onMount(() => {
    activeStreamsTracker.startPolling();
    const unsubscribeStreams = activeStreamsTracker.subscribe(() => activeStreamsVersion++);

    return () => {
      unsubscribeStreams();
    };
  });

  // Auto-scroll selected item into view when selectedIndex changes
  $effect(() => {
    if (!isOpen || !scrollContainer) return;
    const idx = $switcherState.selectedIndex;
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

  /** Navigate to the clicked workspace and close the switcher. */
  function handleWorkspaceClick(workspace: Workspace) {
    dispatch(confirmSelection());
    dispatch(closeSwitcher());

    if (workspace.id !== $currentWorkspaceId) {
      void goto(`/workspace/${workspace.id}`);
    }
  }

  // Get display title (show "Untitled" for empty titles)
  function getDisplayTitle(workspace: Workspace): string {
    const title = workspace.title?.trim();
    return title || 'Untitled';
  }

  // Derive workspace phase info (matches WorkspaceListItem / WorkspaceTableRow logic)
  function getPhaseInfo(ws: Workspace, agents: AgentDisplayInfo[]) {
    const hasActiveAgents = agents.some((a) => a.isActive);
    return deriveWorkspacePhase(ws, { hasActiveAgents });
  }

  function getBuildProgress(ws: Workspace): number {
    const t = ws.taskStats?.total ?? 0;
    if (t === 0) return 0;
    return (ws.taskStats?.completed ?? 0) / t;
  }

  // Get agent display info for a workspace
  function getWorkspaceAgentInfo(ws: Workspace): AgentDisplayInfo[] {
    // Reference version counters for reactivity
    void activeStreamsVersion;
    void $unreadAgentIds$;
    const reduxState = getReduxStore().getState();
    const summary = ws.agentSummary;
    const summaryAgents = summary?.agents || [];
    if (summaryAgents.length === 0) return [];

    const unreadAgentIdsForWs = new Set(selectUnreadAgentIdsForWorkspace.select(reduxState, ws.id));

    return summaryAgents
      .map((agent) => {
        const loadedSession = selectAgentSession.select(reduxState, agent.id);
        const isWaiting = loadedSession
          ? selectAgentIsWaiting.select(reduxState, agent.id)
          : agent.status === 'waiting';
        const isResponding = loadedSession
          ? selectAgentIsResponding.select(reduxState, agent.id)
          : activeStreamsTracker.isAgentStreaming(agent.id) || agent.status === 'busy' || agent.status === 'processing';
        const isUnread = unreadAgentIdsForWs.has(agent.id);

        const hasPermissionRequest = $allPermissionRequests.some((r) => r.sessionId === agent.id);
        let state: AvatarState = 'idle';
        if (agent.status === 'error' || agent.status === 'failed') {
          state = 'failed';
        } else if (hasPermissionRequest) {
          state = 'needs-permission';
        } else if (isWaiting) {
          state = 'waiting';
        } else if (isResponding) {
          state = 'running';
        }

        return {
          id: agent.id,
          state,
          specialist: agent.specialist,
          isActive: isResponding && !isWaiting,
          isUnread,
        };
      })
      .filter((agent) => agent.isActive || agent.isUnread || agent.state === 'needs-permission');
  }

  // PR status helpers
  function getPrStatus(ws: Workspace): PullRequestStatus | null {
    const active = ws.activePullRequest;
    if (active) return active.status;
    if (ws.prStatus) return ws.prStatus;
    const prs = ws.pullRequests ?? [];
    if (prs.length > 0) return prs[0].status;
    return null;
  }

  function getPrNumber(ws: Workspace): number | undefined {
    return ws.activePullRequest?.number ?? ws.prNumber ?? ws.pullRequests?.[0]?.number;
  }
</script>

{#if isOpen && orderedWorkspaces.length > 0}
  <div
    class="fixed inset-0 bg-sidebar/50 backdrop-blur-xs z-50"
    transition:fade={{ duration: 150 }}
  ></div>
  <!-- Switcher Panel -->
  <div
    class="fixed top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 w-[75vw] max-w-160 z-50"
    transition:fly={{ y: 6, duration: 200 }}
    aria-label="Workspace switcher"
    role="dialog"
  >
    <div class="bg-background overflow-hidden border border-border shadow-lg">
      <!-- Scrollable workspace list -->
      <div
        bind:this={scrollContainer}
        class="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain"
      >
        {#each orderedWorkspaces as workspace, index (workspace.id)}
          {@const isSelected = index === $switcherState.selectedIndex}
          {@const isCurrent = workspace.id === $currentWorkspaceId}
          {@const agents = getWorkspaceAgentInfo(workspace)}
          {@const phaseInfo = getPhaseInfo(workspace, agents)}
          {@const progress = getBuildProgress(workspace)}
          {@const wsPrStatus = getPrStatus(workspace)}
          {@const wsPrNumber = getPrNumber(workspace)}
          {@const isMergeable = checkPRMergeable(workspace.activePullRequest)}
          {@const isRunning = agents.some((a) => a.isActive)}
          {@const isUnread = agents.some((a) => a.isUnread)}
          <button
            type="button"
            data-switcher-item
            onmousedown={() => handleWorkspaceClick(workspace)}
            class="relative w-full flex items-start gap-2 px-3 py-2 text-left transition-colors duration-75 cursor-pointer
              {isSelected ? 'bg-muted' : 'hover:bg-muted/30'}"
          >
            <!-- Left column: phase indicator -->
            <div class="flex items-center shrink-0 mt-[3px]">
              <div class="shrink-0 relative">
                <WorkspacePhaseIndicator phase={phaseInfo.phase} {progress} size={14} />
                {#if isRunning}
                  <div
                    class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-green-500 animate-pulse"
                  ></div>
                {:else if isUnread}
                  <div class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-blue-500"></div>
                {/if}
              </div>
            </div>

            <!-- Content: two rows -->
            <div class="flex-1 min-w-0 flex flex-col gap-0.5">
              <!-- Row 1: title + agents + PR + time -->
              <div class="flex items-center gap-1.5">
                <span
                  class="truncate text-[13px] flex-1 min-w-0
                    {isCurrent
                    ? 'font-medium text-foreground'
                    : workspace.title
                      ? 'text-foreground'
                      : 'text-subtle'}"
                >
                  {getDisplayTitle(workspace)}
                </span>

                <!-- Agent avatars -->
                {#if agents.length > 0}
                  <div class="flex items-center -space-x-1.5 shrink-0">
                    {#each agents.slice(0, 3) as agent (agent.id)}
                      <AugieAvatarWithState
                        agentId={agent.id}
                        state={agent.isUnread ? 'unread' : agent.state}
                        size={14}
                        specialist={agent.specialist}
                      />
                    {/each}
                    {#if agents.length > 3}
                      <div class="ml-1 text-ui text-subtle font-medium">
                        +{agents.length - 3}
                      </div>
                    {/if}
                  </div>
                {/if}

                <!-- PR status pill -->
                {#if wsPrStatus}
                  {@const statusColor =
                    wsPrStatus === PullRequestStatus.Merged
                      ? 'bg-purple-500/10 text-purple-500'
                      : wsPrStatus === PullRequestStatus.Open
                        ? isMergeable
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : 'bg-yellow-500/10 text-yellow-500'
                        : wsPrStatus === PullRequestStatus.Draft
                          ? 'bg-muted-foreground/10 text-muted-foreground'
                          : 'bg-red-500/10 text-red-500'}
                  <span class="text-ui font-medium px-1.5 py-0 rounded-full shrink-0 {statusColor}">
                    PR{wsPrNumber ? ` #${wsPrNumber}` : ''}
                  </span>
                {/if}

                {#if getWorkspaceActivityDisplayTime(workspace) > 0}
                  <RelativeTime
                    date={getWorkspaceActivityDisplayTime(workspace)}
                    class="text-ui text-subtle whitespace-nowrap shrink-0"
                    compact
                  />
                {/if}
              </div>

              <!-- Row 2: repo info -->
              {#if workspace.repositoryOwner && workspace.repositoryName}
                <div class="truncate text-ui text-subtle">
                  {workspace.repositoryOwner}/{workspace.repositoryName}
                </div>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
