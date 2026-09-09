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
  import { mergeEdgesByPair, type EdgePairDirection, type MergedEdgePair } from './graph-helpers';

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
  const mergedPairs = $derived(mergeEdgesByPair(edges));
  const pairByKey = $derived(new Map(mergedPairs.map((pair) => [pair.key, pair])));

  let travelingEdges = $state<GraphEdge[]>([]);
  let motionEnabled = $state(true);
  const seenMessageEvents = new Set<string>();
  type GeometryPart =
    | 'main-forward'
    | 'main-reverse'
    | 'highlight'
    | 'gradient'
    | 'backward-terminal'
    | 'forward-terminal'
    | 'label';
  const pairGeometry = new Map<string, Map<GeometryPart, SVGElement>>();
  const messageMotions = new Map<string, SVGAnimateMotionElement>();
  const edgeCurves = new Map<string, number>();

  function registerPairGeometry(
    element: SVGElement,
    initial: { pairKey: string; part: GeometryPart },
  ) {
    let value = initial;
    const register = () => {
      const elements = pairGeometry.get(value.pairKey) ?? new Map();
      elements.set(value.part, element);
      pairGeometry.set(value.pairKey, elements);
    };
    const unregister = () => {
      const elements = pairGeometry.get(value.pairKey);
      elements?.delete(value.part);
      if (elements?.size === 0) pairGeometry.delete(value.pairKey);
    };
    register();
    return {
      update(next: typeof initial) {
        unregister();
        value = next;
        register();
      },
      destroy: unregister,
    };
  }

  function registerMessageMotion(element: SVGAnimateMotionElement, initialEdge: GraphEdge) {
    let key = messageEventKey(initialEdge);
    messageMotions.set(key, element);
    return {
      update(nextEdge: GraphEdge) {
        messageMotions.delete(key);
        key = messageEventKey(nextEdge);
        messageMotions.set(key, element);
      },
      destroy() {
        messageMotions.delete(key);
      },
    };
  }

  function edgeLayerMotion(element: SVGSVGElement) {
    const motion = activityMotion(element);
    const scene = element.closest<HTMLElement>('.graph-scene');
    const syncMotion = () => {
      motionEnabled = element.dataset.motionEnabled !== 'false';
    };
    const syncLabelScale = () => {
      const match = scene?.style.transform.match(/scale\(([^)]+)\)/);
      const scale = Number(match?.[1] ?? 1);
      element.style.setProperty('--edge-label-scale', String(scale > 0 ? 1 / scale : 1));
    };
    const motionObserver = new MutationObserver(syncMotion);
    const scaleObserver = new MutationObserver(syncLabelScale);
    motionObserver.observe(element, { attributeFilter: ['data-motion-enabled'] });
    if (scene) scaleObserver.observe(scene, { attributes: true, attributeFilter: ['style'] });
    syncMotion();
    syncLabelScale();
    return {
      destroy() {
        motionObserver.disconnect();
        scaleObserver.disconnect();
        motion?.destroy?.();
      },
    };
  }

  function messageEventKey(edge: GraphEdge): string {
    return `${edge.id}:${edge.timestamp}`;
  }

  function pairKeyFor(edge: GraphEdge): string {
    return [edge.sourceId, edge.targetId].sort().join('|');
  }

  function directionFor(edge: GraphEdge, pair: MergedEdgePair): EdgePairDirection {
    return edge.sourceId === pair.aId ? 'a-to-b' : 'b-to-a';
  }

  function latestMember(
    pair: MergedEdgePair,
    predicate: (edge: GraphEdge) => boolean,
  ): GraphEdge | undefined {
    return pair.members
      .filter(predicate)
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  }

  $effect(() => {
    const limit = messageParticleLimit(playbackSpeed);
    const arrivals = mergedPairs
      .map((pair) =>
        latestMember(
          pair,
          (edge) => edge.type === 'message' && (edge.isActive || isRecentlyActive(edge.timestamp)),
        ),
      )
      .filter((edge): edge is GraphEdge => edge !== undefined)
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
      .filter((edge) => !seenMessageEvents.has(messageEventKey(edge)))
      .slice(-limit);
    if (arrivals.length === 0) return;
    arrivals.forEach((edge) => seenMessageEvents.add(messageEventKey(edge)));
    const arrivingPairs = new Set(arrivals.map(pairKeyFor));
    travelingEdges = [
      ...travelingEdges.filter((edge) => !arrivingPairs.has(pairKeyFor(edge))),
      ...arrivals,
    ].slice(-limit);
  });

  function opacityFor(pair: MergedEdgePair): number {
    const style = EDGE_STYLES[pair.type] ?? EDGE_STYLES.default;
    const structuralFloor = pair.type === 'delegation' || pair.type === 'task-assignment' ? 0.6 : 0;
    if (!activeFocusNodeId) return Math.max(structuralFloor, style.opacity);
    return pair.aId === activeFocusNodeId || pair.bId === activeFocusNodeId
      ? Math.max(structuralFloor, Math.min(1, style.opacity + 0.28))
      : Math.max(structuralFloor, 0.12);
  }

  function isHighlighted(pair: MergedEdgePair): boolean {
    return (
      activeFocusNodeId !== null &&
      (pair.aId === activeFocusNodeId || pair.bId === activeFocusNodeId)
    );
  }

  function isActiveNow(pair: MergedEdgePair): boolean {
    return pair.members.some(
      (edge) => edge.type === 'message' && (edge.isActive || isRecentlyActive(edge.timestamp)),
    );
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

  function highlightFor(pair: MergedEdgePair): { kind: EdgeHighlight; edge: GraphEdge } | null {
    const working = latestMember(pair, isWorkingEdge);
    const delegation = latestMember(
      pair,
      (edge) => edge.type === 'delegation' && isRecentlyActive(edge.timestamp),
    );
    const waiting = latestMember(pair, (edge) => edge.type === 'waiting-on');
    const kind: EdgeHighlight | null = working
      ? 'working'
      : delegation
        ? 'delegation'
        : waiting
          ? 'waiting'
          : null;
    if (!kind) return null;
    const edge = [working, delegation, waiting]
      .filter((candidate): candidate is GraphEdge => candidate !== undefined)
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
    return { kind, edge };
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
    pair: MergedEdgePair,
    source: GraphPosition,
    target: GraphPosition,
  ): { source: GraphPosition; target: GraphPosition } {
    return {
      source: endpoint(
        source,
        target,
        nodeById.get(pair.aId),
        pair.directions.has('b-to-a') ? 5 : 3,
      ),
      target: endpoint(
        target,
        source,
        nodeById.get(pair.bId),
        pair.directions.has('a-to-b') ? 5 : 3,
      ),
    };
  }

  function edgeCurveDirection(pairKey: string): number {
    const cached = edgeCurves.get(pairKey);
    if (cached !== undefined) return cached;
    let hash = 2166136261;
    for (let index = 0; index < pairKey.length; index += 1) {
      hash ^= pairKey.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const curve = (hash >>> 0) % 2 === 0 ? -1 : 1;
    edgeCurves.set(pairKey, curve);
    return curve;
  }

  function pathsForPair(
    pairKey: string,
    source: GraphPosition,
    target: GraphPosition,
    bidirectional: boolean,
  ): { forward: string; reverse: string } {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
      const path = `M ${source.x} ${source.y}`;
      return { forward: path, reverse: path };
    }
    const direction = edgeCurveDirection(pairKey);
    const bow = bidirectional ? 0.03 : 0.05;
    const controlPoints = (offsetDirection: number) => {
      const offset = distance * bow * direction * offsetDirection;
      const perpendicularX = (-dy / distance) * offset;
      const perpendicularY = (dx / distance) * offset;
      return [
        { x: source.x + dx / 3 + perpendicularX, y: source.y + dy / 3 + perpendicularY },
        {
          x: source.x + (dx * 2) / 3 + perpendicularX,
          y: source.y + (dy * 2) / 3 + perpendicularY,
        },
      ] as const;
    };
    const forward = controlPoints(1);
    const reverse = controlPoints(bidirectional ? -1 : 1);
    return {
      forward: `M ${source.x} ${source.y} C ${forward[0].x} ${forward[0].y}, ${forward[1].x} ${forward[1].y}, ${target.x} ${target.y}`,
      reverse: `M ${target.x} ${target.y} C ${reverse[1].x} ${reverse[1].y}, ${reverse[0].x} ${reverse[0].y}, ${source.x} ${source.y}`,
    };
  }

  function directedPathsFor(pair: MergedEdgePair, paths: { forward: string; reverse: string }) {
    return [
      ...(pair.directions.has('a-to-b')
        ? [{ direction: 'a-to-b' as const, path: paths.forward, part: 'main-forward' as const }]
        : []),
      ...(pair.directions.has('b-to-a')
        ? [{ direction: 'b-to-a' as const, path: paths.reverse, part: 'main-reverse' as const }]
        : []),
    ];
  }

  export function updatePositions(currentPositions: Map<string, GraphPosition>): void {
    for (const pair of mergedPairs) {
      const source = currentPositions.get(pair.aId);
      const target = currentPositions.get(pair.bId);
      const elements = pairGeometry.get(pair.key);
      if (!source || !target || !elements) continue;
      const endpoints = endpointsFor(pair, source, target);
      const paths = pathsForPair(
        pair.key,
        endpoints.source,
        endpoints.target,
        pair.directions.size === 2,
      );
      elements.get('main-forward')?.setAttribute('d', paths.forward);
      elements.get('main-reverse')?.setAttribute('d', paths.reverse);

      const highlight = highlightFor(pair);
      const direction = highlight ? directionFor(highlight.edge, pair) : 'a-to-b';
      const start = direction === 'a-to-b' ? endpoints.source : endpoints.target;
      const end = direction === 'a-to-b' ? endpoints.target : endpoints.source;
      elements
        .get('highlight')
        ?.setAttribute('d', direction === 'a-to-b' ? paths.forward : paths.reverse);
      const gradient = elements.get('gradient');
      gradient?.setAttribute('x1', String(start.x));
      gradient?.setAttribute('y1', String(start.y));
      gradient?.setAttribute('x2', String(end.x));
      gradient?.setAttribute('y2', String(end.y));
      const backward = elements.get('backward-terminal');
      backward?.setAttribute('cx', String(endpoints.source.x));
      backward?.setAttribute('cy', String(endpoints.source.y));
      const forward = elements.get('forward-terminal');
      forward?.setAttribute('cx', String(endpoints.target.x));
      forward?.setAttribute('cy', String(endpoints.target.y));
      elements
        .get('label')
        ?.setAttribute(
          'transform',
          `translate(${(endpoints.source.x + endpoints.target.x) / 2} ${(endpoints.source.y + endpoints.target.y) / 2})`,
        );
    }
    for (const edge of travelingEdges) {
      const pair = pairByKey.get(pairKeyFor(edge));
      if (!pair) continue;
      const source = currentPositions.get(pair.aId);
      const target = currentPositions.get(pair.bId);
      if (!source || !target) continue;
      const endpoints = endpointsFor(pair, source, target);
      const paths = pathsForPair(
        pair.key,
        endpoints.source,
        endpoints.target,
        pair.directions.size === 2,
      );
      const path = directionFor(edge, pair) === 'a-to-b' ? paths.forward : paths.reverse;
      messageMotions.get(messageEventKey(edge))?.setAttribute('path', path);
    }
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
  {#each mergedPairs as pair, edgeIndex (pair.key)}
    {@const source = positions.get(pair.aId) ?? nodeById.get(pair.aId)}
    {@const target = positions.get(pair.bId) ?? nodeById.get(pair.bId)}
    {@const style = EDGE_STYLES[pair.type] ?? EDGE_STYLES.default}
    {@const highlight = highlightFor(pair)}
    {@const prominent = isActiveNow(pair) || highlight?.kind === 'working'}
    {@const stroke = prominent ? 'var(--color-foreground)' : style.stroke}
    {#if source && target}
      {@const endpoints = endpointsFor(pair, source, target)}
      {@const paths = pathsForPair(
        pair.key,
        endpoints.source,
        endpoints.target,
        pair.directions.size === 2,
      )}
      {@const representativeEdge =
        latestMember(pair, (edge) => edge.type === pair.type) ?? pair.latestEdge}
      {@const labelEdge = latestMember(
        pair,
        (edge) =>
          edge.type === 'message' || edge.type === 'file-write' || edge.type === 'note-write',
      )}
      {@const label = labelEdge ? labelFor(labelEdge) : null}
      {@const edgeOpacity = opacityFor(pair)}
      {@const terminalOpacity = Math.min(1, edgeOpacity + 0.08)}
      {@const highlighted = isHighlighted(pair)}
      {@const dimmed = activeFocusNodeId !== null && !highlighted}
      {@const drawDuration = playbackDuration(350, playbackSpeed)}
      {@const gradientId = `${componentId}-edge-highlight-${edgeIndex}`}
      {@const highlightDirection = highlight ? directionFor(highlight.edge, pair) : 'a-to-b'}
      {@const highlightPath = highlightDirection === 'a-to-b' ? paths.forward : paths.reverse}
      {#if highlight && motionEnabled}
        <defs>
          <linearGradient
            use:registerPairGeometry={{ pairKey: pair.key, part: 'gradient' }}
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={highlightDirection === 'a-to-b' ? endpoints.source.x : endpoints.target.x}
            y1={highlightDirection === 'a-to-b' ? endpoints.source.y : endpoints.target.y}
            x2={highlightDirection === 'a-to-b' ? endpoints.target.x : endpoints.source.x}
            y2={highlightDirection === 'a-to-b' ? endpoints.target.y : endpoints.source.y}
          >
            <stop offset="0" stop-color="var(--color-foreground)" stop-opacity="0" />
            <stop offset="0.5" stop-color="var(--color-foreground)" stop-opacity="0.9" />
            <stop offset="1" stop-color="var(--color-foreground)" stop-opacity="0" />
          </linearGradient>
        </defs>
      {/if}
      {#each directedPathsFor(pair, paths) as directedPath (directedPath.direction)}
        <path
          use:registerPairGeometry={{ pairKey: pair.key, part: directedPath.part }}
          class="edge-path"
          d={directedPath.path}
          pathLength="1"
          fill="none"
          {stroke}
          stroke-width={prominent ? 1.5 : style.strokeWidth}
          stroke-dasharray={style.strokeDasharray === 'none' ? undefined : style.strokeDasharray}
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
          opacity={edgeOpacity}
          style:animation-duration={`${drawDuration}ms`}
          data-edge-id={representativeEdge.id}
          data-pair-key={pair.key}
          data-edge-count={pair.members.length}
          data-edge-type={pair.type}
          data-direction={directedPath.direction}
          data-active={pair.isActive}
          data-highlighted={highlighted}
          data-dimmed={dimmed}
          data-last-activity-at={pair.timestamp}
        />
      {/each}
      {#if highlight && motionEnabled}
        {#key `${pair.key}:${highlight.edge.timestamp}:${highlight.kind}`}
          <path
            use:registerPairGeometry={{ pairKey: pair.key, part: 'highlight' }}
            class="edge-highlight"
            class:working-highlight={highlight.kind === 'working'}
            class:delegation-highlight={highlight.kind === 'delegation'}
            class:waiting-highlight={highlight.kind === 'waiting'}
            d={highlightPath}
            pathLength="1"
            fill="none"
            stroke={`url(#${gradientId})`}
            stroke-width={(prominent ? 1.5 : style.strokeWidth) + 0.5}
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
            opacity={dimmed ? edgeOpacity : 1}
            style:animation-duration={highlightDuration(highlight.kind)}
            style:animation-delay={`${drawDuration}ms`}
            data-edge-highlight={highlight.kind}
            data-edge-id={highlight.edge.id}
            data-pair-key={pair.key}
            data-direction={highlightDirection}
            data-dimmed={dimmed}
          />
        {/key}
      {/if}
      {#if pair.directions.has('b-to-a')}
        <circle
          use:registerPairGeometry={{ pairKey: pair.key, part: 'backward-terminal' }}
          class="edge-terminal"
          cx={endpoints.source.x}
          cy={endpoints.source.y}
          r="3"
          fill={stroke}
          vector-effect="non-scaling-stroke"
          opacity={terminalOpacity}
          data-direction="b-to-a"
          style:animation-delay={`${Math.max(0, drawDuration - 80)}ms`}
        />
      {/if}
      {#if pair.directions.has('a-to-b')}
        <circle
          use:registerPairGeometry={{ pairKey: pair.key, part: 'forward-terminal' }}
          class="edge-terminal"
          cx={endpoints.target.x}
          cy={endpoints.target.y}
          r="3"
          fill={stroke}
          vector-effect="non-scaling-stroke"
          opacity={terminalOpacity}
          data-direction="a-to-b"
          style:animation-delay={`${Math.max(0, drawDuration - 80)}ms`}
        />
      {/if}
      {#if label && (activeFocusNodeId === null || highlighted)}
        {@const labelWidth = 12 + label.length * 6}
        <g
          use:registerPairGeometry={{ pairKey: pair.key, part: 'label' }}
          class="edge-count-label"
          transform={`translate(${(endpoints.source.x + endpoints.target.x) / 2} ${(endpoints.source.y + endpoints.target.y) / 2})`}
          opacity={Math.min(1, opacityFor(pair) + 0.18)}
          data-highlighted={highlighted}
        >
          <g class="edge-count-label-content">
            <rect
              x={-labelWidth / 2}
              y="-8"
              width={labelWidth}
              height="16"
              rx="8"
              fill="var(--color-card)"
              stroke="var(--color-border)"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
            <text
              text-anchor="middle"
              dominant-baseline="central"
              fill="var(--color-muted-foreground)"
              font-size="10">{label}</text
            >
          </g>
        </g>
      {/if}
    {/if}
  {/each}
  {#each travelingEdges as edge (`${edge.id}:${edge.timestamp}`)}
    {@const pair = pairByKey.get(pairKeyFor(edge))}
    {@const source = pair ? (positions.get(pair.aId) ?? nodeById.get(pair.aId)) : undefined}
    {@const target = pair ? (positions.get(pair.bId) ?? nodeById.get(pair.bId)) : undefined}
    {#if pair && source && target}
      {@const endpoints = endpointsFor(pair, source, target)}
      {@const paths = pathsForPair(
        pair.key,
        endpoints.source,
        endpoints.target,
        pair.directions.size === 2,
      )}
      {@const messagePath = directionFor(edge, pair) === 'a-to-b' ? paths.forward : paths.reverse}
      <g
        class="message-pill"
        opacity={opacityFor(pair)}
        data-message-particle
        data-pair-key={pair.key}
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
          use:registerMessageMotion={edge}
          use:completeMessageTravel={edge}
          path={messagePath}
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
  .edge-count-label-content {
    transform: scale(var(--edge-label-scale, 1));
    transform-box: fill-box;
    transform-origin: center;
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
