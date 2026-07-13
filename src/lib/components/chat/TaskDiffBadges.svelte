<script lang="ts">
  import {
  faCirclePlus,
  faArrowUp,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { TaskDiffCounts } from './tool-result-parser';

  interface Props {
    counts: TaskDiffCounts;
  }

  let { counts }: Props = $props();

  const hasChanges = $derived(counts.created > 0 || counts.updated > 0 || counts.deleted > 0);
</script>

{#if hasChanges}
  <div class="task-diff-badges">
    {#if counts.created > 0}
      <span class="badge badge-created" title="Created">
        <Fa icon={faCirclePlus} size="xs" />
        <span class="count">{counts.created}</span>
      </span>
    {/if}
    {#if counts.updated > 0}
      <span class="badge badge-updated" title="Updated">
        <Fa icon={faArrowUp} size="xs" />
        <span class="count">{counts.updated}</span>
      </span>
    {/if}
    {#if counts.deleted > 0}
      <span class="badge badge-deleted" title="Deleted">
        <Fa icon={faTrash} size="xs" />
        <span class="count">{counts.deleted}</span>
      </span>
    {/if}
  </div>
{/if}

<style>
  .task-diff-badges {
    display: flex;
    gap: 0.375rem;
    align-items: center;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.375rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
    background: var(--color-muted, #f1f5f9);
    color: var(--color-muted-foreground, #64748b);
  }

  .badge-created {
    background: color-mix(in srgb, var(--color-emerald-500, #10b981) 15%, transparent);
    color: var(--color-emerald-600, #059669);
  }

  .badge-updated {
    background: color-mix(in srgb, var(--color-blue-500, #3b82f6) 15%, transparent);
    color: var(--color-blue-600, #2563eb);
  }

  .badge-deleted {
    background: color-mix(in srgb, var(--color-red-500, #ef4444) 15%, transparent);
    color: var(--color-red-600, #dc2626);
  }

  .count {
    font-variant-numeric: tabular-nums;
  }
</style>
