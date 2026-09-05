/**
 * Diagram Layout Engine
 *
 * Computes node positions and edge paths based on layout configuration
 */

import type {
  DiagramModel,
  DiagramBaseView,
  DiagramNode,
  DiagramEdge,
  DiagramGroup,
} from '$shared/types/notes-primitives';
import type {
  ComputedLayout,
  ComputedNode,
  ComputedEdge,
  ComputedGroup,
  NodeStyleConfig,
} from './types';
import { GRAMMAR_CONFIGS, DEFAULT_NODE_STYLE } from './types';
import {
  semanticFilenameUnits,
  semanticLabelTokens,
  semanticLabelUnits,
} from './diagram-label-wrap';

/**
 * Compute layout for a diagram
 */
// Maximum aspect ratio for diagrams (width/height) - approximately 16:9 video ratio
const MAX_ASPECT_RATIO = 1.78;
// Maximum width before wrapping (in pixels) - reasonable for most screens
const MAX_DIAGRAM_WIDTH = 900;
// Spacing limits to prevent unusable layouts
const MIN_SPACING = 30;
const MAX_SPACING = 300;
const ORTHOGONAL_CORNER_RADIUS = 6;
const EDGE_LABEL_MAX_WIDTH = 112;
const EDGE_LABEL_MIN_WIDTH = 32;
const EDGE_LABEL_CHAR_WIDTH = 7.2;
const EDGE_LABEL_PADDING_X = 12;
const EDGE_LABEL_PADDING_Y = 10;
const EDGE_LABEL_FRAME_WIDTH = 0;
const EDGE_LABEL_LINE_HEIGHT = 18;
const NODE_ICON_WIDTH = 14;
const NODE_ICON_GAP = 8;
const MIN_NODE_HEIGHT = 32;
const AUTOMATIC_VERTICAL_THRESHOLD = 500;
const MIN_READABLE_SCALE = 0.84;
const PORT_SLOT_GAP = 16;

export function compactEdgeLabelMaxWidth(
  label: string,
  availableHeight = Number.POSITIVE_INFINITY,
) {
  if (label.length >= 48) return 100;
  const narrowLabel = measureEdgeLabel(label, 60);
  return narrowLabel.lines >= 3 && availableHeight < narrowLabel.height + 16 ? 80 : 60;
}

let measurementContext: CanvasRenderingContext2D | null | undefined;

function rootToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function rootPixelSize(name: string, fallback: number): number {
  const value = rootToken(name, `${fallback}px`);
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return fallback;
  if (value.endsWith('rem')) {
    const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return amount * rootSize;
  }
  return amount;
}

export function measureDiagramTextWidth(
  text: string,
  fontSize: number,
  weight: string,
  fallbackCharWidth: number,
  letterSpacing = 0,
  fontFamily = rootToken('--font-ui', 'Inter, system-ui, sans-serif'),
): number {
  if (measurementContext === undefined) {
    measurementContext =
      typeof document !== 'undefined' && typeof CanvasRenderingContext2D !== 'undefined'
        ? document.createElement('canvas').getContext('2d')
        : null;
  }
  if (!measurementContext) return text.length * fallbackCharWidth;

  measurementContext.font = `${weight} ${fontSize}px ${fontFamily}`;
  return measurementContext.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
}

export function measureEdgeLabel(
  label: string,
  maxWidth = EDGE_LABEL_MAX_WIDTH,
): { width: number; height: number; lines: number } {
  const fontSize = rootPixelSize('--text-caption-size', 13);
  const weight = rootToken('--text-body-weight', '400');
  const measure = (text: string) =>
    measureDiagramTextWidth(text, fontSize, weight, EDGE_LABEL_CHAR_WIDTH);
  const explicitLines = label.split('\n');
  const naturalWidth =
    Math.max(...explicitLines.map(measure)) + EDGE_LABEL_PADDING_X + EDGE_LABEL_FRAME_WIDTH;
  const minimumWordWidth =
    Math.max(...label.split(/\s+/).map(measure), EDGE_LABEL_MIN_WIDTH - EDGE_LABEL_PADDING_X) +
    EDGE_LABEL_PADDING_X +
    EDGE_LABEL_FRAME_WIDTH;
  const wrappingLimit = Math.max(maxWidth, minimumWordWidth);
  const width = Math.max(EDGE_LABEL_MIN_WIDTH, Math.min(naturalWidth, wrappingLimit));
  const contentWidth = width - EDGE_LABEL_PADDING_X - EDGE_LABEL_FRAME_WIDTH;
  const lines = explicitLines.reduce((total, line) => {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return total + 1;
    let count = 1;
    let current = '';
    for (const word of words) {
      const wordWidth = measure(word);
      if (wordWidth > contentWidth + 0.5) {
        if (current) count += 1;
        count += Math.max(1, Math.ceil((wordWidth - 0.5) / contentWidth)) - 1;
        current = '';
        continue;
      }
      const candidate = current ? `${current} ${word}` : word;
      if (current && measure(candidate) > contentWidth + 0.5) {
        count += 1;
        current = word;
      } else {
        current = candidate;
      }
    }
    return total + count;
  }, 0);
  return {
    width,
    height: Math.min(lines, 3) * EDGE_LABEL_LINE_HEIGHT + EDGE_LABEL_PADDING_Y,
    lines,
  };
}

type RoutePoint = { x: number; y: number };

function estimateEdgeLabelWidth(label: string): number {
  return measureEdgeLabel(label).width;
}

/** Build a point-preserving polyline with small, clamped quadratic corners. */
export function buildRoundedOrthogonalPath(
  points: RoutePoint[],
  radius = ORTHOGONAL_CORNER_RADIUS,
): string {
  if (points.length === 0) return '';

  const path = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incomingLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoingLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const cross =
      (corner.x - previous.x) * (next.y - corner.y) - (corner.y - previous.y) * (next.x - corner.x);
    const cornerRadius = Math.min(radius, incomingLength / 2, outgoingLength / 2);

    if (cornerRadius <= 0 || Math.abs(cross) < 0.001) {
      path.push(`L ${corner.x} ${corner.y}`);
      continue;
    }

    const before = {
      x: corner.x - ((corner.x - previous.x) / incomingLength) * cornerRadius,
      y: corner.y - ((corner.y - previous.y) / incomingLength) * cornerRadius,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / outgoingLength) * cornerRadius,
      y: corner.y + ((next.y - corner.y) / outgoingLength) * cornerRadius,
    };
    path.push(`L ${before.x} ${before.y}`, `Q ${corner.x} ${corner.y} ${after.x} ${after.y}`);
  }

  const endpoint = points[points.length - 1];
  path.push(`L ${endpoint.x} ${endpoint.y}`);
  return path.join(' ');
}

/** Clamp spacing to usable range */
function clampSpacing(spacing: number | undefined, defaultValue: number = 80): number {
  const value = spacing ?? defaultValue;
  return Math.max(MIN_SPACING, Math.min(MAX_SPACING, value));
}

export function computeLayout(
  model: DiagramModel,
  baseView: DiagramBaseView,
  grammar: string,
  styleConfig: NodeStyleConfig = DEFAULT_NODE_STYLE,
  maxDiagramWidth = MAX_DIAGRAM_WIDTH,
): ComputedLayout {
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  const validModel = {
    ...model,
    edges: model.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
  };
  const config = GRAMMAR_CONFIGS[grammar as keyof typeof GRAMMAR_CONFIGS];
  const nodeDefaults = config?.nodeDefaults || { width: 100, height: 60 };

  // First, compute node sizes based on text content
  const nodesWithSizes = validModel.nodes.map((node) => ({
    ...node,
    size: node.size || computeNodeSize(node, nodeDefaults, styleConfig),
  }));

  // Merge grammar's default layout with baseView layout
  // This ensures grammar-specific defaults (like edgeRouting) are applied
  const layout = {
    ...config?.defaultLayout,
    ...baseView.layout,
    // Also check baseView.edgeRouting for backwards compatibility
    edgeRouting:
      baseView.layout.edgeRouting || baseView.edgeRouting || config?.defaultLayout?.edgeRouting,
  };

  const authoredDirection = baseView.layout.direction;
  if (!authoredDirection && ['layered', 'tree'].includes(layout.type)) {
    const horizontalLayout = { ...layout, direction: 'LR' as const };
    const verticalLayout = { ...layout, direction: 'TB' as const };
    const horizontal = computeLayoutWithDirection(
      nodesWithSizes,
      validModel,
      horizontalLayout,
      nodeDefaults,
    );
    const vertical = computeLayoutWithDirection(
      nodesWithSizes,
      validModel,
      verticalLayout,
      nodeDefaults,
    );
    const selected = chooseAutomaticLayout(horizontal, vertical, maxDiagramWidth);
    const selectedLayout = selected === horizontal ? horizontalLayout : verticalLayout;
    return maxDiagramWidth < AUTOMATIC_VERTICAL_THRESHOLD || selected.bounds.width > maxDiagramWidth
      ? applyWrapping(
          selected,
          maxDiagramWidth,
          clampSpacing(layout.spacing, 80),
          selectedLayout,
          nodeDefaults,
          styleConfig,
        )
      : selected;
  }

  const result = computeLayoutWithDirection(nodesWithSizes, validModel, layout, nodeDefaults);
  if (authoredDirection === 'LR' || authoredDirection === 'RL') return result;
  const needsVerticalReflow =
    maxDiagramWidth < AUTOMATIC_VERTICAL_THRESHOLD ||
    (!validModel.groups?.length &&
      (result.bounds.width > maxDiagramWidth ||
        (result.bounds.height > 0 &&
          result.bounds.width / result.bounds.height > MAX_ASPECT_RATIO)));
  return needsVerticalReflow
    ? applyWrapping(
        result,
        maxDiagramWidth,
        clampSpacing(layout.spacing, 80),
        layout,
        nodeDefaults,
        styleConfig,
      )
    : result;
}

type LayoutQuality = {
  crossings: number;
  overlaps: number;
  collisions: number;
  unreadable: boolean;
  overflow: number;
};

function chooseAutomaticLayout(
  horizontal: ComputedLayout,
  vertical: ComputedLayout,
  availableWidth: number,
): ComputedLayout {
  if (availableWidth < AUTOMATIC_VERTICAL_THRESHOLD) return vertical;
  const horizontalQuality = layoutQuality(horizontal, availableWidth);
  const verticalQuality = layoutQuality(vertical, availableWidth);
  if (horizontalQuality.unreadable !== verticalQuality.unreadable) {
    return horizontalQuality.unreadable ? vertical : horizontal;
  }
  if (horizontalQuality.collisions !== verticalQuality.collisions) {
    return horizontalQuality.collisions < verticalQuality.collisions ? horizontal : vertical;
  }
  if (horizontalQuality.overlaps !== verticalQuality.overlaps) {
    return horizontalQuality.overlaps < verticalQuality.overlaps ? horizontal : vertical;
  }
  if (horizontalQuality.crossings > verticalQuality.crossings + 1) return vertical;
  if (horizontalQuality.overflow > verticalQuality.overflow + 0.1) return vertical;
  return horizontal;
}

function layoutQuality(layout: ComputedLayout, availableWidth: number): LayoutQuality {
  const segments = layout.edges.flatMap((edge) => routeSegments(edge.points ?? []));
  let crossings = 0;
  let overlaps = 0;
  let collisions = 0;
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const result = segmentIntersection(segments[left], segments[right]);
      if (result === 'crossing') crossings += 1;
      if (result === 'overlap') overlaps += 1;
    }
    collisions += layout.nodes.filter((node) => segmentCrossesNode(segments[left], node)).length;
  }
  const requiredScale = Math.min(1, availableWidth / Math.max(layout.bounds.width, 1));
  return {
    crossings,
    overlaps,
    collisions,
    unreadable: requiredScale < MIN_READABLE_SCALE,
    overflow: Math.max(0, layout.bounds.width / Math.max(availableWidth, 1) - 1),
  };
}

type RouteSegment = { start: RoutePoint; end: RoutePoint; horizontal: boolean };

function routeSegments(points: RoutePoint[]): RouteSegment[] {
  return points.slice(1).flatMap((end, index) => {
    const start = points[index];
    const horizontal = Math.abs(start.y - end.y) < 0.001;
    const vertical = Math.abs(start.x - end.x) < 0.001;
    return horizontal || vertical ? [{ start, end, horizontal }] : [];
  });
}

function segmentIntersection(
  left: RouteSegment,
  right: RouteSegment,
): 'none' | 'crossing' | 'overlap' {
  const range = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)] as const;
  if (left.horizontal === right.horizontal) {
    const leftAxis = left.horizontal ? left.start.y : left.start.x;
    const rightAxis = right.horizontal ? right.start.y : right.start.x;
    if (Math.abs(leftAxis - rightAxis) >= 0.001) return 'none';
    const [leftMin, leftMax] = left.horizontal
      ? range(left.start.x, left.end.x)
      : range(left.start.y, left.end.y);
    const [rightMin, rightMax] = right.horizontal
      ? range(right.start.x, right.end.x)
      : range(right.start.y, right.end.y);
    return Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin) > 0.5 ? 'overlap' : 'none';
  }
  const horizontal = left.horizontal ? left : right;
  const vertical = left.horizontal ? right : left;
  const [minX, maxX] = range(horizontal.start.x, horizontal.end.x);
  const [minY, maxY] = range(vertical.start.y, vertical.end.y);
  return vertical.start.x > minX + 0.5 &&
    vertical.start.x < maxX - 0.5 &&
    horizontal.start.y > minY + 0.5 &&
    horizontal.start.y < maxY - 0.5
    ? 'crossing'
    : 'none';
}

function segmentCrossesNode(segment: RouteSegment, node: ComputedNode): boolean {
  if (segment.horizontal) {
    const minX = Math.min(segment.start.x, segment.end.x);
    const maxX = Math.max(segment.start.x, segment.end.x);
    return (
      segment.start.y > node.y + 0.5 &&
      segment.start.y < node.y + node.height - 0.5 &&
      maxX > node.x + 0.5 &&
      minX < node.x + node.width - 0.5
    );
  }
  const minY = Math.min(segment.start.y, segment.end.y);
  const maxY = Math.max(segment.start.y, segment.end.y);
  return (
    segment.start.x > node.x + 0.5 &&
    segment.start.x < node.x + node.width - 0.5 &&
    maxY > node.y + 0.5 &&
    minY < node.y + node.height - 0.5
  );
}

/**
 * Apply wrapping to a layout that exceeds max width
 * Shifts nodes that exceed the width down to create wrapped rows
 */
