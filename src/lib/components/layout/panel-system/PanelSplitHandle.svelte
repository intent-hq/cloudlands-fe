<script lang="ts">
  /**
   * PanelSplitHandle - Resizable divider between panels
   *
   * Allows users to resize panels by dragging the handle.
   * Also serves as a drop zone for creating splits at the container level.
   *
   * Drop zone behavior:
   * For horizontal split handle (vertical bar between left/right panels):
   *   - Top ~50px: "Add row above" (new row spanning full width at top)
   *   - Bottom ~50px: "Add row below" (new row spanning full width at bottom)
   *   - Middle area: "Add column left/right" based on X position
   *
   * For vertical split handle (horizontal bar between top/bottom panels):
   *   - Left ~50px: "Add column left"
   *   - Right ~50px: "Add column right"
   *   - Middle area: "Add row above/below" based on Y position
   */

  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import { selectIsDragging } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import {
  setActiveHandleDrop,
  type HandleDropZoneType,
  type SerializableRect,
} from '$store/renderer/slices/tab-state/tab-state-slice';
  import { store as appStore } from '$store/renderer/store';


  /** Position relative to the split for container-level insertion */
  export type HandleDropZone = 'before' | 'after';

  interface Props {
    direction: 'horizontal' | 'vertical';
    /** Path to this split node in the layout tree */
    nodePath?: number[];
    /** Index of the handle within the split (between child i and i+1) */
    handleIndex?: number;
    onResize?: (delta: number) => void;
    onResizeStart?: () => void;
    onResizeEnd?: () => void;
    /** Callback when a tab is dropped on this handle's drop zones */
    onTabDropToHandle?: (
      tabId: string,
      fromPanelId: string,
      nodePath: number[],
      position: HandleDropZone,
      direction: 'horizontal' | 'vertical',
    ) => void;
  }

  let {
    direction,
    nodePath = [],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handleIndex = 0,
    onResize,
    onResizeStart,
    onResizeEnd,
    onTabDropToHandle,
  }: Props = $props();

  let isDragging = $state(false);
  let startPos = $state(0);

  // Tab drag drop zone state
  let isTabDragOver = $state(false);
  let handleRef: HTMLButtonElement;

  // Track global tab drag state
  const isTabDragging = selectIsDragging();

  // Reset drop zone state when global drag ends
  $effect(() => {
    if (!$isTabDragging) {
      isTabDragOver = false;
    }
  });

  // Custom MIME type for tab drag (must match PanelTabBar)
  const TAB_DRAG_MIME = 'application/x-panel-tab';

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    isDragging = true;
    startPos = direction === 'horizontal' ? e.clientX : e.clientY;
    onResizeStart?.();

    // Add class to body to disable pointer events on iframes during drag
    // This prevents iframes (like browser panels) from capturing mouse events
    document.body.classList.add('panel-resizing');

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;

    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = currentPos - startPos;

    if (delta !== 0) {
      onResize?.(delta);
      startPos = currentPos;
    }
  }

  function handleMouseUp() {
    isDragging = false;
    if (typeof onResizeEnd === 'function') {
      onResizeEnd();
    }

    // Remove the class that disables iframe pointer events
    document.body.classList.remove('panel-resizing');

    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  // Edge threshold in pixels for row/column edge zones
  const EDGE_THRESHOLD = 50;

  // Detailed drop zone info including direction and position
  interface DropZoneInfo {
    zoneType: HandleDropZoneType;
    position: HandleDropZone;
    insertDirection: 'horizontal' | 'vertical';
    label: string;
  }

  // Determine drop zone based on cursor position
  // For horizontal split handle (vertical bar between left/right panels):
  //   - Top ~50px: row-above
  //   - Bottom ~50px: row-below
  //   - Middle: column-left or column-right based on X
  // For vertical split handle (horizontal bar between top/bottom panels):
  //   - Left ~50px: column-left
  //   - Right ~50px: column-right
  //   - Middle: row-above or row-below based on Y
  function getDropZoneInfo(e: DragEvent): DropZoneInfo | null {
    if (!handleRef) return null;

    const rect = handleRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (direction === 'horizontal') {
      // Vertical bar between left/right panels
      // Check if near top or bottom edges first
      if (y < EDGE_THRESHOLD) {
        return {
          zoneType: 'row-above',
          position: 'before',
          insertDirection: 'vertical',
          label: m.layout_panelSplitHandle_addRowAbove_label(),
        };
      }
      if (y > rect.height - EDGE_THRESHOLD) {
        return {
          zoneType: 'row-below',
          position: 'after',
          insertDirection: 'vertical',
          label: m.layout_panelSplitHandle_addRowBelow_label(),
        };
      }
      // Middle area - add column left or right
      const midX = rect.width / 2;
      if (x < midX) {
        return {
          zoneType: 'column-left',
          position: 'before',
          insertDirection: 'horizontal',
          label: m.layout_panelSplitHandle_addColumnLeft_label(),
        };
      } else {
        return {
          zoneType: 'column-right',
          position: 'after',
          insertDirection: 'horizontal',
          label: m.layout_panelSplitHandle_addColumnRight_label(),
        };
      }
    } else {
      // Horizontal bar between top/bottom panels
      // Check if near left or right edges first
      if (x < EDGE_THRESHOLD) {
        return {
          zoneType: 'column-left',
          position: 'before',
          insertDirection: 'horizontal',
          label: m.layout_panelSplitHandle_addColumnLeft_label(),
        };
      }
      if (x > rect.width - EDGE_THRESHOLD) {
        return {
          zoneType: 'column-right',
          position: 'after',
          insertDirection: 'horizontal',
          label: m.layout_panelSplitHandle_addColumnRight_label(),
        };
      }
      // Middle area - add row above or below
      const midY = rect.height / 2;
      if (y < midY) {
        return {
          zoneType: 'row-above',
          position: 'before',
          insertDirection: 'vertical',
          label: m.layout_panelSplitHandle_addRowAbove_label(),
        };
      } else {
        return {
          zoneType: 'row-below',
          position: 'after',
          insertDirection: 'vertical',
          label: m.layout_panelSplitHandle_addRowBelow_label(),
        };
      }
    }
  }

  // Current drop zone info
  let currentZoneInfo = $state<DropZoneInfo | null>(null);

  function handleTabDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes(TAB_DRAG_MIME)) return;

    e.preventDefault();
    e.stopPropagation();

    isTabDragOver = true;
    const zoneInfo = getDropZoneInfo(e);
    currentZoneInfo = zoneInfo;

    // Update global store with drop info for the overlay
    if (zoneInfo && handleRef) {
      const handleRect = handleRef.getBoundingClientRect();
      // Find the parent split container to get full bounds for the overlay
      const container = handleRef.closest('.panel-split-container');
      const containerRect = container?.getBoundingClientRect() ?? handleRect;

      const toRect = (r: DOMRect): SerializableRect => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        left: r.left,
      });
      appStore.dispatch(
        setActiveHandleDrop({
          handleRect: toRect(handleRect),
          containerRect: toRect(containerRect),
          zoneType: zoneInfo.zoneType,
          label: zoneInfo.label,
        }),
      );
    }
  }

  function handleTabDragLeave(e: DragEvent) {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget && handleRef?.contains(relatedTarget)) return;

    isTabDragOver = false;
    currentZoneInfo = null;
    appStore.dispatch(setActiveHandleDrop(null));
  }

  function handleTabDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    const zoneInfo = currentZoneInfo;
    isTabDragOver = false;
    currentZoneInfo = null;
    appStore.dispatch(setActiveHandleDrop(null));

    if (!zoneInfo) return;

    // Extract tab data from the drag event
    try {
      const data = e.dataTransfer?.getData(TAB_DRAG_MIME);
      if (!data) return;

      const { tabId, panelId: fromPanelId } = JSON.parse(data);

      onTabDropToHandle?.(
        tabId,
        fromPanelId,
        nodePath,
        zoneInfo.position,
        zoneInfo.insertDirection,
      );
    } catch {
      // Ignore parse errors
    }
  }
