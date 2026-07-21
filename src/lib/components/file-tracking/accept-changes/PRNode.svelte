<script lang="ts">
  /**
   * PRNode - A PR in the timeline with nested commits
   * Mirrors the CommitNode style with nested content collapsed by default
   */
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
  faCodePullRequest,
  faExternalLink,
} from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import type { PRInfo } from './types';
  import CommitNode from './CommitNode.svelte';

  interface Props {
    pr: PRInfo;
    /** Forwarded to nested CommitNodes for lazy `git.commitDetails` fetches. */
    workspaceId?: string;
    noBorder?: boolean;
    defaultExpanded?: boolean;
    onFileClick?: (path: string, commitHash?: string, staged?: boolean) => void;
    onOpenCommit?: (hash: string) => void;
    onOpenPR?: (url: string) => void;
  }

  let {
    pr,
    workspaceId,
    noBorder = false,
    defaultExpanded = false,
    onFileClick,
    onOpenCommit,
    onOpenPR,
  }: Props = $props();

  // Note: We intentionally capture defaultExpanded at initialization as the initial state.
  // This is a "default" value pattern - subsequent changes to the prop don't reset expansion.
  // svelte-ignore state_referenced_locally
  let expanded = $state(defaultExpanded);

  const statusColors: Record<PRInfo['status'], string> = {
    open: 'bg-green-500/10 text-green-600 border-green-500/20',
    merged: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    closed: 'bg-red-500/10 text-red-600 border-red-500/20',
    draft: 'bg-muted text-subtle border-border',
  };

  const commitCount = $derived(pr.commits?.length ?? 0);
</script>

<div class="w-full relative">
  <div
    class="{noBorder
      ? ''
      : 'border border-border rounded-md shadow-xs'} overflow-hidden py-1 pl-3 pr-1.5 bg-background relative z-20"
  >
    <!-- PR header -->
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="group flex items-center justify-between flex-1 text-left py-0.5 hover:text-foreground transition-colors min-w-0 cursor-pointer"
        onclick={() => (expanded = !expanded)}
      >
        <div class="flex items-baseline gap-2 min-w-0 flex-1">
          <Fa icon={faCodePullRequest} class="h-3 w-3 text-ghost shrink-0" />
          <span class="text-sm truncate">{pr.title}</span>
          {#if pr.number}
            <span class="text-xs text-subtle shrink-0">#{pr.number}</span>
          {/if}
          {#if commitCount > 0}
            <span class="text-xs text-subtle shrink-0 ml-auto">
              {commitCount} commit{commitCount === 1 ? '' : 's'}
            </span>
          {/if}
        </div>
      </button>

      <Badge class="shrink-0 {statusColors[pr.status]}">
        {pr.status}
      </Badge>

      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => onOpenPR?.(pr.htmlUrl)}
        tooltip="View PR"
      >
        <Fa icon={faExternalLink} class="h-2.5 w-2.5" />
      </Button>
    </div>

    <!-- Commits list -->
    {#if expanded && pr.commits && pr.commits.length > 0}
      <div class="pl-4 pt-2 pb-2 space-y-1" transition:slide={{ duration: 150 }}>
        {#each pr.commits as commit (commit.hash)}
          <CommitNode
            {commit}
            {workspaceId}
            nested
            showViewAction
            {onFileClick}
            onView={onOpenCommit}
          />
        {/each}
      </div>
    {/if}
  </div>

  {#if !expanded}
    {#each pr.commits?.slice(0, 3) as commit, index (commit.hash)}
      <!-- fake commit node to show a stack -->
      <div
        class="absolute left-0 right-0 top-0 bottom-0 bg-background border border-border rounded-md shadow-xs"
        style="z-index: {10 - index}; transform: translate({index * 5}px, {index * 5}px)"
      ></div>
    {/each}
  {/if}
</div>
