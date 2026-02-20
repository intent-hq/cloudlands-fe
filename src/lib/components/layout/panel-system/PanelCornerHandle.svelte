<script lang="ts">
  /**
   * PanelCornerHandle - Corner resize handle for multi-directional resizing
   *
   * Placed at the intersection of horizontal and vertical split handles.
   * Allows resizing in both directions simultaneously.
   */

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
  class={cn('panel-corner-handle', isDragging && 'dragging')}
  aria-label="Resize panel corner"
  {style}
  onmousedown={handleMouseDown}
></button>

<style>
  .panel-corner-handle {
    position: absolute;
    width: 20px;
    height: 20px;
    background: transparent;
    border: 0;
    padding: 0;
    appearance: none;
    cursor: move;
    z-index: 36;
    /* Center on the corner intersection */
    transform: translate(-50%, -50%);
  }

  .panel-corner-handle:after {
    content: '';
    position: absolute;
    inset: 6px;
    background: transparent;
    border-radius: 2px;
  }
  .panel-corner-handle:hover:after,
  .panel-corner-handle.dragging:after {
    background-color: hsl(var(--primary));
  }
</style>
