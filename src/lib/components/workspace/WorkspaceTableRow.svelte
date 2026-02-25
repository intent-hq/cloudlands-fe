<script lang="ts">
  /**
   * WorkspaceTableRow - A single workspace row in the table view
   */
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { cn } from '$lib/utils';
  import type { Workspace } from '$shared/types';
  import { PullRequestStatus, WorkspaceStatusEnum } from '$shared/types';
  import { faBoxArchive, faBoxOpen, faFolder, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '../ui/button/button.svelte';

  import AgentCard from '$lib/components/chat/AgentCard.svelte';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
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

  // Get GitHub avatar URL for org/user
  function getGitHubAvatarUrl(owner: string, size: number = 32): string {
    return `https://github.com/${owner}.png?size=${size}`;
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
      'relative flex flex-col w-full min-w-0 pl-2.25 pr-5 py-3 text-left cursor-pointer transition-colors',
      isArchived ? 'bg-sidebar hover:bg-muted/20' : 'hover:bg-muted/30',
    )}
    onclick={(e) => onOpen(ws, e)}
  >
    {#if !isLastInGroup}
      <div class="absolute bottom-0 left-5 right-5 h-px bg-border/40"></div>
    {/if}

    <div class="flex items-start w-full gap-2.5">
      <!-- Left: icons column -->
      <div class="flex items-center gap-2.5 shrink-0 pt-0.5">
        <!-- Repo avatar when not grouped -->
        {#if showRepoAvatar && ws.repositoryOwner}
          <img
            src={getGitHubAvatarUrl(ws.repositoryOwner, 32)}
            alt={ws.repositoryOwner}
            class="w-5 h-5 rounded-full shrink-0"
            loading="lazy"
            onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
        {:else if !groupByRepo}
          <span class="text-muted-foreground/50 shrink-0 w-5 flex justify-center">
            <Fa icon={faFolder} size="sm" />
          </span>
        {/if}
      </div>

      <!-- Right: content - single row -->
      <div class="flex-1 min-w-0 flex items-center gap-2">
        <div class="-my-1">
          <WorkspacePhaseIndicator phase={workspacePhase.phase} progress={buildProgress} />
        </div>
        <span
          class={cn(
            'text-base font-medium truncate flex-1 min-w-0',
            ws.archived || !ws.title ? 'text-muted-foreground/70' : 'text-foreground',
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
                class="ml-1.5 flex items-center justify-center text-[10px] text-muted-foreground/60 font-medium"
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
                ? 'bg-emerald-500/10 text-emerald-500'
                : prDisplayStatus === PullRequestStatus.Draft
                  ? 'bg-muted-foreground/10 text-muted-foreground/60'
                  : 'bg-red-500/10 text-red-500'}
          <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 {statusColor}">
            PR{prDisplayNumber ? ` #${prDisplayNumber}` : ''}
          </span>
        {/if}

        <!-- Activity time -->
        <RelativeTime
          date={ws.lastActivity || ws.createdAt}
          class="text-[0.82rem] text-muted-foreground/70 whitespace-nowrap"
          compact
        />
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
