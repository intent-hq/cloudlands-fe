<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { GraphEdge, GraphNode } from './types';
  import { EDGE_STYLES, GRAPH_ACTIVE_ACCENT, GRAPH_NODE_DIMENSIONS } from './constants';
  import {
    activityMotion,
    edgeAnimationDuration,
    isRecentlyActive,
    messageParticleLimit,
    playbackDuration,
  } from './activity-motion';
  import type { PlaybackSpeed } from './playback';

  export interface GraphPosition {
    x: number;
    y: number;
  }

  interface Props {
    edges: GraphEdge[];
    nodes: GraphNode[];
    positions: Map<string, GraphPosition>;
    spotlightNodeId?: string | null;
    playbackSpeed?: PlaybackSpeed;
    onMessageArrival?: (targetId: string) => void;
  }

  let {
    edges,
    nodes,
    positions,
    spotlightNodeId = null,
    playbackSpeed = 1,
    onMessageArrival = () => {},
  }: Props = $props();

  const nodeById = $derived(new Map(nodes.map((node) => [node.id, node])));

  let travelingEdges = $state<GraphEdge[]>([]);
  const seenMessageEvents = new Set<string>();
  const travelTimers = new Set<ReturnType<typeof setTimeout>>();

  $effect(() => {
    const limit = messageParticleLimit(playbackSpeed);
    const arrivals = edges
      .filter(
        (edge) => edge.type === 'message' && (edge.isActive || isRecentlyActive(edge.timestamp)),
      )
      .filter((edge) => !seenMessageEvents.has(`${edge.id}:${edge.timestamp}`))
      .slice(-limit);
    if (arrivals.length === 0) return;
    arrivals.forEach((edge) => seenMessageEvents.add(`${edge.id}:${edge.timestamp}`));
    travelingEdges = [...travelingEdges, ...arrivals].slice(-limit);
    for (const edge of arrivals) {
      const timer = setTimeout(
        () => {
          travelingEdges = travelingEdges.filter(
            (candidate) =>
              `${candidate.id}:${candidate.timestamp}` !== `${edge.id}:${edge.timestamp}`,
          );
          travelTimers.delete(timer);
        },
        playbackDuration(2_600, playbackSpeed),
      );
      travelTimers.add(timer);
    }
  });

  onDestroy(() => {
    for (const timer of travelTimers) clearTimeout(timer);
  });

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

  function isWorkingEdge(edge: GraphEdge): boolean {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    return (
      edge.type === 'task-assignment' &&
      source?.type === 'agent' &&
      source.status === 'responding' &&
      target?.type === 'task' &&
      target.state === 'in_progress'
    );
  }

  function arrowAngle(source: GraphPosition, target: GraphPosition): number {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 180;
    return dy >= 0 ? 90 : -90;
  }

  function notifyMessageArrival(element: SVGAnimateMotionElement, targetId: string) {
    const notify = () => onMessageArrival(targetId);
    element.addEventListener('endEvent', notify);
    return {
      update(nextTargetId: string) {
        targetId = nextTargetId;
      },
      destroy() {
        element.removeEventListener('endEvent', notify);
      },
    };
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
  {#each edges as edge (edge.id)}
    {@const source = positions.get(edge.sourceId)}
    {@const target = positions.get(edge.targetId)}
    {@const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.default}
    {@const working = isWorkingEdge(edge)}
    {@const stroke = isActiveNow(edge) || working ? GRAPH_ACTIVE_ACCENT : style.stroke}
    {#if source && target}
      {@const endpoints = endpointsFor(edge, source, target)}
      {@const path = pathFor(endpoints.source, endpoints.target)}
      {@const label = labelFor(edge)}
      {@const edgeOpacity = opacityFor(edge)}
      {@const drawDuration = playbackDuration(350, playbackSpeed)}
      <path
        class="edge-path"
        class:delegation-pulse={edge.type === 'delegation' && isRecentlyActive(edge.timestamp)}
        class:waiting-breathe={edge.type === 'waiting-on'}
        class:working-drift={working}
        d={path}
        pathLength="1"
        fill="none"
        {stroke}
        stroke-width={style.strokeWidth}
        stroke-dasharray={style.strokeDasharray}
        stroke-linecap="round"
        opacity={edgeOpacity}
        style:--edge-draw-duration={`${drawDuration}ms`}
        data-edge-id={edge.id}
        data-edge-type={edge.type}
        data-active={edge.isActive}
        data-last-activity-at={edge.timestamp}
      />
      <circle
        cx={endpoints.source.x}
        cy={endpoints.source.y}
        r="2"
        fill={stroke}
        opacity={edgeOpacity}
      />
      <path
        class="edge-arrow"
        d="M 0 -2 L 4 0 L 0 2 Z"
        fill={stroke}
        opacity={edgeOpacity}
        transform={`translate(${endpoints.target.x} ${endpoints.target.y}) rotate(${arrowAngle(endpoints.source, endpoints.target)})`}
        style:--edge-draw-duration={`${drawDuration}ms`}
        style:--edge-opacity={edgeOpacity}
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
  {#each travelingEdges as edge (`${edge.id}:${edge.timestamp}`)}
    {@const source = positions.get(edge.sourceId)}
    {@const target = positions.get(edge.targetId)}
    {#if source && target}
      {@const endpoints = endpointsFor(edge, source, target)}
      <g
        class="message-pill"
        opacity={opacityFor(edge)}
        data-message-particle
        data-target-id={edge.targetId}
      >
        <rect
          x="-14"
          y="-7"
          width="28"
          height="14"
          rx="7"
          fill="var(--color-card)"
          stroke={GRAPH_ACTIVE_ACCENT}
        />
        <text
          text-anchor="middle"
          dominant-baseline="central"
          fill={GRAPH_ACTIVE_ACCENT}
          font-family="var(--font-code)"
          font-size="9"><!-- i18n-ignore (compact graph edge-kind token) -->msg</text
        >
        <animateMotion
          use:notifyMessageArrival={edge.targetId}
          path={pathFor(endpoints.source, endpoints.target)}
          dur={`${edgeAnimationDuration(endpoints.source, endpoints.target, playbackSpeed)}s`}
          calcMode="spline"
          keyTimes="0;1"
          keySplines="0.45 0 0.55 1"
          repeatCount="1"
          fill="freeze"
        />
      </g>
    {/if}
  {/each}
</svg>

<style>
  .delegation-pulse {
    animation: delegation-pulse 900ms ease-out 1;
  }
  .edge-path {
    animation: edge-draw var(--edge-draw-duration) ease-out 1;
  }
  .edge-path.working-drift {
    stroke-dasharray: 5 5;
    animation:
      edge-draw var(--edge-draw-duration) ease-out 1,
      working-drift 3s linear var(--edge-draw-duration) infinite;
  }
  .edge-arrow {
    animation: edge-arrow-in 120ms ease-out calc(var(--edge-draw-duration) - 80ms) both;
  }
  .waiting-breathe {
    animation: waiting-breathe 2.8s ease-in-out infinite;
  }
  :global(.edge-layer[data-motion-enabled='false']) .message-pill {
    display: none;
  }
  :global(.edge-layer[data-motion-enabled='false'])
    :is(.edge-path, .edge-arrow, .delegation-pulse, .waiting-breathe, .working-drift) {
    animation: none;
  }
  @keyframes edge-draw {
    from {
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
    }
    to {
      stroke-dasharray: 1;
      stroke-dashoffset: 0;
    }
  }
  @keyframes edge-arrow-in {
    from {
      opacity: 0;
    }
    to {
      opacity: var(--edge-opacity);
    }
  }
  @keyframes working-drift {
    to {
      stroke-dashoffset: -10;
    }
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
    .message-pill {
      display: none;
    }
    .edge-path,
    .edge-arrow,
    .delegation-pulse,
    .waiting-breathe,
    .working-drift {
      animation: none;
    }
  }
</style>
