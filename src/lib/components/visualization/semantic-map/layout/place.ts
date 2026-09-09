import {
  Delaunay,
  forceCollide,
  forceSimulation,
  forceX,
  forceY,
  polygonArea,
  polygonContains,
  type SimulationNodeDatum,
} from 'd3';
import type { Manifest, Region } from '../core/types';
import { computeBudget } from './budget';

const AREA_FRACTION = 0.62;
const NARROW_AREA_FRACTION = 0.5;
const MAX_RADIUS_FRACTION = 0.3;
export const COLLISION_GAP = 4;
const MINIMUM_SITES = 3;
const SITES_PER_REGION = 6;
const HULL_POINT_COUNT = 96;
const POINT_KEY_PRECISION = 100_000;
// Two 13px label lines with 3px leading and 4px block padding occupy 36px.
// A 30px radius leaves the requested 12px inset around that label block.
export const FOCUS_CONTEXT_MIN_RADIUS = 30;

export interface LayoutViewport {
  width: number;
  height: number;
}

export interface RegionGeometry {
  id: string;
  x: number;
  y: number;
  labelX?: number;
  labelY?: number;
  radius: number;
  budget: number;
  hull: [number, number][];
}

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  targetX: number;
  targetY: number;
  radius: number;
  budget: number;
}

interface SiteNode extends SimulationNodeDatum {
  regionIndex: number;
  targetX: number;
  targetY: number;
  collisionRadius: number;
}

type Point = [number, number];

interface BoundaryEdge {
  start: Point;
  end: Point;
}

function seededRandom(initialSeed = 0x6d2b79f5): () => number {
  let seed = initialSeed;
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashSeed(value: string): number {
  let seed = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    seed ^= value.charCodeAt(index);
    seed = Math.imul(seed, 16_777_619);
  }
  return seed >>> 0;
}

function radiusScale(budget: Record<string, number>, viewport: LayoutViewport): number {
  const areaFraction = viewport.width < viewport.height ? NARROW_AREA_FRACTION : AREA_FRACTION;
  const base = Math.sqrt((viewport.width * viewport.height * areaFraction) / Math.PI);
  const largest = Math.sqrt(Math.max(0, ...Object.values(budget)));
  const maximum = Math.min(viewport.width, viewport.height) * MAX_RADIUS_FRACTION;
  return largest === 0 ? 0 : Math.min(base, maximum / largest);
}

function createNode(
  region: Region,
  budget: Record<string, number>,
  viewport: LayoutViewport,
  scale: number,
): LayoutNode {
  const targetX = region.anchor[0] * viewport.width;
  const targetY = region.anchor[1] * viewport.height;
  const amount = Math.max(0, budget[region.id] ?? 0);
  return {
    id: region.id,
    x: targetX,
    y: targetY,
    targetX,
    targetY,
    radius: scale * Math.sqrt(amount),
    budget: amount,
  };
}

function allocateSiteCounts(nodes: LayoutNode[]): number[] {
  const total = Math.max(nodes.length * MINIMUM_SITES, nodes.length * SITES_PER_REGION);
  const remaining = total - nodes.length * MINIMUM_SITES;
  const budgetTotal = nodes.reduce((sum, node) => sum + node.budget, 0);
  const shares = nodes.map(
    (node) => remaining * (budgetTotal === 0 ? 1 / nodes.length : node.budget / budgetTotal),
  );
  const counts = shares.map((share) => MINIMUM_SITES + Math.floor(share));
  const remainder = total - counts.reduce((sum, count) => sum + count, 0);
  shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share), id: nodes[index].id }))
    .sort((left, right) => right.fraction - left.fraction || left.id.localeCompare(right.id))
    .slice(0, remainder)
    .forEach(({ index }) => (counts[index] += 1));
  return counts;
}

