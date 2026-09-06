<script lang="ts">
  import type { GraphEdge, GraphNode } from './types';
  import { EDGE_STYLES, GRAPH_NODE_DIMENSIONS } from './constants';
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
    focusNodeId?: string | null;
    spotlightNodeId?: string | null;
    playbackSpeed?: PlaybackSpeed;
    onMessageArrival?: (targetId: string) => void;
  }

  let {
    edges,
    nodes,
    positions,
    focusNodeId = null,
    spotlightNodeId = null,
    playbackSpeed = 1,
    onMessageArrival = () => {},
  }: Props = $props();
  const componentId = $props.id();

  const nodeById = $derived(new Map(nodes.map((node) => [node.id, node])));
  const activeFocusNodeId = $derived(focusNodeId ?? spotlightNodeId);

  let travelingEdges = $state<GraphEdge[]>([]);
  let motionEnabled = $state(true);
  const seenMessageEvents = new Set<string>();

  function edgeLayerMotion(element: SVGSVGElement) {
    const motion = activityMotion(element);
    const syncMotion = () => {
      motionEnabled = element.dataset.motionEnabled !== 'false';
    };
    const observer = new MutationObserver(syncMotion);
    observer.observe(element, { attributeFilter: ['data-motion-enabled'] });
    syncMotion();
    return {
      destroy() {
        observer.disconnect();
        motion?.destroy?.();
      },
    };
  }

  function messageEventKey(edge: GraphEdge): string {
    return `${edge.id}:${edge.timestamp}`;
  }

  $effect(() => {
    const limit = messageParticleLimit(playbackSpeed);
    const arrivals = edges
      .filter(
        (edge) => edge.type === 'message' && (edge.isActive || isRecentlyActive(edge.timestamp)),
      )
      .filter((edge) => !seenMessageEvents.has(messageEventKey(edge)))
      .slice(-limit);
    if (arrivals.length === 0) return;
    arrivals.forEach((edge) => seenMessageEvents.add(messageEventKey(edge)));
    travelingEdges = [...travelingEdges, ...arrivals].slice(-limit);
  });

  function opacityFor(edge: GraphEdge): number {
    const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.default;
    if (!activeFocusNodeId) return style.opacity;
    return edge.sourceId === activeFocusNodeId || edge.targetId === activeFocusNodeId
      ? Math.min(1, style.opacity + 0.28)
      : 0.12;
  }

  function isHighlighted(edge: GraphEdge): boolean {
    return (
      activeFocusNodeId !== null &&
      (edge.sourceId === activeFocusNodeId || edge.targetId === activeFocusNodeId)
    );
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

  type EdgeHighlight = 'working' | 'delegation' | 'waiting';

  function highlightFor(edge: GraphEdge, working: boolean): EdgeHighlight | null {
    if (working) return 'working';
    if (edge.type === 'delegation' && isRecentlyActive(edge.timestamp)) return 'delegation';
    if (edge.type === 'waiting-on') return 'waiting';
    return null;
  }

  function highlightDuration(highlight: EdgeHighlight): string {
    if (highlight === 'working') return '2.8s';
    if (highlight === 'waiting') return '4s';
    return '1.4s';
  }

  function completeMessageTravel(element: SVGAnimateMotionElement, initialEdge: GraphEdge) {
    let edge = initialEdge;
    const complete = () => {
      onMessageArrival(edge.targetId);
      const completedKey = messageEventKey(edge);
      travelingEdges = travelingEdges.filter(
        (candidate) => messageEventKey(candidate) !== completedKey,
      );
    };
    element.addEventListener('endEvent', complete);
    return {
      update(nextEdge: GraphEdge) {
        edge = nextEdge;
      },
      destroy() {
        element.removeEventListener('endEvent', complete);
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

  function edgeCurve(edgeId: string): number {
    let hash = 2166136261;
    for (let index = 0; index < edgeId.length; index += 1) {
      hash ^= edgeId.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const unit = (hash >>> 0) / 4294967296;
    const direction = unit < 0.5 ? -1 : 1;
    return direction * (0.15 + (unit % 0.5) * 0.2);
  }

  function pathFor(edge: GraphEdge, source: GraphPosition, target: GraphPosition): string {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return `M ${source.x} ${source.y}`;
    const offset = distance * edgeCurve(edge.id);
    const perpendicularX = (-dy / distance) * offset;
    const perpendicularY = (dx / distance) * offset;
    const first = {
      x: source.x + dx / 3 + perpendicularX,
      y: source.y + dy / 3 + perpendicularY,
    };
    const second = {
      x: source.x + (dx * 2) / 3 + perpendicularX,
      y: source.y + (dy * 2) / 3 + perpendicularY,
    };
    return `M ${source.x} ${source.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${target.x} ${target.y}`;
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
  use:edgeLayerMotion
  class="edge-layer pointer-events-none absolute inset-0 h-full w-full overflow-visible"
  aria-hidden="true"
>
  {#each edges as edge, edgeIndex (edge.id)}
    {@const source = positions.get(edge.sourceId)}
    {@const target = positions.get(edge.targetId)}
    {@const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.default}
    {@const working = isWorkingEdge(edge)}
    {@const highlight = highlightFor(edge, working)}
    {@const prominent = isActiveNow(edge) || working}
    {@const stroke = prominent ? 'var(--color-foreground)' : style.stroke}
    {#if source && target}
      {@const endpoints = endpointsFor(edge, source, target)}
      {@const path = pathFor(edge, endpoints.source, endpoints.target)}
      {@const label = labelFor(edge)}
      {@const edgeOpacity = opacityFor(edge)}
      {@const highlighted = isHighlighted(edge)}
      {@const dimmed = activeFocusNodeId !== null && !highlighted}
      {@const drawDuration = playbackDuration(350, playbackSpeed)}
      {@const gradientId = `${componentId}-edge-highlight-${edgeIndex}`}
      {#if highlight && motionEnabled}
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={endpoints.source.x}
            y1={endpoints.source.y}
            x2={endpoints.target.x}
            y2={endpoints.target.y}
          >
            <stop offset="0" stop-color="var(--color-foreground)" stop-opacity="0" />
            <stop offset="0.5" stop-color="var(--color-foreground)" stop-opacity="0.9" />
            <stop offset="1" stop-color="var(--color-foreground)" stop-opacity="0" />
          </linearGradient>
        </defs>
      {/if}
      <path
        class="edge-path"
        d={path}
        pathLength="1"
        fill="none"
        {stroke}
        stroke-width={prominent ? 1.5 : style.strokeWidth}
        stroke-linecap="round"
        opacity={edgeOpacity}
        style:animation-duration={`${drawDuration}ms`}
        data-edge-id={edge.id}
        data-edge-type={edge.type}
        data-active={edge.isActive}
        data-highlighted={highlighted}
        data-dimmed={dimmed}
        data-last-activity-at={edge.timestamp}
      />
      {#if highlight && motionEnabled}
        {#key `${edge.id}:${edge.timestamp}:${highlight}`}
          <path
            class="edge-highlight"
            class:working-highlight={highlight === 'working'}
            class:delegation-highlight={highlight === 'delegation'}
            class:waiting-highlight={highlight === 'waiting'}
            d={path}
            pathLength="1"
            fill="none"
            stroke={`url(#${gradientId})`}
            stroke-width={(prominent ? 1.5 : style.strokeWidth) + 0.5}
            stroke-linecap="round"
            opacity={dimmed ? edgeOpacity : 1}
            style:animation-duration={highlightDuration(highlight)}
            style:animation-delay={`${drawDuration}ms`}
            data-edge-highlight={highlight}
            data-edge-id={edge.id}
            data-dimmed={dimmed}
          />
        {/key}
      {/if}
      <circle
        class="edge-terminal"
        cx={endpoints.target.x}
        cy={endpoints.target.y}
        r="2.25"
        fill={stroke}
        opacity={edgeOpacity}
        style:animation-delay={`${Math.max(0, drawDuration - 80)}ms`}
      />
      {#if label && (activeFocusNodeId === null || highlighted)}
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
          stroke="var(--color-foreground)"
        />
        <text
          text-anchor="middle"
          dominant-baseline="central"
          fill="var(--color-foreground)"
          font-size="9"><!-- i18n-ignore (compact graph edge-kind token) -->msg</text
        >
        <animateMotion
          use:completeMessageTravel={edge}
          path={pathFor(edge, endpoints.source, endpoints.target)}
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
  .edge-path {
    animation: edge-draw 350ms ease-out 1;
  }
  .edge-highlight {
    stroke-dasharray: 0.18 1;
    stroke-dashoffset: 1;
    animation-name: edge-highlight-travel;
    animation-timing-function: linear;
  }
  .working-highlight,
  .waiting-highlight {
    animation-iteration-count: infinite;
  }
  .delegation-highlight {
    animation-fill-mode: both;
    animation-iteration-count: 1;
  }
  .edge-terminal {
    animation: edge-terminal-in 120ms ease-out both;
  }
  :global(.edge-layer[data-motion-enabled='false']) :is(.edge-highlight, .message-pill) {
    display: none;
  }
  :global(.edge-layer[data-motion-enabled='false']) :is(.edge-path, .edge-terminal) {
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
  @keyframes edge-terminal-in {
    from {
      opacity: 0;
    }
  }
  @keyframes edge-highlight-travel {
    from {
      stroke-dashoffset: 1;
    }
    to {
      stroke-dashoffset: -0.18;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .edge-highlight,
    .message-pill {
      display: none;
    }
    .edge-path,
    .edge-terminal {
      animation: none;
    }
  }
</style>
