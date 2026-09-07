import { curveCatmullRomClosed, line, polygonHull } from 'd3';

export type HullPoint = [number, number];

export interface HullMember {
  x: number;
  y: number;
  radius: number;
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

function paddedCircle(member: HullMember, padding: number): HullPoint[] {
  const radius = (member.radius + padding) / Math.cos(Math.PI / HULL_SAMPLES) + ENCLOSURE_EPSILON;
  return Array.from({ length: HULL_SAMPLES }, (_, index): HullPoint => {
    const angle = (index / HULL_SAMPLES) * Math.PI * 2;
    return [member.x + Math.cos(angle) * radius, member.y + Math.sin(angle) * radius];
  });
}

/** Returns a convex outline around circularly padded graph members. */
export function paddedHull(members: HullMember[], padding = HULL_PADDING): HullPoint[] | null {
  if (members.length === 0) return null;
  if (members.length === 1) return paddedCircle(members[0], padding);

  const paddedPoints = members.flatMap((member) => paddedCircle(member, padding));
  return polygonHull(paddedPoints) ?? null;
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