function createSites(nodes: LayoutNode[], viewport: LayoutViewport): SiteNode[] {
  const counts = allocateSiteCounts(nodes);
  const sites = nodes.flatMap((node, regionIndex) => {
    const count = counts[regionIndex];
    const random = seededRandom(hashSeed(node.id));
    const phase = random() * Math.PI * 2;
    const collisionRadius = Math.max(2, (node.radius / Math.sqrt(count)) * 0.48);
    return Array.from({ length: count }, (_, index): SiteNode => {
      const distance = index === 0 ? 0 : node.radius * 0.12 * Math.sqrt(index / count);
      const angle = phase + index * Math.PI * (3 - Math.sqrt(5)) + (random() - 0.5) * 0.18;
      const targetX = node.targetX + Math.cos(angle) * distance;
      const targetY = node.targetY + Math.sin(angle) * distance;
      return {
        regionIndex,
        x: targetX,
        y: targetY,
        targetX,
        targetY,
        collisionRadius,
        ...(index === 0 ? { fx: node.targetX, fy: node.targetY } : {}),
      };
    });
  });
  const simulation = forceSimulation(sites)
    .randomSource(seededRandom())
    .force('x', forceX<SiteNode>((site) => site.targetX).strength(0.42))
    .force('y', forceY<SiteNode>((site) => site.targetY).strength(0.42))
    .force(
      'collision',
      forceCollide<SiteNode>((site) => site.collisionRadius)
        .strength(1)
        .iterations(3),
    )
    .velocityDecay(0.7)
    .stop();
  for (let tick = 0; tick < 90; tick += 1) {
    simulation.tick();
    for (const site of sites) {
      site.x = Math.max(0, Math.min(viewport.width, site.x ?? site.targetX));
      site.y = Math.max(0, Math.min(viewport.height, site.y ?? site.targetY));
    }
  }
  return sites;
}

function pointKey([x, y]: Point): string {
  return `${Math.round(x * POINT_KEY_PRECISION)},${Math.round(y * POINT_KEY_PRECISION)}`;
}

