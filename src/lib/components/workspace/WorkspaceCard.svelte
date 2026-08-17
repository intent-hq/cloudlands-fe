<script lang="ts">
  import { page } from '$app/state';
  import {
    faArrowUpRightFromSquare,
    faBoxArchive,
    faCheck,
    faKeyboard,
    faRightLeft,
    faThumbtack,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import WorkspacePhaseIndicator from '$lib/components/workspace/WorkspacePhaseIndicator.svelte';
  import type { WorkspacePhaseInfo, WorkspacePhaseStats, WorkspacePhase } from './workspace-phase';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from './utils/workspace-status-presentation';
  import TaskProgressBar from './TaskProgressBar.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { Button } from '$lib/components/ui/button';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import SidebarOverflowMenu from '$lib/components/ui/sidebar-context-menu/SidebarOverflowMenu.svelte';
  import type {
    SidebarMenuEntry,
    SidebarMenuItem,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import {
    incrementContextMenuOpen,
    decrementContextMenuOpen,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import type { Workspace } from '$shared/types';
  import { PullRequestStatus } from '$shared/types';
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import {
    requestArchiveWorkspace,
    requestDeleteWorkspace,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import { openTransferModal } from '$store/renderer/slices/workspace-transfer/workspace-transfer-slice';
  import {
    markKeySlotUnassigned,
    pinWorkspaceToKey,
  } from '$store/renderer/slices/hardware-console/hardware-console-slice';
  import {
    selectWorkspacePinnedKeySlot,
    selectWorkspaceResolvedKeySlot,
  } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import { AGENT_KEY_COUNT } from '$features/hardware-console/assignment/key-assignment';
  import { microConnectedReadable } from '$features/hardware-console/device/connection-status';
  import MicroKeySlotBadge from '$lib/components/workspace/MicroKeySlotBadge.svelte';
  import { selectWorkspaceActivePullRequest } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectPrMonitors } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';
  import {
    constructPrUrl,
    countOtherMonitors,
    getPRStatusTooltip,
    mapWorkspacePRs,
    mergeMonitoredPRs,
    selectPrimaryPr,
    toPullRequestStatus,
  } from '$lib/components/workspace/sidebar/sidebar-changes-utils';
  import { cn } from '$lib/utils';
  import { isPRMergeable as checkPRMergeable, getPRTooltipContent } from '$lib/utils/pr-status';
  import { getWorkspaceActivityDisplayTime } from '$shared/utils/workspace-activity-time';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface ActionDef {
    label: string;
    action: string;
  }

  interface Props {
    workspace?: Workspace;
    phase?: WorkspacePhaseInfo;
    stats?: WorkspacePhaseStats;
    variant?: 'compact' | 'expanded' | 'header' | 'row';
    /** @deprecated Status visuals resolve from the workspace status contract. */
    isRunning?: boolean;
    isUnread?: boolean;
    /**
     * Daemon-flagged waiting workspace (grey dot; loses to running/unread).
     * Defaults to the workspace's own BE-sent `waiting` flag (PROTOCOL §5.1)
     * when not explicitly passed; an explicit value overrides the flag.
     */
    /** @deprecated Status visuals resolve from the workspace status contract. */
    isWaiting?: boolean;
    isPinned?: boolean;
    streamingAgentIds?: string[];
    /** Whether the spec note has content */
    hasSpec?: boolean;
    /** Whether the coordinator/initial agent is actively running */
    isAgentRunning?: boolean;
    /** Short digest of what the agent is doing */
    agentDigest?: string;
    /** Optional localized label shown beside the workspace title. */
    trailingLabel?: string;
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
    isRunning: _isRunning = false,
    isUnread = false,
    isWaiting: _isWaiting,
    isPinned = false,
    streamingAgentIds = [],
    hasSpec = false,
    isAgentRunning = false,
    agentDigest,
    trailingLabel,
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
  // Agent PR monitors (PROTOCOL §6.9): all monitors (active + completed) feed
  // the primary-PR pool and the "+N" other-monitored-PRs indicator — the same
  // pool every primary-PR surface uses, so pill and Overview never disagree.
  const prMonitors$ = selectPrMonitors(workspaceIdStore);

  // Micro-key slot badge/menus: only while a micro is connected (manager
  // status connected — not mere presence).
  const microConnected$ = microConnectedReadable();
  const workspaceKeySlot$ = selectWorkspaceResolvedKeySlot(workspaceIdStore);

  // Load canonical tasks for progress display (no-op once initialized).
  $effect(() => {
    const workspaceId = workspace?.id;
    if (!workspaceId) return;
    appStore.dispatch(ensureWorkspaceTasksLoaded(String(workspaceId)));
  });

  const workspaceStatusState = $derived(resolveWorkspaceStatusState(workspace ?? {}));
  const workspaceStatusPresentation = $derived(
    getWorkspaceStatusPresentation(workspaceStatusState),
  );
  let isCurrent = $derived(workspace ? page.url.pathname === `/workspace/${workspace.id}` : false);
  let hoverCardVisible = $state(false);
  let rowElement: HTMLDivElement | null = $state(null);

  const activePullRequest = $derived.by(() => {
    if (!workspace) return null;
    return selectWorkspaceActivePullRequest.select(appStore.state, workspace.id);
  });
  // Primary PR for the pill: the shared oldest-unmerged / latest-merged rule
  // (selectPrimaryPr) over the combined branch-linked + agent-monitored pool
  // (PROTOCOL §6.9).
  const primaryPr = $derived.by(() => {
    if (!workspace) return undefined;
    const ws = workspace;
    const workspaceRepo =
      ws.repositoryOwner && ws.repositoryName
        ? `${ws.repositoryOwner}/${ws.repositoryName}`
        : undefined;
    return selectPrimaryPr(
      mergeMonitoredPRs(
        mapWorkspacePRs(
          ws.pullRequests,
          activePullRequest,
          (prNum, fallbackUrl) =>
            constructPrUrl(prNum, ws.repositoryOwner, ws.repositoryName, fallbackUrl),
          (pr) => pr.title,
        ),
        $prMonitors$,
        workspaceRepo,
      ),
    );
  });
  // The branch-linked active PR keeps its tooltip/mergeability treatment only
  // when it is the chosen primary.
  const primaryIsActivePr = $derived(
    primaryPr !== undefined &&
      activePullRequest !== null &&
      !primaryPr.crossRepo &&
      !primaryPr.monitorOnly &&
      primaryPr.number === activePullRequest.number,
  );
  const prStatus = $derived.by(() => {
    if (!workspace) return null;
    if (primaryPr) return toPullRequestStatus(primaryPr.status);
    return workspace.prStatus ?? null;
  });
  const prNumber = $derived.by(() => {
    if (!workspace) return undefined;
    return primaryPr?.number ?? workspace.prNumber ?? undefined;
  });
  const isPRMergeable = $derived(
    primaryIsActivePr && checkPRMergeable(activePullRequest ?? undefined),
  );
  const prTooltipContent = $derived.by(() => {
    if (!primaryPr) return '';
    return primaryIsActivePr
      ? getPRTooltipContent(activePullRequest ?? undefined)
      : getPRStatusTooltip(primaryPr);
  });

  // "+N" indicator: other monitored PRs in the pool beyond the primary badge.
  const otherMonitoredPrCount = $derived.by(() => {
    if (!workspace) return 0;
    return countOtherMonitors(
      $prMonitors$,
      prNumber,
      workspace.repositoryOwner,
      workspace.repositoryName,
      primaryPr?.crossRepo,
    );
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
  let overflowMenuOpen = $state(false);
  let hadContextMenu = false;

  function handleContextMenu(e: MouseEvent) {
    if (!workspace) return;
    e.preventDefault();
    e.stopPropagation();
    overflowMenuOpen = false;
    contextMenu = { x: e.clientX, y: e.clientY };
  }

  function closeContextMenu() {
    contextMenu = null;
    overflowMenuOpen = false;
  }

  $effect(() => {
    if (overflowMenuOpen) contextMenu = null;
    const isOpen = contextMenu !== null || overflowMenuOpen;

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
        label: m.workspace_card_openNewWindow_label(),
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          onOpenInNewWindow?.();
          closeContextMenu();
        },
      });
    }

    if ($microConnected$) {
      const pinnedSlot = selectWorkspacePinnedKeySlot.select(appStore.state, workspace.id);
      const resolvedSlot = selectWorkspaceResolvedKeySlot.select(appStore.state, workspace.id);
      const assignSubmenu: SidebarMenuItem[] = [];
      for (let slot = 0; slot < AGENT_KEY_COUNT; slot += 1) {
        assignSubmenu.push({
          id: `assign-micro-key-${slot + 1}`,
          label: m.workspace_card_assignMicroKeyNumber_label({ number: formatInteger(slot + 1) }),
          checked: pinnedSlot === slot,
          onClick: () => {
            appStore.dispatch(pinWorkspaceToKey(slot, workspace.id));
            closeContextMenu();
          },
        });
      }
      if (resolvedSlot !== null) {
        assignSubmenu.push({
          id: 'unassign-micro-key',
          label: m.workspace_card_unassignMicroKey_label(),
          onClick: () => {
            appStore.dispatch(markKeySlotUnassigned(resolvedSlot));
            closeContextMenu();
          },
        });
      }
      items.push({
        id: 'assign-micro-key',
        label: m.workspace_card_assignMicroKey_label(),
        icon: faKeyboard,
        onClick: () => {},
        submenu: assignSubmenu,
      });
    }

    items.push({
      id: 'transfer',
      label: m.workspace_card_transfer_label(),
      icon: faRightLeft,
      onClick: () => {
        appStore.dispatch(
          openTransferModal({ workspaceId: workspace.id, workspaceTitle: workspace.title }),
        );
        closeContextMenu();
      },
    });

    items.push({
      id: 'archive',
      label: m.workspace_card_archive_label(),
      icon: faBoxArchive,
      onClick: () => {
        appStore.dispatch(requestArchiveWorkspace(workspace.id));
        closeContextMenu();
      },
    });

    items.push({
      id: 'delete',
      label: m.workspace_card_deleteSpace_label(),
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
    if (stats.pr.hasMerged)
      return m.workspace_card_prMerged_label({ number: stats.pr.number ?? '' });
    if (stats.pr.hasOpen)
      return m.workspace_card_prOpen_label({
        number: stats.pr.number ? `#${stats.pr.number}` : '',
      });
    return '';
  });

  let statusActions = $derived.by((): { primary: ActionDef; secondary: ActionDef } => {
    if (phase?.phase === 'planning') {
      if (isAgentRunning) {
        return {
          primary: { label: m.workspace_card_showCoordinator_label(), action: 'show-coordinator' },
          secondary: { label: m.workspace_card_pause_label(), action: 'pause' },
        };
      }
      if (hasSpec || (stats?.tasks.total ?? 0) > 0) {
        return {
          primary: { label: m.workspace_card_approveStart_label(), action: 'approve' },
          secondary: { label: m.workspace_card_viewSpec_label(), action: 'view-spec' },
        };
      }
      return {
        primary: { label: m.workspace_card_showCoordinator_label(), action: 'show-coordinator' },
        secondary: { label: m.workspace_card_viewSpec_label(), action: 'view-spec' },
      };
    }
    if (phase?.phase === 'building') {
      return {
        primary: { label: m.workspace_card_showCoordinator_label(), action: 'show-coordinator' },
        secondary: { label: m.workspace_card_pause_label(), action: 'pause' },
      };
    }
    if (phase?.phase === 'reviewing') {
      return {
        primary: { label: m.workspace_card_createPr_label(), action: 'create-pr' },
        secondary: { label: m.workspace_card_showChanges_label(), action: 'show-changes' },
      };
    }
    return {
      primary: { label: m.workspace_card_archive_label(), action: 'archive' },
      secondary: { label: m.workspace_card_showChanges_label(), action: 'show-changes' },
    };
  });

  const phasePillStyles: Record<WorkspacePhase, string> = {
    planning: 'bg-muted/20 text-muted-foreground',
    building: 'bg-info/15 text-info',
    reviewing: 'bg-primary/15 text-primary',
    shipped: 'bg-foreground/10 text-foreground',
  };
</script>

{#if workspace}
  <!-- The sibling Button owns keyboard activation; the wrapper delegates pointer hover/context behavior. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={rowElement}
    class={cn(
      'wc-root group relative mx-1 flex w-auto cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left font-normal transition-colors',
      isCurrent
        ? 'bg-background/60'
        : highlighted
          ? 'bg-background/50'
          : !suppressHover && 'hover:bg-background/40',
      selected && 'bg-primary/5 ring-1 ring-primary/30',
      className,
    )}
    role="group"
    data-pinned={isPinned}
    data-highlight-id={highlightId}
    use:highlightTarget={{ id: highlightId }}
    onclick={(e) => onClick?.(e)}
    onkeydown={(event) => {
      if (event.target === event.currentTarget) handleKeydown(event);
    }}
    oncontextmenu={handleContextMenu}
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
    style:anchor-name="--workspace-list-{workspace.id}"
    data-workspace-card-row
  >
    <Button
      variant="plain"
      class="absolute inset-0 z-0 h-auto w-auto rounded-md focus-visible:border-transparent focus-visible:bg-background/50 focus-visible:ring-0"
      aria-label={workspace.title || m.workspace_links_untitled_label()}
      aria-describedby={`workspace-status-state-${workspace.id}${isPinned ? ` workspace-pinned-state-${workspace.id}` : ''}`}
      aria-current={isCurrent ? 'page' : undefined}
      data-workspace-card-trigger
      onclick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    ></Button>

    <div class="relative z-10 flex shrink-0 items-center gap-1.5">
      {#if $microConnected$ && $workspaceKeySlot$ !== null}
        <MicroKeySlotBadge workspaceId={workspace.id} slot={$workspaceKeySlot$} />
      {/if}
      <Tooltip content={workspaceStatusPresentation.tooltip} side="bottom" sideOffset={4}>
        <WorkspaceStatusIcon status={workspaceStatusState} size={14} decorative />
      </Tooltip>
      <span id="workspace-status-state-{workspace.id}" class="sr-only">
        {workspaceStatusPresentation.accessibleName}
      </span>
    </div>

    <div class="relative z-10 flex min-w-0 flex-1 items-center gap-2">
      <span class="flex min-w-0 flex-1 items-center gap-1" data-workspace-card-title-group>
        <span
          class="wc-title type-body min-w-0 truncate font-normal!
          {isCurrent
            ? 'text-foreground'
            : workspace.title
              ? 'text-foreground'
              : 'text-muted-foreground'}"
          data-workspace-card-title
        >
          {workspace.title || m.workspace_links_untitled_label()}
        </span>
        {#if isPinned}
          <span
            class="wc-pin-indicator inline-flex shrink-0 items-center text-muted-foreground transition-opacity
              {onTogglePin
              ? highlighted
                ? 'opacity-0'
                : suppressHover
                  ? ''
                  : 'group-hover:opacity-0 group-focus-within:opacity-0'
              : ''}"
            data-workspace-card-pin-indicator
            aria-hidden="true"
          >
            <Fa icon={faThumbtack} size="xs" />
          </span>
          <span id="workspace-pinned-state-{workspace.id}" class="sr-only">
            {m.layout_activeCard_pinned_header()}
          </span>
        {/if}
      </span>

      {#if trailingLabel}
        <span
          class="type-caption shrink-0 rounded-sm bg-muted-foreground/10 px-1.5 font-normal text-muted-foreground"
          data-workspace-card-trailing-label
        >
          {trailingLabel}
        </span>
      {/if}

      {#if prStatus}
        {@const statusColor =
          prStatus === PullRequestStatus.Merged
            ? 'bg-success/10 text-success'
            : prStatus === PullRequestStatus.Open
              ? isPRMergeable
                ? 'bg-success/10 text-success'
                : 'bg-warning/10 text-warning'
              : prStatus === PullRequestStatus.Draft
                ? 'bg-muted text-muted-foreground'
                : 'bg-destructive/10 text-error-foreground'}
        <Tooltip
          content={prTooltipContent}
          side="bottom"
          sideOffset={4}
          disabled={!prTooltipContent}
        >
          <span
            class="wc-secondary type-caption shrink-0 rounded-sm px-1.5 font-normal tabular-nums {statusColor}"
          >
            {m.workspace_card_prBadge_label({ number: prNumber ? ` #${prNumber}` : '' })}
          </span>
        </Tooltip>
      {/if}

      {#if otherMonitoredPrCount > 0}
        <Tooltip
          content={otherMonitoredPrCount === 1
            ? m.workspace_card_morePrs_tooltip_one()
            : m.workspace_card_morePrs_tooltip_many({
                count: formatInteger(otherMonitoredPrCount),
              })}
          side="bottom"
          sideOffset={4}
        >
          <span
            class="wc-secondary type-caption shrink-0 rounded-sm bg-muted-foreground/10 px-1.5 font-normal text-muted-foreground tabular-nums"
            data-testid="workspace-card-more-prs"
          >
            {m.workspace_card_morePrs_label({ count: formatInteger(otherMonitoredPrCount) })}
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
        data-workspace-card-time
      >
        {#if getWorkspaceActivityDisplayTime(workspace) > 0}
          <RelativeTime
            date={getWorkspaceActivityDisplayTime(workspace)}
            class="type-caption whitespace-nowrap tabular-nums text-muted-foreground"
            compact
          />
        {/if}
      </span>
    </div>

    {#if actions || onOpenInNewWindow || onTogglePin || (isUnread && onMarkAsRead)}
      <div
        class="wc-actions absolute right-1 top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-accent/95 px-0.5 focus-within:opacity-100 group-focus-within:opacity-100
          {highlighted
          ? 'opacity-100'
          : suppressHover
            ? 'opacity-0'
            : 'opacity-0 group-hover:opacity-100'}"
      >
        {#if onOpenInNewWindow}
          <SidebarOverflowMenu
            bind:open={overflowMenuOpen}
            items={getContextMenuItems()}
            ariaLabel={m.workspace_progressCard_actions_ariaLabel()}
            class="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted/50 focus-visible:text-foreground focus-visible:outline-none"
          />
        {/if}
        {@render actions?.()}
        {#if isUnread && onMarkAsRead}
          <Button
            variant="plain"
            size="icon-xs"
            iconOnly
            class="text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:border-transparent focus-visible:bg-muted/50 focus-visible:text-foreground focus-visible:ring-0"
            onclick={(event) => {
              event.stopPropagation();
              onMarkAsRead?.(event);
            }}
            aria-label={m.workspace_card_markAsRead_label()}
            title={m.workspace_card_markAsRead_label()}
          >
            <Fa icon={faCheck} size="xs" />
          </Button>
        {/if}
        {#if onTogglePin}
          <Button
            variant="plain"
            size="icon-xs"
            iconOnly
            class="transition-all hover:bg-muted/50 hover:text-foreground focus-visible:border-transparent focus-visible:bg-muted/50 focus-visible:text-foreground focus-visible:ring-0
              {isPinned ? 'text-primary' : 'text-muted-foreground'}"
            onclick={(event) => {
              event.stopPropagation();
              onTogglePin?.(event);
            }}
            aria-label={isPinned
              ? m.workspace_card_unpin_ariaLabel()
              : m.workspace_card_pin_ariaLabel()}
            title={isPinned ? m.workspace_card_unpin_tooltip() : m.workspace_card_pin_tooltip()}
          >
            <span aria-hidden="true"><Fa icon={faThumbtack} size="xs" /></span>
          </Button>
        {/if}
      </div>
    {/if}
  </div>

  {#if hoverCardVisible && !suppressHover}
    <HoverCard
      anchor="--workspace-list-{workspace.id}"
      position="right"
      anchorElement={rowElement}
      class="w-auto border-0 bg-transparent"
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
    <span class="shrink-0 text-muted-foreground">·</span>
    <span class="truncate text-xs text-muted-foreground">{statusSubtitle}</span>
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
      <div class="flex items-center gap-1 truncate text-xs text-muted-foreground">
        {#if _repoName}<span class="truncate">{_repoName}</span>{/if}
        {#if _repoName && _branch}<span class="text-muted-foreground">·</span>{/if}
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
      <span class="truncate text-muted-foreground">{statusSubtitle}</span>
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
      'rounded-lg border border-border bg-sidebar text-left w-full',
      onClick && 'cursor-pointer hover:bg-sidebar/80 transition-colors',
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
        <div class="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
          {statusSubtitle}
        </div>
      </div>
    </div>

    {#if hasStats}
      <div class="flex flex-col gap-1 px-3 pb-2.5">
        {#if stats.tasks.total > 0}
          <div class="flex items-center gap-2">
            <TaskProgressBar stats={stats.tasks} barWidth="3px" barHeight="14px" class="flex-1" />
            <span class="text-ui shrink-0 tabular-nums text-muted-foreground">
              {stats.tasks.completed}/{stats.tasks.total}
            </span>
          </div>
        {/if}
        {#if stats.files.changed > 0}
          <div class="flex items-center justify-between text-ui">
            <span class="text-muted-foreground"
              >{m.workspace_card_files_label({ count: formatInteger(stats.files.changed) })}</span
            >
            <span class="tabular-nums">
              <span class="text-success">+{stats.files.additions}</span>
              <span class="ml-1 text-error-foreground">-{stats.files.deletions}</span>
            </span>
          </div>
        {/if}
        {#if stats.commits.total > 0}
          <div class="flex items-center justify-between text-ui">
            <span class="text-muted-foreground"
              >{m.workspace_card_commits_label({ count: formatInteger(stats.commits.total) })}</span
            >
          </div>
        {/if}
        {#if statusPrLabel}
          <div class="flex items-center text-ui">
            <span
              class={cn(
                'inline-flex items-center gap-1',
                stats.pr.hasMerged ? 'text-primary' : 'text-success',
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
          class="h-7 text-xs text-muted-foreground"
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
    .wc-pin-indicator {
      opacity: 1 !important;
    }
  }
</style>
