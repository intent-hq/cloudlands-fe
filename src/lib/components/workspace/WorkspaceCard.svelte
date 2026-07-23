<script lang="ts">
  import { page } from '$app/state';
  import {
    faArrowUpRightFromSquare,
    faBoxArchive,
    faCheck,
    faThumbtack,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import WorkspacePhaseIndicator from '$lib/components/workspace/WorkspacePhaseIndicator.svelte';
  import { deriveWorkspacePhase } from '$lib/components/workspace/workspace-phase';
  import type { WorkspacePhaseInfo, WorkspacePhaseStats, WorkspacePhase } from './workspace-phase';
  import TaskProgressBar from './TaskProgressBar.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import {
    incrementContextMenuOpen,
    decrementContextMenuOpen,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import type { Workspace } from '$shared/types';
  import { PullRequestStatus } from '$shared/types';
  import {
    getWorkspaceAgentDisplayInfos,
    type WorkspaceAgentDisplayInfo,
  } from './utils/workspace-agent-display';
  import { writable } from 'svelte/store';
  import { store as appStore } from "$store/renderer/store";
  import {
    selectAgentIsResponding,
    selectAgentIsWaiting,
    selectAgentSession,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectWorkspaceTaskProgress } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import {
    requestArchiveWorkspace,
    requestDeleteWorkspace,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import { selectWorkspaceActivePullRequest } from '$store/renderer/slices/workspace/workspace-selectors';
  import { cn } from '$lib/utils';
  import { isPRMergeable as checkPRMergeable, getPRTooltipContent } from '$lib/utils/pr-status';
  import { getWorkspaceActivityDisplayTime } from '$shared/utils/workspace-activity-time';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';

  interface ActionDef {
    label: string;
    action: string;
  }

  interface Props {
    workspace?: Workspace;
    phase?: WorkspacePhaseInfo;
    stats?: WorkspacePhaseStats;
    variant?: 'compact' | 'expanded' | 'header' | 'row';
    isRunning?: boolean;
    isUnread?: boolean;
    isPinned?: boolean;
    streamingAgentIds?: string[];
    /** Unread agent IDs for this workspace (used to filter which agents to show) */
    unreadAgentIds?: string[];
    /** Whether to hide the repo avatar (e.g. when already grouped by repo) */
    hideRepoAvatar?: boolean;
    /** Whether the spec note has content */
    hasSpec?: boolean;
    /** Whether the coordinator/initial agent is actively running */
    isAgentRunning?: boolean;
    /** Short digest of what the agent is doing */
    agentDigest?: string;
    title?: string;
    repoName?: string;
    branch?: string;
    onClick?: (e?: MouseEvent | KeyboardEvent) => void;
    onAction?: (action: string) => void;
    /** Called when the pin/unpin hover button is clicked (compact variant) */
    onTogglePin?: (e: MouseEvent) => void;
    /** Called when the mark-as-read hover button is clicked (compact variant, unread rows) */
    onMarkAsRead?: (e: MouseEvent) => void;
    /** Called when "Open in New Window" is selected from the context menu */
    onOpenInNewWindow?: () => void;
    /** Called when the mouse enters this item */
    onHover?: () => void;
    /** Highlighted by keyboard navigation or deep-linked UI highlight state */
    highlighted?: boolean;
    /** Selected for bulk operations */
    selected?: boolean;
    /** Stable ID used by app-level highlight navigation */
    highlightId?: string;
    /** Whether to suppress hover styling (when keyboard navigation is active) */
    suppressHover?: boolean;
    class?: string;
    actions?: Snippet;
  }

  let {
    workspace,
    phase,
    stats,
    variant = 'compact',
    isRunning = false,
    isUnread = false,
    isPinned = false,
    streamingAgentIds = [],
    unreadAgentIds = [],
    hideRepoAvatar = false,
    hasSpec = false,
    isAgentRunning = false,
    agentDigest,
    title: _title,
    repoName: _repoName,
    branch: _branch,
    onClick,
    onAction,
    onTogglePin,
    onMarkAsRead,
    onOpenInNewWindow,
    onHover,
    highlighted = false,
    selected = false,
    highlightId,
    suppressHover = false,
    class: className,
    actions,
  }: Props = $props();

  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspace?.id ?? '');
  });
  const workspaceTaskProgress$ = selectWorkspaceTaskProgress(workspaceIdStore);

  // Load canonical tasks for progress display (no-op once initialized).
  $effect(() => {
    const workspaceId = workspace?.id;
    if (!workspaceId) return;
    appStore.dispatch(ensureWorkspaceTasksLoaded(String(workspaceId)));
  });

  const workspacePhaseInfo = $derived(
    workspace
      ? deriveWorkspacePhase(workspace, {
          hasActiveAgents: isRunning,
          taskProgress: $workspaceTaskProgress$,
        })
      : undefined,
  );
  const workspaceBuildProgress = $derived.by(() => {
    const { total, completed } = $workspaceTaskProgress$;
    if (total === 0) return 0;
    return completed / total;
  });
  let isCurrent = $derived(workspace ? page.url.pathname === `/workspace/${workspace.id}` : false);
  let hoverCardVisible = $state(false);
  let rowElement: HTMLDivElement | null = $state(null);

  const prStatus = $derived.by(() => {
    if (!workspace) return null;
    const activePR = selectWorkspaceActivePullRequest.select(
      appStore.state,
      workspace.id,
    );
    if (activePR) return activePR.status;
    if (workspace.prStatus) return workspace.prStatus;
    const prs = workspace.pullRequests ?? [];
    if (prs.length > 0) return prs[0].status;
    return null;
  });
  const prNumber = $derived.by(() => {
    if (!workspace) return undefined;
    const activePR = selectWorkspaceActivePullRequest.select(
      appStore.state,
      workspace.id,
    );
    return activePR?.number ?? workspace.prNumber ?? workspace.pullRequests?.[0]?.number;
  });
  const isPRMergeable = $derived.by(() => {
    if (!workspace) return false;
    const activePR = selectWorkspaceActivePullRequest.select(
      appStore.state,
      workspace.id,
    );
    return checkPRMergeable(activePR ?? undefined);
  });
  const prTooltipContent = $derived.by(() => {
    if (!workspace) return '';
    const activePR = selectWorkspaceActivePullRequest.select(
      appStore.state,
      workspace.id,
    );
    return getPRTooltipContent(activePR ?? undefined);
  });

  const agentInfos = $derived.by(() => {
    const reduxState = appStore.state;
    return getWorkspaceAgentDisplayInfos({
      memberAgentIds: workspace?.agentSummary?.agentIds ?? [],
      unreadAgentIds,
      workspaceActivity: workspace?.activity,
      getAgentSnapshot: (agentId) => {
        const loadedSession = selectAgentSession.select(reduxState, agentId);
        return {
          hasLoadedSession: !!loadedSession,
          isWaiting: loadedSession ? selectAgentIsWaiting.select(reduxState, agentId) : false,
          isResponding: loadedSession
            ? selectAgentIsResponding.select(reduxState, agentId)
            : false,
          isStreamingFallback: streamingAgentIds.includes(agentId),
          sessionStatus: loadedSession?.status as string | undefined,
          specialist: (loadedSession?.metadata?.specialist ??
            null) as WorkspaceAgentDisplayInfo['specialist'],
        };
      },
    });
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') onClick?.(e);
  }

  function handleMouseEnter() {
    onHover?.();
    if (workspace && !suppressHover) hoverCardVisible = true;
  }

  function handleMouseLeave() {
    hoverCardVisible = false;
  }

  $effect(() => {
    if (suppressHover) hoverCardVisible = false;
  });

  let contextMenu: { x: number; y: number } | null = $state(null);
  let hadContextMenu = false;

  function handleContextMenu(e: MouseEvent) {
    if (!workspace) return;
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

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
    if (hadContextMenu) appStore.dispatch(decrementContextMenuOpen());
  });

  function getContextMenuItems(): SidebarMenuEntry[] {
    if (!workspace) return [];
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
      label: 'Delete Space…',
      icon: faTrash,
      destructive: true,
      onClick: () => {
        appStore.dispatch(requestDeleteWorkspace(workspace.id));
        closeContextMenu();
      },
    });

    return items;
  }

  let statusSubtitle = $derived(
    isAgentRunning && agentDigest ? agentDigest : (phase?.subtitle ?? ''),
  );
  let statusBuildProgress = $derived(
    stats && stats.tasks.total > 0 ? stats.tasks.completed / stats.tasks.total : 0,
  );
  let hasStats = $derived(
    !!stats &&
      (stats.tasks.total > 0 ||
        stats.files.changed > 0 ||
        stats.commits.total > 0 ||
        stats.pr.hasOpen ||
        stats.pr.hasMerged),
  );
  let statusPrLabel = $derived.by(() => {
    if (!stats) return '';
    if (stats.pr.hasMerged) return `PR #${stats.pr.number ?? ''} merged`;
    if (stats.pr.hasOpen) return `PR ${stats.pr.number ? `#${stats.pr.number}` : ''} open`;
    return '';
  });

  let statusActions = $derived.by((): { primary: ActionDef; secondary: ActionDef } => {
    if (phase?.phase === 'planning') {
      if (isAgentRunning) {
        return {
          primary: { label: 'Show Coordinator', action: 'show-coordinator' },
          secondary: { label: 'Pause', action: 'pause' },
        };
      }
      if (hasSpec || (stats?.tasks.total ?? 0) > 0) {
        return {
          primary: { label: 'Approve & Start', action: 'approve' },
          secondary: { label: 'View Spec', action: 'view-spec' },
        };
      }
      return {
        primary: { label: 'Show Coordinator', action: 'show-coordinator' },
        secondary: { label: 'View Spec', action: 'view-spec' },
      };
    }
    if (phase?.phase === 'building') {
      return {
        primary: { label: 'Show Coordinator', action: 'show-coordinator' },
        secondary: { label: 'Pause', action: 'pause' },
      };
    }
    if (phase?.phase === 'reviewing') {
      return {
        primary: { label: 'Create PR', action: 'create-pr' },
        secondary: { label: 'Show changes', action: 'show-changes' },
      };
    }
    return {
      primary: { label: 'Archive', action: 'archive' },
      secondary: { label: 'Show changes', action: 'show-changes' },
    };
  });

  const phasePillStyles: Record<WorkspacePhase, string> = {
    planning: 'bg-muted/20 text-subtle',
    building: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    reviewing: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
    shipped: 'bg-foreground/10 text-foreground',
  };
