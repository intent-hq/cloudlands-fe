<script lang="ts">
  import { goto } from '$app/navigation';
  import { faArrowRight, faLayerGroup, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { flushSync, onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
  import { scheduleLayoutRead, scheduleLayoutWrite } from '$lib/utils/layout-phases';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import {
    WORKSPACE_HOVER_CARD_OPEN_DELAY_MS,
    workspaceHoverCardIntentSession,
  } from '$lib/components/workspace/utils/workspace-hover-card-intent';
  import { formatWorkspaceTabStatusSummary } from '$lib/components/workspace/utils/workspace-tab-status-presentation';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
    type WorkspaceStatusPresentationState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import {
    closeWorkspaceTab,
    endDrag,
    moveWorkspace,
    openWorkspaceTab,
    startDrag,
  } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    getReleasedWorkspaceTabMove,
    getWorkspaceTabAutoScrollDelta,
    getWorkspaceTabInsertionIndex,
    proposeWorkspaceTabOrder,
    type WorkspaceTabSlot,
  } from '$lib/components/workspace/utils/workspace-tab-drag';
  import {
    selectCurrentWorkspaceTabId,
    selectWorkspaceTabOrder,
  } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectWorkspaceTabStatuses } from '$store/renderer/slices/hud/hud-selectors';
  import type { WorkspaceTabStatus } from '$store/renderer/slices/hud/hud-types';
  import { WorkspaceStatus } from '$shared/types';
  import { resolveEmptyWindowDestination } from '$features/workspace/utils/empty-window-destination';
  import {
    WORKSPACE_TAB_MOVED_EVENT,
    type WorkspaceTabMovedEventDetail,
  } from '$features/workspace/utils/workspace-tab-move-event';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import WorkspaceTabFlare from './WorkspaceTabFlare.svelte';
  import { getWorkspaceTabBulkCloseIds } from './workspace-tab-context-actions';
  import { prepareTabOutros, workspaceTabLifecycleMotion } from './workspace-tab-lifecycle-motion';
  import {
    WORKSPACE_TAB_CORNER_RADIUS_PX,
    WORKSPACE_TAB_EDGE_FADE_WIDTH_PX,
    WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX,
    WORKSPACE_TAB_MOTION_DURATION_MS,
    WORKSPACE_TAB_MOTION_EASING,
    WORKSPACE_TAB_SCROLLER_MARGIN_LEFT_PX,
    getClippedWorkspaceTabBorderMaskBounds,
    getWorkspaceTabScrollerPaddingLeftPx,
    getWorkspaceTabScrollFadeState,
    type WorkspaceTabBorderMaskBounds,
    workspaceTabMotionEasing,
  } from './titlebar-geometry';

  interface Props {
    onActiveTabBoundsChange?: (bounds: WorkspaceTabBorderMaskBounds | null) => void;
    onActiveTabTrackingChange?: (tracking: boolean) => void;
    activeWorkspaceId?: string | null;
    horizontalPositionTrackingKey?: number;
    leadingInsetPx?: number;
    scrollerMarginLeftPx?: number;
  }

  let {
    onActiveTabBoundsChange,
    onActiveTabTrackingChange,
    activeWorkspaceId,
    horizontalPositionTrackingKey = 0,
    leadingInsetPx = 28,
    scrollerMarginLeftPx = WORKSPACE_TAB_SCROLLER_MARGIN_LEFT_PX,
  }: Props = $props();

  const currentWorkspaceTabId$ = selectCurrentWorkspaceTabId();
  const workspaceTabOrder$ = selectWorkspaceTabOrder();
  const workspaceItems$ = selectWorkspaceItems();
  const workspaceTabStatuses$ = selectWorkspaceTabStatuses();
  let workspaceHoverCardOpenDelay = $state(WORKSPACE_HOVER_CARD_OPEN_DELAY_MS);
  const openWorkspaceHoverCardIds = new Set<string>();
  const pointerOpenEligibleWorkspaceHoverCardIds = new Set<string>();
  let observedTabOrder = selectWorkspaceTabOrder.select(appStore.state);
  let pendingRemovedTabIds: string[] = [];
  const pendingOutroWorkspaceIds = new Set<string>();
  let pendingRemovalResetQueued = false;
  let overflowRefreshFrame: number | null = null;
  let queuedOutroOverflow: boolean | null | undefined;

  const workspaceById = $derived(
    new Map($workspaceItems$.map((workspace) => [String(workspace.id), workspace])),
  );
  const visibleTabIds = $derived($workspaceTabOrder$);

  interface WorkspaceTabDragSession {
    originalOrder: string[];
    pointerOffsetX: number;
    origin: { left: number; top: number; width: number; height: number };
    slots: WorkspaceTabSlot[];
    startScrollLeft: number;
  }

  interface WorkspaceTabPointerGrab {
    workspaceId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    pointerOffsetX: number;
    surface: HTMLElement;
    captureTarget: HTMLElement | null;
  }

  let draggedWorkspaceId = $state<string | null>(null);
  let dragSession = $state<WorkspaceTabDragSession | null>(null);
  let pendingDragPointer: WorkspaceTabPointerGrab | null = null;
  let dragClientX = $state(0);
  let proposedTabOrder = $state<string[] | null>(null);
  let lifecycleMotionReady = $state(false);
  let prefersReducedMotion = $state(false);
  let suppressClickWorkspaceId: string | null = null;
  const renderedTabOrder = $derived(proposedTabOrder ?? $workspaceTabOrder$);
  const selectedWorkspaceId = $derived(
    activeWorkspaceId === undefined ? $currentWorkspaceTabId$ : activeWorkspaceId,
  );
  const visualActiveWorkspaceId = $derived(selectedWorkspaceId);
  const workspaceTabMotionDuration = $derived(
    prefersReducedMotion ? 0 : WORKSPACE_TAB_MOTION_DURATION_MS,
  );
  let refreshOverflow = () => {};
  let reorderAnnouncement = $state('');
  let activeStreamsVersion = $state(0);
  let stripElement = $state<HTMLDivElement | null>(null);
  let isOverflowing = $state(false);
  let pendingOutroOverflow = $state<boolean | null>(null);
  let hasHiddenTabsLeft = $state(false);
  let hasHiddenTabsRight = $state(false);
  const workspaceTabMaskImage = $derived.by(() => {
    if (!hasHiddenTabsLeft && !hasHiddenTabsRight) return 'none';
    const leftStops = hasHiddenTabsLeft
      ? `transparent ${WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX}px, black ${WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX + WORKSPACE_TAB_EDGE_FADE_WIDTH_PX}px`
      : 'black 0';
    const rightStops = hasHiddenTabsRight
      ? `black calc(100% - ${WORKSPACE_TAB_EDGE_FADE_WIDTH_PX}px), transparent 100%`
      : 'black 100%';
    return `linear-gradient(to right, ${leftStops}, ${rightStops})`;
  });
  const tabButtons = new Map<string, HTMLButtonElement>();
  const tabSurfaces = new Map<string, HTMLElement>();
  const ACTIVE_TAB_EDGE_GAP = 2;
  const POINTER_DRAG_THRESHOLD = 4;
  const activeTabBoundsPollers = new Set<() => void>();
  const activeTabBoundsReporters = new Set<() => void>();
  const activeTabBoundsControllers = new Map<string, (active: boolean) => void>();
  let autoScrollFrame: number | null = null;
  let layoutTracking = false;
  let dragTracking = false;
  let scrollTracking = false;
  let tabContextMenu = $state<{ workspaceId: string; x: number; y: number } | null>(null);
  const tabContextMenuItems = $derived.by<SidebarMenuEntry[]>(() => {
    if (!tabContextMenu) return [];
    const { workspaceId } = tabContextMenu;
    const closeOthers = getWorkspaceTabBulkCloseIds($workspaceTabOrder$, workspaceId, 'others');
    const closeRight = getWorkspaceTabBulkCloseIds($workspaceTabOrder$, workspaceId, 'right');
    return [
      {
        id: 'close',
        label: m.layout_panelTabBar_close_label(),
        icon: faXmark,
        onClick: () => closeWorkspace(workspaceId),
      },
      { type: 'separator' },
      {
        id: 'close-others',
        label: m.layout_panelTabBar_closeAllOthers_label(),
        icon: faLayerGroup,
        disabled: closeOthers.length === 0,
        onClick: () => closeWorkspaceTabs(closeOthers, workspaceId),
      },
      {
        id: 'close-right',
        label: m.layout_panelTabBar_closeTabsToRight_label(),
        icon: faArrowRight,
        disabled: closeRight.length === 0,
        onClick: () => closeWorkspaceTabs(closeRight),
      },
    ];
  });

  function reportActiveTabTracking() {
    const tracking = layoutTracking || dragTracking || scrollTracking;
    flushSync(() => onActiveTabTrackingChange?.(tracking));
  }
  const emitActiveTabBounds = (bounds: WorkspaceTabBorderMaskBounds | null) =>
    flushSync(() => onActiveTabBoundsChange?.(bounds));

  function scheduleOverflowRefresh(overflow?: boolean | null) {
    if (overflow !== undefined) queuedOutroOverflow = overflow;
    if (overflowRefreshFrame !== null) return;
    overflowRefreshFrame = requestAnimationFrame(() => {
      overflowRefreshFrame = null;
      if (queuedOutroOverflow !== undefined) {
        pendingOutroOverflow = queuedOutroOverflow;
        queuedOutroOverflow = undefined;
      }
      refreshOverflow();
    });
  }

  onMount(() => {
    activeStreamsTracker.startPolling();
    const unsubscribe = activeStreamsTracker.subscribe(() => activeStreamsVersion++);
    const unsubscribeTabState = appStore.getReadableState().subscribe((state) => {
      const nextTabOrder = selectWorkspaceTabOrder.select(state);
      const previousTabIds = new Set(observedTabOrder);
      const nextTabIds = new Set(nextTabOrder);
      const removedTabIds = observedTabOrder.filter((workspaceId) => !nextTabIds.has(workspaceId));
      const reappearedTabIds = nextTabOrder.filter(
        (workspaceId) =>
          !previousTabIds.has(workspaceId) && pendingOutroWorkspaceIds.has(workspaceId),
      );
      observedTabOrder = nextTabOrder;
      if (reappearedTabIds.length > 0) {
        reappearedTabIds.forEach((workspaceId) => pendingOutroWorkspaceIds.delete(workspaceId));
        scheduleOverflowRefresh(null);
      }
      if (removedTabIds.length === 0) return;
      removedTabIds.forEach((workspaceId) => pendingOutroWorkspaceIds.add(workspaceId));
      pendingRemovedTabIds = Array.from(new Set([...pendingRemovedTabIds, ...removedTabIds]));
      pendingOutroOverflow = prepareTabOutros(stripElement, pendingRemovedTabIds) ?? null;
      if (!pendingRemovalResetQueued) {
        pendingRemovalResetQueued = true;
        queueMicrotask(() => {
          pendingRemovedTabIds = [];
          pendingRemovalResetQueued = false;
        });
      }
    });
    const unsubscribeHoverCardIntent = workspaceHoverCardIntentSession.subscribe(
      (delay) => (workspaceHoverCardOpenDelay = delay),
    );
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => (prefersReducedMotion = motionQuery.matches);
    updateMotionPreference();
    motionQuery.addEventListener('change', updateMotionPreference);
    const lifecycleFrame = requestAnimationFrame(() => {
      lifecycleMotionReady = true;
    });
    const handleMoved = (event: Event) =>
      handleGlobalWorkspaceTabMoved(event as CustomEvent<WorkspaceTabMovedEventDetail>);
    window.addEventListener(WORKSPACE_TAB_MOVED_EVENT, handleMoved);
    return () => {
      unsubscribe();
      unsubscribeTabState();
      unsubscribeHoverCardIntent();
      openWorkspaceHoverCardIds.forEach(() => workspaceHoverCardIntentSession.notifyClosed());
      openWorkspaceHoverCardIds.clear();
      pointerOpenEligibleWorkspaceHoverCardIds.clear();
      cancelAnimationFrame(lifecycleFrame);
      if (overflowRefreshFrame !== null) cancelAnimationFrame(overflowRefreshFrame);
      motionQuery.removeEventListener('change', updateMotionPreference);
      window.removeEventListener(WORKSPACE_TAB_MOVED_EVENT, handleMoved);
    };
  });

  function handleWorkspaceHoverCardOpenChange(workspaceId: string, open: boolean) {
    if (
      open &&
      pointerOpenEligibleWorkspaceHoverCardIds.has(workspaceId) &&
      !openWorkspaceHoverCardIds.has(workspaceId)
    ) {
      openWorkspaceHoverCardIds.add(workspaceId);
      workspaceHoverCardIntentSession.notifyOpened();
    } else if (!open && openWorkspaceHoverCardIds.delete(workspaceId)) {
      workspaceHoverCardIntentSession.notifyClosed();
    }
  }

  // Overflow detection drives the strip's right margin: while tabs are
  // clipped, the clipped tab edge (not the pr-3 padding) sits at the strip's
  // right border, so the -mr-2.5 pull toward the "+" launcher must be
  // replaced with positive spacing. ResizeObserver catches strip resizes;
  // re-running on visibleTabIds catches tab count changes at constant width.
  $effect(() => {
    const strip = stripElement;
    if (!strip) return;
    void renderedTabOrder;
    const updateOverflow = () => {
      isOverflowing = pendingOutroOverflow ?? strip.scrollWidth > strip.clientWidth;
      const fadeState = getWorkspaceTabScrollFadeState(
        strip.scrollLeft,
        strip.scrollWidth,
        strip.clientWidth,
      );
      hasHiddenTabsLeft = fadeState.left;
      hasHiddenTabsRight = fadeState.right;
      activeTabBoundsReporters.forEach((report) => report());
    };
    refreshOverflow = updateOverflow;
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(strip);
    strip.addEventListener('scroll', updateOverflow);
    return () => {
      observer.disconnect();
      strip.removeEventListener('scroll', updateOverflow);
      if (refreshOverflow === updateOverflow) refreshOverflow = () => {};
    };
  });

  $effect(() => {
    void renderedTabOrder;
    void horizontalPositionTrackingKey;
    const trackingDuration = workspaceTabMotionDuration;
    if (activeTabBoundsPollers.size === 0) return;
    layoutTracking = true;
    reportActiveTabTracking();
    let startedAt: number | null = null;
    let frame: number | null = null;
    let cancelled = false;
    const tick = (timestamp: number) => {
      frame = null;
      if (cancelled) return;
      startedAt ??= timestamp;
      activeTabBoundsReporters.forEach((report) => report());
      if (timestamp - startedAt < trackingDuration) {
        frame = requestAnimationFrame(tick);
      } else {
        layoutTracking = false;
        reportActiveTabTracking();
        activeTabBoundsPollers.forEach((poll) => poll());
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      layoutTracking = false;
      reportActiveTabTracking();
    };
  });

  $effect(() => {
    dragTracking = draggedWorkspaceId !== null;
    reportActiveTabTracking();
    return () => {
      dragTracking = false;
      reportActiveTabTracking();
    };
  });

  $effect(() => {
    if (!draggedWorkspaceId) return;
    void dragClientX;
    const frame = requestAnimationFrame(() => {
      activeTabBoundsPollers.forEach((poll) => poll());
    });
    return () => cancelAnimationFrame(frame);
  });

  function getRunningAgentIds(workspaceId: string) {
    void activeStreamsVersion;
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId);
  }

  function tabAccessibleLabel(
    title: string,
    workspaceState: WorkspaceStatusPresentationState,
    status?: WorkspaceTabStatus,
  ): string {
    return m.layout_workspaceTabStrip_status_ariaLabel({
      name: title,
      statuses: status
        ? formatWorkspaceTabStatusSummary(status)
        : getWorkspaceStatusPresentation(workspaceState).accessibleName,
    });
  }

  function reportActiveTabBounds(node: HTMLElement, isActive: boolean) {
    let active = isActive;
    let clampQueued = false;
    let readPending = false;
    let writePending = false;
    let cancelRead: (() => void) | null = null;
    let cancelWrite: (() => void) | null = null;
    let scrollTrackingTimeout: ReturnType<typeof setTimeout> | null = null;
    const strip = node.closest('[data-workspace-tab-strip]');

    const runFrame = (allowClamp = true) => {
      readPending = false;
      const shouldClamp = clampQueued;
      clampQueued = false;
      if (!active) return;

      const tabRect = node.getBoundingClientRect();
      const titlebarRect = node.closest('.window-title-bar')?.getBoundingClientRect() ?? null;
      const stripRect = strip?.getBoundingClientRect() ?? null;
      let scrollDelta = 0;
      let scrollTarget: number | null = null;
      if (
        allowClamp &&
        shouldClamp &&
        strip &&
        stripRect &&
        !draggedWorkspaceId &&
        !layoutTracking
      ) {
        if (tabRect.left < stripRect.left + ACTIVE_TAB_EDGE_GAP) {
          scrollDelta = tabRect.left - stripRect.left - ACTIVE_TAB_EDGE_GAP;
        } else if (tabRect.right > stripRect.right - ACTIVE_TAB_EDGE_GAP) {
          scrollDelta = tabRect.right - stripRect.right + ACTIVE_TAB_EDGE_GAP;
        }
        if (scrollDelta !== 0) scrollTarget = strip.scrollLeft + scrollDelta;
      }
      if (scrollTarget === null && (!titlebarRect || !stripRect)) return;
      const fadeEdges = strip
        ? getWorkspaceTabScrollFadeState(strip.scrollLeft, strip.scrollWidth, strip.clientWidth)
        : undefined;

      if (writePending) cancelWrite?.();
      const writeBounds = () => {
        writePending = false;
        if (!active) return;
        if (scrollTarget !== null && strip) strip.scrollLeft = scrollTarget;
        if (!titlebarRect || !stripRect) return;
        if (scrollTarget === null) {
          emitActiveTabBounds(
            getClippedWorkspaceTabBorderMaskBounds(
              tabRect,
              stripRect,
              titlebarRect.left,
              fadeEdges,
            ),
          );
          return;
        }
        // A clamp moved the strip, so re-measure the boundary-clamped position.
        const movedTabRect = node.getBoundingClientRect();
        const movedTitlebarRect = node.closest('.window-title-bar')?.getBoundingClientRect();
        const movedStripRect = strip?.getBoundingClientRect();
        if (!movedTitlebarRect || !movedStripRect) return;
        emitActiveTabBounds(
          getClippedWorkspaceTabBorderMaskBounds(
            movedTabRect,
            movedStripRect,
            movedTitlebarRect.left,
            strip
              ? getWorkspaceTabScrollFadeState(
                  strip.scrollLeft,
                  strip.scrollWidth,
                  strip.clientWidth,
                )
              : undefined,
          ),
        );
      };
      if (!allowClamp) return writeBounds();
      writePending = true;
      cancelWrite = scheduleLayoutWrite(writeBounds);
    };

    const reportVisibleActiveBounds = () => {
      clampQueued = false;
      runFrame(false);
    };

    const schedule = () => {
      if (readPending) return;
      readPending = true;
      cancelRead = scheduleLayoutRead(() => runFrame());
    };

    const scheduleClampAndReport = () => {
      clampQueued = true;
      schedule();
    };

    const scheduleBoundsReport = () => {
      if (!active) return;
      scrollTracking = true;
      reportActiveTabTracking();
      if (scrollTrackingTimeout !== null) clearTimeout(scrollTrackingTimeout);
      scrollTrackingTimeout = setTimeout(() => {
        scrollTrackingTimeout = null;
        scrollTracking = false;
        reportActiveTabTracking();
      }, 80);
      schedule();
    };

    const resizeObserver = new ResizeObserver(scheduleClampAndReport);
    resizeObserver.observe(node);
    window.addEventListener('resize', scheduleClampAndReport);
    strip?.addEventListener('scroll', scheduleBoundsReport);
    activeTabBoundsPollers.add(scheduleClampAndReport);
    activeTabBoundsReporters.add(reportVisibleActiveBounds);
    scheduleClampAndReport();

    const setActive = (nextIsActive: boolean) => {
      const wasActive = active;
      active = nextIsActive;
      node.dataset.active = String(nextIsActive);
      if (active) {
        reportVisibleActiveBounds();
        scheduleClampAndReport();
      } else if (wasActive) emitActiveTabBounds(null);
    };
    const workspaceId = node.dataset.workspaceTab;
    if (workspaceId) activeTabBoundsControllers.set(workspaceId, setActive);

    return {
      update: setActive,
      destroy() {
        if (scrollTrackingTimeout !== null) clearTimeout(scrollTrackingTimeout);
        if (active && scrollTracking) {
          scrollTracking = false;
          reportActiveTabTracking();
        }
        cancelRead?.();
        cancelWrite?.();
        activeTabBoundsPollers.delete(scheduleClampAndReport);
        activeTabBoundsReporters.delete(reportVisibleActiveBounds);
        resizeObserver.disconnect();
        window.removeEventListener('resize', scheduleClampAndReport);
        strip?.removeEventListener('scroll', scheduleBoundsReport);
        if (workspaceId && activeTabBoundsControllers.get(workspaceId) === setActive) {
          activeTabBoundsControllers.delete(workspaceId);
        }
        if (active) emitActiveTabBounds(null);
      },
    };
  }

  function registerTabButton(node: HTMLButtonElement, workspaceId: string) {
    tabButtons.set(workspaceId, node);
    return {
      destroy() {
        tabButtons.delete(workspaceId);
      },
    };
  }

  function registerTabSurface(node: HTMLElement, workspaceId: string) {
    tabSurfaces.set(workspaceId, node);
    return {
      destroy() {
        tabSurfaces.delete(workspaceId);
      },
    };
  }

  async function openWorkspace(workspaceId: string, restoreFocus = false) {
    appStore.dispatch(openWorkspaceTab(workspaceId));
    await goto(`/workspace/${workspaceId}`);
    if (restoreFocus) requestAnimationFrame(() => tabButtons.get(workspaceId)?.focus());
  }

  function closeWorkspace(workspaceId: string, event?: Event) {
    event?.stopPropagation();
    const wasCurrent = selectedWorkspaceId === workspaceId;
    appStore.dispatch(closeWorkspaceTab(workspaceId));
    if (!wasCurrent) return;

    const nextWorkspaceId = selectCurrentWorkspaceTabId.select(appStore.state);
    layoutTracking = true;
    reportActiveTabTracking();
    activeTabBoundsControllers.get(workspaceId)?.(false);
    if (nextWorkspaceId) activeTabBoundsControllers.get(nextWorkspaceId)?.(true);
    void goto(
      nextWorkspaceId
        ? `/workspace/${nextWorkspaceId}`
        : resolveEmptyWindowDestination(selectWorkspaceItems.select(appStore.state)),
    );
  }

  function closeWorkspaceTabs(workspaceIds: string[], focusWorkspaceId?: string) {
    if (workspaceIds.length === 0) return;
    const closingWorkspaceId =
      selectedWorkspaceId && workspaceIds.includes(selectedWorkspaceId)
        ? selectedWorkspaceId
        : null;
    if (focusWorkspaceId) appStore.dispatch(openWorkspaceTab(focusWorkspaceId));
    workspaceIds.forEach((workspaceId) => appStore.dispatch(closeWorkspaceTab(workspaceId)));
    const nextWorkspaceId = focusWorkspaceId ?? selectCurrentWorkspaceTabId.select(appStore.state);
    if (closingWorkspaceId) {
      layoutTracking = true;
      reportActiveTabTracking();
      activeTabBoundsControllers.get(closingWorkspaceId)?.(false);
      if (nextWorkspaceId) activeTabBoundsControllers.get(nextWorkspaceId)?.(true);
    }
    void goto(
      nextWorkspaceId
        ? `/workspace/${nextWorkspaceId}`
        : resolveEmptyWindowDestination(selectWorkspaceItems.select(appStore.state)),
    );
  }

  function handleWorkspaceTabContextMenu(event: MouseEvent, workspaceId: string) {
    event.preventDefault();
    event.stopPropagation();
    cancelPointerDrag();
    tabContextMenu = { workspaceId, x: event.clientX, y: event.clientY };
  }

  function moveWorkspaceTab(workspaceId: string, direction: -1 | 1) {
    const currentIndex = visibleTabIds.indexOf(workspaceId);
    const targetIndex = currentIndex + direction;
    const targetId = visibleTabIds[targetIndex];
    if (currentIndex < 0 || !targetId) return;

    appStore.dispatch(moveWorkspace(workspaceId, targetId, direction === -1 ? 'before' : 'after'));
    reorderAnnouncement = m.layout_workspaceTabStrip_reorderAnnouncement({
      name: workspaceById.get(workspaceId)?.title || m.layout_workspaceTabStrip_untitled_label(),
      position: targetIndex + 1,
    });
    requestAnimationFrame(() => tabButtons.get(workspaceId)?.focus());
  }

  function handleGlobalWorkspaceTabMoved(event: CustomEvent<WorkspaceTabMovedEventDetail>) {
    const { workspaceId, position } = event.detail;
    if (!visibleTabIds.includes(workspaceId) || position < 1) return;
    reorderAnnouncement = m.layout_workspaceTabStrip_reorderAnnouncement({
      name: workspaceById.get(workspaceId)?.title || m.layout_workspaceTabStrip_untitled_label(),
      position,
    });
    requestAnimationFrame(() => {
      const tab = tabButtons.get(workspaceId);
      if (!tab) return;
      tab.focus();
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function handleTabKeydown(event: KeyboardEvent, workspaceId: string) {
    if (
      event.altKey &&
      event.shiftKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      event.preventDefault();
      moveWorkspaceTab(workspaceId, event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }

    if (event.key === 'Delete' || (event.key === 'Backspace' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      closeWorkspace(workspaceId, event);
      return;
    }

    const currentIndex = visibleTabIds.indexOf(workspaceId);
    let targetId: string | undefined;
    if (event.key === 'ArrowLeft')
      targetId = visibleTabIds[currentIndex - 1] ?? visibleTabIds.at(-1);
    if (event.key === 'ArrowRight') targetId = visibleTabIds[currentIndex + 1] ?? visibleTabIds[0];
    if (event.key === 'Home') targetId = visibleTabIds[0];
    if (event.key === 'End') targetId = visibleTabIds.at(-1);
    if (!targetId) return;

    event.preventDefault();
    tabButtons.get(targetId)?.focus();
    void openWorkspace(targetId, true);
  }

  function ordersMatch(first: string[], second: string[]) {
    return first.length === second.length && first.every((id, index) => id === second[index]);
  }

  function stopDragAutoScroll() {
    if (autoScrollFrame === null) return;
    cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
  }

  function updateProposedTabOrder(clientX: number) {
    if (!draggedWorkspaceId || !dragSession) return;
    const scrollDelta =
      (stripElement?.scrollLeft ?? dragSession.startScrollLeft) - dragSession.startScrollLeft;
    const slots = dragSession.slots.map((slot) => ({
      ...slot,
      centerX: slot.centerX - scrollDelta,
    }));
    const insertionIndex = getWorkspaceTabInsertionIndex(
      clientX,
      dragSession.pointerOffsetX,
      dragSession.origin.width,
      slots,
    );
    const nextOrder = proposeWorkspaceTabOrder(
      dragSession.originalOrder,
      draggedWorkspaceId,
      insertionIndex,
    );
    if (!proposedTabOrder || !ordersMatch(nextOrder, proposedTabOrder)) {
      proposedTabOrder = nextOrder;
    }
  }

  function runDragAutoScroll() {
    autoScrollFrame = null;
    if (!draggedWorkspaceId || !dragSession || !stripElement) return;
    const stripRect = stripElement.getBoundingClientRect();
    const delta = getWorkspaceTabAutoScrollDelta(dragClientX, stripRect.left, stripRect.right);
    const maxScrollLeft = Math.max(0, stripElement.scrollWidth - stripElement.clientWidth);
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, stripElement.scrollLeft + delta));
    if (nextScrollLeft === stripElement.scrollLeft) return;
    stripElement.scrollLeft = nextScrollLeft;
    updateProposedTabOrder(dragClientX);
    queueDragAutoScroll();
  }

  function queueDragAutoScroll() {
    if (autoScrollFrame !== null) return;
    autoScrollFrame = -1;
    const frame = requestAnimationFrame(runDragAutoScroll);
    if (autoScrollFrame === -1) autoScrollFrame = frame;
  }

  $effect(() => {
    if (
      !draggedWorkspaceId &&
      proposedTabOrder &&
      ordersMatch(proposedTabOrder, $workspaceTabOrder$)
    ) {
      proposedTabOrder = null;
    }
  });

  function handleDragPointerDown(event: PointerEvent, workspaceId: string) {
    if (event.button !== 0 || !event.isPrimary || draggedWorkspaceId) return;
    const target = event.target as HTMLElement;
    const tabTarget = target.closest<HTMLElement>('[role="tab"]');
    if (!tabTarget || target.closest('[data-workspace-tab-close]')) return;
    suppressClickWorkspaceId = null;
    const surface = event.currentTarget as HTMLElement;
    const captureTarget = stripElement ?? surface;
    const rect = surface.getBoundingClientRect();
    pendingDragPointer = {
      workspaceId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      pointerOffsetX: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
      surface,
      captureTarget,
    };
    captureTarget.setPointerCapture(event.pointerId);
  }

  function startPointerDrag(pointerGrab: WorkspaceTabPointerGrab, clientX: number) {
    const rect = pointerGrab.surface.getBoundingClientRect();
    const originalOrder = [...visibleTabIds];
    flushSync(() => (draggedWorkspaceId = pointerGrab.workspaceId));
    dragClientX = clientX;
    proposedTabOrder = originalOrder;
    dragSession = {
      originalOrder,
      pointerOffsetX: pointerGrab.pointerOffsetX,
      origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      slots: originalOrder.flatMap((id) => {
        if (id === pointerGrab.workspaceId) return [];
        const slotRect = tabSurfaces.get(id)?.getBoundingClientRect();
        return slotRect ? [{ id, centerX: slotRect.left + slotRect.width / 2 }] : [];
      }),
      startScrollLeft: stripElement?.scrollLeft ?? 0,
    };
    appStore.dispatch(startDrag());
  }

  function handleDragPointerMove(event: PointerEvent) {
    const pointerGrab = pendingDragPointer;
    if (!pointerGrab || event.pointerId !== pointerGrab.pointerId) return;
    if (!draggedWorkspaceId) {
      const distance = Math.hypot(
        event.clientX - pointerGrab.startClientX,
        event.clientY - pointerGrab.startClientY,
      );
      if (distance < POINTER_DRAG_THRESHOLD) return;
      startPointerDrag(pointerGrab, event.clientX);
    }
    event.preventDefault();
    dragClientX = event.clientX;
    updateProposedTabOrder(dragClientX);
    queueDragAutoScroll();
  }

  function clearPointerGrab() {
    const pointerGrab = pendingDragPointer;
    pendingDragPointer = null;
    if (pointerGrab?.captureTarget?.hasPointerCapture(pointerGrab.pointerId)) {
      pointerGrab.captureTarget.releasePointerCapture(pointerGrab.pointerId);
    }
  }

  function finishDrag(keepProposedOrder = false) {
    if (!draggedWorkspaceId) return;
    stopDragAutoScroll();
    pendingDragPointer = null;
    draggedWorkspaceId = null;
    dragSession = null;
    if (!keepProposedOrder) proposedTabOrder = null;
    appStore.dispatch(endDrag());
  }

  function releaseDraggedWorkspace() {
    if (!draggedWorkspaceId || !dragSession) return;
    const releasedOrder = proposedTabOrder ?? dragSession.originalOrder;
    const releasedIndex = releasedOrder.indexOf(draggedWorkspaceId);
    const move = getReleasedWorkspaceTabMove(
      dragSession.originalOrder,
      releasedOrder,
      draggedWorkspaceId,
    );
    if (move) {
      appStore.dispatch(moveWorkspace(draggedWorkspaceId, move.targetId, move.placement));
      reorderAnnouncement = m.layout_workspaceTabStrip_reorderAnnouncement({
        name:
          workspaceById.get(draggedWorkspaceId)?.title ||
          m.layout_workspaceTabStrip_untitled_label(),
        position: releasedIndex + 1,
      });
    }
    finishDrag(Boolean(move));
  }

  function cancelPointerDrag(suppressFollowingClick = false) {
    const cancelledWorkspaceId = pendingDragPointer?.workspaceId ?? draggedWorkspaceId;
    clearPointerGrab();
    finishDrag();
    if (suppressFollowingClick && cancelledWorkspaceId) {
      suppressClickWorkspaceId = cancelledWorkspaceId;
    }
  }

  function handleDragPointerUp(event: PointerEvent) {
    const pointerGrab = pendingDragPointer;
    if (!pointerGrab || event.pointerId !== pointerGrab.pointerId) return;
    const didDrag = draggedWorkspaceId === pointerGrab.workspaceId && dragSession !== null;
    if (didDrag) {
      event.preventDefault();
      dragClientX = event.clientX;
      updateProposedTabOrder(dragClientX);
    }
    suppressClickWorkspaceId = pointerGrab.workspaceId;
    setTimeout(() => {
      if (suppressClickWorkspaceId === pointerGrab.workspaceId) suppressClickWorkspaceId = null;
    });
    clearPointerGrab();
    if (didDrag) releaseDraggedWorkspace();
    else void openWorkspace(pointerGrab.workspaceId);
  }

  function handleDragPointerCancel(event: PointerEvent) {
    if (event.pointerId !== pendingDragPointer?.pointerId) return;
    cancelPointerDrag();
  }

  function handleLostPointerCapture(event: PointerEvent) {
    if (event.pointerId !== pendingDragPointer?.pointerId) return;
    cancelPointerDrag(true);
  }

  function handleDragKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || (!pendingDragPointer && !draggedWorkspaceId)) return;
    event.preventDefault();
    cancelPointerDrag(true);
  }

  function handleTabClick(event: MouseEvent, workspaceId: string) {
    if (suppressClickWorkspaceId === workspaceId && event.detail !== 0) {
      suppressClickWorkspaceId = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    void openWorkspace(workspaceId, event.detail === 0);
  }

  function handleTabIntroEnd(workspaceId: string) {
    if (pendingOutroWorkspaceIds.delete(workspaceId)) {
      scheduleOverflowRefresh(null);
    }
    if (workspaceId !== visualActiveWorkspaceId) return;
    activeTabBoundsPollers.forEach((poll) => poll());
  }

  function handleTabOutroEnd(workspaceId: string) {
    pendingOutroWorkspaceIds.delete(workspaceId);
    pendingOutroOverflow = null;
    activeTabBoundsPollers.forEach((poll) => poll());
    requestAnimationFrame(() => activeTabBoundsPollers.forEach((poll) => poll()));
  }
</script>

<svelte:window onkeydown={handleDragKeydown} />

{#if $workspaceTabOrder$.length > 0}
  <!-- The open scroller starts 12px after the panel curve. A 16px transparent lead-in
       moves the active left fade past it without moving the first tab.
       The closed scroller moves left so the visible logo-to-flare gap
       matches the tab gap floor. Its 6px padding keeps the leading flare fully
       inside the scrollport, so the clip and fade still move with the first tab.
       The right margin is conditional: -mr-2.5 keeps the "+" launcher tight
       against the last tab's pr-3 padding when everything fits, but during
       overflow the clipped tab edge is flush with the strip border, so mr-1
       (plus the parent's gap-1) keeps 8px of clearance before the "+".
       Scrolled-out tabs must not carve no-drag holes (intent-hq/monorepo#2400). -->
  <div
    bind:this={stripElement}
    data-workspace-tab-scroller
    class={cn(
      'flex w-fit min-w-0 max-w-[100%] items-center gap-0.5 overflow-x-auto overflow-y-hidden pr-3 scrollbar-none transition-[padding-left,margin-right] motion-reduce:transition-none',
      isOverflowing ? 'mr-1' : '-mr-2.5',
      draggedWorkspaceId && 'cursor-grabbing',
    )}
    aria-label={m.layout_workspaceTabStrip_openSpaces_ariaLabel()}
    role="tablist"
    tabindex="-1"
    style:margin-left={`${scrollerMarginLeftPx}px`}
    style:padding-left={`${getWorkspaceTabScrollerPaddingLeftPx(leadingInsetPx)}px`}
    style:padding-bottom="2px"
    style:margin-bottom="-2px"
    style:mask-image={workspaceTabMaskImage}
    style:transition-duration={`${WORKSPACE_TAB_MOTION_DURATION_MS}ms`}
    style:transition-timing-function={WORKSPACE_TAB_MOTION_EASING}
    data-workspace-tab-strip
    data-fade-left={hasHiddenTabsLeft}
    data-fade-right={hasHiddenTabsRight}
    data-app-region-clip
    onpointermove={handleDragPointerMove}
    onpointerup={handleDragPointerUp}
    onpointercancel={handleDragPointerCancel}
    onlostpointercapture={handleLostPointerCapture}
  >
    {#each renderedTabOrder as workspaceId (workspaceId)}
      {@const workspace = workspaceById.get(workspaceId)}
      {@const isDragged = draggedWorkspaceId === workspaceId}
      {@const isCurrent = workspaceId === visualActiveWorkspaceId}
      <div
        class="w-40 max-w-[40vw] min-w-0 shrink-0"
        data-workspace-tab-motion={workspaceId}
        style:width={isDragged ? `${dragSession?.origin.width ?? 160}px` : undefined}
        style:height={isDragged ? `${dragSession?.origin.height ?? 32}px` : undefined}
        animate:flip={{
          duration: isDragged ? 0 : workspaceTabMotionDuration,
          easing: workspaceTabMotionEasing,
        }}
        in:workspaceTabLifecycleMotion={{
          duration: lifecycleMotionReady && !isDragged ? workspaceTabMotionDuration : 0,
          easing: workspaceTabMotionEasing,
          phase: 'intro',
          onFrame: () => scheduleOverflowRefresh(),
        }}
        out:workspaceTabLifecycleMotion={{
          duration: lifecycleMotionReady && !isDragged ? workspaceTabMotionDuration : 0,
          easing: workspaceTabMotionEasing,
          phase: 'outro',
          onFrame: (overflow) => scheduleOverflowRefresh(overflow),
        }}
        onintroend={() => handleTabIntroEnd(workspaceId)}
        onoutroend={() => handleTabOutroEnd(workspaceId)}
      >
        {#if workspace}
          {@const runningAgentIds = getRunningAgentIds(workspaceId)}
          {@const tabStatus = $workspaceTabStatuses$[workspaceId]}
          {@const workspaceStatusState = resolveWorkspaceStatusState(workspace)}
          {@const isArchived = workspace.status === WorkspaceStatus.Archived}
          {@const workspaceTitle =
            workspace.title?.trim() || m.layout_workspaceTabStrip_untitled_label()}
          {#if isDragged}
            <div
              class="invisible h-full w-full"
              aria-hidden="true"
              data-workspace-tab-placeholder={workspaceId}
            ></div>
          {/if}
          <div
            class={cn(
              'group/workspace-tab flex h-8 w-full min-w-0 shrink-0 items-center border transition-[background-color,border-color] motion-reduce:transition-none',
              isCurrent
                ? 'rounded-t-md border-border border-b-0 bg-sidebar text-foreground shadow-none'
                : 'rounded-md border-transparent text-muted-foreground hover:bg-sidebar/50 hover:text-foreground',
              isDragged
                ? 'pointer-events-none fixed z-50 cursor-grabbing'
                : 'relative cursor-pointer',
            )}
            data-workspace-tab={workspaceId}
            data-workspace-tab-visual={workspaceId}
            data-active={isCurrent}
            data-dragging={isDragged}
            style:left={isDragged && dragSession
              ? `${dragClientX - dragSession.pointerOffsetX}px`
              : undefined}
            style:top={isDragged && dragSession ? `${dragSession.origin.top - 2}px` : undefined}
            style:width={isDragged && dragSession ? `${dragSession.origin.width}px` : undefined}
            style:height={isDragged && dragSession ? `${dragSession.origin.height}px` : undefined}
            style:border-radius={isCurrent
              ? `${WORKSPACE_TAB_CORNER_RADIUS_PX}px ${WORKSPACE_TAB_CORNER_RADIUS_PX}px 0 0`
              : `${WORKSPACE_TAB_CORNER_RADIUS_PX}px`}
            style:transition-duration={isDragged ? '0ms' : `${WORKSPACE_TAB_MOTION_DURATION_MS}ms`}
            style:transition-timing-function={WORKSPACE_TAB_MOTION_EASING}
            use:reportActiveTabBounds={isCurrent}
            use:registerTabSurface={workspaceId}
            role="presentation"
            onpointerdown={(event) => handleDragPointerDown(event, workspaceId)}
            onmouseenter={() => pointerOpenEligibleWorkspaceHoverCardIds.add(workspaceId)}
            onmouseleave={() => pointerOpenEligibleWorkspaceHoverCardIds.delete(workspaceId)}
            oncontextmenu={(event) => handleWorkspaceTabContextMenu(event, workspaceId)}
          >
            <WorkspaceTabFlare
              side="leading"
              visible={isCurrent}
              durationMs={isDragged ? 0 : WORKSPACE_TAB_MOTION_DURATION_MS}
            />
            <WorkspaceTabFlare
              side="trailing"
              visible={isCurrent}
              durationMs={isDragged ? 0 : WORKSPACE_TAB_MOTION_DURATION_MS}
            />
            <TooltipRich
              side="bottom"
              align="start"
              delayDuration={workspaceHoverCardOpenDelay}
              onOpenChange={(open) => handleWorkspaceHoverCardOpenChange(workspaceId, open)}
              disableHoverableContent={true}
              disabled={draggedWorkspaceId !== null}
              showArrow={false}
              maxWidth="none"
              class="absolute -inset-px rounded-[inherit]"
              contentClass="border-0 bg-transparent p-0 shadow-none"
              contentContainerClass="space-y-0! p-0!"
            >
              {#snippet content()}
                <div data-workspace-tab-hover-content={workspaceId}>
                  <WorkspaceHoverCard {workspace} activeAgentIds={runningAgentIds} />
                </div>
              {/snippet}
              <button
                type="button"
                use:registerTabButton={workspaceId}
                class="flex h-full w-full min-w-0 touch-none cursor-pointer select-none items-center gap-1 truncate rounded-[inherit] pl-3 pr-1 text-left text-xs font-medium outline-none! focus-visible:text-foreground forced-colors:focus-visible:text-[HighlightText]"
                onclick={(event) => handleTabClick(event, workspaceId)}
                onkeydown={(event) => handleTabKeydown(event, workspaceId)}
                onfocusin={() => pointerOpenEligibleWorkspaceHoverCardIds.delete(workspaceId)}
                role="tab"
                aria-selected={isCurrent}
                aria-current={isCurrent ? 'page' : undefined}
                aria-label={tabAccessibleLabel(workspaceTitle, workspaceStatusState, tabStatus)}
                tabindex={isCurrent ? 0 : -1}
                data-workspace-tab-hover-trigger
              >
                <span
                  class={cn('min-w-0 flex-1 truncate', isArchived && 'opacity-60')}
                  data-workspace-tab-title>{workspaceTitle}</span
                >
                <span
                  class="pointer-events-none ml-auto flex shrink-0 items-center gap-1"
                  data-workspace-tab-controls
                >
                  <span
                    class="pointer-events-none flex h-4 max-w-14 shrink-0 items-center justify-end overflow-hidden"
                    data-workspace-tab-status-cluster
                  >
                    <WorkspaceStatusIcon status={workspaceStatusState} size={14} decorative />
                  </span>
                  <span class="size-5 shrink-0" data-workspace-tab-close-space aria-hidden="true"
                  ></span>
                </span>
              </button>
            </TooltipRich>
            <button
              type="button"
              class={cn(
                'absolute right-1 z-10 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-subtle outline-none! transition-opacity hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:opacity-100 forced-colors:focus-visible:text-[HighlightText]',
                isCurrent ? 'opacity-70' : 'opacity-0 group-hover/workspace-tab:opacity-100',
              )}
              onclick={(event) => closeWorkspace(workspaceId, event)}
              aria-label={m.layout_workspaceTabStrip_close_ariaLabel({
                name: workspace.title?.trim() || m.layout_workspaceTabStrip_untitled_label(),
              })}
              data-workspace-tab-close
            >
              <Fa icon={faXmark} size="xs" />
            </button>
          </div>
        {:else}
          <div
            class={cn(
              'group/workspace-tab relative flex h-8 w-full min-w-0 shrink-0 items-center border transition-[background-color,border-color,opacity,transform] motion-reduce:transition-none',
              isCurrent
                ? 'rounded-t-md border-border border-b-0 bg-sidebar text-foreground shadow-none'
                : 'rounded-md border-transparent text-muted-foreground',
            )}
            data-workspace-tab={workspaceId}
            data-workspace-tab-visual={workspaceId}
            data-workspace-tab-loading="true"
            data-active={isCurrent}
            style:border-radius={isCurrent
              ? `${WORKSPACE_TAB_CORNER_RADIUS_PX}px ${WORKSPACE_TAB_CORNER_RADIUS_PX}px 0 0`
              : `${WORKSPACE_TAB_CORNER_RADIUS_PX}px`}
            style:transition-duration={`${WORKSPACE_TAB_MOTION_DURATION_MS}ms`}
            style:transition-timing-function={WORKSPACE_TAB_MOTION_EASING}
            use:reportActiveTabBounds={isCurrent}
            use:registerTabSurface={workspaceId}
            role="presentation"
            oncontextmenu={(event) => handleWorkspaceTabContextMenu(event, workspaceId)}
          >
            <WorkspaceTabFlare
              side="leading"
              visible={isCurrent}
              durationMs={WORKSPACE_TAB_MOTION_DURATION_MS}
            />
            <WorkspaceTabFlare
              side="trailing"
              visible={isCurrent}
              durationMs={WORKSPACE_TAB_MOTION_DURATION_MS}
            />
            <button
              type="button"
              use:registerTabButton={workspaceId}
              class="absolute -inset-px flex min-w-0 cursor-pointer items-center rounded-[inherit] px-3 pr-8 text-left outline-none! forced-colors:focus-visible:text-[HighlightText]"
              onclick={(event) => void openWorkspace(workspaceId, event.detail === 0)}
              onkeydown={(event) => handleTabKeydown(event, workspaceId)}
              role="tab"
              aria-label={m.layout_workspaceTabStrip_loading_ariaLabel({ workspaceId })}
              aria-selected={isCurrent}
              aria-current={isCurrent ? 'page' : undefined}
              tabindex={isCurrent ? 0 : -1}
              data-workspace-tab-loading-target
            >
              <span
                class="h-2.5 w-24 animate-pulse rounded-full bg-sidebar-foreground/10 motion-reduce:animate-none"
                aria-hidden="true"
                data-workspace-tab-loading-indicator
              ></span>
            </button>
            <button
              type="button"
              class="absolute right-1 z-10 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-subtle opacity-70 outline-none! hover:bg-muted hover:text-foreground focus-visible:text-foreground forced-colors:focus-visible:text-[HighlightText]"
              onclick={(event) => closeWorkspace(workspaceId, event)}
              aria-label={m.layout_workspaceTabStrip_close_ariaLabel({ name: workspaceId })}
              data-workspace-tab-close
            >
              <Fa icon={faXmark} size="xs" />
            </button>
          </div>
        {/if}
      </div>
    {/each}
    <span class="sr-only" aria-live="polite">{reorderAnnouncement}</span>
  </div>
{/if}

{#if tabContextMenu}
  <SidebarContextMenu
    x={tabContextMenu.x}
    y={tabContextMenu.y}
    items={tabContextMenuItems}
    onClickOutside={() => (tabContextMenu = null)}
  />
{/if}

<style>
  [data-workspace-tab][data-active='true'] {
    border-bottom-width: 0;
    box-shadow: none;
  }

  button[data-workspace-tab-hover-trigger] {
    cursor: pointer;
  }

  button[data-workspace-tab-hover-trigger]:focus-visible [data-workspace-tab-title] {
    text-decoration-line: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 2px;
  }

  button[data-workspace-tab-loading-target]:focus-visible [data-workspace-tab-loading-indicator] {
    background-color: currentColor;
    opacity: 0.45;
  }

  button[data-workspace-tab-close]:focus-visible :global(svg) {
    transform: scale(1.15);
  }
</style>
