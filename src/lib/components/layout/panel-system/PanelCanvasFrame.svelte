<script lang="ts">
  import type { Snippet } from 'svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import type { PanelCanvasSizing } from '$shared/panel-layout-sizing';
  import type { PanelCanvasWidthSource } from '$store/renderer/slices/panel-layout/panel-layout-width-provenance';
  import { getPanelCanvasWidths } from './panel-canvas-width';

  let {
    active = true,
    sizing,
    viewportWidth,
    panelColumnWidths,
    resetPanelColumnWidths = panelColumnWidths,
    canvasWidth: providedCanvasWidth,
    canvasWidthSource = 'explicit',
    scrollContainer,
    onWidthChange,
    onResizeStart,
    onResizePreview,
    onResizeEnd,
    onResizeCancel,
    children,
  }: {
    active?: boolean;
    sizing: PanelCanvasSizing;
    viewportWidth: number;
    panelColumnWidths: readonly number[];
    resetPanelColumnWidths?: readonly number[];
    /**
     * Persisted canvas width from Redux (`null` before the user resizes).
     * When present it drives `defaultWidth`. When absent, the canvas falls back
     * to the active sizing mode's automatic width.
     */
    canvasWidth: number | null;
    canvasWidthSource?: PanelCanvasWidthSource | null;
    scrollContainer: HTMLElement | null;
    onWidthChange: (width: number) => void;
    onResizeStart: () => void;
    onResizePreview: (delta: number) => void;
    onResizeEnd: (previousWidth: number, nextWidth: number) => void;
    onResizeCancel: () => void;
    children: Snippet;
  } = $props();

  const widths = $derived(
    getPanelCanvasWidths(
      viewportWidth,
      panelColumnWidths,
      sizing,
      providedCanvasWidth,
      canvasWidthSource,
      resetPanelColumnWidths,
    ),
  );
</script>

<ResizablePanel
  {active}
  storageKey={null}
  minWidth={widths.minWidth}
  maxWidth={widths.defaultWidth + 2560}
  defaultWidth={widths.defaultWidth}
  resetWidth={widths.resetWidth}
  side="left"
  resizeScrollContainer={scrollContainer}
  syncWithDefaultWidth={true}
  disableWidthTransition={true}
  showHandleIndicator={true}
  handleClassName="panel-canvas-resize-handle"
  lockRenderedWidthDuringResize={sizing === 'viewport'}
  {onWidthChange}
  {onResizeStart}
  onResize={(_previousWidth, nextWidth) => onResizePreview(nextWidth - widths.defaultWidth)}
  {onResizeEnd}
  {onResizeCancel}
  className="h-full min-h-0 mx-0!"
>
  {@render children()}
</ResizablePanel>
