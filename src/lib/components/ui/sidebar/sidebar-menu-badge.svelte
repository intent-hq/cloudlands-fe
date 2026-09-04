<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import { useSize } from '$lib/components/ui/size-context';
  import type { HTMLAttributes } from 'svelte/elements';
  import { getSidebarMenuRowContext } from './sidebar-menu-context';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props();

  const size = useSize();
  const row = getSidebarMenuRowContext();
  let lit = $derived(row?.menu?.activeIndexes.get(row.level) === row?.index);

  $effect(() => {
    row?.setHasBadge(true);
    return () => row?.setHasBadge(false);
  });
</script>

<div
  bind:this={ref}
  data-slot="sidebar-menu-badge"
  data-sidebar="menu-badge"
  class={cn(
    'pointer-events-none absolute right-2 z-10 flex h-5 min-w-5 select-none items-center justify-center px-1 tabular-nums transition-[color,font-variation-settings] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
    size === 'compact' ? 'top-1 text-[10px]' : 'top-1.5 text-[11px]',
    lit ? 'text-foreground' : 'text-muted-foreground',
    'group-data-[collapsible=icon]:hidden',
    className,
  )}
  {...restProps}
  style:font-variation-settings={lit ? "'wght' 600" : "'wght' 400"}
>
  {@render children?.()}
</div>
