/**
 * Fire-and-forget `agent.markSeen` triggers (PROTOCOL §5.5).
 *
 * The seen marker advances at four DISCRETE moments — never continuously
 * from scroll position:
 *
 *   1. Turn finish — `streamEnded` (terminal `agent:stream:end`) while the
 *      conversation is the currently viewed tab AND the window is focused.
 *   2. User send — the user sends a message in the conversation
 *      (`sendMessage`): composing there is proof they saw the transcript.
 *   3. Stop-looking boundary — the divider-session boundary seam (chat tab
 *      close / active-workspace switch) fires for the affected agents.
 *   4. View — the conversation becomes the currently viewed tab
 *      (`markAgentAsViewed`) while its newest persisted message is an
 *      assistant reply: opening an already-finished conversation is reading
 *      it, and no later turn-finish will arrive to advance the marker.
 *
 * The unread-tracking root saga observes all four triggers. Each trigger targets the newest
 * PERSISTED message id at fire time — streaming/partial rows are never
 * eligible. The daemon persists `lastSeenMessageId` (served on AgentLite,
 * converging via `agent:updated`), so callers never await the mutation:
 * failures roll back the dedupe record and the next trigger retries.
 *
 * Turn-finish and user-send are debounced per agent so bursts coalesce into
 * one call (and the canonical persisted user-message echo from
 * `chat.subscribe` can replace the optimistic local row before the target id
 * is read); gates are re-evaluated from live store state when the timer
 * fires. Boundary triggers fire immediately — a debounce would outlive the
 * viewing session.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: the appClient seam and
 * store are dynamically imported at fire time; the only module-scope store
 * imports are slice action types (no selector modules).
 */
import type { AgentMessage } from '$shared/types';

/** Debounce window for coalescing turn-finish / user-send bursts. */
export const MARK_AGENT_SEEN_DEBOUNCE_MS = 1000;

/** Gates re-evaluated from live store state when a trigger fires. */
interface FireGates {
  /**
   * Turn-finish and view: the conversation must still be the currently
   * viewed one and the window focused. User-send and boundary triggers carry
   * their own proof of looking, so they skip both gates.
   */
  requireViewedAndFocused: boolean;
  /**
   * View only: the newest persisted message must be an assistant reply —
   * a finished turn the user is reading. Without it a mid-turn view (newest
   * persisted row is the user's own message) would advance the marker for
   * a reply that has not arrived yet; turn-finish covers that case.
   */
  requireAssistantTail?: boolean;
}

interface PendingTrigger {
  timer: ReturnType<typeof setTimeout>;
  gates: FireGates;
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
 * Newest persisted message in transcript order — streaming rows (partial
 * assistant output not yet persisted daemon-side) are never eligible: the
 * marker must only ever point at a message the daemon can resolve.
 */
function newestPersistedMessage(messages: readonly AgentMessage[]): AgentMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.isStreaming) continue;
    if (typeof message.id === 'string' && message.id.length > 0) return message;
  }
  return null;
}

/** Id of the newest persisted message, or null when none qualifies. */
export function newestPersistedMessageId(messages: readonly AgentMessage[]): string | null {
  return newestPersistedMessage(messages)?.id ?? null;
}

/**
 * Turn-finish trigger: debounced, and gated at fire time on the conversation
 * still being the currently viewed one AND the window being focused — a tab
 * switch or blur during the debounce window silently drops the request.
 */
export function markAgentSeenOnTurnFinish(agentId: string): void {
  scheduleDebounced(agentId, { requireViewedAndFocused: true });
}

/**
 * User-send trigger: the user just composed a message in this conversation,
 * which is itself proof they were looking — no viewed/focus gate. Debounced
 * so the canonical persisted user-message echo (chat.subscribe) can replace
 * the optimistic local row before the target id is read.
 */
export function markAgentSeenOnUserSend(agentId: string): void {
  scheduleDebounced(agentId, { requireViewedAndFocused: false });
}

/**
 * View trigger: the conversation just became the currently viewed tab
 * (`markAgentAsViewed`). Covers opening an ALREADY-FINISHED conversation —
 * no terminal stream event will ever arrive for it, so without this trigger
 * the agent's marker (and the workspace unread dot derived from it) would
 * only clear at a stop-looking boundary. Debounced with the viewed/focus
 * gates plus the assistant-tail gate: a mid-turn view is left to the
 * turn-finish trigger.
 */
export function markAgentSeenOnView(agentId: string): void {
  scheduleDebounced(agentId, { requireViewedAndFocused: true, requireAssistantTail: true });
}

