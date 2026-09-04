<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import { animatedHeight } from '$lib/motion';
  import { getSidebarGroupContext } from './sidebar-group-context.svelte';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
  const group = getSidebarGroupContext();
</script>

<div
  bind:this={ref}
  data-slot="sidebar-group-content"
  data-sidebar="group-content"
  class={cn('type-body w-full will-change-[height]', className)}
  use:animatedHeight={group?.open ?? true}
  aria-hidden={group && !group.open ? 'true' : undefined}
  inert={group && !group.open ? true : undefined}
  {...restProps}
>
  <div>{@render children?.()}</div>
</div>
