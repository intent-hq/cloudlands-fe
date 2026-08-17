<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { goto } from '$app/navigation';
  import WorkspaceSurface from '../../../routes/(app)/workspace/[id]/WorkspaceSurface.svelte';
  import { getWorkspaceViewTransitionName } from './workspace-view-transition';
  import ResizablePanelGroup from '$lib/components/layout/ResizablePanelGroup.svelte';
  import PanelNavigator from '$lib/components/layout/panel-system/PanelNavigator.svelte';
  import { resize } from '$lib/components/layout/size-transition';
  import { store as appStore } from '$store/renderer/store';
  import {
    closeWorkspaceTab,
    endDrag,
    moveWorkspace,
    openWorkspaceTab,
    startDrag,
  } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    selectCurrentWorkspaceTabId,
    selectWorkspaceStacks,
  } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import {
    selectFocusedPanelTargetsByWorkspaceId,
    selectPanelCanvasWidthsByWorkspaceId,
    selectPanelColumnCountsByWorkspaceId,
    selectPanelRestoreStatusesByWorkspaceId,
    selectPanelNavigatorItemsByWorkspaceId,
    selectPanelRevealRequestsByWorkspaceId,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    consumePanelReveal,
    panelLayoutScopeMounted,
    focusPanel,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    findAdjacentWorkspaceWithPanels,
    type PanelCycleBoundaryTarget,
    type PanelCycleDirection,
  } from '$features/layout/panel-cycle-navigation';
  import { findAdjacentWorkspaceColumnId } from '$features/workspace/utils/workspace-tab-navigation';
  import { resolveEmptyWindowDestination } from '$features/workspace/utils/empty-window-destination';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    getWorkspaceDragPlacement,
    isWorkspaceStackPlacement,
    type WorkspaceDragPlacement,
  } from './utils/workspace-drag-placement';
  import {
    findWorkspaceColumn,
    findWorkspacePanel,
    scrollWorkspaceColumnIntoView,
    scrollWorkspacePanelIntoView,
  } from './utils/workspace-column-scroll';
  import {
    createColumnVisibilityTracker,
    type ColumnVisibilityTracker,
    type TrackedColumnElement,
  } from './utils/column-visibility';
  import WorkspaceColumnPlaceholder from './WorkspaceColumnPlaceholder.svelte';
  import { createLayoutStableRevealScheduler } from './utils/layout-stable-reveal';
  import { isFocusInEditableElement } from '$lib/utils/keyboardShortcuts';
  import AllWorkspacesCard from '$lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte';
  import { CONTAINED_PANEL_INLINE_CHROME } from '$shared/panel-layout-sizing';
  import { m } from '$shared/paraglide/messages.js';
  import {
    COLUMN_SIDEBAR_MAX_WIDTH,
    requestResizablePanelSize,
  } from '$store/renderer/slices/ui-layout/ui-layout-slice';
  import {
    selectHydratedResizablePanelSizes,
    selectResizablePanelSizes,
  } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
    observeWorkspaceColumnsOverlap,
    type WorkspaceColumnsOverlapObserver,
  } from './workspace-columns-overlap';

  interface Props {
    onHorizontalOverlapChange?: (overlap: boolean) => void;
  }

  let { onHorizontalOverlapChange = () => {} }: Props = $props();

  const currentWorkspaceId$ = selectCurrentWorkspaceTabId();
  const workspaceStacks$ = selectWorkspaceStacks();
  const panelCanvasWidthsByWorkspaceId$ = selectPanelCanvasWidthsByWorkspaceId();
  const panelColumnCountsByWorkspaceId$ = selectPanelColumnCountsByWorkspaceId();
  const focusedPanelTargetsByWorkspaceId$ = selectFocusedPanelTargetsByWorkspaceId();
  const panelNavigatorItemsByWorkspaceId$ = selectPanelNavigatorItemsByWorkspaceId();
  const resizablePanelSizes$ = selectResizablePanelSizes();
  const hydratedResizablePanelSizes$ = selectHydratedResizablePanelSizes();
  const panelRevealRequestsByWorkspaceId$ = selectPanelRevealRequestsByWorkspaceId();
  const panelRestoreStatusesByWorkspaceId$ = selectPanelRestoreStatusesByWorkspaceId();
  const LAYOUT_WIDTH_SETTLE_MS = 340;
  // Interim stack width while sidebar widths / panel layouts hydrate: columns
  // render immediately at the default sidebar width instead of flashing an
  // empty scroller, then settle to their measured widths.
  const FALLBACK_STACK_WIDTH = 360;
  let sidebarWidths = $state<Record<string, number>>({});
  let livePanelCanvasWidths = $state<Record<string, number>>({});
  let columnsScroller = $state.raw<HTMLDivElement | null>(null);
  let navigatorPanelRoot = $state.raw<HTMLElement | null>(null);
  let overlapObserver: WorkspaceColumnsOverlapObserver | null = null;
  let panelPreviewWidthRatios = $state<Record<string, number>>({});
  let draggedWorkspaceId = $state<string | null>(null);
  let dragOverWorkspaceId = $state<string | null>(null);
  let dragOverPlacement = $state<WorkspaceDragPlacement | null>(null);
  let lifecycleMotionReady = $state(false);
  let lastScrolledWorkspaceId: string | null = null;
  let hasRevealedInitialWorkspace = false;
  let previousPanelColumnCounts: Record<string, number> = {};
  let panelColumnCountsInitialized = false;
  let anchoredWorkspaceId = $state<string | null>(null);
  let anchorBaselinePending = false;
  let anchorSettleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAnchorScrollLeft = 0;
  const layoutRevealScheduler = createLayoutStableRevealScheduler();
  const pendingPanelRevealScheduler = createLayoutStableRevealScheduler();
  let visibleWorkspaceIds = $state<ReadonlySet<string>>(new Set());
  let columnVisibilityTracker = $state.raw<ColumnVisibilityTracker | null>(null);
  const UNMOUNT_HYSTERESIS_MS = 300;
  let recentlyVisibleWorkspaceIds = $state<ReadonlySet<string>>(new Set());
  const unmountHysteresisTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let previouslyVisibleWorkspaceIds: ReadonlySet<string> = new Set();
  let materializingWorkspaceId = $state<string | null>(null);
  const requestedSidebarWidthKeys = new Set<string>();
  const requestedLayoutRestoreIds = new Set<string>();
  const openWorkspaceIds = $derived($workspaceStacks$.flat());
  const sidebarWidthsReady = $derived(
    openWorkspaceIds.every(
      (workspaceId) =>
        $hydratedResizablePanelSizes$[`workspace-left-panel-width:${workspaceId}`] === true &&
        $hydratedResizablePanelSizes$[`workspace-left-panel-expanded-width:${workspaceId}`] ===
          true,
    ),
  );
  const panelLayoutsSettled = $derived(
    openWorkspaceIds.every((workspaceId) => {
      const status = $panelRestoreStatusesByWorkspaceId$[workspaceId];
      return status === 'restored' || status === 'empty' || status === 'invalid';
    }),
  );
  const columnsReady = $derived(sidebarWidthsReady && panelLayoutsSettled);
  // Layout motion stays disabled through the post-jump width-settle window
  // (anchoredWorkspaceId non-null), not merely until one rAF after mount:
  // late width reports from lazily mounted surfaces must snap, not animate.
  const layoutMotionDuration = $derived(
    lifecycleMotionReady && columnsReady && anchoredWorkspaceId === null ? 180 : 0,
  );
  const visibleWorkspaceIdsAttribute = $derived([...visibleWorkspaceIds].sort().join(','));
  const mountedWorkspaceIds = $derived.by(() => {
    const mounted = new Set(visibleWorkspaceIds);
    for (const workspaceId of recentlyVisibleWorkspaceIds) mounted.add(workspaceId);
    const currentWorkspaceId = $currentWorkspaceId$;
    if (currentWorkspaceId) mounted.add(currentWorkspaceId);
    if (materializingWorkspaceId) mounted.add(materializingWorkspaceId);
    if (draggedWorkspaceId) mounted.add(draggedWorkspaceId);
    if (dragOverWorkspaceId) mounted.add(dragOverWorkspaceId);
    return mounted;
  });
  const currentPanelNavigatorItems = $derived(
    ($panelNavigatorItemsByWorkspaceId$[$currentWorkspaceId$ ?? ''] ?? []).map((panel) => ({
      ...panel,
      title: panel.title || m.layout_panelEmptyState_newPanel_label(),
    })),
  );

  $effect(() => {
    const workspaceId = $currentWorkspaceId$;
    const scroller = columnsScroller;
    void currentPanelNavigatorItems;
    if (!workspaceId || !scroller) {
      navigatorPanelRoot = null;
      return;
    }
    void tick().then(() => {
      if (columnsScroller !== scroller || $currentWorkspaceId$ !== workspaceId) return;
      navigatorPanelRoot = findWorkspaceColumn(scroller, workspaceId);
    });
  });

  $effect(() => {
    for (const workspaceId of openWorkspaceIds) {
      for (const key of [
        `workspace-left-panel-width:${workspaceId}`,
        `workspace-left-panel-expanded-width:${workspaceId}`,
      ]) {
        if ($hydratedResizablePanelSizes$[key] !== true && !requestedSidebarWidthKeys.has(key)) {
          requestedSidebarWidthKeys.add(key);
          appStore.dispatch(requestResizablePanelSize(key));
        }
      }
    }
  });

  // Pre-restore persisted panel layouts for every open workspace: placeholder
  // columns never mount a PanelLayout scope, so without this their panel
  // widths only hydrate once scrolled into view — shifting column offsets
  // after the initial jump. Restoring up front makes stack widths final
  // before the reveal effect measures them.
  $effect(() => {
    const statuses = $panelRestoreStatusesByWorkspaceId$;
    for (const workspaceId of openWorkspaceIds) {
      if (requestedLayoutRestoreIds.has(workspaceId)) continue;
      if ((statuses[workspaceId] ?? 'idle') !== 'idle') continue;
      requestedLayoutRestoreIds.add(workspaceId);
      appStore.dispatch(panelLayoutScopeMounted(workspaceId));
    }
  });

  onMount(() => {
    const scroller = columnsScroller;
    if (!scroller) return;
    overlapObserver = observeWorkspaceColumnsOverlap(scroller, onHorizontalOverlapChange);
    return () => {
      overlapObserver?.destroy();
      overlapObserver = null;
    };
  });

  $effect(() => {
    void $workspaceStacks$;
    if (!columnsScroller) return;
    void tick().then(() => overlapObserver?.measure());
  });

  $effect(() => {
    const requests = $panelRevealRequestsByWorkspaceId$;
    const scroller = columnsScroller;
    const entries = Object.entries(requests);
    if (!scroller || entries.length === 0) {
      pendingPanelRevealScheduler.cancel();
      if (entries.length === 0) materializingWorkspaceId = null;
      return;
    }
    const [workspaceId, request] =
      entries.find(([candidateId]) => candidateId === $currentWorkspaceId$) ?? entries.at(-1)!;
    materializingWorkspaceId = workspaceId;
    void tick().then(() => {
      const isCurrent = () =>
        columnsScroller === scroller &&
        $panelRevealRequestsByWorkspaceId$[workspaceId]?.requestId === request.requestId;
      if (!isCurrent()) return;
      scheduleRevealAfterLayout(
        () => findWorkspacePanel(scroller, workspaceId, request.panelId),
        (behavior) => {
          if (!isCurrent()) return;
          scrollWorkspacePanelIntoView(scroller, workspaceId, request.panelId, behavior);
          appStore.dispatch(consumePanelReveal(workspaceId, request.requestId));
          if (materializingWorkspaceId === workspaceId) materializingWorkspaceId = null;
        },
        undefined,
        isCurrent,
        () => {
          if (!isCurrent()) return;
          appStore.dispatch(consumePanelReveal(workspaceId, request.requestId));
          if (materializingWorkspaceId === workspaceId) materializingWorkspaceId = null;
        },
        pendingPanelRevealScheduler,
      );
    });
  });

  onMount(() => {
    const frame = requestAnimationFrame(() => {
      lifecycleMotionReady = true;
    });
    return () => cancelAnimationFrame(frame);
  });

  onMount(() => {
    const handleWorkspaceColumnShortcut = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        !event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight')
      ) {
        return;
      }

      const target = event.target;
      const targetElement =
        target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      if (
        (targetElement && isFocusInEditableElement(targetElement)) ||
        isFocusInEditableElement()
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      const currentWorkspaceId = $currentWorkspaceId$;
      if (!currentWorkspaceId) return;
      const targetWorkspaceId = findAdjacentWorkspaceColumnId(
        $workspaceStacks$,
        currentWorkspaceId,
        event.code === 'ArrowRight' ? 'next' : 'previous',
      );
      if (targetWorkspaceId) {
        activateWorkspace(targetWorkspaceId);
        scheduleWorkspaceReveal(targetWorkspaceId, 'start', 'smooth');
      }
    };

    window.addEventListener('keydown', handleWorkspaceColumnShortcut, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleWorkspaceColumnShortcut, { capture: true });
  });

  function cancelScrollAnchor() {
    if (anchorSettleTimer !== null) clearTimeout(anchorSettleTimer);
    anchorSettleTimer = null;
    anchorBaselinePending = false;
    if (anchoredWorkspaceId !== null) anchoredWorkspaceId = null;
  }

  function armAnchorSettleTimer() {
    if (anchorSettleTimer !== null) clearTimeout(anchorSettleTimer);
    anchorSettleTimer = setTimeout(() => {
      anchorSettleTimer = null;
      anchoredWorkspaceId = null;
    }, LAYOUT_WIDTH_SETTLE_MS);
  }

  function handleScrollerScroll() {
    const scroller = columnsScroller;
    if (anchoredWorkspaceId === null || !scroller) return;
    // A scroll position we did not set means the user scrolled: stop
    // re-anchoring immediately — never fight the user.
    if (Math.abs(scroller.scrollLeft - lastAnchorScrollLeft) > 1) cancelScrollAnchor();
  }

  function handleScrollerWheel() {
    // Wheel input is definitive user intent. The scroll-position heuristic
    // above can miss it: scroll events are coalesced per frame, so when a
    // late width report re-anchors in the same frame as a wheel scroll the
    // single scroll event reports the anchor position again and the anchor
    // survives — snapping the view back and eating the user's scroll. Cancel
    // on the input event itself, which no re-anchor can overwrite.
    if (anchoredWorkspaceId === null) return;
    cancelScrollAnchor();
  }

  function handleColumnsScroll() {
    handleScrollerScroll();
    overlapObserver?.measure();
  }

  function scheduleRevealAfterLayout(
    resolveTarget: () => HTMLElement | null,
    reveal: (behavior: ScrollBehavior) => void,
    behaviorOverride?: ScrollBehavior,
    isCurrent: () => boolean = () => true,
    onTargetRemoved?: () => void,
    scheduler: ReturnType<typeof createLayoutStableRevealScheduler> = layoutRevealScheduler,
  ) {
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = prefersReducedMotion
      ? 'auto'
      : (behaviorOverride ?? (lifecycleMotionReady ? 'smooth' : 'auto'));
    scheduler.schedule({
      resolveElements: () => {
        const container = columnsScroller;
        const target = resolveTarget();
        return container && target ? { container, target } : null;
      },
      isCurrent,
      reveal: () => reveal(behavior),
      onTargetRemoved,
    });
  }

  function scheduleWorkspaceReveal(
    workspaceId: string,
    inline: ScrollLogicalPosition = 'nearest',
    behavior?: ScrollBehavior,
  ) {
    const scroller = columnsScroller;
    if (!scroller) return;

    cancelScrollAnchor();
    lastScrolledWorkspaceId = workspaceId;
    void tick().then(() => {
      if (columnsScroller !== scroller || lastScrolledWorkspaceId !== workspaceId) return;
      scheduleRevealAfterLayout(
        () => findWorkspaceColumn(scroller, workspaceId),
        (resolvedBehavior) => {
          if (columnsScroller !== scroller || lastScrolledWorkspaceId !== workspaceId) return;
          scrollWorkspaceColumnIntoView(scroller, workspaceId, resolvedBehavior, inline);
        },
        behavior,
        () => columnsScroller === scroller && lastScrolledWorkspaceId === workspaceId,
      );
    });
  }

  $effect(() => {
    const workspaceId = $currentWorkspaceId$;
    const scroller = columnsScroller;
    const ready = columnsReady;
    if (!workspaceId || !scroller || !ready || workspaceId === lastScrolledWorkspaceId) return;

    if (!hasRevealedInitialWorkspace) {
      // The first reveal per mount jumps instantly — a smooth sweep would drag
      // every intermediate column through the observer window, mounting a full
      // surface for each just to scroll past it. Jumping synchronously here
      // (this effect runs before the visibility-tracker effects below) also
      // makes the layout seed read the post-jump scroll position, so the
      // landing window mounts immediately without a placeholder flash.
      // `inline: 'start'` (not 'nearest') so a partially visible target is
      // still aligned instead of silently skipped.
      hasRevealedInitialWorkspace = true;
      lastScrolledWorkspaceId = workspaceId;
      scrollWorkspaceColumnIntoView(scroller, workspaceId, 'auto', 'start');
      // The jump is anchored to pre-settle widths: surfaces that lazily mount
      // after it report live widths that shift the target while scrollLeft
      // stays frozen. Keep the target anchored (re-align on width changes)
      // until widths have been stable for the settle window or the user
      // scrolls, whichever comes first.
      lastAnchorScrollLeft = scroller.scrollLeft;
      anchorBaselinePending = true;
      anchoredWorkspaceId = workspaceId;
      armAnchorSettleTimer();
      return;
    }

    scheduleWorkspaceReveal(workspaceId);
  });

  // Re-anchor the initial-jump target whenever width-affecting state changes
  // while the anchor is live. Reads every input of stackWidth so any late
  // width report (live canvas widths, preview ratios, persisted widths,
  // sidebar echoes, panel counts) re-runs the left-edge alignment after the
  // DOM has laid out, and pushes the settle window out.
  $effect(() => {
    const workspaceId = anchoredWorkspaceId;
    const scroller = columnsScroller;
    void livePanelCanvasWidths;
    void panelPreviewWidthRatios;
    void sidebarWidths;
    void $panelCanvasWidthsByWorkspaceId$;
    void $panelColumnCountsByWorkspaceId$;
    void $resizablePanelSizes$;
    if (!workspaceId || !scroller) return;
    if (anchorBaselinePending) {
      // First run after the jump only registers dependencies — the jump
      // itself already aligned the target.
      anchorBaselinePending = false;
      return;
    }
    void tick().then(() => {
      if (anchoredWorkspaceId !== workspaceId || columnsScroller !== scroller) return;
      scrollWorkspaceColumnIntoView(scroller, workspaceId, 'auto', 'start');
      lastAnchorScrollLeft = scroller.scrollLeft;
      armAnchorSettleTimer();
    });
  });

  $effect(() => {
    const counts = $panelColumnCountsByWorkspaceId$;
    const workspaceId = $currentWorkspaceId$;
    const previousCount = workspaceId ? (previousPanelColumnCounts[workspaceId] ?? 0) : 0;
    const nextCount = workspaceId ? (counts[workspaceId] ?? 0) : 0;
    previousPanelColumnCounts = { ...counts };

    if (!panelColumnCountsInitialized) {
      panelColumnCountsInitialized = true;
      return;
    }
    if (!workspaceId || nextCount <= previousCount) return;

    const panelId = $focusedPanelTargetsByWorkspaceId$[workspaceId]?.panelId;
    const scroller = columnsScroller;
    if (!panelId || !scroller) return;

    void tick().then(() => {
      if (
        columnsScroller !== scroller ||
        $currentWorkspaceId$ !== workspaceId ||
        ($panelColumnCountsByWorkspaceId$[workspaceId] ?? 0) < nextCount
      ) {
        return;
      }
      scheduleRevealAfterLayout(
        () => findWorkspacePanel(scroller, workspaceId, panelId),
        (behavior) => {
          if (columnsScroller !== scroller || $currentWorkspaceId$ !== workspaceId) return;
          scrollWorkspacePanelIntoView(scroller, workspaceId, panelId, behavior);
        },
      );
    });
  });

  $effect(() => {
    const scroller = columnsScroller;
    if (!scroller) return;
    const tracker = createColumnVisibilityTracker(scroller, (visible) => {
      visibleWorkspaceIds = visible;
    });
    columnVisibilityTracker = tracker;
    return () => {
      if (columnVisibilityTracker === tracker) columnVisibilityTracker = null;
      tracker.destroy();
    };
  });

  $effect(() => {
    const stacks = $workspaceStacks$;
    const scroller = columnsScroller;
    const tracker = columnVisibilityTracker;
    const ready = columnsReady;
    if (!scroller || !tracker || !ready) return;

    const openIds = new Set(stacks.flat());
    const tracked: TrackedColumnElement[] = [];
    for (const element of scroller.querySelectorAll('[data-workspace-stack]')) {
      const workspaceIds = (element.getAttribute('data-workspace-stack') ?? '')
        .split(',')
        .filter((workspaceId) => openIds.has(workspaceId));
      if (workspaceIds.length > 0) tracked.push({ element, workspaceIds });
    }
    tracker.setElements(tracked);
  });

  // Unmount hysteresis: a column that leaves the visibility window stays
  // mounted for a short delay so straddling the overscan edge during scroll
  // does not thrash mount/unmount. Re-entering the window cancels the timer.
  $effect(() => {
    const visible = visibleWorkspaceIds;
    const departed = [...previouslyVisibleWorkspaceIds].filter(
      (workspaceId) => !visible.has(workspaceId),
    );
    previouslyVisibleWorkspaceIds = visible;

    for (const workspaceId of visible) {
      const timer = unmountHysteresisTimers.get(workspaceId);
      if (timer === undefined) continue;
      clearTimeout(timer);
      unmountHysteresisTimers.delete(workspaceId);
    }

    untrack(() => {
      const retained = new Set(recentlyVisibleWorkspaceIds);
      let changed = false;
      for (const workspaceId of retained) {
        if (!visible.has(workspaceId)) continue;
        retained.delete(workspaceId);
        changed = true;
      }
      for (const workspaceId of departed) {
        retained.add(workspaceId);
        changed = true;
        unmountHysteresisTimers.set(
          workspaceId,
          setTimeout(() => {
            unmountHysteresisTimers.delete(workspaceId);
            const next = new Set(recentlyVisibleWorkspaceIds);
            next.delete(workspaceId);
            recentlyVisibleWorkspaceIds = next;
          }, UNMOUNT_HYSTERESIS_MS),
        );
      }
      if (changed) recentlyVisibleWorkspaceIds = retained;
    });
  });

  onDestroy(() => {
    cancelScrollAnchor();
    for (const timer of unmountHysteresisTimers.values()) clearTimeout(timer);
    unmountHysteresisTimers.clear();
    layoutRevealScheduler.cancel();
    pendingPanelRevealScheduler.cancel();
  });

  function updateSidebarWidth(workspaceId: string, width: number) {
    const clampedWidth = Math.max(280, Math.min(COLUMN_SIDEBAR_MAX_WIDTH, width));
    if (sidebarWidths[workspaceId] === clampedWidth) return;
    sidebarWidths = { ...sidebarWidths, [workspaceId]: clampedWidth };
  }

  function getSidebarWidth(workspaceId: string) {
    const storedWidth = $resizablePanelSizes$[`workspace-left-panel-width:${workspaceId}`] ?? 360;
    return Math.max(
      280,
      Math.min(COLUMN_SIDEBAR_MAX_WIDTH, sidebarWidths[workspaceId] ?? storedWidth),
    );
  }

  function updatePanelPreviewWidthRatio(workspaceId: string, ratio: number) {
    if ((panelPreviewWidthRatios[workspaceId] ?? 1) === ratio) return;
    if (ratio === 1) {
      const nextRatios = { ...panelPreviewWidthRatios };
      delete nextRatios[workspaceId];
      panelPreviewWidthRatios = nextRatios;
      return;
    }
    panelPreviewWidthRatios = { ...panelPreviewWidthRatios, [workspaceId]: ratio };
  }

  function updatePanelCanvasWidth(workspaceId: string, width: number) {
    if (livePanelCanvasWidths[workspaceId] === width) return;
    livePanelCanvasWidths = { ...livePanelCanvasWidths, [workspaceId]: width };
  }

  function activateWorkspace(workspaceId: string) {
    if ($currentWorkspaceId$ === workspaceId) return;
    materializingWorkspaceId = workspaceId;
    appStore.dispatch(openWorkspaceTab(workspaceId));
    void goto(`/workspace/${workspaceId}`);
  }

  function activatePanelFromNavigator(panelId: string) {
    const workspaceId = $currentWorkspaceId$;
    if (!workspaceId) return;
    appStore.dispatch(focusPanel(workspaceId, panelId));
  }

  function handlePanelCycleBoundary(
    workspaceId: string,
    direction: PanelCycleDirection,
  ): PanelCycleBoundaryTarget | null {
    const targetWorkspaceId = findAdjacentWorkspaceWithPanels(
      $workspaceStacks$,
      workspaceId,
      direction,
      (candidateId) => ($panelColumnCountsByWorkspaceId$[candidateId] ?? 0) > 0,
    );
    if (!targetWorkspaceId) return null;

    activateWorkspace(targetWorkspaceId);
    return {
      workspaceId: targetWorkspaceId,
      layoutId: targetWorkspaceId,
    };
  }

  function handleWorkspacePointerDown(event: PointerEvent, workspaceId: string) {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-workspace-close]')) return;
    activateWorkspace(workspaceId);
  }

  function closeWorkspace(workspaceId: string, event: MouseEvent) {
    event.stopPropagation();
    const wasCurrent = $currentWorkspaceId$ === workspaceId;
    appStore.dispatch(closeWorkspaceTab(workspaceId));
    if (!wasCurrent) return;

    const nextWorkspaceId = selectCurrentWorkspaceTabId.select(appStore.state);
    void goto(
      nextWorkspaceId
        ? `/workspace/${nextWorkspaceId}`
        : resolveEmptyWindowDestination(selectWorkspaceItems.select(appStore.state)),
    );
  }

  function handleColumnDragStart(event: DragEvent, workspaceId: string) {
    const target = event.target;
    const titleRegion =
      target instanceof Element ? target.closest('[data-workspace-title-region]') : null;
    if (!(titleRegion instanceof HTMLElement)) return;

    draggedWorkspaceId = workspaceId;
    event.dataTransfer?.setData('text/plain', workspaceId);
    if (event.dataTransfer) {
      const rect = titleRegion.getBoundingClientRect();
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setDragImage(
        titleRegion,
        Math.max(0, event.clientX - rect.left),
        Math.max(0, event.clientY - rect.top),
      );
    }
    appStore.dispatch(startDrag());
  }

  function handleColumnDragOver(event: DragEvent, workspaceId: string) {
    if (!draggedWorkspaceId || draggedWorkspaceId === workspaceId) return;
    event.preventDefault();
    const placement = getWorkspaceDragPlacement(
      event.clientX,
      event.clientY,
      (event.currentTarget as HTMLElement).getBoundingClientRect(),
    );
    dragOverWorkspaceId = workspaceId;
    dragOverPlacement = placement;
    if (!isWorkspaceStackPlacement(placement)) {
      appStore.dispatch(moveWorkspace(draggedWorkspaceId, workspaceId, placement));
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleColumnDragLeave(event: DragEvent, workspaceId: string) {
    const nextTarget = event.relatedTarget;
    const currentTarget = event.currentTarget as HTMLElement;
    if (nextTarget instanceof Node && currentTarget.contains(nextTarget)) return;
    if (dragOverWorkspaceId === workspaceId) {
      dragOverWorkspaceId = null;
      dragOverPlacement = null;
    }
  }

  function handleColumnDrop(event: DragEvent, workspaceId: string) {
    event.preventDefault();
    const sourceId = draggedWorkspaceId ?? event.dataTransfer?.getData('text/plain');
    if (sourceId && sourceId !== workspaceId && dragOverPlacement) {
      appStore.dispatch(moveWorkspace(sourceId, workspaceId, dragOverPlacement));
    }
    handleColumnDragEnd();
  }

  function handleColumnDragEnd() {
    draggedWorkspaceId = null;
    dragOverWorkspaceId = null;
    dragOverPlacement = null;
    appStore.dispatch(endDrag());
  }
</script>

{#snippet workspaceColumn(workspaceId: string)}
  <section
    class="relative h-full min-h-0 w-full overflow-hidden rounded-xl border border-border bg-sidebar shadow-sm transition-[opacity,transform,box-shadow] duration-(--motion-fast) {draggedWorkspaceId ===
    workspaceId
      ? 'scale-[0.99] opacity-50 shadow-none'
      : ''}"
    style:view-transition-name={getWorkspaceViewTransitionName(workspaceId)}
    aria-label={m.workspace_columns_workspaceColumn_ariaLabel({ workspaceId })}
    data-workspace-column={workspaceId}
    data-active={$currentWorkspaceId$ === workspaceId}
    data-dragging={draggedWorkspaceId === workspaceId}
    data-workspace-drop-placement={dragOverWorkspaceId === workspaceId
      ? dragOverPlacement
      : undefined}
    onpointerdowncapture={(event) => handleWorkspacePointerDown(event, workspaceId)}
    ondragstart={(event) => handleColumnDragStart(event, workspaceId)}
    ondragover={(event) => handleColumnDragOver(event, workspaceId)}
    ondragleave={(event) => handleColumnDragLeave(event, workspaceId)}
    ondrop={(event) => handleColumnDrop(event, workspaceId)}
    ondragend={handleColumnDragEnd}
  >
    {#if dragOverWorkspaceId === workspaceId && isWorkspaceStackPlacement(dragOverPlacement)}
      <div
        class="pointer-events-none absolute inset-x-[18%] z-50 h-[38%] rounded-md bg-ring/15 ring-1 ring-inset ring-ring/60 shadow-(--elevation-raised) transition-[top,bottom] duration-(--motion-fast) {dragOverPlacement ===
        'above'
          ? 'top-2'
          : 'bottom-2'}"
        aria-hidden="true"
        data-workspace-stack-preview={dragOverPlacement}
      ></div>
    {/if}
    {#if mountedWorkspaceIds.has(workspaceId)}
      <WorkspaceSurface
        {workspaceId}
        active={$currentWorkspaceId$ === workspaceId}
        manageTab={false}
        columnMode={true}
        retainWorkspaceSessionOnUnmount={true}
        onCloseWorkspace={(event) => closeWorkspace(workspaceId, event)}
        onSidebarWidthChange={(width) => updateSidebarWidth(workspaceId, width)}
        onPanelMovePreviewWidthRatioChange={(ratio) =>
          updatePanelPreviewWidthRatio(workspaceId, ratio)}
        onPanelCanvasWidthChange={(width) => updatePanelCanvasWidth(workspaceId, width)}
        onCyclePanelBoundary={(direction) => handlePanelCycleBoundary(workspaceId, direction)}
      />
    {:else}
      <WorkspaceColumnPlaceholder
        {workspaceId}
        onCloseWorkspace={(event) => closeWorkspace(workspaceId, event)}
      />
    {/if}
  </section>
{/snippet}

{#snippet workspaceStackItem(workspaceId: string, index: number, stackLength: number)}
  <div
    class="h-full min-h-0 {index > 0 ? 'pt-1' : ''} {index < stackLength - 1 ? 'pb-1' : ''}"
    data-workspace-column-motion={workspaceId}
    data-compact-workspace-column={($panelColumnCountsByWorkspaceId$[workspaceId] ?? 0) === 0
      ? ''
      : undefined}
  >
    {@render workspaceColumn(workspaceId)}
  </div>
{/snippet}

{#snippet resizableWorkspaceStackItem(workspaceId: string, index: number, stackLength: number)}
  <div class="h-full min-h-0 w-full">
    {@render workspaceStackItem(workspaceId, index, stackLength)}
  </div>
{/snippet}

<div class="relative h-full min-h-0 w-full">
  <div
    bind:this={columnsScroller}
    class="scrollbar-none h-full min-h-0 w-full overflow-x-auto overflow-y-hidden bg-transparent"
    aria-label={m.workspace_columns_openSpaces_ariaLabel()}
    data-workspace-columns
    data-visible-workspace-columns={visibleWorkspaceIdsAttribute}
    data-sidebar-widths-ready={sidebarWidthsReady}
    data-anchored-workspace-column={anchoredWorkspaceId}
    data-layout-motion-duration={layoutMotionDuration}
    onscroll={handleColumnsScroll}
    onwheel={handleScrollerWheel}
  >
    <div class="flex h-full min-h-0 w-max min-w-full gap-3 p-2">
      {#each $workspaceStacks$ as stack (stack[0])}
        {@const stackWidth = columnsReady
          ? Math.max(
            ...stack.map((workspaceId) => {
              const panelCount = $panelColumnCountsByWorkspaceId$[workspaceId] ?? 0;
              const panelCanvasWidth =
                livePanelCanvasWidths[workspaceId] ??
                $panelCanvasWidthsByWorkspaceId$[workspaceId] ??
                480;
              return (
                getSidebarWidth(workspaceId) +
                (panelCount > 0
                  ? panelCanvasWidth * (panelPreviewWidthRatios[workspaceId] ?? 1) +
                    CONTAINED_PANEL_INLINE_CHROME
                  : 0)
              );
            }),
            )
          : FALLBACK_STACK_WIDTH}
        <div
          class="h-full min-h-0 shrink-0"
          style:width={`${stackWidth}px`}
          data-workspace-stack={stack.join(',')}
          data-workspace-stack-key={stack[0]}
          animate:flip={{ duration: layoutMotionDuration, easing: cubicOut }}
          transition:resize={{ axis: 'x', duration: layoutMotionDuration }}
        >
          {#if stack.length > 1}
            <div class="h-full min-h-0 w-full" data-workspace-stack-resize-group>
              <ResizablePanelGroup
                panels={stack.map((workspaceId) => ({ id: workspaceId, minSize: 180 }))}
                orientation="vertical"
                storageKey={`workspace-stack-heights:${stack.join(':')}`}
                className="h-full min-h-0"
              >
                {#snippet children(panel, index)}
                  {@render resizableWorkspaceStackItem(panel.id, index, stack.length)}
                {/snippet}
              </ResizablePanelGroup>
            </div>
          {:else}
            {@render resizableWorkspaceStackItem(stack[0], 0, 1)}
          {/if}
        </div>
      {/each}
      <aside
        class="flex h-full min-h-0 w-90 shrink-0 overflow-y-auto px-4 py-10"
        aria-label={m.layout_sidebarNav_allWorkspaces_title()}
        data-workspace-directory-column
      >
        <section class="my-auto w-full max-w-sm" data-workspace-directory-content>
          <AllWorkspacesCard
            recentsOnly
            recentLimit={3}
            searchRecents
            expandableRecents
            excludedWorkspaceIds={$workspaceStacks$.flat()}
            showLoadingText={false}
          />
        </section>
      </aside>
    </div>
  </div>
  {#if currentPanelNavigatorItems.length >= 2}
    <PanelNavigator
      panels={currentPanelNavigatorItems}
      viewport={columnsScroller}
      panelRoot={navigatorPanelRoot}
      ariaLabel={m.layout_panelLayout_ariaLabel()}
      onActivate={activatePanelFromNavigator}
      class="absolute inset-x-3 bottom-3 z-50"
    />
  {/if}
</div>

<style>
  :global(body.panel-resizing) [data-workspace-stack],
  :global(body.panel-resizing) [data-workspace-column-motion] {
    animation: none !important;
    transition: none !important;
  }

  [data-workspace-column] :global([data-workspace-title-region][draggable='true']) {
    cursor: grab;
  }

  [data-workspace-column][data-dragging='true'] :global([data-workspace-title-region]) {
    cursor: grabbing;
  }
</style>
