<script lang="ts">
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn } from '$lib/utils';
  import { LIST_STATE_GEOMETRY, type StateDensity } from '../state-geometry';

  let {
    recipe = 'list',
    count = 3,
    label,
    density = 'default',
    rowHeight,
    class: className,
  }: {
    recipe?: 'list' | 'card-grid' | 'form';
    count?: number;
    label: string;
    density?: StateDensity;
    rowHeight?: number;
    class?: string;
  } = $props();

  const listGeometry = $derived(LIST_STATE_GEOMETRY[density]);
  const resolvedRowHeight = $derived(rowHeight ?? listGeometry.rowHeight);
  const listGeometryStyle = $derived(
    `--state-list-row-height: ${resolvedRowHeight}px; --state-list-inline-inset: ${listGeometry.inlineInset}px; --state-list-row-gap: ${listGeometry.rowGap}px;`,
  );
</script>

<div
  data-slot="loading-state"
  data-recipe={recipe}
  data-density={density}
  role="status"
  aria-label={label}
  style={recipe === 'list' ? listGeometryStyle : undefined}
  class={cn(
    recipe === 'card-grid'
      ? 'grid grid-cols-2 gap-3'
      : recipe === 'form'
        ? 'space-y-3'
        : 'flex flex-col gap-(--state-list-row-gap) px-(--state-list-inline-inset)',
    className,
  )}
>
  {#if recipe === 'form'}
    {#each Array(count) as _, index (index)}
      <div class="space-y-2">
        <Skeleton class="h-3 w-24 bg-surface-2" style="--selected: var(--surface-4)" />
        <Skeleton class="h-9 w-full bg-surface-2" style="--selected: var(--surface-4)" />
      </div>
    {/each}
  {:else if recipe === 'card-grid'}
    {#each Array(count) as _, index (index)}
      <Skeleton class="h-28 w-full bg-surface-2" style="--selected: var(--surface-4)" />
    {/each}
  {:else}
    {#each Array(count) as _, index (index)}
      <Skeleton
        class="h-(--state-list-row-height) w-full bg-surface-2"
        style="--selected: var(--surface-4)"
      />
    {/each}
  {/if}
</div>
