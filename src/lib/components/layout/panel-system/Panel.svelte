<script lang="ts">
  /**
   * Panel - A single panel in the panel system
   *
   * Contains a tab bar and content area.
   * When focused, the tab bar shows group label and content actions.
   * Supports drag-and-drop for cross-panel tab movement.
   */

  import { m } from '$shared/paraglide/messages.js';
  import type {
    PanelState,
    PanelTab,
  } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { cn } from '$lib/utils';
  import PanelTabBar from './PanelTabBar.svelte';
  import PanelContentRenderer from './PanelContentRenderer.svelte';
  import PanelEmptyState from './PanelEmptyState.svelte';
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
    PANE_DRAG_MIME,
    clearDraggedPaneState,
    getDraggedPane,
    getPaneColumnDropZone,
    type PaneDropPlacement,
  } from './panel-drag';
  import { store as appStore } from '$store/renderer/store';
  import { markPanelTouched } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { endDrag } from '$store/renderer/slices/tab-state/tab-state-slice';

  export type DropZone = 'left' | 'right' | 'center';

  interface Props {
    panel: PanelState;
    isFocused?: boolean;
    showFocusBorder?: boolean;
    workspaceId: string;
    layoutId: string;
    active?: boolean;
    availableCanvasWidth?: number;
    isRightmostPanel?: boolean;
    canCreateColumn?: boolean;
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
    /** Reports the one valid destination for the active-pane drag. */
    onPaneDropPreview?: (placement: PaneDropPlacement | null) => void;
    /** Idempotently finishes the active-pane drag before layout mutation. */
    onPaneDragFinish?: () => void;
    onMovePaneLeft?: () => void;
    onMovePaneRight?: () => void;
    onMoveLeft?: () => void;
    onMoveRight?: () => void;
    /** Handler for renaming a tab (note, agent, or file) */
    onTabRename?: (tab: PanelTab, newName: string) => void;
    /** Callbacks for creating new items */
    onCreateAgent?: (panelId?: string) => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null, panelId?: string) => void;
    onCreateNote?: (panelId?: string) => void;
    onCreateTerminal?: (panelId?: string) => void;
    onOpenBrowser?: (panelId?: string) => void;
    emptyState?: Snippet;
    /** Split panel horizontally (side by side) */
    onSplitHorizontal?: () => void;
  }

  let {
    panel,
    isFocused = false,
    showFocusBorder = false,
    workspaceId,
    layoutId,
    active = true,
    availableCanvasWidth,
    isRightmostPanel = false,
    canCreateColumn = true,
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
    onPaneDropPreview,
    onPaneDragFinish,
    onMovePaneLeft,
    onMovePaneRight,
    onMoveLeft,
    onMoveRight,
    onTabRename,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onCreateNote,
    onCreateTerminal,
    onOpenBrowser,
    emptyState,
    onSplitHorizontal,
  }: Props = $props();

  // A panel component never changes identity. Keep teardown independent from
  // the reactive layout entry, which can disappear before child cleanup runs.
  // svelte-ignore state_referenced_locally
  const panelId = panel.id;

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
    onDrop: (drop) => fileDropHandler.current?.onDrop(drop),
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
  setPanelContext(panelId);

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
    if (active) applyTabCacheUpdate(panel.tabs, panel.activeTabId);
  });

  // Clear focus before a tab switch or panel deactivation flips `inert` on a
  // cached wrapper. Flipping `inert` while a descendant holds focus makes the
  // browser blur it synchronously inside the template effect, where widgets
  // that write $state on blur (e.g. TipTap) throw state_unsafe_mutation.
  // Header controls are outside these wrappers and keep their focus normally.
  $effect.pre(() => {
    const activeTabId = panel.activeTabId;
    const panelActive = active;
    if (typeof document === 'undefined' || !panelRef) return;
    const focusedElement = document.activeElement;
    if (!(focusedElement instanceof HTMLElement) || !panelRef.contains(focusedElement)) return;
    const focusedWrapper = focusedElement.closest<HTMLElement>('.tab-content-wrapper');
    if (focusedWrapper && (!panelActive || focusedWrapper.dataset.tabId !== activeTabId)) {
      focusedElement.blur();
    }
  });

  // Enforce the TTL even when the active tab does not change again. Without
  // this timer, inactive browser/editor/diff tabs can stay mounted forever.
  $effect(() => {
    if (!active) return;
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
  const TAB_DRAG_MIME = PANE_DRAG_MIME;

  // Drop zone state
  let isPaneDragOver = $state(false);
  let isLegacyTabDragOver = $state(false);
  let activeDropZone = $state<DropZone | null>(null);

  // Track global drag state to disable pointer events on content
  const isDragging = selectIsDragging();

  // Reset local drop zone state when global drag ends
  $effect(() => {
    if (!$isDragging) {
      isPaneDragOver = false;
      isLegacyTabDragOver = false;
      activeDropZone = null;
    }
  });

  let pointerFocusHandled = false;

  function handlePanelFocus() {
    if (pointerFocusHandled || isFocused) return;
    onFocus?.();
  }

  function markUserTouch() {
    if (panel.pristine) appStore.dispatch(markPanelTouched(layoutId, panelId));
  }

  // Focus the panel when the user clicks anywhere inside it. `onfocusin` only
  // fires when a focusable descendant receives focus; clicks on non-focusable
  // content (empty area, static text, non-interactive tab content) would
  // otherwise leave the panel unfocused. Uses `pointerdown` (capture) so the
  // panel focuses before nested interactive elements handle the event, and it
  // stays passive — no preventDefault / stopPropagation.
  function isEmptyStateInteraction(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('[data-panel-empty-state]') !== null;
  }

  function handlePanelPointerDown(event: PointerEvent) {
    if (!isEmptyStateInteraction(event.target)) markUserTouch();
    // A focusable pointer target emits `focusin` after this capture handler.
    // Treat both events as one column activation without cancelling either,
    // so the target keeps its native DOM focus.
    pointerFocusHandled = true;
    queueMicrotask(() => (pointerFocusHandled = false));
    if (isFocused) return;
    onFocus?.();
  }

  function handlePanelKeyDown(event: KeyboardEvent) {
    if (!isEmptyStateInteraction(event.target)) markUserTouch();
  }

  function getDropZone(e: DragEvent): DropZone {
    if (!panelRef) return 'center';
    // Tabless panels only split along the horizontal stack.
    return getPaneColumnDropZone(
      e.clientX,
      panelRef.getBoundingClientRect(),
      canCreateColumn,
      activeDropZone,
    );
  }

  function getPaneDropPlacement(
    zone: DropZone,
  ): Extract<PaneDropPlacement, { kind: 'panel' }> | null {
    const draggedPane = getDraggedPane();
    if (!draggedPane) return null;
    if (zone === 'center' && draggedPane.panelId === panelId) return null;
    if (zone !== 'center' && draggedPane.panelId === panelId && panel.tabs.length === 1) {
      return null;
    }
    return { kind: 'panel', targetPanelId: panelId, zone };
  }

  function handleDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes(TAB_DRAG_MIME)) return;

    e.preventDefault();
    const zone = getDropZone(e);
    isPaneDragOver = getDraggedPane() !== null;
    isLegacyTabDragOver = !isPaneDragOver;
    activeDropZone = zone;
    if (isPaneDragOver) onPaneDropPreview?.(getPaneDropPlacement(zone));
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
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

    if (isPaneDragOver) onPaneDropPreview?.(null);
    isPaneDragOver = false;
    isLegacyTabDragOver = false;
    activeDropZone = null;
  }

  function finishPaneDrag() {
    isPaneDragOver = false;
    activeDropZone = null;
    onPaneDropPreview?.(null);
    const finish = onPaneDragFinish;
    if (finish) finish();
    else {
      clearDraggedPaneState();
      appStore.dispatch(endDrag());
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation(); // Prevent drop from reaching content (like editors)
    const draggedPane = getDraggedPane();
    if (draggedPane) {
      const zone = activeDropZone ?? getDropZone(e);
      const placement = getPaneDropPlacement(zone);
      finishPaneDrag();
      if (!placement) return;
      markUserTouch();
      if (placement.zone === 'center') onTabMoveToPanel?.(draggedPane.tabId, draggedPane.panelId);
      else onTabDrop?.(draggedPane.tabId, draggedPane.panelId, placement.zone);
      return;
    }

    markUserTouch();

    const zone = activeDropZone ?? getDropZone(e);
    activeDropZone = null;
    isLegacyTabDragOver = false;
    try {
      const data = e.dataTransfer?.getData(TAB_DRAG_MIME);
      if (!data) return;

      const { tabId, panelId: fromPanelId } = JSON.parse(data);

      if (zone === 'center') {
        // Move tab to this panel's tab bar (only if from a different panel)
        if (fromPanelId !== panelId) {
          onTabMoveToPanel?.(tabId, fromPanelId);
        }
      } else {
        // Split and move tab
        // If dropping on the same panel with only one tab, don't do anything
        // (can't split a panel with its only tab - it would just end up the same)
        if (fromPanelId === panelId && panel.tabs.length === 1) {
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
      'panel group/panel relative flex flex-col h-full overflow-hidden rounded-(--panel-shell-radius) text-foreground',
    )}
    class:bg-sidebar={panel.tabs.length === 0}
    class:bg-background={panel.tabs.length > 0}
    class:contained
    data-panel-id={panelId}
    data-layout-id={layoutId}
    data-focused={isFocused}
    data-focus-border-visible={isFocused && showFocusBorder}
    data-empty-panel-shell={panel.tabs.length === 0 ? 'true' : undefined}
    data-zoomed={isZoomed}
    data-pristine={panel.pristine === true}
    data-empty-panel-surface={panel.pristine === true && panel.tabs.length === 0
      ? 'true'
      : undefined}
    onfocusin={handlePanelFocus}
    onpointerdowncapture={handlePanelPointerDown}
    onkeydowncapture={handlePanelKeyDown}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    role="region"
    aria-label={m.layout_panel_ariaLabel()}
  >
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
        attentionTabIds={panel.attentionTabIds}
        {panelId}
        {workspaceId}
        {layoutId}
        {availableCanvasWidth}
        {isRightmostPanel}
        {isFocused}
        contentActions={headerActions.current}
        {onTabClick}
        {onTabClose}
        {onTabReorder}
        {onTabMoveToPanel}
        {onPaneDragFinish}
        {onMovePaneLeft}
        {onMovePaneRight}
        {onMoveLeft}
        {onMoveRight}
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
          {@const isActive = active && tab.id === panel.activeTabId}
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
          {panelId}
          {onCreateAgent}
          {onCreateAgentWithSpecialist}
          {onCreateNote}
          {onCreateTerminal}
          {onOpenBrowser}
        />
      {/if}
    </div>

    {#if isLegacyTabDragOver && activeDropZone}
      <div
        class={cn('legacy-tab-drop-destination', activeDropZone)}
        data-panel-drop-destination
        data-panel-legacy-tab-drop-zone={activeDropZone}
        aria-hidden="true"
      ></div>
    {/if}

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
    --panel-shell-radius: var(--radius-large);
    position: relative;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border: 1px solid transparent;
    box-shadow: var(--elevation-raised);

    /* Container query setup for responsive panel headers */
    container-type: size;
    container-name: panel;
  }

  .panel[data-focus-border-visible='true'] {
    border-color: hsl(var(--border));
  }

  @media (forced-colors: active) {
    .panel[data-focus-border-visible='true'] {
      border-color: Highlight;
    }
  }

  .panel[data-empty-panel-shell='true']:not([data-focus-border-visible='true']) {
    border-width: 0;
  }

  .panel[data-empty-panel-shell='true'] {
    box-shadow: none;
  }

  .panel-content {
    position: relative;
  }

  .legacy-tab-drop-destination {
    position: absolute;
    inset-block: 0;
    z-index: 20;
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    background: hsl(var(--card) / 0.42);
    pointer-events: none;
  }

  .legacy-tab-drop-destination.left {
    left: 0;
    width: 50%;
  }

  .legacy-tab-drop-destination.right {
    right: 0;
    width: 50%;
  }

  .legacy-tab-drop-destination.center {
    inset-inline: 0;
  }

  @media (forced-colors: active) {
    .legacy-tab-drop-destination {
      border-color: CanvasText;
      background: Canvas;
      outline: 2px solid CanvasText;
      outline-offset: -3px;
    }
  }

  /* Tab content wrapper - keeps content mounted but hidden to preserve scroll */
  .tab-content-wrapper {
    overflow: hidden;
  }

  .tab-content-wrapper.hidden {
    display: none;
  }
</style>