</script>

{#if workspace}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={rowElement}
    class={cn(
      'wc-root group relative flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left',
      isCurrent
        ? 'bg-background'
        : highlighted
          ? 'bg-sidebar'
          : !suppressHover && 'hover:bg-sidebar',
      selected && 'bg-primary/5 ring-1 ring-primary/30',
      className,
    )}
    role="button"
    tabindex="0"
    data-highlight-id={highlightId}
    use:highlightTarget={{ id: highlightId }}
    onclick={(e) => onClick?.(e)}
    onkeydown={handleKeydown}
    oncontextmenu={handleContextMenu}
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
    style:anchor-name="--workspace-list-{workspace.id}"
  >
    <div class="flex items-center shrink-0 mt-[3px]">
      <div class="shrink-0 relative">
        <WorkspacePhaseIndicator
          phase={workspacePhaseInfo?.phase ?? 'planning'}
          progress={workspaceBuildProgress}
          size={14}
        />
        {#if isRunning}
          <div
            class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-green-500 animate-pulse"
          ></div>
        {:else if isUnread}
          <div class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-blue-500"></div>
        {/if}
      </div>
    </div>

    <div class="flex-1 min-w-0 flex flex-col gap-0.5">
      <div class="flex items-center gap-1.5">
        <span
          class="wc-title truncate text-[13px] flex-1 min-w-0
          {isCurrent
            ? 'font-medium text-foreground'
            : workspace.title
              ? 'text-foreground'
              : 'text-subtle'}"
        >
          {workspace.title || 'Untitled'}
        </span>

        {#if isRunning && streamingAgentIds.length > 0 && workspace?.activity !== 'idle'}
          <div class="wc-secondary flex items-center -space-x-1.5 shrink-0">
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
          <div class="wc-secondary flex items-center -space-x-1.5 shrink-0">
            {#each agentInfos.slice(0, 3) as agent (agent.id)}
              <AugieAvatarWithState
                agentId={agent.id}
                size={14}
                state={agent.state}
                specialist={agent.specialist}
              />
            {/each}
            {#if agentInfos.length > 3}
              <div class="ml-1 text-ui text-subtle font-medium">+{agentInfos.length - 3}</div>
            {/if}
          </div>
        {/if}

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
          <Tooltip
            content={prTooltipContent}
            side="bottom"
            sideOffset={4}
            disabled={!prTooltipContent}
          >
            <span
              class="wc-secondary text-ui font-medium px-1.5 py-0 rounded-full shrink-0 {statusColor}"
            >
              PR{prNumber ? ` #${prNumber}` : ''}
            </span>
          </Tooltip>
        {/if}

        <span
          class="wc-secondary shrink-0 {actions || onTogglePin || (isUnread && onMarkAsRead)
            ? highlighted
              ? 'opacity-0'
              : suppressHover
                ? ''
                : 'group-hover:opacity-0 group-hover/message:opacity-0'
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

      {#if !hideRepoAvatar && workspace.repositoryOwner && workspace.repositoryName}
        <div class="wc-repo truncate text-ui text-subtle">
          {workspace.repositoryOwner}/{workspace.repositoryName}
        </div>
      {/if}
    </div>

    {#if actions || onTogglePin || (isUnread && onMarkAsRead)}
      <div
        class="wc-actions absolute right-0 top-1.5 px-2 flex items-center gap-0.5
          {highlighted
          ? 'opacity-100'
          : suppressHover
            ? 'opacity-0'
            : 'opacity-0 group-hover:opacity-100'}"
      >
        {@render actions?.()}
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
      <WorkspaceHoverCard {workspace} activeAgentIds={streamingAgentIds} />
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
{:else if phase && stats && variant === 'row'}
  <button
    type="button"
    class={cn(
      'flex items-center gap-2 w-full min-w-0 text-left text-sm py-1',
      onClick && 'cursor-pointer transition-colors rounded',
      !onClick && 'cursor-default',
      highlighted && 'bg-sidebar',
      selected && 'bg-primary/5 ring-1 ring-primary/30',
      className,
    )}
    data-highlight-id={highlightId}
    use:highlightTarget={{ id: highlightId }}
    onclick={onClick}
    disabled={!onClick}
  >
    <WorkspacePhaseIndicator
      phase={phase.phase}
      progress={statusBuildProgress}
      size={14}
      class="shrink-0"
    />
    <span class="font-medium truncate">{phase.label}</span>
    <span class="text-ghost shrink-0">·</span>
    <span class="text-subtle truncate text-xs">{statusSubtitle}</span>
    {@render actions?.()}
  </button>
{:else if phase && stats && variant === 'header'}
  <div
    class={cn(
      'flex flex-col gap-1.5 w-full min-w-0',
      highlighted && 'bg-sidebar rounded',
      selected && 'bg-primary/5 ring-1 ring-primary/30 rounded',
      className,
    )}
    data-highlight-id={highlightId}
    use:highlightTarget={{ id: highlightId }}
  >
    {#if _title}
      <div class="text-sm font-semibold truncate">{_title}</div>
    {/if}
    {#if _repoName || _branch}
      <div class="flex items-center gap-1 text-xs text-subtle truncate">
        {#if _repoName}<span class="truncate">{_repoName}</span>{/if}
        {#if _repoName && _branch}<span class="text-ghost">·</span>{/if}
        {#if _branch}<span class="truncate">{_branch}</span>{/if}
      </div>
    {/if}
    <div class="flex items-center gap-2 text-xs">
      <WorkspacePhaseIndicator
        phase={phase.phase}
        progress={statusBuildProgress}
        size={12}
        class="shrink-0"
      />
      <span class="text-subtle truncate">{statusSubtitle}</span>
      <span
        class={cn(
          'inline-flex items-center px-1.5 py-px rounded-full text-ui font-medium shrink-0 ml-auto',
          phasePillStyles[phase.phase],
        )}>{phase.label}</span
      >
    </div>
    {@render actions?.()}
  </div>
{:else if phase && stats}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
  <div
    class={cn(
      'rounded-lg border border-border/50 bg-background text-left w-full',
      onClick && 'cursor-pointer hover:bg-background/80 transition-colors',
      highlighted && 'ring-1 ring-primary/40',
      selected && 'bg-primary/5 ring-1 ring-primary/30',
      className,
    )}
    data-highlight-id={highlightId}
    use:highlightTarget={{ id: highlightId }}
    onclick={onClick}
    onkeydown={handleKeydown}
    role="button"
    tabindex={onClick ? 0 : undefined}
  >
    <div class="flex items-start gap-2.5 px-3 pt-3 pb-2">
      <WorkspacePhaseIndicator
        phase={phase.phase}
        progress={statusBuildProgress}
        size={16}
        class="shrink-0 mt-0.5"
      />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium">{phase.label}</div>
        <div class="text-xs text-subtle mt-0.5 leading-snug line-clamp-2">{statusSubtitle}</div>
      </div>
    </div>

    {#if hasStats}
      <div class="flex flex-col gap-1 px-3 pb-2.5">
        {#if stats.tasks.total > 0}
          <div class="flex items-center gap-2">
            <TaskProgressBar stats={stats.tasks} barWidth="3px" barHeight="14px" class="flex-1" />
            <span class="text-ui text-subtle shrink-0 tabular-nums">
              {stats.tasks.completed}/{stats.tasks.total}
            </span>
          </div>
        {/if}
        {#if stats.files.changed > 0}
          <div class="flex items-center justify-between text-ui">
            <span class="text-subtle">{stats.files.changed} files</span>
            <span class="tabular-nums">
              <span class="text-green-500/70">+{stats.files.additions}</span>
              <span class="text-red-500/70 ml-1">-{stats.files.deletions}</span>
            </span>
          </div>
        {/if}
        {#if stats.commits.total > 0}
          <div class="flex items-center justify-between text-ui">
            <span class="text-subtle">{stats.commits.total} commits</span>
          </div>
        {/if}
        {#if statusPrLabel}
          <div class="flex items-center text-ui">
            <span
              class={cn(
                'inline-flex items-center gap-1',
                stats.pr.hasMerged ? 'text-purple-500/70' : 'text-green-500/70',
              )}>{statusPrLabel}</span
            >
          </div>
        {/if}
      </div>
    {/if}

    {#if actions}
      <div class="flex items-center gap-1.5 px-2 pb-2">
        {@render actions()}
      </div>
    {:else if onAction}
      <div class="flex items-center gap-1.5 px-2 pb-2">
        <Button
          class="flex-1 h-7 text-xs"
          variant="outline"
          size="sm"
          onclick={(e) => {
            e.stopPropagation();
            onAction?.(statusActions.primary.action);
          }}>{statusActions.primary.label}</Button
        >
        <Button
          class="h-7 text-xs text-subtle"
          variant="ghost"
          size="sm"
          onclick={(e) => {
            e.stopPropagation();
            onAction?.(statusActions.secondary.action);
          }}>{statusActions.secondary.label}</Button
        >
      </div>
    {/if}
  </div>
{/if}

<style>
  @container (max-width: 220px) {
    .wc-secondary {
      display: none;
    }
    .wc-repo {
      display: none;
    }
  }

  @container (max-width: 160px) {
    .wc-root {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
      padding-top: 0.25rem;
      padding-bottom: 0.25rem;
      gap: 0.375rem;
    }
    .wc-title {
      font-size: 12px;
    }
    .wc-actions {
      display: none;
    }
  }
</style>
