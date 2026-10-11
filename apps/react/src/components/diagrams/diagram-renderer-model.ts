// Component-local scene and camera lifecycle translated from DiagramRenderer.svelte.
import { signal, computed, effect, batch, untracked } from '@preact/signals-react';
import { flushSync } from 'react-dom';
import type { DiagramPrimitive } from '$shared/types/notes-primitives';
import {
  compactEdgeLabelMaxWidth,
  computeLayout,
  measureEdgeLabel,
} from '$lib/components/diagrams/layout-engine';
import {
  DEFAULT_NODE_STYLE,
  type ComputedEdge,
  type ComputedGroup,
  type ComputedLayout,
  type ComputedNode,
  type NodeStyleConfig,
} from '$lib/components/diagrams/types';
import { prefersReducedMotion, onReducedMotionChange } from '@/lib/motion';
import { cameraMotionKeyframes, partitionSceneIds } from '$lib/components/diagrams/diagram-motion';
import { freeLabelFractions } from '$lib/components/diagrams/diagram-label-placement';
import { equalComputedLayout } from '$lib/components/diagrams/equal-computed-layout';
export interface DiagramRendererProps {
  diagram: DiagramPrimitive;
  onUpdate?: (updates: Partial<DiagramPrimitive>) => void;
  editable?: boolean;
  /** Optional node style configuration for customizing font sizes, padding, etc. */
  styleConfig?: NodeStyleConfig;
  /** Callback for when a node binding is clicked */
  onBindingClick?: (
    e: MouseEvent,
    binding: {
      type: string;
      target: string;
    },
  ) => void;
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
export function createDiagramRenderer(initial: DiagramRendererProps) {
  const inputs = signal(initial);
  const revision = signal(0);
  const preEffects: Array<() => void | (() => void)> = [];
  const effects: Array<() => void | (() => void)> = [];
  const mounts: Array<() => void | (() => void)> = [];
  const destroys: Array<() => void> = [];
  function flushView() {
    flushSync(() => {
      revision.value += 1;
    });
  }
  async function tick() {
    await Promise.resolve();
    flushView();
  }
  const diagram = computed(() => inputs.value.diagram);
  const onUpdate = computed(() => inputs.value.onUpdate);
  const editable = computed(() => inputs.value.editable ?? false);
  const styleConfig = computed(() => inputs.value.styleConfig ?? DEFAULT_NODE_STYLE);
  const onBindingClick = computed(() => inputs.value.onBindingClick);
  const viewResetKey = computed(() => inputs.value.viewResetKey);
  const PADDING = 32;
  const PRIMARY_TEXT_FLOOR = 12;
  const SECONDARY_TEXT_FLOOR = 10;
  const ARROW_TERMINAL_GAP_CSS_PX = 5;
  const ARROW_TIP_RADIUS_CSS_PX = 0.5;
  let resizing = signal(false);
  let layoutResizeRevision = signal(0);
  let resizeFrame: number | undefined;
  let fitFrame: number | undefined;
  function motionDuration(duration: number): number {
    return resizing.value || prefersReducedMotion(scrollContainerEl.value?.ownerDocument)
      ? 0
      : duration;
  }

  // Computed layout
  let layout = signal<ComputedLayout | null>(null);
  let publishedLayout: ComputedLayout | null = null;
  let layoutError = signal(false);
  let fitToWidth = signal(false);
  let fitScale = signal(1);
  let layoutWidthLimit = signal(900);
  let uncompactedLayoutWidth = signal(900);
  let scrollContainerEl = signal<HTMLDivElement | null>(null);
  let scrollContainerWidth = signal<number | null>(null);
  let noteLaneWidth = signal<number | null>(null);
  let windowHeight = signal<number | undefined>();
  let stepViewportActive = signal(false);
  let restoreStepScroll: (() => void) | undefined;
  let keepStepInView: (() => void) | undefined;
  let fontMeasurementRevision = signal(0);
  mounts.push(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) fontMeasurementRevision.value += 1;
    });
    return () => {
      cancelled = true;
    };
  });

  // Current state - default to first state if not set

  let currentStateId = signal(
    diagram.value.currentStateId ??
      (diagram.value.states && diagram.value.states.length > 0
        ? diagram.value.states[0].id
        : undefined),
  );
  let currentState = computed(
    () => diagram.value.states?.find((s) => s.id === currentStateId.value) ?? null,
  );

  let presentedStateId = signal(currentStateId.value);
  let previousDiagramId: string | undefined;
  let presentedState = computed(
    () =>
      diagram.value.states?.find((state) => state.id === presentedStateId.value) ??
      currentState.value,
  );
  let cameraZoom = computed(() => currentState.value?.camera?.zoom ?? 1);
  let automaticallyFitState = computed(() => currentState.value !== null);
  let presentationWidth = computed(() =>
    scrollContainerWidth.value !== null && scrollContainerWidth.value > 0
      ? scrollContainerWidth.value
      : (scrollContainerEl.value?.clientWidth ?? null),
  );
  let usesCompactPresentation = computed(
    () =>
      uncompactedLayoutWidth.value < 500 ||
      (automaticallyFitState.value &&
        (noteLaneWidth.value ?? presentationWidth.value ?? 0) > 0 &&
        (noteLaneWidth.value ?? presentationWidth.value ?? 0) < 500),
  );
  let canvasPadding = computed(() => (usesCompactPresentation.value ? 4 : PADDING));
  let renderStyleConfig = computed(() =>
    usesCompactPresentation.value
      ? {
          ...styleConfig.value,
          maxWidth: Math.min(styleConfig.value.maxWidth, 150),
          maxLines: Math.max(styleConfig.value.maxLines, 5),
          paddingX: Math.min(styleConfig.value.paddingX, 10),
        }
      : styleConfig.value,
  );
  let renderedScale = computed(
    () => cameraZoom.value * (fitToWidth.value || automaticallyFitState.value ? fitScale.value : 1),
  );
  let readableScale = computed(() =>
    Math.max(
      PRIMARY_TEXT_FLOOR / renderStyleConfig.value.labelFontSize,
      SECONDARY_TEXT_FLOOR /
        (styleConfig.value === DEFAULT_NODE_STYLE ? 11 : renderStyleConfig.value.kindFontSize),
    ),
  );
  let arrowTerminalGap = computed(
    () => (ARROW_TERMINAL_GAP_CSS_PX + ARROW_TIP_RADIUS_CSS_PX) / renderedScale.value,
  );
  let labelTurnClearance = computed(() => 8 / renderedScale.value);

  // Track state changes for animations
  let stateJustChanged = signal(false);
  let enteringNodeIds = signal<string[]>([]);
  let enteringGroupIds = signal<string[]>([]);
  let enteringEdgeIds = signal<string[]>([]);
  let departingNodes = signal<ComputedNode[]>([]);
  let departingGroups = signal<ComputedGroup[]>([]);
  let departingEdges = signal<ComputedEdge[]>([]);
  let departingLabelPositions = signal(new Map<string, EdgeLabelPosition>());
  let heldNodes = signal<ComputedNode[]>([]);
  let heldGroups = signal<ComputedGroup[]>([]);
  let heldEdges = signal<ComputedEdge[]>([]);
  let heldLabelPositions = signal(new Map<string, EdgeLabelPosition>());
  let holdSharedScene = signal(false);
  let retainDepartingScene = signal(false);
  let revealEnteringScene = signal(true);
  const movingEdgeIds = new Set<string>();
  let rendererEl = signal<HTMLDivElement>();
  let diagramSettled = signal(true);
  let settlementRevision = 0;
  let settlementFrame: number | undefined;
  let transitionRevision = 0;
  let motionPhase = signal<'settled' | 'camera' | 'exit' | 'scene'>('settled');
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
    const camera = rendererEl.value?.querySelector<SVGSVGElement>('.diagram-svg-layer');
    const geometry = rendererEl.value?.querySelector<SVGGElement>('.diagram-geometry-motion');
    const matrix = geometry?.getScreenCTM?.();
    return {
      camera: camera ? getComputedStyle(camera).transform : null,
      screenMatrix: matrix
        ? new DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f])
        : null,
    };
  }
  function animateCameraStage(previous: ReturnType<typeof captureCameraStage>) {
    if (motionDuration(1) === 0 || !rendererEl.value) return [];
    const camera = rendererEl.value.querySelector<SVGSVGElement>('.diagram-svg-layer');
    const geometry = rendererEl.value.querySelector<SVGGElement>('.diagram-svg-layer > g');
    if (!camera || !geometry || !previous.camera) return [];
    for (const animation of camera.getAnimations({
      subtree: false,
    }))
      animation.cancel();
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
  function activeFiniteAnimations() {
    if (!rendererEl.value?.getAnimations) return [];
    return rendererEl.value
      .getAnimations({
        subtree: true,
      })
      .filter((animation) => {
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
    if (heldNodes.value.length === 0 && visibleNodes.value.length > 0) {
      // Disjoint scenes have no shared paint to bridge exit and destination fitting.
      // Enter inside the fitted union while outgoing paint is still opaque, then
      // let it exit only after incoming paint has finished becoming visible.
      motionPhase.value = 'scene';
      revealEnteringScene.value = true;
      flushView();
      if (!(await waitForVisualAnimations(revision))) return;
    }
    motionPhase.value = 'exit';
    holdSharedScene.value = false;
    retainDepartingScene.value = false;
    presentedStateId.value = stateId;
    flushView();
    if (!(await waitForVisualAnimations(revision))) return;
    const previousCameraStage = captureCameraStage();
    departingNodes.value = [];
    departingGroups.value = [];
    departingEdges.value = [];
    departingLabelPositions.value = new Map();
    heldNodes.value = [];
    heldGroups.value = [];
    heldEdges.value = [];
    heldLabelPositions.value = new Map();
    // Outgoing paint has finished fading. Fit the destination with shared geometry
    // (or the already-visible disjoint scene) before revealing any remaining entry.
    motionPhase.value = 'camera';
    flushView();
    cameraAnimations = animateCameraStage(previousCameraStage);
    if (!(await waitForVisualAnimations(revision))) return;
    motionPhase.value = 'scene';
    revealEnteringScene.value = true;
    flushView();
  }
  function motionSnapshot() {
    if (!rendererEl.value) return '';
    // Settlement belongs to this diagram. Scrolling or moving an ancestor must
    // not keep unchanged local geometry in the settling state.
    const origin = rendererEl.value.getBoundingClientRect();
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
    return [...rendererEl.value.querySelectorAll<SVGElement | HTMLElement>(selector)]
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
          (bounds.x - origin.x).toFixed(3),
          (bounds.y - origin.y).toFixed(3),
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
        motionPhase.value === 'camera' ||
        motionPhase.value === 'exit' ||
        movingEdgeIds.size > 0 ||
        activeFiniteAnimations().length > 0;
      if (!active && previousSnapshot !== undefined && snapshot === previousSnapshot) {
        if (stateJustChanged.value) {
          stateJustChanged.value = false;
          settlementFrame = undefined;
          void tick().then(() => {
            if (revision === settlementRevision) monitorDiagramSettlement(revision);
          });
          return;
        }
        diagramSettled.value = true;
        motionPhase.value = 'settled';
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
      stateJustChanged.value = false;
    }
    diagramSettled.value = false;
    queueMicrotask(() => {
      if (revision === settlementRevision) monitorDiagramSettlement(revision);
    });
  }
  destroys.push(() => {
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
  let hoveredNodeId = signal<string | null>(null);
  let hoveredGroupId = signal<string | null>(null);

  // Calculate connected elements when hovering a node
  let connectedNodeIds = computed(() => {
    if (!hoveredNodeId.value) return new Set<string>();
    const connected = new Set<string>();
    connected.add(hoveredNodeId.value);

    // Find all edges connected to the hovered node
    diagram.value.model.edges.forEach((edge) => {
      if (edge.from === hoveredNodeId.value) {
        connected.add(edge.to);
      }
      if (edge.to === hoveredNodeId.value) {
        connected.add(edge.from);
      }
    });
    return connected;
  });
  let connectedEdgeIds = computed(() => {
    if (!hoveredNodeId.value) return new Set<string>();
    const connected = new Set<string>();

    // Find all edges connected to the hovered node
    diagram.value.model.edges.forEach((edge) => {
      if (edge.from === hoveredNodeId.value || edge.to === hoveredNodeId.value) {
        connected.add(edge.id);
      }
    });
    return connected;
  });

  // Calculate which nodes belong to the hovered group
  let groupNodeIds = computed(() => {
    if (!hoveredGroupId.value) return new Set<string>();
    const ids = new Set<string>();

    // Check group.nodeIds from the groups array
    if (diagram.value.model.groups) {
      const group = diagram.value.model.groups.find((g) => g.id === hoveredGroupId.value);
      if (group?.nodeIds) {
        group.nodeIds.forEach((id) => ids.add(id));
      }
    }

    // Also check nodes that declare membership via node.group property
    diagram.value.model.nodes.forEach((node) => {
      if (node.group === hoveredGroupId.value) {
        ids.add(node.id);
      }
    });
    return ids;
  });

  // Calculate which edges connect nodes within the hovered group
  let groupEdgeIds = computed(() => {
    if (!hoveredGroupId.value) return new Set<string>();
    const nodeIds = groupNodeIds.value;
    const connected = new Set<string>();
    diagram.value.model.edges.forEach((edge) => {
      if (nodeIds.has(edge.from) || nodeIds.has(edge.to)) {
        connected.add(edge.id);
      }
    });
    return connected;
  });

  // Highlighted elements (from current state)
  let highlightedNodeSet = computed(() =>
    presentedState.value?.highlightedNodes && presentedState.value.highlightedNodes.length > 0
      ? new Set(presentedState.value.highlightedNodes)
      : null,
  );
  let highlightedEdgeSet = computed(() =>
    presentedState.value?.highlightedEdges && presentedState.value.highlightedEdges.length > 0
      ? new Set(presentedState.value.highlightedEdges)
      : null,
  );
  let hasStateHighlighting = computed(
    () => highlightedNodeSet.value !== null || highlightedEdgeSet.value !== null,
  );

  // Visible elements (based on current state)
  let visibleNodeIds = computed(
    () => currentState.value?.visibleNodes ?? diagram.value.model.nodes.map((n) => n.id),
  );
  let visibleNodeIdSet = computed(() => new Set(visibleNodeIds.value));
  let rawVisibleEdgeIds = computed(
    () => currentState.value?.visibleEdges ?? diagram.value.model.edges.map((e) => e.id),
  );
  let visibleEdgeIds = computed(() =>
    rawVisibleEdgeIds.value.filter((edgeId) => {
      const edge = diagram.value.model.edges.find((e) => e.id === edgeId);
      return edge && visibleNodeIdSet.value.has(edge.from) && visibleNodeIdSet.value.has(edge.to);
    }),
  );
  let visibleNodes = computed(
    () => layout.value?.nodes.filter((n) => visibleNodeIds.value.includes(n.id)) ?? [],
  );
  let visibleEdges = computed(
    () => layout.value?.edges.filter((e) => visibleEdgeIds.value.includes(e.id)) ?? [],
  );
  let edgeLabelPositions = computed(() => {
    // Fixed-size nodes can retain their geometry while connector fonts change.
    void fontMeasurementRevision.value;
    const positions = new Map<string, EdgeLabelPosition>();
    const placedLabels: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    const overlapsNode = (x: number, y: number, w: number, h: number, padding = 0) => {
      return visibleNodes.value.some((node) => {
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
      return (layout.value?.groups ?? []).some(
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
      visibleEdges.value.some(
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
    for (const edge of visibleEdges.value) {
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
        usesCompactPresentation.value
          ? compactEdgeLabelMaxWidth(edge.label ?? '', directVerticalCapacity)
          : undefined,
      );
      const truncated = lines > 3;
      const modelEdge = diagram.value.model.edges.find(({ id }) => id === edge.id);
      const reverseEdge =
        modelEdge &&
        diagram.value.model.edges.find(
          (candidate) => candidate.from === modelEdge.to && candidate.to === modelEdge.from,
        );
      if (reverseEdge && points.length === 2) {
        const reverseLabel = measureEdgeLabel(
          reverseEdge.label ?? '',
          usesCompactPresentation.value
            ? compactEdgeLabelMaxWidth(reverseEdge.label ?? '')
            : undefined,
        );
        const dx = Math.abs(points[1].x - points[0].x);
        const dy = Math.abs(points[1].y - points[0].y);
        const axisLength = Math.max(dx, dy);
        const pairExtent =
          dx >= dy
            ? (labelWidth + reverseLabel.width) / 2
            : (labelHeight + reverseLabel.height) / 2;
        const preferredFraction = visibleEdgeIds.value.includes(reverseEdge.id)
          ? Math.max(0.05, Math.min(0.35, (1 - (pairExtent + 6) / axisLength) / 2))
          : 0.35;
        const labelExtent = dx >= dy ? labelWidth : labelHeight;
        const minimumFraction = Math.min(
          0.5,
          (labelExtent / 2 + 4 / renderedScale.value) / axisLength,
        );
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
          positions.set(edge.id, {
            x,
            y,
            width: labelWidth,
            height: labelHeight,
            truncated,
          });
          placedLabels.push({
            x,
            y,
            width: labelWidth,
            height: labelHeight,
          });
          continue;
        }
      }
      const candidates: Array<{
        x: number;
        y: number;
        score: number;
      }> = [];
      const closeCandidates: Array<{
        x: number;
        y: number;
        score: number;
      }> = [];
      const oneSidedCandidates: Array<{
        x: number;
        y: number;
        score: number;
      }> = [];
      const addCandidate = (x: number, y: number, score: number, target = candidates) => {
        const labelX = x - labelWidth / 2;
        const labelY = y - labelHeight / 2;
        if (overlapsNode(labelX, labelY, labelWidth, labelHeight, 8)) return;
        if (overlapsGroupHeader(labelX, labelY, labelWidth, labelHeight)) return;
        if (overlapsRoute(labelX, labelY, labelWidth, labelHeight, edge.id)) return;
        const candidate = {
          x: labelX,
          y: labelY,
          score,
        };
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
          if (farthestTurn < labelExtent / 2 + labelTurnClearance.value) continue;
          const anchorX = p1.x + (p2.x - p1.x) * fraction;
          const anchorY = p1.y + (p2.y - p1.y) * fraction;
          const horizontalBonus = isHorizontal ? 1000 : 0;
          addCandidate(
            anchorX,
            anchorY,
            segmentLength + horizontalBonus - Math.abs(fraction - 0.5) * 16,
            nearestTurn >= labelExtent / 2 + labelTurnClearance.value
              ? candidates
              : oneSidedCandidates,
          );
        }
      }

      // Fixed fractions can miss a small clear interval. Only on exhaustion, inspect
      // obstacle boundaries along the same edge, then revalidate the usual predicates.
      if (!candidates.length && !closeCandidates.length && !oneSidedCandidates.length) {
        const obstacles = [
          ...visibleNodes.value.map((node) => ({
            ...node,
            padding: 8,
          })),
          ...(layout.value?.groups ?? []).map((group) => ({
            ...group,
            height: 34,
            padding: 0,
          })),
          ...placedLabels.map((label) => ({
            ...label,
            padding: 1,
          })),
          ...visibleEdges.value
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
            {
              width: labelWidth,
              height: labelHeight,
            },
            obstacles,
            labelTurnClearance.value,
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
        placedLabels.push({
          x: best.x,
          y: best.y,
          width: labelWidth,
          height: labelHeight,
        });
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
        placedLabels.push({
          x: labelX,
          y: labelY,
          width: labelWidth,
          height: labelHeight,
        });
      }
    }
    return positions;
  });
  let renderedNodes = computed(() => {
    const entering = new Set(enteringNodeIds.value);
    const targetScene = revealEnteringScene.value
      ? visibleNodes.value
      : visibleNodes.value.filter((node) => !entering.has(node.id));
    const held = new Map(heldNodes.value.map((node) => [node.id, node]));
    const target = holdSharedScene.value
      ? targetScene.map((node) => held.get(node.id) ?? node)
      : targetScene;
    if (!retainDepartingScene.value) return target;
    const targetIds = new Set(target.map((node) => node.id));
    return [...target, ...departingNodes.value.filter((node) => !targetIds.has(node.id))];
  });
  let renderedGroups = computed(() => {
    const entering = new Set(enteringGroupIds.value);
    const targetScene = revealEnteringScene.value
      ? visibleGroups.value
      : visibleGroups.value.filter((group) => !entering.has(group.id));
    const held = new Map(heldGroups.value.map((group) => [group.id, group]));
    const target = holdSharedScene.value
      ? targetScene.map((group) => held.get(group.id) ?? group)
      : targetScene;
    if (!retainDepartingScene.value) return target;
    const targetIds = new Set(target.map((group) => group.id));
    return [...target, ...departingGroups.value.filter((group) => !targetIds.has(group.id))];
  });
  let renderedEdges = computed(() => {
    const entering = new Set(enteringEdgeIds.value);
    const targetScene = revealEnteringScene.value
      ? visibleEdges.value
      : visibleEdges.value.filter((edge) => !entering.has(edge.id));
    const held = new Map(heldEdges.value.map((edge) => [edge.id, edge]));
    const target = holdSharedScene.value
      ? targetScene.map((edge) => held.get(edge.id) ?? edge)
      : targetScene;
    if (!retainDepartingScene.value) return target;
    const targetIds = new Set(target.map((edge) => edge.id));
    return [...target, ...departingEdges.value.filter((edge) => !targetIds.has(edge.id))];
  });
  let renderedLabelPositions = computed(() => {
    const positions = retainDepartingScene.value
      ? new Map(departingLabelPositions.value)
      : new Map<string, EdgeLabelPosition>();
    for (const [edgeId, position] of edgeLabelPositions.value) positions.set(edgeId, position);
    if (holdSharedScene.value) {
      for (const [edgeId, position] of heldLabelPositions.value) positions.set(edgeId, position);
    }
    return positions;
  });

  // Visible groups logic:
  // 1. If state explicitly defines visibleGroups, use that
  // 2. If state has highlightedNodes, only show groups containing highlighted nodes
  //    (this handles before/after diagrams where groups share nodes)
  // 3. Otherwise, show groups that have at least one visible node
  let visibleGroups = computed(() => {
    const scene = currentState.value;
    if (!layout.value?.groups) return [];

    // If state explicitly defines which groups to show, use that
    if (scene?.visibleGroups) {
      return layout.value.groups.filter((g) => scene.visibleGroups!.includes(g.id));
    }

    // If state has highlighted nodes, only show groups that contain at least one highlighted node
    // This prevents overlapping groups in before/after diagrams where groups share nodes
    if (scene?.highlightedNodes && scene.highlightedNodes.length > 0) {
      const highlightedSet = new Set(scene.highlightedNodes);
      return layout.value.groups.filter(
        (g) => Array.isArray(g.nodeIds) && g.nodeIds.some((id) => highlightedSet.has(id)),
      );
    }

    // Default: show groups that have at least one visible node
    return layout.value.groups.filter(
      (g) => Array.isArray(g.nodeIds) && g.nodeIds.some((id) => visibleNodeIds.value.includes(id)),
    );
  });

  // Compute layout on mount and when diagram or style config changes
  effects.push(() => {
    void fontMeasurementRevision.value;
    const scene = currentState.value;
    try {
      // Lay out only the selected scene. Future steps must not reserve space or supply
      // routing obstacles, and hidden members must not inflate an active group's frame.
      const groups = scene
        ? diagram.value.model.groups
            ?.filter((group) => {
              if (scene.visibleGroups) return scene.visibleGroups.includes(group.id);
              const members = scene.highlightedNodes?.length
                ? scene.highlightedNodes
                : visibleNodeIds.value;
              return group.nodeIds?.some(
                (id) => members.includes(id) && visibleNodeIdSet.value.has(id),
              );
            })
            .map((group) => ({
              ...group,
              nodeIds: group.nodeIds?.filter((id) => visibleNodeIdSet.value.has(id)),
            }))
        : diagram.value.model.groups;
      const groupIds = new Set(groups?.map((group) => group.id));
      const model = scene
        ? {
            ...diagram.value.model,
            // Hiding a group frame must not hide its still-visible members. The
            // layout engine positions nodes only within groups in this model.
            nodes: diagram.value.model.nodes
              .filter((node) => visibleNodeIdSet.value.has(node.id))
              .map((node) =>
                node.group && !groupIds.has(node.group)
                  ? {
                      ...node,
                      group: undefined,
                    }
                  : node,
              ),
            edges: diagram.value.model.edges.filter((edge) =>
              visibleEdgeIds.value.includes(edge.id),
            ),
            groups,
          }
        : diagram.value.model;
      const nextLayout = computeLayout(
        model,
        scene
          ? {
              ...diagram.value.baseView,
              layout: {
                ...diagram.value.baseView.layout,
                spacing: Math.min(
                  diagram.value.baseView.layout.spacing ?? 80,
                  usesCompactPresentation.value ? 40 : 56,
                ),
              },
            }
          : diagram.value.baseView,
        diagram.value.grammar,
        renderStyleConfig.value,
        layoutWidthLimit.value,
      );
      // Width/font invalidations still measure again, but an unchanged result
      // need not invalidate every node and connector downstream. Label fonts have
      // their own invalidation because their metrics are not part of ComputedLayout.
      if (!equalComputedLayout(publishedLayout, nextLayout)) {
        publishedLayout = nextLayout;
        layout.value = nextLayout;
      }
      layoutError.value = false;
      beginDiagramSettlement();
    } catch {
      publishedLayout = null;
      layout.value = null;
      layoutError.value = true;
    }
  });

  // Camera state from current diagram state
  let cameraPan = computed(() => currentState.value?.camera?.pan ?? null);
  let cameraFocusNodeId = computed(() => currentState.value?.camera?.focus ?? null);

  // Scroll container ref for focus scrolling
  let initialFitResolved = signal(false);
  function clearTransitionScene() {
    stateJustChanged.value = false;
    motionPhase.value = 'scene';
    holdSharedScene.value = false;
    retainDepartingScene.value = false;
    revealEnteringScene.value = true;
    enteringNodeIds.value = [];
    enteringGroupIds.value = [];
    enteringEdgeIds.value = [];
    departingNodes.value = [];
    departingGroups.value = [];
    departingEdges.value = [];
    departingLabelPositions.value = new Map();
    heldNodes.value = [];
    heldGroups.value = [];
    heldEdges.value = [];
    heldLabelPositions.value = new Map();
    presentedStateId.value = currentStateId.value;
  }

  // Reconcile only replacement identity or removed local steps. Parent onUpdate echoes
  // must not rewind a valid selection or interrupt its in-flight presentation.
  preEffects.push(() => {
    const id = diagram.value.id;
    const stateIds = diagram.value.states?.map((state) => state.id) ?? [];
    const incomingStateId = diagram.value.currentStateId;
    untracked(() => {
      // Initial selection retains the existing prop-seeding contract; only updates reconcile.
      if (previousDiagramId === undefined) {
        previousDiagramId = id;
        return;
      }
      const valid = (stateId: string | undefined) =>
        stateId === undefined ? stateIds.length === 0 : stateIds.includes(stateId);
      if (id === previousDiagramId && valid(currentStateId.value) && valid(presentedStateId.value))
        return;
      const keepSelection = id === previousDiagramId && valid(currentStateId.value);
      previousDiagramId = id;
      transitionRevision += 1;
      for (const animation of cameraAnimations) animation.cancel();
      cameraAnimations = [];
      cancelFitFrame();
      stopStepViewportTracking();
      movingEdgeIds.clear();
      if (!keepSelection) {
        currentStateId.value =
          stateIds.find((stateId) => stateId === incomingStateId) ?? stateIds[0];
      }
      clearTransitionScene();
      // Dispose the old keyed paint (including child-owned animations), not the renderer
      // or its controls. Ordinary navigation retains the shared-scene/camera path.
      layoutResizeRevision.value += 1;
    });
  });

  // Keep the available note lane separate from the content-sized presentation.
  // Only a lane resize interrupts motion; a step's own width change does not.
  effects.push(() => {
    if (!scrollContainerEl.value) return;
    const noteLane = scrollContainerEl.value.closest<HTMLElement>('.node-diagram_block');
    const resizeLane = noteLane ?? rendererEl.value ?? scrollContainerEl.value;
    let resizeLaneWidth = resizeLane.clientWidth;
    untracked(() => {
      noteLaneWidth.value = noteLane?.clientWidth ?? null;
      scrollContainerWidth.value = scrollContainerEl.value!.clientWidth;
      updateFitScale();
    });
    const observer = new ResizeObserver(() => {
      if (
        automaticallyFitState.value &&
        scrollContainerWidth.value !== null &&
        Math.abs(resizeLane.clientWidth - resizeLaneWidth) > 0.5
      ) {
        // Old scene coordinates no longer fit after a lane resize. Settle that interruption
        // immediately; ordinary step changes keep their existing motion schedule.
        resizing.value = true;
        stopStepViewportTracking();
        transitionRevision += 1;
        for (const animation of cameraAnimations) animation.cancel();
        cameraAnimations = [];
        movingEdgeIds.clear();
        clearTransitionScene();
      }
      resizeLaneWidth = resizeLane.clientWidth;
      noteLaneWidth.value = noteLane?.clientWidth ?? null;
      scrollContainerWidth.value = scrollContainerEl.value!.clientWidth;
      updateFitScale();
      flushView();
      if (resizing.value) {
        layoutResizeRevision.value += 1;
        flushView();
        for (const animation of activeFiniteAnimations()) animation.finish();
        if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          resizing.value = false;
          resizeFrame = undefined;
        });
      }
    });
    observer.observe(scrollContainerEl.value);
    if (resizeLane !== scrollContainerEl.value) observer.observe(resizeLane);
    return () => observer.disconnect();
  });

  // Apply camera transform (zoom + pan) to the diagram content
  let cameraTransformStyle = computed(() => {
    const panX = cameraPan.value?.x ?? 0;
    const panY = cameraPan.value?.y ?? 0;
    if (automaticallyFitState.value) {
      return `scale(${renderedScale.value}) translate(calc(-50% + ${panX / renderedScale.value}px), calc(-50% + ${panY / renderedScale.value}px))`;
    }
    const transforms: string[] = [];
    if (cameraPan.value) transforms.push(`translate(${panX}px, ${panY}px)`);
    if (renderedScale.value !== 1) {
      transforms.push(`scale(${renderedScale.value})`);
    }
    return transforms.length > 0 ? transforms.join(' ') : undefined;
  });

  // Focus on a specific node when camera.focus changes
  effects.push(() => {
    if (!cameraFocusNodeId.value || !layout.value || !scrollContainerEl.value) return;
    const focusNode = layout.value.nodes.find((n) => n.id === cameraFocusNodeId.value);
    if (!focusNode) return;

    // Calculate the node's center position relative to the SVG using visibleBounds
    // (which accounts for state-filtered visibility) instead of layout.bounds
    const bounds = visibleBounds.value ?? layout.value.bounds;
    const nodeCenterX = focusNode.x + focusNode.width / 2 - (bounds.minX - canvasPadding.value);
    const nodeCenterY = focusNode.y + focusNode.height / 2 - (bounds.minY - canvasPadding.value);

    // Apply zoom scaling
    const scaledX = nodeCenterX * cameraZoom.value;
    const scaledY = nodeCenterY * cameraZoom.value;

    // Scroll to center the node in the container
    const containerWidth = scrollContainerEl.value.clientWidth;
    const containerHeight = scrollContainerEl.value.clientHeight;

    // Account for cameraPan offset when scrolling
    const panX = cameraPan.value?.x ?? 0;
    const panY = cameraPan.value?.y ?? 0;
    scrollContainerEl.value.scrollTo({
      left: Math.max(0, scaledX + panX * cameraZoom.value - containerWidth / 2),
      top: Math.max(0, scaledY + panY * cameraZoom.value - containerHeight / 2),
      behavior: motionDuration(1) === 0 ? 'auto' : 'smooth',
    });
  });

  // Compute visible bounds when state filtering is active
  function measureSceneBounds(includeDeparting = true) {
    if (!layout.value) return null;
    if (!currentState.value) {
      let { minX, minY, maxX, maxY } = layout.value.bounds;
      for (const label of edgeLabelPositions.value.values()) {
        minX = Math.min(minX, label.x);
        minY = Math.min(minY, label.y);
        maxX = Math.max(maxX, label.x + label.width);
        maxY = Math.max(maxY, label.y + label.height);
      }
      return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }

    // Compute bounds from only visible elements
    // Keep outgoing paint in the camera bounds until its existing exit finishes.
    const nodes = includeDeparting
      ? [...visibleNodes.value, ...departingNodes.value, ...heldNodes.value]
      : visibleNodes.value;
    const edges = includeDeparting
      ? [...visibleEdges.value, ...departingEdges.value, ...heldEdges.value]
      : visibleEdges.value;
    const groups = includeDeparting
      ? [...visibleGroups.value, ...departingGroups.value, ...heldGroups.value]
      : visibleGroups.value;
    if (nodes.length === 0)
      return {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        width: 0,
        height: 0,
      };
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
      ...edgeLabelPositions.value.values(),
      ...(includeDeparting ? departingLabelPositions.value.values() : []),
      ...(includeDeparting ? heldLabelPositions.value.values() : []),
    ]) {
      minX = Math.min(minX, label.x);
      minY = Math.min(minY, label.y);
      maxX = Math.max(maxX, label.x + label.width);
      maxY = Math.max(maxY, label.y + label.height);
    }
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  // Keep both coordinate sets inside the SVG through exits and shared-node motion.
  // Clearing the retained scene restores active-scene-only fitting at rest.
  let visibleBounds = computed(() => measureSceneBounds(true));
  let svgWidth = computed(() => {
    if (!visibleBounds.value) return 800;
    return visibleBounds.value.width + canvasPadding.value * 2;
  });
  let svgHeight = computed(() => {
    if (!visibleBounds.value) return 600;
    return visibleBounds.value.height + canvasPadding.value * 2;
  });
  let contentWidth = computed(() => svgWidth.value * renderedScale.value);
  let intrinsicWidth = computed(
    () =>
      (layout.value ? svgWidth.value * cameraZoom.value * Math.max(1, readableScale.value) : 0) +
      16,
  );
  let contentHeight = computed(() => (svgHeight.value + 6) * renderedScale.value);
  let destinationFrameHeight = computed(() =>
    Math.ceil((svgHeight.value + 6) * renderedScale.value + 20),
  );
  let stateFrameHeight = computed(() => destinationFrameHeight.value);
  let drawingOverflows = computed(
    () =>
      automaticallyFitState.value &&
      ((windowHeight.value !== undefined &&
        stateFrameHeight.value > windowHeight.value * 0.9 + 1) ||
        (presentationWidth.value !== null &&
          contentWidth.value + 16 > presentationWidth.value + 1)),
  );
  function stopStepViewportTracking() {
    stepViewportActive.value = false;
    keepStepInView = undefined;
    restoreStepScroll?.();
    restoreStepScroll = undefined;
  }
  function startStepViewportTracking() {
    stopStepViewportTracking();
    if (!rendererEl.value) return;
    stepViewportActive.value = true;
    const renderer = rendererEl.value;
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
      window.addEventListener(type, stopFollowing, {
        capture: true,
        passive: true,
      });
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
        if (Math.abs(delta) > 0.5)
          ancestor.scrollBy({
            top: delta,
            behavior: 'instant',
          });
      }
    };
  }
  let svgTransform = computed(() => {
    if (!visibleBounds.value) return 'translate(0, 0)';
    return `translate(${-visibleBounds.value.minX + canvasPadding.value}px, ${-visibleBounds.value.minY + canvasPadding.value}px)`;
  });
  let svgTransformAttribute = computed(() => {
    if (!visibleBounds.value) return 'translate(0, 0)';
    return `translate(${-visibleBounds.value.minX + canvasPadding.value}, ${-visibleBounds.value.minY + canvasPadding.value})`;
  });
  function updateFitScale() {
    if ((!fitToWidth.value && !automaticallyFitState.value) || !scrollContainerEl.value) {
      fitScale.value = 1;
      return;
    }
    const availableWidth = Math.max(1, scrollContainerEl.value.clientWidth - 16);
    const layoutAvailableWidth = Math.max(
      1,
      (noteLaneWidth.value ?? scrollContainerEl.value.clientWidth) - 16,
    );
    // A stateful canvas follows its content. Its own height must not feed back into fitting.
    const availableHeight = automaticallyFitState.value
      ? Number.POSITIVE_INFINITY
      : Math.max(1, scrollContainerEl.value.clientHeight - 16);
    const renderedWidth = Math.max(1, svgWidth.value * cameraZoom.value);
    const renderedHeight = Math.max(1, svgHeight.value * cameraZoom.value);
    const verticalStateWidthFloor =
      automaticallyFitState.value &&
      layoutAvailableWidth >= 500 &&
      ['TB', 'BT'].includes(diagram.value.baseView.layout.direction ?? '')
        ? 500
        : 160;
    // Classify against fixed padding, not the compact padding selected by this width.
    // Otherwise widths near the breakpoint alternate between compact and regular layouts.
    uncompactedLayoutWidth.value = Math.max(
      verticalStateWidthFloor,
      layoutAvailableWidth / readableScale.value - PADDING * 2,
    );
    layoutWidthLimit.value = Math.max(
      verticalStateWidthFloor,
      layoutAvailableWidth / readableScale.value - canvasPadding.value * 2,
    );
    fitScale.value = Math.min(
      noteLaneWidth.value === null ? 1.25 : Math.max(1, readableScale.value),
      Math.max(
        readableScale.value,
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
    fitToWidth.value = !fitToWidth.value;
    updateFitScale();
    fitFrame = requestAnimationFrame(() => {
      fitFrame = undefined;
      updateFitScale();
      scrollContainerEl.value?.scrollTo({
        left: 0,
        top: 0,
        behavior: motionDuration(1) === 0 ? 'auto' : 'smooth',
      });
    });
  }
  effects.push(() => {
    void svgWidth.value;
    void svgHeight.value;
    void cameraZoom.value;
    if (fitToWidth.value || automaticallyFitState.value) updateFitScale();
  });
  effects.push(() => {
    if (initialFitResolved.value || !layout.value || !scrollContainerEl.value) return;
    const availableWidth = scrollContainerEl.value.clientWidth - 16;
    if (availableWidth <= 0) return;
    if (svgWidth.value * cameraZoom.value > availableWidth) {
      fitToWidth.value = true;
      updateFitScale();
    }
    initialFitResolved.value = true;
  });
  let previousViewResetKey = signal<string | undefined>();
  let viewResetInitialized = signal(false);
  effects.push(() => {
    const nextViewResetKey = viewResetKey.value;
    if (!viewResetInitialized.value) {
      previousViewResetKey.value = nextViewResetKey;
      viewResetInitialized.value = true;
      return;
    }
    if (nextViewResetKey === previousViewResetKey.value) return;
    previousViewResetKey.value = nextViewResetKey;
    cancelFitFrame();
    stopStepViewportTracking();
    fitToWidth.value = false;
    fitScale.value = 1;
    scrollContainerEl.value?.scrollTo({
      left: 0,
      top: 0,
      behavior: 'auto',
    });
  });

  // Handle state change
  function changeState(stateId: string) {
    if (stateId === currentStateId.value) return;
    startStepViewportTracking();
    const previousCameraStage = captureCameraStage();
    transitionRevision += 1;
    const revision = transitionRevision;
    const sourceNodes = renderedNodes.value;
    const sourceGroups = renderedGroups.value;
    const sourceEdges = renderedEdges.value;
    const sourceLabelPositions = new Map(renderedLabelPositions.value);
    const hasMotion = motionDuration(1) > 0;
    stateJustChanged.value = hasMotion;
    motionPhase.value = hasMotion ? 'camera' : 'scene';
    beginDiagramSettlement();
    if (hasMotion) {
      holdSharedScene.value = true;
      revealEnteringScene.value = false;
      retainDepartingScene.value = true;
      heldNodes.value = sourceNodes;
      heldGroups.value = sourceGroups;
      heldEdges.value = sourceEdges;
      heldLabelPositions.value = sourceLabelPositions;
      enteringNodeIds.value = diagram.value.model.nodes
        .map((node) => node.id)
        .filter((id) => !sourceNodes.some((node) => node.id === id));
      enteringGroupIds.value = (diagram.value.model.groups ?? [])
        .map((group) => group.id)
        .filter((id) => !sourceGroups.some((group) => group.id === id));
      enteringEdgeIds.value = diagram.value.model.edges
        .map((edge) => edge.id)
        .filter((id) => !sourceEdges.some((edge) => edge.id === id));
      departingNodes.value = sourceNodes;
      departingGroups.value = sourceGroups;
      departingEdges.value = sourceEdges;
      departingLabelPositions.value = sourceLabelPositions;
    }
    currentStateId.value = stateId;
    flushView();
    if (hasMotion) {
      const nodePartition = partitionSceneIds(
        sourceNodes.map((node) => node.id),
        visibleNodes.value.map((node) => node.id),
      );
      const groupPartition = partitionSceneIds(
        sourceGroups.map((group) => group.id),
        visibleGroups.value.map((group) => group.id),
      );
      const edgePartition = partitionSceneIds(
        sourceEdges.map((edge) => edge.id),
        visibleEdges.value.map((edge) => edge.id),
      );
      enteringNodeIds.value = nodePartition.entering;
      enteringGroupIds.value = groupPartition.entering;
      enteringEdgeIds.value = edgePartition.entering;
      heldNodes.value = sourceNodes.filter((node) => nodePartition.shared.includes(node.id));
      heldGroups.value = sourceGroups.filter((group) => groupPartition.shared.includes(group.id));
      heldEdges.value = sourceEdges.filter((edge) => edgePartition.shared.includes(edge.id));
      heldLabelPositions.value = new Map(
        [...sourceLabelPositions].filter(([edgeId]) => edgePartition.shared.includes(edgeId)),
      );
      departingNodes.value = sourceNodes.filter((node) =>
        nodePartition.departing.includes(node.id),
      );
      departingGroups.value = sourceGroups.filter((group) =>
        groupPartition.departing.includes(group.id),
      );
      departingEdges.value = sourceEdges.filter((edge) =>
        edgePartition.departing.includes(edge.id),
      );
      departingLabelPositions.value = new Map(
        [...sourceLabelPositions].filter(([edgeId]) => edgePartition.departing.includes(edgeId)),
      );
      flushView();
    } else {
      clearTransitionScene();
    }
    cameraAnimations = animateCameraStage(previousCameraStage);
    if (hasMotion) {
      if (cameraAnimations.length === 0) motionPhase.value = 'exit';
      void completeTransitionStages(revision, stateId, cameraAnimations);
    }

    // Notify parent so consumers (e.g. TipTap DiagramBlock) can persist the selected step
    onUpdate.value?.({
      currentStateId: stateId,
    });
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
    if (!editable.value || !onUpdate.value) return;
    const updatedNodes = diagram.value.model.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            position: {
              x,
              y,
            },
          }
        : n,
    );
    onUpdate.value({
      model: {
        ...diagram.value.model,
        nodes: updatedNodes,
      },
    });
  }
  return {
    diagram,
    editable,
    onBindingClick,
    resizing,
    layoutResizeRevision,
    motionDuration,
    layout,
    layoutError,
    fitToWidth,
    windowHeight,
    stepViewportActive,
    currentStateId,
    automaticallyFitState,
    usesCompactPresentation,
    renderStyleConfig,
    arrowTerminalGap,
    stateJustChanged,
    enteringEdgeIds,
    diagramSettled,
    motionPhase,
    CAMERA_MOTION_MS,
    CAMERA_MOTION_EASING,
    MOVE_EXIT_MS,
    EXIT_CONTENT_MS,
    EXIT_CONNECTION_MS,
    SCENE_ENTRY_MS,
    LABEL_ENTRY_DELAY_MS,
    LABEL_ENTRY_MS,
    hoveredNodeId,
    hoveredGroupId,
    connectedNodeIds,
    connectedEdgeIds,
    groupNodeIds,
    groupEdgeIds,
    highlightedNodeSet,
    highlightedEdgeSet,
    hasStateHighlighting,
    renderedNodes,
    renderedGroups,
    renderedEdges,
    renderedLabelPositions,
    cameraTransformStyle,
    svgWidth,
    svgHeight,
    contentWidth,
    intrinsicWidth,
    contentHeight,
    destinationFrameHeight,
    stateFrameHeight,
    drawingOverflows,
    svgTransform,
    svgTransformAttribute,
    toggleFitToWidth,
    changeState,
    handleEdgeMotion,
    handleNodeMove,
    revision,
    setHoveredGroup: (id: string | null) => {
      hoveredGroupId.value = id;
    },
    setHoveredNode: (id: string | null) => {
      hoveredNodeId.value = id;
    },
    setRenderer: (element: HTMLDivElement | null) => {
      rendererEl.value = element ?? undefined;
    },
    setScrollContainer: (element: HTMLDivElement | null) => {
      scrollContainerEl.value = element;
    },
    update: (next: DiagramRendererProps) =>
      batch(() => {
        inputs.value = next;
      }),
    mount() {
      const dispose = [
        ...preEffects.map((fn) => effect(fn)),
        ...effects.map((fn) => effect(fn)),
        ...mounts.map((fn) => fn()),
      ];
      const resizeWindow = () => {
        windowHeight.value = window.innerHeight;
      };
      resizeWindow();
      window.addEventListener('resize', resizeWindow);
      const stopMotion = onReducedMotionChange((reduced) => {
        if (!reduced) return;
        batch(() => {
          transitionRevision += 1;
          for (const animation of cameraAnimations) animation.cancel();
          cameraAnimations = [];
          movingEdgeIds.clear();
          stopStepViewportTracking();
          clearTransitionScene();
          layoutResizeRevision.value += 1;
          beginDiagramSettlement();
        });
      }, rendererEl.value?.ownerDocument);

      return () => {
        stopMotion();
        dispose.forEach((fn) => fn?.());
        destroys.forEach((fn) => fn());
        window.removeEventListener('resize', resizeWindow);
      };
    },
  };
}
