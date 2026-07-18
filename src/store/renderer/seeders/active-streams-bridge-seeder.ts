/**
 * Active Streams Bridge Seeder
 *
 * Bridges agent:get-active-streams to real daemon data in the renderer.
 * Queries workspace.list → agent.list per workspace and filters on
 * isStreaming === true || isResponding === true, mirroring the main-process
 * handler in src/features/agent/main/agent-missing.ipc.ts.
 *
 * The tracker's ActiveStream interface expects:
 *   { agentId, sessionId, workspaceId, startTime }
 * where agentId = sessionId = AgentLite.id, and startTime is Date.parse(updatedAt) or 0.
 *
 * Per-workspace agent.list failures are swallowed (returning [] for that
 * workspace) and the overall result is still { success: true, data }. Only
 * workspace.list failure returns { success: false, error, data: [] }. Never
 * throws; the channel is always bridged (the tracker reads result.success).
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

/**
 * Fetch active streams from the daemon: workspace.list → agent.list per
 * workspace → filter on isStreaming || isResponding → map to ActiveStream shape.
 */
async function getActiveStreamsFromDaemon(): Promise<ActiveStream[]> {
  // Query workspace.list
  const workspaceListResult = (await backendRequest<WorkspaceListResult>('workspace.list')) as
    | WorkspaceListResult
    | undefined;
  const workspaces = Array.isArray(workspaceListResult?.workspaces)
    ? workspaceListResult.workspaces
    : [];

  // Query agent.list per workspace in parallel
  const perWorkspace = await Promise.all(
    workspaces.map(async (ws) => {
      const workspaceId = String(ws.id ?? ws.workspaceId ?? '');
      if (!workspaceId) return [];

      try {
        const agentListResult = (await backendRequest<AgentListResult>('agent.list', {
          workspaceId,
        })) as AgentListResult | undefined;
        const agents = Array.isArray(agentListResult?.agents) ? agentListResult.agents : [];

        // Filter on isStreaming || isResponding
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
