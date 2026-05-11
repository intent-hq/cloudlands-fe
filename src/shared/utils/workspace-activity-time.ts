import type { Workspace } from '../types';

export type WorkspaceActivityTimeFields = Pick<
  Workspace,
  'lastActivity' | 'createdAt' | 'updatedAt'
>;

export type WorkspaceActivityTimeSource = 'lastActivity' | 'createdAt' | 'updatedAt' | 'none';

export interface WorkspaceActivityDisplayTime {
  time: number;
  source: WorkspaceActivityTimeSource;
}

function parseTimestamp(value: string | undefined | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function getWorkspaceActivityDisplayTimeInfo(
  workspace: WorkspaceActivityTimeFields,
): WorkspaceActivityDisplayTime {
  const lastActivity = parseTimestamp(workspace.lastActivity);
  if (lastActivity > 0) return { time: lastActivity, source: 'lastActivity' };

  const createdAt = parseTimestamp(workspace.createdAt);
  if (createdAt > 0) return { time: createdAt, source: 'createdAt' };

  const updatedAt = parseTimestamp(workspace.updatedAt);
  if (updatedAt > 0) return { time: updatedAt, source: 'updatedAt' };

  return { time: 0, source: 'none' };
}

export function getWorkspaceActivityDisplayTime(workspace: WorkspaceActivityTimeFields): number {
  return getWorkspaceActivityDisplayTimeInfo(workspace).time;
}

export function compareWorkspaceActivityDisplayTimeDesc(
  a: WorkspaceActivityTimeFields,
  b: WorkspaceActivityTimeFields,
): number {
  return getWorkspaceActivityDisplayTime(b) - getWorkspaceActivityDisplayTime(a);
}

export function isWorkspaceActivityWithin(
  workspace: WorkspaceActivityTimeFields,
  now: number,
  durationMs: number,
): boolean {
  const time = getWorkspaceActivityDisplayTime(workspace);
  return time > 0 && now - time < durationMs;
}