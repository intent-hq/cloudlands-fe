<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import {
    SIDEBAR_COOKIE_MAX_AGE,
    SIDEBAR_COOKIE_NAME,
    SIDEBAR_WIDTH,
    SIDEBAR_WIDTH_MOBILE,
  } from './constants.js';
  import { setSidebar, type SidebarPeek } from './context.svelte.js';

  let {
    ref = $bindable(null),
    open = $bindable(true),
    onOpenChange = () => {},
    persist = true,
    peek = 'none',
    shortcut,
    width = SIDEBAR_WIDTH,
    widthMobile = SIDEBAR_WIDTH_MOBILE,
    class: className,
    style,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    persist?: boolean;
    peek?: SidebarPeek;
    shortcut?: string | null;
    width?: string;
    widthMobile?: string;
  } = $props();

  const sidebar = setSidebar({
    open: () => open,
    setOpen: (value: boolean) => {
      open = value;
      onOpenChange(value);

      if (persist) {
        document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
      }
    },
    peek: () => peek,
    shortcut: () => shortcut,
    width: () => width,
  });

  $effect(() => sidebar.setProviderElement(ref));
</script>

<svelte:window
  onkeydown={sidebar.handleShortcutKeydown}
  onpointerdown={sidebar.handleOutsidePointerDown}
/>

<Tooltip.Provider delayDuration={0}>
  <div
    data-slot="sidebar-wrapper"
    style="--sidebar-width: {sidebar.width}; --sidebar-width-mobile: {widthMobile}; {style}"
    class={cn(
      'group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full',
      className,
    )}
    bind:this={ref}
    {...restProps}
  >
    {@render children?.()}
  </div>
</Tooltip.Provider>
