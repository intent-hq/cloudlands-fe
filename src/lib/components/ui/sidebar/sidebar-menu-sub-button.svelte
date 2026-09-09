<script lang="ts" module>
  function rowGutter(actionCount: number, hasBadge: boolean): number {
    if (!actionCount && !hasBadge) return 8;
    const actionsWidth = actionCount ? actionCount * 24 + (actionCount - 1) * 4 : 0;
    const runWidth = (hasBadge ? 24 : 0) + actionsWidth + (hasBadge && actionCount ? 4 : 0);
    return (hasBadge ? 8 : 6) + runWidth + 4;
  }
</script>

<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import { untrack, type Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { useSize } from '$lib/components/ui/size-context';
  import { getSidebarMenuRowContext } from './sidebar-menu-context';

  let {
    ref = $bindable(null),
    children,
    child,
    class: className,
    size = 'md',
    isActive = false,
    icon,
    label,
    onfocus,
    onblur,
    ...restProps
  }: WithElementRef<HTMLAnchorAttributes> & {
    child?: Snippet<[{ props: Record<string, unknown> }]>;
    size?: 'sm' | 'md';
    isActive?: boolean;
    icon?: Snippet;
    label?: string;
  } = $props();

  const row = getSidebarMenuRowContext();
  const contextualSize = useSize();
  let proximityActive = $derived(row?.menu?.hover?.activeIndex === row?.index);
  let lit = $derived(isActive || proximityActive);
  let gutterHover = $derived(rowGutter(row?.actionCount ?? 0, row?.hasBadge ?? false));
  let gutterRest = $derived(
    row?.actionsShowOnHover ? rowGutter(0, row?.hasBadge ?? false) : gutterHover,
  );
  let tabIndex = $derived.by(() => {
    if (!row?.menu) return undefined;
    const preferredIndex = row.menu.focusIndex ?? [...row.menu.activeIndexes.values()].at(-1) ?? 0;
    return row.index === preferredIndex ? 0 : -1;
  });

  $effect(() => {
    const active = isActive;
    if (!row?.menu) return;
    untrack(() => row.menu?.setActive(row.index, row.level, active));
    return () => untrack(() => row.menu?.setActive(row.index, row.level, false));
  });

  $effect(() => {
    const element = ref;
    if (!row?.menu || !element) return;
    untrack(() => row.menu?.registerElement(row.index, element));
    return () => untrack(() => row.menu?.registerElement(row.index, null));
  });

  const mergedProps = $derived({
    class: cn(
      'relative z-10 flex w-full min-w-0 cursor-pointer select-none items-center gap-2 overflow-hidden rounded-md pl-2 pr-(--row-gutter) text-left outline-none transition-[padding] duration-spring-fast ease-spring-fast group-hover/menu-sub-item:pr-(--row-gutter-hover) group-focus-within/menu-sub-item:pr-(--row-gutter-hover) motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
      size === 'sm' || contextualSize === 'compact' ? 'h-6 text-xs' : 'type-caption h-7',
      'group-data-[collapsible=icon]:hidden',
      className,
    ),
    'data-slot': 'sidebar-menu-sub-button',
    'data-sidebar': 'menu-sub-button',
    'data-size': size,
    'data-active': isActive,
    'data-proximity-active': proximityActive,
    'data-sidebar-index': row?.index,
    'aria-current': isActive ? ('page' as const) : undefined,
    tabindex: tabIndex,
    style: `--row-gutter: ${gutterRest}px; --row-gutter-hover: ${gutterHover}px;`,
    onfocus: (event: FocusEvent & { currentTarget: HTMLAnchorElement }) => {
      row?.menu?.hover?.setActiveIndex(row.index);
      row?.menu?.setFocus(row.index);
      onfocus?.(event);
    },
    onblur: (event: FocusEvent & { currentTarget: HTMLAnchorElement }) => {
      onblur?.(event);
    },
    ...restProps,
  });
</script>

{#if child}
  {@render child({ props: mergedProps })}
{:else}
  <a bind:this={ref} {...mergedProps}>
    {#if icon}
      <span
        class={cn(
          'sidebar-menu-sub-icon text-muted-foreground flex size-4 shrink-0 items-center justify-center transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none [&>svg]:size-4 [&>svg]:transition-[stroke-width] [&>svg]:duration-spring-fast',
          lit && 'text-foreground',
        )}>{@render icon()}</span
      >
    {/if}
    {#if label}
      <span class="inline-grid min-w-0 flex-1 text-left">
        <span
          class="invisible col-start-1 row-start-1 truncate"
          style="font-variation-settings: 'wght' 500"
          aria-hidden="true">{label}</span
        >
        <span
          class={cn(
            'text-muted-foreground col-start-1 row-start-1 truncate transition-[color,font-variation-settings] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
            lit && 'text-foreground',
          )}
          style:font-variation-settings={isActive ? "'wght' 500" : "'wght' 400"}>{label}</span
        >
      </span>
      {@render children?.()}
    {:else}
      <span
        class={cn(
          'text-muted-foreground flex min-w-0 flex-1 items-center gap-2 truncate transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none',
          lit && 'text-foreground',
          isActive && 'font-medium',
        )}>{@render children?.()}</span
      >
    {/if}
  </a>
{/if}

<style>
  .sidebar-menu-sub-icon :global(svg) {
    stroke-width: 1.5;
  }

  .sidebar-menu-sub-icon.text-foreground :global(svg) {
    stroke-width: 2;
  }
</style>
