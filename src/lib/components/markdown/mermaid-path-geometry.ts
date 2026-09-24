import { flowchartClusterId, type FlowchartClusterMembership } from './mermaid-cluster-membership';

const ORTHOGONAL_CORNER_RADIUS = 6;
const FLOWCHART_PORT_SLOT_GAP = 16;
const FLOWCHART_FANOUT_PORT_GAP = 18;
const MAX_TERMINAL_CORRECTION = 4;
const COMPACT_ARROW_SIZE = 7;
const LABEL_TURN_CLEARANCE_CSS = 8;
const STATE_NODE_CLEARANCE_CSS = 8;

type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
type Segment = { start: Point; end: Point };
type CardinalSide = 'top' | 'right' | 'bottom' | 'left';

function boundsPort(bounds: Bounds, side: CardinalSide): Point {
  if (side === 'top') return pointAt(bounds, 0.5, 0);
  if (side === 'right') return pointAt(bounds, 1, 0.5);
  if (side === 'bottom') return pointAt(bounds, 0.5, 1);
  return pointAt(bounds, 0, 0.5);
}

export function chooseFlowchartFeedbackTargetX(target: Bounds, sameSidePorts: number[]) {
  const center = target.x + target.width / 2;
  const occupied = sameSidePorts.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (!occupied.some((port) => Math.abs(port - center) <= 1)) return center;

  const slotCount = occupied.length + 1;
  const gap = Math.min(FLOWCHART_PORT_SLOT_GAP, (target.width * 0.6) / (slotCount - 1));
  return center - (gap * (slotCount - 1)) / 2;
}

export function chooseFlowchartFeedbackInsideX(target: FlowchartRectBounds, ports: number[]) {
  const center = target.x + target.width / 2;
  if (!ports.some((x) => x < center) || !ports.some((x) => x > center)) return;
  if (ports.every((x) => Math.abs(x - center) >= FLOWCHART_PORT_SLOT_GAP)) return;
  const x = Math.min(...ports) - FLOWCHART_PORT_SLOT_GAP;
  const inset = Math.min(target.width / 2, target.corner?.x ?? 0);
  return x >= target.x + inset && x <= target.x + target.width - inset ? x : undefined;
}

function segmentCssScale(path: SVGGraphicsElement, start: Point, end: Point) {
  const matrix = path.getScreenCTM();
  const localLength = Math.hypot(end.x - start.x, end.y - start.y);
  if (!matrix || localLength <= 0) return 1;
  const screenStart = new DOMPoint(start.x, start.y).matrixTransform(matrix);
  const screenEnd = new DOMPoint(end.x, end.y).matrixTransform(matrix);
  return Math.hypot(screenEnd.x - screenStart.x, screenEnd.y - screenStart.y) / localLength || 1;
}

const CLUSTER_TITLE_INSET = 24;
const CLUSTER_TITLE_CONTENT_GAP = 32;

export function measuredClusterHeaderHeight(titleHeight: number) {
  return Math.ceil(Math.max(titleHeight, 18)) + CLUSTER_TITLE_INSET + CLUSTER_TITLE_CONTENT_GAP;
}

export function buildFlowchartDecisionBranchPoints(
  source: Bounds,
  target: Bounds,
  branch: 'upper' | 'lower',
  occupied: Bounds[],
  compact = false,
): Point[] {
  if (target.y >= source.y + source.height + 16) {
    const start = boundsPort(source, 'bottom');
    const end = boundsPort(target, 'top');
    const laneY = (start.y + end.y) / 2;
    const candidate = simplifyOrthogonalPoints([
      start,
      { x: start.x, y: laneY },
      { x: end.x, y: laneY },
      end,
    ]);
    const obstacles = occupied.filter(
      (bounds) =>
        ![source, target].some(
          (endpoint) =>
            Math.abs(bounds.x - endpoint.x) < 0.001 &&
            Math.abs(bounds.y - endpoint.y) < 0.001 &&
            Math.abs(bounds.width - endpoint.width) < 0.001 &&
            Math.abs(bounds.height - endpoint.height) < 0.001,
        ),
    );
    if (
      segments(candidate).every(
        (segment) => !obstacles.some((bounds) => segmentCrossesBounds(segment, bounds, 8)),
      )
    )
      return candidate;
  }
  const stackedTarget = branch === 'upper' && target.y >= source.y + source.height;
  const sourceSide = branch === 'upper' && !stackedTarget ? 'top' : 'right';
  if (compact && stackedTarget) {
    const sourcePort = boundsPort(source, 'bottom');
    const targetTop = boundsPort(target, 'top');
    const targetPort = {
      x: Math.max(target.x, Math.min(sourcePort.x, target.x + target.width)),
      y: targetTop.y,
    };
    const sameBounds = (left: Bounds, right: Bounds) =>
      Math.abs(left.x - right.x) < 0.001 &&
      Math.abs(left.y - right.y) < 0.001 &&
      Math.abs(left.width - right.width) < 0.001 &&
      Math.abs(left.height - right.height) < 0.001;
    const direct = { start: sourcePort, end: targetPort };
    const directIsClear =
      Math.abs(sourcePort.x - targetPort.x) < 0.001 &&
      !occupied.some(
        (bounds) =>
          !sameBounds(bounds, source) &&
          !sameBounds(bounds, target) &&
          segmentCrossesBounds(direct, bounds, STATE_NODE_CLEARANCE_CSS),
      );
    if (directIsClear) return [sourcePort, targetPort];
  }
  const targetSide: CardinalSide = stackedTarget
    ? 'right'
    : branch === 'upper'
      ? 'top'
      : target.x >= source.x + source.width
        ? 'left'
        : 'right';
  const sourcePort = boundsPort(source, sourceSide);
  const targetPort = boundsPort(target, targetSide);
  const clearance = compact ? 16 : 32;
  if (sourceSide === 'top') {
    const laneY = Math.min(...occupied.map((bounds) => bounds.y), target.y, source.y) - clearance;
    if (Math.abs(sourcePort.x - targetPort.x) < 0.001) {
      const laneX =
        Math.max(
          source.x + source.width,
          target.x + target.width,
          ...occupied.map((bounds) => bounds.x + bounds.width),
        ) + clearance;
      return simplifyOrthogonalPoints([
        sourcePort,
        { x: sourcePort.x, y: laneY },
        { x: laneX, y: laneY },
        { x: laneX, y: targetPort.y },
        targetPort,
      ]);
    }
    return simplifyOrthogonalPoints([
      sourcePort,
      { x: sourcePort.x, y: laneY },
      { x: targetPort.x, y: laneY },
      targetPort,
    ]);
  }
  if (
    targetSide === 'left' &&
    sourcePort.y >= target.y &&
    sourcePort.y <= target.y + target.height
  ) {
    return [sourcePort, { x: target.x, y: sourcePort.y }];
  }
  if (targetSide === 'left') {
    if (Math.abs(sourcePort.y - targetPort.y) < 0.001) return [sourcePort, targetPort];
    const laneX = (sourcePort.x + targetPort.x) / 2;
    return [sourcePort, { x: laneX, y: sourcePort.y }, { x: laneX, y: targetPort.y }, targetPort];
  }
  const laneX = Math.max(...occupied.map((bounds) => bounds.x + bounds.width)) + clearance * 2;
  return simplifyOrthogonalPoints([
    sourcePort,
    { x: laneX, y: sourcePort.y },
    { x: laneX, y: targetPort.y },
    targetPort,
  ]);
}

export function buildFlowchartDecisionReturnPoints(
  source: Bounds,
  target: Bounds,
  occupied: Bounds[],
  compact = false,
): Point[] {
  const sourcePort = boundsPort(source, 'bottom');
  const targetPort = boundsPort(target, compact ? 'left' : 'bottom');
  const clearance = compact ? 16 : 32;
  const laneY = Math.max(...occupied.map((bounds) => bounds.y + bounds.height)) + clearance;
  if (compact) {
    const laneX =
      Math.min(source.x, target.x, ...occupied.map((bounds) => bounds.x)) - clearance - 12;
    const leadY = sourcePort.y + 12;
    return simplifyOrthogonalPoints([
      sourcePort,
      { x: sourcePort.x, y: leadY },
      { x: laneX, y: leadY },
      { x: laneX, y: targetPort.y },
      targetPort,
    ]);
  }
  return simplifyOrthogonalPoints([
    sourcePort,
    { x: sourcePort.x, y: laneY },
    { x: targetPort.x, y: laneY },
    targetPort,
  ]);
}

export function buildFlowchartFeedbackLanePoints(
  source: Bounds,
  target: Bounds,
  occupied: Bounds[],
  compact = false,
): Point[] {
  const outerRight = compact
    ? source.x + source.width + 28
    : Math.max(...occupied.map((bounds) => bounds.x + bounds.width)) + 28;
  const outerLeft = Math.min(...occupied.map((bounds) => bounds.x)) - (compact ? 12 : 28);
  const outerBottom =
    Math.max(...occupied.map((bounds) => bounds.y + bounds.height)) + (compact ? 12 : 28);
  const sourceY = source.y + source.height / 2;
  const targetX = target.x + target.width / 2;
  return [
    { x: source.x + source.width, y: sourceY },
    { x: outerRight, y: sourceY },
    { x: outerRight, y: outerBottom },
    { x: outerLeft, y: outerBottom },
    { x: outerLeft, y: target.y + target.height + 12 },
    { x: targetX, y: target.y + target.height + 12 },
    { x: targetX, y: target.y + target.height + 0.25 },
  ];
}

export function buildGroupedReturnLanePoints(
  source: Bounds,
  target: Bounds,
  occupied: Bounds[],
  compact = false,
) {
  const laneX =
    Math.max(...occupied.map((bounds) => bounds.x + bounds.width)) + (compact ? 18 : 28);
  const sourceY = source.y + source.height / 2;
  const targetY = target.y + target.height / 2;
  return [
    { x: source.x + source.width, y: sourceY },
    { x: laneX, y: sourceY },
    { x: laneX, y: targetY },
    { x: target.x + target.width, y: targetY },
  ];
}

/** Keep the dedicated outer return outside corridors chosen by later repairs. */
export function expandFlowchartFeedbackLane(points: Point[], occupied: Bounds[]): Point[] {
  if (points.length !== 7 || points[3].x !== points[4].x || points[3].y <= points[4].y)
    return points;
  const left = Math.min(
    points[3].x,
    ...occupied
      .filter((bounds) => bounds.y < points[3].y && bounds.y + bounds.height > points[4].y)
      .map((bounds) => bounds.x - 20),
  );
  if (left === points[3].x) return points;
  return points.map((point, index) => (index === 3 || index === 4 ? { ...point, x: left } : point));
}

function boundsOverlap(left: Bounds, right: Bounds, padding = 4) {
  return (
    left.x < right.x + right.width + padding &&
    left.x + left.width + padding > right.x &&
    left.y < right.y + right.height + padding &&
    left.y + left.height + padding > right.y
  );
}

function segmentCrossesBounds(segment: Segment, bounds: Bounds, padding = 0) {
  const left = bounds.x - padding;
  const right = bounds.x + bounds.width + padding;
  const top = bounds.y - padding;
  const bottom = bounds.y + bounds.height + padding;
  if (Math.abs(segment.start.x - segment.end.x) < 0.001) {
    return (
      segment.start.x > left &&
      segment.start.x < right &&
      Math.max(segment.start.y, segment.end.y) > top &&
      Math.min(segment.start.y, segment.end.y) < bottom
    );
  }
  if (Math.abs(segment.start.y - segment.end.y) >= 0.001) return false;
  return (
    segment.start.y > top &&
    segment.start.y < bottom &&
    Math.max(segment.start.x, segment.end.x) > left &&
    Math.min(segment.start.x, segment.end.x) < right
  );
}

export function routeOrthogonalAroundObstacles(
  points: Point[],
  obstacles: Bounds[],
  clearance = STATE_NODE_CLEARANCE_CSS,
  occupied: Segment[] = [],
) {
  let routed = simplifyOrthogonalPoints(points);
  for (let pass = 0; pass < obstacles.length * 2 + 1; pass += 1) {
    let replacement: { index: number; points: Point[] } | undefined;
    for (let index = 0; index < routed.length - 1 && !replacement; index += 1) {
      const segment = { start: routed[index], end: routed[index + 1] };
      const obstacle = obstacles.find((bounds) => segmentCrossesBounds(segment, bounds, clearance));
      if (!obstacle) continue;
      const vertical = Math.abs(segment.start.x - segment.end.x) < 0.001;
      const forward = vertical
        ? segment.end.y >= segment.start.y
        : segment.end.x >= segment.start.x;
      const before = vertical
        ? forward
          ? obstacle.y - clearance
          : obstacle.y + obstacle.height + clearance
        : forward
          ? obstacle.x - clearance
          : obstacle.x + obstacle.width + clearance;
      const after = vertical
        ? forward
          ? obstacle.y + obstacle.height + clearance
          : obstacle.y - clearance
        : forward
          ? obstacle.x + obstacle.width + clearance
          : obstacle.x - clearance;
      const lanes = vertical
        ? [obstacle.x - clearance, obstacle.x + obstacle.width + clearance]
        : [obstacle.y - clearance, obstacle.y + obstacle.height + clearance];
      const candidates = lanes.map((lane) => {
        const detour = vertical
          ? [
              segment.start,
              { x: segment.start.x, y: before },
              { x: lane, y: before },
              { x: lane, y: after },
              { x: segment.end.x, y: after },
              segment.end,
            ]
          : [
              segment.start,
              { x: before, y: segment.start.y },
              { x: before, y: lane },
              { x: after, y: lane },
              { x: after, y: segment.end.y },
              segment.end,
            ];
        const candidateSegments = segments(simplifyOrthogonalPoints(detour));
        const collisions = candidateSegments.reduce(
          (count, candidate) =>
            count +
            obstacles.filter(
              (bounds) => bounds !== obstacle && segmentCrossesBounds(candidate, bounds, clearance),
            ).length,
          0,
        );
        const shared = candidateSegments.filter((candidate) =>
          occupied.some((other) => overlappingSegments(candidate, other)),
        ).length;
        const length = candidateSegments.reduce(
          (total, candidate) =>
            total +
            Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y),
          0,
        );
        return { detour, score: collisions * 1_000_000 + shared * 10_000 + length };
      });
      replacement = {
        index,
        points: candidates.toSorted((left, right) => left.score - right.score)[0].detour,
      };
    }
    if (!replacement) break;
    routed = simplifyOrthogonalPoints([
      ...routed.slice(0, replacement.index),
      ...replacement.points,
      ...routed.slice(replacement.index + 2),
    ]);
  }
  return routed;
}

const STATE_LABEL = {
  userSendsMessage: 'User sends message', // i18n-ignore -- Mermaid source label
  agentResponds: 'Agent responds', // i18n-ignore -- Mermaid source label
  toolStarts: 'Tool starts', // i18n-ignore -- Mermaid source label
  toolCompletes: 'Tool completes', // i18n-ignore -- Mermaid source label
  agentAsksUser: 'Agent asks user', // i18n-ignore -- Mermaid source label
  userReplies: 'User replies', // i18n-ignore -- Mermaid source label
  agentFinishes: 'Agent finishes', // i18n-ignore -- Mermaid source label
  requestFails: 'Request fails', // i18n-ignore -- Mermaid source label
  streamFails: 'Stream fails', // i18n-ignore -- Mermaid source label
  userRetries: 'User retries', // i18n-ignore -- Mermaid source label
} as const;

const STATE_ROUTE_NODES = {
  [STATE_LABEL.userSendsMessage]: ['Idle', 'Starting'],
  [STATE_LABEL.agentResponds]: ['Starting', 'Streaming'],
  [STATE_LABEL.toolStarts]: ['Streaming', 'RunningTool'],
  [STATE_LABEL.toolCompletes]: ['RunningTool', 'Streaming'],
  [STATE_LABEL.agentAsksUser]: ['Streaming', 'NeedsInput'],
  [STATE_LABEL.userReplies]: ['NeedsInput', 'Streaming'],
  [STATE_LABEL.agentFinishes]: ['Streaming', 'Complete'],
  [STATE_LABEL.requestFails]: ['Starting', 'Failed'],
  [STATE_LABEL.streamFails]: ['Streaming', 'Failed'],
  [STATE_LABEL.userRetries]: ['Failed', 'Starting'],
} as const;

/** The identity fields returned by Mermaid's parsed StateDB.getData(), before rendering. */
export type StateDiagramRoutingData = {
  direction: string;
  nodes: {
    id: string;
    domId?: string;
    shape: string;
    isGroup?: boolean;
    parentId?: string;
  }[];
  edges: { id: string; start: string; end: string; label?: string }[];
};

/** Copy Mermaid's state identities before the next parse clears its shared database. */
export function snapshotStateDiagramRoutingData(
  data: StateDiagramRoutingData,
): StateDiagramRoutingData {
  return {
    direction: data.direction,
    nodes: data.nodes.map(({ id, domId, shape, isGroup, parentId }) => ({
      id,
      domId,
      shape,
      isGroup,
      parentId,
    })),
    edges: data.edges.map(({ id, start, end, label }) => ({ id, start, end, label })),
  };
}

export function replacePathTerminal(pathData: string, terminal: Point): string | null {
  const numberPattern = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?';
  const match = pathData.match(
    new RegExp(`(${numberPattern})([\\s,]+)(${numberPattern})\\s*$`, 'i'),
  );
  if (!match || match.index === undefined) return null;
  const replaced = `${pathData.slice(0, match.index)}${terminal.x}${match[2]}${terminal.y}`;
  const terminalLine = replaced.match(
    new RegExp(`L\\s*(${numberPattern})[\\s,]+(${numberPattern})\\s*$`, 'i'),
  );
  if (!terminalLine || terminalLine.index === undefined) return replaced;
  const prior = replaced
    .slice(0, terminalLine.index)
    .match(new RegExp(`(${numberPattern})[\\s,]+(${numberPattern})\\s*$`, 'i'));
  if (!prior) return replaced;
  return Math.hypot(Number(prior[1]) - terminal.x, Number(prior[2]) - terminal.y) < 0.001
    ? replaced.slice(0, terminalLine.index).trimEnd()
    : replaced;
}

function boundsInPathSpace(element: SVGGraphicsElement, path: SVGGraphicsElement): Bounds | null {
  const elementMatrix = element.getScreenCTM();
  const pathMatrix = path.getScreenCTM();
  if (!elementMatrix || !pathMatrix) return null;
  const inversePathMatrix = pathMatrix.inverse();
  const bounds = element.getBBox();
  const corners = [
    new DOMPoint(bounds.x, bounds.y),
    new DOMPoint(bounds.x + bounds.width, bounds.y),
    new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height),
    new DOMPoint(bounds.x, bounds.y + bounds.height),
  ].map((point) => point.matrixTransform(elementMatrix).matrixTransform(inversePathMatrix));
  const left = Math.min(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const right = Math.max(...corners.map((point) => point.x));
  const bottom = Math.max(...corners.map((point) => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clientBoundsInPathSpace(element: SVGGraphicsElement, path: SVGPathElement): Bounds | null {
  const pathMatrix = path.getScreenCTM();
  if (!pathMatrix) return boundsInPathSpace(element, path);
  const inversePathMatrix = pathMatrix.inverse();
  const bounds = element.getBoundingClientRect();
  const corners = [
    new DOMPoint(bounds.left, bounds.top),
    new DOMPoint(bounds.right, bounds.top),
    new DOMPoint(bounds.right, bounds.bottom),
    new DOMPoint(bounds.left, bounds.bottom),
  ].map((point) => point.matrixTransform(inversePathMatrix));
  const left = Math.min(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const right = Math.max(...corners.map((point) => point.x));
  const bottom = Math.max(...corners.map((point) => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function rayBoundsEntry(
  origin: Point,
  direction: Point,
  bounds: Bounds,
  edgeTolerance = 0,
): Point | null {
  let near = Number.NEGATIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;
  for (const [position, delta, minimum, maximum] of [
    [origin.x, direction.x, bounds.x, bounds.x + bounds.width],
    [origin.y, direction.y, bounds.y, bounds.y + bounds.height],
  ]) {
    if (Math.abs(delta) < 0.0001) {
      if (position < minimum - edgeTolerance || position > maximum + edgeTolerance) return null;
      continue;
    }
    const first = (minimum - position) / delta;
    const second = (maximum - position) / delta;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
  }
  if (near < 0 || near > far) return null;
  return { x: origin.x + direction.x * near, y: origin.y + direction.y * near };
}

function distanceToBounds(point: Point, bounds: Bounds) {
  return Math.hypot(
    Math.max(bounds.x - point.x, 0, point.x - bounds.x - bounds.width),
    Math.max(bounds.y - point.y, 0, point.y - bounds.y - bounds.height),
  );
}

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const progress = lengthSquared
    ? Math.max(
        0,
        Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
      )
    : 0;
  return Math.hypot(point.x - start.x - dx * progress, point.y - start.y - dy * progress);
}

function cylinderBoundary(bounds: Bounds, shape: SVGGraphicsElement) {
  const ratio = Number.parseFloat(shape.dataset.cylinderRimRatio ?? '0.14');
  const rim = Math.max(1, Math.min(bounds.height / 2, bounds.height * ratio));
  const centerX = bounds.x + bounds.width / 2;
  const radiusX = bounds.width / 2;
  const points: Point[] = [];
  for (let index = 0; index <= 32; index += 1) {
    const angle = Math.PI + (Math.PI * index) / 32;
    points.push({
      x: centerX + Math.cos(angle) * radiusX,
      y: bounds.y + rim + Math.sin(angle) * rim,
    });
  }
  points.push({ x: bounds.x + bounds.width, y: bounds.y + bounds.height - rim });
  for (let index = 0; index <= 32; index += 1) {
    const angle = (Math.PI * index) / 32;
    points.push({
      x: centerX + Math.cos(angle) * radiusX,
      y: bounds.y + bounds.height - rim + Math.sin(angle) * rim,
    });
  }
  points.push({ x: bounds.x, y: bounds.y + rim });
  return points;
}

function isDiamondShape(shape: SVGGraphicsElement) {
  if (shape.tagName.toLowerCase() !== 'polygon') return false;
  const coordinates = shape
    .getAttribute('points')
    ?.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)
    ?.map(Number);
  return coordinates?.length === 8;
}

function diamondBoundary(bounds: Bounds): Point[] {
  const center = pointAt(bounds, 0.5, 0.5);
  return [
    { x: center.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: center.y },
    { x: center.x, y: bounds.y + bounds.height },
    { x: bounds.x, y: center.y },
  ];
}

export function diamondRayIntersection(origin: Point, direction: Point, bounds: Bounds) {
  const cross = (left: Point, right: Point) => left.x * right.y - left.y * right.x;
  const boundary = diamondBoundary(bounds);
  return boundary
    .map((start, index) => ({ start, end: boundary[(index + 1) % boundary.length] }))
    .flatMap(({ start, end }) => {
      const side = { x: end.x - start.x, y: end.y - start.y };
      const denominator = cross(direction, side);
      if (Math.abs(denominator) < 0.0001) return [];
      const offset = { x: start.x - origin.x, y: start.y - origin.y };
      const rayProgress = cross(offset, side) / denominator;
      const sideProgress = cross(offset, direction) / denominator;
      return rayProgress >= 0 && sideProgress >= 0 && sideProgress <= 1
        ? [
            {
              point: {
                x: origin.x + direction.x * rayProgress,
                y: origin.y + direction.y * rayProgress,
              },
              rayProgress,
            },
          ]
        : [];
    })
    .toSorted((left, right) => left.rayProgress - right.rayProgress)[0]?.point;
}

function distanceToShape(point: Point, bounds: Bounds, shape: SVGGraphicsElement) {
  if (
    shape.tagName.toLowerCase() === 'rect' &&
    shape.closest('svg')?.classList.contains('statediagram')
  ) {
    const matrix = shape.getScreenCTM();
    const style = getComputedStyle(shape);
    const local = shape.getBBox();
    const radius = (value: string) =>
      /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? Number.parseFloat(value) : NaN;
    const rx = radius(style.rx === 'auto' ? style.ry : style.rx);
    const ry = radius(style.ry === 'auto' ? style.rx : style.ry);
    if (matrix && Math.abs(matrix.b) < 1e-8 && Math.abs(matrix.c) < 1e-8) {
      const screenRx = Math.min(local.width / 2, rx) * Math.abs(matrix.a);
      const screenRy = Math.min(local.height / 2, ry) * Math.abs(matrix.d);
      if (screenRx > 0 && Math.abs(screenRx - screenRy) < 1e-6) {
        // Only circular, axis-aligned state corners are supported here. Other
        // shapes and elliptical/skewed corners retain their existing behavior.
        const dx = Math.abs(point.x - bounds.x - bounds.width / 2) - (bounds.width / 2 - screenRx);
        const dy =
          Math.abs(point.y - bounds.y - bounds.height / 2) - (bounds.height / 2 - screenRx);
        return Math.max(0, Math.hypot(Math.max(0, dx), Math.max(0, dy)) - screenRx);
      }
    }
  }
  const boundary = isDiamondShape(shape)
    ? diamondBoundary(bounds)
    : shape.dataset.diagramCylinder === 'true'
      ? cylinderBoundary(bounds, shape)
      : null;
  if (!boundary) return distanceToBounds(point, bounds);
  return Math.min(
    ...boundary.map((start, index) =>
      distanceToSegment(point, start, boundary[(index + 1) % boundary.length]),
    ),
  );
}

function rayShapeEntry(
  origin: Point,
  direction: Point,
  bounds: Bounds,
  shape: SVGGraphicsElement,
  edgeTolerance = 0,
) {
  const boundsEntry = rayBoundsEntry(origin, direction, bounds, edgeTolerance);
  if (!boundsEntry) return null;
  if (isDiamondShape(shape))
    return diamondRayIntersection(origin, direction, bounds) ?? boundsEntry;
  if (shape.dataset.diagramCylinder !== 'true') return boundsEntry;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  let near = Math.hypot(boundsEntry.x - origin.x, boundsEntry.y - origin.y);
  let far = (center.x - origin.x) * direction.x + (center.y - origin.y) * direction.y;
  const ratio = Number.parseFloat(shape.dataset.cylinderRimRatio ?? '0.14');
  const rim = Math.max(1, Math.min(bounds.height / 2, bounds.height * ratio));
  const inside = (distance: number) => {
    const point = { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
    if (point.y >= bounds.y + rim && point.y <= bounds.y + bounds.height - rim) {
      return point.x >= bounds.x && point.x <= bounds.x + bounds.width;
    }
    const capY = point.y < bounds.y + rim ? bounds.y + rim : bounds.y + bounds.height - rim;
    const normalizedX = (point.x - center.x) / (bounds.width / 2);
    const normalizedY = (point.y - capY) / rim;
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  };
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const middle = (near + far) / 2;
    if (inside(middle)) far = middle;
    else near = middle;
  }
  return { x: origin.x + direction.x * far, y: origin.y + direction.y * far };
}

export function attachStateTerminalArrowheads(svg: SVGSVGElement) {
  if (!svg.classList.contains('statediagram')) return;
  const targets = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
    const shape = node.querySelector<SVGGraphicsElement>(
      ':scope > .label-container, :scope > rect, :scope > circle, :scope > ellipse, :scope > polygon',
    );
    return shape ? [{ node, shape }] : [];
  });

  for (const path of svg.querySelectorAll<SVGPathElement>(
    '.edgePaths path[marker-end], path.transition[data-edge="true"][marker-end]',
  )) {
    const length = path.getTotalLength();
    if (length < 0.25) continue;
    const terminal = path.getPointAtLength(length);
    const tangentPoint = path.getPointAtLength(Math.max(0, length - 0.1));
    const storedDirection = (path.dataset.terminalDirection ?? '').split(',').map(Number);
    const directionVector =
      storedDirection.length === 2 && storedDirection.every(Number.isFinite)
        ? { x: storedDirection[0], y: storedDirection[1] }
        : { x: terminal.x - tangentPoint.x, y: terminal.y - tangentPoint.y };
    const tangentLength = Math.hypot(directionVector.x, directionVector.y);
    if (tangentLength < 0.0001) continue;
    const direction = {
      x: directionVector.x / tangentLength,
      y: directionVector.y / tangentLength,
    };
    const origin = { x: terminal.x - direction.x * 256, y: terminal.y - direction.y * 256 };
    const knownTarget = path.dataset.terminalTarget;
    const candidates = targets.flatMap(({ node, shape }) => {
      const rawBounds = clientBoundsInPathSpace(shape, path);
      if (!rawBounds) return [];
      const bounds = rawBounds;
      const intersection = rayBoundsEntry(origin, direction, bounds, 0.5);
      if (!intersection) return [];
      const correction = Math.hypot(intersection.x - terminal.x, intersection.y - terminal.y);
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const pointsInward =
        direction.x * (center.x - intersection.x) + direction.y * (center.y - intersection.y) > 0;
      return pointsInward && (node.id === knownTarget || correction <= MAX_TERMINAL_CORRECTION)
        ? [{ node, intersection, correction }]
        : [];
    });
    const target = candidates.sort((left, right) => left.correction - right.correction)[0];
    if (!target) continue;
    const repaired = replacePathTerminal(path.getAttribute('d') ?? '', target.intersection);
    if (!repaired) continue;
    path.setAttribute('d', repaired);
    path.dataset.terminalTarget = target.node.id;
    path.dataset.terminalDirection = `${direction.x},${direction.y}`;
  }
}

function markerForPath(svg: SVGSVGElement, path: SVGPathElement) {
  const reference = path.getAttribute('marker-end') ?? '';
  const markerId = reference.match(/#([^)'"]+)/)?.[1];
  return markerId
    ? svg.querySelector<SVGMarkerElement>(`marker[id="${CSS.escape(markerId)}"]`)
    : null;
}

/** Keep the visible chevron tip exactly `cssGap` screen pixels before its target boundary. */
export function applyMermaidTerminalGaps(svg: SVGSVGElement, cssGap = 5) {
  const targets = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
    const shape = shapeForNode(node);
    return shape ? [{ node, shape }] : [];
  });

  for (const path of svg.querySelectorAll<SVGPathElement>(
    '.edgePaths path[marker-end], .edges.edgePath path[marker-end]',
  )) {
    if (markerForPath(svg, path)?.dataset.diagramChevron !== 'true') continue;
    const basePath = path.dataset.terminalGapBasePath ?? path.getAttribute('d');
    if (!basePath) continue;
    path.dataset.terminalGapBasePath = basePath;
    path.setAttribute('d', basePath);
    const length = path.getTotalLength();
    if (length < 0.25) continue;
    const terminal = path.getPointAtLength(length);
    const tangentPoint = path.getPointAtLength(Math.max(0, length - 0.1));
    const matrix = path.getScreenCTM();
    if (!matrix) continue;
    const terminalScreen = new DOMPoint(terminal.x, terminal.y).matrixTransform(matrix);
    const logicalPoints = (path.dataset.manhattanPoints ?? '')
      .trim()
      .split(/\s+/)
      .map((point) => point.split(',').map(Number))
      .filter((point) => point.length === 2 && point.every(Number.isFinite))
      .map(([x, y]) => ({ x, y }));
    const logicalTangent = logicalPoints.at(-2) ?? tangentPoint;
    const logicalTerminal = logicalPoints.at(-1) ?? terminal;
    const storedDirection = (path.dataset.terminalDirection ?? '').split(',').map(Number);
    const localDirection =
      logicalPoints.length >= 2
        ? { x: logicalTerminal.x - logicalTangent.x, y: logicalTerminal.y - logicalTangent.y }
        : storedDirection.length === 2 && storedDirection.every(Number.isFinite)
          ? { x: storedDirection[0], y: storedDirection[1] }
          : { x: terminal.x - tangentPoint.x, y: terminal.y - tangentPoint.y };
    const screenOrigin = new DOMPoint(0, 0).matrixTransform(matrix);
    const screenVectorEnd = new DOMPoint(localDirection.x, localDirection.y).matrixTransform(
      matrix,
    );
    const screenLength = Math.hypot(
      screenVectorEnd.x - screenOrigin.x,
      screenVectorEnd.y - screenOrigin.y,
    );
    if (screenLength <= 0) continue;
    const screenDirection = {
      x: (screenVectorEnd.x - screenOrigin.x) / screenLength,
      y: (screenVectorEnd.y - screenOrigin.y) / screenLength,
    };
    const identity = flowchartEdgeIdentity(path);
    const targetId = path.dataset.terminalTarget ?? identity?.target;
    const origin = {
      x: terminalScreen.x - screenDirection.x * 256,
      y: terminalScreen.y - screenDirection.y * 256,
    };
    const candidates = targets.flatMap(({ node, shape }) => {
      if (targetId && node.id !== targetId && flowchartNodeId(node) !== targetId) return [];
      const clientBounds = shape.getBoundingClientRect();
      const bounds = {
        x: clientBounds.left,
        y: clientBounds.top,
        width: clientBounds.width,
        height: clientBounds.height,
      };
      const intersection = rayShapeEntry(
        origin,
        screenDirection,
        bounds,
        shape,
        svg.classList.contains('statediagram') ? 0.5 : 0,
      );
      if (!intersection) return [];
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const pointsInward =
        screenDirection.x * (center.x - intersection.x) +
          screenDirection.y * (center.y - intersection.y) >
        0;
      const correction = Math.hypot(
        intersection.x - terminalScreen.x,
        intersection.y - terminalScreen.y,
      );
      return pointsInward && (targetId || correction <= 12)
        ? [{ node, shape, bounds, intersection, correction }]
        : [];
    });
    const target = candidates.sort((left, right) => left.correction - right.correction)[0];
    if (!target) continue;
    const markerPath = markerForPath(svg, path)?.querySelector<SVGPathElement>('path');
    const markerStrokeWidth = Number.parseFloat(
      markerPath ? getComputedStyle(markerPath).strokeWidth : '0',
    );
    const centerlineGap = cssGap + (Number.isFinite(markerStrokeWidth) ? markerStrokeWidth / 2 : 0);
    let near = 0;
    let far = centerlineGap;
    const screenPoint = (distance: number) => ({
      x: target.intersection.x - screenDirection.x * distance,
      y: target.intersection.y - screenDirection.y * distance,
    });
    while (
      distanceToShape(screenPoint(far), target.bounds, target.shape) < centerlineGap &&
      far < 256
    )
      far *= 2;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const middle = (near + far) / 2;
      if (distanceToShape(screenPoint(middle), target.bounds, target.shape) < centerlineGap)
        near = middle;
      else far = middle;
    }
    const terminalScreenPoint = screenPoint(far);
    const terminalPoint = new DOMPoint(
      terminalScreenPoint.x,
      terminalScreenPoint.y,
    ).matrixTransform(matrix.inverse());
    const tangentScreenPoint = screenPoint(far + 1);
    const tangentTerminalPoint = new DOMPoint(
      tangentScreenPoint.x,
      tangentScreenPoint.y,
    ).matrixTransform(matrix.inverse());
    const repaired = replacePathTerminal(path.getAttribute('d') ?? '', tangentTerminalPoint);
    if (!repaired) continue;
    path.setAttribute('d', `${repaired} L ${terminalPoint.x} ${terminalPoint.y}`);
    path.dataset.terminalTarget = target.node.id;
    path.dataset.terminalGapCss = String(cssGap);
  }
}

function parseOrthogonalLinePath(pathData: string, minimumPoints: 2 | 3 = 3): Point[] | null {
  const numberPattern = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?';
  const tokens = pathData.match(new RegExp(`[ML]|${numberPattern}`, 'gi'));
  const residue = pathData.replace(new RegExp(`[ML]|${numberPattern}|[\\s,]`, 'gi'), '').trim();
  if (!tokens || residue) return null;

  const points: Point[] = [];
  let command = '';
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^[ML]$/i.test(token)) {
      command = token.toUpperCase();
      continue;
    }
    const yToken = tokens[index + 1];
    if (!command || !yToken || /^[ML]$/i.test(yToken)) return null;
    points.push({ x: Number(token), y: Number(yToken) });
    index += 1;
    command = 'L';
  }
  if (points.length < minimumPoints) return null;
  return points.slice(1).every((point, index) => {
    const previous = points[index];
    return Math.abs(point.x - previous.x) < 0.001 || Math.abs(point.y - previous.y) < 0.001;
  })
    ? points
    : null;
}

