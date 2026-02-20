<script lang="ts">
  /**
   * Agent Turn Summary Card
   *
   * Displays a summary card for an agent turn showing:
   * - Turn number and timestamp
   * - Files changed with additions/deletions
   * - Tool calls made
   * - Status and duration
   *
   * Clean, robust, and user-friendly design.
   */

  import {
    faFile,
    faWrench,
    faClock,
    faCheckCircle,
    faSpinner,
    faExclamationTriangle,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { formatDistanceToNow } from 'date-fns';

  interface FileChange {
    path: string;
    additions: number;
    deletions: number;
    action: 'create' | 'modify' | 'delete';
  }

  interface Props {
    turnNumber: number;
    agentId: string;
    agentName: string;
    timestamp: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    fileChanges?: FileChange[];
    toolCalls?: string[];
    duration?: number;
    message?: string;
    onClick?: () => void;
    isExpanded?: boolean;
  }

  let {
    turnNumber,
    agentId,
    agentName,
    timestamp,
    status,
    fileChanges = [],
    toolCalls = [],
    duration,
    message,
    onClick,
    isExpanded = false,
  }: Props = $props();

  // Calculate totals
  let totalAdditions = $derived(fileChanges.reduce((sum, f) => sum + f.additions, 0));
  let totalDeletions = $derived(fileChanges.reduce((sum, f) => sum + f.deletions, 0));
  let filesChanged = $derived(fileChanges.length);
  let toolsUsed = $derived(toolCalls.length);

  // Format timestamp with error handling
  let timeAgo = $derived.by(() => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return 'Unknown time';
      }
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return 'Unknown time';
    }
  });

  // Get status icon and color
  let statusIcon = $derived(
    status === 'completed'
      ? faCheckCircle
      : status === 'running'
        ? faSpinner
        : status === 'failed'
          ? faExclamationTriangle
          : faClock,
  );

  let statusColor = $derived(
    status === 'completed'
      ? 'text-green-500'
      : status === 'running'
        ? 'text-blue-500'
        : status === 'failed'
          ? 'text-red-500'
          : 'text-muted-foreground',
  );

  // Handle keyboard navigation
  function handleKeyDown(e: KeyboardEvent) {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick();
    }
  }
</script>

<button
  class="w-full text-left p-4 rounded-lg border border-border bg-card hover:bg-muted/50 transition-all duration-200 group"
  class:ring-2={isExpanded}
  class:ring-primary={isExpanded}
  onclick={onClick}
  onkeydown={handleKeyDown}
  disabled={!onClick}
  role={onClick ? 'button' : undefined}
  tabindex={onClick ? 0 : -1}
>
  <!-- Header -->
  <div class="flex items-start justify-between gap-3 mb-3">
    <div class="flex items-center gap-3 min-w-0 flex-1">
      <AuggieAvatar size={32} faceSeed={agentId} colorSeed={agentId} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h3 class="font-medium text-sm">Turn #{turnNumber}</h3>
          <span class="text-xs text-muted-foreground">• {agentName}</span>
        </div>
        <p class="text-xs text-muted-foreground mt-0.5">{timeAgo}</p>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <Fa
        icon={statusIcon}
        class={`${statusColor} ${status === 'running' ? 'animate-spin' : ''}`}
        size="sm"
      />
      {#if duration}
        <span class="text-xs text-muted-foreground">{(duration / 1000).toFixed(1)}s</span>
      {/if}
    </div>
  </div>

  <!-- Message preview -->
  {#if message}
    <p class="text-sm text-muted-foreground mb-3 line-clamp-2">{message}</p>
  {/if}

  <!-- Stats Grid -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <!-- Files Changed -->
    {#if filesChanged > 0}
      <div class="flex items-center gap-2 text-xs">
        <Fa icon={faFile} class="text-muted-foreground" size="xs" />
        <span class="font-medium">{filesChanged}</span>
        <span class="text-muted-foreground">file{filesChanged !== 1 ? 's' : ''}</span>
      </div>
    {/if}

    <!-- Line Changes -->
    {#if totalAdditions > 0 || totalDeletions > 0}
      <div class="flex items-center gap-2">
        <LineChangesBadge additions={totalAdditions} deletions={totalDeletions} size="xs" />
      </div>
    {/if}

    <!-- Tools Used -->
    {#if toolsUsed > 0}
      <div class="flex items-center gap-2 text-xs">
        <Fa icon={faWrench} class="text-muted-foreground" size="xs" />
        <span class="font-medium">{toolsUsed}</span>
        <span class="text-muted-foreground">tool{toolsUsed !== 1 ? 's' : ''}</span>
      </div>
    {/if}
  </div>

  <!-- Expanded Details -->
  {#if isExpanded && fileChanges.length > 0}
    <div class="mt-3 pt-3 border-t space-y-1">
      <p class="text-xs font-medium text-muted-foreground mb-2">Files Changed:</p>
      {#each fileChanges.slice(0, 5) as file (file.path)}
        <div class="flex items-center justify-between text-xs pl-2">
          <span class="truncate flex-1 font-mono">{file.path.split('/').pop()}</span>
          <LineChangesBadge additions={file.additions} deletions={file.deletions} size="xs" />
        </div>
      {/each}
      {#if fileChanges.length > 5}
        <p class="text-xs text-muted-foreground pl-2">...and {fileChanges.length - 5} more</p>
      {/if}
    </div>
  {/if}
</button>
