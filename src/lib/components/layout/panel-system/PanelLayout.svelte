<script lang="ts">
  /* eslint-disable max-lines */
  import { setContext, onDestroy, tick, untrack } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import {
    getPanelLayoutManager,
    type PanelLayoutNode,
    type PanelTab,
  } from '$features/layout/panel-layout-adapter';
  import {
    getPaneDropPreview,
    getPanelMovePreviewWidthRatio,
    PANE_DROP_PREVIEW_PANEL_ID,
  } from '$features/layout/panel-move-preview';
  import {
    createPanelKeyboardShortcuts,
    registerPanelKeyboardShortcuts,
    unregisterPanelKeyboardShortcuts,
  } from '$features/layout/panel-keyboard-shortcuts.svelte';
  import {
    resolveLocalPanelCycleTarget,
    type PanelCycleBoundaryTarget,
    type PanelCycleDirection,
  } from '$features/layout/panel-cycle-navigation';
  import PanelContainer from './PanelContainer.svelte';
  import PanelCanvasFrame from './PanelCanvasFrame.svelte';
  import {
    getPanelCanvasWidths,
    getPanelPreferredWidths,
    getPanelViewportContentWidth,
  } from './panel-canvas-width';
  import PanelDragPreview from './PanelDragPreview.svelte';
  import {
    EMPTY_LAYOUT_LOADING_TIMEOUT_MS,
    isLayoutSettledNow,
    shouldRenderPanelContainer as computeShouldRenderPanelContainer,
  } from './panel-render-gate';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import { appClient } from '$lib/client';
  import { derived, writable } from 'svelte/store';
  import { createLogger } from '$lib/utils/client-logger';
  import { hasCapability } from '$lib/utils/platform-capabilities';
  import { dispatchWindowEvent } from '$lib/utils/window-events';

  import { resize } from '$lib/components/layout/size-transition';
  import { fade } from 'svelte/transition';
  import { flattenPanels, openTabFromConfig } from './panel-ai-layout-helpers';
  import { NoteId } from '$shared/types/branded-ids';
  import { updateNoteTitle } from '$features/notes/notes-write-service';
  import { renameWithUndo } from '$lib/utils/reversible-actions';
  import { updateSession as updateAgentSessionFields } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import { scrollFade } from '$lib/actions/scroll-fade';
  import { scheduleLayoutRead } from '$lib/utils/layout-phases';
  import { cn } from '$lib/utils';
  import { createBrowserFocusOwnershipReporter } from './browser-focus-ownership';
  import { closePanelWithLastPanelPolicy } from './close-panel';
  import {
    clearDraggedPaneState,
    getDraggedPane,
    getPaneColumnDropZone,
    getPaneInsertionPlacementAtX,
    getPaneInsertionTargets,
    type DraggedPane,
    type PaneDropPlacement,
  } from './panel-drag';
  import { selectIsDragging } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { endDrag } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { animatePanelPreviewPositions, capturePanelPositions } from './panel-reorder-animation';
  import { findPanelElement, scrollPanelIntoView } from './panel-layout-scroll';
  import {
    shouldBlurActiveElement,
    shouldRedirectFocusToPanelContent,
  } from './panel-content-focus';
  import { createLayoutStableRevealScheduler } from '$lib/components/workspace/utils/layout-stable-reveal';

  import {
    selectPanelLayoutRoot,
    selectExpandedPanelId,
    selectPanels,
    selectFocusedPanelId,
    selectActiveTab,
    selectAllTabs,
    selectPanelIds,
    selectPanelColumnDefaultWidthTiers,
    selectPanelCanvasWidth,
    selectPanelCanvasWidthSource,
    selectPendingPanelReveal,
    selectRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { removeTerminal } from '$store/renderer/slices/terminals/terminals-slice';
  import { renameAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    markPanelTouched,
    panelLayoutScopeMounted,
    panelLayoutScopeUnmounted,
    consumePanelReveal,
    resizePanelLayoutRightEdge,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { store as appStore } from '$store/renderer/store';
  import {
    allocateViewportPanelWidths,
    getAutomaticPanelCanvasWidth,
    getPanelDefaultWidth,
    type PanelCanvasSizing,
  } from '$shared/panel-layout-sizing';
  import { resizePanelTreeRightEdge } from '$store/renderer/slices/panel-layout/panel-layout-tabless';

  const logger = createLogger('PanelLayout');

  interface Props {
    workspaceId: string;
    layoutId?: string;
    active?: boolean;
    contained?: boolean;
    canvasSizing?: PanelCanvasSizing;
    hideEmptyLayout?: boolean;
    allowCloseLastPanel?: boolean;
    /** Callbacks for creating new items (passed to panel tab bars) */
    onCreateAgent?: (panelId?: string) => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null, panelId?: string) => void;
    onCreateNote?: (panelId?: string) => void;
    onPanelMovePreviewWidthRatioChange?: (ratio: number) => void;
    onPanelCanvasWidthChange?: (width: number) => void;
    onAvailableCanvasWidthChange?: (width: number) => void;
    onCyclePanelBoundary?: (direction: PanelCycleDirection) => PanelCycleBoundaryTarget | null;
  }

  let {
    workspaceId,
    layoutId,
    active = true,
    contained = false,
    canvasSizing = 'viewport',
    hideEmptyLayout = false,
    allowCloseLastPanel = false,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onCreateNote,
    onPanelMovePreviewWidthRatioChange,
    onPanelCanvasWidthChange,
    onAvailableCanvasWidthChange,
    onCyclePanelBoundary,
  }: Props = $props();

  const effectiveLayoutId = $derived(layoutId ?? workspaceId);

  $effect(() => {
    const mountedLayoutId = effectiveLayoutId;
    appStore.dispatch(panelLayoutScopeMounted(mountedLayoutId));
    return () => appStore.dispatch(panelLayoutScopeUnmounted(mountedLayoutId));
  });

  // Reactive writable store that mirrors the layout scope so Redux selectors
  // re-evaluate whenever the prop changes (called at component init time).
  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // Reactive selector subscriptions for template rendering
  const root$ = selectPanelLayoutRoot(workspaceIdStore);
  const expandedPanelId$ = selectExpandedPanelId(workspaceIdStore);
  const panels$ = selectPanels(workspaceIdStore);
  const focusedPanelId$ = selectFocusedPanelId(workspaceIdStore);
  const activeTab$ = selectActiveTab(workspaceIdStore);
  const allTabs$ = selectAllTabs(workspaceIdStore);
  const panelColumnDefaultWidthTiers$ = selectPanelColumnDefaultWidthTiers(workspaceIdStore);
  const panelDefaultWidthViewport = writable(0);
  const panelColumnDefaultWidths$ = derived(
    [panelColumnDefaultWidthTiers$, panelDefaultWidthViewport],
    ([$tiers, viewportWidth]) => $tiers.map((tier) => getPanelDefaultWidth(tier, viewportWidth)),
  );
  const panelCanvasWidth$ = selectPanelCanvasWidth(workspaceIdStore);
  const panelCanvasWidthSource$ = selectPanelCanvasWidthSource(workspaceIdStore);
  const pendingPanelReveal$ = selectPendingPanelReveal(workspaceIdStore);
  const restoreStatus$ = selectRestoreStatus(workspaceIdStore);
  const panelIds$ = selectPanelIds(workspaceIdStore);
  const isDragging$ = selectIsDragging();
  // Keep the root renderer on the split branch when the first adjacent panel
  // opens. The existing panel then retains its keyed component instance while
  // only the new child mounts and runs its enter transition.
  const stableContainerRoot = $derived(
    $root$.type === 'panel'
      ? {
          type: 'split' as const,
          direction: 'horizontal' as const,
          children: [$root$],
          sizes: [100],
        }
      : $root$,
  );
  let paneDropPreview = $state<{
    draggedPane: DraggedPane;
    placement: PaneDropPlacement;
  } | null>(null);
  let panelLayoutMotionElement = $state.raw<HTMLDivElement | null>(null);
  let panelWorkspaceInset = $state.raw<HTMLDivElement | null>(null);
  const panelRevealScheduler = createLayoutStableRevealScheduler();
  $effect(() => {
    const request = $pendingPanelReveal$;
    const container = panelWorkspaceInset;
    const targetLayoutId = effectiveLayoutId;
    if (contained || !active || !request || !container) {
      panelRevealScheduler.cancel();
      return;
    }

    const isCurrent = () =>
      panelWorkspaceInset === container &&
      selectPendingPanelReveal.select(appStore.state, targetLayoutId)?.requestId ===
        request.requestId;
    void tick().then(() => {
      if (!isCurrent()) return;
      panelRevealScheduler.schedule({
        resolveElements: () => {
          const target = findPanelElement(container, request.panelId);
          return target ? { container, target } : null;
        },
        isCurrent,
        reveal: () => {
          if (!isCurrent()) return;
          const moved = scrollPanelIntoView(container, request.panelId, 'smooth');
          appStore.dispatch(consumePanelReveal(targetLayoutId, request.requestId));
          if (request.preserveFocus) return;
          setTimeout(
            () => {
              if (
                active &&
                selectFocusedPanelId.select(appStore.state, targetLayoutId) === request.panelId
              ) {
                dispatchFocusPanelContent(request.panelId);
              }
            },
            moved ? 300 : 0,
          );
        },
        onTargetRemoved: () => {
          if (isCurrent()) appStore.dispatch(consumePanelReveal(targetLayoutId, request.requestId));
        },
      });
    });

    return () => panelRevealScheduler.cancel();
  });
  let panelViewportWidth = $state(0);
  $effect(() => {
    panelDefaultWidthViewport.set(canvasSizing === 'viewport' ? panelViewportWidth : 0);
  });
  const automaticPanelCanvasWidth = $derived(
    getAutomaticPanelCanvasWidth($panelColumnDefaultWidths$, canvasSizing, panelViewportWidth),
  );
  let panelRootReferenceSize = $state(0);
  let panelOuterResizeDelta = $state(0);
  let panelOuterResizeCommittedDelta = $state(0);
  let panelOuterResizeCommittedWidth = $state<number | null>(null);
  let viewportOuterResizeCommittedRoot = $state<PanelLayoutNode | null>(null);
  let viewportOuterResizeClearFrame: number | null = null;
  let panelOuterResizeStartReferenceSize: number | null = null;
  const effectivePreferredCanvasWidth = $derived(
    panelOuterResizeCommittedWidth ?? $panelCanvasWidth$,
  );
  const effectivePreferredCanvasWidthSource = $derived(
    panelOuterResizeCommittedWidth !== null ? 'explicit' : $panelCanvasWidthSource$,
  );
  const rootHorizontalSizes = $derived(
    $root$?.type === 'split' &&
      $root$.direction === 'horizontal' &&
      $root$.children.length === $panelColumnDefaultWidths$.length
      ? $root$.sizes
      : null,
  );
  const panelColumnPreferredWidths = $derived(
    getPanelPreferredWidths(
      $panelColumnDefaultWidths$,
      rootHorizontalSizes,
      effectivePreferredCanvasWidth,
      effectivePreferredCanvasWidthSource,
    ),
  );
  const allocatedPanelCanvas = $derived(
    getPanelCanvasWidths(
      panelViewportWidth,
      panelColumnPreferredWidths,
      canvasSizing,
      effectivePreferredCanvasWidth,
      effectivePreferredCanvasWidthSource,
    ),
  );
  const expandedAutomaticViewportWidth = $derived(
    $expandedPanelId$ !== null &&
      canvasSizing === 'viewport' &&
      $panelCanvasWidthSource$ !== 'explicit'
      ? allocatedPanelCanvas.defaultWidth
      : null,
  );
  const effectivePanelCanvasWidth = $derived(
    panelOuterResizeCommittedWidth ?? expandedAutomaticViewportWidth ?? $panelCanvasWidth$,
  );
  const effectivePanelCanvasWidthSource = $derived(
    panelOuterResizeCommittedWidth !== null || expandedAutomaticViewportWidth !== null
      ? 'explicit'
      : $panelCanvasWidthSource$,
  );
  const panelGeometryCanvasWidth = $derived(
    canvasSizing === 'viewport'
      ? allocatedPanelCanvas.defaultWidth
      : (panelOuterResizeCommittedWidth ??
          expandedAutomaticViewportWidth ??
          allocatedPanelCanvas.defaultWidth) + panelOuterResizeDelta,
  );
  const viewportOuterResizeRoot = $derived(
    viewportOuterResizeCommittedRoot ??
      (canvasSizing === 'viewport' && panelOuterResizeDelta !== 0
        ? resizePanelTreeRightEdge(
            stableContainerRoot,
            panelOuterResizeStartReferenceSize ?? panelRootReferenceSize,
            (panelOuterResizeStartReferenceSize ?? panelRootReferenceSize) + panelOuterResizeDelta,
          )
        : stableContainerRoot),
  );
  const viewportOuterResizeWidths = $derived(
    canvasSizing === 'viewport' &&
      (panelOuterResizeDelta !== 0 || viewportOuterResizeCommittedRoot !== null) &&
      viewportOuterResizeRoot.type === 'split' &&
      viewportOuterResizeRoot.direction === 'horizontal'
      ? allocateViewportPanelWidths(viewportOuterResizeRoot.sizes, panelViewportWidth).panelWidths
      : allocatedPanelCanvas.panelWidths,
  );
  let retainedRootPanel = $state<{ panelId: string; width: number } | null>(null);

  $effect(() => {
    const rootIsReconciled =
      $root$ === selectPanelLayoutRoot.select(appStore.state, effectiveLayoutId);
    if (
      panelOuterResizeCommittedWidth !== null &&
      rootIsReconciled &&
      (($panelCanvasWidthSource$ === 'explicit' &&
        $panelCanvasWidth$ === panelOuterResizeCommittedWidth) ||
        ($panelCanvasWidthSource$ === null &&
          $panelCanvasWidth$ === null &&
          panelOuterResizeCommittedWidth === automaticPanelCanvasWidth))
    ) {
      panelOuterResizeCommittedWidth = null;
      panelOuterResizeCommittedDelta = 0;
    }
  });

  function measurePanelViewportWidth(node: HTMLElement, enabled = true) {
    let observer: ResizeObserver | null = null;
    let cancelRead: (() => void) | null = null;
    function update() {
      const styles = getComputedStyle(node);
      panelViewportWidth = getPanelViewportContentWidth(
        node.clientWidth,
        Number.parseFloat(styles.paddingLeft) || 0,
        Number.parseFloat(styles.paddingRight) || 0,
      );
      onAvailableCanvasWidthChange?.(panelViewportWidth);
    }

    function sync(nextEnabled: boolean) {
      observer?.disconnect();
      observer = null;
      cancelRead?.();
      cancelRead = null;
      if (!nextEnabled) return;
      // No synchronous update here: it runs mid-flush on workspace switches
      // and forces a reflow. The initial measurement goes through the shared
      // batched read phase instead; the observer covers later resizes.
      cancelRead = scheduleLayoutRead(() => {
        cancelRead = null;
        update();
      });
      if (typeof ResizeObserver === 'undefined') return;
      observer = new ResizeObserver(update);
      observer.observe(node);
    }

    sync(enabled);
    return {
      update: sync,
      destroy: () => {
        observer?.disconnect();
        cancelRead?.();
      },
    };
  }
  const retainedRootPanelWidth = $derived(
    $root$.type === 'panel' && retainedRootPanel?.panelId === $root$.panelId
      ? retainedRootPanel.width
      : null,
  );
  $effect(() => {
    if (retainedRootPanel && $root$.type !== 'panel') retainedRootPanel = null;
  });

  function handlePanelCanvasResizeStart() {
    markPristinePanelsTouched();
    panelOuterResizeCommittedWidth = null;
    panelOuterResizeCommittedDelta = 0;
    viewportOuterResizeCommittedRoot = null;
    if (viewportOuterResizeClearFrame !== null) cancelAnimationFrame(viewportOuterResizeClearFrame);
    viewportOuterResizeClearFrame = null;
    panelOuterResizeStartReferenceSize = panelRootReferenceSize > 0 ? panelRootReferenceSize : null;
  }

  function handlePanelCanvasResizeEnd(previousWidth: number, nextWidth: number) {
    const startReferenceSize = panelOuterResizeStartReferenceSize;
    panelOuterResizeStartReferenceSize = null;
    if (previousWidth === nextWidth) return;
    const gutterWidth =
      startReferenceSize !== null ? Math.max(0, previousWidth - startReferenceSize) : 0;
    panelOuterResizeCommittedWidth = nextWidth;
    if (canvasSizing === 'viewport') viewportOuterResizeCommittedRoot = viewportOuterResizeRoot;
    panelOuterResizeCommittedDelta = canvasSizing === 'viewport' ? 0 : nextWidth - previousWidth;
    appStore.dispatch(
      resizePanelLayoutRightEdge(
        effectiveLayoutId,
        Math.max(1, previousWidth - gutterWidth),
        Math.max(1, nextWidth - gutterWidth),
        nextWidth,
        nextWidth === automaticPanelCanvasWidth,
      ),
    );
    panelOuterResizeDelta = 0;
    if (viewportOuterResizeCommittedRoot !== null) {
      viewportOuterResizeClearFrame = requestAnimationFrame(() => {
        viewportOuterResizeCommittedRoot = null;
        viewportOuterResizeClearFrame = null;
      });
    }
  }

  function handlePanelCanvasResizeCancel() {
    panelOuterResizeCommittedWidth = null;
    panelOuterResizeCommittedDelta = 0;
    viewportOuterResizeCommittedRoot = null;
    if (viewportOuterResizeClearFrame !== null) cancelAnimationFrame(viewportOuterResizeClearFrame);
    viewportOuterResizeClearFrame = null;
    panelOuterResizeStartReferenceSize = null;
    panelOuterResizeDelta = 0;
  }
  let panelDragPreviewElement = $state.raw<HTMLDivElement | null>(null);
  let panelPreviewStartPositions = new Map<string, DOMRect>();
  let panelPreviewAnimationVersion = 0;
  let panelMovePreviewClearFrame: number | null = null;
  let paneDropPreviewFrame: number | null = null;
  let pendingPaneDropPoint: { clientX: number; targetPanelId: string | null } | null = null;
  let paneInsertionGeometry: ReturnType<typeof measurePaneInsertionGeometry> = null;
  let paneInsertionGeometryKey: string | null = null;
  let panelMoveCommitVersion = 0;
  let panelMoveCommitReleaseFrame: number | null = null;
  let suppressCommittedPanelMoveMotion = $state(false);
  const panelMovePreview = $derived(
    paneDropPreview
      ? getPaneDropPreview(
          { root: $root$, panels: $panels$ },
          paneDropPreview.draggedPane,
          paneDropPreview.placement,
          $panelCanvasWidth$,
        )
      : null,
  );
  const visiblePanelMovePreview = $derived(
    panelMovePreview?.changed === true ? panelMovePreview : null,
  );
  const panelMovePreviewRoot = $derived(visiblePanelMovePreview?.root ?? null);
  const paneDropPreviewPanelId = $derived(
    visiblePanelMovePreview?.destinationPanelId ?? PANE_DROP_PREVIEW_PANEL_ID,
  );
  const panelMovePreviewWidthRatio = $derived(
    visiblePanelMovePreview
      ? getPanelMovePreviewWidthRatio(
          $root$,
          visiblePanelMovePreview.root,
          $panelCanvasWidth$,
          visiblePanelMovePreview.canvasWidth,
        )
      : 1,
  );
  let reportedPanelMovePreviewWidthRatio = 1;

  $effect(() => {
    const nextRatio = panelMovePreviewWidthRatio;
    if (nextRatio === reportedPanelMovePreviewWidthRatio) return;
    reportedPanelMovePreviewWidthRatio = nextRatio;
    onPanelMovePreviewWidthRatioChange?.(nextRatio);
  });

  function clearPanelMovePreviewNow() {
    if (panelMovePreviewClearFrame !== null) cancelAnimationFrame(panelMovePreviewClearFrame);
    panelMovePreviewClearFrame = null;
    if (paneDropPreviewFrame !== null) cancelAnimationFrame(paneDropPreviewFrame);
    paneDropPreviewFrame = null;
    pendingPaneDropPoint = null;
    panelPreviewAnimationVersion += 1;
    panelDragPreviewElement
      ?.getAnimations({ subtree: true })
      .forEach((animation) => animation.cancel());
    panelPreviewStartPositions = new Map();
    paneDropPreview = null;
  }

  function arePaneDropPlacementsEqual(
    first: PaneDropPlacement | null,
    second: PaneDropPlacement | null,
  ): boolean {
    if (first === second) return true;
    if (!first || !second || first.kind !== second.kind) return false;
    if (first.kind === 'edge' && second.kind === 'edge') return first.position === second.position;
    return (
      first.kind === 'panel' &&
      second.kind === 'panel' &&
      first.targetPanelId === second.targetPanelId &&
      first.zone === second.zone
    );
  }

  function setPaneDropPreview(placement: PaneDropPlacement | null) {
    const draggedPane = getDraggedPane();
    const current = paneDropPreview;
    if (!draggedPane || !placement) {
      if (current) paneDropPreview = null;
      return;
    }
    if (
      current?.draggedPane.tabId === draggedPane.tabId &&
      current.draggedPane.panelId === draggedPane.panelId &&
      arePaneDropPlacementsEqual(current.placement, placement)
    ) {
      return;
    }
    paneDropPreview = { draggedPane, placement };
  }

  function ownsDraggedPane(): boolean {
    const draggedPane = getDraggedPane();
    return draggedPane !== null && $panels$[draggedPane.panelId] !== undefined;
  }

  function finishPaneDrag() {
    clearPanelMovePreviewNow();
    invalidatePaneInsertionGeometry();
    clearDraggedPaneState();
    appStore.dispatch(endDrag());
  }

  function invalidatePaneInsertionGeometry() {
    paneInsertionGeometry = null;
    paneInsertionGeometryKey = null;
  }

  $effect(() => {
    const layoutElement = panelLayoutMotionElement;
    const panelIds = $panelIds$;
    if (!active || !layoutElement) return;

    const observer = new ResizeObserver(invalidatePaneInsertionGeometry);
    observer.observe(layoutElement);
    const panelElements = layoutElement.querySelectorAll<HTMLElement>('[data-panel-id]');
    for (const panelElement of panelElements) {
      if (panelElement.dataset.panelId && panelIds.includes(panelElement.dataset.panelId)) {
        observer.observe(panelElement);
      }
    }
    return () => observer.disconnect();
  });

  function commitPanelMoveWithoutReplay(commit: () => void) {
    if (panelMovePreviewClearFrame !== null) cancelAnimationFrame(panelMovePreviewClearFrame);
    panelMovePreviewClearFrame = null;
    if (panelMoveCommitReleaseFrame !== null) cancelAnimationFrame(panelMoveCommitReleaseFrame);
    panelMoveCommitReleaseFrame = null;
    const version = ++panelMoveCommitVersion;
    suppressCommittedPanelMoveMotion = true;
    commit();

    void tick().then(() => {
      if (version !== panelMoveCommitVersion) return;
      clearPanelMovePreviewNow();
      panelMoveCommitReleaseFrame = requestAnimationFrame(() => {
        panelMoveCommitReleaseFrame = null;
        if (version === panelMoveCommitVersion) suppressCommittedPanelMoveMotion = false;
      });
    });
  }

  function measurePaneInsertionGeometry() {
    if (!panelLayoutMotionElement) return null;
    const panelElements = Array.from(
      panelLayoutMotionElement.querySelectorAll<HTMLElement>('[data-panel-id]'),
    );
    const panelElementsById = new Map(
      panelElements.map((element) => [element.dataset.panelId, element] as const),
    );
    const panelRects = $panelIds$.map((panelId) =>
      panelElementsById.get(panelId)?.getBoundingClientRect(),
    );
    if (panelRects.some((rect) => !rect)) return null;

    const layoutRect = panelLayoutMotionElement.getBoundingClientRect();
    const targets = getPaneInsertionTargets(
      layoutRect,
      panelRects as DOMRect[],
      $panelIds$.length < 4,
    );
    const panelRectsById = new Map(
      $panelIds$.map((panelId, index) => [panelId, panelRects[index] as DOMRect] as const),
    );
    return { layoutRect, panelRectsById, targets };
  }

  function getPaneInsertionGeometry(draggedPane: DraggedPane) {
    const key = `${draggedPane.panelId}:${draggedPane.tabId}:${$panelIds$.join(',')}`;
    if (paneInsertionGeometryKey === key && paneInsertionGeometry) return paneInsertionGeometry;
    paneInsertionGeometryKey = key;
    paneInsertionGeometry = measurePaneInsertionGeometry();
    return paneInsertionGeometry;
  }

  function resolvePaneDropPlacement(
    clientX: number,
    targetPanelId: string | null,
    draggedPane = getDraggedPane(),
  ): PaneDropPlacement | null {
    if (!draggedPane) return null;
    const geometry = getPaneInsertionGeometry(draggedPane);
    if (!geometry) return null;
    const insertionPlacement = getPaneInsertionPlacementAtX(
      clientX,
      geometry.layoutRect,
      geometry.targets,
      $panelIds$,
    );
    if (insertionPlacement) return insertionPlacement;

    if (!targetPanelId) return null;
    const targetRect = geometry.panelRectsById.get(targetPanelId);
    if (!targetRect) return null;
    const targetPanel = $panels$[targetPanelId];
    if (!targetPanel) return null;
    const previousPlacement = paneDropPreview?.placement;
    const previousZone =
      previousPlacement?.kind === 'panel' && previousPlacement.targetPanelId === targetPanelId
        ? previousPlacement.zone
        : null;
    const zone = getPaneColumnDropZone(clientX, targetRect, $panelIds$.length < 4, previousZone);
    if (zone === 'center' && draggedPane.panelId === targetPanelId) return null;
    if (
      zone !== 'center' &&
      draggedPane.panelId === targetPanelId &&
      targetPanel.tabs.length === 1
    ) {
      return null;
    }
    return { kind: 'panel', targetPanelId, zone };
  }

  function handlePaneInsertionDragOver(event: DragEvent) {
    if (!getDraggedPane()) return;
    event.stopPropagation();
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const eventElement = event.target instanceof Element ? event.target : null;
    pendingPaneDropPoint = {
      clientX: event.clientX,
      targetPanelId: eventElement?.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId ?? null,
    };
    if (paneDropPreviewFrame !== null) return;
    paneDropPreviewFrame = requestAnimationFrame(() => {
      paneDropPreviewFrame = null;
      const point = pendingPaneDropPoint;
      pendingPaneDropPoint = null;
      if (point) setPaneDropPreview(resolvePaneDropPlacement(point.clientX, point.targetPanelId));
    });
  }

  function handlePaneInsertionDrop(event: DragEvent) {
    const draggedPane = getDraggedPane();
    if (!draggedPane) return;
    const eventElement = event.target instanceof Element ? event.target : null;
    const targetPanelId =
      eventElement?.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId ?? null;
    const placement = resolvePaneDropPlacement(event.clientX, targetPanelId, draggedPane);

    event.preventDefault();
    event.stopPropagation();
    if (!placement) {
      finishPaneDrag();
      return;
    }
    commitPanelMoveWithoutReplay(() => {
      finishPaneDrag();
      if (placement.kind === 'edge') {
        layoutManager.moveTabToSplitLevel(
          draggedPane.tabId,
          draggedPane.panelId,
          [],
          placement.position,
          'horizontal',
        );
        return;
      }
      if (placement.zone === 'center') {
        layoutManager.moveTabToPanel(
          draggedPane.tabId,
          draggedPane.panelId,
          placement.targetPanelId,
        );
        return;
      }
      layoutManager.moveTabToSplit(
        draggedPane.tabId,
        draggedPane.panelId,
        placement.targetPanelId,
        placement.zone,
      );
    });
  }

  function handlePaneInsertionDragLeave(event: DragEvent) {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && panelLayoutMotionElement?.contains(relatedTarget)) return;
    clearPanelMovePreviewNow();
  }

  function handlePaneDropPreview(placement: PaneDropPlacement | null) {
    setPaneDropPreview(placement);
  }

  function handleWindowPaneDragLeave(event: DragEvent) {
    if (!ownsDraggedPane() || event.relatedTarget !== null) return;
    const target = event.target;
    if (
      target !== window &&
      target !== document &&
      target !== document.documentElement &&
      target !== document.body
    ) {
      return;
    }
    finishPaneDrag();
  }

  function handleWindowPaneDragEnd() {
    if (ownsDraggedPane()) finishPaneDrag();
  }

  function handleWindowPaneDrop() {
    if (ownsDraggedPane()) finishPaneDrag();
  }

  $effect.pre(() => {
    if (!panelMovePreviewRoot || suppressCommittedPanelMoveMotion) return;
    const previewElement = untrack(() => panelDragPreviewElement);
    const motionElement = untrack(() => panelLayoutMotionElement);
    panelPreviewStartPositions = previewElement
      ? capturePanelPositions(previewElement)
      : capturePanelPositions(motionElement, '[data-panel-id]');
  });

  $effect(() => {
    if (!panelMovePreviewRoot || suppressCommittedPanelMoveMotion) return;
    const version = ++panelPreviewAnimationVersion;
    void tick().then(() => {
      const previewElement = untrack(() => panelDragPreviewElement);
      if (version === panelPreviewAnimationVersion && previewElement) {
        animatePanelPreviewPositions(previewElement, panelPreviewStartPositions);
      }
    });
  });

  $effect(() => {
    if (!$isDragging$ && !suppressCommittedPanelMoveMotion) {
      clearPanelMovePreviewNow();
      invalidatePaneInsertionGeometry();
    }
  });

  // Per-workspace "settled" latch: once the layout has been considered
  // resolved for a workspace (backend restored it, tabs appeared, or the
  // fallback loading window elapsed), keep it settled until workspaceId
  // changes. Without the latch, closing the last tab re-armed the loading
  // window and unmounted <PanelContainer> for the fallback duration, causing
  // a blank content area before the empty state reappeared.
  let settledForWorkspaceId = $state<string | null>(null);
  const isSettled = $derived(settledForWorkspaceId === effectiveLayoutId);

  $effect(() => {
    if (!active || untrack(() => settledForWorkspaceId) === effectiveLayoutId) return;

    if (isLayoutSettledNow($restoreStatus$, $allTabs$.length)) {
      settledForWorkspaceId = effectiveLayoutId;
      return;
    }

    const currentWorkspaceId = effectiveLayoutId;
    const timeoutId = window.setTimeout(() => {
      settledForWorkspaceId = currentWorkspaceId;
    }, EMPTY_LAYOUT_LOADING_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  });

  const shouldRenderPanelContainer = $derived(
    computeShouldRenderPanelContainer({
      restoreStatus: $restoreStatus$,
      totalTabs: $allTabs$.length,
      hasSettled: isSettled,
    }),
  );
  let lifecycleMotionReadyForLayoutId = $state<string | null>(null);
  const layoutMotionDuration = $derived(
    lifecycleMotionReadyForLayoutId === effectiveLayoutId && !suppressCommittedPanelMoveMotion
      ? 220
      : 0,
  );

  $effect(() => {
    const layoutId = effectiveLayoutId;
    if (!active || !shouldRenderPanelContainer || lifecycleMotionReadyForLayoutId === layoutId)
      return;

    const frame = requestAnimationFrame(() => {
      if (effectiveLayoutId === layoutId) lifecycleMotionReadyForLayoutId = layoutId;
    });
    return () => cancelAnimationFrame(frame);
  });

  // Get or create the panel layout manager for this workspace (action methods only)
  let layoutManager = $derived(getPanelLayoutManager(effectiveLayoutId));

  // Create keyboard shortcuts manager and register it globally
  const keyboardShortcuts = createPanelKeyboardShortcuts(
    () => layoutManager,
    (direction) => focusCycledPanel(direction),
    () => panelViewportWidth,
    { onFocusAdjacentColumn: (direction) => focusAdjacentColumn(direction) },
  );

  // Register keyboard shortcuts in cache so they can be accessed from outside
  $effect(() => {
    if (!active) return;
    registerPanelKeyboardShortcuts(effectiveLayoutId, keyboardShortcuts);
    return () => {
      unregisterPanelKeyboardShortcuts(effectiveLayoutId);
    };
  });

  // Notify main process when a browser panel becomes the active/focused panel.
  // Ownership tokens let teardown clear only the browser identity it claimed.
  const browserFocusOwnership = createBrowserFocusOwnershipReporter(invoke);
  $effect(() => {
    const activeTab = $activeTab$;
    const browserIdentity =
      active && activeTab?.type === 'browser'
        ? `${effectiveLayoutId}:${$focusedPanelId$ ?? ''}:${activeTab.id}`
        : null;
    browserFocusOwnership.update(browserIdentity);
  });

  // Terminal list state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let terminals = $state<
    Array<{
      id: string;
      name: string;
      lastCommand?: string;
      lastOutput?: string;
      hasRunningProcess: boolean;
    }>
  >([]);

  // Load terminals - called explicitly when workspace changes or terminals update
  function loadTerminals(wsId: string) {
    const terminalMetadata = terminalManager.loadTerminalMetadata(wsId);
    terminals = terminalMetadata.map((t) => {
      const history = terminalHistoryTracker.getHistory(t.terminalId);
      return {
        id: t.terminalId,
        name: t.title || m.layout_panelLayout_terminal_fallback(),
        lastCommand: history?.lastCommand,
        lastOutput: history?.lastOutput,
        hasRunningProcess: history?.isExecuting || false,
      };
    });
  }

  // Track last loaded to prevent redundant loads
  // Using a non-reactive variable to avoid dependency tracking
  let lastLoadedWorkspaceId: string | null = null;

  // Effect to load terminals when workspaceId changes
  // Terminal history updates are handled via the onMount subscription
  $effect(() => {
    const wsId = workspaceId;
    if (!active) {
      lastLoadedWorkspaceId = null;
      return;
    }

    // Only reload if workspace changed
    if (wsId !== lastLoadedWorkspaceId) {
      lastLoadedWorkspaceId = wsId;
      // Use untrack to prevent the terminals state update from re-triggering effects
      untrack(() => {
        loadTerminals(wsId);
      });
    }
  });

  // Subscribe to terminal history updates only while this surface is active.
  // We track the first call to skip the immediate invocation that happens on subscribe
  $effect(() => {
    if (!active) return;
    let isFirstCall = true;
    const unsubscribe = terminalHistoryTracker.updateCounter.subscribe(() => {
      // Skip the first call (immediate invocation on subscribe)
      // as we already load terminals in the $effect
      if (isFirstCall) {
        isFirstCall = false;
        return;
      }
      // Reload terminals when history updates
      loadTerminals(workspaceId);
    });
    return unsubscribe;
  });

  // Handler to create a new terminal via the daemon (`terminal.create`,
  // PROTOCOL §5.13). The daemon assigns the terminalId; we surface it as
  // `MutationResult.id` from the live client.
  async function handleCreateTerminal(panelId?: string) {
    try {
      const result = await appClient.terminals.create({
        workspaceId,
        cols: 80,
        rows: 24,
      });

      if (result.success && result.id) {
        logger.info('Created new terminal', { terminalId: result.id });

        // Clear any stale Redux entry for this id before saving fresh metadata.
        // `saveTerminalMetadata` spreads the existing entry to preserve
        // customName across remounts, but for a freshly daemon-assigned id
        // (e.g. after a daemon restart that resets the id counter) a stale
        // customName from a previously renamed terminal must not carry over.
        appStore.dispatch(removeTerminal(workspaceId, result.id));

        // Save terminal metadata without a hardcoded title — the reducer keeps
        // any daemon-provided name and only falls back to 'Terminal'.
        terminalManager.saveTerminalMetadata(result.id, workspaceId);

        // Reload terminals to include the new one
        loadTerminals(workspaceId);

        // Open the new terminal as a tab in the panel layout
        layoutManager.openTab(
          {
            type: 'terminal',
            title: m.layout_panelLayout_terminal_fallback(),
            terminalId: result.id,
            closable: true,
          },
          panelId,
        );
      } else if (!result.success) {
        logger.error('Failed to create terminal', { error: result.error });
      }
    } catch (error) {
      logger.error('Failed to create terminal', error);
    }
  }

  // Handler to open a new browser tab. The embedded browser panel needs the
  // Electron <webview> + CDP bridge, so the handler is only offered when the
  // capability exists — child components hide their "New Browser" entry points
  // when onOpenBrowser is undefined.
  const canOpenBrowserPanel = hasCapability('browserPanel');
  function handleOpenBrowser(panelId?: string) {
    layoutManager.openBrowserPanel('about:blank', undefined, panelId);
  }

  // Provide a getter function to child components via context
  // This ensures they always get the current manager even if workspaceId changes
  setContext('panelLayoutManager', () => layoutManager);

  // Event handlers
  function markPristinePanelsTouched() {
    for (const panel of Object.values($panels$)) {
      if (panel.pristine) appStore.dispatch(markPanelTouched(effectiveLayoutId, panel.id));
    }
  }

  function handleFocusPanel(panelId: string) {
    layoutManager.focusPanel(panelId);
  }

  function handleTabClick(panelId: string, tabId: string) {
    layoutManager.focusPanel(panelId);
    layoutManager.setActiveTab(tabId, panelId);
  }

  function handleTabClose(panelId: string, tabId: string) {
    // Closing a panel's final tab removes the panel itself (closePanelHelper
    // runs inside the closeTab reducer), so it collapses the split exactly
    // like a panel close and needs the same motion suppression to avoid the
    // surviving-sibling overflow flicker during the exit outro.
    const panel = $panels$[panelId];
    const collapsesPanel =
      panel?.tabs.length === 1 && panel.tabs[0].id === tabId && Object.keys($panels$).length > 1;
    if (collapsesPanel) {
      commitPanelMoveWithoutReplay(() => layoutManager.closeTab(tabId, panelId));
    } else {
      layoutManager.closeTab(tabId, panelId);
    }
  }

  function handleTabReorder(panelId: string, fromIndex: number, toIndex: number) {
    layoutManager.reorderTabs(panelId, fromIndex, toIndex);
  }

  function handleCloseOtherTabs(panelId: string, tabId: string) {
    layoutManager.closeOtherTabs(tabId, panelId);
  }

  function handleCloseTabsToRight(panelId: string, tabId: string) {
    layoutManager.closeTabsToRight(tabId, panelId);
  }

  function handleCloseAllTabs(panelId: string) {
    layoutManager.closeAllTabs(panelId);
  }

  function handleCloseAllOthersEverywhere(panelId: string, tabId: string) {
    if (panelLayoutMotionElement) {
      const panelElement = Array.from(
        panelLayoutMotionElement.querySelectorAll<HTMLElement>('[data-panel-id]'),
      ).find((element) => element.dataset.panelId === panelId);
      const width = panelElement?.getBoundingClientRect().width ?? 0;
      retainedRootPanel = width > 0 ? { panelId, width } : null;
    }
    layoutManager.closeAllOthersEverywhere(tabId, panelId);
  }

  function handleSplitPanel(panelId: string, direction: 'horizontal' | 'vertical') {
    retainedRootPanel = null;
    layoutManager.splitPanel(panelId, direction);
  }

  function handleClosePanel(panelId: string) {
    // Commit the close without layout motion: during the removed wrapper's
    // exit outro the surviving siblings already carry their new (larger)
    // pixel flex bases, so the combined width overflows the canvas for the
    // exit duration and visibly shifts/clips the survivors. Suppressing the
    // replay applies the collapse in a single frame.
    commitPanelMoveWithoutReplay(() => {
      closePanelWithLastPanelPolicy(layoutManager, panelId, allowCloseLastPanel);
    });
  }

  function handleZoomToggle(_panelId: string) {
    keyboardShortcuts.executeAction('zoom-toggle');
  }

  function handleUpdateSizes(nodePath: number[], sizes: number[]) {
    markPristinePanelsTouched();
    // nodePath represents the path to the split node whose sizes are being updated
    // Empty path means root
    layoutManager.updateSizes(nodePath, sizes);
  }

  function handleResizeRootDivider(
    previousPanelWidths: readonly number[],
    finalPanelWidths: readonly number[],
  ) {
    markPristinePanelsTouched();
    layoutManager.resizeRootDivider(previousPanelWidths, finalPanelWidths);
  }

  function handlePanelCanvasWidthChange(width: number) {
    onPanelCanvasWidthChange?.(width);
  }

  function handlePanelOuterResizePreview(delta: number) {
    panelOuterResizeDelta = delta;
  }

  function handleTabDropToSplit(
    targetPanelId: string,
    tabId: string,
    fromPanelId: string,
    zone: 'left' | 'right' | 'center',
  ) {
    if (zone === 'center') {
      // Move to panel, not split
      layoutManager.moveTabToPanel(tabId, fromPanelId, targetPanelId);
    } else {
      layoutManager.moveTabToSplit(tabId, fromPanelId, targetPanelId, zone);
    }
  }

  function handleTabMoveToPanel(
    targetPanelId: string,
    tabId: string,
    fromPanelId: string,
    insertIndex?: number,
  ) {
    layoutManager.moveTabToPanel(tabId, fromPanelId, targetPanelId, insertIndex);
  }

  function handleMoveActivePane(panelId: string, direction: PanelCycleDirection) {
    const panelIds = selectPanelIds.select(appStore.state, workspaceId);
    const panelIndex = panelIds.indexOf(panelId);
    const targetIndex = panelIndex + (direction === 'next' ? 1 : -1);
    const targetPanelId = panelIds[targetIndex];
    const activeTabId = layoutManager.getPanel(panelId)?.activeTabId;
    if (targetPanelId && activeTabId) {
      layoutManager.moveTabToPanel(activeTabId, panelId, targetPanelId);
    }
  }

  function handleTabDropToSplitHandle(
    tabId: string,
    fromPanelId: string,
    nodePath: number[],
    position: 'before' | 'after',
    direction: 'horizontal' | 'vertical',
  ) {
    if (direction !== 'horizontal') return;
    layoutManager.moveTabToSplitLevel(tabId, fromPanelId, nodePath, position, direction);
  }

  function handlePanelMove(
    draggedPanelId: string,
    targetPanelId: string,
    position: 'before' | 'after' | 'above' | 'below',
  ) {
    commitPanelMoveWithoutReplay(() => {
      layoutManager.movePanel(draggedPanelId, targetPanelId, position);
    });
  }

  /**
   * Handle renaming a tab (note, agent, or file).
   * Shows a toast with undo support.
   */
  async function handleTabRename(tab: PanelTab, newName: string) {
    const oldName = tab.title || m.layout_panelLayout_untitled_fallback();

    if (tab.type === 'note' && tab.noteId) {
      // Rename note
      const noteId = NoteId(tab.noteId);
      await renameWithUndo(
        'note',
        oldName,
        newName,
        () => {
          void updateNoteTitle(workspaceId, noteId, newName);
          // Update the tab title in the layout manager
          layoutManager.updateTabTitle(tab.id, newName);
        },
        () => {
          void updateNoteTitle(workspaceId, noteId, oldName);
          layoutManager.updateTabTitle(tab.id, oldName);
        },
      );
    } else if (tab.type === 'agent' && tab.agentId) {
      // Rename agent
      const agentId = tab.agentId;
      // Capture the pre-rename nameExplicitlySet flag so revert paths can
      // restore the exact disk state. Auto-named sessions have
      // nameExplicitlySet: false; hardcoding true here would diverge Redux
      // from disk and permanently block MCP/automatic naming on failure.
      const preRenameSession = selectAgentSession.select(appStore.state, agentId);
      const oldNameExplicitlySet = preRenameSession?.nameExplicitlySet ?? false;
      await renameWithUndo(
        'agent',
        oldName,
        newName,
        async () => {
          appStore.dispatch(
            updateAgentSessionFields(agentId, {
              name: newName,
              nameExplicitlySet: true,
            } as any),
          );
          layoutManager.updateTabTitle(tab.id, newName);
          // Persist the rename via the mutation middleware (`agent.rename`,
          // PROTOCOL §5.5) so other windows pick it up immediately.
          try {
            const action = renameAgentSessionRequested(workspaceId, agentId, newName);
            appStore.dispatch(action);
            await action.promise;
          } catch (err) {
            // Revert optimistic UI so tab title and Redux match disk, then
            // rethrow so ReversibleActionManager surfaces the error toast
            // and skips the undo toast.
            appStore.dispatch(
              updateAgentSessionFields(agentId, {
                name: oldName,
                nameExplicitlySet: oldNameExplicitlySet,
              } as any),
            );
            layoutManager.updateTabTitle(tab.id, oldName);
            throw err;
          }
        },
        async () => {
          // Undo: restore old name with the captured nameExplicitlySet so
          // Redux matches what disk held before the rename.
          appStore.dispatch(
            updateAgentSessionFields(agentId, {
              name: oldName,
              nameExplicitlySet: oldNameExplicitlySet,
            } as any),
          );
          layoutManager.updateTabTitle(tab.id, oldName);
          try {
            const action = renameAgentSessionRequested(workspaceId, agentId, oldName);
            appStore.dispatch(action);
            await action.promise;
          } catch (err) {
            // Revert the revert: undo failed, so restore the new name in the UI
            // and rethrow so the user sees the error.
            appStore.dispatch(
              updateAgentSessionFields(agentId, {
                name: newName,
                nameExplicitlySet: true,
              } as any),
            );
            layoutManager.updateTabTitle(tab.id, newName);
            throw err;
          }
        },
      );
    }
    // Note: File renaming is more complex (involves filesystem) - skipping for now
  }

  /**
   * Dispatch an event to focus the content of a panel.
   * Content components (ChatPanel, NoteWithComments) listen for this event
   * and focus their main input element accordingly.
   * For other tab types, blur any currently focused element.
   */
  function dispatchFocusPanelContent(
    panelId: string,
    targetLayoutManager = layoutManager,
    targetWorkspaceId = workspaceId,
    targetLayoutId = effectiveLayoutId,
  ) {
    const panel = targetLayoutManager.getPanel(panelId);
    if (!panel || !panel.activeTabId) {
      // No active tab, blur focus left behind outside the target panel
      if (shouldBlurActiveElement(document.activeElement, panelId, targetLayoutId)) {
        document.activeElement.blur();
      }
      return;
    }

    const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);
    if (!activeTab) return;

    // Types that have focusable content that should receive focus
    const focusableTypes = ['agent', 'note', 'file'];

    // Use a delay to ensure panel switch animation/rendering is complete
    // and any click event processing from the source panel has finished
    setTimeout(() => {
      // Skip entirely if this panel lost focus while the callback was queued,
      // so a stale callback cannot redirect or blur focus the user has since
      // placed in another panel.
      if (selectFocusedPanelId.select(appStore.state, targetLayoutId) !== panelId) return;
      if (focusableTypes.includes(activeTab.type)) {
        // Only redirect focus into the panel content when the current focus
        // lives outside the target panel — focus the user just placed inside
        // the panel but outside the prompt (e.g. the header rename input)
        // must not be stolen (intent-hq/monorepo#2947).
        if (!shouldRedirectFocusToPanelContent(document.activeElement, panelId, targetLayoutId)) {
          return;
        }
        // Dispatch event with panel and tab info - content components will handle focus
        dispatchWindowEvent('panel:focus-content', {
          panelId,
          tabId: activeTab.id,
          tabType: activeTab.type,
          agentId: activeTab.agentId,
          noteId: activeTab.noteId,
          workspaceId: targetWorkspaceId,
        });
      } else {
        // For other tab types (terminal, file, diff, browser, etc.), blur
        // stale focus from previously focused content — but never focus the
        // user just placed inside this panel (its webview, URL bar, etc.),
        // or clicking into a browser tab would blur itself 100 ms later
        // (intent-hq/monorepo#2895).
        if (shouldBlurActiveElement(document.activeElement, panelId, targetLayoutId)) {
          document.activeElement.blur();
        }
      }
    }, 100);
  }

  function focusCycledPanel(direction: PanelCycleDirection): boolean {
    const panelIds = selectPanelIds.select(appStore.state, workspaceId);
    const focusedPanelId = selectFocusedPanelId.select(appStore.state, workspaceId);
    const localTargetId = resolveLocalPanelCycleTarget(panelIds, focusedPanelId, direction);
    if (localTargetId) {
      appStore.dispatch(markPanelTouched(effectiveLayoutId, localTargetId));
      layoutManager.focusPanel(localTargetId);
      dispatchFocusPanelContent(localTargetId);
      return true;
    }

    const boundaryTarget = onCyclePanelBoundary?.(direction);
    if (boundaryTarget) {
      const targetPanelIds = selectPanelIds.select(appStore.state, boundaryTarget.layoutId);
      const targetPanelId =
        direction === 'next' ? targetPanelIds[0] : targetPanelIds[targetPanelIds.length - 1];
      if (targetPanelId) {
        appStore.dispatch(markPanelTouched(boundaryTarget.layoutId, targetPanelId));
        const targetLayoutManager = getPanelLayoutManager(boundaryTarget.layoutId);
        targetLayoutManager.focusPanel(targetPanelId);
        dispatchFocusPanelContent(
          targetPanelId,
          targetLayoutManager,
          boundaryTarget.workspaceId,
          boundaryTarget.layoutId,
        );
        return true;
      }
    }

    const wrappedPanelId = direction === 'next' ? panelIds[0] : panelIds[panelIds.length - 1];
    if (!wrappedPanelId || (panelIds.length === 1 && wrappedPanelId === focusedPanelId))
      return false;
    appStore.dispatch(markPanelTouched(effectiveLayoutId, wrappedPanelId));
    layoutManager.focusPanel(wrappedPanelId);
    dispatchFocusPanelContent(wrappedPanelId);
    return true;
  }

  function focusAdjacentColumn(direction: PanelCycleDirection): boolean {
    const panelIds = selectPanelIds.select(appStore.state, workspaceId);
    const focusedPanelId = selectFocusedPanelId.select(appStore.state, workspaceId);
    const targetPanelId = resolveLocalPanelCycleTarget(panelIds, focusedPanelId, direction);
    if (!targetPanelId) return false;
    appStore.dispatch(markPanelTouched(effectiveLayoutId, targetPanelId));
    layoutManager.focusPanel(targetPanelId);
    dispatchFocusPanelContent(targetPanelId);
    return true;
  }

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

  // Keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && ownsDraggedPane()) {
      e.preventDefault();
      finishPaneDrag();
      return;
    }
    if (!active) return;
    // First, let the leader key system handle it
    if (keyboardShortcuts.handleKeyDown(e)) {
      return;
    }

    // On Mac, "Mod" is Cmd (metaKey) only — Ctrl is reserved for Emacs bindings and other uses.
    // On Win/Linux, "Mod" is Ctrl.
    const isMod = isMac ? e.metaKey : e.ctrlKey;

    // Note: Mod+/ for keyboard shortcuts cheat sheet is handled globally in +layout.svelte
    // Do NOT add a handler here or it will toggle twice (once per handler)

    // Mod+Shift+Enter - Toggle zoom on focused panel (alternative)
    if (isMod && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      keyboardShortcuts.executeAction('zoom-toggle');
      return;
    }
  }

  // Use capture phase for panel-specific shortcuts.
  $effect(() => {
    if (!active) return;
    window.addEventListener('keydown', handleKeyDown, true);

    // Listen for terminal creation events
    const handleTerminalCreated = (event: any) => {
      const { workspaceId: eventWorkspaceId } = event;
      if (eventWorkspaceId === workspaceId) {
        // Reload terminals to include the new one
        loadTerminals(workspaceId);
      }
    };

    // Listen for layout:configure-panels events from AI-generated layouts
    const handleConfigurePanels = async (event: Event) => {
      if (!active) return;
      const detail = (event as CustomEvent)?.detail;
      const panels = detail?.panels as Array<{
        tabs: Array<{
          type: string;
          agentId?: string;
          agentName?: string;
          noteId?: string;
          noteTitle?: string;
          filePath?: string;
          browserUrl?: string;
          createNew?: boolean;
          newAgentName?: string;
          title?: string;
        }>;
        activeTabIndex?: number;
      }>;

      if (!panels || !layoutManager) {
        logger.warn('Invalid configure-panels event', { detail });
        return;
      }

      const flatPanels = flattenPanels(panels);
      logger.info('Configuring panels from AI layout', {
        originalPanelCount: panels.length,
        flatPanelCount: flatPanels.length,
        flatPanels,
      });

      // Batch all changes into a single history entry
      await layoutManager.batchMutations(async () => {
        // Create the right number of panels using createGridLayout
        // This ensures we have exactly the number of panels needed
        const panelCount = Math.max(1, Math.min(flatPanels.length, 6)); // Cap at 6 panels
        const panelIds = layoutManager.createGridLayout(panelCount);
        logger.info('Created grid layout for AI panels', {
          panelIds,
          panelCount,
          flatPanelCount: flatPanels.length,
        });

        // Open tabs in each panel (createGridLayout already created fresh empty panels)
        for (
          let panelIndex = 0;
          panelIndex < flatPanels.length && panelIndex < panelIds.length;
          panelIndex++
        ) {
          const panelConfig = flatPanels[panelIndex];
          const panelId = panelIds[panelIndex];

          const tabs = panelConfig.tabs;
          logger.info('Processing panel tabs', {
            panelIndex,
            panelId,
            tabCount: tabs.length,
            tabs,
          });
          for (const tab of tabs) {
            await openTabFromConfig(tab, panelId, panelIndex, {
              layoutManager,
              workspaceId,
              logger,
            });
          }
        }
      });
    };

    document.addEventListener('layout:configure-panels', handleConfigurePanels);

    // Use listenSync for proper cleanup without race conditions
    const unsubTerminalCreated = listenSync('terminal:created', (event: any) => {
      handleTerminalCreated(event.payload || event);
    });

    // browser:focus-tab and browser:list-tabs-request are handled by the
    // window-level browser IPC saga (browser-ipc-saga.ts), which routes by the
    // payload's workspaceId so background workspaces answer too (monorepo#2756).

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('layout:configure-panels', handleConfigurePanels);
      unsubTerminalCreated();
    };
  });

  onDestroy(() => {
    panelMoveCommitVersion += 1;
    if (panelMoveCommitReleaseFrame !== null) cancelAnimationFrame(panelMoveCommitReleaseFrame);
    if (viewportOuterResizeClearFrame !== null) cancelAnimationFrame(viewportOuterResizeClearFrame);
    if (ownsDraggedPane()) finishPaneDrag();
    else clearPanelMovePreviewNow();
    if (reportedPanelMovePreviewWidthRatio !== 1) onPanelMovePreviewWidthRatioChange?.(1);
    browserFocusOwnership.destroy();
    keyboardShortcuts.cleanup();
  });
