<script lang="ts" generics="T">
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { ListKey } from './types';

  let {
    sections,
    getKey = (_section, index) => index,
    header,
    children,
    class: className,
    inset = true,
  }: {
    sections: readonly T[];
    getKey?: (section: T, index: number) => ListKey;
    header: Snippet<[T, number]>;
    children: Snippet<[T, number]>;
    class?: string;
    inset?: boolean;
  } = $props();
</script>

<div data-slot="sectioned-list" class={cn('min-w-0', className)}>
  {#each sections as section, index (getKey(section, index))}
    <section class="min-w-0">
      <div
        class={cn(
          'sticky top-0 z-20 bg-background/95 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm',
          inset ? 'px-3' : 'px-0',
        )}
      >
        {@render header(section, index)}
      </div>
      {@render children(section, index)}
    </section>
  {/each}
</div>
