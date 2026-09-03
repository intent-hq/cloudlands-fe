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
  import { m } from '$shared/paraglide/messages.js';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';

  import { invoke } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import { selectActiveTab } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';

  import { writable } from 'svelte/store';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { getLineStats, type LineStats } from '$features/file-tracking/file-tracking.client';
  import {
    selectZoomFactor,
    selectCounterScale,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { navigateBackFromSettings, navigateToSettings } from '$lib/utils/workspace-navigation';
  import IntentNavigationIcon from '$lib/icons/IntentNavigationIcon.svelte';
  import {
    TITLEBAR_NAVIGATION_CONTROL_CLASS,
    TITLEBAR_NAVIGATION_GLYPH_CLASS,
  } from './titlebar-navigation';
  import {
    getCounterScaledTitlebarHeight,
    getWorkspaceTabLeadingInsetPx,
    TITLEBAR_LEFT_DRAG_SURFACE_CLASS,
    WINDOW_TITLEBAR_HEIGHT_PX,
    WORKSPACE_TAB_MOTION_DURATION_MS,
    WORKSPACE_TAB_MOTION_EASING,
  } from './titlebar-geometry';
  import DaemonStatusIndicator from './DaemonStatusIndicator.svelte';
  import WorkspaceTabStrip from './WorkspaceTabStrip.svelte';
  import WorkspaceRepoLauncher from './WorkspaceRepoLauncher.svelte';
  import SidebarNav from './sidebar-nav/SidebarNav.svelte';
  import {
    selectOnboardingActive,
    selectPanelItem,
    selectPanelWidth,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';

  interface Props {
    workspaceId?: string;
  }

  let { workspaceId }: Props = $props();
  let activeTabBounds = $state<{ left: number; width: number } | null>(null);
  let activeTabTracking = $state(false);
  const routedWorkspaceId = $derived(
    page.url.pathname.startsWith('/workspace/') && page.params.id !== 'new'
      ? (page.params.id ?? null)
      : null,
  );
  const panelItem$ = selectPanelItem();
  const panelWidth$ = selectPanelWidth();
  const onboardingActive$ = selectOnboardingActive();

  // Where the workspace controls naturally start (left edge, titlebar coords).
  // Measured from the fixed controls (SidebarNav) so the margin below can align
  // the tabs with the sidebar panel's right edge rather than a fixed offset.
  const SIDEBAR_PANEL_LEFT_INSET = 8; // pl-2 on .workspace-frame-row
  const CONTROLS_GAP = 4; // gap-1 between titlebar control groups
  let fixedControlsEl = $state<HTMLDivElement | null>(null);
  let controlsBaseLeft = $state(0);
  let fixedControlsTrailingInset = $state(0);

  $effect(() => {
    const el = fixedControlsEl;
    if (!el) return;
    const measure = () => {
      controlsBaseLeft = el.offsetLeft + el.offsetWidth + CONTROLS_GAP;
      fixedControlsTrailingInset = Number.parseFloat(getComputedStyle(el).paddingRight) || 0;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });

  // Align the workspace controls (tabs) with the left panel's right edge
  // when a sidebar panel is open; tracks the panel width live.
  const sidebarPanelOpen = $derived(Boolean($panelItem$));
  const workspaceTabLeadingInsetPx = $derived(getWorkspaceTabLeadingInsetPx(sidebarPanelOpen));
  const panelOffset = $derived(
    sidebarPanelOpen
      ? Math.max(0, $panelWidth$ + SIDEBAR_PANEL_LEFT_INSET - controlsBaseLeft)
      : -fixedControlsTrailingInset,
  );

  function handleActiveTabBoundsChange(bounds: { left: number; width: number } | null) {
    activeTabBounds = bounds;
  }

  function handleActiveTabTrackingChange(tracking: boolean) {
    activeTabTracking = tracking;
  }

  // Zoom selectors
  const zoomFactor = selectZoomFactor();
  const counterScale = selectCounterScale();
  const workspaceItems = selectWorkspaceItems();

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

  // Get workspace data
  const workspace = $derived(
    $workspaceItems.find((candidate) => candidate.id === workspaceId) ?? null,
  );

  // Reactive writable store for workspaceId so Redux selectors re-evaluate
  // (initial value only; the $effect below keeps it in sync)
  // svelte-ignore state_referenced_locally
  const workspaceIdStore = writable(workspaceId ?? '');
  $effect(() => {
    workspaceIdStore.set(workspaceId ?? '');
  });

  // Reactive selector subscription for the active panel title.
  const focusedTab$ = selectActiveTab(workspaceIdStore);

  // Get focused tab info
  const focusedTab = $derived($focusedTab$ ?? null);

  // Get workspaces with activity (streaming or unread) - excluding current workspace
  const workspacesWithActivity = $derived.by(() => {
    // Touch reactive versions
    void activeStreamsVersion;

    const allWorkspaces = $workspaceItems.filter(
      (w) => w.status !== WorkspaceStatusEnum.Archived && w.id !== workspaceId,
    );

    return allWorkspaces
      .map((ws) => {
        const streamingAgentIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(ws.id);
        const streaming = streamingAgentIds.length > 0;
        // BE-owned attention flag; streaming takes precedence over unread.
        const hasUnread = !streaming && ws.attention === 'unread';

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

  // i18n-ignore (development instance identifier supplied by the launcher)
  const devTitleText = $derived(
    import.meta.env.DEV && import.meta.env.VITE_DEV_NAME
      ? `${displayText || 'Intent'} · [${import.meta.env.VITE_DEV_NAME}]`
      : '',
  );

  // Update the native window title when displayText changes
  $effect(() => {
    const title = displayText || 'Intent';
    // Update the native window title via IPC
    invoke(IPC_CHANNELS.WINDOW.SET_TITLE, { title }).catch(() => {
      // Silently ignore errors (e.g., if not in Electron context)
    });
  });

  async function handleSettings() {
    if (page.url.pathname.startsWith('/settings')) {
      await navigateBackFromSettings();
    } else {
      await navigateToSettings();
    }
  }
</script>

{#snippet titlebarUtilities(showDaemonStatus: boolean)}
  {#if showDaemonStatus}
    <DaemonStatusIndicator />
  {/if}
  <Tooltip content={m.layout_sidebarNav_settings_label()} side="bottom" delayDuration={300}>
    <Button
      variant="ghost"
      size="icon"
      iconOnly
      class={TITLEBAR_NAVIGATION_CONTROL_CLASS}
      onclick={() => void handleSettings()}
      aria-label={m.layout_sidebarNav_settings_label()}
      aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
      data-titlebar-settings
    >
      <span class={TITLEBAR_NAVIGATION_GLYPH_CLASS} data-titlebar-navigation-glyph>
        <IntentNavigationIcon name="settings" size={16} class="pointer-events-none size-4!" />
      </span>
    </Button>
  </Tooltip>
{/snippet}

<!-- Counter-scale wrapper to maintain fixed position relative to macOS traffic lights -->
<div
  class="window-title-bar-wrapper"
  style:height="{getCounterScaledTitlebarHeight($zoomFactor)}px"
  aria-label={m.layout_titleBar_ariaLabel()}
>
  <!-- app-drag-region scopes the layout rule in +layout.svelte that marks
       interactive descendants as no-drag so they stay clickable. -->
  <div
    class={cn(
      'window-title-bar app-drag-region',
      isMac ? 'window-title-bar-mac' : 'window-title-bar-windows',
    )}
    style:height="{WINDOW_TITLEBAR_HEIGHT_PX}px"
    style:transform="scale({$counterScale})"
    style:transform-origin="top left"
    style:width="{100 * $zoomFactor}%"
  >
    <!-- Left column -->
    <div class={TITLEBAR_LEFT_DRAG_SURFACE_CLASS} data-title-bar-navigation>
      <div
        class="titlebar-left-drag-handle shrink-0 self-stretch"
        data-titlebar-left-drag-handle
        aria-hidden="true"
      ></div>
      <div
        class="titlebar-fixed-controls flex min-w-0 items-center gap-1"
        bind:this={fixedControlsEl}
        data-titlebar-fixed-controls
      >
        <SidebarNav />
      </div>
      <div
        class="flex min-w-0 self-end items-center gap-1 transition-[margin-left] duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none"
        style:margin-left={`${panelOffset}px`}
        data-titlebar-workspace-controls
      >
        <WorkspaceTabStrip
          onActiveTabBoundsChange={handleActiveTabBoundsChange}
          onActiveTabTrackingChange={handleActiveTabTrackingChange}
          activeWorkspaceId={routedWorkspaceId}
          leadingInsetPx={workspaceTabLeadingInsetPx}
          horizontalPositionTrackingKey={panelOffset + workspaceTabLeadingInsetPx}
        />
        {#if !$onboardingActive$}
          <WorkspaceRepoLauncher />
        {/if}
      </div>
      <div
        class="titlebar-drag-handle min-w-12 flex-1 self-stretch"
        data-titlebar-drag-handle
      ></div>
    </div>

    <!-- Right column: global status and settings -->
    <div class="app-no-drag flex items-center justify-end pr-4 gap-1">
      {#if devTitleText}
        <span
          class="max-w-[min(45vw,40rem)] truncate px-2 text-xs text-muted-foreground"
          title={devTitleText}
          data-dev-instance-title
        >
          {devTitleText}
        </span>
      {/if}
      {@render titlebarUtilities(true)}
    </div>
    {#if activeTabBounds}
      <div
        class="pointer-events-none absolute -bottom-px z-[60] h-px bg-sidebar motion-reduce:transition-none"
        style:left={`${activeTabBounds.left}px`}
        style:width={`${activeTabBounds.width}px`}
        style:transition={activeTabTracking
          ? 'none'
          : `left ${WORKSPACE_TAB_MOTION_DURATION_MS}ms ${WORKSPACE_TAB_MOTION_EASING}, width ${WORKSPACE_TAB_MOTION_DURATION_MS}ms ${WORKSPACE_TAB_MOTION_EASING}`}
        data-active-tab-border-mask
        aria-hidden="true"
      ></div>
    {/if}
  </div>
</div>

<style>
  .window-title-bar-wrapper {
    position: relative;
    z-index: 50;
    overflow: visible;
    background: transparent;
    -webkit-app-region: drag;
  }

  .window-title-bar {
    background: transparent;
  }

  .window-title-bar {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    /* border-bottom: 1px solid hsl(var(--border) / 0.5); */
    position: relative;
    z-index: 50;
    padding-top: 2px;
    --titlebar-control-shift: 0px;
    -webkit-app-region: drag;
  }

  .window-title-bar:global(.window-title-bar-mac) {
    --titlebar-control-shift: 8px;
    padding-left: 80px; /* Native traffic-light clearance inside the counter-scaled titlebar */
  }

  .window-title-bar:global(.window-title-bar-windows) {
    padding-left: 8px; /* Minimal padding for Windows */
  }

  .titlebar-drag-handle {
    -webkit-app-region: drag;
  }

  .titlebar-left-drag-surface,
  .titlebar-left-drag-handle {
    -webkit-app-region: drag;
  }

  .titlebar-left-drag-handle {
    width: calc(16px - var(--titlebar-control-shift));
  }

  .titlebar-fixed-controls {
    padding-right: var(--titlebar-control-shift);
  }

  /* Track the panel width directly (no easing) while it is being resized */
  :global(body.panel-resizing) [data-titlebar-workspace-controls] {
    transition: none;
  }

  /* Current workspace tab - connects to sidebar below */
  .current-workspace-tab {
    background: hsl(var(--background));
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
