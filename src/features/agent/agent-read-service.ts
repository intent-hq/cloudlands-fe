/**
 * Reusable agent-session read seam used by the agent read saga and event router.
 *
 * `ensureAgentSession(agentId)` fetches `appClient.agents.get` and hydrates the
 * store: `bulkUpsertSessions([session])` populates the agent-session slice
 * (`byAgentId` + messages = the conversation), and `upsertSession(session)`
 * registers the agent id in the workspace-agents index. `upsertSession` alone is
 * NOT enough — the agent-session reducer only consumes `bulkUpsertSessions`.
 *
 * READ-ONLY: this module never invokes an agent mutation (no create/send/stop).
 *
 * Loads are coalesced per agent via an in-flight map so the AgentCard mount
 * effect and the WorkspaceHoverCard per-agent loop collapse rapid re-dispatches
 * into a single `agent.get` fetch. Event-driven refreshes use
 * `refreshAgentSessionAfterEvent`, which adds one bounded trailing read when an
 * event arrives during an in-flight fetch.
 *
 * Conversation note: the agent session's `messages` array IS the conversation.
 * On the mock seam this carries the sample transcript; on the live daemon
 * `agent.get` currently returns message COUNTS only (no transcript) and the chat
 * domain is still mock-delegated, so live transcripts are a documented BE gap
 * (Track C chat snapshot) — this service does not fabricate them.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam, the
 * configured store, the slice actions, and the logger.
 */
import { appClient } from '$lib/client';
import type { AgentSession } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { createLogger } from '$lib/utils/client-logger';
import { isAgentDeletionPending } from './utils/pending-agent-deletions';
import { isAgentNotFoundError } from './utils/agent-not-found-error';
import { staleRuntimeFlagClearUpsertOptions } from './utils/stale-runtime-flag-clear';

const logger = createLogger('AgentReadService');

/** In-flight wire reads keyed by agent id; shared by every metadata caller. */
const inFlight = new Map<string, Promise<AgentSession | null>>();

/** In-flight guarded hydrations keyed by agent id; prevents duplicate store writes. */
const hydrationInFlight = new Map<string, Promise<AgentSession | null>>();

/** Event-driven trailing loads keyed by agent id; at most one per in-flight read. */
const pendingEventRerun = new Map<string, Promise<void>>();

/**
 * Monotonic read sequencing: every new `agent.get` request takes the next
 * generation, and `notePendingQuestionMarkerProjection` records the generation
 * current when an `agent:updated` question-marker event was applied to the
 * store (PROTOCOL §6.5). A response whose request started at or before that
 * generation may predate the daemon's marker write, so its marker fields must
 * not undo the event projection; the trailing read (always a later generation)
 * remains authoritative.
 */
let readGeneration = 0;
const markerProjectionGeneration = new Map<string, number>();
const QUESTION_MARKER_KEYS = ['pendingQuestionsMessageId', 'dismissedQuestionsMessageId'] as const;

export function notePendingQuestionMarkerProjection(agentId: string): void {
  markerProjectionGeneration.set(agentId, readGeneration);
}

function preserveProjectedQuestionMarkers(
  agentId: string,
  generation: number,
  session: AgentSession | null,
): AgentSession | null {
  if (!session) return session;
  const projectedAt = markerProjectionGeneration.get(agentId);
  if (projectedAt === undefined || generation > projectedAt) return session;
  const stored = appStore.state.agentSessions?.byAgentId[agentId]?.metadata;
  if (!stored) return session;
  let metadata = session.metadata;
  for (const key of QUESTION_MARKER_KEYS) {
    const projected = stored[key];
    if (typeof projected !== 'string' || metadata?.[key] === projected) continue;
    metadata = { ...metadata, [key]: projected };
  }
  return metadata === session.metadata ? session : { ...session, metadata };
}

/**
 * Refresh after a daemon event without losing an update behind an older read.
 * If a read is already in flight, one trailing read is scheduled after it;
 * further events during that read share the same trailing promise.
 */
