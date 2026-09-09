import { getAgentColorsWithSeed } from '$lib/utils/agent-colors';
import type { Manifest, MapActivity } from '../core/types';
import type { RegionGeometry } from '../layout/place';
import type {
  ActivityMark,
  ActivityTick,
  AgentBadge,
  AgentTrail,
  FocusContent,
  FocusEvidenceItem,
  HeatBand,
  RouteEdge,
  SemanticMapFilters,
  SemanticMapRoute,
  SemanticMapSelection,
  SemanticMapScene,
  SemanticMapTimeWindow,
} from './types';

const READ_DURATION_MS = 2_000;
const MOVE_DURATION_MS = 1_000;
const TOOL_DURATION_MS = 1_200;
const DEFAULT_TRAIL_LENGTH = 4;
export const HEAT_BAND_ALPHA: Readonly<Record<HeatBand, number>> = {
  0: 0,
  1: 0.07,
  2: 0.14,
  3: 0.21,
};

function timestamp(value: string): number {
  return Date.parse(value);
}

export function filterActivities(
  activities: MapActivity[],
  filters: SemanticMapFilters,
  timeWindow: SemanticMapTimeWindow,
): MapActivity[] {
  const start = timestamp(timeWindow.start);
  const end = timestamp(timeWindow.end);
  const agents = filters.agentIds?.length ? new Set(filters.agentIds) : null;
  const kinds = filters.kinds?.length ? new Set(filters.kinds) : null;
  return activities
    .filter((activity) => {
      const at = timestamp(activity.ts);
      return (
        at >= start &&
        at <= end &&
        (!agents || (!!activity.agentId && agents.has(activity.agentId))) &&
        (!kinds || kinds.has(activity.kind))
      );
    })
    .sort((a, b) => timestamp(a.ts) - timestamp(b.ts));
}

function geometryIndex(geometry: RegionGeometry[]): Map<string, RegionGeometry> {
  return new Map(geometry.map((region) => [region.id, region]));
}

function stringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function markPosition(activity: MapActivity, region: RegionGeometry): [number, number] {
  const hash = stringHash(`${activity.agentId ?? ''}:${activity.path ?? ''}:${activity.ts}`);
  const angle = ((hash % 360) * Math.PI) / 180;
  const distance = region.radius * (0.12 + ((hash >>> 9) % 24) / 100);
  return [region.x + Math.cos(angle) * distance, region.y + Math.sin(angle) * distance];
}

export function quantizeHeat(count: number): HeatBand {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
}

function tickPosition(region: RegionGeometry): [number, number] {
  return region.hull.reduce(
    (rightmost, point) =>
      point[0] > rightmost[0] ||
      (point[0] === rightmost[0] &&
        Math.abs(point[1] - region.y) < Math.abs(rightmost[1] - region.y))
        ? point
        : rightmost,
    region.hull[0] ?? ([region.x + region.radius, region.y] as [number, number]),
  );
}

function isUnsortedRegion(regionId: string): boolean {
  return regionId.toLowerCase() === 'unsorted'; // i18n-ignore (wire identifier)
}

