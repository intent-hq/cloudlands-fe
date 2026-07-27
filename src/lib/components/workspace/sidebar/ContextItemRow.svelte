<script lang="ts">
  /**
   * ContextItemRow - List item for displaying context items in the sidebar
   *
   * Displays context item with provider icon, title, and handles click actions.
   * Supports nested display for items under notes.
   */
  import type { ContextItem } from '$features/context/types';
  import ProviderIcon from '$lib/components/icons/ProviderIcon.svelte';
  import Fa from 'svelte-fa';
  import {
  faExternalLink,
  faChevronRight,
  faTrash,
  faArrowUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import { m } from '$shared/paraglide/messages.js';

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
  let contextMenu: { x: number; y: number } | null = $state(null);

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function getContextMenuItems(): SidebarMenuEntry[] {
    const items: SidebarMenuEntry[] = [
      {
        id: 'open',
        label: 'Open',
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

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="relative w-full text-left group flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors cursor-pointer border
         {isNested ? 'pl-6' : ''}
         {isSelected
    ? 'bg-primary/10 text-primary border-transparent'
    : isActive
      ? 'bg-background text-foreground border-border shadow-xs'
      : 'bg-sidebar border-transparent'}"
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
  role="button"
  tabindex="0"
>
  <!-- Provider Icon -->
  <div class="w-5 h-5 rounded flex items-center justify-center shrink-0">
    <ProviderIcon
      provider={item.provider}
      size={12}
      class={isSelected ? 'text-primary' : isActive ? 'text-foreground' : 'opacity-70'}
    />
  </div>

  <!-- Content -->
  <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
    <div class="w-full min-w-0 flex items-center gap-1.5">
      <span class="text-ui truncate {isSelected ? 'text-primary' : ''}"
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

  <!-- Action buttons -->
  <div
    class="absolute right-0 bg-inherit px-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
  >
    {#if hasExternalLink}
      <Tooltip content="Open in browser" side="top" delayDuration={300}>
        <button
          type="button"
          class="p-1 rounded hover:bg-muted transition-colors cursor-pointer"
          onclick={handleExternalClick}
        >
          <Fa icon={faExternalLink} size="xs" class="text-ghost" />
        </button>
      </Tooltip>
    {/if}
    <!-- {#if canDelete}
      <Tooltip content="Remove from context" side="top" delayDuration={300}>
        <button
          type="button"
          class="p-1 rounded hover:bg-destructive/10 transition-colors cursor-pointer"
          onclick={handleDeleteClick}
        >
          <Fa icon={faTrash} size="xs" class="text-ghost hover:text-destructive-foreground" />
        </button>
      </Tooltip>
    {/if} -->
  </div>
  {#if item.type === 'note'}
    <Fa
      icon={faChevronRight}
      size="xs"
      class="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
    />
  {/if}
</div>

{#if contextMenu}
  <SidebarContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={getContextMenuItems()}
    onClickOutside={closeContextMenu}
  />
{/if}
