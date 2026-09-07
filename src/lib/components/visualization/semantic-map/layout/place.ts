import { forceCollide, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3';
import { computeBlobShapes } from '../../ecosystem-visualizer/blob-shapes';
import type { ProcessedNode } from '../../ecosystem-visualizer/types';
import type { Manifest, Region } from '../core/types';
import { computeBudget } from './budget';

const AREA_FRACTION = 0.62;
const NARROW_AREA_FRACTION = 0.5;
const MAX_RADIUS_FRACTION = 0.3;
const COLLISION_GAP = 4;
const HULL_PADDING_FRACTION = 0.12;
const HULL_POINT_RADIUS_FRACTION = 0.07;
const HULL_POINT_SPREAD_FRACTION = 0.9;
const LABEL_EDGE_INSET = 76;

export interface LayoutViewport {
  width: number;
  height: number;
}

export interface RegionGeometry {
  id: string;
  x: number;
  y: number;
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
  hull: [number, number][];
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
    hull: [],
  };
}

function constrainToViewport(nodes: LayoutNode[], viewport: LayoutViewport): void {
  nodes.forEach((node) => {
    const inset = node.radius + COLLISION_GAP;
    const horizontalInset = Math.max(inset, LABEL_EDGE_INSET);
    node.x = Math.max(
      horizontalInset,
      Math.min(viewport.width - horizontalInset, node.x ?? node.targetX),
    );
    node.y = Math.max(inset, Math.min(viewport.height - inset, node.y ?? node.targetY));
  });
}

function separateOverlaps(nodes: LayoutNode[], viewport: LayoutViewport): void {
  for (let iteration = 0; iteration < 120; iteration += 1) {
    let separated = true;
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const dx = (nodes[right].x ?? 0) - (nodes[left].x ?? 0);
        const dy = (nodes[right].y ?? 0) - (nodes[left].y ?? 0);
        const distance = Math.hypot(dx, dy) || 1;
        const overlap = nodes[left].radius + nodes[right].radius + COLLISION_GAP - distance;
        if (overlap <= 0) continue;
        separated = false;
        const shiftX = (dx / distance) * overlap * 0.5;
        const shiftY = (dy / distance) * overlap * 0.5;
        nodes[left].x = (nodes[left].x ?? 0) - shiftX;
        nodes[left].y = (nodes[left].y ?? 0) - shiftY;
        nodes[right].x = (nodes[right].x ?? 0) + shiftX;
        nodes[right].y = (nodes[right].y ?? 0) + shiftY;
      }
    }
    constrainToViewport(nodes, viewport);
    if (separated) return;
  }
}

function settle(nodes: LayoutNode[], viewport: LayoutViewport): void {
  const simulation = forceSimulation(nodes)
    .randomSource(seededRandom())
    .force('x', forceX<LayoutNode>((node) => node.targetX).strength(0.35))
    .force('y', forceY<LayoutNode>((node) => node.targetY).strength(0.35))
    .force(
      'collision',
      forceCollide<LayoutNode>((node) => node.radius + COLLISION_GAP)
        .strength(1)
        .iterations(8),
    )
    .velocityDecay(0.65)
    .stop();
  for (let index = 0; index < 60; index += 1) {
    simulation.tick();
    constrainToViewport(nodes, viewport);
  }
  simulation.force('x', null).force('y', null).alpha(1);
  nodes.forEach((node) => {
    node.vx = 0;
    node.vy = 0;
  });
  for (let index = 0; index < 80; index += 1) {
    simulation.tick();
    constrainToViewport(nodes, viewport);
  }
  separateOverlaps(nodes, viewport);
}