function applyWrapping(
  layout: ComputedLayout,
  maxWidth: number,
  spacing: number,
  routeLayout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
  styleConfig: NodeStyleConfig,
): ComputedLayout {
  const needsCompactSemantics =
    layout.edges.some((edge) => Boolean(edge.label)) ||
    layout.nodes.some((node) => node.width > maxWidth);
  const isOverflowingManualLayout = routeLayout.type === 'manual' && layout.bounds.width > maxWidth;
  if ((maxWidth < 500 && needsCompactSemantics) || isOverflowingManualLayout) {
    const compactNodeWidth = Math.max(150, Math.min(260, maxWidth));
    const compactNodes = layout.nodes.map((node) => {
      const width = Math.min(node.width, compactNodeWidth);
      const measuredHeight = computeNodeSize(node, nodeDefaults, styleConfig, width).height;
      return {
        ...node,
        width,
        height: node.size ? Math.max(node.size.height, measuredHeight) : measuredHeight,
      };
    });
    const columnWidth = Math.max(...compactNodes.map((node) => node.width));
    const outgoingRows = new Map<string, number>();
    for (const edge of layout.edges) {
      if (edge.label) outgoingRows.set(edge.from, (outgoingRows.get(edge.from) ?? 0) + 1);
    }
    let y = 0;
    const narrowNodes = compactNodes.map((node) => {
      const positioned = { ...node, x: (columnWidth - node.width) / 2, y };
      const labelRows = outgoingRows.get(node.id) ?? 0;
      y += node.height + Math.max(140, labelRows * 62 + 60, spacing * 0.65);
      return positioned;
    });
    const narrowGroups = layout.groups
      ? computeGroupBoundsFromNodes(layout.groups, narrowNodes)
      : undefined;
    const narrowEdges = computeCompactColumnEdgePaths(layout.edges, narrowNodes);
    return {
      nodes: narrowNodes,
      groups: narrowGroups,
      edges: narrowEdges,
      bounds: computeBoundsFromNodes(narrowNodes, narrowGroups, narrowEdges),
    };
  }

  if (layout.bounds.width <= maxWidth) {
    return layout;
  }

  const nodes = [...layout.nodes];
  const rowHeight = Math.max(...nodes.map((n) => n.height)) + spacing;

  // Sort nodes by their x position to process left-to-right
  const sortedNodes = [...nodes].sort((a, b) => a.x - b.x);
  const nodeAdjustments = new Map<string, { dx: number; dy: number }>();

  // Track the current row's y offset and x offset for wrapping
  let rowYOffset = 0;
  let rowXOffset = 0;

  sortedNodes.forEach((node) => {
    const relativeX = node.x - layout.bounds.minX - rowXOffset;

    // Check if this node exceeds max width and needs to wrap
    if (relativeX + node.width > maxWidth && relativeX > 0) {
      // Record the x offset to subtract for this new row
      rowXOffset = node.x - layout.bounds.minX;
      // Start a new row
      rowYOffset += rowHeight + spacing;
    }

    nodeAdjustments.set(node.id, { dx: -rowXOffset, dy: rowYOffset });
  });

  // Apply adjustments
  const wrappedNodes = nodes.map((node) => {
    const adj = nodeAdjustments.get(node.id) || { dx: 0, dy: 0 };
    return {
      ...node,
      x: node.x + adj.dx,
      y: node.y + adj.dy,
    };
  });

  // Recompute groups if present
  const wrappedGroups = layout.groups
    ? computeGroupBoundsFromNodes(layout.groups, wrappedNodes)
    : undefined;

  const wrappedEdges = computeOrthogonalEdgePaths(
    layout.edges,
    wrappedNodes,
    routeLayout,
    wrappedGroups,
  );

  // Recompute bounds (including edge points for routing tracks)
  const bounds = computeBoundsFromNodes(wrappedNodes, wrappedGroups, wrappedEdges);

  return {
    nodes: wrappedNodes,
    edges: wrappedEdges,
    groups: wrappedGroups,
    bounds,
  };
}

/**
 * Helper to recompute group bounds from adjusted nodes
 */
