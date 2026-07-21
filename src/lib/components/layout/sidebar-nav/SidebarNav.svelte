<script lang="ts">
  /**
   * SidebarNav - Slack-style icon rail navigation
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

  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { invoke } from '$lib/electron-bridge';
  import {
  navigateToSettings,
  navigateBackFromSettings,
} from '$lib/utils/workspace-navigation';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import {
  faHome,
  faPlus,
  faLayerGroup,
  faCog,
  faBell,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { SidebarNavItem } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import SidebarNavHoverCard from './SidebarNavHoverCard.svelte';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { WorkspaceStatusEnum } from '$shared/types';

  import {
  selectActiveStreamsVersion,
  selectPanelItem,
  selectActiveCard,
  selectOnboardingActive,
  selectExpandedItem,
  selectIsCardPinned,
  selectContextMenuOpen,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import {
  closeAll,
  togglePanel,
  setHoveredItem,
  setExpandedItem,
  setDeferredLeave,
  clearDeferredLeave,
  setShowCreateModal,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

  import {
  selectUnreadAgentIds,
  selectUnreadAgentIdsForWorkspace,
} from '$store/renderer/slices/unread-tracking/unread-tracking-selectors';
  import { isWorkspaceActivityWithin } from '$shared/utils/workspace-activity-time';
  import { store as appStore } from '$store/renderer/store';

  const workspaceItems = selectWorkspaceItems();
  const activeStreamsVersion$ = selectActiveStreamsVersion();
  const unreadAgentIds$ = selectUnreadAgentIds();
  const panelItem$ = selectPanelItem();
  const activeCard$ = selectActiveCard();
  const onboardingActive$ = selectOnboardingActive();
  const expandedItem$ = selectExpandedItem();
  const isCardPinned$ = selectIsCardPinned();
  const contextMenuOpen$ = selectContextMenuOpen();

  // Count unread workspaces only (within 24h)
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  const unreadCount = $derived.by(() => {
    // Read shared version counters so this re-runs when streams/unread state changes
    void $activeStreamsVersion$;
    // Reading unreadAgentIds$ triggers re-evaluation when unread state changes
    void $unreadAgentIds$;
    const now = Date.now();
    const state = appStore.state;
    let count = 0;
    for (const ws of $workspaceItems) {
      if (ws.status === WorkspaceStatusEnum.Archived || ws.status === WorkspaceStatusEnum.Deleted)
        continue;
      // Skip if currently streaming (not "unread")
      if (activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id).length > 0) continue;
      const unreadIds = selectUnreadAgentIdsForWorkspace.select(state, ws.id);
      if (unreadIds.length > 0 && isWorkspaceActivityWithin(ws, now, ONE_DAY_MS)) count++;
    }
    return count;
  });

  const isHomePage = $derived(page.url.pathname === '/');
  const isSettingsPage = $derived(page.url.pathname === '/settings');

  const navItems: {
    id: SidebarNavItem;
    icon: typeof faHome;
    label: string;
    badge?: () => number;
  }[] = [
    { id: 'home', icon: faHome, label: 'Home' },
    { id: 'new-workspace', icon: faPlus, label: 'New' },
    { id: 'active', icon: faBell, label: 'Active', badge: () => unreadCount },
    { id: 'all-workspaces', icon: faLayerGroup, label: 'All' },
    { id: 'chief', icon: faWandMagicSparkles, label: 'Assistant' },
    { id: 'settings', icon: faCog, label: 'Settings' },
  ];

  function isItemActive(id: SidebarNavItem): boolean {
    if (id === 'home' && isHomePage) return true;
    if (id === 'settings' && isSettingsPage) return true;
    // Highlight when panel is open for this item
    if ($panelItem$ === id) return true;
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

      if (deferredLeave && !selectIsCardPinned.select(state)) {
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

    // Home and settings don't have hover cards — skip
    if (item === 'home' || item === 'settings') return;

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

    // Pinned cards never auto-close
    if ($isCardPinned$) return;

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

  function handleClick(id: SidebarNavItem, event?: MouseEvent) {
    if (id === 'home') {
      appStore.dispatch(closeAll(false));
      goto('/');
    } else if (id === 'settings') {
      appStore.dispatch(closeAll(false));
      const isOnSettings = page.url.pathname.startsWith('/settings');
      if (isOnSettings) {
        navigateBackFromSettings();
      } else {
        navigateToSettings();
      }
    } else if (id === 'new-workspace') {
      appStore.dispatch(closeAll(false));
      // Command-click (or Ctrl-click on non-Mac) opens in new window
      if (event?.metaKey || event?.ctrlKey) {
        invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route: '/workspace/new' }).catch(() => {
          // Fallback to navigation in current window if IPC fails
          goto('/workspace/new');
        });
        return;
      }
      appStore.dispatch(setShowCreateModal(true));
    } else {
      // Toggle the persistent sidebar panel
      appStore.dispatch(togglePanel(id));
    }
  }

  // Track icon button positions for hover card placement
  let iconRefs = $state<Record<string, HTMLButtonElement | null>>({});
</script>

{#if !$onboardingActive$}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<nav class="group/nav sidebar-nav flex flex-col items-center pt-2 pb-1 gap-1 h-full shrink-0 w-13" aria-label="Global navigation">
  <!-- Top nav items -->
  <div class="flex flex-col items-center gap-1 w-full px-1.5">
    {#each navItems.slice(0, 5) as item (item.id)}
      {@const active = isItemActive(item.id)}
      {@const isHovered = $activeCard$ === item.id}
      {@const badgeCount = item.badge?.() ?? 0}
      <button
        bind:this={iconRefs[item.id]}
        class="sidebar-nav-btn relative flex flex-col items-center gap-1 cursor-pointer transition-all duration-150
          {active || isHovered ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={(e) => handleClick(item.id, e)}
        onmouseenter={() => handleMouseEnter(item.id)}
        onmouseleave={handleMouseLeave}
        aria-label={item.label}
        data-nav-item={item.id}
      >
        <div
          class="relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-150
          {active ? 'bg-foreground/10' : isHovered ? 'bg-foreground/8' : 'hover:bg-foreground/5'}"
        >
          {#if item.id === 'chief'}
              <AuggieAvatar size={24} />
            {:else}
              <Fa icon={item.icon} size={16} />
            {/if}
          {#if badgeCount > 0}
            <span
              class="absolute -top-0.25 -right-0.25 min-w-3 h-3 flex items-center justify-center rounded-full bg-blue-500 text-app-background text-[0.55rem] font-black px-0.5"
            >
              {badgeCount}
            </span>
          {/if}
        </div>
      </button>
    {/each}
  </div>

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- Bottom nav items (settings) -->
  <div class="flex flex-col items-center gap-2 w-full px-1.5 pb-1">
    {#each navItems.slice(5) as item (item.id)}
      {@const active = isItemActive(item.id)}
      <button
        bind:this={iconRefs[item.id]}
        class="sidebar-nav-btn relative flex flex-col items-center gap-1 cursor-pointer transition-all duration-150
          {active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={(e) => handleClick(item.id, e)}
        onmouseenter={() => handleMouseEnter(item.id)}
        onmouseleave={handleMouseLeave}
        aria-label={item.label}
        data-nav-item={item.id}
      >
        <div
          class="relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-150
          {active ? 'bg-foreground/10' : 'hover:bg-foreground/5'}"
        >
          {#if item.id === 'chief'}
              <AuggieAvatar size={24} />
            {:else}
              <Fa icon={item.icon} size={16} />
            {/if}
        </div>
      </button>
    {/each}
  </div>
</nav>

<!-- Hover Card Portal -->
<SidebarNavHoverCard {iconRefs} />
{/if}
