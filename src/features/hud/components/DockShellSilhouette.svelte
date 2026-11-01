<script lang="ts">
  import type { DockPointerRect } from '$shared/dock-layout';
  import type { DockPlacementSnapshot } from '$shared/dock-placement';
  import { fade } from '$lib/motion';
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
  /** With a drop target, only its preview shows; the dragged shell keeps the pointer, unseen. */
  const draggedHidden = $derived(!!preview);
  /**
   * The drop target drawn in its real form (notch contour, side rail, floating bar),
   * filled with the dark dock palette the shell takes while dragging. Keyed by shape so
   * a change of target cross-fades; each frozen copy keeps its own geometry.
   */
  const previews = $derived.by(() => {
    if (!preview) return [];
    const { x, y, width, height } = preview.surface;
    const local = { x: 0, y: 0, width, height };
    const edgeSide = preview.placement.kind === 'edge' ? preview.placement.side : null;
    const d =
      preview.shape === 'notch'
        ? `${getDockNotchContour(local)} Z`
        : preview.shape === 'edge'
          ? `${getDockEdgeContour(local, local, local, edgeSide)} Z`
          : getDockSilhouette(local, '', '', preview.shape === 'top-pill' ? height / 2 : 14);
    return [
      {
        shape: preview.shape,
        d,
        left: x - placement.surface.x,
        top: y - placement.surface.y,
        width,
        height,
      },
    ];
  });
</script>

{#if dragging || placement.shape === 'floating'}
  <div
    class="shell-elevation"
    class:dragged-hidden={draggedHidden}
    aria-hidden="true"
    style:left={`${shown.x}px`}
    style:top={`${shown.y}px`}
    style:width={`${shown.width}px`}
    style:height={`${shown.height}px`}
  ></div>
{/if}
{#if preview}
  <div
    class="snap-preview"
    data-testid="dock-snap-preview"
    data-dock-drag-target
    data-target={preview.shape}
    aria-hidden="true"
  >
    {#each previews as target (target.shape)}
      <svg
        class="snap-preview-shape"
        width={target.width}
        height={target.height}
        overflow="visible"
        style:left={`${target.left}px`}
        style:top={`${target.top}px`}
        in:fade={{ tier: 'fast' }}
        out:fade={{ tier: 'fast' }}
      >
        <path d={target.d} />
      </svg>
    {/each}
  </div>
{/if}
<svg
  class="shell-silhouette"
  class:dragged-hidden={draggedHidden}
  width="100%"
  height="100%"
  overflow="visible"
  aria-hidden="true"
>
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
  /* One form while dragging: with a drop target the dragged shell (outline, shadow,
     contents and grip) fades out but keeps owning the gesture; only the preview shows. */
  .shell-silhouette,
  .shell-elevation,
  :global(.companion.dragging > .companion-content) {
    transition: opacity var(--spring-fast) var(--spring-fast-ease);
  }
  .dragged-hidden,
  :global(.companion.dragging:has(> [data-dock-drag-target]) > .companion-content) {
    opacity: 0;
  }
  .snap-preview {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .snap-preview-shape {
    position: absolute;
    pointer-events: none;
  }
  /* The dragged shell uses the dark dock palette, so the preview is never light-filled. */
  .snap-preview-shape path {
    fill: hsl(var(--dock-surface));
    stroke: hsl(var(--dock-border));
    stroke-width: 1px;
  }
</style>
