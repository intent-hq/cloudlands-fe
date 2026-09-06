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

export interface SemanticMapGeometry {
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

export interface AgentBadge {
  id: string;
  name: string;
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
  badges: AgentBadge[];
  edges: RouteEdge[];
  heatByRegion: Record<string, number>;
  hasMotion: boolean;
}
