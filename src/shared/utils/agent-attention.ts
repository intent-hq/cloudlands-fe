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
 *
 * The daemon defers *emitting* a mid-turn request until the turn ends, but a
 * mid-turn rehydration/list read can still deliver the persisted fields while
 * the agent is streaming. Defensively, the derivation returns null while a
 * live turn is in flight (`isAgentTurnLive`) — the indicator appears once the
 * agent stops streaming.
 */

import { isAgentTurnLive, type AgentRuntimeStateInput } from './agent-runtime-state';

export type AgentAttentionKind = 'discussion' | 'blocker';

export interface AgentAttentionRequest {
  kind: AgentAttentionKind;
  reason?: string;
  timestamp?: string;
}

/** Structural subset of AgentSession/AgentLite this derivation reads. */
export interface AgentAttentionFieldsLike extends AgentRuntimeStateInput {
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
 * kinds are treated as no pending request rather than guessed at. While the
 * session shows a live turn in flight (activity flags on a non-terminal
 * status), the request is suppressed — it surfaces when the turn ends.
 */
export function getAgentAttentionRequest(
  session?: AgentAttentionFieldsLike | null,
): AgentAttentionRequest | null {
  if (!session) return null;
  if (isAgentTurnLive(session)) return null;
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

/** Structural subset of AgentSession/AgentLite the stop-timestamp derivation reads. */
export interface AgentStopTimestampFieldsLike {
  stopReasonTimestamp?: unknown;
  metadata?: Record<string, unknown> | null;
}

/**
 * Derive the ISO timestamp of the latest terminal stop/failure for a session,
 * or null when unknown. Per PROTOCOL §5.5, `stopReasonTimestamp` is
 * top-level on BOTH the full `AgentSession` projection and `AgentLite` —
 * unlike the attention-request trio above, there is no `metadata`-nested
 * copy. The `metadata` read below is defensive-only (harmless if a future
 * projection nests it there) and not part of the documented contract. Used
 * for "failed X ago" displays.
 */
export function getAgentStopReasonTimestamp(
  session?: AgentStopTimestampFieldsLike | null,
): string | null {
  if (!session) return null;
  const metadata = session.metadata ?? {};
  const timestamp = session.stopReasonTimestamp ?? metadata.stopReasonTimestamp;
  return typeof timestamp === 'string' && timestamp.length > 0 ? timestamp : null;
}
