<script lang="ts">
  /**
   * Diagram Edge Component
   */
  import { untrack } from 'svelte';
  import type { ComputedEdge } from './types';
  import { prefersReducedMotion } from '$lib/utils/reduced-motion';
  import { buildRoundedOrthogonalPath } from './layout-engine';

  interface Props {
    edge: ComputedEdge;
    dimmed?: boolean;
    highlighted?: boolean;
    /** Unique scope for SVG marker IDs to avoid cross-diagram conflicts */
    markerScope?: string;
    /** Diagram-space inset that keeps the painted arrow tip away from its target. */
    terminalGap?: number;
    /** Delay retained-route morphing until the current scene stage begins. */
    motionDelay?: number;
    onmotionchange?: (edgeId: string, moving: boolean) => void;
  }

  let {
    edge,
    dimmed = false,
    highlighted = false,
    markerScope = '',
    terminalGap = 0,
    motionDelay = 0,
    onmotionchange,
  }: Props = $props();
  let displayedPath = $state('');
  let motionProgress = $state(1);
  let previousPoints: { x: number; y: number }[] = [];
  let previousTargetPath = '';
  let previousEdgeReference: ComputedEdge | undefined;
  let previousEdgeId = '';
  let rootElement: SVGGElement | undefined;
  let revealMaskId = $derived(`edge-reveal-${markerScope}-${edge.id}`);
  let revealMaskBounds = $derived.by(() => {
    displayedPath;
    const points = [...(edge.points ?? []), ...previousPoints];
    const padding = Math.max(16, terminalGap * 3);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = xs.length > 0 ? Math.min(...xs) : 0;
    const minY = ys.length > 0 ? Math.min(...ys) : 0;
    const maxX = xs.length > 0 ? Math.max(...xs) : 1;
    const maxY = ys.length > 0 ? Math.max(...ys) : 1;
    return {
      x: minX - padding,
      y: minY - padding,
      width: Math.max(1, maxX - minX) + padding * 2,
      height: Math.max(1, maxY - minY) + padding * 2,
    };
  });

  function insetTerminal(points: { x: number; y: number }[], gap: number) {
    if (points.length < 2 || gap <= 0) return points;
    const next = points.map((point) => ({ ...point }));
    const terminal = next.at(-1)!;
    const previous = next.at(-2)!;
    const length = Math.hypot(terminal.x - previous.x, terminal.y - previous.y);
    if (length <= gap) return points;
    terminal.x -= ((terminal.x - previous.x) / length) * gap;
    terminal.y -= ((terminal.y - previous.y) / length) * gap;
    return next;
  }

  function reportMotion(moving: boolean) {
    untrack(() => onmotionchange?.(edge.id, moving));
  }

  type NodeBounds = { x: number; y: number; width: number; height: number };

  function captureNodeMotion(nodeId: string) {
    const node = rootElement?.ownerSVGElement?.querySelector<SVGForeignObjectElement>(
      `[data-node-id="${CSS.escape(nodeId)}"]`,
    );
    if (!node) return null;
    const style = getComputedStyle(node);
    const value = (property: string, fallback: number) => {
      const parsed = Number.parseFloat(style.getPropertyValue(property));
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    return {
      node,
      from: {
        x: value('x', node.x.baseVal.value),
        y: value('y', node.y.baseVal.value),
        width: value('width', node.width.baseVal.value),
        height: value('height', node.height.baseVal.value),
      },
      to: {
        x: node.x.baseVal.value,
        y: node.y.baseVal.value,
        width: node.width.baseVal.value,
        height: node.height.baseVal.value,
      },
    };
  }

  function interpolateNodeMotion(
    motion: { node: SVGForeignObjectElement; from: NodeBounds; to: NodeBounds } | null,
    fallbackProgress: number,
  ) {
    if (!motion) return null;
    const transition = motion.node
      .getAnimations()
      .find((animation) => (animation as CSSTransition).transitionProperty === 'x');
    const sampledProgress = transition?.effect?.getComputedTiming().progress;
    const progress = typeof sampledProgress === 'number' ? sampledProgress : fallbackProgress;
    return Object.fromEntries(
      (['x', 'y', 'width', 'height'] as const).map((property) => [
        property,
        motion.from[property] + (motion.to[property] - motion.from[property]) * progress,
      ]),
    ) as NodeBounds;
  }

  function attachToNode(point: { x: number; y: number }, bounds: NodeBounds | null, gap = 0) {
    if (!bounds) return point;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const halfWidth = bounds.width / 2;
    const halfHeight = bounds.height / 2;
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) return point;
    const horizontalScale = Math.abs(dx) < 0.001 ? Infinity : halfWidth / Math.abs(dx);
    const verticalScale = Math.abs(dy) < 0.001 ? Infinity : halfHeight / Math.abs(dy);
    if (horizontalScale <= verticalScale) {
      return {
        x: centerX + Math.sign(dx) * (halfWidth + gap),
        y: centerY + dy * horizontalScale,
      };
    }
    return {
      x: centerX + dx * verticalScale,
      y: centerY + Math.sign(dy) * (halfHeight + gap),
    };
  }

  function sampleCurve(a1: number, a2: number, progress: number) {
    const inverse = 1 - progress;
    return (
      3 * inverse * inverse * progress * a1 + 3 * inverse * progress * progress * a2 + progress ** 3
    );
  }

  function calmEaseOut(progress: number) {
    let low = 0;
    let high = 1;
    let parameter = progress;
    for (let index = 0; index < 12; index += 1) {
      const sampled = sampleCurve(0.16, 0.3, parameter);
      if (sampled < progress) low = parameter;
      else high = parameter;
      parameter = (low + high) / 2;
    }
    return sampleCurve(1, 1, parameter);
  }

  function resample(points: { x: number; y: number }[], count: number) {
    if (points.length < 2) {
      return Array.from({ length: count }, () => points[0] ?? { x: 0, y: 0 });
    }
    const lengths = points
      .slice(1)
      .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    return Array.from({ length: count }, (_, sampleIndex) => {
      let distance = (total * sampleIndex) / (count - 1);
      let segment = 0;
      while (segment < lengths.length - 1 && distance > lengths[segment]) {
        distance -= lengths[segment];
        segment += 1;
      }
      const start = points[segment];
      const end = points[segment + 1];
      const progress = lengths[segment] ? distance / lengths[segment] : 0;
      return {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      };
    });
  }

  $effect(() => {
    const targetPoints = insetTerminal(edge.points ?? [], terminalGap);
    const targetPath = terminalGap > 0 ? buildRoundedOrthogonalPath(targetPoints) : edge.path;
    const reduced = prefersReducedMotion();
    if (
      reduced ||
      (previousTargetPath === targetPath && previousEdgeReference === edge) ||
      previousPoints.length < 2 ||
      targetPoints.length < 2
    ) {
      displayedPath = targetPath;
      previousPoints = targetPoints;
      previousTargetPath = targetPath;
      previousEdgeReference = edge;
      previousEdgeId = edge.id;
      motionProgress = 1;
      reportMotion(false);
      return;
    }
    const from = resample(previousPoints, 24);
    const to = resample(targetPoints, 24);
    const retainsIdentity = previousEdgeId === edge.id;
    const previousStart = previousPoints[0];
    const previousEnd = previousPoints[previousPoints.length - 1];
    const targetStart = targetPoints[0];
    const targetEnd = targetPoints[targetPoints.length - 1];
    const sourceNodeMotion = captureNodeMotion(edge.from);
    const targetNodeMotion = captureNodeMotion(edge.to);
    const shiftsLaneWithoutMovingNodes =
      retainsIdentity &&
      Math.abs(targetStart.x - previousStart.x - (targetEnd.x - previousEnd.x)) < 1 &&
      Math.abs(targetStart.y - previousStart.y - (targetEnd.y - previousEnd.y)) < 1;
    previousTargetPath = targetPath;
    previousEdgeReference = edge;
    previousEdgeId = edge.id;
    let frame = 0;
    let delayTimer: number | undefined;
    motionProgress = 0;
    reportMotion(true);
    const tick = (now: number) => {
      const startedAt = motionStartedAt!;
      const elapsed = Math.max(0, Math.min(1, (now - startedAt) / 220));
      const progress = calmEaseOut(elapsed);
      const points = from.map((point, index) => ({
        x: point.x + (to[index].x - point.x) * progress,
        y: point.y + (to[index].y - point.y) * progress,
      }));
      if (shiftsLaneWithoutMovingNodes) {
        points[0] = targetPoints[0];
        points[points.length - 1] = targetPoints[targetPoints.length - 1];
      }
      points[0] = attachToNode(points[0], interpolateNodeMotion(sourceNodeMotion, progress));
      points[points.length - 1] = attachToNode(
        points[points.length - 1],
        interpolateNodeMotion(targetNodeMotion, progress),
        terminalGap,
      );
      previousPoints = points;
      motionProgress = elapsed;
      displayedPath = buildRoundedOrthogonalPath(points);
      if (elapsed < 1) frame = requestAnimationFrame(tick);
      else {
        displayedPath = targetPath;
        previousPoints = targetPoints;
        motionProgress = 1;
        reportMotion(false);
      }
    };
    let motionStartedAt: number | undefined;
    const startMotion = () => {
      motionStartedAt = performance.now();
      frame = requestAnimationFrame(tick);
    };
    if (motionDelay > 0) delayTimer = window.setTimeout(startMotion, motionDelay);
    else startMotion();
    return () => {
      if (delayTimer !== undefined) window.clearTimeout(delayTimer);
      cancelAnimationFrame(frame);
      reportMotion(false);
    };
  });

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
  const semanticMarkerStyles = new Set([
    'danger',
    'success',
    'warning',
    'muted',
    'inactive',
    'highlighted',
    'active',
  ]);
  let markerSuffix = $derived(markerScope ? `-${markerScope}` : '');
  let markerUrl = $derived(
    edge.semanticStyle && semanticMarkerStyles.has(edge.semanticStyle)
      ? `url(#arrowhead-${edge.semanticStyle}${markerSuffix})`
      : `url(#arrowhead${markerSuffix})`,
  );
