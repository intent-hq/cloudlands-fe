<script lang="ts">
  import type { GraphEdge } from './types';
  import { EDGE_STYLES } from './constants';
  import { activityMotion, edgeAnimationDuration, isRecentlyActive } from './activity-motion';

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

  const activeEdges = $derived(
    edges.filter((edge) => edge.isActive || isRecentlyActive(edge.timestamp)).slice(0, 40),
  );

  function opacityFor(edge: GraphEdge): number {
    const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.default;
    if (!spotlightNodeId) return style.opacity;
    return edge.sourceId === spotlightNodeId || edge.targetId === spotlightNodeId
      ? style.opacity
      : 0.15;
  }
</script>

<svg
  use:activityMotion
  class="edge-layer pointer-events-none absolute inset-0 h-full w-full overflow-visible"
  aria-hidden="true"
>
  {#each edges as edge (edge.id)}
    {@const source = positions.get(edge.sourceId)}
    {@const target = positions.get(edge.targetId)}
    {@const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.default}
    {#if source && target}
      <line
        class:delegation-pulse={edge.type === 'delegation' && isRecentlyActive(edge.timestamp)}
        class:waiting-breathe={edge.type === 'waiting-on'}
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
  {#each activeEdges as edge (`${edge.id}:${edge.timestamp}`)}
    {@const source = positions.get(edge.sourceId)}
    {@const target = positions.get(edge.targetId)}
    {@const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.default}
    {#if source && target}
      <circle class="activity-particle" r="3" fill={style.stroke} opacity={opacityFor(edge)}>
        <animateMotion
          path={`M ${source.x} ${source.y} L ${target.x} ${target.y}`}
          dur={`${edgeAnimationDuration(source, target)}s`}
          repeatCount="1"
          fill="freeze"
        />
      </circle>
    {/if}
  {/each}
</svg>

<style>
  .delegation-pulse {
    animation: delegation-pulse 900ms ease-out 1;
  }
  .waiting-breathe {
    animation: waiting-breathe 2.8s ease-in-out infinite;
  }
  :global(.edge-layer[data-motion-enabled='false']) .activity-particle {
    display: none;
  }
  :global(.edge-layer[data-motion-enabled='false']) :is(.delegation-pulse, .waiting-breathe) {
    animation: none;
  }
  @keyframes delegation-pulse {
    50% {
      stroke-width: 4;
      opacity: 1;
    }
  }
  @keyframes waiting-breathe {
    50% {
      opacity: 0.35;
      stroke-dashoffset: 14;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .activity-particle {
      display: none;
    }
    .delegation-pulse,
    .waiting-breathe {
      animation: none;
    }
  }
</style>