</script>

<button
  type="button"
  bind:this={handleRef}
  class={cn(
    'panel-split-handle',
    direction === 'horizontal' ? 'horizontal' : 'vertical',
    isDragging && 'dragging',
    isTabDragOver && 'tab-drag-over',
  )}
  aria-label={m.layout_panelSplitHandle_resize_ariaLabel()}
  onmousedown={handleMouseDown}
  ondragover={handleTabDragOver}
  ondragleave={handleTabDragLeave}
  ondrop={handleTabDrop}
></button>

<style>
  .panel-split-handle {
    position: relative;
    flex-shrink: 0;
    background: transparent;
    border: 0;
    padding: 0;
    appearance: none;
    z-index: 35;
  }

  /* 8px gap, handle is 16px wide, so margin = -(16 - 8) / 2 = -4px each side */
  .panel-split-handle.horizontal {
    width: 16px;
    cursor: col-resize;
    margin: 0 -4px;
  }

  .panel-split-handle.horizontal::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 2px;
    height: 100%;
    border-radius: 1px;
    background: hsl(var(--primary));
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .panel-split-handle.vertical {
    height: 16px;
    width: 100%;
    cursor: row-resize;
    margin: -4px 0;
  }

  .panel-split-handle.vertical::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    transform: translateY(-50%);
    width: 100%;
    height: 2px;
    border-radius: 1px;
    background: hsl(var(--primary));
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .panel-split-handle:hover::before,
  .panel-split-handle.dragging::before {
    opacity: 1;
  }

  .panel-split-handle:focus-visible {
    outline: 2px solid hsl(var(--primary));
    outline-offset: -1px;
  }

  /* Tab drag drop zone styles */
  .panel-split-handle.tab-drag-over {
    z-index: 30;
  }

  .handle-drop-indicator {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    background: hsl(var(--primary) / 0.15);
    pointer-events: none;
    z-index: 100;
  }

  /* Horizontal split handle (vertical bar) - indicators go above/below */
  .handle-drop-indicator.horizontal {
    left: 50%;
    transform: translateX(-50%);
    width: max(200px, 30vw);
    height: 60px;
  }

  .handle-drop-indicator.horizontal.before {
    bottom: 100%;
    margin-bottom: 10px;
    /* border-radius: 8px 8px 0 0; */
  }

  .handle-drop-indicator.horizontal.after {
    top: 100%;
    margin-top: 10px;
    /* border-radius: 0 0 8px 8px; */
  }

  /* Vertical split handle (horizontal bar) - indicators go left/right */
  .handle-drop-indicator.vertical {
    top: 50%;
    transform: translateY(-50%);
    width: 60px;
    height: max(100px, 20vh);
  }

  .handle-drop-indicator.vertical.before {
    right: 100%;
    margin-right: 10px;
    /* border-radius: 8px 0 0 8px; */
  }

  .handle-drop-indicator.vertical.after {
    left: 100%;
    margin-left: 10px;
    /* border-radius: 0 8px 8px 0; */
  }

  .drop-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: hsl(var(--primary));
    background: hsl(var(--background) / 0.9);
    padding: 0.25rem 0.5rem;
    /* border-radius: 10px; */
    white-space: nowrap;
  }
</style>
