<script lang="ts" module>
  let subMenuSequence = 0;
</script>

<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import { animatedHeight } from '$lib/motion';
  import { getSidebarMenuContext, setSidebarMenuLevelContext } from './sidebar-menu-context';

  let {
    ref = $bindable(null),
    class: className,
    open = true,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLUListElement>> & { open?: boolean } = $props();

  const menu = getSidebarMenuContext();
  const level = `sub-${++subMenuSequence}`;
  setSidebarMenuLevelContext(level);

  $effect(() => {
    open;
    menu?.refresh();
  });
</script>

<div
  use:animatedHeight={open}
  aria-hidden={!open ? 'true' : undefined}
  inert={!open ? true : undefined}
  class="will-change-[height]"
>
  <ul
    bind:this={ref}
    data-slot="sidebar-menu-sub"
    data-sidebar="menu-sub"
    data-state={open ? 'open' : 'closed'}
    class={cn(
      'border-border relative ml-[15px] flex min-w-0 flex-col gap-0.5 border-l pl-2',
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
  </ul>
</div>
