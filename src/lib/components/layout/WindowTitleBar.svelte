<script lang="ts">
  /**
   * WindowTitleBar - VS Code/Spotlight-style title bar with search bar and layout controls
   *
   * Features:
   * - Back/forward navigation for focus history (navigates between previously focused tabs)
   * - Centered search bar with workspace name + active tab info (opens command palette on click)
   * - Layout controls on the right (always expanded - minimap, preset dropdown, AI prompt)
   * - Counter-scaling to maintain fixed position relative to macOS traffic lights when zoomed
   */

  import { page } from '$app/state';
  import { faSearch } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import SidebarIcon from '$lib/components/icons/SidebarIcon.svelte';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';

  import { invoke } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
  import { paletteStore } from '$features/palette/palette.store.svelte';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
  import { applyContentPreset } from '$features/layout/preset-executor';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { PanelLayoutControls } from '$lib/components/layout/panel-system';
  import type { LayoutPresetId } from '$lib/components/layout/panel-system/types';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { getLineStats, type LineStats } from '$features/file-tracking/file-tracking.client';
  import { zoomStore } from '$lib/stores/zoom.store.svelte';
  import { sidebarWidthStore } from '$lib/stores/sidebar-width.store.svelte';
  import { layoutSettings } from '$features/layout/layout-settings.svelte';

  interface Props {
    workspaceId?: string;
  }

  let { workspaceId }: Props = $props();

  // Detect platform for conditional styling and shortcuts
  const isMac = $derived.by(() => {
    if (typeof navigator === 'undefined') return false;
    return (
      // @ts-expect-error - userAgentData is not in all browsers
      navigator.userAgentData?.platform === 'macOS' ||
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
    );
  });

  // Reactivity versions for subscriptions
  let activeStreamsVersion = $state(0);
  let unreadVersion = $state(0);
  let lineStatsVersion = $state(0);

  // Cache for line stats
  let lineStatsCache = new SvelteMap<string, LineStats>();

  // Fetch line stats for workspaces with activity and current workspace
  async function refreshLineStats() {
    // Capture workspaceId at start to guard against async race
    const capturedWorkspaceId = workspaceId;

    // Fetch for current workspace
    if (capturedWorkspaceId) {
      try {
        const stats = await getLineStats(capturedWorkspaceId);
        // Guard: only update cache if workspaceId hasn't changed
        if (workspaceId === capturedWorkspaceId) {
          lineStatsCache.set(capturedWorkspaceId, stats);
        }
      } catch {
        if (workspaceId === capturedWorkspaceId && !lineStatsCache.has(capturedWorkspaceId)) {
          lineStatsCache.set(capturedWorkspaceId, { additions: 0, deletions: 0 });
        }
      }
    }
    // Fetch for activity workspaces
    for (const { workspace: ws } of workspacesWithActivity) {
      // Capture workspaceId before each await to guard against async race
      const wsIdBeforeFetch = workspaceId;
      try {
        const stats = await getLineStats(ws.id);
        // Guard: only update cache if workspaceId hasn't changed
        if (workspaceId === wsIdBeforeFetch) {
          lineStatsCache.set(ws.id, stats);
        }
      } catch {
        if (workspaceId === wsIdBeforeFetch && !lineStatsCache.has(ws.id)) {
          lineStatsCache.set(ws.id, { additions: 0, deletions: 0 });
        }
      }
    }
    lineStatsVersion++;
  }

  // Check if we're on a workspace page
  const isWorkspacePage = $derived(page.url.pathname.startsWith('/workspace/'));
  const isHomePage = $derived(page.url.pathname === '/');

  // Get workspace data
  const workspace = $derived(
    workspaceId ? workspaceStore.findById(WorkspaceId(workspaceId)) : null,
  );

  // Get panel layout manager for this workspace
  const layoutManager = $derived(workspaceId ? getPanelLayoutManager(workspaceId) : null);

  // Get focused tab info
  const focusedTab = $derived(layoutManager?.focusedTab ?? null);

  // Get workspaces with activity (streaming or unread) - excluding current workspace
  const workspacesWithActivity = $derived.by(() => {
    // Touch reactive versions
    void activeStreamsVersion;
    void unreadVersion;

    const allWorkspaces = workspaceStore.items.filter(
      (w) => w.status !== WorkspaceStatusEnum.Archived && w.id !== workspaceId,
    );

    return allWorkspaces
      .map((ws) => {
        const streamingAgentIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
        const streaming = streamingAgentIds.length > 0;
        const hasUnread =
          unreadTrackingService
            .getUnreadAgentIdsForWorkspace(ws.id)
            .filter((id) => !streamingAgentIds.includes(id)).length > 0;

        return { workspace: ws, streaming, hasUnread };
      })
      .filter(({ streaming, hasUnread }) => streaming || hasUnread)
      .slice(0, 5); // Limit to 5 items to not crowd the title bar
  });

  let hasMounted = false;

  onMount(() => {
    activeStreamsTracker.startPolling(2000);
    const unsubscribeStreams = activeStreamsTracker.subscribe(() => {
      activeStreamsVersion++;
      refreshLineStats(); // Refresh line stats when activity changes
    });
    const unsubscribeUnread = unreadTrackingService.subscribe(() => {
      unreadVersion++;
      refreshLineStats(); // Refresh line stats when activity changes
    });

    // Initial fetch
    refreshLineStats();
    hasMounted = true;

    return () => {
      unsubscribeStreams();
      unsubscribeUnread();
    };
  });

  // Refresh line stats when workspaceId changes (but not on initial mount, which is handled by onMount)
  $effect(() => {
    if (workspaceId && hasMounted) {
      refreshLineStats();
    }
  });

  // Build display text for the search bar - show focused tab title and workspace
  const displayText = $derived.by(() => {
    if (focusedTab?.title && workspace?.title) {
      return `${focusedTab.title} — ${workspace.title}`;
    }
    if (focusedTab?.title) {
      return focusedTab.title;
    }
    if (workspace?.title) {
      return workspace.title;
    }
    return '';
  });

  // Update the native window title when displayText changes
  $effect(() => {
    const title = displayText || 'Intent';
    // Update the native window title via IPC
    invoke(IPC_CHANNELS.WINDOW.SET_TITLE, { title }).catch(() => {
      // Silently ignore errors (e.g., if not in Electron context)
    });
  });

  function handleSearchClick() {
    paletteStore.open();
  }

  async function handleApplyPreset(presetId: LayoutPresetId) {
    if (!layoutManager || !workspaceId) return;
    await applyContentPreset(presetId, layoutManager, {
      workspaceId,
      containerWidth: window.innerWidth,
      containerHeight: window.innerHeight,
    });
  }
