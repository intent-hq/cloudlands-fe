<script lang="ts">
  import type { Snippet } from 'svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import type { PanelCanvasSizing } from '$shared/panel-layout-sizing';
  import { getPanelCanvasWidths } from './panel-canvas-width';

  let {
    sizing,
    viewportWidth,
    panelColumnCount,
    canvasWidth,
    transientWidthDelta = 0,
    scrollContainer,
    onWidthChange,
    onResizeStart,
    onResizePreview,
    onResizeEnd,
    children,
  }: {
    sizing: PanelCanvasSizing;
    viewportWidth: number;
    panelColumnCount: number;
    /**
     * Persisted canvas width from Redux (`null` before the user resizes).
     * When present it drives `defaultWidth`, so middle-handle drags that
     * dispatch `resizePanelLayoutAtHorizontalPanel` grow the outer canvas.
     * The resolved Redux width is authoritative rather than an additive delta,
     * so a direct outer-handle drag cannot be applied twice after commit.
     * When absent, the canvas falls back to
     * the active sizing mode's automatic width.
     */
    canvasWidth: number | null;
    /** Live width delta while an inner panel handle is being dragged. */
    transientWidthDelta?: number;
    scrollContainer: HTMLElement | null;
    onWidthChange: (width: number) => void;
    onResizeStart: () => void;
    onResizePreview: (delta: number) => void;
    onResizeEnd: (previousWidth: number, nextWidth: number) => void;
    children: Snippet;
  } = $props();

  const widths = $derived(
    getPanelCanvasWidths(viewportWidth, panelColumnCount, sizing, canvasWidth),
  );
</script>

<ResizablePanel
  storageKey={null}
  minWidth={widths.minWidth}
  maxWidth={widths.defaultWidth + 2560}
  defaultWidth={widths.defaultWidth}
  side="left"
  resizeScrollContainer={scrollContainer}
  syncWithDefaultWidth={true}
  {transientWidthDelta}
  disableWidthTransition={true}
  showHandleIndicator={true}
  handleClassName="right-0! panel-canvas-resize-handle"
  {onWidthChange}
  {onResizeStart}
  onResize={(_previousWidth, nextWidth) => onResizePreview(nextWidth - widths.defaultWidth)}
  {onResizeEnd}
  className="h-full min-h-0 mx-0!"
>
  {@render children()}
</ResizablePanel>

<style>
  :global(.panel-canvas-resize-handle[data-resize-axis='x'])::before {
    right: 0;
    left: auto;
    transform: none;
  }

  :global(
    .panel-canvas-resize-handle[data-resize-indicator='short'][data-resize-axis='x']
  )::before {
    transform: translateY(-50%);
  }
</style>
