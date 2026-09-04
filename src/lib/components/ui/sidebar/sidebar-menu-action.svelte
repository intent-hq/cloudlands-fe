<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import { untrack, type Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { getSidebarMenuActionsContext, getSidebarMenuRowContext } from './sidebar-menu-context';

  let {
    ref = $bindable(null),
    class: className,
    showOnHover = false,
    children,
    child,
    onclick,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes> & {
    child?: Snippet<[{ props: Record<string, unknown> }]>;
    showOnHover?: boolean;
  } = $props();

  const row = getSidebarMenuRowContext();
  const cluster = getSidebarMenuActionsContext();
  let effectiveShowOnHover = $derived(cluster?.showOnHover ?? showOnHover);

  $effect(() => {
    const currentShowOnHover = effectiveShowOnHover;
    return untrack(() => row?.registerAction(currentShowOnHover));
  });

  const mergedProps = $derived({
    class: cn(
      cluster?.clustered
        ? 'relative flex size-6 shrink-0 items-center justify-center'
        : 'absolute right-1.5 z-10 flex size-6 items-center justify-center',
      !cluster?.clustered && row?.hasBadge && 'right-8.5',
      !cluster?.clustered && (row?.isSubRow ? 'top-0' : 'top-1'),
      'text-muted-foreground rounded-md outline-none hover:bg-hover hover:text-foreground transition-[color,background-color,opacity] duration-spring-fast ease-spring-fast focus-visible:ring-1 focus-visible:ring-focus-ring motion-reduce:transition-none [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:transition-[stroke-width] [&>svg]:duration-spring-fast',
      // Increases the hit area of the button on mobile.
      'after:absolute after:-inset-2 md:after:hidden',
      'group-data-[collapsible=icon]:hidden',
      !cluster?.clustered &&
        effectiveShowOnHover &&
        'opacity-0 peer-focus-visible/menu-button:opacity-100 peer-hover/menu-button:opacity-100 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100 hover:opacity-100',
      'in-data-[force-actions=true]:opacity-100!',
      className,
    ),
    'data-slot': 'sidebar-menu-action',
    'data-sidebar': 'menu-action',
    'data-show-on-hover': effectiveShowOnHover,
    onclick: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
      event.stopPropagation();
      onclick?.(event);
    },
    ...restProps,
  });
</script>

{#if child}
  {@render child({ props: mergedProps })}
{:else}
  <button bind:this={ref} {...mergedProps}>
    {@render children?.()}
  </button>
{/if}

<style>
  :global([data-sidebar='menu-action'] > svg) {
    stroke-width: 1.5;
  }

  :global([data-sidebar='menu-action']:hover > svg) {
    stroke-width: 2;
  }
</style>