function buildMarks(
  activities: MapActivity[],
  geometry: Map<string, RegionGeometry>,
  end: number,
  duration: number,
  colors: Map<string, string>,
  neutral: string,
): {
  marks: ActivityMark[];
  ticks: ActivityTick[];
  trails: AgentTrail[];
  heatByRegion: Record<string, HeatBand>;
} {
  const marks: ActivityMark[] = [];
  const mutationCountByRegion = new Map<string, number>();
  const latestMutationColorByRegion = new Map<string, string>();
  const trailRegionsByAgent = new Map<string, RegionGeometry[]>();
  const previousRegion = new Map<string, RegionGeometry>();
  for (const activity of activities) {
    if (!activity.regionId) continue;
    const region = geometry.get(activity.regionId);
    if (!region) continue;
    const agentId = activity.agentId ?? '';
    const color = colors.get(agentId) ?? neutral;
    if (agentId) {
      const trailRegions = trailRegionsByAgent.get(agentId) ?? [];
      if (trailRegions.at(-1)?.id !== region.id) trailRegions.push(region);
      trailRegionsByAgent.set(agentId, trailRegions);
    }
    if (activity.kind === 'edit' || activity.kind === 'create') {
      mutationCountByRegion.set(
        activity.regionId,
        (mutationCountByRegion.get(activity.regionId) ?? 0) + 1,
      );
      latestMutationColorByRegion.set(activity.regionId, color);
    }
    if (activity.kind === 'tool' || activity.kind === 'thinking') continue;
    const ageMs = Math.max(0, end - timestamp(activity.ts));
    const alpha = Math.max(0.12, 1 - ageMs / duration);
    const [x, y] = markPosition(activity, region);
    const from = previousRegion.get(agentId);
    previousRegion.set(agentId, region);
    if (activity.kind === 'read' && ageMs > READ_DURATION_MS) continue;
    if (activity.kind === 'move' && ageMs > MOVE_DURATION_MS) continue;
    if ((activity.kind === 'edit' || activity.kind === 'create') && ageMs > READ_DURATION_MS)
      continue;
    const mark: ActivityMark = {
      kind: activity.kind,
      x,
      y,
      alpha:
        activity.kind === 'edit' || activity.kind === 'create'
          ? Math.max(0, 1 - ageMs / READ_DURATION_MS)
          : alpha,
      ageMs,
      color,
    };
    if (activity.kind === 'move' && from) {
      mark.fromX = from.x;
      mark.fromY = from.y;
    }
    marks.push(mark);
  }
  const heatByRegion = Object.fromEntries(
    [...mutationCountByRegion].map(([regionId, count]) => [regionId, quantizeHeat(count)]),
  ) as Record<string, HeatBand>;
  const hottestCuratedBand = Math.max(
    0,
    ...Object.entries(heatByRegion)
      .filter(([regionId]) => !isUnsortedRegion(regionId))
      .map(([, band]) => band),
  );
  for (const regionId of Object.keys(heatByRegion)) {
    if (isUnsortedRegion(regionId)) {
      heatByRegion[regionId] = Math.min(
        heatByRegion[regionId],
        Math.max(0, hottestCuratedBand - 1),
      ) as HeatBand;
    }
  }
  const ticks: ActivityTick[] = [...mutationCountByRegion].flatMap(([regionId, count]) => {
    const region = geometry.get(regionId);
    if (!region) return [];
    const [x, y] = tickPosition(region);
    return [{ regionId, x, y, count, color: latestMutationColorByRegion.get(regionId) ?? neutral }];
  });
  const trails: AgentTrail[] = [...trailRegionsByAgent].flatMap(([agentId, regions]) => {
    const recent = regions.slice(-DEFAULT_TRAIL_LENGTH);
    if (recent.length < 2) return [];
    return [
      {
        agentId,
        color: colors.get(agentId) ?? neutral,
        points: recent.map((region, index) => ({
          x: region.x,
          y: region.y,
          alpha: 0.9 - (recent.length - 1 - index) * 0.2,
        })),
      },
    ];
  });
  return { marks, heatByRegion, ticks, trails };
}

function agentColors(activities: MapActivity[], dark: boolean): Map<string, string> {
  const result = new Map<string, string>();
  for (const activity of activities) {
    if (!activity.agentId || result.has(activity.agentId)) continue;
    result.set(activity.agentId, getAgentColorsWithSeed(activity.agentId, dark)[0]);
  }
  return result;
}

function hullContainsPoint(hull: [number, number][], x: number, y: number): boolean {
  let contained = false;
  for (let index = 0, previous = hull.length - 1; index < hull.length; previous = index++) {
    const [currentX, currentY] = hull[index];
    const [previousX, previousY] = hull[previous];
    if (
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX
    )
      contained = !contained;
  }
  return contained;
}

function evidenceLabel(activity: MapActivity): string {
  if (!activity.path) return activity.agentName ?? activity.agentId ?? activity.kind;
  const name = activity.path.split('/').at(-1) ?? activity.path;
  if (name.length <= 18) return name;
  return `${name.slice(0, 8)}…${name.slice(-8)}`;
}

function focusItemPositions(region: RegionGeometry, count: number): Array<[number, number]> {
  const columns = Math.min(3, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const horizontalStep = Math.min(108, (region.radius * 1.25) / Math.max(1, columns));
  const verticalStep = Math.min(62, (region.radius * 0.9) / Math.max(1, rows));
  const positions: Array<[number, number]> = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = region.x + (column - (columns - 1) / 2) * horizontalStep;
    const y = region.y + region.radius * 0.3 + (row - (rows - 1) / 2) * verticalStep;
    positions.push(hullContainsPoint(region.hull, x, y) ? [x, y] : [region.x, region.y]);
  }
  return positions;
}

