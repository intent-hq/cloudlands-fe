<script lang="ts">
  import type { GraphEdge, GraphNode } from './types';
  import { EDGE_STYLES, GRAPH_ACTIVE_ACCENT, GRAPH_NODE_DIMENSIONS } from './constants';
  import { activityMotion, edgeAnimationDuration, isRecentlyActive } from './activity-motion';

  export interface GraphPosition {
    x: number;
    y: number;
  }

  interface Props {
    edges: GraphEdge[];
    nodes: GraphNode[];
    positions: Map<string, GraphPosition>;
    spotlightNodeId?: string | null;
  }

  let { edges, nodes, positions, spotlightNodeId = null }: Props = $props();

  const nodeById = $derived(new Map(nodes.map((node) => [node.id, node])));

  const activeEdges = $derived(
    edges
      .filter(
        (edge) => edge.type !== 'waiting-on' && (edge.isActive || isRecentlyActive(edge.timestamp)),
      )
      .slice(0, 40),
  );

  function opacityFor(edge: GraphEdge): number {
    const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.default;
    if (!spotlightNodeId) return style.opacity;
    return edge.sourceId === spotlightNodeId || edge.targetId === spotlightNodeId
      ? Math.min(1, style.opacity + 0.28)
      : 0.12;
  }

  function isActiveNow(edge: GraphEdge): boolean {
    return edge.type === 'message' && (edge.isActive || isRecentlyActive(edge.timestamp));
  }

  function endpoint(
    from: GraphPosition,
    to: GraphPosition,
    node: GraphNode | undefined,
    extra: number,
  ): GraphPosition {
    if (!node) return from;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) return from;
    const dimensions = GRAPH_NODE_DIMENSIONS[node.type];
    const scale = Math.min(
      (dimensions.width / 2 + extra) / Math.max(Math.abs(dx), 0.001),
      (dimensions.height / 2 + extra) / Math.max(Math.abs(dy), 0.001),
    );
    return { x: from.x + dx * scale, y: from.y + dy * scale };
  }

  function endpointsFor(
    edge: GraphEdge,
    source: GraphPosition,
    target: GraphPosition,
  ): { source: GraphPosition; target: GraphPosition } {
    return {
      source: endpoint(source, target, nodeById.get(edge.sourceId), 3),
      target: endpoint(target, source, nodeById.get(edge.targetId), 5),
    };
  }

  function pathFor(source: GraphPosition, target: GraphPosition): string {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const bend = Math.min(96, Math.max(24, Math.abs(dx) * 0.36));
      const direction = Math.sign(dx) || 1;
      return `M ${source.x} ${source.y} C ${source.x + bend * direction} ${source.y}, ${target.x - bend * direction} ${target.y}, ${target.x} ${target.y}`;
    }
    const bend = Math.min(96, Math.max(24, Math.abs(dy) * 0.36));
    const direction = Math.sign(dy) || 1;
    return `M ${source.x} ${source.y} C ${source.x} ${source.y + bend * direction}, ${target.x} ${target.y - bend * direction}, ${target.x} ${target.y}`;
  }

  function labelFor(edge: GraphEdge): string | null {
    if (edge.type === 'file-write' || edge.type === 'note-write') {
      if (!edge.additions && !edge.deletions) return null;
      return `+${edge.additions ?? 0} −${edge.deletions ?? 0}`;
    }
    if (edge.type === 'message') return `×${edge.count}`;
    return null;
  }
</script>

<svg
  use:activityMotion
  class="edge-layer pointer-events-none absolute inset-0 h-full w-full overflow-visible"
  aria-hidden="true"
>
  <defs>
    <marker
      id="graph-edge-dot"
      markerWidth="4"
      markerHeight="4"
      refX="2"
      refY="2"
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <circle cx="2" cy="2" r="2" fill="context-stroke" />
    </marker>
    <marker
      id="graph-edge-arrow"
      markerWidth="4"
      markerHeight="4"
      refX="4"
      refY="2"
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path d="M 0 0 L 4 2 L 0 4 Z" fill="context-stroke" />
    </marker>
  </defs>
  {#each edges as edge (edge.id)}
    {@const source = positions.get(edge.sourceId)}
    {@const target = positions.get(edge.targetId)}
    {@const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.default}
    {@const stroke = isActiveNow(edge) ? GRAPH_ACTIVE_ACCENT : style.stroke}
    {#if source && target}
      {@const endpoints = endpointsFor(edge, source, target)}
      {@const path = pathFor(endpoints.source, endpoints.target)}
      {@const label = labelFor(edge)}
      <path
        class:delegation-pulse={edge.type === 'delegation' && isRecentlyActive(edge.timestamp)}
        class:waiting-breathe={edge.type === 'waiting-on'}
        d={path}
        fill="none"
        {stroke}
        stroke-width={style.strokeWidth}
        stroke-dasharray={style.strokeDasharray}
        stroke-linecap="round"
        marker-start="url(#graph-edge-dot)"
        marker-end="url(#graph-edge-arrow)"
        opacity={opacityFor(edge)}
        data-edge-id={edge.id}
        data-edge-type={edge.type}
        data-active={edge.isActive}
        data-last-activity-at={edge.timestamp}
      />
      {#if label}
        {@const labelWidth = 12 + label.length * 6}
        <g
          transform={`translate(${(endpoints.source.x + endpoints.target.x) / 2} ${(endpoints.source.y + endpoints.target.y) / 2})`}
          opacity={Math.min(1, opacityFor(edge) + 0.18)}
        >
          <rect
            x={-labelWidth / 2}
            y="-8"
            width={labelWidth}
            height="16"
            rx="8"
            fill="var(--color-card)"
            stroke="var(--color-border)"
            stroke-width="1"
          />
          <text
            text-anchor="middle"
            dominant-baseline="central"
            fill="var(--color-muted-foreground)"
            font-family="var(--font-code)"
            font-size="10">{label}</text
          >
        </g>
      {/if}
    {/if}
  {/each}
  {#each activeEdges as edge (`${edge.id}:${edge.timestamp}`)}
    {@const source = positions.get(edge.sourceId)}
    {@const target = positions.get(edge.targetId)}
    {#if source && target}
      {@const endpoints = endpointsFor(edge, source, target)}
      <circle class="activity-particle" r="2" fill={GRAPH_ACTIVE_ACCENT} opacity={opacityFor(edge)}>
        <animateMotion
          path={pathFor(endpoints.source, endpoints.target)}
          dur={`${edgeAnimationDuration(endpoints.source, endpoints.target)}s`}
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