export function simplifyOrthogonalPoints(points: Point[]): Point[] {
  const distinct = points.filter(
    (point, index) =>
      !index || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) >= 0.001,
  );
  const simplified: Point[] = [];
  for (const point of distinct) {
    const previous = simplified.at(-1);
    const beforePrevious = simplified.at(-2);
    if (
      previous &&
      beforePrevious &&
      ((Math.abs(beforePrevious.x - previous.x) < 0.001 &&
        Math.abs(previous.x - point.x) < 0.001) ||
        (Math.abs(beforePrevious.y - previous.y) < 0.001 && Math.abs(previous.y - point.y) < 0.001))
    ) {
      simplified[simplified.length - 1] = point;
    } else {
      simplified.push(point);
    }
  }
  return simplified;
}

export function buildRoundedOrthogonalPath(
  points: Point[],
  cornerRadius = ORTHOGONAL_CORNER_RADIUS,
): string {
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    const cross =
      (corner.x - previous.x) * (next.y - corner.y) - (corner.y - previous.y) * (next.x - corner.x);
    const radius = Math.min(cornerRadius, incoming / 2, outgoing / 2);
    if (radius <= 0 || Math.abs(cross) < 0.001) {
      commands.push(`L ${corner.x} ${corner.y}`);
      continue;
    }
    const beforeX = corner.x - ((corner.x - previous.x) / incoming) * radius;
    const beforeY = corner.y - ((corner.y - previous.y) / incoming) * radius;
    const afterX = corner.x + ((next.x - corner.x) / outgoing) * radius;
    const afterY = corner.y + ((next.y - corner.y) / outgoing) * radius;
    commands.push(`L ${beforeX} ${beforeY}`, `Q ${corner.x} ${corner.y} ${afterX} ${afterY}`);
  }
  const endpoint = points[points.length - 1];
  commands.push(`L ${endpoint.x} ${endpoint.y}`);
  return commands.join(' ');
}

export function roundOrthogonalBends(svg: SVGSVGElement) {
  for (const path of svg.querySelectorAll<SVGPathElement>(
    '.flowchart-link, .edgePaths path, path.relation, path.transition[data-edge="true"]',
  )) {
    const points = parseOrthogonalLinePath(path.getAttribute('d') ?? '');
    if (!points) continue;
    const simplified = simplifyOrthogonalPoints(points);
    path.dataset.manhattanPoints ??= simplified.map((point) => `${point.x},${point.y}`).join(' ');
    const rounded = buildRoundedOrthogonalPath(simplified);
    if (!path.dataset.feedbackLane) {
      path.dataset.manhattanSegments = String(Math.max(0, simplified.length - 1));
    }
    if (!rounded.includes(' Q ')) continue;
    path.setAttribute('d', rounded);
    path.dataset.cornerRadius = String(ORTHOGONAL_CORNER_RADIUS);
  }
}

function shapeForNode(node: SVGGElement) {
  return node.querySelector<SVGGraphicsElement>(
    ':scope > .label-container, :scope > rect, :scope > circle, :scope > ellipse, :scope > .outer-path, :scope > .basic.label-container, :scope > polygon',
  );
}

export function refineMermaidCylinderNodes(svg: SVGSVGElement) {
  for (const node of svg.querySelectorAll<SVGGElement>('g.node')) {
    const shape = node.querySelector<SVGPathElement>(
      ':scope > path.basic.label-container.outer-path[label-offset-y]',
    );
    if (!shape || shape.dataset.diagramCylinder === 'true') continue;
    const bounds = shape.getBBox();
    const label = node.querySelector<SVGGElement>(':scope > .label')?.getBBox();
    const height = Math.max(bounds.height, 68);
    const width = Math.max(bounds.width, height * 1.45, (label?.width ?? 0) + 32);
    const radiusX = width / 2;
    const radiusY = Math.min(8, height * 0.14);
    const top = -height / 2;
    const bottom = height / 2;
    shape.setAttribute(
      'd',
      `M ${-radiusX} ${top + radiusY} A ${radiusX} ${radiusY} 0 0 1 ${radiusX} ${top + radiusY} L ${radiusX} ${bottom - radiusY} A ${radiusX} ${radiusY} 0 0 1 ${-radiusX} ${bottom - radiusY} Z`,
    );
    shape.removeAttribute('transform');
    shape.dataset.diagramCylinder = 'true';
    shape.dataset.cylinderRimRatio = String(radiusY / height);
    const rim = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    rim.setAttribute(
      'd',
      `M ${-radiusX} ${top + radiusY} A ${radiusX} ${radiusY} 0 0 1 ${radiusX} ${top + radiusY} A ${radiusX} ${radiusY} 0 0 1 ${-radiusX} ${top + radiusY} Z`,
    );
    rim.setAttribute('class', 'diagram-cylinder-rim');
    rim.setAttribute('aria-hidden', 'true');
    rim.setAttribute('focusable', 'false');
    shape.after(rim);
  }
}

export function repairFlowchartNodeOutlines(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  for (const node of svg.querySelectorAll<SVGGElement>('g.node')) {
    node.querySelector(':scope > .flowchart-node-outline')?.remove();
    const shape = shapeForNode(node);
    if (!shape) continue;
    const outline = shape.cloneNode(false) as SVGGraphicsElement;
    outline.removeAttribute('id');
    outline.classList.add('flowchart-node-outline');
    outline.setAttribute('aria-hidden', 'true');
    outline.setAttribute('focusable', 'false');
    // Authored inline !important fills survive cloning and otherwise cover labels.
    outline.style.setProperty('fill', 'none', 'important');
    node.append(outline);
  }
}

export function repairEntityDividers(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'er') return;
  for (const node of svg.querySelectorAll<SVGGElement>('g.node')) {
    node
      .querySelectorAll(':scope > .er-negative-space-divider')
      .forEach((divider) => divider.remove());
    const rows = [
      ...node.querySelectorAll<SVGGElement>(':scope > .row-rect-odd, :scope > .row-rect-even'),
    ].map((row) => row.getBBox());
    if (!rows.length) continue;
    const originalDividers = [...node.querySelectorAll<SVGGElement>(':scope > .divider')];
    const verticalDividers = originalDividers
      .map((divider) => divider.getBBox())
      .filter((bounds) => bounds.height > bounds.width)
      .toSorted((left, right) => right.x - left.x);
    originalDividers.forEach((divider) => divider.remove());
    const left = Math.min(...rows.map((row) => row.x));
    const right = Math.max(...rows.map((row) => row.x + row.width));
    const bottom = Math.max(...rows.map((row) => row.y + row.height));
    const addDivider = (kind: 'row' | 'key', start: Point, end: Point) => {
      const divider = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      divider.classList.add('er-negative-space-divider');
      divider.dataset.dividerKind = kind;
      divider.setAttribute('x1', String(start.x));
      divider.setAttribute('y1', String(start.y));
      divider.setAttribute('x2', String(end.x));
      divider.setAttribute('y2', String(end.y));
      divider.setAttribute('aria-hidden', 'true');
      node.insertBefore(divider, node.querySelector(':scope > .label'));
    };
    for (const y of rows.map((row) => row.y)) {
      addDivider('row', { x: left, y }, { x: right, y });
    }
    const hasKeys = [...node.querySelectorAll<SVGGElement>(':scope > .label.attribute-keys')].some(
      (label) => Boolean(label.textContent?.trim()),
    );
    const keyBoundary = verticalDividers[0];
    if (hasKeys && keyBoundary) {
      const x = keyBoundary.x + keyBoundary.width / 2;
      addDivider('key', { x, y: rows[0].y }, { x, y: bottom });
    }
  }
}

export function alignMermaidOpenArrowheads(svg: SVGSVGElement) {
  for (const marker of svg.querySelectorAll<SVGMarkerElement>('marker')) {
    const markerPath = marker.querySelector<SVGPathElement>('path');
    const sharedMarker = marker.id.endsWith('-arrowhead');
    const endMarker =
      marker.id.includes('pointEnd') || marker.id.includes('barbEnd') || sharedMarker;
    const startMarker = marker.id.includes('pointStart');
    if (!markerPath || (!endMarker && !startMarker)) continue;
    marker.setAttribute('viewBox', `0 0 ${COMPACT_ARROW_SIZE} ${COMPACT_ARROW_SIZE}`);
    marker.setAttribute('markerWidth', String(COMPACT_ARROW_SIZE));
    marker.setAttribute('markerHeight', String(COMPACT_ARROW_SIZE));
    marker.setAttribute('refX', endMarker ? '6.5' : '0.5');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', sharedMarker ? 'auto-start-reverse' : 'auto');
    marker.setAttribute('markerUnits', 'userSpaceOnUse');
    marker.dataset.diagramChevron = 'true';
    markerPath.setAttribute(
      'd',
      endMarker ? 'M 3.5 0.5 L 6.5 3.5 L 3.5 6.5' : 'M 3.5 0.5 L 0.5 3.5 L 3.5 6.5',
    );
    markerPath.setAttribute('fill', 'none');
    markerPath.setAttribute('stroke', 'context-stroke');
    markerPath.setAttribute('stroke-width', '1');
    markerPath.setAttribute('stroke-linecap', 'round');
    markerPath.setAttribute('stroke-linejoin', 'round');
    markerPath.setAttribute('vector-effect', 'non-scaling-stroke');
  }
}

function flowchartEdgeIdentity(path: SVGPathElement) {
  const match = path.id.match(/-L_([^_]+)_([^_]+)_\d+$/);
  return match ? { source: match[1], target: match[2] } : null;
}

function flowchartLabelForPath(svg: SVGSVGElement, path: SVGPathElement) {
  const edgeId = path.id.match(/-(L_.+)$/)?.[1];
  if (!edgeId) return;
  return [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')].find(
    (label) => label.querySelector(':scope > .label')?.getAttribute('data-id') === edgeId,
  );
}

function flowchartNode(svg: SVGSVGElement, id: string) {
  return [...svg.querySelectorAll<SVGGElement>('g.node')].find(
    (node) => flowchartNodeId(node) === id,
  );
}

export function routeFlowchartClientRequestLane(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return false;
  const path = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].find((candidate) => {
    const identity = flowchartEdgeIdentity(candidate);
    return identity?.source === 'Client' && identity.target === 'Gateway';
  });
  const clientNode = flowchartNode(svg, 'Client');
  const gatewayNode = flowchartNode(svg, 'Gateway');
  const queueNode = flowchartNode(svg, 'Queue');
  const enqueuePath = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].find(
    (candidate) => {
      const identity = flowchartEdgeIdentity(candidate);
      return identity?.source === 'Gateway' && identity.target === 'Queue';
    },
  );
  const label = path && flowchartLabelForPath(svg, path);
  let client = clientNode && flowchartNodeBounds(clientNode);
  const gateway = gatewayNode && flowchartNodeBounds(gatewayNode);
  const queue = queueNode && flowchartNodeBounds(queueNode);
  const labelBounds = path && label && clientBoundsInPathSpace(label, path);
  if (!path || !clientNode || !client || !gateway || !label || !labelBounds) return false;

  const gatewayCenter = pointAt(gateway, 0.5, 0.5);
  const boundary = [...svg.querySelectorAll<SVGRectElement>('g.cluster > rect')]
    .flatMap((rect) => {
      const bounds = clientBoundsInPathSpace(rect, path);
      return bounds ? [bounds] : [];
    })
    .filter(
      (bounds) =>
        gatewayCenter.x > bounds.x &&
        gatewayCenter.x < bounds.x + bounds.width &&
        gatewayCenter.y > bounds.y &&
        gatewayCenter.y < bounds.y + bounds.height,
    )
    .toSorted((left, right) => right.width * right.height - left.width * left.height)[0];
  if (!boundary) return false;

  const desiredGap = Math.max(52, labelBounds.height + 24);
  const currentGap = boundary.y - (client.y + client.height);
  const shift = Math.max(0, desiredGap - currentGap);
  const matrix = clientNode.transform.baseVal.consolidate()?.matrix;
  if (matrix && shift > 0) {
    clientNode.setAttribute('transform', `translate(${matrix.e}, ${matrix.f - shift})`);
    clientNode.dataset.requestLaneRaised = 'true';
    clientNode.dataset.requestLaneShift = String(
      Number(clientNode.dataset.requestLaneShift ?? 0) + shift,
    );
    client = { ...client, y: client.y - shift };
  }

  const sourcePort = pointAt(client, 0.5, 1);
  const targetPort = pointAt(gateway, 0, 0.35);
  const laneY = (sourcePort.y + boundary.y) / 2;
  const laneX = boundary.x - Math.max(20, labelBounds.height / 2 + 4);
  const points = [
    sourcePort,
    { x: sourcePort.x, y: laneY },
    { x: laneX, y: laneY },
    { x: laneX, y: targetPort.y },
    targetPort,
  ];
  path.setAttribute(
    'd',
    points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
  );
  path.dataset.clientRequestLane = 'downward';
  path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
  placeFlowchartLabelOnRoute(label, path, points, 1);
  const enqueueLabel = enqueuePath && flowchartLabelForPath(svg, enqueuePath);
  if (enqueuePath && enqueueLabel && queue) {
    const enqueueSource = pointAt(gateway, 0, 0.65);
    const enqueueTarget = pointAt(queue, 0, 0.5);
    const enqueueLaneX = boundary.x + 12;
    const enqueuePoints = [
      enqueueSource,
      { x: enqueueLaneX, y: enqueueSource.y },
      { x: enqueueLaneX, y: enqueueTarget.y },
      enqueueTarget,
    ];
    enqueuePath.setAttribute(
      'd',
      enqueuePoints.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
    );
    enqueuePath.dataset.clientRequestLane = 'enqueue';
    enqueuePath.dataset.manhattanPoints = enqueuePoints
      .map((point) => `${point.x},${point.y}`)
      .join(' ');
    placeFlowchartLabelOnRoute(enqueueLabel, enqueuePath, enqueuePoints, 1);
  }
  routeGroupedReturnEdgesWithTarget(svg, 'Client', client);
  return true;
}

/** Smallest outward move, preferring a side on which the outsider already lies. */
export function clusterOutsiderShift(frame: Bounds, content: Bounds, outside: Bounds): Point {
  if (!boundsOverlap(frame, outside, 12)) return { x: 0, y: 0 };
  const candidates = [
    {
      x: frame.x - outside.x - outside.width - 12,
      y: 0,
      clear: outside.x + outside.width <= content.x,
    },
    {
      x: frame.x + frame.width - outside.x + 12,
      y: 0,
      clear: outside.x >= content.x + content.width,
    },
    {
      x: 0,
      y: frame.y - outside.y - outside.height - 12,
      clear: outside.y + outside.height <= content.y,
    },
    {
      x: 0,
      y: frame.y + frame.height - outside.y + 12,
      clear: outside.y >= content.y + content.height,
    },
  ];
  const { x, y } = candidates.toSorted(
    (left, right) =>
      Number(right.clear) - Number(left.clear) ||
      Math.hypot(left.x, left.y) - Math.hypot(right.x, right.y),
  )[0];
  return { x, y };
}

function unionClusterBounds(bounds: Bounds[]): Bounds {
  const x = Math.min(...bounds.map((box) => box.x));
  const y = Math.min(...bounds.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...bounds.map((box) => box.x + box.width)) - x,
    height: Math.max(...bounds.map((box) => box.y + box.height)) - y,
  };
}

function translateInClusterSpace(
  element: SVGGraphicsElement,
  reference: SVGGraphicsElement,
  delta: Point,
) {
  const parent = (element.parentElement as SVGGraphicsElement | null)?.getScreenCTM();
  const matrix = reference.getScreenCTM();
  if (!parent || !matrix) return;
  const origin = new DOMPoint(0, 0).matrixTransform(matrix).matrixTransform(parent.inverse());
  const target = new DOMPoint(delta.x, delta.y)
    .matrixTransform(matrix)
    .matrixTransform(parent.inverse());
  const previous = element.getAttribute('transform') ?? '';
  element.setAttribute(
    'transform',
    `translate(${target.x - origin.x}, ${target.y - origin.y}) ${previous}`,
  );
}

export function reserveFlowchartClusterHeaderBands(
  svg: SVGSVGElement,
  membership?: FlowchartClusterMembership,
) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  const records = [...svg.querySelectorAll<SVGGElement>('g.cluster')].flatMap((cluster) => {
    const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
    const label = cluster.querySelector<SVGGElement>(':scope > g.cluster-label');
    if (!rect || !label) return [];
    const id = membership && flowchartClusterId(cluster, membership);
    const memberIds = id ? membership?.get(id) : undefined;
    // A semantic snapshot is authoritative, including an empty group.
    if (membership && !memberIds) return [];
    const frame = rect.getBBox();
    const members = nodes.filter((node) => {
      if (memberIds) return memberIds.has(flowchartNodeId(node));
      const bounds = flowchartNodeBounds(node);
      if (!bounds) return false;
      const center = pointAt(bounds, 0.5, 0.5);
      return (
        center.x >= frame.x &&
        center.x <= frame.x + frame.width &&
        center.y >= frame.y &&
        center.y <= frame.y + frame.height
      );
    });
    return [{ cluster, rect, label, frame, members, id, memberIds }];
  });
  // Retarget only paths whose node/frame actually changes. Preserve the original
  // side, topology and markers, including edges whose endpoint is a subgraph.
  const routes = membership
    ? [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].flatMap((path) => {
        const identity = flowchartEdgeIdentity(path);
        // Straight connectors need terminal updates too when an endpoint moves.
        const points = parseOrthogonalLinePath(path.getAttribute('d') ?? '', 2);
        if (!identity || !points) return [];
        const endpoint = (id: string) => {
          const node = flowchartNode(svg, id);
          const shape =
            (node && shapeForNode(node)) ?? records.find((record) => record.id === id)?.rect;
          const bounds = shape && boundsInPathSpace(shape, path);
          return shape && bounds ? { shape, bounds } : null;
        };
        return [
          { path, points, source: endpoint(identity.source), target: endpoint(identity.target) },
        ];
      })
    : [];
  const layouts = new Map<SVGGElement, Bounds>();
  for (const record of records.toSorted(
    (left, right) =>
      (left.memberIds?.size ?? 0) - (right.memberIds?.size ?? 0) ||
      left.frame.width * left.frame.height - right.frame.width * right.frame.height,
  )) {
    const childFrames = records
      .filter(
        (candidate) =>
          candidate !== record &&
          (record.memberIds
            ? Boolean(candidate.id && record.memberIds.has(candidate.id))
            : candidate.frame.x >= record.frame.x &&
              candidate.frame.y >= record.frame.y &&
              candidate.frame.x + candidate.frame.width <= record.frame.x + record.frame.width &&
              candidate.frame.y + candidate.frame.height <= record.frame.y + record.frame.height),
      )
      .flatMap(({ cluster, rect }) => {
        const bounds = membership ? boundsInPathSpace(rect, record.cluster) : layouts.get(cluster);
        return bounds ? [bounds] : [];
      });
    const memberFrames = record.members.flatMap((node) => {
      const shape = shapeForNode(node);
      const bounds =
        membership && shape ? boundsInPathSpace(shape, record.cluster) : flowchartNodeBounds(node);
      return bounds ? [bounds] : [];
    });
    const content = [...memberFrames, ...childFrames];
    if (!content.length) continue;
    const viewport = record.label.querySelector<SVGForeignObjectElement>('foreignObject');
    const titleContent = viewport?.querySelector<HTMLElement>('div');
    const contentBounds = unionClusterBounds(content);
    const outside = membership
      ? nodes
          .filter((node) => !record.members.includes(node))
          .flatMap((node) => {
            const shape = shapeForNode(node);
            const bounds = shape && boundsInPathSpace(shape, record.cluster);
            return bounds ? [bounds] : [];
          })
      : [];
    let titleHeight = Math.ceil(
      Math.max(
        titleContent?.getBoundingClientRect().height ?? 0,
        titleContent?.scrollHeight ?? 0,
        record.label.getBBox().height,
        18,
      ),
    );
    let headerHeight = measuredClusterHeaderHeight(titleHeight);
    const minContentX = Math.min(...content.map(({ x }) => x));
    const maxContentX = Math.max(...content.map(({ x, width }) => x + width));
    const minContentY = Math.min(...content.map(({ y }) => y));
    const maxContentY = Math.max(...content.map(({ y, height }) => y + height));
    let x = Math.min(record.frame.x, minContentX - CLUSTER_TITLE_INSET);
    let y = Math.min(record.frame.y, minContentY - headerHeight);
    let right = Math.max(record.frame.x + record.frame.width, maxContentX + CLUSTER_TITLE_INSET);
    let bottom = Math.max(record.frame.y + record.frame.height, maxContentY + 20);
    if (
      membership &&
      outside.some((box) => boundsOverlap({ x, y, width: right - x, height: bottom - y }, box, 12))
    ) {
      // Mermaid can widen a frame for its title after placing nodes. Rebuild the
      // unsafe allocation from semantic members, never from captured outsiders.
      x = minContentX - CLUSTER_TITLE_INSET;
      right = maxContentX + CLUSTER_TITLE_INSET;
      bottom = maxContentY + 20;
      if (viewport && titleContent) {
        const measurement = viewport.cloneNode(true) as SVGForeignObjectElement;
        const text = measurement.querySelector<HTMLElement>('div')!;
        measurement.style.visibility = 'hidden';
        measurement.setAttribute('height', '1');
        measurement.setAttribute('width', String(right - x - CLUSTER_TITLE_INSET * 2));
        text.style.setProperty('height', 'auto', 'important');
        text.style.setProperty('width', '100%', 'important');
        record.label.append(measurement);
        try {
          const width = Math.max(contentBounds.width, text.scrollWidth);
          right = x + width + CLUSTER_TITLE_INSET * 2;
          measurement.setAttribute('width', String(width));
          titleHeight = Math.ceil(Math.max(18, text.scrollHeight));
        } finally {
          measurement.remove();
        }
      } else {
        right = Math.max(right, x + record.label.getBBox().width + CLUSTER_TITLE_INSET * 2);
      }
      headerHeight = measuredClusterHeaderHeight(titleHeight);
      y = minContentY - headerHeight;
    }
    const frame = { x, y, width: right - x, height: bottom - y };
    record.rect.setAttribute('x', String(frame.x));
    record.rect.setAttribute('y', String(frame.y));
    record.rect.setAttribute('width', String(frame.width));
    record.rect.setAttribute('height', String(frame.height));
    record.cluster.dataset.headerHeight = String(headerHeight);
    if (viewport) {
      viewport.setAttribute('x', '0');
      viewport.setAttribute('y', '0');
      viewport.setAttribute('width', String(Math.max(24, frame.width - CLUSTER_TITLE_INSET * 2)));
      viewport.setAttribute('height', String(titleHeight));
      record.label.setAttribute(
        'transform',
        `translate(${frame.x + CLUSTER_TITLE_INSET}, ${frame.y + CLUSTER_TITLE_INSET})`,
      );
    } else {
      const title = record.label.getBBox();
      record.label.setAttribute(
        'transform',
        `translate(${frame.x + frame.width / 2 - title.x - title.width / 2}, ${frame.y + CLUSTER_TITLE_INSET - title.y})`,
      );
    }
    layouts.set(record.cluster, frame);
    if (!membership) continue;
    // Move exterior groups atomically. Moving the whole outward half-plane also
    // preserves gaps to their neighbours instead of introducing a new collision.
    const unrelated = records.filter(
      (candidate) =>
        candidate !== record &&
        candidate.id &&
        record.id &&
        !record.memberIds?.has(candidate.id) &&
        !candidate.memberIds?.has(record.id),
    );
    const roots = unrelated.filter(
      (candidate) =>
        !unrelated.some(
          (parent) => parent !== candidate && candidate.id && parent.memberIds?.has(candidate.id),
        ),
    );
    const units: SVGGraphicsElement[][] = roots.map((root) => [
      root.cluster,
      ...root.members,
      ...records
        .filter((child) => child.id && root.memberIds?.has(child.id))
        .map((child) => child.cluster),
    ]);
    units.push(
      ...nodes
        .filter(
          (node) =>
            !record.members.includes(node) && !roots.some((root) => root.members.includes(node)),
        )
        .map((node) => [node]),
    );
    for (const unit of units) {
      const measure = (elements: SVGGraphicsElement[]) => {
        const boxes = elements.flatMap((element) => {
          const shape = element.matches('g.node')
            ? shapeForNode(element as SVGGElement)
            : element.querySelector<SVGRectElement>(':scope > rect');
          const bounds = shape && boundsInPathSpace(shape, record.cluster);
          return bounds ? [bounds] : [];
        });
        return boxes.length ? unionClusterBounds(boxes) : null;
      };
      const box = measure(unit);
      if (!box) continue;
      const delta = clusterOutsiderShift(frame, contentBounds, box);
      if (!delta.x && !delta.y) continue;
      const axis = delta.x ? 'x' : 'y';
      const extent = delta.x ? 'width' : 'height';
      const moving = units
        .filter((candidate) => {
          const bounds = measure(candidate);
          return (
            bounds &&
            (delta[axis] > 0
              ? bounds[axis] + bounds[extent] > box[axis]
              : bounds[axis] < box[axis] + box[extent])
          );
        })
        .flat();
      for (const element of new Set(moving)) {
        if (!moving.some((parent) => parent !== element && parent.contains(element)))
          translateInClusterSpace(element, record.cluster, delta);
      }
    }
  }
  for (const { path, points, source, target } of routes) {
    let changed = false;
    const terminal = (endpoint: typeof source, point: Point) => {
      const next = endpoint && boundsInPathSpace(endpoint.shape, path);
      if (!endpoint || !next) return point;
      const previous = endpoint.bounds;
      if (
        (['x', 'y', 'width', 'height'] as const).every(
          (key) => Math.abs(next[key] - previous[key]) < 0.001,
        )
      )
        return point;
      changed = true;
      return {
        x: next.x + ((point.x - previous.x) * next.width) / (previous.width || 1),
        y: next.y + ((point.y - previous.y) * next.height) / (previous.height || 1),
      };
    };
    const start = terminal(source, points[0]);
    const end = terminal(target, points[points.length - 1]);
    if (!changed) continue;
    const adjusted = snapOrthogonalTerminals(
      points,
      start,
      end,
      Math.abs(points[1].x - points[0].x) < 0.001,
    );
    path.setAttribute(
      'd',
      adjusted.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
    );
    path.dataset.manhattanPoints = adjusted.map((point) => `${point.x},${point.y}`).join(' ');
  }
}

export function routeFlowchartFeedbackLane(svg: SVGSVGElement, force = false) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const edges = paths.flatMap((path) => {
    const identity = flowchartEdgeIdentity(path);
    return identity ? [{ path, ...identity }] : [];
  });
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const edge of edges.filter(({ source, target }) => source !== target)) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
  }
  const feedback = edges.find(
    (edge) =>
      edge.source !== edge.target &&
      (inDegree.get(edge.source) ?? 0) >= 2 &&
      (outDegree.get(edge.source) ?? 0) === 1 &&
      (outDegree.get(edge.target) ?? 0) >= 2,
  );
  if (!feedback) return;
  if (!force && feedback.path.dataset.feedbackLane === 'outer') return feedback.path.getBBox();
  const sourceNode = flowchartNode(svg, feedback.source);
  const targetNode = flowchartNode(svg, feedback.target);
  const sourceShape = sourceNode && shapeForNode(sourceNode);
  const targetShape = targetNode && shapeForNode(targetNode);
  if (!sourceShape || !targetShape) return;
  const source = sourceNode && flowchartNodeBounds(sourceNode);
  const target = targetNode && flowchartNodeBounds(targetNode);
  const nodeBounds = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
    const bounds = flowchartNodeBounds(node);
    return bounds ? [bounds] : [];
  });
  if (!source || !target || !nodeBounds.length) return;
  const otherPathBounds = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')]
    .filter((path) => path !== feedback.path)
    .map((path) => path.getBBox());
  const compact = feedback.path.dataset.compactFlowchart === 'true';
  const points = buildFlowchartFeedbackLanePoints(
    source,
    target,
    compact ? nodeBounds : [...nodeBounds, ...otherPathBounds],
    compact,
  );
  feedback.path.setAttribute(
    'd',
    points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
  );
  feedback.path.dataset.feedbackLane = 'outer';
  feedback.path.dataset.feedbackSource = feedback.source;
  feedback.path.dataset.feedbackTarget = feedback.target;
  feedback.path.dataset.manhattanSegments = '4';
  feedback.path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
}

