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
  import { navigateToSettings, navigateBackFromSettings } from '$lib/utils/workspace-navigation';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { faHome, faPlus, faLayerGroup, faCog, faBell } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { sidebarNavStore, type SidebarNavItem } from './sidebar-nav.store.svelte';
  import SidebarNavHoverCard from './SidebarNavHoverCard.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { onMount } from 'svelte';

  // Reactivity versions
  let activeStreamsVersion = $state(0);
  let unreadVersion = $state(0);

  onMount(() => {
    activeStreamsTracker.startPolling(2000);
    const unsubStreams = activeStreamsTracker.subscribe(() => activeStreamsVersion++);
    const unsubUnread = unreadTrackingService.subscribe(() => unreadVersion++);
    return () => {
      unsubStreams();
      unsubUnread();
    };
  });

  // Count unread workspaces only (within 24h)
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  const unreadCount = $derived.by(() => {
    void activeStreamsVersion;
    void unreadVersion;
    const now = Date.now();
    let count = 0;
    for (const ws of workspaceStore.items) {
      if (ws.status === WorkspaceStatusEnum.Archived || ws.status === WorkspaceStatusEnum.Deleted)
        continue;
      // Skip if currently streaming (not "unread")
      if (activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id).length > 0) continue;
      const unreadIds = unreadTrackingService.getUnreadAgentIdsForWorkspace(ws.id);
      const updatedAt = new Date(ws.updatedAt).getTime();
      if (unreadIds.length > 0 && now - updatedAt < ONE_DAY_MS) count++;
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
    { id: 'settings', icon: faCog, label: 'Settings' },
  ];

  function isItemActive(id: SidebarNavItem): boolean {
    if (id === 'home' && isHomePage) return true;
    if (id === 'settings' && isSettingsPage) return true;
    // Highlight when panel is open for this item
    if (sidebarNavStore.panelItem === id) return true;
    return false;
  }

  function handleClick(id: SidebarNavItem, event?: MouseEvent) {
    if (id === 'home') {
      sidebarNavStore.closeAll();
      goto('/');
    } else if (id === 'settings') {
      sidebarNavStore.closeAll();
      const isOnSettings = page.url.pathname.startsWith('/settings');
      if (isOnSettings) {
        navigateBackFromSettings();
      } else {
        navigateToSettings();
      }
    } else if (id === 'new-workspace') {
      sidebarNavStore.closeAll();
      // Command-click (or Ctrl-click on non-Mac) opens new window on home
      if (event?.metaKey || event?.ctrlKey) {
        invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route: '/' }).catch(() => {
          // Fallback to modal in current window if IPC fails
          window.dispatchEvent(new CustomEvent('app:open-new-space-modal', { detail: {} }));
        });
        return;
      }
      // Normal click opens create modal
      window.dispatchEvent(new CustomEvent('app:open-new-space-modal', { detail: {} }));
    } else {
      // Toggle the persistent sidebar panel
      sidebarNavStore.togglePanel(id);
    }
  }

  // Track icon button positions for hover card placement
  let iconRefs = $state<Record<string, HTMLButtonElement | null>>({});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<nav class="group/nav sidebar-nav flex flex-col items-center pt-2 pb-1 gap-1 h-full shrink-0 w-13">
  <!-- Top nav items -->
  <div class="flex flex-col items-center gap-1 w-full px-1.5">
    {#each navItems.slice(0, 4) as item (item.id)}
      {@const active = isItemActive(item.id)}
      {@const isHovered = sidebarNavStore.activeCard === item.id}
      {@const badgeCount = item.badge?.() ?? 0}
      <button
        bind:this={iconRefs[item.id]}
        class="sidebar-nav-btn relative flex flex-col items-center gap-1 cursor-pointer transition-all duration-150
          {active || isHovered
          ? 'text-foreground'
          : 'text-muted-foreground/60 hover:text-foreground'}"
        onclick={(e) => handleClick(item.id, e)}
        onmouseenter={() => sidebarNavStore.handleMouseEnter(item.id)}
        onmouseleave={() => sidebarNavStore.handleMouseLeave()}
        aria-label={item.label}
        data-nav-item={item.id}
      >
        <div
          class="relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-150
          {active ? 'bg-foreground/10' : isHovered ? 'bg-foreground/8' : 'hover:bg-foreground/5'}"
        >
          <Fa icon={item.icon} size={16} />
          {#if badgeCount > 0}
            <span
              class="absolute -top-0.25 -right-0.25 min-w-3 h-3 flex items-center justify-center rounded-full bg-blue-500 text-app-background text-[8px] font-bold px-0.5"
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
    {#each navItems.slice(4) as item (item.id)}
      {@const active = isItemActive(item.id)}
      <button
        bind:this={iconRefs[item.id]}
        class="sidebar-nav-btn relative flex flex-col items-center gap-1 cursor-pointer transition-all duration-150
          {active ? 'text-foreground' : 'text-muted-foreground/60 hover:text-foreground'}"
        onclick={(e) => handleClick(item.id, e)}
        onmouseenter={() => sidebarNavStore.handleMouseEnter(item.id)}
        onmouseleave={() => sidebarNavStore.handleMouseLeave()}
        aria-label={item.label}
        data-nav-item={item.id}
      >
        <div
          class="relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-150
          {active ? 'bg-foreground/10' : 'hover:bg-foreground/5'}"
        >
          <Fa icon={item.icon} size={16} />
        </div>
      </button>
    {/each}
  </div>
</nav>

<!-- Hover Card Portal -->
<SidebarNavHoverCard {iconRefs} />
