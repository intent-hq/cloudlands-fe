/**
 * Fire-and-forget `agent.markSeen` trigger (PROTOCOL §5.5).
 *
 * Advances the per-conversation seen marker while the user is actually
 * looking at the end of the transcript. The ONLY trigger is the viewport
 * being at the very bottom with the agent currently viewed and the window
 * focused — scrolling mid-conversation NEVER produces a backend call. The
 * daemon persists `lastSeenMessageId` (served on AgentLite, converging via
 * `agent:updated`), so callers never await the mutation: failures are
 * tolerated silently and the next trigger retries naturally.
 *
 * Requests are debounced per agent so message bursts while sitting at the
 * bottom collapse into one call carrying the newest persisted message id.
 * All gates are re-evaluated at fire time from a live snapshot — scrolling
 * away, blurring the window, or switching agents during the debounce window
 * silently drops the pending request.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: the appClient seam and
 * store are dynamically imported at fire time so this module can be imported
 * from component code without eagerly pulling in the client graph.
 */
import type { AgentMessage } from '$shared/types';

/** Debounce window for coalescing bursts while sitting at the bottom. */
export const MARK_AGENT_SEEN_DEBOUNCE_MS = 1000;

/**
 * Live view of the trigger gates, re-read at fire time. `null` when the
 * caller can no longer produce a meaningful snapshot (e.g. unmounted).
 */
export interface MarkAgentSeenSnapshot {
  workspaceId: string;
  agentId: string;
  /** Newest persisted (never streaming) message id, or null when none. */
  messageId: string | null;
  /** Viewport is at the very end of the transcript. */
  atBottom: boolean;
}

interface PendingTrigger {
  timer: ReturnType<typeof setTimeout>;
  getSnapshot: () => MarkAgentSeenSnapshot | null;
}

const pendingByAgent = new Map<string, PendingTrigger>();
const lastSentByAgent = new Map<string, string>();

/**
 * Bound on the per-agent dedupe map so it cannot grow without limit across
 * many agent sessions in a long-lived renderer. Eviction is LRU-ish: Map
 * iteration order is insertion order and `recordLastSent` re-inserts on every
 * write, so the first key is always the least recently sent.
 */
export const MARK_AGENT_SEEN_DEDUPE_LIMIT = 200;

function recordLastSent(agentId: string, messageId: string): void {
  lastSentByAgent.delete(agentId);
  lastSentByAgent.set(agentId, messageId);
  if (lastSentByAgent.size > MARK_AGENT_SEEN_DEDUPE_LIMIT) {
    const oldest = lastSentByAgent.keys().next().value;
    if (oldest !== undefined) lastSentByAgent.delete(oldest);
  }
}

/**
 * Newest persisted message id in transcript order — streaming rows (partial
 * assistant output not yet persisted daemon-side) are never eligible: the
 * marker must only ever point at a message the daemon can resolve.
 */
export function newestPersistedMessageId(messages: readonly AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.isStreaming) continue;
    if (typeof message.id === 'string' && message.id.length > 0) return message.id;
  }
  return null;
}

/**
 * Request a debounced fire-and-forget `agent.markSeen`. Re-requesting within
 * the debounce window restarts the timer (trailing edge) and the snapshot is
 * taken fresh when the timer fires, so a burst of messages produces one call
 * with the newest id. Never throws and never blocks the caller.
 */
export function requestMarkAgentSeen(
  agentId: string,
  getSnapshot: () => MarkAgentSeenSnapshot | null,
): void {
  const existing = pendingByAgent.get(agentId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pendingByAgent.delete(agentId);
    void fire(agentId, getSnapshot);
  }, MARK_AGENT_SEEN_DEBOUNCE_MS);
  pendingByAgent.set(agentId, { timer, getSnapshot });
}

/** Drop any pending trigger for the agent (component teardown). */
export function cancelPendingMarkAgentSeen(agentId: string): void {
  const pending = pendingByAgent.get(agentId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingByAgent.delete(agentId);
}

/** Evaluate all gates from a live snapshot, then send at most one request. */
async function fire(
  _requestAgentId: string,
  getSnapshot: () => MarkAgentSeenSnapshot | null,
): Promise<void> {
  // Dedupe bookkeeping is keyed by the fire-time snapshot's agentId — the
  // same identity the viewed gate and the mutation use — never by the
  // request-time key, so the two can never diverge.
  let dedupeKey: string | null = null;
  let recordedId: string | null = null;
  try {
    const snapshot = getSnapshot();
    if (!snapshot) return;
    if (!snapshot.atBottom) return;
    if (!snapshot.messageId) return;
    if (!snapshot.workspaceId || !snapshot.agentId) return;
    // Window focus gate: never advance the marker while the app is in the
    // background — the user is not actually seeing the messages.
    if (typeof document !== 'undefined' && !document.hasFocus()) return;

    const [{ store: appStore }, { appClient }] = await Promise.all([
      import('$store/renderer/store'),
      import('$lib/client'),
    ]);

    // Viewed gate (one-time dependency-light read, no selector import): the
    // conversation must still be the one on screen.
    const state = appStore.state as {
      unreadTracking?: { currentlyViewedAgentId: string | null };
    };
    if (state.unreadTracking?.currentlyViewedAgentId !== snapshot.agentId) return;

    // Dedupe: the daemon call is idempotent but there is no point re-sending
    // the same marker while the user sits at the bottom.
    dedupeKey = snapshot.agentId;
    if (lastSentByAgent.get(dedupeKey) === snapshot.messageId) return;
    recordLastSent(dedupeKey, snapshot.messageId);
    recordedId = snapshot.messageId;

    const result = await appClient.agents.markSeen({
      workspaceId: snapshot.workspaceId,
      agentId: snapshot.agentId,
      messageId: snapshot.messageId,
    });
    if (!result.success && lastSentByAgent.get(dedupeKey) === recordedId) {
      // Roll back the dedupe record so the next trigger retries naturally.
      lastSentByAgent.delete(dedupeKey);
    }
  } catch {
    // Fire-and-forget: the marker stays behind and the next trigger retries.
    if (
      dedupeKey !== null &&
      recordedId !== null &&
      lastSentByAgent.get(dedupeKey) === recordedId
    ) {
      lastSentByAgent.delete(dedupeKey);
    }
  }
}