function routeGroupedReturnEdgesWithTarget(
  svg: SVGSVGElement,
  overrideTargetId?: string,
  overrideTarget?: Bounds,
) {
  if (
    svg.getAttribute('aria-roledescription') !== 'flowchart-v2' ||
    !svg.querySelector('g.cluster')
  )
    return;
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
  paths.forEach((path, index) => {
    if (path.dataset.nestedDecisionRoute) return;
    const identity = flowchartEdgeIdentity(path);
    const sourceOutdegree = identity
      ? paths.filter((candidate) => flowchartEdgeIdentity(candidate)?.source === identity.source)
          .length
      : 0;
    const sourceNode = identity && flowchartNode(svg, identity.source);
    const targetNode = identity && flowchartNode(svg, identity.target);
    const source = sourceNode && boundsInPathSpace(sourceNode, path);
    const target =
      identity?.target === overrideTargetId
        ? overrideTarget
        : targetNode && clientBoundsInPathSpace(targetNode, path);
    if (!identity || !source || !target || sourceOutdegree > 1 || target.y >= source.y) return;
    const occupied = [
      ...[...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
        const bounds = boundsInPathSpace(node, path);
        return bounds ? [bounds] : [];
      }),
      ...[...svg.querySelectorAll<SVGRectElement>('g.cluster > rect')].flatMap((rect) => {
        const bounds = boundsInPathSpace(rect, path);
        return bounds ? [bounds] : [];
      }),
    ];
    const points = buildGroupedReturnLanePoints(
      source,
      target,
      occupied,
      path.dataset.compactFlowchart === 'true',
    );
    path.setAttribute(
      'd',
      points.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${point.x},${point.y}`).join(''),
    );
    path.dataset.groupedReturnLane = 'right';
    path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
    const label = labels[index];
    if (!label) return;
    const midpoint = {
      x: points[1].x,
      y: (points[1].y + points[2].y) / 2,
    };
    const local = label.getBBox();
    const pathMatrix = path.getCTM();
    const labelParentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getCTM();
    const center =
      pathMatrix && labelParentMatrix
        ? new DOMPoint(midpoint.x, midpoint.y)
            .matrixTransform(pathMatrix)
            .matrixTransform(labelParentMatrix.inverse())
        : midpoint;
    label.setAttribute(
      'transform',
      `translate(${center.x - local.x - local.width / 2}, ${center.y - local.y - local.height / 2})`,
    );
    label.dataset.finalPathCenter = `${midpoint.x},${midpoint.y}`;
  });
}

export function routeGroupedReturnEdges(svg: SVGSVGElement) {
  routeGroupedReturnEdgesWithTarget(svg);
}

export function snapFlowchartFeedbackPorts(svg: SVGSVGElement) {
  const path = svg.querySelector<SVGPathElement>('path[data-feedback-lane="outer"]');
  const source = path?.dataset.feedbackSource && flowchartNode(svg, path.dataset.feedbackSource);
  const target = path?.dataset.feedbackTarget && flowchartNode(svg, path.dataset.feedbackTarget);
  const matrix = path?.getScreenCTM();
  const points = (path?.dataset.manhattanPoints ?? '')
    .split(' ')
    .map((point) => point.split(',').map(Number))
    .filter((point) => point.length === 2 && point.every(Number.isFinite))
    .map(([x, y]) => ({ x, y }));
  if (!path || !source || !target || !matrix || points.length < 4) return;
  const inverse = matrix.inverse();
  const sourceBounds = source.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  const targetId = path.dataset.feedbackTarget;
  const sameSidePorts = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].flatMap(
    (candidate) => {
      if (candidate === path) return [];
      const identity = flowchartEdgeIdentity(candidate);
      const route = (candidate.dataset.manhattanPoints ?? '')
        .trim()
        .split(/\s+/)
        .map((point) => point.split(',').map(Number))
        .filter((point) => point.length === 2 && point.every(Number.isFinite))
        .map(([x, y]) => ({ x, y }));
      const candidateMatrix = candidate.getScreenCTM();
      if (!identity || !candidateMatrix || route.length < 2) return [];
      const terminalIndex =
        identity.source === targetId ? 0 : identity.target === targetId ? -1 : null;
      if (terminalIndex === null) return [];
      const terminal = route[terminalIndex === 0 ? 0 : route.length - 1];
      const neighbor = route[terminalIndex === 0 ? 1 : route.length - 2];
      const screenTerminal = new DOMPoint(terminal.x, terminal.y).matrixTransform(candidateMatrix);
      const screenNeighbor = new DOMPoint(neighbor.x, neighbor.y).matrixTransform(candidateMatrix);
      if (
        Math.abs(screenTerminal.y - targetBounds.bottom) > 1 ||
        Math.abs(screenTerminal.x - screenNeighbor.x) > 1
      )
        return [];
      return [screenTerminal.matrixTransform(inverse).x];
    },
  );
  const targetLeft = new DOMPoint(targetBounds.left, targetBounds.bottom).matrixTransform(
    inverse,
  ).x;
  const targetRight = new DOMPoint(targetBounds.right, targetBounds.bottom).matrixTransform(
    inverse,
  ).x;
  let targetX = chooseFlowchartFeedbackTargetX(
    {
      x: Math.min(targetLeft, targetRight),
      y: 0,
      width: Math.abs(targetRight - targetLeft),
      height: 0,
    },
    sameSidePorts,
  );
  const targetCenterX = (targetLeft + targetRight) / 2;
  const sourcePort = new DOMPoint(
    sourceBounds.right,
    sourceBounds.top + sourceBounds.height / 2,
  ).matrixTransform(inverse);
  const targetShape = shapeForNode(target);
  const targetLocal = targetShape && boundsInPathSpace(targetShape, path);
  const radius = targetShape ? getComputedStyle(targetShape).rx : '0';
  const localWidth = targetShape?.getBBox().width ?? 0;
  const insideX =
    targetLocal && localWidth && points.at(-2)!.y > targetLocal.y + targetLocal.height
      ? chooseFlowchartFeedbackInsideX(
          {
            ...targetLocal,
            corner: {
              x:
                (Number.parseFloat(radius) || 0) *
                (radius.endsWith('%') ? targetLocal.width / 100 : targetLocal.width / localWidth),
              y: 0,
            },
          },
          sameSidePorts,
        )
      : undefined;
  const insideTail =
    insideX === undefined
      ? []
      : [
          { ...points[points.length - 3] },
          { x: insideX, y: points[points.length - 2].y },
          {
            x: insideX,
            y: new DOMPoint(targetBounds.left, targetBounds.bottom).matrixTransform(inverse).y,
          },
        ];
  const insideObstacles = [...svg.querySelectorAll<SVGGElement>('g.node')]
    .filter((node) => node !== target)
    .flatMap((node) => {
      const bounds = boundsInPathSpace(node, path);
      return bounds ? [bounds] : [];
    });
  const ownLabel = flowchartLabelForPath(svg, path);
  const insideLabels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
    .filter((label) => label !== ownLabel && label.textContent?.trim())
    .flatMap((label) => {
      const bounds = clientBoundsInPathSpace(label, path);
      return bounds ? [bounds] : [];
    });
  const insideOccupied = measuredFlowchartRoutes(svg)
    .filter((route) => route.path !== path)
    .flatMap((route) => {
      const routeMatrix = route.path.getScreenCTM();
      return routeMatrix
        ? segments(
            route.points.map(({ x, y }) =>
              new DOMPoint(x, y).matrixTransform(routeMatrix).matrixTransform(inverse),
            ),
          )
        : [];
    });
  const clearInside =
    insideTail.length > 0 &&
    segments(insideTail).every(
      (segment) =>
        !insideObstacles.some((bounds) => segmentCrossesBounds(segment, bounds, 8)) &&
        !insideLabels.some((bounds) => segmentCrossesBounds(segment, bounds, 4)) &&
        !insideOccupied.some(({ start, end }) =>
          segmentCrossesBounds(
            segment,
            {
              x: Math.min(start.x, end.x),
              y: Math.min(start.y, end.y),
              width: Math.abs(end.x - start.x),
              height: Math.abs(end.y - start.y),
            },
            6,
          ),
        ),
    );
  if (clearInside) targetX = insideX!;
  if (!clearInside && Math.abs(targetX - targetCenterX) > 1 && points.length >= 7) {
    const targetPort = new DOMPoint(
      targetBounds.left + targetBounds.width / 2,
      targetBounds.top - 0.25,
    ).matrixTransform(inverse);
    const targetLead = new DOMPoint(
      targetBounds.left + targetBounds.width / 2,
      targetBounds.top - 12,
    ).matrixTransform(inverse);
    points[0] = { x: sourcePort.x, y: sourcePort.y };
    points[1].y = sourcePort.y;
    points[4] = { x: points[3].x, y: targetLead.y };
    points[5] = { x: targetLead.x, y: targetLead.y };
    points[6] = { x: targetPort.x, y: targetPort.y };
    path.dataset.feedbackTargetSide = 'top';
    path.dataset.manhattanPoints = points.map(({ x, y }) => `${x},${y}`).join(' ');
    path.setAttribute(
      'd',
      points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join(''),
    );
    placeFlowchartLabelOnRoute(flowchartLabelForPath(svg, path), path, points);
    return;
  }
  const targetPort = new DOMPoint(
    targetBounds.left + targetBounds.width / 2,
    targetBounds.bottom + 0.25,
  ).matrixTransform(inverse);
  targetPort.x = targetX;
  points[0] = { x: sourcePort.x, y: sourcePort.y };
  points[1].y = sourcePort.y;
  points[points.length - 2].x = targetPort.x;
  points[points.length - 1] = { x: targetPort.x, y: targetPort.y };
  path.dataset.feedbackTargetSide = 'bottom';
  path.dataset.manhattanPoints = points.map(({ x, y }) => `${x},${y}`).join(' ');
  path.setAttribute(
    'd',
    points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join(''),
  );
  placeFlowchartLabelOnRoute(flowchartLabelForPath(svg, path), path, points);
}

export function snapFlowchartFanoutPorts(svg: SVGSVGElement) {
  const edges = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].flatMap((path) => {
    if (
      path.dataset.clusterHeaderClearance ||
      path.dataset.nestedDecisionRoute ||
      path.dataset.decisionCycleRoute
    )
      return [];
    const identity = flowchartEdgeIdentity(path);
    const points = (path.dataset.manhattanPoints ?? '')
      .trim()
      .split(/\s+/)
      .map((point) => point.split(',').map(Number))
      .filter((point) => point.length === 2 && point.every(Number.isFinite))
      .map(([x, y]) => ({ x, y }));
    return identity && points.length >= 2 ? [{ path, points, ...identity }] : [];
  });
  const bySource = new Map<string, typeof edges>();
  for (const edge of edges) bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge]);
  for (const [sourceId, branches] of bySource) {
    const sourceNode = branches.length >= 2 && flowchartNode(svg, sourceId);
    const source = sourceNode && flowchartNodeBounds(sourceNode);
    if (!source) continue;
    const vertical = branches.filter(({ points }) => Math.abs(points[0].x - points[1].x) < 0.001);
    if (vertical.length < 2) continue;
    const ordered = vertical.toSorted((left, right) => {
      const leftTarget = flowchartNode(svg, left.target);
      const rightTarget = flowchartNode(svg, right.target);
      const leftBounds = leftTarget && flowchartNodeBounds(leftTarget);
      const rightBounds = rightTarget && flowchartNodeBounds(rightTarget);
      return (
        (leftBounds?.x ?? 0) +
          (leftBounds?.width ?? 0) / 2 -
          ((rightBounds?.x ?? 0) + (rightBounds?.width ?? 0) / 2) ||
        (leftBounds?.y ?? 0) +
          (leftBounds?.height ?? 0) / 2 -
          ((rightBounds?.y ?? 0) + (rightBounds?.height ?? 0) / 2) ||
        left.path.id.localeCompare(right.path.id)
      );
    });
    const gap = Math.min(FLOWCHART_FANOUT_PORT_GAP, (source.width * 0.4) / (ordered.length - 1));
    const centerX = source.x + source.width / 2;
    const firstX = centerX - (gap * (ordered.length - 1)) / 2;
    ordered.forEach(({ path, points }, index) => {
      const start = { x: firstX + gap * index, y: points[0].y };
      const end = points.at(-1)!;
      const snapped = snapOrthogonalTerminals(points, start, end, true);
      path.dataset.fanoutPort = `${start.x},${start.y}`;
      path.dataset.manhattanPoints = snapped.map(({ x, y }) => `${x},${y}`).join(' ');
      path.setAttribute(
        'd',
        snapped.map(({ x, y }, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${x},${y}`).join(''),
      );
    });
  }
}

export function snapOrthogonalTerminals(
  points: Point[],
  start: Point,
  end: Point,
  vertical: boolean,
): Point[] {
  if (points.length < 2) return points;
  if (points.length === 2) {
    if (vertical && Math.abs(start.x - end.x) >= 0.001) {
      const middleY = (start.y + end.y) / 2;
      return [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end];
    }
    if (!vertical && Math.abs(start.y - end.y) >= 0.001) {
      const middleX = (start.x + end.x) / 2;
      return [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
    }
    return [start, end];
  }
  if (points.length === 3) {
    if (vertical && Math.abs(start.x - end.x) >= 0.001) {
      const middleY = (start.y + end.y) / 2;
      return [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end];
    }
    if (!vertical && Math.abs(start.y - end.y) >= 0.001) {
      const middleX = (start.x + end.x) / 2;
      return [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
    }
    return [start, end];
  }

  const snapped = points.map((point) => ({ ...point }));
  snapped[0] = start;
  snapped[snapped.length - 1] = end;
  if (vertical) {
    snapped[1].x = start.x;
    snapped[snapped.length - 2].x = end.x;
  } else {
    snapped[1].y = start.y;
    snapped[snapped.length - 2].y = end.y;
  }
  const hasDiagonal = snapped.slice(1).some((point, index) => {
    const previous = snapped[index];
    return Math.abs(point.x - previous.x) >= 0.001 && Math.abs(point.y - previous.y) >= 0.001;
  });
  if (hasDiagonal) return snapOrthogonalTerminals([start, end], start, end, vertical);
  return snapped;
}

function placeFlowchartLabelOnRoute(
  label: SVGGElement | undefined,
  path: SVGPathElement,
  points: Point[],
  preferredSegmentIndex?: number,
  clearance?: { obstacles: Bounds[]; occupied: Segment[] },
) {
  if (!label?.textContent?.trim()) return true;
  if (points.length < 2) return false;
  const pathMatrix = path.getScreenCTM();
  const labelParentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getScreenCTM();
  if (!pathMatrix || !labelParentMatrix) return false;
  const current = label.getBoundingClientRect();
  const currentBounds = clientBoundsInPathSpace(label, path);
  if (clearance && !currentBounds) return false;
  const currentCenter = new DOMPoint(
    current.left + current.width / 2,
    current.top + current.height / 2,
  ).matrixTransform(pathMatrix.inverse());
  const previousTransform = label.getAttribute('transform');
  label.removeAttribute('transform');
  const local = label.getBBox();
  if (previousTransform) label.setAttribute('transform', previousTransform);
  const otherLabels = [
    ...(path.ownerSVGElement?.querySelectorAll<SVGGElement>('g.edgeLabel') ?? []),
  ]
    .filter((other) => other !== label && other.textContent?.trim())
    .map((other) => other.getBoundingClientRect());
  const nodes = [...(path.ownerSVGElement?.querySelectorAll<SVGGElement>('g.node') ?? [])].map(
    (node) => node.getBoundingClientRect(),
  );
  const overlaps = (left: DOMRect, right: DOMRect) =>
    left.left < right.right + 4 &&
    left.right + 4 > right.left &&
    left.top < right.bottom + 4 &&
    left.bottom + 4 > right.top;
  const candidates = points.slice(1).flatMap((end, index) => {
    const start = points[index];
    const horizontal = Math.abs(start.y - end.y) < 0.001;
    const capacity = Math.hypot(end.x - start.x, end.y - start.y);
    const required = (horizontal ? local.width : local.height) + 12;
    if (capacity < required) return [];
    return [0.5, 0.35, 0.65, 0.2, 0.8].flatMap((fraction) => {
      if (capacity * Math.min(fraction, 1 - fraction) < required / 2) return [];
      const center = {
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      };
      if (clearance && currentBounds) {
        const bounds = {
          x: center.x - currentBounds.width / 2,
          y: center.y - currentBounds.height / 2,
          width: currentBounds.width,
          height: currentBounds.height,
        };
        if (
          clearance.obstacles.some((other) => boundsOverlap(bounds, other, 4)) ||
          clearance.occupied.some((segment) => segmentCrossesBounds(segment, bounds, 4))
        )
          return [];
      }
      const screenCenter = new DOMPoint(center.x, center.y).matrixTransform(pathMatrix);
      const bounds = DOMRect.fromRect({
        x: screenCenter.x - current.width / 2,
        y: screenCenter.y - current.height / 2,
        width: current.width,
        height: current.height,
      });
      const collisions =
        otherLabels.filter((other) => overlaps(bounds, other)).length +
        nodes.filter((node) => overlaps(bounds, node)).length;
      return [
        {
          start,
          end,
          center,
          preferred: index === preferredSegmentIndex,
          collisions,
          distance: Math.hypot(center.x - currentCenter.x, center.y - currentCenter.y),
        },
      ];
    });
  });
  const placement = candidates.toSorted(
    (left, right) =>
      Number(right.preferred) - Number(left.preferred) ||
      left.collisions - right.collisions ||
      left.distance - right.distance,
  )[0];
  if (!placement) return false;
  const center = new DOMPoint(placement.center.x, placement.center.y)
    .matrixTransform(pathMatrix)
    .matrixTransform(labelParentMatrix.inverse());
  label.setAttribute(
    'transform',
    `translate(${center.x - local.x - local.width / 2}, ${center.y - local.y - local.height / 2})`,
  );
  label.dataset.routePathId = path.id;
  label.dataset.finalPathCenter = `${placement.center.x},${placement.center.y}`;
  path.dataset.labelSegment = `${placement.start.x},${placement.start.y} ${placement.end.x},${placement.end.y}`;
  return true;
}

export function snapFlowchartPorts(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const nodeObstacles = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
    const shape = shapeForNode(node);
    return shape ? [{ node, bounds: shape.getBoundingClientRect() }] : [];
  });
  const pairGroups = new Map<string, SVGPathElement[]>();
  for (const path of paths) {
    const identity = flowchartEdgeIdentity(path);
    if (!identity || identity.source === identity.target) continue;
    const key = [identity.source, identity.target].toSorted().join('\u0000');
    pairGroups.set(key, [...(pairGroups.get(key) ?? []), path]);
  }
  for (const path of paths) {
    if (
      path.dataset.feedbackLane ||
      path.dataset.fanoutSource ||
      path.dataset.groupedReturnLane ||
      path.dataset.decisionBranch ||
      path.dataset.decisionReturn ||
      path.dataset.clientRequestLane ||
      path.dataset.clusterHeaderClearance ||
      path.dataset.compactGroupedRoute ||
      path.dataset.decisionCycleRoute ||
      path.dataset.nestedDecisionRoute
    )
      continue;
    const identity = flowchartEdgeIdentity(path);
    const sourceNode = identity && flowchartNode(svg, identity.source);
    const targetNode = identity && flowchartNode(svg, identity.target);
    const sourceShape = sourceNode && shapeForNode(sourceNode);
    const targetShape = targetNode && shapeForNode(targetNode);
    const matrix = path.getScreenCTM();
    const points = (path.dataset.manhattanPoints ?? '')
      .trim()
      .split(/\s+/)
      .map((point) => point.split(',').map(Number))
      .filter((point) => point.length === 2 && point.every(Number.isFinite))
      .map(([x, y]) => ({ x, y }));
    if (!sourceShape || !targetShape || !matrix) continue;

    const source = sourceShape.getBoundingClientRect();
    const target = targetShape.getBoundingClientRect();
    const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const verticallySeparated = target.top >= source.bottom || source.top >= target.bottom;
    const horizontallySeparated = target.left >= source.right || source.left >= target.right;
    const vertical =
      verticallySeparated ||
      (!horizontallySeparated &&
        Math.abs(targetCenter.y - sourceCenter.y) >= Math.abs(targetCenter.x - sourceCenter.x));
    const downward = targetCenter.y >= sourceCenter.y;
    const rightward = targetCenter.x >= sourceCenter.x;
    const sharedLeft = Math.max(source.left, target.left);
    const sharedRight = Math.min(source.right, target.right);
    const sharedTop = Math.max(source.top, target.top);
    const sharedBottom = Math.min(source.bottom, target.bottom);
    const verticalPortX =
      sharedLeft <= sharedRight ? (sharedLeft + sharedRight) / 2 : sourceCenter.x;
    const verticalTargetX = sharedLeft <= sharedRight ? verticalPortX : targetCenter.x;
    const horizontalPortY =
      sharedTop <= sharedBottom ? (sharedTop + sharedBottom) / 2 : sourceCenter.y;
    const horizontalTargetY = sharedTop <= sharedBottom ? horizontalPortY : targetCenter.y;
    const sourcePort = vertical
      ? { x: verticalPortX, y: downward ? source.bottom : source.top }
      : { x: rightward ? source.right : source.left, y: horizontalPortY };
    const targetPort = vertical
      ? { x: verticalTargetX, y: downward ? target.top : target.bottom }
      : { x: rightward ? target.left : target.right, y: horizontalTargetY };
    const inverse = matrix.inverse();
    const localPoint = (x: number, y: number) => {
      const point = new DOMPoint(x, y).matrixTransform(inverse);
      return { x: point.x, y: point.y };
    };
    let start = localPoint(sourcePort.x, sourcePort.y);
    let end = localPoint(targetPort.x, targetPort.y);
    let specialPoints: Point[] | null = null;
    if (identity?.source === identity?.target) {
      const laneX = source.right + 48;
      specialPoints = [
        localPoint(source.right, source.top + source.height * 0.2),
        localPoint(laneX, source.top + source.height * 0.2),
        localPoint(laneX, source.top + source.height * 0.8),
        localPoint(source.right, source.top + source.height * 0.8),
      ];
      path.dataset.selfLoop = 'right';
    } else if (!path.dataset.compactFlowchart && identity) {
      const key = [identity.source, identity.target].toSorted().join('\u0000');
      const group = pairGroups.get(key) ?? [];
      const lane = group.indexOf(path) - (group.length - 1) / 2;
      if (group.length > 1) {
        if (lane === 0 && vertical) {
          const laneX = (sourceCenter.x + targetCenter.x) / 2;
          specialPoints = [
            localPoint(laneX, downward ? source.bottom : source.top),
            localPoint(laneX, downward ? target.top : target.bottom),
          ];
        } else if (lane === 0) {
          const laneY = (sourceCenter.y + targetCenter.y) / 2;
          specialPoints = [
            localPoint(rightward ? source.right : source.left, laneY),
            localPoint(rightward ? target.left : target.right, laneY),
          ];
        } else if (vertical) {
          const distance = 24 + (Math.ceil(Math.abs(lane)) - 1) * 16;
          const left = lane < 0;
          const corridorTop = Math.min(sourceCenter.y, targetCenter.y);
          const corridorBottom = Math.max(sourceCenter.y, targetCenter.y);
          const intervening = nodeObstacles.filter(
            ({ node, bounds }) =>
              node !== sourceNode &&
              node !== targetNode &&
              bounds.bottom > corridorTop &&
              bounds.top < corridorBottom,
          );
          const laneX = left
            ? Math.min(source.left, target.left, ...intervening.map(({ bounds }) => bounds.left)) -
              distance
            : Math.max(
                source.right,
                target.right,
                ...intervening.map(({ bounds }) => bounds.right),
              ) + distance;
          const sourceX = left ? source.left : source.right;
          const targetX = left ? target.left : target.right;
          specialPoints = [
            localPoint(sourceX, sourceCenter.y),
            localPoint(laneX, sourceCenter.y),
            localPoint(laneX, targetCenter.y),
            localPoint(targetX, targetCenter.y),
          ];
        } else {
          const distance = 24 + (Math.ceil(Math.abs(lane)) - 1) * 16;
          const above = lane < 0;
          const corridorLeft = Math.min(sourceCenter.x, targetCenter.x);
          const corridorRight = Math.max(sourceCenter.x, targetCenter.x);
          const intervening = nodeObstacles.filter(
            ({ node, bounds }) =>
              node !== sourceNode &&
              node !== targetNode &&
              bounds.right > corridorLeft &&
              bounds.left < corridorRight,
          );
          const laneY = above
            ? Math.min(source.top, target.top, ...intervening.map(({ bounds }) => bounds.top)) -
              distance
            : Math.max(
                source.bottom,
                target.bottom,
                ...intervening.map(({ bounds }) => bounds.bottom),
              ) + distance;
          const sourceY = above ? source.top : source.bottom;
          const targetY = above ? target.top : target.bottom;
          specialPoints = [
            localPoint(sourceCenter.x, sourceY),
            localPoint(sourceCenter.x, laneY),
            localPoint(targetCenter.x, laneY),
            localPoint(targetCenter.x, targetY),
          ];
        }
        path.dataset.parallelLane = lane < 0 ? 'before' : lane > 0 ? 'after' : 'center';
      }
    }
    if (specialPoints) {
      start = specialPoints[0];
      end = specialPoints[specialPoints.length - 1];
    }
    const routedPoints = specialPoints ?? (points.length >= 2 ? points : [start, end]);
    const hadDiagonal = routedPoints.slice(1).some((point, index) => {
      const previous = routedPoints[index];
      return Math.abs(point.x - previous.x) >= 0.001 && Math.abs(point.y - previous.y) >= 0.001;
    });
    const snapped = specialPoints ?? snapOrthogonalTerminals(routedPoints, start, end, vertical);
    const simplified = simplifyOrthogonalPoints(snapped);
    if (hadDiagonal) path.dataset.cardinalRepaired = 'true';
    path.dataset.manhattanPoints = simplified.map(({ x, y }) => `${x},${y}`).join(' ');
    path.setAttribute(
      'd',
      simplified.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join(''),
    );
    if (!path.dataset.compactFlowchart) {
      placeFlowchartLabelOnRoute(flowchartLabelForPath(svg, path), path, simplified);
    }
  }
}

type CardinalAttachment = { point: Point; side: CardinalSide; lead?: Point };

type StraightRoutePort = CardinalAttachment & { range?: [number, number] };
type FlowchartRectBounds = Bounds & { corner?: Point };

/** Choose a label position without changing or remeasuring any SVG geometry. */
export function chooseClearFlowchartLabel(
  points: Point[],
  current: Bounds,
  obstacles: Bounds[],
  occupied: Segment[],
) {
  const center = pointAt(current, 0.5, 0.5);
  const clear = (bounds: Bounds) =>
    !obstacles.some((other) => boundsOverlap(bounds, other, 4)) &&
    !occupied.some((segment) => segmentCrossesBounds(segment, bounds, 4));
  const candidates = segments(points).flatMap(({ start, end }) => {
    const horizontal = Math.abs(start.y - end.y) < 0.001;
    const axis = horizontal ? 'x' : 'y';
    const across = horizontal ? 'y' : 'x';
    const half = (horizontal ? current.width : current.height) / 2;
    const low = Math.min(start[axis], end[axis]) + half + 6;
    const high = Math.max(start[axis], end[axis]) - half - 6;
    if (low > high) return [];
    return [
      center[axis],
      (low + high) / 2,
      low,
      high,
      low * 0.75 + high * 0.25,
      low * 0.25 + high * 0.75,
    ].flatMap((value) => {
      const next = {
        [axis]: Math.max(low, Math.min(high, value)),
        [across]: start[across],
      } as Point;
      const bounds = { ...current, x: next.x - current.width / 2, y: next.y - current.height / 2 };
      return clear(bounds)
        ? [
            {
              center: next,
              bounds,
              start,
              end,
              distance: Math.hypot(next.x - center.x, next.y - center.y),
            },
          ]
        : [];
    });
  });
  return candidates.toSorted((a, b) => a.distance - b.distance)[0];
}

/** A bounded local repair, not a layout: clear routes keep their assigned ports. */
export function chooseClearFlowchartRoute(
  points: Point[],
  source: FlowchartRectBounds,
  target: FlowchartRectBounds,
  obstacles: Bounds[],
  occupied: Segment[],
  sourcePorts: Point[] = [],
  targetPorts: Point[] = [],
  label?: { bounds: Bounds; obstacles: Bounds[]; occupied: Segment[] },
  fixedSource = false,
  shorterOnly = false,
) {
  if (points.length < 2) return points;
  const blocked = (route: Point[]) =>
    segments(route).some((segment) =>
      obstacles.some((bounds) => segmentCrossesBounds(segment, bounds, 8)),
    );
  const shared = (route: Point[]) =>
    segments(route).some((segment) =>
      occupied.some((other) => overlappingSegments(segment, other)),
    );
  const labelFits = (route: Point[]) =>
    !label ||
    chooseClearFlowchartLabel(
      route,
      label.bounds,
      [source, target, ...obstacles, ...label.obstacles],
      label.occupied,
    );
  if (!shorterOnly && !blocked(points) && !shared(points) && labelFits(points)) return points;
  const attachments = (
    bounds: FlowchartRectBounds,
    point: Point,
    adjacent: Point,
    ports: Point[],
    fixed = false,
  ) => {
    const side = cardinalSideFromDirection(point, adjacent);
    const candidates: CardinalAttachment[] = [{ point, side }];
    for (const side of fixed ? [] : (['top', 'right', 'bottom', 'left'] as const)) {
      for (const fraction of shorterOnly ? [0.5, 0.25, 0.75, 0, 1] : [0.5, 0.25, 0.75]) {
        const point =
          side === 'top' || side === 'bottom'
            ? pointAt(bounds, fraction, side === 'top' ? 0 : 1)
            : pointAt(bounds, side === 'left' ? 0 : 1, fraction);
        if (side === 'top' || side === 'bottom') {
          const inset = Math.min(bounds.width / 2, bounds.corner?.x ?? 0);
          point.x = Math.max(bounds.x + inset, Math.min(bounds.x + bounds.width - inset, point.x));
        } else {
          const inset = Math.min(bounds.height / 2, bounds.corner?.y ?? 0);
          point.y = Math.max(bounds.y + inset, Math.min(bounds.y + bounds.height - inset, point.y));
        }
        if (
          ports.every(
            (port) =>
              Math.hypot(port.x - point.x, port.y - point.y) >=
              (shorterOnly ? 8 : FLOWCHART_PORT_SLOT_GAP),
          )
        )
          candidates.push({ point, side });
      }
    }
    return candidates.map((attachment) => {
      const lead = { ...attachment.point };
      const verticalLead = Math.max(16, (label?.bounds.height ?? 0) / 2 + (shorterOnly ? 4 : 8));
      const horizontalLead = Math.max(16, (label?.bounds.width ?? 0) / 2 + (shorterOnly ? 4 : 8));
      if (attachment.side === 'top') lead.y -= verticalLead;
      if (attachment.side === 'bottom') lead.y += verticalLead;
      if (attachment.side === 'left') lead.x -= horizontalLead;
      if (attachment.side === 'right') lead.x += horizontalLead;
      return { ...attachment, lead };
    });
  };
  const starts = attachments(source, points[0], points[1], sourcePorts, fixedSource);
  const ends = attachments(target, points.at(-1)!, points.at(-2)!, targetPorts);
  const extent = [
    source,
    target,
    ...obstacles,
    ...occupied.map(({ start, end }) => ({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(start.x - end.x),
      height: Math.abs(start.y - end.y),
    })),
  ];
  const xGap = Math.max(16, (label?.bounds.width ?? 0) / 2 + 8);
  const yGap = Math.max(16, (label?.bounds.height ?? 0) / 2 + 8);
  const outerX = [
    Math.min(...extent.map((b) => b.x)) - xGap,
    Math.max(...extent.map((b) => b.x + b.width)) + xGap,
  ];
  const outerY = [
    Math.min(...extent.map((b) => b.y)) - yGap,
    Math.max(...extent.map((b) => b.y + b.height)) + yGap,
  ];
  if (shorterOnly) {
    // Local obstacle faces expose corridors hidden by the global envelope. Bound
    // the candidates and retain the original whenever no shorter clear route fits.
    const faces = (axis: 'x' | 'y', size: 'width' | 'height') =>
      [...new Set(obstacles.flatMap((box) => [box[axis] - 16, box[axis] + box[size] + 16]))]
        .toSorted((a, b) => Math.abs(a - source[axis]) - Math.abs(b - source[axis]))
        .slice(0, 12);
    outerX.push(...faces('x', 'width'));
    outerY.push(...faces('y', 'height'));
  }
  // Four envelope lanes bound the fallback; no visibility grid or iterative rerouting.
  const candidates = starts.flatMap((start) =>
    ends.flatMap((end) =>
      [
        [start.point, start.lead, { x: start.lead.x, y: end.lead.y }, end.lead, end.point],
        [start.point, start.lead, { x: end.lead.x, y: start.lead.y }, end.lead, end.point],
        ...outerX.map((x) => [
          start.point,
          start.lead,
          { x, y: start.lead.y },
          { x, y: end.lead.y },
          end.lead,
          end.point,
        ]),
        ...outerY.map((y) => [
          start.point,
          start.lead,
          { x: start.lead.x, y },
          { x: end.lead.x, y },
          end.lead,
          end.point,
        ]),
      ].map(simplifyOrthogonalPoints),
    ),
  );
  const length = (route: Point[]) =>
    segments(route).reduce(
      (sum, segment) =>
        sum + Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y),
      0,
    );
  let best: Point[] | undefined;
  let score = Infinity;
  for (const { candidate, length: candidateLength } of candidates
    .map((candidate) => ({ candidate, length: length(candidate) }))
    .toSorted((a, b) => a.length - b.length)) {
    if (
      (shorterOnly &&
        (candidateLength >= length(points) - 1 ||
          candidate.some((point) => point.y < Math.min(source.y, target.y) - yGap))) ||
      blocked(candidate) ||
      !labelFits(candidate) ||
      segments(candidate).some(
        (segment) => segmentCrossesBounds(segment, source) || segmentCrossesBounds(segment, target),
      )
    )
      continue;
    const conflicts = segments(candidate).reduce(
      (sum, segment) =>
        sum +
        occupied.reduce((count, other) => {
          const bounds = {
            x: Math.min(other.start.x, other.end.x),
            y: Math.min(other.start.y, other.end.y),
            width: Math.abs(other.end.x - other.start.x),
            height: Math.abs(other.end.y - other.start.y),
          };
          return (
            count +
            (overlappingSegments(segment, other)
              ? 100
              : segmentCrossesBounds(segment, bounds, 6)
                ? 1
                : 0)
          );
        }, 0),
      0,
    );
    if (conflicts < score && (!shorterOnly || conflicts === 0)) {
      best = candidate;
      score = conflicts;
    }
    if (score === 0) break;
  }
  return best ?? points;
}

function measuredFlowchartRoutes(svg: SVGSVGElement) {
  return [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].flatMap((path) => {
    const identity = flowchartEdgeIdentity(path);
    const points = (path.dataset.manhattanPoints ?? '')
      .trim()
      .split(/\s+/)
      .map((value) => {
        const [x, y] = value.split(',').map(Number);
        return { x, y };
      });
    return identity &&
      points.length >= 2 &&
      points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      ? [{ path, ...identity, points, label: flowchartLabelForPath(svg, path) }]
      : [];
  });
}

