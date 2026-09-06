import type { AgentAttribution } from '$features/file-tracking/types';

export type DiffMapSourceIdentity =
  | { kind: 'working-tree'; workspaceId: string }
  | { kind: 'commit'; commitHash: string }
  | { kind: 'range'; base: string; head: string }
  | { kind: 'pr'; repository: string; prNumber: number }
  | { kind: 'chat-turn'; sessionId: string; turnId: string };

export type DiffMapSource = DiffMapSourceIdentity & { snapshotId: string };

export type DiffMapFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary' | 'mode';

export interface DiffMapAttribution {
  agent?: AgentAttribution;
  manual?: boolean;
  timestamp: number;
}

export interface DiffMapFile {
  /** Stable repository-relative path identity. */
  id: string;
  path: string;
  name: string;
  dir: string;
  status: DiffMapFileStatus;
  additions: number;
  deletions: number;
  statsKnown: boolean;
  renamedFrom?: string;
  /** Alternating normalized position and weight values: [position, weight, ...]. */
  oldTrack?: number[];
  /** Alternating normalized position and weight values: [position, weight, ...]. */
  newTrack?: number[];
  hunks?: DiffMapHunk[];
  attribution?: DiffMapAttribution;
  contentHash?: string;
}

export interface DiffMapGroup {
  id: string;
  path: string;
  /** Path segments before displayName, including the trailing slash. */
  displayPrefix: string;
  displayName: string;
  fileIds: string[];
  changedCount: number;
  totalCount?: number;
}

export interface DiffMapSection {
  id: string;
  path: string;
  displayPrefix: string;
  displayName: string;
  groupIds: string[];
  changedCount: number;
  totalCount?: number;
}

interface DiffMapLineRange {
  start: number;
  end: number;
}

export interface DiffMapHunk {
  oldRange?: DiffMapLineRange;
  newRange?: DiffMapLineRange;
}

export interface ReviewSliceEntry {
  path: string;
  hunks?: DiffMapHunk[];
  contentHash: string;
}

export interface ReviewSlice {
  source: DiffMapSourceIdentity;
  snapshotId: string;
  entries: ReviewSliceEntry[];
}

interface DiffMapFactAnnotation {
  id: string;
  kind: 'attribution' | 'comment' | 'review' | 'changed-since-review' | 'test' | 'custom';
  fileId?: string;
  oldRange?: DiffMapLineRange;
  newRange?: DiffMapLineRange;
  label?: string;
  data?: Record<string, unknown>;
}

export interface DiffMapClaimAnnotation {
  id: string;
  kind: 'claim';
  label: string;
  paths: string[];
  hunks?: unknown[];
  provenance: string | Record<string, unknown>;
}

export interface DiffMapGroupAnnotation {
  id: string;
  kind: 'group';
  label: string;
  paths: string[];
}

export type DiffMapAnnotation =
  DiffMapFactAnnotation | DiffMapClaimAnnotation | DiffMapGroupAnnotation;

export interface DiffMapDocument {
  source: DiffMapSource;
  files: DiffMapFile[];
  groups: DiffMapGroup[];
  sections?: DiffMapSection[];
  annotations: DiffMapAnnotation[];
}

export interface DiffMapRepoTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: readonly DiffMapRepoTreeNode[];
}
