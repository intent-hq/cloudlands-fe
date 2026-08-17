<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { goto } from '$app/navigation';
  import WorkspaceSurface from '../../../routes/(app)/workspace/[id]/WorkspaceSurface.svelte';
  import ParkedWorkspaceSurface from './ParkedWorkspaceSurface.svelte';
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
    selectPanelCanvasWidthsByWorkspaceId,
    selectPanelColumnCountsByWorkspaceId,
    selectPanelNavigatorItemsByWorkspaceId,
    selectPanelRevealRequestsByWorkspaceId,
    selectPanelTabCountsByWorkspaceId,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    consumePanelReveal,
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
  import { selectWorkspaceTabStatuses } from '$store/renderer/slices/hud/hud-selectors';
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
  import { resolveLiveWorkspaceIds } from './workspace-surface-window';
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
  const panelTabCountsByWorkspaceId$ = selectPanelTabCountsByWorkspaceId();
  const panelNavigatorItemsByWorkspaceId$ = selectPanelNavigatorItemsByWorkspaceId();
  const resizablePanelSizes$ = selectResizablePanelSizes();
  const hydratedResizablePanelSizes$ = selectHydratedResizablePanelSizes();
  const panelRevealRequestsByWorkspaceId$ = selectPanelRevealRequestsByWorkspaceId();
  const workspaceItems$ = selectWorkspaceItems();
  const workspaceTabStatuses$ = selectWorkspaceTabStatuses();
  let sidebarWidths = $state<Record<string, number>>({});
  let livePanelCanvasWidths = $state<Record<string, number>>({});
  let columnsScroller = $state<HTMLDivElement | null>(null);
  let navigatorPanelRoot = $state<HTMLElement | null>(null);
  let overlapObserver: WorkspaceColumnsOverlapObserver | null = null;
  let panelPreviewWidthRatios = $state<Record<string, number>>({});
  let draggedWorkspaceId = $state<string | null>(null);
  let dragOverWorkspaceId = $state<string | null>(null);
  let dragOverPlacement = $state<WorkspaceDragPlacement | null>(null);
  let lifecycleMotionReady = $state(false);
  let lastScrolledWorkspaceId: string | null = null;
  const layoutRevealScheduler = createLayoutStableRevealScheduler();
  const requestedSidebarWidthKeys = new Set<string>();
  const layoutMotionDuration = $derived(lifecycleMotionReady ? 180 : 0);
  const openWorkspaceIds = $derived($workspaceStacks$.flat());
  const sidebarWidthsReady = $derived(
    openWorkspaceIds.every(
      (workspaceId) =>
        $hydratedResizablePanelSizes$[`workspace-left-panel-width:${workspaceId}`] === true &&
        $hydratedResizablePanelSizes$[`workspace-left-panel-expanded-width:${workspaceId}`] ===
          true,
    ),
  );

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

  let visibilityMeasurementFrame: number | null = null;
  let visibleStackKeys = $state<string[]>([]);
  let materializingWorkspaceId = $state<string | null>(null);
  const workspaceById = $derived(
    new Map($workspaceItems$.map((workspace) => [String(workspace.id), workspace])),
  );
  const liveWorkspaceIds = $derived(
    resolveLiveWorkspaceIds(
      $workspaceStacks$,
      $currentWorkspaceId$,
      visibleStackKeys,
      materializingWorkspaceId,
    ),
  );
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

  function measureVisibleWorkspaceStacks() {
    const scroller = columnsScroller;
    if (!scroller) return;
    const viewport = scroller.getBoundingClientRect();
    if (viewport.right <= viewport.left) return;
    const nextKeys = [...scroller.querySelectorAll<HTMLElement>('[data-workspace-stack-key]')]
      .filter((stack) => {
        const rect = stack.getBoundingClientRect();
        return rect.right > viewport.left && rect.left < viewport.right;
      })
      .map((stack) => stack.dataset.workspaceStackKey!)
      .filter(Boolean);
    if (
      nextKeys.length === visibleStackKeys.length &&
      nextKeys.every((key, index) => key === visibleStackKeys[index])
    )
      return;
    visibleStackKeys = nextKeys;
  }

  function scheduleVisibleWorkspaceStackMeasurement() {
    if (visibilityMeasurementFrame !== null) return;
    visibilityMeasurementFrame = requestAnimationFrame(() => {
      visibilityMeasurementFrame = null;
      measureVisibleWorkspaceStacks();
    });
  }

  function handleColumnsScroll() {
    overlapObserver?.measure();
    scheduleVisibleWorkspaceStackMeasurement();
  }

  onMount(() => {
    measureVisibleWorkspaceStacks();
    const scroller = columnsScroller;
    if (!scroller) return;
    overlapObserver = observeWorkspaceColumnsOverlap(scroller, onHorizontalOverlapChange);
    if (typeof ResizeObserver === 'undefined') return () => overlapObserver?.destroy();
    const visibilityObserver = new ResizeObserver(scheduleVisibleWorkspaceStackMeasurement);
    visibilityObserver.observe(scroller);
    return () => {
      visibilityObserver.disconnect();
      overlapObserver?.destroy();
      overlapObserver = null;
    };
  });

  $effect(() => {
    void $workspaceStacks$;
    if (!columnsScroller) return;
    scheduleVisibleWorkspaceStackMeasurement();
    void tick().then(() => overlapObserver?.measure());
  });

  $effect(() => {
    const requests = $panelRevealRequestsByWorkspaceId$;
    const scroller = columnsScroller;
    const entries = Object.entries(requests);
    if (!scroller || entries.length === 0) {
      layoutRevealScheduler.cancel();
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

  function scheduleRevealAfterLayout(
    resolveTarget: () => HTMLElement | null,
    reveal: (behavior: ScrollBehavior) => void,
    behaviorOverride?: ScrollBehavior,
    isCurrent: () => boolean = () => true,
    onTargetRemoved?: () => void,
  ) {
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = prefersReducedMotion
      ? 'auto'
      : (behaviorOverride ?? (lifecycleMotionReady ? 'smooth' : 'auto'));
    layoutRevealScheduler.schedule({
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
    if (!workspaceId || !scroller || workspaceId === lastScrolledWorkspaceId) return;

    scheduleWorkspaceReveal(workspaceId);
  });

  onDestroy(() => {
    layoutRevealScheduler.cancel();
    if (visibilityMeasurementFrame !== null) cancelAnimationFrame(visibilityMeasurementFrame);
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
    {#if liveWorkspaceIds.includes(workspaceId)}
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
      {@const workspace = workspaceById.get(workspaceId)}
      <ParkedWorkspaceSurface
        {workspaceId}
        title={workspace?.title?.trim() || m.layout_workspaceTabStrip_untitled_label()}
        status={$workspaceTabStatuses$[workspaceId]}
        panelTabCount={$panelTabCountsByWorkspaceId$[workspaceId] ?? 0}
        sidebarWidth={sidebarWidths[workspaceId] ?? 360}
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
    data-sidebar-widths-ready={sidebarWidthsReady}
    onscroll={handleColumnsScroll}
  >
    <div class="flex h-full min-h-0 w-max min-w-full gap-3 p-2">
      {#if sidebarWidthsReady}
        {#each $workspaceStacks$ as stack (stack[0])}
          {@const stackWidth = Math.max(
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
          )}
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
      {/if}
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
