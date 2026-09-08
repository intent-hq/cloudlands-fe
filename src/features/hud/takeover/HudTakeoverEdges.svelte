<script lang="ts">
  /**
   * Dependency-edge layer for the takeover task map — an absolutely
   * positioned SVG spanning the whole canvas box, rendered UNDER the cells
   * inside `.ov-map-pan` so it pans/scales with them. Edge kinds: `dep`
   * (dependency, stroked with its source task's palette color and dimmed
   * once the destination is underway/finished), `spec` (spec root →
   * rootless task, subtler), `conflict` (advisory, dashed, no arrowhead).
   * Arrowheads point at the dependent task and take the edge's color via
   * per-palette-slot markers; they render at a fixed user-space size
   * (`markerUnits="userSpaceOnUse"`, sized to match a 1.5-wide stroke) so
   * the hover stroke thickening never scales them.
   * Pulse treatments (derived upstream, see
   * `takeoverEdgePulse`): live conflicts pulse red, dep edges into a
   * ready-to-start task render green and pulse; the pulse animation is
   * gated on the overlay's `motion` flag — reduced motion keeps the same
   * static colors (parity with the overlay's `.ov-no-motion` handling).
   * While a task cell is hovered (`hoveredTaskId`), every edge touching it
   * renders full-strength (dim + pulse suppressed) with a thicker stroke;
   * unrelated edges keep their normal rendering.
   */
  import {
    HUD_TAKEOVER_EDGE_PALETTE,
    HUD_TAKEOVER_EDGE_READY_COLOR,
    takeoverEdgePathD,
    takeoverEdgeTouchesTask,
    type HudTakeoverMapEdge,
  } from './hud-takeover-edges';

  let {
    edges,
    box,
    motion,
    hoveredTaskId = null,
  }: {
    edges: HudTakeoverMapEdge[];
    box: { left: number; top: number; width: number; height: number };
    motion: boolean;
    hoveredTaskId?: string | null;
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
        markerUnits="userSpaceOnUse"
        markerWidth="10.5"
        markerHeight="10.5"
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
          markerUnits="userSpaceOnUse"
          markerWidth="10.5"
          markerHeight="10.5"
          orient="auto-start-reverse"
        >
          <path d="M0 0.5 L7.5 4 L0 7.5 Z" fill={color} />
        </marker>
      {/each}
      <marker
        id="ov-edge-arrow-ready"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerUnits="userSpaceOnUse"
        markerWidth="10.5"
        markerHeight="10.5"
        orient="auto-start-reverse"
      >
        <path d="M0 0.5 L7.5 4 L0 7.5 Z" fill={HUD_TAKEOVER_EDGE_READY_COLOR} />
      </marker>
    </defs>
    {#each edges as edge (edge.id)}
      {@const hovered = takeoverEdgeTouchesTask(edge, hoveredTaskId)}
      <path
        class={`ov-edge ov-edge-${edge.kind}`}
        class:ov-edge-hover={hovered}
        class:ov-edge-dim={edge.dimmed && !hovered}
        class:ov-edge-conflict-live={edge.pulse === 'conflict'}
        class:ov-edge-ready={edge.pulse === 'ready'}
        class:ov-edge-pulse={motion && edge.pulse !== null && !hovered}
        d={takeoverEdgePathD(edge.points)}
        style:stroke={edge.pulse === 'ready'
          ? HUD_TAKEOVER_EDGE_READY_COLOR
          : edge.colorIndex === null
            ? undefined
            : HUD_TAKEOVER_EDGE_PALETTE[edge.colorIndex]}
        marker-end={edge.kind === 'conflict'
          ? undefined
          : edge.pulse === 'ready'
            ? 'url(#ov-edge-arrow-ready)'
            : edge.colorIndex === null
              ? 'url(#ov-edge-arrow-spec)'
              : `url(#ov-edge-arrow-c${edge.colorIndex})`}
        data-testid="hud-takeover-edge"
        data-kind={edge.kind}
        data-pulse={edge.pulse}
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
    stroke: hsl(var(--danger) / 0.55);
    stroke-dasharray: 4 5;
  }
  /* Live conflict (neither endpoint complete or cancelled): full-strength red. */
  .ov-edge-conflict-live {
    stroke: hsl(var(--danger) / 0.9);
  }
  /* Ready-to-start pathway: stroke comes inline (success green). The wide
     stroke is the static differentiator from a plain slot-1 (same green)
     dep edge under reduced motion — dashes stay reserved for conflicts. */
  .ov-edge-ready {
    stroke-width: 2.5;
  }
  /* Consumed dep edge (destination underway/finished) or resolved conflict
     (either endpoint complete or cancelled): dim line + arrowhead, static. */
  .ov-edge-dim {
    opacity: 0.35;
  }
  /* Edge touching the hovered task cell: full-strength (the dim and pulse
     classes are withheld in markup) with a thicker stroke — declared after
     .ov-edge-ready so its width wins on hovered ready edges. */
  .ov-edge-hover {
    opacity: 1;
    stroke-width: 3;
  }
  /* Attention pulse (live conflict / ready pathway); class applied only
     when the overlay's motion flag allows animation. */
  .ov-edge-pulse {
    animation: ovedgepulse 2.1s ease-in-out infinite;
  }
  @keyframes ovedgepulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
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
    .ov-edge-pulse {
      animation: none;
    }
  }
  :global(.ov-no-motion) .ov-map-edges {
    animation: none;
  }
  :global(.ov-no-motion) .ov-edge-pulse {
    animation: none;
  }
</style>
