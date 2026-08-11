<script lang="ts">
  import type { Snippet } from 'svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import { getPanelCanvasWidths } from './panel-canvas-width';

  let {
    contained,
    viewportWidth,
    panelColumnCount,
    canvasWidth,
    scrollContainer,
    onWidthChange,
    onResizeEnd,
    children,
  }: {
    contained: boolean;
    viewportWidth: number;
    panelColumnCount: number;
    /**
     * Persisted canvas width from Redux (`null` before the user resizes).
     * When present it drives `defaultWidth`, so middle-handle drags that
     * dispatch `resizePanelLayoutAtHorizontalPanel` grow the outer canvas
     * via `resizeWithDefaultWidth`. When absent, the canvas falls back to
     * the viewport-fill default from `getPanelCanvasWidths`.
     */
    canvasWidth: number | null;
    scrollContainer: HTMLElement | null;
    onWidthChange: (width: number) => void;
    onResizeEnd: (previousWidth: number, nextWidth: number) => void;
    children: Snippet;
  } = $props();

  const widths = $derived(getPanelCanvasWidths(viewportWidth, panelColumnCount));
  const effectiveDefaultWidth = $derived(
    canvasWidth !== null && Number.isFinite(canvasWidth) && canvasWidth > 0
      ? canvasWidth
      : widths.defaultWidth,
  );
</script>

<ResizablePanel
  storageKey={null}
  minWidth={widths.minWidth}
  maxWidth={Math.max(1, viewportWidth) + 1280}
  defaultWidth={effectiveDefaultWidth}
  side="left"
  resizeScrollContainer={scrollContainer}
  doSkipResize={contained}
  resizeWithDefaultWidth={true}
  disableWidthTransition={true}
  showHandleIndicator={true}
  {onWidthChange}
  {onResizeEnd}
  className="h-full min-h-0 mx-0!"
>
  {@render children()}
</ResizablePanel>
