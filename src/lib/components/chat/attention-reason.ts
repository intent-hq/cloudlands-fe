/**
 * Full-text loader for a shortened attention reason.
 *
 * `agent.list` rows cap `metadata.attentionRequestReason` and mark the
 * shortened copy with `attentionRequestReasonTruncated` (PROTOCOL §5.5
 * truncation flags). `agent.get` is a detail read that never caps, so it
 * serves the full reason. The result is returned to the caller rather than
 * written to the store, because the next list refresh would shorten it again.
 */
import { backendRequest } from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import {
  getAgentAttentionRequest,
  type AgentAttentionRequest,
  type AgentAttentionFieldsLike,
} from '$shared/utils/agent-attention';

const inflight = new Map<string, Promise<string | null>>();

function requestKey(agentId: string, request: AgentAttentionRequest): string {
  return `${agentId}\u0000${request.kind}\u0000${request.timestamp ?? ''}`;
}

/**
 * Resolve the full reason of `request` for `agentId`, or `null` when the read
 * fails or the daemon now holds a different request (another kind or
 * timestamp). Concurrent calls for the same request share one `agent.get`.
 */
export function loadFullAttentionReason(
  agentId: string,
  request: AgentAttentionRequest,
): Promise<string | null> {
  const key = requestKey(agentId, request);
  const pending = inflight.get(key);
  if (pending) return pending;
  const workspaceId = store.state.agentSessions?.byAgentId[agentId]?.workspaceId;
  const load = backendRequest<{ agent?: AgentAttentionFieldsLike }>('agent.get', {
    agentId,
    ...(workspaceId ? { workspaceId } : {}),
  })
    .then((result) => {
      const full = getAgentAttentionRequest(result?.agent);
      if (!full || full.kind !== request.kind) return null;
      if (request.timestamp && full.timestamp !== request.timestamp) return null;
      return full.reason ?? null;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, load);
  return load;
}
