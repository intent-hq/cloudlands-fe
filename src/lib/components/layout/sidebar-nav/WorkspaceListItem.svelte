<script lang="ts">
  import { page } from '$app/state';
  import { faCheck, faThumbtack, faFolder } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import WorkspacePhaseIndicator from '$lib/components/workspace/WorkspacePhaseIndicator.svelte';
  import { deriveWorkspacePhase } from '$lib/components/workspace/workspace-phase';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import type { Workspace } from '$shared/types';
  import { PullRequestStatus } from '$shared/types';

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
    onClick?: () => void;
    /** Whether this item is highlighted via keyboard navigation */
    highlighted?: boolean;
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
    highlighted = false,
  }: Props = $props();

  const phaseInfo = $derived(deriveWorkspacePhase(workspace));
  let isCurrent = $derived(page.url.pathname === `/workspace/${workspace.id}`);

  // Task progress for building phase pie chart (0–1)
  let buildProgress = $derived.by(() => {
    const t = workspace.taskStats?.total ?? 0;
    if (t === 0) return 0;
    return (workspace.taskStats?.completed ?? 0) / t;
  });

  // PR status
  const prStatus = $derived.by(() => {
    const active = workspace.activePullRequest;
    if (active) return active.status;
    if (workspace.prStatus) return workspace.prStatus;
    const prs = workspace.pullRequests ?? [];
    if (prs.length > 0) return prs[0].status;
    return null;
  });
  const prNumber = $derived(
    workspace.activePullRequest?.number ??
      workspace.prNumber ??
      workspace.pullRequests?.[0]?.number,
  );
  // Agent info — only show unread and in-progress agents
  const activeAgentStatuses = new Set(['streaming', 'processing', 'busy', 'responding']);
  const agentInfos = $derived.by(() => {
    const all = workspace.agentSummary?.agents ?? [];
    const unreadSet = new Set(unreadAgentIds);
    return all.filter(
      (agent) => activeAgentStatuses.has(agent.status ?? '') || unreadSet.has(agent.id),
    );
  });

  function getGitHubAvatarUrl(owner: string, size: number = 32): string {
    return `https://github.com/${owner}.png?size=${size}`;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') onClick?.();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="group relative flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left
    {isCurrent ? 'bg-sidebar' : highlighted ? 'bg-sidebar' : 'hover:bg-sidebar'}"
  role="button"
  tabindex="0"
  onclick={() => onClick?.()}
  onkeydown={handleKeydown}
>
  <!-- Left column: repo avatar + status indicator side by side -->
  <div class="flex items-center gap-1 shrink-0">
    {#if !hideRepoAvatar}
      {#if workspace.repositoryOwner}
        <img
          src={getGitHubAvatarUrl(workspace.repositoryOwner)}
          alt={workspace.repositoryOwner}
          class="size-3.5 rounded-full shrink-0"
          loading="lazy"
          onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
        />
      {:else}
        <span class="text-muted-foreground/50 shrink-0 size-3.5 flex items-center justify-center">
          <Fa icon={faFolder} size="xs" />
        </span>
      {/if}
    {/if}
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

  <!-- Content: single row -->
  <div class="flex-1 min-w-0 flex items-center gap-1.5">
    <span
      class="truncate text-[13px] flex-1 min-w-0
      {isCurrent
        ? 'font-medium text-foreground'
        : workspace.title
          ? 'text-foreground'
          : 'text-muted-foreground/70'}"
    >
      {workspace.title || 'Untitled'}
    </span>

    <!-- Agent avatars -->
    {#if isRunning && streamingAgentIds.length > 0}
      <div class="flex items-center -space-x-1.5 shrink-0">
        {#each streamingAgentIds.slice(0, 3) as agentId (agentId)}
          <AugieAvatarWithState {agentId} size={14} state="running" />
        {/each}
        {#if streamingAgentIds.length > 3}
          <div class="ml-1 text-[10px] text-muted-foreground font-medium">
            +{streamingAgentIds.length - 3}
          </div>
        {/if}
      </div>
    {:else if agentInfos.length > 0}
      <div class="flex items-center -space-x-1.5 shrink-0">
        {#each agentInfos.slice(0, 3) as agent (agent.id)}
          <AugieAvatarWithState
            agentId={agent.id}
            size={14}
            state={agent.status === 'streaming' || agent.status === 'processing'
              ? 'running'
              : 'idle'}
            specialist={agent.specialist}
          />
        {/each}
        {#if agentInfos.length > 3}
          <div class="ml-1 text-[10px] text-muted-foreground/50 font-medium">
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
            ? 'bg-emerald-500/10 text-emerald-500'
            : prStatus === PullRequestStatus.Draft
              ? 'bg-muted-foreground/10 text-muted-foreground/60'
              : 'bg-red-500/10 text-red-500'}
      <span class="text-[9px] font-medium px-1.5 py-0 rounded-full shrink-0 {statusColor}">
        PR{prNumber ? ` #${prNumber}` : ''}
      </span>
    {/if}

    <span
      class="shrink-0 {onTogglePin || (isUnread && onMarkAsRead) ? 'group-hover:opacity-0' : ''}"
    >
      <RelativeTime
        date={workspace.lastActivity || workspace.updatedAt}
        class="text-[11px] text-muted-foreground/50 whitespace-nowrap"
        compact
      />
    </span>
  </div>

  <!-- Hover actions (absolute positioned) -->
  {#if onTogglePin || (isUnread && onMarkAsRead)}
    <div
      class="absolute right-0 top-1.5 px-2 bg-sidebar flex opacity-0 group-hover:opacity-100 items-center gap-0.5"
    >
      {#if isUnread && onMarkAsRead}
        <button
          class="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/40 transition-all hover:bg-muted/50 hover:text-foreground"
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
            {isPinned ? 'text-primary/60' : 'text-muted-foreground/40'}"
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