export function repairFlowchartRouteClearance(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const routes = measuredFlowchartRoutes(svg);
  const reference = routes[0]?.path;
  if (!reference) return;
  const nodes = new Map(
    [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
      const shape = shapeForNode(node);
      const bounds = shape && boundsInPathSpace(shape, reference);
      if (!shape || !bounds) return [];
      const style = getComputedStyle(shape);
      const local = shape.getBBox();
      const radius = (value: string, extent: number) =>
        (Number.parseFloat(value) || 0) * (value.endsWith('%') ? extent / 100 : 1);
      const corner = {
        x: (radius(style.rx, local.width) * bounds.width) / local.width,
        y: (radius(style.ry, local.height) * bounds.height) / local.height,
      };
      return [[flowchartNodeId(node), { bounds: { ...bounds, corner }, shape }] as const];
    }),
  );
  const labels = new Map(
    routes.flatMap((route) => {
      const bounds =
        route.label?.textContent?.trim() && clientBoundsInPathSpace(route.label, reference);
      return bounds ? [[route, bounds] as const] : [];
    }),
  );
  const headers = [...svg.querySelectorAll<SVGGElement>('g.cluster > .cluster-label')].flatMap(
    (node) => {
      const bounds = clientBoundsInPathSpace(node, reference);
      return bounds ? [bounds] : [];
    },
  );
  const plannedLabels = new Map<string, Point>();
  const routingOrder = routes
    .map((route) => {
      const source = nodes.get(route.source);
      const target = nodes.get(route.target);
      // Dedicated passes own shared trunks, return lanes, and nonrectangular attachment.
      const fixed = Boolean(
        route.source === route.target ||
        route.path.dataset.fanoutSource ||
        route.path.dataset.feedbackLane ||
        route.path.dataset.groupedReturnLane ||
        route.path.dataset.decisionCycleRoute ||
        route.path.dataset.nestedDecisionRoute ||
        source?.shape.tagName.toLowerCase() !== 'rect' ||
        target?.shape.tagName.toLowerCase() !== 'rect',
      );
      return { route, source, target, fixed };
    })
    // Reserve labels on fixed routes before choosing corridors around them.
    .sort((a, b) => Number(b.fixed) - Number(a.fixed));
  for (const { route, source, target, fixed } of routingOrder) {
    const others = routes.filter((other) => other !== route);
    const ports = (id: string) =>
      others.flatMap((other) => [
        ...(other.source === id ? [other.points[0]] : []),
        ...(other.target === id ? [other.points.at(-1)!] : []),
      ]);
    const occupied = others
      .filter((other) => other.source !== route.source || other.target === route.target)
      .flatMap((other) => segments(other.points));
    const obstacles = [...nodes]
      .filter(([id]) => id !== route.source && id !== route.target)
      .map<Bounds>(([, node]) => node.bounds)
      .concat(
        headers,
        [...labels].filter(([other]) => other !== route).map(([, bounds]) => bounds),
      );
    const labelBounds = labels.get(route);
    const chooseRoute = (points: Point[], shorterOnly = false) =>
      !fixed && source && target
        ? chooseClearFlowchartRoute(
            points,
            source.bounds,
            target.bounds,
            obstacles,
            occupied,
            ports(route.source),
            ports(route.target),
            labelBounds
              ? {
                  bounds: labelBounds,
                  obstacles: [...labels]
                    .filter(([other]) => other !== route)
                    .map(([, bounds]) => bounds),
                  occupied: others.flatMap((other) => segments(other.points)),
                }
              : undefined,
            Boolean(route.path.dataset.fanoutPort) &&
              others.some(
                (other) => other.source === route.source && other.target !== route.target,
              ),
            shorterOnly,
          )
        : points;
    const ingress = nestedClusterIngress(svg, route.path, source?.bounds, target?.bounds);
    const initialPoints = ingress
      ? [
          pointAt(source!.bounds, 1, 0.5),
          { x: ingress.x, y: source!.bounds.y + source!.bounds.height / 2 },
          { x: ingress.x, y: target!.bounds.y + target!.bounds.height / 2 },
          pointAt(target!.bounds, 1, 0.5),
        ]
      : route.points;
    let points = chooseRoute(initialPoints);
    if (!fixed && !ingress && points.length > 4) points = chooseRoute(points, true);
    if (!fixed && !ingress && !svg.querySelector('g.cluster'))
      points = separateFlowchartVerticalLane(
        points,
        others
          .filter((other) => other.path.dataset.feedbackLane)
          .flatMap((other) => segments(other.points)),
        obstacles,
      );
    // Ordinary label clearance may introduce a feedback crossing. Retry that
    // candidate once, before reserving labels or writing any route geometry.
    if (
      !fixed &&
      source &&
      target &&
      target.bounds.y > source.bounds.y &&
      others.some(
        (other) =>
          other.path.dataset.feedbackLane &&
          other.target === route.source &&
          segments(points).some((segment) =>
            segments(other.points).some(({ start, end }) =>
              segmentCrossesBounds(segment, {
                x: Math.min(start.x, end.x),
                y: Math.min(start.y, end.y),
                width: Math.abs(end.x - start.x),
                height: Math.abs(end.y - start.y),
              }),
            ),
          ),
      )
    )
      points = chooseRoute(points, true);
    if (labelBounds) {
      const placement = chooseClearFlowchartLabel(
        points,
        labelBounds,
        [...[source, target].flatMap((node) => (node ? [node.bounds] : [])), ...obstacles],
        others.flatMap((other) => segments(other.points)),
      );
      // Reserve the planned label before later routes choose their corridors.
      if (placement) {
        labels.set(route, placement.bounds);
        plannedLabels.set(route.path.id, placement.center);
      }
    }
    if (points === route.points) continue;
    route.points = points;
    route.path.dataset.manhattanPoints = points.map(({ x, y }) => `${x},${y}`).join(' ');
    route.path.setAttribute('d', points.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x},${y}`).join(''));
  }
  // The ordinary routes can escape the envelope used by the earlier feedback
  // pass. Expand only its left run now, retaining both terminal ports and the
  // remaining routes; final label placement and rounding follow this pass.
  for (const route of routes.filter((route) => route.path.dataset.feedbackLane === 'outer')) {
    const others = routes.filter((other) => other !== route);
    const occupied = others.flatMap((other) =>
      segments(other.points).map(({ start, end }) => ({
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      })),
    );
    occupied.push(...[...labels].filter(([other]) => other !== route).map(([, bounds]) => bounds));
    const points = expandFlowchartFeedbackLane(route.points, occupied);
    if (points === route.points) continue;
    route.path.dataset.manhattanPoints = points.map(({ x, y }) => `${x},${y}`).join(' ');
    route.path.setAttribute('d', points.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x},${y}`).join(''));
    plannedLabels.delete(route.path.id);
  }
  return plannedLabels;
}

export function separateFlowchartVerticalLane(
  points: Point[],
  occupied: Segment[],
  obstacles: Bounds[],
): Point[] {
  for (let index = 1; index < points.length - 2; index++) {
    const start = points[index],
      end = points[index + 1];
    if (Math.abs(start.x - end.x) > 0.001 || Math.abs(start.y - end.y) < 32) continue;
    const neighbors = occupied.filter(
      (other) =>
        Math.abs(other.start.x - other.end.x) < 0.001 &&
        Math.abs(other.start.x - start.x) < 20 &&
        Math.abs(other.start.x - start.x) > 0.001 &&
        Math.min(Math.max(start.y, end.y), Math.max(other.start.y, other.end.y)) -
          Math.max(Math.min(start.y, end.y), Math.min(other.start.y, other.end.y)) >
          20,
    );
    if (!neighbors.length) continue;
    const candidates = neighbors
      .flatMap((other) => [other.start.x - 20, other.start.x + 20])
      .filter((x) => Math.abs(x - start.x) <= 20)
      .toSorted((a, b) => Math.abs(a - start.x) - Math.abs(b - start.x));
    for (const x of candidates) {
      const candidate = points.map((point, i) =>
        i === index || i === index + 1 ? { ...point, x } : point,
      );
      const changed = segments(candidate).slice(index - 1, index + 2);
      if (
        neighbors.some((other) => Math.abs(other.start.x - x) < 19.99) ||
        changed.some((segment) => obstacles.some((box) => segmentCrossesBounds(segment, box, 4)))
      )
        continue;
      return candidate;
    }
  }
  return points;
}

function nestedClusterIngress(
  svg: SVGSVGElement,
  path: SVGPathElement,
  source?: Bounds,
  target?: Bounds,
) {
  if (!source || !target || path.dataset.nestedDecisionRoute) return null;
  const contains = (frame: Bounds, node: Bounds) =>
    node.x >= frame.x - 0.5 &&
    node.x + node.width <= frame.x + frame.width + 0.5 &&
    node.y >= frame.y - 0.5 &&
    node.y + node.height <= frame.y + frame.height + 0.5;
  const frames = [...svg.querySelectorAll<SVGRectElement>('g.cluster > rect')].flatMap((rect) => {
    const bounds = boundsInPathSpace(rect, path);
    return bounds ? [bounds] : [];
  });
  const child = frames
    .filter((frame) => contains(frame, target) && !contains(frame, source))
    .toSorted((a, b) => a.width * a.height - b.width * b.height)[0];
  const parent =
    child &&
    frames
      .filter((frame) => frame !== child && contains(frame, child) && contains(frame, source))
      .toSorted((a, b) => a.width * a.height - b.width * b.height)[0];
  if (!child || !parent || source.y + source.height > child.y) return null;
  return { x: (child.x + child.width + parent.x + parent.width) / 2 };
}

export function repairFlowchartLabelClearance(
  svg: SVGSVGElement,
  plannedLabels?: Map<string, Point>,
) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const routes = measuredFlowchartRoutes(svg);
  const reference = routes[0]?.path;
  if (!reference) return;
  const nodes = [
    ...svg.querySelectorAll<SVGGElement>('g.node, g.cluster > .cluster-label'),
  ].flatMap((node) => {
    const bounds = clientBoundsInPathSpace(node, reference);
    return bounds ? [bounds] : [];
  });
  // Snapshot every measurement before writing: placement is purely local arithmetic.
  const labels = routes.flatMap((route) => {
    const label = route.label;
    if (!label?.textContent?.trim()) return [];
    const current = clientBoundsInPathSpace(label, reference);
    const planned = plannedLabels?.get(route.path.id);
    if (current && planned) {
      current.x = planned.x - current.width / 2;
      current.y = planned.y - current.height / 2;
    }
    const matrix = reference.getScreenCTM();
    const parentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getScreenCTM();
    const local = label.getBBox();
    return current && matrix && parentMatrix
      ? [{ route, label, current, matrix, inverse: parentMatrix.inverse(), local }]
      : [];
  });
  for (const item of labels) {
    const { route, label, current, matrix, inverse, local } = item;
    const occupied = routes
      .filter((other) => other !== route)
      .flatMap((other) => segments(other.points));
    const placement = chooseClearFlowchartLabel(
      route.points,
      current,
      [...nodes, ...labels.filter((other) => other !== item).map((other) => other.current)],
      occupied,
    );
    if (!placement) continue;
    const center = new DOMPoint(placement.center.x, placement.center.y)
      .matrixTransform(matrix)
      .matrixTransform(inverse);
    label.setAttribute(
      'transform',
      `translate(${center.x - local.x - local.width / 2},${center.y - local.y - local.height / 2})`,
    );
    label.dataset.labelSegmentStart = `${placement.start.x},${placement.start.y}`;
    label.dataset.labelSegmentEnd = `${placement.end.x},${placement.end.y}`;
    item.current = placement.bounds;
  }
}

/** Keep assigned shape ports fixed; slide only ports with an explicit free boundary range. */
export function preferClearStraightRoute(
  points: Point[],
  source: StraightRoutePort,
  target: StraightRoutePort,
  obstacles: Bounds[],
  occupied: Segment[] = [],
  sourcePorts: Point[] = [],
  targetPorts: Point[] = [],
  clearance = 8,
) {
  const opposite = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
  if (opposite[source.side] !== target.side) return points;
  const horizontal = source.side === 'left' || source.side === 'right';
  const axis = horizontal ? 'y' : 'x';
  const along = horizontal ? 'x' : 'y';
  const direction = source.side === 'right' || source.side === 'bottom' ? 1 : -1;
  if ((target.point[along] - source.point[along]) * direction <= 0) return points;
  const sourceRange = source.range ?? [source.point[axis], source.point[axis]];
  const targetRange = target.range ?? [target.point[axis], target.point[axis]];
  const low = Math.max(sourceRange[0], targetRange[0]);
  const high = Math.min(sourceRange[1], targetRange[1]);
  if (low > high) return points;
  const clamp = (value: number) => Math.max(low, Math.min(high, value));
  const candidates = [
    ...new Set([
      clamp(source.point[axis]),
      clamp(target.point[axis]),
      low,
      high,
      (low + high) / 2,
      ...[...sourcePorts, ...targetPorts].flatMap((point) => [
        point[axis] - FLOWCHART_PORT_SLOT_GAP,
        point[axis] + FLOWCHART_PORT_SLOT_GAP,
      ]),
      ...obstacles.flatMap((bounds) => [
        bounds[axis] - clearance,
        bounds[axis] + (horizontal ? bounds.height : bounds.width) + clearance,
      ]),
      ...occupied.flatMap((segment) => [
        Math.min(segment.start[axis], segment.end[axis]) - clearance,
        Math.max(segment.start[axis], segment.end[axis]) + clearance,
      ]),
    ]),
  ]
    .filter((value) => value >= low && value <= high)
    .toSorted(
      (left, right) =>
        Math.abs(left - source.point[axis]) +
        Math.abs(left - target.point[axis]) -
        Math.abs(right - source.point[axis]) -
        Math.abs(right - target.point[axis]),
    );
  for (const coordinate of candidates) {
    const start = { ...source.point, [axis]: coordinate };
    const end = { ...target.point, [axis]: coordinate };
    if (
      sourcePorts.some(
        (port) => Math.hypot(start.x - port.x, start.y - port.y) < FLOWCHART_PORT_SLOT_GAP - 0.001,
      ) ||
      targetPorts.some(
        (port) => Math.hypot(end.x - port.x, end.y - port.y) < FLOWCHART_PORT_SLOT_GAP - 0.001,
      )
    )
      continue;
    const candidate = { start, end };
    if (obstacles.some((bounds) => segmentCrossesBounds(candidate, bounds, clearance))) continue;
    if (
      occupied.some((segment) =>
        segmentCrossesBounds(
          candidate,
          {
            x: Math.min(segment.start.x, segment.end.x),
            y: Math.min(segment.start.y, segment.end.y),
            width: Math.abs(segment.start.x - segment.end.x),
            height: Math.abs(segment.start.y - segment.end.y),
          },
          clearance,
        ),
      )
    )
      continue;
    return [start, end];
  }
  return points;
}

function cardinalSideFromDirection(origin: Point, adjacent: Point): CardinalSide {
  const dx = adjacent.x - origin.x;
  const dy = adjacent.y - origin.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** A local return is optional: never trade a shorter path for occupied paint or a lost label. */
export function chooseClearLocalReturn(
  points: Point[],
  candidates: Point[][],
  obstacles: Bounds[],
  occupied: Segment[],
  label?: { bounds: Bounds; obstacles: Bounds[] },
) {
  const length = (route: Point[]) =>
    segments(route).reduce(
      (sum, { start, end }) => sum + Math.hypot(end.x - start.x, end.y - start.y),
      0,
    );
  return (
    candidates
      .map(simplifyOrthogonalPoints)
      .filter(
        (candidate) => candidate.length <= points.length && length(candidate) < length(points) - 1,
      )
      .filter((candidate) =>
        segments(candidate).every(
          (segment) =>
            !obstacles.some((bounds) => segmentCrossesBounds(segment, bounds, 8)) &&
            !occupied.some(({ start, end }) =>
              segmentCrossesBounds(
                segment,
                {
                  x: Math.min(start.x, end.x),
                  y: Math.min(start.y, end.y),
                  width: Math.abs(end.x - start.x),
                  height: Math.abs(end.y - start.y),
                },
                8,
              ),
            ),
        ),
      )
      .filter(
        (candidate) =>
          !label ||
          chooseClearFlowchartLabel(
            candidate,
            label.bounds,
            [...obstacles, ...label.obstacles],
            occupied,
          ),
      )
      .sort((left, right) => length(left) - length(right))[0] ?? points
  );
}

function straightenClearFlowchartRoutes(svg: SVGSVGElement, edges: FlowchartRoute[]) {
  const routes = edges
    .map((edge) => ({
      ...edge,
      points: (edge.path.dataset.manhattanPoints ?? '').split(' ').map((value) => {
        const [x, y] = value.split(',').map(Number);
        return { x, y };
      }),
    }))
    .filter(
      ({ points }) =>
        points.length >= 2 && points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
    );
  for (const route of routes) {
    if (route.source === route.target || route.points.length === 2) continue;
    const { path, points } = route;
    const port = (role: 'source' | 'target'): StraightRoutePort | undefined => {
      const node = flowchartNode(svg, route[role]);
      const shape = node && shapeForNode(node);
      const bounds = shape && boundsInPathSpace(shape, path);
      if (!shape || !bounds) return;
      const point = role === 'source' ? points[0] : points[points.length - 1];
      const adjacent = role === 'source' ? points[1] : points[points.length - 2];
      const side = cardinalSideFromDirection(point, adjacent);
      const horizontal = side === 'left' || side === 'right';
      const inset = Math.max(8, Number(shape.getAttribute(horizontal ? 'ry' : 'rx')) || 0);
      const range: [number, number] | undefined =
        shape.tagName.toLowerCase() === 'rect'
          ? horizontal
            ? [bounds.y + inset, bounds.y + bounds.height - inset]
            : [bounds.x + inset, bounds.x + bounds.width - inset]
          : undefined;
      return { point, side, range };
    };
    const source = port('source');
    const target = port('target');
    if (!source || !target) continue;
    const otherRoutes = routes.filter((other) => other !== route);
    const occupiedPorts = (id: string) =>
      otherRoutes.flatMap((other) => [
        ...(other.source === id ? [other.points[0]] : []),
        ...(other.target === id ? [other.points[other.points.length - 1]] : []),
      ]);
    const contains = (bounds: Bounds, point: Point) =>
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height;
    const obstacles = [
      ...[...svg.querySelectorAll<SVGGElement>('g.node')].filter(
        (node) => ![route.source, route.target].includes(flowchartNodeId(node)),
      ),
      ...svg.querySelectorAll<SVGGElement>('g.cluster > .cluster-label'),
      ...[...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')].filter(
        (label) => label !== route.label && label.textContent?.trim(),
      ),
    ]
      .map((element) => clientBoundsInPathSpace(element, path))
      .filter((bounds): bounds is Bounds => !!bounds);
    for (const rect of svg.querySelectorAll<SVGRectElement>('g.cluster > rect')) {
      const bounds = boundsInPathSpace(rect, path);
      if (bounds && !contains(bounds, source.point) && !contains(bounds, target.point))
        obstacles.push(bounds);
    }
    const occupied = otherRoutes.flatMap((other) => segments(other.points));
    let straight = preferClearStraightRoute(
      points,
      source,
      target,
      obstacles,
      occupied,
      occupiedPorts(route.source),
      occupiedPorts(route.target),
    );
    if (straight === points && path.dataset.nestedDecisionRoute === 'secondary-retry') {
      const sourceNode = flowchartNode(svg, route.source);
      const targetNode = flowchartNode(svg, route.target);
      const sourceShape = sourceNode && shapeForNode(sourceNode);
      const targetShape = targetNode && shapeForNode(targetNode);
      const sourceBounds = sourceShape && boundsInPathSpace(sourceShape, path);
      const targetBounds = targetShape && boundsInPathSpace(targetShape, path);
      if (
        sourceShape?.tagName.toLowerCase() === 'rect' &&
        targetShape &&
        isDiamondShape(targetShape) &&
        sourceBounds &&
        targetBounds
      ) {
        const start = pointAt(sourceBounds, 0.5, 0);
        const candidates: Point[][] = [];
        // Keep the existing lower diamond port when returning from below/right.
        if (
          target.side === 'bottom' &&
          start.y > targetBounds.y + targetBounds.height + 8 &&
          start.x > target.point.x
        ) {
          const y = (start.y + targetBounds.y + targetBounds.height) / 2;
          candidates.push([start, { x: start.x, y }, { x: target.point.x, y }, target.point]);
        }
        // A below/left reciprocal can approach the lower-left face without crossing the add lane.
        const left = diamondBoundaryPort(targetBounds, 'left', 24);
        if (start.x < left.x && start.y > left.y)
          candidates.push([start, { x: start.x, y: left.y }, left]);
        const right = diamondBoundaryPort(targetBounds, 'right', targetBounds.height * 0.32);
        if (start.x > right.x && start.y > right.y)
          candidates.push([start, { x: start.x, y: right.y }, right]);
        const available = candidates.filter(
          (candidate) =>
            !occupiedPorts(route.source).some(
              (port) => Math.hypot(port.x - start.x, port.y - start.y) < FLOWCHART_PORT_SLOT_GAP,
            ) &&
            !occupiedPorts(route.target).some(
              (port) =>
                Math.hypot(port.x - candidate.at(-1)!.x, port.y - candidate.at(-1)!.y) <
                FLOWCHART_PORT_SLOT_GAP,
            ),
        );
        const labelBounds = route.label && clientBoundsInPathSpace(route.label, path);
        straight = chooseClearLocalReturn(
          points,
          available,
          obstacles,
          occupied,
          labelBounds
            ? { bounds: labelBounds, obstacles: [sourceBounds, targetBounds] }
            : undefined,
        );
      }
    }
    if (straight === points) continue;
    if (
      !placeFlowchartLabelOnRoute(route.label, path, straight, undefined, { obstacles, occupied })
    )
      continue;
    route.points = straight;
    path.dataset.manhattanPoints = straight.map(({ x, y }) => `${x},${y}`).join(' ');
    path.dataset.manhattanSegments = String(straight.length - 1);
    const terminal = straight.at(-1)!;
    const adjacent = straight.at(-2)!;
    path.dataset.terminalDirection = `${terminal.x - adjacent.x},${terminal.y - adjacent.y}`;
    if (path.dataset.nestedDecisionRoute === 'secondary-retry') {
      path.dataset.diamondTargetSide = cardinalSideFromDirection(terminal, adjacent);
    }
    path.setAttribute(
      'd',
      straight.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x},${y}`).join(''),
    );
  }
}

function attachCardinalPorts(
  route: Point[],
  source?: CardinalAttachment,
  target?: CardinalAttachment,
) {
  const points = route.map((point) => ({ ...point }));
  if (source) {
    const next = points[1];
    const previousStart = points[0];
    points[0] = source.point;
    const vertical = source.side === 'top' || source.side === 'bottom';
    if (points.length > 2) {
      if (vertical && Math.abs(previousStart.x - next.x) < 0.001) next.x = source.point.x;
      else if (!vertical && Math.abs(previousStart.y - next.y) < 0.001) next.y = source.point.y;
    }
    const aligned = vertical
      ? Math.abs(next.x - source.point.x) < 0.001
      : Math.abs(next.y - source.point.y) < 0.001;
    if (!aligned) {
      if (source.lead) {
        const bend = vertical ? { x: next.x, y: source.lead.y } : { x: source.lead.x, y: next.y };
        points.splice(1, 0, source.lead, bend);
      } else {
        const bend = vertical ? { x: source.point.x, y: next.y } : { x: next.x, y: source.point.y };
        points.splice(1, 0, bend);
      }
    }
  }
  if (target) {
    const previous = points[points.length - 2];
    const previousEnd = points[points.length - 1];
    points[points.length - 1] = target.point;
    const vertical = target.side === 'top' || target.side === 'bottom';
    if (points.length > 2) {
      if (vertical && Math.abs(previousEnd.x - previous.x) < 0.001) previous.x = target.point.x;
      else if (!vertical && Math.abs(previousEnd.y - previous.y) < 0.001)
        previous.y = target.point.y;
    }
    const aligned = vertical
      ? Math.abs(previous.x - target.point.x) < 0.001
      : Math.abs(previous.y - target.point.y) < 0.001;
    if (!aligned) {
      if (target.lead) {
        const bend = vertical
          ? { x: previous.x, y: target.lead.y }
          : { x: target.lead.x, y: previous.y };
        points.splice(points.length - 1, 0, bend, target.lead);
      } else {
        const bend = vertical
          ? { x: target.point.x, y: previous.y }
          : { x: previous.x, y: target.point.y };
        points.splice(points.length - 1, 0, bend);
      }
    }
  }
  return simplifyOrthogonalPoints(points);
}

export function diamondBoundaryPort(bounds: Bounds, side: CardinalSide, offset = 0): Point {
  const center = pointAt(bounds, 0.5, 0.5);
  const halfWidth = bounds.width / 2;
  const halfHeight = bounds.height / 2;
  if (side === 'top' || side === 'bottom') {
    const clamped = Math.max(-halfWidth * 0.7, Math.min(halfWidth * 0.7, offset));
    const height = halfHeight * (1 - Math.abs(clamped) / halfWidth);
    return { x: center.x + clamped, y: center.y + (side === 'top' ? -height : height) };
  }
  const clamped = Math.max(-halfHeight * 0.7, Math.min(halfHeight * 0.7, offset));
  const width = halfWidth * (1 - Math.abs(clamped) / halfHeight);
  return { x: center.x + (side === 'left' ? -width : width), y: center.y + clamped };
}

function diamondCardinalAttachment(
  bounds: Bounds,
  side: CardinalSide,
  offset = 0,
): CardinalAttachment {
  const point = diamondBoundaryPort(bounds, side, offset);
  const lead = { ...point };
  if (side === 'top') lead.y -= 12;
  else if (side === 'right') lead.x += 12;
  else if (side === 'bottom') lead.y += 12;
  else lead.x -= 12;
  return { point, side, lead };
}

function allocateDiamondAttachments(svg: SVGSVGElement, paths: SVGPathElement[]) {
  type Use = {
    path: SVGPathElement;
    role: 'source' | 'target';
    nodeId: string;
    bounds: Bounds;
    side: CardinalSide;
    adjacent: Point;
  };
  const identities = new Map(paths.map((path) => [path, flowchartEdgeIdentity(path)]));
  const uses: Use[] = [];
  for (const path of paths) {
    const identity = identities.get(path);
    const points = (path.dataset.manhattanPoints ?? '')
      .trim()
      .split(/\s+/)
      .map((point) => point.split(',').map(Number))
      .filter((point) => point.length === 2 && point.every(Number.isFinite))
      .map(([x, y]) => ({ x, y }));
    if (!identity || points.length < 2) continue;
    const sourceNode = flowchartNode(svg, identity.source);
    const sourceShape = sourceNode && shapeForNode(sourceNode);
    if (sourceShape && isDiamondShape(sourceShape)) {
      const bounds = boundsInPathSpace(sourceShape, path);
      if (bounds) {
        const side = cardinalSideFromDirection(pointAt(bounds, 0.5, 0.5), points[1]);
        uses.push({
          path,
          role: 'source',
          nodeId: identity.source,
          bounds,
          side,
          adjacent: points[1],
        });
      }
    }
    const targetNode = flowchartNode(svg, identity.target);
    const targetShape = targetNode && shapeForNode(targetNode);
    if (targetShape && isDiamondShape(targetShape)) {
      const bounds = boundsInPathSpace(targetShape, path);
      if (bounds) {
        const reciprocal = paths.some((candidate) => {
          const candidateIdentity = identities.get(candidate);
          return (
            candidate !== path &&
            candidateIdentity?.source === identity.target &&
            candidateIdentity.target === identity.source
          );
        });
        const side: CardinalSide =
          path.dataset.decisionReturn && path.dataset.compactFlowchart === 'true'
            ? 'left'
            : path.dataset.decisionReturn || reciprocal
              ? 'bottom'
              : cardinalSideFromDirection(pointAt(bounds, 0.5, 0.5), points[points.length - 2]);
        uses.push({
          path,
          role: 'target',
          nodeId: identity.target,
          bounds,
          side,
          adjacent: points[points.length - 2],
        });
      }
    }
  }
  const groups = new Map<string, Use[]>();
  for (const use of uses) {
    const key = `${use.nodeId}\u0000${use.side}`;
    groups.set(key, [...(groups.get(key) ?? []), use]);
  }
  const assignments = new Map<
    SVGPathElement,
    { source?: CardinalAttachment; target?: CardinalAttachment }
  >();
  for (const grouped of groups.values()) {
    const side = grouped[0].side;
    const horizontal = side === 'top' || side === 'bottom';
    const sorted = grouped.toSorted(
      (left, right) =>
        (horizontal ? left.adjacent.x - right.adjacent.x : left.adjacent.y - right.adjacent.y) ||
        left.path.id.localeCompare(right.path.id) ||
        left.role.localeCompare(right.role),
    );
    const span = (horizontal ? grouped[0].bounds.width : grouped[0].bounds.height) * 0.5;
    const gap = Math.min(FLOWCHART_PORT_SLOT_GAP, span / Math.max(1, grouped.length - 1));
    sorted.forEach((use, index) => {
      const offset = grouped.length === 1 ? 0 : (index - (grouped.length - 1) / 2) * gap;
      const assignment = assignments.get(use.path) ?? {};
      assignment[use.role] = diamondCardinalAttachment(use.bounds, side, offset);
      assignments.set(use.path, assignment);
    });
  }
  return assignments;
}

function spreadCrowdedFlowchartPorts(svg: SVGSVGElement) {
  type Use = {
    path: SVGPathElement;
    role: 'source' | 'target';
    side: CardinalSide;
    bounds: Bounds;
    endpoint: Point;
  };
  const groups = new Map<string, Use[]>();
  for (const path of svg.querySelectorAll<SVGPathElement>('.edgePaths path')) {
    if (
      path.dataset.feedbackLane ||
      path.dataset.groupedReturnLane ||
      path.dataset.clientRequestLane ||
      path.dataset.compactGroupedRoute ||
      path.dataset.decisionCycleRoute ||
      path.dataset.nestedDecisionRoute
    )
      continue;
    const identity = flowchartEdgeIdentity(path);
    const points = (path.dataset.manhattanPoints ?? '')
      .trim()
      .split(/\s+/)
      .map((point) => point.split(',').map(Number))
      .filter((point) => point.length === 2 && point.every(Number.isFinite))
      .map(([x, y]) => ({ x, y }));
    if (!identity || points.length < 2) continue;
    for (const role of ['source', 'target'] as const) {
      if (role === 'source' && path.dataset.fanoutSource) continue;
      const nodeId = identity[role];
      const node = flowchartNode(svg, nodeId);
      const shape = node && shapeForNode(node);
      const bounds = shape && boundsInPathSpace(shape, path);
      if (!shape || !bounds || isDiamondShape(shape)) continue;
      const endpoint = role === 'source' ? points[0] : points[points.length - 1];
      const distances: [CardinalSide, number][] = [
        ['top', Math.abs(endpoint.y - bounds.y)],
        ['right', Math.abs(endpoint.x - bounds.x - bounds.width)],
        ['bottom', Math.abs(endpoint.y - bounds.y - bounds.height)],
        ['left', Math.abs(endpoint.x - bounds.x)],
      ];
      const side = distances.toSorted((left, right) => left[1] - right[1])[0][0];
      const key = `${nodeId}\u0000${side}`;
      groups.set(key, [...(groups.get(key) ?? []), { path, role, side, bounds, endpoint }]);
    }
  }
  const assignments = new Map<
    SVGPathElement,
    { source?: CardinalAttachment; target?: CardinalAttachment }
  >();
  for (const uses of groups.values()) {
    if (uses.length < 2) continue;
    const side = uses[0].side;
    const horizontal = side === 'top' || side === 'bottom';
    const sorted = uses.toSorted(
      (left, right) =>
        (horizontal ? left.endpoint.x - right.endpoint.x : left.endpoint.y - right.endpoint.y) ||
        left.path.id.localeCompare(right.path.id) ||
        left.role.localeCompare(right.role),
    );
    const span = (horizontal ? uses[0].bounds.width : uses[0].bounds.height) * 0.6;
    const gap = Math.min(FLOWCHART_PORT_SLOT_GAP, span / Math.max(1, uses.length - 1));
    sorted.forEach((use, index) => {
      const offset = (index - (uses.length - 1) / 2) * gap;
      const center = boundsPort(use.bounds, side);
      const point = horizontal
        ? { x: center.x + offset, y: center.y }
        : { x: center.x, y: center.y + offset };
      const assignment = assignments.get(use.path) ?? {};
      assignment[use.role] = { point, side };
      assignments.set(use.path, assignment);
    });
  }
  for (const [path, assignment] of assignments) {
    const points = (path.dataset.manhattanPoints ?? '')
      .trim()
      .split(/\s+/)
      .map((point) => point.split(',').map(Number))
      .filter((point) => point.length === 2 && point.every(Number.isFinite))
      .map(([x, y]) => ({ x, y }));
    if (points.length < 2) continue;
    const routed = attachCardinalPorts(points, assignment.source, assignment.target);
    path.dataset.manhattanPoints = routed.map(({ x, y }) => `${x},${y}`).join(' ');
    if (assignment.source) {
      path.dataset.crowdedSourcePort = `${assignment.source.point.x},${assignment.source.point.y}`;
    }
    if (assignment.target) {
      path.dataset.crowdedTargetPort = `${assignment.target.point.x},${assignment.target.point.y}`;
    }
    path.setAttribute(
      'd',
      routed.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join(''),
    );
  }
}

export function snapFlowchartDiamondPorts(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  spreadCrowdedFlowchartPorts(svg);
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const diamondAttachments = allocateDiamondAttachments(svg, paths);
  for (const path of paths) {
    if (path.dataset.nestedDecisionRoute || path.dataset.decisionCycleRoute) continue;
    const identity = flowchartEdgeIdentity(path);
    const sourceNode = identity && flowchartNode(svg, identity.source);
    const targetNode = identity && flowchartNode(svg, identity.target);
    const sourceShape = sourceNode && shapeForNode(sourceNode);
    const targetShape = targetNode && shapeForNode(targetNode);
    const points = (path.dataset.manhattanPoints ?? '')
      .trim()
      .split(/\s+/)
      .map((point) => point.split(',').map(Number))
      .filter((point) => point.length === 2 && point.every(Number.isFinite))
      .map(([x, y]) => ({ x, y }));
    if (points.length < 2) continue;
    let sourceAttachment: CardinalAttachment | undefined;
    let targetAttachment: CardinalAttachment | undefined;
    const labelText = flowchartLabelForPath(svg, path)?.textContent?.trim().toLocaleLowerCase();
    if (sourceShape && isDiamondShape(sourceShape)) {
      const bounds = boundsInPathSpace(sourceShape, path);
      const attachment = diamondAttachments.get(path)?.source;
      if (bounds && attachment) {
        const origin = pointAt(bounds, 0.5, 0.5);
        const inferredSide = cardinalSideFromDirection(origin, points[1]);
        const { side } = attachment;
        if (labelText === 'no' && inferredSide !== side && points.length > 2) {
          const lane = points
            .slice(1)
            .map((end, index) => ({
              index,
              length:
                Math.abs(points[index].y - end.y) < 0.001 ? Math.abs(points[index].x - end.x) : 0,
            }))
            .toSorted((left, right) => right.length - left.length)[0];
          if (lane?.length) {
            const offset = (points[lane.index].y >= origin.y ? 1 : -1) * FLOWCHART_PORT_SLOT_GAP;
            points[lane.index].y += offset;
            points[lane.index + 1].y += offset;
            path.dataset.decisionLane = String(points[lane.index].y);
          }
        }
        const { point } = attachment;
        sourceAttachment = attachment;
        path.dataset.diamondSourcePort = `${point.x},${point.y}`;
        path.dataset.diamondSourceSide = side;
        if (path.dataset.decisionBranch) path.dataset.decisionPort = `${point.x},${point.y}`;
      }
    }
    if (targetShape && isDiamondShape(targetShape)) {
      const attachment = diamondAttachments.get(path)?.target;
      if (attachment) {
        const { side } = attachment;
        const { point } = attachment;
        targetAttachment = attachment;
        if (targetNode) {
          path.dataset.diamondTargetPort = `${point.x},${point.y}`;
          path.dataset.diamondTargetSide = side;
          path.dataset.terminalTarget = targetNode.id;
        }
      }
    }
    const routed = attachCardinalPorts(points, sourceAttachment, targetAttachment);
    const previous = routed[routed.length - 2];
    const endpoint = routed[routed.length - 1];
    if (targetAttachment) {
      path.dataset.terminalDirection = `${endpoint.x - previous.x},${endpoint.y - previous.y}`;
    }
    path.dataset.manhattanPoints = routed.map(({ x, y }) => `${x},${y}`).join(' ');
    path.dataset.manhattanSegments = String(routed.length - 1);
    path.setAttribute(
      'd',
      routed.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join(''),
    );
    if (!path.dataset.compactFlowchart) {
      placeFlowchartLabelOnRoute(flowchartLabelForPath(svg, path), path, routed);
    }
  }
}

/** A bounded downstream alternative; overlapping targets need an outside-left approach. */
export function buildDownstreamFanoutRoutes(
  source: Bounds,
  targets: { bounds: Bounds; port: Point; tail?: Point[] }[],
  obstacles: Bounds[],
  occupied: Bounds[],
): Point[][] | null {
  const clearance = 8;
  const start = boundsPort(source, 'right');
  if (
    targets.length !== 2 ||
    [source, ...targets.map(({ bounds }) => bounds), ...obstacles, ...occupied].some(
      (bounds) =>
        !Object.values(bounds).every(Number.isFinite) || bounds.width < 0 || bounds.height < 0,
    ) ||
    targets.some(
      ({ bounds, port }) =>
        !Number.isFinite(port.x) ||
        !Number.isFinite(port.y) ||
        bounds.y < source.y + source.height + 32 ||
        (!(
          Math.abs(port.x - bounds.x) < 0.001 &&
          Math.abs(port.y - bounds.y - bounds.height / 2) < 0.001
        ) &&
          (port.x <= start.x + 16 ||
            Math.abs(port.y - bounds.y) > 0.001 ||
            port.x < bounds.x + clearance ||
            port.x > bounds.x + bounds.width - clearance)),
    )
  )
    return null;
  const trunk = { x: start.x + 16, y: start.y };
  const proposed: Point[][] = [];
  for (const { bounds, port, tail } of targets) {
    const leftEntry = Math.abs(port.x - bounds.x) < 0.001;
    const candidates = leftEntry
      ? [
          [
            start,
            trunk,
            { x: trunk.x, y: source.y + source.height + 16 },
            { x: bounds.x - 16, y: source.y + source.height + 16 },
            { x: bounds.x - 16, y: port.y },
            port,
          ],
        ]
      : [
          ...(tail?.length === 2 &&
          Math.abs(tail[0].x - port.x) < 0.001 &&
          tail[0].y >= source.y + source.height + clearance &&
          tail[0].y <= bounds.y - 16
            ? [[start, trunk, { x: trunk.x, y: tail[0].y }, tail[0], port]]
            : []),
          [start, trunk, { x: trunk.x, y: bounds.y - 32 }, { x: port.x, y: bounds.y - 32 }, port],
        ];
    const points = candidates.map(simplifyOrthogonalPoints).find((candidate) =>
      segments(candidate).every((segment, index) => {
        if (
          Math.abs(segment.start.x - segment.end.x) >= 0.001 &&
          Math.abs(segment.start.y - segment.end.y) >= 0.001
        )
          return false;
        return (
          ![...obstacles, ...occupied].some((other) =>
            segmentCrossesBounds(segment, other, clearance),
          ) &&
          !segmentCrossesBounds(segment, source, index === 0 ? 0 : clearance) &&
          !targets.some(({ bounds: other }) =>
            segmentCrossesBounds(
              segment,
              other,
              other === bounds && index === candidate.length - 2 ? 0 : clearance,
            ),
          )
        );
      }),
    );
    if (!points) return null;
    proposed.push(points);
  }
  // Branches may share only their initial trunk; they must not meet again after splitting.
  const [left, right] = proposed.map(segments);
  let shared = 0;
  while (shared < Math.min(left.length, right.length)) {
    const a = left[shared];
    const b = right[shared];
    if (Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) > 0.001) break;
    if (Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) > 0.001) {
      if (overlappingSegments(a, b)) {
        const shorter =
          Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y) <
          Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y)
            ? a
            : b;
        if (shorter === a) right[shared] = { start: a.end, end: b.end };
        else left[shared] = { start: b.end, end: a.end };
      }
      break;
    }
    shared++;
  }
  for (const a of left.slice(shared))
    for (const b of right.slice(shared)) {
      if (overlappingSegments(a, b)) return null;
      const horizontal = Math.abs(a.start.y - a.end.y) < 0.001;
      const otherHorizontal = Math.abs(b.start.y - b.end.y) < 0.001;
      if (horizontal === otherHorizontal) continue;
      const h = horizontal ? a : b;
      const v = horizontal ? b : a;
      if (
        v.start.x > Math.min(h.start.x, h.end.x) + 0.001 &&
        v.start.x < Math.max(h.start.x, h.end.x) - 0.001 &&
        h.start.y > Math.min(v.start.y, v.end.y) + 0.001 &&
        h.start.y < Math.max(v.start.y, v.end.y) - 0.001
      )
        return null;
    }
  return proposed;
}

function routeDownstreamFanout(
  svg: SVGSVGElement,
  sourceId: string,
  branches: { path: SVGPathElement; target: string }[],
) {
  if (
    branches.length !== 2 ||
    svg.querySelector('g.cluster') ||
    branches.some(({ path }) => path.dataset.compactFlowchart || path.dataset.feedbackLane)
  )
    return;
  const reference = branches[0].path;
  const matrix = reference.getScreenCTM();
  if (
    !matrix ||
    matrix.a <= 0 ||
    matrix.d <= 0 ||
    Math.abs(matrix.b) > 0.001 ||
    Math.abs(matrix.c) > 0.001
  )
    return;
  const inverse = matrix.inverse();
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => {
    const shape = shapeForNode(node);
    return {
      id: flowchartNodeId(node),
      shape,
      bounds: shape && boundsInPathSpace(shape, reference),
    };
  });
  if (
    nodes.some(({ bounds }) => !bounds) ||
    new Set(nodes.map(({ id }) => id)).size !== nodes.length
  )
    return;
  const source = nodes.find(({ id }) => id === sourceId);
  if (!source?.bounds || source.shape?.tagName.toLowerCase() !== 'rect') return;
  const otherPaths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].filter(
    (path) => !branches.some((branch) => branch.path === path),
  );
  const samples = otherPaths.map((path) => {
    const otherMatrix = path.getScreenCTM();
    const length = path.getTotalLength();
    if (!otherMatrix || !length || !Number.isFinite(length) || length > 16384) return null;
    const count = Math.ceil(length / 2);
    return {
      path,
      points: Array.from({ length: count + 1 }, (_, i) =>
        path
          .getPointAtLength((length * i) / count)
          .matrixTransform(otherMatrix)
          .matrixTransform(inverse),
      ),
    };
  });
  if (samples.some((sample) => !sample)) return;
  const occupied = samples.flatMap((sample) =>
    segments(sample!.points).map(({ start, end }) => ({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    })),
  );
  const targets = branches.map(({ path, target }) => {
    const node = nodes.find(({ id }) => id === target);
    const pathMatrix = path.getScreenCTM();
    if (
      !node?.bounds ||
      node.shape?.tagName.toLowerCase() !== 'rect' ||
      !pathMatrix ||
      (['a', 'b', 'c', 'd', 'e', 'f'] as const).some(
        (key) => Math.abs(pathMatrix[key] - matrix[key]) > 0.001,
      )
    )
      return null;
    const bounds = node.bounds;
    const inbound = samples.filter(
      (sample) => flowchartEdgeIdentity(sample!.path)?.target === target,
    );
    // Only an unambiguous right-side top ingress can share this target with the new left slot.
    if (
      inbound.length > 1 ||
      (inbound.length && bounds.width * 0.6 < FLOWCHART_PORT_SLOT_GAP) ||
      inbound.some((sample) => {
        const end = sample!.points.at(-1)!;
        return Math.abs(end.y - bounds.y) > 8 || end.x < bounds.x + bounds.width / 2;
      })
    )
      return null;
    const port =
      bounds.x <= source.bounds!.x + source.bounds!.width + 16
        ? boundsPort(bounds, 'left')
        : {
            x: bounds.x + bounds.width / 2 - (inbound.length ? FLOWCHART_PORT_SLOT_GAP / 2 : 0),
            y: bounds.y,
          };
    const logical = path.dataset.manhattanPoints
      ?.split(' ')
      .map((point, i) => `${i ? 'L' : 'M'}${point}`)
      .join('');
    const original = parseOrthogonalLinePath(logical ?? path.getAttribute('d') ?? '');
    const tail = original?.slice(-2);
    return {
      bounds,
      port,
      tail:
        tail && Math.abs(tail[0].x - port.x) < 0.001 && Math.abs(tail[1].y - port.y) < 0.001
          ? [tail[0], port]
          : undefined,
    };
  });
  if (targets.some((target) => !target)) return;
  const labels = branches.map(({ path }) => flowchartLabelForPath(svg, path));
  const otherLabels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
    .filter((label) => label.textContent?.trim() && !labels.includes(label))
    .map((label) => clientBoundsInPathSpace(label, reference));
  if (otherLabels.some((bounds) => !bounds)) return;
  const obstacles = [
    ...nodes
      .filter(
        (node) => node !== source && !targets.some((target) => target!.bounds === node.bounds),
      )
      .map((node) => node.bounds!),
    ...(otherLabels as Bounds[]),
  ];
  const routes = buildDownstreamFanoutRoutes(
    source.bounds,
    targets as NonNullable<(typeof targets)[number]>[],
    obstacles,
    occupied,
  );
  if (!routes) return;
  const placements: {
    label: SVGGElement;
    transform: string;
    center: Point;
    segment: Segment;
    bounds: Bounds;
  }[] = [];
  for (const [index, label] of labels.entries()) {
    if (!label?.textContent?.trim()) continue;
    const bounds = clientBoundsInPathSpace(label, reference);
    const parentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getScreenCTM();
    if (!bounds || !parentMatrix) return;
    const segment = segments(routes[index]).find((segment) => {
      const center = {
        x: (segment.start.x + segment.end.x) / 2,
        y: (segment.start.y + segment.end.y) / 2,
      };
      const box = {
        x: center.x - bounds.width / 2,
        y: center.y - bounds.height / 2,
        width: bounds.width,
        height: bounds.height,
      };
      const horizontal = Math.abs(segment.start.y - segment.end.y) < 0.001;
      return (
        Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y) >=
          (horizontal ? bounds.width : bounds.height) + 16 &&
        ![
          ...nodes.map((node) => node.bounds!),
          ...(otherLabels as Bounds[]),
          ...occupied,
          ...placements.map((placement) => placement.bounds),
        ].some((other) => boundsOverlap(box, other, 8)) &&
        !routes
          .filter((_, i) => i !== index)
          .some((other) => segments(other).some((s) => segmentCrossesBounds(s, box, 8)))
      );
    });
    if (!segment) return;
    const center = {
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2,
    };
    const local = label.getBBox();
    const parentCenter = new DOMPoint(center.x, center.y)
      .matrixTransform(matrix)
      .matrixTransform(parentMatrix.inverse());
    placements.push({
      label,
      center,
      segment,
      bounds: {
        x: center.x - bounds.width / 2,
        y: center.y - bounds.height / 2,
        width: bounds.width,
        height: bounds.height,
      },
      transform: `translate(${parentCenter.x - local.x - local.width / 2}, ${parentCenter.y - local.y - local.height / 2})`,
    });
  }
  routes.forEach((points, index) => {
    const { path, target } = branches[index];
    path.setAttribute('d', points.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x},${y}`).join(''));
    delete path.dataset.terminalGapBasePath;
    path.dataset.fanoutSource = sourceId;
    path.dataset.fanoutTarget = target;
    path.dataset.fanoutTrunk = points
      .slice(0, 2)
      .map(({ x, y }) => `${x},${y}`)
      .join(' ');
    path.dataset.manhattanPoints = points.map(({ x, y }) => `${x},${y}`).join(' ');
  });
  placements.forEach(({ label, transform, center, segment }) => {
    label.setAttribute('transform', transform);
    const path = branches[labels.indexOf(label)].path;
    label.dataset.routePathId = path.id;
    label.dataset.finalPathCenter = `${center.x},${center.y}`;
    path.dataset.labelSegment = `${segment.start.x},${segment.start.y} ${segment.end.x},${segment.end.y}`;
  });
}

