<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { goto } from '$app/navigation';
  import WorkspaceSurface from '../../../routes/(app)/workspace/[id]/WorkspaceSurface.svelte';
  import { getWorkspaceViewTransitionName } from './workspace-view-transition';
  import ResizablePanelGroup from '$lib/components/layout/ResizablePanelGroup.svelte';
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
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
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
    scrollWorkspaceColumnIntoView,
    scrollWorkspacePanelIntoView,
  } from './utils/workspace-column-scroll';
  import {
    createColumnVisibilityTracker,
    type ColumnVisibilityTracker,
    type TrackedColumnElement,
  } from './utils/column-visibility';
  import AllWorkspacesCard from '$lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte';
  import { CONTAINED_PANEL_INLINE_CHROME } from '$shared/panel-layout-sizing';
  import { m } from '$shared/paraglide/messages.js';

  const currentWorkspaceId$ = selectCurrentWorkspaceTabId();
  const workspaceStacks$ = selectWorkspaceStacks();
  const panelCanvasWidthsByWorkspaceId$ = selectPanelCanvasWidthsByWorkspaceId();
  const panelColumnCountsByWorkspaceId$ = selectPanelColumnCountsByWorkspaceId();
  const focusedPanelTargetsByWorkspaceId$ = selectFocusedPanelTargetsByWorkspaceId();
  const LAYOUT_WIDTH_SETTLE_MS = 340;
  let sidebarWidths = $state<Record<string, number>>({});
  let livePanelCanvasWidths = $state<Record<string, number>>({});
  let columnsScroller = $state<HTMLDivElement | null>(null);
  let panelPreviewWidthRatios = $state<Record<string, number>>({});
  let draggedWorkspaceId = $state<string | null>(null);
  let dragOverWorkspaceId = $state<string | null>(null);
  let dragOverPlacement = $state<WorkspaceDragPlacement | null>(null);
  let lifecycleMotionReady = $state(false);
  let lastScrolledWorkspaceId: string | null = null;
  let previousPanelColumnCounts: Record<string, number> = {};
  let panelColumnCountsInitialized = false;
  let revealFrame: number | null = null;
  let revealSettleTimer: ReturnType<typeof setTimeout> | null = null;
  let visibleWorkspaceIds = $state<ReadonlySet<string>>(new Set());
  let columnVisibilityTracker: ColumnVisibilityTracker | null = null;
  const layoutMotionDuration = $derived(lifecycleMotionReady ? 180 : 0);
  const visibleWorkspaceIdsAttribute = $derived([...visibleWorkspaceIds].sort().join(','));

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
        scheduleWorkspaceReveal(targetWorkspaceId, 'start', 'smooth', false);
      }
    };

    window.addEventListener('keydown', handleWorkspaceColumnShortcut, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleWorkspaceColumnShortcut, { capture: true });
  });

  function cancelPendingReveal() {
    if (revealFrame !== null) cancelAnimationFrame(revealFrame);
    if (revealSettleTimer !== null) clearTimeout(revealSettleTimer);
    revealFrame = null;
    revealSettleTimer = null;
  }

  function scheduleRevealAfterLayout(
    reveal: (behavior: ScrollBehavior) => void,
    behaviorOverride?: ScrollBehavior,
    waitForLayout = true,
  ) {
    cancelPendingReveal();
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = prefersReducedMotion
      ? 'auto'
      : (behaviorOverride ?? (lifecycleMotionReady ? 'smooth' : 'auto'));

    revealFrame = requestAnimationFrame(() => {
      revealFrame = null;
      revealSettleTimer = setTimeout(
        () => {
          reveal(behavior);
          revealSettleTimer = null;
        },
        waitForLayout && layoutMotionDuration > 0 ? LAYOUT_WIDTH_SETTLE_MS : 0,
      );
    });
  }

  function scheduleWorkspaceReveal(
    workspaceId: string,
    inline: ScrollLogicalPosition = 'nearest',
    behavior?: ScrollBehavior,
    waitForLayout = true,
  ) {
    const scroller = columnsScroller;
    if (!scroller) return;

    lastScrolledWorkspaceId = workspaceId;
    void tick().then(() => {
      if (columnsScroller !== scroller || lastScrolledWorkspaceId !== workspaceId) return;
      scheduleRevealAfterLayout(
        (resolvedBehavior) => {
          if (columnsScroller !== scroller || lastScrolledWorkspaceId !== workspaceId) return;
          scrollWorkspaceColumnIntoView(scroller, workspaceId, resolvedBehavior, inline);
        },
        behavior,
        waitForLayout,
      );
    });
  }

  $effect(() => {
    const workspaceId = $currentWorkspaceId$;
    const scroller = columnsScroller;
    if (!workspaceId || !scroller || workspaceId === lastScrolledWorkspaceId) return;

    scheduleWorkspaceReveal(workspaceId);
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
      scheduleRevealAfterLayout((behavior) => {
        if (columnsScroller !== scroller || $currentWorkspaceId$ !== workspaceId) return;
        scrollWorkspacePanelIntoView(scroller, workspaceId, panelId, behavior);
      });
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
    if (!scroller || !tracker) return;

    const openWorkspaceIds = new Set(stacks.flat());
    const tracked: TrackedColumnElement[] = [];
    for (const element of scroller.querySelectorAll('[data-workspace-stack]')) {
      const workspaceIds = (element.getAttribute('data-workspace-stack') ?? '')
        .split(',')
        .filter((workspaceId) => openWorkspaceIds.has(workspaceId));
      if (workspaceIds.length > 0) tracked.push({ element, workspaceIds });
    }
    tracker.setElements(tracked);
  });

  onDestroy(cancelPendingReveal);

  function updateSidebarWidth(workspaceId: string, width: number) {
    if (sidebarWidths[workspaceId] === width) return;
    sidebarWidths[workspaceId] = width;
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
    appStore.dispatch(openWorkspaceTab(workspaceId));
    void goto(`/workspace/${workspaceId}`);
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
    class="relative h-full min-h-0 w-full overflow-hidden rounded-md bg-sidebar shadow-md transition-[opacity,transform,box-shadow] duration-(--motion-fast) {draggedWorkspaceId ===
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
    <WorkspaceSurface
      {workspaceId}
      active={$currentWorkspaceId$ === workspaceId}
      manageTab={false}
      columnMode={true}
      onCloseWorkspace={(event) => closeWorkspace(workspaceId, event)}
      onSidebarWidthChange={(width) => updateSidebarWidth(workspaceId, width)}
      onPanelMovePreviewWidthRatioChange={(ratio) =>
        updatePanelPreviewWidthRatio(workspaceId, ratio)}
      onPanelCanvasWidthChange={(width) => updatePanelCanvasWidth(workspaceId, width)}
      onCyclePanelBoundary={(direction) => handlePanelCycleBoundary(workspaceId, direction)}
    />
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

<div
  bind:this={columnsScroller}
  class="scrollbar-none h-full min-h-0 w-full overflow-x-auto overflow-y-hidden bg-transparent"
  aria-label={m.workspace_columns_openSpaces_ariaLabel()}
  data-workspace-columns
  data-visible-workspace-columns={visibleWorkspaceIdsAttribute}
>
  <div class="flex h-full min-h-0 w-max min-w-full gap-2 pl-2 pr-2 pt-2">
    {#each $workspaceStacks$ as stack (stack[0])}
      {@const stackWidth = Math.max(
        ...stack.map((workspaceId) => {
          const panelCount = $panelColumnCountsByWorkspaceId$[workspaceId] ?? 0;
          const panelCanvasWidth =
            livePanelCanvasWidths[workspaceId] ??
            $panelCanvasWidthsByWorkspaceId$[workspaceId] ??
            480;
          return (
            (sidebarWidths[workspaceId] ?? 360) +
            (panelCount > 0
              ? panelCanvasWidth * (panelPreviewWidthRatios[workspaceId] ?? 1) +
                CONTAINED_PANEL_INLINE_CHROME
              : 0)
          );
        }),
      )}
      <div
        class="h-full min-h-0 shrink-0"
        style:width={`${stackWidth}px`}
        data-workspace-stack={stack.join(',')}
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
