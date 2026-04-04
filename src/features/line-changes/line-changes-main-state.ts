/**
 * Line Changes Main-Process State
 *
 * Simple module-level state for tracking line change statistics in the main process.
 * Replaces the old EventEmitter-based LineChangesStore with plain Records and functions.
 */

import { Logger } from '../../shared/logger';
import type { AgentId } from '$shared/types/branded-ids';
import type { WorkspaceId } from '../../shared/types';

const logger = new Logger('LineChangesMainState');

export interface LineChangeStats {
  additions: number;
  deletions: number;
  timestamp: string;
}

export interface FileLineChange {
  path: string;
  additions: number;
  deletions: number;
  action: 'create' | 'modify' | 'delete';
}

// Module-level state (plain Records, no EventEmitter)
let workspaceStats: Record<string, LineChangeStats> = {};
let agentStats: Record<string, LineChangeStats> = {};
let fileChanges: Record<string, FileLineChange[]> = {};

export function getWorkspaceStats(workspaceId: WorkspaceId): LineChangeStats | undefined {
  return workspaceStats[workspaceId];
}

export function getAllWorkspaceStats(): Record<string, LineChangeStats> {
  return { ...workspaceStats };
}

export function getAgentStats(agentId: AgentId): LineChangeStats | undefined {
  return agentStats[agentId];
}

export function updateWorkspaceStats(
  workspaceId: WorkspaceId,
  stats: Partial<LineChangeStats>,
): void {
  const existing = workspaceStats[workspaceId];
  workspaceStats[workspaceId] = {
    additions: stats.additions ?? existing?.additions ?? 0,
    deletions: stats.deletions ?? existing?.deletions ?? 0,
    timestamp: stats.timestamp || new Date().toISOString(),
  };
  logger.info(`Updated workspace stats for ${workspaceId}`);
}

export function updateAgentStats(agentId: AgentId, stats: Partial<LineChangeStats>): void {
  const existing = agentStats[agentId];
  agentStats[agentId] = {
    additions: stats.additions ?? existing?.additions ?? 0,
    deletions: stats.deletions ?? existing?.deletions ?? 0,
    timestamp: stats.timestamp || new Date().toISOString(),
  };
  logger.debug(`Updated agent stats for ${agentId}`);
}

export function trackFileChanges(id: WorkspaceId | AgentId, changes: FileLineChange[]): void {
  const existing = fileChanges[id] || [];
  const changeMap = new Map<string, FileLineChange>();
  existing.forEach((c) => changeMap.set(c.path, c));
  changes.forEach((c) => changeMap.set(c.path, c));

  const updated = Array.from(changeMap.values());
  fileChanges[id] = updated;

  const stats = updated.reduce(
    (acc, c) => ({
      additions: acc.additions + c.additions,
      deletions: acc.deletions + c.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  const isAgentId = id.startsWith('agent-');
  if (isAgentId) {
    updateAgentStats(id as AgentId, stats);
  } else {
    updateWorkspaceStats(id as WorkspaceId, stats);
  }

  logger.info(`Tracked ${changes.length} file changes for ${id}, total files: ${updated.length}`);
}

export function clearWorkspaceStats(workspaceId: WorkspaceId): void {
  delete workspaceStats[workspaceId];
  delete fileChanges[workspaceId];
  logger.info(`Cleared workspace stats for ${workspaceId}`);
}

export function clearAgentStats(agentId: AgentId): void {
  delete agentStats[agentId];
  delete fileChanges[agentId];
  logger.info(`Cleared agent stats for ${agentId}`);
}

export function clearAll(): void {
  workspaceStats = {};
  agentStats = {};
  fileChanges = {};
  logger.info('Cleared all line change statistics');
}

