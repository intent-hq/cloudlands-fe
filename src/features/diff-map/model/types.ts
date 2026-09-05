import type { AgentAttribution } from '$features/file-tracking/types';

export type DiffMapSource =
  | { kind: 'working-tree'; workspaceId: string; snapshotId: string }
  | { kind: 'commit'; commitHash: string; snapshotId: string }
  | { kind: 'range'; base: string; head: string; snapshotId: string }
  | { kind: 'pr'; repository: string; prNumber: number; snapshotId: string }
  | { kind: 'chat-turn'; sessionId: string; turnId: string; snapshotId: string };

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

export interface DiffMapLineRange {
  start: number;
  end: number;
}

export interface DiffMapAnnotation {
  id: string;
  kind: 'attribution' | 'comment' | 'review' | 'changed-since-review' | 'test' | 'custom';
  fileId?: string;
  oldRange?: DiffMapLineRange;
  newRange?: DiffMapLineRange;
  label?: string;
  data?: Record<string, unknown>;
}

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
