<script lang="ts">
  /**
   * PanelContainer - Recursive container for panels and splits
   *
   * Renders either a single panel or a split container with children.
   * Handles resizing between children.
   */

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

  import type { DropZone } from './Panel.svelte';
  import type { HandleDropZone } from './PanelSplitHandle.svelte';

  interface Props {
    node: PanelLayoutNode;
    panels: Record<string, PanelState>;
    focusedPanelId: string | null;
    workspaceId: string;
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
    onCreateNote?: () => void;
    onCreateTerminal?: () => void;
    onOpenBrowser?: () => void;
  }

  let {
    node,
    panels,
    focusedPanelId,
    workspaceId,
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
    onTabDropToSplit,
    onTabMoveToPanel,
    onTabDropToSplitHandle,
    onTabRename,
    onCreateAgent,
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

  let containerRef = $state<HTMLDivElement | null>(null);
  // Initialize sizes from node, but allow local updates during resize
  let localSizes = $state<number[] | null>(null);
  let sizes = $derived(localSizes ?? (node.type === 'split' ? node.sizes : []));

  function handleResize(index: number, delta: number) {
    if (node.type !== 'split' || !containerRef) return;

    const containerSize =
      node.direction === 'horizontal' ? containerRef.offsetWidth : containerRef.offsetHeight;

    const deltaPercent = (delta / containerSize) * 100;

    // Adjust sizes
    const newSizes = [...sizes];
    const minSize = 10; // Minimum 10%

    newSizes[index] = Math.max(minSize, newSizes[index] + deltaPercent);
    newSizes[index + 1] = Math.max(minSize, newSizes[index + 1] - deltaPercent);

    // Normalize to ensure they sum to 100
    const total = newSizes.reduce((a, b) => a + b, 0);
    const normalizedSizes = newSizes.map((s) => (s / total) * 100);
    localSizes = normalizedSizes;

    // Update the layout manager immediately so minimap updates during drag
    onUpdateSizes?.(nodePath, normalizedSizes);
  }

  function handleResizeEnd() {
    // Reset local sizes so we use the node's sizes again
    localSizes = null;
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
          const childSizes = [...childNode.sizes];
          const minSize = 10;

          childSizes[childHandleIndex] = Math.max(
            minSize,
            childSizes[childHandleIndex] + deltaPercent,
          );
          childSizes[childHandleIndex + 1] = Math.max(
            minSize,
            childSizes[childHandleIndex + 1] - deltaPercent,
          );

          // Normalize
          const total = childSizes.reduce((a, b) => a + b, 0);
          const normalizedSizes = childSizes.map((s) => (s / total) * 100);

          onUpdateSizes?.(childPath, normalizedSizes);
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function handleCornerResizeEnd(_handleIndex: number) {
    handleResizeEnd();
  }
</script>

{#if node.type === 'panel'}
  {@const panel = panels[node.panelId]}
  {#if panel}
    <Panel
      {panel}
      {workspaceId}
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
      {onTabRename}
      {onCreateAgent}
      {onCreateNote}
      {onCreateTerminal}
      {onOpenBrowser}
      onSplitHorizontal={() => onSplitPanel?.(node.panelId, 'horizontal')}
      onSplitVertical={() => onSplitPanel?.(node.panelId, 'vertical')}
    />
  {/if}
{:else if node.type === 'split'}
  <div
    bind:this={containerRef}
    class={cn(
      'panel-split-container flex h-full w-full',
      node.direction === 'vertical' && 'flex-col',
    )}
  >
    {#each node.children as child, i (i)}
      {@const isHiddenByZoom = isPanelHiddenByZoom(child)}
      {@const containsZoomedPanel = zoomedPanelId && containsPanel(child, zoomedPanelId)}
      <div
        class="panel-split-child"
        class:hidden={isHiddenByZoom}
        style={containsZoomedPanel
          ? 'flex: 1 1 100%'
          : `flex: 1 1 ${isHiddenByZoom ? 0 : (sizes[i] ?? node.sizes[i])}%`}
      >
        <PanelContainer
          node={child}
          {panels}
          {focusedPanelId}
          {workspaceId}
          nodePath={[...nodePath, i]}
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
          {onTabDropToSplit}
          {onTabMoveToPanel}
          {onTabDropToSplitHandle}
          {onTabRename}
          {onCreateAgent}
          {onCreateNote}
          {onCreateTerminal}
          {onOpenBrowser}
        />
      </div>

      {#if i < node.children.length - 1 && !zoomedPanelId}
        {@const corners = getCornerPositions(i)}
        <div class="panel-split-handle-wrapper relative">
          <PanelSplitHandle
            direction={node.direction}
            {nodePath}
            handleIndex={i}
            onResize={(delta) => handleResize(i, delta)}
            onResizeEnd={handleResizeEnd}
            onTabDropToHandle={onTabDropToSplitHandle}
          />
          <!-- Corner handles at intersection points -->
          {#each corners as corner (corner.position)}
            <PanelCornerHandle
              onResize={(deltaX, deltaY) => handleCornerResize(i, corner.targets, deltaX, deltaY)}
              onResizeEnd={() => handleCornerResizeEnd(i)}
              style={node.direction === 'horizontal'
                ? `top: ${corner.position}%; left: 50%;`
                : `left: ${corner.position}%; top: 50%;`}
            />
          {/each}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .panel-split-container {
    min-width: 0;
    min-height: 0;
    gap: 4px;
  }

  .panel-split-child {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .panel-split-handle-wrapper {
    position: relative;
    display: flex;
    flex-shrink: 0;
    /* Stretch to fill cross-axis so corner handles can position with percentages */
    align-self: stretch;
  }
</style>
