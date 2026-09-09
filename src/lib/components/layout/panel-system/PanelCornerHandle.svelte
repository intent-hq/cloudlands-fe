<script lang="ts">
  /**
   * PanelCornerHandle - Corner resize handle for multi-directional resizing
   *
   * Placed at the intersection of horizontal and vertical split handles.
   * Allows resizing in both directions simultaneously.
   */

  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import { onDestroy } from 'svelte';

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
  let destroyed = false;

  const BODY_RESIZE_OWNERS = Symbol.for('intent.panel-resize-handle-owners');
  const bodyResizeOwner = {};
  type ResizeBody = HTMLElement & { [key: symbol]: unknown };
  type BodyResizeOwnership = { owners: Set<object>; preserveClass: boolean };

  function acquireBodyResizeOwnership() {
    const body = document.body as ResizeBody;
    let ownership = body[BODY_RESIZE_OWNERS] as BodyResizeOwnership | undefined;
    if (!ownership) {
      ownership = {
        owners: new Set(),
        preserveClass: body.classList.contains('panel-resizing'),
      };
      body[BODY_RESIZE_OWNERS] = ownership;
    }
    ownership.owners.add(bodyResizeOwner);
    body.classList.add('panel-resizing');
  }

  function releaseBodyResizeOwnership() {
    const body = document.body as ResizeBody;
    const ownership = body[BODY_RESIZE_OWNERS] as BodyResizeOwnership | undefined;
    if (!ownership?.owners.delete(bodyResizeOwner) || ownership.owners.size > 0) return;
    if (!ownership.preserveClass) body.classList.remove('panel-resizing');
    delete body[BODY_RESIZE_OWNERS];
  }

  function handleMouseDown(e: MouseEvent) {
    if (destroyed || isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    acquireBodyResizeOwnership();
    onResizeStart?.();
    if (destroyed || !isDragging) return;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    if (deltaX !== 0 || deltaY !== 0) {
      onResize?.(deltaX, deltaY);
      if (!isDragging) return;
      startX = e.clientX;
      startY = e.clientY;
    }
  }

  function handleMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    releaseBodyResizeOwnership();
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    if (typeof onResizeEnd === 'function') {
      onResizeEnd();
    }
  }

  function cancelDrag() {
    isDragging = false;
    releaseBodyResizeOwnership();
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  onDestroy(() => {
    destroyed = true;
    cancelDrag();
  });
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
