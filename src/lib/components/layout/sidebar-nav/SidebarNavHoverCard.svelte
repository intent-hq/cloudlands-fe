<script lang="ts">
  /**
   * SidebarNavHoverCard - Popup card that appears when hovering sidebar nav items
   *
   * Positioned to the right of the hovered icon, shows preview content
   * for each nav item type.
   *
   * Focus management: steals focus when the card appears so keyboard navigation
   * works immediately, and restores focus to the previously focused element on close.
   */

  import { tick } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { SidebarNavItem } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import NewWorkspaceCard from './cards/NewWorkspaceCard.svelte';
  import ActiveWorkspacesCard from './cards/ActiveWorkspacesCard.svelte';
  import AllWorkspacesCard from './cards/AllWorkspacesCard.svelte';
  import ChiefCard from './cards/ChiefCard.svelte';
  import { fly } from 'svelte/transition';
  import { faThumbtack } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Tooltip } from '$lib/components/ui/tooltip';

  import {
  selectActiveCard,
  selectExpandedItem,
  selectIsCardPinned,
  selectContextMenuOpen,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import {
  closeHoverCards,
  setHoveredItem,
  setExpandedItem,
  toggleCardPinned,
  setDeferredLeave,
  clearDeferredLeave,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';

  const activeCard$ = selectActiveCard();
  const expandedItem$ = selectExpandedItem();
  const isCardPinned$ = selectIsCardPinned();
  const contextMenuOpen$ = selectContextMenuOpen();

  const cardMeta: Partial<Record<SidebarNavItem, { title: () => string; description: string }>> = {
    'new-workspace': { title: () => m.layout_sidebarNav_newWorkspace_title(), description: '' },
    active: { title: () => m.layout_sidebarNav_activeWorkspaces_title(), description: '' },
    'all-workspaces': { title: () => m.layout_sidebarNav_allWorkspaces_title(), description: '' },
  };

  interface Props {
    iconRefs: Record<string, HTMLButtonElement | null>;
  }

  let { iconRefs }: Props = $props();

  const isExpanded = $derived($expandedItem$ !== null);
  const meta = $derived($activeCard$ ? cardMeta[$activeCard$] : null);

  // Focus management: save/restore focus when card opens/closes
  let previouslyFocused: HTMLElement | null = null;
  let contentEl: HTMLDivElement | null = $state(null);
  let cardEl: HTMLDivElement | null = $state(null);

  // Outside-click dismissal: while a card is showing, a pointerdown outside both
  // the card and the nav rail closes it — unpinned expanded cards included (the
  // "stays until clicked elsewhere" contract). Clicks inside the card or the nav,
  // or while a sidebar context menu is open, do not dismiss; a pinned+expanded
  // card stays open (pin means pin).
  $effect(() => {
    if (!$activeCard$) return;
    const handlePointerDown = (e: PointerEvent) => {
      const node = e.target instanceof Node ? e.target : null;
      if (!node) return;
      if (cardEl?.contains(node)) return;
      const el = node instanceof Element ? node : node.parentElement;
      if (el?.closest('.sidebar-nav')) return;
      const state = appStore.state;
      if (selectContextMenuOpen.select(state)) return;
      if (selectIsCardPinned.select(state) && selectExpandedItem.select(state) !== null) return;
      appStore.dispatch(closeHoverCards());
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  });

  $effect(() => {
    if ($activeCard$) {
      // Card is opening — save current focus and move it into the card
      previouslyFocused = document.activeElement as HTMLElement | null;
      tick().then(() => {
        // Focus the first focusable child (the listbox container or search input)
        const focusable = contentEl?.querySelector<HTMLElement>('[tabindex="0"], input, button');
        focusable?.focus();
      });
    } else {
      // Card is closing — restore focus
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
      previouslyFocused = null;
    }
  });

  // Hover card mouse enter/leave: cancel/set leave timeouts.
  // The old store managed timeouts internally. Since hover timeouts are
  // component-local UI behavior, we keep them here.
  let leaveTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleCardMouseEnter() {
    if (leaveTimeout) {
      clearTimeout(leaveTimeout);
      leaveTimeout = null;
    }
    // Cancel any deferred leave — pointer is back inside the card
    appStore.dispatch(clearDeferredLeave());
  }

  function handleCardMouseLeave() {
    // If an expanded card is pinned open, don't auto-close. The pin only gates
    // expanded cards — the pin affordance doesn't render on transient
    // (non-expanded) cards, so they must never be pin-wedged open.
    if ($isCardPinned$ && isExpanded) return;

    if ($contextMenuOpen$) {
      appStore.dispatch(setDeferredLeave('card'));
      return;
    }

    leaveTimeout = setTimeout(() => {
      appStore.dispatch(setHoveredItem(null));
      appStore.dispatch(setExpandedItem(null));
    }, 200);
  }

  function handleCardKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      appStore.dispatch(closeHoverCards());
    }
  }

  // Calculate card position based on the hovered icon
  const cardStyle = $derived.by(() => {
    if (!$activeCard$) return '';
    const ref = iconRefs[$activeCard$];
    if (!ref) return 'top: 48px; left: 60px;';

    const rect = ref.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const padding = 8;

    // If the button is in the bottom half, anchor card bottom to button bottom
    if (rect.bottom > viewportHeight / 2) {
      return `bottom: ${viewportHeight - rect.bottom - padding}px; left: 60px;`;
    }

    // Otherwise align top of card with top of icon
    const top = Math.max(padding, rect.top - padding);
    return `top: ${top}px; left: 60px;`;
  });
</script>

{#if $activeCard$}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={cardEl}
    class="sidebar-hover-card fixed z-100"
    style={cardStyle}
    onmouseenter={handleCardMouseEnter}
    onmouseleave={handleCardMouseLeave}
    onkeydown={handleCardKeydown}
    transition:fly={{ x: -8, duration: 150 }}
  >
    <!-- Invisible bridge element: extends the hover hit-area leftward to cover the
         gap between the nav rail and the card, so the pointer doesn't leave/re-enter -->
    <div class="absolute top-0 bottom-0 -left-4 w-4" aria-hidden="true"></div>
    <div
      class="bg-popover border border-border shadow-lg overflow-hidden flex flex-col
        {isExpanded ? 'w-80 max-h-[70vh]' : 'w-72 max-h-[50vh]'}"
    >
      <!-- Header -->
      {#if meta}
        <div class="px-3 pt-3 pb-2 shrink-0 flex items-start justify-between">
          <div>
            <h3 class="{isExpanded ? 'text-base' : 'text-sm'} font-semibold text-foreground">
              {meta.title()}
            </h3>
            {#if meta.description}
              <p class="{isExpanded ? 'text-xs' : 'text-ui'} text-subtle mt-0.5">
                {meta.description}
              </p>
            {/if}
          </div>
          {#if isExpanded}
            <Tooltip content={$isCardPinned$ ? m.layout_sidebarNav_unpinSidebar_tooltip() : m.layout_sidebarNav_pinSidebar_tooltip()} side="bottom" sideOffset={4}>
              <button
                class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded transition-all hover:bg-muted/50
                  {$isCardPinned$ ? 'text-foreground rotate-0' : 'text-muted-foreground rotate-45'}"
                onclick={() => appStore.dispatch(toggleCardPinned())}
                aria-label={$isCardPinned$ ? m.layout_sidebarNav_unpinSidebar_tooltip() : m.layout_sidebarNav_pinSidebar_tooltip()}
              >
                <Fa icon={faThumbtack} size="xs" />
              </button>
            </Tooltip>
          {/if}
        </div>
      {/if}

      <!-- Content -->
      <div class="flex-1 min-h-0 overflow-y-auto" bind:this={contentEl}>
        {#if $activeCard$ === 'new-workspace'}
          <NewWorkspaceCard expanded={isExpanded} />
        {:else if $activeCard$ === 'active'}
          <ActiveWorkspacesCard expanded={isExpanded} />
        {:else if $activeCard$ === 'chief'}
          <ChiefCard expanded={isExpanded} />
        {:else if $activeCard$ === 'all-workspaces'}
          <AllWorkspacesCard expanded={isExpanded} />
        {/if}
      </div>
    </div>
  </div>
{/if}
