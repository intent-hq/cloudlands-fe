<script lang="ts">
  /**
   * Panel - A single panel in the panel system
   *
   * Contains a tab bar and content area.
   * When focused, the tab bar shows group label and content actions.
   * Supports drag-and-drop for cross-panel tab movement.
   */

  import type { PanelState, PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { cn } from '$lib/utils';
  import PanelTabBar from './PanelTabBar.svelte';
  import PanelContentRenderer from './PanelContentRenderer.svelte';
  import PanelEmptyState from './PanelEmptyState.svelte';
  import PanelDropZones from './PanelDropZones.svelte';
  import { createPanelHeaderContext } from './panel-header-context.svelte';
  import { setPanelContext } from './panel-context';
  import {
    arePanelTabCachesEqual,
    getNextPanelTabCacheExpiryDelay,
    MAX_CACHED_INACTIVE_TABS,
    PANEL_TAB_CACHE_TTL_MS,
    updatePanelTabCache,
  } from './panel-tab-cache';
  import { selectIsDragging } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import {
    onMount,
    untrack,
    type Snippet,
  } from 'svelte';

  export type DropZone = 'top' | 'bottom' | 'left' | 'right' | 'center';

  interface Props {
    panel: PanelState;
    isFocused?: boolean;
    workspaceId: string;
    onFocus?: () => void;
    onTabClick?: (tabId: string) => void;
    onTabClose?: (tabId: string) => void;
    onCloseOtherTabs?: (tabId: string) => void;
    onTabReorder?: (fromIndex: number, toIndex: number) => void;
    onCloseTabsToRight?: (tabId: string) => void;
    onCloseAllTabs?: () => void;
    onCloseAllOthersEverywhere?: (tabId: string) => void;
    onClosePanel?: () => void;
    onZoomToggle?: () => void;
    /** Whether the panel is currently zoomed */
    isZoomed?: boolean;
    /** Handler for dropping a tab on this panel's drop zones */
    onTabDrop?: (tabId: string, fromPanelId: string, zone: DropZone) => void;
    /** Handler for moving a tab to this panel's tab bar */
    onTabMoveToPanel?: (tabId: string, fromPanelId: string, insertIndex?: number) => void;
    /** Handler for renaming a tab (note, agent, or file) */
    onTabRename?: (tab: PanelTab, newName: string) => void;
    /** Callbacks for creating new items */
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onCreateNote?: () => void;
    onCreateTerminal?: () => void;
    onOpenBrowser?: () => void;
    emptyState?: Snippet;
    /** Split panel horizontally (side by side) */
    onSplitHorizontal?: () => void;
    /** Split panel vertically (top and bottom) */
    onSplitVertical?: () => void;
  }

  let {
    panel,
    isFocused = false,
    workspaceId,
    onFocus,
    onTabClick,
    onTabClose,
    onTabReorder,
    onCloseOtherTabs,
    onCloseTabsToRight,
    onCloseAllTabs,
    onCloseAllOthersEverywhere,
    onClosePanel,
    onZoomToggle,
    isZoomed = false,
    onTabDrop,
    onTabMoveToPanel,
    onTabRename,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onCreateNote,
    onCreateTerminal,
    onOpenBrowser,
    emptyState,
    onSplitHorizontal,
    onSplitVertical,
  }: Props = $props();

  // Create header context for content components to register their actions
  const { actions: headerActions } = createPanelHeaderContext();

  // Set panel context so child components can access the panel ID
  // This is more reliable than DOM traversal for navigation events
  setPanelContext(panel.id);

  // Get the active tab - use optional chaining to handle workspace transitions
  let activeTab = $derived(panel?.tabs?.find((t) => t.id === panel.activeTabId) ?? null);

  // Keep recently-visited tabs mounted for faster switching
  // Tabs are kept for PANEL_TAB_CACHE_TTL_MS after switching away, then unmounted
  const tabCacheOptions = {
    ttlMs: PANEL_TAB_CACHE_TTL_MS,
    maxInactiveTabs: MAX_CACHED_INACTIVE_TABS,
  };

  // Track which tabs should remain mounted (active + recently visited)
  let cachedTabIds = $state<Map<string, number>>(new Map()); // tabId -> timestamp when last active

  function applyTabCacheUpdate(
    tabs = panel.tabs,
    activeTabId = panel.activeTabId,
    now = Date.now(),
  ) {
    const { currentCache, nextCache } = untrack(() => {
      const currentCache = cachedTabIds;
      return {
        currentCache,
        nextCache: updatePanelTabCache(currentCache, tabs, activeTabId, now, tabCacheOptions),
      };
    });

    if (!arePanelTabCachesEqual(currentCache, nextCache)) {
      cachedTabIds = nextCache;
    }
  }

  // Update cache when active tab or tab membership changes.
  $effect(() => {
    applyTabCacheUpdate(panel.tabs, panel.activeTabId);
  });

  // Enforce the TTL even when the active tab does not change again. Without
  // this timer, inactive browser/editor/diff tabs can stay mounted forever.
  $effect(() => {
    const delay = getNextPanelTabCacheExpiryDelay(
      cachedTabIds,
      panel.activeTabId,
      Date.now(),
      PANEL_TAB_CACHE_TTL_MS,
    );
    if (delay === null) return;

    const timeout = setTimeout(() => applyTabCacheUpdate(panel.tabs, panel.activeTabId), delay);
    return () => clearTimeout(timeout);
  });

  // Get tabs that should be rendered (exist in panel AND are in cache)
  let tabsToRender = $derived(panel.tabs.filter((tab) => cachedTabIds.has(tab.id)));

  // Detect fresh workspace creation for tab bar slide-down animation
  let animateTabBar = $state(false);
  onMount(() => {
    const pendingKey = Object.keys(sessionStorage).find((k) =>
      k.endsWith(':initial-agent-pending'),
    );
    if (pendingKey && sessionStorage.getItem(pendingKey)) {
      animateTabBar = true;
      // Clear after animation completes
      setTimeout(() => {
        animateTabBar = false;
      }, 700);
    }
  });

  // Custom MIME type for tab drag (must match PanelTabBar)
  const TAB_DRAG_MIME = 'application/x-panel-tab';

  // Drop zone state
  let isDragOver = $state(false);
  let activeDropZone = $state<DropZone | null>(null);
  let panelRef = $state.raw<HTMLDivElement | null>(null);

  // Tab bar height in pixels (h-9 = 2.25rem = 36px)
  const TAB_BAR_HEIGHT = 36;

  // Track global drag state to disable pointer events on content
  const isDragging = selectIsDragging();

  // Reset local drop zone state when global drag ends
  $effect(() => {
    if (!$isDragging) {
      isDragOver = false;
      activeDropZone = null;
    }
  });

  function handlePanelFocus() {
    onFocus?.();
  }

  // Determine which drop zone based on cursor position (relative to content area below tab bar)
  function getDropZone(e: DragEvent): DropZone | null {
    if (!panelRef) return 'center';

    const rect = panelRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // If cursor is over the tab bar area, no drop zone
    if (y < TAB_BAR_HEIGHT) return null;

    // Calculate position relative to content area (below tab bar)
    const contentY = y - TAB_BAR_HEIGHT;
    const contentHeight = rect.height - TAB_BAR_HEIGHT;
    const width = rect.width;

    // Edge zones are ~20-25% from each edge
    const edgeThreshold = 0.25;

    if (contentY < contentHeight * edgeThreshold) return 'top';
    if (contentY > contentHeight * (1 - edgeThreshold)) return 'bottom';
    if (x < width * 0.2) return 'left';
    if (x > width * 0.8) return 'right';
    return 'center';
  }

  function handleDragOver(e: DragEvent) {
    // Only accept our custom tab drag MIME type
    if (!e.dataTransfer?.types.includes(TAB_DRAG_MIME)) return;

    e.preventDefault();

    const zone = getDropZone(e);
    // Only show drop zones if cursor is in the content area (not tab bar)
    if (zone === null) {
      isDragOver = false;
      activeDropZone = null;
    } else {
      isDragOver = true;
      activeDropZone = zone;
    }
  }

  function handleDragLeave(e: DragEvent) {
    // Only reset if leaving the panel entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget && panelRef?.contains(relatedTarget)) return;

    isDragOver = false;
    activeDropZone = null;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation(); // Prevent drop from reaching content (like editors)
    isDragOver = false;

    try {
      const data = e.dataTransfer?.getData(TAB_DRAG_MIME);
      if (!data) return;

      const { tabId, panelId: fromPanelId } = JSON.parse(data);

      const zone = activeDropZone ?? 'center';
      activeDropZone = null;

      if (zone === 'center') {
        // Move tab to this panel's tab bar (only if from a different panel)
        if (fromPanelId !== panel.id) {
          onTabMoveToPanel?.(tabId, fromPanelId);
        }
      } else {
        // Split and move tab
        // If dropping on the same panel with only one tab, don't do anything
        // (can't split a panel with its only tab - it would just end up the same)
        if (fromPanelId === panel.id && panel.tabs.length === 1) {
          return;
        }
        onTabDrop?.(tabId, fromPanelId, zone);
      }
    } catch {
      activeDropZone = null;
    }
  }
</script>

{#if panel}
  <div
    bind:this={panelRef}
    class={cn(
      'panel group/panel relative flex flex-col h-full bg-background overflow-hidden',
      isFocused && 'focused',
    )}
    data-panel-id={panel.id}
    tabindex="-1"
    onfocusin={handlePanelFocus}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    role="region"
    aria-label="Panel"
  >
    <!-- Drop zones overlay (positioned below tab bar) -->
    <PanelDropZones activeZone={activeDropZone} isActive={isDragOver} />
    <!-- Tab Bar (shows group label and actions when focused) -->
    <div
      style={animateTabBar
        ? 'animation: slideDownTabBar 350ms cubic-bezier(0.33, 1, 0.68, 1) 300ms forwards; opacity: 0; transform: translateY(-100%);'
        : ''}
    >
    <PanelTabBar
      tabs={panel.tabs}
      activeTabId={panel.activeTabId}
      panelId={panel.id}
      {workspaceId}
      {isFocused}
      contentActions={headerActions.current}
      {onTabClick}
      {onTabClose}
      {onTabReorder}
      {onTabMoveToPanel}
      {onCloseOtherTabs}
      {onCloseTabsToRight}
      {onCloseAllTabs}
      {onCloseAllOthersEverywhere}
      {onClosePanel}
      {onZoomToggle}
      {isZoomed}
      {onTabRename}
      {onCreateAgent}
      {onCreateAgentWithSpecialist}
      {onCreateNote}
      {onCreateTerminal}
      {onOpenBrowser}
      {onSplitHorizontal}
      {onSplitVertical}
    />
    </div>

    <!-- Content Area -->
    <!--
    Tab content rendering strategy:
    - Render active tab + recently visited tabs (cached for 30s)
    - Inactive tabs are hidden with CSS but remain mounted
    - This provides instant tab switching for recently used tabs
    - After 30s of inactivity, tabs are unmounted to save memory

    During tab drag operations, pointer-events are disabled to prevent:
    - Editors from showing paste cursors
    - Content from interfering with drop zones
  -->
    <div
      class={cn('panel-content flex-1 overflow-hidden', $isDragging && 'pointer-events-none')}
    >
      {#if panel.tabs.length > 0 && activeTab}
        <!-- Render all cached tabs, showing only the active one -->
        {#each tabsToRender as tab (tab.id)}
          {@const isActive = tab.id === panel.activeTabId}
          <div
            class="tab-content-wrapper h-full w-full"
            class:hidden={!isActive}
            aria-hidden={!isActive}
            inert={!isActive}
          >
            <PanelContentRenderer
              {tab}
              {workspaceId}
              {isActive}
              isPanelFocused={isFocused && isActive}
              onFocus={() => onFocus?.()}
            />
          </div>
        {/each}
      {:else if emptyState}
        {@render emptyState()}
      {:else}
        <PanelEmptyState
          {workspaceId}
          {onCreateAgent}
          {onCreateAgentWithSpecialist}
          {onCreateNote}
          {onCreateTerminal}
          {onOpenBrowser}
        />
      {/if}
    </div>

    <!-- {#if !isFocused}
    <div
      class="absolute inset-0 bg-sidebar/50 mix-blend-darken dark:bg-[#1b1b1b] dark:mix-blend-difference pointer-events-none"
      transition:fade={{ duration: 60 }}
    ></div>
  {/if} -->
  </div>
{/if}

<style>
  .panel {
    position: relative;

    /* Container query setup for responsive panel headers */
    container-type: size;
    container-name: panel;
  }

  .panel.focused {
    /* border-color: hsl(var(--primary) / 0.9); */
  }

  /* Subtle focus indicator - left edge accent bar */
  /* .panel.focused::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: hsl(var(--primary) / 0.6);
    z-index: 10;
  } */

  .panel-content {
    position: relative;
  }

  /* Tab content wrapper - keeps content mounted but hidden to preserve scroll */
  .tab-content-wrapper {
    overflow: hidden;
  }

  .tab-content-wrapper.hidden {
    display: none;
  }
</style>
