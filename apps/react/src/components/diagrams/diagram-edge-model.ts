// Component-local painted-route lifecycle translated from DiagramEdge.svelte.
import { signal, computed, effect, batch, untracked } from '@preact/signals-react';
import type { ComputedEdge } from '$lib/components/diagrams/types';
import { prefersReducedMotion, onReducedMotionChange } from '@/lib/motion';
import { buildRoundedOrthogonalPath } from '$lib/components/diagrams/layout-engine';
export interface DiagramEdgeProps {
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
export function createDiagramEdge(initial: DiagramEdgeProps) {
  const inputs = signal(initial);
  const effects: Array<() => void | (() => void)> = [];
  const reducedMotion = signal(prefersReducedMotion());
  const edge = computed(() => inputs.value.edge);
  const dimmed = computed(() => inputs.value.dimmed ?? false);
  const highlighted = computed(() => inputs.value.highlighted ?? false);
  const markerScope = computed(() => inputs.value.markerScope ?? '');
  const terminalGap = computed(() => inputs.value.terminalGap ?? 0);
  const motionDelay = computed(() => inputs.value.motionDelay ?? 0);
  const onmotionchange = computed(() => inputs.value.onmotionchange);
  let displayedPath = signal('');
  let motionProgress = signal(1);
  let previousPoints: {
    x: number;
    y: number;
  }[] = [];
  let previousTargetPath = '';
  let previousEdgeReference: ComputedEdge | undefined;
  let previousEdgeId = '';
  let rootElement: SVGGElement | undefined;
  let revealMaskId = computed(() => `edge-reveal-${markerScope.value}-${edge.value.id}`);
  let revealMaskBounds = computed(() => {
    void displayedPath.value;
    const points = [...(edge.value.points ?? []), ...previousPoints];
    const padding = Math.max(16, terminalGap.value * 3);
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
  function insetTerminal(
    points: {
      x: number;
      y: number;
    }[],
    gap: number,
  ) {
    if (points.length < 2 || gap <= 0) return points;
    const next = points.map((point) => ({
      ...point,
    }));
    const terminal = next.at(-1)!;
    const previous = next.at(-2)!;
    const length = Math.hypot(terminal.x - previous.x, terminal.y - previous.y);
    if (length <= gap) return points;
    terminal.x -= ((terminal.x - previous.x) / length) * gap;
    terminal.y -= ((terminal.y - previous.y) / length) * gap;
    return next;
  }
  function reportMotion(moving: boolean) {
    untracked(() => onmotionchange.value?.(edge.value.id, moving));
  }
  type NodeBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  function findNode(nodeId: string) {
    return rootElement?.ownerSVGElement?.querySelector<SVGForeignObjectElement>(
      `[data-node-id="${CSS.escape(nodeId)}"]`,
    );
  }
  function sampleNodeBounds(node: SVGForeignObjectElement | null | undefined): NodeBounds | null {
    if (!node) return null;
    // Geometry properties can start independently (including y-only motion). Read the
    // painted pose rather than applying one property's or the route's clock to all four.
    const style = getComputedStyle(node);
    const value = (property: string, fallback: number) => {
      const parsed = Number.parseFloat(style.getPropertyValue(property));
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    return {
      x: value('x', node.x.baseVal.value),
      y: value('y', node.y.baseVal.value),
      width: value('width', node.width.baseVal.value),
      height: value('height', node.height.baseVal.value),
    };
  }
  function attachToNode(
    point: {
      x: number;
      y: number;
    },
    bounds: NodeBounds | null,
    gap = 0,
  ) {
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
  function resample(
    points: {
      x: number;
      y: number;
    }[],
    count: number,
  ) {
    if (points.length < 2) {
      return Array.from(
        {
          length: count,
        },
        () =>
          points[0] ?? {
            x: 0,
            y: 0,
          },
      );
    }
    const lengths = points
      .slice(1)
      .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    return Array.from(
      {
        length: count,
      },
      (_, sampleIndex) => {
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
      },
    );
  }
  effects.push(() => {
    const targetPoints = insetTerminal(edge.value.points ?? [], terminalGap.value);
    const targetPath =
      terminalGap.value > 0 ? buildRoundedOrthogonalPath(targetPoints) : edge.value.path;
    const reduced = reducedMotion.value;
    if (
      reduced ||
      (previousTargetPath === targetPath && previousEdgeReference === edge.value) ||
      previousPoints.length < 2 ||
      targetPoints.length < 2
    ) {
      displayedPath.value = targetPath;
      previousPoints = targetPoints;
      previousTargetPath = targetPath;
      previousEdgeReference = edge.value;
      previousEdgeId = edge.value.id;
      motionProgress.value = 1;
      reportMotion(false);
      return;
    }
    const from = resample(previousPoints, 24);
    const to = resample(targetPoints, 24);
    const retainsIdentity = previousEdgeId === edge.value.id;
    const previousStart = previousPoints[0];
    const previousEnd = previousPoints[previousPoints.length - 1];
    const targetStart = targetPoints[0];
    const targetEnd = targetPoints[targetPoints.length - 1];
    const sourceNode = findNode(edge.value.from);
    const targetNode = findNode(edge.value.to);
    const shiftsLaneWithoutMovingNodes =
      retainsIdentity &&
      Math.abs(targetStart.x - previousStart.x - (targetEnd.x - previousEnd.x)) < 1 &&
      Math.abs(targetStart.y - previousStart.y - (targetEnd.y - previousEnd.y)) < 1;
    previousTargetPath = targetPath;
    previousEdgeReference = edge.value;
    previousEdgeId = edge.value.id;
    let frame = 0;
    let delayTimer: number | undefined;
    motionProgress.value = 0;
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
      points[0] = attachToNode(points[0], sampleNodeBounds(sourceNode));
      points[points.length - 1] = attachToNode(
        points[points.length - 1],
        sampleNodeBounds(targetNode),
        terminalGap.value,
      );
      previousPoints = points;
      motionProgress.value = elapsed;
      displayedPath.value = buildRoundedOrthogonalPath(points);
      if (elapsed < 1) frame = requestAnimationFrame(tick);
      else {
        displayedPath.value = targetPath;
        previousPoints = targetPoints;
        motionProgress.value = 1;
        reportMotion(false);
      }
    };
    let motionStartedAt: number | undefined;
    const startMotion = () => {
      motionStartedAt = performance.now();
      frame = requestAnimationFrame(tick);
    };
    if (motionDelay.value > 0) delayTimer = window.setTimeout(startMotion, motionDelay.value);
    else startMotion();
    return () => {
      if (delayTimer !== undefined) window.clearTimeout(delayTimer);
      cancelAnimationFrame(frame);
      reportMotion(false);
    };
  });

  // Get edge class based on semantic style
  let edgeClass = computed(() => {
    const classes = ['diagram-edge'];
    if (edge.value.semanticStyle) {
      classes.push(`edge-${edge.value.semanticStyle}`);
    }
    if (edge.value.animated) {
      classes.push('edge-animated');
    }
    if (edge.value.dashed) {
      classes.push('edge-dashed');
    }
    if (dimmed.value) {
      classes.push('edge-dimmed');
    }
    if (highlighted.value) {
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
  let markerSuffix = computed(() => (markerScope.value ? `-${markerScope.value}` : ''));
  let markerUrl = computed(() =>
    edge.value.semanticStyle && semanticMarkerStyles.has(edge.value.semanticStyle)
      ? `url(#arrowhead-${edge.value.semanticStyle}${markerSuffix.value})`
      : `url(#arrowhead${markerSuffix.value})`,
  );
  return {
    displayedPath,
    motionProgress,
    revealMaskId,
    revealMaskBounds,
    edgeClass,
    markerUrl,
    setRoot: (el: SVGGElement | null) => {
      rootElement = el ?? undefined;
    },
    update: (next: DiagramEdgeProps) =>
      batch(() => {
        inputs.value = next;
      }),
    mount: () => {
      reducedMotion.value = prefersReducedMotion(rootElement?.ownerDocument);
      const stopMotion = onReducedMotionChange((value) => {
        reducedMotion.value = value;
      }, rootElement?.ownerDocument);
      const disposes = effects.map((fn) => effect(fn));
      return () => {
        stopMotion();
        disposes.forEach((fn) => fn());
      };
    },
  };
}
