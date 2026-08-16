<script lang="ts">
  /**
   * Panel - A single panel in the panel system
   *
   * Contains a tab bar and content area.
   * When focused, the tab bar shows group label and content actions.
   * Supports drag-and-drop for cross-panel tab movement.
   */

  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type {
    PanelState,
    PanelTab,
  } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import PanelTabBar from './PanelTabBar.svelte';
  import PanelContentRenderer from './PanelContentRenderer.svelte';
  import PanelEmptyState from './PanelEmptyState.svelte';
  import PanelDropZones from './PanelDropZones.svelte';
  import { createPanelHeaderContext } from './panel-header-context.svelte';
  import { createPanelFileDropContext } from './panel-file-drop-context.svelte';
  import type { PanelFileDropHandler } from './panel-file-drop-context.svelte';
  import { setPanelContext } from './panel-context';
  import { createFileDropTarget } from '$lib/utils/file-drop';
  import {
    arePanelTabCachesEqual,
    getNextPanelTabCacheExpiryDelay,
    MAX_CACHED_INACTIVE_TABS,
    PANEL_TAB_CACHE_TTL_MS,
    updatePanelTabCache,
  } from './panel-tab-cache';
  import { selectIsDragging } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { untrack, type Snippet } from 'svelte';
  import {
    PANEL_DRAG_MIME,
    clearDraggedPanelState,
    getDraggedPanelId,
    getPanelDragPlacement,
    type PanelDragPlacement,
  } from './panel-drag';
  import { store as appStore } from '$store/renderer/store';
  import { endDrag } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { markPanelTouched } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  export type DropZone = 'top' | 'bottom' | 'left' | 'right' | 'center';

  interface Props {
    panel: PanelState;
    isFocused?: boolean;
    workspaceId: string;
    layoutId: string;
    contained?: boolean;
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
    /** Handler for dropping a whole panel onto this panel (reorder) */
    onPanelMove?: (draggedPanelId: string, position: PanelDragPlacement) => void;
    onPanelMovePreview?: (
      draggedPanelId: string,
      targetPanelId: string,
      position: PanelDragPlacement | null,
    ) => void;
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
    layoutId,
    contained = false,
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
    onPanelMove,
    onPanelMovePreview,
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

  // File-drop seam: chat content (ChatPanel) registers a handler while it is
  // the active tab, extending its OS-file drop target to the panel header.
  // Header handlers are gated on both the Files drag type (inside
  // createFileDropTarget) and a registered handler, so tab drags, panel-move
  // drags, and non-agent tabs are untouched.
  const { handler: fileDropHandler } = createPanelFileDropContext();
  const headerFileDrop = createFileDropTarget({
    onDragChange: (dragging) => fileDropHandler.current?.onDragChange(dragging),
    onDrop: (files) => fileDropHandler.current?.onDrop(files),
  });

  // Clear stale drag state on any handler identity change: unregister mid-drag
  // (tab switch/close) and direct A→B replacement (agent→agent tab switch where
  // the new tab registers before the old tab's cleanup runs), so a mid-drag
  // counter never leaks into the next handler's session.
  let lastRegisteredHandler: PanelFileDropHandler | null = null;
  $effect(() => {
    if (fileDropHandler.current !== lastRegisteredHandler) {
      lastRegisteredHandler = fileDropHandler.current;
      headerFileDrop.reset();
    }
  });

  function handleHeaderFileDragEnter(e: DragEvent) {
    if (!fileDropHandler.current) return;
    headerFileDrop.handleDragEnter(e);
  }

  function handleHeaderFileDragLeave(e: DragEvent) {
    if (!fileDropHandler.current) return;
    headerFileDrop.handleDragLeave(e);
  }

  function handleHeaderFileDragOver(e: DragEvent) {
    if (!fileDropHandler.current) return;
    headerFileDrop.handleDragOver(e);
  }

  function handleHeaderFileDrop(e: DragEvent) {
    if (!fileDropHandler.current) return;
    headerFileDrop.handleDrop(e);
  }

  // Set panel context so child components can access the panel ID
  // This is more reliable than DOM traversal for navigation events
  // (context must be set at init; a panel's ID is stable for its lifetime)
  // svelte-ignore state_referenced_locally
  setPanelContext(panel.id);

  // Get the active tab - use optional chaining to handle workspace transitions
  let activeTab = $derived(panel?.tabs?.find((t) => t.id === panel.activeTabId) ?? null);
  let panelRef = $state.raw<HTMLDivElement | null>(null);

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

  // Clear focus before a content-triggered tab switch hides its cached wrapper.
  // Header controls are outside these wrappers and keep their focus normally.
  $effect.pre(() => {
    const activeTabId = panel.activeTabId;
    if (typeof document === 'undefined' || !panelRef) return;
    const focusedElement = document.activeElement;
    if (!(focusedElement instanceof HTMLElement) || !panelRef.contains(focusedElement)) return;
    const focusedWrapper = focusedElement.closest<HTMLElement>('.tab-content-wrapper');
    if (focusedWrapper && focusedWrapper.dataset.tabId !== activeTabId) focusedElement.blur();
  });

  // Enforce the TTL even when the active tab does not change again. Without
  // this timer, inactive browser/editor/diff tabs can stay mounted forever.
  $effect(() => {
    const delay = getNextPanelTabCacheExpiryDelay(
      cachedTabIds,
      panel.activeTabId,
      Date.now(),
      PANEL_TAB_CACHE_TTL_MS,
      panel.tabs,
    );
    if (delay === null) return;

    const timeout = setTimeout(() => applyTabCacheUpdate(panel.tabs, panel.activeTabId), delay);
    return () => clearTimeout(timeout);
  });

  // Get tabs that should be rendered (exist in panel AND are in cache)
  let tabsToRender = $derived(panel.tabs.filter((tab) => cachedTabIds.has(tab.id)));

  // Fresh workspace creation used to trigger a tab-bar slide-down animation via
  // an `initial-agent-pending` sessionStorage marker. The daemon-owned create
  // flow doesn't stash that marker, so the animation is disabled here — the
  // remaining CSS wiring stays inert.
  let animateTabBar = $state(false);

  // Custom MIME type for tab drag (must match PanelTabBar)
  const TAB_DRAG_MIME = 'application/x-panel-tab';

  // Drop zone state
  let isDragOver = $state(false);
  let activeDropZone = $state<DropZone | null>(null);
  let panelDropPlacement = $state<PanelDragPlacement | null>(null);
  // Tab bar height in pixels (h-9 = 2.25rem = 36px)
  const TAB_BAR_HEIGHT = 36;

  // Track global drag state to disable pointer events on content
  const isDragging = selectIsDragging();

  // Reset local drop zone state when global drag ends
  $effect(() => {
    if (!$isDragging) {
      isDragOver = false;
      activeDropZone = null;
      panelDropPlacement = null;
    }
  });

  function handlePanelFocus() {
    onFocus?.();
  }

  function markUserTouch() {
    if (panel.pristine) appStore.dispatch(markPanelTouched(layoutId, panel.id));
  }

  // Focus the panel when the user clicks anywhere inside it. `onfocusin` only
  // fires when a focusable descendant receives focus; clicks on non-focusable
  // content (empty area, static text, non-interactive tab content) would
  // otherwise leave the panel unfocused. Uses `pointerdown` (capture) so the
  // panel focuses before nested interactive elements handle the event, and it
  // stays passive — no preventDefault / stopPropagation.
  function handlePanelPointerDown() {
    markUserTouch();
    if (isFocused) return;
    onFocus?.();
  }

  function handlePanelKeyDown() {
    markUserTouch();
  }

  // Determine which drop zone based on cursor position (relative to content area below tab bar)
  function getDropZone(e: DragEvent): DropZone | null {
    if (!panelRef) return 'center';

    const rect = panelRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // If cursor is over the tab bar area, no drop zone
    if (y < TAB_BAR_HEIGHT) return null;

    const width = rect.width;

    // Tabless panels only split along the horizontal stack.
    if (x < width * 0.2) return 'left';
    if (x > width * 0.8) return 'right';
    return 'center';
  }

  function getPanelPlacement(e: DragEvent): PanelDragPlacement {
    if (!panelRef) return 'after';
    return getPanelDragPlacement(
      e.clientX,
      e.clientY,
      panelRef.getBoundingClientRect(),
      panelDropPlacement,
    );
  }

  function handleDragOver(e: DragEvent) {
    // Whole-panel drag: preview only. The real layout changes once, on drop.
    if (e.dataTransfer?.types.includes(PANEL_DRAG_MIME)) {
      const draggedPanelId = getDraggedPanelId();
      if (!draggedPanelId) return;
      e.preventDefault();
      if (draggedPanelId === panel.id) {
        panelDropPlacement = getPanelPlacement(e);
        onPanelMovePreview?.(draggedPanelId, panel.id, panelDropPlacement);
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        return;
      }
      panelDropPlacement = getPanelPlacement(e);
      onPanelMovePreview?.(draggedPanelId, panel.id, panelDropPlacement);
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      return;
    }

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
    if (panelRef) {
      const rect = panelRef.getBoundingClientRect();
      const pointerStillInside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (pointerStillInside) return;
    }

    isDragOver = false;
    activeDropZone = null;
    panelDropPlacement = null;
    const draggedPanelId = getDraggedPanelId();
    if (draggedPanelId) onPanelMovePreview?.(draggedPanelId, panel.id, null);
  }

  function handleDrop(e: DragEvent) {
    markUserTouch();
    e.preventDefault();
    e.stopPropagation(); // Prevent drop from reaching content (like editors)
    isDragOver = false;

    // Whole-panel drop: reorder the stack
    const panelData = e.dataTransfer?.getData(PANEL_DRAG_MIME);
    const mirroredPanelId = getDraggedPanelId();
    if (panelData || mirroredPanelId) {
      const placement = panelDropPlacement ?? getPanelPlacement(e);
      panelDropPlacement = null;
      activeDropZone = null;
      let draggedId = mirroredPanelId;
      try {
        if (panelData) draggedId = JSON.parse(panelData).panelId ?? draggedId;
      } catch {
        // Fall back to the mirrored id used during dragover.
      }
      if (draggedId) {
        onPanelMovePreview?.(draggedId, panel.id, null);
        clearDraggedPanelState();
        appStore.dispatch(endDrag());
        if (draggedId !== panel.id) onPanelMove?.(draggedId, placement);
      }
      return;
    }
    panelDropPlacement = null;

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
      'panel group/panel relative flex flex-col h-full overflow-hidden rounded-lg border border-border',
      panel.pristine === true && panel.tabs.length === 0
        ? 'bg-transparent text-sidebar-foreground'
        : 'bg-card text-card-foreground',
    )}
    class:contained
    data-panel-id={panel.id}
    data-layout-id={layoutId}
    data-focused={isFocused}
    data-zoomed={isZoomed}
    data-pristine={panel.pristine === true}
    onfocusin={handlePanelFocus}
    onpointerdowncapture={handlePanelPointerDown}
    onkeydowncapture={handlePanelKeyDown}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    role="region"
    aria-label={m.layout_panel_ariaLabel()}
  >
    <!-- Drop zones overlay (positioned below tab bar) -->
    <PanelDropZones activeZone={activeDropZone} isActive={isDragOver} />
    {#if !activeTab && onClosePanel}
      <div class="absolute right-2 top-2 z-20" data-empty-panel-close>
        <Tooltip content={m.layout_panel_closePanel_ariaLabel()} side="bottom" delayDuration={300}>
          <Button
            variant="ghost-light"
            size="icon-xs"
            class="cursor-pointer opacity-50 hover:opacity-100 focus-visible:opacity-100"
            onclick={(event) => {
              event.stopPropagation();
              onClosePanel?.();
            }}
            aria-label={m.layout_panel_closePanel_ariaLabel()}
          >
            <Fa icon={faXmark} size="xs" />
          </Button>
        </Tooltip>
      </div>
    {/if}
    <!-- Tab Bar (shows group label and actions when focused) -->
    <div
      data-panel-header
      style={animateTabBar
        ? 'animation: slideDownTabBar 350ms cubic-bezier(0.33, 1, 0.68, 1) 300ms forwards; opacity: 0; transform: translateY(-100%);'
        : ''}
      ondragenter={handleHeaderFileDragEnter}
      ondragleave={handleHeaderFileDragLeave}
      ondragover={handleHeaderFileDragOver}
      ondrop={handleHeaderFileDrop}
    >
      <PanelTabBar
        tabs={panel.tabs}
        activeTabId={panel.activeTabId}
        panelId={panel.id}
        {workspaceId}
        {layoutId}
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
    <div class={cn('panel-content flex-1 overflow-hidden', $isDragging && 'pointer-events-none')}>
      {#if panel.tabs.length > 0 && activeTab}
        <!-- Render all cached tabs, showing only the active one -->
        {#each tabsToRender as tab (tab.id)}
          {@const isActive = tab.id === panel.activeTabId}
          <div
            class="tab-content-wrapper h-full w-full"
            class:hidden={!isActive}
            data-tab-id={tab.id}
            aria-hidden={!isActive}
            inert={!isActive}
          >
            <PanelContentRenderer
              {tab}
              {workspaceId}
              {layoutId}
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
    width: 100%;
    min-width: 0;
    box-shadow: var(--elevation-raised);

    /* Container query setup for responsive panel headers */
    container-type: size;
    container-name: panel;
  }

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
