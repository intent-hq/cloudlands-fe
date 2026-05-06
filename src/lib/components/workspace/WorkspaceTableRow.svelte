<script lang="ts">
  /**
   * WorkspaceTableRow - A single workspace row in the table view
   */
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { cn } from '$lib/utils';
  import type { Workspace } from '$shared/types';
  import { PullRequestStatus, WorkspaceStatusEnum } from '$shared/types';
  import { isPRMergeable as checkPRMergeable, getPRTooltipContent } from '$lib/utils/pr-status';
  import { faBoxArchive, faBoxOpen, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '../ui/button/button.svelte';

  import AgentCard from '$lib/components/chat/AgentCard.svelte';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { deriveWorkspacePhase } from './workspace-phase';
  import WorkspacePhaseIndicator from './WorkspacePhaseIndicator.svelte';

  // Agent display info with computed avatar state
  interface AgentDisplayInfo {
    id: string;
    state: AvatarState;
    specialist?: 'spec-writer' | 'implementor' | 'verifier' | null;
    isActive: boolean;
    isUnread: boolean;
  }

  interface Props {
    workspace: Workspace;
    agents: AgentDisplayInfo[];
    isLastInGroup?: boolean;
    showRepoAvatar?: boolean;
    groupByRepo?: boolean;
    onOpen: (workspace: Workspace, event?: MouseEvent) => void;
    onDelete?: (workspace: Workspace) => void;
    onArchive?: (workspace: Workspace) => void;
    onUnarchive?: (workspace: Workspace) => void;
  }

  let {
    workspace: ws,
    agents,
    isLastInGroup = false,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    showRepoAvatar = false,
    groupByRepo = false,
    onOpen,
    onDelete,
    onArchive,
    onUnarchive,
  }: Props = $props();

  // Check if workspace is archived
  const isArchived = $derived(ws.status === WorkspaceStatusEnum.Archived);

  // Compute workspace phase
  const workspacePhase = $derived.by(() => {
    const hasActiveAgents = agents.some((a) => a.isActive);
    return deriveWorkspacePhase(ws, { hasActiveAgents });
  });

  // Task progress for building phase pie chart (0–1)
  const buildProgress = $derived.by(() => {
    const t = ws.taskStats?.total ?? 0;
    if (t === 0) return 0;
    return (ws.taskStats?.completed ?? 0) / t;
  });

  // PR status
  const prDisplayStatus = $derived.by(() => {
    const active = ws.activePullRequest;
    if (active) return active.status;
    if (ws.prStatus) return ws.prStatus;
    const prs = ws.pullRequests ?? [];
    if (prs.length > 0) return prs[0].status;
    return null;
  });
  const prDisplayNumber = $derived(
    ws.activePullRequest?.number ?? ws.prNumber ?? ws.pullRequests?.[0]?.number,
  );

  const isPRMergeable = $derived.by(() => checkPRMergeable(ws.activePullRequest));

  const prTooltipContent = $derived.by(() => getPRTooltipContent(ws.activePullRequest));

  // Hover state for agent cards
  let hoveredAgentId: string | null = $state(null);
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleAgentMouseEnter(agentId: string) {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoveredAgentId = agentId;
  }

  function handleAgentMouseLeave() {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      hoveredAgentId = null;
    }, 100);
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    onDelete?.(ws);
  }

  function handleArchive(e: MouseEvent) {
    e.stopPropagation();
    if (isArchived) {
      onUnarchive?.(ws);
    } else {
      onArchive?.(ws);
    }
  }
</script>