export async function refreshAgentSessionAfterEvent(agentId: string): Promise<void> {
  const pending = inFlight.get(agentId);
  if (!pending) return ensureAgentSession(agentId);

  const scheduledRerun = pendingEventRerun.get(agentId);
  if (scheduledRerun) return scheduledRerun;

  // Delete before the trailing read so events during that read can coalesce
  // into one further trailing refresh instead of getting lost.
  const rerun = pending.then(
    () => {
      pendingEventRerun.delete(agentId);
      return ensureAgentSession(agentId);
    },
    () => {
      // A rejected leading read is not cached and must not suppress the event's
      // authoritative trailing retry.
      pendingEventRerun.delete(agentId);
      return ensureAgentSession(agentId);
    },
  );
  pendingEventRerun.set(agentId, rerun);
  return rerun;
}

/**
 * Shared raw `agent.get` read for callers that need the returned projection.
 * Rejections propagate so each caller can preserve its existing error policy;
 * the failed promise is always evicted and is never treated as cached data.
 * The only reconciliation applied is the question-marker guard above: a
 * response to a request that started before an `agent:updated` marker
 * projection keeps the store's projected marker values.
 */
export function readAgentSession(agentId: string): Promise<AgentSession | null> {
  const pending = inFlight.get(agentId);
  if (pending) return pending;

  const generation = ++readGeneration;
  const run = appClient.agents
    .get(agentId)
    .then((session) => preserveProjectedQuestionMarkers(agentId, generation, session))
    .finally(() => {
      if (inFlight.get(agentId) === run) inFlight.delete(agentId);
    });
  inFlight.set(agentId, run);
  return run;
}

async function hydrateAgentSession(agentId: string): Promise<AgentSession | null> {
  try {
    const storedBefore = appStore.state.agentSessions?.byAgentId[agentId];
    const hadInFlightPairBeforeFetch =
      storedBefore?.isStreaming === true && storedBefore?.isProcessing === true;
    const session = await readAgentSession(agentId);
    // Re-check after the fetch: a deletion may have become pending while
    // `agent.get` was in flight; upserting now would resurrect the
    // soft-hidden session. Also drop rows carrying the daemon's
    // delete-grace-window deadline (PROTOCOL §5.5 `pendingDeleteAt`, v6.7+)
    // — a deletion scheduled by another window/client (or before an FE
    // restart) is not in this window's local registry.
    if (session && !session.pendingDeleteAt && !isAgentDeletionPending(agentId)) {
      // `agent.get` returns AgentLite (PROTOCOL §5.5) — session metadata and
      // message COUNTS only, not the retained transcript. `normalizeAgent`
      // fills the missing `messages` field with `[]`, so dispatching this
      // session as-is would clobber a transcript that `chat-read-service`
      // already hydrated via `agent.getConversation`. Preserve any existing
      // messages so this metadata-only refresh never erases the seq-0 user
      // message (nor any subsequent history).
      const existing = appStore.state.agentSessions?.byAgentId[agentId];
      const merged = existing ? { ...session, messages: existing.messages } : session;
      appStore.dispatch(
        bulkUpsertSessions(
          [merged],
          staleRuntimeFlagClearUpsertOptions(hadInFlightPairBeforeFetch, session),
        ),
      );
      appStore.dispatch(upsertSession(merged));
      return merged;
    }
    return null;
  } catch (error) {
    if (isAgentNotFoundError(error)) {
      // Expected: speculative loads (hover cards, avatars, peek cards) may
      // reference an agent deleted on the daemon (monorepo#1753). WARN only
      // — no navigation or cleanup from this read seam.
      logger.warn('Agent no longer exists on daemon; skipping session load', { agentId });
    } else {
      logger.error('Failed to load agent session', error);
    }
    return null;
  } finally {
    hydrationInFlight.delete(agentId);
  }
}

/**
 * Fetch a single agent's session from the seam and hydrate the store with it.
 * Errors are swallowed (logged only) so a failed read leaves any prior session
 * intact rather than clearing it. Concurrent calls for the same agent share one
 * fetch.
 */
export async function ensureAgentSession(agentId: string): Promise<void> {
  // A soft-hidden deletion is pending (undo window still open): the daemon
  // still returns the agent from `agent.get`, so refetching would resurrect
  // the deleted session. Skip entirely.
  if (isAgentDeletionPending(agentId)) return;
  const pending = hydrationInFlight.get(agentId);
  if (pending) {
    await pending;
    return;
  }
  const run = hydrateAgentSession(agentId);
  hydrationInFlight.set(agentId, run);
  await run;
}
