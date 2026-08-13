<script lang="ts">
  /**
   * SidebarNav - Compact global navigation for the window title bar
   *
   * A narrow sidebar with icon buttons for:
   * - Home
   * - New Workspace
   * - Active Workspaces (in progress / unread)
   * - All Workspaces
   * - Settings
   *
   * Each icon shows a hover card with preview content.
   */

  import { m } from '$shared/paraglide/messages.js';
  import type { SidebarNavItem } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import { isCombinedWorkspacePanelItem } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import { Button } from '$lib/components/ui/button';
  import IntentNavigationIcon from '$lib/icons/IntentNavigationIcon.svelte';
  import { cn } from '$lib/utils';
  import {
    TITLEBAR_NAVIGATION_CONTROL_CLASS,
    TITLEBAR_NAVIGATION_GLYPH_CLASS,
  } from '../titlebar-navigation';
  import SidebarNavHoverCard from './SidebarNavHoverCard.svelte';

  import {
    selectPanelItem,
    selectActiveCard,
    selectOnboardingActive,
    selectExpandedItem,
    selectIsCardPinned,
    selectContextMenuOpen,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import {
    togglePanel,
    setHoveredItem,
    setExpandedItem,
    setDeferredLeave,
    clearDeferredLeave,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';
  const panelItem$ = selectPanelItem();
  const activeCard$ = selectActiveCard();
  const onboardingActive$ = selectOnboardingActive();
  const expandedItem$ = selectExpandedItem();
  const isCardPinned$ = selectIsCardPinned();
  const contextMenuOpen$ = selectContextMenuOpen();

  const navItems: {
    id: SidebarNavItem;
    label: string;
  }[] = [{ id: 'all-workspaces', label: m.layout_sidebarNav_allWorkspaces_title() }];

  function isItemActive(id: SidebarNavItem): boolean {
    // Highlight the workspace button for either half of the combined panel.
    if ($panelItem$ === id) return true;
    if (
      id === 'all-workspaces' &&
      $panelItem$ !== null &&
      isCombinedWorkspacePanelItem($panelItem$)
    )
      return true;
    return false;
  }

  // ── Hover timeout management (component-local UI behavior) ──
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  let leaveTimeout: ReturnType<typeof setTimeout> | null = null;

  // Process deferred leave when context menu closes
  let prevContextMenuOpen = false;
  $effect(() => {
    const isOpen = $contextMenuOpen$;
    if (prevContextMenuOpen && !isOpen) {
      // Context menu just closed — process any deferred leave
      const state = appStore.state;
      const deferredLeave = state.sidebarNav.deferredLeave;
      appStore.dispatch(clearDeferredLeave());

      const pinnedExpanded =
        selectIsCardPinned.select(state) && selectExpandedItem.select(state) !== null;
      if (deferredLeave && !pinnedExpanded) {
        leaveTimeout = setTimeout(() => {
          appStore.dispatch(setHoveredItem(null));
          if (deferredLeave === 'card') {
            appStore.dispatch(setExpandedItem(null));
          }
        }, 200);
      }
    }
    prevContextMenuOpen = isOpen;
  });

  function handleMouseEnter(item: SidebarNavItem) {
    if (leaveTimeout) {
      clearTimeout(leaveTimeout);
      leaveTimeout = null;
    }
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
    }
    // Cancel any deferred leave — pointer is back on the nav
    appStore.dispatch(clearDeferredLeave());

    // If an expanded item is open, switch immediately
    if ($expandedItem$) {
      appStore.dispatch(setHoveredItem(item));
      return;
    }

    // Otherwise delay hover card appearance
    hoverTimeout = setTimeout(() => {
      appStore.dispatch(setHoveredItem(item));
    }, 120);
  }

  function handleMouseLeave() {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }

    // Pinned expanded cards never auto-close. The pin only gates expanded cards —
    // the pin affordance doesn't render on transient (non-expanded) cards, so they
    // must never be pin-wedged open.
    if ($isCardPinned$ && $expandedItem$ !== null) return;

    // Context menu open — defer the leave so we can process it when the menu closes
    if ($contextMenuOpen$) {
      appStore.dispatch(setDeferredLeave('nav'));
      return;
    }

    // Set deferred leave so the hover card can cancel it if the pointer
    // crosses the gap and enters the card before the timeout fires.
    appStore.dispatch(setDeferredLeave('nav'));

    leaveTimeout = setTimeout(() => {
      // Only close if the deferred leave wasn't cleared (e.g. by the card's mouseenter)
      const state = appStore.state;
      if (state.sidebarNav.deferredLeave === 'nav') {
        appStore.dispatch(clearDeferredLeave());
        appStore.dispatch(setHoveredItem(null));
        // Don't clear expandedItem on mouse leave - it stays until clicked elsewhere
      }
    }, 200);
  }

  function handleClick(id: SidebarNavItem) {
    // Primary activation toggles the persistent combined Spaces + Chief panel.
    appStore.dispatch(togglePanel(id));
  }

  function openMenu(id: SidebarNavItem) {
    appStore.dispatch(setHoveredItem(id));
  }

  function handleMenuKeydown(event: KeyboardEvent, id: SidebarNavItem) {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(id);
  }

  function handleContextMenu(event: MouseEvent, id: SidebarNavItem) {
    event.preventDefault();
    openMenu(id);
  }

  // Track icon button positions for hover card placement
  let iconRefs = $state<Record<string, HTMLButtonElement | null>>(
    Object.fromEntries(navItems.map((item) => [item.id, null])),
  );
</script>

{#if !$onboardingActive$}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <nav
    class="group/nav sidebar-nav flex h-8 shrink-0 items-center gap-0.5"
    aria-label={m.layout_sidebarNav_ariaLabel()}
    data-top-navigation
  >
    <div class="flex items-center gap-0.5">
      {#each navItems as item (item.id)}
        {@const active = isItemActive(item.id)}
        {@const isHovered = $activeCard$ === item.id}
        <Button
          bind:ref={iconRefs[item.id]}
          variant="ghost-light"
          size="icon"
          iconOnly
          class={cn('sidebar-nav-btn relative', TITLEBAR_NAVIGATION_CONTROL_CLASS)}
          onclick={() => handleClick(item.id)}
          onmouseenter={() => handleMouseEnter(item.id)}
          onmouseleave={handleMouseLeave}
          onkeydown={(event) => handleMenuKeydown(event, item.id)}
          oncontextmenu={(event) => handleContextMenu(event, item.id)}
          aria-label={m.ui_shortcuts_toggleSpaces_label()}
          aria-pressed={active}
          aria-haspopup="dialog"
          aria-expanded={isHovered}
          aria-controls="spaces-navigation-menu"
          title={m.ui_shortcuts_toggleSpaces_label()}
          data-nav-item={item.id}
          data-titlebar-spaces-control
        >
          <span class={TITLEBAR_NAVIGATION_GLYPH_CLASS} data-titlebar-navigation-glyph>
            <IntentNavigationIcon name="dandelion" size={16} class="pointer-events-none size-4!" />
          </span>
        </Button>
      {/each}
    </div>
  </nav>

  <!-- Hover Card Portal -->
  <SidebarNavHoverCard {iconRefs} />
{/if}
