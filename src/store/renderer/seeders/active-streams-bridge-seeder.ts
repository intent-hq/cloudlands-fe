/**
 * Active Streams Bridge Seeder
 *
 * Bridges agent:get-active-streams to the daemon's cross-workspace
 * agent.listActive probe. Older sidecars fall back to the legacy
 * workspace.list → agent.list fan-out for compatibility.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { AGENT_CHANNELS } from '$shared/ipc/channels';
import { backendRequest } from '$lib/client/live/backend-transport';
import type { ActiveStream } from '$features/agent/services/active-streams-tracker';

interface WorkspaceListResult {
  workspaces?: Array<{ id?: unknown; workspaceId?: unknown }>;
}

interface AgentListResult {
  agents?: Array<{
    id?: unknown;
    isStreaming?: boolean;
    isResponding?: boolean;
    updatedAt?: string;
  }>;
}

interface AgentListActiveResult {
  streams: ActiveStream[];
}

/**
 * Last successfully resolved active-streams snapshot. Served back on a
 * transient `agent.listActive` failure so a slow/overloaded daemon degrades
 * to a stale read instead of triggering the legacy fan-out — mirrors the
 * main-process handler in agent-missing.ipc.ts.
 */
let lastKnownActiveStreams: ActiveStream[] = [];

/**
 * The legacy `workspace.list` → `agent.list` fan-out is only a safe substitute
 * for `agent.listActive` when the daemon genuinely predates the method
 * (JSON-RPC -32601 / `METHOD_NOT_FOUND`). Any other failure (timeout,
 * connection drop, internal error) means the daemon is already struggling, and
 * fanning out into O(workspaces) extra RPCs would amplify that load —
 * precisely the load ⇒ timeout ⇒ fan-out ⇒ more load loop this guards against
 * (monorepo#1395).
 *
 * Checks the structured `code`/`rpcCode` fields only — never the error
 * message — so a daemon error whose message happens to contain "method not
 * found" (e.g. an internal error surfacing an unrelated method name) is not
 * misclassified as a genuine `METHOD_NOT_FOUND` and does not trigger the
 * fan-out.
 */
function isMethodNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    if ((error as { code?: unknown }).code === 'METHOD_NOT_FOUND') return true;
    if ((error as { rpcCode?: unknown }).rpcCode === -32601) return true;
  }
  return false;
}

/**
 * Legacy compatibility path for sidecars without agent.listActive.
 */
async function getLegacyActiveStreamsFromDaemon(): Promise<ActiveStream[]> {
  const workspaceListResult = (await backendRequest<WorkspaceListResult>('workspace.list')) as
    WorkspaceListResult | undefined;
  const workspaces = Array.isArray(workspaceListResult?.workspaces)
    ? workspaceListResult.workspaces
    : [];

  const perWorkspace = await Promise.all(
    workspaces.map(async (ws) => {
      const workspaceId = String(ws.id ?? ws.workspaceId ?? '');
      if (!workspaceId) return [];

      try {
        const agentListResult = (await backendRequest<AgentListResult>('agent.list', {
          workspaceId,
        })) as AgentListResult | undefined;
        const agents = Array.isArray(agentListResult?.agents) ? agentListResult.agents : [];

        return agents
          .filter((agent) => agent.isStreaming === true || agent.isResponding === true)
          .map((agent) => {
            const agentId = String(agent.id ?? '');
            const parsed = agent.updatedAt ? Date.parse(agent.updatedAt) : NaN;
            const startTime = Number.isFinite(parsed) ? parsed : 0;
            return { agentId, sessionId: agentId, workspaceId, startTime };
          })
          .filter((entry) => entry.agentId.length > 0);
      } catch {
        // agent.list failed for this workspace; skip it (mirrors main handler)
        return [];
      }
    }),
  );

  return perWorkspace.flat();
}

async function getActiveStreamsFromDaemon(): Promise<ActiveStream[]> {
  try {
    const result = await backendRequest<AgentListActiveResult>('agent.listActive');
    const activeStreams = result.streams.map(({ agentId, sessionId, workspaceId, startTime }) => ({
      agentId,
      sessionId,
      workspaceId,
      startTime,
    }));
    lastKnownActiveStreams = activeStreams;
    return activeStreams;
  } catch (error) {
    if (!isMethodNotFoundError(error)) {
      // Transient failure (timeout, connection drop, internal error) — the
      // daemon is already struggling, so serve the last known snapshot
      // instead of fanning out into the legacy workspace.list + agent.list
      // per-workspace probe, which would only add more load.
      console.warn(
        'agent.listActive failed transiently; returning last known active streams',
        error,
      );
      return lastKnownActiveStreams;
    }
    // Compatibility fallback: shipped FE versions may briefly run against a
    // pre-PROTOCOL-4.1 sidecar that does not implement agent.listActive yet.
    console.warn('agent.listActive unavailable; using legacy active-streams probe', error);
    const activeStreams = await getLegacyActiveStreamsFromDaemon();
    lastKnownActiveStreams = activeStreams;
    return activeStreams;
  }
}

// Register the handler at import time (host-bridge-seeder idiom)
registerMockIpcHandler(AGENT_CHANNELS.GET_ACTIVE_STREAMS, async () => {
  try {
    const activeStreams = await getActiveStreamsFromDaemon();
    return { success: true, data: activeStreams };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      data: [],
    };
  }
});
