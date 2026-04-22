import type { FileNode, FileGitStatus, EnvironmentConfig } from "$shared/types";

// ---------------------------------------------------------------------------
// Flattened node for virtualized rendering
// ---------------------------------------------------------------------------

export interface FlattenedFileNode {
  node: FileNode;
  depth: number;
  /** Compacted path prefix (for single-child directory chains like "src/lib/components") */
  displayPath?: string;
  /** UI state computed from expandedPaths */
  isExpanded: boolean;
  /** UI state computed from loadingPaths */
  isLoading: boolean;
  /** Agent IDs who recently edited this file (derived from ws.agentFileEdits) */
  agentEdits?: string[];
  /** Git status for files (derived from ws.gitStatus[relativePath]) */
  gitStatus?: FileGitStatus;
  /** True for directories whose subtree contains at least one changed file (derived from ws.gitStatus) */
  directoryHasChanges?: boolean;
}

// ---------------------------------------------------------------------------
// Per-workspace state
// ---------------------------------------------------------------------------

export interface FileExplorerWorkspaceState {
  workspacePath: string;
  rootNode: FileNode | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  fileCount: number;
  /** Git status keyed by relative file path */
  gitStatus: Record<string, FileGitStatus>;
  /** Paths of expanded directories */
  expandedPaths: string[];
  /** Paths of directories currently loading children */
  loadingPaths: string[];
  /** Agent IDs keyed by relative file path */
  agentFileEdits: Record<string, string[]>;
  isBulkOperation: boolean;
  /** Incremented to force UI re-renders after deep tree mutations */
  treeVersion: number;
  gitignorePatterns: string[];
  environmentConfig?: EnvironmentConfig;
  remoteConnectionId: string | null;
  isRemoteInitialized: boolean;
  /** Whether this workspace's file explorer is active (false = abort pending async ops) */
  isStoreActive: boolean;
}

// ---------------------------------------------------------------------------
// Root state
// ---------------------------------------------------------------------------

export interface FileExplorerState {
  byWorkspaceId: Record<string, FileExplorerWorkspaceState>;
}