function computeGroupBoundsFromNodes(
  groups: ComputedGroup[],
  nodes: ComputedNode[],
): ComputedGroup[] {
  return groups.map((group) => {
    // Find nodes that were in this group's bounds
    const groupNodes = nodes.filter(
      (n) =>
        n.x >= group.x - 30 &&
        n.x <= group.x + group.width + 30 &&
        n.y >= group.y - 30 &&
        n.y <= group.y + group.height + 30,
    );

    if (groupNodes.length === 0) {
      return group;
    }

    const paddingX = 30;
    const paddingTop = 52;
    const paddingBottom = 30;
    const minX = Math.min(...groupNodes.map((n) => n.x)) - paddingX;
    const minY = Math.min(...groupNodes.map((n) => n.y)) - paddingTop;
    const maxX = Math.max(...groupNodes.map((n) => n.x + n.width)) + paddingX;
    const maxY = Math.max(...groupNodes.map((n) => n.y + n.height)) + paddingBottom;

    return {
      ...group,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  });
}

/**
 * Helper to compute bounds from nodes (also includes edges for routing tracks)
 */
function computeBoundsFromNodes(
  nodes: ComputedNode[],
  groups?: ComputedGroup[],
  edges?: ComputedEdge[],
) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Math.min(...nodes.map((n) => n.x));
  let minY = Math.min(...nodes.map((n) => n.y));
  let maxX = Math.max(...nodes.map((n) => n.x + n.width));
  let maxY = Math.max(...nodes.map((n) => n.y + n.height));

  if (groups && groups.length > 0) {
    minX = Math.min(minX, ...groups.map((g) => g.x));
    minY = Math.min(minY, ...groups.map((g) => g.y));
    maxX = Math.max(maxX, ...groups.map((g) => g.x + g.width));
    maxY = Math.max(maxY, ...groups.map((g) => g.y + g.height));
  }

  // Include edge points in bounds calculation (for routing tracks)
  if (edges && edges.length > 0) {
    for (const edge of edges) {
      if (edge.points) {
        for (const point of edge.points) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
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

/**
 * Internal function to compute layout with a specific direction
 */
function computeLayoutWithDirection(
  nodesWithSizes: (DiagramNode & { size: { width: number; height: number } })[],
  model: DiagramModel,
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
): ComputedLayout {
  // Compute node positions
  const computedNodes = computeNodePositions(
    nodesWithSizes,
    model.edges,
    layout,
    nodeDefaults,
    model.groups,
  );
  if ((layout.type === 'layered' || layout.type === 'tree') && layout.direction === 'RL') {
    const minX = Math.min(...computedNodes.map(({ x }) => x));
    const maxX = Math.max(...computedNodes.map(({ x, width }) => x + width));
    for (const node of computedNodes) node.x = minX + maxX - node.x - node.width;
  }
  if ((layout.type === 'layered' || layout.type === 'tree') && layout.direction === 'BT') {
    const minY = Math.min(...computedNodes.map(({ y }) => y));
    const maxY = Math.max(...computedNodes.map(({ y, height }) => y + height));
    for (const node of computedNodes) node.y = minY + maxY - node.y - node.height;
  }

  // Compute edge paths
  const computedEdges = computeEdgePaths(model.edges, computedNodes, layout, model.groups);

  // Deduplicate edge IDs to prevent Svelte {#each} key collisions
  const edgeIdCounts = new Map<string, number>();
  for (const edge of computedEdges) {
    const originalId = edge.id;
    const count = edgeIdCounts.get(originalId) ?? 0;
    if (count > 0) {
      edge.id = `${originalId}-${count}`;
    }
    edgeIdCounts.set(originalId, count + 1);
  }

  // Compute group bounds
  const computedGroups = model.groups ? computeGroupBounds(model.groups, computedNodes) : undefined;

  // Compute overall bounds (including groups and edge routing tracks)
  const bounds = computeBounds(computedNodes, computedGroups, computedEdges);

  return {
    nodes: computedNodes,
    edges: computedEdges,
    groups: computedGroups,
    bounds,
  };
}

/**
 * Compute node size based on text content
 * Uses the style config for font metrics to ensure consistency with CSS
 */
function computeNodeSize(
  node: DiagramNode,
  defaults: { width: number; height: number },
  style: NodeStyleConfig,
  availableWidth = style.maxWidth,
): { width: number; height: number } {
  const usesDefaultStyle = style === DEFAULT_NODE_STYLE;
  const isStoreNode = ['db', 'store', 'data_store'].includes(node.kind ?? '');
  const paddingX = (usesDefaultStyle ? 10 : style.paddingX) + (isStoreNode ? 8 : 0);
  const paddingY = usesDefaultStyle ? 7 : style.paddingY;
  const contentGap = usesDefaultStyle ? 2 : style.gap;
  const kindFontSize = usesDefaultStyle ? 11 : style.kindFontSize;
  const iconColumnWidth = NODE_ICON_WIDTH + NODE_ICON_GAP;
  const frameBorderWidth = 0;
  const maxWidth = Math.min(style.maxWidth, availableWidth);
  const labelWrapSafety = /[^\x00-\x7f]/.test(node.label) ? 10 : 8;
  // Keep a small wrap safety margin for the application UI font stack.
  const defaultCharWidthRatio = 0.6;

  // Use the same metrics as DiagramNodeHTML for all measurements.
  const LABEL_CHAR_WIDTH =
    style.labelFontSize * (usesDefaultStyle ? defaultCharWidthRatio : style.labelCharWidthRatio);
  const KIND_CHAR_WIDTH =
    kindFontSize * (usesDefaultStyle ? defaultCharWidthRatio : style.kindCharWidthRatio);

  // Measure label - account for hard line breaks and word wrapping
  const hardLines = node.label.split(/\r\n?|\n/);
  const words = semanticLabelTokens(node.label);
  const isShortLabel = words.length <= 2 && node.label.length <= 20;
  const labelWeight = '600';
  // i18n-ignore (CSS font-family fallback, not user-facing text)
  const labelFontFamily = rootToken('--font-editorial', 'Georgia, Times New Roman, serif');
  const measureLabel = (text: string) =>
    measureDiagramTextWidth(
      text,
      style.labelFontSize,
      labelWeight,
      LABEL_CHAR_WIDTH,
      -0.01 * style.labelFontSize,
      labelFontFamily,
    );
  const measureKind = (text: string) =>
    measureDiagramTextWidth(text, kindFontSize, '500', KIND_CHAR_WIDTH, 0.015 * kindFontSize);
  const estimatedLineWidths = hardLines.map(measureLabel);
  const longestLineWidth = Math.max(...estimatedLineWidths);
  const longestWordWidth = Math.max(...semanticLabelUnits(node.label).map(measureLabel), 0);

  let labelWidth: number;
  let labelLines = 1;

  if (isShortLabel) {
    labelWidth = longestLineWidth;
    labelLines = hardLines.length;
  } else {
    // For longer labels, estimate wrapping at a reasonable width
    // Allow wider nodes for long labels, but cap at maxWidth
    const maxLineWidth = Math.min(
      longestLineWidth,
      maxWidth - paddingX * 2 - iconColumnWidth - frameBorderWidth - labelWrapSafety,
    );
    const wrappedLineWidth = Math.max(maxLineWidth, longestWordWidth);
    labelWidth = wrappedLineWidth;
    const visibleLineCount = hardLines.reduce((total, line) => {
      const filenameUnits = semanticFilenameUnits(line);
      const lineWords = filenameUnits ?? semanticLabelTokens(line);
      if (!lineWords.length) return total + 1;
      let count = 1;
      let current = '';
      for (const word of lineWords) {
        const wordWidth = measureLabel(word);
        if (wordWidth > wrappedLineWidth + 0.5) {
          if (current) count += 1;
          count += Math.max(1, Math.ceil((wordWidth - 0.5) / wrappedLineWidth)) - 1;
          current = '';
          continue;
        }
        const candidate = current ? `${current}${filenameUnits ? '' : ' '}${word}` : word;
        if (current && measureLabel(candidate) > wrappedLineWidth + 0.5) {
          count += 1;
          current = word;
        } else {
          current = candidate;
        }
      }
      return total + count;
    }, 0);
    labelLines = visibleLineCount;
  }

  const labelHeight = style.labelFontSize * style.labelLineHeight * labelLines;

  // Measure kind (if present)
  let kindWidth = 0;
  let kindHeight = 0;
  if (node.kind) {
    const kindLines = node.kind.split('\n');
    kindWidth = Math.max(...kindLines.map(measureKind));
    kindHeight = kindFontSize * style.kindLineHeight * kindLines.length;
  }

  // Calculate total size
  const contentWidth = Math.max(labelWidth + labelWrapSafety, kindWidth) + iconColumnWidth;
  const contentHeight = labelHeight + (node.kind ? contentGap + kindHeight : 0);

  // Ensure minimum size but allow nodes to be smaller for short labels
  const minWidth = Math.max(isShortLabel ? 72 : defaults.width * 0.6, isStoreNode ? 112 : 0);
  const chromeWidth = iconColumnWidth + paddingX * 2 + frameBorderWidth;
  const width = Math.max(
    Math.min(Math.max(contentWidth + paddingX * 2 + frameBorderWidth, minWidth), maxWidth),
    longestWordWidth + chromeWidth + labelWrapSafety,
  );
  const height = Math.max(
    contentHeight + paddingY * 2 + frameBorderWidth,
    MIN_NODE_HEIGHT,
    isStoreNode ? 90 : 0,
  );

  return { width, height };
}

/**
 * Compute node positions based on layout type
 */
function computeNodePositions(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
  groups?: DiagramGroup[],
): ComputedNode[] {
  // If nodes have manual positions, use them
  const hasManualPositions = nodes.some((n) => n.position);

  if (hasManualPositions || layout.type === 'manual') {
    // Collect manually positioned nodes first
    const manualNodes: Array<{ x: number; y: number; width: number; height: number }> = [];
    const result: ComputedNode[] = [];

    // First pass: place manually positioned nodes and collect their bounds
    for (const node of nodes) {
      const width = node.size?.width ?? nodeDefaults.width;
      const height = node.size?.height ?? nodeDefaults.height;
      if (node.position) {
        const placed = { ...node, x: node.position.x, y: node.position.y, width, height };
        result.push(placed);
        manualNodes.push(placed);
      } else {
        // Placeholder - will be repositioned below
        result.push({ ...node, x: 0, y: 0, width, height });
      }
    }

    // Second pass: position unpositioned nodes avoiding manual ones
    const spacing = clampSpacing(layout.spacing, 80);
    for (let i = 0; i < result.length; i++) {
      const node = nodes[i];
      if (node.position) continue; // Already placed

      const width = result[i].width;
      const height = result[i].height;

      // Find a position that doesn't overlap with any existing node
      let bestX = 0;
      let bestY = 0;
      let placed = false;

      // Try positions in a grid pattern, checking for overlaps
      for (let row = 0; row < 20 && !placed; row++) {
        for (let col = 0; col < 20 && !placed; col++) {
          const candidateX = col * (width + spacing);
          const candidateY = row * (height + spacing);

          const overlaps = manualNodes.some((mn) => {
            return !(
              candidateX + width + spacing * 0.3 < mn.x ||
              candidateX > mn.x + mn.width + spacing * 0.3 ||
              candidateY + height + spacing * 0.3 < mn.y ||
              candidateY > mn.y + mn.height + spacing * 0.3
            );
          });

          if (!overlaps) {
            bestX = candidateX;
            bestY = candidateY;
            placed = true;
          }
        }
      }

      result[i] = { ...result[i], x: bestX, y: bestY };
      manualNodes.push({ x: bestX, y: bestY, width, height });
    }

    const positionedColumns = new Map<number, ComputedNode[]>();
    for (const node of result) {
      const authored = nodes.find(({ id }) => id === node.id)?.position;
      if (!authored) continue;
      const columnKey = [...positionedColumns.keys()].find((x) => Math.abs(x - authored.x) <= 8);
      const column = positionedColumns.get(columnKey ?? authored.x) ?? [];
      column.push(node);
      positionedColumns.set(columnKey ?? authored.x, column);
    }
    const minimumX = Math.min(...result.map((node) => node.x));
    const compressedColumnNodes = new Set<string>();
    for (const [authoredX, column] of positionedColumns) {
      if (column.length < 2) continue;
      const width = Math.max(...column.map((node) => node.width));
      const center = minimumX + (authoredX + width / 2 - minimumX) * 0.89;
      for (const node of column) {
        node.x = center - node.width / 2;
        compressedColumnNodes.add(node.id);
      }
    }
    for (const node of result) {
      if (!compressedColumnNodes.has(node.id)) {
        node.x = minimumX + (node.x - minimumX) * 0.89;
      }
    }
    return result;
  }

  // Otherwise, compute positions based on layout type
  switch (layout.type) {
    case 'layered':
      return computeLayeredLayout(nodes, edges, layout, nodeDefaults, groups);
    case 'force':
      return computeForceLayout(nodes, edges, layout, nodeDefaults, groups);
    case 'circular':
      return computeCircularLayout(nodes, layout, nodeDefaults);
    case 'tree':
      return computeTreeLayout(nodes, edges, layout, nodeDefaults);
    default:
      return computeLayeredLayout(nodes, edges, layout, nodeDefaults, groups);
  }
}

/**
 * Compute layered layout (Sugiyama-style)
 * Implements a proper hierarchical layout with:
 * - Topological layer assignment based on edge dependencies
 * - Group-aware positioning with clear separation
 * - Barycenter-based crossing minimization
 */
function computeLayeredLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
  groups?: DiagramGroup[],
): ComputedNode[] {
  const spacing = clampSpacing(layout.spacing, 80);
  const direction = layout.direction ?? 'LR';
  const isHorizontal = direction === 'LR' || direction === 'RL';

  // Build group membership map
  const nodeToGroup = new Map<string, string>();
  if (groups) {
    groups.forEach((group) => {
      if (Array.isArray(group.nodeIds)) {
        group.nodeIds.forEach((nodeId) => nodeToGroup.set(nodeId, group.id));
      }
    });
    nodes.forEach((node) => {
      if (node.group) nodeToGroup.set(node.id, node.group);
    });
  }

  // Build adjacency lists
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  nodes.forEach((node) => {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  });
  edges.forEach((edge) => {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  });

  // Compute node sizes
  const nodeSizes = new Map<string, { width: number; height: number }>();
  nodes.forEach((node) => {
    nodeSizes.set(node.id, {
      width: node.size?.width ?? nodeDefaults.width,
      height: node.size?.height ?? nodeDefaults.height,
    });
  });

  // If we have groups, use hierarchical group-based layout
  if (groups && groups.length > 0) {
    return computeHierarchicalGroupLayout(
      nodes,
      edges,
      groups,
      nodeSizes,
      nodeToGroup,
      outgoing,
      incoming,
      spacing,
      isHorizontal,
    );
  }

  // No groups - use standard hierarchical layout
  return computeStandardHierarchicalLayout(nodes, edges, nodeSizes, spacing, isHorizontal);
}

/**
 * Compute hierarchical layout for diagrams with groups
 * Places groups in a grid based on dependency flow, then positions nodes within groups
 */
function computeHierarchicalGroupLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  groups: DiagramGroup[],
  nodeSizes: Map<string, { width: number; height: number }>,
  nodeToGroup: Map<string, string>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
  spacing: number,
  isHorizontal: boolean,
): ComputedNode[] {
  const UNGROUPED = '__ungrouped__';
  const GROUP_PADDING = 32; // Padding around group contents and title
  const GROUP_SPACING = Math.max(48, spacing * 0.75); // Space between groups
  const NODE_SPACING = Math.max(20, spacing * 0.32); // Space between nodes in same group

  // Step 1: Assign nodes to groups
  const groupNodes = new Map<string, string[]>();
  groups.forEach((g) => groupNodes.set(g.id, []));
  groupNodes.set(UNGROUPED, []);

  nodes.forEach((node) => {
    const gid = nodeToGroup.get(node.id) || UNGROUPED;
    let nodeIds = groupNodes.get(gid);
    if (!nodeIds) {
      nodeIds = [];
      groupNodes.set(gid, nodeIds);
    }
    nodeIds.push(node.id);
  });

  // Step 2: Build group dependency graph
  const groupOutgoing = new Map<string, Set<string>>();
  const groupIncoming = new Map<string, Set<string>>();
  const allGroupIds = [...groups.map((g) => g.id), UNGROUPED];
  allGroupIds.forEach((gid) => {
    groupOutgoing.set(gid, new Set());
    groupIncoming.set(gid, new Set());
  });

  edges.forEach((edge) => {
    const fromGroup = nodeToGroup.get(edge.from) || UNGROUPED;
    const toGroup = nodeToGroup.get(edge.to) || UNGROUPED;
    if (fromGroup !== toGroup) {
      groupOutgoing.get(fromGroup)?.add(toGroup);
      groupIncoming.get(toGroup)?.add(fromGroup);
    }
  });

  // Step 3: Assign groups to layers using longest path algorithm
  const groupLayer = new Map<string, number>();
  const visited = new Set<string>();

  function assignGroupLayer(gid: string): number {
    const existingLayer = groupLayer.get(gid);
    if (existingLayer !== undefined) return existingLayer;
    if (visited.has(gid)) return 0; // Cycle detected
    visited.add(gid);

    const groupIndex = allGroupIds.indexOf(gid);
    const deps = [...(groupIncoming.get(gid) || new Set())].filter((dependencyId) => {
      const isReciprocal = groupOutgoing.get(gid)?.has(dependencyId) ?? false;
      return !isReciprocal || allGroupIds.indexOf(dependencyId) < groupIndex;
    });
    let maxDepLayer = -1;
    deps.forEach((depGid) => {
      maxDepLayer = Math.max(maxDepLayer, assignGroupLayer(depGid));
    });

    const layer = maxDepLayer + 1;
    groupLayer.set(gid, layer);
    return layer;
  }

  allGroupIds.forEach((gid) => {
    if ((groupNodes.get(gid)?.length ?? 0) > 0) {
      assignGroupLayer(gid);
    }
  });

  // Step 4: Organize groups into layers
  const maxGroupLayer = Math.max(...Array.from(groupLayer.values()), 0);
  const groupLayers: string[][] = Array.from({ length: maxGroupLayer + 1 }, () => []);

  groupLayer.forEach((layer, gid) => {
    if ((groupNodes.get(gid)?.length ?? 0) > 0) {
      groupLayers[layer].push(gid);
    }
  });

  // Step 5: Compute intra-group layered layout for each group
  // For each group, build a sub-graph and run mini Sugiyama-style layout
  const groupInternalLayouts = new Map<
    string,
    { layers: string[][]; nodeLayer: Map<string, number>; layerSpacing: number[] }
  >();
  const groupDimensions = new Map<string, { width: number; height: number }>();

  // Build intra-group edge maps
  const intraGroupOutgoing = new Map<string, string[]>();
  const intraGroupIncoming = new Map<string, string[]>();
  nodes.forEach((node) => {
    intraGroupOutgoing.set(node.id, []);
    intraGroupIncoming.set(node.id, []);
  });
  edges.forEach((edge) => {
    const fromGroup = nodeToGroup.get(edge.from) || UNGROUPED;
    const toGroup = nodeToGroup.get(edge.to) || UNGROUPED;
    if (fromGroup === toGroup) {
      intraGroupOutgoing.get(edge.from)?.push(edge.to);
      intraGroupIncoming.get(edge.to)?.push(edge.from);
    }
  });

  allGroupIds.forEach((gid) => {
    const nodeIds = groupNodes.get(gid) || [];
    if (nodeIds.length === 0) {
      groupDimensions.set(gid, { width: 0, height: 0 });
      groupInternalLayouts.set(gid, { layers: [], nodeLayer: new Map(), layerSpacing: [] });
      return;
    }

    const nodeIdSet = new Set(nodeIds);

    // Assign layers within the group using longest path
    const nodeLayer = new Map<string, number>();
    const layerVisited = new Set<string>();

    function assignIntraLayer(nodeId: string): number {
      const existingLayer = nodeLayer.get(nodeId);
      if (existingLayer !== undefined) return existingLayer;
      if (layerVisited.has(nodeId)) return 0;
      layerVisited.add(nodeId);

      const deps = (intraGroupIncoming.get(nodeId) || []).filter((id) => nodeIdSet.has(id));
      let maxDepLayer = -1;
      deps.forEach((depId) => {
        maxDepLayer = Math.max(maxDepLayer, assignIntraLayer(depId));
      });

      const layer = maxDepLayer + 1;
      nodeLayer.set(nodeId, layer);
      return layer;
    }

    nodeIds.forEach((nid) => assignIntraLayer(nid));

    // Organize into layers
    const maxLayer = Math.max(...Array.from(nodeLayer.values()), 0);
    const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
    nodeLayer.forEach((layer, nodeId) => {
      if (nodeIdSet.has(nodeId)) layers[layer].push(nodeId);
    });

    // Barycenter crossing minimization within the group (4 passes)
    for (let pass = 0; pass < 4; pass++) {
      // Down sweep
      for (let i = 1; i < layers.length; i++) {
        const layer = layers[i];
        const prevLayer = layers[i - 1];
        const barycenters = new Map<string, number>();
        layer.forEach((nodeId) => {
          const inNodes = (intraGroupIncoming.get(nodeId) || []).filter((id) => nodeIdSet.has(id));
          const positions = inNodes.map((id) => prevLayer.indexOf(id)).filter((pos) => pos !== -1);
          if (positions.length > 0) {
            barycenters.set(nodeId, positions.reduce((a, b) => a + b, 0) / positions.length);
          } else {
            barycenters.set(nodeId, layer.indexOf(nodeId));
          }
        });
        layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
      }
      // Up sweep
      for (let i = layers.length - 2; i >= 0; i--) {
        const layer = layers[i];
        const nextLayer = layers[i + 1];
        const barycenters = new Map<string, number>();
        layer.forEach((nodeId) => {
          const outNodes = (intraGroupOutgoing.get(nodeId) || []).filter((id) => nodeIdSet.has(id));
          const positions = outNodes.map((id) => nextLayer.indexOf(id)).filter((pos) => pos !== -1);
          if (positions.length > 0) {
            barycenters.set(nodeId, positions.reduce((a, b) => a + b, 0) / positions.length);
          } else {
            barycenters.set(nodeId, layer.indexOf(nodeId));
          }
        });
        layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
      }
    }

    const layerSpacing = layers.slice(0, -1).map((_, layerIndex) => {
      const labelClearance = edges.reduce((clearance, edge) => {
        if (
          !edge.label ||
          nodeToGroup.get(edge.from) !== gid ||
          nodeToGroup.get(edge.to) !== gid ||
          nodeLayer.get(edge.from) !== layerIndex ||
          nodeLayer.get(edge.to) !== layerIndex + 1
        ) {
          return clearance;
        }
        const label = measureEdgeLabel(edge.label);
        return Math.max(clearance, (isHorizontal ? label.width : label.height) + 24);
      }, 0);
      return Math.max(spacing * 0.5, labelClearance);
    });

    groupInternalLayouts.set(gid, { layers, nodeLayer, layerSpacing });

    // Calculate group dimensions based on multi-layer layout
    let totalPrimary = 0;
    let maxSecondary = 0;

    layers.forEach((layer, layerIdx) => {
      let layerPrimary = 0;
      let layerSecondary = 0;

      layer.forEach((nodeId) => {
        const size = nodeSizes.get(nodeId);
        if (!size) return;
        if (isHorizontal) {
          layerSecondary += size.height + NODE_SPACING;
          layerPrimary = Math.max(layerPrimary, size.width);
        } else {
          layerSecondary += size.width + NODE_SPACING;
          layerPrimary = Math.max(layerPrimary, size.height);
        }
      });

      layerSecondary -= NODE_SPACING; // Remove last spacing
      maxSecondary = Math.max(maxSecondary, layerSecondary);
      totalPrimary += layerPrimary;
      if (layerIdx > 0) totalPrimary += layerSpacing[layerIdx - 1] ?? spacing * 0.5;
    });

    const width = isHorizontal
      ? totalPrimary + GROUP_PADDING * 2
      : maxSecondary + GROUP_PADDING * 2;
    const height = isHorizontal
      ? maxSecondary + GROUP_PADDING * 2
      : totalPrimary + GROUP_PADDING * 2;

    groupDimensions.set(gid, { width, height });
  });

  // Step 6: Inter-group barycenter ordering within each layer
  // Order groups in the same layer to minimize cross-group edge crossings
  for (let pass = 0; pass < 4; pass++) {
    // Down sweep
    for (let i = 1; i < groupLayers.length; i++) {
      const layer = groupLayers[i];
      const prevLayer = groupLayers[i - 1];
      const barycenters = new Map<string, number>();
      layer.forEach((gid) => {
        const inGroups = Array.from(groupIncoming.get(gid) || []);
        const positions = inGroups.map((id) => prevLayer.indexOf(id)).filter((pos) => pos !== -1);
        if (positions.length > 0) {
          barycenters.set(gid, positions.reduce((a, b) => a + b, 0) / positions.length);
        } else {
          barycenters.set(gid, layer.indexOf(gid));
        }
      });
      layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
    }
    // Up sweep
    for (let i = groupLayers.length - 2; i >= 0; i--) {
      const layer = groupLayers[i];
      const nextLayer = groupLayers[i + 1];
      const barycenters = new Map<string, number>();
      layer.forEach((gid) => {
        const outGroups = Array.from(groupOutgoing.get(gid) || []);
        const positions = outGroups.map((id) => nextLayer.indexOf(id)).filter((pos) => pos !== -1);
        if (positions.length > 0) {
          barycenters.set(gid, positions.reduce((a, b) => a + b, 0) / positions.length);
        } else {
          barycenters.set(gid, layer.indexOf(gid));
        }
      });
      layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
    }
  }

  // Step 7: Position groups
  const groupPositions = new Map<string, { x: number; y: number }>();
  let primaryOffset = 0;

  groupLayers.forEach((layerGroups) => {
    let secondaryOffset = 0;
    let maxPrimarySize = 0;

    layerGroups.forEach((gid) => {
      const dim = groupDimensions.get(gid);
      if (!dim) return;

      if (isHorizontal) {
        groupPositions.set(gid, { x: primaryOffset, y: secondaryOffset });
        secondaryOffset += dim.height + GROUP_SPACING;
        maxPrimarySize = Math.max(maxPrimarySize, dim.width);
      } else {
        groupPositions.set(gid, { x: secondaryOffset, y: primaryOffset });
        secondaryOffset += dim.width + GROUP_SPACING;
        maxPrimarySize = Math.max(maxPrimarySize, dim.height);
      }
    });

    primaryOffset += maxPrimarySize + GROUP_SPACING;
  });

  // Step 8: Position nodes within groups using intra-group layers
  const positioned: ComputedNode[] = [];
  allGroupIds.forEach((gid) => {
    const nodeIds = groupNodes.get(gid) || [];
    const groupPos = groupPositions.get(gid);
    const internalLayout = groupInternalLayouts.get(gid);
    if (!groupPos || nodeIds.length === 0 || !internalLayout) return;

    const { layers, layerSpacing } = internalLayout;
    let layerPrimaryOffset = GROUP_PADDING;

    layers.forEach((layer, layerIndex) => {
      // Calculate total secondary size for centering within the group
      let totalSecondary = 0;
      layer.forEach((nodeId) => {
        const size = nodeSizes.get(nodeId);
        if (!size) return;
        totalSecondary += (isHorizontal ? size.height : size.width) + NODE_SPACING;
      });
      totalSecondary -= NODE_SPACING;

      // Center nodes in the secondary direction within the group
      const groupDim = groupDimensions.get(gid);
      if (!groupDim) return;
      const groupSecondarySize = isHorizontal ? groupDim.height : groupDim.width;
      let nodeSecondaryOffset =
        GROUP_PADDING + (groupSecondarySize - GROUP_PADDING * 2 - totalSecondary) / 2;

      let maxLayerPrimary = 0;

      layer.forEach((nodeId) => {
        const node = nodes.find((n) => n.id === nodeId);
        const size = nodeSizes.get(nodeId);
        if (!node || !size) return;

        let x, y;
        if (isHorizontal) {
          x = groupPos.x + layerPrimaryOffset;
          y = groupPos.y + nodeSecondaryOffset;
          nodeSecondaryOffset += size.height + NODE_SPACING;
          maxLayerPrimary = Math.max(maxLayerPrimary, size.width);
        } else {
          x = groupPos.x + nodeSecondaryOffset;
          y = groupPos.y + layerPrimaryOffset;
          nodeSecondaryOffset += size.width + NODE_SPACING;
          maxLayerPrimary = Math.max(maxLayerPrimary, size.height);
        }

        positioned.push({ ...node, x, y, width: size.width, height: size.height });
      });

      layerPrimaryOffset += maxLayerPrimary + (layerSpacing[layerIndex] ?? spacing * 0.5);
    });
  });

  return positioned;
}

/**
 * Compute standard hierarchical layout without groups
 */
function computeStandardHierarchicalLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  nodeSizes: Map<string, { width: number; height: number }>,
  spacing: number,
  isHorizontal: boolean,
): ComputedNode[] {
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const feedbackEdgeIds = new Set<string>();
  const adjacency = new Map<string, DiagramEdge[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge);
    adjacency.set(edge.from, list);
  }
  const reaches = (start: string, target: string, excludedId: string): boolean => {
    const pending = [start];
    const seen = new Set<string>();
    while (pending.length) {
      const nodeId = pending.pop();
      if (!nodeId) continue;
      if (nodeId === target) return true;
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      for (const edge of adjacency.get(nodeId) ?? []) {
        if (edge.id !== excludedId) pending.push(edge.to);
      }
    }
    return false;
  };
  for (const edge of edges) {
    const fromIndex = nodeOrder.get(edge.from) ?? 0;
    const toIndex = nodeOrder.get(edge.to) ?? 0;
    if (fromIndex > toIndex && reaches(edge.to, edge.from, edge.id)) {
      feedbackEdgeIds.add(edge.id);
    }
  }
  const rankIncoming = new Map<string, string[]>();
  const rankOutgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (feedbackEdgeIds.has(edge.id)) continue;
    rankIncoming.set(edge.to, [...(rankIncoming.get(edge.to) ?? []), edge.from]);
    rankOutgoing.set(edge.from, [...(rankOutgoing.get(edge.from) ?? []), edge.to]);
  }

  // Assign nodes to layers using longest path algorithm
  const nodeLayer = new Map<string, number>();
  const visited = new Set<string>();

  function assignLayer(nodeId: string): number {
    const existingLayer = nodeLayer.get(nodeId);
    if (existingLayer !== undefined) return existingLayer;
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);

    const deps = rankIncoming.get(nodeId) || [];
    let maxDepLayer = -1;
    deps.forEach((depId) => {
      maxDepLayer = Math.max(maxDepLayer, assignLayer(depId));
    });

    const layer = maxDepLayer + 1;
    nodeLayer.set(nodeId, layer);
    return layer;
  }

  nodes.forEach((node) => assignLayer(node.id));

  // Organize nodes into layers
  const maxLayer = Math.max(...Array.from(nodeLayer.values()), 0);
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);

  nodeLayer.forEach((layer, nodeId) => {
    layers[layer].push(nodeId);
  });

  // Minimize crossings using barycenter heuristic
  for (let pass = 0; pass < 4; pass++) {
    // Down sweep
    for (let i = 1; i < layers.length; i++) {
      const layer = layers[i];
      const prevLayer = layers[i - 1];

      const barycenters = new Map<string, number>();
      layer.forEach((nodeId) => {
        const inNodes = rankIncoming.get(nodeId) || [];
        const positions = inNodes.map((id) => prevLayer.indexOf(id)).filter((pos) => pos !== -1);

        if (positions.length > 0) {
          barycenters.set(nodeId, positions.reduce((a, b) => a + b, 0) / positions.length);
        } else {
          barycenters.set(nodeId, layer.indexOf(nodeId));
        }
      });

      layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
    }

    // Up sweep
    for (let i = layers.length - 2; i >= 0; i--) {
      const layer = layers[i];
      const nextLayer = layers[i + 1];

      const barycenters = new Map<string, number>();
      layer.forEach((nodeId) => {
        const outNodes = rankOutgoing.get(nodeId) || [];
        const positions = outNodes.map((id) => nextLayer.indexOf(id)).filter((pos) => pos !== -1);

        if (positions.length > 0) {
          barycenters.set(nodeId, positions.reduce((a, b) => a + b, 0) / positions.length);
        } else {
          barycenters.set(nodeId, layer.indexOf(nodeId));
        }
      });

      layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
    }
  }

  // Position nodes
  const positioned: ComputedNode[] = [];
  const NODE_SPACING = spacing * 0.4;

  const layerSpacing = layers.slice(0, -1).map((_, layerIndex) => {
    const labelClearance = edges.reduce((clearance, edge) => {
      const fromLayer = nodeLayer.get(edge.from);
      const toLayer = nodeLayer.get(edge.to);
      if (
        !edge.label ||
        feedbackEdgeIds.has(edge.id) ||
        fromLayer !== layerIndex ||
        toLayer !== layerIndex + 1
      ) {
        return clearance;
      }
      const label = measureEdgeLabel(edge.label);
      return Math.max(clearance, (isHorizontal ? label.width : label.height) + 36);
    }, 0);
    return Math.max(spacing * 0.65, labelClearance);
  });

  let primaryOffset = 0;

  layers.forEach((layer, layerIndex) => {
    let maxPrimarySize = 0;
    let secondaryOffset = 0;

    // Center the layer
    const totalSecondary = layer.reduce((sum, nodeId) => {
      const size = nodeSizes.get(nodeId);
      if (!size) return sum;
      return sum + (isHorizontal ? size.height : size.width) + NODE_SPACING;
    }, -NODE_SPACING);

    secondaryOffset = -totalSecondary / 2;

    layer.forEach((nodeId) => {
      const node = nodes.find((n) => n.id === nodeId);
      const size = nodeSizes.get(nodeId);
      if (!node || !size) return;

      let x, y;
      if (isHorizontal) {
        x = primaryOffset;
        y = secondaryOffset;
        secondaryOffset += size.height + NODE_SPACING;
        maxPrimarySize = Math.max(maxPrimarySize, size.width);
      } else {
        x = secondaryOffset;
        y = primaryOffset;
        secondaryOffset += size.width + NODE_SPACING;
        maxPrimarySize = Math.max(maxPrimarySize, size.height);
      }

      positioned.push({ ...node, x, y, width: size.width, height: size.height });
    });

    primaryOffset += maxPrimarySize + (layerSpacing[layerIndex] ?? spacing * 0.8);
  });

  return positioned;
}

