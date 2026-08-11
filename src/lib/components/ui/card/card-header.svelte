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
  data-slot="card-header"
  class={cn(
    '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-x-4 gap-y-1 border-b border-border px-4 py-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
