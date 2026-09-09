import type { Manifest, MapActivity, MapActivityKind, Route } from '../core/types';
import type { RegionGeometry } from '../layout/place';

export type SemanticMapSelection =
  | { type: 'region'; regionIds: string[] }
  | { type: 'agent'; agentId: string }
  | { type: 'route' }
  | null;

export interface SemanticMapFilters {
  agentIds?: string[];
  kinds?: MapActivityKind[];
}

export interface SemanticMapTimeWindow {
  start: string;
  end: string;
}

interface SemanticMapGeometry {
  rest: RegionGeometry[];
  focus: RegionGeometry[];
}

export interface SemanticMapCanvasProps {
  manifest: Manifest;
  geometry: SemanticMapGeometry;
  activities: MapActivity[];
  route?: Route;
  selection: SemanticMapSelection;
  filters: SemanticMapFilters;
  timeWindow: SemanticMapTimeWindow;
  width: number;
  height: number;
  onSelectRegion?: (regionIds: string[]) => void;
  onSelectAgent?: (agentId: string) => void;
  onSelectRoute?: () => void;
  onClearSelection?: () => void;
}

export interface ActivityMark {
  kind: Exclude<MapActivityKind, 'tool' | 'thinking'>;
  x: number;
  y: number;
  fromX?: number;
  fromY?: number;
  alpha: number;
  ageMs: number;
  color: string;
}

export type HeatBand = 0 | 1 | 2 | 3;

export interface ActivityTick {
  regionId: string;
  x: number;
  y: number;
  count: number;
  color: string;
}

export interface AgentTrailPoint {
  x: number;
  y: number;
  alpha: number;
}

export interface AgentTrail {
  agentId: string;
  color: string;
  points: AgentTrailPoint[];
}

export interface AgentBadge {
  id: string;
  name: string;
  kind: MapActivityKind;
  x: number;
  y: number;
  color: string;
  thinking: boolean;
  toolAgeMs?: number;
}

export interface RouteEdge {
  from: string;
  to: string;
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
  endX: number;
  endY: number;
  count: number;
  label: string;
  evidence: string[];
}

export interface SemanticMapScene {
  activities: MapActivity[];
  marks: ActivityMark[];
  ticks: ActivityTick[];
  trails: AgentTrail[];
  badges: AgentBadge[];
  edges: RouteEdge[];
  heatByRegion: Record<string, HeatBand>;
  hasMotion: boolean;
}
