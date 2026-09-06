import { forceCollide, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3';
import { computeBlobShapes } from '../../ecosystem-visualizer/blob-shapes';
import type { ProcessedNode } from '../../ecosystem-visualizer/types';
import type { Manifest, Region } from '../core/types';

const AREA_FRACTION = 0.08;
const MAX_RADIUS_FRACTION = 0.18;
const COLLISION_GAP = 2;

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
}

function seededRandom(): () => number {
  let seed = 0x6d2b79f5;
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function radiusScale(budget: Record<string, number>, viewport: LayoutViewport): number {
  const base = Math.sqrt((viewport.width * viewport.height * AREA_FRACTION) / Math.PI);
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

function settle(nodes: LayoutNode[]): void {
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
  for (let index = 0; index < 60; index += 1) simulation.tick();
  simulation.force('x', null).force('y', null).alpha(1);
  nodes.forEach((node) => {
    node.vx = 0;
    node.vy = 0;
  });
  for (let index = 0; index < 20; index += 1) simulation.tick();
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
  const child = {
    ...folder,
    id: `${region.id}:shape`,
    path: `${region.id}/shape`,
    depth: 2,
    isFolder: false,
    parent: folder,
  } as ProcessedNode;
  folder.children = [child];
  return (
    computeBlobShapes([folder, child], {
      basePadding: 0,
      hullSubdivisions: 2,
      hullSmoothing: 2,
      wobbleAmplitude: 0,
    })[0]?.hull ?? []
  );
}

export function placeRegions(
  manifest: Manifest,
  budget: Record<string, number>,
  viewport: LayoutViewport,
): RegionGeometry[] {
  const scale = radiusScale(budget, viewport);
  const nodes = manifest.regions.map((region) => createNode(region, budget, viewport, scale));
  settle(nodes);
  return nodes.map((node, index) => ({
    id: node.id,
    x: node.x ?? 0,
    y: node.y ?? 0,
    radius: node.radius,
    budget: node.budget,
    hull: hullFor(node, manifest.regions[index]),
  }));
}