export function buildFocusContent(input: {
  activities: MapActivity[];
  manifest: Manifest;
  geometry: RegionGeometry[];
  focusedRegionIds: ReadonlySet<string>;
  dark: boolean;
  neutral: string;
}): FocusContent | null {
  const region = input.geometry.find(({ id }) => input.focusedRegionIds.has(id));
  if (!region) return null;
  const children = input.manifest.regions.filter(({ parent }) => parent === region.id);
  const relevantIds = new Set([region.id, ...children.map(({ id }) => id)]);
  const activities = input.activities.filter(
    (activity) => !!activity.regionId && relevantIds.has(activity.regionId),
  );
  if (activities.length === 0) return null;
  const colors = agentColors(activities, input.dark);
  const childById = new Map(children.map((child) => [child.id, child]));
  const evidenceActivities = activities.some(({ path }) => !!path)
    ? activities.filter(({ path }) => !!path)
    : activities;
  const latestByKey = new Map<string, MapActivity>();
  for (const activity of evidenceActivities) {
    const key =
      children.length > 0 && activity.regionId && childById.has(activity.regionId)
        ? activity.regionId
        : (activity.path ?? activity.id);
    latestByKey.set(key, activity);
  }
  const entries = [...latestByKey].slice(-9);
  const positions = focusItemPositions(region, entries.length);
  const items: FocusEvidenceItem[] = entries.map(([key, activity], index) => {
    const child = childById.get(key);
    return {
      id: key,
      label: child?.label ?? evidenceLabel(activity),
      kind: activity.kind,
      color: colors.get(activity.agentId ?? '') ?? input.neutral,
      x: positions[index][0],
      y: positions[index][1],
      path: activity.path,
      count: child ? activities.filter(({ regionId }) => regionId === child.id).length : undefined,
    };
  });
  return { regionId: region.id, mode: children.length > 0 ? 'subregions' : 'files', items };
}

function buildBadges(
  activities: MapActivity[],
  geometry: Map<string, RegionGeometry>,
  end: number,
  colors: Map<string, string>,
  neutral: string,
): AgentBadge[] {
  const latestByAgent = new Map<string, MapActivity>();
  const latestRegionByAgent = new Map<string, string>();
  const nameByAgent = new Map<string, string>();
  for (const activity of activities) {
    if (!activity.agentId) continue;
    latestByAgent.set(activity.agentId, activity);
    if (activity.regionId && geometry.has(activity.regionId)) {
      latestRegionByAgent.set(activity.agentId, activity.regionId);
    }
    if (activity.agentName) nameByAgent.set(activity.agentId, activity.agentName);
  }
  let unplaced = 0;
  const badges = [...latestByAgent].map(([id, latest]) => {
    const region = geometry.get(latestRegionByAgent.get(id) ?? '');
    const badge: AgentBadge = {
      id,
      name: nameByAgent.get(id) ?? id,
      regionId: region?.id,
      kind: latest.kind,
      x: region?.x ?? 28 + unplaced++ * 34,
      y: region?.y ?? 28,
      color: colors.get(id) ?? neutral,
      thinking: latest.kind === 'thinking',
    };
    if (latest.kind === 'tool') badge.toolAgeMs = Math.max(0, end - timestamp(latest.ts));
    return badge;
  });
  return badges;
}

export function buildRouteEdges(
  routes: SemanticMapRoute[],
  geometry: RegionGeometry[],
  fileLabel: (count: number) => string,
  dark: boolean,
  neutral: string,
): RouteEdge[] {
  const byId = geometryIndex(geometry);
  return routes.flatMap(({ agentId, route }, routeIndex) =>
    route.transitions.flatMap((transition, index) => {
      const from = byId.get(transition.from);
      const to = byId.get(transition.to);
      if (!from || !to) return [];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const direction = (index + routeIndex) % 2 === 0 ? 1 : -1;
      const separation = routes.length > 1 ? 8 * routeIndex : 0;
      const bend = direction * (Math.min(42, Math.hypot(dx, dy) * 0.12) + separation);
      const length = Math.max(1, Math.hypot(dx, dy));
      const controlX = (from.x + to.x) / 2 - (dy / length) * bend;
      const controlY = (from.y + to.y) / 2 + (dx / length) * bend;
      const pointAt = (t: number) => {
        const inverse = 1 - t;
        return {
          x: inverse * inverse * from.x + 2 * inverse * t * controlX + t * t * to.x,
          y: inverse * inverse * from.y + 2 * inverse * t * controlY + t * t * to.y,
        };
      };
      const midpoint = pointAt(0.5);
      const arrow = pointAt(0.84);
      const arrowTangentX = 2 * 0.16 * (controlX - from.x) + 2 * 0.84 * (to.x - controlX);
      const arrowTangentY = 2 * 0.16 * (controlY - from.y) + 2 * 0.84 * (to.y - controlY);
      return [
        {
          agentId,
          transitionIndex: index,
          color: agentId ? getAgentColorsWithSeed(agentId, dark)[0] : neutral,
          from: transition.from,
          to: transition.to,
          startX: from.x,
          startY: from.y,
          controlX,
          controlY,
          endX: to.x,
          endY: to.y,
          midpointX: midpoint.x,
          midpointY: midpoint.y,
          arrowX: arrow.x,
          arrowY: arrow.y,
          arrowAngle: Math.atan2(arrowTangentY, arrowTangentX),
          step: index + 1,
          count: transition.count,
          label: transition.label ?? fileLabel(transition.evidence.length),
          evidence: transition.evidence,
        },
      ];
    }),
  );
}

