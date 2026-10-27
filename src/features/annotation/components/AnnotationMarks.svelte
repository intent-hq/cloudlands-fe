<script lang="ts">
  import {
    ANNOTATION_PALETTE,
    ANNOTATION_STROKE_WIDTH,
    ANNOTATION_KEYLINE_WIDTH,
    ANNOTATION_CORNER_RADIUS,
    ANNOTATION_FILL_OPACITY,
    annotationStrokePath,
    arrowHeadPoints,
    normalizedBounds,
    type AnnotationAction,
    type AnnotationPalette,
  } from '../utils/annotation-actions';

  let {
    actions,
    width,
    height,
    palette = ANNOTATION_PALETTE,
  }: {
    actions: AnnotationAction[];
    width: number;
    height: number;
    palette?: AnnotationPalette;
  } = $props();
</script>

{#snippet geometry(action: AnnotationAction, outline = false)}
  {#if action.kind === 'stroke'}
    {#if action.points.length === 1}
      <circle
        class="dot"
        cx={action.points[0].x}
        cy={action.points[0].y}
        r={(outline ? ANNOTATION_KEYLINE_WIDTH : ANNOTATION_STROKE_WIDTH) / 2}
      />
    {:else}<path d={annotationStrokePath(action.points)} />{/if}
  {:else if action.kind === 'selection' && !outline}
    {@const rect = normalizedBounds(action)}
    <rect class="selection" x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="4" />
  {:else if action.kind === 'rectangle'}
    {@const rect = normalizedBounds(action)}
    <rect
      class="rectangle"
      fill={outline ? 'none' : palette.ink}
      fill-opacity={ANNOTATION_FILL_OPACITY}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      rx={Math.min(ANNOTATION_CORNER_RADIUS, rect.width / 2, rect.height / 2)}
    />
  {:else if action.kind === 'arrow'}
    {@const head = arrowHeadPoints(action.origin, action.end)}
    <path
      class="arrow"
      d={`M ${action.origin.x} ${action.origin.y} L ${action.end.x} ${action.end.y} M ${head.left.x} ${head.left.y} L ${action.end.x} ${action.end.y} L ${head.right.x} ${head.right.y}`}
    />
  {:else if action.kind === 'pin'}
    <g
      class={outline ? 'pin-outline-group' : 'pin'}
      transform={`translate(${action.point.x} ${action.point.y})`}
    >
      {#if outline}<circle class="pin-outline" r="12" stroke-width="2" />
      {:else}<circle r="12" /><text y="0.5">{action.number}</text>{/if}
    </g>
  {/if}
{/snippet}

<svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
  {#each actions as action}
    <g
      class="outlines"
      style:--annotation-ink={palette.outer}
      stroke-width={ANNOTATION_KEYLINE_WIDTH}
    >
      {@render geometry(action, true)}
    </g>
    <g
      class="marks"
      style:--annotation-ink={palette.ink}
      style:--annotation-paper={palette.inner}
      stroke-width={ANNOTATION_STROKE_WIDTH}
    >
      {@render geometry(action)}
    </g>
  {/each}
</svg>

<style>
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .marks,
  .outlines {
    fill: none;
    stroke: var(--annotation-ink);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dot,
  .pin circle {
    fill: var(--annotation-ink);
    stroke: none;
  }
  .selection {
    fill: hsl(var(--primary) / 0.08);
    stroke: hsl(var(--primary));
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
  }
  .pin-outline {
    fill: none;
    stroke: var(--annotation-ink);
  }
  .pin text {
    fill: var(--annotation-paper);
    stroke: none;
    font:
      600 12px Inter,
      sans-serif;
    text-anchor: middle;
    dominant-baseline: middle;
  }
</style>