/**
 * Compute force-directed layout
 * Spring-based layout with repulsion, attraction, and edge-crossing avoidance
 */
function computeForceLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
  groups?: DiagramGroup[],
): ComputedNode[] {
  const spacing = clampSpacing(layout.spacing, 100);
  const direction = layout.direction ?? 'LR';
  const isHorizontal = direction === 'LR' || direction === 'RL';
  const iterations = 150; // More iterations for better convergence
  const repulsionStrength = spacing * spacing * 8; // Moderate repulsion to prevent overlap
  const attractionStrength = 0.04; // Stronger attraction for direct edges
  const edgeCrossingPenalty = 1.5; // Lower penalty for edge crossings
  const damping = 0.7; // Lower damping for more movement

  // Build group membership map
  // Handle both cases: groups with nodeIds arrays AND nodes with group property
  const nodeToGroup = new Map<string, string>();
  if (groups) {
    // First, check groups for nodeIds
    groups.forEach((group) => {
      if (Array.isArray(group.nodeIds)) {
        group.nodeIds.forEach((nodeId) => {
          nodeToGroup.set(nodeId, group.id);
        });
      }
    });
    // Then, check nodes for group property (takes precedence if both exist)
    nodes.forEach((node) => {
      if (node.group) {
        nodeToGroup.set(node.id, node.group);
      }
    });
  }

  // Build adjacency for better initial positioning
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  nodes.forEach((node) => {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  });
  edges.forEach((edge) => {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  });

  // Initialize positions using a simple hierarchical layout for better starting point
  const nodeDepth = new Map<string, number>();
  const visited = new Set<string>();

  // Find root nodes (no incoming edges)
  const roots = nodes.filter((n) => (incoming.get(n.id)?.length ?? 0) === 0);
  const startNodes = roots.length > 0 ? roots : [nodes[0]];

  // BFS to assign depths
  const queue: Array<{ id: string; depth: number }> = startNodes.map((n) => ({
    id: n.id,
    depth: 0,
  }));
  let maxDepth = 0;

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const { id, depth } = item;
    if (visited.has(id)) continue;
    visited.add(id);

    nodeDepth.set(id, depth);
    maxDepth = Math.max(maxDepth, depth);

    const children = outgoing.get(id) ?? [];
    children.forEach((childId) => {
      if (!visited.has(childId)) {
        queue.push({ id: childId, depth: depth + 1 });
      }
    });
  }

  // Assign depths to unvisited nodes
  nodes.forEach((node) => {
    if (!nodeDepth.has(node.id)) {
      nodeDepth.set(node.id, 0);
    }
  });

  // Count nodes at each depth for positioning
  const nodesAtDepth = new Map<number, number>();
  nodeDepth.forEach((depth) => {
    nodesAtDepth.set(depth, (nodesAtDepth.get(depth) ?? 0) + 1);
  });

  const depthCounters = new Map<number, number>();

  // Pre-position groups if they exist (compact hierarchical layout)
  const groupCenters = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  if (groups && groups.length > 0) {
    // Arrange groups in a grid layout with minimal spacing
    const numGroups = groups.length;

    // For horizontal layouts, prefer more columns (horizontal arrangement)
    // For vertical layouts, prefer more rows (vertical arrangement)
    let cols: number, rows: number;
    if (isHorizontal) {
      cols = numGroups; // All groups in a row for horizontal layout
      rows = 1;
    } else {
      cols = 1; // All groups in a column for vertical layout
      rows = numGroups;
    }

    const groupSpacing = spacing * 0.8; // Very compact spacing between group centers

    groups.forEach((group, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);

      const centerX = (col - (cols - 1) / 2) * groupSpacing;
      const centerY = (row - (rows - 1) / 2) * groupSpacing;

      groupCenters.set(group.id, {
        x: isHorizontal ? centerX : centerY,
        y: isHorizontal ? centerY : centerX,
        vx: 0,
        vy: 0,
      });
    });
  }

  // Initialize positions based on depth and group membership
  const positions = nodes.map((node) => {
    const depth = nodeDepth.get(node.id) ?? 0;
    const countAtDepth = nodesAtDepth.get(depth) ?? 1;
    const indexAtDepth = depthCounters.get(depth) ?? 0;
    depthCounters.set(depth, indexAtDepth + 1);

    // Position based on depth and index within depth
    // Use compact spacing
    const primaryMultiplier = isHorizontal ? 2 : 1.5;
    const secondaryMultiplier = isHorizontal ? 1 : 1.2;

    const primaryPos = (depth / Math.max(maxDepth, 1)) * spacing * primaryMultiplier;
    let secondaryPos =
      ((indexAtDepth - countAtDepth / 2) / Math.max(countAtDepth, 1)) *
      spacing *
      secondaryMultiplier;

    // If node belongs to a group, position it near the group center
    const groupId = nodeToGroup.get(node.id);
    const groupCenter = groupId ? groupCenters.get(groupId) : undefined;
    if (groupCenter) {
      // For horizontal layouts: keep depth-based X, use group center for Y
      // For vertical layouts: keep depth-based Y, use group center for X
      if (isHorizontal) {
        // primaryPos is X (depth-based, keep it)
        // secondaryPos is Y (use group center instead)
        secondaryPos = groupCenter.y + secondaryPos * 0.2;
      } else {
        // primaryPos is Y (depth-based, keep it)
        // secondaryPos is X (use group center instead)
        secondaryPos = groupCenter.x + secondaryPos * 0.2;
      }
    }

    // Add small random jitter to help force simulation spread nodes out
    // Use node ID as seed for deterministic randomness
    const seed = node.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const jitterX = ((seed % 100) / 100 - 0.5) * spacing * 0.1;
    const jitterY = (((seed * 7) % 100) / 100 - 0.5) * spacing * 0.1;

    return {
      node,
      x: (isHorizontal ? primaryPos : secondaryPos) + jitterX,
      y: (isHorizontal ? secondaryPos : primaryPos) + jitterY,
      vx: 0,
      vy: 0,
      width: node.size?.width ?? nodeDefaults.width,
      height: node.size?.height ?? nodeDefaults.height,
    };
  });

  // Build position lookup
  const getPos = (nodeId: string) => positions.find((p) => p.node.id === nodeId);

  // Simulation
  for (let iter = 0; iter < iterations; iter++) {
    // Reset forces
    positions.forEach((p) => {
      p.vx = 0;
      p.vy = 0;
    });

    // Repulsion between all nodes (stronger for non-connected nodes)
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const distSq = dx * dx + dy * dy + 0.01;
        const dist = Math.sqrt(distSq);

        // Stronger repulsion for overlapping or very close nodes
        const minDistX = (positions[i].width + positions[j].width) / 2 + spacing * 0.25;
        const minDistY = (positions[i].height + positions[j].height) / 2 + spacing * 0.25;
        const minDist = Math.sqrt(minDistX * minDistX + minDistY * minDistY);
        const force =
          dist < minDist
            ? (repulsionStrength * 3) / distSq // Stronger repulsion when too close
            : (repulsionStrength * 1.0) / distSq; // Base repulsion

        // Bias repulsion based on direction
        let fx = (dx / dist) * force;
        let fy = (dy / dist) * force;

        if (isHorizontal) {
          fx *= 1.5; // Stronger horizontal repulsion
          fy *= 0.6; // Weaker vertical repulsion
        } else {
          fx *= 0.6; // Weaker horizontal repulsion
          fy *= 1.5; // Stronger vertical repulsion
        }

        positions[i].vx -= fx;
        positions[i].vy -= fy;
        positions[j].vx += fx;
        positions[j].vy += fy;
      }
    }

    // Attraction along edges
    edges.forEach((edge) => {
      const fromPos = getPos(edge.from);
      const toPos = getPos(edge.to);
      if (!fromPos || !toPos) return;

      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy + 0.01);
      const force = attractionStrength * dist;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      fromPos.vx += fx;
      fromPos.vy += fy;
      toPos.vx -= fx;
      toPos.vy -= fy;
    });

    // Edge crossing avoidance: push nodes away from non-incident edges
    positions.forEach((nodePos) => {
      edges.forEach((edge) => {
        // Skip edges connected to this node
        if (edge.from === nodePos.node.id || edge.to === nodePos.node.id) return;

        const fromPos = getPos(edge.from);
        const toPos = getPos(edge.to);
        if (!fromPos || !toPos) return;

        // Calculate distance from node to edge line segment
        const edgeDx = toPos.x - fromPos.x;
        const edgeDy = toPos.y - fromPos.y;
        const edgeLengthSq = edgeDx * edgeDx + edgeDy * edgeDy;

        if (edgeLengthSq < 0.01) return;

        // Project node onto edge line
        const t = Math.max(
          0,
          Math.min(
            1,
            ((nodePos.x - fromPos.x) * edgeDx + (nodePos.y - fromPos.y) * edgeDy) / edgeLengthSq,
          ),
        );

        // Only apply force if projection is within the edge segment (not at endpoints)
        // This prevents pushing nodes away from edges they're not actually blocking
        if (t < 0.1 || t > 0.9) return;

        const closestX = fromPos.x + t * edgeDx;
        const closestY = fromPos.y + t * edgeDy;

        const dx = nodePos.x - closestX;
        const dy = nodePos.y - closestY;
        const distSq = dx * dx + dy * dy + 0.01;
        const dist = Math.sqrt(distSq);

        // Apply strong repulsion if node is too close to edge
        // Use node dimensions to calculate proper clearance
        const nodeRadius = Math.max(nodePos.width, nodePos.height) / 2;
        const threshold = nodeRadius + spacing * 0.1;

        if (dist < threshold) {
          // Exponential force - gets much stronger as distance decreases
          const normalizedDist = dist / threshold;
          const force = edgeCrossingPenalty * (1 - normalizedDist) * (1 - normalizedDist) * spacing;
          nodePos.vx += (dx / dist) * force;
          nodePos.vy += (dy / dist) * force;
        }
      });
    });

    // Edge-edge crossing minimization: detect crossing edges and push their endpoints apart
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const edge1 = edges[i];
        const edge2 = edges[j];

        // Skip if edges share a node
        if (
          edge1.from === edge2.from ||
          edge1.from === edge2.to ||
          edge1.to === edge2.from ||
          edge1.to === edge2.to
        )
          continue;

        const from1 = getPos(edge1.from);
        const to1 = getPos(edge1.to);
        const from2 = getPos(edge2.from);
        const to2 = getPos(edge2.to);

        if (!from1 || !to1 || !from2 || !to2) continue;

        // Check if edges cross using line segment intersection
        const det = (to1.x - from1.x) * (to2.y - from2.y) - (to1.y - from1.y) * (to2.x - from2.x);
        if (Math.abs(det) < 0.01) continue; // Parallel or nearly parallel

        const t1 =
          ((from2.x - from1.x) * (to2.y - from2.y) - (from2.y - from1.y) * (to2.x - from2.x)) / det;
        const t2 =
          ((from2.x - from1.x) * (to1.y - from1.y) - (from2.y - from1.y) * (to1.x - from1.x)) / det;

        // If edges cross (or nearly cross), apply repulsion to separate them
        if (t1 > 0.1 && t1 < 0.9 && t2 > 0.1 && t2 < 0.9) {
          const crossingForce = edgeCrossingPenalty * spacing * 0.15;

          // Push edge1 endpoints perpendicular to edge2
          const edge2Dx = to2.x - from2.x;
          const edge2Dy = to2.y - from2.y;
          const edge2Len = Math.sqrt(edge2Dx * edge2Dx + edge2Dy * edge2Dy);
          const perpX = -edge2Dy / edge2Len;
          const perpY = edge2Dx / edge2Len;

          // Determine which side of edge2 the edge1 endpoints are on
          const side1 =
            (to2.x - from2.x) * (from1.y - from2.y) - (to2.y - from2.y) * (from1.x - from2.x);
          const direction = side1 > 0 ? 1 : -1;

          from1.vx += perpX * crossingForce * direction;
          from1.vy += perpY * crossingForce * direction;
          to1.vx += perpX * crossingForce * direction;
          to1.vy += perpY * crossingForce * direction;

          // Push edge2 endpoints in opposite direction
          from2.vx -= perpX * crossingForce * direction;
          from2.vy -= perpY * crossingForce * direction;
          to2.vx -= perpX * crossingForce * direction;
          to2.vy -= perpY * crossingForce * direction;
        }
      }
    }

    // Compact hierarchical group forces
    if (groups && groups.length > 0 && groupCenters.size > 0) {
      // Reset group center velocities
      groupCenters.forEach((center) => {
        center.vx = 0;
        center.vy = 0;
      });

      // 1. Group-level repulsion: Keep group centers separated (weaker for compactness)
      const groupRepulsionStrength = spacing * spacing * 5.0; // Moderate repulsion
      const groupCenterArray = Array.from(groupCenters.entries());

      for (let i = 0; i < groupCenterArray.length; i++) {
        for (let j = i + 1; j < groupCenterArray.length; j++) {
          const [, centerI] = groupCenterArray[i];
          const [, centerJ] = groupCenterArray[j];

          const dx = centerJ.x - centerI.x;
          const dy = centerJ.y - centerI.y;
          const distSq = dx * dx + dy * dy + 0.01;
          const dist = Math.sqrt(distSq);

          const force = groupRepulsionStrength / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          centerI.vx -= fx;
          centerI.vy -= fy;
          centerJ.vx += fx;
          centerJ.vy += fy;
        }
      }

      // 2. Node-to-group-center attraction: Pull nodes toward their group center
      const groupAttractionStrength = 0.05; // Weaker attraction to allow more spreading

      positions.forEach((pos) => {
        const groupId = nodeToGroup.get(pos.node.id);
        const groupCenter = groupId ? groupCenters.get(groupId) : undefined;
        if (groupCenter) {
          const dx = groupCenter.x - pos.x;
          const dy = groupCenter.y - pos.y;

          pos.vx += dx * groupAttractionStrength;
          pos.vy += dy * groupAttractionStrength;

          // Apply opposite force to group center (Newton's third law)
          groupCenter.vx -= dx * groupAttractionStrength * 0.1;
          groupCenter.vy -= dy * groupAttractionStrength * 0.1;
        }
      });

      // 3. Node-level separation between different groups (moderate)
      const groupSeparationStrength = spacing * 2.0;

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const groupI = nodeToGroup.get(positions[i].node.id);
          const groupJ = nodeToGroup.get(positions[j].node.id);

          // Apply separation if nodes are in different groups OR if one is ungrouped
          const inDifferentGroups = groupI && groupJ && groupI !== groupJ;
          const oneUngrouped = (groupI && !groupJ) || (!groupI && groupJ);

          if (inDifferentGroups || oneUngrouped) {
            const dx = positions[j].x - positions[i].x;
            const dy = positions[j].y - positions[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy + 0.01);

            const force = groupSeparationStrength / (dist * 1.0 + spacing * 0.5);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            positions[i].vx -= fx;
            positions[i].vy -= fy;
            positions[j].vx += fx;
            positions[j].vy += fy;
          }
        }
      }

      // 4. Update group center positions
      groupCenters.forEach((center) => {
        center.x += center.vx * damping;
        center.y += center.vy * damping;
      });
    }

    // Update positions with damping
    positions.forEach((p) => {
      p.x += p.vx * damping;
      p.y += p.vy * damping;
    });
  }

  // Post-simulation: resolve any remaining rectangular overlaps
  for (let pass = 0; pass < 10; pass++) {
    let hasOverlap = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const overlapX =
          (positions[i].width + positions[j].width) / 2 +
          spacing * 0.15 -
          Math.abs(positions[j].x - positions[i].x);
        const overlapY =
          (positions[i].height + positions[j].height) / 2 +
          spacing * 0.15 -
          Math.abs(positions[j].y - positions[i].y);
        if (overlapX > 0 && overlapY > 0) {
          hasOverlap = true;
          // Push apart along the axis with less overlap
          if (overlapX < overlapY) {
            const push = overlapX / 2 + 1;
            if (positions[j].x >= positions[i].x) {
              positions[i].x -= push;
              positions[j].x += push;
            } else {
              positions[i].x += push;
              positions[j].x -= push;
            }
          } else {
            const push = overlapY / 2 + 1;
            if (positions[j].y >= positions[i].y) {
              positions[i].y -= push;
              positions[j].y += push;
            } else {
              positions[i].y += push;
              positions[j].y -= push;
            }
          }
        }
      }
    }
    if (!hasOverlap) break;
  }

  // Pack disconnected components closer together
  // Detect connected components and re-arrange their bounding boxes in a grid
  const COMPONENT_GAP = 60;
  const adjacency = new Map<string, Set<string>>();
  positions.forEach((p) => adjacency.set(p.node.id, new Set()));
  edges.forEach((edge) => {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  });

  const componentOf = new Map<string, number>();
  let componentCount = 0;
  positions.forEach((p) => {
    if (componentOf.has(p.node.id)) return;
    const compId = componentCount++;
    const stack = [p.node.id];
    while (stack.length > 0) {
      const nid = stack.pop();
      if (nid === undefined) break;
      if (componentOf.has(nid)) continue;
      componentOf.set(nid, compId);
      adjacency.get(nid)?.forEach((neighbor) => {
        if (!componentOf.has(neighbor)) stack.push(neighbor);
      });
    }
  });

  if (componentCount > 1) {
    // Compute bounding box for each component
    const compBounds = new Map<
      number,
      { minX: number; minY: number; maxX: number; maxY: number }
    >();
    positions.forEach((p) => {
      const cid = componentOf.get(p.node.id);
      if (cid === undefined) return;
      const existing = compBounds.get(cid);
      if (!existing) {
        compBounds.set(cid, { minX: p.x, minY: p.y, maxX: p.x + p.width, maxY: p.y + p.height });
      } else {
        existing.minX = Math.min(existing.minX, p.x);
        existing.minY = Math.min(existing.minY, p.y);
        existing.maxX = Math.max(existing.maxX, p.x + p.width);
        existing.maxY = Math.max(existing.maxY, p.y + p.height);
      }
    });

    // Sort components by size (largest first) for better packing
    const compIds = Array.from(compBounds.keys()).sort((a, b) => {
      const ba = compBounds.get(a);
      const bb = compBounds.get(b);
      if (!ba || !bb) return 0;
      return (bb.maxX - bb.minX) * (bb.maxY - bb.minY) - (ba.maxX - ba.minX) * (ba.maxY - ba.minY);
    });

    // Arrange components in a grid layout
    const cols = Math.ceil(Math.sqrt(compIds.length));
    let gridX = 0;
    let gridY = 0;
    let rowMaxHeight = 0;
    let colIndex = 0;

    for (const cid of compIds) {
      const bounds = compBounds.get(cid);
      if (!bounds) continue;
      const compW = bounds.maxX - bounds.minX;
      const compH = bounds.maxY - bounds.minY;

      // Shift all nodes in this component so the component's top-left is at (gridX, gridY)
      const dx = gridX - bounds.minX;
      const dy = gridY - bounds.minY;
      positions.forEach((p) => {
        if (componentOf.get(p.node.id) === cid) {
          p.x += dx;
          p.y += dy;
        }
      });

      gridX += compW + COMPONENT_GAP;
      rowMaxHeight = Math.max(rowMaxHeight, compH);
      colIndex++;

      if (colIndex >= cols) {
        colIndex = 0;
        gridX = 0;
        gridY += rowMaxHeight + COMPONENT_GAP;
        rowMaxHeight = 0;
      }
    }
  }

  return positions.map((p) => ({
    ...p.node,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
  }));
}

