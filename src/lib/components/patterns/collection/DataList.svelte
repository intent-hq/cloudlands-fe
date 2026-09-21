<script lang="ts">
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { DataListItem } from './types';

  let {
    items,
    value,
    class: className,
  }: {
    items: readonly DataListItem[];
    value?: Snippet<[DataListItem, number]>;
    class?: string;
  } = $props();
</script>

<dl data-slot="data-list" class={cn('min-w-0 divide-y divide-border', className)}>
  {#each items as item, index (item.key)}
    <div class="grid min-w-0 grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)] gap-4 py-2.5">
      <dt class="text-sm font-medium text-muted-foreground">{item.label}</dt>
      <dd class="min-w-0 text-sm text-foreground">
        {#if value}
          {@render value(item, index)}
        {:else}
          <span class="break-words">{item.value}</span>
          {#if item.description}<p class="mt-0.5 text-xs text-muted-foreground">
              {item.description}
            </p>{/if}
        {/if}
      </dd>
    </div>
  {/each}
</dl>
