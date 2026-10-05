<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  /**
   * ContextItemRow - List item for displaying context items in the sidebar
   *
   * Displays context item with provider icon, title, and handles click actions.
   * Supports nested display for items under notes.
   */
  import type { ContextItem } from '$features/context/types';
  import ProviderIcon from '$features/context/components/ContextProviderIcon.svelte';
  import Fa from 'svelte-fa';
  import {
    faExternalLink,
    faChevronRight,
    faTrash,
    faArrowUpRightFromSquare,
  } from '@fortawesome/free-solid-svg-icons';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
    type SidebarMenuEntry,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import { m } from '$shared/paraglide/messages.js';
  import ResourceIconTile from '$lib/components/shared/ResourceIconTile.svelte';

  interface Props {
    item: ContextItem;
    isNested?: boolean;
    isSelected?: boolean;
    isActive?: boolean;
    onClick?: (item: ContextItem) => void;
    onExternalOpen?: (item: ContextItem) => void;
    onDelete?: (item: ContextItem) => void;
  }

  let {
    item,
    isNested = false,
    isSelected = false,
    isActive = false,
    onClick,
    onExternalOpen,
    onDelete,
  }: Props = $props();

  // Display text based on item type
  const displayTitle = $derived(() => {
    switch (item.type) {
      case 'linear-issue':
        return item.identifier;
      case 'github-issue':
        return `#${item.number}`;
      case 'sentry-issue':
        return item.shortId;
      default:
        return item.title;
    }
  });

  const subtitle = $derived(() => {
    switch (item.type) {
      case 'linear-issue':
      case 'github-issue':
      case 'sentry-issue':
        return item.title;
      case 'browser-url':
        return item.url;
      default:
        return null;
    }
  });

  const hasExternalLink = $derived(item.type !== 'note' && !!item.url);

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    onClick?.(item);
  }

  function handleExternalClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    onExternalOpen?.(item);
  }

  // Can delete non-note items
  const canDelete = $derived(item.type !== 'note');

  // Context menu state
  let contextMenu: (SidebarContextPosition & { itemId: string }) | null = $state(null);

  $effect(() => {
    if (contextMenu && contextMenu.itemId !== item.id) contextMenu = null;
  });

  function handleContextMenu(e: MouseEvent | KeyboardEvent) {
    const position = getSidebarContextPosition(e);
    if (position) contextMenu = { ...position, itemId: item.id };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function getContextMenuItems(): SidebarMenuEntry[] {
    const items: SidebarMenuEntry[] = [
      {
        id: 'open',
        label: m.ui_fileActions_open_label(),
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          onClick?.(item);
          closeContextMenu();
        },
      },
    ];

    // Add external link option if available
    if (hasExternalLink) {
      items.push({
        id: 'open-external',
        label: m.workspace_contextItem_openInBrowser_label(),
        icon: faExternalLink,
        onClick: () => {
          onExternalOpen?.(item);
          closeContextMenu();
        },
      });
    }

    // Add delete option for non-note items
    if (canDelete) {
      items.push({ type: 'separator' });
      items.push({
        id: 'remove',
        label: m.workspace_contextItem_removeFromContext_label(),
        icon: faTrash,
        destructive: true,
        onClick: () => {
          onDelete?.(item);
          closeContextMenu();
        },
      });
    }

    return items;
  }
</script>

<div
  class="relative w-full text-left group flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors cursor-pointer border
         {isNested ? 'pl-6' : ''}
         {isSelected
    ? 'bg-primary/10 text-primary border-transparent'
    : isActive
      ? 'bg-background text-foreground border-transparent'
      : 'bg-sidebar border-transparent'}"
>
  <Button
    variant="plain"
    wrapContent={false}
    class="flex min-w-0 flex-1 items-center justify-start gap-1.5 text-left"
    onclick={handleClick}
    oncontextmenu={handleContextMenu}
    onkeydown={handleContextMenu}
    aria-current={isActive ? 'page' : undefined}
  >
    <!-- Provider Icon -->
    {#if item.type === 'note'}
      <ResourceIconTile kind="note" />
    {:else}
      <div class="w-5 h-5 rounded flex items-center justify-center shrink-0">
        <ProviderIcon
          provider={item.provider}
          size={12}
          class={isSelected ? 'text-primary-ink' : isActive ? 'text-foreground' : 'opacity-70'}
        />
      </div>
    {/if}

    <!-- Content -->
    <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
      <div class="w-full min-w-0 flex items-center gap-1.5">
        <span class="type-body font-normal truncate {isSelected ? 'text-primary-ink' : ''}"
          >{displayTitle()}</span
        >
        {#if item.type === 'note' && item.isSpec}
          <span class="text-xs px-1 py-0.5 rounded bg-primary/10 text-primary font-medium"
            >{m.workspace_contextItem_spec_label()}</span
          >
        {/if}
      </div>
      {#if subtitle()}
        <div class="text-xs text-subtle truncate">{subtitle()}</div>
      {/if}
    </div>

    {#if item.type === 'note'}
      <Fa icon={faChevronRight} size="xs" class="text-muted-foreground" />
    {/if}
  </Button>

  <!-- Action buttons -->
  <div
    class="absolute right-0 bg-inherit px-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
  >
    {#if hasExternalLink}
      <Tooltip
        content={m.workspace_contextItem_openInBrowser_label()}
        side="top"
        delayDuration={300}
      >
        <Button
          variant="ghost"
          type="button"
          size="icon-compact"
          iconOnly
          aria-label={m.workspace_contextItem_openInBrowser_label()}
          class="rounded hover:bg-muted transition-colors cursor-pointer"
          onclick={handleExternalClick}
        >
          <Fa icon={faExternalLink} size="xs" class="text-ghost" />
        </Button>
      </Tooltip>
    {/if}
    <!-- {#if canDelete}
      <Tooltip content="Remove from context" side="top" delayDuration={300}>
        <Button
        variant="ghost"
          type="button"
          class="p-1 rounded hover:bg-danger-background/10 transition-colors cursor-pointer"
          onclick={handleDeleteClick}
        >
          <Fa icon={faTrash} size="xs" class="text-ghost hover:text-danger" />
        </Button>
      </Tooltip>
    {/if} -->
  </div>
</div>

{#if contextMenu}
  <SidebarContextMenu
    x={contextMenu?.x ?? 0}
    y={contextMenu?.y ?? 0}
    returnFocus={contextMenu?.returnFocus}
    ariaLabel={item.title}
    items={getContextMenuItems()}
    onClickOutside={closeContextMenu}
  />
{/if}