/**
 * Compute circular layout
 */
function computeCircularLayout(
  nodes: DiagramNode[],
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
): ComputedNode[] {
  const radius = 200;
  const angleStep = (2 * Math.PI) / nodes.length;

  return nodes.map((node, i) => {
    const angle = i * angleStep;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    const width = node.size?.width ?? nodeDefaults.width;
    const height = node.size?.height ?? nodeDefaults.height;

    return { ...node, x, y, width, height };
  });
}

/**
 * Compute tree layout
 * Hierarchical layout with parent-child relationships
 */
function computeTreeLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
): ComputedNode[] {
  const spacing = clampSpacing(layout.spacing, 60);
  const direction = layout.direction ?? 'TB';
  const isVertical = direction === 'TB' || direction === 'BT';

  // Build parent-child relationships
  const children = new Map<string, string[]>();
  const parents = new Map<string, string>();

  edges.forEach((edge) => {
    let childList = children.get(edge.from);
    if (!childList) {
      childList = [];
      children.set(edge.from, childList);
    }
    childList.push(edge.to);
    parents.set(edge.to, edge.from);
  });

  // Find root nodes (nodes with no parents)
  const roots = nodes.filter((node) => !parents.has(node.id));
  if (roots.length === 0 && nodes.length > 0) {
    // If no roots found, use first node
    roots.push(nodes[0]);
  }

  // Compute tree layout recursively
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  let currentX = 0;

  function layoutNode(nodeId: string, depth: number): { width: number; height: number } {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return { width: 0, height: 0 };

    const width = node.size?.width ?? nodeDefaults.width;
    const height = node.size?.height ?? nodeDefaults.height;
    const nodeChildren = children.get(nodeId) || [];

    if (nodeChildren.length === 0) {
      // Leaf node
      const x = isVertical ? currentX : depth * (width + spacing);
      const y = isVertical ? depth * (height + spacing) : currentX;
      positions.set(nodeId, { x, y, width, height });
      currentX += (isVertical ? width : height) + spacing;
      return { width, height };
    }

    // Layout children first
    const childrenWidths: number[] = [];
    nodeChildren.forEach((childId) => {
      const childSize = layoutNode(childId, depth + 1);
      childrenWidths.push(isVertical ? childSize.width : childSize.height);
    });

    // Position this node centered above children
    const childrenStart =
      currentX - childrenWidths.reduce((a, b) => a + b, 0) - spacing * (childrenWidths.length - 1);
    const childrenEnd = currentX;
    const centerX = (childrenStart + childrenEnd) / 2;

    const x = isVertical ? centerX : depth * (width + spacing);
    const y = isVertical ? depth * (height + spacing) : centerX;
    positions.set(nodeId, { x, y, width, height });

    return { width, height };
  }

  // Layout from each root
  roots.forEach((root) => {
    layoutNode(root.id, 0);
  });

  // Convert to ComputedNode array
  return nodes.map((node) => {
    const pos = positions.get(node.id) || {
      x: 0,
      y: 0,
      width: nodeDefaults.width,
      height: nodeDefaults.height,
    };
    return {
      ...node,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    };
  });
}

