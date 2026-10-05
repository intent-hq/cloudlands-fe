import type { Workspace } from '$shared/types';

/** Home shows recorded content activity when supplied by the daemon.
 * Older daemons fall back to explicitly labelled creation, never maintenance metadata. */
export function homeActivity(
  workspace: Pick<Workspace, 'lastContentActivity' | 'lastActivity' | 'createdAt' | 'updatedAt'>,
) {
  const content = workspace.lastContentActivity ? Date.parse(workspace.lastContentActivity) : NaN;
  if (Number.isFinite(content) && content > 0) return { time: content, source: 'content' as const };
  const created = Date.parse(workspace.createdAt);
  return Number.isFinite(created) && created > 0
    ? { time: created, source: 'created' as const }
    : { time: 0, source: 'unknown' as const };
}
export function getHomeActivityTime(workspace: Parameters<typeof homeActivity>[0]) {
  return homeActivity(workspace).time;
}
export function compareHomeActivityDesc(
  a: Parameters<typeof homeActivity>[0],
  b: Parameters<typeof homeActivity>[0],
) {
  return getHomeActivityTime(b) - getHomeActivityTime(a);
}
