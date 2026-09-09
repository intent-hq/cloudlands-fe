import type { RegionGeometry } from '../layout/place';
import type { AgentBadge, RouteEdge } from './types';

const GAP = 4;
const BADGE_SIZE = 30;
const REGION_LABEL_MIN_FONT_SIZE = 12;
const REGION_LABEL_MAX_FONT_SIZE = 16;
const REGION_LABEL_MIN_OPACITY = 0.82;
const ALL_REGION_LABELS_MIN_WIDTH = 600;
const NARROW_REGION_LABEL_WIDTH = 96;

export interface LabelBox {
  id: string;
  kind: 'region' | 'edge' | 'pip' | 'badge';
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
  pips: PlacedLabel[];
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

function abbreviateLabel(text: string): string {
  const words = text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (words.length >= 2)
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase();
  return text.slice(0, 2).toUpperCase();
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

function hullContainsPoint(hull: [number, number][], x: number, y: number): boolean {
  let contained = false;
  for (let index = 0, previous = hull.length - 1; index < hull.length; previous = index++) {
    const currentPoint = hull[index];
    const previousPoint = hull[previous];
    const crossesRay =
      currentPoint[1] > y !== previousPoint[1] > y &&
      x <
        ((previousPoint[0] - currentPoint[0]) * (y - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];
    if (crossesRay) contained = !contained;
  }
  return contained;
}

function labelContainedByHull(
  box: LabelBox,
  hull: [number, number][],
  lines: string[],
  fontSize: number,
): boolean {
  return lines.every((line, index) => {
    const halfWidth = estimateWidth(line, fontSize) / 2;
    const halfHeight = fontSize / 2;
    const y = box.y + (index - (lines.length - 1) / 2) * (fontSize + 3);
    return [
      [box.x - halfWidth, y - halfHeight],
      [box.x + halfWidth, y - halfHeight],
      [box.x + halfWidth, y + halfHeight],
      [box.x - halfWidth, y + halfHeight],
    ].every(([x, pointY]) => hullContainsPoint(hull, x, pointY));
  });
}

function place(
  base: Omit<LabelBox, 'x' | 'y'>,
  candidates: Array<readonly [number, number]>,
  occupied: LabelBox[],
  viewport: { width: number; height: number },
  fits: (box: LabelBox) => boolean = () => true,
): LabelBox | undefined {
  for (const [x, y] of candidates) {
    const box = { ...base, x, y };
    if (
      inside(box, viewport.width, viewport.height) &&
      fits(box) &&
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
  const anchorX = region.labelX ?? region.x;
  const anchorY = region.labelY ?? region.y;
  const horizontalStep = width * 0.55;
  const verticalOffsets = [
    0,
    GAP,
    -GAP,
    GAP * 2,
    -GAP * 2,
    GAP * 3,
    -GAP * 3,
    -height,
    height,
    -height * 2,
    height * 2,
  ];
  return [
    ...verticalOffsets.map((offset) => [anchorX, anchorY + offset] as const),
    ...verticalOffsets.flatMap((offset) => [
      [anchorX - horizontalStep, anchorY + offset] as const,
      [anchorX + horizontalStep, anchorY + offset] as const,
    ]),
  ];
}

function badgeCandidates(
  badge: AgentBadge,
  scale: number,
  viewport: { width: number; height: number },
): Array<readonly [number, number]> {
  const step = 34 / scale;
  const result: Array<readonly [number, number]> = [];
  for (const radius of [step, step * 1.55, step * 2.1]) {
    for (const angle of [-Math.PI / 2, 0, Math.PI / 2, Math.PI, -Math.PI / 4, Math.PI / 4]) {
      result.push([badge.x + Math.cos(angle) * radius, badge.y + Math.sin(angle) * radius]);
    }
  }
  const halfSize = BADGE_SIZE / scale / 2;
  const gridStep = (BADGE_SIZE + GAP) / scale;
  const fallback: Array<readonly [number, number]> = [];
  for (let y = halfSize + GAP; y <= viewport.height - halfSize - GAP; y += gridStep) {
    for (let x = halfSize + GAP; x <= viewport.width - halfSize - GAP; x += gridStep) {
      fallback.push([x, y]);
    }
  }
  fallback.sort(
    ([leftX, leftY], [rightX, rightY]) =>
      Math.hypot(leftX - badge.x, leftY - badge.y) - Math.hypot(rightX - badge.x, rightY - badge.y),
  );
  return [...result, ...fallback];
}

function visibleRegions(input: {
  regions: RegionGeometry[];
  width: number;
  heatByRegion?: Readonly<Record<string, number>>;
  revealedRegionIds?: ReadonlySet<string>;
}): RegionGeometry[] {
  if (input.width >= ALL_REGION_LABELS_MIN_WIDTH) return input.regions;
  const limit = Math.max(3, Math.floor(input.width / NARROW_REGION_LABEL_WIDTH));
  const maximumBudget = Math.max(0, ...input.regions.map(({ budget }) => budget));
  const ranked = [...input.regions].sort((left, right) => {
    const leftPriority = left.budget + (input.heatByRegion?.[left.id] ?? 0) * maximumBudget;
    const rightPriority = right.budget + (input.heatByRegion?.[right.id] ?? 0) * maximumBudget;
    return rightPriority - leftPriority || left.id.localeCompare(right.id);
  });
  return ranked.filter((region, index) => index < limit || input.revealedRegionIds?.has(region.id));
}

export function layoutSceneLabels(input: {
  regions: RegionGeometry[];
  regionLabels: ReadonlyMap<string, string>;
  edges: RouteEdge[];
  badges: AgentBadge[];
  width: number;
  height: number;
  scale?: number;
  heatByRegion?: Readonly<Record<string, number>>;
  revealedRegionIds?: ReadonlySet<string>;
  focusedRegionIds?: ReadonlySet<string>;
  focusContentRegionIds?: ReadonlySet<string>;
}): LabelLayout {
  const scale = input.scale ?? 1;
  const viewport = { width: input.width, height: input.height };
  const occupied: LabelBox[] = [];
  const focusState = {
    maximumBudget: Math.max(0, ...input.regions.map(({ budget }) => budget)),
  };
  const badges = input.badges.map((badge, index) => {
    const placed = place(
      { id: badge.id, kind: 'badge', width: BADGE_SIZE / scale, height: BADGE_SIZE / scale },
      badgeCandidates(badge, scale, viewport),
      occupied,
      viewport,
    );
    const box =
      placed ??
      ({
        id: badge.id,
        kind: 'badge',
        x: BADGE_SIZE / scale / 2 + GAP,
        y: BADGE_SIZE / scale / 2 + GAP + (index * (BADGE_SIZE + GAP)) / scale,
        width: BADGE_SIZE / scale,
        height: BADGE_SIZE / scale,
      } satisfies LabelBox);
    if (!placed) occupied.push(box);
    return { ...badge, x: box.x, y: box.y, box };
  });
  const pips = input.edges.map((edge, index) => {
    const fontSize = 12 / scale;
    const size = 20 / scale;
    const box = {
      id: `pip-${index}`,
      kind: 'pip' as const,
      x: edge.midpointX,
      y: edge.midpointY,
      width: size,
      height: size,
    };
    occupied.push(box);
    return { ...box, text: String(edge.step), fontSize, opacity: 1 };
  });
  const regions = visibleRegions(input).flatMap((region) => {
    const text = input.regionLabels.get(region.id);
    if (!text) return [];
    const fontSize = Math.max(
      REGION_LABEL_MIN_FONT_SIZE,
      Math.min(REGION_LABEL_MAX_FONT_SIZE, region.radius * 0.15),
    );
    const maxCharacters = Math.max(
      8,
      Math.min(22, Math.floor((region.radius * 1.2) / (fontSize * 0.56))),
    );
    const lines = wrapLabel(text, maxCharacters);
    const width = Math.max(...lines.map((line) => estimateWidth(line, fontSize)));
    const height = lines.length * (fontSize + 3) + 4;
    const candidates = input.focusContentRegionIds?.has(region.id)
      ? [
          [region.labelX ?? region.x, (region.labelY ?? region.y) - region.radius * 0.45] as const,
          ...regionCandidates(region, width, height),
        ]
      : regionCandidates(region, width, height);
    let box = place(
      { id: region.id, kind: 'region', width, height },
      candidates,
      occupied,
      viewport,
      (candidate) => labelContainedByHull(candidate, region.hull, lines, fontSize),
    );
    let displayedText = text;
    let displayedLines = lines;
    if (input.focusedRegionIds?.size && !input.focusedRegionIds.has(region.id) && !box) {
      displayedText = abbreviateLabel(text);
      displayedLines = [displayedText];
      const abbreviatedWidth = estimateWidth(displayedText, fontSize);
      const abbreviatedHeight = fontSize + 4;
      box = place(
        {
          id: region.id,
          kind: 'region',
          width: abbreviatedWidth,
          height: abbreviatedHeight,
        },
        regionCandidates(region, abbreviatedWidth, abbreviatedHeight),
        occupied,
        viewport,
        (candidate) => labelContainedByHull(candidate, region.hull, displayedLines, fontSize),
      );
    }
    return box
      ? [
          {
            ...box,
            text: displayedText,
            fontSize,
            opacity: labelEmphasis(region, focusState),
            lines: displayedLines,
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
        width: Math.max(...lines.map((line) => estimateWidth(line, fontSize))) + 16 / scale,
        height: lines.length * (fontSize + 3 / scale) + 10 / scale,
      },
      edgeCandidates(edge, 14 / scale),
      occupied,
      viewport,
    );
    return box ? [{ ...box, text: edge.label, fontSize, opacity: 1, lines }] : [];
  });
  return { regions, edges, pips, badges, boxes: occupied };
}
