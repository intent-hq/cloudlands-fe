<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import { setSidebarGroupActionsContext } from './sidebar-group-context.svelte';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> = $props();

  setSidebarGroupActionsContext(true);
</script>

<div
  bind:this={ref}
  data-slot="sidebar-group-actions"
  data-sidebar="group-actions"
  class={cn('absolute right-3.5 top-2 z-10 flex h-8 items-center gap-1', className)}
  {...restProps}
>
  {@render children?.()}
</div>
