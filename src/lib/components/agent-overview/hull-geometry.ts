import { curveCatmullRomClosed, line, polygonHull } from 'd3';

export type HullPoint = [number, number];

export interface HullMember {
  x: number;
  y: number;
  radius: number;
}

export interface KeyedHullMember extends HullMember {
  id: string;
}

export const HULL_PADDING = 18;
export const HULL_FILL_OPACITIES = {
  dimmed: 0.006,
  focusedWorking: 0.05,
  focusedIdle: 0.0375,
  working: 0.04,
  idle: 0.0275,
  softenerRatio: 0.34,
} as const;
const HULL_SAMPLES = 16;
const ENCLOSURE_EPSILON = 1;
const HULL_DIRECTIONS = Array.from({ length: HULL_SAMPLES }, (_, index) => {
  const angle = (index / HULL_SAMPLES) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});

function paddedCircle(member: HullMember, padding: number): HullPoint[] {
  const radius = (member.radius + padding) / Math.cos(Math.PI / HULL_SAMPLES) + ENCLOSURE_EPSILON;
  return HULL_DIRECTIONS.map((direction): HullPoint => [
    member.x + direction.x * radius,
    member.y + direction.y * radius,
  ]);
}

/** Returns a convex outline around circularly padded graph members. */
export function paddedHull(members: HullMember[], padding = HULL_PADDING): HullPoint[] | null {
  if (members.length === 0) return null;
  if (members.length === 1) return paddedCircle(members[0], padding);

  const paddedPoints = members.flatMap((member) => paddedCircle(member, padding));
  return polygonHull(paddedPoints) ?? null;
}

/** Interpolates membership changes through the task anchor instead of snapping the outline. */
export function interpolateHullMembers(
  previous: KeyedHullMember[],
  next: KeyedHullMember[],
  anchor: Pick<HullMember, 'x' | 'y'>,
  progress: number,
): KeyedHullMember[] {
  const t = Math.min(1, Math.max(0, progress));
  const previousById = new Map(previous.map((member) => [member.id, member]));
  const nextById = new Map(next.map((member) => [member.id, member]));
  const ids = [
    ...previousById.keys(),
    ...[...nextById.keys()].filter((id) => !previousById.has(id)),
  ];

  return ids
    .filter((id) => t < 1 || nextById.has(id))
    .map((id) => {
      const previousMember = previousById.get(id);
      const nextMember = nextById.get(id);
      const from = previousMember ?? { id, ...anchor, radius: 0 };
      const to = nextMember ?? { id, ...anchor, radius: 0 };
      return {
        id,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        radius: from.radius + (to.radius - from.radius) * t,
      };
    });
}

const closedHullLine = line<HullPoint>()
  .x((point) => point[0])
  .y((point) => point[1])
  .curve(curveCatmullRomClosed.alpha(0.5));

/** Produces an organic closed SVG path from a hull polygon. */
export function smoothClosedHullPath(hull: HullPoint[] | null): string | null {
  if (!hull || hull.length < 3) return null;
  const path = closedHullLine(hull);
  return path ? `${path}Z` : null;
}