export function routeFlowchartCenteredFanouts(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const edges = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].flatMap((path) => {
    const identity = flowchartEdgeIdentity(path);
    return identity ? [{ path, ...identity }] : [];
  });
  const bySource = new Map<string, typeof edges>();
  for (const edge of edges) bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge]);
  for (const [sourceId, branches] of bySource) {
    if (branches.length < 2) continue;
    const sourceNode = flowchartNode(svg, sourceId);
    if (!sourceNode) continue;
    if (sourceNode.querySelector(':scope > polygon.label-container')) continue;
    const routes = branches.flatMap((branch) => {
      const source = flowchartNodeBounds(sourceNode);
      const targetNode = flowchartNode(svg, branch.target);
      const target = targetNode && flowchartNodeBounds(targetNode);
      return source && target ? [{ ...branch, targetId: branch.target, source, target }] : [];
    });
    if (routes.length !== branches.length) continue;
    if (new Set(routes.map(({ targetId }) => targetId)).size !== routes.length) continue;
    const sourceRight = routes[0].source.x + routes[0].source.width;
    const sourceBottom = routes[0].source.y + routes[0].source.height;
    const sameDownstreamRank =
      routes.length === 3 &&
      routes.every((route) => route.target.y >= sourceBottom + 16) &&
      Math.max(...routes.map((route) => route.target.y)) -
        Math.min(...routes.map((route) => route.target.y)) <=
        8;
    if (sameDownstreamRank) {
      const ordered = routes.toSorted(
        (left, right) =>
          left.target.x + left.target.width / 2 - (right.target.x + right.target.width / 2),
      );
      const source = ordered[0].source;
      const sourceCenterY = source.y + source.height / 2;
      const starts = [
        { x: source.x, y: sourceCenterY },
        { x: source.x + source.width / 2, y: sourceBottom },
        { x: sourceRight, y: sourceCenterY },
      ];
      ordered.forEach((route, index) => {
        const start = starts[index];
        const outward =
          index === 0
            ? { x: start.x - 16, y: start.y }
            : index === 1
              ? { x: start.x, y: start.y + 16 }
              : { x: start.x + 16, y: start.y };
        const targetX = route.target.x + route.target.width / 2;
        const targetY = route.target.y;
        const laneY = targetY - 16;
        const points = [outward, { x: outward.x, y: laneY }, { x: targetX, y: laneY }];
        points.unshift(start);
        points.push({ x: targetX, y: targetY });
        route.path.setAttribute(
          'd',
          points
            .map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${point.x},${point.y}`)
            .join(''),
        );
        route.path.dataset.fanoutSource = sourceId;
        route.path.dataset.fanoutTarget = route.targetId;
        route.path.dataset.fanoutPort = `${start.x},${start.y}`;
        route.path.dataset.fanoutTrunk = `${start.x},${start.y} ${outward.x},${outward.y}`;
        route.path.dataset.manhattanPoints = points
          .map((point) => `${point.x},${point.y}`)
          .join(' ');
        placeFlowchartLabelOnRoute(flowchartLabelForPath(svg, route.path), route.path, points);
      });
      continue;
    }
    if (routes.some((route) => route.target.x <= sourceRight + 16)) {
      routeDownstreamFanout(svg, sourceId, branches);
      continue;
    }
    const firstTargetX = Math.min(...routes.map((route) => route.target.x));
    const trunkX = sourceRight + Math.min(36, Math.max(16, (firstTargetX - sourceRight) / 2));
    const sourceY = routes[0].source.y + routes[0].source.height / 2;
    for (const route of routes) {
      const targetY = route.target.y + route.target.height / 2;
      const points = [
        { x: sourceRight, y: sourceY },
        { x: trunkX, y: sourceY },
        { x: trunkX, y: targetY },
        { x: route.target.x, y: targetY },
      ];
      route.path.setAttribute(
        'd',
        points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
      );
      route.path.dataset.fanoutSource = sourceId;
      route.path.dataset.fanoutTarget = route.targetId;
      route.path.dataset.fanoutTrunk = `${sourceRight},${sourceY} ${trunkX},${sourceY}`;
      route.path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
    }
  }
}

function placeDecisionLabel(label: SVGGElement, path: SVGPathElement, start: Point, end: Point) {
  if (!label.textContent?.trim()) return;
  const previousTransform = label.getAttribute('transform');
  label.removeAttribute('transform');
  const local = label.getBBox();
  if (previousTransform) label.setAttribute('transform', previousTransform);
  const pathMatrix = path.getCTM();
  const labelParentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getCTM();
  if (!pathMatrix || !labelParentMatrix) return;
  const midpoint = {
    x: start.x + (end.x - start.x) * 0.55,
    y: start.y + (end.y - start.y) * 0.55,
  };
  const center = new DOMPoint(midpoint.x, midpoint.y)
    .matrixTransform(pathMatrix)
    .matrixTransform(labelParentMatrix.inverse());
  label.setAttribute(
    'transform',
    `translate(${center.x - local.x - local.width / 2}, ${center.y - local.y - local.height / 2})`,
  );
  label.dataset.finalPathCenter = `${midpoint.x},${midpoint.y}`;
  label.dataset.routePathId = path.id;
  path.dataset.labelSegment = `${start.x},${start.y} ${end.x},${end.y}`;
}

type FlowchartRoute = {
  path: SVGPathElement;
  source: string;
  target: string;
  label?: SVGGElement;
};

function setFlowchartNodeCenter(node: SVGGElement, center: Point, referencePath: SVGPathElement) {
  const shape = shapeForNode(node);
  const current = shape && boundsInPathSpace(shape, referencePath);
  const matrix = node.transform.baseVal.consolidate()?.matrix;
  if (!current || !matrix) return;
  node.style.setProperty('transition-property', 'none', 'important');
  node.setAttribute(
    'transform',
    `translate(${matrix.e + center.x - current.x - current.width / 2}, ${matrix.f + center.y - current.y - current.height / 2})`,
  );
}

function reframeFlowchartClusters(
  records: Array<{
    cluster: SVGGElement;
    rect: SVGRectElement;
    label: SVGGElement;
    frame: Bounds;
    members: SVGGElement[];
  }>,
  referencePath: SVGPathElement,
) {
  const layouts = new Map<SVGGElement, Bounds>();
  for (const record of records.toSorted(
    (left, right) => left.frame.width * left.frame.height - right.frame.width * right.frame.height,
  )) {
    const children = records
      .filter(
        (candidate) =>
          candidate !== record &&
          candidate.frame.x >= record.frame.x &&
          candidate.frame.y >= record.frame.y &&
          candidate.frame.x + candidate.frame.width <= record.frame.x + record.frame.width &&
          candidate.frame.y + candidate.frame.height <= record.frame.y + record.frame.height,
      )
      .flatMap(({ cluster }) => {
        const bounds = layouts.get(cluster);
        return bounds ? [bounds] : [];
      });
    const content = [
      ...record.members.flatMap((node) => {
        const shape = shapeForNode(node);
        const bounds = shape && boundsInPathSpace(shape, referencePath);
        return bounds ? [bounds] : [];
      }),
      ...children,
    ];
    if (!content.length) continue;
    const headerHeight =
      Number(record.cluster.dataset.headerHeight) || measuredClusterHeaderHeight(18);
    const x = Math.min(...content.map((bounds) => bounds.x)) - 24;
    const y = Math.min(...content.map((bounds) => bounds.y)) - headerHeight;
    const right = Math.max(...content.map((bounds) => bounds.x + bounds.width)) + 24;
    const bottom = Math.max(...content.map((bounds) => bounds.y + bounds.height)) + 24;
    const frame = { x, y, width: right - x, height: bottom - y };
    record.rect.style.setProperty('transition-property', 'none', 'important');
    for (const [attribute, value] of Object.entries(frame)) {
      record.rect.setAttribute(attribute, String(value));
    }
    const viewport = record.label.querySelector<SVGForeignObjectElement>('foreignObject');
    if (viewport) {
      viewport.setAttribute('x', '0');
      viewport.setAttribute('y', '0');
      viewport.setAttribute('width', String(Math.max(24, frame.width - CLUSTER_TITLE_INSET * 2)));
      record.label.setAttribute(
        'transform',
        `translate(${frame.x + CLUSTER_TITLE_INSET}, ${frame.y + CLUSTER_TITLE_INSET})`,
      );
    } else {
      const title = record.label.getBBox();
      record.label.setAttribute(
        'transform',
        `translate(${frame.x + frame.width / 2 - title.x - title.width / 2}, ${frame.y + CLUSTER_TITLE_INSET - title.y})`,
      );
    }
    layouts.set(record.cluster, frame);
  }
}

function routeNestedDecisionHierarchy(svg: SVGSVGElement, edges: FlowchartRoute[]) {
  if (svg.querySelectorAll('g.cluster').length < 2) return false;
  const referencePath = edges[0]?.path;
  if (!referencePath) return false;
  const nodeBounds = (node: SVGGElement | undefined) => {
    const shape = node && shapeForNode(node);
    return shape ? boundsInPathSpace(shape, referencePath) : null;
  };
  const topology = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((decisionNode) => {
    const decisionId = flowchartNodeId(decisionNode);
    const shape = shapeForNode(decisionNode);
    if (!shape || !isDiamondShape(shape)) return [];
    const outgoing = edges.filter(
      (edge) => edge.source === decisionId && edge.target !== decisionId,
    );
    const secondary = outgoing.find((edge) =>
      edges.some(
        (candidate) => candidate.source === edge.target && candidate.target === decisionId,
      ),
    )?.target;
    if (!secondary) return [];
    const merge = outgoing.find(
      (edge) =>
        edge.target !== secondary &&
        edges.some(
          (candidate) => candidate.source === secondary && candidate.target === edge.target,
        ) &&
        edges.some(
          (candidate) => candidate.source === edge.target && candidate.target === edge.target,
        ),
    )?.target;
    if (!merge) return [];
    const ingressBySource = new Map<string, FlowchartRoute[]>();
    for (const edge of edges.filter(
      (edge) => edge.target === decisionId && edge.source !== secondary,
    )) {
      ingressBySource.set(edge.source, [...(ingressBySource.get(edge.source) ?? []), edge]);
    }
    const ingress = [...ingressBySource.values()].find((group) => group.length >= 2);
    const branches = edges.filter((edge) => edge.source === decisionId && edge.target === merge);
    const add = edges.find((edge) => edge.source === decisionId && edge.target === secondary);
    const retry = edges.find((edge) => edge.source === secondary && edge.target === decisionId);
    const done = edges.find((edge) => edge.source === secondary && edge.target === merge);
    const loop = edges.find((edge) => edge.source === merge && edge.target === merge);
    const downstream = edges.find((edge) => edge.source === merge && edge.target !== merge);
    if (!ingress || branches.length < 2 || !add || !retry || !done || !loop || !downstream)
      return [];
    return [
      { decisionId, secondary, merge, ingress, branches, add, retry, done, loop, downstream },
    ];
  })[0];
  if (!topology) return false;

  const intakeId = topology.ingress[0].source;
  const registryId = topology.downstream.target;
  const involvedIds = new Set([
    topology.decisionId,
    topology.secondary,
    topology.merge,
    intakeId,
    registryId,
  ]);
  const allNodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  const nodes = new Map(
    allNodes
      .filter((node) => involvedIds.has(flowchartNodeId(node)))
      .map((node) => [flowchartNodeId(node), node]),
  );
  if (nodes.size !== involvedIds.size) return false;
  const clusterRecords = [...svg.querySelectorAll<SVGGElement>('g.cluster')].flatMap((cluster) => {
    const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
    const label = cluster.querySelector<SVGGElement>(':scope > g.cluster-label');
    if (!rect || !label) return [];
    const frame = boundsInPathSpace(rect, referencePath);
    if (!frame) return [];
    const members = allNodes.filter((node) => {
      const bounds = nodeBounds(node);
      if (!bounds) return false;
      const center = pointAt(bounds, 0.5, 0.5);
      return (
        center.x >= frame.x &&
        center.x <= frame.x + frame.width &&
        center.y >= frame.y &&
        center.y <= frame.y + frame.height
      );
    });
    return [{ cluster, rect, label, frame, members }];
  });
  const innerCluster = clusterRecords
    .filter((record) =>
      record.members.some((node) => flowchartNodeId(node) === topology.decisionId),
    )
    .toSorted(
      (left, right) =>
        left.frame.width * left.frame.height - right.frame.width * right.frame.height,
    )[0];
  const outerCluster = innerCluster
    ? clusterRecords
        .filter(
          (record) =>
            record !== innerCluster &&
            innerCluster.frame.x >= record.frame.x &&
            innerCluster.frame.y >= record.frame.y &&
            innerCluster.frame.x + innerCluster.frame.width <=
              record.frame.x + record.frame.width &&
            innerCluster.frame.y + innerCluster.frame.height <=
              record.frame.y + record.frame.height,
        )
        .toSorted(
          (left, right) =>
            left.frame.width * left.frame.height - right.frame.width * right.frame.height,
        )[0]
    : undefined;
  const addClusterMember = (record: (typeof clusterRecords)[number] | undefined, id: string) => {
    const node = nodes.get(id);
    if (record && node && !record.members.includes(node)) record.members.push(node);
  };
  addClusterMember(innerCluster, topology.decisionId);
  addClusterMember(innerCluster, topology.secondary);
  addClusterMember(outerCluster, intakeId);
  addClusterMember(outerCluster, topology.merge);
  const bounds = new Map(
    [...nodes].flatMap(([id, node]) => {
      const value = nodeBounds(node);
      return value ? [[id, value] as const] : [];
    }),
  );
  if (bounds.size !== nodes.size) return false;
  const compact = edges.some(({ path }) => path.dataset.compactFlowchart === 'true');
  const layout = compact ? 'compact' : 'wide';
  const shouldPlaceNodes = svg.dataset.nestedDecisionLayout !== layout;
  const intake = bounds.get(intakeId)!;
  const decision = bounds.get(topology.decisionId)!;
  const secondary = bounds.get(topology.secondary)!;
  const merge = bounds.get(topology.merge)!;
  const registry = bounds.get(registryId)!;
  const centers = compact
    ? (() => {
        const x = pointAt(decision, 0.5, 0.5).x;
        const y = pointAt(intake, 0.5, 0.5).y;
        const step = Math.max(intake.height, decision.height, merge.height, registry.height) + 94;
        return {
          intake: { x, y },
          decision: { x, y: y + step },
          secondary: { x: x + secondary.width / 2, y: y + step * 1.5 },
          merge: { x, y: y + step * 2 },
          registry: { x, y: y + step * 3 },
        };
      })()
    : (() => {
        const y = pointAt(decision, 0.5, 0.5).y;
        const intakeX = pointAt(intake, 0.5, 0.5).x;
        const decisionX = intakeX + intake.width / 2 + decision.width / 2 + 116;
        const mergeX = decisionX + decision.width / 2 + merge.width / 2 + 184;
        return {
          intake: { x: intakeX, y },
          decision: { x: decisionX, y },
          secondary: { x: (decisionX + mergeX) / 2 + 8, y: y + 95 },
          merge: { x: mergeX, y },
          registry: {
            x: mergeX + merge.width / 2 + registry.width / 2 + 124,
            y,
          },
        };
      })();
  if (shouldPlaceNodes) {
    for (const [id, center] of [
      [intakeId, centers.intake],
      [topology.decisionId, centers.decision],
      [topology.secondary, centers.secondary],
      [topology.merge, centers.merge],
      [registryId, centers.registry],
    ] as const) {
      setFlowchartNodeCenter(nodes.get(id)!, center, referencePath);
    }
    svg.dataset.nestedDecisionLayout = layout;
  }
  reframeFlowchartClusters(clusterRecords, referencePath);

  const current = (id: string) => nodeBounds(nodes.get(id))!;
  const i = current(intakeId);
  const d = current(topology.decisionId);
  const s = current(topology.secondary);
  const m = current(topology.merge);
  const r = current(registryId);
  const [primaryIngress, metadataIngress] = topology.ingress;
  const [primaryBranch, returnBranch] = topology.branches;
  const routes: Array<{
    edge: FlowchartRoute;
    role: string;
    points: Point[];
    labelSegment?: number;
    sourceSide?: CardinalSide;
    targetSide?: CardinalSide;
  }> = [];
  if (compact) {
    const outerLeft = Math.min(i.x, d.x, m.x, r.x) - 16;
    const addLane = Math.max(d.x + d.width, s.x + s.width) + 12;
    const outerRight = addLane + 20;
    const ingressTarget = diamondBoundaryPort(d, 'top', -8);
    const metadataTarget = diamondBoundaryPort(d, 'left', -8);
    const retryTarget = diamondBoundaryPort(d, 'top', 8);
    const branchSource = diamondBoundaryPort(d, 'bottom', -8);
    const returnSource = diamondBoundaryPort(d, 'left', 8);
    routes.push(
      {
        edge: primaryIngress,
        role: 'primary-ingress',
        points: [
          pointAt(i, 0.5, 1),
          { x: ingressTarget.x, y: pointAt(i, 0.5, 1).y },
          ingressTarget,
        ],
        targetSide: 'top',
      },
      {
        edge: metadataIngress,
        role: 'metadata-return',
        points: [
          pointAt(i, 0, 0.55),
          { x: outerLeft - 22, y: pointAt(i, 0, 0.55).y },
          { x: outerLeft - 22, y: metadataTarget.y },
          metadataTarget,
        ],
        labelSegment: 1,
        targetSide: 'left',
      },
      {
        edge: topology.add,
        role: 'secondary-add',
        points: [
          diamondBoundaryPort(d, 'right', -8),
          { x: addLane, y: diamondBoundaryPort(d, 'right', -8).y },
          { x: addLane, y: pointAt(s, 1, 0.35).y },
          pointAt(s, 1, 0.35),
        ],
        labelSegment: 1,
        sourceSide: 'right',
      },
      {
        edge: topology.retry,
        role: 'secondary-retry',
        points: [
          pointAt(s, 1, 0.68),
          { x: outerRight, y: pointAt(s, 1, 0.68).y },
          { x: outerRight, y: d.y - 24 },
          { x: retryTarget.x, y: d.y - 24 },
          retryTarget,
        ],
        labelSegment: 1,
        targetSide: 'top',
      },
      {
        edge: primaryBranch,
        role: 'primary-branch',
        points: [
          branchSource,
          { x: branchSource.x, y: d.y + d.height + 12 },
          { x: branchSource.x - 16, y: d.y + d.height + 12 },
          { x: branchSource.x - 16, y: m.y - 12 },
          { x: pointAt(m, 0.42, 0).x, y: m.y - 12 },
          pointAt(m, 0.42, 0),
        ],
        labelSegment: 2,
        sourceSide: 'bottom',
      },
      {
        edge: returnBranch,
        role: 'decision-return',
        points: [
          returnSource,
          { x: outerLeft, y: returnSource.y },
          { x: outerLeft, y: pointAt(m, 0, 0.65).y },
          pointAt(m, 0, 0.65),
        ],
        labelSegment: 1,
        sourceSide: 'left',
      },
      {
        edge: topology.done,
        role: 'secondary-done',
        points: [
          pointAt(s, 1, 0.65),
          { x: s.x + s.width, y: pointAt(m, 1, 0.65).y },
          pointAt(m, 1, 0.65),
        ],
        labelSegment: 0,
      },
      {
        edge: topology.downstream,
        role: 'primary-save',
        points: [pointAt(m, 0.5, 1), pointAt(r, 0.5, 0)],
      },
    );
  } else {
    const metaY = Math.min(i.y, d.y) - 44;
    const retryY = s.y + s.height + 72;
    const ingressTarget = diamondBoundaryPort(d, 'left', -8);
    const metadataTarget = diamondBoundaryPort(d, 'top', -8);
    const branchSource = diamondBoundaryPort(d, 'right', -8);
    const returnSource = diamondBoundaryPort(d, 'right', 8);
    const returnTarget = { x: m.x, y: returnSource.y };
    const addSource = diamondBoundaryPort(d, 'bottom', -10);
    const retryTarget = diamondBoundaryPort(d, 'bottom', 10);
    const branchTarget = { x: m.x, y: branchSource.y };
    routes.push(
      {
        edge: primaryIngress,
        role: 'primary-ingress',
        points: [{ x: i.x + i.width, y: ingressTarget.y }, ingressTarget],
        targetSide: 'left',
      },
      {
        edge: metadataIngress,
        role: 'metadata-return',
        points: [
          pointAt(i, 0.5, 0),
          { x: pointAt(i, 0.5, 0).x, y: metaY },
          { x: metadataTarget.x, y: metaY },
          metadataTarget,
        ],
        labelSegment: 1,
        targetSide: 'top',
      },
      {
        edge: topology.add,
        role: 'secondary-add',
        points: [addSource, { x: addSource.x, y: pointAt(s, 0, 0.38).y }, pointAt(s, 0, 0.38)],
        labelSegment: 1,
        sourceSide: 'bottom',
      },
      {
        edge: topology.retry,
        role: 'secondary-retry',
        points: [
          pointAt(s, 0.38, 1),
          { x: pointAt(s, 0.38, 1).x, y: retryY },
          { x: retryTarget.x, y: retryY },
          retryTarget,
        ],
        labelSegment: 1,
        targetSide: 'bottom',
      },
      {
        edge: primaryBranch,
        role: 'primary-branch',
        points: [branchSource, branchTarget],
        sourceSide: 'right',
      },
      {
        edge: returnBranch,
        role: 'decision-return',
        points: [returnSource, returnTarget],
        sourceSide: 'right',
      },
      {
        edge: topology.done,
        role: 'secondary-done',
        points: [
          pointAt(s, 1, 0.62),
          { x: pointAt(m, 0.42, 1).x, y: pointAt(s, 1, 0.62).y },
          pointAt(m, 0.42, 1),
        ],
      },
      {
        edge: topology.downstream,
        role: 'primary-save',
        points: [pointAt(m, 1, 0.64), { x: r.x, y: pointAt(m, 1, 0.64).y }],
      },
    );
  }
  routes.push({
    edge: topology.loop,
    role: 'compact-loop',
    points: [
      pointAt(m, 1, 0.16),
      { x: m.x + m.width + 30, y: pointAt(m, 1, 0.16).y },
      { x: m.x + m.width + 30, y: pointAt(m, 1, 0.4).y },
      pointAt(m, 1, 0.4),
    ],
  });
  for (const { edge, role, points: rawPoints, labelSegment, sourceSide, targetSide } of routes) {
    const points = simplifyOrthogonalPoints(rawPoints);
    for (const key of [
      'feedbackLane',
      'fanoutSource',
      'groupedReturnLane',
      'decisionBranch',
      'decisionReturn',
      'clusterHeaderClearance',
      'compactGroupedRoute',
    ]) {
      delete edge.path.dataset[key];
    }
    edge.path.dataset.nestedDecisionRoute = role;
    if (role === 'compact-loop') edge.path.dataset.selfLoop = 'right';
    else delete edge.path.dataset.selfLoop;
    if (sourceSide) edge.path.dataset.diamondSourceSide = sourceSide;
    else delete edge.path.dataset.diamondSourceSide;
    if (targetSide) edge.path.dataset.diamondTargetSide = targetSide;
    else delete edge.path.dataset.diamondTargetSide;
    edge.path.dataset.manhattanPoints = points.map(({ x, y }) => `${x},${y}`).join(' ');
    edge.path.dataset.manhattanSegments = String(points.length - 1);
    edge.path.dataset.terminalTarget = nodes.get(edge.target)?.id ?? '';
    const terminal = points.at(-1)!;
    const adjacent = points.at(-2)!;
    edge.path.dataset.terminalDirection = `${terminal.x - adjacent.x},${terminal.y - adjacent.y}`;
    edge.path.setAttribute(
      'd',
      points.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x},${y}`).join(''),
    );
    placeFlowchartLabelOnRoute(edge.label, edge.path, points, labelSegment);
  }
  straightenClearFlowchartRoutes(svg, edges);
  return true;
}

/** A single reciprocal work branch off an otherwise linear directed flow.
 * Reject joins, extra branches and ambiguous cycles rather than inventing meaning.
 */
export function findFlowchartDecisionCycle(
  edges: Array<{ source: string; target: string }>,
  decisionIds: string[],
) {
  if (decisionIds.length !== 1) return null;
  const decision = decisionIds[0];
  const branches = edges.filter((edge) => edge.source === decision);
  if (branches.length !== 2) return null;
  const returning = branches.filter((branch) =>
    edges.some((edge) => edge.source === branch.target && edge.target === decision),
  );
  if (returning.length !== 1) return null;
  const retry = returning[0].target;
  if (
    retry === decision ||
    edges.filter((edge) => edge.source === retry || edge.target === retry).length !== 2
  )
    return null;
  const forward = edges.filter((edge) => edge.source !== retry && edge.target !== retry);
  const roots = forward.filter((edge) => !forward.some((other) => other.target === edge.source));
  if (roots.length !== 1) return null;
  const spine = [roots[0].source];
  while (true) {
    const outgoing = forward.filter((edge) => edge.source === spine.at(-1));
    if (!outgoing.length) break;
    if (outgoing.length !== 1 || spine.includes(outgoing[0].target)) return null;
    spine.push(outgoing[0].target);
  }
  if (
    spine.length !== forward.length + 1 ||
    spine.indexOf(decision) <= 0 ||
    spine.at(-1) === decision
  )
    return null;
  return { decision, retry, spine };
}

function routeVerticalDecisionCycle(svg: SVGSVGElement, edges: FlowchartRoute[]) {
  if (
    !['TD', 'TB'].includes(svg.dataset.flowchartDirection ?? '') ||
    svg.querySelector('g.cluster')
  )
    return false;
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  const topology = findFlowchartDecisionCycle(
    edges,
    nodes
      .filter((node) => {
        const shape = shapeForNode(node);
        return shape && isDiamondShape(shape);
      })
      .map(flowchartNodeId),
  );
  if (!topology || nodes.length !== topology.spine.length + 1) return false;
  const reference = edges[0].path;
  const boxes = new Map(
    nodes.flatMap((node) => {
      const shape = shapeForNode(node);
      const bounds = shape && boundsInPathSpace(shape, reference);
      return bounds ? [[flowchartNodeId(node), bounds] as const] : [];
    }),
  );
  if (boxes.size !== nodes.length) return false;
  const branch = edges.find(
    (edge) => edge.source === topology.decision && edge.target === topology.retry,
  )!;
  const branchLabel = branch.label?.getBBox();
  const root = boxes.get(topology.spine[0])!;
  const centerX = root.x + root.width / 2;
  let top = root.y;
  const compact = reference.dataset.compactFlowchart === 'true';
  for (const id of topology.spine) {
    const box = boxes.get(id)!;
    box.x = centerX - box.width / 2;
    box.y = top;
    top += box.height + (compact ? 100 : 64);
  }
  const decision = boxes.get(topology.decision)!;
  const retry = boxes.get(topology.retry)!;
  retry.x = decision.x + decision.width + Math.max(80, (branchLabel?.width ?? 0) + 48);
  retry.y = decision.y + (decision.height - retry.height) / 2;
  for (const node of nodes)
    setFlowchartNodeCenter(node, pointAt(boxes.get(flowchartNodeId(node))!, 0.5, 0.5), reference);
  for (const edge of edges) {
    const source = boxes.get(edge.source)!;
    const target = boxes.get(edge.target)!;
    const returning = edge.source === topology.retry;
    const branching = edge === branch;
    let points: Point[];
    if (returning) {
      // A separate upper-right diamond port keeps the return above the outgoing
      // label and entirely outside the continuation and the decision interior.
      const port = diamondBoundaryPort(target, 'right', -Math.min(32, target.height / 4));
      const shelf = Math.min(source.y, target.y) - 32;
      points = [
        pointAt(source, 0.5, 0),
        { x: source.x + source.width / 2, y: shelf },
        { x: target.x + target.width + 24, y: shelf },
        { x: target.x + target.width + 24, y: port.y },
        port,
      ];
    } else if (branching) {
      points = [pointAt(source, 1, 0.5), pointAt(target, 0, 0.5)];
    } else {
      points = [pointAt(source, 0.5, 1), pointAt(target, 0.5, 0)];
    }
    for (const key of [
      'feedbackLane',
      'fanoutSource',
      'fanoutPort',
      'parallelLane',
      'decisionBranch',
      'decisionReturn',
    ])
      delete edge.path.dataset[key];
    edge.path.dataset.decisionCycleRoute = returning ? 'return' : branching ? 'branch' : 'spine';
    edge.path.dataset.manhattanPoints = points.map(({ x, y }) => `${x},${y}`).join(' ');
    edge.path.dataset.manhattanSegments = String(points.length - 1);
    edge.path.setAttribute('d', points.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x},${y}`).join(''));
    placeFlowchartLabelOnRoute(edge.label, edge.path, points);
  }
  svg.dataset.decisionCycleLayout = 'vertical';
  return true;
}

export function routeFlowchartDecisionBranches(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
  const edges = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].flatMap(
    (path, index) => {
      const identity = flowchartEdgeIdentity(path);
      return identity ? [{ path, label: labels[index], ...identity }] : [];
    },
  );
  const referencePath = edges[0]?.path;
  if (!referencePath) return;
  if (routeNestedDecisionHierarchy(svg, edges)) return;
  if (routeVerticalDecisionCycle(svg, edges)) return;
  const nodeBounds = (node: SVGGElement | undefined) => {
    const shape = node && shapeForNode(node);
    return shape ? boundsInPathSpace(shape, referencePath) : null;
  };
  const occupied = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
    const bounds = nodeBounds(node);
    return bounds ? [bounds] : [];
  });
  for (const sourceId of new Set(edges.map(({ source }) => source))) {
    const sourceNode = flowchartNode(svg, sourceId);
    const source = nodeBounds(sourceNode);
    const branches = edges
      .filter(({ source }) => source === sourceId)
      .flatMap((edge) => {
        const targetNode = flowchartNode(svg, edge.target);
        const targetBounds = nodeBounds(targetNode);
        return targetBounds ? [{ ...edge, targetBounds }] : [];
      });
    if (
      !sourceNode?.querySelector(':scope > polygon.label-container') ||
      !source ||
      branches.length !== 2 ||
      !occupied.length
    )
      continue;
    const labeledBranches = branches.toSorted(
      (left, right) =>
        Number(right.label?.textContent?.trim() === 'Yes') -
        Number(left.label?.textContent?.trim() === 'Yes'),
    );
    if (
      new Set(labeledBranches.map(({ label }) => label?.textContent?.trim())).size !== 2 ||
      !labeledBranches.some(({ label }) => label?.textContent?.trim() === 'Yes') ||
      !labeledBranches.some(({ label }) => label?.textContent?.trim() === 'No')
    )
      continue;
    labeledBranches.forEach((edge, index) => {
      const branch = index === 0 ? 'upper' : 'lower';
      const compact = edge.path.dataset.compactFlowchart === 'true';
      const points = buildFlowchartDecisionBranchPoints(
        source,
        edge.targetBounds,
        branch,
        occupied,
        compact,
      );
      edge.path.setAttribute(
        'd',
        points
          .map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${point.x},${point.y}`)
          .join(''),
      );
      edge.path.dataset.decisionBranch = branch;
      edge.path.dataset.decisionSource = sourceId;
      edge.path.dataset.decisionTarget = edge.target;
      edge.path.dataset.decisionPort = `${points[0].x},${points[0].y}`;
      edge.path.dataset.decisionLane = String(points[1].x);
      edge.path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
      if (edge.label) {
        const shortLead = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) <= 12;
        placeDecisionLabel(
          edge.label,
          edge.path,
          shortLead && points[2] ? points[1] : points[0],
          shortLead && points[2] ? points[2] : points[1],
        );
      }
    });
    const branchTargets = new Set(labeledBranches.map(({ target }) => target));
    const returnEdge = edges.find(
      ({ source, target }) => branchTargets.has(source) && target === sourceId,
    );
    const returnSourceNode = returnEdge && flowchartNode(svg, returnEdge.source);
    const returnSource = nodeBounds(returnSourceNode);
    if (!returnEdge || !returnSource) continue;
    const points = buildFlowchartDecisionReturnPoints(
      returnSource,
      source,
      occupied,
      returnEdge.path.dataset.compactFlowchart === 'true',
    );
    returnEdge.path.setAttribute(
      'd',
      points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
    );
    returnEdge.path.dataset.decisionReturn = 'outer';
    returnEdge.path.dataset.decisionSource = returnEdge.source;
    returnEdge.path.dataset.decisionTarget = sourceId;
    returnEdge.path.dataset.decisionLane = String(Math.max(...points.map(({ y }) => y)));
    returnEdge.path.dataset.manhattanPoints = points
      .map((point) => `${point.x},${point.y}`)
      .join(' ');
  }
}

