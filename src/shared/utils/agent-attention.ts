/**
 * Attention-request derivation (PROTOCOL §5.5 attention-request fields).
 *
 * The daemon persists a pending attention request (raised via
 * `ws.agent.requestDiscussion` / `ws.agent.reportBlocker`) as three nullable
 * session fields, exposed top-level on the full `AgentSession` projection and
 * under `metadata` on the `AgentLite` list/get projection:
 *   - `attentionRequestKind`: "discussion" | "blocker"
 *   - `attentionRequestReason`: string
 *   - `attentionRequestTimestamp`: ISO string
 * The fields are a *pending* state — the daemon clears them when the user
 * next responds, i.e. on a user-origin delivery (`agent.sendMessage`,
 * `agent.sendQueuedMessageNow`, `agent.editAndRegenerate`, or a drained
 * user-origin queue entry), emitting `agent:updated` with
 * `attentionRequestCleared: true`; automatic deliveries (A2A sends,
 * parent/subscription wakes) do not clear them. An absent kind means no
 * pending request and the indicator retires.
 */

export type AgentAttentionKind = 'discussion' | 'blocker';

export interface AgentAttentionRequest {
  kind: AgentAttentionKind;
  reason?: string;
  timestamp?: string;
}

/** Structural subset of AgentSession/AgentLite this derivation reads. */
export interface AgentAttentionFieldsLike {
  attentionRequestKind?: unknown;
  attentionRequestReason?: unknown;
  attentionRequestTimestamp?: unknown;
  metadata?: Record<string, unknown> | null;
}

function isAttentionKind(value: unknown): value is AgentAttentionKind {
  return value === 'discussion' || value === 'blocker';
}

/**
 * Derive the pending attention request for a session, or null when none is
 * pending. Reads the top-level fields first (full `AgentSession` projection),
 * falling back to `metadata` (the `AgentLite` list/get projection). Unknown
 * kinds are treated as no pending request rather than guessed at.
 */
export function getAgentAttentionRequest(
  session?: AgentAttentionFieldsLike | null,
): AgentAttentionRequest | null {
  if (!session) return null;
  const metadata = session.metadata ?? {};
  const kind = session.attentionRequestKind ?? metadata.attentionRequestKind;
  if (!isAttentionKind(kind)) return null;
  const reason = session.attentionRequestReason ?? metadata.attentionRequestReason;
  const timestamp = session.attentionRequestTimestamp ?? metadata.attentionRequestTimestamp;
  return {
    kind,
    reason: typeof reason === 'string' && reason.length > 0 ? reason : undefined,
    timestamp: typeof timestamp === 'string' && timestamp.length > 0 ? timestamp : undefined,
  };
}