/**
 * Calculate intersection point between a line and a rectangle
 * Line goes from (centerX, centerY) towards (targetX, targetY)
 */

/**
 * Compute edge paths based on edge routing type
 */
function computeEdgePaths(
  edges: DiagramEdge[],
  nodes: ComputedNode[],
  layout: DiagramBaseView['layout'],
  groups?: DiagramGroup[],
): ComputedEdge[] {
  const edgeRouting = layout.edgeRouting || 'polyline';

  // Circular layouts should always use straight lines — orthogonal routing
  // creates ugly right-angle paths between circularly-placed nodes
  if (layout.type === 'circular') {
    return computeStraightEdgePaths(edges, nodes);
  }

  if (edgeRouting === 'orthogonal' || edgeRouting === 'curved') {
    return computeOrthogonalEdgePaths(edges, nodes, layout, groups);
  }

  // Default: simple straight lines
  return computeStraightEdgePaths(edges, nodes);
}

/**
 * Build a map of edge ID → perpendicular offset for bidirectional edge pairs.
 * When two edges connect the same pair of nodes in opposite directions,
 * they get offset ±BIDIRECTIONAL_OFFSET perpendicular to the line between nodes.
 */
const BIDIRECTIONAL_OFFSET = 32;
const BIDIRECTIONAL_LABEL_CLEARANCE = 6;

export function measuredBidirectionalOffset(firstExtent: number, secondExtent: number) {
  return Math.max(
    BIDIRECTIONAL_OFFSET,
    (firstExtent + secondExtent) / 4 + BIDIRECTIONAL_LABEL_CLEARANCE / 2,
  );
}

function buildBidirectionalOffsetMap(
  edges: DiagramEdge[],
  nodes: ComputedNode[],
): Map<string, number> {
  const offsets = new Map<string, number>();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  // Build a map of directed pairs: "from::to" -> edges
  const directedMap = new Map<string, DiagramEdge[]>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const key = `${edge.from}::${edge.to}`;
    let directedEdges = directedMap.get(key);
    if (!directedEdges) {
      directedEdges = [];
      directedMap.set(key, directedEdges);
    }
    directedEdges.push(edge);
  }

  // Only offset edges that are truly bidirectional (A→B AND B→A both exist)
  const processed = new Set<string>();
  for (const [key] of directedMap) {
    const [from, to] = key.split('::');
    const reverseKey = `${to}::${from}`;
    const sortedPairKey = [from, to].sort().join('::');

    if (processed.has(sortedPairKey)) continue;
    if (!directedMap.has(reverseKey)) continue;

    // Both directions exist - apply offsets
    processed.add(sortedPairKey);
    const forwardEdges = directedMap.get(key);
    const reverseEdges = directedMap.get(reverseKey);
    if (!forwardEdges || !reverseEdges) continue;

    const fromNode = nodeMap.get(from);
    const toNode = nodeMap.get(to);
    const horizontal =
      fromNode && toNode
        ? Math.abs(toNode.x + toNode.width / 2 - (fromNode.x + fromNode.width / 2)) >=
          Math.abs(toNode.y + toNode.height / 2 - (fromNode.y + fromNode.height / 2))
        : false;
    const widestLabel = (pair: DiagramEdge[]) =>
      Math.max(
        0,
        ...pair.map((edge) => {
          if (!edge.label) return 0;
          const label = measureEdgeLabel(edge.label);
          return horizontal ? label.height : label.width;
        }),
      );
    const offset = measuredBidirectionalOffset(
      widestLabel(forwardEdges),
      widestLabel(reverseEdges),
    );

    for (const edge of forwardEdges) {
      offsets.set(edge.id, offset);
    }
    for (const edge of reverseEdges) {
      offsets.set(edge.id, offset);
    }
  }

  return offsets;
}

/**
 * Apply perpendicular offset to a point along the line from->to.
 */
function applyPerpendicularOffset(
  point: { x: number; y: number },
  fromCenter: { x: number; y: number },
  toCenter: { x: number; y: number },
  offset: number,
): { x: number; y: number } {
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return point;
  // Perpendicular direction (rotate 90 degrees)
  const perpX = -dy / len;
  const perpY = dx / len;
  return { x: point.x + perpX * offset, y: point.y + perpY * offset };
}

/**
 * Compute edge paths with simple straight lines
 */
