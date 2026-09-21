<script lang="ts">
  /* eslint-disable max-lines -- coordinated geometry, motion, and accessibility renderer */
  /**
   * Diagram Renderer
   *
   * Renders interactive diagrams with support for states, animations, and bindings
   */
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import { compactEdgeLabelMaxWidth, computeLayout, measureEdgeLabel } from './layout-engine';
  import type {
    ComputedEdge,
    ComputedGroup,
    ComputedLayout,
    ComputedNode,
    NodeStyleConfig,
  } from './types';
  import { DEFAULT_NODE_STYLE, EDGE_LABEL_STYLE } from './types';
  import DiagramNodeHTML from './DiagramNodeHTML.svelte';
  import DiagramEdge from './DiagramEdge.svelte';
  import DiagramGroup from './DiagramGroup.svelte';
  import DiagramControls from './DiagramControls.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import Fa from 'svelte-fa';
  import { faCompress, faExpand } from '@fortawesome/free-solid-svg-icons';
  import { timedFade, type ImmediateMotionConfig as TransitionConfig } from '$lib/motion';
  import { cubicOut } from 'svelte/easing';
  import { flushSync, onDestroy, onMount, tick, untrack } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { prefersReducedMotion } from '$lib/utils/reduced-motion';
  import { cameraMotionKeyframes, partitionSceneIds } from './diagram-motion';
  import { freeLabelFractions } from './diagram-label-placement';

  interface Props {
    diagram: DiagramPrimitive;
    onUpdate?: (updates: Partial<DiagramPrimitive>) => void;
    editable?: boolean;
    /** Optional node style configuration for customizing font sizes, padding, etc. */
    styleConfig?: NodeStyleConfig;
    /** Callback for when a node binding is clicked */
    onBindingClick?: (e: MouseEvent, binding: { type: string; target: string }) => void;
    /** Resets transient fit and scroll state when an embedding view changes identity. */
    viewResetKey?: string;
  }

  interface EdgeLabelPosition {
    x: number;
    y: number;
    width: number;
    height: number;
    truncated: boolean;
  }

  let {
    diagram,
    onUpdate,
    editable = false,
    styleConfig = DEFAULT_NODE_STYLE,
    onBindingClick,
    viewResetKey,
  }: Props = $props();

  const PADDING = 32;
  const PRIMARY_TEXT_FLOOR = 12;
  const SECONDARY_TEXT_FLOOR = 10;
  const ARROW_TERMINAL_GAP_CSS_PX = 5;
  const ARROW_TIP_RADIUS_CSS_PX = 0.5;
  let resizing = $state(false);
  let layoutResizeRevision = $state(0);
  let resizeFrame: number | undefined;
  let fitFrame: number | undefined;
  function motionDuration(duration: number): number {
    return resizing || prefersReducedMotion(scrollContainerEl?.ownerDocument) ? 0 : duration;
  }

  // Computed layout
  let layout = $state<ComputedLayout | null>(null);
  let layoutError = $state(false);
  let fitToWidth = $state(false);
  let fitScale = $state(1);
  let layoutWidthLimit = $state(900);
  let scrollContainerEl = $state<HTMLDivElement | null>(null);
  let scrollContainerWidth = $state<number | null>(null);
  let noteLaneWidth = $state<number | null>(null);
  let windowHeight = $state<number | undefined>();
  let stepViewportActive = $state(false);
  let restoreStepScroll: (() => void) | undefined;
  let keepStepInView: (() => void) | undefined;
  let fontMeasurementRevision = $state(0);

  onMount(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) fontMeasurementRevision += 1;
    });
    return () => {
      cancelled = true;
    };
  });

  // Current state - default to first state if not set
  // svelte-ignore state_referenced_locally - intentional: prop seeds the step; valid local selections survive parent echoes
  let currentStateId = $state(
    diagram.currentStateId ??
      (diagram.states && diagram.states.length > 0 ? diagram.states[0].id : undefined),
  );
  let currentState = $derived(diagram.states?.find((s) => s.id === currentStateId) ?? null);
  // svelte-ignore state_referenced_locally - intentional: the presented state begins at the selected initial step
  let presentedStateId = $state(currentStateId);
  let previousDiagramId: string | undefined;
  let presentedState = $derived(
    diagram.states?.find((state) => state.id === presentedStateId) ?? currentState,
  );
  let cameraZoom = $derived(currentState?.camera?.zoom ?? 1);
  let automaticallyFitState = $derived(currentState !== null);
  let presentationWidth = $derived(
    scrollContainerWidth !== null && scrollContainerWidth > 0
      ? scrollContainerWidth
      : (scrollContainerEl?.clientWidth ?? null),
  );
  let usesCompactPresentation = $derived(
    layoutWidthLimit < 500 ||
      (automaticallyFitState &&
        (noteLaneWidth ?? presentationWidth ?? 0) > 0 &&
        (noteLaneWidth ?? presentationWidth ?? 0) < 500),
  );
  let canvasPadding = $derived(usesCompactPresentation ? 4 : PADDING);
  let renderStyleConfig = $derived(
    usesCompactPresentation
      ? {
          ...styleConfig,
          maxWidth: Math.min(styleConfig.maxWidth, 150),
          maxLines: Math.max(styleConfig.maxLines, 5),
          paddingX: Math.min(styleConfig.paddingX, 10),
        }
      : styleConfig,
  );
  let renderedScale = $derived(cameraZoom * (fitToWidth || automaticallyFitState ? fitScale : 1));
  let readableScale = $derived(
    Math.max(
      PRIMARY_TEXT_FLOOR / renderStyleConfig.labelFontSize,
      SECONDARY_TEXT_FLOOR /
        (styleConfig === DEFAULT_NODE_STYLE ? 11 : renderStyleConfig.kindFontSize),
    ),
  );
  let arrowTerminalGap = $derived(
    (ARROW_TERMINAL_GAP_CSS_PX + ARROW_TIP_RADIUS_CSS_PX) / renderedScale,
  );
  let labelTurnClearance = $derived(8 / renderedScale);

  // Track state changes for animations
  let stateJustChanged = $state(false);
  let enteringNodeIds = $state<string[]>([]);
  let enteringGroupIds = $state<string[]>([]);
  let enteringEdgeIds = $state<string[]>([]);
  let departingNodes = $state<ComputedNode[]>([]);
  let departingGroups = $state<ComputedGroup[]>([]);
  let departingEdges = $state<ComputedEdge[]>([]);
  let departingLabelPositions = $state(new Map<string, EdgeLabelPosition>());
  let heldNodes = $state<ComputedNode[]>([]);
  let heldGroups = $state<ComputedGroup[]>([]);
  let heldEdges = $state<ComputedEdge[]>([]);
  let heldLabelPositions = $state(new Map<string, EdgeLabelPosition>());
  let holdSharedScene = $state(false);
  let retainDepartingScene = $state(false);
  let revealEnteringScene = $state(true);
  const movingEdgeIds = new Set<string>();
  let rendererEl = $state<HTMLDivElement>();
  let diagramSettled = $state(true);
  let settlementRevision = 0;
  let settlementFrame: number | undefined;
  let transitionRevision = 0;
  let motionPhase = $state<'settled' | 'camera' | 'exit' | 'scene'>('settled');
  let cameraAnimations: Animation[] = [];

  const CAMERA_MOTION_MS = 180;
  const CAMERA_MOTION_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';
  const MOVE_EXIT_MS = 220;
  const EXIT_CONTENT_MS = 160;
  const EXIT_CONNECTION_MS = 180;
  const SCENE_ENTRY_MS = 180;
  const LABEL_ENTRY_DELAY_MS = 60;
  const LABEL_ENTRY_MS = SCENE_ENTRY_MS - LABEL_ENTRY_DELAY_MS;

  function captureCameraStage() {
    const camera = rendererEl?.querySelector<SVGSVGElement>('.diagram-svg-layer');
    const geometry = rendererEl?.querySelector<SVGGElement>('.diagram-geometry-motion');
    const matrix = geometry?.getScreenCTM?.();
    return {
      camera: camera ? getComputedStyle(camera).transform : null,
      screenMatrix: matrix
        ? new DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f])
        : null,
    };
  }

  function animateCameraStage(previous: ReturnType<typeof captureCameraStage>) {
    if (motionDuration(1) === 0 || !rendererEl) return [];
    const camera = rendererEl.querySelector<SVGSVGElement>('.diagram-svg-layer');
    const geometry = rendererEl.querySelector<SVGGElement>('.diagram-svg-layer > g');
    if (!camera || !geometry || !previous.camera) return [];
    for (const animation of camera.getAnimations({ subtree: false })) animation.cancel();
    const nextTransform = getComputedStyle(camera).transform;
    let startTransform = previous.camera;
    const screen = previous.screenMatrix ? camera.getScreenCTM() : null;
    if (screen && previous.screenMatrix) {
      // Interpolate the complete world pose once. Rebasing the geometry origin
      // separately would multiply independently animated translation and scale.
      const current = new DOMMatrix([screen.a, screen.b, screen.c, screen.d, screen.e, screen.f]);
      const geometryTransform = new DOMMatrix(getComputedStyle(geometry).transform);
      startTransform = new DOMMatrix(nextTransform)
        .multiply(current.inverse())
        .multiply(previous.screenMatrix)
        .multiply(geometryTransform.inverse())
        .toString();
    }
    const keyframes = cameraMotionKeyframes(startTransform, nextTransform);
    if (keyframes.length === 0) return [];
    const animation = camera.animate(keyframes, {
      duration: CAMERA_MOTION_MS,
      easing: CAMERA_MOTION_EASING,
    });
    animation.finished.catch(() => undefined);
    return [animation];
  }

  function revealConnection(
    _node: Element,
    { delay = 0, duration }: { delay?: number; duration: number },
  ): TransitionConfig {
    return {
      delay,
      duration: motionDuration(duration),
      easing: cubicOut,
      css: (progress) => `--edge-reveal-progress: ${progress};`,
    };
  }

  function activeFiniteAnimations() {
    if (!rendererEl?.getAnimations) return [];
    return rendererEl.getAnimations({ subtree: true }).filter((animation) => {
      const endTime = Number(animation.effect?.getComputedTiming().endTime);
      return (
        Number.isFinite(endTime) &&
        animation.playState !== 'finished' &&
        animation.playState !== 'idle'
      );
    });
  }

  async function waitForVisualAnimations(revision: number) {
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (revision !== transitionRevision) return false;
    const animations = activeFiniteAnimations();
    await Promise.allSettled(animations.map((animation) => animation.finished));
    return revision === transitionRevision;
  }

  async function completeTransitionStages(
    revision: number,
    stateId: string,
    stageAnimations: Animation[],
  ) {
    if (stageAnimations.length > 0) {
      await Promise.allSettled(stageAnimations.map((animation) => animation.finished));
      if (revision !== transitionRevision) return;
    }
    if (heldNodes.length === 0 && visibleNodes.length > 0) {
      // Disjoint scenes have no shared paint to bridge exit and destination fitting.
      // Enter inside the fitted union while outgoing paint is still opaque, then
      // let it exit only after incoming paint has finished becoming visible.
      motionPhase = 'scene';
      revealEnteringScene = true;
      flushSync();
      if (!(await waitForVisualAnimations(revision))) return;
    }
    motionPhase = 'exit';
    holdSharedScene = false;
    retainDepartingScene = false;
    presentedStateId = stateId;
    flushSync();
    if (!(await waitForVisualAnimations(revision))) return;
    const previousCameraStage = captureCameraStage();
    departingNodes = [];
    departingGroups = [];
    departingEdges = [];
    departingLabelPositions = new Map();
    heldNodes = [];
    heldGroups = [];
    heldEdges = [];
    heldLabelPositions = new Map();
    // Outgoing paint has finished fading. Fit the destination with shared geometry
    // (or the already-visible disjoint scene) before revealing any remaining entry.
    motionPhase = 'camera';
    flushSync();
    cameraAnimations = animateCameraStage(previousCameraStage);
    if (!(await waitForVisualAnimations(revision))) return;
    motionPhase = 'scene';
    revealEnteringScene = true;
    flushSync();
  }

  function motionSnapshot() {
    if (!rendererEl) return '';
    const selector = [
      '.diagram-content',
      '.diagram-svg-layer',
      '.diagram-geometry-motion',
      '[data-group-id]',
      '.group-bg',
      '.group-label',
      '.diagram-edge',
      '.edge-path',
      '.edge-label-container',
      '[data-node-id]',
      '.diagram-node-html',
    ].join(',');
    return [...rendererEl.querySelectorAll<SVGElement | HTMLElement>(selector)]
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return [
          element.tagName,
          element.getAttribute('data-node-id'),
          element.getAttribute('data-edge-id'),
          element.getAttribute('data-group-id'),
          element.getAttribute('class'),
          element.getAttribute('d'),
          bounds.x.toFixed(3),
          bounds.y.toFixed(3),
          bounds.width.toFixed(3),
          bounds.height.toFixed(3),
          style.opacity,
          style.transform,
        ].join('|');
      })
      .join('\n');
  }

  function monitorDiagramSettlement(revision: number, previousSnapshot?: string) {
    settlementFrame = requestAnimationFrame(() => {
      if (revision !== settlementRevision) return;
      keepStepInView?.();
      const snapshot = motionSnapshot();
      const active =
        motionPhase === 'camera' ||
        motionPhase === 'exit' ||
        movingEdgeIds.size > 0 ||
        activeFiniteAnimations().length > 0;
      if (!active && previousSnapshot !== undefined && snapshot === previousSnapshot) {
        if (stateJustChanged) {
          stateJustChanged = false;
          settlementFrame = undefined;
          void tick().then(() => {
            if (revision === settlementRevision) monitorDiagramSettlement(revision);
          });
          return;
        }
        diagramSettled = true;
        motionPhase = 'settled';
        stopStepViewportTracking();
        settlementFrame = undefined;
        return;
      }
      monitorDiagramSettlement(revision, active ? undefined : snapshot);
    });
  }

  function beginDiagramSettlement() {
    settlementRevision += 1;
    const revision = settlementRevision;
    if (settlementFrame !== undefined) cancelAnimationFrame(settlementFrame);
    settlementFrame = undefined;
    if (motionDuration(1) === 0) {
      stateJustChanged = false;
    }
    diagramSettled = false;
    queueMicrotask(() => {
      if (revision === settlementRevision) monitorDiagramSettlement(revision);
    });
  }

  onDestroy(() => {
    stopStepViewportTracking();
    transitionRevision += 1;
    settlementRevision += 1;
    if (settlementFrame !== undefined) cancelAnimationFrame(settlementFrame);
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    cancelFitFrame();
    for (const animation of cameraAnimations) animation.cancel();
    cameraAnimations = [];
    movingEdgeIds.clear();
  });

  // Hover state for highlighting connected nodes/edges
  let hoveredNodeId = $state<string | null>(null);
  let hoveredGroupId = $state<string | null>(null);

  // Calculate connected elements when hovering a node
  let connectedNodeIds = $derived.by(() => {
    if (!hoveredNodeId) return new Set<string>();

    const connected = new Set<string>();
    connected.add(hoveredNodeId);

    // Find all edges connected to the hovered node
    diagram.model.edges.forEach((edge) => {
      if (edge.from === hoveredNodeId) {
        connected.add(edge.to);
      }
      if (edge.to === hoveredNodeId) {
        connected.add(edge.from);
      }
    });

    return connected;
  });

  let connectedEdgeIds = $derived.by(() => {
    if (!hoveredNodeId) return new Set<string>();

    const connected = new Set<string>();

    // Find all edges connected to the hovered node
    diagram.model.edges.forEach((edge) => {
      if (edge.from === hoveredNodeId || edge.to === hoveredNodeId) {
        connected.add(edge.id);
      }
    });

    return connected;
  });

  // Calculate which nodes belong to the hovered group
  let groupNodeIds = $derived.by(() => {
    if (!hoveredGroupId) return new Set<string>();

    const ids = new Set<string>();

    // Check group.nodeIds from the groups array
    if (diagram.model.groups) {
      const group = diagram.model.groups.find((g) => g.id === hoveredGroupId);
      if (group?.nodeIds) {
        group.nodeIds.forEach((id) => ids.add(id));
      }
    }

    // Also check nodes that declare membership via node.group property
    diagram.model.nodes.forEach((node) => {
      if (node.group === hoveredGroupId) {
        ids.add(node.id);
      }
    });

    return ids;
  });

  // Calculate which edges connect nodes within the hovered group
  let groupEdgeIds = $derived.by(() => {
    if (!hoveredGroupId) return new Set<string>();

    const nodeIds = groupNodeIds;
    const connected = new Set<string>();

    diagram.model.edges.forEach((edge) => {
      if (nodeIds.has(edge.from) || nodeIds.has(edge.to)) {
        connected.add(edge.id);
      }
    });

    return connected;
  });

  // Highlighted elements (from current state)
  let highlightedNodeSet = $derived(
    presentedState?.highlightedNodes && presentedState.highlightedNodes.length > 0
      ? new Set(presentedState.highlightedNodes)
      : null,
  );
  let highlightedEdgeSet = $derived(
    presentedState?.highlightedEdges && presentedState.highlightedEdges.length > 0
      ? new Set(presentedState.highlightedEdges)
      : null,
  );
  let hasStateHighlighting = $derived(highlightedNodeSet !== null || highlightedEdgeSet !== null);

  // Visible elements (based on current state)
  let visibleNodeIds = $derived(currentState?.visibleNodes ?? diagram.model.nodes.map((n) => n.id));
  let visibleNodeIdSet = $derived(new Set(visibleNodeIds));
  let rawVisibleEdgeIds = $derived(
    currentState?.visibleEdges ?? diagram.model.edges.map((e) => e.id),
  );
  let visibleEdgeIds = $derived(
    rawVisibleEdgeIds.filter((edgeId) => {
      const edge = diagram.model.edges.find((e) => e.id === edgeId);
      return edge && visibleNodeIdSet.has(edge.from) && visibleNodeIdSet.has(edge.to);
    }),
  );

  let visibleNodes = $derived(layout?.nodes.filter((n) => visibleNodeIds.includes(n.id)) ?? []);
  let visibleEdges = $derived(layout?.edges.filter((e) => visibleEdgeIds.includes(e.id)) ?? []);

  let edgeLabelPositions = $derived.by(() => {
    const positions = new Map<string, EdgeLabelPosition>();
    const placedLabels: Array<{ x: number; y: number; width: number; height: number }> = [];

    const overlapsNode = (x: number, y: number, w: number, h: number, padding = 0) => {
      return visibleNodes.some((node) => {
        return !(
          x + w + padding < node.x ||
          x - padding > node.x + node.width ||
          y + h + padding < node.y ||
          y - padding > node.y + node.height
        );
      });
    };

    // Helper to check if a rectangle overlaps with already placed labels
    const overlapsLabel = (x: number, y: number, w: number, h: number, padding = 6) => {
      return placedLabels.some((label) => {
        return !(
          x + w + padding < label.x ||
          x - padding > label.x + label.width ||
          y + h + padding < label.y ||
          y - padding > label.y + label.height
        );
      });
    };

    const overlapsGroupHeader = (x: number, y: number, w: number, h: number) => {
      return (layout?.groups ?? []).some(
        (group) =>
          x < group.x + group.width && x + w > group.x && y < group.y + 34 && y + h > group.y,
      );
    };

    const overlapsRoute = (
      x: number,
      y: number,
      w: number,
      h: number,
      ownEdgeId: string,
      padding = 2,
    ) =>
      visibleEdges.some(
        (edge) =>
          edge.id !== ownEdgeId &&
          (edge.points ?? []).slice(0, -1).some((point, index) => {
            const next = edge.points![index + 1];
            const steps = Math.max(
              1,
              Math.ceil(Math.hypot(next.x - point.x, next.y - point.y) / 4),
            );
            for (let step = 0; step <= steps; step += 1) {
              const routeX = point.x + ((next.x - point.x) * step) / steps;
              const routeY = point.y + ((next.y - point.y) * step) / steps;
              if (
                routeX > x - padding &&
                routeX < x + w + padding &&
                routeY > y - padding &&
                routeY < y + h + padding
              ) {
                return true;
              }
            }
            return false;
          }),
      );

    for (const edge of visibleEdges) {
      if (!edge.label || !edge.points || edge.points.length < 2) continue;

      const points = edge.points;
      const directVerticalCapacity =
        points.length === 2 && Math.abs(points[0].x - points[1].x) < 0.5
          ? Math.abs(points[0].y - points[1].y)
          : undefined;
      const {
        width: labelWidth,
        height: labelHeight,
        lines,
      } = measureEdgeLabel(
        edge.label,
        usesCompactPresentation
          ? compactEdgeLabelMaxWidth(edge.label ?? '', directVerticalCapacity)
          : undefined,
      );
      const truncated = lines > 3;

      const modelEdge = diagram.model.edges.find(({ id }) => id === edge.id);
      const reverseEdge =
        modelEdge &&
        diagram.model.edges.find(
          (candidate) => candidate.from === modelEdge.to && candidate.to === modelEdge.from,
        );
      if (reverseEdge && points.length === 2) {
        const reverseLabel = measureEdgeLabel(
          reverseEdge.label ?? '',
          usesCompactPresentation ? compactEdgeLabelMaxWidth(reverseEdge.label ?? '') : undefined,
        );
        const dx = Math.abs(points[1].x - points[0].x);
        const dy = Math.abs(points[1].y - points[0].y);
        const axisLength = Math.max(dx, dy);
        const pairExtent =
          dx >= dy
            ? (labelWidth + reverseLabel.width) / 2
            : (labelHeight + reverseLabel.height) / 2;
        const preferredFraction = visibleEdgeIds.includes(reverseEdge.id)
          ? Math.max(0.05, Math.min(0.35, (1 - (pairExtent + 6) / axisLength) / 2))
          : 0.35;
        const labelExtent = dx >= dy ? labelWidth : labelHeight;
        const minimumFraction = Math.min(0.5, (labelExtent / 2 + 4 / renderedScale) / axisLength);
        const fraction = Math.max(
          minimumFraction,
          Math.min(1 - minimumFraction, preferredFraction),
        );
        const x = points[0].x + (points[1].x - points[0].x) * fraction - labelWidth / 2;
        const y = points[0].y + (points[1].y - points[0].y) * fraction - labelHeight / 2;
        if (
          !overlapsNode(x, y, labelWidth, labelHeight, 8) &&
          !overlapsGroupHeader(x, y, labelWidth, labelHeight) &&
          !overlapsRoute(x, y, labelWidth, labelHeight, edge.id) &&
          !overlapsLabel(x, y, labelWidth, labelHeight, 1)
        ) {
          positions.set(edge.id, { x, y, width: labelWidth, height: labelHeight, truncated });
          placedLabels.push({ x, y, width: labelWidth, height: labelHeight });
          continue;
        }
      }

      const candidates: Array<{ x: number; y: number; score: number }> = [];
      const closeCandidates: Array<{ x: number; y: number; score: number }> = [];
      const oneSidedCandidates: Array<{ x: number; y: number; score: number }> = [];

      const addCandidate = (x: number, y: number, score: number, target = candidates) => {
        const labelX = x - labelWidth / 2;
        const labelY = y - labelHeight / 2;
        if (overlapsNode(labelX, labelY, labelWidth, labelHeight, 8)) return;
        if (overlapsGroupHeader(labelX, labelY, labelWidth, labelHeight)) return;
        if (overlapsRoute(labelX, labelY, labelWidth, labelHeight, edge.id)) return;
        const candidate = { x: labelX, y: labelY, score };
        if (overlapsLabel(labelX, labelY, labelWidth, labelHeight)) {
          if (!overlapsLabel(labelX, labelY, labelWidth, labelHeight, 1)) {
            closeCandidates.push(candidate);
          }
          return;
        }
        target.push(candidate);
      };

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dx = Math.abs(p2.x - p1.x);
        const dy = Math.abs(p2.y - p1.y);

        const segmentLength = Math.hypot(dx, dy);
        if (segmentLength < 8) continue;
        const isHorizontal = dx >= dy;
        const labelExtent = isHorizontal ? labelWidth : labelHeight;

        const labelFractions = [
          0.5, 0.25, 0.75, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.125, 0.875, 0.05, 0.1, 0.15, 0.85, 0.9,
          0.95,
        ];
        for (const fraction of labelFractions) {
          const nearestTurn = segmentLength * Math.min(fraction, 1 - fraction);
          const farthestTurn = segmentLength * Math.max(fraction, 1 - fraction);
          if (farthestTurn < labelExtent / 2 + labelTurnClearance) continue;
          const anchorX = p1.x + (p2.x - p1.x) * fraction;
          const anchorY = p1.y + (p2.y - p1.y) * fraction;
          const horizontalBonus = isHorizontal ? 1000 : 0;
          addCandidate(
            anchorX,
            anchorY,
            segmentLength + horizontalBonus - Math.abs(fraction - 0.5) * 16,
            nearestTurn >= labelExtent / 2 + labelTurnClearance ? candidates : oneSidedCandidates,
          );
        }
      }

      // Fixed fractions can miss a small clear interval. Only on exhaustion, inspect
      // obstacle boundaries along the same edge, then revalidate the usual predicates.
      if (!candidates.length && !closeCandidates.length && !oneSidedCandidates.length) {
        const obstacles = [
          ...visibleNodes.map((node) => ({ ...node, padding: 8 })),
          ...(layout?.groups ?? []).map((group) => ({ ...group, height: 34, padding: 0 })),
          ...placedLabels.map((label) => ({ ...label, padding: 1 })),
          ...visibleEdges
            .filter((other) => other.id !== edge.id)
            .flatMap((other) =>
              (other.points ?? []).slice(1).map((end, index) => {
                const start = other.points![index];
                return {
                  x: Math.min(start.x, end.x),
                  y: Math.min(start.y, end.y),
                  width: Math.abs(end.x - start.x),
                  height: Math.abs(end.y - start.y),
                  padding: 2,
                };
              }),
            ),
        ];
        for (let index = 1; index < points.length; index += 1) {
          const start = points[index - 1];
          const end = points[index];
          const length = Math.hypot(end.x - start.x, end.y - start.y);
          const horizontalBonus = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 1000 : 0;
          for (const fraction of freeLabelFractions(
            start,
            end,
            { width: labelWidth, height: labelHeight },
            obstacles,
            labelTurnClearance,
          )) {
            addCandidate(
              start.x + (end.x - start.x) * fraction,
              start.y + (end.y - start.y) * fraction,
              length + horizontalBonus - Math.abs(fraction - 0.5) * 16,
            );
          }
        }
      }

      // Pick best candidate
      if (candidates.length > 0 || closeCandidates.length > 0 || oneSidedCandidates.length > 0) {
        const eligibleCandidates =
          candidates.length > 0
            ? candidates
            : closeCandidates.length > 0
              ? closeCandidates
              : oneSidedCandidates;
        eligibleCandidates.sort((a, b) => b.score - a.score);
        const best = eligibleCandidates[0];
        positions.set(edge.id, {
          x: best.x,
          y: best.y,
          width: labelWidth,
          height: labelHeight,
          truncated,
        });
        placedLabels.push({ x: best.x, y: best.y, width: labelWidth, height: labelHeight });
      } else if (points.length >= 2) {
        const [p1, p2] = points
          .slice(0, -1)
          .map((point, index) => [point, points[index + 1]] as const)
          .toSorted(
            ([startA, endA], [startB, endB]) =>
              Math.hypot(endB.x - startB.x, endB.y - startB.y) -
              Math.hypot(endA.x - startA.x, endA.y - startA.y),
          )[0];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const labelX = midX - labelWidth / 2;
        const labelY = midY - labelHeight / 2;
        positions.set(edge.id, {
          x: labelX,
          y: labelY,
          width: labelWidth,
          height: labelHeight,
          truncated,
        });
        placedLabels.push({ x: labelX, y: labelY, width: labelWidth, height: labelHeight });
      }
    }

    return positions;
  });

  let renderedNodes = $derived.by(() => {
    const entering = new Set(enteringNodeIds);
    const targetScene = revealEnteringScene
      ? visibleNodes
      : visibleNodes.filter((node) => !entering.has(node.id));
    const held = new Map(heldNodes.map((node) => [node.id, node]));
    const target = holdSharedScene
      ? targetScene.map((node) => held.get(node.id) ?? node)
      : targetScene;
    if (!retainDepartingScene) return target;
    const targetIds = new Set(target.map((node) => node.id));
    return [...target, ...departingNodes.filter((node) => !targetIds.has(node.id))];
  });
  let renderedGroups = $derived.by(() => {
    const entering = new Set(enteringGroupIds);
    const targetScene = revealEnteringScene
      ? visibleGroups
      : visibleGroups.filter((group) => !entering.has(group.id));
    const held = new Map(heldGroups.map((group) => [group.id, group]));
    const target = holdSharedScene
      ? targetScene.map((group) => held.get(group.id) ?? group)
      : targetScene;
    if (!retainDepartingScene) return target;
    const targetIds = new Set(target.map((group) => group.id));
    return [...target, ...departingGroups.filter((group) => !targetIds.has(group.id))];
  });
  let renderedEdges = $derived.by(() => {
    const entering = new Set(enteringEdgeIds);
    const targetScene = revealEnteringScene
      ? visibleEdges
      : visibleEdges.filter((edge) => !entering.has(edge.id));
    const held = new Map(heldEdges.map((edge) => [edge.id, edge]));
    const target = holdSharedScene
      ? targetScene.map((edge) => held.get(edge.id) ?? edge)
      : targetScene;
    if (!retainDepartingScene) return target;
    const targetIds = new Set(target.map((edge) => edge.id));
    return [...target, ...departingEdges.filter((edge) => !targetIds.has(edge.id))];
  });
  let renderedLabelPositions = $derived.by(() => {
    const positions = retainDepartingScene
      ? new Map(departingLabelPositions)
      : new Map<string, EdgeLabelPosition>();
    for (const [edgeId, position] of edgeLabelPositions) positions.set(edgeId, position);
    if (holdSharedScene) {
      for (const [edgeId, position] of heldLabelPositions) positions.set(edgeId, position);
    }
    return positions;
  });

  // Visible groups logic:
  // 1. If state explicitly defines visibleGroups, use that
  // 2. If state has highlightedNodes, only show groups containing highlighted nodes
  //    (this handles before/after diagrams where groups share nodes)
  // 3. Otherwise, show groups that have at least one visible node
  let visibleGroups = $derived.by(() => {
    if (!layout?.groups) return [];

    // If state explicitly defines which groups to show, use that
    if (currentState?.visibleGroups) {
      return layout.groups.filter((g) => currentState.visibleGroups!.includes(g.id));
    }

    // If state has highlighted nodes, only show groups that contain at least one highlighted node
    // This prevents overlapping groups in before/after diagrams where groups share nodes
    if (currentState?.highlightedNodes && currentState.highlightedNodes.length > 0) {
      const highlightedSet = new Set(currentState.highlightedNodes);
      return layout.groups.filter(
        (g) => Array.isArray(g.nodeIds) && g.nodeIds.some((id) => highlightedSet.has(id)),
      );
    }

    // Default: show groups that have at least one visible node
    return layout.groups.filter(
      (g) => Array.isArray(g.nodeIds) && g.nodeIds.some((id) => visibleNodeIds.includes(id)),
    );
  });

  // Compute layout on mount and when diagram or style config changes
  $effect(() => {
    fontMeasurementRevision;
    try {
      // Lay out only the selected scene. Future steps must not reserve space or supply
      // routing obstacles, and hidden members must not inflate an active group's frame.
      const groups = currentState
        ? diagram.model.groups
            ?.filter((group) => {
              if (currentState.visibleGroups) return currentState.visibleGroups.includes(group.id);
              const members = currentState.highlightedNodes?.length
                ? currentState.highlightedNodes
                : visibleNodeIds;
              return group.nodeIds?.some((id) => members.includes(id) && visibleNodeIdSet.has(id));
            })
            .map((group) => ({
              ...group,
              nodeIds: group.nodeIds?.filter((id) => visibleNodeIdSet.has(id)),
            }))
        : diagram.model.groups;
      const groupIds = new Set(groups?.map((group) => group.id));
      const model = currentState
        ? {
            ...diagram.model,
            // Hiding a group frame must not hide its still-visible members. The
            // layout engine positions nodes only within groups in this model.
            nodes: diagram.model.nodes
              .filter((node) => visibleNodeIdSet.has(node.id))
              .map((node) =>
                node.group && !groupIds.has(node.group) ? { ...node, group: undefined } : node,
              ),
            edges: diagram.model.edges.filter((edge) => visibleEdgeIds.includes(edge.id)),
            groups,
          }
        : diagram.model;
      layout = computeLayout(
        model,
        currentState
          ? {
              ...diagram.baseView,
              layout: {
                ...diagram.baseView.layout,
                spacing: Math.min(
                  diagram.baseView.layout.spacing ?? 80,
                  usesCompactPresentation ? 40 : 56,
                ),
              },
            }
          : diagram.baseView,
        diagram.grammar,
        renderStyleConfig,
        layoutWidthLimit,
      );
      layoutError = false;
      beginDiagramSettlement();
    } catch {
      layout = null;
      layoutError = true;
    }
  });

  // Camera state from current diagram state
  let cameraPan = $derived(currentState?.camera?.pan ?? null);
  let cameraFocusNodeId = $derived(currentState?.camera?.focus ?? null);

  // Scroll container ref for focus scrolling
  let initialFitResolved = $state(false);

  function clearTransitionScene() {
    stateJustChanged = false;
    motionPhase = 'scene';
    holdSharedScene = false;
    retainDepartingScene = false;
    revealEnteringScene = true;
    enteringNodeIds = [];
    enteringGroupIds = [];
    enteringEdgeIds = [];
    departingNodes = [];
    departingGroups = [];
    departingEdges = [];
    departingLabelPositions = new Map();
    heldNodes = [];
    heldGroups = [];
    heldEdges = [];
    heldLabelPositions = new Map();
    presentedStateId = currentStateId;
  }

  // Reconcile only replacement identity or removed local steps. Parent onUpdate echoes
  // must not rewind a valid selection or interrupt its in-flight presentation.
  $effect.pre(() => {
    const id = diagram.id;
    const stateIds = diagram.states?.map((state) => state.id) ?? [];
    const incomingStateId = diagram.currentStateId;
    untrack(() => {
      // Initial selection retains the existing prop-seeding contract; only updates reconcile.
      if (previousDiagramId === undefined) {
        previousDiagramId = id;
        return;
      }
      const valid = (stateId: string | undefined) =>
        stateId === undefined ? stateIds.length === 0 : stateIds.includes(stateId);
      if (id === previousDiagramId && valid(currentStateId) && valid(presentedStateId)) return;
      const keepSelection = id === previousDiagramId && valid(currentStateId);
      previousDiagramId = id;
      transitionRevision += 1;
      for (const animation of cameraAnimations) animation.cancel();
      cameraAnimations = [];
      cancelFitFrame();
      stopStepViewportTracking();
      movingEdgeIds.clear();
      if (!keepSelection) {
        currentStateId = stateIds.find((stateId) => stateId === incomingStateId) ?? stateIds[0];
      }
      clearTransitionScene();
      // Dispose the old keyed paint (including child-owned animations), not the renderer
      // or its controls. Ordinary navigation retains the shared-scene/camera path.
      layoutResizeRevision += 1;
    });
  });

  // Keep the available note lane separate from the content-sized presentation.
  // Only a lane resize interrupts motion; a step's own width change does not.
  $effect(() => {
    if (!scrollContainerEl) return;
    const noteLane = scrollContainerEl.closest<HTMLElement>('.node-diagram_block');
    const resizeLane = noteLane ?? rendererEl ?? scrollContainerEl;
    let resizeLaneWidth = resizeLane.clientWidth;
    untrack(() => {
      noteLaneWidth = noteLane?.clientWidth ?? null;
      scrollContainerWidth = scrollContainerEl!.clientWidth;
      updateFitScale();
    });
    const observer = new ResizeObserver(() => {
      if (
        automaticallyFitState &&
        scrollContainerWidth !== null &&
        Math.abs(resizeLane.clientWidth - resizeLaneWidth) > 0.5
      ) {
        // Old scene coordinates no longer fit after a lane resize. Settle that interruption
        // immediately; ordinary step changes keep their existing motion schedule.
        resizing = true;
        stopStepViewportTracking();
        transitionRevision += 1;
        for (const animation of cameraAnimations) animation.cancel();
        cameraAnimations = [];
        movingEdgeIds.clear();
        clearTransitionScene();
      }
      resizeLaneWidth = resizeLane.clientWidth;
      noteLaneWidth = noteLane?.clientWidth ?? null;
      scrollContainerWidth = scrollContainerEl!.clientWidth;
      updateFitScale();
      flushSync();
      if (resizing) {
        layoutResizeRevision += 1;
        flushSync();
        for (const animation of activeFiniteAnimations()) animation.finish();
        if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          resizing = false;
          resizeFrame = undefined;
        });
      }
    });
    observer.observe(scrollContainerEl);
    if (resizeLane !== scrollContainerEl) observer.observe(resizeLane);
    return () => observer.disconnect();
  });

  // Apply camera transform (zoom + pan) to the diagram content
  let cameraTransformStyle = $derived.by(() => {
    const panX = cameraPan?.x ?? 0;
    const panY = cameraPan?.y ?? 0;
    if (automaticallyFitState) {
      return `scale(${renderedScale}) translate(calc(-50% + ${panX / renderedScale}px), calc(-50% + ${panY / renderedScale}px))`;
    }
    const transforms: string[] = [];
    if (cameraPan) transforms.push(`translate(${panX}px, ${panY}px)`);
    if (renderedScale !== 1) {
      transforms.push(`scale(${renderedScale})`);
    }
    return transforms.length > 0 ? transforms.join(' ') : undefined;
  });

  // Focus on a specific node when camera.focus changes
  $effect(() => {
    if (!cameraFocusNodeId || !layout || !scrollContainerEl) return;

    const focusNode = layout.nodes.find((n) => n.id === cameraFocusNodeId);
    if (!focusNode) return;

    // Calculate the node's center position relative to the SVG using visibleBounds
    // (which accounts for state-filtered visibility) instead of layout.bounds
    const bounds = visibleBounds ?? layout.bounds;
    const nodeCenterX = focusNode.x + focusNode.width / 2 - (bounds.minX - canvasPadding);
    const nodeCenterY = focusNode.y + focusNode.height / 2 - (bounds.minY - canvasPadding);

    // Apply zoom scaling
    const scaledX = nodeCenterX * cameraZoom;
    const scaledY = nodeCenterY * cameraZoom;

    // Scroll to center the node in the container
    const containerWidth = scrollContainerEl.clientWidth;
    const containerHeight = scrollContainerEl.clientHeight;

    // Account for cameraPan offset when scrolling
    const panX = cameraPan?.x ?? 0;
    const panY = cameraPan?.y ?? 0;

    scrollContainerEl.scrollTo({
      left: Math.max(0, scaledX + panX * cameraZoom - containerWidth / 2),
      top: Math.max(0, scaledY + panY * cameraZoom - containerHeight / 2),
      behavior: motionDuration(1) === 0 ? 'auto' : 'smooth',
    });
  });

  // Compute visible bounds when state filtering is active
  function measureSceneBounds(includeDeparting = true) {
    if (!layout) return null;
    if (!currentState) {
      let { minX, minY, maxX, maxY } = layout.bounds;
      for (const label of edgeLabelPositions.values()) {
        minX = Math.min(minX, label.x);
        minY = Math.min(minY, label.y);
        maxX = Math.max(maxX, label.x + label.width);
        maxY = Math.max(maxY, label.y + label.height);
      }
      return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }

    // Compute bounds from only visible elements
    // Keep outgoing paint in the camera bounds until its existing exit finishes.
    const nodes = includeDeparting
      ? [...visibleNodes, ...departingNodes, ...heldNodes]
      : visibleNodes;
    const edges = includeDeparting
      ? [...visibleEdges, ...departingEdges, ...heldEdges]
      : visibleEdges;
    const groups = includeDeparting
      ? [...visibleGroups, ...departingGroups, ...heldGroups]
      : visibleGroups;

    if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

    let minX = Math.min(...nodes.map((n) => n.x));
    let minY = Math.min(...nodes.map((n) => n.y));
    let maxX = Math.max(...nodes.map((n) => n.x + n.width));
    let maxY = Math.max(...nodes.map((n) => n.y + n.height));

    // Include visible groups
    for (const g of groups) {
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.width);
      maxY = Math.max(maxY, g.y + g.height);
    }

    // Every waypoint is painted, including perimeter turns outside the node envelope.
    // Four scene units also contain the seven-unit marker and its rounded stroke.
    for (const edge of edges) {
      if (edge.points) {
        for (const point of edge.points) {
          minX = Math.min(minX, point.x - 4);
          minY = Math.min(minY, point.y - 4);
          maxX = Math.max(maxX, point.x + 4);
          maxY = Math.max(maxY, point.y + 4);
        }
      }
    }

    // Keep edge labels inside the SVG, including multiline labels offset from their path.
    for (const label of [
      ...edgeLabelPositions.values(),
      ...(includeDeparting ? departingLabelPositions.values() : []),
      ...(includeDeparting ? heldLabelPositions.values() : []),
    ]) {
      minX = Math.min(minX, label.x);
      minY = Math.min(minY, label.y);
      maxX = Math.max(maxX, label.x + label.width);
      maxY = Math.max(maxY, label.y + label.height);
    }

    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  // Keep both coordinate sets inside the SVG through exits and shared-node motion.
  // Clearing the retained scene restores active-scene-only fitting at rest.
  let visibleBounds = $derived(measureSceneBounds(true));

  let svgWidth = $derived.by(() => {
    if (!visibleBounds) return 800;
    return visibleBounds.width + canvasPadding * 2;
  });

  let svgHeight = $derived.by(() => {
    if (!visibleBounds) return 600;
    return visibleBounds.height + canvasPadding * 2;
  });

  let contentWidth = $derived(svgWidth * renderedScale);
  let intrinsicWidth = $derived(
    (layout ? svgWidth * cameraZoom * Math.max(1, readableScale) : 0) + 16,
  );
  let contentHeight = $derived((svgHeight + 6) * renderedScale);
  let destinationFrameHeight = $derived(Math.ceil((svgHeight + 6) * renderedScale + 20));
  let stateFrameHeight = $derived(destinationFrameHeight);
  let drawingOverflows = $derived(
    automaticallyFitState &&
      ((windowHeight !== undefined && stateFrameHeight > windowHeight * 0.9 + 1) ||
        (presentationWidth !== null && contentWidth + 16 > presentationWidth + 1)),
  );

  function stopStepViewportTracking() {
    stepViewportActive = false;
    keepStepInView = undefined;
    restoreStepScroll?.();
    restoreStepScroll = undefined;
  }

  function startStepViewportTracking() {
    stopStepViewportTracking();
    if (!rendererEl) return;
    stepViewportActive = true;
    const renderer = rendererEl;
    const ancestors: HTMLElement[] = [];
    for (let parent = renderer.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) ancestors.push(parent);
    }
    const page = document.scrollingElement as HTMLElement | null;
    if (page && !ancestors.includes(page)) ancestors.push(page);
    // Browser anchoring must not compete with the bounded, step-owned adjustment.
    const anchoring = ancestors.map((element) => ({
      element,
      value: element.style.getPropertyValue('overflow-anchor'),
      priority: element.style.getPropertyPriority('overflow-anchor'),
    }));
    for (const { element } of anchoring) element.style.setProperty('overflow-anchor', 'none');
    const stopFollowing = () => {
      keepStepInView = undefined;
    };
    // A wheel/touch/key gesture belongs to the user, even during an unfinished step.
    for (const type of ['wheel', 'touchstart', 'keydown'])
      window.addEventListener(type, stopFollowing, { capture: true, passive: true });
    restoreStepScroll = () => {
      for (const { element, value, priority } of anchoring) {
        if (value) element.style.setProperty('overflow-anchor', value, priority);
        else element.style.removeProperty('overflow-anchor');
      }
      for (const type of ['wheel', 'touchstart', 'keydown'])
        window.removeEventListener(type, stopFollowing, true);
    };
    keepStepInView = () => {
      const footer = renderer.querySelector<HTMLElement>('.diagram-footer');
      if (!footer) return;
      for (const ancestor of ancestors) {
        const bounds = ancestor.getBoundingClientRect();
        const top = ancestor === page ? 0 : Math.max(0, bounds.top + ancestor.clientTop);
        const bottom =
          ancestor === page
            ? window.innerHeight
            : Math.min(window.innerHeight, bounds.top + ancestor.clientTop + ancestor.clientHeight);
        if (bottom <= top) continue;
        const footerBounds = footer.getBoundingClientRect();
        // Only reveal clipped controls. Do not recenter unrelated note/page content.
        const target =
          footerBounds.height <= bottom - top
            ? footerBounds
            : footer.querySelector('.state-navigation')!.getBoundingClientRect();
        const delta =
          target.bottom > bottom ? target.bottom - bottom : target.top < top ? target.top - top : 0;
        if (Math.abs(delta) > 0.5) ancestor.scrollBy({ top: delta, behavior: 'instant' });
      }
    };
  }

  let svgTransform = $derived.by(() => {
    if (!visibleBounds) return 'translate(0, 0)';
    return `translate(${-visibleBounds.minX + canvasPadding}px, ${-visibleBounds.minY + canvasPadding}px)`;
  });

  let svgTransformAttribute = $derived.by(() => {
    if (!visibleBounds) return 'translate(0, 0)';
    return `translate(${-visibleBounds.minX + canvasPadding}, ${-visibleBounds.minY + canvasPadding})`;
  });

  function updateFitScale() {
    if ((!fitToWidth && !automaticallyFitState) || !scrollContainerEl) {
      fitScale = 1;
      return;
    }
    const availableWidth = Math.max(1, scrollContainerEl.clientWidth - 16);
    const layoutAvailableWidth = Math.max(1, (noteLaneWidth ?? scrollContainerEl.clientWidth) - 16);
    // A stateful canvas follows its content. Its own height must not feed back into fitting.
    const availableHeight = automaticallyFitState
      ? Number.POSITIVE_INFINITY
      : Math.max(1, scrollContainerEl.clientHeight - 16);
    const renderedWidth = Math.max(1, svgWidth * cameraZoom);
    const renderedHeight = Math.max(1, svgHeight * cameraZoom);
    const verticalStateWidthFloor =
      automaticallyFitState &&
      layoutAvailableWidth >= 500 &&
      ['TB', 'BT'].includes(diagram.baseView.layout.direction ?? '')
        ? 500
        : 160;
    layoutWidthLimit = Math.max(
      verticalStateWidthFloor,
      layoutAvailableWidth / readableScale - canvasPadding * 2,
    );
    fitScale = Math.min(
      noteLaneWidth === null ? 1.25 : Math.max(1, readableScale),
      Math.max(
        readableScale,
        Math.min(availableWidth / renderedWidth, availableHeight / renderedHeight),
      ),
    );
  }

  function cancelFitFrame() {
    if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);
    fitFrame = undefined;
  }

  function toggleFitToWidth() {
    cancelFitFrame();
    fitToWidth = !fitToWidth;
    updateFitScale();
    fitFrame = requestAnimationFrame(() => {
      fitFrame = undefined;
      updateFitScale();
      scrollContainerEl?.scrollTo({
        left: 0,
        top: 0,
        behavior: motionDuration(1) === 0 ? 'auto' : 'smooth',
      });
    });
  }

  $effect(() => {
    svgWidth;
    svgHeight;
    cameraZoom;
    if (fitToWidth || automaticallyFitState) updateFitScale();
  });

  $effect(() => {
    if (initialFitResolved || !layout || !scrollContainerEl) return;
    const availableWidth = scrollContainerEl.clientWidth - 16;
    if (availableWidth <= 0) return;
    if (svgWidth * cameraZoom > availableWidth) {
      fitToWidth = true;
      updateFitScale();
    }
    initialFitResolved = true;
  });

  let previousViewResetKey = $state<string | undefined>();
  let viewResetInitialized = $state(false);
  $effect(() => {
    const nextViewResetKey = viewResetKey;
    if (!viewResetInitialized) {
      previousViewResetKey = nextViewResetKey;
      viewResetInitialized = true;
      return;
    }
    if (nextViewResetKey === previousViewResetKey) return;
    previousViewResetKey = nextViewResetKey;
    cancelFitFrame();
    stopStepViewportTracking();
    fitToWidth = false;
    fitScale = 1;
    scrollContainerEl?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
  });

  // Handle state change
  function changeState(stateId: string) {
    if (stateId === currentStateId) return;
    startStepViewportTracking();
    const previousCameraStage = captureCameraStage();
    transitionRevision += 1;
    const revision = transitionRevision;
    const sourceNodes = renderedNodes;
    const sourceGroups = renderedGroups;
    const sourceEdges = renderedEdges;
    const sourceLabelPositions = new Map(renderedLabelPositions);
    const hasMotion = motionDuration(1) > 0;
    stateJustChanged = hasMotion;
    motionPhase = hasMotion ? 'camera' : 'scene';
    beginDiagramSettlement();
    if (hasMotion) {
      holdSharedScene = true;
      revealEnteringScene = false;
      retainDepartingScene = true;
      heldNodes = sourceNodes;
      heldGroups = sourceGroups;
      heldEdges = sourceEdges;
      heldLabelPositions = sourceLabelPositions;
      enteringNodeIds = diagram.model.nodes
        .map((node) => node.id)
        .filter((id) => !sourceNodes.some((node) => node.id === id));
      enteringGroupIds = (diagram.model.groups ?? [])
        .map((group) => group.id)
        .filter((id) => !sourceGroups.some((group) => group.id === id));
      enteringEdgeIds = diagram.model.edges
        .map((edge) => edge.id)
        .filter((id) => !sourceEdges.some((edge) => edge.id === id));
      departingNodes = sourceNodes;
      departingGroups = sourceGroups;
      departingEdges = sourceEdges;
      departingLabelPositions = sourceLabelPositions;
    }
    currentStateId = stateId;
    flushSync();
    if (hasMotion) {
      const nodePartition = partitionSceneIds(
        sourceNodes.map((node) => node.id),
        visibleNodes.map((node) => node.id),
      );
      const groupPartition = partitionSceneIds(
        sourceGroups.map((group) => group.id),
        visibleGroups.map((group) => group.id),
      );
      const edgePartition = partitionSceneIds(
        sourceEdges.map((edge) => edge.id),
        visibleEdges.map((edge) => edge.id),
      );
      enteringNodeIds = nodePartition.entering;
      enteringGroupIds = groupPartition.entering;
      enteringEdgeIds = edgePartition.entering;
      heldNodes = sourceNodes.filter((node) => nodePartition.shared.includes(node.id));
      heldGroups = sourceGroups.filter((group) => groupPartition.shared.includes(group.id));
      heldEdges = sourceEdges.filter((edge) => edgePartition.shared.includes(edge.id));
      heldLabelPositions = new Map(
        [...sourceLabelPositions].filter(([edgeId]) => edgePartition.shared.includes(edgeId)),
      );
      departingNodes = sourceNodes.filter((node) => nodePartition.departing.includes(node.id));
      departingGroups = sourceGroups.filter((group) => groupPartition.departing.includes(group.id));
      departingEdges = sourceEdges.filter((edge) => edgePartition.departing.includes(edge.id));
      departingLabelPositions = new Map(
        [...sourceLabelPositions].filter(([edgeId]) => edgePartition.departing.includes(edgeId)),
      );
      flushSync();
    } else {
      clearTransitionScene();
    }
    cameraAnimations = animateCameraStage(previousCameraStage);
    if (hasMotion) {
      if (cameraAnimations.length === 0) motionPhase = 'exit';
      void completeTransitionStages(revision, stateId, cameraAnimations);
    }

    // Notify parent so consumers (e.g. TipTap DiagramBlock) can persist the selected step
    onUpdate?.({ currentStateId: stateId });
    keepStepInView?.();
  }

  function handleEdgeMotion(edgeId: string, moving: boolean) {
    const changed = moving ? !movingEdgeIds.has(edgeId) : movingEdgeIds.has(edgeId);
    if (!changed) return;
    if (moving) movingEdgeIds.add(edgeId);
    else movingEdgeIds.delete(edgeId);
    if (moving) beginDiagramSettlement();
  }

  // Handle node position update (for editing)
  function handleNodeMove(nodeId: string, x: number, y: number) {
    if (!editable || !onUpdate) return;

    const updatedNodes = diagram.model.nodes.map((n) =>
      n.id === nodeId ? { ...n, position: { x, y } } : n,
    );

    onUpdate({
      model: {
        ...diagram.model,
        nodes: updatedNodes,
      },
    });
  }
