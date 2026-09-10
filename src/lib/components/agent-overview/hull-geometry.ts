import { curveLinearClosed, line, polygonHull } from 'd3';

export type HullPoint = [number, number];

export interface HullMember {
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export interface KeyedHullMember extends HullMember {
  id: string;
}

export const HULL_PADDING = 18;
export const HULL_SOFT_PADDING = 25;
export const TWO_MEMBER_HULL_PADDING = 16;
export const HULL_FILL_OPACITIES = {
  dimmed: 0.012,
  focusedWorking: 0.12,
  focusedIdle: 0.06,
  working: 0.09,
  idle: 0.035,
  softenerRatio: 0.34,
} as const;
const HULL_CORNER_STEPS = 4;
const HULL_SAMPLES = 16;
const ENCLOSURE_EPSILON = 1;
const HULL_DIRECTIONS = Array.from({ length: HULL_SAMPLES }, (_, index) => {
  const angle = (index / HULL_SAMPLES) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});

interface CircularHullMember {
  x: number;
  y: number;
  radius: number;
}

function paddedCircle(member: CircularHullMember, padding: number): HullPoint[] {
  const radius = (member.radius + padding) / Math.cos(Math.PI / HULL_SAMPLES) + ENCLOSURE_EPSILON;
  return HULL_DIRECTIONS.map((direction): HullPoint => [
    member.x + direction.x * radius,
    member.y + direction.y * radius,
  ]);
}

function paddedRoundedRectangle(member: HullMember, padding: number): HullPoint[] {
  const centerX = member.x + member.offsetX;
  const centerY = member.y + member.offsetY;
  const halfWidth = member.width / 2;
  const halfHeight = member.height / 2;
  const cornerRadius = padding + ENCLOSURE_EPSILON;
  const corners = [
    { x: halfWidth, y: -halfHeight, startAngle: -Math.PI / 2 },
    { x: halfWidth, y: halfHeight, startAngle: 0 },
    { x: -halfWidth, y: halfHeight, startAngle: Math.PI / 2 },
    { x: -halfWidth, y: -halfHeight, startAngle: Math.PI },
  ];
  return corners.flatMap((corner) =>
    Array.from({ length: HULL_CORNER_STEPS + 1 }, (_, index): HullPoint => {
      const angle = corner.startAngle + (index / HULL_CORNER_STEPS) * (Math.PI / 2);
      return [
        centerX + corner.x + Math.cos(angle) * cornerRadius,
        centerY + corner.y + Math.sin(angle) * cornerRadius,
      ];
    }),
  );
}

function paddedShape(member: HullMember | CircularHullMember, padding: number): HullPoint[] {
  return 'width' in member
    ? paddedRoundedRectangle(member, padding)
    : paddedCircle(member, padding);
}

export function taskHullPadding(memberCount: number, padding = HULL_PADDING): number {
  return memberCount === 2 ? Math.min(padding, TWO_MEMBER_HULL_PADDING) : padding;
}

/** Returns a convex outline around rounded, rectangularly padded graph members. */
export function paddedHull(
  members: Array<HullMember | CircularHullMember>,
  padding = HULL_PADDING,
): HullPoint[] | null {
  if (members.length === 0) return null;
  if (members.length === 1) return paddedShape(members[0], padding);

  const paddedPoints = members.flatMap((member) => paddedShape(member, padding));
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
      const collapsed = { id, ...anchor, width: 0, height: 0, offsetX: 0, offsetY: 0 };
      const from = previousMember ?? collapsed;
      const to = nextMember ?? collapsed;
      return {
        id,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        width: from.width + (to.width - from.width) * t,
        height: from.height + (to.height - from.height) * t,
        offsetX: from.offsetX + (to.offsetX - from.offsetX) * t,
        offsetY: from.offsetY + (to.offsetY - from.offsetY) * t,
      };
    });
}

const closedHullLine = line<HullPoint>()
  .x((point) => point[0])
  .y((point) => point[1])
  .curve(curveLinearClosed);

/** Produces a stable closed SVG path that preserves straight hull edges. */
export function smoothClosedHullPath(hull: HullPoint[] | null): string | null {
  if (!hull || hull.length < 3) return null;
  const path = closedHullLine(hull);
  return path ? `${path}Z` : null;
}
