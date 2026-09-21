<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';
  import { setSidebarGroupContext } from './sidebar-group-context.svelte';

  let {
    ref = $bindable(null),
    class: className,
    collapsible = false,
    open = $bindable(true),
    onOpenChange,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> & {
    collapsible?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = $props();

  let actionKeys = $state.raw(new Set<symbol>());

  setSidebarGroupContext({
    get collapsible() {
      return collapsible;
    },
    get open() {
      return open;
    },
    get actionCount() {
      return actionKeys.size;
    },
    toggle() {
      if (!collapsible) return;
      open = !open;
      onOpenChange?.(open);
    },
    registerAction() {
      const key = Symbol('sidebar-group-action');
      actionKeys = new Set(actionKeys).add(key);
      return () => {
        const next = new Set(actionKeys);
        next.delete(key);
        actionKeys = next;
      };
    },
  });
</script>

<div
  bind:this={ref}
  data-slot="sidebar-group"
  data-sidebar="group"
  data-open={open}
  data-collapsible={collapsible}
  class={cn('relative flex w-full min-w-0 flex-col p-2', className)}
  {...restProps}
>
  {@render children?.()}
</div>
