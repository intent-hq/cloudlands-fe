<script lang="ts">
  /**
   * PanelSplitHandle - Resizable divider between panels
   *
   * Allows users to resize panels by dragging the handle.
   * Also serves as a drop zone for creating splits at the container level.
   *
   * In fixed-column workspaces, horizontal handles accept only left/right column drops.
   */

  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import { getDraggedPane } from './panel-drag';

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
    /** Apply pointer deltas before mouse-up when preview geometry is commit-critical. */
    immediateResize?: boolean;
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
    immediateResize = false,
    onTabDropToHandle,
  }: Props = $props();

  let isDragging = $state(false);
  let startPos = $state(0);

  let handleRef: HTMLButtonElement;

  // Custom MIME type for tab drag (must match PanelTabBar)
  const TAB_DRAG_MIME = 'application/x-panel-tab';

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    isDragging = true;
    startPos = direction === 'horizontal' ? e.clientX : e.clientY;
    pendingResizeDelta = 0;
    onResizeStart?.();

    // Add class to body to disable pointer events on iframes during drag
    // This prevents iframes (like browser panels) from capturing mouse events
    document.body.classList.add('panel-resizing');

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  let pendingResizeDelta = 0;
  let resizeFrame: number | null = null;

  function flushPendingResize() {
    resizeFrame = null;
    const delta = pendingResizeDelta;
    pendingResizeDelta = 0;
    if (delta !== 0) onResize?.(delta);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;

    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = currentPos - startPos;

    if (delta !== 0) {
      pendingResizeDelta += delta;
      startPos = currentPos;
      if (immediateResize) {
        flushPendingResize();
      } else {
        resizeFrame ??= requestAnimationFrame(flushPendingResize);
      }
    }
  }

  function handleMouseUp() {
    isDragging = false;
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
      flushPendingResize();
    }
    if (typeof onResizeEnd === 'function') {
      onResizeEnd();
    }

    // Remove the class that disables iframe pointer events
    document.body.classList.remove('panel-resizing');

    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  interface DropZoneInfo {
    position: HandleDropZone;
    insertDirection: 'horizontal' | 'vertical';
  }

  function getDropZoneInfo(e: DragEvent): DropZoneInfo | null {
    if (!handleRef || direction !== 'horizontal') return null;

    const rect = handleRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 2) {
      return {
        position: 'before',
        insertDirection: 'horizontal',
      };
    }
    return {
      position: 'after',
      insertDirection: 'horizontal',
    };
  }

  // Current drop zone info
  let currentZoneInfo = $state<DropZoneInfo | null>(null);

  function handleTabDragOver(e: DragEvent) {
    if (getDraggedPane()) return;
    if (!e.dataTransfer?.types.includes(TAB_DRAG_MIME)) return;

    e.preventDefault();
    e.stopPropagation();

    currentZoneInfo = getDropZoneInfo(e);
  }

  function handleTabDragLeave(e: DragEvent) {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget && handleRef?.contains(relatedTarget)) return;

    currentZoneInfo = null;
  }

  function handleTabDrop(e: DragEvent) {
    if (getDraggedPane()) return;
    e.preventDefault();
    e.stopPropagation();

    const zoneInfo = currentZoneInfo;
    currentZoneInfo = null;

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
    'app-resize-handle panel-split-handle',
    direction === 'horizontal' ? 'horizontal' : 'vertical',
    isDragging && 'dragging',
  )}
  data-resize-axis={direction === 'horizontal' ? 'x' : 'y'}
  data-resizing={isDragging}
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
    z-index: 35;
  }

  /* 8px gap, handle is 16px wide, so margin = -(16 - 8) / 2 = -4px each side */
  .panel-split-handle.horizontal {
    width: 16px;
    margin: 0 -4px;
  }

  .panel-split-handle.vertical {
    height: 16px;
    width: 100%;
    margin: -4px 0;
  }
</style>
