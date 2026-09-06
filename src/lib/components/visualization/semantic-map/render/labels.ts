import type { RegionGeometry } from '../layout/place';
import type { AgentBadge, RouteEdge } from './types';

const GAP = 4;
const BADGE_SIZE = 30;

export interface LabelBox {
  id: string;
  kind: 'region' | 'edge' | 'count' | 'badge';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedLabel extends LabelBox {
  text: string;
  fontSize: number;
}

export interface LabelLayout {
  regions: PlacedLabel[];
  edges: PlacedLabel[];
  counts: PlacedLabel[];
  badges: Array<AgentBadge & { box: LabelBox }>;
  boxes: LabelBox[];
}

function overlaps(left: LabelBox, right: LabelBox): boolean {
  return !(
    left.x + left.width / 2 + GAP <= right.x - right.width / 2 ||
    right.x + right.width / 2 + GAP <= left.x - left.width / 2 ||
    left.y + left.height / 2 + GAP <= right.y - right.height / 2 ||
    right.y + right.height / 2 + GAP <= left.y - left.height / 2
  );
}

export function boxesOverlap(left: LabelBox, right: LabelBox): boolean {
  return overlaps(left, right);
}

function estimateWidth(text: string, fontSize: number, maximum = Infinity): number {
  return Math.min(maximum, Math.max(fontSize, text.length * fontSize * 0.56));
}

function inside(box: LabelBox, width: number, height: number): boolean {
  return (
    box.x - box.width / 2 >= GAP &&
    box.x + box.width / 2 <= width - GAP &&
    box.y - box.height / 2 >= GAP &&
    box.y + box.height / 2 <= height - GAP
  );
}

function place(
  base: Omit<LabelBox, 'x' | 'y'>,
  candidates: Array<readonly [number, number]>,
  occupied: LabelBox[],
  viewport: { width: number; height: number },
): LabelBox | undefined {
  for (const [x, y] of candidates) {
    const box = { ...base, x, y };
    if (
      inside(box, viewport.width, viewport.height) &&
      !occupied.some((item) => overlaps(box, item))
    ) {
      occupied.push(box);
      return box;
    }
  }
}

function edgeCandidates(edge: RouteEdge, distance: number): Array<readonly [number, number]> {
  const x = (edge.startX + 2 * edge.controlX + edge.endX) / 4;
  const y = (edge.startY + 2 * edge.controlY + edge.endY) / 4;
  const dx = edge.endX - edge.startX;
  const dy = edge.endY - edge.startY;
  const length = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / length;
  const ny = dx / length;
  const tx = dx / length;
  const ty = dy / length;
  return [
    [x + nx * distance, y + ny * distance],
    [x - nx * distance, y - ny * distance],
    [x + nx * (distance + 18), y + ny * (distance + 18)],
    [x - nx * (distance + 18), y - ny * (distance + 18)],
    [x + nx * distance + tx * 30, y + ny * distance + ty * 30],
    [x - nx * distance - tx * 30, y - ny * distance - ty * 30],
    [x + nx * (distance + 36) + tx * 46, y + ny * (distance + 36) + ty * 46],
    [x - nx * (distance + 36) - tx * 46, y - ny * (distance + 36) - ty * 46],
  ];
}

function badgeCandidates(badge: AgentBadge, scale: number): Array<readonly [number, number]> {
  const step = 34 / scale;
  const result: Array<readonly [number, number]> = [];
  for (const radius of [step, step * 1.55, step * 2.1]) {
    for (const angle of [-Math.PI / 2, 0, Math.PI / 2, Math.PI, -Math.PI / 4, Math.PI / 4]) {
      result.push([badge.x + Math.cos(angle) * radius, badge.y + Math.sin(angle) * radius]);
    }
  }
  return result;
}

export function layoutSceneLabels(input: {
  regions: RegionGeometry[];
  regionLabels: ReadonlyMap<string, string>;
  edges: RouteEdge[];
  badges: AgentBadge[];
  width: number;
  height: number;
  scale?: number;
}): LabelLayout {
  const scale = input.scale ?? 1;
  const viewport = { width: input.width, height: input.height };
  const occupied: LabelBox[] = [];
  const regions = input.regions.flatMap((region) => {
    const text = input.regionLabels.get(region.id);
    if (!text) return [];
    const fontSize = Math.max(11, Math.min(16, region.radius * 0.15));
    const width = estimateWidth(text, fontSize, Math.max(54, region.radius * 1.45));
    const box = place(
      { id: region.id, kind: 'region', width, height: fontSize + 4 },
      [
        [region.x, region.y],
        [region.x, region.y - fontSize],
        [region.x, region.y + fontSize],
      ],
      occupied,
      viewport,
    );
    return box ? [{ ...box, text, fontSize }] : [];
  });
  const edges = input.edges.flatMap((edge, index) => {
    const fontSize = 11 / scale;
    const box = place(
      {
        id: `edge-${index}`,
        kind: 'edge',
        width: estimateWidth(edge.label, fontSize, 260 / scale),
        height: fontSize + 4 / scale,
      },
      edgeCandidates(edge, 14 / scale),
      occupied,
      viewport,
    );
    return box ? [{ ...box, text: edge.label, fontSize }] : [];
  });
  const counts = input.edges.flatMap((edge, index) => {
    const fontSize = 10 / scale;
    const text = `${edge.count}×`;
    const box = place(
      {
        id: `count-${index}`,
        kind: 'count',
        width: estimateWidth(text, fontSize),
        height: fontSize + 4 / scale,
      },
      edgeCandidates(edge, 30 / scale),
      occupied,
      viewport,
    );
    return box ? [{ ...box, text, fontSize }] : [];
  });
  const badges = input.badges.flatMap((badge) => {
    const box = place(
      { id: badge.id, kind: 'badge', width: BADGE_SIZE / scale, height: BADGE_SIZE / scale },
      badgeCandidates(badge, scale),
      occupied,
      viewport,
    );
    return box ? [{ ...badge, x: box.x, y: box.y, box }] : [];
  });
  return { regions, edges, counts, badges, boxes: occupied };
}
