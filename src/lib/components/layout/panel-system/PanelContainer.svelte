<script lang="ts">
  /**
   * PanelContainer - Recursive container for panels and splits
   *
   * Renders either a single panel or a split container with children.
   * Handles resizing between children.
   */

  import { onDestroy, onMount } from 'svelte';
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
  import {
    getElementContentBoxSize,
    getPanelFlexValue,
    getPanelReferenceSize,
    resizeAdjacentPanels,
  } from './panel-resize';
  import { translatePanel } from './panel-reorder-animation';
  import { getDraggedPane } from './panel-drag';
  import { resize } from '$lib/components/layout/size-transition';
  import { cubicOut } from 'svelte/easing';
  import {
    PANEL_SPLIT_GUTTER_WIDTH,
    resizePanelWidthsAtDivider,
  } from '$shared/panel-layout-sizing';
  import { getDominantPanelChildWidth } from './panel-dominant-flex';

  import type { DropZone } from './Panel.svelte';
  import type { HandleDropZone } from './PanelSplitHandle.svelte';

  interface Props {
    node: PanelLayoutNode;
    panels: Record<string, PanelState>;
    panelOrder: readonly string[];
    focusedPanelId: string | null;
    workspaceId: string;
    layoutId: string;
    contained?: boolean;
    suppressLayoutMotion?: boolean;
    retainedRootPanelWidth?: number | null;
    rootPanelReferenceSize?: number | null;
    /** Canonical pixel widths for direct root-level horizontal children. */
    rootHorizontalPanelWidths?: readonly number[] | null;
    /** Live outer-canvas delta; only the final root panel absorbs it. */
    rootCanvasResizeDelta?: number;
    /** Live usable viewport width for structural column-count changes. */
    availableCanvasWidth?: number;
    /** Report the root split's gutter-exclusive content width. */
    onRootReferenceSizeChange?: (width: number) => void;
    nodePath?: number[]; // Path to this node in the tree (for size updates)
    /** Zoom state - if set, only this panel is visible */
    zoomedPanelId?: string | null;
    /** Expanded panel that owns the live width remainder after compact siblings. */
    dominantPanelId?: string | null;
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
    /** Commit a fixed-width proportional root-divider resize. */
    onResizeRootDivider?: (
      panelIndex: number,
      requestedDelta: number,
      previousPanelWidths: readonly number[],
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
    /** Handler for moving the active pane to an adjacent column. */
    onMoveActivePane?: (panelId: string, direction: 'next' | 'prev') => void;
    /** Handler for reordering a whole panel relative to another panel */
    onPanelMove?: (
      draggedPanelId: string,
      targetPanelId: string,
      position: 'before' | 'after' | 'above' | 'below',
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
    onCreateAgent?: (panelId?: string) => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null, panelId?: string) => void;
    onCreateNote?: (panelId?: string) => void;
    onCreateTerminal?: (panelId?: string) => void;
    onOpenBrowser?: (panelId?: string) => void;
  }

  let {
    node,
    panels,
    panelOrder,
    focusedPanelId,
    workspaceId,
    layoutId,
    contained = false,
    suppressLayoutMotion = false,
    retainedRootPanelWidth = null,
    rootPanelReferenceSize = null,
    rootHorizontalPanelWidths = null,
    rootCanvasResizeDelta = 0,
    availableCanvasWidth,
    onRootReferenceSizeChange,
    nodePath = [],
    zoomedPanelId = null,
    dominantPanelId = null,
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
    onResizeRootDivider,
    onTabDropToSplit,
    onTabMoveToPanel,
    onMoveActivePane,
    onPanelMove,
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
  let suppressResizeCommitMotion = $state(false);
  let resizeCommitMotionFrame: number | null = null;
  const layoutMotionDuration = $derived(
    lifecycleMotionReady && !isResizing && !suppressLayoutMotion && !suppressResizeCommitMotion
      ? 180
      : 0,
  );
  const layoutMotionExitDuration = $derived(
    lifecycleMotionReady && !isResizing && !suppressLayoutMotion && !suppressResizeCommitMotion
      ? 140
      : 0,
  );

  function resizePanelChild(nodeToResize: HTMLElement, params: Parameters<typeof resize>[1]) {
    if (suppressLayoutMotion || getDraggedPane()) return { duration: 0 };
    return resize(nodeToResize, params);
  }

  onMount(() => {
    const frame = requestAnimationFrame(() => {
      lifecycleMotionReady = true;
    });
    return () => cancelAnimationFrame(frame);
  });

  onDestroy(() => {
    if (resizeCommitMotionFrame !== null) cancelAnimationFrame(resizeCommitMotionFrame);
  });

  function suppressMotionThroughResizeCommit() {
    suppressResizeCommitMotion = true;
    if (resizeCommitMotionFrame !== null) cancelAnimationFrame(resizeCommitMotionFrame);
    resizeCommitMotionFrame = requestAnimationFrame(() => {
      resizeCommitMotionFrame = null;
      suppressResizeCommitMotion = false;
    });
  }

  function getPanelChildFlex(
    child: PanelLayoutNode,
    index: number,
    resizeSizes = node.type === 'split' ? node.sizes : [],
  ): string {
    if (node.type !== 'split') return '';
    if (rootResizeStartChildWidths !== null && rootResizeNextChildWidths !== null) {
      const pinnedWidth =
        rootResizeNextChildWidths[index] ?? rootResizeStartChildWidths[index] ?? 0;
      return `0 0 ${pinnedWidth}px`;
    }
    if (nodePath.length === 0 && node.direction === 'horizontal' && rootCanvasResizeDelta !== 0) {
      const previousReferenceSize = Math.max(0, (panelReferenceSize ?? 0) - rootCanvasResizeDelta);
      const previousWidth = previousReferenceSize * ((node.sizes[index] ?? 0) / 100);
      const pinnedWidth =
        index === node.children.length - 1
          ? Math.max(1, previousWidth + rootCanvasResizeDelta)
          : previousWidth;
      return `0 0 ${pinnedWidth}px`;
    }
    const hiddenByZoom = isPanelHiddenByZoom(child);
    if (zoomedPanelId && containsPanel(child, zoomedPanelId)) return '1 1 100%';
    if (hiddenByZoom) return '0 0 0%';
    const dominantWidth = getDominantPanelChildWidth(
      node,
      index,
      dominantPanelId,
      panelReferenceSize,
    );
    if (dominantWidth !== null) return `0 0 ${dominantWidth}px`;
    if (
      nodePath.length === 0 &&
      node.direction === 'horizontal' &&
      rootHorizontalPanelWidths?.length === node.children.length
    ) {
      return `0 0 ${rootHorizontalPanelWidths[index]}px`;
    }
    return getPanelFlexValue(
      resizeSizes[index] ?? node.sizes[index],
      panelReferenceSize,
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

    // Derive the gutter total from the node structure rather than the DOM:
    // when a close collapses the split, exiting gutter wrappers are still in
    // the DOM mid-outro (a leaving cross-axis gutter can measure at full
    // container size), which would corrupt the reference size until an
    // unrelated resize re-measures — leaving the surviving panel near zero.
    const gutterCount = zoomedPanelId ? 0 : Math.max(0, node.children.length - 1);
    const gutterSize = gutterCount * PANEL_SPLIT_GUTTER_WIDTH;
    const rootViewport = containerRef.closest<HTMLElement>('[data-testid="panel-workspace-inset"]');
    const resizeTarget = nodePath.length === 0 ? rootViewport : containerRef.parentElement;
    // Measure the content box: split children live inside it, so a padded
    // resize target's clientWidth/clientHeight would oversize the stack.
    const availableSize =
      node.direction === 'horizontal'
        ? nodePath.length === 0 && rootPanelReferenceSize !== null
          ? rootPanelReferenceSize
          : resizeTarget
            ? getElementContentBoxSize(resizeTarget, 'horizontal')
            : containerRef.clientWidth
        : resizeTarget
          ? getElementContentBoxSize(resizeTarget, 'vertical')
          : containerRef.clientHeight;

    panelReferenceSize = getPanelReferenceSize(availableSize, gutterSize);
    if (nodePath.length === 0) onRootReferenceSizeChange?.(panelReferenceSize);
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

  const resizesRootDivider = $derived(
    node.type === 'split' &&
      node.direction === 'horizontal' &&
      nodePath.length === 0 &&
      !!onResizeRootDivider,
  );
  let rootResizeStartChildWidths: number[] | null = null;
  let rootResizeNextChildWidths: number[] | null = null;
  let rootResizeRequestedDelta = 0;
  let rootResizeInlineScale = 1;

  function handleResize(index: number, delta: number) {
    if (node.type !== 'split' || !containerRef) return;

    if (resizesRootDivider && rootResizeStartChildWidths !== null) {
      rootResizeRequestedDelta += delta / rootResizeInlineScale;
      const resized = resizePanelWidthsAtDivider(
        rootResizeStartChildWidths,
        index,
        rootResizeRequestedDelta,
      );
      rootResizeNextChildWidths = resized.panelWidths;
      applyLiveRootResizeChildWidths(resized.panelWidths);
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

  function applyLiveRootResizeChildWidths(widths: readonly number[]) {
    if (node.type !== 'split' || !containerRef) return;
    const panelElements = Array.from(
      containerRef.querySelectorAll<HTMLElement>(':scope > .panel-split-child'),
    );
    panelElements.forEach((panelElement, index) => {
      panelElement.style.flex = `0 0 ${widths[index] ?? 0}px`;
    });
  }

  function handleResizeStart() {
    if (resizeCommitMotionFrame !== null) cancelAnimationFrame(resizeCommitMotionFrame);
    resizeCommitMotionFrame = null;
    suppressResizeCommitMotion = false;
    liveResizeSizes = node.type === 'split' ? [...node.sizes] : null;
    isResizing = true;
    const renderedContainerWidth = containerRef?.getBoundingClientRect().width ?? 0;
    const layoutContainerWidth = containerRef?.offsetWidth ?? 0;
    rootResizeInlineScale =
      resizesRootDivider && renderedContainerWidth > 0 && layoutContainerWidth > 0
        ? renderedContainerWidth / layoutContainerWidth
        : 1;
    rootResizeStartChildWidths =
      resizesRootDivider && containerRef
        ? Array.from(containerRef.querySelectorAll<HTMLElement>(':scope > .panel-split-child')).map(
            (el) => el.getBoundingClientRect().width / rootResizeInlineScale,
          )
        : null;
    rootResizeNextChildWidths = rootResizeStartChildWidths ? [...rootResizeStartChildWidths] : null;
    rootResizeRequestedDelta = 0;
  }

  function handleResizeEnd(panelIndex?: number) {
    const committedSizes = liveResizeSizes;
    const previousPanelWidths = rootResizeStartChildWidths;
    const nextPanelWidths = rootResizeNextChildWidths;
    const wasRootResize = resizesRootDivider && previousPanelWidths !== null;
    suppressMotionThroughResizeCommit();
    if (
      wasRootResize &&
      nextPanelWidths !== null &&
      panelIndex !== undefined &&
      nextPanelWidths.some((width, index) => width !== previousPanelWidths[index])
    ) {
      onResizeRootDivider?.(panelIndex, rootResizeRequestedDelta, previousPanelWidths);
    }
    liveResizeSizes = null;
    isResizing = false;
    rootResizeStartChildWidths = null;
    rootResizeNextChildWidths = null;
    rootResizeRequestedDelta = 0;
    rootResizeInlineScale = 1;
    if (wasRootResize) return;
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

  function handleCornerResizeEnd(handleIndex: number) {
    handleResizeEnd(handleIndex);
  }
</script>

{#if node.type === 'panel'}
  {@const panel = panels[node.panelId]}
  {@const panelIndex = panelOrder.indexOf(node.panelId)}
  <div class="h-full w-full min-h-0 min-w-0">
    {#if panel}
      <Panel
        {panel}
        {workspaceId}
        {layoutId}
        {availableCanvasWidth}
        canCreateColumn={panelOrder.length < 4}
        isRightmostPanel={panelOrder.at(-1) === node.panelId}
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
        onMovePaneLeft={onMoveActivePane && panelIndex > 0
          ? () => onMoveActivePane(node.panelId, 'prev')
          : undefined}
        onMovePaneRight={onMoveActivePane && panelIndex >= 0 && panelIndex < panelOrder.length - 1
          ? () => onMoveActivePane(node.panelId, 'next')
          : undefined}
        onMoveLeft={panelIndex > 0
          ? () => onPanelMove?.(node.panelId, panelOrder[panelIndex - 1], 'before')
          : undefined}
        onMoveRight={panelIndex >= 0 && panelIndex < panelOrder.length - 1
          ? () => onPanelMove?.(node.panelId, panelOrder[panelIndex + 1], 'after')
          : undefined}
        {onTabRename}
        {onCreateAgent}
        {onCreateAgentWithSpecialist}
        {onCreateNote}
        {onCreateTerminal}
        {onOpenBrowser}
        {contained}
        onSplitHorizontal={panelOrder.length < 4
          ? () => onSplitPanel?.(node.panelId, 'horizontal')
          : undefined}
      />
    {:else}
      <div class="h-full w-full bg-background text-foreground" data-missing-panel-surface></div>
    {/if}
  </div>
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
          <!-- Pixel bases resolve percentages against the mode-aware canvas width;
               explicit root-handle resizing owns intrinsic overflow. -->
          <PanelContainer
            node={item.child}
            {panels}
            {panelOrder}
            {focusedPanelId}
            {workspaceId}
            {layoutId}
            {availableCanvasWidth}
            {contained}
            {suppressLayoutMotion}
            nodePath={[...nodePath, item.index]}
            {zoomedPanelId}
            {dominantPanelId}
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
            {onResizeRootDivider}
            {onTabDropToSplit}
            {onTabMoveToPanel}
            {onMoveActivePane}
            {onPanelMove}
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
            immediateResize={resizesRootDivider}
            onResizeStart={handleResizeStart}
            onResize={(delta) => handleResize(item.index, delta)}
            onResizeEnd={() => handleResizeEnd(item.index)}
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
    /* The canvas alone owns horizontal overflow. Split containers never add a
       second implicit content-width constraint. */
    min-width: 0;
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