export function routeEdgePresentation(
  edge: Pick<RouteEdge, 'agentId' | 'transitionIndex'>,
  selection: SemanticMapSelection,
  hovered: boolean,
): { accented: boolean; opacity: number } {
  if (selection?.type === 'route' && selection.transitionIndex !== undefined) {
    return edge.transitionIndex === selection.transitionIndex && edge.agentId === selection.agentId
      ? { accented: true, opacity: 1 }
      : { accented: false, opacity: 0.24 };
  }
  const accented = hovered || selection?.type === 'route' || selection?.type === 'agent';
  return { accented, opacity: accented ? 0.9 : 0.62 };
}

export function sharedRegionIds(activities: MapActivity[], agentIds: string[]): string[] {
  if (agentIds.length < 2) return [];
  const selected = new Set(agentIds);
  const agentsByRegion = new Map<string, Set<string>>();
  for (const activity of activities) {
    if (!activity.regionId || !activity.agentId || !selected.has(activity.agentId)) continue;
    const agents = agentsByRegion.get(activity.regionId) ?? new Set<string>();
    agents.add(activity.agentId);
    agentsByRegion.set(activity.regionId, agents);
  }
  return [...agentsByRegion].filter(([, agents]) => agents.size > 1).map(([regionId]) => regionId);
}

export function buildScene(input: {
  activities: MapActivity[];
  filters: SemanticMapFilters;
  timeWindow: SemanticMapTimeWindow;
  geometry: RegionGeometry[];
  routes?: SemanticMapRoute[];
  dark: boolean;
  neutral: string;
  fileLabel: (count: number) => string;
}): SemanticMapScene {
  const activities = filterActivities(input.activities, input.filters, input.timeWindow);
  const windowEnd = timestamp(input.timeWindow.end);
  const referenceTime = input.timeWindow.end.startsWith('9999-') ? Date.now() : windowEnd;
  const duration = Math.max(1, referenceTime - timestamp(input.timeWindow.start));
  const geometry = geometryIndex(input.geometry);
  const colors = agentColors(activities, input.dark);
  const { marks, heatByRegion, ticks, trails } = buildMarks(
    activities,
    geometry,
    referenceTime,
    duration,
    colors,
    input.neutral,
  );
  const badges = buildBadges(activities, geometry, referenceTime, colors, input.neutral);
  return {
    activities,
    marks,
    ticks,
    trails,
    badges,
    edges: buildRouteEdges(
      input.routes ?? [],
      input.geometry,
      input.fileLabel,
      input.dark,
      input.neutral,
    ),
    heatByRegion,
    hasMotion:
      marks.some((mark) => mark.kind === 'read' || mark.kind === 'move') ||
      badges.some((badge) => badge.thinking || (badge.toolAgeMs ?? Infinity) < TOOL_DURATION_MS),
  };
}

export function hitRouteEdge(edge: RouteEdge, x: number, y: number, tolerance: number): boolean {
  let previousX = edge.startX;
  let previousY = edge.startY;
  for (let step = 1; step <= 20; step += 1) {
    const t = step / 20;
    const inverse = 1 - t;
    const currentX =
      inverse * inverse * edge.startX + 2 * inverse * t * edge.controlX + t * t * edge.endX;
    const currentY =
      inverse * inverse * edge.startY + 2 * inverse * t * edge.controlY + t * t * edge.endY;
    const dx = currentX - previousX;
    const dy = currentY - previousY;
    const lengthSquared = dx * dx + dy * dy;
    const projection = Math.max(
      0,
      Math.min(1, ((x - previousX) * dx + (y - previousY) * dy) / Math.max(1, lengthSquared)),
    );
    if (
      Math.hypot(x - (previousX + projection * dx), y - (previousY + projection * dy)) <= tolerance
    )
      return true;
    previousX = currentX;
    previousY = currentY;
  }
  return false;
}
