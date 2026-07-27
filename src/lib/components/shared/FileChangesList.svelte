<script lang="ts">
  /**
   * Simplified FileChangesList for displaying file operations in compact views
   * Used in hover cards and other UI elements that need a simple file list
   */
  import { Fa } from 'svelte-fa';
  import { faFile } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import type { FileOperation } from '$shared/types';
  import LineChangesBadge from './LineChangesBadge.svelte';
  import type { Snippet } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    fileChanges: FileOperation[];
    maxItems?: number;
    showStats?: boolean;
    compact?: boolean;
    className?: string;
    selectedChangeId?: string;
    onFileClick?: (file: FileOperation) => void;
    onFileDoubleClick?: (file: FileOperation) => void;
    actions?: Snippet<[{ change: FileOperation }]>;
  }

  let {
    fileChanges = [],
    maxItems = 10,
    showStats = true,
    compact = false,
    className = '',
    selectedChangeId = undefined,
    onFileClick,
    onFileDoubleClick,
    actions,
  }: Props = $props();

  // Calculate statistics
  let stats: { created: number; modified: number; deleted: number; total: number } = $derived.by(
    () => {
      const result = {
        created: 0,
        modified: 0,
        deleted: 0,
        total: fileChanges.length,
      };

      fileChanges.forEach((change) => {
        const action = change.action || change.type;
        if (action === 'create') result.created++;
        else if (action === 'modify') result.modified++;
        else if (action === 'delete') result.deleted++;
      });

      return result;
    },
  );

  // Limit items if needed
  let displayedChanges = $derived(
    maxItems && fileChanges.length > maxItems ? fileChanges.slice(0, maxItems) : fileChanges,
  );

  let remainingCount = $derived(
    maxItems && fileChanges.length > maxItems ? fileChanges.length - maxItems : 0,
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function getFileIcon(change: FileOperation) {
    return faFile;
  }

  function getFileName(path: string) {
    return path.split('/').pop() || path;
  }

  function getDirectory(path: string) {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/');
  }
</script>

<div class={cn('flex flex-col', className)}>
  {#if showStats && stats.total > 0}
    <div class="flex items-center gap-2 px-2 py-1 text-xs text-subtle">
      <span
        >{stats.total === 1
          ? m.shared_fileChangesList_fileCount_one({ count: formatInteger(stats.total) })
          : m.shared_fileChangesList_fileCount_many({ count: formatInteger(stats.total) })}</span
      >
      {#if stats.created > 0}
        <span class="text-green-600">+{stats.created}</span>
      {/if}
      {#if stats.modified > 0}
        <span class="text-blue-600">~{stats.modified}</span>
      {/if}
      {#if stats.deleted > 0}
        <span class="text-red-600">-{stats.deleted}</span>
      {/if}
    </div>
  {/if}

  <div class="space-y-0.5">
    {#each displayedChanges as change (change.path)}
      {@const fileName = getFileName(change.path)}
      {@const directory = getDirectory(change.path)}
      <button
        class={cn(
          'w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 transition-colors text-left',
          compact ? 'py-0.5' : 'py-1',
          selectedChangeId === change.path && 'bg-muted',
        )}
        onclick={() => onFileClick?.(change)}
        ondblclick={() => onFileDoubleClick?.(change)}
      >
        <Fa icon={getFileIcon(change)} class="text-ghost flex-shrink-0" size="sm" />

        <div class="flex-1 min-w-0">
          <div class={cn('truncate', compact ? 'text-xs' : 'text-sm')}>{fileName}</div>
          {#if !compact && directory}
            <div class="text-xs text-subtle truncate">{directory}</div>
          {/if}
        </div>

        {#if showStats && (change.additions || change.deletions)}
          <LineChangesBadge
            additions={change.additions || 0}
            deletions={change.deletions || 0}
            size={compact ? 'xs' : 'sm'}
          />
        {/if}

        {#if actions}
          <div class="flex-shrink-0">
            {@render actions({ change })}
          </div>
        {/if}
      </button>
    {/each}

    {#if remainingCount > 0}
      <div class="px-2 py-1 text-xs text-subtle">
        {m.shared_fileChangesList_more_label({ count: formatInteger(remainingCount) })}
      </div>
    {/if}
  </div>
</div>
