export type MapSource = 'curated' | 'structural';

export type RegionAnchor = [x: number, y: number];

export interface Region {
  id: string;
  label: string;
  responsibility: string;
  parent?: string;
  anchor: RegionAnchor;
  paths: string[];
  color?: string;
}

export interface Crossing {
  from: string;
  to: string;
  label: string;
}

export interface Manifest {
  version: 1;
  regions: Region[];
  crossings?: Crossing[];
}

export type AssignmentConfidence = 'curated' | 'unsorted';

export interface Assignment {
  regionId: string;
  confidence: AssignmentConfidence;
}

export type MapActivityKind = 'read' | 'edit' | 'create' | 'delete' | 'move' | 'tool' | 'thinking';

export interface MapActivity {
  regionId?: string;
  agentId?: string;
  agentName?: string;
  path?: string;
  kind: MapActivityKind;
  ts: string;
}

export interface RouteTransition {
  from: string;
  to: string;
  count: number;
  evidence: string[];
  label?: string;
}

export interface Route {
  visits: string[];
  transitions: RouteTransition[];
}

export interface MapCoverage {
  matched: number;
  total: number;
}

export interface SemanticMapSnapshot {
  manifest: Manifest;
  source: MapSource;
  coverage: MapCoverage;
}