</script>

<!-- Counter-scale wrapper to maintain fixed position relative to macOS traffic lights -->
<div class="window-title-bar-wrapper" style:height="{35 / zoomStore.zoomFactor}px">
  <div
    class={cn(
      'window-title-bar app-drag-region',
      isMac ? 'window-title-bar-mac' : 'window-title-bar-windows',
    )}
    style:transform="scale({zoomStore.counterScale})"
    style:transform-origin="top left"
    style:width="{100 * zoomStore.zoomFactor}%"
  >
    <!-- Left column -->
    <div class="flex items-center app-no-drag min-w-0">
      {#if !isHomePage && layoutSettings.sidebarSide === 'left'}
        <Tooltip side="bottom" delayDuration={300}>
          {#snippet content()}
            <span>Sidebar</span>
            <span class="text-muted-foreground ml-1.5">⌘B</span>
          {/snippet}
          <button
            class="p-2 rounded hover:bg-muted/50 transition-colors text-muted-foreground/50 hover:text-foreground cursor-pointer"
            onclick={() => sidebarWidthStore.toggle()}
            aria-label="Toggle sidebar"
          >
            <SidebarIcon size={16} side="left" />
          </button>
        </Tooltip>
      {/if}

    </div>

    <!-- Center: Search bar (workspace pages only) -->
    {#if isWorkspacePage && workspaceId}
      <div class="flex items-center justify-center px-4 gap-1 app-no-drag">
        <!-- Search bar -->
        <button class="search-bar" onclick={handleSearchClick} type="button">
          <!-- Search icon -->
          <Fa icon={faSearch} size="sm" class="text-muted-foreground/50 shrink-0" />

          <!-- Display text -->
          <span class="text-sm text-muted-foreground truncate flex-1 px-2">
            {displayText || 'Search...'}
          </span>

          <!-- Shortcut hint -->
          <span class="text-[11px] text-muted-foreground/50 font-medium shrink-0"
            >{isMac ? '⌘' : 'Ctrl+'}K</span
          >
        </button>
      </div>
    {:else}
      <div></div>
    {/if}

    <!-- Right column: Layout controls + sidebar toggle (when sidebar is on right) -->
    <div class="flex items-center justify-end pr-4 app-no-drag gap-1">
      {#if isWorkspacePage && workspaceId && layoutManager}
        <PanelLayoutControls
          layoutRoot={layoutManager.layout.root}
          canGoBack={layoutManager.canGoBack}
          canGoForward={layoutManager.canGoForward}
          {workspaceId}
          onGoBack={() => layoutManager.goBack()}
          onGoForward={() => layoutManager.goForward()}
          onApplyPreset={handleApplyPreset}
        />
      {/if}
      {#if !isHomePage && layoutSettings.sidebarSide === 'right'}
        <Tooltip side="bottom" delayDuration={300}>
          {#snippet content()}
            <span>Sidebar</span>
            <span class="text-muted-foreground ml-1.5">⌘B</span>
          {/snippet}
          <button
            class="p-2 rounded hover:bg-muted/50 transition-colors text-muted-foreground/50 hover:text-foreground cursor-pointer"
            onclick={() => sidebarWidthStore.toggle()}
            aria-label="Toggle sidebar"
          >
            <SidebarIcon size={16} side="right" />
          </button>
        </Tooltip>
      {/if}
    </div>
  </div>
</div>

<style>
  .window-title-bar-wrapper {
    position: relative;
    z-index: 50;
    overflow: hidden;
  }

  .window-title-bar {
    height: 35px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    background: hsl(var(--app-background) / 0.8);
    /* border-bottom: 1px solid hsl(var(--border) / 0.5); */
    position: relative;
    z-index: 50;
    padding-top: 2px;
    -webkit-app-region: drag;
  }

  .window-title-bar:global(.window-title-bar-mac) {
    padding-left: 70px; /* Space for macOS traffic lights */
  }

  .window-title-bar:global(.window-title-bar-windows) {
    padding-left: 8px; /* Minimal padding for Windows */
  }

  .search-bar {
    display: flex;
    align-items: center;
    max-width: 400px;
    width: 100%;
    height: 26px;
    padding: 0 8px;
    background: hsl(var(--background) / 0.5);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .search-bar:hover {
    background: hsl(var(--background) / 1);
  }

  /* Current workspace tab - connects to sidebar below */
  .current-workspace-tab {
    background: hsl(var(--sidebar));
    border-top-left-radius: 0.375rem;
    border-top-right-radius: 0.375rem;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    padding: 0.375rem 0.5rem;
    /* Extend to the bottom of the title bar - use negative margin to compensate for title bar padding */
    align-self: stretch;
    margin-bottom: -2px;
    padding-bottom: calc(0.375rem + 2px);
  }
</style>
