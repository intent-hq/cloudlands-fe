<script lang="ts">
  import { Button, type ButtonProps } from '$lib/components/ui/button';
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
      'text-muted-foreground rounded-md hover:bg-hover hover:text-foreground transition-[color,background-color,opacity] duration-spring-fast ease-spring-fast focus-visible:outline focus-visible:-outline-offset-1 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:[stroke-width:1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-spring-fast hover:[&_svg]:[stroke-width:2]',
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
  <Button bind:ref variant="ghost" size="icon-compact" {...mergedProps as unknown as ButtonProps}>
    {@render children?.()}
  </Button>
{/if}
