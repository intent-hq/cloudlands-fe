<script lang="ts">
  import type { Workspace } from '$shared/types';
  import { formatDistanceToNow } from 'date-fns';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';

  interface Props {
    workspace: Workspace | null;
    lineStats?: { additions: number; deletions: number };
    isLoading?: boolean;
  }

  let { workspace, lineStats, isLoading = false }: Props = $props();

  // Check if there are line changes
  let hasChanges = $derived(lineStats && (lineStats.additions > 0 || lineStats.deletions > 0));

  // Get streaming and unread agent IDs for this workspace
  let streamingAgentIds = $derived(
    workspace ? activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspace.id) : [],
  );

  let unreadAgentIds = $derived(
    workspace ? unreadTrackingService.getUnreadAgentIdsForWorkspace(workspace.id) : [],
  );

  // Filter out streaming agents from unread list
  let unreadOnlyAgentIds = $derived(unreadAgentIds.filter((id) => !streamingAgentIds.includes(id)));

  // Format last activity time (use lastActivity if available, otherwise updatedAt)
  let lastActivityText = $derived(
    !workspace
      ? 'No recent activity'
      : (() => {
          const activityDate = workspace.lastActivity || workspace.updatedAt;
          if (!activityDate) return 'No recent activity';
          try {
            return formatDistanceToNow(new Date(activityDate), {
              addSuffix: true,
            });
          } catch {
            return 'Recently';
          }
        })(),
  );

  // Get repository display name
  let repoDisplayName = $derived(
    !workspace
      ? 'Loading...'
      : workspace?.repositoryName
        ? workspace.repositoryOwner
          ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
          : workspace.repositoryName
        : 'Local repository',
  );
</script>

<div
  class="bg-card border border-border shadow-lg p-3 min-w-[220px] max-w-[280px] flex flex-col text-left"
>
  <!-- Header: Title and repo -->
  <div class="w-full">
    {#if isLoading || !workspace}
      <Skeleton class="h-5 w-40" />
    {:else}
      <div class="text-sm font-semibold text-foreground truncate">
        {workspace?.title || 'Untitled'}
      </div>
      <div class="text-sm text-muted-foreground truncate mt-0.5">
        {repoDisplayName}
      </div>
    {/if}
  </div>

  <!-- Status row: line changes, agents -->
  {#if !isLoading && workspace}
    <div class="flex items-center gap-1.5 mt-2">
      {#if hasChanges && lineStats}
        <LineChangesBadge
          additions={lineStats.additions}
          deletions={lineStats.deletions}
          size="xxs"
        />
      {/if}

      <!-- Agent avatars -->
      {#if streamingAgentIds.length > 0 || unreadOnlyAgentIds.length > 0}
        <div class="flex items-center -space-x-1">
          {#each streamingAgentIds.slice(0, 3) as agentId (agentId)}
            <AugieAvatarWithState {agentId} size={14} state="running" />
          {/each}
          {#each unreadOnlyAgentIds.slice(0, 3 - streamingAgentIds.length) as agentId (agentId)}
            <AugieAvatarWithState {agentId} size={14} state="unread" />
          {/each}
        </div>
      {/if}

      <!-- Last activity if no other status -->
      {#if !hasChanges && streamingAgentIds.length === 0 && unreadOnlyAgentIds.length === 0}
        <span class="text-xs text-muted-foreground">{lastActivityText}</span>
      {/if}
    </div>
  {:else if isLoading}
    <Skeleton class="h-4 w-32 mt-2" />
  {/if}
</div>