</script>

<svelte:window bind:innerHeight={windowHeight} />

<div
  bind:this={rendererEl}
  class="diagram-renderer"
  class:has-content={Boolean(layout && diagram.model.nodes.length > 0)}
  class:compact-diagram={usesCompactPresentation}
  class:fitted-diagram={fitToWidth}
  class:stateful-diagram={Boolean(diagram.states?.length)}
  class:camera-stage={motionPhase === 'camera'}
  class:resizing
  data-diagram-intrinsic-width={intrinsicWidth}
  style={`--diagram-edge-label-font-size: ${EDGE_LABEL_STYLE.fontSize}px;
    --diagram-edge-label-line-height: ${EDGE_LABEL_STYLE.lineHeight};
    --diagram-edge-label-padding-x: ${EDGE_LABEL_STYLE.paddingX}px;
    --diagram-edge-label-padding-y: ${EDGE_LABEL_STYLE.paddingY}px;`}
  style:--diagram-camera-duration={`${motionDuration(CAMERA_MOTION_MS)}ms`}
  style:--diagram-camera-easing={CAMERA_MOTION_EASING}
  style:--diagram-move-exit-duration={`${motionDuration(MOVE_EXIT_MS)}ms`}
  style:--diagram-label-entry-delay={`${motionDuration(LABEL_ENTRY_DELAY_MS)}ms`}
  style:--diagram-label-entry-duration={`${motionDuration(LABEL_ENTRY_MS)}ms`}
  data-diagram-settled={diagramSettled}
  data-diagram-state={currentStateId}
  data-diagram-motion-phase={motionPhase}