</script>

<svelte:window
  ondragend={() => active && handleWindowPaneDragEnd()}
  ondragleave={(event) => active && handleWindowPaneDragLeave(event)}
  ondrop={() => active && handleWindowPaneDrop()}
/>

{#snippet panelCanvas()}
  {#if shouldRenderPanelContainer && (!hideEmptyLayout || $allTabs$.length > 0)}
    <div
      bind:this={panelLayoutMotionElement}
      class="relative h-full w-full min-w-0"
      data-panel-layout-motion
      ondragovercapture={handlePaneInsertionDragOver}
      ondropcapture={handlePaneInsertionDrop}
      ondragleave={handlePaneInsertionDragLeave}
      transition:resize={{ axis: 'x', duration: layoutMotionDuration }}
    >
      <div class:opacity-0={panelMovePreviewRoot !== null} class="h-full w-full min-w-0">
        <PanelContainer
          node={viewportOuterResizeRoot}
          panels={$panels$}
          panelOrder={$panelIds$}
          focusedPanelId={active ? $focusedPanelId$ : null}
          zoomedPanelId={keyboardShortcuts.zoomedPanelId}
          dominantPanelId={$expandedPanelId$}
          {workspaceId}
          layoutId={effectiveLayoutId}
          {active}
          {contained}
          suppressLayoutMotion={suppressCommittedPanelMoveMotion}
          {retainedRootPanelWidth}
          rootPanelReferenceSize={panelGeometryCanvasWidth > 0 ? panelGeometryCanvasWidth : null}
          rootHorizontalPanelWidths={viewportOuterResizeWidths}
          rootCanvasResizeDelta={canvasSizing === 'viewport'
            ? 0
            : panelOuterResizeDelta + panelOuterResizeCommittedDelta}
          availableCanvasWidth={panelViewportWidth}
          onFocusPanel={handleFocusPanel}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
          onTabReorder={handleTabReorder}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseTabsToRight={handleCloseTabsToRight}
          onCloseAllTabs={handleCloseAllTabs}
          onCloseAllOthersEverywhere={handleCloseAllOthersEverywhere}
          onSplitPanel={handleSplitPanel}
          onClosePanel={handleClosePanel}
          onZoomToggle={handleZoomToggle}
          onUpdateSizes={handleUpdateSizes}
          onRootReferenceSizeChange={(width) => (panelRootReferenceSize = width)}
          onResizeRootDivider={handleResizeRootDivider}
          onTabDropToSplit={handleTabDropToSplit}
          onTabMoveToPanel={handleTabMoveToPanel}
          onPaneDropPreview={handlePaneDropPreview}
          onPaneDragFinish={finishPaneDrag}
          onMoveActivePane={handleMoveActivePane}
          onPanelMove={handlePanelMove}
          onTabDropToSplitHandle={handleTabDropToSplitHandle}
          onTabRename={handleTabRename}
          {onCreateAgent}
          {onCreateAgentWithSpecialist}
          {onCreateNote}
          onCreateTerminal={handleCreateTerminal}
          onOpenBrowser={canOpenBrowserPanel ? handleOpenBrowser : undefined}
        />
      </div>
      {#if visiblePanelMovePreview}
        <div
          bind:this={panelDragPreviewElement}
          class={cn(
            'pointer-events-none absolute inset-y-0 left-0 z-40 box-content',
            contained ? 'px-2' : 'pr-2 sm:pr-3',
          )}
          style:width={`${
            (contained && !onPanelMovePreviewWidthRatioChange ? panelMovePreviewWidthRatio : 1) *
            100
          }%`}
          data-panel-layout-drag-preview={paneDropPreview?.placement.kind === 'panel'
            ? paneDropPreview.placement.zone
            : paneDropPreview?.placement.position}
          data-panel-layout-edge-preview={paneDropPreview?.placement.kind === 'edge'
            ? paneDropPreview.placement.position
            : undefined}
          aria-hidden="true"
        >
          <PanelDragPreview
            node={visiblePanelMovePreview.root}
            panels={visiblePanelMovePreview.panels}
            draggedPanelId={paneDropPreviewPanelId}
            draggedPanelSourceId={paneDropPreviewPanelId === PANE_DROP_PREVIEW_PANEL_ID
              ? paneDropPreview?.draggedPane.panelId
              : null}
            {contained}
          />
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

<div
  class="panel-layout h-full w-full flex flex-col bg-sidebar"
  aria-label={m.layout_panelLayout_ariaLabel()}
>
  <div class="flex min-h-0 flex-1">
    <!-- Main panel area -->
    <div
      bind:this={panelWorkspaceInset}
      use:measurePanelViewportWidth={active}
      class={cn(
        'min-h-0 min-w-0 flex-1 overflow-y-hidden scrollbar-none bg-sidebar',
        contained ? 'overflow-hidden py-2 px-2' : 'overflow-x-auto py-2 pr-2 sm:py-3 sm:pr-3',
      )}
      data-testid="panel-workspace-inset"
      use:scrollFade={{ axis: 'x', fadeSize: contained ? 0 : 24, enabled: active }}
    >
      <!-- The flex track makes the fixed-width canvas participate in max-content
           sizing, which keeps the container's right padding in the scroll range. -->
      <div class={contained ? 'h-full w-full min-w-0' : 'flex h-full w-max min-w-full'}>
        {#key effectiveLayoutId}
          <PanelCanvasFrame
            {active}
            sizing={canvasSizing}
            viewportWidth={panelViewportWidth}
            panelColumnWidths={panelColumnPreferredWidths}
            resetPanelColumnWidths={$panelColumnDefaultWidths$}
            canvasWidth={effectivePanelCanvasWidth}
            canvasWidthSource={effectivePanelCanvasWidthSource}
            scrollContainer={panelWorkspaceInset}
            onWidthChange={handlePanelCanvasWidthChange}
            onResizeStart={handlePanelCanvasResizeStart}
            onResizePreview={handlePanelOuterResizePreview}
            onResizeEnd={handlePanelCanvasResizeEnd}
            onResizeCancel={handlePanelCanvasResizeCancel}
          >
            {@render panelCanvas()}
          </PanelCanvasFrame>
        {/key}
      </div>
    </div>
  </div>
</div>
<!-- Leader key indicator -->
{#if active && keyboardShortcuts.leaderActive}
  <div
    class="fixed bottom-20 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-lg shadow-lg px-4 py-2 z-50"
    transition:fade={{ duration: 100 }}
  >
    <div class="text-sm font-medium text-foreground">
      {#if keyboardShortcuts.showPanelNumbers}
        <span class="text-primary">{m.layout_panelLayout_pressKeys_before()}</span>
        {m.layout_panelLayout_jumpToPanel_after()}
      {:else}
        <span class="text-primary">⌘K</span>
        {m.layout_panelLayout_leaderActivated_label()}
        <span class="text-subtle ml-2"> {m.layout_panelLayout_leaderHints_label()} </span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .panel-layout {
    display: flex;
    flex-direction: column;
  }
</style>
