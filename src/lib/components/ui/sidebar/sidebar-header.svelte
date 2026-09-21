<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    orientation = 'vertical',
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> & {
    orientation?: 'vertical' | 'horizontal';
  } = $props();
</script>

<div
  bind:this={ref}
  data-slot="sidebar-header"
  data-sidebar="header"
  data-orientation={orientation}
  class={cn(
    'flex shrink-0 gap-2 p-2',
    orientation === 'horizontal' ? 'flex-row items-center' : 'flex-col',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
