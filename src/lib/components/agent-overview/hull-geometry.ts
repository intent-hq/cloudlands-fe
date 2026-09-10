import { contours, curveBasisClosed, line, polygonArea, polygonHull } from 'd3';

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
const MAX_CONTOUR_GRID_EDGE = 80;
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

function memberCenter(member: HullMember): HullPoint {
  return [member.x + member.offsetX, member.y + member.offsetY];
}

function distanceToRectangle(
  x: number,
  y: number,
  center: HullPoint,
  halfWidth: number,
  halfHeight: number,
): number {
  const dx = Math.max(Math.abs(x - center[0]) - halfWidth, 0);
  const dy = Math.max(Math.abs(y - center[1]) - halfHeight, 0);
  return Math.hypot(dx, dy);
}

function distanceToSegment(x: number, y: number, from: HullPoint, to: HullPoint): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - from[0]) * dx + (y - from[1]) * dy) / lengthSquared));
  return Math.hypot(x - (from[0] + dx * t), y - (from[1] + dy * t));
}

function resampleRing(ring: HullPoint[], count: number): HullPoint[] {
  const points =
    ring.length > 1 && ring[0][0] === ring.at(-1)?.[0] && ring[0][1] === ring.at(-1)?.[1]
      ? ring.slice(0, -1)
      : ring;
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return { point, next, length: Math.hypot(next[0] - point[0], next[1] - point[1]) };
  });
  const fallbackSegment = segments.at(-1);
  if (!fallbackSegment) return [];
  const perimeter = segments.reduce((sum, segment) => sum + segment.length, 0);
  return Array.from({ length: count }, (_, index) => {
    let distance = (perimeter * index) / count;
    const segment =
      segments.find((candidate) => {
        if (distance <= candidate.length) return true;
        distance -= candidate.length;
        return false;
      }) ?? fallbackSegment;
    const t = segment.length === 0 ? 0 : distance / segment.length;
    return [
      segment.point[0] + (segment.next[0] - segment.point[0]) * t,
      segment.point[1] + (segment.next[1] - segment.point[1]) * t,
    ];
  });
}

function contourRing(
  members: HullMember[],
  padding: number,
  bridgeRadius: number,
): { polygonCount: number; ring: HullPoint[] } | null {
  const centers = members.map(memberCenter);
  const baseMinX = Math.min(
    ...members.map((member, index) => centers[index][0] - member.width / 2),
  );
  const baseMaxX = Math.max(
    ...members.map((member, index) => centers[index][0] + member.width / 2),
  );
  const baseMinY = Math.min(
    ...members.map((member, index) => centers[index][1] - member.height / 2),
  );
  const baseMaxY = Math.max(
    ...members.map((member, index) => centers[index][1] + member.height / 2),
  );
  let cellSize = Math.max(1, padding / 2);
  for (let index = 0; index < 2; index += 1) {
    const extent = padding + cellSize * 1.8;
    cellSize = Math.max(
      Math.max(1, padding / 2),
      (baseMaxX - baseMinX + extent * 2) / (MAX_CONTOUR_GRID_EDGE - 1),
      (baseMaxY - baseMinY + extent * 2) / (MAX_CONTOUR_GRID_EDGE - 1),
    );
  }
  const slack = Math.max(2, cellSize);
  const extent = padding + slack + cellSize;
  const originX = baseMinX - extent;
  const originY = baseMinY - extent;
  const columns = Math.ceil((baseMaxX - baseMinX + extent * 2) / cellSize) + 1;
  const rows = Math.ceil((baseMaxY - baseMinY + extent * 2) / cellSize) + 1;
  const anchor = centers[0];
  const halfSizes = members.map((member) => [member.width / 2, member.height / 2] as const);
  const values = new Array<number>(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    const y = originY + row * cellSize;
    for (let column = 0; column < columns; column += 1) {
      const x = originX + column * cellSize;
      let memberDistance = Number.POSITIVE_INFINITY;
      let bridgeDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < members.length; index += 1) {
        const [halfWidth, halfHeight] = halfSizes[index];
        memberDistance = Math.min(
          memberDistance,
          distanceToRectangle(x, y, centers[index], halfWidth, halfHeight),
        );
        if (index > 0) {
          bridgeDistance = Math.min(
            bridgeDistance,
            distanceToSegment(x, y, anchor, centers[index]) - bridgeRadius,
          );
        }
      }
      values[row * columns + column] = padding + slack - Math.min(memberDistance, bridgeDistance);
    }
  }
  const geometry = contours().size([columns, rows]).thresholds([0])(values)[0];
  const rings: HullPoint[][] =
    geometry?.coordinates.flatMap((polygon) => {
      const ring = polygon[0];
      return ring ? [ring.map((point): HullPoint => [point[0], point[1]])] : [];
    }) ?? [];
  const ring = rings.toSorted(
    (left, right) => Math.abs(polygonArea(right)) - Math.abs(polygonArea(left)),
  )[0];
  if (!ring) return null;
  return {
    polygonCount: geometry.coordinates.length,
    ring: ring.map(([x, y]) => [originX + x * cellSize, originY + y * cellSize]),
  };
}

/** Returns one smooth, concave sticker outline joined through the first member. */
export function organicHull(members: HullMember[], padding = HULL_PADDING): HullPoint[] | null {
  if (members.length === 0) return null;
  const safePadding = Math.max(1, padding);
  let result: ReturnType<typeof contourRing> = null;
  for (const ratio of [0.22, 0.5, 1]) {
    result = contourRing(members, safePadding, Math.max(2, safePadding * ratio));
    if (result?.polygonCount === 1) break;
  }
  if (!result) return null;
  return resampleRing(result.ring, Math.min(32, Math.max(24, members.length * 8)));
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
  .curve(curveBasisClosed);

/** Produces a smooth, continuously curved closed SVG path. */
export function smoothClosedHullPath(hull: HullPoint[] | null): string | null {
  if (!hull || hull.length < 3) return null;
  const path = closedHullLine(hull);
  return path ? `${path}Z` : null;
}
