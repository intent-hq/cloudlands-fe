import type { MapActivity } from '../core/types';
import { drawQuadraticPath } from './canvas';
import { routeEdgePresentation } from './scene';
import type { RouteEdge, SemanticMapSelection } from './types';

interface ComparisonRouteOptions {
  selection: SemanticMapSelection;
  hoveredEdgeIndex: number | null;
  keyboardEdgeIndex: number | null;
  paths: Array<Path2D | undefined>;
  scale: number;
  accent: string;
  background: string;
  foreground: string;
}

export const SHARED_REGION_FILL_ALPHA = 0.08;

function strokeRoute(
  ctx: CanvasRenderingContext2D,
  path: Path2D | undefined,
  edge: RouteEdge,
): void {
  if (path) ctx.stroke(path);
  else {
    drawQuadraticPath(ctx, edge);
    ctx.stroke();
  }
}

export function drawComparisonRoutes(
  ctx: CanvasRenderingContext2D,
  edges: RouteEdge[],
  options: ComparisonRouteOptions,
): void {
  edges.forEach((edge, index) => {
    const presentation = routeEdgePresentation(
      edge,
      options.selection,
      options.hoveredEdgeIndex === index,
    );
    const selected =
      options.selection?.type === 'route' &&
      options.selection.transitionIndex === edge.transitionIndex &&
      options.selection.agentId === edge.agentId;
    const routeColor = selected ? options.accent : edge.color;
    const path = options.paths[index];
    ctx.save();
    ctx.globalAlpha = presentation.opacity;
    ctx.strokeStyle = options.foreground;
    ctx.lineWidth = (4 + Math.sqrt(Math.max(1, edge.count))) / options.scale;
    strokeRoute(ctx, path, edge);
    ctx.strokeStyle = routeColor;
    ctx.fillStyle = routeColor;
    ctx.lineWidth = (1.5 + Math.sqrt(Math.max(1, edge.count))) / options.scale;
    strokeRoute(ctx, path, edge);
    const arrowSize = 7 / options.scale;
    ctx.translate(edge.arrowX, edge.arrowY);
    ctx.rotate(edge.arrowAngle);
    ctx.beginPath();
    ctx.moveTo(arrowSize, 0);
    ctx.lineTo(-arrowSize, arrowSize * 0.62);
    ctx.lineTo(-arrowSize, -arrowSize * 0.62);
    ctx.closePath();
    ctx.strokeStyle = options.foreground;
    ctx.lineWidth = 2.5 / options.scale;
    ctx.stroke();
    ctx.fill();
    ctx.rotate(-edge.arrowAngle);
    ctx.translate(-edge.arrowX, -edge.arrowY);
    if (options.keyboardEdgeIndex === index) {
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.strokeStyle = options.background;
      ctx.lineWidth = 8 / options.scale;
      strokeRoute(ctx, path, edge);
      ctx.strokeStyle = options.accent;
      ctx.lineWidth = 2 / options.scale;
      ctx.setLineDash([4 / options.scale, 3 / options.scale]);
      strokeRoute(ctx, path, edge);
    }
    ctx.restore();
  });
}

export function drawSharedRegionHighlight(
  ctx: CanvasRenderingContext2D,
  path: Path2D | undefined,
  scale: number,
  foreground: string,
  fill: boolean,
): void {
  ctx.save();
  if (fill) {
    ctx.globalAlpha = SHARED_REGION_FILL_ALPHA;
    ctx.fillStyle = foreground;
    if (path) ctx.fill(path);
    else ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = foreground;
  ctx.lineWidth = 2 / scale;
  if (path) ctx.stroke(path);
  else ctx.stroke();
  ctx.restore();
}

export function latestEvidenceAction(
  activities: MapActivity[],
  selectedAgentIds: ReadonlySet<string>,
  agentId?: string,
  regionId?: string,
): { type: 'diff' | 'file'; path: string } | null {
  const candidates = activities
    .filter(
      (activity) =>
        activity.path &&
        (!agentId || activity.agentId === agentId) &&
        (selectedAgentIds.size === 0 ||
          !activity.agentId ||
          selectedAgentIds.has(activity.agentId)) &&
        (!regionId || activity.regionId === regionId),
    )
    .toSorted((left, right) => Date.parse(right.ts) - Date.parse(left.ts));
  const mutation = candidates.find(({ kind }) =>
    ['edit', 'create', 'delete', 'move'].includes(kind),
  );
  if (mutation?.path) return { type: 'diff', path: mutation.path };
  return candidates[0]?.path ? { type: 'file', path: candidates[0].path } : null;
}
