<script lang="ts">
  import type { GraphEdge } from './types';
  import { EDGE_STYLES } from './constants';

  export interface GraphPosition {
    x: number;
    y: number;
  }

  interface Props {
    edges: GraphEdge[];
    positions: Map<string, GraphPosition>;
    spotlightNodeId?: string | null;
  }

  let { edges, positions, spotlightNodeId = null }: Props = $props();

  function opacityFor(edge: GraphEdge): number {
    const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.default;
    if (!spotlightNodeId) return style.opacity;
    return edge.sourceId === spotlightNodeId || edge.targetId === spotlightNodeId
      ? style.opacity
      : 0.15;
  }
</script>

<svg class="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
  {#each edges as edge (edge.id)}
    {@const source = positions.get(edge.sourceId)}
    {@const target = positions.get(edge.targetId)}
    {@const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.default}
    {#if source && target}
      <line
        x1={source.x}
        y1={source.y}
        x2={target.x}
        y2={target.y}
        stroke={style.stroke}
        stroke-width={style.strokeWidth}
        stroke-dasharray={style.strokeDasharray}
        stroke-linecap="round"
        opacity={opacityFor(edge)}
        data-edge-id={edge.id}
        data-edge-type={edge.type}
        data-active={edge.isActive}
        data-last-activity-at={edge.timestamp}
      />
    {/if}
  {/each}
</svg>
