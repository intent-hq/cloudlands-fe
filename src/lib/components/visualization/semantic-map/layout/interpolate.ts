import type { RegionGeometry } from './place';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const INTERPOLATED_HULL_POINT_COUNT = 96;

function resampleHull(hull: [number, number][], count: number): [number, number][] {
  if (hull.length === 0) return [];
  const lengths = hull.map(([x, y], index) => {
    const [nextX, nextY] = hull[(index + 1) % hull.length];
    return Math.hypot(nextX - x, nextY - y);
  });
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  if (perimeter === 0) return Array.from({ length: count }, () => [...hull[0]]);
  let edge = 0;
  let edgeStart = 0;
  return Array.from({ length: count }, (_, index) => {
    const distance = (index * perimeter) / count;
    while (edge < lengths.length - 1 && edgeStart + lengths[edge] < distance) {
      edgeStart += lengths[edge++];
    }
    const from = hull[edge];
    const to = hull[(edge + 1) % hull.length];
    const progress = lengths[edge] === 0 ? 0 : (distance - edgeStart) / lengths[edge];
    return [lerp(from[0], to[0], progress), lerp(from[1], to[1], progress)];
  });
}

function interpolateHull(
  a: [number, number][],
  b: [number, number][],
  t: number,
): [number, number][] {
  if (a.length === 0 && b.length === 0) return [];
  const count = INTERPOLATED_HULL_POINT_COUNT;
  const fromHull = resampleHull(a.length ? a : b, count);
  const toHull = resampleHull(b.length ? b : a, count);
  return Array.from({ length: count }, (_, index) => {
    const from = fromHull[index];
    const to = toHull[index];
    return [lerp(from[0], to[0], t), lerp(from[1], to[1], t)];
  });
}

export function lerpGeometry(a: RegionGeometry, b: RegionGeometry, t: number): RegionGeometry {
  const progress = Math.max(0, Math.min(1, t));
  if (progress === 0) return { ...a, hull: a.hull.map((point) => [...point]) };
  if (progress === 1) return { ...b, hull: b.hull.map((point) => [...point]) };
  return {
    id: b.id,
    x: lerp(a.x, b.x, progress),
    y: lerp(a.y, b.y, progress),
    labelX: lerp(a.labelX ?? a.x, b.labelX ?? b.x, progress),
    labelY: lerp(a.labelY ?? a.y, b.labelY ?? b.y, progress),
    radius: lerp(a.radius, b.radius, progress),
    budget: lerp(a.budget, b.budget, progress),
    hull: interpolateHull(a.hull, b.hull, progress),
  };
}

export function capFocusGeometry(
  rest: RegionGeometry[],
  focus: RegionGeometry[],
  focusedRegionIds: ReadonlySet<string>,
  maximumScale = 1.6,
): RegionGeometry[] {
  const restById = new Map(rest.map((region) => [region.id, region]));
  let progress = 1;
  for (const target of focus) {
    if (!focusedRegionIds.has(target.id)) continue;
    const start = restById.get(target.id);
    if (!start || target.radius <= start.radius * maximumScale) continue;
    progress = Math.min(
      progress,
      (start.radius * maximumScale - start.radius) / (target.radius - start.radius),
    );
  }
  return focus.map((target) => {
    const start = restById.get(target.id);
    return start ? lerpGeometry(start, target, progress) : target;
  });
}
