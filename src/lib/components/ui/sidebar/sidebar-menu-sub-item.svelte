<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import {
    getSidebarMenuContext,
    getSidebarMenuLevelContext,
    setSidebarMenuRowContext,
  } from './sidebar-menu-context';

  let {
    ref = $bindable(null),
    children,
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLLIElement>> = $props();

  const menu = getSidebarMenuContext();
  const level = getSidebarMenuLevelContext();
  const index = menu?.claimIndex(level) ?? -1;
  let actionEntries = $state.raw(new Map<symbol, boolean>());
  let hasBadge = $state(false);
  setSidebarMenuRowContext({
    index,
    level,
    menu,
    isSubRow: true,
    get actionCount() {
      return actionEntries.size;
    },
    get actionsShowOnHover() {
      return [...actionEntries.values()].some(Boolean);
    },
    get hasBadge() {
      return hasBadge;
    },
    registerAction(showOnHover) {
      const key = Symbol('sidebar-menu-action');
      actionEntries = new Map(actionEntries).set(key, showOnHover);
      return () => {
        const next = new Map(actionEntries);
        next.delete(key);
        actionEntries = next;
      };
    },
    setHasBadge(value) {
      hasBadge = value;
    },
  });
</script>

<li
  bind:this={ref}
  data-slot="sidebar-menu-sub-item"
  data-sidebar="menu-sub-item"
  class={cn('group/menu-sub-item relative z-10', className)}
  {...restProps}
>
  {@render children?.()}
</li>
