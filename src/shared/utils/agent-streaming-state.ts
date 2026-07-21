import { AgentStatus, type AgentSession } from '$shared/types';
import { isStreamingMessage } from '$shared/types/guards';

/**
 * Normalize transient streaming/processing flags so a session persisted or
 * restored mid-turn cannot re-hydrate (or persist) a phantom "responding"
 * state. A live stream handler is the only legitimate reason to remain
 * streaming/active; without one and without an actually-streaming message,
 * force the flags off and demote Active/Processing status to Idle.
 *
 * When `clearStaleMessageFlags` is true and no handler exists, message-level
 * `isStreaming` flags are also cleared before normalizing. Use this from load
 * paths that can verify stream liveness (e.g. StreamManager): a periodic
 * mid-stream save can leave `isStreaming: true` on the last assistant message,
 * and without a live handler that snapshot can never legitimately resume.
 *
 * Dependency-light and side-effect free: this is a pure predicate that mutates
 * and returns the object it is given. Callers that must not mutate their input
 * (frozen Redux/loaded objects) MUST pass a clone, e.g.
 * `normalizeStreamingState({ ...session })`.
 */
export function normalizeStreamingState<T extends Partial<AgentSession>>(
  session: T,
  hasHandler = false,
  clearStaleMessageFlags = false,
): T {
  if (hasHandler) return session;
  if (clearStaleMessageFlags) {
    session.messages?.forEach((message) => {
      if (isStreamingMessage(message)) message.isStreaming = false;
    });
  } else if (session.messages?.some((message) => isStreamingMessage(message))) {
    return session;
  }
  session.isStreaming = false;
  session.isProcessing = false;
  session.isResponding = false;
  if (session.status === AgentStatus.Active || session.status === AgentStatus.Processing) {
    session.status = AgentStatus.Idle;
  }
  return session;
}

