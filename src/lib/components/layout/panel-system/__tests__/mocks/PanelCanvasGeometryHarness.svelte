<script lang="ts">
  import type { PanelCanvasSizing } from '$shared/panel-layout-sizing';
  import PanelCanvasFrame from '../../PanelCanvasFrame.svelte';

  let {
    sizing,
    viewportWidth,
    panelColumnWidths,
    canvasWidth,
    longContent = false,
    onResizeEnd,
  }: {
    sizing: PanelCanvasSizing;
    viewportWidth: number;
    panelColumnWidths: readonly number[];
    canvasWidth: number | null;
    longContent?: boolean;
    onResizeEnd: (previousWidth: number, nextWidth: number) => void;
  } = $props();
</script>

<PanelCanvasFrame
  {sizing}
  {viewportWidth}
  {panelColumnWidths}
  {canvasWidth}
  scrollContainer={null}
  onWidthChange={() => {}}
  onResizeStart={() => {}}
  onResizePreview={() => {}}
  {onResizeEnd}
  onResizeCancel={() => {}}
>
  <div data-testid="canvas-content" class="h-full min-w-0 overflow-hidden">
    {#if longContent}
      <span data-testid="long-content" class="block w-[4000px] whitespace-nowrap">
        Unbreakable_content_that_must_not_inflate_the_panel_canvas
      </span>
    {/if}
  </div>
</PanelCanvasFrame>