/** A grouped graph can use separate compact columns only for independent chains. */
export function hasParallelFlowchartLanes(svg: SVGSVGElement): boolean {
  if (
    svg.getAttribute('aria-roledescription') !== 'flowchart-v2' ||
    !svg.querySelector('g.cluster')
  )
    return false;
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map(flowchartNodeId);
  const nodeIds = new Set(nodes);
  const next = new Map<string, string>();
  const incoming = new Set<string>();
  for (const path of svg.querySelectorAll<SVGPathElement>('.edgePaths path')) {
    const edge = flowchartEdgeIdentity(path);
    if (
      !edge ||
      !nodeIds.has(edge.source) ||
      !nodeIds.has(edge.target) ||
      next.has(edge.source) ||
      incoming.has(edge.target)
    )
      return false;
    next.set(edge.source, edge.target);
    incoming.add(edge.target);
  }
  const roots = nodes.filter((id) => !incoming.has(id));
  if (roots.length < 2 || roots.some((id) => !next.has(id))) return false;
  const visited = new Set<string>();
  for (const root of roots) {
    let id: string | undefined = root;
    while (id !== undefined) {
      if (visited.has(id)) return false;
      visited.add(id);
      id = next.get(id);
    }
  }
  // Disconnected cycles (including self loops) cannot be reached from a root.
  return visited.size === nodes.length;
}

