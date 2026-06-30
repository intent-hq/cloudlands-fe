import { AgentStatus, type AgentMessage, type AgentSession } from '$shared/types';
import { isStreamingMessage } from '$shared/types/guards';

/**
 * Predicate that matches the selector-side definition of "still streaming":
 * either the live `isStreaming` flag is set, or the message was persisted with
 * a non-terminal `streamingComplete:false`. Used to detect daemon-persisted
 * mid-turn messages on hydration so they can be finalized rather than
 * re-hydrated as phantom in-flight streams.
 */
function isStaleStreamingMessage(message: AgentMessage | undefined): boolean {
  if (!message) return false;
  return message.isStreaming === true || (message as { streamingComplete?: boolean }).streamingComplete === false;
}

/**
 * Normalize transient streaming/processing flags so a session persisted or
 * restored mid-turn cannot re-hydrate (or persist) a phantom "responding"
 * state. A live stream handler is the only legitimate reason to remain
 * streaming/active; without one and without an actually-streaming message,
 * force the flags off and demote Active/Processing status to Idle.
 *
 * `finalizeStaleMessages` opts the caller into clearing per-message
 * `isStreaming`/`streamingComplete:false` flags BEFORE the bail-out check,
 * mirroring the orphan-recovery semantics from the legacy main-process
 * `repairOrphanedStreamingState` path. Hydration paths (no live ACP handler
 * is possible by definition) must pass this so daemon-persisted streaming
 * messages do not block normalization and leave the UI stuck in "Thinking".
 * Persistence paths leave it off so a genuinely in-flight stream is preserved
 * across saves.
 *
 * Dependency-light and side-effect free: this is a pure predicate that mutates
 * and returns the object it is given. Callers that must not mutate their input
 * (frozen Redux/loaded objects) MUST pass a clone, e.g.
 * `normalizeStreamingState({ ...session })`.
 */
export function normalizeStreamingState<T extends Partial<AgentSession>>(
  session: T,
  hasHandler = false,
  finalizeStaleMessages = false,
): T {
  if (hasHandler) return session;
  if (finalizeStaleMessages && Array.isArray(session.messages)) {
    for (const message of session.messages) {
      if (isStaleStreamingMessage(message)) {
        message.isStreaming = false;
        (message as { streamingComplete?: boolean }).streamingComplete = true;
      }
    }
  }
  if (session.messages?.some((message) => isStreamingMessage(message))) return session;
  session.isStreaming = false;
  session.isProcessing = false;
  session.isResponding = false;
  if (session.status === AgentStatus.Active || session.status === AgentStatus.Processing) {
    session.status = AgentStatus.Idle;
  }
  return session;
}

