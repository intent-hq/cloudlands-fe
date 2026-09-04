<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import { useSidebar } from './context.svelte.js';
  import { m } from '$shared/paraglide/messages.js';
  import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from './constants.js';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLButtonElement>, HTMLButtonElement> = $props();

  const sidebar = useSidebar();
  let dragged = false;
  let suppressClick = false;

  function handlePointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    sidebar.dismissPeek();
    const startX = event.clientX;
    const container = ref?.closest<HTMLElement>('[data-slot="sidebar-container"]');
    const measured = container?.getBoundingClientRect().width ?? Number.NaN;
    const parsed = sidebar.width.endsWith('px') ? Number.parseFloat(sidebar.width) : Number.NaN;
    const startWidth = measured > 0 ? measured : Number.isFinite(parsed) ? parsed : 256;
    dragged = false;

    const move = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * (sidebar.side === 'left' ? 1 : -1);
      const requested = startWidth + delta;
      dragged ||= Math.abs(delta) > 2;
      if (dragged && !sidebar.open) sidebar.setOpen(true);
      if (requested < SIDEBAR_MIN_WIDTH) {
        sidebar.setWidth(SIDEBAR_MIN_WIDTH);
        sidebar.setOpen(false);
      } else {
        sidebar.setWidth(Math.min(requested, SIDEBAR_MAX_WIDTH));
        sidebar.setOpen(true);
      }
    };
    const up = () => {
      suppressClick = dragged;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  function handleClick() {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!sidebar.open && sidebar.props.peek() === 'click') sidebar.requestPeek('click');
    else sidebar.toggle();
  }
</script>

<button
  bind:this={ref}
  data-sidebar="rail"
  data-slot="sidebar-rail"
  aria-label={m.ui_sidebar_toggle_label()}
  tabIndex={-1}
  onpointerdown={handlePointerDown}
  onpointerenter={() => sidebar.requestPeek('hover')}
  onclick={handleClick}
  title={m.ui_sidebar_toggle_label()}
  class={cn(
    'absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-[background-color] duration-spring-fast ease-spring-fast after:absolute after:inset-y-0 after:left-[calc(1/2*100%-1px)] after:w-px after:bg-border hover:after:bg-border motion-reduce:transition-none group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex',
    'in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize',
    '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
    'hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full',
    '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
    '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
    'group-data-[variant=inset]:inset-y-2',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</button>
