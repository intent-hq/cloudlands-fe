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
  import { openPalette } from '$lib/store/slices/palette/palette-slice';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { applyContentPreset } from '$features/layout/preset-executor';
  import {
  selectPanelLayoutRoot,
  selectCanGoBack,
  selectCanGoForward,
  selectActiveTab,
} from '$lib/store/slices/panel-layout/panel-layout-selectors';
  import { PanelLayoutControls } from '$lib/components/layout/panel-system';
  import type { LayoutPresetId } from '$lib/components/layout/panel-system/types';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import PromotionalBanner from '$lib/components/PromotionalBanner.svelte';
  import { selectWorkspaceItems } from '$lib/store/slices/workspace/workspace-selectors';
  import {
  selectUnreadAgentIds,
  selectUnreadAgentIdsForWorkspace,
} from '$lib/store/slices/unread-tracking/unread-tracking-selectors';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { writable } from 'svelte/store';
  import { WorkspaceStatusEnum } from '$shared/types';
  import {
  getLineStats,
  type LineStats,
} from '$features/file-tracking/file-tracking.client';
  import {
  selectZoomFactor,
  selectCounterScale,
} from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import { toggleSidebar } from '$lib/store/slices/ui-layout/ui-layout-slice';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { selectOnboardingActive } from '$lib/store/slices/sidebar-nav/sidebar-nav-selectors';
  import { selectSidebarSide } from '$lib/store/slices/ui-layout/ui-layout-selectors';

  interface Props {
    workspaceId?: string;
  }

  let { workspaceId }: Props = $props();

  const dispatch = getDispatch();
  const sidebarSide$ = selectSidebarSide();

  // Zoom selectors
  const zoomFactor = selectZoomFactor();
  const counterScale = selectCounterScale();
  const workspaceItems = selectWorkspaceItems();
  const unreadAgentIds$ = selectUnreadAgentIds();

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
  }

  // Check if we're on a workspace page
  const isWorkspacePage = $derived(page.url.pathname.startsWith('/workspace/'));
  const onboardingActive$ = selectOnboardingActive();
  const isWorkspaceVisible = $derived(isWorkspacePage && workspaceId && !$onboardingActive$);

  // Get workspace data
  const workspace = $derived(
    $workspaceItems.find((candidate) => candidate.id === workspaceId) ?? null,
  );

  // Reactive writable store for workspaceId so Redux selectors re-evaluate
  const workspaceIdStore = writable(workspaceId ?? '');
  $effect(() => {
    workspaceIdStore.set(workspaceId ?? '');
  });

  // Get panel layout manager for this workspace (action methods only)
  const layoutManager = $derived(workspaceId ? getPanelLayoutManager(workspaceId) : null);

  // Reactive selector subscriptions for panel layout state
  const layoutRoot$ = selectPanelLayoutRoot(workspaceIdStore);
  const canGoBack$ = selectCanGoBack(workspaceIdStore);
  const canGoForward$ = selectCanGoForward(workspaceIdStore);
  const focusedTab$ = selectActiveTab(workspaceIdStore);

  // Get focused tab info
  const focusedTab = $derived($focusedTab$ ?? null);

  // Get workspaces with activity (streaming or unread) - excluding current workspace
  const workspacesWithActivity = $derived.by(() => {
    // Touch reactive versions
    void activeStreamsVersion;
    // Reading unreadAgentIds$ triggers re-evaluation when unread state changes
    void $unreadAgentIds$;

    const allWorkspaces = $workspaceItems.filter(
      (w) => w.status !== WorkspaceStatusEnum.Archived && w.id !== workspaceId,
    );

    const state = getReduxStore().getState();
    return allWorkspaces
      .map((ws) => {
        const streamingAgentIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
        const streaming = streamingAgentIds.length > 0;
        const hasUnread =
          selectUnreadAgentIdsForWorkspace
            .select(state, ws.id)
            .filter((id) => !streamingAgentIds.includes(id)).length > 0;

        return { workspace: ws, streaming, hasUnread };
      })
      .filter(({ streaming, hasUnread }) => streaming || hasUnread)
      .slice(0, 5); // Limit to 5 items to not crowd the title bar
  });

  let hasMounted = false;

  onMount(() => {
    activeStreamsTracker.startPolling();
    const unsubscribeStreams = activeStreamsTracker.subscribe(() => {
      activeStreamsVersion++;
      refreshLineStats(); // Refresh line stats when activity changes
    });

    // Initial fetch
    refreshLineStats();
    hasMounted = true;

    return () => {
      unsubscribeStreams();
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
    dispatch(openPalette());
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
<div
  class="window-title-bar-wrapper"
  style:height="{35 / $zoomFactor}px"
  aria-label="Window title bar"
>
  <div
    class={cn(
      'window-title-bar app-drag-region',
      isMac ? 'window-title-bar-mac' : 'window-title-bar-windows',
    )}
    style:transform="scale({$counterScale})"
    style:transform-origin="top left"
    style:width="{100 * $zoomFactor}%"
  >
    <!-- Left column -->
    <div class="flex items-center min-w-0">
      {#if isWorkspaceVisible && $sidebarSide$ === 'left'}
        <Tooltip side="bottom" delayDuration={300}>
          {#snippet content()}
            <span>Sidebar</span>
            <span class="text-subtle ml-1.5">⌘B</span>
          {/snippet}
          <button
            class="p-2 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
            onclick={() => dispatch(toggleSidebar())}
            aria-label="Toggle sidebar"
          >
            <SidebarIcon size={16} side="left" />
          </button>
        </Tooltip>
      {/if}
      <PromotionalBanner />
    </div>

    <!-- Center: Search bar (workspace pages only, hidden during onboarding) -->
    {#if isWorkspaceVisible}
      <div class="flex items-center justify-center px-4 gap-1" style="-webkit-app-region: no-drag">
        <!-- Search bar -->
        <button class="search-bar" onclick={handleSearchClick} type="button">
          <!-- Search icon -->
          <Fa icon={faSearch} size="sm" class="text-ghost shrink-0" />

          <!-- Display text -->
          <span class="text-sm text-subtle truncate flex-1 px-2">
            {displayText || 'Search...'}
          </span>

          <!-- Shortcut hint -->
          <span class="text-ui text-subtle font-medium shrink-0">{isMac ? '⌘' : 'Ctrl+'}K</span>
        </button>
      </div>
    {:else}
      <div></div>
    {/if}

    <!-- Right column: Layout controls + sidebar toggle (when sidebar is on right) -->
    <div class="flex items-center justify-end pr-4 gap-1">
      {#if isWorkspaceVisible && layoutManager}
        <PanelLayoutControls
          layoutRoot={$layoutRoot$}
          canGoBack={$canGoBack$}
          canGoForward={$canGoForward$}
          workspaceId={workspaceId!}
          onGoBack={() => layoutManager.goBack()}
          onGoForward={() => layoutManager.goForward()}
          onApplyPreset={handleApplyPreset}
        />
      {/if}
      {#if isWorkspaceVisible && $sidebarSide$ === 'right'}
        <Tooltip side="bottom" delayDuration={300}>
          {#snippet content()}
            <span>Sidebar</span>
            <span class="text-subtle ml-1.5">⌘B</span>
          {/snippet}
          <button
            class="p-2 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
            onclick={() => dispatch(toggleSidebar())}
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
