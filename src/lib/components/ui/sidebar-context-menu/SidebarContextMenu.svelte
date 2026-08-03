<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faCheck, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import {
  isSeparator,
  type SidebarMenuEntry,
  type SidebarMenuItem,
} from './types';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';

  interface Props {
    x: number;
    y: number;
    items: SidebarMenuEntry[];
    onClickOutside?: () => void;
  }

  let { x, y, items, onClickOutside }: Props = $props();

  let menuElement: HTMLElement | null = $state(null);

  // Adjust position if menu would go off screen
  let adjustedX = $state(x);
  let adjustedY = $state(y);

  function adjustPosition() {
    if (!menuElement) return;

    const rect = menuElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Adjust horizontal position if needed
    if (x + rect.width > viewportWidth - 10) {
      adjustedX = viewportWidth - rect.width - 10;
    } else {
      adjustedX = x;
    }

    // Adjust vertical position if needed
    if (y + rect.height > viewportHeight - 10) {
      adjustedY = viewportHeight - rect.height - 10;
    } else {
      adjustedY = y;
    }
  }

  function handleClickOutside(event: MouseEvent) {
    if (menuElement && !menuElement.contains(event.target as Node)) {
      onClickOutside?.();
    }
  }

  function handleContextMenuOutside(event: MouseEvent) {
    // Close when right-clicking outside the menu (allows new menu to open at new position)
    if (menuElement && !menuElement.contains(event.target as Node)) {
      onClickOutside?.();
    }
  }

  function handleItemClick(item: SidebarMenuItem) {
    if (item.disabled) return;
    if (item.submenu) {
      openSubmenuId = openSubmenuId === item.id ? null : item.id;
      return;
    }
    item.onClick();
    onClickOutside?.();
  }

  // Flyout submenu: opens on hover/click of the parent item, closes when the
  // pointer moves to another top-level item.
  let openSubmenuId: string | null = $state(null);

  function handleItemMouseEnter(item: SidebarMenuItem) {
    openSubmenuId = item.submenu && !item.disabled ? item.id : null;
  }

  function handleSubmenuItemClick(item: SidebarMenuItem) {
    if (item.disabled) return;
    item.onClick();
    onClickOutside?.();
  }

  onMount(() => {
    // Use requestAnimationFrame to measure after render
    requestAnimationFrame(() => adjustPosition());

    // Use mousedown instead of click to close before the new contextmenu event fires
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('contextmenu', handleContextMenuOutside);
    // Escape layer: the menu only exists while open, and is the topmost overlay
    const releaseEscapeLayer = pushEscapeLayer(() => {
      onClickOutside?.();
    });

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleContextMenuOutside);
      releaseEscapeLayer();
    };
  });
</script>

<Portal zIndex={100}>
  <div
    bind:this={menuElement}
    class="fixed z-[100] bg-popover border border-border shadow-lg py-0.5 min-w-40"
    style="left: {adjustedX}px; top: {adjustedY}px;"
    role="menu"
  >
    {#each items as entry, i (i)}
      {#if isSeparator(entry)}
        <div class="h-px bg-border my-0.5"></div>
      {:else}
        <div class="relative" onmouseenter={() => handleItemMouseEnter(entry)} role="presentation">
          <button
            type="button"
            class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent
              {entry.disabled ? 'text-muted-foreground cursor-not-allowed' : 'text-foreground hover:bg-accent cursor-pointer'}
              {entry.destructive && !entry.disabled ? 'text-destructive-foreground hover:text-destructive-foreground' : ''}"
            onclick={() => handleItemClick(entry)}
            disabled={entry.disabled}
            role="menuitem"
            aria-haspopup={entry.submenu ? 'menu' : undefined}
            aria-expanded={entry.submenu ? openSubmenuId === entry.id : undefined}
          >
            {#if entry.icon}
              <Fa icon={entry.icon} class="w-2.5 h-2.5 opacity-60" />
            {/if}
            <span class="flex-1">{entry.label}</span>
            {#if entry.submenu}
              <Fa icon={faChevronRight} class="w-2 h-2 opacity-60" />
            {/if}
          </button>
          {#if entry.submenu && openSubmenuId === entry.id}
            <div
              class="absolute left-full top-0 -mt-0.5 bg-popover border border-border shadow-lg py-0.5 min-w-32"
              role="menu"
            >
              {#each entry.submenu as subitem (subitem.id)}
                <button
                  type="button"
                  class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent
                    {subitem.disabled ? 'text-muted-foreground cursor-not-allowed' : 'text-foreground hover:bg-accent cursor-pointer'}"
                  onclick={() => handleSubmenuItemClick(subitem)}
                  disabled={subitem.disabled}
                  role="menuitem"
                >
                  <span class="flex-1">{subitem.label}</span>
                  {#if subitem.checked}
                    <Fa icon={faCheck} class="w-2.5 h-2.5 opacity-60" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</Portal>
