import type { RegionGeometry } from '../layout/place';
import type { RouteEdge } from './types';

interface PathTarget {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
}

export function traceHull(target: PathTarget, hull: [number, number][]): void {
  if (hull.length === 0) return;
  target.moveTo(hull[0][0], hull[0][1]);
  for (let index = 1; index < hull.length; index += 1) {
    target.lineTo(hull[index][0], hull[index][1]);
  }
  target.closePath();
}

function traceRoute(target: PathTarget, edge: RouteEdge): void {
  target.moveTo(edge.startX, edge.startY);
  target.quadraticCurveTo(edge.controlX, edge.controlY, edge.endX, edge.endY);
}

function hullKey(geometry: RegionGeometry[]): string {
  return geometry
    .map(({ id, hull }) => `${id}:${hull.map(([x, y]) => `${x},${y}`).join(';')}`)
    .join('|');
}

function routeKey(edges: RouteEdge[]): string {
  return edges
    .map(({ startX, startY, controlX, controlY, endX, endY }) =>
      [startX, startY, controlX, controlY, endX, endY].join(','),
    )
    .join('|');
}

export class CanvasPathCache {
  hulls = new Map<string, Path2D>();
  routes: Path2D[] = [];
  private hullGeometryKey = '';
  private routeGeometryKey = '';

  constructor(private readonly createPath: () => Path2D = () => new Path2D()) {}

  update(geometry: RegionGeometry[], edges: RouteEdge[]): void {
    const nextHullKey = hullKey(geometry);
    if (nextHullKey !== this.hullGeometryKey) {
      this.hullGeometryKey = nextHullKey;
      this.hulls = new Map(
        geometry.map((region) => {
          const path = this.createPath();
          traceHull(path, region.hull);
          return [region.id, path];
        }),
      );
    }
    const nextRouteKey = routeKey(edges);
    if (nextRouteKey !== this.routeGeometryKey) {
      this.routeGeometryKey = nextRouteKey;
      this.routes = edges.map((edge) => {
        const path = this.createPath();
        traceRoute(path, edge);
        return path;
      });
    }
  }
}

export function cacheHullPaths(geometry: RegionGeometry[]): Map<string, Path2D> {
  return new Map(
    geometry.map((region) => {
      const path = new Path2D();
      traceHull(path, region.hull);
      return [region.id, path];
    }),
  );
}

export function drawQuadraticPath(
  ctx: CanvasRenderingContext2D,
  edge: {
    startX: number;
    startY: number;
    controlX: number;
    controlY: number;
    endX: number;
    endY: number;
  },
): void {
  ctx.beginPath();
  traceRoute(ctx, edge as RouteEdge);
}
