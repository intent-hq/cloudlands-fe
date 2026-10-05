/**
 * Line-change metrics client — daemon-backed reads (PROTOCOL §5.20).
 *
 * Agent totals are read through `backendRequest`. Transport errors propagate
 * to the lifecycle read service, which folds them into request-state actions.
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

/** `metrics.getAgentStats` — one agent's line-change totals, or null when untracked. */
export async function getAgentLineStats(
  agentId: string,
  workspaceId?: string,
): Promise<Metrics | null> {
  return toMetrics(
    await backendRequest<unknown>('metrics.getAgentStats', {
      agentId,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    }),
  );
}
