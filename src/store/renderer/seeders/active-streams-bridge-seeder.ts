/**
 * Active Streams Bridge Seeder
 *
 * Bridges agent:get-active-streams to the daemon's cross-workspace
 * agent.listActive probe — one daemon-global request, never a per-workspace
 * fan-out.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { AGENT_CHANNELS } from '$shared/ipc/channels';
import { backendRequest } from '$lib/client/live/backend-transport';
import type { ActiveStream } from '$features/agent/services/active-streams-tracker';

interface AgentListActiveResult {
  streams: ActiveStream[];
}

/**
 * Last successfully resolved active-streams snapshot. Served back on ANY
 * `agent.listActive` failure — including a `-32601` METHOD_NOT_FOUND — so a
 * slow/overloaded daemon degrades to a stale read instead of issuing more
 * RPCs. The former `workspace.list` → `agent.list` fan-out was removed: every
 * supported daemon serves `agent.listActive`, and fanning out O(workspaces)
 * `agent.list` calls on a failure only amplified load (monorepo#1395). Mirrors
 * the main-process handler in agent-missing.ipc.ts.
 */
let lastKnownActiveStreams: ActiveStream[] = [];

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
    // Any failure (timeout, connection drop, internal error, method not
    // found) — serve the last known snapshot rather than issuing more RPCs
    // against a daemon that is already struggling.
    console.warn('agent.listActive failed; returning last known active streams', error);
    return lastKnownActiveStreams;
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
