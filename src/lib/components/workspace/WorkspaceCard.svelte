<script lang="ts">
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import type { Note, Workspace } from '$shared/types';
  import { WorkspaceStatusEnum, PullRequestStatus } from '$shared/types';
  import { getWorkspaceStage } from '$lib/utils/workspace-utils';
  import { isPRMergeable as checkPRMergeable, getPRTooltipContent } from '$lib/utils/pr-status';
  import { computeTaskStats } from '$shared/utils/task-stats';
  import {
    faFileCode,
    faServer,
    faTrash,
    faBoxArchive,
    faBoxOpen,
  } from '@fortawesome/free-solid-svg-icons';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import Fa from 'svelte-fa';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import Button from '../ui/button/button.svelte';
  import { fade } from 'svelte/transition';
  import { onMount } from 'svelte';
  import { getLineStats, type LineStats } from '$features/file-tracking/file-tracking.client';
  // Removed workspace preloading on hover to improve performance

  // Svelte 5: Use $props for component props
  let {
    showRepo = true,
    workspace,
    notes = [],
    onClick,
    onDelete,
    onArchive,
    onUnarchive,
  }: {
    showRepo?: boolean;
    workspace: Workspace;
    notes?: Note[];
    onClick: (workspace: Workspace) => void;
    onDelete?: (workspace: Workspace) => void;
    onArchive?: (workspace: Workspace) => void;
    onUnarchive?: (workspace: Workspace) => void;
  } = $props();

  // Check if workspace is archived
  let isArchived = $derived(workspace.status === WorkspaceStatusEnum.Archived);

  // Real-time line stats from file tracking
  let realTimeStats = $state<LineStats | null>(null);

  onMount(() => {
    // Fetch real-time line stats for this workspace
    getLineStats(workspace.id).then((stats) => {
      realTimeStats = stats;
    });

    // Refresh periodically
    const interval = setInterval(() => {
      getLineStats(workspace.id).then((stats) => {
        realTimeStats = stats;
      });
    }, 5000);

    return () => clearInterval(interval);
  });

  // Removed hover preloading to improve performance
  // Users will see a brief loading state when clicking, but this prevents
  // unnecessary monitoring of all workspaces

  // Svelte 5: Use $derived for computed values
  let stage = $derived(getWorkspaceStage(workspace));
  let repoInfo = $derived(
    workspace.repositoryOwner && workspace.repositoryName
      ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
      : null,
  );

  // Task progress stats — delegates to the shared canonical utility.
  // See $shared/utils/task-stats.ts for the single source of truth.
  let taskStats = $derived.by(() => {
    const stats = computeTaskStats(notes);
    if (stats.total === 0) return null;
    const percentage = Math.round((stats.completed / stats.total) * 100);
    return { ...stats, percentage };
  });

  const gatherFilesFromWorkspace = () => {
    const paths = new Set<string>();

    workspace.diffs?.forEach((diff) => {
      diff.files?.forEach((file) => {
        if (typeof file === 'string') {
          paths.add(file);
        } else if (
          file &&
          typeof file === 'object' &&
          'path' in file &&
          typeof (file as any).path === 'string'
        ) {
          paths.add((file as any).path);
        }
      });
    });

    workspace.timeline?.forEach((entry) => {
      if (entry.eventType === 'FileModified' && typeof entry.metadata?.filePath === 'string') {
        paths.add(entry.metadata.filePath);
      }
    });

    return Array.from(paths);
  };

  // Get unique file paths prioritizing the diff summary when available
  let filePaths = $derived.by(() => {
    if (workspace.diffSummary?.files?.length) {
      return workspace.diffSummary.files.map((file) => file.path).slice(0, 6);
    }

    return gatherFilesFromWorkspace().slice(0, 6);
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

  const isPRMergeable = $derived.by(() => checkPRMergeable(workspace.activePullRequest));

  const prTooltipContent = $derived.by(() => getPRTooltipContent(workspace.activePullRequest));

  let totalFileCount = $derived.by(() => {
    if (workspace.diffSummary) {
      return workspace.diffSummary.totalFiles;
    }

    return gatherFilesFromWorkspace().length;
  });

  // Use real-time stats from IPC when available, otherwise show zeros while loading
  let stats = $derived.by(() => {
    if (realTimeStats) {
      return realTimeStats;
    }
    return { additions: 0, deletions: 0 };
  });

  // Get unique agent IDs from conversation info
  let agentIds = $derived(
    workspace.conversationInfo
      ?.map((c) => c.agentId)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 3) || [],
  );

  // Format relative time
  function formatRelativeTime(dateString: string | undefined): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffWeeks < 4) return `${diffWeeks}w ago`;
    return `${diffMonths}mo ago`;
  }

  let lastEditedTime = $derived(formatRelativeTime(workspace.lastActivity || workspace.updatedAt));

  function handleClick() {
    onClick(workspace);
  }

  async function handleDelete(e: MouseEvent) {
    e.stopPropagation(); // Prevent card click
    if (onDelete) {
      onDelete(workspace);
    }
  }

  async function handleArchive(e: MouseEvent) {
    e.stopPropagation(); // Prevent card click
    if (isArchived && onUnarchive) {
      onUnarchive(workspace);
    } else if (!isArchived && onArchive) {
      onArchive(workspace);
    }
  }
