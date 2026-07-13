/**
 * Daemon-backed "agents still running?" check for the quit flow.
 *
 * Live agent turns run inside the intentd daemon (`agent.sendMessage`,
 * PROTOCOL §5.5) — not in this process. The quit prompt therefore consults
 * the daemon's per-agent `isResponding` flag (`agent.list`, §5.5/§7.1),
 * which is the authoritative "active worker" signal. The old check read the
 * main-process messageAccumulator Redux slice, which no longer exists (the
 * main-process store was removed in the port), so it crashed on every quit.
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
 * List agents the daemon reports as currently responding, across all
 * workspaces. Never throws: any transport/RPC failure yields `[]`.
 */
export async function listRespondingAgents(client: RunningAgentsRpc): Promise<RespondingAgent[]> {
  if (client.getStatus() !== 'connected') {
    logger.warn('Daemon not connected during quit check; assuming no running agents');
    return [];
  }

  let workspaces: Record<string, unknown>[];
  try {
    const result = await client.request<{ workspaces?: unknown[] }>('workspace.list');
    workspaces = Array.isArray(result?.workspaces)
      ? (result.workspaces as Record<string, unknown>[])
      : [];
  } catch (error) {
    logger.warn('workspace.list failed during quit check; assuming no running agents', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const perWorkspace = await Promise.all(
    workspaces.map(async (ws) => {
      const workspaceId = String(ws.id ?? ws.workspaceId ?? '');
      if (!workspaceId) return [];
      try {
        const result = await client.request<{ agents?: unknown[] }>('agent.list', { workspaceId });
        const agents = Array.isArray(result?.agents)
          ? (result.agents as Record<string, unknown>[])
          : [];
        return agents
          .filter((agent) => agent.isResponding === true)
          .map((agent) => ({
            agentId: String(agent.id ?? ''),
            name: String(agent.name ?? agent.id ?? ''),
            workspaceId,
          }));
      } catch (error) {
        logger.warn('agent.list failed during quit check; skipping workspace', {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    }),
  );

  return perWorkspace.flat();
}
