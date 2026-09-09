import type { Manifest, MapActivity, MapActivityKind, Route } from '../core/types';
import type { RegionGeometry } from '../layout/place';

export type SemanticMapSelection =
  | { type: 'region'; regionIds: string[] }
  | { type: 'agent'; agentIds: string[]; pinnedRegionIds?: string[] }
  | { type: 'route'; agentId?: string; transitionIndex?: number; pinnedRegionIds?: string[] }
  | null;

export interface SemanticMapRoute {
  agentId?: string;
  route: Route;
}

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
  routes?: SemanticMapRoute[];
  selection: SemanticMapSelection;
  filters: SemanticMapFilters;
  timeWindow: SemanticMapTimeWindow;
  width: number;
  height: number;
  onSelectRegion?: (regionIds: string[]) => void;
  onSelectAgent?: (agentId: string, additive: boolean) => void;
  onSelectRoute?: (agentId: string | undefined, transitionIndex: number) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
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

interface AgentTrailPoint {
  x: number;
  y: number;
  alpha: number;
}

export interface AgentTrail {
  agentId: string;
  color: string;
  points: AgentTrailPoint[];
}

export interface FocusEvidenceItem {
  id: string;
  label: string;
  kind: MapActivityKind;
  color: string;
  x: number;
  y: number;
  path?: string;
  count?: number;
}

export interface FocusContent {
  regionId: string;
  mode: 'files' | 'subregions';
  items: FocusEvidenceItem[];
}

export interface AgentBadge {
  id: string;
  name: string;
  regionId?: string;
  kind: MapActivityKind;
  x: number;
  y: number;
  color: string;
  thinking: boolean;
  toolAgeMs?: number;
}

export interface RouteEdge {
  agentId?: string;
  transitionIndex: number;
  color: string;
  from: string;
  to: string;
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
  endX: number;
  endY: number;
  midpointX: number;
  midpointY: number;
  arrowX: number;
  arrowY: number;
  arrowAngle: number;
  step: number;
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