</script>

<div
  class="relative group flex flex-col bg-background border border-border rounded-lg w-full shadow-sm h-28 hover:shadow-md dark:shadow-lg dark:hover:shadow-xl hover:scale-[0.99] {isArchived
    ? 'bg-muted/50!'
    : ''}"
  data-stage={stage}
  data-archived={isArchived}
  role="article"
>
  <!-- Action buttons -->
  <div
    class="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100"
  >
    {#if onArchive || onUnarchive}
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={handleArchive}
        class="hover:text-muted-foreground"
        title={isArchived ? 'Unarchive space' : 'Archive space'}
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
        title="Delete space"
      >
        <Fa icon={faTrash} size="sm" />
      </Button>
    {/if}
  </div>

  <!-- Card content (clickable) -->
  <button
    class="flex flex-col p-4 text-left space-y-0.5 cursor-pointer w-full"
    onclick={handleClick}
  >
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold m-0 flex-1 truncate pr-8" title={workspace.title || 'Untitled'}>
        {#if workspace.title}
          <span class="text-foreground">{workspace.title}</span>
        {:else}
          <span class="text-subtle">Untitled</span>
        {/if}
      </h3>
      <div class="flex items-center gap-2">
        {#if isArchived}
          <div
            class="flex items-center gap-0.5 px-1.5 py-0.5 bg-background text-subtle rounded text-xs"
          >
            <Fa icon={faBoxArchive} size="xs" />
            <span class="text-ui">Archived</span>
          </div>
        {/if}
        {#if workspace.environmentConfig && workspace.environmentConfig.type === 'remote'}
          <div
            class="flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded text-xs"
          >
            <Fa icon={faServer} size="xs" />
            <span class="text-ui">Remote</span>
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
          {@const tooltipText = prTooltipContent}
          <Tooltip content={tooltipText} side="bottom" sideOffset={4} disabled={!tooltipText}>
            <span class="text-ui-sm font-medium px-1.5 py-0 rounded-full shrink-0 {statusColor}">
              PR{prNumber ? ` #${prNumber}` : ''}
            </span>
          </Tooltip>
        {/if}
      </div>
    </div>

    {#if repoInfo && showRepo}
      <div class="flex items-center gap-2 text-xs text-subtle whitespace-nowrap">
        {repoInfo}
      </div>
    {/if}
    {#if lastEditedTime}
      <div class="flex items-center gap-2 text-xs text-subtle whitespace-nowrap">
        {lastEditedTime}
      </div>
    {/if}

    <!-- Task progress bar -->
    {#if taskStats}
      <div class="flex items-center gap-2 mt-1">
        <div class="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            class="h-full bg-emerald-500 transition-all duration-300"
            style="width: {taskStats.percentage}%"
          ></div>
        </div>
        <span class="text-ui text-subtle whitespace-nowrap">
          {taskStats.completed}/{taskStats.total}
        </span>
      </div>
    {/if}

    <div class="flex items-center justify-between gap-2 mt-auto pt-2">
      {#if agentIds.length > 0}
        <div class="flex items-center gap-2">
          <div class="flex -ml-1">
            {#each agentIds as agentId (agentId)}
              <div
                class="-ml-1 border-2 border-white dark:border-card rounded-full bg-white dark:bg-card overflow-hidden"
                title="Agent {agentId.substring(0, 8)}"
              >
                <AuggieAvatar faceSeed={agentId} colorSeed={agentId} size={24} />
              </div>
            {/each}
            {#if agentIds.length > 3}
              <div
                class="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-subtle text-[0.65rem] font-semibold -ml-1 border-2 border-white dark:border-card"
              >
                +{agentIds.length - 3}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <div class="flex items-center gap-2">
        {#if filePaths.length > 0}
          <div class="flex items-center gap-1">
            {#each filePaths as path (path)}
              <Tooltip content={path.split('/').pop()}>
                <Fa icon={faFileCode} class="text-ghost" size="sm" />
              </Tooltip>
            {/each}
            {#if filePaths.length === 6}
              {@const totalFiles = totalFileCount}
              {#if totalFiles > 6}
                <span class="text-[0.7rem] text-subtle ml-1 font-medium"
                  >+{totalFiles - 6}</span
                >
              {/if}
            {/if}

            <LineChangesBadge additions={stats.additions} deletions={stats.deletions} />
          </div>
        {/if}
      </div>
    </div>
  </button>
</div>
