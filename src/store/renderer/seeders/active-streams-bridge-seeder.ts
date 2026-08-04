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
    return result.streams.map(({ agentId, sessionId, workspaceId, startTime }) => ({
      agentId,
      sessionId,
      workspaceId,
      startTime,
    }));
  } catch (error) {
    // Compatibility fallback: shipped FE versions may briefly run against a
    // pre-PROTOCOL-4.1 sidecar that does not implement agent.listActive yet.
    console.warn('agent.listActive unavailable; using legacy active-streams probe', error);
    return getLegacyActiveStreamsFromDaemon();
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
