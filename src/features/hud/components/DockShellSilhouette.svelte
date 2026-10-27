<script lang="ts">
  import type { DockPointerRect } from '$shared/dock-layout';
  import type { DockPlacementSnapshot } from '$shared/dock-placement';
  import {
    getDockEdgeContour,
    getDockNotchContour,
    getDockSilhouette,
  } from './dock-shell-geometry';

  let { placement, shown }: { placement: DockPlacementSnapshot; shown: DockPointerRect } = $props();
  const dragging = $derived(placement.phase === 'dragging');
  const side = $derived(placement.placement.kind === 'edge' ? placement.placement.side : null);
  const notch = $derived(!dragging && placement.shape === 'notch');
  const edge = $derived(!dragging && placement.shape === 'edge');
  const edgeContour = $derived(
    edge ? getDockEdgeContour(shown, placement.surface, placement.windowBounds, side) : '',
  );
  const notchContour = $derived(notch ? getDockNotchContour(shown) : '');
  const silhouette = $derived(getDockSilhouette(shown, notchContour, edgeContour, 14));
  const preview = $derived(dragging ? placement.dragTarget : null);
</script>

{#if dragging || placement.shape === 'floating'}
  <div
    class="shell-elevation"
    aria-hidden="true"
    style:left={`${shown.x}px`}
    style:top={`${shown.y}px`}
    style:width={`${shown.width}px`}
    style:height={`${shown.height}px`}
  ></div>
{/if}
{#if preview}
  <svg
    class="snap-preview"
    data-testid="dock-snap-preview"
    data-target={preview.shape}
    aria-hidden="true"
    width={preview.surface.width}
    height={preview.surface.height}
    style:left={`${preview.surface.x - placement.surface.x}px`}
    style:top={`${preview.surface.y - placement.surface.y}px`}
  >
    <rect
      x="1"
      y="1"
      width={Math.max(0, preview.surface.width - 2)}
      height={Math.max(0, preview.surface.height - 2)}
      rx="14"
    />
  </svg>
{/if}
<svg class="shell-silhouette" width="100%" height="100%" overflow="visible" aria-hidden="true">
  <path d={silhouette} />
</svg>

<style>
  .shell-silhouette {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .shell-silhouette path {
    fill: hsl(var(--popover));
  }
  .shell-elevation {
    position: absolute;
    pointer-events: none;
    border-radius: 14px;
    box-shadow: var(--elevation-overlay);
  }
  .snap-preview {
    position: absolute;
    pointer-events: none;
  }
  .snap-preview rect {
    fill: none;
    stroke: hsl(var(--foreground) / 0.4);
    stroke-width: 1px;
  }
</style>
