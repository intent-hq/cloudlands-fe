import type { RegionGeometry } from '../layout/place';
import type { AgentBadge, RouteEdge } from './types';

const GAP = 4;
const BADGE_SIZE = 30;
export const REGION_LABEL_MIN_FONT_SIZE = 13;
export const REGION_LABEL_MAX_FONT_SIZE = 16;
export const REGION_LABEL_MIN_OPACITY = 0.82;

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
  opacity: number;
  lines?: string[];
}

export interface LabelLayout {
  regions: PlacedLabel[];
  edges: PlacedLabel[];
  counts: PlacedLabel[];
  badges: Array<AgentBadge & { box: LabelBox }>;
  boxes: LabelBox[];
}

export interface LabelFocusState {
  maximumBudget: number;
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

function wrapLabel(text: string, maxCharacters: number): string[] {
  const lines = [''];
  for (const word of text.split(' ')) {
    const last = lines.length - 1;
    const candidate = lines[last] ? `${lines[last]} ${word}` : word;
    if (candidate.length > maxCharacters && lines[last]) lines.push(word);
    else lines[last] = candidate;
  }
  return lines;
}

export function labelEmphasis(
  region: Pick<RegionGeometry, 'budget'>,
  focusState: LabelFocusState,
): number {
  if (focusState.maximumBudget <= 0) return 1;
  const ratio = Math.sqrt(Math.max(0, region.budget) / focusState.maximumBudget);
  return Math.max(REGION_LABEL_MIN_OPACITY, Math.min(1, ratio));
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

function regionCandidates(
  region: RegionGeometry,
  width: number,
  height: number,
): Array<readonly [number, number]> {
  const horizontalStep = width * 0.55;
  const verticalOffsets = [0, -height, height, -height * 2, height * 2];
  return [
    ...verticalOffsets.map((offset) => [region.x, region.y + offset] as const),
    ...verticalOffsets.flatMap((offset) => [
      [region.x - horizontalStep, region.y + offset] as const,
      [region.x + horizontalStep, region.y + offset] as const,
    ]),
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
  const focusState = {
    maximumBudget: Math.max(0, ...input.regions.map(({ budget }) => budget)),
  };
  const regions = input.regions.flatMap((region) => {
    const text = input.regionLabels.get(region.id);
    if (!text) return [];
    const fontSize = Math.max(
      REGION_LABEL_MIN_FONT_SIZE,
      Math.min(REGION_LABEL_MAX_FONT_SIZE, region.radius * 0.15),
    );
    const lines = wrapLabel(text, 22);
    const width = Math.max(...lines.map((line) => estimateWidth(line, fontSize)));
    const height = lines.length * (fontSize + 3) + 4;
    const box = place(
      { id: region.id, kind: 'region', width, height },
      regionCandidates(region, width, height),
      occupied,
      viewport,
    );
    return box
      ? [
          {
            ...box,
            text,
            fontSize,
            opacity: labelEmphasis(region, focusState),
            lines,
          },
        ]
      : [];
  });
  const edges = input.edges.flatMap((edge, index) => {
    const fontSize = 12 / scale;
    const lines = wrapLabel(edge.label, 36);
    const box = place(
      {
        id: `edge-${index}`,
        kind: 'edge',
        width: Math.max(...lines.map((line) => estimateWidth(line, fontSize))),
        height: lines.length * (fontSize + 3 / scale) + 4 / scale,
      },
      edgeCandidates(edge, 14 / scale),
      occupied,
      viewport,
    );
    return box ? [{ ...box, text: edge.label, fontSize, opacity: 1, lines }] : [];
  });
  const counts = input.edges.flatMap((edge, index) => {
    const fontSize = 11 / scale;
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
    return box ? [{ ...box, text, fontSize, opacity: 1 }] : [];
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
