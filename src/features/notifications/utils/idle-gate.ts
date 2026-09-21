/**
 * Idle-notification wire gate — the bounded reads behind the `agent:idle`
 * suppression decision, shared by the main-process `NotificationService`, the
 * web-platform substitute and the renderer notifications saga so the three
 * gates stay in parity. Transport-agnostic: takes the caller's `request` fn.
 *
 * Replaces the former unscoped `agent.list` read
 * ([intent-hq/intent#5531](https://github.com/intent-hq/intent/issues/5531)):
 * every idle event in a large workspace pulled the whole session list (a
 * ~1 MiB frame at 459 sessions) to answer two small questions. Now:
 *   1. the idle agent's own `metadata.isBackground` / `notificationsMuted` /
 *      `provider` / `metadata.specialist` come from ONE `agent.get` row;
 *   2. "is any other agent still active?" comes from `agent.listActive` — the
 *      daemon-global mid-turn busy set (§5.5) filtered to the workspace. That
 *      set is a SUPERSET of the rows the old scan counted: an AgentLite row's
 *      `isResponding` derives from the same busy set (`agent_is_busy`), but
 *      the projection forces both `isStreaming` and `isResponding` to `false`
 *      for a session already persisted terminal (`completed`/`error`/
 *      `deleted`) while its worker is still draining — the manager releases
 *      the busy slot only after the failure handler returns;
 *   3. each active sibling is therefore read with ONE `agent.get` — bounded
 *      by the active count, not the workspace size — and counted only when
 *      its row still carries `isStreaming || isResponding` (the old predicate)
 *      and is not muted. This keeps the verdict identical to the old scan,
 *      including the terminal-but-still-busy window.
 *
 * Failure posture (matches the old `agent.list` gate exactly): a row the
 * daemon reports `not-found` is treated as ABSENT from the workspace — the
 * idle agent then carries no flags (notify proceeds on the payload alone) and
 * a vanished sibling is not counted — which is what the old list read yielded
 * for a session deleted between the idle event and the read. Any other read
 * failure propagates to the caller's outer `catch`, which logs and drops the
 * notification, exactly as a failed `agent.list` did.
 */

import { isAgentNotFoundError } from '$features/agent/utils/agent-not-found-error';

/** The caller's JSON-RPC request fn (main `JsonRpcClient.request` / renderer `backendRequest`). */
export type IdleGateRequest = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** `agent.get` row subset the gate consults (PROTOCOL §5.5 AgentLite). */
interface IdleGateAgent {
  id?: string;
  provider?: string;
  isStreaming?: boolean;
  isResponding?: boolean;
  notificationsMuted?: boolean;
  metadata?: { isBackground?: boolean; specialist?: string };
}

/** `agent.listActive` result subset (PROTOCOL §5.5). */
interface AgentListActiveResult {
  streams?: Array<{ agentId?: string; workspaceId?: string }>;
}

export type IdleGateVerdict =
  | { kind: 'background'; idleAgent: IdleGateAgent }
  | { kind: 'muted'; idleAgent: IdleGateAgent }
  | { kind: 'others-active'; idleAgent: IdleGateAgent | undefined; otherActiveCount: number }
  | { kind: 'notify'; idleAgent: IdleGateAgent | undefined };

/** One `agent.get`; `undefined` when the daemon reports the row `not-found`. */
async function getAgentRow(
  request: IdleGateRequest,
  workspaceId: string,
  agentId: string,
): Promise<IdleGateAgent | undefined> {
  try {
    const result = (await request('agent.get', { agentId, workspaceId })) as
      { agent?: IdleGateAgent } | undefined;
    return result?.agent;
  } catch (error) {
    if (isAgentNotFoundError(error)) return undefined;
    throw error;
  }
}

/**
 * Decide whether an `agent:idle` event for `agentId` in `workspaceId` should
 * notify, using bounded reads only. Callers run the event-payload fast paths
 * (background / muted / waiting / archived stamps) BEFORE this, so a
 * `background` or `muted` verdict here only fires for idle payloads that
 * predate those stamps.
 */
export async function readIdleNotificationGate(
  request: IdleGateRequest,
  { workspaceId, agentId }: { workspaceId: string; agentId: string },
): Promise<IdleGateVerdict> {
  const idleAgent = await getAgentRow(request, workspaceId, agentId);

  // Skip background agents — delegated child completions stay quiet.
  if (idleAgent?.metadata?.isBackground === true) return { kind: 'background', idleAgent };

  // Skip muted agents (AgentLite top-level `notificationsMuted`) — parity
  // with the payload fast path for idle events that predate the stamp.
  if (idleAgent?.notificationsMuted === true) return { kind: 'muted', idleAgent };

  const active = (await request('agent.listActive', {})) as AgentListActiveResult | undefined;
  const otherActiveIds = [
    ...new Set(
      (active?.streams ?? [])
        .filter((s) => s.workspaceId === workspaceId && !!s.agentId && s.agentId !== agentId)
        .map((s) => s.agentId as string),
    ),
  ];
  if (otherActiveIds.length === 0) return { kind: 'notify', idleAgent };

  // Re-apply the old row predicate on the fetched siblings: a busy-set entry
  // whose row already reads terminal (both flags `false`) is not active.
  // Muted siblings never hold the gate either: a running muted agent's own
  // idle is suppressed, so counting it here would leave the workspace silent.
  const siblings = await Promise.all(
    otherActiveIds.map((id) => getAgentRow(request, workspaceId, id)),
  );
  const otherActiveCount = siblings.filter(
    (row) =>
      row !== undefined &&
      (row.isStreaming === true || row.isResponding === true) &&
      row.notificationsMuted !== true,
  ).length;
  if (otherActiveCount > 0) return { kind: 'others-active', idleAgent, otherActiveCount };
  return { kind: 'notify', idleAgent };
}
