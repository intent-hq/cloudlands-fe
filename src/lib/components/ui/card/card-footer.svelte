<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="card-footer"
  class={cn(
    'type-caption flex min-w-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3 text-muted-foreground',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
