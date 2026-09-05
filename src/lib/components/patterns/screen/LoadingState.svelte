<script lang="ts">
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn } from '$lib/utils';

  let {
    recipe = 'list',
    count = 3,
    label,
    class: className,
  }: {
    recipe?: 'list' | 'card-grid' | 'form';
    count?: number;
    label: string;
    class?: string;
  } = $props();
</script>

<div
  data-slot="loading-state"
  data-recipe={recipe}
  role="status"
  aria-label={label}
  class={cn(recipe === 'card-grid' ? 'grid grid-cols-2 gap-3' : 'space-y-3', className)}
>
  {#if recipe === 'form'}
    {#each Array(count) as _, index (index)}
      <div class="space-y-2">
        <Skeleton class="h-3 w-24" />
        <Skeleton class="h-9 w-full" />
      </div>
    {/each}
  {:else if recipe === 'card-grid'}
    {#each Array(count) as _, index (index)}<Skeleton class="h-28 w-full" />{/each}
  {:else}
    {#each Array(count) as _, index (index)}<Skeleton class="h-12 w-full" />{/each}
  {/if}
</div>
