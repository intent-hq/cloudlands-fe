const ORTHOGONAL_CORNER_RADIUS = 6;
const FLOWCHART_PORT_SLOT_GAP = 16;
const MAX_TERMINAL_CORRECTION = 4;
const COMPACT_ARROW_SIZE = 7;
const LABEL_TURN_CLEARANCE_CSS = 8;

type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
type Segment = { start: Point; end: Point };

export function chooseFlowchartFeedbackTargetX(target: Bounds, sameSidePorts: number[]) {
  const center = target.x + target.width / 2;
  const occupied = sameSidePorts.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (!occupied.some((port) => Math.abs(port - center) <= 1)) return center;

  const slotCount = occupied.length + 1;
  const gap = Math.min(FLOWCHART_PORT_SLOT_GAP, (target.width * 0.6) / (slotCount - 1));
  return center - (gap * (slotCount - 1)) / 2;
}

function segmentCssScale(path: SVGGraphicsElement, start: Point, end: Point) {
  const matrix = path.getScreenCTM();
  const localLength = Math.hypot(end.x - start.x, end.y - start.y);
  if (!matrix || localLength <= 0) return 1;
  const screenStart = new DOMPoint(start.x, start.y).matrixTransform(matrix);
  const screenEnd = new DOMPoint(end.x, end.y).matrixTransform(matrix);
  return Math.hypot(screenEnd.x - screenStart.x, screenEnd.y - screenStart.y) / localLength || 1;
}

export function measuredClusterHeaderHeight(titleHeight: number) {
  return Math.ceil(Math.max(titleHeight, 18)) + 48;
}

export function buildFlowchartDecisionBranchPoints(
  source: Bounds,
  target: Bounds,
  branch: 'upper' | 'lower',
  occupied: Bounds[],
  compact = false,
): Point[] {
  const upper = branch === 'upper';
  const sourcePort = pointAt(source, 0.75, upper ? 0.25 : 0.75);
  const targetToRight = target.x >= source.x + source.width;
  if (targetToRight) {
    const laneX = Math.min(
      target.x - 12,
      Math.max(source.x + source.width + (upper ? 28 : 40), sourcePort.x + 44),
    );
    const targetPort = pointAt(target, 0, 0.5);
    return [sourcePort, { x: laneX, y: sourcePort.y }, { x: laneX, y: targetPort.y }, targetPort];
  }
  if (!upper) {
    const stubX = source.x + source.width + 48;
    const bridgeY = source.y + source.height + 18;
    const laneX = Math.min(...occupied.map((bounds) => bounds.x)) - (compact ? 16 : 32);
    const targetPort = pointAt(target, 0, 0.5);
    return [
      sourcePort,
      { x: stubX, y: sourcePort.y },
      { x: stubX, y: bridgeY },
      { x: laneX, y: bridgeY },
      { x: laneX, y: targetPort.y },
      targetPort,
    ];
  }
  const laneX = Math.max(...occupied.map((bounds) => bounds.x + bounds.width)) + 32;
  const targetPort = pointAt(target, 1, 0.5);
  return [sourcePort, { x: laneX, y: sourcePort.y }, { x: laneX, y: targetPort.y }, targetPort];
}

