type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export function shapeOutline(shape: SVGGraphicsElement, box: Box, inverse: DOMMatrix): Point[] {
  const geometries =
    shape instanceof SVGGeometryElement
      ? [shape]
      : [
          ...shape.querySelectorAll<SVGGeometryElement>(
            'path,polygon,polyline,circle,ellipse,rect',
          ),
        ];
  const points = geometries
    .flatMap((geometry) => {
      const matrix = geometry.getScreenCTM();
      if (!matrix) return [];
      const length = geometry.getTotalLength();
      const count = Math.max(16, Math.min(256, Math.ceil(length / 24) * 4));
      const samples =
        geometry instanceof SVGPolygonElement || geometry instanceof SVGPolylineElement
          ? Array.from({ length: geometry.points.numberOfItems }, (_, i) =>
              geometry.points.getItem(i),
            )
          : Array.from({ length: count }, (_, i) =>
              geometry.getPointAtLength((length * i) / count),
            );
      return samples.map((p) => {
        const world = new DOMPoint(p.x, p.y).matrixTransform(matrix).matrixTransform(inverse);
        return { x: world.x - box.x, y: world.y - box.y };
      });
    })
    .toSorted((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, all) => !i || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 0.001);
  if (points.length < 3)
    return [
      { x: 0, y: 0 },
      { x: box.width, y: 0 },
      { x: box.width, y: box.height },
      { x: 0, y: box.height },
    ];
  const half = (ordered: Point[]) => {
    const hull: Point[] = [];
    for (const p of ordered) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0)
        hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  const hull = [...half(points), ...half([...points].reverse())];
  const native = geometries.flatMap((geometry) => {
    const matrix = geometry.getScreenCTM();
    return matrix ? [{ geometry, inverse: matrix.inverse().multiply(inverse.inverse()) }] : [];
  });
  // A convex hull is safe for avoidance, but a bridge across a concavity would
  // leave a new port floating in empty space. Keep those native routes intact.
  const filled = (p: Point) =>
    native.some(({ geometry, inverse }) =>
      geometry.isPointInFill(new DOMPoint(box.x + p.x, box.y + p.y).matrixTransform(inverse)),
    );
  const c = { x: box.width / 2, y: box.height / 2 };
  if (
    hull.some((a, i) => {
      const b = hull[(i + 1) % hull.length];
      return [0.25, 0.5, 0.75].some((t) => {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const size = Math.hypot(c.x - p.x, c.y - p.y) || 1;
        return !filled({
          x: p.x + ((c.x - p.x) / size) * 0.1,
          y: p.y + ((c.y - p.y) / size) * 0.1,
        });
      });
    })
  )
    return [];
  return hull;
}

export function shapePort(box: Box, outline: Point[], nominal: Point): [Point, Point] {
  const center = { x: box.width / 2, y: box.height / 2 };
  const ray = { x: nominal.x - box.x - center.x, y: nominal.y - box.y - center.y };
  let at = -Infinity;
  let normal = { x: 0, y: 0 };
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i],
      b = outline[(i + 1) % outline.length],
      edge = { x: b.x - a.x, y: b.y - a.y };
    const det = ray.x * edge.y - ray.y * edge.x;
    if (Math.abs(det) < 0.000001) continue;
    const d = { x: a.x - center.x, y: a.y - center.y };
    const t = (d.x * edge.y - d.y * edge.x) / det;
    const u = (d.x * ray.y - d.y * ray.x) / det;
    if (t < 0 || u < -0.00001 || u > 1.00001 || t < at - 0.00001) continue;
    const size = Math.hypot(edge.x, edge.y);
    const n = { x: edge.y / size, y: -edge.x / size };
    if (Math.abs(t - at) < 0.00001) {
      normal.x += n.x;
      normal.y += n.y;
    } else {
      at = t;
      normal = n;
    }
  }
  if (!Number.isFinite(at) || Math.hypot(normal.x, normal.y) < 0.001) {
    const size = Math.hypot(ray.x, ray.y) || 1;
    return [nominal, { x: nominal.x + (ray.x / size) * 32, y: nominal.y + (ray.y / size) * 32 }];
  }
  const size = Math.hypot(normal.x, normal.y);
  const point = {
    x: box.x + center.x + ray.x * at + (normal.x / size) * 0.05,
    y: box.y + center.y + ray.y * at + (normal.y / size) * 0.05,
  };
  return [point, { x: point.x + (normal.x / size) * 32, y: point.y + (normal.y / size) * 32 }];
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function hitsShape(points: Point[], box: Box, outline: Point[], padding: number): boolean {
  const local = points.map((p) => ({ x: p.x - box.x, y: p.y - box.y }));
  const contains = (p: Point) =>
    outline.every((a, i) => cross(a, outline[(i + 1) % outline.length], p) >= 0);
  for (let i = 1; i < local.length; i++) {
    const a = local[i - 1],
      b = local[i];
    if (
      Math.max(a.x, b.x) < -Math.max(0, padding) ||
      Math.min(a.x, b.x) > box.width + Math.max(0, padding) ||
      Math.max(a.y, b.y) < -Math.max(0, padding) ||
      Math.min(a.y, b.y) > box.height + Math.max(0, padding)
    )
      continue;
    for (const p of [a, b]) {
      if (
        contains(p) &&
        outline.every(
          (c, j) => distanceToSegment(p, c, outline[(j + 1) % outline.length]) > -padding,
        )
      )
        return true;
    }
    for (let j = 0; j < outline.length; j++) {
      const c = outline[j],
        d = outline[(j + 1) % outline.length];
      if (
        cross(a, b, c) * cross(a, b, d) < -0.000001 &&
        cross(c, d, a) * cross(c, d, b) < -0.000001
      )
        return true;
      if (
        padding > 0 &&
        Math.min(
          distanceToSegment(a, c, d),
          distanceToSegment(b, c, d),
          distanceToSegment(c, a, b),
          distanceToSegment(d, a, b),
        ) < padding
      )
        return true;
    }
  }
  return false;
}
