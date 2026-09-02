<script lang="ts">
  import { goto } from '$app/navigation';
  import { faArrowRight, faLayerGroup, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
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
  import { getWorkspaceTabBulkCloseIds } from './workspace-tab-context-actions';
  import {
    WORKSPACE_TAB_BORDER_WIDTH_PX,
    WORKSPACE_TAB_FLARE_BOTTOM_PX,
    WORKSPACE_TAB_FLARE_INNER_PX,
    WORKSPACE_TAB_FLARE_OFFSET_PX,
    WORKSPACE_TAB_FLARE_OUTER_PX,
    WORKSPACE_TAB_FLARE_RADIUS_PX,
    WORKSPACE_TAB_FLARE_SIZE_PX,
    WORKSPACE_TAB_MOTION_DURATION_MS,
    WORKSPACE_TAB_MOTION_EASING,
    workspaceTabMotionEasing,
  } from './titlebar-geometry';

  interface Props {
    onActiveTabBoundsChange?: (bounds: { left: number; width: number } | null) => void;
    onActiveTabTrackingChange?: (tracking: boolean) => void;
    activeWorkspaceId?: string | null;
    horizontalPositionTrackingKey?: number;
  }

  let {
    onActiveTabBoundsChange,
    onActiveTabTrackingChange,
    activeWorkspaceId,
    horizontalPositionTrackingKey = 0,
  }: Props = $props();

  const currentWorkspaceTabId$ = selectCurrentWorkspaceTabId();
  const workspaceTabOrder$ = selectWorkspaceTabOrder();
  const workspaceItems$ = selectWorkspaceItems();
  const workspaceTabStatuses$ = selectWorkspaceTabStatuses();
  let workspaceHoverCardOpenDelay = $state(WORKSPACE_HOVER_CARD_OPEN_DELAY_MS);
  const openWorkspaceHoverCardIds = new Set<string>();
  const pointerOpenEligibleWorkspaceHoverCardIds = new Set<string>();

  const workspaceById = $derived(
    new Map($workspaceItems$.map((workspace) => [String(workspace.id), workspace])),
  );
  // Persisted tab IDs are available before workspace metadata hydrates. Keep
  // them in the strip so inactive tabs do not disappear during refresh.
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
  let suppressClickWorkspaceId: string | null = null;
  const renderedTabOrder = $derived(proposedTabOrder ?? $workspaceTabOrder$);
  let reorderAnnouncement = $state('');
  let activeStreamsVersion = $state(0);
  let stripElement = $state<HTMLDivElement | null>(null);
  let isOverflowing = $state(false);
  const tabButtons = new Map<string, HTMLButtonElement>();
  const tabSurfaces = new Map<string, HTMLElement>();
  const ACTIVE_TAB_EDGE_GAP = 2;
  const POINTER_DRAG_THRESHOLD = 4;
  const leadingFlareFillPath = `M 0 ${WORKSPACE_TAB_FLARE_SIZE_PX} H ${WORKSPACE_TAB_FLARE_SIZE_PX} V ${WORKSPACE_TAB_FLARE_INNER_PX} H ${WORKSPACE_TAB_FLARE_OUTER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 1 ${WORKSPACE_TAB_FLARE_INNER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX} Z`;
  const leadingFlareStrokePath = `M ${WORKSPACE_TAB_FLARE_OUTER_PX} ${WORKSPACE_TAB_FLARE_INNER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 1 ${WORKSPACE_TAB_FLARE_INNER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX}`;
  const trailingFlareFillPath = `M ${WORKSPACE_TAB_FLARE_SIZE_PX} ${WORKSPACE_TAB_FLARE_SIZE_PX} H 0 V ${WORKSPACE_TAB_FLARE_INNER_PX} H ${WORKSPACE_TAB_FLARE_INNER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 0 ${WORKSPACE_TAB_FLARE_OUTER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX} Z`;
  const trailingFlareStrokePath = `M ${WORKSPACE_TAB_FLARE_INNER_PX} ${WORKSPACE_TAB_FLARE_INNER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 0 ${WORKSPACE_TAB_FLARE_OUTER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX}`;
  // Active tab bounds drive the parent border mask that hides the sidebar
  // border under the active tab. Svelte's animate:flip moves tabs via CSS
  // transform, which ResizeObserver does not fire on, so during the flip the
  // mask stays put while the tab slides. Poll via rAF for the full layout
  // transition whenever tab order or title-bar positioning changes.
  const activeTabBoundsPollers = new Set<() => void>();
  const ACTIVE_TAB_TRACKING_DURATION_MS = 240;
  let autoScrollFrame: number | null = null;
  let layoutTracking = false;
  let dragTracking = false;
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
    onActiveTabTrackingChange?.(layoutTracking || dragTracking);
  }

  onMount(() => {
    activeStreamsTracker.startPolling();
    const unsubscribe = activeStreamsTracker.subscribe(() => activeStreamsVersion++);
    const unsubscribeHoverCardIntent = workspaceHoverCardIntentSession.subscribe(
      (delay) => (workspaceHoverCardOpenDelay = delay),
    );
    const handleMoved = (event: Event) =>
      handleGlobalWorkspaceTabMoved(event as CustomEvent<WorkspaceTabMovedEventDetail>);
    window.addEventListener(WORKSPACE_TAB_MOVED_EVENT, handleMoved);
    return () => {
      unsubscribe();
      unsubscribeHoverCardIntent();
      openWorkspaceHoverCardIds.forEach(() => workspaceHoverCardIntentSession.notifyClosed());
      openWorkspaceHoverCardIds.clear();
      pointerOpenEligibleWorkspaceHoverCardIds.clear();
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
      isOverflowing = strip.scrollWidth > strip.clientWidth;
    };
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(strip);
    return () => observer.disconnect();
  });

  $effect(() => {
    void renderedTabOrder;
    void horizontalPositionTrackingKey;
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
      activeTabBoundsPollers.forEach((poll) => poll());
      if (timestamp - startedAt < ACTIVE_TAB_TRACKING_DURATION_MS) {
        frame = requestAnimationFrame(tick);
      } else {
        layoutTracking = false;
        reportActiveTabTracking();
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
    const strip = node.closest('[data-workspace-tab-strip]');

    // Batched read phase: measure everything against one clean layout,
    // compute the clamp delta, then hand the scrollLeft mutation and the
    // bounds report to the write phase — no interleaved read/write reflows.
    const runFrame = () => {
      readPending = false;
      const shouldClamp = clampQueued;
      clampQueued = false;
      if (!active) return;

      const tabRect = node.getBoundingClientRect();
      const titlebarRect = node.closest('.window-title-bar')?.getBoundingClientRect() ?? null;
      let scrollDelta = 0;
      let scrollTarget: number | null = null;
      if (shouldClamp && strip && !draggedWorkspaceId) {
        const stripRect = strip.getBoundingClientRect();
        if (tabRect.left < stripRect.left + ACTIVE_TAB_EDGE_GAP) {
          scrollDelta = tabRect.left - stripRect.left - ACTIVE_TAB_EDGE_GAP;
        } else if (tabRect.right > stripRect.right - ACTIVE_TAB_EDGE_GAP) {
          scrollDelta = tabRect.right - stripRect.right + ACTIVE_TAB_EDGE_GAP;
        }
        if (scrollDelta !== 0) scrollTarget = strip.scrollLeft + scrollDelta;
      }
      if (scrollTarget === null && !titlebarRect) return;

      if (writePending) cancelWrite?.();
      writePending = true;
      cancelWrite = scheduleLayoutWrite(() => {
        writePending = false;
        if (!active) return;
        if (scrollTarget !== null && strip) strip.scrollLeft = scrollTarget;
        if (!titlebarRect) return;
        if (scrollTarget === null) {
          // Common path: report straight from the read-phase measurement.
          onActiveTabBoundsChange?.({
            left: tabRect.left - titlebarRect.left,
            width: tabRect.width,
          });
          return;
        }
        // A clamp moved the strip, so the read-phase rects are stale and
        // scrollLeft may have been boundary-clamped — re-measure. This is
        // the one remaining forced read, and it only runs when the active
        // tab was actually scrolled into view (at most once per switch).
        const movedTabRect = node.getBoundingClientRect();
        const movedTitlebarRect = node.closest('.window-title-bar')?.getBoundingClientRect();
        if (!movedTitlebarRect) return;
        onActiveTabBoundsChange?.({
          left: movedTabRect.left - movedTitlebarRect.left,
          width: movedTabRect.width,
        });
      });
    };

    // The pending flags (not the cancel handles) gate re-scheduling: with a
    // synchronously-invoking rAF stub the task runs before the handle
    // assignment, so a handle-based gate would deadlock.
    const schedule = () => {
      if (readPending) return;
      readPending = true;
      cancelRead = scheduleLayoutRead(runFrame);
    };

    const scheduleClampAndReport = () => {
      clampQueued = true;
      schedule();
    };

    // User scrolling must not be fought by the active-tab clamp: scroll only
    // refreshes the reported bounds so the titlebar mask keeps tracking.
    const scheduleBoundsReport = () => schedule();

    const resizeObserver = new ResizeObserver(scheduleClampAndReport);
    resizeObserver.observe(node);
    window.addEventListener('resize', scheduleClampAndReport);
    strip?.addEventListener('scroll', scheduleBoundsReport);
    activeTabBoundsPollers.add(scheduleClampAndReport);
    scheduleClampAndReport();

    return {
      update(nextIsActive: boolean) {
        const wasActive = active;
        active = nextIsActive;
        if (active) scheduleClampAndReport();
        else if (wasActive) onActiveTabBoundsChange?.(null);
      },
      destroy() {
        cancelRead?.();
        cancelWrite?.();
        activeTabBoundsPollers.delete(scheduleClampAndReport);
        resizeObserver.disconnect();
        window.removeEventListener('resize', scheduleClampAndReport);
        strip?.removeEventListener('scroll', scheduleBoundsReport);
        if (active) onActiveTabBoundsChange?.(null);
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
    const wasCurrent = $currentWorkspaceTabId$ === workspaceId;
    appStore.dispatch(closeWorkspaceTab(workspaceId));
    if (!wasCurrent) return;

    const nextWorkspaceId = selectCurrentWorkspaceTabId.select(appStore.state);
    void goto(
      nextWorkspaceId
        ? `/workspace/${nextWorkspaceId}`
        : resolveEmptyWindowDestination(selectWorkspaceItems.select(appStore.state)),
    );
  }

  function closeWorkspaceTabs(workspaceIds: string[], focusWorkspaceId?: string) {
    if (workspaceIds.length === 0) return;
    if (focusWorkspaceId) appStore.dispatch(openWorkspaceTab(focusWorkspaceId));
    workspaceIds.forEach((workspaceId) => appStore.dispatch(closeWorkspaceTab(workspaceId)));
    const nextWorkspaceId = focusWorkspaceId ?? selectCurrentWorkspaceTabId.select(appStore.state);
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
    draggedWorkspaceId = pointerGrab.workspaceId;
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
</script>

<svelte:window onkeydown={handleDragKeydown} />

{#if $workspaceTabOrder$.length > 0}
  <!-- pl-7 keeps the active tab's 12px corner-flare SVG inside the padding box
       and gives the first tab 24px of clearance after the -ml-1 strip offset.
       The right margin is conditional: -mr-2.5 keeps the "+" launcher tight
       against the last tab's pr-3 padding when everything fits, but during
       overflow the clipped tab edge is flush with the strip border, so mr-1
       (plus the parent's gap-1) keeps 8px of clearance before the "+".
       The 2px bottom padding contains the dropped active-tab flares inside
       the scrollport; the matching negative margin preserves the strip's
       existing 32px titlebar footprint while preventing vertical overflow.
       data-app-region-clip: tabs scrolled out of this container must not carve
       no-drag holes in the titlebar drag strip (unclipped-geometry carving,
       intent-hq/monorepo#2400; rules in app.css). -->
  <div
    bind:this={stripElement}
    data-workspace-tab-scroller
    class={cn(
      'flex w-fit min-w-0 max-w-[100%] items-center gap-0.5 overflow-x-auto overflow-y-hidden pl-7 pr-3 -ml-1 scrollbar-none',
      isOverflowing ? 'mr-1' : '-mr-2.5',
      draggedWorkspaceId && 'cursor-grabbing',
    )}
    aria-label={m.layout_workspaceTabStrip_openSpaces_ariaLabel()}
    role="tablist"
    tabindex="-1"
    style:padding-bottom="2px"
    style:margin-bottom="-2px"
    data-workspace-tab-strip
    data-app-region-clip
    onpointermove={handleDragPointerMove}
    onpointerup={handleDragPointerUp}
    onpointercancel={handleDragPointerCancel}
    onlostpointercapture={handleLostPointerCapture}
  >
    {#each renderedTabOrder as workspaceId (workspaceId)}
      {@const workspace = workspaceById.get(workspaceId)}
      {@const isDragged = draggedWorkspaceId === workspaceId}
      {@const isCurrent =
        workspaceId ===
        (activeWorkspaceId === undefined ? $currentWorkspaceTabId$ : activeWorkspaceId)}
      <div
        class="min-w-0 shrink-0"
        data-workspace-tab-motion={workspaceId}
        style:width={isDragged ? `${dragSession?.origin.width ?? 160}px` : undefined}
        style:height={isDragged ? `${dragSession?.origin.height ?? 32}px` : undefined}
        animate:flip={{
          duration: isDragged ? 0 : WORKSPACE_TAB_MOTION_DURATION_MS,
          easing: workspaceTabMotionEasing,
        }}
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
              'group/workspace-tab flex h-8 w-40 max-w-[40vw] shrink-0 items-center border transition-[background-color,border-color] motion-reduce:transition-none',
              isCurrent
                ? 'rounded-t-md border-border border-b-0 bg-sidebar text-foreground shadow-none'
                : 'rounded-md border-transparent text-muted-foreground hover:bg-sidebar/50 hover:text-foreground',
              isDragged
                ? 'pointer-events-none fixed z-50 cursor-grabbing'
                : 'relative cursor-pointer',
            )}
            data-workspace-tab={workspaceId}
            data-active={isCurrent}
            data-dragging={isDragged}
            style:left={isDragged && dragSession
              ? `${dragClientX - dragSession.pointerOffsetX}px`
              : undefined}
            style:top={isDragged && dragSession ? `${dragSession.origin.top - 2}px` : undefined}
            style:width={isDragged && dragSession ? `${dragSession.origin.width}px` : undefined}
            style:height={isDragged && dragSession ? `${dragSession.origin.height}px` : undefined}
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
            <!-- The 13px canvas contains the 12px radius plus both half-stroke edges.
                 Its arc starts on the tab border centre and ends on the title-bar border centre. -->
            <svg
              class="pointer-events-none absolute overflow-visible text-sidebar transition-opacity motion-reduce:transition-none"
              style:left={`${-WORKSPACE_TAB_FLARE_OFFSET_PX}px`}
              style:bottom={`${WORKSPACE_TAB_FLARE_BOTTOM_PX}px`}
              style:width={`${WORKSPACE_TAB_FLARE_SIZE_PX}px`}
              style:height={`${WORKSPACE_TAB_FLARE_SIZE_PX}px`}
              style:opacity={isCurrent ? 1 : 0}
              style:transition-duration={isDragged
                ? '0ms'
                : `${WORKSPACE_TAB_MOTION_DURATION_MS}ms`}
              style:transition-timing-function={WORKSPACE_TAB_MOTION_EASING}
              viewBox={`0 0 ${WORKSPACE_TAB_FLARE_SIZE_PX} ${WORKSPACE_TAB_FLARE_SIZE_PX}`}
              aria-hidden="true"
              data-workspace-tab-leading-flare
            >
              <path d={leadingFlareFillPath} fill="currentColor" />
              <path
                class="stroke-border"
                d={leadingFlareStrokePath}
                fill="none"
                stroke-width={WORKSPACE_TAB_BORDER_WIDTH_PX}
              />
            </svg>
            <svg
              class="pointer-events-none absolute overflow-visible text-sidebar transition-opacity motion-reduce:transition-none"
              style:right={`${-WORKSPACE_TAB_FLARE_OFFSET_PX}px`}
              style:bottom={`${WORKSPACE_TAB_FLARE_BOTTOM_PX}px`}
              style:width={`${WORKSPACE_TAB_FLARE_SIZE_PX}px`}
              style:height={`${WORKSPACE_TAB_FLARE_SIZE_PX}px`}
              style:opacity={isCurrent ? 1 : 0}
              style:transition-duration={isDragged
                ? '0ms'
                : `${WORKSPACE_TAB_MOTION_DURATION_MS}ms`}
              style:transition-timing-function={WORKSPACE_TAB_MOTION_EASING}
              viewBox={`0 0 ${WORKSPACE_TAB_FLARE_SIZE_PX} ${WORKSPACE_TAB_FLARE_SIZE_PX}`}
              aria-hidden="true"
              data-workspace-tab-trailing-flare
            >
              <path d={trailingFlareFillPath} fill="currentColor" />
              <path
                class="stroke-border"
                d={trailingFlareStrokePath}
                fill="none"
                stroke-width={WORKSPACE_TAB_BORDER_WIDTH_PX}
              />
            </svg>
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
              'group/workspace-tab relative flex h-8 w-40 max-w-[40vw] shrink-0 items-center border transition-[background-color,border-color,opacity,transform] motion-reduce:transition-none',
              isCurrent
                ? 'rounded-t-md border-border border-b-0 bg-sidebar text-foreground shadow-none'
                : 'rounded-md border-transparent text-muted-foreground',
            )}
            data-workspace-tab={workspaceId}
            data-workspace-tab-loading="true"
            data-active={isCurrent}
            style:transition-duration={`${WORKSPACE_TAB_MOTION_DURATION_MS}ms`}
            style:transition-timing-function={WORKSPACE_TAB_MOTION_EASING}
            use:reportActiveTabBounds={isCurrent}
            use:registerTabSurface={workspaceId}
            role="presentation"
            oncontextmenu={(event) => handleWorkspaceTabContextMenu(event, workspaceId)}
          >
            <svg
              class="pointer-events-none absolute overflow-visible text-sidebar transition-opacity motion-reduce:transition-none"
              style:left={`${-WORKSPACE_TAB_FLARE_OFFSET_PX}px`}
              style:bottom={`${WORKSPACE_TAB_FLARE_BOTTOM_PX}px`}
              style:width={`${WORKSPACE_TAB_FLARE_SIZE_PX}px`}
              style:height={`${WORKSPACE_TAB_FLARE_SIZE_PX}px`}
              style:opacity={isCurrent ? 1 : 0}
              style:transition-duration={`${WORKSPACE_TAB_MOTION_DURATION_MS}ms`}
              style:transition-timing-function={WORKSPACE_TAB_MOTION_EASING}
              viewBox={`0 0 ${WORKSPACE_TAB_FLARE_SIZE_PX} ${WORKSPACE_TAB_FLARE_SIZE_PX}`}
              aria-hidden="true"
              data-workspace-tab-leading-flare
            >
              <path d={leadingFlareFillPath} fill="currentColor" />
              <path
                class="stroke-border"
                d={leadingFlareStrokePath}
                fill="none"
                stroke-width={WORKSPACE_TAB_BORDER_WIDTH_PX}
              />
            </svg>
            <svg
              class="pointer-events-none absolute overflow-visible text-sidebar transition-opacity motion-reduce:transition-none"
              style:right={`${-WORKSPACE_TAB_FLARE_OFFSET_PX}px`}
              style:bottom={`${WORKSPACE_TAB_FLARE_BOTTOM_PX}px`}
              style:width={`${WORKSPACE_TAB_FLARE_SIZE_PX}px`}
              style:height={`${WORKSPACE_TAB_FLARE_SIZE_PX}px`}
              style:opacity={isCurrent ? 1 : 0}
              style:transition-duration={`${WORKSPACE_TAB_MOTION_DURATION_MS}ms`}
              style:transition-timing-function={WORKSPACE_TAB_MOTION_EASING}
              viewBox={`0 0 ${WORKSPACE_TAB_FLARE_SIZE_PX} ${WORKSPACE_TAB_FLARE_SIZE_PX}`}
              aria-hidden="true"
              data-workspace-tab-trailing-flare
            >
              <path d={trailingFlareFillPath} fill="currentColor" />
              <path
                class="stroke-border"
                d={trailingFlareStrokePath}
                fill="none"
                stroke-width={WORKSPACE_TAB_BORDER_WIDTH_PX}
              />
            </svg>
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
