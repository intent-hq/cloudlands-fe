<script lang="ts">
  import { goto } from '$app/navigation';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import { formatWorkspaceTabStatusSummary } from '$lib/components/workspace/utils/workspace-tab-status-presentation';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
    type WorkspaceStatusPresentationState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import { getWorkspaceViewTransitionName } from '$lib/components/workspace/workspace-view-transition';
  import {
    closeWorkspaceTab,
    endDrag,
    moveWorkspace,
    openWorkspaceTab,
    startDrag,
  } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    getReleasedWorkspaceTabMove,
    getWorkspaceTabInsertionIndex,
    proposeWorkspaceTabOrder,
    type WorkspaceTabSlot,
  } from '$lib/components/workspace/utils/workspace-tab-drag';
  import {
    selectCurrentWorkspaceTabId,
    selectWorkspaceTabOrder,
    selectWorkspaceViewMode,
  } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectWorkspaceTabStatuses } from '$store/renderer/slices/hud/hud-selectors';
  import type { WorkspaceTabStatus } from '$store/renderer/slices/hud/hud-types';
  import { WorkspaceStatus } from '$shared/types';
  import { resolveEmptyWindowDestination } from '$features/workspace/utils/empty-window-destination';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    onActiveTabBoundsChange?: (bounds: { left: number; width: number } | null) => void;
    onActiveTabTrackingChange?: (tracking: boolean) => void;
    activeWorkspaceId?: string | null;
  }

  let { onActiveTabBoundsChange, onActiveTabTrackingChange, activeWorkspaceId }: Props = $props();

  const currentWorkspaceTabId$ = selectCurrentWorkspaceTabId();
  const workspaceTabOrder$ = selectWorkspaceTabOrder();
  const workspaceViewMode$ = selectWorkspaceViewMode();
  const workspaceItems$ = selectWorkspaceItems();
  const workspaceTabStatuses$ = selectWorkspaceTabStatuses();

  const workspaceById = $derived(
    new Map($workspaceItems$.map((workspace) => [String(workspace.id), workspace])),
  );
  // Persisted tab IDs are available before workspace metadata hydrates. Keep
  // them in the strip so inactive tabs do not disappear during refresh.
  const visibleTabIds = $derived($workspaceTabOrder$);

  interface WorkspaceTabDragSession {
    originalOrder: string[];
    startClientX: number;
    pointerOffsetX: number;
    origin: { left: number; top: number; width: number; height: number };
    slots: WorkspaceTabSlot[];
  }

  let draggedWorkspaceId = $state<string | null>(null);
  let dragSession = $state<WorkspaceTabDragSession | null>(null);
  let dragClientX = $state(0);
  let proposedTabOrder = $state<string[] | null>(null);
  const renderedTabOrder = $derived(proposedTabOrder ?? $workspaceTabOrder$);
  let reorderAnnouncement = $state('');
  let activeStreamsVersion = $state(0);
  let stripElement = $state<HTMLDivElement | null>(null);
  let isOverflowing = $state(false);
  const tabButtons = new Map<string, HTMLButtonElement>();
  const tabSurfaces = new Map<string, HTMLElement>();
  const ACTIVE_TAB_EDGE_GAP = 2;
  // Active tab bounds drive the parent border mask that hides the sidebar
  // border under the active tab. Svelte's animate:flip moves tabs via CSS
  // transform, which ResizeObserver does not fire on, so during the flip the
  // mask stays put while the tab slides. Poll via rAF for the flip window
  // whenever tab order changes so the mask tracks the moving tab.
  const activeTabBoundsPollers = new Set<() => void>();
  const FLIP_ANIMATION_FRAMES = 14;

  onMount(() => {
    activeStreamsTracker.startPolling();
    return activeStreamsTracker.subscribe(() => activeStreamsVersion++);
  });

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
    if (activeTabBoundsPollers.size === 0) return;
    onActiveTabTrackingChange?.(true);
    let framesLeft = FLIP_ANIMATION_FRAMES;
    let frame: number | null = null;
    let cancelled = false;
    const tick = () => {
      frame = null;
      if (cancelled) return;
      activeTabBoundsPollers.forEach((poll) => poll());
      framesLeft -= 1;
      if (framesLeft > 0) {
        frame = requestAnimationFrame(tick);
      } else {
        onActiveTabTrackingChange?.(false);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      onActiveTabTrackingChange?.(false);
    };
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
    let frameId: number | null = null;
    let clampQueued = false;
    const strip = node.closest('[data-workspace-tab-strip]');

    const clampActiveTabIntoView = () => {
      if (!strip) return;
      const tabRect = node.getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      if (tabRect.left < stripRect.left + ACTIVE_TAB_EDGE_GAP) {
        strip.scrollLeft += tabRect.left - stripRect.left - ACTIVE_TAB_EDGE_GAP;
      } else if (tabRect.right > stripRect.right - ACTIVE_TAB_EDGE_GAP) {
        strip.scrollLeft += tabRect.right - stripRect.right + ACTIVE_TAB_EDGE_GAP;
      }
    };

    const reportBounds = () => {
      const titlebar = node.closest('.window-title-bar');
      if (!titlebar) return;
      const tabRect = node.getBoundingClientRect();
      const titlebarRect = titlebar.getBoundingClientRect();
      onActiveTabBoundsChange?.({
        left: tabRect.left - titlebarRect.left,
        width: tabRect.width,
      });
    };

    const clampAndReport = () => {
      if (!active) return;
      clampActiveTabIntoView();
      reportBounds();
    };

    const runFrame = () => {
      frameId = null;
      const shouldClamp = clampQueued;
      clampQueued = false;
      if (!active) return;
      if (shouldClamp) clampActiveTabIntoView();
      reportBounds();
    };

    const schedule = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(runFrame);
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
    activeTabBoundsPollers.add(clampAndReport);
    scheduleClampAndReport();

    return {
      update(nextIsActive: boolean) {
        const wasActive = active;
        active = nextIsActive;
        if (active) scheduleClampAndReport();
        else if (wasActive) onActiveTabBoundsChange?.(null);
      },
      destroy() {
        if (frameId !== null) cancelAnimationFrame(frameId);
        activeTabBoundsPollers.delete(clampAndReport);
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

  $effect(() => {
    if (
      !draggedWorkspaceId &&
      proposedTabOrder &&
      ordersMatch(proposedTabOrder, $workspaceTabOrder$)
    ) {
      proposedTabOrder = null;
    }
  });

  function handleDragStart(event: DragEvent, workspaceId: string) {
    if (!event.dataTransfer) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const startClientX = event.clientX;
    const originalOrder = [...visibleTabIds];
    draggedWorkspaceId = workspaceId;
    dragClientX = startClientX;
    proposedTabOrder = originalOrder;
    dragSession = {
      originalOrder,
      startClientX,
      pointerOffsetX: Math.max(0, Math.min(startClientX - rect.left, rect.width)),
      origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      slots: originalOrder.flatMap((id) => {
        if (id === workspaceId) return [];
        const slotRect = tabSurfaces.get(id)?.getBoundingClientRect();
        return slotRect ? [{ id, centerX: slotRect.left + slotRect.width / 2 }] : [];
      }),
    };
    event.dataTransfer.setData('text/plain', workspaceId);
    event.dataTransfer.effectAllowed = 'move';
    const transparentDragImage = document.createElement('div');
    transparentDragImage.style.cssText =
      'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;';
    document.body.append(transparentDragImage);
    event.dataTransfer.setDragImage?.(transparentDragImage, 0, 0);
    requestAnimationFrame(() => transparentDragImage.remove());
    appStore.dispatch(startDrag());
  }

  function handleDragOver(event: DragEvent) {
    if (!draggedWorkspaceId || !dragSession) return;
    event.preventDefault();
    handleDragMove(event);
    const insertionIndex = getWorkspaceTabInsertionIndex(
      event.clientX,
      dragSession.pointerOffsetX,
      dragSession.origin.width,
      dragSession.slots,
    );
    const nextOrder = proposeWorkspaceTabOrder(
      dragSession.originalOrder,
      draggedWorkspaceId,
      insertionIndex,
    );
    if (!proposedTabOrder || !ordersMatch(nextOrder, proposedTabOrder))
      proposedTabOrder = nextOrder;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleDragMove(event: DragEvent) {
    if (!draggedWorkspaceId || !dragSession) return;
    if (event.clientX === 0 && event.clientY === 0) return;
    dragClientX = event.clientX;
  }

  function finishDrag(keepProposedOrder = false) {
    if (!draggedWorkspaceId) return;
    draggedWorkspaceId = null;
    dragSession = null;
    if (!keepProposedOrder) proposedTabOrder = null;
    appStore.dispatch(endDrag());
  }

  function handleDrop(event: DragEvent) {
    if (!draggedWorkspaceId || !dragSession) return;
    event.preventDefault();
    handleDragOver(event);
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

  function handleDragEnd() {
    finishDrag();
  }
</script>

{#if $workspaceTabOrder$.length > 0}
  <!-- pl-3 keeps the active tab's 12px corner-flare SVG inside the padding box
       so overflow-x-auto does not clip it; -ml-1 gives that back minus 8px so
       the first tab sits clear of the view-mode toggle instead of flush.
       The right margin is conditional: -mr-2.5 keeps the "+" launcher tight
       against the last tab's pr-3 padding when everything fits, but during
       overflow the clipped tab edge is flush with the strip border, so mr-1
       (plus the parent's gap-1) keeps 8px of clearance before the "+".
       data-app-region-clip: tabs scrolled out of this container must not carve
       no-drag holes in the titlebar drag strip (unclipped-geometry carving,
       intent-hq/monorepo#2400; rules in app.css). -->
  <div
    bind:this={stripElement}
    class={cn(
      'flex w-fit min-w-0 max-w-[100%] items-center gap-0.5 overflow-x-auto pl-3 -ml-1 pr-3 scrollbar-none',
      isOverflowing ? 'mr-1' : '-mr-2.5',
    )}
    aria-label={m.layout_workspaceTabStrip_openSpaces_ariaLabel()}
    role="tablist"
    tabindex="-1"
    data-workspace-tab-strip
    data-app-region-clip
    ondragover={handleDragOver}
    ondrop={handleDrop}
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
        animate:flip={{ duration: isDragged ? 0 : 180, easing: cubicOut }}
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
              class="h-full w-full rounded-md border border-border bg-sidebar/35"
              aria-hidden="true"
              data-workspace-tab-placeholder={workspaceId}
            ></div>
          {/if}
          <div
            class={cn(
              'group/workspace-tab flex h-8 w-40 max-w-[40vw] shrink-0 items-center border transition-[background-color,border-color,box-shadow] motion-reduce:transition-none',
              isCurrent
                ? 'rounded-t-md border-border border-b-transparent bg-sidebar text-foreground'
                : 'rounded-md border-transparent text-muted-foreground hover:bg-sidebar/50 hover:text-foreground',
              isDragged ? 'pointer-events-none fixed z-50 cursor-grabbing shadow-lg' : 'relative',
            )}
            data-workspace-tab={workspaceId}
            data-active={isCurrent}
            data-dragging={isDragged}
            style:view-transition-name={$workspaceViewMode$ === 'single'
              ? getWorkspaceViewTransitionName(workspaceId)
              : undefined}
            style:left={isDragged && dragSession
              ? `${dragSession.origin.left + dragClientX - dragSession.startClientX}px`
              : undefined}
            style:top={isDragged && dragSession ? `${dragSession.origin.top}px` : undefined}
            style:width={isDragged && dragSession ? `${dragSession.origin.width}px` : undefined}
            style:height={isDragged && dragSession ? `${dragSession.origin.height}px` : undefined}
            use:reportActiveTabBounds={isCurrent}
            use:registerTabSurface={workspaceId}
            role="presentation"
            draggable={true}
            ondragstart={(event) => handleDragStart(event, workspaceId)}
            ondrag={handleDragMove}
            ondragend={handleDragEnd}
          >
            {#if isCurrent}
              <!-- Concave outward flare: extends bg-sidebar below-outside the tab's bottom corners
                     so the active tab appears to flow into the panel below (Chrome-tab style).
                     Uses a 12x12 quarter-arc dropped 2px past the tab bottom so the concave
                     curve terminates on the panel's top border. The right flare's `-12.5px`
                     offset + 1px seam-fill rect compensates for the arc-stroke straddling the
                     right-edge pixel boundary so no gap shows between flare and tab side. -->
              <svg
                class="pointer-events-none absolute left-[-12px] -bottom-0.5 size-[12px] overflow-visible text-sidebar"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path d="M 0 12 L 12 12 L 12 0 A 12 12 0 0 1 0 12 Z" fill="currentColor" />
                <path
                  class="stroke-border"
                  d="M 12 0 A 12 12 0 0 1 0 12"
                  fill="none"
                  stroke-width="1"
                />
              </svg>
              <svg
                class="pointer-events-none absolute right-[-12.5px] -bottom-0.5 size-[12px] overflow-visible text-sidebar"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path d="M 12 12 L 0 12 L 0 0 A 12 12 0 0 0 12 12 Z" fill="currentColor" />
                <rect x="-1" width="1" height="100%" fill="currentColor" />
                <path
                  class="stroke-border"
                  d="M 0 0 A 12 12 0 0 0 12 12"
                  fill="none"
                  stroke-width="1"
                />
              </svg>
            {/if}
            <TooltipRich
              side="bottom"
              align="start"
              delayDuration={500}
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
                class="flex h-full w-full min-w-0 cursor-pointer items-center gap-1 truncate rounded-[inherit] pl-3 pr-1 text-left text-xs font-medium outline-none! active:cursor-grabbing focus-visible:text-foreground forced-colors:focus-visible:text-[HighlightText]"
                onclick={(event) => void openWorkspace(workspaceId, event.detail === 0)}
                onkeydown={(event) => handleTabKeydown(event, workspaceId)}
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
              'group/workspace-tab relative flex h-8 w-40 max-w-[40vw] shrink-0 items-center border transition-[background-color,border-color,box-shadow,opacity,transform] motion-reduce:transition-none',
              isCurrent
                ? 'rounded-t-md border-border border-b-transparent bg-sidebar text-foreground'
                : 'rounded-md border-transparent text-muted-foreground',
            )}
            data-workspace-tab={workspaceId}
            data-workspace-tab-loading="true"
            data-active={isCurrent}
            style:view-transition-name={$workspaceViewMode$ === 'single'
              ? getWorkspaceViewTransitionName(workspaceId)
              : undefined}
            use:reportActiveTabBounds={isCurrent}
            use:registerTabSurface={workspaceId}
            role="presentation"
          >
            {#if isCurrent}
              <svg
                class="pointer-events-none absolute left-[-12px] -bottom-0.5 size-[12px] overflow-visible text-sidebar"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path d="M 0 12 L 12 12 L 12 0 A 12 12 0 0 1 0 12 Z" fill="currentColor" />
                <path
                  class="stroke-border"
                  d="M 12 0 A 12 12 0 0 1 0 12"
                  fill="none"
                  stroke-width="1"
                />
              </svg>
              <svg
                class="pointer-events-none absolute right-[-12.5px] -bottom-0.5 size-[12px] overflow-visible text-sidebar"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path d="M 12 12 L 0 12 L 0 0 A 12 12 0 0 0 12 12 Z" fill="currentColor" />
                <rect x="-1" width="1" height="100%" fill="currentColor" />
                <path
                  class="stroke-border"
                  d="M 0 0 A 12 12 0 0 0 12 12"
                  fill="none"
                  stroke-width="1"
                />
              </svg>
            {/if}
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

<style>
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