</script>

<g
  bind:this={rootElement}
  class={edgeClass}
  data-edge-id={edge.id}
  data-edge-from={edge.from}
  data-edge-to={edge.to}
  data-edge-motion-progress={motionProgress}
>
  <defs>
    <mask
      id={revealMaskId}
      maskUnits="userSpaceOnUse"
      maskContentUnits="userSpaceOnUse"
      x={revealMaskBounds.x}
      y={revealMaskBounds.y}
      width={revealMaskBounds.width}
      height={revealMaskBounds.height}
      style="mask-type: alpha;"
    >
      <path
        d={displayedPath}
        class="edge-reveal-mask-path"
        pathLength="1"
        fill="none"
        stroke="white"
        stroke-width={Math.max(12, terminalGap * 3)}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </mask>
  </defs>
  <g mask={`url(#${revealMaskId})`}>
    <!-- Edge path -->
    <path
      d={displayedPath}
      class="edge-path"
      marker-end={markerUrl}
      vector-effect="non-scaling-stroke"
    />
    {#if (edge.animated || edge.dashed) && edge.points?.[0]}
      <circle
        class="edge-origin"
        cx={edge.points[0].x}
        cy={edge.points[0].y}
        r="1.5"
        aria-hidden="true"
      />
    {/if}
  </g>
</g>

<style>
  :global(.edge-path) {
    fill: none;
    stroke: var(--diagram-connector);
    stroke-width: var(--diagram-connector-width);
    stroke-linecap: round;
    stroke-linejoin: round;
    transition:
      stroke var(--diagram-move-exit-duration, var(--motion-standard)) var(--ease-standard),
      opacity var(--diagram-move-exit-duration, var(--motion-standard)) var(--ease-standard);
  }

  :global(.edge-reveal-mask-path) {
    stroke-dasharray: 1 1;
    stroke-dashoffset: calc((1 - var(--edge-reveal-progress, 1)) * 1px);
  }

  :global(.diagram-edge:hover .edge-path) {
    stroke: var(--diagram-connector-hover);
    stroke-width: var(--diagram-connector-width);
  }

  :global(.edge-dimmed .edge-path) {
    opacity: 0.5;
  }

  /* State-level highlighting (from DiagramState.highlightedEdges) */
  :global(.edge-state-highlighted .edge-path) {
    stroke: var(--diagram-connector-hover);
    stroke-width: var(--diagram-connector-width);
  }

  :global(.edge-highlighted .edge-path) {
    stroke: var(--diagram-connector-hover);
    stroke-width: var(--diagram-connector-width);
  }

  :global(.edge-muted .edge-path) {
    stroke: var(--diagram-connector-muted);
    stroke-width: 1px;
  }

  :global(.edge-danger .edge-path) {
    stroke: var(--diagram-connector-danger);
    stroke-width: 1px;
  }

  :global(.edge-success .edge-path) {
    stroke: var(--diagram-connector-success);
    stroke-width: 1px;
  }

  :global(.edge-warning .edge-path) {
    stroke: var(--diagram-connector-warning);
    stroke-width: 1px;
  }

  :global(.edge-inactive .edge-path) {
    stroke: var(--diagram-connector-inactive);
    stroke-width: 1px;
  }

  :global(.edge-active .edge-path) {
    stroke: var(--diagram-connector-active);
    stroke-width: 1px;
  }

  /* Dashed edge style */
  :global(.edge-dashed .edge-path) {
    stroke-dasharray: 4 4;
  }

  /* Animated flow */
  :global(.edge-animated .edge-path) {
    stroke-dasharray: 5 4;
    animation: dash-flow 1.4s linear infinite;
  }

  :global(.edge-origin) {
    fill: var(--diagram-connector);
    pointer-events: none;
  }

  :global(.edge-danger .edge-origin) {
    fill: var(--diagram-connector-danger);
  }

  :global(.edge-success .edge-origin) {
    fill: var(--diagram-connector-success);
  }

  :global(.edge-warning .edge-origin) {
    fill: var(--diagram-connector-warning);
  }

  :global(.edge-highlighted .edge-origin),
  :global(.edge-active .edge-origin),
  :global(.edge-state-highlighted .edge-origin) {
    fill: var(--diagram-connector-active);
  }

  @keyframes dash-flow {
    to {
      stroke-dashoffset: -10;
    }
  }

  :global(.catalog-reduced-motion .edge-animated .edge-path) {
    animation: none;
  }

  @container style(--motion-reduced: 1) {
    :global(html:not(.catalog-full-motion) .edge-path) {
      transition: none;
    }

    :global(html:not(.catalog-full-motion) .edge-animated .edge-path) {
      animation: none;
    }
  }
</style>