/**
 * Stop-looking boundary trigger (divider-session boundary seam: chat tab
 * close / active-workspace switch). Fires IMMEDIATELY for each affected
 * agent — the user was looking right up to the boundary, and a debounce
 * would outlive the viewing session. Supersedes any pending debounce.
 */
export function markAgentSeenAtBoundary(agentIds: readonly string[]): void {
  for (const agentId of agentIds) {
    if (typeof agentId !== 'string' || agentId.length === 0) continue;
    cancelPendingMarkAgentSeen(agentId);
    void fire(agentId, { requireViewedAndFocused: false });
  }
}

/** Drop any pending debounced trigger for the agent. */
export function cancelPendingMarkAgentSeen(agentId: string): void {
  const pending = pendingByAgent.get(agentId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingByAgent.delete(agentId);
}

/**
 * Debounce per agent (trailing edge): re-triggering restarts the timer, and
 * the target id + gates are read fresh from the store when it fires, so a
 * burst produces one call carrying the newest persisted id. The LAST
 * trigger's gates win — a user send during a pending turn-finish window
 * drops the viewed/focus gate, since the send is itself proof of looking.
 */
function scheduleDebounced(agentId: string, gates: FireGates): void {
  cancelPendingMarkAgentSeen(agentId);
  const timer = setTimeout(() => {
    pendingByAgent.delete(agentId);
    void fire(agentId, gates);
  }, MARK_AGENT_SEEN_DEBOUNCE_MS);
  pendingByAgent.set(agentId, { timer, gates });
}

/**
 * Fire-time seams, dynamically imported once and shared by every fire —
 * concurrent triggers (e.g. a multi-agent boundary) await the same in-flight
 * import instead of racing duplicate loads.
 */
let seamsPromise: Promise<{
  appStore: (typeof import('$store/renderer/store'))['store'];
  appClient: (typeof import('$lib/client'))['appClient'];
}> | null = null;

function loadSeams(): NonNullable<typeof seamsPromise> {
  seamsPromise ??= Promise.all([import('$store/renderer/store'), import('$lib/client')]).then(
    ([storeModule, clientModule]) => ({
      appStore: storeModule.store,
      appClient: clientModule.appClient,
    }),
  );
  return seamsPromise;
}

/**
 * Resolve the gates and the target message id from live store state, then
 * send at most one request. Never throws and never blocks the caller.
 */
async function fire(agentId: string, gates: FireGates): Promise<void> {
  let recordedId: string | null = null;
  try {
    const { appStore, appClient } = await loadSeams();

    // Dependency-light one-time state read (no selector imports).
    const state = appStore.state as {
      unreadTracking?: { currentlyViewedAgentId: string | null };
      agentSessions?: {
        byAgentId: Record<
          string,
          { workspaceId?: unknown; messages?: readonly AgentMessage[] } | undefined
        >;
      };
    };

    if (gates.requireViewedAndFocused) {
      // Viewed gate: the conversation must still be the one on screen.
      if (state.unreadTracking?.currentlyViewedAgentId !== agentId) return;
      // Window focus gate: never advance the marker while the app is in the
      // background — the user is not actually seeing the messages.
      if (typeof document !== 'undefined' && !document.hasFocus()) return;
    }

    const session = state.agentSessions?.byAgentId[agentId];
    if (!session) return;
    const workspaceId = typeof session.workspaceId === 'string' ? session.workspaceId : '';
    if (workspaceId.length === 0) return;
    const target = newestPersistedMessage(session.messages ?? []);
    if (!target) return;
    // Assistant-tail gate (view trigger): only a finished assistant reply
    // counts as read-by-viewing; a user-message tail means a turn is in
    // flight and turn-finish will handle it.
    if (gates.requireAssistantTail && target.role !== 'assistant') return;
    const messageId = target.id;

    // Dedupe: the daemon call is idempotent but there is no point re-sending
    // the same marker id.
    if (lastSentByAgent.get(agentId) === messageId) return;
    recordLastSent(agentId, messageId);
    recordedId = messageId;

    const result = await appClient.agents.markSeen({ workspaceId, agentId, messageId });
    if (!result.success && lastSentByAgent.get(agentId) === recordedId) {
      // Roll back the dedupe record so the next trigger retries naturally.
      lastSentByAgent.delete(agentId);
    }
  } catch {
    // Fire-and-forget: the marker stays behind and the next trigger retries.
    if (recordedId !== null && lastSentByAgent.get(agentId) === recordedId) {
      lastSentByAgent.delete(agentId);
    }
  }
}
