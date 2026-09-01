<script lang="ts">
  /**
   * PanelCornerHandle - Corner resize handle for multi-directional resizing
   *
   * Placed at the intersection of horizontal and vertical split handles.
   * Allows resizing in both directions simultaneously.
   */

  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';

  interface Props {
    onResize?: (deltaX: number, deltaY: number) => void;
    onResizeStart?: () => void;
    onResizeEnd?: () => void;
    /** Inline style for positioning */
    style?: string;
  }

  let { onResize, onResizeStart, onResizeEnd, style }: Props = $props();

  let isDragging = $state(false);
  let startX = $state(0);
  let startY = $state(0);

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    onResizeStart?.();

    // Add class to body to disable pointer events on iframes during drag
    document.body.classList.add('panel-resizing');

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    if (deltaX !== 0 || deltaY !== 0) {
      onResize?.(deltaX, deltaY);
      startX = e.clientX;
      startY = e.clientY;
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
</script>

<button
  type="button"
  class={cn('app-resize-handle panel-corner-handle', isDragging && 'dragging')}
  data-resize-axis="both"
  data-resizing={isDragging}
  aria-label={m.layout_panelCornerHandle_resize_ariaLabel()}
  {style}
  onmousedown={handleMouseDown}
></button>

<style>
  .panel-corner-handle {
    position: absolute;
    width: 16px;
    height: 16px;
    z-index: 36;
    /* Center on the corner intersection */
    transform: translate(-50%, -50%);
    /* Clip the leading (top/left) 4px out of hit-testing so the handle never
       covers the top-left neighbor's scrollbars meeting at its corner; see
       PanelSplitHandle for the same rule. */
    clip-path: inset(4px 0 0 4px);
  }
</style>
