/**
 * Daemon-backed "agents still running?" check for the quit flow.
 *
 * Live agent turns run inside the intentd daemon (`agent.sendMessage`,
 * PROTOCOL §5.5) — not in this process. The quit prompt therefore consults
 * the daemon's global mid-turn busy set (`agent.listActive`, §5.5), which is
 * the authoritative "active worker" signal, and resolves each busy agent's
 * display name with one `agent.get`. The previous shape — `workspace.list`
 * followed by one unscoped `agent.list` per workspace — pulled every
 * session row in the daemon at quit time; `agent.list` frames grow past
 * 1 MiB on large hosts (intent-hq/intent#5531), so the quit check must stay
 * bounded by the number of BUSY agents, not the number of sessions. The old
 * check read the main-process messageAccumulator Redux slice, which no
 * longer exists (the main-process store was removed in the port), so it
 * crashed on every quit.
 *
 * Fail-open by design: if the daemon is unreachable or a query fails, we
 * report no running agents so quit is never blocked by a dead backend.
 */

import { Logger } from '../shared/logger';

const logger = new Logger('RunningAgentsCheck');

/** One agent the daemon reports as actively draining a turn. */
export interface RespondingAgent {
  agentId: string;
  name: string;
  workspaceId: string;
}

/** Minimal JSON-RPC surface consumed by the quit check (see JsonRpcClient). */
export interface RunningAgentsRpc {
  getStatus(): string;
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

/**
 * List agents the daemon reports as currently mid-turn, across all
 * workspaces. Never throws: any transport/RPC failure yields `[]`.
 */
export async function listRespondingAgents(client: RunningAgentsRpc): Promise<RespondingAgent[]> {
  if (client.getStatus() !== 'connected') {
    logger.warn('Daemon not connected during quit check; assuming no running agents');
    return [];
  }

  let streams: Record<string, unknown>[];
  try {
    const result = await client.request<{ streams?: unknown[] }>('agent.listActive', {});
    streams = Array.isArray(result?.streams) ? (result.streams as Record<string, unknown>[]) : [];
  } catch (error) {
    logger.warn('agent.listActive failed during quit check; assuming no running agents', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const resolved = await Promise.all(
    streams.map(async (stream): Promise<RespondingAgent | null> => {
      const agentId = String(stream.agentId ?? '');
      if (!agentId) return null;
      const workspaceId = String(stream.workspaceId ?? '');
      let name = agentId;
      try {
        const result = await client.request<{ agent?: { name?: unknown } }>(
          'agent.get',
          workspaceId ? { agentId, workspaceId } : { agentId },
        );
        const wireName = result?.agent?.name;
        if (typeof wireName === 'string' && wireName) name = wireName;
      } catch (error) {
        logger.warn('agent.get failed during quit check; falling back to the agent id', {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { agentId, name, workspaceId };
    }),
  );

  return resolved.filter((agent): agent is RespondingAgent => agent !== null);
}
