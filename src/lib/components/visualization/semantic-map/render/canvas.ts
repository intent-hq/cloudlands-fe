import type { RegionGeometry } from '../layout/place';

export function traceHull(
  target: CanvasRenderingContext2D | Path2D,
  hull: [number, number][],
): void {
  if (hull.length === 0) return;
  target.moveTo(hull[0][0], hull[0][1]);
  for (let index = 1; index < hull.length; index += 1) {
    target.lineTo(hull[index][0], hull[index][1]);
  }
  target.closePath();
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
  ctx.moveTo(edge.startX, edge.startY);
  ctx.quadraticCurveTo(edge.controlX, edge.controlY, edge.endX, edge.endY);
}