function createHullChildren(
  node: LayoutNode,
  region: Region,
  folder: ProcessedNode,
): ProcessedNode[] {
  const childCount = Math.max(3, region.paths.length);
  const regionSeed = hashSeed(region.id);
  const random = seededRandom(regionSeed);
  const lobeCount = Math.min(childCount, 2 + (regionSeed % 3));
  const childRadius =
    node.radius * Math.min(HULL_POINT_RADIUS_FRACTION, 0.42 / Math.sqrt(childCount));
  const maximumDistance = Math.max(0, node.radius * HULL_POINT_SPREAD_FRACTION - childRadius);
  const centerX = node.x ?? 0;
  const centerY = node.y ?? 0;
  const shapePhase = random() * Math.PI * 2;
  const children = Array.from({ length: childCount }, (_, index) => {
    const lobeAngle = shapePhase + ((index % lobeCount) / lobeCount) * Math.PI * 2;
    const angle = lobeAngle + (random() - 0.5) * (Math.PI / lobeCount) * 0.72;
    const distance = maximumDistance * (0.72 + random() * 0.28);
    const targetX = centerX + Math.cos(angle) * distance;
    const targetY = centerY + Math.sin(angle) * distance;
    return {
      ...folder,
      id: `${region.id}:shape:${index}`,
      path: `${region.id}/shape/${index}`,
      depth: 2,
      isFolder: false,
      parent: folder,
      x: targetX,
      y: targetY,
      r: childRadius,
      targetX,
      targetY,
    } as ProcessedNode & { targetX: number; targetY: number };
  });
  const simulation = forceSimulation(children)
    .randomSource(random)
    .force('x', forceX<ProcessedNode & { targetX: number }>((child) => child.targetX).strength(0.7))
    .force('y', forceY<ProcessedNode & { targetY: number }>((child) => child.targetY).strength(0.7))
    .force(
      'collision',
      forceCollide<ProcessedNode>((child) => child.r)
        .strength(1)
        .iterations(4),
    )
    .velocityDecay(0.65)
    .stop();
  for (let index = 0; index < 40; index += 1) simulation.tick();
  return children;
}

function carveHullLobes(
  hull: [number, number][],
  centerX: number,
  centerY: number,
  radius: number,
  region: Region,
): [number, number][] {
  const regionSeed = hashSeed(region.id);
  const lobeCount = Math.min(Math.max(3, region.paths.length), 2 + (regionSeed % 3));
  const phase = seededRandom(regionSeed)() * Math.PI * 2;
  return hull.map(([x, y]) => {
    const angle = Math.atan2(y - centerY, x - centerX);
    const lobe = (Math.cos((angle - phase) * lobeCount) + 1) / 2;
    const secondary = Math.sin((angle + phase) * (lobeCount + 2)) * 0.02;
    const distance = radius * Math.max(0.7, Math.min(1, 0.72 + lobe * 0.28 + secondary));
    return [centerX + Math.cos(angle) * distance, centerY + Math.sin(angle) * distance];
  });
}

function hullFor(node: LayoutNode, region: Region): [number, number][] {
  const folder = {
    id: region.id,
    path: region.id,
    name: region.label,
    label: region.label,
    color: region.color ?? '',
    size: 1,
    value: 1,
    depth: 1,
    isFolder: true,
    x: node.x ?? 0,
    y: node.y ?? 0,
    vx: 0,
    vy: 0,
    r: node.radius,
  } as ProcessedNode;
  const children = createHullChildren(node, region, folder);
  folder.children = children;
  const hull =
    computeBlobShapes([folder, ...children], {
      basePadding: node.radius * HULL_PADDING_FRACTION,
      hullSubdivisions: 1,
      hullSmoothing: 2,
      wobbleAmplitude: 3,
    })[0]?.hull ?? [];
  return carveHullLobes(hull, node.x ?? 0, node.y ?? 0, node.radius, region);
}

function createLayoutNodes(
  manifest: Manifest,
  budget: Record<string, number>,
  viewport: LayoutViewport,
): LayoutNode[] {
  const scale = radiusScale(budget, viewport);
  const nodes = manifest.regions.map((region) => createNode(region, budget, viewport, scale));
  nodes.forEach((node, index) => {
    const centerX = node.x ?? node.targetX;
    const centerY = node.y ?? node.targetY;
    const hull = hullFor(node, manifest.regions[index]);
    node.hull = hull.map(([x, y]) => [x - centerX, y - centerY]);
    node.radius = Math.max(0, ...node.hull.map(([x, y]) => Math.hypot(x, y)));
  });
  return nodes;
}

export function placeRegions(
  manifest: Manifest,
  budget: Record<string, number>,
  viewport: LayoutViewport,
): RegionGeometry[] {
  const nodes = createLayoutNodes(manifest, budget, viewport);
  const restBudget = computeBudget(manifest);
  const isFocused = manifest.regions.some((region) => budget[region.id] !== restBudget[region.id]);
  if (isFocused) {
    const restNodes = createLayoutNodes(manifest, restBudget, viewport);
    settle(restNodes, viewport);
    nodes.forEach((node, index) => {
      node.x = restNodes[index].x;
      node.y = restNodes[index].y;
      node.targetX = restNodes[index].x ?? node.targetX;
      node.targetY = restNodes[index].y ?? node.targetY;
    });
  }
  settle(nodes, viewport);
  return nodes.map((node) => ({
    id: node.id,
    x: node.x ?? 0,
    y: node.y ?? 0,
    radius: node.radius,
    budget: node.budget,
    hull: node.hull.map(([x, y]) => [x + (node.x ?? 0), y + (node.y ?? 0)]),
  }));
}