<div class="group relative">
  <button
    class={cn(
      'relative flex flex-col w-full min-w-0 pl-4.75 pr-5 py-3 text-left cursor-pointer transition-colors',
      isArchived ? 'bg-sidebar hover:bg-muted/20' : 'hover:bg-muted/30',
    )}
    onclick={(e) => onOpen(ws, e)}
  >
    {#if !isLastInGroup}
      <div class="absolute bottom-0 left-5 right-5 h-px bg-border/40"></div>
    {/if}

    <div class="flex min-w-0 items-start w-full gap-2.5">
      <!-- Left: phase indicator -->
      <div class="flex items-center shrink-0 pt-0.5">
        <WorkspacePhaseIndicator phase={workspacePhase.phase} progress={buildProgress} />
      </div>

      <!-- Right: content - two rows -->
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <!-- Row 1: title + agents + PR + time -->
        <div class="flex min-w-0 items-center gap-2">
          <span
            class={cn(
              'text-base font-medium truncate flex-1 min-w-0',
              ws.archived || !ws.title ? 'text-muted-foreground' : 'text-foreground',
            )}
            title={ws.title || 'Untitled'}>{ws.title || 'Untitled'}</span
          >

          <!-- Agent avatars -->
          {#if agents.length > 0}
            <div class="flex items-center -space-x-1.5 shrink-0 pr-1">
              {#each agents.slice(0, 4) as agent (agent.id)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="relative flex"
                  style:anchor-name="--agent-row-{ws.id}-{agent.id}"
                  onmouseenter={() => handleAgentMouseEnter(agent.id)}
                  onmouseleave={handleAgentMouseLeave}
                >
                  <AugieAvatarWithState
                    agentId={agent.id}
                    state={agent.isUnread ? 'unread' : 'running'}
                    size={16}
                    specialist={agent.specialist}
                  />
                </div>
              {/each}
              {#if agents.length > 4}
                <div
                  class="ml-1.5 flex items-center justify-center text-ui text-subtle font-medium"
                >
                  +{agents.length - 4}
                </div>
              {/if}
            </div>
          {/if}

          <!-- PR status pill -->
          {#if prDisplayStatus}
            {@const statusColor =
              prDisplayStatus === PullRequestStatus.Merged
                ? 'bg-purple-500/10 text-purple-500'
                : prDisplayStatus === PullRequestStatus.Open
                  ? isPRMergeable
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                  : prDisplayStatus === PullRequestStatus.Draft
                    ? 'bg-muted-foreground/10 text-muted-foreground'
                    : 'bg-red-500/10 text-red-500'}
            {@const tooltipText = prTooltipContent}
            <Tooltip content={tooltipText} side="bottom" sideOffset={4} disabled={!tooltipText}>
              <span class="text-ui font-medium px-1.5 py-0.5 rounded-full shrink-0 {statusColor}">
                PR{prDisplayNumber ? ` #${prDisplayNumber}` : ''}
              </span>
            </Tooltip>
          {/if}

          <!-- Activity time -->
          <RelativeTime
            date={ws.lastActivity || ws.updatedAt}
            class="text-ui text-subtle whitespace-nowrap shrink-0"
            compact
          />
        </div>

        <!-- Row 2: repo info (hidden when grouped by repo) -->
        {#if !groupByRepo && ws.repositoryOwner && ws.repositoryName}
          <div class="truncate text-xs text-subtle">
            {ws.repositoryOwner}/{ws.repositoryName}
          </div>
        {/if}
      </div>
    </div>
  </button>

  <!-- Hover action buttons -->
  {#if onArchive || onUnarchive || onDelete}
    <div
      class="absolute right-2.5 top-2.5 flex items-center gap-0 opacity-0 group-hover:opacity-100 bg-sidebar pl-1"
    >
      {#if onArchive || onUnarchive}
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={handleArchive}
          class="hover:text-muted-foreground"
          tooltip={isArchived ? 'Unarchive space' : 'Archive space'}
        >
          <Fa icon={isArchived ? faBoxOpen : faBoxArchive} size="sm" />
        </Button>
      {/if}
      {#if onDelete}
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={handleDelete}
          class="hover:text-destructive-foreground hover:bg-destructive/10!"
          tooltip="Delete space"
        >
          <Fa icon={faTrash} size="sm" />
        </Button>
      {/if}
    </div>
  {/if}

  <!-- Agent Hover Card -->
  {#if hoveredAgentId}
    {@const hoveredAgent = agents.find((a) => a.id === hoveredAgentId)}
    {#if hoveredAgent}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        onmouseenter={() => handleAgentMouseEnter(hoveredAgentId!)}
        onmouseleave={handleAgentMouseLeave}
      >
        <HoverCard
          anchor="--agent-row-{ws.id}-{hoveredAgentId}"
          position="top"
          class="w-72 rounded-lg overflow-hidden"
        >
          <AgentCard agentId={hoveredAgentId} showBorder={false} workspace={ws} />
        </HoverCard>
      </div>
    {/if}
  {/if}
</div>