function edgeKey(start: Point, end: Point): string {
  const left = pointKey(start);
  const right = pointKey(end);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function boundaryRings(cells: Point[][]): Point[][] {
  const edges = new Map<string, BoundaryEdge>();
  for (const cell of cells) {
    const points =
      cell.length > 1 && pointKey(cell[0]) === pointKey(cell.at(-1)!) ? cell.slice(0, -1) : cell;
    for (let index = 0; index < points.length; index += 1) {
      const edge = { start: points[index], end: points[(index + 1) % points.length] };
      const key = edgeKey(edge.start, edge.end);
      if (edges.has(key)) edges.delete(key);
      else edges.set(key, edge);
    }
  }
  const unused = new Map(edges);
  const rings: Point[][] = [];
  while (unused.size > 0) {
    const [firstKey, first] = unused.entries().next().value as [string, BoundaryEdge];
    unused.delete(firstKey);
    const ring = [first.start];
    let current = first.end;
    while (pointKey(current) !== pointKey(ring[0]) && unused.size > 0) {
      ring.push(current);
      const currentKey = pointKey(current);
      const match = [...unused].find(
        ([, edge]) => pointKey(edge.start) === currentKey || pointKey(edge.end) === currentKey,
      );
      if (!match) break;
      unused.delete(match[0]);
      current = pointKey(match[1].start) === currentKey ? match[1].end : match[1].start;
    }
    if (ring.length >= 3 && pointKey(current) === pointKey(ring[0])) rings.push(ring);
  }
  return rings;
}

function isLandEdge(start: Point, end: Point, viewport: LayoutViewport): boolean {
  const epsilon = 0.001;
  return (
    (Math.abs(start[0]) < epsilon && Math.abs(end[0]) < epsilon) ||
    (Math.abs(start[1]) < epsilon && Math.abs(end[1]) < epsilon) ||
    (Math.abs(start[0] - viewport.width) < epsilon &&
      Math.abs(end[0] - viewport.width) < epsilon) ||
    (Math.abs(start[1] - viewport.height) < epsilon && Math.abs(end[1] - viewport.height) < epsilon)
  );
}

function lineIntersection(
  originA: Point,
  directionA: Point,
  originB: Point,
  directionB: Point,
): Point {
  const cross = directionA[0] * directionB[1] - directionA[1] * directionB[0];
  if (Math.abs(cross) < 1e-8) return [(originA[0] + originB[0]) / 2, (originA[1] + originB[1]) / 2];
  const dx = originB[0] - originA[0];
  const dy = originB[1] - originA[1];
  const t = (dx * directionB[1] - dy * directionB[0]) / cross;
  return [originA[0] + directionA[0] * t, originA[1] + directionA[1] * t];
}

function signedPolygonArea(ring: Point[]): number {
  return (
    ring.reduce((sum, [x, y], index) => {
      const [nextX, nextY] = ring[(index + 1) % ring.length];
      return sum + x * nextY - nextX * y;
    }, 0) / 2
  );
}

function insetRing(ring: Point[], viewport: LayoutViewport): Point[] {
  const orientation = Math.sign(signedPolygonArea(ring)) || 1;
  const inset = (COLLISION_GAP + 0.1) / 2;
  return ring.map((point, index) => {
    const previous = ring[(index - 1 + ring.length) % ring.length];
    const next = ring[(index + 1) % ring.length];
    const previousLength = Math.max(
      1e-8,
      Math.hypot(point[0] - previous[0], point[1] - previous[1]),
    );
    const nextLength = Math.max(1e-8, Math.hypot(next[0] - point[0], next[1] - point[1]));
    const previousDirection: Point = [
      (point[0] - previous[0]) / previousLength,
      (point[1] - previous[1]) / previousLength,
    ];
    const nextDirection: Point = [
      (next[0] - point[0]) / nextLength,
      (next[1] - point[1]) / nextLength,
    ];
    const previousDistance = isLandEdge(previous, point, viewport) ? 0 : inset;
    const nextDistance = isLandEdge(point, next, viewport) ? 0 : inset;
    const previousNormal: Point = [
      -previousDirection[1] * orientation,
      previousDirection[0] * orientation,
    ];
    const nextNormal: Point = [-nextDirection[1] * orientation, nextDirection[0] * orientation];
    return lineIntersection(
      [
        point[0] + previousNormal[0] * previousDistance,
        point[1] + previousNormal[1] * previousDistance,
      ],
      previousDirection,
      [point[0] + nextNormal[0] * nextDistance, point[1] + nextNormal[1] * nextDistance],
      nextDirection,
    );
  });
}

function roundedRing(ring: Point[], viewport: LayoutViewport): Point[] {
  const radius = Math.max(3, Math.min(14, (12 * viewport.width) / 1_200));
  return ring.flatMap((point, index) => {
    const previous = ring[(index - 1 + ring.length) % ring.length];
    const next = ring[(index + 1) % ring.length];
    const previousLength = Math.hypot(previous[0] - point[0], previous[1] - point[1]);
    const nextLength = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const cut = Math.min(radius, previousLength / 3, nextLength / 3);
    if (cut < 0.01) return [point];
    const start: Point = [
      point[0] + ((previous[0] - point[0]) * cut) / previousLength,
      point[1] + ((previous[1] - point[1]) * cut) / previousLength,
    ];
    const end: Point = [
      point[0] + ((next[0] - point[0]) * cut) / nextLength,
      point[1] + ((next[1] - point[1]) * cut) / nextLength,
    ];
    return [0, 0.25, 0.5, 0.75].map((progress): Point => {
      const inverse = 1 - progress;
      return [
        inverse * inverse * start[0] +
          2 * inverse * progress * point[0] +
          progress * progress * end[0],
        inverse * inverse * start[1] +
          2 * inverse * progress * point[1] +
          progress * progress * end[1],
      ];
    });
  });
}

function resampleRing(ring: Point[], count = HULL_POINT_COUNT): Point[] {
  if (ring.length === 0) return [];
  const lengths = ring.map((point, index) =>
    Math.hypot(
      point[0] - ring[(index + 1) % ring.length][0],
      point[1] - ring[(index + 1) % ring.length][1],
    ),
  );
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  if (perimeter === 0) return Array.from({ length: count }, () => [...ring[0]] as Point);
  const result: Point[] = [];
  let edgeIndex = 0;
  let edgeStart = 0;
  for (let index = 0; index < count; index += 1) {
    const distance = (index * perimeter) / count;
    while (edgeIndex < lengths.length - 1 && edgeStart + lengths[edgeIndex] < distance) {
      edgeStart += lengths[edgeIndex++];
    }
    const start = ring[edgeIndex];
    const end = ring[(edgeIndex + 1) % ring.length];
    const progress = lengths[edgeIndex] === 0 ? 0 : (distance - edgeStart) / lengths[edgeIndex];
    result.push([
      start[0] + (end[0] - start[0]) * progress,
      start[1] + (end[1] - start[1]) * progress,
    ]);
  }
  return result;
}

function pointSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const progress = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / Math.max(1e-9, lengthSquared),
    ),
  );
  return Math.hypot(point[0] - start[0] - progress * dx, point[1] - start[1] - progress * dy);
}

