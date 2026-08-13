<script lang="ts">
  /**
   * Dependency-edge layer for the takeover task map — an absolutely
   * positioned SVG spanning the whole canvas box, rendered UNDER the cells
   * inside `.ov-map-pan` so it pans/scales with them. Edge kinds: `dep`
   * (met dependency), `unmet` (daemon-computed `unmetDependsOn`), `spec`
   * (spec root → rootless task, subtler), `conflict` (advisory, dashed, no
   * arrowhead). Arrowheads point at the dependent task.
   */
  import type { HudTakeoverMapEdge } from './hud-takeover-edges';

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
      {#each ['dep', 'unmet', 'spec'] as kind (kind)}
        <marker
          id={`ov-edge-arrow-${kind}`}
          class={`ov-edge-arrow-${kind}`}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0.5 L7.5 4 L0 7.5 Z" />
        </marker>
      {/each}
    </defs>
    {#each edges as edge (edge.id)}
      <polyline
        class={`ov-edge ov-edge-${edge.kind}`}
        points={edge.points.map((p) => `${p.x},${p.y}`).join(' ')}
        marker-end={edge.kind === 'conflict' ? undefined : `url(#ov-edge-arrow-${edge.kind})`}
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
  .ov-edge-dep {
    stroke: hsl(var(--muted-foreground) / 0.75);
  }
  .ov-edge-unmet {
    /* Thicker stroke doubles as a non-color cue vs met deps (a11y). */
    stroke: hsl(var(--warning) / 0.85);
    stroke-width: 2.5;
  }
  .ov-edge-spec {
    stroke: hsl(var(--muted-foreground) / 0.35);
  }
  .ov-edge-conflict {
    stroke: hsl(var(--destructive-foreground) / 0.55);
    stroke-dasharray: 4 5;
  }
  .ov-edge-arrow-dep path {
    fill: hsl(var(--muted-foreground) / 0.75);
  }
  .ov-edge-arrow-unmet path {
    fill: hsl(var(--warning) / 0.85);
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
