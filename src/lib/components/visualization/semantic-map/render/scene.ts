import { agentColorPalette } from '$lib/utils/agent-colors';
import type { MapActivity, Route } from '../core/types';
import type { RegionGeometry } from '../layout/place';
import type {
  ActivityMark,
  AgentBadge,
  RouteEdge,
  SemanticMapFilters,
  SemanticMapScene,
  SemanticMapTimeWindow,
} from './types';

const READ_DURATION_MS = 2_000;
const MOVE_DURATION_MS = 1_000;
const TOOL_DURATION_MS = 1_200;
const BADGE_RADIUS = 13;
const AGENT_HUE_LIMIT = 8;

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
  const agents = filters.agentIds ? new Set(filters.agentIds) : null;
  const kinds = filters.kinds ? new Set(filters.kinds) : null;
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

function buildMarks(
  activities: MapActivity[],
  geometry: Map<string, RegionGeometry>,
  end: number,
  duration: number,
  colors: Map<string, string>,
): { marks: ActivityMark[]; heatByRegion: Record<string, number> } {
  const marks: ActivityMark[] = [];
  const heatByRegion: Record<string, number> = {};
  const previousRegion = new Map<string, RegionGeometry>();
  for (const activity of activities) {
    if (!activity.regionId || activity.kind === 'tool' || activity.kind === 'thinking') continue;
    const region = geometry.get(activity.regionId);
    if (!region) continue;
    const ageMs = Math.max(0, end - timestamp(activity.ts));
    const alpha = Math.max(0.12, 1 - ageMs / duration);
    const agentId = activity.agentId ?? '';
    const color = colors.get(agentId) ?? agentColorPalette[AGENT_HUE_LIMIT];
    const [x, y] = markPosition(activity, region);
    const from = previousRegion.get(agentId);
    previousRegion.set(agentId, region);
    if (activity.kind === 'read' && ageMs > READ_DURATION_MS) continue;
    if (activity.kind === 'move' && ageMs > MOVE_DURATION_MS) continue;
    const mark: ActivityMark = { kind: activity.kind, x, y, alpha, ageMs, color };
    if (activity.kind === 'move' && from) {
      mark.fromX = from.x;
      mark.fromY = from.y;
    }
    marks.push(mark);
    if (activity.kind === 'edit' || activity.kind === 'create') {
      heatByRegion[activity.regionId] = Math.min(
        1,
        (heatByRegion[activity.regionId] ?? 0) + alpha * 0.3,
      );
    }
  }
  return { marks, heatByRegion };
}

function agentColors(activities: MapActivity[], neutral: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const activity of activities) {
    if (!activity.agentId || result.has(activity.agentId)) continue;
    const index = result.size;
    result.set(activity.agentId, index < AGENT_HUE_LIMIT ? agentColorPalette[index] : neutral);
  }
  return result;
}

function fanBadges(badges: AgentBadge[], regionIdByAgent: Map<string, string>): void {
  const groups = new Map<string, AgentBadge[]>();
  for (const badge of badges) {
    const regionId = regionIdByAgent.get(badge.id);
    if (!regionId) continue;
    const group = groups.get(regionId) ?? [];
    group.push(badge);
    groups.set(regionId, group);
  }
  for (const group of groups.values()) {
    if (group.length === 1) continue;
    group.forEach((badge, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, group.length - 1)) * Math.PI;
      const distance = BADGE_RADIUS + group.length * 2;
      badge.x += Math.cos(angle) * distance;
      badge.y += Math.sin(angle) * distance;
    });
  }
}

function buildBadges(
  activities: MapActivity[],
  geometry: Map<string, RegionGeometry>,
  end: number,
  colors: Map<string, string>,
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
      x: region?.x ?? 28 + unplaced++ * 34,
      y: region?.y ?? 28,
      color: colors.get(id) ?? agentColorPalette[AGENT_HUE_LIMIT],
      thinking: latest.kind === 'thinking',
    };
    if (latest.kind === 'tool') badge.toolAgeMs = Math.max(0, end - timestamp(latest.ts));
    return badge;
  });
  fanBadges(badges, latestRegionByAgent);
  return badges;
}

export function buildRouteEdges(
  route: Route | undefined,
  geometry: RegionGeometry[],
  fileLabel: (count: number) => string,
): RouteEdge[] {
  if (!route) return [];
  const byId = geometryIndex(geometry);
  return route.transitions.flatMap((transition, index) => {
    const from = byId.get(transition.from);
    const to = byId.get(transition.to);
    if (!from || !to) return [];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const bend = (index % 2 === 0 ? 1 : -1) * Math.min(42, Math.hypot(dx, dy) * 0.12);
    const length = Math.max(1, Math.hypot(dx, dy));
    return [
      {
        from: transition.from,
        to: transition.to,
        startX: from.x,
        startY: from.y,
        controlX: (from.x + to.x) / 2 - (dy / length) * bend,
        controlY: (from.y + to.y) / 2 + (dx / length) * bend,
        endX: to.x,
        endY: to.y,
        count: transition.count,
        label: transition.label ?? fileLabel(transition.evidence.length),
        evidence: transition.evidence,
      },
    ];
  });
}

export function buildScene(input: {
  activities: MapActivity[];
  filters: SemanticMapFilters;
  timeWindow: SemanticMapTimeWindow;
  geometry: RegionGeometry[];
  route?: Route;
  neutral: string;
  fileLabel: (count: number) => string;
}): SemanticMapScene {
  const activities = filterActivities(input.activities, input.filters, input.timeWindow);
  const end = timestamp(input.timeWindow.end);
  const duration = Math.max(1, end - timestamp(input.timeWindow.start));
  const geometry = geometryIndex(input.geometry);
  const colors = agentColors(activities, input.neutral);
  const { marks, heatByRegion } = buildMarks(activities, geometry, end, duration, colors);
  const badges = buildBadges(activities, geometry, end, colors);
  return {
    activities,
    marks,
    badges,
    edges: buildRouteEdges(input.route, input.geometry, input.fileLabel),
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
