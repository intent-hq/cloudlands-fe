<script lang="ts">
  /**
   * Diagram Edge Component
   */
  import type { ComputedEdge } from './types';

  interface Props {
    edge: ComputedEdge;
    dimmed?: boolean;
    highlighted?: boolean;
    /** Unique scope for SVG marker IDs to avoid cross-diagram conflicts */
    markerScope?: string;
  }

  let { edge, dimmed = false, highlighted = false, markerScope = '' }: Props = $props();

  // Get edge class based on semantic style
  let edgeClass = $derived.by(() => {
    const classes = ['diagram-edge'];
    if (edge.semanticStyle) {
      classes.push(`edge-${edge.semanticStyle}`);
    }
    if (edge.animated) {
      classes.push('edge-animated');
    }
    if (edge.dashed) {
      classes.push('edge-dashed');
    }
    if (dimmed) {
      classes.push('edge-dimmed');
    }
    if (highlighted) {
      classes.push('edge-state-highlighted');
    }
    return classes.join(' ');
  });

  // Get the appropriate arrowhead marker based on semantic style, scoped by diagram ID
  const semanticMarkerStyles = new Set(['danger', 'success', 'warning', 'muted', 'inactive', 'highlighted', 'active']);
  let markerSuffix = $derived(markerScope ? `-${markerScope}` : '');
  let markerUrl = $derived(
    edge.semanticStyle && semanticMarkerStyles.has(edge.semanticStyle)
      ? `url(#arrowhead-${edge.semanticStyle}${markerSuffix})`
      : `url(#arrowhead${markerSuffix})`,
  );
</script>

<g class={edgeClass}>
  <!-- Edge path -->
  <path
    d={edge.path}
    class="edge-path"
    marker-end={markerUrl}
    vector-effect="non-scaling-stroke"
  />
</g>



<style>
  :global(.edge-path) {
    fill: none;
    stroke: hsl(var(--border));
    stroke-width: 1px;
    transition: all 0.2s ease;
  }

  :global(.diagram-edge:hover .edge-path) {
    stroke: hsl(var(--foreground) / 0.7);
    stroke-width: 1px;
  }

  :global(.edge-dimmed .edge-path) {
    opacity: 0.15;
    transition: opacity 0.2s ease;
  }

  /* State-level highlighting (from DiagramState.highlightedEdges) */
  :global(.edge-state-highlighted .edge-path) {
    stroke: hsl(var(--accent));
    stroke-width: 1.5px;
  }

  :global(.edge-highlighted .edge-path) {
    stroke: hsl(var(--accent));
    stroke-width: 1px;
  }

  :global(.edge-muted .edge-path) {
    stroke: hsl(var(--muted-foreground) / 0.3);
    stroke-width: 1px;
  }

  :global(.edge-danger .edge-path) {
    stroke: hsl(var(--destructive) / 0.8);
    stroke-width: 1px;
  }

  :global(.edge-success .edge-path) {
    stroke: hsl(142 76% 36% / 0.6);
    stroke-width: 1px;
  }

  :global(.edge-warning .edge-path) {
    stroke: hsl(38 92% 50% / 0.6);
    stroke-width: 1px;
  }

  :global(.edge-inactive .edge-path) {
    stroke: hsl(var(--muted-foreground) / 0.2);
    stroke-width: 1px;
  }

  :global(.edge-active .edge-path) {
    stroke: hsl(var(--accent));
    stroke-width: 1px;
  }

  /* Dashed edge style */
  :global(.edge-dashed .edge-path) {
    stroke-dasharray: 5 4;
  }

  /* Animated flow */
  :global(.edge-animated .edge-path) {
    stroke-dasharray: 6 4;
    animation: dash-flow 1s linear infinite;
  }

  @keyframes dash-flow {
    to {
      stroke-dashoffset: -10;
    }
  }
</style>
