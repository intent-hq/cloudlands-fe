import type { RegionGeometry } from './place';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateHull(
  a: [number, number][],
  b: [number, number][],
  t: number,
): [number, number][] {
  const count = Math.max(a.length, b.length);
  if (count === 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const from = a[Math.floor((index * a.length) / count)] ?? b[index % b.length];
    const to = b[Math.floor((index * b.length) / count)] ?? a[index % a.length];
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
    radius: lerp(a.radius, b.radius, progress),
    budget: lerp(a.budget, b.budget, progress),
    hull: interpolateHull(a.hull, b.hull, progress),
  };
}
