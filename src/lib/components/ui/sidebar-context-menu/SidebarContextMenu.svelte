<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { isSeparator, type SidebarMenuEntry, type SidebarMenuItem } from './types';
  import Portal from '$lib/components/ui/Portal.svelte';

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

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      onClickOutside?.();
    }
  }

  function handleItemClick(item: SidebarMenuItem) {
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
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleContextMenuOutside);
      document.removeEventListener('keydown', handleKeyDown);
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
        <button
          type="button"
          class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent
            {entry.disabled ? 'text-muted-foreground cursor-not-allowed' : 'text-foreground hover:bg-accent cursor-pointer'}
            {entry.destructive && !entry.disabled ? 'text-destructive-foreground hover:text-destructive-foreground' : ''}"
          onclick={() => handleItemClick(entry)}
          disabled={entry.disabled}
          role="menuitem"
        >
          {#if entry.icon}
            <Fa icon={entry.icon} class="w-2.5 h-2.5 opacity-60" />
          {/if}
          {entry.label}
        </button>
      {/if}
    {/each}
  </div>
</Portal>