export function reflowCompactFlowchart(
  svg: SVGSVGElement,
  routeEdges = true,
  membership?: FlowchartClusterMembership,
): Bounds | null {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return null;
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  if (svg.querySelector('g.cluster')) {
    if (!routeEdges) positionCompactGroupedFlowchart(svg, membership);
    else routeCompactGroupedEdges(svg);
    return routeEdges ? measureCompactFlowchartBounds(svg, nodes) : null;
  }
  if (nodes.length < 2) return null;
  if (!routeEdges) {
    let cursorY = 0;
    for (const node of nodes) {
      const shape = shapeForNode(node);
      const bounds = shape?.getBBox() ?? node.getBBox();
      node.setAttribute(
        'transform',
        `translate(${-bounds.x - bounds.width / 2}, ${cursorY - bounds.y})`,
      );
      cursorY += bounds.height + 100;
    }
    return null;
  }

  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
  const nodeIndex = new Map(nodes.map((node, index) => [flowchartNodeId(node), index]));
  const pairCounts = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const path of paths) {
    const identity = flowchartEdgeIdentity(path);
    if (!identity) continue;
    const pair = [identity.source, identity.target].toSorted().join('\u0000');
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    outDegree.set(identity.source, (outDegree.get(identity.source) ?? 0) + 1);
  }
  const laneCounts = { left: 0, right: 0 };
  const stubCounts = new Map<string, number>();
  const pairLaneCounts = new Map<string, number>();
  const placedLabelBounds: Bounds[] = [];
  const routedBounds = nodes.flatMap((node) => {
    const matrix = node.transform.baseVal.consolidate()?.matrix;
    if (!matrix) return [];
    const bounds = node.getBBox();
    return [
      {
        x: bounds.x + matrix.e,
        y: bounds.y + matrix.f,
        width: bounds.width,
        height: bounds.height,
      },
    ];
  });
  paths.forEach((path, pathIndex) => {
    const identity = flowchartEdgeIdentity(path);
    const sourceNode = identity && flowchartNode(svg, identity.source);
    const targetNode = identity && flowchartNode(svg, identity.target);
    const source = sourceNode && flowchartNodeBounds(sourceNode);
    const target = targetNode && flowchartNodeBounds(targetNode);
    if (!identity || !source || !target) return;
    routedBounds.push(source, target);
    const sourceIndex = nodeIndex.get(identity.source) ?? 0;
    const targetIndex = nodeIndex.get(identity.target) ?? 0;
    const pair = [identity.source, identity.target].toSorted().join('\u0000');
    const pairCount = pairCounts.get(pair) ?? 0;
    const pairLaneIndex = pairLaneCounts.get(pair) ?? 0;
    pairLaneCounts.set(pair, pairLaneIndex + 1);
    if (pairCount > 1) {
      const lane = pairLaneIndex - (pairCount - 1) / 2;
      path.dataset.parallelLane = lane < 0 ? 'before' : lane > 0 ? 'after' : 'center';
    } else {
      delete path.dataset.parallelLane;
    }
    let points: Point[];
    if (
      targetIndex === sourceIndex + 1 &&
      pairCounts.get(pair) === 1 &&
      outDegree.get(identity.source) === 1
    ) {
      points = [pointAt(source, 0.5, 1), pointAt(target, 0.5, 0)];
    } else {
      const side = targetIndex <= sourceIndex ? 'left' : 'right';
      const laneNumber = laneCounts[side]++;
      const stubKey = `${identity.source}\u0000${side}`;
      const stubNumber = stubCounts.get(stubKey) ?? 0;
      stubCounts.set(stubKey, stubNumber + 1);
      const downward = targetIndex > sourceIndex;
      const sourcePort = pointAt(source, 0.5, downward ? 1 : 0);
      const targetPort = pointAt(target, 0.5, downward ? 0 : 1);
      const stubOffset = 28 + stubNumber * 30;
      const sourceStubY = sourcePort.y + (downward ? stubOffset : -stubOffset);
      const targetStubY = targetPort.y + (downward ? -28 : 28);
      const laneOffset = 42 + (laneNumber % 2) * 6;
      const laneX =
        side === 'left'
          ? Math.min(source.x, target.x) - laneOffset
          : Math.max(source.x + source.width, target.x + target.width) + laneOffset;
      points = [
        sourcePort,
        { x: sourcePort.x, y: sourceStubY },
        { x: laneX, y: sourceStubY },
        { x: laneX, y: targetStubY },
        { x: targetPort.x, y: targetStubY },
        targetPort,
      ];
    }
    points = simplifyOrthogonalPoints(points);
    const pathMinX = Math.min(...points.map((point) => point.x));
    const pathMinY = Math.min(...points.map((point) => point.y));
    const pathMaxX = Math.max(...points.map((point) => point.x));
    const pathMaxY = Math.max(...points.map((point) => point.y));
    routedBounds.push({
      x: pathMinX,
      y: pathMinY,
      width: pathMaxX - pathMinX,
      height: pathMaxY - pathMinY,
    });
    path.setAttribute(
      'd',
      points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
    );
    path.dataset.compactFlowchart = 'true';
    path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');

    const label = labels[pathIndex];
    if (!label) return;
    const segments = points.slice(1).map((end, index) => ({ start: points[index], end }));
    const sortedSegments = segments.toSorted(
      (left, right) =>
        Number(Math.abs(right.end.y - right.start.y) < 0.001) -
          Number(Math.abs(left.end.y - left.start.y) < 0.001) ||
        Math.hypot(right.end.x - right.start.x, right.end.y - right.start.y) -
          Math.hypot(left.end.x - left.start.x, left.end.y - left.start.y),
    );
    const local = label.getBBox();
    const placements = sortedSegments.flatMap((segment) =>
      [0.5, 0.35, 0.65, 0.2, 0.8].map((ratio) => ({
        segment,
        midpoint: {
          x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
          y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
        },
      })),
    );
    const placement =
      placements.find(({ midpoint }) => {
        const bounds = {
          x: midpoint.x - local.width / 2,
          y: midpoint.y - local.height / 2,
          width: local.width,
          height: local.height,
        };
        return !placedLabelBounds.some((placed) => boundsOverlap(bounds, placed, 4));
      }) ?? placements[0];
    if (!placement) return;
    const { midpoint } = placement;
    label.setAttribute(
      'transform',
      `translate(${midpoint.x - local.x - local.width / 2}, ${midpoint.y - local.y - local.height / 2})`,
    );
    const placedBounds = {
      x: midpoint.x - local.width / 2,
      y: midpoint.y - local.height / 2,
      width: local.width,
      height: local.height,
    };
    placedLabelBounds.push(placedBounds);
    routedBounds.push(placedBounds);
  });
  if (!routedBounds.length) return null;
  const minX = Math.min(...routedBounds.map((bounds) => bounds.x));
  const minY = Math.min(...routedBounds.map((bounds) => bounds.y));
  const maxX = Math.max(...routedBounds.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(...routedBounds.map((bounds) => bounds.y + bounds.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function measureCompactFlowchartBounds(svg: SVGSVGElement, nodes: SVGGElement[]): Bounds | null {
  const bounds = nodes.map(flowchartNodeBounds).filter((box): box is Bounds => Boolean(box));
  for (const path of svg.querySelectorAll<SVGPathElement>('.edgePaths path')) {
    const box = path.getBBox();
    bounds.push({ x: box.x, y: box.y, width: box.width, height: box.height });
  }
  if (!bounds.length) return null;
  const minX = Math.min(...bounds.map((box) => box.x));
  const minY = Math.min(...bounds.map((box) => box.y));
  const maxX = Math.max(...bounds.map((box) => box.x + box.width));
  const maxY = Math.max(...bounds.map((box) => box.y + box.height));
  return { x: minX - 6, y: minY - 46, width: maxX - minX + 12, height: maxY - minY + 54 };
}

export function measureFlowchartContentBounds(svg: SVGSVGElement): Bounds | null {
  const referencePath = svg.querySelector<SVGPathElement>('.edgePaths path');
  if (!referencePath) return null;
  const elements = [
    ...[...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
      const shape = shapeForNode(node);
      return shape ? [shape] : [];
    }),
    ...svg.querySelectorAll<SVGRectElement>('g.cluster > rect'),
    ...svg.querySelectorAll<SVGPathElement>('.edgePaths path'),
  ];
  const bounds = elements.flatMap((element) => {
    const value = boundsInPathSpace(element, referencePath);
    return value ? [value] : [];
  });
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map((value) => value.x));
  const y = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return { x, y, width: right - x, height: bottom - y };
}

function flowchartNodeId(node: SVGGElement): string {
  return node.id.match(/flowchart-(.+?)-\d+$/)?.[1] ?? node.id;
}

function flowchartNodeBounds(node: SVGGElement): Bounds | null {
  const shape = shapeForNode(node);
  const matrix = node.transform.baseVal.consolidate()?.matrix;
  if (!shape || !matrix) return null;
  const bounds = shape.getBBox();
  return {
    x: bounds.x + matrix.e,
    y: bounds.y + matrix.f,
    width: bounds.width,
    height: bounds.height,
  };
}

/** Reject a proposed group rectangle if its padding or header captures an outsider. */
export function planCompactClusterFrame(
  content: Bounds[],
  outside: Bounds[],
  headerHeight: number,
): Bounds | null {
  if (!content.length) return null;
  const x = Math.min(...content.map((box) => box.x)) - 20;
  const y = Math.min(...content.map((box) => box.y)) - headerHeight;
  const right = Math.max(...content.map((box) => box.x + box.width)) + 20;
  const bottom = Math.max(...content.map((box) => box.y + box.height)) + 20;
  const frame = { x, y, width: right - x, height: bottom - y };
  return outside.some((box) => boundsOverlap(frame, box, 4)) ? null : frame;
}

function positionCompactGroupedFlowchart(
  svg: SVGSVGElement,
  membership?: FlowchartClusterMembership,
) {
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  const originalBounds = new Map(nodes.map((node) => [node, flowchartNodeBounds(node)]));
  // Capture membership before either candidate moves nodes or reframes groups.
  const clusters = [...svg.querySelectorAll<SVGGElement>('g.cluster')].flatMap((cluster) => {
    const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
    const label = cluster.querySelector<SVGGElement>(':scope > g.cluster-label');
    if (!rect || !label) return [];
    const originalRect = rect.getBBox();
    const id = membership && flowchartClusterId(cluster, membership);
    const memberIds = id ? membership?.get(id) : undefined;
    if (membership && !memberIds) return [];
    const members = nodes.filter((node) => {
      if (memberIds) return memberIds.has(flowchartNodeId(node));
      const bounds = originalBounds.get(node);
      if (!bounds) return false;
      const center = pointAt(bounds, 0.5, 0.5);
      return (
        center.x >= originalRect.x &&
        center.x <= originalRect.x + originalRect.width &&
        center.y >= originalRect.y &&
        center.y <= originalRect.y + originalRect.height
      );
    });
    return [{ cluster, rect, label, originalRect, members, id, memberIds }];
  });
  const positions = new Map<SVGGElement, Point>();
  const placeColumn = (column: SVGGElement[], centerX: number, startY: number) => {
    let y = startY;
    for (const node of column) {
      const bounds = node.getBBox();
      positions.set(node, { x: centerX - bounds.x - bounds.width / 2, y: y - bounds.y });
      y += bounds.height + 100;
    }
  };
  const columnWidth = Math.max(...nodes.map((node) => node.getBBox().width));
  const independentChains = hasParallelFlowchartLanes(svg);
  let parallelLanes = independentChains;
  if (parallelLanes) {
    const next = new Map(
      [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].map((path) => {
        const edge = flowchartEdgeIdentity(path)!;
        return [edge.source, edge.target];
      }),
    );
    const targets = new Set(next.values());
    const byId = new Map(nodes.map((node) => [flowchartNodeId(node), node]));
    const lanes = nodes
      .filter((node) => !targets.has(flowchartNodeId(node)))
      .map((root) => {
        const lane = [root];
        let id = next.get(flowchartNodeId(root));
        while (id !== undefined) {
          lane.push(byId.get(id)!);
          id = next.get(id);
        }
        return lane;
      });
    const rankHeights = Array.from(
      { length: Math.max(...lanes.map((lane) => lane.length)) },
      (_, rank) => Math.max(...lanes.map((lane) => lane[rank]?.getBBox().height ?? 0)),
    );
    let x = 0;
    for (const lane of lanes) {
      const width = Math.max(...lane.map((node) => node.getBBox().width));
      let y = 48;
      lane.forEach((node, rank) => {
        const bounds = node.getBBox();
        positions.set(node, {
          x: x + width / 2 - bounds.x - bounds.width / 2,
          y: y + rankHeights[rank] / 2 - bounds.y - bounds.height / 2,
        });
        y += rankHeights[rank] + 100;
      });
      x += width + 24;
    }
  } else {
    placeColumn(nodes, columnWidth / 2, 48);
  }

  const planFrames = () => {
    const projected = new Map(
      nodes.flatMap((node) => {
        const shape = shapeForNode(node);
        const position = positions.get(node);
        if (!shape || !position) return [];
        const box = shape.getBBox();
        return [
          [
            node,
            { x: box.x + position.x, y: box.y + position.y, width: box.width, height: box.height },
          ] as const,
        ];
      }),
    );
    if (
      independentChains &&
      (projected.size !== nodes.length ||
        clusters.length !== svg.querySelectorAll('g.cluster').length ||
        clusters.some(({ members }) => !members.length))
    )
      return null;
    const layouts = new Map<
      SVGGElement,
      {
        frame: Bounds;
        measuredTitleHeight: number;
        headerHeight: number;
      }
    >();
    for (const record of clusters.toSorted(
      (left, right) =>
        (left.memberIds?.size ?? 0) - (right.memberIds?.size ?? 0) ||
        left.originalRect.width * left.originalRect.height -
          right.originalRect.width * right.originalRect.height,
    )) {
      const memberBounds = record.members.flatMap((node) => {
        const bounds = projected.get(node);
        return bounds ? [bounds] : [];
      });
      const nestedBounds = clusters
        .filter(
          (candidate) =>
            candidate !== record &&
            (record.memberIds
              ? Boolean(candidate.id && record.memberIds.has(candidate.id))
              : candidate.originalRect.x >= record.originalRect.x &&
                candidate.originalRect.y >= record.originalRect.y &&
                candidate.originalRect.x + candidate.originalRect.width <=
                  record.originalRect.x + record.originalRect.width &&
                candidate.originalRect.y + candidate.originalRect.height <=
                  record.originalRect.y + record.originalRect.height),
        )
        .flatMap(({ cluster }) => {
          const layout = layouts.get(cluster);
          return layout ? [layout.frame] : [];
        });
      const contentBounds = [...memberBounds, ...nestedBounds];
      if (!contentBounds.length) continue;
      const titleViewport = record.label.querySelector<SVGForeignObjectElement>('foreignObject');
      // The real title wraps after reframing. Measure that width in isolation so
      // later header growth cannot invalidate the nonmember clearance check.
      const measurement =
        independentChains && titleViewport
          ? (titleViewport.cloneNode(true) as SVGForeignObjectElement)
          : null;
      if (measurement) {
        const width =
          Math.max(...contentBounds.map((box) => box.x + box.width)) -
          Math.min(...contentBounds.map((box) => box.x));
        measurement.setAttribute('width', String(Math.max(24, width)));
        measurement.style.visibility = 'hidden';
        const content = measurement.querySelector<HTMLElement>('div');
        if (content) {
          content.style.width = '100%';
          content.style.whiteSpace = 'normal';
          content.style.overflowWrap = 'normal';
          content.style.wordBreak = 'normal';
        }
        record.label.append(measurement);
      }
      let measuredTitleHeight: number;
      try {
        const titleContent = (measurement ?? titleViewport)?.querySelector<HTMLElement>('div');
        measuredTitleHeight = Math.ceil(
          Math.max(
            titleContent?.getBoundingClientRect().height ?? 0,
            titleContent?.scrollHeight ?? 0,
            18,
          ),
        );
      } finally {
        measurement?.remove();
      }
      const headerHeight = measuredClusterHeaderHeight(measuredTitleHeight);
      const outside = independentChains
        ? nodes
            .filter((node) => !record.members.includes(node))
            .flatMap((node) => {
              const bounds = projected.get(node);
              return bounds ? [bounds] : [];
            })
        : [];
      const frame = planCompactClusterFrame(contentBounds, outside, headerHeight);
      if (!frame) return null;
      layouts.set(record.cluster, { frame, measuredTitleHeight, headerHeight });
    }
    return layouts;
  };
  let layouts = planFrames();
  if (parallelLanes && !layouts) {
    parallelLanes = false;
    placeColumn(nodes, columnWidth / 2, 48);
    layouts = planFrames();
  }
  // Neither rejected plan ever touches the SVG. Routing must use this same choice.
  svg.dataset.compactGroupedLayout = !layouts ? 'original' : parallelLanes ? 'parallel' : 'column';
  if (!layouts) return;
  for (const [node, position] of positions) {
    node.setAttribute('transform', `translate(${position.x}, ${position.y})`);
  }
  for (const record of clusters) {
    const layout = layouts.get(record.cluster);
    if (!layout) continue;
    const { frame, measuredTitleHeight, headerHeight } = layout;
    const minX = frame.x;
    const maxX = frame.x + frame.width;
    const minY = frame.y;
    const titleViewport = record.label.querySelector<SVGForeignObjectElement>('foreignObject');
    const titleContent = titleViewport?.querySelector<HTMLElement>('div');
    record.rect.setAttribute('x', String(frame.x));
    record.rect.setAttribute('y', String(frame.y));
    record.rect.setAttribute('width', String(frame.width));
    record.rect.setAttribute('height', String(frame.height));
    record.cluster.dataset.headerHeight = String(headerHeight);
    if (titleViewport) {
      titleViewport.setAttribute('x', '0');
      titleViewport.setAttribute('y', '0');
      titleViewport.setAttribute('width', String(Math.max(24, frame.width - 40)));
      titleViewport.setAttribute('height', String(measuredTitleHeight));
      titleViewport.style.overflow = 'hidden';
      if (titleContent) {
        titleContent.style.width = '100%';
        titleContent.style.whiteSpace = 'normal';
        titleContent.style.overflowWrap = 'normal';
        titleContent.style.wordBreak = 'normal';
      }
      record.label.setAttribute('transform', `translate(${minX + 20}, ${minY + 20})`);
    } else {
      const labelBounds = record.label.getBBox();
      record.label.setAttribute(
        'transform',
        `translate(${(minX + maxX) / 2 - labelBounds.x - labelBounds.width / 2}, ${minY + 20 - labelBounds.y})`,
      );
    }
  }
}

function routeCompactGroupedEdges(svg: SVGSVGElement) {
  if (svg.dataset.compactGroupedLayout === 'original') return;
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  const parallelLanes = svg.dataset.compactGroupedLayout === 'parallel';
  const nodeIndex = new Map(nodes.map((node, index) => [flowchartNodeId(node), index]));
  const records = paths.flatMap((path) => {
    const identity = flowchartEdgeIdentity(path);
    return identity ? [{ path, ...identity }] : [];
  });
  const pairGroups = new Map<string, typeof records>();
  for (const record of records) {
    const key = [record.source, record.target].toSorted().join('\u0000');
    pairGroups.set(key, [...(pairGroups.get(key) ?? []), record]);
  }
  const sideCounts = { left: 0, right: 0 };
  const routes = records.flatMap((record) => {
    if (record.source === record.target) return [{ ...record, side: 'right' as const }];
    const key = [record.source, record.target].toSorted().join('\u0000');
    const group = pairGroups.get(key) ?? [];
    if (group.length > 1) {
      return [
        { ...record, side: group.indexOf(record) % 2 ? ('right' as const) : ('left' as const) },
      ];
    }
    const sourceIndex = nodeIndex.get(record.source) ?? 0;
    const targetIndex = nodeIndex.get(record.target) ?? 0;
    return [
      {
        ...record,
        side:
          parallelLanes || Math.abs(targetIndex - sourceIndex) === 1
            ? null
            : targetIndex < sourceIndex
              ? ('left' as const)
              : ('right' as const),
      },
    ];
  });
  const terminalTotals = new Map<string, number>();
  for (const route of routes) {
    if (!route.side || route.source === route.target) continue;
    for (const id of [route.source, route.target]) {
      const key = `${id}\u0000${route.side}`;
      terminalTotals.set(key, (terminalTotals.get(key) ?? 0) + 1);
    }
  }
  const terminalSlots = new Map<string, number>();
  const terminalRatio = (id: string, side: 'left' | 'right') => {
    const key = `${id}\u0000${side}`;
    const total = terminalTotals.get(key) ?? 1;
    const slot = terminalSlots.get(key) ?? 0;
    terminalSlots.set(key, slot + 1);
    return total === 1 ? 0.5 : 0.25 + (slot * 0.5) / (total - 1);
  };
  const allBounds = nodes
    .map(flowchartNodeBounds)
    .filter((bounds): bounds is Bounds => Boolean(bounds));
  const outerLeft = Math.min(...allBounds.map((bounds) => bounds.x)) - 24;
  const outerRight = Math.max(...allBounds.map((bounds) => bounds.x + bounds.width)) + 24;
  for (const route of routes) {
    const { path, source: sourceId, target: targetId, side } = route;
    const sourceNode = flowchartNode(svg, sourceId);
    const targetNode = flowchartNode(svg, targetId);
    const source = sourceNode && flowchartNodeBounds(sourceNode);
    const target = targetNode && flowchartNodeBounds(targetNode);
    if (!source || !target) continue;
    let points: Point[];
    if (sourceId === targetId) {
      const laneX = source.x + source.width + 24;
      points = [
        pointAt(source, 1, 0.3),
        { x: laneX, y: source.y + source.height * 0.3 },
        { x: laneX, y: source.y + source.height * 0.7 },
        pointAt(source, 1, 0.7),
      ];
      path.dataset.selfLoop = 'right';
    } else if (!side) {
      const horizontallySeparated =
        target.x >= source.x + source.width || source.x >= target.x + target.width;
      if (horizontallySeparated) {
        const rightward = target.x >= source.x;
        const sourcePort = pointAt(source, rightward ? 1 : 0, 0.5);
        const targetPort = pointAt(target, rightward ? 0 : 1, 0.5);
        const laneX = (sourcePort.x + targetPort.x) / 2;
        points = simplifyOrthogonalPoints([
          sourcePort,
          { x: laneX, y: sourcePort.y },
          { x: laneX, y: targetPort.y },
          targetPort,
        ]);
      } else {
        const downward = target.y >= source.y;
        const sourcePort = pointAt(source, 0.5, downward ? 1 : 0);
        const targetPort = pointAt(target, 0.5, downward ? 0 : 1);
        const laneY = (sourcePort.y + targetPort.y) / 2;
        points = simplifyOrthogonalPoints([
          sourcePort,
          { x: sourcePort.x, y: laneY },
          { x: targetPort.x, y: laneY },
          targetPort,
        ]);
      }
    } else {
      const sourcePort = pointAt(source, side === 'left' ? 0 : 1, terminalRatio(sourceId, side));
      const targetPort = pointAt(target, side === 'left' ? 0 : 1, terminalRatio(targetId, side));
      const laneNumber = sideCounts[side]++;
      const laneX =
        (side === 'left' ? outerLeft : outerRight) + (side === 'left' ? -1 : 1) * laneNumber * 12;
      points = [
        sourcePort,
        { x: laneX, y: sourcePort.y },
        { x: laneX, y: targetPort.y },
        targetPort,
      ];
      path.dataset.compactGroupedSide = side;
      path.dataset.compactGroupedPort = `${sourcePort.x},${sourcePort.y} ${targetPort.x},${targetPort.y}`;
    }
    points = simplifyOrthogonalPoints(points);
    path.setAttribute(
      'd',
      points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
    );
    path.dataset.compactFlowchart = 'true';
    path.dataset.compactGroupedRoute = 'true';
    path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
  }
  for (const cluster of svg.querySelectorAll<SVGGElement>('g.cluster')) {
    const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
    const label = cluster.querySelector<SVGGElement>(':scope > g.cluster-label');
    if (!rect || !label) continue;
    const rectBounds = rect.getBBox();
    const labelBounds = label.getBBox();
    label.setAttribute(
      'transform',
      `translate(${rectBounds.x + rectBounds.width / 2 - labelBounds.x - labelBounds.width / 2}, ${rectBounds.y + 20 - labelBounds.y})`,
    );
  }
}

export function spaceNestedFlowchartClusters(svg: SVGSVGElement) {
  if (svg.dataset.nestedDecisionLayout) return;
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  const records = [...svg.querySelectorAll<SVGGElement>('g.cluster')].flatMap((cluster) => {
    const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
    return rect
      ? [
          {
            cluster,
            rect,
            frame: {
              x: Number(rect.getAttribute('x')),
              y: Number(rect.getAttribute('y')),
              width: Number(rect.getAttribute('width')),
              height: Number(rect.getAttribute('height')),
            },
          },
        ]
      : [];
  });
  const contains = (frame: Bounds, node: Bounds) =>
    node.x >= frame.x &&
    node.x + node.width <= frame.x + frame.width &&
    node.y >= frame.y &&
    node.y + node.height <= frame.y + frame.height;
  for (const child of records) {
    const parent = records
      .filter((record) => record !== child && contains(record.frame, child.frame))
      .toSorted((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height)[0];
    if (!parent) continue;
    const entries = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].flatMap((path) => {
      const identity = flowchartEdgeIdentity(path);
      const sourceNode = identity && flowchartNode(svg, identity.source);
      const targetNode = identity && flowchartNode(svg, identity.target);
      const source = sourceNode && flowchartNodeBounds(sourceNode);
      const target = targetNode && flowchartNodeBounds(targetNode);
      const label = flowchartLabelForPath(svg, path);
      if (
        !source ||
        !target ||
        !contains(child.frame, target) ||
        contains(child.frame, source) ||
        !contains(parent.frame, source) ||
        source.y + source.height > child.frame.y
      )
        return [];
      return [{ source, labelWidth: label?.getBBox().width ?? 0 }];
    });
    if (!entries.length) continue;
    const clearance = 24;
    const needed = Math.max(
      0,
      ...entries.map(({ source }) => source.y + source.height + clearance - child.frame.y),
    );
    const members = nodes.filter((node) => {
      const bounds = flowchartNodeBounds(node);
      return bounds && contains(child.frame, bounds);
    });
    const below = nodes
      .filter((node) => !members.includes(node))
      .flatMap((node) => {
        const bounds = flowchartNodeBounds(node);
        return bounds && bounds.y >= child.frame.y + child.frame.height ? [bounds.y] : [];
      });
    const available =
      Math.min(parent.frame.y + parent.frame.height, ...below) -
      child.frame.y -
      child.frame.height -
      clearance;
    const shift = Math.min(needed, Math.max(0, available));
    if (shift > 0) {
      for (const node of members) {
        const matrix = node.transform.baseVal.consolidate()?.matrix;
        if (matrix) node.setAttribute('transform', `translate(${matrix.e}, ${matrix.f + shift})`);
      }
      for (const record of records.filter((record) => contains(child.frame, record.frame))) {
        record.rect.setAttribute('y', String(record.frame.y + shift));
        const label = record.cluster.querySelector<SVGGElement>(':scope > .cluster-label');
        const matrix = label?.transform.baseVal.consolidate()?.matrix;
        if (matrix) label!.setAttribute('transform', `translate(${matrix.e}, ${matrix.f + shift})`);
      }
    }
    const corridor = Math.max(...entries.map(({ labelWidth }) => labelWidth + 12));
    const right = Math.max(
      parent.frame.x + parent.frame.width,
      child.frame.x + child.frame.width + corridor,
    );
    parent.rect.setAttribute('width', String(right - parent.frame.x));
  }
}

export function routeFlowchartAroundClusterHeaders(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const clusters = [...svg.querySelectorAll<SVGGElement>('g.cluster')];
  for (const path of svg.querySelectorAll<SVGPathElement>('.edgePaths path')) {
    if (path.dataset.feedbackLane || path.dataset.nestedDecisionRoute) continue;
    const fanoutIdentity = path.dataset.fanoutSource && flowchartEdgeIdentity(path);
    const fanoutSourceNode = fanoutIdentity && flowchartNode(svg, fanoutIdentity.source);
    const fanoutTargetNode = fanoutIdentity && flowchartNode(svg, fanoutIdentity.target);
    const fanoutSource = fanoutSourceNode && flowchartNodeBounds(fanoutSourceNode);
    const fanoutTarget = fanoutTargetNode && flowchartNodeBounds(fanoutTargetNode);
    const clusterForBounds = (bounds: Bounds) =>
      clusters
        .flatMap((cluster) => {
          const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
          const frame = rect?.getBBox();
          return frame ? [{ cluster, frame }] : [];
        })
        .filter(
          ({ frame }) =>
            bounds.x + bounds.width / 2 > frame.x &&
            bounds.x + bounds.width / 2 < frame.x + frame.width &&
            bounds.y + bounds.height / 2 > frame.y &&
            bounds.y + bounds.height / 2 < frame.y + frame.height,
        )
        .toSorted((left, right) => left.frame.width - right.frame.width)[0];
    if (fanoutSource && fanoutTarget) {
      const sourceCluster = clusterForBounds(fanoutSource);
      const targetCluster = clusterForBounds(fanoutTarget);
      if (sourceCluster && targetCluster && sourceCluster.cluster !== targetCluster.cluster) {
        const sourcePort = pointAt(fanoutSource, 1, 0.5);
        const targetPort = pointAt(fanoutTarget, 0, 0.5);
        const laneX =
          (sourceCluster.frame.x + sourceCluster.frame.width + targetCluster.frame.x) / 2;
        const points = [
          sourcePort,
          { x: laneX, y: sourcePort.y },
          { x: laneX, y: targetPort.y },
          targetPort,
        ];
        path.setAttribute(
          'd',
          points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
        );
        path.dataset.clusterHeaderClearance = 'true';
        path.dataset.clusterHeaderTargetPort = 'left';
        path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
        continue;
      }
    }
    const length = path.getTotalLength();
    if (!length) continue;
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(length);
    if (Math.abs(end.y - start.y) <= Math.abs(end.x - start.x)) continue;
    const identity = flowchartEdgeIdentity(path);
    const sourceNode = identity && flowchartNode(svg, identity.source);
    const targetNode = identity && flowchartNode(svg, identity.target);
    const sourceShape = sourceNode && shapeForNode(sourceNode);
    const targetShape = targetNode && shapeForNode(targetNode);
    const sourceBounds = sourceShape ? boundsInPathSpace(sourceShape, path) : null;
    const targetBounds = targetShape ? boundsInPathSpace(targetShape, path) : null;
    const containingCluster = (nodeBounds: Bounds | null) =>
      nodeBounds
        ? clusters
            .map((cluster) => {
              const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
              const bounds = rect && clientBoundsInPathSpace(rect, path);
              const headerHeight = Number(cluster.dataset.headerHeight);
              return bounds
                ? {
                    bounds,
                    protectedBottom:
                      bounds.y + (Number.isFinite(headerHeight) ? headerHeight : 48) + 8,
                  }
                : null;
            })
            .filter((item): item is { bounds: Bounds; protectedBottom: number } => Boolean(item))
            .filter(
              ({ bounds }) =>
                nodeBounds.x + nodeBounds.width / 2 > bounds.x &&
                nodeBounds.x + nodeBounds.width / 2 < bounds.x + bounds.width &&
                nodeBounds.y + nodeBounds.height / 2 > bounds.y &&
                nodeBounds.y + nodeBounds.height / 2 < bounds.y + bounds.height,
            )
            .toSorted((left, right) => left.bounds.width - right.bounds.width)[0]
        : null;
    const sourceCluster = containingCluster(sourceBounds);
    const targetCluster = containingCluster(targetBounds);
    if (targetBounds && targetCluster && end.y < targetCluster.protectedBottom) {
      const targetCenterY = targetBounds.y + targetBounds.height / 2;
      const enterFromLeft =
        Math.abs(start.x - (targetCluster.bounds.x - 8)) <=
        Math.abs(start.x - (targetCluster.bounds.x + targetCluster.bounds.width + 8));
      const laneX = enterFromLeft
        ? targetCluster.bounds.x - 8
        : targetCluster.bounds.x + targetCluster.bounds.width + 8;
      const targetX = enterFromLeft ? targetBounds.x : targetBounds.x + targetBounds.width;
      const differentSourceCluster =
        sourceBounds &&
        sourceCluster &&
        (sourceCluster.bounds.x !== targetCluster.bounds.x ||
          sourceCluster.bounds.y !== targetCluster.bounds.y);
      const beforeY = targetCluster.bounds.y - 6;
      const sourceCenterY = sourceBounds ? sourceBounds.y + sourceBounds.height / 2 : start.y;
      const sourceX = sourceBounds
        ? laneX < sourceBounds.x + sourceBounds.width / 2
          ? sourceBounds.x
          : sourceBounds.x + sourceBounds.width
        : start.x;
      const routed = simplifyOrthogonalPoints(
        differentSourceCluster
          ? [
              { x: sourceX, y: sourceCenterY },
              { x: laneX, y: sourceCenterY },
              { x: laneX, y: targetCenterY },
              { x: targetX, y: targetCenterY },
            ]
          : [
              { x: start.x, y: start.y },
              { x: start.x, y: beforeY },
              { x: laneX, y: beforeY },
              { x: laneX, y: targetCenterY },
              { x: targetX, y: targetCenterY },
            ],
      );
      path.setAttribute(
        'd',
        routed.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
      );
      path.dataset.clusterHeaderClearance = 'true';
      path.dataset.clusterHeaderTargetPort = enterFromLeft ? 'left' : 'right';
      path.dataset.manhattanPoints = routed.map((point) => `${point.x},${point.y}`).join(' ');
      continue;
    }
    const obstacles = clusters
      .flatMap((cluster) => {
        const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
        const bounds = rect && clientBoundsInPathSpace(rect, path);
        if (!bounds) return [];
        const headerHeight = Number(cluster.dataset.headerHeight);
        const protectedBounds = {
          ...bounds,
          height: Math.min(bounds.height, (Number.isFinite(headerHeight) ? headerHeight : 48) + 8),
        };
        const crosses = Array.from({ length: 101 }, (_, index) =>
          path.getPointAtLength((length * index) / 100),
        ).some(
          (point) =>
            point.x > protectedBounds.x - 6 &&
            point.x < protectedBounds.x + protectedBounds.width + 6 &&
            point.y > protectedBounds.y - 6 &&
            point.y < protectedBounds.y + protectedBounds.height + 6,
        );
        return crosses ? [protectedBounds] : [];
      })
      .sort((left, right) =>
        end.y >= start.y ? left.y - right.y : right.y + right.height - (left.y + left.height),
      );
    if (!obstacles.length) continue;

    const downward = end.y >= start.y;
    const points: Point[] = [{ x: start.x, y: start.y }];
    for (const obstacle of obstacles) {
      const beforeY = downward ? obstacle.y - 6 : obstacle.y + obstacle.height + 6;
      const afterY = downward ? obstacle.y + obstacle.height + 6 : obstacle.y - 6;
      const leftX = obstacle.x - 8;
      const rightX = obstacle.x + obstacle.width + 8;
      const laneX = Math.abs(start.x - leftX) <= Math.abs(start.x - rightX) ? leftX : rightX;
      points.push(
        { x: start.x, y: beforeY },
        { x: laneX, y: beforeY },
        { x: laneX, y: afterY },
        { x: start.x, y: afterY },
      );
    }
    points.push({ x: start.x, y: end.y }, { x: end.x, y: end.y });
    const routed = simplifyOrthogonalPoints(points);
    path.setAttribute(
      'd',
      routed.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
    );
    path.dataset.clusterHeaderClearance = 'true';
    path.dataset.manhattanPoints = routed.map((point) => `${point.x},${point.y}`).join(' ');
  }
}

export function positionCompactGroupedEdgeLabels(svg: SVGSVGElement) {
  if (!svg.querySelector('g.cluster')) return;
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
  const clusterTitles = [...svg.querySelectorAll<SVGGElement>('g.cluster > g.cluster-label')];
  const untransformedLabelBounds = (label: SVGGElement) => {
    const transform = label.getAttribute('transform');
    label.removeAttribute('transform');
    const bounds = label.getBBox();
    if (transform) label.setAttribute('transform', transform);
    return bounds;
  };
  const placed: Bounds[] = [];
  paths.forEach((path, index) => {
    const label = labels[index];
    if (path.dataset.nestedDecisionRoute && label) {
      const bounds = clientBoundsInPathSpace(label, path);
      if (bounds) placed.push(bounds);
      return;
    }
    if (path.dataset.clientRequestLane === 'downward' && label) {
      const bounds = clientBoundsInPathSpace(label, path);
      if (bounds) placed.push(bounds);
      return;
    }
    const points = (path.dataset.manhattanPoints ?? '')
      .trim()
      .split(/\s+/)
      .map((point) => point.split(',').map(Number))
      .filter((point) => point.length === 2 && point.every(Number.isFinite))
      .map(([x, y]) => ({ x, y }));
    if (!label || points.length < 2) return;
    const local = untransformedLabelBounds(label);
    const labelBounds = clientBoundsInPathSpace(label, path);
    if (!labelBounds) return;
    const obstacles = [
      ...[...svg.querySelectorAll<SVGGElement>('g.node')]
        .map((node) => clientBoundsInPathSpace(node, path))
        .filter((bounds): bounds is Bounds => Boolean(bounds)),
      ...clusterTitles
        .map((title) => clientBoundsInPathSpace(title, path))
        .filter((bounds): bounds is Bounds => Boolean(bounds)),
      ...placed,
    ];
    const pathSegments = segments(points);
    const candidates = pathSegments
      .flatMap((segment) => {
        const horizontal = Math.abs(segment.start.y - segment.end.y) < 0.001;
        const capacity = Math.hypot(
          segment.end.x - segment.start.x,
          segment.end.y - segment.start.y,
        );
        const required = (horizontal ? labelBounds.width : labelBounds.height) + 12;
        if (capacity < required) return [];
        return [0.5, 0.35, 0.65, 0.2, 0.8].map((ratio) => {
          const center = {
            x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
            y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
          };
          const bounds = {
            x: center.x - labelBounds.width / 2,
            y: center.y - labelBounds.height / 2,
            width: labelBounds.width,
            height: labelBounds.height,
          };
          return { center, bounds, horizontal, capacity };
        });
      })
      .filter(({ bounds }) => obstacles.every((obstacle) => !boundsOverlap(bounds, obstacle, 4)))
      .sort(
        (left, right) =>
          Number(right.horizontal) - Number(left.horizontal) || right.capacity - left.capacity,
      );
    let placement: (typeof candidates)[number] | undefined = candidates[0];
    if (!placement) {
      const longest = pathSegments
        .map((segment) => ({
          ...segment,
          capacity: Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y),
        }))
        .sort((left, right) => right.capacity - left.capacity)[0];
      if (!longest) return;
      const vertical =
        Math.abs(longest.end.y - longest.start.y) > Math.abs(longest.end.x - longest.start.x);
      const midpoint = {
        x: (longest.start.x + longest.end.x) / 2,
        y: (longest.start.y + longest.end.y) / 2,
      };
      const halfExtent = vertical ? labelBounds.width / 2 : labelBounds.height / 2;
      const nearestObstacleCenters = obstacles.flatMap((obstacle) =>
        vertical
          ? [
              { x: obstacle.x - 4 - halfExtent, y: midpoint.y },
              { x: obstacle.x + obstacle.width + 4 + halfExtent, y: midpoint.y },
            ]
          : [
              { x: midpoint.x, y: obstacle.y - 4 - halfExtent },
              { x: midpoint.x, y: obstacle.y + obstacle.height + 4 + halfExtent },
            ],
      );
      placement = [
        vertical
          ? { x: midpoint.x + halfExtent + 4, y: midpoint.y }
          : { x: midpoint.x, y: midpoint.y + halfExtent + 4 },
        vertical
          ? { x: midpoint.x - halfExtent - 4, y: midpoint.y }
          : { x: midpoint.x, y: midpoint.y - halfExtent - 4 },
        ...nearestObstacleCenters,
      ]
        .map((center) => {
          return {
            center,
            bounds: {
              x: center.x - labelBounds.width / 2,
              y: center.y - labelBounds.height / 2,
              width: labelBounds.width,
              height: labelBounds.height,
            },
            horizontal: !vertical,
            capacity: longest.capacity,
          };
        })
        .filter(
          ({ bounds }) =>
            obstacles.every((obstacle) => !boundsOverlap(bounds, obstacle, 4)) &&
            placed.every((existing) => !boundsOverlap(bounds, existing, 4)),
        )
        .toSorted(
          (left, right) =>
            Math.hypot(left.center.x - midpoint.x, left.center.y - midpoint.y) -
            Math.hypot(right.center.x - midpoint.x, right.center.y - midpoint.y),
        )[0];
    }
    if (!placement) return;
    if (path.dataset.groupedReturnLane === 'right' && !placement.horizontal) {
      const inset = local.width / 2 - 6;
      placement = {
        ...placement,
        center: { ...placement.center, x: placement.center.x - inset },
        bounds: { ...placement.bounds, x: placement.bounds.x - inset },
      };
    }
    const pathMatrix = path.getCTM();
    const labelParentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getCTM();
    const center =
      pathMatrix && labelParentMatrix
        ? new DOMPoint(placement.center.x, placement.center.y)
            .matrixTransform(pathMatrix)
            .matrixTransform(labelParentMatrix.inverse())
        : placement.center;
    label.setAttribute(
      'transform',
      `translate(${center.x - local.x - local.width / 2}, ${center.y - local.y - local.height / 2})`,
    );
    label.dataset.finalPathCenter = `${placement.center.x},${placement.center.y}`;
    placed.push(placement.bounds);
  });
  paths.forEach((path, index) => {
    const label = labels[index];
    if (path.dataset.nestedDecisionRoute || path.dataset.clientRequestLane === 'downward') return;
    const centerText = label?.dataset.finalPathCenter;
    const pointText = path.dataset.manhattanPoints;
    if (!label?.textContent?.trim() || !pointText) return;
    const labelBounds = clientBoundsInPathSpace(label, path);
    if (!labelBounds) return;
    const titleBounds = clusterTitles.flatMap((title) => {
      const bounds = clientBoundsInPathSpace(title, path);
      return bounds ? [bounds] : [];
    });
    const collision = titleBounds.find((bounds) => boundsOverlap(labelBounds, bounds, 4));
    if (!collision) return;
    const parsePoint = (value: string) => {
      const [x, y] = value.split(',').map(Number);
      return { x, y };
    };
    const points = pointText.split(' ').map(parsePoint);
    const pathSegments = points.slice(1).map((end, segmentIndex) => ({
      start: points[segmentIndex],
      end,
    }));
    const current = centerText ? parsePoint(centerText) : null;
    const segment = current
      ? pathSegments.find(({ start, end }) => {
          const minX = Math.min(start.x, end.x) - 1;
          const maxX = Math.max(start.x, end.x) + 1;
          const minY = Math.min(start.y, end.y) - 1;
          const maxY = Math.max(start.y, end.y) + 1;
          return current.x >= minX && current.x <= maxX && current.y >= minY && current.y <= maxY;
        })
      : pathSegments
          .slice()
          .sort(
            (left, right) =>
              Math.hypot(right.end.x - right.start.x, right.end.y - right.start.y) -
              Math.hypot(left.end.x - left.start.x, left.end.y - left.start.y),
          )[0];
    if (!segment) return;
    const vertical =
      Math.abs(segment.end.y - segment.start.y) > Math.abs(segment.end.x - segment.start.x);
    const midpoint = {
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2,
    };
    const desired = { ...(current ?? midpoint) };
    if (!current) {
      const half = vertical ? labelBounds.width / 2 : labelBounds.height / 2;
      const clearCenter = [1, -1]
        .map((side) =>
          vertical
            ? { x: midpoint.x + side * (half + 4), y: midpoint.y }
            : { x: midpoint.x, y: midpoint.y + side * (half + 4) },
        )
        .find((center) => {
          const bounds = {
            x: center.x - labelBounds.width / 2,
            y: center.y - labelBounds.height / 2,
            width: labelBounds.width,
            height: labelBounds.height,
          };
          return titleBounds.every((title) => !boundsOverlap(bounds, title, 4));
        });
      if (!clearCenter) return;
      desired.x = clearCenter.x;
      desired.y = clearCenter.y;
    } else if (vertical) {
      const half = labelBounds.height / 2;
      const below = collision.y + collision.height + 4 + half;
      const above = collision.y - 4 - half;
      const min = Math.min(segment.start.y, segment.end.y) + half;
      const max = Math.max(segment.start.y, segment.end.y) - half;
      desired.y = below <= max ? Math.max(min, below) : Math.min(max, above);
    } else {
      const half = labelBounds.width / 2;
      const right = collision.x + collision.width + 4 + half;
      const left = collision.x - 4 - half;
      const min = Math.min(segment.start.x, segment.end.x) + half;
      const max = Math.max(segment.start.x, segment.end.x) - half;
      desired.x = right <= max ? Math.max(min, right) : Math.min(max, left);
    }
    const local = untransformedLabelBounds(label);
    const pathMatrix = path.getCTM();
    const labelParentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getCTM();
    if (!pathMatrix || !labelParentMatrix) return;
    const parentCenter = new DOMPoint(desired.x, desired.y)
      .matrixTransform(pathMatrix)
      .matrixTransform(labelParentMatrix.inverse());
    label.setAttribute(
      'transform',
      `translate(${parentCenter.x - local.x - local.width / 2}, ${parentCenter.y - local.y - local.height / 2})`,
    );
    label.dataset.finalPathCenter = `${desired.x},${desired.y}`;
  });
}

function pointAt(bounds: Bounds, xRatio: number, yRatio: number): Point {
  return { x: bounds.x + bounds.width * xRatio, y: bounds.y + bounds.height * yRatio };
}

function stateRoutePoints(
  label: keyof typeof STATE_ROUTE_NODES,
  source: Bounds,
  target: Bounds,
  allNodes: Bounds[],
  compact = false,
): Point[] {
  const left = Math.min(...allNodes.map((bounds) => bounds.x));
  const right = Math.max(...allNodes.map((bounds) => bounds.x + bounds.width));
  const top = Math.min(...allNodes.map((bounds) => bounds.y));
  const sourceBottom = pointAt(source, 0.5, 1);
  const targetTop = pointAt(target, 0.5, 0);
  if (label === STATE_LABEL.userSendsMessage) return [sourceBottom, targetTop];
  if (label === STATE_LABEL.agentResponds) {
    const respondSource = pointAt(source, 0.28, 1);
    const respondTarget = pointAt(target, 0.28, 0);
    const laneY = respondSource.y + (compact ? 38 : 50);
    return [
      respondSource,
      { x: respondSource.x, y: laneY },
      { x: respondTarget.x, y: laneY },
      respondTarget,
    ];
  }
  if (label === STATE_LABEL.toolStarts) {
    if (compact) {
      const laneX = Math.min(source.x + source.width, target.x + target.width) - 16;
      return [
        { x: laneX, y: source.y + source.height },
        { x: laneX, y: target.y },
      ];
    }
    const downward = target.y >= source.y;
    const startSource = pointAt(source, 0.64, downward ? 1 : 0);
    const startTarget = pointAt(target, 0.5, downward ? 0 : 1);
    const laneY = (startSource.y + startTarget.y) / 2;
    return [
      startSource,
      { x: startSource.x, y: laneY },
      { x: startTarget.x, y: laneY },
      startTarget,
    ];
  }
  if (label === STATE_LABEL.toolCompletes) {
    if (compact) {
      const laneX = Math.max(source.x, target.x);
      return [
        { x: laneX, y: source.y },
        { x: laneX, y: target.y + target.height },
      ];
    }
    const downward = target.y >= source.y;
    const returnSource = pointAt(source, 0.72, downward ? 1 : 0);
    const returnTarget = pointAt(target, 0.8, downward ? 0 : 1);
    const laneOffset = 92;
    const laneY = returnSource.y + (downward ? laneOffset : -laneOffset);
    return [
      returnSource,
      { x: returnSource.x, y: laneY },
      { x: returnTarget.x, y: laneY },
      returnTarget,
    ];
  }
  if (label === STATE_LABEL.agentAsksUser) {
    const askSource = pointAt(source, 0, compact ? 0.75 : 0.35);
    const askTarget = pointAt(target, 0, compact ? 0.25 : 0.35);
    const laneX = Math.min(askSource.x, askTarget.x) - (compact ? 60 : 50);
    return [askSource, { x: laneX, y: askSource.y }, { x: laneX, y: askTarget.y }, askTarget];
  }
  if (label === STATE_LABEL.userReplies) {
    const replySource = pointAt(source, 1, 0.65);
    const replyTarget = pointAt(target, 1, compact ? 0.95 : 0.65);
    const laneX = Math.max(replySource.x, replyTarget.x) + (compact ? 32 : 30);
    return [
      replySource,
      { x: laneX, y: replySource.y },
      { x: laneX, y: replyTarget.y },
      replyTarget,
    ];
  }
  if (label === STATE_LABEL.agentFinishes) {
    const finishSource = pointAt(source, 1, 0.35);
    const finishTarget = pointAt(target, 1, 0.35);
    const laneX = compact ? Math.max(finishSource.x, finishTarget.x) + 40 : right + 90;
    return [
      finishSource,
      { x: laneX, y: finishSource.y },
      { x: laneX, y: finishTarget.y },
      finishTarget,
    ];
  }
  if (label === STATE_LABEL.requestFails) {
    const requestSource = pointAt(source, 0, compact ? 0.9 : 0.25);
    const requestTarget = pointAt(target, 0, compact ? 0.75 : 0.25);
    const laneX = left - (compact ? 88 : 40);
    return [
      requestSource,
      { x: laneX, y: requestSource.y },
      { x: laneX, y: requestTarget.y },
      requestTarget,
    ];
  }
  if (label === STATE_LABEL.streamFails) {
    if (compact) {
      const failSource = pointAt(source, 0, 0.25);
      const failureTarget = pointAt(target, 0, 0.25);
      const laneX = left - 60;
      return [
        failSource,
        { x: laneX, y: failSource.y },
        { x: laneX, y: failureTarget.y },
        failureTarget,
      ];
    }
    const failSource = pointAt(source, 0.5, 0);
    const failureTarget = pointAt(target, 0, 0.5);
    const laneX = left - 80;
    const upperLaneY = top - 40;
    return [
      failSource,
      { x: failSource.x, y: upperLaneY },
      { x: laneX, y: upperLaneY },
      { x: laneX, y: failureTarget.y },
      failureTarget,
    ];
  }
  if (compact) {
    const retrySource = pointAt(source, 0, 0.9);
    const retryTarget = pointAt(target, 0, 0.1);
    const laneX = left - 92;
    return [
      retrySource,
      { x: laneX, y: retrySource.y },
      { x: laneX, y: retryTarget.y },
      retryTarget,
    ];
  }
  const retrySource = pointAt(source, 1, 0.75);
  const retryTarget = pointAt(target, 0, 0.75);
  const retryLane = (retrySource.x + retryTarget.x) / 2;
  return [
    retrySource,
    { x: retryLane, y: retrySource.y },
    { x: retryLane, y: retryTarget.y },
    retryTarget,
  ];
}

function segments(points: Point[]): Segment[] {
  return points.slice(1).map((end, index) => ({ start: points[index], end }));
}

function overlappingSegments(left: Segment, right: Segment) {
  const leftHorizontal = Math.abs(left.start.y - left.end.y) < 0.001;
  const rightHorizontal = Math.abs(right.start.y - right.end.y) < 0.001;
  if (leftHorizontal !== rightHorizontal) return false;
  if (leftHorizontal) {
    if (Math.abs(left.start.y - right.start.y) >= 0.001) return false;
    return (
      Math.min(left.start.x, left.end.x) < Math.max(right.start.x, right.end.x) - 0.001 &&
      Math.min(right.start.x, right.end.x) < Math.max(left.start.x, left.end.x) - 0.001
    );
  }
  if (Math.abs(left.start.x - right.start.x) >= 0.001) return false;
  return (
    Math.min(left.start.y, left.end.y) < Math.max(right.start.y, right.end.y) - 0.001 &&
    Math.min(right.start.y, right.end.y) < Math.max(left.start.y, left.end.y) - 0.001
  );
}

export function chooseLabelSegment(
  points: Point[],
  labelSize: { width: number; height: number },
  occupied: Segment[] = [],
  path?: SVGGraphicsElement,
) {
  return segments(points)
    .flatMap((segment, index) => {
      const horizontal = Math.abs(segment.start.y - segment.end.y) < 0.001;
      const capacity = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
      const scale = path ? segmentCssScale(path, segment.start, segment.end) : 1;
      const required =
        (horizontal ? labelSize.width : labelSize.height) + (LABEL_TURN_CLEARANCE_CSS * 2) / scale;
      return capacity >= required && !occupied.some((other) => overlappingSegments(segment, other))
        ? [{ segment, index, horizontal, capacity, excess: capacity - required }]
        : [];
    })
    .sort(
      (left, right) =>
        Number(right.horizontal) - Number(left.horizontal) || right.excess - left.excess,
    )[0];
}