function interiorPoint(ring: Point[], anchor: Point): Point {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const bounds = {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
  let best = anchor;
  let bestDistance = 0;
  for (let row = 0; row <= 20; row += 1) {
    for (let column = 0; column <= 20; column += 1) {
      const point: Point = [
        bounds.left + ((bounds.right - bounds.left) * column) / 20,
        bounds.top + ((bounds.bottom - bounds.top) * row) / 20,
      ];
      if (!polygonContains(ring, point)) continue;
      const distance = Math.min(
        ...ring.map((start, index) =>
          pointSegmentDistance(point, start, ring[(index + 1) % ring.length]),
        ),
      );
      if (distance > bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function tessellatedHulls(nodes: LayoutNode[], viewport: LayoutViewport): Point[][] {
  const sites = createSites(nodes, viewport);
  const delaunay = Delaunay.from(
    sites,
    (site) => site.x ?? site.targetX,
    (site) => site.y ?? site.targetY,
  );
  const voronoi = delaunay.voronoi([0, 0, viewport.width, viewport.height]);
  const cellsByRegion = nodes.map((): Point[][] => []);
  sites.forEach((site, index) => {
    const polygon = voronoi.cellPolygon(index);
    if (polygon) cellsByRegion[site.regionIndex].push(polygon.map(([x, y]) => [x, y]));
  });
  return cellsByRegion.map((cells, regionIndex) => {
    const anchor: Point = [nodes[regionIndex].targetX, nodes[regionIndex].targetY];
    const rings = boundaryRings(cells);
    const ring =
      rings.find((candidate) => polygonContains(candidate, anchor)) ??
      rings.sort((left, right) => Math.abs(polygonArea(right)) - Math.abs(polygonArea(left)))[0];
    if (!ring) return [];
    const hull = resampleRing(roundedRing(insetRing(ring, viewport), viewport));
    return polygonContains(hull, anchor) ? hull : resampleRing(roundedRing(ring, viewport));
  });
}

export function placeRegions(
  manifest: Manifest,
  budget: Record<string, number>,
  viewport: LayoutViewport,
): RegionGeometry[] {
  const restBudget = computeBudget(manifest);
  const isFocused = manifest.regions.some((region) => budget[region.id] !== restBudget[region.id]);
  const contextRegionIds = new Set(
    isFocused
      ? manifest.regions
          .filter((region) => (budget[region.id] ?? 0) < restBudget[region.id])
          .map((region) => region.id)
      : [],
  );
  const scale = radiusScale(budget, viewport);
  const nodes = manifest.regions.map((region) => createNode(region, budget, viewport, scale));
  const hulls = tessellatedHulls(nodes, viewport);
  return nodes.map((node, index) => {
    const [labelX, labelY] = interiorPoint(hulls[index], [node.targetX, node.targetY]);
    return {
      id: node.id,
      x: node.targetX,
      y: node.targetY,
      labelX,
      labelY,
      radius: Math.max(
        contextRegionIds.has(node.id) ? FOCUS_CONTEXT_MIN_RADIUS : 0,
        Math.sqrt(Math.abs(polygonArea(hulls[index])) / Math.PI),
      ),
      budget: node.budget,
      hull: hulls[index],
    };
  });
}