function computeStraightEdgePaths(edges: DiagramEdge[], nodes: ComputedNode[]): ComputedEdge[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const biOffsets = buildBidirectionalOffsetMap(edges, nodes);
  const selfLoopCounts = new Map<string, number>();

  return edges.map((edge) => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);

    if (!fromNode || !toNode) {
      return { ...edge, path: '', points: [] };
    }

    // Self-loop: edge from a node to itself
    if (fromNode.id === toNode.id) {
      const loopIdx = selfLoopCounts.get(edge.from) ?? 0;
      selfLoopCounts.set(edge.from, loopIdx + 1);
      const { path, points } = computeSelfLoopPath(fromNode, loopIdx);
      return { ...edge, path, points };
    }

    // Calculate centers
    const fromCenterX = fromNode.x + fromNode.width / 2;
    const fromCenterY = fromNode.y + fromNode.height / 2;
    const toCenterX = toNode.x + toNode.width / 2;
    const toCenterY = toNode.y + toNode.height / 2;

    // Determine direction
    const dx = toCenterX - fromCenterX;
    const dy = toCenterY - fromCenterY;

    // Calculate connection points on node edges (not centers)
    let fromPoint: { x: number; y: number };
    let toPoint: { x: number; y: number };

    // Use angle to determine best connection point
    const angle = Math.atan2(dy, dx);
    const absAngle = Math.abs(angle);

    if (absAngle < Math.PI / 4) {
      fromPoint = { x: fromNode.x + fromNode.width, y: fromCenterY };
      toPoint = { x: toNode.x, y: toCenterY };
    } else if (absAngle > (3 * Math.PI) / 4) {
      fromPoint = { x: fromNode.x, y: fromCenterY };
      toPoint = { x: toNode.x + toNode.width, y: toCenterY };
    } else if (angle > 0) {
      fromPoint = { x: fromCenterX, y: fromNode.y + fromNode.height };
      toPoint = { x: toCenterX, y: toNode.y };
    } else {
      fromPoint = { x: fromCenterX, y: fromNode.y };
      toPoint = { x: toCenterX, y: toNode.y + toNode.height };
    }

    // Keep a small source gap. The renderer applies the exact scale-aware target gap.
    const gap = 2;
    const edgeDx = toPoint.x - fromPoint.x;
    const edgeDy = toPoint.y - fromPoint.y;
    const length = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

    if (length > gap * 2) {
      const dirX = edgeDx / length;
      const dirY = edgeDy / length;
      fromPoint = { x: fromPoint.x + dirX * gap, y: fromPoint.y + dirY * gap };
    }

    // Apply bidirectional offset if needed
    const biOffset = biOffsets.get(edge.id);
    if (biOffset) {
      const fromCenter = { x: fromCenterX, y: fromCenterY };
      const toCenter = { x: toCenterX, y: toCenterY };
      fromPoint = applyPerpendicularOffset(fromPoint, fromCenter, toCenter, biOffset);
      toPoint = applyPerpendicularOffset(toPoint, fromCenter, toCenter, biOffset);
    }

    const path = `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
    const points = [
      fromPoint,
      { x: (fromPoint.x + toPoint.x) / 2, y: (fromPoint.y + toPoint.y) / 2 },
      toPoint,
    ];

    return { ...edge, path, points };
  });
}

type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * Compute organized orthogonal edge paths with proper track-based routing
 * Uses channel allocation to avoid overlapping edges
 */
function computeOrthogonalEdgePaths(
  edges: DiagramEdge[],
  nodes: ComputedNode[],
  layout: DiagramBaseView['layout'],
  groups?: DiagramGroup[],
): ComputedEdge[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nodeGroup = new Map(nodes.flatMap((node) => (node.group ? [[node.id, node.group]] : [])));
  groups?.forEach((group) => group.nodeIds?.forEach((nodeId) => nodeGroup.set(nodeId, group.id)));
  const biOffsets = buildBidirectionalOffsetMap(edges, nodes);
  const direction = layout.direction || 'TB';
  const isVerticalLayout = direction === 'TB' || direction === 'BT';

  const TRACK_SPACING = 16; // Space between parallel routing tracks
  const NODE_CLEARANCE = 24; // Minimum clearance from node edge for routing
  const NODE_GAP = 32; // Keep a clear lead between a node and the first turn

  // Find the bounding box of all nodes
  let minX = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  // Collect edge info
  type EdgeInfo = {
    index: number;
    edge: DiagramEdge;
    fromNode: ComputedNode;
    toNode: ComputedNode;
    fromSide: Side;
    toSide: Side;
    goesBackward: boolean;
  };

  const edgeInfos: EdgeInfo[] = [];
  const selfLoopEdges: ComputedEdge[] = [];
  const selfLoopCounts = new Map<string, number>();

  for (const [index, edge] of edges.entries()) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) continue;

    // Self-loop: edge from a node to itself
    if (fromNode.id === toNode.id) {
      const loopIdx = selfLoopCounts.get(edge.from) ?? 0;
      selfLoopCounts.set(edge.from, loopIdx + 1);
      const { path, points } = computeSelfLoopPath(fromNode, loopIdx);
      selfLoopEdges.push({ ...edge, path, points });
      continue;
    }

    const { fromSide, toSide } = determineConnectionSides(fromNode, toNode, isVerticalLayout);

    const usesDirectedLayers = layout.type === 'layered' || layout.type === 'tree';
    const goesBackward =
      usesDirectedLayers &&
      (isVerticalLayout
        ? fromNode.y + fromNode.height / 2 > toNode.y + toNode.height / 2
        : fromNode.x + fromNode.width / 2 > toNode.x + toNode.width / 2);

    edgeInfos.push({ index, edge, fromNode, toNode, fromSide, toSide, goesBackward });
  }

  const portPositions = assignOrderedPortPositions(edgeInfos);

  // Group edges by their routing needs to allocate non-overlapping channels
  // For horizontal layout: edges using vertical midline channels
  // For vertical layout: edges using horizontal midline channels

  // Channel allocation: group edges that share horizontal/vertical segments

  // Pre-compute which channel each edge needs
  const edgeChannelInfo = new Map<
    string,
    {
      needsHorizontalChannel: boolean;
      needsVerticalChannel: boolean;
      horizontalY: number;
      verticalX: number;
    }
  >();

  edgeInfos.forEach((info) => {
    const { fromNode, toNode, fromSide, toSide } = info;
    const isFromVertical = fromSide === 'top' || fromSide === 'bottom';
    const isToVertical = toSide === 'top' || toSide === 'bottom';

    const fromCenterX = fromNode.x + fromNode.width / 2;
    const fromCenterY = fromNode.y + fromNode.height / 2;
    const toCenterX = toNode.x + toNode.width / 2;
    const toCenterY = toNode.y + toNode.height / 2;

    let needsHorizontalChannel = false;
    let needsVerticalChannel = false;

    // Calculate channel position with proper clearance from nodes
    // For horizontal channels: position between the two nodes with clearance
    let horizontalY: number;
    if (fromSide === 'bottom' && toSide === 'top') {
      // From bottom to top: place channel between nodes
      const fromBottom = fromNode.y + fromNode.height;
      const toTop = toNode.y;
      horizontalY = (fromBottom + toTop) / 2;
      // Ensure minimum clearance from both nodes
      horizontalY = Math.max(horizontalY, fromBottom + NODE_CLEARANCE);
      horizontalY = Math.min(horizontalY, toTop - NODE_CLEARANCE);
    } else if (fromSide === 'top' && toSide === 'bottom') {
      // From top to bottom: place channel between nodes
      const fromTop = fromNode.y;
      const toBottom = toNode.y + toNode.height;
      horizontalY = (fromTop + toBottom) / 2;
      horizontalY = Math.min(horizontalY, fromTop - NODE_CLEARANCE);
      horizontalY = Math.max(horizontalY, toBottom + NODE_CLEARANCE);
    } else {
      // Default: midpoint with offset toward the gap between nodes
      horizontalY = (fromCenterY + toCenterY) / 2;
    }

    // For vertical channels: position between nodes with clearance
    let verticalX: number;
    if (fromSide === 'right' && toSide === 'left') {
      const fromRight = fromNode.x + fromNode.width;
      const toLeft = toNode.x;
      verticalX = (fromRight + toLeft) / 2;
    } else if (fromSide === 'left' && toSide === 'right') {
      const fromLeft = fromNode.x;
      const toRight = toNode.x + toNode.width;
      verticalX = (fromLeft + toRight) / 2;
    } else {
      verticalX = (fromCenterX + toCenterX) / 2;
    }

    if (isFromVertical && isToVertical && Math.abs(fromCenterX - toCenterX) > 5) {
      needsHorizontalChannel = true;
    } else if (!isFromVertical && !isToVertical) {
      needsVerticalChannel = true;
    }

    edgeChannelInfo.set(info.edge.id, {
      needsHorizontalChannel,
      needsVerticalChannel,
      horizontalY,
      verticalX,
    });
  });

  // Allocate channels to avoid overlapping
  // Sort edges by their channel position to assign unique tracks
  const edgesNeedingHorizontal = edgeInfos.filter(
    (e) => edgeChannelInfo.get(e.edge.id)?.needsHorizontalChannel,
  );
  const edgesNeedingVertical = edgeInfos.filter(
    (e) => edgeChannelInfo.get(e.edge.id)?.needsVerticalChannel,
  );

  // Sort by natural channel position
  edgesNeedingHorizontal.sort((a, b) => {
    const aInfo = edgeChannelInfo.get(a.edge.id);
    const bInfo = edgeChannelInfo.get(b.edge.id);
    if (!aInfo || !bInfo) return 0;
    return aInfo.horizontalY - bInfo.horizontalY;
  });

  edgesNeedingVertical.sort((a, b) => {
    const aInfo = edgeChannelInfo.get(a.edge.id);
    const bInfo = edgeChannelInfo.get(b.edge.id);
    if (!aInfo || !bInfo) return 0;
    return aInfo.verticalX - bInfo.verticalX;
  });

  // Assign non-overlapping channel positions
  const horizontalChannelY = new Map<string, number>();
  const verticalChannelX = new Map<string, number>();

  // For horizontal channels: check if edges overlap in X and need different Y
  // Use a more aggressive separation algorithm
  const assignHorizontalChannels = () => {
    // Group edges by their approximate Y position (within tolerance)
    const assignedChannels: {
      minX: number;
      maxX: number;
      y: number;
      edgeId: string;
      sourceId: string;
      targetId: string;
    }[] = [];

    edgesNeedingHorizontal.forEach((info) => {
      const { fromNode, toNode } = info;
      const channelInfo = edgeChannelInfo.get(info.edge.id);
      if (!channelInfo) return;
      const baseY = channelInfo.horizontalY;
      // Use full node extent for overlap detection
      const edgeMinX = Math.min(fromNode.x, toNode.x);
      const edgeMaxX = Math.max(fromNode.x + fromNode.width, toNode.x + toNode.width);

      // Find all channels this edge would overlap with
      const overlappingChannels = assignedChannels.filter((channel) => {
        const overlapsX = !(edgeMaxX < channel.minX - 10 || edgeMinX > channel.maxX + 10);
        return (
          overlapsX && (channel.sourceId !== info.edge.from || channel.targetId === info.edge.to)
        );
      });

      // Find a Y position that doesn't conflict with overlapping channels
      let assignedY = baseY;
      if (overlappingChannels.length > 0) {
        // Collect all Y positions that are taken
        const takenYs = overlappingChannels.map((c) => c.y).sort((a, b) => a - b);

        // Find a free slot
        let foundSlot = false;
        for (let offset = 0; offset <= overlappingChannels.length; offset++) {
          const candidateY = baseY + offset * TRACK_SPACING;
          const isTaken = takenYs.some((y) => Math.abs(y - candidateY) < TRACK_SPACING - 1);
          if (!isTaken) {
            assignedY = candidateY;
            foundSlot = true;
            break;
          }
          // Also try negative offset
          const candidateYNeg = baseY - offset * TRACK_SPACING;
          const isTakenNeg = takenYs.some((y) => Math.abs(y - candidateYNeg) < TRACK_SPACING - 1);
          if (!isTakenNeg && offset > 0) {
            assignedY = candidateYNeg;
            foundSlot = true;
            break;
          }
        }
        if (!foundSlot) {
          assignedY = baseY + overlappingChannels.length * TRACK_SPACING;
        }
      }

      assignedChannels.push({
        minX: edgeMinX,
        maxX: edgeMaxX,
        y: assignedY,
        edgeId: info.edge.id,
        sourceId: info.edge.from,
        targetId: info.edge.to,
      });
      horizontalChannelY.set(info.edge.id, assignedY);
    });
  };

  const assignVerticalChannels = () => {
    const assignedChannels: { minY: number; maxY: number; x: number; edgeId: string }[] = [];

    edgesNeedingVertical.forEach((info) => {
      const { fromNode, toNode } = info;
      const channelInfo = edgeChannelInfo.get(info.edge.id);
      if (!channelInfo) return;
      const baseX = channelInfo.verticalX;
      const edgeMinY = Math.min(fromNode.y, toNode.y);
      const edgeMaxY = Math.max(fromNode.y + fromNode.height, toNode.y + toNode.height);

      // Find overlapping channels
      const overlappingChannels = assignedChannels.filter((channel) => {
        const overlapsY = !(edgeMaxY < channel.minY - 10 || edgeMinY > channel.maxY + 10);
        return overlapsY;
      });

      let assignedX = baseX;
      if (overlappingChannels.length > 0) {
        const takenXs = overlappingChannels.map((c) => c.x).sort((a, b) => a - b);

        let foundSlot = false;
        for (let offset = 0; offset <= overlappingChannels.length; offset++) {
          const candidateX = baseX + offset * TRACK_SPACING;
          const isTaken = takenXs.some((x) => Math.abs(x - candidateX) < TRACK_SPACING - 1);
          if (!isTaken) {
            assignedX = candidateX;
            foundSlot = true;
            break;
          }
          const candidateXNeg = baseX - offset * TRACK_SPACING;
          const isTakenNeg = takenXs.some((x) => Math.abs(x - candidateXNeg) < TRACK_SPACING - 1);
          if (!isTakenNeg && offset > 0) {
            assignedX = candidateXNeg;
            foundSlot = true;
            break;
          }
        }
        if (!foundSlot) {
          assignedX = baseX + overlappingChannels.length * TRACK_SPACING;
        }
      }

      assignedChannels.push({ minY: edgeMinY, maxY: edgeMaxY, x: assignedX, edgeId: info.edge.id });
      verticalChannelX.set(info.edge.id, assignedX);
    });
  };

  assignHorizontalChannels();
  assignVerticalChannels();

  // Backward edge track allocation
  const backwardEdges = edgeInfos.filter((e) => e.goesBackward);
  backwardEdges.sort((a, b) => {
    const aDistance = isVerticalLayout
      ? Math.abs(a.fromNode.y - a.toNode.y)
      : Math.abs(a.fromNode.x - a.toNode.x);
    const bDistance = isVerticalLayout
      ? Math.abs(b.fromNode.y - b.toNode.y)
      : Math.abs(b.fromNode.x - b.toNode.x);
    return bDistance - aDistance;
  });

  const backwardTrackMap = new Map<string, number>();
  backwardEdges.forEach((info, i) => {
    backwardTrackMap.set(info.edge.id, i);
  });

  const directedParallelMap = new Map<string, { index: number; count: number }>();
  const directedParallelGroups = new Map<string, EdgeInfo[]>();
  for (const info of edgeInfos) {
    const key = `${info.edge.from}->${info.edge.to}`;
    const group = directedParallelGroups.get(key) ?? [];
    group.push(info);
    directedParallelGroups.set(key, group);
  }
  for (const group of directedParallelGroups.values()) {
    group.forEach((info, index) =>
      directedParallelMap.set(info.edge.id, { index, count: group.length }),
    );
  }

  const verticalCorridorIsBlocked = (info: EdgeInfo) => {
    const routeX =
      (info.fromNode.x + info.fromNode.width / 2 + info.toNode.x + info.toNode.width / 2) / 2;
    const startY = Math.min(
      info.fromNode.y + info.fromNode.height,
      info.toNode.y + info.toNode.height,
    );
    const endY = Math.max(info.fromNode.y, info.toNode.y);
    if (endY <= startY) return false;

    return nodes.some(
      (node) =>
        node.id !== info.fromNode.id &&
        node.id !== info.toNode.id &&
        routeX >= node.x - NODE_GAP &&
        routeX <= node.x + node.width + NODE_GAP &&
        node.y < endY &&
        node.y + node.height > startY,
    );
  };

  const verticalLabelNeedsLane = (info: EdgeInfo) => {
    if (!info.edge.label) return false;
    const gap = Math.max(
      0,
      Math.max(info.fromNode.y, info.toNode.y) -
        Math.min(info.fromNode.y + info.fromNode.height, info.toNode.y + info.toNode.height),
    );
    const compactLabel = measureEdgeLabel(
      info.edge.label,
      compactEdgeLabelMaxWidth(info.edge.label, gap),
    );
    return compactLabel.lines >= 3 && gap < compactLabel.height + 16;
  };

  // Generate paths
  const computedEdges: ComputedEdge[] = edgeInfos.map((info) => {
    const { index, edge, fromNode, toNode, fromSide, toSide, goesBackward } = info;

    const getPortPosition = (node: ComputedNode, side: Side) => {
      switch (side) {
        case 'top':
          return { x: node.x + node.width / 2, y: node.y };
        case 'bottom':
          return { x: node.x + node.width / 2, y: node.y + node.height };
        case 'left':
          return { x: node.x, y: node.y + node.height / 2 };
        case 'right':
          return { x: node.x + node.width, y: node.y + node.height / 2 };
      }
    };

    const fromPos = portPositions.get(`${index}:from`) ?? getPortPosition(fromNode, fromSide);
    let toPos = portPositions.get(`${index}:to`) ?? getPortPosition(toNode, toSide);
    const biOffset = biOffsets.get(edge.id);

    const points: Array<{ x: number; y: number }> = [fromPos];

    const isFromVertical = fromSide === 'top' || fromSide === 'bottom';
    const isToVertical = toSide === 'top' || toSide === 'bottom';

    if (fromNode.id === toNode.id) {
      const source = { x: fromNode.x + fromNode.width, y: fromNode.y + fromNode.height / 2 };
      const target = { x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height };
      const trackX = source.x + NODE_CLEARANCE + TRACK_SPACING + 80;
      const trackY = target.y + NODE_CLEARANCE + TRACK_SPACING;
      points[0] = source;
      points.push({ x: trackX, y: source.y }, { x: trackX, y: trackY }, { x: target.x, y: trackY });
      toPos = target;
    } else if (
      nodes.length <= 6 &&
      edge.dashed &&
      edges.some(
        (candidate) =>
          candidate.id !== edge.id && candidate.from === edge.from && candidate.to === edge.to,
      )
    ) {
      const source = { x: fromNode.x + fromNode.width, y: fromNode.y + fromNode.height / 2 };
      const target = { x: toNode.x + toNode.width, y: toNode.y + toNode.height / 2 };
      const trackX = Math.max(source.x, target.x) + NODE_CLEARANCE + TRACK_SPACING;
      points[0] = source;
      points.push({ x: trackX, y: source.y }, { x: trackX, y: target.y });
      toPos = target;
    } else if (goesBackward) {
      // Backward edge: route around the outside
      const trackNum = backwardTrackMap.get(edge.id) ?? 0;

      if (isVerticalLayout) {
        const labelClearance = Math.max(
          groups?.length ? 0 : 32,
          edge.label ? estimateEdgeLabelWidth(edge.label) / 2 + 4 : 0,
        );
        const trackX = minX - NODE_CLEARANCE - labelClearance - (trackNum + 1) * TRACK_SPACING;
        const source = { x: fromNode.x, y: fromNode.y + fromNode.height / 2 };
        const target = { x: toNode.x, y: toNode.y + toNode.height / 2 };
        points[0] = source;
        points.push({ x: trackX, y: source.y }, { x: trackX, y: target.y });
        toPos = target;
      } else {
        const trackY = maxY + NODE_CLEARANCE + (trackNum + 1) * TRACK_SPACING;
        const stepAwayX = fromSide === 'right' ? fromPos.x + NODE_GAP : fromPos.x - NODE_GAP;
        const stepToX = toSide === 'left' ? toPos.x - NODE_GAP : toPos.x + NODE_GAP;
        points.push({ x: stepAwayX, y: fromPos.y });
        points.push({ x: stepAwayX, y: trackY });
        points.push({ x: stepToX, y: trackY });
        points.push({ x: stepToX, y: toPos.y });
      }
    } else if (
      isVerticalLayout &&
      isFromVertical &&
      isToVertical &&
      nodeGroup.has(fromNode.id) &&
      nodeGroup.has(toNode.id) &&
      nodeGroup.get(fromNode.id) !== nodeGroup.get(toNode.id)
    ) {
      // Enter a lower group from the side so the route does not cross its heading.
      const source = {
        x: fromNode.x + fromNode.width,
        y: fromNode.y + fromNode.height / 2,
      };
      const target = {
        x: toNode.x + toNode.width,
        y: toNode.y + toNode.height / 2,
      };
      const trackX = Math.max(
        maxX + NODE_CLEARANCE + NODE_GAP,
        source.x + NODE_GAP,
        target.x + NODE_GAP,
      );
      points[0] = source;
      points.push({ x: trackX, y: source.y }, { x: trackX, y: target.y });
      toPos = target;
    } else if (
      isVerticalLayout &&
      isFromVertical &&
      isToVertical &&
      (verticalCorridorIsBlocked(info) || verticalLabelNeedsLane(info))
    ) {
      // A rank-spanning edge must not pass through intermediate nodes. Give it one
      // outside lane with a horizontal segment sized for its label.
      const labelWidth = edge.label ? estimateEdgeLabelWidth(edge.label) : 0;
      const source = {
        x: fromNode.x + fromNode.width,
        y: fromNode.y + fromNode.height / 2,
      };
      const target = {
        x: toNode.x + toNode.width,
        y: toNode.y + toNode.height / 2,
      };
      const trackX = Math.max(
        maxX + NODE_CLEARANCE + labelWidth / 2 + TRACK_SPACING,
        source.x + Math.max(labelWidth + EDGE_LABEL_PADDING_X, NODE_GAP),
        target.x + Math.max(labelWidth + EDGE_LABEL_PADDING_X, NODE_GAP),
      );
      points[0] = source;
      points.push({ x: trackX, y: source.y }, { x: trackX, y: target.y });
      toPos = target;
    } else if (isFromVertical && isToVertical) {
      // Vertical to vertical - use allocated horizontal channel
      // Check if the node centers are aligned (not just port positions, which may be spread)
      const fromNodeCenterX = fromNode.x + fromNode.width / 2;
      const toNodeCenterX = toNode.x + toNode.width / 2;
      const portsAreAligned = Math.abs(fromPos.x - toPos.x) < 1;
      if (Math.abs(fromNodeCenterX - toNodeCenterX) < 5 && !biOffset && portsAreAligned) {
        // Nodes are vertically aligned - use a single straight line down the center
        // Skip this optimization when bidirectional offset is applied, as it would
        // override the offset and cause overlapping edges
        const centerX = (fromNodeCenterX + toNodeCenterX) / 2;
        points[0] = { x: centerX, y: fromPos.y };
        // toPos will be pushed with centerX below
        toPos = { x: centerX, y: toPos.y };
      } else if (Math.abs(fromNodeCenterX - toNodeCenterX) < 5 && !biOffset) {
        const centerX = (fromNodeCenterX + toNodeCenterX) / 2;
        points[0] = { x: centerX, y: fromPos.y };
        toPos = { x: centerX, y: toPos.y };
      } else if (Math.abs(fromNodeCenterX - toNodeCenterX) < 5) {
        const direction = fromPos.y <= toPos.y ? 1 : -1;
        const centerX = (fromNodeCenterX + toNodeCenterX) / 2 + direction * Math.abs(biOffset ?? 0);
        points[0] = { x: centerX, y: fromPos.y };
        toPos = { x: centerX, y: toPos.y };
      } else {
        const channelY = horizontalChannelY.get(edge.id) ?? (fromPos.y + toPos.y) / 2;
        // Add step-out segments for cleaner routing
        const stepOutY =
          fromSide === 'bottom'
            ? Math.max(fromPos.y + NODE_GAP, channelY)
            : Math.min(fromPos.y - NODE_GAP, channelY);
        const stepInY =
          toSide === 'top'
            ? Math.min(toPos.y - NODE_GAP, channelY)
            : Math.max(toPos.y + NODE_GAP, channelY);

        // Only add intermediate points if the channel is significantly different
        if (Math.abs(stepOutY - channelY) > 2) {
          points.push({ x: fromPos.x, y: stepOutY });
        }
        points.push({ x: fromPos.x, y: channelY });
        points.push({ x: toPos.x, y: channelY });
        if (Math.abs(stepInY - channelY) > 2) {
          points.push({ x: toPos.x, y: stepInY });
        }
      }
    } else if (!isFromVertical && !isToVertical && biOffset) {
      const routeBelow = fromPos.x < toPos.x;
      const laneY = routeBelow
        ? Math.max(fromNode.y + fromNode.height, toNode.y + toNode.height) +
          NODE_CLEARANCE +
          Math.abs(biOffset) / 2 +
          (edge.dashed ? 28 : 0)
        : Math.min(fromNode.y, toNode.y) -
          NODE_CLEARANCE -
          Math.abs(biOffset) / 2 -
          (edge.dashed ? 28 : 0);
      if (!routeBelow) {
        const source = getPortPosition(fromNode, fromSide);
        const target = getPortPosition(toNode, toSide);
        const stepAwayX = fromSide === 'right' ? source.x + NODE_GAP : source.x - NODE_GAP;
        const stepToX = toSide === 'left' ? target.x - NODE_GAP : target.x + NODE_GAP;
        points[0] = source;
        points.push(
          { x: stepAwayX, y: source.y },
          { x: stepAwayX, y: laneY },
          { x: stepToX, y: laneY },
          { x: stepToX, y: target.y },
        );
        toPos = target;
      } else {
        const source = {
          x: fromNode.x + fromNode.width * 0.65,
          y: fromNode.y + fromNode.height,
        };
        const target = {
          x: toNode.x + toNode.width * 0.35,
          y: toNode.y + toNode.height,
        };
        points[0] = source;
        points.push({ x: source.x, y: laneY }, { x: target.x, y: laneY });
        toPos = target;
      }
    } else if (!isFromVertical && !isToVertical) {
      // Horizontal to horizontal - use allocated vertical channel
      const channelX = verticalChannelX.get(edge.id) ?? (fromPos.x + toPos.x) / 2;
      const stepOutX =
        fromSide === 'right'
          ? Math.max(fromPos.x + NODE_GAP, channelX)
          : Math.min(fromPos.x - NODE_GAP, channelX);
      const stepInX =
        toSide === 'left'
          ? Math.min(toPos.x - NODE_GAP, channelX)
          : Math.max(toPos.x + NODE_GAP, channelX);

      if (Math.abs(stepOutX - channelX) > 2) {
        points.push({ x: stepOutX, y: fromPos.y });
      }
      points.push({ x: channelX, y: fromPos.y });
      points.push({ x: channelX, y: toPos.y });
      if (Math.abs(stepInX - channelX) > 2) {
        points.push({ x: stepInX, y: toPos.y });
      }
    } else {
      // L-shaped connection - add clearance step
      if (isFromVertical) {
        // From vertical port, step out, then go to target
        const stepY = fromSide === 'bottom' ? fromPos.y + NODE_GAP : fromPos.y - NODE_GAP;
        if (Math.abs(stepY - toPos.y) > 5) {
          points.push({ x: fromPos.x, y: stepY });
          points.push({ x: toPos.x, y: stepY });
        } else {
          points.push({ x: fromPos.x, y: toPos.y });
        }
      } else {
        const stepX = fromSide === 'right' ? fromPos.x + NODE_GAP : fromPos.x - NODE_GAP;
        if (Math.abs(stepX - toPos.x) > 5) {
          points.push({ x: stepX, y: fromPos.y });
          points.push({ x: stepX, y: toPos.y });
        } else {
          points.push({ x: toPos.x, y: fromPos.y });
        }
      }
    }

    points.push(toPos);
    const simplifiedPoints = simplifyOrthogonalPoints(points);

    return {
      ...edge,
      path: buildRoundedOrthogonalPath(simplifiedPoints),
      points: simplifiedPoints,
    };
  });

  return [...selfLoopEdges, ...computedEdges];

  function assignOrderedPortPositions(infos: EdgeInfo[]): Map<string, RoutePoint> {
    type PortUse = {
      key: string;
      node: ComputedNode;
      side: Side;
      desired: number;
      role: 'from' | 'to';
      edgeId: string;
    };
    const groups = new Map<string, PortUse[]>();
    const add = (use: PortUse) => {
      const key = `${use.node.id}:${use.side}`;
      groups.set(key, [...(groups.get(key) ?? []), use]);
    };
    for (const info of infos) {
      const fromVertical = info.fromSide === 'top' || info.fromSide === 'bottom';
      const toVertical = info.toSide === 'top' || info.toSide === 'bottom';
      add({
        key: `${info.index}:from`,
        node: info.fromNode,
        side: info.fromSide,
        desired: fromVertical
          ? info.toNode.x + info.toNode.width / 2
          : info.toNode.y + info.toNode.height / 2,
        role: 'from',
        edgeId: info.edge.id,
      });
      add({
        key: `${info.index}:to`,
        node: info.toNode,
        side: info.toSide,
        desired: toVertical
          ? info.fromNode.x + info.fromNode.width / 2
          : info.fromNode.y + info.fromNode.height / 2,
        role: 'to',
        edgeId: info.edge.id,
      });
    }

    const positions = new Map<string, RoutePoint>();
    for (const uses of groups.values()) {
      const roles = new Set(uses.map(({ role }) => role));
      const oppositeNodes = new Set(
        uses.map((use) => {
          const info = infos.find((candidate) => candidate.index === Number(use.key.split(':')[0]));
          return use.role === 'from' ? info?.toNode.id : info?.fromNode.id;
        }),
      );
      const needsDistinctPorts = uses.length >= 3 || (roles.size > 1 && oppositeNodes.size === 1);
      if (!needsDistinctPorts) continue;
      const sorted = uses.toSorted(
        (left, right) =>
          left.desired - right.desired ||
          left.role.localeCompare(right.role) ||
          left.edgeId.localeCompare(right.edgeId) ||
          left.key.localeCompare(right.key),
      );
      const { node, side } = sorted[0];
      const verticalSide = side === 'top' || side === 'bottom';
      const size = verticalSide ? node.width : node.height;
      const center = verticalSide ? node.x + node.width / 2 : node.y + node.height / 2;
      const available = Math.max(0, size - Math.min(32, size * 0.4));
      const gap = sorted.length > 1 ? Math.min(PORT_SLOT_GAP, available / (sorted.length - 1)) : 0;
      const start = center - (gap * (sorted.length - 1)) / 2;
      sorted.forEach((use, slot) => {
        const axis = start + slot * gap;
        positions.set(
          use.key,
          verticalSide
            ? { x: axis, y: side === 'top' ? node.y : node.y + node.height }
            : { x: side === 'left' ? node.x : node.x + node.width, y: axis },
        );
      });
    }
    return positions;
  }
}

function computeCompactColumnEdgePaths(
  edges: DiagramEdge[],
  nodes: ComputedNode[],
): ComputedEdge[] {
  const nodeMap = new Map(nodes.map((node, index) => [node.id, { node, index }]));
  const sourceRows = new Map<string, number>();
  const columnWidth = Math.max(...nodes.map((node) => node.x + node.width));
  const terminalLead = (edges.length >= nodes.length * 1.5 ? 24 : 32) + ORTHOGONAL_CORNER_RADIUS;

  return edges.flatMap((edge) => {
    const sourceEntry = nodeMap.get(edge.from);
    const targetEntry = nodeMap.get(edge.to);
    if (!sourceEntry || !targetEntry) return [];
    const { node: source, index: sourceIndex } = sourceEntry;
    const { node: target, index: targetIndex } = targetEntry;
    const row = sourceRows.get(edge.from) ?? 0;
    sourceRows.set(edge.from, row + 1);
    const compactLabel = edge.label
      ? measureEdgeLabel(edge.label, compactEdgeLabelMaxWidth(edge.label))
      : null;
    const needsAdjacentLabelLane =
      targetIndex === sourceIndex + 1 &&
      Boolean(compactLabel && compactLabel.height + 16 > target.y - (source.y + source.height));
    let points: Array<{ x: number; y: number }>;

    if (edge.from === edge.to) {
      const laneClearance = edge.label ? 64 : 44;
      const start = { x: source.x + source.width / 2, y: source.y };
      const end = { x: source.x + source.width, y: source.y + source.height / 2 };
      const laneX = columnWidth + laneClearance;
      const loopY = source.y - 32 - row * 26;
      points = [
        start,
        { x: start.x, y: loopY },
        { x: laneX, y: loopY },
        { x: laneX, y: end.y },
        end,
      ];
    } else if (targetIndex === sourceIndex + 1 && !needsAdjacentLabelLane) {
      points = [
        { x: source.x + source.width / 2, y: source.y + source.height },
        { x: target.x + target.width / 2, y: target.y },
      ];
    } else {
      const downward = targetIndex > sourceIndex;
      const start = {
        x: downward ? source.x + source.width : source.x,
        y: source.y + source.height / 2,
      };
      const end = {
        x: downward ? target.x + target.width : target.x,
        y: target.y + target.height / 2,
      };
      const laneClearance = needsAdjacentLabelLane
        ? Math.max(terminalLead, (compactLabel?.width ?? 0) / 2 + 8)
        : terminalLead;
      const laneX = downward ? columnWidth + laneClearance + row * 8 : -laneClearance - row * 8;
      points = [
        start,
        { x: start.x + (downward ? terminalLead : -terminalLead), y: start.y },
        { x: laneX, y: start.y },
        { x: laneX, y: end.y },
        { x: end.x + (downward ? terminalLead : -terminalLead), y: end.y },
        end,
      ];
    }

    const simplifiedPoints = simplifyOrthogonalPoints(points);
    return [
      {
        ...edge,
        path: buildCompactOrthogonalPath(simplifiedPoints),
        points: simplifiedPoints,
      },
    ];
  });
}

function buildCompactOrthogonalPath(
  points: RoutePoint[],
  radius = ORTHOGONAL_CORNER_RADIUS,
): string {
  if (points.length === 0) return '';
  const commands = [`M ${points[0].x} ${points[0].y}`];
  let current = points[0];
  let hasInitialLine = false;
  const lineTo = (point: RoutePoint) => {
    if (!hasInitialLine) {
      commands.push(`L ${point.x} ${point.y}`);
      hasInitialLine = true;
    } else if (Math.abs(point.y - current.y) < 0.001) commands.push(`H ${point.x}`);
    else commands.push(`V ${point.y}`);
    current = point;
  };

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incomingLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoingLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const cornerRadius = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    const before = {
      x: corner.x - ((corner.x - previous.x) / incomingLength) * cornerRadius,
      y: corner.y - ((corner.y - previous.y) / incomingLength) * cornerRadius,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / outgoingLength) * cornerRadius,
      y: corner.y + ((next.y - corner.y) / outgoingLength) * cornerRadius,
    };
    lineTo(before);
    commands.push(`Q ${corner.x} ${corner.y} ${after.x} ${after.y}`);
    current = after;
  }
  lineTo(points[points.length - 1]);
  return commands.join(' ');
}

function simplifyOrthogonalPoints(
  points: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  const simplified: Array<{ x: number; y: number }> = [];
  const equal = (a: number, b: number) => Math.abs(a - b) < 0.001;

  for (const point of points) {
    const last = simplified[simplified.length - 1];
    if (last && equal(last.x, point.x) && equal(last.y, point.y)) continue;

    while (simplified.length >= 2) {
      const previous = simplified[simplified.length - 2];
      const current = simplified[simplified.length - 1];
      const isCollinear =
        (equal(previous.x, current.x) && equal(current.x, point.x)) ||
        (equal(previous.y, current.y) && equal(current.y, point.y));
      if (!isCollinear) break;
      simplified.pop();
    }
    simplified.push(point);
  }

  return simplified;
}

/**
 * Determine which sides of the nodes to connect based on layout direction and positions
 */
function determineConnectionSides(
  fromNode: ComputedNode,
  toNode: ComputedNode,
  isVerticalLayout: boolean,
): { fromSide: Side; toSide: Side } {
  const fromCenterX = fromNode.x + fromNode.width / 2;
  const fromCenterY = fromNode.y + fromNode.height / 2;
  const toCenterX = toNode.x + toNode.width / 2;
  const toCenterY = toNode.y + toNode.height / 2;

  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;

  // For vertical layouts (TB/BT), prefer top/bottom connections
  if (isVerticalLayout) {
    if (fromNode.y + fromNode.height <= toNode.y) {
      return { fromSide: 'bottom', toSide: 'top' };
    }
    if (toNode.y + toNode.height <= fromNode.y) {
      return { fromSide: 'top', toSide: 'bottom' };
    }
    // Vertically overlapping nodes share a row even when their measured heights differ.
    return dx > 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
  }

  // For horizontal layouts (LR/RL), prefer left/right connections
  if (Math.abs(dx) > 10) {
    // Significant horizontal difference
    return dx > 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
  }
  // Nearly same level - use vertical
  return dy > 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}

/**
 * Compute a self-loop path for edges where from === to.
 * Uses a compact outside lane from the top-center port to the right-center port.
 */
function computeSelfLoopPath(
  node: ComputedNode,
  loopIndex: number = 0,
): { path: string; points: Array<{ x: number; y: number }> } {
  const topY = node.y;
  const baseRadius = Math.max(Math.min(node.width, node.height) * 0.4, 28);
  const indexOffset = loopIndex * 12;
  const laneY = topY - baseRadius - indexOffset;
  const laneX = node.x + node.width + baseRadius + indexOffset;
  const start = { x: node.x + node.width / 2, y: topY };
  const end = { x: node.x + node.width, y: node.y + node.height / 2 };

  const points = [
    start,
    { x: start.x, y: laneY },
    { x: laneX, y: laneY },
    { x: laneX, y: end.y },
    end,
  ];

  return { path: buildRoundedOrthogonalPath(points), points };
}

/**
 * Compute group bounds
 */
function computeGroupBounds(groups: DiagramGroup[], nodes: ComputedNode[]): ComputedGroup[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return groups.map((group) => {
    // Get nodes from group.nodeIds if present
    const nodeIds = Array.isArray(group.nodeIds) ? [...group.nodeIds] : [];
    // Also include nodes that have this group as their group property
    nodes.forEach((n) => {
      if (n.group === group.id && !nodeIds.includes(n.id)) {
        nodeIds.push(n.id);
      }
    });
    const groupNodes = nodeIds.map((id) => nodeMap.get(id)).filter(Boolean) as ComputedNode[];

    if (groupNodes.length === 0) {
      return { ...group, x: 0, y: 0, width: 0, height: 0 };
    }

    const minX = Math.min(...groupNodes.map((n) => n.x));
    const minY = Math.min(...groupNodes.map((n) => n.y));
    const maxX = Math.max(...groupNodes.map((n) => n.x + n.width));
    const maxY = Math.max(...groupNodes.map((n) => n.y + n.height));

    const paddingX = 30;
    const paddingTop = 52;
    const paddingBottom = 30;

    return {
      ...group,
      x: minX - paddingX,
      y: minY - paddingTop,
      width: maxX - minX + paddingX * 2,
      height: maxY - minY + paddingTop + paddingBottom,
    };
  });
}

/**
 * Compute overall bounds (including nodes, groups, and edge points)
 */
function computeBounds(nodes: ComputedNode[], groups?: ComputedGroup[], edges?: ComputedEdge[]) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Math.min(...nodes.map((n) => n.x));
  let minY = Math.min(...nodes.map((n) => n.y));
  let maxX = Math.max(...nodes.map((n) => n.x + n.width));
  let maxY = Math.max(...nodes.map((n) => n.y + n.height));

  // Include groups in bounds calculation
  if (groups && groups.length > 0) {
    minX = Math.min(minX, ...groups.map((g) => g.x));
    minY = Math.min(minY, ...groups.map((g) => g.y));
    maxX = Math.max(maxX, ...groups.map((g) => g.x + g.width));
    maxY = Math.max(maxY, ...groups.map((g) => g.y + g.height));
  }

  // Include edge points in bounds calculation (for routing tracks)
  if (edges && edges.length > 0) {
    for (const edge of edges) {
      if (edge.points) {
        for (const point of edge.points) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
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
