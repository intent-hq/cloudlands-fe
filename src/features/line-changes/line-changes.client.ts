/**
 * Line-change metrics client — daemon-backed reads (PROTOCOL §5.20).
 *
 * Formerly invoked `line-changes:*` IPC against main-process in-memory
 * Records (module-level state lost on restart and never fed by daemon-spawned
 * agents — split-brain). The four §5.20 wire reads now go over
 * `backendRequest`; the local `update*` writers and diff calculation were
 * backend-internal (aggregation happens in intentd, PROTOCOL.md §5.20) and
 * were deleted, not ported. Transport errors propagate to the caller so the
 * lifecycle read service can fold them into the request-state actions.
 */

import { backendRequest } from '$lib/client/live/backend-transport';

/** §5.20 `Metrics` — workspace-level stats include `byAgent`; per-agent stats omit it. */
export interface Metrics {
  additions: number;
  deletions: number;
  filesChanged: number;
  byAgent?: Record<string, { additions: number; deletions: number; filesChanged: number }>;
}

/** Coerce a raw daemon `Metrics` payload; `null` when the daemon has no stats. */
function toMetrics(raw: unknown): Metrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    additions: typeof r.additions === 'number' ? r.additions : 0,
    deletions: typeof r.deletions === 'number' ? r.deletions : 0,
    filesChanged: typeof r.filesChanged === 'number' ? r.filesChanged : 0,
    ...(r.byAgent && typeof r.byAgent === 'object'
      ? { byAgent: r.byAgent as Metrics['byAgent'] }
      : {}),
  };
}

/** `metrics.getWorkspaceStats` — workspace line-change totals, or null when untracked. */
export async function getWorkspaceLineStats(workspaceId: string): Promise<Metrics | null> {
  return toMetrics(await backendRequest<unknown>('metrics.getWorkspaceStats', { workspaceId }));
}

/** `metrics.getAgentStats` — one agent's line-change totals, or null when untracked. */
export async function getAgentLineStats(agentId: string): Promise<Metrics | null> {
  return toMetrics(await backendRequest<unknown>('metrics.getAgentStats', { agentId }));
}

/** `metrics.getAllWorkspaceStats` — `{ [workspaceId]: Metrics }` for all workspaces. */
export async function getAllWorkspaceLineStats(): Promise<Record<string, Metrics>> {
  const result = await backendRequest<unknown>('metrics.getAllWorkspaceStats', {});
  if (!result || typeof result !== 'object') return {};
  const stats: Record<string, Metrics> = {};
  for (const [workspaceId, value] of Object.entries(result as Record<string, unknown>)) {
    const metrics = toMetrics(value);
    if (metrics) stats[workspaceId] = metrics;
  }
  return stats;
}

/** `metrics.clearAgentStats` — resets one agent's counters; folds to a boolean. */
export async function clearAgentLineStats(agentId: string): Promise<boolean> {
  const result = await backendRequest<unknown>('metrics.clearAgentStats', { agentId });
  return Boolean(
    result && typeof result === 'object' && (result as { success?: unknown }).success === true,
  );
}
