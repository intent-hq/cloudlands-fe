import type { MutationResult } from '../client-types';
import type { BackendTransport } from './backend-transport-types';
import { createRunMutation } from './backend-mutation';

/** Shared agent.markSeen wire owner; the binding supplies its guarded transport. */
export function createBackendAgentSeen(backendRequest: BackendTransport['request']) {
  const runMutation = createRunMutation(backendRequest);
  return async function markSeen(params: {
    agentId: string;
    workspaceId: string;
    messageId: string;
  }): Promise<MutationResult> {
    // `agent.markSeen` (§5.5) takes `{ workspaceId, agentId, messageId }`
    // (all required — workspace mismatch surfaces as NotFound); the wire ack
    // is `{ success: true, lastSeenMessageId }`, folded by `runMutation` into
    // a plain `MutationResult`. The daemon persists the marker in session
    // metadata (survives reload) and emits `agent:updated` so all clients
    // converge on the advanced marker. Idempotent on the same messageId.
    // Transport / daemon errors fold into `{ success: false, error }` — the
    // fire-and-forget trigger never awaits this for UI flow.
    return runMutation('agent.markSeen', {
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      messageId: params.messageId,
    });
  };
}
