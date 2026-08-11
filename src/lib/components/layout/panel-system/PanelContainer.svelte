<script lang="ts">
  /**
   * PanelContainer - Recursive container for panels and splits
   *
   * Renders either a single panel or a split container with children.
   * Handles resizing between children.
   */

  import { onMount } from 'svelte';
  import type {
    PanelLayoutNode,
    PanelState,
    PanelTab,
  } from '$features/layout/panel-layout-adapter';
  import { cn } from '$lib/utils';
  import Panel from './Panel.svelte';
  import PanelSplitHandle from './PanelSplitHandle.svelte';
  import PanelCornerHandle from './PanelCornerHandle.svelte';
  import PanelContainer from './PanelContainer.svelte';
  import { getPanelFlexValue, getPanelReferenceSize, resizeAdjacentPanels } from './panel-resize';
  import { translatePanel } from './panel-reorder-animation';
  import { getDraggedPanelId } from './panel-drag';
  import { resize } from '$lib/components/layout/size-transition';
  import { cubicOut } from 'svelte/easing';

  import type { DropZone } from './Panel.svelte';
  import type { HandleDropZone } from './PanelSplitHandle.svelte';

  interface Props {
    node: PanelLayoutNode;
    panels: Record<string, PanelState>;
    focusedPanelId: string | null;
    workspaceId: string;
    layoutId: string;
    contained?: boolean;
    suppressLayoutMotion?: boolean;
    retainedRootPanelWidth?: number | null;
    rootPanelReferenceSize?: number | null;
    nodePath?: number[]; // Path to this node in the tree (for size updates)
    /** Zoom state - if set, only this panel is visible */
    zoomedPanelId?: string | null;
    onFocusPanel?: (panelId: string) => void;
    onTabClick?: (panelId: string, tabId: string) => void;
    onTabClose?: (panelId: string, tabId: string) => void;
    onTabReorder?: (panelId: string, fromIndex: number, toIndex: number) => void;
    onCloseOtherTabs?: (panelId: string, tabId: string) => void;
    onCloseTabsToRight?: (panelId: string, tabId: string) => void;
    onCloseAllTabs?: (panelId: string) => void;
    onCloseAllOthersEverywhere?: (panelId: string, tabId: string) => void;
    onSplitPanel?: (panelId: string, direction: 'horizontal' | 'vertical') => void;
    onClosePanel?: (panelId: string) => void;
    onZoomToggle?: (panelId: string) => void;
    onUpdateSizes?: (nodePath: number[], sizes: number[]) => void;
    /**
     * Handler for growing the workspace canvas by resizing a specific
     * root-level horizontal panel. Used in `contained` (columns) mode so a
     * middle split-handle drag expands the workspace instead of stealing width
     * from a sibling panel.
     */
    onGrowCanvasAtHorizontalPanel?: (
      previousWidth: number,
      nextWidth: number,
      panelIndex: number,
    ) => void;
    /** Handler for dropping a tab to create a split */
    onTabDropToSplit?: (
      targetPanelId: string,
      tabId: string,
      fromPanelId: string,
      zone: DropZone,
    ) => void;
    /** Handler for moving a tab to another panel */
    onTabMoveToPanel?: (
      targetPanelId: string,
      tabId: string,
      fromPanelId: string,
      insertIndex?: number,
    ) => void;
    /** Handler for reordering a whole panel relative to another panel */
    onPanelMove?: (
      draggedPanelId: string,
      targetPanelId: string,
      position: 'before' | 'after' | 'above' | 'below',
    ) => void;
    onPanelMovePreview?: (
      draggedPanelId: string,
      targetPanelId: string,
      position: 'before' | 'after' | 'above' | 'below' | null,
    ) => void;
    /** Handler for dropping a tab on a split handle (container-level insertion) */
    onTabDropToSplitHandle?: (
      tabId: string,
      fromPanelId: string,
      nodePath: number[],
      position: HandleDropZone,
      direction: 'horizontal' | 'vertical',
    ) => void;
    /** Handler for renaming a tab (note, agent, or file) */
    onTabRename?: (tab: PanelTab, newName: string) => void;
    /** Callbacks for creating new items */
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onCreateNote?: () => void;
    onCreateTerminal?: () => void;
    onOpenBrowser?: () => void;
  }

  let {
    node,
    panels,
    focusedPanelId,
    workspaceId,
    layoutId,
    contained = false,
    suppressLayoutMotion = false,
    retainedRootPanelWidth = null,
    rootPanelReferenceSize = null,
    nodePath = [],
    zoomedPanelId = null,
    onFocusPanel,
    onTabClick,
    onTabClose,
    onTabReorder,
    onCloseOtherTabs,
    onCloseTabsToRight,
    onCloseAllTabs,
    onCloseAllOthersEverywhere,
    onSplitPanel,
    onClosePanel,
    onZoomToggle,
    onUpdateSizes,
    onGrowCanvasAtHorizontalPanel,
    onTabDropToSplit,
    onTabMoveToPanel,
    onPanelMove,
    onPanelMovePreview,
    onTabDropToSplitHandle,
    onTabRename,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onCreateNote,
    onCreateTerminal,
    onOpenBrowser,
  }: Props = $props();

  // Check if this panel node should be hidden due to zoom
  function isPanelHiddenByZoom(nodeToCheck: PanelLayoutNode): boolean {
    if (!zoomedPanelId) return false;
    if (nodeToCheck.type === 'panel') {
      return nodeToCheck.panelId !== zoomedPanelId;
    }
    // For splits, hidden if zoomed panel is not a descendant
    return !containsPanel(nodeToCheck, zoomedPanelId);
  }

  function containsPanel(nodeToCheck: PanelLayoutNode, panelId: string): boolean {
    if (nodeToCheck.type === 'panel') {
      return nodeToCheck.panelId === panelId;
    }
    return nodeToCheck.children.some((child) => containsPanel(child, panelId));
  }

  function getNodeTransitionKey(nodeToKey: PanelLayoutNode): string {
    if (nodeToKey.type === 'panel') return nodeToKey.panelId;
    return `${nodeToKey.direction}:${nodeToKey.children.map(getNodeTransitionKey).join('|')}`;
  }

  type SplitLayoutItem =
    | { type: 'panel'; child: PanelLayoutNode; index: number; key: string }
    | { type: 'gutter'; index: number; key: string };

  function getSplitLayoutItems(): SplitLayoutItem[] {
    if (node.type !== 'split') return [];
    const items: SplitLayoutItem[] = [];
    node.children.forEach((child, index) => {
      const childKey = getNodeTransitionKey(child);
      items.push({ type: 'panel', child, index, key: `panel:${childKey}` });
      if (index < node.children.length - 1 && !zoomedPanelId) {
        items.push({ type: 'gutter', index, key: `gutter:${index}` });
      }
    });
    return items;
  }

  let containerRef = $state<HTMLDivElement | null>(null);
  let liveResizeSizes: number[] | null = null;
  let panelReferenceSize = $state<number | null>(null);
  let lifecycleMotionReady = $state(false);
  let isResizing = $state(false);
  const layoutMotionDuration = $derived(
    lifecycleMotionReady && !isResizing && !suppressLayoutMotion ? 180 : 0,
  );
  const layoutMotionExitDuration = $derived(
    lifecycleMotionReady && !isResizing && !suppressLayoutMotion ? 140 : 0,
  );

  function resizePanelChild(nodeToResize: HTMLElement, params: Parameters<typeof resize>[1]) {
    if (suppressLayoutMotion || getDraggedPanelId()) return { duration: 0 };
    return resize(nodeToResize, params);
  }

  onMount(() => {
    const frame = requestAnimationFrame(() => {
      lifecycleMotionReady = true;
    });
    return () => cancelAnimationFrame(frame);
  });

  function getPanelChildFlex(
    child: PanelLayoutNode,
    index: number,
    resizeSizes = node.type === 'split' ? node.sizes : [],
  ): string {
    if (node.type !== 'split') return '';
    const hiddenByZoom = isPanelHiddenByZoom(child);
    if (zoomedPanelId && containsPanel(child, zoomedPanelId)) return '1 1 100%';
    if (hiddenByZoom) return '0 0 0%';
    return getPanelFlexValue(
      resizeSizes[index] ?? node.sizes[index],
      panelReferenceSize,
      contained,
      nodePath.length === 0 && node.children.length === 1 ? retainedRootPanelWidth : null,
    );
  }

  function applyLiveResizeSizes(resizeSizes: number[]) {
    if (node.type !== 'split' || !containerRef) return;
    const panelElements = Array.from(
      containerRef.querySelectorAll<HTMLElement>(':scope > .panel-split-child'),
    );
    panelElements.forEach((panelElement, index) => {
      const child = node.children[index];
      if (child) panelElement.style.flex = getPanelChildFlex(child, index, resizeSizes);
    });
  }

  function measurePanelReferenceSize() {
    if (node.type !== 'split' || !containerRef) return;

    const directChildren = Array.from(containerRef.children);
    const panelChildren = directChildren.filter((child) =>
      child.classList.contains('panel-split-child'),
    );
    const gutterSize = directChildren
      .filter((child) => child.classList.contains('panel-split-handle-wrapper'))
      .reduce(
        (total, gutter) =>
          total +
          (node.direction === 'horizontal'
            ? (gutter as HTMLElement).offsetWidth
            : (gutter as HTMLElement).offsetHeight),
        0,
      );
    const firstPanel = panelChildren[0];
    const minimumPanelSize = firstPanel
      ? Number.parseFloat(
          node.direction === 'horizontal'
            ? getComputedStyle(firstPanel).minWidth
            : getComputedStyle(firstPanel).minHeight,
        ) || 0
      : 0;
    const rootViewport = containerRef.closest<HTMLElement>('[data-testid="panel-workspace-inset"]');
    const resizeTarget = nodePath.length === 0 ? rootViewport : containerRef.parentElement;
    const availableSize =
      node.direction === 'horizontal'
        ? nodePath.length === 0 && rootPanelReferenceSize !== null
          ? rootPanelReferenceSize
          : (resizeTarget?.clientWidth ?? containerRef.clientWidth)
        : (resizeTarget?.clientHeight ?? containerRef.clientHeight);

    panelReferenceSize = getPanelReferenceSize(
      availableSize,
      panelChildren.length,
      minimumPanelSize,
      gutterSize,
    );
  }

  $effect(() => {
    if (node.type !== 'split' || !containerRef) return;

    const observedElement =
      nodePath.length === 0
        ? containerRef.closest<HTMLElement>('[data-testid="panel-workspace-inset"]')
        : containerRef.parentElement;
    measurePanelReferenceSize();
    if (!observedElement) return;

    const observer = new ResizeObserver(measurePanelReferenceSize);
    observer.observe(observedElement);
    return () => observer.disconnect();
  });

  // A root-level horizontal handle drag grows the workspace canvas so the
  // panel to the left of the handle absorbs the delta while sibling panels
  // keep their pixel width. This applies to both contained (columns) mode and
  // uncontained (tab) mode; nested splits keep the classic sibling-
  // redistribution behaviour.
  const growsCanvasAtRootHorizontal = $derived(
    node.type === 'split' &&
      node.direction === 'horizontal' &&
      nodePath.length === 0 &&
      !!onGrowCanvasAtHorizontalPanel,
  );
  let canvasResizeStartWidth: number | null = null;
  let canvasResizeAccumulatedWidth: number | null = null;
  // Frozen per-child pixel widths captured at drag start. During a canvas-grow
  // drag we imperatively pin every sibling to its start pixel width and grow
  // only the target child, so we do not rely on the percentage/reference-size
  // round-trip through Redux (which can lag by a frame and cause siblings to
  // visibly flex).
  let canvasResizeStartChildWidths: number[] | null = null;

  function handleResize(index: number, delta: number) {
    if (node.type !== 'split' || !containerRef) return;

    if (
      growsCanvasAtRootHorizontal &&
      canvasResizeStartWidth !== null &&
      canvasResizeStartChildWidths !== null
    ) {
      // `delta` from PanelSplitHandle is incremental (per-frame). Accumulate
      // against the last flushed canvas width so multi-frame drags grow the
      // target child by the full drag distance, not just the final frame.
      const previousWidth = canvasResizeAccumulatedWidth ?? canvasResizeStartWidth;
      const nextWidth = Math.max(1, previousWidth + delta);
      const targetChildStartWidth = canvasResizeStartChildWidths[index] ?? 0;
      const nextChildWidth = Math.max(1, targetChildStartWidth + (nextWidth - canvasResizeStartWidth));
      applyLiveCanvasResizeChildWidths(index, nextChildWidth);
      if (nextWidth === previousWidth) return;
      canvasResizeAccumulatedWidth = nextWidth;
      onGrowCanvasAtHorizontalPanel?.(previousWidth, nextWidth, index);
      return;
    }

    const containerSize =
      panelReferenceSize ??
      (node.direction === 'horizontal' ? containerRef.offsetWidth : containerRef.offsetHeight);

    const deltaPercent = (delta / containerSize) * 100;

    const newSizes = resizeAdjacentPanels(liveResizeSizes ?? node.sizes, index, deltaPercent);
    liveResizeSizes = newSizes;
    applyLiveResizeSizes(newSizes);
  }

  function applyLiveCanvasResizeChildWidths(growIndex: number, growWidth: number) {
    if (node.type !== 'split' || !containerRef || !canvasResizeStartChildWidths) return;
    const panelElements = Array.from(
      containerRef.querySelectorAll<HTMLElement>(':scope > .panel-split-child'),
    );
    panelElements.forEach((panelElement, index) => {
      const pinnedWidth =
        index === growIndex ? growWidth : (canvasResizeStartChildWidths?.[index] ?? 0);
      panelElement.style.flex = `0 0 ${pinnedWidth}px`;
    });
  }

  function handleResizeStart() {
    liveResizeSizes = node.type === 'split' ? [...node.sizes] : null;
    isResizing = true;
    canvasResizeStartWidth = growsCanvasAtRootHorizontal
      ? (panelReferenceSize ?? containerRef?.offsetWidth ?? null)
      : null;
    canvasResizeAccumulatedWidth = null;
    canvasResizeStartChildWidths =
      growsCanvasAtRootHorizontal && containerRef
        ? Array.from(
            containerRef.querySelectorAll<HTMLElement>(':scope > .panel-split-child'),
          ).map((el) => el.getBoundingClientRect().width)
        : null;
  }

  function handleResizeEnd() {
    const committedSizes = liveResizeSizes;
    const wasCanvasResize = growsCanvasAtRootHorizontal && canvasResizeStartChildWidths !== null;
    liveResizeSizes = null;
    isResizing = false;
    canvasResizeStartWidth = null;
    canvasResizeAccumulatedWidth = null;
    canvasResizeStartChildWidths = null;
    if (wasCanvasResize) {
      // Clear imperative pixel flex overrides so the next render uses the
      // reactive percentage-based flex derived from the updated node sizes.
      if (containerRef) {
        Array.from(
          containerRef.querySelectorAll<HTMLElement>(':scope > .panel-split-child'),
        ).forEach((el) => {
          el.style.flex = '';
        });
      }
      return;
    }
    if (!committedSizes) return;
    onUpdateSizes?.(nodePath, committedSizes);
  }

  // Corner resize handling - for resizing in both directions at once

  type CornerTarget = { childIndex: number; childHandleIndex: number };
  type CornerPosition = { position: number; targets: CornerTarget[] };

  /**
   * Get corner positions for a split handle at index i.
   * Returns positions (as percentages) where corners should appear along the handle.
   * A corner appears where a perpendicular child split's handle would intersect.
   * For 4-way intersections (both adjacent children have handles at same position),
   * the targets array will contain both children.
   *
   * This also looks through nested same-direction splits to find perpendicular splits
   * that should have corners visible at this level.
   */
  function getCornerPositions(handleIndex: number): CornerPosition[] {
    if (node.type !== 'split') return [];

    const POSITION_THRESHOLD = 2; // positions within 2% are considered the same
    const cornerMap = new Map<number, CornerTarget[]>();
    const perpendicularDirection = node.direction === 'horizontal' ? 'vertical' : 'horizontal';

    // Helper to add a corner, merging with existing if positions are close
    function addCorner(position: number, target: CornerTarget) {
      // Find existing corner within threshold
      for (const [existingPos, targets] of cornerMap) {
        if (Math.abs(existingPos - position) < POSITION_THRESHOLD) {
          targets.push(target);
          return;
        }
      }
      cornerMap.set(position, [target]);
    }

    // Type for split nodes
    type SplitNode = Extract<PanelLayoutNode, { type: 'split' }>;

    /**
     * Collect all handle positions from a perpendicular split, including handles
     * from nested same-direction children. Returns positions as percentages of the
     * total perpendicular split area.
     *
     * For example, if a horizontal split has children at [25%, 75%] and the second
     * child is also a horizontal split with [50%, 50%], we return:
     * - 25% (handle between child 0 and child 1)
     * - 25% + 75% * 50% = 62.5% (handle inside nested split)
     */
    function collectHandlePositions(
      splitNode: SplitNode,
      startOffset: number = 0,
      totalSize: number = 100,
    ): number[] {
      const positions: number[] = [];

      let accumulatedSize = 0;
      for (let i = 0; i < splitNode.children.length; i++) {
        const childSize = splitNode.sizes[i];
        const childStart = startOffset + (accumulatedSize / 100) * totalSize;
        const childTotalSize = (childSize / 100) * totalSize;

        // If there's a handle after this child (not the last child)
        if (i < splitNode.children.length - 1) {
          const handlePosition = startOffset + ((accumulatedSize + childSize) / 100) * totalSize;
          positions.push(handlePosition);
        }

        // If this child is a same-direction split, recurse into it
        const child = splitNode.children[i];
        if (child.type === 'split' && child.direction === splitNode.direction) {
          const nestedPositions = collectHandlePositions(child, childStart, childTotalSize);
          positions.push(...nestedPositions);
        }

        accumulatedSize += childSize;
      }

      return positions;
    }

    /**
     * Find perpendicular split in a child, looking through same-direction nested splits.
     * For childBefore (above/left of handle), we look at the LAST child of same-direction splits.
     * For childAfter (below/right of handle), we look at the FIRST child of same-direction splits.
     */
    function findPerpendicularSplit(
      child: PanelLayoutNode | undefined,
      lookAtFirst: boolean, // true = look at first child, false = look at last child
    ): SplitNode | null {
      if (!child) return null;
      if (child.type !== 'split') return null;

      // If this is a perpendicular split, return it
      if (child.direction === perpendicularDirection) {
        return child;
      }

      // Same direction split - look through it
      const nextChild = lookAtFirst ? child.children[0] : child.children[child.children.length - 1];

      return findPerpendicularSplit(nextChild, lookAtFirst);
    }

    // Check the child before the handle (at handleIndex)
    const childBefore = node.children[handleIndex];
    const perpSplitBefore = findPerpendicularSplit(childBefore, false);
    if (perpSplitBefore) {
      const handlePositions = collectHandlePositions(perpSplitBefore);
      for (const position of handlePositions) {
        addCorner(position, { childIndex: handleIndex, childHandleIndex: 0 });
      }
    }

    // Check the child after the handle (at handleIndex + 1)
    const childAfter = node.children[handleIndex + 1];
    const perpSplitAfter = findPerpendicularSplit(childAfter, true);
    if (perpSplitAfter) {
      const handlePositions = collectHandlePositions(perpSplitAfter);
      for (const position of handlePositions) {
        addCorner(position, { childIndex: handleIndex + 1, childHandleIndex: 0 });
      }
    }

    return Array.from(cornerMap.entries()).map(([position, targets]) => ({ position, targets }));
  }

  /**
   * Handle corner resize - resize the main split and all child splits at this corner.
   * For 4-way intersections, this resizes both adjacent child splits.
   */
  function handleCornerResize(
    handleIndex: number,
    targets: CornerTarget[],
    deltaX: number,
    deltaY: number,
  ) {
    if (node.type !== 'split' || !containerRef) return;

    // Determine which delta applies to which direction
    const mainDelta = node.direction === 'horizontal' ? deltaX : deltaY;
    const childDelta = node.direction === 'horizontal' ? deltaY : deltaX;

    // Resize the main split
    if (mainDelta !== 0) {
      handleResize(handleIndex, mainDelta);
    }

    // Resize all child splits at this corner
    if (childDelta !== 0) {
      for (const { childIndex, childHandleIndex } of targets) {
        const childNode = node.children[childIndex];
        if (childNode?.type === 'split') {
          // The child's container size in its layout direction
          const childContainerSize =
            childNode.direction === 'horizontal'
              ? containerRef.offsetWidth
              : containerRef.offsetHeight;
          const deltaPercent = (childDelta / childContainerSize) * 100;

          const childPath = [...nodePath, childIndex];
          const childSizes = resizeAdjacentPanels(childNode.sizes, childHandleIndex, deltaPercent);

          onUpdateSizes?.(childPath, childSizes);
        }
      }
    }
  }

  function handleCornerResizeEnd(_handleIndex: number) {
    handleResizeEnd();
  }
