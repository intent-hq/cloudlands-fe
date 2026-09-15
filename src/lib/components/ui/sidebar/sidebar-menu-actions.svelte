<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import { getSidebarMenuRowContext, setSidebarMenuActionsContext } from './sidebar-menu-context';

  let {
    ref = $bindable(null),
    class: className,
    showOnHover = false,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    showOnHover?: boolean;
  } = $props();

  const row = getSidebarMenuRowContext();
  setSidebarMenuActionsContext({
    clustered: true,
    get showOnHover() {
      return showOnHover;
    },
  });
</script>

<div
  bind:this={ref}
  data-slot="sidebar-menu-actions"
  data-sidebar="menu-actions"
  data-show-on-hover={showOnHover}
  class={cn(
    'absolute right-1.5 z-10 flex items-center gap-1',
    row?.isSubRow ? 'top-0' : 'top-1',
    row?.hasBadge && 'right-8.5',
    showOnHover &&
      'opacity-0 transition-opacity duration-spring-fast ease-spring-fast group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 focus-within:opacity-100 hover:opacity-100 motion-reduce:transition-none',
    'in-data-[force-actions=true]:opacity-100!',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
