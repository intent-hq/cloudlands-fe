<script lang="ts">
  import { page } from '$app/state';
  import {
  faCheck,
  faThumbtack,
  faArrowUpRightFromSquare,
  faBoxArchive,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import WorkspacePhaseIndicator from '$lib/components/workspace/WorkspacePhaseIndicator.svelte';
  import { deriveWorkspacePhase } from '$lib/components/workspace/workspace-phase';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { onDestroy } from 'svelte';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';

  import {
  incrementContextMenuOpen,
  decrementContextMenuOpen,
} from '$lib/store/slices/sidebar-nav/sidebar-nav-slice';
  import type { Workspace } from '$shared/types';
  import { PullRequestStatus } from '$shared/types';

  import {
  selectAgentIsResponding,
  selectAgentIsWaiting,
  selectAgentSession,
} from '$lib/store/slices/agent-session/agent-session-selectors';
  import {
  requestArchiveWorkspace,
  requestDeleteWorkspace,
} from '$lib/store/slices/workspace-operations/workspace-operations-slice';
  import { selectWorkspaceActivePullRequest } from '$lib/store/slices/workspace/workspace-selectors';
  import { cn } from '$lib/utils';
  import {
  isPRMergeable as checkPRMergeable,
  getPRTooltipContent,
} from '$lib/utils/pr-status';
  import { getWorkspaceActivityDisplayTime } from '$shared/utils/workspace-activity-time';
  import { store as appStore } from '$lib/store/store';

  interface Props {
    workspace: Workspace;
    isRunning?: boolean;
    isUnread?: boolean;
    isPinned?: boolean;
    streamingAgentIds?: string[];
    /** Unread agent IDs for this workspace (used to filter which agents to show) */
    unreadAgentIds?: string[];
    /** Whether to hide the repo avatar (e.g. when already grouped by repo) */
    hideRepoAvatar?: boolean;
    onMarkAsRead?: (e: MouseEvent) => void;
    onTogglePin?: (e: MouseEvent) => void;
    onClick?: (e?: MouseEvent | KeyboardEvent) => void;
    /** Called when "Open in New Window" is selected from the context menu */
    onOpenInNewWindow?: () => void;
    /** Called when the mouse enters this item */
    onHover?: () => void;
    /** Whether this item is highlighted via keyboard navigation */
    highlighted?: boolean;
    /** Whether to suppress hover styling (when keyboard navigation is active) */
    suppressHover?: boolean;
  }

  let {
    workspace,
    isRunning = false,
    isUnread = false,
    isPinned = false,
    streamingAgentIds = [],
    unreadAgentIds = [],
    hideRepoAvatar = false,
    onMarkAsRead,
    onTogglePin,
    onClick,
    onOpenInNewWindow,
    onHover,
    highlighted = false,
    suppressHover = false,
  }: Props = $props();


  const phaseInfo = $derived(deriveWorkspacePhase(workspace, { hasActiveAgents: isRunning }));
  let isCurrent = $derived(page.url.pathname === `/workspace/${workspace.id}`);
  let hoverCardVisible = $state(false);
  let rowElement: HTMLDivElement | null = $state(null);

  // Task progress for building phase pie chart (0–1)
  let buildProgress = $derived.by(() => {
    const t = workspace.taskStats?.total ?? 0;
    if (t === 0) return 0;
    return (workspace.taskStats?.completed ?? 0) / t;
  });

  // PR status - use selector for activePullRequest data
  const prStatus = $derived.by(() => {
    const activePR = selectWorkspaceActivePullRequest.select(appStore.state, workspace.id);
    if (activePR) return activePR.status;
    if (workspace.prStatus) return workspace.prStatus;
    const prs = workspace.pullRequests ?? [];
    if (prs.length > 0) return prs[0].status;
    return null;
  });
  const prNumber = $derived.by(() => {
    const activePR = selectWorkspaceActivePullRequest.select(appStore.state, workspace.id);
    return activePR?.number ?? workspace.prNumber ?? workspace.pullRequests?.[0]?.number;
  });

  // PR mergeability (optimistic: default green, only yellow for KNOWN issues)
  const isPRMergeable = $derived.by(() => {
    const activePR = selectWorkspaceActivePullRequest.select(appStore.state, workspace.id);
    return checkPRMergeable(activePR ?? undefined);
  });

  // PR tooltip content for mergeability details
  const prTooltipContent = $derived.by(() => {
    const activePR = selectWorkspaceActivePullRequest.select(appStore.state, workspace.id);
    return getPRTooltipContent(activePR ?? undefined);
  });
  // Agent info — only show unread and in-progress agents
  const activeAgentStatuses = new Set(['streaming', 'processing', 'busy', 'responding']);
  function getSummaryAgentState(agent: { id: string; status?: string }): AvatarState {
    const reduxState = appStore.state;
    const loadedSession = selectAgentSession.select(reduxState, agent.id);
    const isWaiting = loadedSession
      ? selectAgentIsWaiting.select(reduxState, agent.id)
      : agent.status === 'waiting';
    const isResponding = loadedSession
      ? selectAgentIsResponding.select(reduxState, agent.id)
      : activeAgentStatuses.has(agent.status ?? '');

    if (isWaiting) return 'waiting';
    if (isResponding) return 'running';
    return 'idle';
  }

  const agentInfos = $derived.by(() => {
    const all = workspace.agentSummary?.agents ?? [];
    const unreadSet = new Set(unreadAgentIds);
    return all.filter(
      (agent) => getSummaryAgentState(agent) !== 'idle' || unreadSet.has(agent.id),
    );
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') onClick?.(e);
  }

  function handleMouseEnter() {
    onHover?.();
    if (!suppressHover) {
      hoverCardVisible = true;
    }
  }

  function handleMouseLeave() {
    hoverCardVisible = false;
  }

  $effect(() => {
    if (suppressHover) {
      hoverCardVisible = false;
    }
  });

  // Context menu state
  let contextMenu: { x: number; y: number } | null = $state(null);

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  // Keep Redux context menu counter in sync so the hover card won't close
  // while the context menu is open (the menu renders in a Portal outside
  // the hover card's DOM, which would otherwise trigger mouseleave).
  // Note: hadContextMenu is intentionally NOT $state — it's a local
  // tracking variable that must not trigger reactivity.
  let hadContextMenu = false;

  $effect(() => {
    const isOpen = contextMenu !== null;

    if (isOpen && !hadContextMenu) {
      appStore.dispatch(incrementContextMenuOpen());
    } else if (!isOpen && hadContextMenu) {
      appStore.dispatch(decrementContextMenuOpen());
    }
    hadContextMenu = isOpen;
  });

  onDestroy(() => {
    if (hadContextMenu) {
      appStore.dispatch(decrementContextMenuOpen());
    }
  });

  function getContextMenuItems(): SidebarMenuEntry[] {
    const items: SidebarMenuEntry[] = [];

    if (onOpenInNewWindow) {
      items.push({
        id: 'open-new-window',
        label: 'Open in New Window',
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          onOpenInNewWindow?.();
          closeContextMenu();
        },
      });
    }

    items.push({
      id: 'archive',
      label: 'Archive',
      icon: faBoxArchive,
      onClick: () => {
        appStore.dispatch(requestArchiveWorkspace(workspace.id));
        closeContextMenu();
      },
    });

    items.push({
      id: 'delete',
      label: 'Delete',
      icon: faTrash,
      destructive: true,
      onClick: () => {
        appStore.dispatch(requestDeleteWorkspace(workspace.id));
        closeContextMenu();
      },
    });

    return items;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={rowElement}
  class={cn(
    'wli-root group relative flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left',
    isCurrent ? 'bg-background' : highlighted ? 'bg-sidebar' : !suppressHover && 'hover:bg-sidebar',
  )}
  role="button"
  tabindex="0"
  onclick={(e) => onClick?.(e)}
  onkeydown={handleKeydown}
  oncontextmenu={handleContextMenu}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  style:anchor-name="--workspace-list-{workspace.id}"
>
  <!-- Left column: status indicator -->
  <div class="flex items-center shrink-0 mt-[3px]">
    <div class="shrink-0 relative">
      <WorkspacePhaseIndicator phase={phaseInfo.phase} progress={buildProgress} size={14} />
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
        class="wli-title truncate text-[13px] flex-1 min-w-0
        {isCurrent
          ? 'font-medium text-foreground'
          : workspace.title
            ? 'text-foreground'
            : 'text-subtle'}"
      >
        {workspace.title || 'Untitled'}
      </span>

      <!-- Agent avatars -->
      {#if isRunning && streamingAgentIds.length > 0}
        <div class="wli-secondary flex items-center -space-x-1.5 shrink-0">
          {#each streamingAgentIds.slice(0, 3) as agentId (agentId)}
            <AugieAvatarWithState {agentId} size={14} state="running" />
          {/each}
          {#if streamingAgentIds.length > 3}
            <div class="ml-1 text-ui text-subtle font-medium">
              +{streamingAgentIds.length - 3}
            </div>
          {/if}
        </div>
      {:else if agentInfos.length > 0}
        <div class="wli-secondary flex items-center -space-x-1.5 shrink-0">
          {#each agentInfos.slice(0, 3) as agent (agent.id)}
            <AugieAvatarWithState
              agentId={agent.id}
              size={14}
              state={getSummaryAgentState(agent)}
              specialist={agent.specialist}
            />
          {/each}
          {#if agentInfos.length > 3}
            <div class="ml-1 text-ui text-subtle font-medium">
              +{agentInfos.length - 3}
            </div>
          {/if}
        </div>
      {/if}

      <!-- PR status pill -->
      {#if prStatus}
        {@const statusColor =
          prStatus === PullRequestStatus.Merged
            ? 'bg-purple-500/10 text-purple-500'
            : prStatus === PullRequestStatus.Open
              ? isPRMergeable
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
              : prStatus === PullRequestStatus.Draft
                ? 'bg-muted-foreground/10 text-muted-foreground'
                : 'bg-red-500/10 text-red-500'}
        {@const tooltipText = prTooltipContent}
        <Tooltip content={tooltipText} side="bottom" sideOffset={4} disabled={!tooltipText}>
          <span
            class="wli-secondary text-ui font-medium px-1.5 py-0 rounded-full shrink-0 {statusColor}"
          >
            PR{prNumber ? ` #${prNumber}` : ''}
          </span>
        </Tooltip>
      {/if}

      <span
        class="wli-secondary shrink-0 {onTogglePin || (isUnread && onMarkAsRead)
          ? highlighted
            ? 'opacity-0'
            : suppressHover
              ? ''
              : 'group-hover:opacity-0'
          : ''}"
      >
        {#if getWorkspaceActivityDisplayTime(workspace) > 0}
          <RelativeTime
            date={getWorkspaceActivityDisplayTime(workspace)}
            class="text-ui text-subtle whitespace-nowrap"
            compact
          />
        {/if}
      </span>
    </div>

    <!-- Row 2: repo info -->
    {#if !hideRepoAvatar && workspace.repositoryOwner && workspace.repositoryName}
      <div class="wli-repo truncate text-ui text-subtle">
        {workspace.repositoryOwner}/{workspace.repositoryName}
      </div>
    {/if}
  </div>

  <!-- Hover actions (absolute positioned) -->
  {#if onTogglePin || (isUnread && onMarkAsRead)}
    <div
      class="wli-actions absolute right-0 top-1.5 px-2 flex items-center gap-0.5 bg-[inherit]
        {highlighted
        ? 'opacity-100'
        : suppressHover
          ? 'opacity-0'
          : 'opacity-0 group-hover:opacity-100'}"
    >
      {#if isUnread && onMarkAsRead}
        <button
          class="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-ghost transition-all hover:bg-muted/50 hover:text-foreground"
          onclick={onMarkAsRead}
          aria-label="Mark as read"
          title="Mark as read"
        >
          <Fa icon={faCheck} size="xs" />
        </button>
      {/if}
      {#if onTogglePin}
        <button
          class="flex h-5 w-5 -my-1 cursor-pointer items-center justify-center rounded transition-all hover:bg-muted/50 hover:text-foreground
            {isPinned ? 'text-primary/60' : 'text-ghost'}"
          onclick={onTogglePin}
          aria-label={isPinned ? 'Unpin' : 'Pin'}
          title={isPinned ? 'Unpin from Active list' : 'Pin to Active list'}
        >
          <Fa icon={faThumbtack} size="xs" />
        </button>
      {/if}
    </div>
  {/if}
</div>

{#if hoverCardVisible && !suppressHover}
  <HoverCard
    anchor="--workspace-list-{workspace.id}"
    position="right"
    anchorElement={rowElement}
    class="w-auto border-0 bg-transparent shadow-xl"
  >
    <WorkspaceHoverCard workspace={workspace} activeAgentIds={streamingAgentIds} />
  </HoverCard>
{/if}

{#if contextMenu}
  <SidebarContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={getContextMenuItems()}
    onClickOutside={closeContextMenu}
  />
{/if}

<style>
  /* Medium: hide secondary metadata */
  @container (max-width: 220px) {
    .wli-secondary {
      display: none;
    }
    .wli-repo {
      display: none;
    }
  }

  /* Narrow: tighten spacing, shrink text */
  @container (max-width: 160px) {
    .wli-root {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
      padding-top: 0.25rem;
      padding-bottom: 0.25rem;
      gap: 0.375rem;
    }
    .wli-title {
      font-size: 12px;
    }
    .wli-actions {
      display: none;
    }
  }
</style>
