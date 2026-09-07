<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import { CARD_CONTENT_INSET_CLASS } from './card-inset';

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
    'type-caption flex min-w-0 flex-wrap items-center gap-2 pb-4 pt-2 text-muted-foreground',
    CARD_CONTENT_INSET_CLASS,
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
