<script lang="ts">
  /**
   * WorkspaceTableRow - A single workspace row in the table view
   */
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
  import type { Workspace, WorkspaceCommitInfo } from '$shared/types';
  import { PullRequestStatus, WorkspaceStatusEnum } from '$shared/types';
  import {
    faBoxArchive,
    faBoxOpen,
    faCodeCommit,
    faCodePullRequest,
    faFolder,
    faPlusMinus,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '../ui/button/button.svelte';

  import AgentCard from '$lib/components/chat/AgentCard.svelte';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import LineChangesBadge from '../shared/LineChangesBadge.svelte';
  import WorkspaceStatusIcon, {
    type WorkspaceDisplayStatus,
  } from './WorkspaceStatusIcon.svelte';

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

  // Derived values
  const hasChanges = $derived(ws.diffSummary && ws.diffSummary.totalFiles > 0);
  const pullRequests = $derived(ws.pullRequests || []);
  const hasPR = $derived(
    pullRequests.length > 0 || ws.activePullRequest || ws.prStatus === PullRequestStatus.Open,
  );
  const taskStats = $derived(ws.taskStats);
  const commits = $derived<WorkspaceCommitInfo[]>(ws.gitSummary?.commits || []);
  const commitCount = $derived(ws.gitSummary?.ahead || 0);

  // Compute workspace display status based on available data
  // Priority: PR merged > PR open > Complete > In progress > Not started
  const workspaceDisplayStatus = $derived.by((): WorkspaceDisplayStatus => {
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
  });

  // Tooltip text for workspace status
  const statusTooltipText = $derived.by((): string => {
    const total = taskStats?.total || 0;
    const completed = taskStats?.completed || 0;
    const inProgress = taskStats?.inProgress || 0;

    switch (workspaceDisplayStatus) {
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
  });

  // Prepare commit data for tooltip
  const commitTooltipData = $derived(() => {
    if (commitCount === 0) return null;
    const displayCount = Math.min(commits.length, 6);
    const items = commits
      .slice(0, displayCount)
      .map((commit, i) => commit?.title || `Commit ${i + 1}`);
    const remaining = commitCount > 6 ? commitCount - 6 : 0;
    return { items, remaining };
  });

  // Prepare PR data for tooltip
  const prTooltipData = $derived(() => {
    if (!hasPR) return null;
    const displayCount = Math.min(pullRequests.length, 6);
    const items = pullRequests.slice(0, displayCount).map((pr) => `#${pr.number}: ${pr.title}`);
    // Fallback to activePullRequest if pullRequests is empty
    if (pullRequests.length === 0 && ws.activePullRequest) {
      items.push(`#${ws.activePullRequest.number}: ${ws.activePullRequest.title}`);
    }
    const remaining = pullRequests.length > 6 ? pullRequests.length - 6 : 0;
    return { items, remaining };
  });

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
    class="relative flex flex-col justify-center w-full min-w-0 pr-5 pl-3 h-10 text-left hover:bg-muted/30 cursor-pointer {isArchived ? 'bg-sidebar' : ''}"
    onclick={(e) => onOpen(ws, e)}
  >
    {#if !isLastInGroup}
      <div class="absolute bottom-0 left-5 right-5 h-px bg-border/40"></div>
    {/if}

    <!-- Row content -->
    <div class="flex items-center w-full gap-2">
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

      <!-- Workspace status indicator -->
      {#if ws.archived}
        <div class="shrink-0 ml-2.25 mr-1.5">
          <Fa icon={faBoxArchive} size="sm" class="text-muted-foreground/30" />
        </div>
      {:else}
        <Tooltip side="top" delayDuration={0}>
          {#snippet content()}
            <span class="text-sm">{statusTooltipText}</span>
          {/snippet}
          <div class="shrink-0 ml-2.25 mr-1.5">
            <WorkspaceStatusIcon status={workspaceDisplayStatus} size={12} />
          </div>
        </Tooltip>
      {/if}

      <!-- Title -->
      <div class="flex-1 min-w-0 pr-4">
        <span
          class={cn(
            'text-[13px] font-mediumx text-foreground truncate block',
            ws.archived || !ws.title ? 'text-muted-foreground/70' : '',
          )}
          title={ws.title || 'Untitled'}
        >{ws.title || 'Untitled'}</span
        >
      </div>

      <!-- Line changes visualization -->
      {#if hasChanges}
        <Tooltip side="top" delayDuration={0} contentClass="mb-0 whitespace-nowrap">
          {#snippet content()}
            <div class="text-sm flex flex-col space-y-0 mb-0">
              <div class="font-semibold">
                {ws.diffSummary?.totalFiles} files with local changes:
              </div>
              <!-- list files -->
              <ul class="space-y-px m-0 p-0 list-none my-1">
                {#each ws.diffSummary?.files.slice(0, 5) as file}
                  {@const fileName = file.path.split('/').pop()}
                  <li class="truncate flex items-center max-w-xs w-full">
                    <div class="flex-1 truncate">
                    {fileName}
                    </div>
                    <LineChangesBadge
                    class="ml-2"
                      additions={file.additions}
                      deletions={file.deletions}
                      size="xs"
                    />
                  </li>
                {/each}
                {#if ws.diffSummary?.files.length && ws.diffSummary?.files.length > 5}
                  <li class="text-muted-foreground">+ {ws.diffSummary?.files.length - 5} more</li>
                {/if}
              </ul>
            </div>
          {/snippet}
          <span class="text-muted-foreground/50 py-2 -my-1">
            <Fa icon={faPlusMinus} size="xs" />
          </span>
        </Tooltip>
      {/if}

      <!-- Commits ahead indicator -->
      {#if commitCount > 0}
        {@const data = commitTooltipData()}
        <Tooltip side="top" contentClass="mb-0 whitespace-nowrap">
          {#snippet content()}
            {#if data}
              <div class="text-sm flex flex-col space-y-0 mb-0">
                <div class="font-semibold">Commits:</div>
                <ul class="space-y-px m-0 p-0 list-none my-1">
                  {#each data.items as item}
                    <li class="truncate max-w-xs">{item}</li>
                  {/each}
                  {#if data.remaining > 0}
                    <li class="text-muted-foreground">+ {data.remaining} more</li>
                  {/if}
                </ul>
              </div>
            {/if}
          {/snippet}
          <span class="text-muted-foreground/50 py-2 -my-1">
            <Fa icon={faCodeCommit} size="xs" />
          </span>
        </Tooltip>
      {/if}

      <!-- PR info -->
      {#if hasPR}
        {@const data = prTooltipData()}
        <Tooltip side="top" contentClass="mb-0 whitespace-nowrap">
          {#snippet content()}
            {#if data}
              <div class="text-sm flex flex-col space-y-0 mb-0">
                <div class="font-semibold">PRs:</div>
                <ul class="space-y-px m-0 p-0 list-none my-1">
                  {#each data.items as item}
                    <li class="truncate max-w-xs">#{item}</li>
                  {/each}
                  {#if data.remaining > 0}
                    <li class="text-muted-foreground">+ {data.remaining} more</li>
                  {/if}
                </ul>
              </div>
            {/if}
          {/snippet}
          <span class="text-muted-foreground/50 py-2 -my-1">
            <Fa icon={faCodePullRequest} size="xs" />
          </span>
        </Tooltip>
      {/if}


      <!-- Agent avatars -->
      {#if agents.length > 0}
        <div class="flex items-center -space-x-1.5 shrink-0">
          {#each agents.slice(0, 6) as agent (agent.id)}
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
          {#if agents.length > 6}
            <div
              class="ml-2 flex items-center justify-center text-xs text-muted-foreground font-medium"
            >
              +{agents.length - 6}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Activity time -->
      <div
        class="shrink-0 hidden w-8 text-right sm:block group-hover:opacity-0 pointer-events-none"
      >
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
      class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0 opacity-0 group-hover:opacity-100"
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
          class="hover:text-destructive hover:bg-destructive/10!"
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
