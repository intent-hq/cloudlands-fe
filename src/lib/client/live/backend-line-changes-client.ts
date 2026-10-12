import type { Metrics } from '../lifecycle-read-client-types';
import type { BackendRuntime } from './backend-transport-runtime';

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

/** Bind canonical metric reads to the owning renderer's backend without starting a request. */
export function createBackendLineChangesClient(backend: Pick<BackendRuntime, 'backendRequest'>) {
  const { backendRequest } = backend;

  /** `metrics.getAgentStats` — one agent's line-change totals, or null when untracked. */
  async function getAgentLineStats(agentId: string, workspaceId?: string): Promise<Metrics | null> {
    return toMetrics(
      await backendRequest<unknown>('metrics.getAgentStats', {
        agentId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      }),
    );
  }

  return { getAgentLineStats };
}