export function buildFlowchartDecisionReturnPoints(
  source: Bounds,
  target: Bounds,
  occupied: Bounds[],
  compact = false,
): Point[] {
  const sourcePort = pointAt(source, 0.5, 1);
  const outerBottom = Math.max(...occupied.map((bounds) => bounds.y + bounds.height)) + 32;
  const targetBottom = pointAt(target, 0.5, 1);
  const horizontalOverlap =
    Math.min(source.x + source.width, target.x + target.width) - Math.max(source.x, target.x);
  if (horizontalOverlap <= 0) {
    return [
      sourcePort,
      { x: sourcePort.x, y: outerBottom },
      { x: targetBottom.x, y: outerBottom },
      targetBottom,
    ];
  }
  const outerLeft = Math.min(...occupied.map((bounds) => bounds.x)) - (compact ? 26 : 64);
  const bridgeY = source.y + source.height + 18;
  const targetPort = pointAt(target, 0, 0.5);
  return [
    sourcePort,
    { x: sourcePort.x, y: bridgeY },
    { x: outerLeft, y: bridgeY },
    { x: outerLeft, y: targetPort.y },
    targetPort,
  ];
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

export function buildGroupedReturnLanePoints(source: Bounds, target: Bounds, occupied: Bounds[]) {
  const laneX = Math.max(...occupied.map((bounds) => bounds.x + bounds.width)) + 28;
  const sourceY = source.y + source.height / 2;
  const targetY = target.y + target.height / 2;
  return [
    { x: source.x + source.width, y: sourceY },
    { x: laneX, y: sourceY },
    { x: laneX, y: targetY },
    { x: target.x + target.width, y: targetY },
  ];
}

function boundsOverlap(left: Bounds, right: Bounds, padding = 4) {
  return (
    left.x < right.x + right.width + padding &&
    left.x + left.width + padding > right.x &&
    left.y < right.y + right.height + padding &&
    left.y + left.height + padding > right.y
  );
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

function boundsInPathSpace(element: SVGGraphicsElement, path: SVGPathElement): Bounds | null {
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

function rayBoundsEntry(origin: Point, direction: Point, bounds: Bounds): Point | null {
  let near = Number.NEGATIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;
  for (const [position, delta, minimum, maximum] of [
    [origin.x, direction.x, bounds.x, bounds.x + bounds.width],
    [origin.y, direction.y, bounds.y, bounds.y + bounds.height],
  ]) {
    if (Math.abs(delta) < 0.0001) {
      if (position < minimum || position > maximum) return null;
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

function distanceToShape(point: Point, bounds: Bounds, shape: SVGGraphicsElement) {
  if (shape.dataset.diagramCylinder !== 'true') return distanceToBounds(point, bounds);
  const boundary = cylinderBoundary(bounds, shape);
  return Math.min(
    ...boundary.slice(1).map((end, index) => distanceToSegment(point, boundary[index], end)),
  );
}

function rayShapeEntry(origin: Point, direction: Point, bounds: Bounds, shape: SVGGraphicsElement) {
  const boundsEntry = rayBoundsEntry(origin, direction, bounds);
  if (!boundsEntry || shape.dataset.diagramCylinder !== 'true') return boundsEntry;
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

  for (const path of svg.querySelectorAll<SVGPathElement>('.edgePaths path[marker-end]')) {
    const length = path.getTotalLength();
    if (length < 0.25) continue;
    const terminal = path.getPointAtLength(length);
    const tangentPoint = path.getPointAtLength(Math.max(0, length - 0.1));
    const tangentLength = Math.hypot(terminal.x - tangentPoint.x, terminal.y - tangentPoint.y);
    if (tangentLength < 0.0001) continue;
    const direction = {
      x: (terminal.x - tangentPoint.x) / tangentLength,
      y: (terminal.y - tangentPoint.y) / tangentLength,
    };
    const origin = { x: terminal.x - direction.x * 256, y: terminal.y - direction.y * 256 };
    const knownTarget = path.dataset.terminalTarget;
    const candidates = targets.flatMap(({ node, shape }) => {
      const rawBounds = clientBoundsInPathSpace(shape, path);
      if (!rawBounds) return [];
      const bounds = rawBounds;
      const intersection = rayBoundsEntry(origin, direction, bounds);
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

  for (const path of svg.querySelectorAll<SVGPathElement>('.edgePaths path[marker-end]')) {
    if (markerForPath(svg, path)?.dataset.diagramChevron !== 'true') continue;
    const length = path.getTotalLength();
    if (length < 0.25) continue;
    const terminal = path.getPointAtLength(length);
    const tangentPoint = path.getPointAtLength(Math.max(0, length - 0.1));
    const matrix = path.getScreenCTM();
    if (!matrix) continue;
    const terminalScreen = new DOMPoint(terminal.x, terminal.y).matrixTransform(matrix);
    const tangentScreen = new DOMPoint(tangentPoint.x, tangentPoint.y).matrixTransform(matrix);
    const screenLength = Math.hypot(
      terminalScreen.x - tangentScreen.x,
      terminalScreen.y - tangentScreen.y,
    );
    if (screenLength <= 0) continue;
    const screenDirection = {
      x: (terminalScreen.x - tangentScreen.x) / screenLength,
      y: (terminalScreen.y - tangentScreen.y) / screenLength,
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
      const intersection = rayShapeEntry(origin, screenDirection, bounds, shape);
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
    const repaired = replacePathTerminal(path.getAttribute('d') ?? '', terminalPoint);
    if (!repaired) continue;
    path.setAttribute('d', repaired);
    path.dataset.terminalTarget = target.node.id;
    path.dataset.terminalGapCss = String(cssGap);
  }
}

function parseOrthogonalLinePath(pathData: string): Point[] | null {
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
  if (points.length < 3) return null;
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
  const cornerRadius = svg.classList.contains('statediagram') ? 2 : ORTHOGONAL_CORNER_RADIUS;
  for (const path of svg.querySelectorAll<SVGPathElement>(
    '.flowchart-link, .edgePaths path, path.relation',
  )) {
    const points = parseOrthogonalLinePath(path.getAttribute('d') ?? '');
    if (!points) continue;
    const simplified = simplifyOrthogonalPoints(points);
    path.dataset.manhattanPoints ??= simplified.map((point) => `${point.x},${point.y}`).join(' ');
    const rounded = buildRoundedOrthogonalPath(simplified, cornerRadius);
    if (!path.dataset.feedbackLane) {
      path.dataset.manhattanSegments = String(Math.max(0, simplified.length - 1));
    }
    if (!rounded.includes(' Q ')) continue;
    path.setAttribute('d', rounded);
    path.dataset.cornerRadius = String(ORTHOGONAL_CORNER_RADIUS);
    if (cornerRadius !== ORTHOGONAL_CORNER_RADIUS) {
      path.dataset.cornerRadius = String(cornerRadius);
    }
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
    node.append(outline);
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
  const label = path && flowchartLabelForPath(svg, path);
  let client = clientNode && flowchartNodeBounds(clientNode);
  const gateway = gatewayNode && flowchartNodeBounds(gatewayNode);
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

  if (clientNode.dataset.requestLaneRaised !== 'true') {
    const desiredGap = Math.max(52, labelBounds.height + 24);
    const currentGap = boundary.y - (client.y + client.height);
    const shift = Math.max(0, desiredGap - currentGap);
    const matrix = clientNode.transform.baseVal.consolidate()?.matrix;
    if (matrix && shift > 0) {
      clientNode.setAttribute('transform', `translate(${matrix.e}, ${matrix.f - shift})`);
      clientNode.dataset.requestLaneRaised = 'true';
      clientNode.dataset.requestLaneShift = String(shift);
      client = { ...client, y: client.y - shift };
    }
  }

  const sourcePort = pointAt(client, 0.5, 1);
  const targetPort = pointAt(gateway, 0, 0.5);
  const laneY = (sourcePort.y + boundary.y) / 2;
  const laneX = boundary.x - 8;
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
  routeGroupedReturnEdgesWithTarget(svg, 'Client', client);
  return true;
}

export function reserveFlowchartClusterHeaderBands(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  const records = [...svg.querySelectorAll<SVGGElement>('g.cluster')].flatMap((cluster) => {
    const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
    const label = cluster.querySelector<SVGGElement>(':scope > g.cluster-label');
    if (!rect || !label) return [];
    const frame = rect.getBBox();
    const members = nodes.filter((node) => {
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
    return [{ cluster, rect, label, frame, members }];
  });
  const layouts = new Map<SVGGElement, Bounds>();
  for (const record of records.toSorted(
    (left, right) => left.frame.width * left.frame.height - right.frame.width * right.frame.height,
  )) {
    const childFrames = records
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
    const memberFrames = record.members.flatMap((node) => {
      const bounds = flowchartNodeBounds(node);
      return bounds ? [bounds] : [];
    });
    const content = [...memberFrames, ...childFrames];
    if (!content.length) continue;
    const viewport = record.label.querySelector<SVGForeignObjectElement>('foreignObject');
    const titleContent = viewport?.querySelector<HTMLElement>('div');
    const titleHeight = Math.ceil(
      Math.max(
        titleContent?.getBoundingClientRect().height ?? 0,
        titleContent?.scrollHeight ?? 0,
        record.label.getBBox().height,
        18,
      ),
    );
    const headerHeight = measuredClusterHeaderHeight(titleHeight);
    const minContentX = Math.min(...content.map(({ x }) => x));
    const maxContentX = Math.max(...content.map(({ x, width }) => x + width));
    const minContentY = Math.min(...content.map(({ y }) => y));
    const maxContentY = Math.max(...content.map(({ y, height }) => y + height));
    const x = Math.min(record.frame.x, minContentX - 20);
    const y = Math.min(record.frame.y, minContentY - headerHeight);
    const right = Math.max(record.frame.x + record.frame.width, maxContentX + 20);
    const bottom = Math.max(record.frame.y + record.frame.height, maxContentY + 20);
    const frame = { x, y, width: right - x, height: bottom - y };
    record.rect.setAttribute('x', String(frame.x));
    record.rect.setAttribute('y', String(frame.y));
    record.rect.setAttribute('width', String(frame.width));
    record.rect.setAttribute('height', String(frame.height));
    record.cluster.dataset.headerHeight = String(headerHeight);
    if (viewport) {
      viewport.setAttribute('x', '0');
      viewport.setAttribute('y', '0');
      viewport.setAttribute('width', String(Math.max(24, frame.width - 40)));
      viewport.setAttribute('height', String(titleHeight));
      record.label.setAttribute('transform', `translate(${frame.x + 20}, ${frame.y + 20})`);
    } else {
      const title = record.label.getBBox();
      record.label.setAttribute(
        'transform',
        `translate(${frame.x + frame.width / 2 - title.x - title.width / 2}, ${frame.y + 20 - title.y})`,
      );
    }
    layouts.set(record.cluster, frame);
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
    const points = buildGroupedReturnLanePoints(source, target, occupied);
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
  const targetX = chooseFlowchartFeedbackTargetX(
    {
      x: Math.min(targetLeft, targetRight),
      y: 0,
      width: Math.abs(targetRight - targetLeft),
      height: 0,
    },
    sameSidePorts,
  );
  const sourcePort = new DOMPoint(
    sourceBounds.right,
    sourceBounds.top + sourceBounds.height / 2,
  ).matrixTransform(inverse);
  const targetPort = new DOMPoint(
    targetBounds.left + targetBounds.width / 2,
    targetBounds.bottom + 0.25,
  ).matrixTransform(inverse);
  targetPort.x = targetX;
  points[0] = { x: sourcePort.x, y: sourcePort.y };
  points[1].y = sourcePort.y;
  points[points.length - 2].x = targetPort.x;
  points[points.length - 1] = { x: targetPort.x, y: targetPort.y };
  path.dataset.manhattanPoints = points.map(({ x, y }) => `${x},${y}`).join(' ');
  path.setAttribute(
    'd',
    points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join(''),
  );
  placeFlowchartLabelOnRoute(flowchartLabelForPath(svg, path), path, points);
}

export function snapFlowchartFanoutPorts(svg: SVGSVGElement) {
  const edges = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].flatMap((path) => {
    if (path.dataset.clusterHeaderClearance) return [];
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
    const gap = Math.min(FLOWCHART_PORT_SLOT_GAP, (source.width * 0.6) / (ordered.length - 1));
    const firstX = source.x + source.width / 2 - (gap * (ordered.length - 1)) / 2;
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
) {
  if (!label?.textContent?.trim() || points.length < 2) return;
  const pathMatrix = path.getScreenCTM();
  const labelParentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getScreenCTM();
  if (!pathMatrix || !labelParentMatrix) return;
  const current = label.getBoundingClientRect();
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
  if (!placement) return;
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
}

export function snapFlowchartPorts(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
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
      path.dataset.clusterHeaderClearance
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
    if (!path.dataset.compactFlowchart && identity?.source === identity?.target) {
      const laneX = source.right + 32;
      specialPoints = [
        localPoint(source.right, source.top + source.height * 0.3),
        localPoint(laneX, source.top + source.height * 0.3),
        localPoint(laneX, source.top + source.height * 0.7),
        localPoint(source.right, source.top + source.height * 0.7),
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
          const laneX = left
            ? Math.min(source.left, target.left) - distance
            : Math.max(source.right, target.right) + distance;
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
          const laneY = above
            ? Math.min(source.top, target.top) - distance
            : Math.max(source.bottom, target.bottom) + distance;
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
    const sourceRight = routes[0].source.x + routes[0].source.width;
    if (routes.some((route) => route.target.x <= sourceRight + 16)) continue;
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
    x: start.x + (end.x - start.x) * 0.85,
    y: start.y + (end.y - start.y) * 0.85,
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
      if (edge.label) placeDecisionLabel(edge.label, edge.path, points[0], points[1]);
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

export function reflowCompactFlowchart(svg: SVGSVGElement, routeEdges = true): Bounds | null {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return null;
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  if (svg.querySelector('g.cluster')) {
    if (!routeEdges) positionCompactGroupedFlowchart(svg);
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

function positionCompactGroupedFlowchart(svg: SVGSVGElement) {
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const identities = paths.flatMap((path) => {
    const identity = flowchartEdgeIdentity(path);
    return identity ? [identity] : [];
  });
  const fanout = [...new Set(identities.map(({ source }) => source))].find(
    (source) => identities.filter((identity) => identity.source === source).length > 1,
  );
  const originalBounds = new Map(nodes.map((node) => [node, flowchartNodeBounds(node)]));
  const placeColumn = (column: SVGGElement[], centerX: number, startY: number) => {
    let y = startY;
    for (const node of column) {
      const bounds = node.getBBox();
      node.setAttribute(
        'transform',
        `translate(${centerX - bounds.x - bounds.width / 2}, ${y - bounds.y})`,
      );
      y += bounds.height + 100;
    }
  };
  if (fanout) {
    const ordered = nodes.toSorted(
      (left, right) =>
        (originalBounds.get(left)?.x ?? 0) - (originalBounds.get(right)?.x ?? 0) ||
        (originalBounds.get(left)?.y ?? 0) - (originalBounds.get(right)?.y ?? 0),
    );
    const columnWidth = Math.max(...ordered.map((node) => node.getBBox().width));
    placeColumn(ordered, columnWidth / 2, 48);
  } else {
    const ordered = nodes.toSorted(
      (left, right) => (originalBounds.get(left)?.y ?? 0) - (originalBounds.get(right)?.y ?? 0),
    );
    const columnWidth = Math.max(...ordered.map((node) => node.getBBox().width));
    placeColumn(ordered, columnWidth / 2, 48);
  }

  const clusters = [...svg.querySelectorAll<SVGGElement>('g.cluster')].flatMap((cluster) => {
    const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
    const label = cluster.querySelector<SVGGElement>(':scope > g.cluster-label');
    if (!rect || !label) return [];
    const originalRect = rect.getBBox();
    const members = nodes.filter((node) => {
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
    return [{ cluster, rect, label, originalRect, members }];
  });
  const layouts = new Map<SVGGElement, Bounds>();
  for (const record of clusters.toSorted(
    (left, right) =>
      left.originalRect.width * left.originalRect.height -
      right.originalRect.width * right.originalRect.height,
  )) {
    const memberBounds = record.members.flatMap((node) => {
      const bounds = flowchartNodeBounds(node);
      return bounds ? [bounds] : [];
    });
    const nestedBounds = clusters
      .filter(
        (candidate) =>
          candidate !== record &&
          candidate.originalRect.x >= record.originalRect.x &&
          candidate.originalRect.y >= record.originalRect.y &&
          candidate.originalRect.x + candidate.originalRect.width <=
            record.originalRect.x + record.originalRect.width &&
          candidate.originalRect.y + candidate.originalRect.height <=
            record.originalRect.y + record.originalRect.height,
      )
      .flatMap(({ cluster }) => {
        const bounds = layouts.get(cluster);
        return bounds ? [bounds] : [];
      });
    const contentBounds = [...memberBounds, ...nestedBounds];
    if (!contentBounds.length) continue;
    const titleViewport = record.label.querySelector<SVGForeignObjectElement>('foreignObject');
    const titleContent = titleViewport?.querySelector<HTMLElement>('div');
    const measuredTitleHeight = Math.ceil(
      Math.max(
        titleContent?.getBoundingClientRect().height ?? 0,
        titleContent?.scrollHeight ?? 0,
        18,
      ),
    );
    const headerHeight = measuredClusterHeaderHeight(measuredTitleHeight);
    const minX = Math.min(...contentBounds.map(({ x }) => x)) - 20;
    const maxX = Math.max(...contentBounds.map(({ x, width }) => x + width)) + 20;
    const minY = Math.min(...contentBounds.map(({ y }) => y)) - headerHeight;
    const maxY = Math.max(...contentBounds.map(({ y, height }) => y + height)) + 20;
    const frame = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
    layouts.set(record.cluster, frame);
  }
}

function routeCompactGroupedEdges(svg: SVGSVGElement) {
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const identities = paths.map((path) => ({ path, identity: flowchartEdgeIdentity(path) }));
  const outDegree = new Map<string, number>();
  for (const { identity } of identities) {
    if (identity) outDegree.set(identity.source, (outDegree.get(identity.source) ?? 0) + 1);
  }
  for (const { path, identity } of identities) {
    if (!identity || (outDegree.get(identity.source) ?? 0) > 1) continue;
    const sourceNode = flowchartNode(svg, identity.source);
    const targetNode = flowchartNode(svg, identity.target);
    const source = sourceNode && flowchartNodeBounds(sourceNode);
    const target = targetNode && flowchartNodeBounds(targetNode);
    if (!source || !target) continue;
    const sourceCenter = pointAt(source, 0.5, 0.5);
    const targetCenter = pointAt(target, 0.5, 0.5);
    const vertical =
      Math.abs(targetCenter.y - sourceCenter.y) >= Math.abs(targetCenter.x - sourceCenter.x);
    const points = vertical
      ? [pointAt(source, 0.5, 1), pointAt(target, 0.5, 0)]
      : [pointAt(source, 1, 0.5), pointAt(target, 0, 0.5)];
    path.setAttribute(
      'd',
      points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
    );
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

export function routeFlowchartAroundClusterHeaders(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const clusters = [...svg.querySelectorAll<SVGGElement>('g.cluster')];
  for (const path of svg.querySelectorAll<SVGPathElement>('.edgePaths path')) {
    if (path.dataset.feedbackLane) continue;
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
      placement = [1, -1]
        .map((side) => {
          const center = vertical
            ? { x: midpoint.x + side * (labelBounds.width / 2 + 4), y: midpoint.y }
            : { x: midpoint.x, y: midpoint.y + side * (labelBounds.height / 2 + 4) };
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
        .find(
          ({ bounds }) =>
            obstacles.every((obstacle) => !boundsOverlap(bounds, obstacle, 4)) &&
            placed.every((existing) => !boundsOverlap(bounds, existing, 4)),
        );
    }
    if (!placement) return;
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
  const bottom = Math.max(...allNodes.map((bounds) => bounds.y + bounds.height));
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
    const laneX = compact ? Math.max(finishSource.x, finishTarget.x) + 44 : right + 90;
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
    const laneX = left - (compact ? 68 : 40);
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
    const failSource = pointAt(source, 0.35, 1);
    const failureTarget = pointAt(target, 0, 0.5);
    const targetLaneX = failureTarget.x - 20;
    const laneY = bottom + (compact ? 25 : 45);
    return [
      failSource,
      { x: failSource.x, y: laneY },
      { x: targetLaneX, y: laneY },
      { x: targetLaneX, y: failureTarget.y },
      failureTarget,
    ];
  }
  if (compact) {
    const retrySource = pointAt(source, 0, 0.9);
    const retryTarget = pointAt(target, 0, 0.1);
    const laneX = left - 108;
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

export function rewriteStateRoutes(svg: SVGSVGElement, compact = false) {
  if (!svg.classList.contains('statediagram')) return;
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
  const referencePath = paths[0];
  if (!referencePath) return;
  const nodeBounds = new Map<string, Bounds>();
  const nodeElements = new Map<string, { node: SVGGElement; shape: SVGGraphicsElement }>();
  for (const node of svg.querySelectorAll<SVGGElement>('g.node')) {
    const name = node.textContent?.trim();
    const shape = shapeForNode(node);
    const bounds = shape && boundsInPathSpace(shape, referencePath);
    if (name && bounds) {
      nodeBounds.set(name, bounds);
      if (shape) nodeElements.set(name, { node, shape });
    }
  }
  const requiredNames = new Set(Object.values(STATE_ROUTE_NODES).flat());
  if ([...requiredNames].some((name) => !nodeBounds.has(name))) return;
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
      geometry.node.setAttribute(
        'transform',
        `translate(${matrix.e + target.x - current.x}, ${matrix.f + target.y - current.y})`,
      );
      nodeBounds.set(name, { ...current, ...target });
    });
  }
  const allNodes = [...nodeBounds.values()];
  const occupied: Segment[] = [];
  const routePoints: Point[] = [];
  const labelOrder = [
    '',
    STATE_LABEL.userSendsMessage,
    STATE_LABEL.agentResponds,
    STATE_LABEL.toolStarts,
    STATE_LABEL.toolCompletes,
    STATE_LABEL.agentAsksUser,
    STATE_LABEL.userReplies,
    STATE_LABEL.agentFinishes,
    STATE_LABEL.requestFails,
    STATE_LABEL.streamFails,
    STATE_LABEL.userRetries,
  ];
  const labelsByText = new Map(
    labels.map((label) => [label.textContent?.replace(/\s+/g, ' ').trim() ?? '', label]),
  );
  paths.forEach((path, index) => {
    const label = labelsByText.get(labelOrder[index]);
    if (!label) return;
    const text = label.textContent?.replace(/\s+/g, ' ').trim() as keyof typeof STATE_ROUTE_NODES;
    const nodeNames = STATE_ROUTE_NODES[text];
    if (!nodeNames || !path) return;
    label.dataset.routePathId = path.id;
    path.dataset.routeLabel = text;
    const source = nodeBounds.get(nodeNames[0]);
    const target = nodeBounds.get(nodeNames[1]);
    if (!source || !target) return;
    const points = simplifyOrthogonalPoints(
      stateRoutePoints(text, source, target, allNodes, compact),
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
    path.dataset.terminalTarget = nodeElements.get(nodeNames[1])?.node.id ?? nodeNames[1];
    label.dataset.routePathId = path.id;
    occupied.push(labelSegment);
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
  const routeSegments = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].map((path) => {
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
        ? [0.04, 0.15, 0.25, 0.5, 0.75, 0.85]
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
          if (placesLabelInsideRightLane) midpoint.x -= local.width / 2 - 6;
          const placesLabelInsideLeftLane =
            compact &&
            Math.abs(candidateSegment.x1 - candidateSegment.x2) < 0.5 &&
            (path.dataset.routeLabel === STATE_LABEL.agentAsksUser ||
              path.dataset.routeLabel === STATE_LABEL.requestFails ||
              path.dataset.routeLabel === STATE_LABEL.streamFails);
          if (placesLabelInsideLeftLane) {
            midpoint.x +=
              local.width / 2 + (path.dataset.routeLabel === STATE_LABEL.agentAsksUser ? 0 : -1);
          }
          const placesRetryAboveShelf =
            compact &&
            Math.abs(candidateSegment.y1 - candidateSegment.y2) < 0.5 &&
            path.dataset.routeLabel === STATE_LABEL.userRetries;
          if (placesRetryAboveShelf) midpoint.y -= local.height / 2 - 4;
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
  if (!placed.length) return null;
  const left = Math.min(...placed.map((bounds) => bounds.x));
  const top = Math.min(...placed.map((bounds) => bounds.y));
  const right = Math.max(...placed.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...placed.map((bounds) => bounds.y + bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
