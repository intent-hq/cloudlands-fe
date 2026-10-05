<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import { SIDEBAR_WIDTH_MOBILE } from './constants.js';
  import { useSidebar } from './context.svelte.js';
  import { m } from '$shared/paraglide/messages.js';
  import Rail from './sidebar-rail.svelte';

  let {
    ref = $bindable(null),
    side = 'left',
    variant = 'sidebar',
    collapsible = 'offcanvas',
    rail = true,
    bordered = true,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    side?: 'left' | 'right';
    variant?: 'sidebar' | 'floating' | 'inset';
    collapsible?: 'offcanvas' | 'icon' | 'none';
    rail?: boolean;
    bordered?: boolean;
  } = $props();

  const sidebar = useSidebar();
  const effectiveCollapsible = $derived(collapsible === 'icon' ? 'offcanvas' : collapsible);

  $effect(() => sidebar.setSide(side));
</script>

{#if collapsible === 'none'}
  <div
    class={cn(
      'bg-sidebar text-sidebar-foreground w-(--sidebar-width) flex h-full flex-col',
      className,
    )}
    bind:this={ref}
    {...restProps}
  >
    {@render children?.()}
  </div>
{:else if sidebar.isMobile}
  <Sheet.Root bind:open={() => sidebar.openMobile, (v) => sidebar.setOpenMobile(v)} {...restProps}>
    <Sheet.Content
      data-sidebar="sidebar"
      data-slot="sidebar"
      data-mobile="true"
      class="bg-sidebar text-sidebar-foreground w-(--sidebar-width) p-0 [&>button]:hidden"
      style="--sidebar-width: {SIDEBAR_WIDTH_MOBILE};"
      {side}
    >
      <Sheet.Header class="sr-only">
        <Sheet.Title>{m.ui_sidebar_title_label()}</Sheet.Title>
        <Sheet.Description>{m.ui_sidebar_mobile_description()}</Sheet.Description>
      </Sheet.Header>
      <div class="flex h-full w-full flex-col">
        {@render children?.()}
      </div>
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <div
    bind:this={ref}
    class="text-sidebar-foreground group peer hidden md:block"
    data-state={sidebar.state}
    data-collapsible={sidebar.state === 'collapsed' ? effectiveCollapsible : ''}
    data-peeking={sidebar.peekOpen}
    data-variant={variant}
    data-side={side}
    data-slot="sidebar"
  >
    <!-- This is what handles the sidebar gap on desktop -->
    <div
      data-slot="sidebar-gap"
      class={cn(
        'w-(--sidebar-width) relative bg-transparent transition-[width] duration-spring-slow ease-spring-slow motion-reduce:transition-none',
        'group-data-[collapsible=offcanvas]:w-0',
        'group-data-[side=right]:rotate-180',
      )}
    ></div>
    <div
      data-slot="sidebar-container"
      class={cn(
        'w-(--sidebar-width) fixed inset-y-0 z-10 hidden h-svh transition-[left,right,width] duration-spring-slow ease-spring-slow motion-reduce:transition-none md:flex',
        side === 'left'
          ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'
          : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
        'group-data-[peeking=true]:left-auto group-data-[peeking=true]:right-auto',
        side === 'left' && 'group-data-[peeking=true]:left-0',
        side === 'right' && 'group-data-[peeking=true]:right-0',
        // Adjust the padding for floating and inset variants.
        variant === 'floating' || variant === 'inset'
          ? 'p-2'
          : bordered &&
              'group-data-[side=left]:border-r group-data-[side=right]:border-l border-border',
        sidebar.peekOpen && 'p-2',
        className,
      )}
      onpointerenter={() => sidebar.requestPeek('hover')}
      onpointerleave={() => sidebar.props.peek() === 'hover' && sidebar.dismissPeek()}
      {...restProps}
    >
      <div
        data-sidebar="sidebar"
        data-slot="sidebar-inner"
        class={cn(
          'bg-sidebar flex h-full w-full flex-col',
          'group-data-[variant=floating]:rounded-md group-data-[variant=floating]:shadow-(--elevation-raised)',
          'group-data-[variant=inset]:overflow-hidden group-data-[variant=inset]:rounded-md',
          bordered &&
            'group-data-[variant=floating]:border group-data-[variant=floating]:border-border',
          sidebar.peekOpen && 'rounded-md border border-border shadow-(--elevation-overlay)',
        )}
      >
        {@render children?.()}
      </div>
      {#if rail && effectiveCollapsible === 'offcanvas'}
        <Rail />
      {/if}
    </div>
  </div>
{/if}
