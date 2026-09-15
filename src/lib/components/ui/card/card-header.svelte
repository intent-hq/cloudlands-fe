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
  data-slot="card-header"
  class={cn(
    '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-x-4 gap-y-1.5 pt-4 pb-2 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]',
    CARD_CONTENT_INSET_CLASS,
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
