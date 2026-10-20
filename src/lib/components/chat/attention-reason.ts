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
import { attentionRequestKey } from './attention-notice';

const inflight = new Map<string, Promise<string | null>>();

/**
 * Resolve the full reason of `request` for `agentId`, or `null` when the
 * request has no identity (see {@link attentionRequestKey}), the read fails, or
 * the daemon now holds a different request (another kind or timestamp).
 * Concurrent calls for the same request share one `agent.get`.
 */
export function loadFullAttentionReason(
  agentId: string,
  request: AgentAttentionRequest,
): Promise<string | null> {
  const key = attentionRequestKey(agentId, request);
  if (key === null) return Promise.resolve(null);
  const pending = inflight.get(key);
  if (pending) return pending;
  const workspaceId = store.state.agentSessions?.byAgentId[agentId]?.workspaceId;
  const load = backendRequest<{ agent?: AgentAttentionFieldsLike }>('agent.get', {
    agentId,
    ...(workspaceId ? { workspaceId } : {}),
  })
    .then((result) => {
      const full = getAgentAttentionRequest(result?.agent);
      if (!full?.timestamp || attentionRequestKey(agentId, full) !== key) return null;
      return full.reason ?? null;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, load);
  return load;
}
