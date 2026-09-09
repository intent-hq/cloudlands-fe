import { GRAPH_FIT_PADDING } from './constants';
import type { GraphNode } from './types';

export interface FitBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

interface GraphPosition {
  x: number;
  y: number;
}

export const NODE_SCREEN_MARGINS: Record<
  GraphNode['type'],
  { top: number; right: number; bottom: number; left: number }
> = {
  agent: { top: 32, right: 64, bottom: 52, left: 64 },
  task: { top: 78, right: 78, bottom: 78, left: 78 },
  file: { top: 32, right: 56, bottom: 40, left: 56 },
  note: { top: 32, right: 56, bottom: 40, left: 56 },
};

/** Bounds from layout anchors and constant screen-space node margins. */
export function anchorFitBounds(
  nodes: GraphNode[],
  positions: ReadonlyMap<string, GraphPosition>,
  candidateScale: number,
): FitBounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  const scale = Math.max(0.01, candidateScale);
  const bounds = nodes.reduce(
    (result, node) => {
      const position = positions.get(node.id) ?? node;
      const margin = NODE_SCREEN_MARGINS[node.type];
      result.minX = Math.min(result.minX, position.x - margin.left / scale);
      result.minY = Math.min(result.minY, position.y - margin.top / scale);
      result.maxX = Math.max(result.maxX, position.x + margin.right / scale);
      result.maxY = Math.max(result.maxY, position.y + margin.bottom / scale);
      return result;
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  return {
    ...bounds,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

/** Largest scale that contains the padded graph inside the available viewport. */
export function containedFitScale(
  bounds: FitBounds,
  availableWidth: number,
  availableHeight: number,
  maximumScale: number,
): number {
  return Math.min(
    maximumScale,
    Math.max(1, availableWidth - GRAPH_FIT_PADDING * 2) / Math.max(1, bounds.width),
    Math.max(1, availableHeight - GRAPH_FIT_PADDING * 2) / Math.max(1, bounds.height),
  );
}

/** Largest scale whose anchor bounds, including fixed screen margins, stay contained. */
export function containedAnchorFitScale(
  nodes: GraphNode[],
  positions: ReadonlyMap<string, GraphPosition>,
  availableWidth: number,
  availableHeight: number,
  maximumScale: number,
): number {
  let lower = 0;
  let upper = maximumScale;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const candidate = (lower + upper) / 2;
    const bounds = anchorFitBounds(nodes, positions, candidate);
    const contained =
      bounds.width * candidate + GRAPH_FIT_PADDING * 2 <= availableWidth &&
      bounds.height * candidate + GRAPH_FIT_PADDING * 2 <= availableHeight;
    if (contained) lower = candidate;
    else upper = candidate;
  }
  return lower;
}