</script>

{#if node.type === 'panel'}
  {@const panel = panels[node.panelId]}
  {#if panel}
    <div class="h-full w-full min-h-0 min-w-0">
      <Panel
        {panel}
        {workspaceId}
        {layoutId}
        isFocused={focusedPanelId === node.panelId}
        isZoomed={zoomedPanelId === node.panelId}
        onFocus={() => onFocusPanel?.(node.panelId)}
        onTabClick={(tabId) => onTabClick?.(node.panelId, tabId)}
        onTabClose={(tabId) => onTabClose?.(node.panelId, tabId)}
        onTabReorder={(fromIndex, toIndex) => onTabReorder?.(node.panelId, fromIndex, toIndex)}
        onCloseOtherTabs={(tabId) => onCloseOtherTabs?.(node.panelId, tabId)}
        onCloseTabsToRight={(tabId) => onCloseTabsToRight?.(node.panelId, tabId)}
        onCloseAllTabs={() => onCloseAllTabs?.(node.panelId)}
        onCloseAllOthersEverywhere={(tabId) => onCloseAllOthersEverywhere?.(node.panelId, tabId)}
        onClosePanel={() => onClosePanel?.(node.panelId)}
        onZoomToggle={() => onZoomToggle?.(node.panelId)}
        onTabDrop={(tabId, fromPanelId, zone) =>
          onTabDropToSplit?.(node.panelId, tabId, fromPanelId, zone)}
        onTabMoveToPanel={(tabId, fromPanelId, insertIndex?: number) =>
          onTabMoveToPanel?.(node.panelId, tabId, fromPanelId, insertIndex)}
        onPanelMove={(draggedPanelId, position) =>
          onPanelMove?.(draggedPanelId, node.panelId, position)}
        onPanelMovePreview={(draggedPanelId, targetPanelId, position) =>
          onPanelMovePreview?.(draggedPanelId, targetPanelId, position)}
        {onTabRename}
        {onCreateAgent}
        {onCreateAgentWithSpecialist}
        {onCreateNote}
        {onCreateTerminal}
        {onOpenBrowser}
        {contained}
        onSplitHorizontal={() => onSplitPanel?.(node.panelId, 'horizontal')}
        onSplitVertical={() => onSplitPanel?.(node.panelId, 'vertical')}
      />
    </div>
  {/if}
{:else if node.type === 'split'}
  <div
    bind:this={containerRef}
    class={cn(
      'panel-split-container flex h-full w-full',
      contained && 'contained',
      node.direction,
      node.direction === 'vertical' && 'flex-col',
    )}
  >
    {#each getSplitLayoutItems() as item (item.key)}
      <div
        class={item.type === 'panel'
          ? 'panel-split-child'
          : cn('panel-split-handle-wrapper relative', node.direction)}
        class:hidden={item.type === 'panel' && isPanelHiddenByZoom(item.child)}
        style:flex={item.type === 'panel' ? getPanelChildFlex(item.child, item.index) : undefined}
        data-split-gutter={item.type === 'gutter' ? node.direction : undefined}
        animate:translatePanel={{ duration: layoutMotionDuration, easing: cubicOut }}
        in:resizePanelChild={{
          axis: node.direction === 'horizontal' ? 'x' : 'y',
          duration: layoutMotionDuration,
        }}
        out:resizePanelChild={{
          axis: node.direction === 'horizontal' ? 'x' : 'y',
          duration: layoutMotionExitDuration,
        }}
      >
        {#if item.type === 'panel'}
          <!-- Pixel bases resolve percentages against the canvas width. The default
               canvas fits its viewport; explicit outer-edge resizing owns overflow. -->
          <PanelContainer
            node={item.child}
            {panels}
            {focusedPanelId}
            {workspaceId}
            {layoutId}
            {contained}
            {suppressLayoutMotion}
            nodePath={[...nodePath, item.index]}
            {zoomedPanelId}
            {onFocusPanel}
            {onTabClick}
            {onTabClose}
            {onTabReorder}
            {onCloseOtherTabs}
            {onCloseTabsToRight}
            {onCloseAllTabs}
            {onCloseAllOthersEverywhere}
            {onSplitPanel}
            {onClosePanel}
            {onZoomToggle}
            {onUpdateSizes}
            {onGrowCanvasAtHorizontalPanel}
            {onTabDropToSplit}
            {onTabMoveToPanel}
            {onPanelMove}
            {onPanelMovePreview}
            {onTabDropToSplitHandle}
            {onTabRename}
            {onCreateAgent}
            {onCreateAgentWithSpecialist}
            {onCreateNote}
            {onCreateTerminal}
            {onOpenBrowser}
          />
        {:else}
          <!-- i18n-ignore (scanner false positive on the < comparison) -->
          <PanelSplitHandle
            direction={node.direction}
            {nodePath}
            handleIndex={item.index}
            onResizeStart={handleResizeStart}
            onResize={(delta) => handleResize(item.index, delta)}
            onResizeEnd={handleResizeEnd}
            onTabDropToHandle={onTabDropToSplitHandle}
          />
          <!-- Corner handles at intersection points -->
          {#each getCornerPositions(item.index) as corner (corner.position)}
            <PanelCornerHandle
              onResizeStart={handleResizeStart}
              onResize={(deltaX, deltaY) =>
                handleCornerResize(item.index, corner.targets, deltaX, deltaY)}
              onResizeEnd={() => handleCornerResizeEnd(item.index)}
              style={node.direction === 'horizontal'
                ? `top: ${corner.position}%; left: 50%;`
                : `left: ${corner.position}%; top: 50%;`}
            />
          {/each}
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .panel-split-container {
    /* The canvas controls intentional horizontal overflow. Default split
       children remain shrinkable so a new layout fits its viewport. */
    min-width: max-content;
    min-height: 0;
    gap: 0;
  }

  .panel-split-child {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  :global(body.panel-resizing) .panel-split-child,
  :global(body.panel-resizing) .panel-split-handle-wrapper {
    animation: none !important;
    transition: none !important;
  }

  .panel-split-container.contained {
    min-width: 0;
    overflow: hidden;
  }

  .panel-split-container.contained.horizontal > .panel-split-child {
    /* Workspace columns reserve 30rem per horizontal panel at their outer edge. */
    min-width: 30rem;
  }

  .panel-split-handle-wrapper {
    position: relative;
    display: flex;
    flex-shrink: 0;
    /* Stretch to fill cross-axis so corner handles can position with percentages */
    align-self: stretch;
  }

  /* The centered 16px resize target uses negative margins to occupy an exact 8px gutter. */
  .panel-split-handle-wrapper.horizontal {
    width: var(--space-2);
  }

  .panel-split-handle-wrapper.vertical {
    height: var(--space-2);
  }
</style>