function stateRoutePlan(svg: SVGSVGElement, diagram?: StateDiagramRoutingData) {
  if (!diagram || diagram.direction !== 'TB' || !svg.id) return;
  // These are route presets for one supported authored topology, not a way to
  // infer endpoints from display names or transition text. Reject the whole
  // reflow if any edge/node is different: compact mode moves shared nodes.
  const presets = Object.entries(STATE_ROUTE_NODES);
  const requiredIds = new Set<string>(['root_start', ...Object.values(STATE_ROUTE_NODES).flat()]);
  if (
    diagram.nodes.length !== requiredIds.size ||
    new Set(diagram.nodes.map((node) => node.id)).size !== requiredIds.size ||
    new Set(diagram.nodes.map((node) => node.domId)).size !== requiredIds.size ||
    diagram.nodes.some(
      (node) =>
        !requiredIds.has(node.id) ||
        !node.domId ||
        node.isGroup ||
        node.parentId ||
        node.shape !== (node.id === 'root_start' ? 'stateStart' : 'rect'),
    ) ||
    diagram.edges.length !== presets.length + 1 ||
    new Set(diagram.edges.map((edge) => edge.id)).size !== diagram.edges.length ||
    diagram.edges.filter((edge) => edge.start === 'root_start' && edge.end === 'Idle').length !== 1
  )
    return;
  const paths = [
    ...svg.querySelectorAll<SVGPathElement>('.edgePaths path, path.transition[data-edge="true"]'),
  ];
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  if (paths.length !== diagram.edges.length || nodes.length !== diagram.nodes.length) return;
  const pathsById = new Map<string, SVGPathElement>();
  for (const path of paths) {
    const id = path.dataset.id;
    if (
      !id ||
      pathsById.has(id) ||
      path.id !== `${svg.id}-${id}` ||
      !diagram.edges.some((edge) => edge.id === id)
    )
      return;
    pathsById.set(id, path);
  }
  const labelsById = new Map<string, SVGGElement>();
  for (const label of labels) {
    const id = label.querySelector(':scope > .label[data-id]')?.getAttribute('data-id');
    if (!id || labelsById.has(id) || !pathsById.has(id)) return;
    labelsById.set(id, label);
  }
  const nodesById = new Map<string, SVGGElement>();
  for (const node of diagram.nodes) {
    const matches = nodes.filter((element) => element.id === `${svg.id}-${node.domId}`);
    if (matches.length !== 1) return;
    nodesById.set(node.id, matches[0]);
  }
  const routes = [];
  for (const [kind, [source, target]] of presets) {
    const matches = diagram.edges.filter((edge) => edge.start === source && edge.end === target);
    if (matches.length !== 1) return;
    const edge = matches[0];
    const path = pathsById.get(edge.id);
    const label = labelsById.get(edge.id);
    if (!path || !label) return;
    routes.push({ edge, path, label, kind: kind as keyof typeof STATE_ROUTE_NODES });
  }
  return { paths, labels, nodesById, routes, diagram };
}

export function rewriteStateRoutes(
  svg: SVGSVGElement,
  compact = false,
  diagram?: StateDiagramRoutingData,
) {
  if (!svg.classList.contains('statediagram')) return;
  let plan: ReturnType<typeof stateRoutePlan>;
  try {
    // Retain verified parser identity for repeat fits and SVG clones. Never
    // reconstruct missing identity from text, element order, or painted paths.
    plan = stateRoutePlan(svg, diagram ?? JSON.parse(svg.dataset.stateRouteGraph ?? 'null'));
  } catch {
    return;
  }
  if (!plan) return;
  const { paths, labels, nodesById, routes } = plan;
  const referencePath = paths[0];
  if (!referencePath) return;
  const nodeBounds = new Map<string, Bounds>();
  const nodeElements = new Map<string, { node: SVGGElement; shape: SVGGraphicsElement }>();
  for (const [id, node] of nodesById) {
    const shape = shapeForNode(node);
    const bounds = shape && boundsInPathSpace(shape, referencePath);
    if (!shape || !bounds || !Object.values(bounds).every(Number.isFinite)) return;
    if (compact && !node.transform.baseVal.consolidate()?.matrix) return;
    nodeBounds.set(id, bounds);
    nodeElements.set(id, { node, shape });
  }
  svg.dataset.stateRouteGraph = JSON.stringify({
    direction: plan.diagram.direction,
    nodes: plan.diagram.nodes.map(({ id, domId, shape }) => ({ id, domId, shape })),
    edges: plan.diagram.edges.map(({ id, start, end }) => ({ id, start, end })),
  } satisfies StateDiagramRoutingData);
  for (const element of [...paths, ...labels]) {
    element.style.setProperty('transition-property', 'none', 'important');
  }
  if (compact) {
    const idle = nodeBounds.get('Idle');
    if (!idle) return;
    const centerX = idle.x + idle.width / 2;
    const targets = [
      { name: 'Starting', centerOffset: 0, yOffset: 138 },
      { name: 'Streaming', centerOffset: 0, yOffset: 258 },
      { name: 'RunningTool', centerOffset: 0, yOffset: 396 },
      { name: 'NeedsInput', centerOffset: 0, yOffset: 578 },
      { name: 'Complete', centerOffset: 0, yOffset: 738 },
      { name: 'Failed', centerOffset: 0, yOffset: 898 },
    ];
    targets.forEach(({ name, centerOffset, yOffset }) => {
      const geometry = nodeElements.get(name);
      const current = nodeBounds.get(name);
      const matrix = geometry?.node.transform.baseVal.consolidate()?.matrix;
      if (!geometry || !current || !matrix) return;
      const target = { x: centerX + centerOffset - current.width / 2, y: idle.y + yOffset };
      geometry.node.style.setProperty('transition-property', 'none', 'important');
      geometry.node.setAttribute(
        'transform',
        `translate(${matrix.e + target.x - current.x}, ${matrix.f + target.y - current.y})`,
      );
      nodeBounds.set(name, { ...current, ...target });
    });
  }
  const allNodes = [...nodeBounds].flatMap(([id, bounds]) => (id === 'root_start' ? [] : [bounds]));
  const occupied: Segment[] = [];
  const occupiedRoutes: Segment[] = [];
  const routePoints: Point[] = [];
  routes.forEach(({ edge, path, label, kind: text }) => {
    // routeLabel is the legacy geometry-preset key. Never read authored label
    // text to select it, and never replace the label's authored content.
    label.dataset.routePathId = path.id;
    path.dataset.routeLabel = text;
    const source = nodeBounds.get(edge.start);
    const target = nodeBounds.get(edge.end);
    if (!source || !target) return;
    const directPoints = simplifyOrthogonalPoints(
      stateRoutePoints(text, source, target, allNodes, compact),
    );
    const scale = directPoints[1] ? segmentCssScale(path, directPoints[0], directPoints[1]) : 1;
    const points = routeOrthogonalAroundObstacles(
      directPoints,
      allNodes.filter((bounds) => bounds !== source && bounds !== target),
      STATE_NODE_CLEARANCE_CSS / scale,
      occupiedRoutes,
    );
    routePoints.push(...points);
    const labelBounds = label.getBBox();
    const placementPoints = text === STATE_LABEL.agentFinishes ? points.slice(1, 3) : points;
    const placement =
      chooseLabelSegment(placementPoints, labelBounds, occupied, path) ??
      placementPoints
        .slice(0, -1)
        .map((start, pointIndex) => {
          const end = placementPoints[pointIndex + 1];
          return {
            segment: { start, end },
            capacity: Math.hypot(end.x - start.x, end.y - start.y),
          };
        })
        .sort((left, right) => right.capacity - left.capacity)[0];
    if (!placement) return;
    path.setAttribute(
      'd',
      points.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${point.x},${point.y}`).join(''),
    );
    const labelSegment =
      text === STATE_LABEL.toolStarts && points[1] && points[2]
        ? { start: points[1], end: points[2] }
        : text === STATE_LABEL.agentAsksUser && points[1] && points[2]
          ? { start: points[1], end: points[2] }
          : text === STATE_LABEL.agentFinishes && points[1] && points[2]
            ? { start: points[1], end: points[2] }
            : !compact && text === STATE_LABEL.userReplies && points[1] && points[2]
              ? { start: points[1], end: points[2] }
              : text === STATE_LABEL.requestFails && points[1] && points[2]
                ? { start: points[1], end: points[2] }
                : compact && text === STATE_LABEL.userRetries && points[2] && points[3]
                  ? { start: points[2], end: points[3] }
                  : placement.segment;
    path.dataset.routeLabel = text;
    path.dataset.labelSegment = `${labelSegment.start.x},${labelSegment.start.y} ${labelSegment.end.x},${labelSegment.end.y}`;
    path.dataset.labelCapacity = String(
      Math.hypot(
        labelSegment.end.x - labelSegment.start.x,
        labelSegment.end.y - labelSegment.start.y,
      ),
    );
    path.dataset.manhattanSegments = String(points.length - 1);
    path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
    path.dataset.terminalTarget = nodeElements.get(edge.end)?.node.id ?? edge.end;
    label.dataset.routePathId = path.id;
    occupied.push(labelSegment);
    occupiedRoutes.push(...segments(points));
  });
  const minX = Math.min(
    ...allNodes.map((bounds) => bounds.x),
    ...routePoints.map((point) => point.x),
  );
  const minY = Math.min(
    2,
    ...allNodes.map((bounds) => bounds.y),
    ...routePoints.map((point) => point.y),
  );
  const maxX = Math.max(
    ...allNodes.map((bounds) => bounds.x + bounds.width),
    ...routePoints.map((point) => point.x),
  );
  const maxY = Math.max(
    ...allNodes.map((bounds) => bounds.y + bounds.height),
    ...routePoints.map((point) => point.y),
  );
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Keep an entry's departure fixed; try only the four local target-side midpoints. */
export function chooseClearStateEntryRoute(
  points: Point[],
  target: Bounds,
  obstacles: Bounds[],
  occupied: Segment[],
  clearance = 8,
) {
  if (points.length < 2) return points;
  const occupiedBounds = occupied.map(({ start, end }) => ({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }));
  const clear = (route: Point[]) =>
    segments(route).every(
      (segment) =>
        !segmentCrossesBounds(segment, target) &&
        [...obstacles, ...occupiedBounds].every(
          (bounds) => !segmentCrossesBounds(segment, bounds, clearance),
        ),
    );
  if (clear(points)) return points;
  const start = points[0];
  const side = cardinalSideFromDirection(start, points[1]);
  const lead = { ...start };
  const distance = clearance * 2;
  if (side === 'top') lead.y -= distance;
  if (side === 'bottom') lead.y += distance;
  if (side === 'left') lead.x -= distance;
  if (side === 'right') lead.x += distance;
  const candidates = [
    { point: pointAt(target, 0.5, 0), dx: 0, dy: -distance },
    { point: pointAt(target, 1, 0.5), dx: distance, dy: 0 },
    { point: pointAt(target, 0.5, 1), dx: 0, dy: distance },
    { point: pointAt(target, 0, 0.5), dx: -distance, dy: 0 },
  ].flatMap(({ point, dx, dy }) => {
    const endLead = { x: point.x + dx, y: point.y + dy };
    return [
      [start, lead, { x: lead.x, y: endLead.y }, endLead, point],
      [start, lead, { x: endLead.x, y: lead.y }, endLead, point],
    ]
      .map(simplifyOrthogonalPoints)
      .filter((route) => {
        const first = route[1],
          last = route.at(-2)!;
        return (
          (first.x - start.x) * (lead.x - start.x) + (first.y - start.y) * (lead.y - start.y) > 0 &&
          (last.x - point.x) * dx + (last.y - point.y) * dy > 0 &&
          clear(route)
        );
      });
  });
  const length = (route: Point[]) =>
    segments(route).reduce(
      (sum, { start, end }) => sum + Math.hypot(end.x - start.x, end.y - start.y),
      0,
    );
  return candidates.toSorted((a, b) => length(a) - length(b))[0] ?? points;
}

export function repairStateEntryRoutes(svg: SVGSVGElement) {
  if (!svg.classList.contains('statediagram')) return;
  const paths = [
    ...svg.querySelectorAll<SVGPathElement>('.edgePaths path, path.transition[data-edge="true"]'),
  ];
  const reference = paths[0];
  if (!reference) return;
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
    const shape = shapeForNode(node);
    const bounds = shape && boundsInPathSpace(shape, reference);
    return shape && bounds ? [{ node, shape, bounds }] : [];
  });
  const routes = paths.flatMap((path) => {
    let points: Point[];
    try {
      points = path.dataset.manhattanPoints
        ? path.dataset.manhattanPoints.split(' ').map((value) => {
            const [x, y] = value.split(',').map(Number);
            return { x, y };
          })
        : JSON.parse(atob(path.dataset.points ?? ''));
    } catch {
      return [];
    }
    if (
      !Array.isArray(points) ||
      points.length < 2 ||
      points.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
    )
      return [];
    const nearest = (point: Point) =>
      nodes.toSorted(
        (a, b) => distanceToBounds(point, a.bounds) - distanceToBounds(point, b.bounds),
      )[0];
    return [{ path, points, source: nearest(points[0]), target: nearest(points.at(-1)!) }];
  });
  for (const route of routes) {
    const { path, points, source, target } = route;
    if (
      !source ||
      !target ||
      source === target ||
      source.shape.tagName !== 'circle' ||
      target.shape.tagName !== 'rect' ||
      routes.some((other) => other.target === source)
    )
      continue;
    const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')].flatMap(
      (label) => {
        if (!label.textContent?.trim()) return [];
        const bounds = clientBoundsInPathSpace(label, path);
        return bounds ? [bounds] : [];
      },
    );
    const next = chooseClearStateEntryRoute(
      points,
      target.bounds,
      [
        ...nodes.filter((node) => node !== source && node !== target).map((node) => node.bounds),
        ...labels,
      ],
      routes.filter((other) => other !== route).flatMap((other) => segments(other.points)),
    );
    if (next === points) continue;
    const d = buildRoundedOrthogonalPath(next);
    path.setAttribute('d', d);
    path.dataset.terminalGapBasePath = d;
    path.dataset.manhattanPoints = next.map(({ x, y }) => `${x},${y}`).join(' ');
    path.dataset.manhattanSegments = String(next.length - 1);
    path.dataset.terminalTarget = target.node.id;
    const end = next.at(-1)!,
      previous = next.at(-2)!;
    path.dataset.terminalDirection = `${end.x - previous.x},${end.y - previous.y}`;
    route.points = next;
  }
}

function shortenStateRouteDetours(svg: SVGSVGElement) {
  const paths = [
    ...svg.querySelectorAll<SVGPathElement>('.edgePaths path, path.transition[data-edge="true"]'),
  ];
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
  const reference = paths[0];
  if (!reference) return;
  const allNodes = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
    const shape = shapeForNode(node);
    const bounds = shape && boundsInPathSpace(shape, reference);
    if (!shape || !bounds) return [];
    const style = getComputedStyle(shape);
    return [
      {
        ...bounds,
        corner: {
          x: Math.min(bounds.width / 2, Number.parseFloat(style.rx) || 0),
          y: Math.min(bounds.height / 2, Number.parseFloat(style.ry) || 0),
        },
      },
    ];
  });
  const routes = paths.flatMap((path) => {
    const points = (path.dataset.manhattanPoints ?? '').split(' ').map((value) => {
      const [x, y] = value.split(',').map(Number);
      return { x, y };
    });
    if (points.length < 2 || points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y)))
      return [];
    const nearest = (point: Point) =>
      allNodes.toSorted((a, b) => distanceToBounds(point, a) - distanceToBounds(point, b))[0];
    return [{ path, points, source: nearest(points[0]), target: nearest(points.at(-1)!) }];
  });
  for (const route of routes) {
    const { path, points, source, target } = route;
    // Only reconsider an upward departure that overshoots both endpoints of a
    // downward transition. Ordinary state lanes retain their assigned geometry.
    if (
      !source ||
      !target ||
      target.y <= source.y ||
      points[1].y >= Math.min(source.y, target.y) - Math.max(source.height, target.height)
    )
      continue;
    const label = labels.find((label) => label.dataset.routePathId === path.id);
    const labelBounds = label && clientBoundsInPathSpace(label, path);
    if (!label || !labelBounds) continue;
    const others = routes.filter((other) => other !== route);
    const occupied = others.flatMap((other) => segments(other.points));
    const obstacles = allNodes.filter((node) => node !== source && node !== target);
    const labelObstacles = labels
      .filter((other) => other !== label)
      .flatMap((other) => {
        const bounds = clientBoundsInPathSpace(other, path);
        return bounds ? [bounds] : [];
      });
    const ports = (node: Bounds) =>
      others.flatMap((other) => [
        ...(other.source === node ? [other.points[0]] : []),
        ...(other.target === node ? [other.points.at(-1)!] : []),
      ]);
    const local = chooseClearFlowchartRoute(
      points,
      source,
      target,
      [...obstacles, ...labelObstacles],
      occupied,
      ports(source),
      ports(target),
      { bounds: labelBounds, obstacles: labelObstacles, occupied },
      false,
      true,
    );
    if (local === points) continue;
    const placement = chooseClearFlowchartLabel(
      local,
      labelBounds,
      [...allNodes, ...labelObstacles],
      occupied,
    );
    if (!placement) continue;
    route.points = local;
    path.setAttribute(
      'd',
      local.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x},${y}`).join(''),
    );
    path.dataset.manhattanPoints = local.map(({ x, y }) => `${x},${y}`).join(' ');
    path.dataset.manhattanSegments = String(local.length - 1);
    path.dataset.labelSegment = `${placement.start.x},${placement.start.y} ${placement.end.x},${placement.end.y}`;
    const end = local.at(-1)!;
    const previous = local.at(-2)!;
    path.dataset.terminalDirection = `${end.x - previous.x},${end.y - previous.y}`;
    delete path.dataset.terminalGapBasePath;
    const labelLocal = label.getBBox();
    const parentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getCTM();
    const pathMatrix = path.getCTM();
    if (parentMatrix && pathMatrix) {
      const center = new DOMPoint(placement.center.x, placement.center.y)
        .matrixTransform(pathMatrix)
        .matrixTransform(parentMatrix.inverse());
      label.setAttribute(
        'transform',
        `translate(${center.x - labelLocal.x - labelLocal.width / 2},${center.y - labelLocal.y - labelLocal.height / 2})`,
      );
      label.dataset.finalPathCenter = `${placement.center.x},${placement.center.y}`;
    }
  }
}

type StateLabelPathCandidate = {
  id: string;
  nativeId?: string;
  intersectsLabel: boolean;
};

export function chooseStateLabelPathIndex(
  label: { nativeId?: string; routePathId?: string },
  paths: StateLabelPathCandidate[],
) {
  if (label.nativeId) {
    const matches = paths.flatMap((path, index) =>
      path.nativeId === label.nativeId ? [index] : [],
    );
    if (matches.length) return matches.length === 1 ? matches[0] : null;
  }
  if (label.routePathId) {
    const matches = paths.flatMap((path, index) => (path.id === label.routePathId ? [index] : []));
    if (matches.length) return matches.length === 1 ? matches[0] : null;
  }
  const intersections = paths.flatMap((path, index) => (path.intersectsLabel ? [index] : []));
  return intersections.length === 1 ? intersections[0] : null;
}

function statePathIntersectsLabel(path: SVGPathElement, label: SVGGElement) {
  const bounds = clientBoundsInPathSpace(label, path);
  const length = path.getTotalLength();
  if (!bounds || !length) return false;
  const step = Math.max(1, Math.min(bounds.width, bounds.height) / 4);
  const samples = Math.max(16, Math.min(2048, Math.ceil(length / step)));
  return Array.from({ length: samples + 1 }, (_, index) =>
    path.getPointAtLength((length * index) / samples),
  ).some((point) => distanceToBounds(point, bounds) <= 0.5);
}

export function repairUpwardStateFailureRoutes(svg: SVGSVGElement) {
  if (!svg.classList.contains('statediagram')) return;
  const paths = [
    ...svg.querySelectorAll<SVGPathElement>('.edgePaths path, path.transition[data-edge="true"]'),
  ];
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
  const claimed = new Set<SVGPathElement>();
  labels.forEach((label) => {
    if (label.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() !== 'fail') return;
    const nativeId = label
      .querySelector<SVGGraphicsElement>(':scope > .label[data-id]')
      ?.getAttribute('data-id');
    const pathIndex = chooseStateLabelPathIndex(
      { nativeId: nativeId ?? undefined, routePathId: label.dataset.routePathId },
      paths.map((path) => ({
        id: path.id,
        nativeId: path.dataset.id,
        intersectsLabel: statePathIntersectsLabel(path, label),
      })),
    );
    const path = pathIndex === null ? undefined : paths[pathIndex];
    if (!path || claimed.has(path)) return;
    const length = path.getTotalLength();
    if (!length) return;
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(length);
    const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
      const shape = shapeForNode(node);
      const bounds = shape && boundsInPathSpace(shape, path);
      return shape && bounds ? [{ node, shape, bounds }] : [];
    });
    const source = nodes.toSorted(
      (left, right) => distanceToBounds(start, left.bounds) - distanceToBounds(start, right.bounds),
    )[0];
    const target = nodes.toSorted(
      (left, right) => distanceToBounds(end, left.bounds) - distanceToBounds(end, right.bounds),
    )[0];
    if (!source || !target || source === target || target.bounds.y >= source.bounds.y) return;
    const overlapLeft = Math.max(source.bounds.x, target.bounds.x);
    const overlapRight = Math.min(
      source.bounds.x + source.bounds.width,
      target.bounds.x + target.bounds.width,
    );
    if (overlapRight <= overlapLeft) return;
    const x = overlapLeft + (overlapRight - overlapLeft) * 0.75;
    const style = getComputedStyle(source.shape);
    const rx = Math.min(source.bounds.width / 2, Number.parseFloat(style.rx) || 0);
    const ry = Math.min(source.bounds.height / 2, Number.parseFloat(style.ry) || 0);
    const cornerX = Math.max(
      source.bounds.x + rx - x,
      x - (source.bounds.x + source.bounds.width - rx),
      0,
    );
    const cornerInset = rx > 0 ? ry * (1 - Math.sqrt(Math.max(0, 1 - (cornerX / rx) ** 2))) : 0;
    const points = [
      { x, y: source.bounds.y + cornerInset },
      { x, y: target.bounds.y + target.bounds.height },
    ];
    const pathData = `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`;
    path.setAttribute('d', pathData);
    path.dataset.terminalGapBasePath = pathData;
    path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
    path.dataset.manhattanSegments = '1';
    path.dataset.labelSegment = `${points[0].x},${points[0].y} ${points[1].x},${points[1].y}`;
    path.dataset.routeLabel = 'fail';
    path.dataset.terminalTarget = target.node.id;
    path.dataset.terminalDirection = '0,-1';
    label.dataset.routePathId = path.id;
    claimed.add(path);
  });
}

export function placeStateLabelsOnFinalRoutes(svg: SVGSVGElement, compact = false): Bounds | null {
  if (!svg.classList.contains('statediagram')) return null;
  const placed: Bounds[] = [];
  const nodeBounds = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
    const matrix = node.transform.baseVal.consolidate()?.matrix;
    const bounds = node.getBBox();
    return matrix
      ? [
          {
            x: bounds.x + matrix.e,
            y: bounds.y + matrix.f,
            width: bounds.width,
            height: bounds.height,
          },
        ]
      : [];
  });
  const routeSegments = [
    ...svg.querySelectorAll<SVGPathElement>('.edgePaths path, path.transition[data-edge="true"]'),
  ].map((path) => {
    const points = (path.dataset.manhattanPoints ?? '')
      .split(' ')
      .map((point) => point.split(',').map(Number))
      .filter((point) => point.length === 2 && point.every(Number.isFinite))
      .map(([x, y]) => ({ x, y }));
    return { path, segments: points.slice(1).map((end, index) => ({ start: points[index], end })) };
  });
  const overlaps = (left: Bounds, right: Bounds, padding = 4) =>
    left.x < right.x + right.width + padding &&
    left.x + left.width + padding > right.x &&
    left.y < right.y + right.height + padding &&
    left.y + left.height + padding > right.y;
  const segmentHits = (segment: Segment, bounds: Bounds) => {
    if (Math.abs(segment.start.x - segment.end.x) < 0.5) {
      const top = Math.min(segment.start.y, segment.end.y);
      const bottom = Math.max(segment.start.y, segment.end.y);
      return (
        segment.start.x > bounds.x - 3 &&
        segment.start.x < bounds.x + bounds.width + 3 &&
        bottom > bounds.y - 3 &&
        top < bounds.y + bounds.height + 3
      );
    }
    const left = Math.min(segment.start.x, segment.end.x);
    const right = Math.max(segment.start.x, segment.end.x);
    return (
      segment.start.y > bounds.y - 3 &&
      segment.start.y < bounds.y + bounds.height + 3 &&
      right > bounds.x - 3 &&
      left < bounds.x + bounds.width + 3
    );
  };
  for (const label of svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')) {
    const pathId = label.dataset.routePathId;
    const path = pathId ? svg.querySelector<SVGPathElement>(`#${CSS.escape(pathId)}`) : null;
    const values = path?.dataset.labelSegment?.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)?.map(Number);
    if (!path || !values || values.length !== 4) continue;
    const local = label.getBBox();
    const fractions = compact
      ? path.dataset.routeLabel === STATE_LABEL.requestFails
        ? [0.03]
        : [0.5, 0.25, 0.75, 0.15, 0.35, 0.65, 0.85]
      : [0.5, 0.25, 0.75];
    const ownSegments = routeSegments.find((route) => route.path === path)?.segments ?? [];
    const retryShelf =
      compact && path.dataset.routeLabel === STATE_LABEL.userRetries
        ? ownSegments.findLast(
            (segment) =>
              Math.abs(segment.start.y - segment.end.y) < 0.5 &&
              Math.abs(segment.start.x - segment.end.x) >= local.width,
          )
        : undefined;
    const pinsLabelToShelf =
      (compact &&
        (path.dataset.routeLabel === STATE_LABEL.agentAsksUser ||
          path.dataset.routeLabel === STATE_LABEL.toolStarts ||
          path.dataset.routeLabel === STATE_LABEL.requestFails ||
          path.dataset.routeLabel === STATE_LABEL.userRetries)) ||
      (!compact &&
        (path.dataset.routeLabel === STATE_LABEL.agentAsksUser ||
          path.dataset.routeLabel === STATE_LABEL.agentFinishes ||
          path.dataset.routeLabel === STATE_LABEL.toolStarts ||
          path.dataset.routeLabel === STATE_LABEL.userReplies ||
          path.dataset.routeLabel === STATE_LABEL.requestFails));
    const candidateSegments = [
      retryShelf
        ? {
            x1: retryShelf.start.x,
            y1: retryShelf.start.y,
            x2: retryShelf.end.x,
            y2: retryShelf.end.y,
          }
        : { x1: values[0], y1: values[1], x2: values[2], y2: values[3] },
      ...(pinsLabelToShelf
        ? []
        : ownSegments.map(({ start, end }) => ({
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
          }))),
    ].filter(
      (segment, index, segments) =>
        segments.findIndex(
          (candidate) =>
            candidate.x1 === segment.x1 &&
            candidate.y1 === segment.y1 &&
            candidate.x2 === segment.x2 &&
            candidate.y2 === segment.y2,
        ) === index,
    );
    const candidates = candidateSegments.flatMap((candidateSegment) => {
      const segment = {
        start: { x: candidateSegment.x1, y: candidateSegment.y1 },
        end: { x: candidateSegment.x2, y: candidateSegment.y2 },
      };
      const capacity = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
      const horizontal = Math.abs(segment.start.y - segment.end.y) < 0.5;
      const halfLabelExtent = (horizontal ? local.width : local.height) / 2;
      const clearance =
        LABEL_TURN_CLEARANCE_CSS / segmentCssScale(path, segment.start, segment.end);
      return fractions
        .filter(
          (fraction) => capacity * Math.max(fraction, 1 - fraction) >= halfLabelExtent + clearance,
        )
        .map((fraction) => {
          const midpoint = {
            x: candidateSegment.x1 + (candidateSegment.x2 - candidateSegment.x1) * fraction,
            y: candidateSegment.y1 + (candidateSegment.y2 - candidateSegment.y1) * fraction,
          };
          const placesLabelInsideRightLane =
            compact &&
            Math.abs(candidateSegment.x1 - candidateSegment.x2) < 0.5 &&
            (path.dataset.routeLabel === STATE_LABEL.userReplies ||
              path.dataset.routeLabel === STATE_LABEL.agentFinishes);
          if (placesLabelInsideRightLane) {
            midpoint.x -=
              local.width / 2 - (path.dataset.routeLabel === STATE_LABEL.userReplies ? 0 : 6);
          }
          const placesAgentResponseBetweenStates =
            compact &&
            Math.abs(candidateSegment.x1 - candidateSegment.x2) < 0.5 &&
            path.dataset.routeLabel === STATE_LABEL.agentResponds;
          if (placesAgentResponseBetweenStates) midpoint.y += 6;
          const placesLabelInsideLeftLane =
            Math.abs(candidateSegment.x1 - candidateSegment.x2) < 0.5 &&
            ((compact &&
              (path.dataset.routeLabel === STATE_LABEL.agentAsksUser ||
                path.dataset.routeLabel === STATE_LABEL.requestFails ||
                path.dataset.routeLabel === STATE_LABEL.streamFails)) ||
              (!compact && path.dataset.routeLabel === STATE_LABEL.requestFails));
          if (placesLabelInsideLeftLane) {
            const inset =
              path.dataset.routeLabel === STATE_LABEL.agentAsksUser
                ? 0
                : path.dataset.routeLabel === STATE_LABEL.streamFails
                  ? -26
                  : 0;
            midpoint.x += local.width / 2 + inset;
          }
          const placesRetryAboveShelf =
            compact &&
            Math.abs(candidateSegment.y1 - candidateSegment.y2) < 0.5 &&
            path.dataset.routeLabel === STATE_LABEL.userRetries;
          if (placesRetryAboveShelf) {
            midpoint.x += 12;
            midpoint.y -= local.height / 2 - 4;
          }
          const placesToolCompletionBesideReturnLane =
            !compact &&
            Math.abs(candidateSegment.x1 - candidateSegment.x2) < 0.5 &&
            path.dataset.routeLabel === STATE_LABEL.toolCompletes;
          if (placesToolCompletionBesideReturnLane) midpoint.x += local.width / 2 - 6;
          const bounds = {
            x: midpoint.x - local.width / 2,
            y: midpoint.y - local.height / 2,
            width: local.width,
            height: local.height,
          };
          const labelCollisions = placed.filter((other) => overlaps(bounds, other)).length;
          const nodeCollisions = nodeBounds.filter((node) => overlaps(bounds, node, 5)).length;
          const routeCollisions = routeSegments
            .filter((route) => route.path !== path)
            .flatMap((route) => route.segments)
            .filter((segment) => segmentHits(segment, bounds)).length;
          const nearestTurn = capacity * Math.min(fraction, 1 - fraction);
          return {
            midpoint,
            bounds,
            score:
              labelCollisions * 10_000 +
              nodeCollisions * 10_000 +
              routeCollisions * 1_000 +
              (nearestTurn < halfLabelExtent + clearance ? 100 : 0) +
              Math.abs(fraction - 0.5),
          };
        });
    });
    if (candidates.length === 0) continue;
    const eligibleCandidates = candidates;
    eligibleCandidates.sort((left, right) => {
      const collisionDelta = Math.floor(left.score / 1_000) - Math.floor(right.score / 1_000);
      if (collisionDelta !== 0) return collisionDelta;
      if (compact && path.dataset.routeLabel === STATE_LABEL.toolStarts) {
        const targetY = values[1] + (values[3] - values[1]) * 0.65;
        return Math.abs(left.midpoint.y - targetY) - Math.abs(right.midpoint.y - targetY);
      }
      if (compact && path.dataset.routeLabel === STATE_LABEL.agentAsksUser) {
        const targetY = values[1] + (values[3] - values[1]) * 0.65;
        return Math.abs(left.midpoint.y - targetY) - Math.abs(right.midpoint.y - targetY);
      }
      if (compact && path.dataset.routeLabel === STATE_LABEL.requestFails) {
        const targetY = values[1] + (values[3] - values[1]) * 0.04;
        return Math.abs(left.midpoint.y - targetY) - Math.abs(right.midpoint.y - targetY);
      }
      if (!compact && path.dataset.routeLabel === STATE_LABEL.agentAsksUser) {
        return left.midpoint.x - right.midpoint.x;
      }
      if (!compact && path.dataset.routeLabel === STATE_LABEL.agentFinishes) {
        const centerX = (values[0] + values[2]) / 2;
        return Math.abs(left.midpoint.x - centerX) - Math.abs(right.midpoint.x - centerX);
      }
      if (!compact && path.dataset.routeLabel === STATE_LABEL.toolStarts) {
        return right.midpoint.y - left.midpoint.y;
      }
      if (!compact && path.dataset.routeLabel === STATE_LABEL.userReplies) {
        return right.midpoint.x - left.midpoint.x;
      }
      return left.score - right.score;
    });
    const midpoint = eligibleCandidates[0].midpoint;
    const bounds = {
      x: midpoint.x - local.width / 2,
      y: midpoint.y - local.height / 2,
      width: local.width,
      height: local.height,
    };
    const pathMatrix = path.getCTM();
    const labelParentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getCTM();
    const labelMidpoint =
      pathMatrix && labelParentMatrix
        ? new DOMPoint(midpoint.x, midpoint.y)
            .matrixTransform(pathMatrix)
            .matrixTransform(labelParentMatrix.inverse())
        : midpoint;
    const x = labelMidpoint.x - (local.x + local.width / 2);
    const y = labelMidpoint.y - (local.y + local.height / 2);
    label.setAttribute('transform', `translate(${x}, ${y})`);
    label.dataset.finalPathCenter = `${midpoint.x},${midpoint.y}`;
    placed.push(bounds);
  }
  shortenStateRouteDetours(svg);
  if (!placed.length) return null;
  const left = Math.min(...placed.map((bounds) => bounds.x));
  const top = Math.min(...placed.map((bounds) => bounds.y));
  const right = Math.max(...placed.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...placed.map((bounds) => bounds.y + bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
