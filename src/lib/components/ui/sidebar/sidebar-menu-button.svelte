<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';
  import { OPTION_LIST_ROW_CLASS } from '$lib/styles/option-list-row';

  export const sidebarMenuButtonVariants = tv({
    base: 'peer/menu-button relative z-10 flex w-full cursor-pointer select-none items-center gap-2 overflow-hidden rounded-md pl-2 pr-(--row-gutter) text-left transition-[padding] duration-spring-fast ease-spring-fast focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus-ring focus-visible:shadow-none group-hover/menu-item:pr-(--row-gutter-hover) group-focus-within/menu-item:pr-(--row-gutter-hover) motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
    variants: {
      variant: {
        default: '',
        outline:
          'border border-border bg-background shadow-(--elevation-raised) data-[proximity-active=true]:border-sidebar-accent',
      },
      size: {
        default: OPTION_LIST_ROW_CLASS,
        sm: 'type-caption h-(--control-height-compact)',
        lg: 'type-body group-data-[collapsible=icon]:p-0! h-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  });

  export type SidebarMenuButtonVariant = VariantProps<typeof sidebarMenuButtonVariants>['variant'];
  export type SidebarMenuButtonSize = VariantProps<typeof sidebarMenuButtonVariants>['size'];

  const ROW_BASE_PAD = 8;
  const ROW_SLOT = 24;
  const ROW_GAP = 4;

  function rowGutter(actionCount: number, hasBadge: boolean): number {
    if (!actionCount && !hasBadge) return ROW_BASE_PAD;
    const actionsWidth = actionCount ? actionCount * ROW_SLOT + (actionCount - 1) * ROW_GAP : 0;
    const runWidth =
      (hasBadge ? ROW_SLOT : 0) + actionsWidth + (hasBadge && actionCount ? ROW_GAP : 0);
    return (hasBadge ? 8 : 6) + runWidth + ROW_GAP;
  }
</script>

<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import { cn, type WithElementRef, type WithoutChildrenOrChild } from '$lib/utils.js';
  import { mergeProps } from 'bits-ui';
  import { untrack, type ComponentProps, type Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { useSize } from '$lib/components/ui/size-context';
  import { m } from '$shared/paraglide/messages.js';
  import { useSidebar } from './context.svelte.js';
  import { getSidebarMenuRowContext } from './sidebar-menu-context';

  let {
    ref = $bindable(null),
    class: className,
    children,
    child,
    variant = 'default',
    size = 'default',
    isActive = false,
    status,
    dot,
    icon,
    label,
    tooltipContent,
    tooltipContentProps,
    onfocus,
    onblur,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> & {
    isActive?: boolean;
    status?: 'active' | 'unread' | 'idle';
    dot?: 'filled' | 'ring';
    icon?: Snippet;
    label?: string;
    variant?: SidebarMenuButtonVariant;
    size?: SidebarMenuButtonSize;
    tooltipContent?: Snippet | string;
    tooltipContentProps?: WithoutChildrenOrChild<ComponentProps<typeof Tooltip.Content>>;
    child?: Snippet<[{ props: Record<string, unknown> }]>;
  } = $props();

  const sidebar = useSidebar();
  const contextualSize = useSize();
  const row = getSidebarMenuRowContext();
  let proximityActive = $derived(row?.menu?.hover?.activeIndex === row?.index);
  let effectiveActive = $derived(isActive || status === 'active');
  let lit = $derived(effectiveActive || proximityActive);
  let resolvedDot = $derived(dot ?? (status ? (status === 'idle' ? 'ring' : 'filled') : undefined));
  let resolvedSize = $derived(size === 'default' && contextualSize === 'compact' ? 'sm' : size);
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
    const active = effectiveActive;
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

  const buttonProps = $derived({
    class: cn(
      sidebarMenuButtonVariants({ variant, size: resolvedSize }),
      !row?.menu && 'data-[proximity-active=true]:bg-hover data-[active=true]:bg-active',
      'data-[active=true]:text-foreground data-[proximity-active=true]:text-foreground',
      className,
    ),
    'data-slot': 'sidebar-menu-button',
    'data-sidebar': 'menu-button',
    'data-size': resolvedSize,
    'data-active': effectiveActive,
    'data-status': status,
    'data-proximity-active': proximityActive,
    'data-sidebar-index': row?.index,
    'aria-current': effectiveActive ? ('page' as const) : undefined,
    tabindex: tabIndex,
    style: `--row-gutter: ${gutterRest}px; --row-gutter-hover: ${gutterHover}px;`,
    onfocus: (event: FocusEvent & { currentTarget: HTMLButtonElement }) => {
      row?.menu?.hover?.setActiveIndex(row.index);
      row?.menu?.setFocus(row.index);
      onfocus?.(event);
    },
    onblur: (event: FocusEvent & { currentTarget: HTMLButtonElement }) => {
      onblur?.(event);
    },
    ...restProps,
  });
</script>

<!-- i18n-ignore (snippet parameter type annotation, not UI text) -->
{#snippet Button({ props }: { props?: Record<string, unknown> })}
  {@const mergedProps = mergeProps(buttonProps, props)}
  {#if child}
    {@render child({ props: mergedProps })}
  {:else}
    <button bind:this={ref} {...mergedProps}>
      {#if icon}
        <span
          class={cn(
            'sidebar-menu-icon text-muted-foreground flex size-4 shrink-0 items-center justify-center transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none [&>svg]:size-4 [&>svg]:transition-[stroke-width] [&>svg]:duration-spring-fast',
            lit && 'text-foreground',
          )}>{@render icon()}</span
        >
      {:else if resolvedDot}
        <span class="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
          <span
            class={cn(
              'size-2 rounded-full transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none',
              resolvedDot === 'ring' ? 'border border-current' : 'bg-current',
              lit ? 'text-foreground/60' : 'text-muted-foreground/50',
            )}
          ></span>
        </span>
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
            style:font-variation-settings={effectiveActive ? "'wght' 500" : "'wght' 400"}
            >{label}</span
          >
        </span>
        {@render children?.()}
      {:else}
        <span
          class={cn(
            'text-muted-foreground flex min-w-0 flex-1 items-center gap-2 truncate transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none',
            lit && 'text-foreground',
            effectiveActive && 'font-medium',
          )}>{@render children?.()}</span
        >
      {/if}
      {#if status === 'unread'}
        <span class="sr-only">, {m.hud_workspaceState_unread_label()}</span>
      {/if}
    </button>
  {/if}
{/snippet}

{#if !tooltipContent}
  {@render Button({})}
{:else}
  <!-- Provider ensures proper context and cleanup during component destruction -->
  <Tooltip.Provider>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          {@render Button({ props })}
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content
        side="right"
        align="center"
        hidden={sidebar.state !== 'collapsed' || sidebar.isMobile}
        {...tooltipContentProps}
      >
        {#if typeof tooltipContent === 'string'}
          {tooltipContent}
        {:else if tooltipContent}
          {@render tooltipContent()}
        {/if}
      </Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}

<style>
  :global([data-sidebar='menu-button'] > svg),
  .sidebar-menu-icon :global(svg) {
    stroke-width: 1.5;
  }

  :global([data-sidebar='menu-button'][data-active='true'] > svg),
  :global([data-sidebar='menu-button'][data-proximity-active='true'] > svg),
  .sidebar-menu-icon.text-foreground :global(svg) {
    stroke-width: 2;
  }
</style>
