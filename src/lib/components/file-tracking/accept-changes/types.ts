/**
 * Accept Changes Panel Types
 *
 * Type definitions for the redesigned accept changes workflow.
 */

import type { LocalCommitInfo } from '$features/accept-changes/types';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

/** Open in target options */
export type OpenInTarget = 'vscode' | 'terminal' | 'finder';

/** Agent attribution for file changes */
export interface FileChangeAttribution {
  agentId: string;
  agentName: string;
  sessionId?: string;
  turnNumber?: number;
  timestamp?: number;
}

/**
 * UI file change with staging info for the accept-changes panel.
 * This is distinct from the shared FileChange in change-detector.types.ts
 * because it includes UI-specific fields like staged and attribution.
 */
export interface UIFileChange {
  path: string;
  additions: number;
  deletions: number;
  staged: boolean;
  status?: 'added' | 'modified' | 'deleted' | 'renamed';
  attribution?: FileChangeAttribution;
  /** Whether this file is locked due to active agent work (auto-commit pending) */
  locked?: boolean;
  /** Tooltip message explaining why the file is locked */
  lockReason?: string;
}

/** @deprecated Use UIFileChange instead - alias for backwards compatibility */
export type FileChange = UIFileChange;

/** Group of file changes by agent */
export interface AgentChangeGroup {
  agentId: string | null; // null for manual/unknown changes
  agentName: string;
  files: UIFileChange[];
  stats: ChangeStats;
  /** Whether this group is locked due to active agent work (auto-commit pending) */
  locked?: boolean;
  /** Tooltip message explaining why the group is locked */
  lockReason?: string;
}

/** Group files by agent attribution */
export function groupFilesByAgent(files: UIFileChange[]): AgentChangeGroup[] {
  const groups = new Map<string, UIFileChange[]>();
  // Track seen file paths per agent to prevent duplicates which cause Svelte {#each} key errors
  const seenPaths = new Map<string, Set<string>>();

  for (const file of files) {
    const agentId = file.attribution?.agentId ?? 'manual';
    let groupFiles = groups.get(agentId);
    let agentSeenPaths = seenPaths.get(agentId);
    if (!groupFiles || !agentSeenPaths) {
      groupFiles = [];
      agentSeenPaths = new Set();
      groups.set(agentId, groupFiles);
      seenPaths.set(agentId, agentSeenPaths);
    }

    // Skip duplicates within the same agent group
    if (agentSeenPaths.has(file.path)) continue;
    agentSeenPaths.add(file.path);

    groupFiles.push(file);
  }

  // Convert to array and calculate stats
  const result: AgentChangeGroup[] = [];
  for (const [agentId, groupFiles] of groups) {
    const firstFile = groupFiles.find((f) => f.attribution);
    result.push({
      agentId: agentId === 'manual' ? null : agentId,
      agentName: firstFile?.attribution?.agentName ?? 'Manual Changes',
      files: groupFiles,
      stats: calculateStats(groupFiles),
    });
  }

  // Sort: agent changes first (by most recent), then manual changes last
  result.sort((a, b) => {
    if (a.agentId === null) return 1;
    if (b.agentId === null) return -1;
    // Sort by most recent timestamp
    const aTime = Math.max(...a.files.map((f) => f.attribution?.timestamp ?? 0));
    const bTime = Math.max(...b.files.map((f) => f.attribution?.timestamp ?? 0));
    return bTime - aTime;
  });

  return result;
}

/** Stats for a group of changes */
export interface ChangeStats {
  fileCount: number;
  additions: number;
  deletions: number;
}

/** PR status for display */
export type PRDisplayStatus = 'open' | 'merged' | 'closed' | 'draft';

/** Pull request info for display */
export interface PRInfo {
  number: number;
  title: string;
  url: string;
  htmlUrl: string;
  status: PRDisplayStatus;
  commits?: LocalCommitInfo[];
  createdAt?: string;
  updatedAt?: string;
}

/** Bucket visibility state */
export interface BucketState {
  expanded: boolean;
  visible: boolean;
}

/** Commit panel state */
export interface CommitPanelState {
  expanded: boolean;
  message: string;
  isGenerating: boolean;
  isCommitting: boolean;
}

/** Push panel state */
export interface PushPanelState {
  isPushing: boolean;
  error?: string;
}

/** Create PR panel state */
export interface CreatePRPanelState {
  expanded: boolean;
  title: string;
  body: string;
  isGenerating: boolean;
  isCreating: boolean;
}

/** Props for CollapsibleBucket */
export interface CollapsibleBucketProps {
  title: string;
  icon?: IconDefinition;
  count?: number;
  stats?: ChangeStats;
  expanded?: boolean;
  onToggle?: () => void;
  class?: string;
}

/** Props for FileList */
export interface FileListProps {
  files: UIFileChange[];
  muted?: boolean;
  showStageButtons?: boolean;
  onFileClick?: (path: string) => void;
  onStage?: (path: string) => void;
  onUnstage?: (path: string) => void;
}

/** Calculate stats from files */
export function calculateStats(files: UIFileChange[]): ChangeStats {
  return {
    fileCount: files.length,
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
  };
}

/** Calculate stats from commits */
export function calculateCommitStats(commits: LocalCommitInfo[]): ChangeStats {
  let additions = 0;
  let deletions = 0;
  let fileCount = 0;

  for (const commit of commits) {
    fileCount += commit.filesChanged ?? 0;
    for (const file of commit.files ?? []) {
      additions += file.additions;
      deletions += file.deletions;
    }
  }

  return { fileCount, additions, deletions };
}

/** Get file status icon info */
export function getFileStatusInfo(file: UIFileChange): {
  color: string;
  bg: string;
  label: string;
} {
  // Use explicit status if available
  if (file.status === 'added') {
    return { color: 'text-green-500', bg: 'bg-green-500/10', label: 'Added' };
  }
  if (file.status === 'deleted') {
    return { color: 'text-red-500', bg: 'bg-red-500/10', label: 'Deleted' };
  }
  if (file.status === 'modified' || file.status === 'renamed') {
    return { color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Modified' };
  }

  // Fallback to stats-based heuristic (for backward compatibility)
  if (file.additions > 0 && file.deletions === 0) {
    return { color: 'text-green-500', bg: 'bg-green-500/10', label: 'Added' };
  }
  if (file.deletions > 0 && file.additions === 0) {
    return { color: 'text-red-500', bg: 'bg-red-500/10', label: 'Deleted' };
  }
  return { color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Modified' };
}