>
  {#if layout && diagram.model.nodes.length > 0}
    <div class="diagram-actions" role="toolbar" aria-label={m.diagram_renderer_actions_ariaLabel()}>
      <Button
        variant="ghost"
        size="icon-compact"
        iconOnly
        class="diagram-fit-button"
        onclick={toggleFitToWidth}
        aria-pressed={fitToWidth}
        aria-label={fitToWidth
          ? m.diagram_renderer_actualSize_ariaLabel()
          : m.diagram_renderer_fitToWidth_ariaLabel()}
        tooltip={fitToWidth
          ? m.diagram_renderer_actualSize_ariaLabel()
          : m.diagram_renderer_fitToWidth_ariaLabel()}
      >
        <Fa icon={fitToWidth ? faExpand : faCompress} size="sm" />
      </Button>
    </div>
  {/if}
  <!-- Scrollable diagram content -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (The named drawing region needs keyboard access only when it scrolls.) -->
  <div
    class="diagram-scroll-container"
    class:stepping-viewport={stepViewportActive}
    bind:this={scrollContainerEl}
    role={automaticallyFitState ? 'region' : undefined}
    aria-label={automaticallyFitState ? m.diagram_controls_walkthrough_ariaLabel() : undefined}
    tabindex={drawingOverflows ? 0 : undefined}
    style:height={automaticallyFitState
      ? `${Math.min(stateFrameHeight, (windowHeight ?? Infinity) * 0.9)}px`
      : undefined}
  >
    {#if layoutError}
      <div class="diagram-feedback" role="alert">
        <strong>{m.markdown_mermaid_renderFailed_error()}</strong>
        <span>{m.diagram_renderer_error_description()}</span>
      </div>
    {:else if diagram.model.nodes.length === 0}
      <div class="diagram-feedback" role="status">
        <strong>{m.diagram_validator_noNodes_warning()}</strong>
        <span>{m.diagram_renderer_empty_description()}</span>
      </div>
    {:else}
      <div
        class="diagram-content"
        style:width={automaticallyFitState
          ? `max(100%, ${contentWidth + 16}px)`
          : `${contentWidth}px`}
        style:height={automaticallyFitState
          ? `max(100%, ${stateFrameHeight}px)`
          : `${contentHeight}px`}
      >
        <!-- SVG Layer (edges, groups, and HTML overlay) -->
        <svg
          class="diagram-svg-layer"
          width={svgWidth}
          height={svgHeight + 6}
          style:top={automaticallyFitState ? `${destinationFrameHeight / 2}px` : undefined}
          style:transform={cameraTransformStyle}
        >
          <!-- Shared marker definitions scoped by diagram ID to avoid cross-diagram conflicts -->
          <defs>
            <!-- Default arrowhead matching default edge stroke color -->
            <marker
              id="arrowhead-{diagram.id}"
              markerWidth="7"
              markerHeight="7"
              refX="6.5"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 3.5 0.5 L 6.5 3.5 L 3.5 6.5"
                fill="none"
                stroke="context-stroke"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <!-- Semantic-colored arrowhead markers -->
            <marker
              id="arrowhead-danger-{diagram.id}"
              markerWidth="7"
              markerHeight="7"
              refX="6.5"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 3.5 0.5 L 6.5 3.5 L 3.5 6.5"
                fill="none"
                stroke="context-stroke"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-success-{diagram.id}"
              markerWidth="7"
              markerHeight="7"
              refX="6.5"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 3.5 0.5 L 6.5 3.5 L 3.5 6.5"
                fill="none"
                stroke="context-stroke"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-warning-{diagram.id}"
              markerWidth="7"
              markerHeight="7"
              refX="6.5"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 3.5 0.5 L 6.5 3.5 L 3.5 6.5"
                fill="none"
                stroke="context-stroke"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-muted-{diagram.id}"
              markerWidth="7"
              markerHeight="7"
              refX="6.5"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 3.5 0.5 L 6.5 3.5 L 3.5 6.5"
                fill="none"
                stroke="context-stroke"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-inactive-{diagram.id}"
              markerWidth="7"
              markerHeight="7"
              refX="6.5"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 3.5 0.5 L 6.5 3.5 L 3.5 6.5"
                fill="none"
                stroke="context-stroke"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-highlighted-{diagram.id}"
              markerWidth="7"
              markerHeight="7"
              refX="6.5"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 3.5 0.5 L 6.5 3.5 L 3.5 6.5"
                fill="none"
                stroke="context-stroke"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-active-{diagram.id}"
              markerWidth="7"
              markerHeight="7"
              refX="6.5"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 3.5 0.5 L 6.5 3.5 L 3.5 6.5"
                fill="none"
                stroke="context-stroke"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
          </defs>
          {#key layoutResizeRevision}
            <g
              class="diagram-geometry-motion"
              transform={svgTransformAttribute}
              style:transform={svgTransform}
            >
              <!-- Groups (background) -->
              {#if renderedGroups}
                {#each renderedGroups as group (group.id)}
                  <g
                    in:timedFade={{
                      delay: 0,
                      duration: motionDuration(SCENE_ENTRY_MS),
                    }}
                    out:timedFade={{ duration: motionDuration(EXIT_CONTENT_MS) }}
                  >
                    <DiagramGroup
                      {group}
                      dimmed={hoveredGroupId !== null && hoveredGroupId !== group.id}
                      onHover={(groupId: string | null) => (hoveredGroupId = groupId)}
                    />
                  </g>
                {/each}
              {/if}

              <!-- Edges -->
              {#each renderedEdges as edge (edge.id)}
                {@const isEdgeDimmed =
                  (hoveredNodeId !== null && !connectedEdgeIds.has(edge.id)) ||
                  (hoveredGroupId !== null && !groupEdgeIds.has(edge.id)) ||
                  (hasStateHighlighting &&
                    highlightedEdgeSet !== null &&
                    !highlightedEdgeSet.has(edge.id))}
                {@const isEdgeHighlighted =
                  highlightedEdgeSet !== null && highlightedEdgeSet.has(edge.id)}
                <g
                  class="edge-reveal"
                  in:revealConnection={{ duration: SCENE_ENTRY_MS }}
                  out:revealConnection={{ duration: EXIT_CONNECTION_MS }}
                >
                  <DiagramEdge
                    {edge}
                    dimmed={isEdgeDimmed}
                    highlighted={isEdgeHighlighted}
                    markerScope={diagram.id}
                    terminalGap={arrowTerminalGap}
                    motionDelay={0}
                    onmotionchange={handleEdgeMotion}
                  />
                </g>
              {/each}

              <!-- Edge labels (HTML via foreignObject) -->
              {#each renderedEdges as edge (edge.id)}
                {#if edge.label && renderedLabelPositions.has(edge.id)}
                  {@const labelPos = renderedLabelPositions.get(edge.id)!}
                  {@const isDimmed =
                    (hoveredNodeId !== null && !connectedEdgeIds.has(edge.id)) ||
                    (hoveredGroupId !== null && !groupEdgeIds.has(edge.id)) ||
                    (hasStateHighlighting &&
                      highlightedEdgeSet !== null &&
                      !highlightedEdgeSet.has(edge.id))}
                  <foreignObject
                    x={labelPos.x}
                    y={labelPos.y}
                    width={labelPos.width}
                    height={labelPos.height}
                    class="edge-label-container diagram-geometry-motion {isDimmed
                      ? 'edge-label-dimmed'
                      : ''}"
                    class:edge-label-entry={stateJustChanged && enteringEdgeIds.includes(edge.id)}
                    data-edge-id={edge.id}
                    data-semantic-style={edge.semanticStyle ?? 'default'}
                    data-truncated={labelPos.truncated}
                    out:timedFade={{ duration: motionDuration(EXIT_CONTENT_MS / 2) }}
                  >
                    {#if labelPos.truncated}
                      <Tooltip content={edge.label} side="top" class="edge-label-tooltip">
                        {#snippet trigger()}
                          <div class="edge-label-html" aria-label={edge.label}>
                            <span class="edge-label-text">{edge.label}</span>
                          </div>
                        {/snippet}
                      </Tooltip>
                    {:else}
                      <div class="edge-label-html">
                        <span class="edge-label-text">{edge.label}</span>
                      </div>
                    {/if}
                  </foreignObject>
                {/if}
              {/each}

              <!-- HTML nodes via foreignObject -->
              {#each renderedNodes as node (node.id)}
                {@const isNodeDimmed =
                  (hoveredNodeId !== null && !connectedNodeIds.has(node.id)) ||
                  (hoveredGroupId !== null && !groupNodeIds.has(node.id)) ||
                  (hasStateHighlighting &&
                    highlightedNodeSet !== null &&
                    !highlightedNodeSet.has(node.id))}
                {@const isNodeHighlighted =
                  highlightedNodeSet !== null && highlightedNodeSet.has(node.id)}
                <foreignObject
                  data-node-id={node.id}
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  class="diagram-geometry-motion"
                  in:timedFade={{
                    delay: 0,
                    duration: stateJustChanged ? motionDuration(SCENE_ENTRY_MS) : 0,
                    easing: cubicOut,
                  }}
                  out:timedFade={{ duration: motionDuration(EXIT_CONTENT_MS) }}
                >
                  <DiagramNodeHTML
                    {node}
                    {editable}
                    styleConfig={renderStyleConfig}
                    dimmed={isNodeDimmed}
                    highlighted={isNodeHighlighted}
                    onMove={(x: number, y: number) => handleNodeMove(node.id, x, y)}
                    onHover={(nodeId: string | null) => (hoveredNodeId = nodeId)}
                    {onBindingClick}
                  />
                </foreignObject>
              {/each}
            </g>
          {/key}
        </svg>
      </div>
    {/if}
  </div>

  <!-- Reserve the final row for this diagram's controls, outside its drawing viewport. -->
  {#if !layoutError && diagram.model.nodes.length > 0 && diagram.states && diagram.states.length > 0}
    <div class="diagram-footer">
      <DiagramControls states={diagram.states} {currentStateId} onStateChange={changeState} />
    </div>
  {/if}
</div>

<style>
  .diagram-renderer {
    --diagram-camera-duration: 180ms;
    --diagram-camera-easing: cubic-bezier(0.65, 0, 0.35, 1);
    --diagram-move-exit-duration: 220ms;
    --diagram-label-entry-delay: 60ms;
    --diagram-label-entry-duration: 120ms;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 900px;
    position: relative;
    color: hsl(var(--foreground));
    font-family: var(--font-ui);
  }

  .diagram-renderer:is(.compact-diagram, .fitted-diagram) {
    max-height: none;
  }

  .diagram-renderer.has-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    width: 100%;
    max-width: 100%;
    margin-inline: auto;
  }

  .diagram-renderer.stateful-diagram.has-content {
    height: auto;
    min-height: 0;
    max-height: none;
    grid-template-rows: auto minmax(0, 1fr) auto;
    align-items: stretch;
  }

  .diagram-actions {
    grid-column: 1;
    grid-row: 1;
    justify-self: end;
    display: flex;
    margin: var(--space-2) var(--space-2) var(--space-1);
    padding: 2px;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: hsl(var(--background));
    box-shadow: var(--elevation-raised);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--motion-standard) var(--ease-standard);
  }

  .diagram-renderer:hover .diagram-actions,
  .diagram-renderer:focus-within .diagram-actions {
    opacity: 1;
    pointer-events: auto;
  }

  :global(.diagram-fit-button) {
    color: hsl(var(--muted-foreground));
  }

  :global(.diagram-fit-button:hover),
  :global(.diagram-fit-button:focus-visible) {
    color: hsl(var(--foreground));
  }

  .diagram-scroll-container {
    grid-column: 1;
    grid-row: 2;
    overflow: auto;
    width: 100%;
    flex: 1;
    min-height: 0;
  }

  .stateful-diagram .diagram-scroll-container {
    overflow: auto;
    max-height: 90vh;
  }

  .stepping-viewport {
    transition: height var(--diagram-camera-duration) var(--diagram-camera-easing);
  }

  .stateful-diagram .diagram-content {
    min-width: 100%;
    min-height: 100%;
  }

  .resizing :global(*) {
    transition: none !important;
    animation: none !important;
  }

  .stateful-diagram .diagram-svg-layer {
    position: absolute;
    left: 50%;
    top: 50%;
  }

  .diagram-content {
    position: relative;
    width: fit-content;
    height: fit-content;
    margin: 0 auto;
    overflow: visible;
    border-radius: var(--radius-medium);
  }

  .diagram-feedback {
    display: grid;
    min-height: 10rem;
    place-content: center;
    gap: var(--space-1);
    padding: var(--space-4);
    text-align: center;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
  }

  .diagram-feedback strong {
    color: hsl(var(--foreground));
    font-weight: var(--text-caption-weight);
  }

  .diagram-svg-layer {
    display: block;
    background: var(--diagram-canvas);
    transform-origin: top left;
    transition: transform var(--diagram-camera-duration, 220ms)
      var(--diagram-camera-easing, cubic-bezier(0.65, 0, 0.35, 1));
  }

  .diagram-footer {
    grid-column: 1;
    grid-row: 3;
    min-width: 0;
    flex-shrink: 0;
    box-sizing: border-box;
    overflow: hidden;
  }

  /* Allow pointer events on nodes */
  :global(.diagram-node-html) {
    pointer-events: auto;
  }

  foreignObject[data-node-id] {
    overflow: visible;
  }

  /* Edge labels */
  :global(.edge-label-container) {
    pointer-events: none;
    overflow: visible;
    transition: opacity var(--motion-standard) var(--ease-standard);
    display: block;
  }

  :global(.edge-label-tooltip) {
    width: 100%;
    height: 100%;
    pointer-events: auto;
  }

  :global(.diagram-geometry-motion) {
    transition:
      transform var(--diagram-move-exit-duration) cubic-bezier(0.16, 1, 0.3, 1),
      x var(--diagram-move-exit-duration) cubic-bezier(0.16, 1, 0.3, 1),
      y var(--diagram-move-exit-duration) cubic-bezier(0.16, 1, 0.3, 1),
      width var(--diagram-move-exit-duration) cubic-bezier(0.16, 1, 0.3, 1),
      height var(--diagram-move-exit-duration) cubic-bezier(0.16, 1, 0.3, 1),
      opacity 180ms ease-out;
  }

  .stateful-diagram.camera-stage :global(.diagram-geometry-motion) {
    transition:
      transform var(--diagram-camera-duration) var(--diagram-camera-easing),
      x var(--diagram-move-exit-duration) cubic-bezier(0.16, 1, 0.3, 1),
      y var(--diagram-move-exit-duration) cubic-bezier(0.16, 1, 0.3, 1),
      width var(--diagram-move-exit-duration) cubic-bezier(0.16, 1, 0.3, 1),
      height var(--diagram-move-exit-duration) cubic-bezier(0.16, 1, 0.3, 1),
      opacity 180ms ease-out;
  }

  .stateful-diagram.camera-stage :global(.group-bg) {
    transition-delay: 0ms;
  }

  .stateful-diagram.camera-stage :global(.group-label) {
    transition-delay: 0ms;
  }

  /* The camera animation owns world-pose interpolation, including the origin
     rebase. Shared node/edge motion remains independently animated below it. */
  .stateful-diagram .diagram-svg-layer,
  .stateful-diagram .diagram-svg-layer > .diagram-geometry-motion {
    transition: none;
  }

  :global(.edge-label-dimmed) {
    opacity: 0.64;
  }

  :global(.edge-label-entry) {
    animation: revealLabel var(--diagram-label-entry-duration) var(--diagram-label-entry-delay)
      cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes revealLabel {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  :global(.edge-label-html) {
    position: relative;
    isolation: isolate;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 2px;
    font-family: var(--font-ui);
    font-size: var(--diagram-edge-label-font-size);
    font-weight: var(--text-body-weight);
    line-height: var(--diagram-edge-label-line-height);
    letter-spacing: var(--text-caption-tracking);
    color: hsl(var(--muted-foreground));
    background: transparent;
    padding: var(--diagram-edge-label-padding-y) var(--diagram-edge-label-padding-x);
    overflow: hidden;
    overflow-wrap: normal;
    word-break: normal;
    text-align: center;
    box-sizing: border-box;
  }

  :global(.edge-label-html::before) {
    position: absolute;
    z-index: 0;
    inset: 0;
    content: '';
    background-color: var(--diagram-label-surface);
    -webkit-mask-image:
      linear-gradient(
        to right,
        transparent,
        hsl(var(--foreground)) 6px,
        hsl(var(--foreground)) calc(100% - 6px),
        transparent
      ),
      linear-gradient(
        to bottom,
        transparent,
        hsl(var(--foreground)) 4px,
        hsl(var(--foreground)) calc(100% - 4px),
        transparent
      );
    -webkit-mask-composite: source-in;
    -webkit-mask-repeat: no-repeat;
    mask-image:
      linear-gradient(
        to right,
        transparent,
        hsl(var(--foreground)) 6px,
        hsl(var(--foreground)) calc(100% - 6px),
        transparent
      ),
      linear-gradient(
        to bottom,
        transparent,
        hsl(var(--foreground)) 4px,
        hsl(var(--foreground)) calc(100% - 4px),
        transparent
      );
    mask-composite: intersect;
    mask-repeat: no-repeat;
    pointer-events: none;
    transition: background-color var(--motion-standard) var(--ease-standard);
  }

  :global(.edge-label-text) {
    position: relative;
    z-index: 1;
    display: -webkit-box;
    margin-inline: -1px;
    padding-inline: 1px;
    overflow: hidden;
    white-space: pre-line;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  :global(.catalog-reduced-motion .edge-label-container),
  :global(.catalog-reduced-motion .edge-label-html::before),
  :global(.catalog-reduced-motion .diagram-geometry-motion),
  :global(.catalog-reduced-motion .diagram-svg-layer),
  :global(.catalog-reduced-motion) .diagram-actions {
    transition: none;
    animation: none;
  }

  :global(.catalog-reduced-motion .diagram-renderer),
  :global(.catalog-reduced-motion .diagram-renderer *) {
    transition: none !important;
    animation: none !important;
  }

  @container style(--motion-reduced: 1) {
    :global(html:not(.catalog-full-motion) .edge-label-container),
    :global(html:not(.catalog-full-motion) .edge-label-html::before),
    :global(html:not(.catalog-full-motion) .diagram-geometry-motion),
    :global(html:not(.catalog-full-motion) .diagram-svg-layer),
    :global(html:not(.catalog-full-motion)) .diagram-actions {
      transition: none;
      animation: none;
    }

    :global(html:not(.catalog-full-motion) .diagram-renderer),
    :global(html:not(.catalog-full-motion) .diagram-renderer *) {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
