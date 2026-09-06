/**
 * Accept Changes Panel Types
 *
 * Type definitions for the redesigned accept changes workflow.
 */

import type { LocalCommitInfo } from '$features/accept-changes/types';
import type { PrMonitorSnapshot } from '$features/pr-monitor/pr-monitor-service';
import { m } from '$shared/paraglide/messages.js';

/** Agent attribution for file changes */
interface FileChangeAttribution {
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
  /** Previous path when this file represents a rename. */
  renamedFrom?: string;
  attribution?: FileChangeAttribution;
  /** Whether this file is locked due to active agent work (auto-commit pending) */
  locked?: boolean;
  /** Tooltip message explaining why the file is locked */
  lockReason?: string;
}

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
      agentName: firstFile?.attribution?.agentName ?? m.fileTracking_changes_manualChanges_label(),
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
interface ChangeStats {
  fileCount: number;
  additions: number;
  deletions: number;
}

/** PR status for display */
type PRDisplayStatus = 'open' | 'merged' | 'closed' | 'draft';

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
  /** Set on rows sourced from an agent PR monitor (PROTOCOL §6.9). */
  monitorAgentId?: string;
  /** `<owner>/<name>` when the monitored PR's repo differs from the workspace repo. */
  crossRepo?: string;
  /** Display-only short form of `crossRepo`: the owner segment is dropped when
   * it matches the workspace repo owner. `crossRepo` keeps the full identity
   * for row keys (see intent-hq/monorepo#1699). */
  crossRepoDisplay?: string;
  /** Monitor's last merge-requirements snapshot (PROTOCOL §6.9) for hover status. */
  monitorSnapshot?: PrMonitorSnapshot;
  /** Row exists only as a monitor (no matching workspace PR) — local
   * commit/file data does not apply to it. */
  monitorOnly?: boolean;
}

/** Calculate stats from files */
function calculateStats(files: UIFileChange[]): ChangeStats {
  return {
    fileCount: files.length,
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
  };
}
