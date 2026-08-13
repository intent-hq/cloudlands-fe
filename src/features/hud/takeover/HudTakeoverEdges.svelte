<script lang="ts">
  /**
   * Dependency-edge layer for the takeover task map — an absolutely
   * positioned SVG spanning the whole canvas box, rendered UNDER the cells
   * inside `.ov-map-pan` so it pans/scales with them. Edge kinds: `dep`
   * (dependency, stroked with its source task's palette color and dimmed
   * once the destination is underway/finished), `spec` (spec root →
   * rootless task, subtler), `conflict` (advisory, dashed, no arrowhead).
   * Arrowheads point at the dependent task and take the edge's color via
   * per-palette-slot markers.
   */
  import {
    HUD_TAKEOVER_EDGE_PALETTE,
    takeoverEdgePathD,
    type HudTakeoverMapEdge,
  } from './hud-takeover-edges';

  let {
    edges,
    box,
  }: {
    edges: HudTakeoverMapEdge[];
    box: { left: number; top: number; width: number; height: number };
  } = $props();
</script>

{#if edges.length > 0}
  <svg
    class="ov-map-edges"
    style:left={`${box.left}px`}
    style:top={`${box.top}px`}
    width={box.width}
    height={box.height}
    viewBox={`${box.left} ${box.top} ${box.width} ${box.height}`}
    aria-hidden="true"
    data-testid="hud-takeover-edges"
  >
    <defs>
      <marker
        id="ov-edge-arrow-spec"
        class="ov-edge-arrow-spec"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0 0.5 L7.5 4 L0 7.5 Z" />
      </marker>
      {#each HUD_TAKEOVER_EDGE_PALETTE as color, i (color)}
        <marker
          id={`ov-edge-arrow-c${i}`}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0.5 L7.5 4 L0 7.5 Z" fill={color} />
        </marker>
      {/each}
    </defs>
    {#each edges as edge (edge.id)}
      <path
        class={`ov-edge ov-edge-${edge.kind}`}
        class:ov-edge-dim={edge.dimmed}
        d={takeoverEdgePathD(edge.points)}
        style:stroke={edge.colorIndex === null
          ? undefined
          : HUD_TAKEOVER_EDGE_PALETTE[edge.colorIndex]}
        marker-end={edge.kind === 'conflict'
          ? undefined
          : edge.colorIndex === null
            ? 'url(#ov-edge-arrow-spec)'
            : `url(#ov-edge-arrow-c${edge.colorIndex})`}
        data-testid="hud-takeover-edge"
        data-kind={edge.kind}
      />
    {/each}
  </svg>
{/if}

<style>
  .ov-map-edges {
    position: absolute;
    pointer-events: none;
    overflow: visible;
    animation: ovedgesin 0.4s ease 0.9s both;
  }
  @keyframes ovedgesin {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .ov-edge {
    fill: none;
    stroke-width: 1.5;
  }
  /* Dep strokes come inline from the source task's palette color. */
  .ov-edge-spec {
    stroke: hsl(var(--muted-foreground) / 0.35);
  }
  .ov-edge-conflict {
    stroke: hsl(var(--destructive-foreground) / 0.55);
    stroke-dasharray: 4 5;
  }
  /* Consumed dep edge (destination underway/finished): dim line + arrowhead. */
  .ov-edge-dim {
    opacity: 0.35;
  }
  .ov-edge-arrow-spec path {
    fill: hsl(var(--muted-foreground) / 0.35);
  }

  /* Reduced motion: the layer shows immediately (global override can't
     reach into this component's scoped animation). */
  @media (prefers-reduced-motion: reduce) {
    .ov-map-edges {
      animation: none;
    }
  }
  :global(.ov-no-motion) .ov-map-edges {
    animation: none;
  }
</style>
