import type { AgentSession } from '$shared/types';
import {
  bulkUpsertSessions,
  markAgentDetailHydrated,
  upsertSession,
} from '../../store/renderer/slices/agent-session/agent-session-slice';
import { createLogger } from '$lib/utils/client-logger';
import { isAgentDeletionPending } from './utils/pending-agent-deletions';
import { isAgentNotFoundError } from './utils/agent-not-found-error';
import { staleRuntimeFlagClearUpsertOptions } from './utils/stale-runtime-flag-clear';

import type { AgentSessionState } from '../../store/renderer/slices/agent-session/agent-session-types';
import type { createAgentReadOwnership } from './agent-read-ownership-factory';
export function createAgentReadService({
  appStore,
  getAgent,
  onBackendReconnected,
  ownership,
}: {
  appStore: {
    readonly state: { agentSessions: AgentSessionState };
    dispatch: (
      action: ReturnType<
        typeof bulkUpsertSessions | typeof markAgentDetailHydrated | typeof upsertSession
      >,
    ) => unknown;
  };
  getAgent: (agentId: string, workspaceId?: string) => Promise<AgentSession | null>;
  onBackendReconnected: (handler: () => void) => () => void;
  ownership: ReturnType<typeof createAgentReadOwnership>;
}) {
  const { claimAgentReadOwnership } = ownership;
  const logger = createLogger('AgentReadService');
  let stop: (() => void) | undefined;
  let disposed = false;
  let connectionGeneration = 0;
  let lifecycleInstalled = false;
  function readKey(agentId: string, workspaceId?: string): string {
    if (!lifecycleInstalled) {
      lifecycleInstalled = true;
      stop = onBackendReconnected(() => {
        connectionGeneration += 1;
        inFlight.clear();
        hydrationInFlight.clear();
        pendingEventRerun.clear();
        markerProjectionGeneration.clear();
      });
    }
    return JSON.stringify([connectionGeneration, workspaceId ?? null, agentId]);
  }

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
  const QUESTION_MARKER_KEYS = [
    'pendingQuestionsMessageId',
    'dismissedQuestionsMessageId',
  ] as const;

  function notePendingQuestionMarkerProjection(agentId: string, workspaceId?: string): void {
    workspaceId ??= appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
    markerProjectionGeneration.set(readKey(agentId, workspaceId), readGeneration);
  }

  function preserveProjectedQuestionMarkers(
    agentId: string,
    generation: number,
    session: AgentSession | null,
  ): AgentSession | null {
    if (!session) return session;
    const projectedAt = markerProjectionGeneration.get(readKey(agentId, session.workspaceId));
    if (projectedAt === undefined || generation > projectedAt) return session;
    const current = appStore.state.agentSessions?.byAgentId[agentId];
    const stored = current?.workspaceId === session.workspaceId ? current.metadata : undefined;
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
  async function refreshAgentSessionAfterEvent(
    agentId: string,
    workspaceId?: string,
  ): Promise<void> {
    workspaceId ??= appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
    const key = readKey(agentId, workspaceId);
    const ownership = claimAgentReadOwnership(agentId, workspaceId);
    const pending = inFlight.get(key);
    if (!pending) return ensureAgentSession(agentId, workspaceId);

    const connection = connectionGeneration;
    const scheduledRerun = pendingEventRerun.get(key);
    if (scheduledRerun) return scheduledRerun;

    // Delete before the trailing read so events during that read can coalesce
    // into one further trailing refresh instead of getting lost.
    const rerun = pending.then(
      () => {
        pendingEventRerun.delete(key);
        if (connection === connectionGeneration && ownership.isCurrent())
          return ensureAgentSession(agentId, workspaceId);
      },
      () => {
        // A rejected leading read is not cached and must not suppress the event's
        // authoritative trailing retry.
        pendingEventRerun.delete(key);
        if (connection === connectionGeneration && ownership.isCurrent())
          return ensureAgentSession(agentId, workspaceId);
      },
    );
    pendingEventRerun.set(key, rerun);
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
  function readAgentSession(agentId: string, workspaceId?: string): Promise<AgentSession | null> {
    workspaceId ??= appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
    if (disposed) return Promise.resolve(null);
    const key = readKey(agentId, workspaceId);
    const pending = inFlight.get(key);
    if (pending) return pending;

    const generation = ++readGeneration;
    const connection = connectionGeneration;
    const run = getAgent(agentId, workspaceId)
      .then((session) =>
        !disposed && connection === connectionGeneration
          ? preserveProjectedQuestionMarkers(agentId, generation, session)
          : null,
      )
      .finally(() => {
        if (inFlight.get(key) === run) inFlight.delete(key);
      });
    inFlight.set(key, run);
    return run;
  }

  async function hydrateAgentSession(
    agentId: string,
    ownership: ReturnType<typeof claimAgentReadOwnership>,
    workspaceId?: string,
  ): Promise<AgentSession | null> {
    workspaceId ??= appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
    try {
      const prior = appStore.state.agentSessions?.byAgentId[agentId];
      const storedBefore = prior?.workspaceId === workspaceId ? prior : undefined;
      const hadInFlightPairBeforeFetch =
        storedBefore?.isStreaming === true && storedBefore?.isProcessing === true;
      const session = await readAgentSession(agentId, workspaceId);
      if (session) ownership.bindWorkspace(session.workspaceId);
      // Re-check after the fetch: a deletion may have become pending while
      // `agent.get` was in flight; upserting now would resurrect the
      // soft-hidden session. Also drop rows carrying the daemon's
      // delete-grace-window deadline (PROTOCOL §5.5 `pendingDeleteAt`)
      // — a deletion scheduled by another window/client (or before an FE
      // restart) is not in this window's local registry.
      if (
        !disposed &&
        ownership.isCurrent() &&
        session &&
        !session.pendingDeleteAt &&
        !isAgentDeletionPending(agentId)
      ) {
        return receiveAgentSession(session, true, hadInFlightPairBeforeFetch);
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
      hydrationInFlight.delete(ownership.key);
    }
  }

  /**
   * Fetch a single agent's session from the seam and hydrate the store with it.
   * Errors are swallowed (logged only) so a failed read leaves any prior session
   * intact rather than clearing it. Concurrent calls for the same agent share one
   * fetch.
   */
  async function ensureAgentSession(agentId: string, workspaceId?: string): Promise<void> {
    if (disposed) return;
    workspaceId ??= appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
    const ownership = claimAgentReadOwnership(agentId, workspaceId);
    const key = ownership.key;
    // A soft-hidden deletion is pending (undo window still open): the daemon
    // still returns the agent from `agent.get`, so refetching would resurrect
    // the deleted session. Skip entirely.
    if (isAgentDeletionPending(agentId)) return;
    const pending = hydrationInFlight.get(key);
    if (pending) {
      await pending;
      return;
    }
    const run = hydrateAgentSession(agentId, ownership, workspaceId);
    hydrationInFlight.set(key, run);
    await run;
  }

  /** Canonical metadata ingestion preserves transcript and deletion/ownership guards. */
  function receiveAgentSession(
    session: AgentSession,
    detail = false,
    hadInFlightPairBeforeFetch = false,
  ): AgentSession | null {
    const agentId = session.id;
    if (
      disposed ||
      session.pendingDeleteAt ||
      isAgentDeletionPending(agentId) ||
      !ownership.isAgentReadWorkspaceCurrent(agentId, session.workspaceId)
    )
      return null;
    // `agent.get` returns AgentLite (PROTOCOL §5.5) — session metadata and
    // message COUNTS only, not the retained transcript. `normalizeAgent`
    // fills the missing `messages` field with `[]`, so dispatching this
    // session as-is would clobber a transcript that `chat-read-service`
    // already hydrated via `agent.getConversation`. Preserve any existing
    // messages so this metadata-only refresh never erases the seq-0 user
    // message (nor any subsequent history).
    const existing = appStore.state.agentSessions?.byAgentId[agentId];
    const merged =
      existing?.workspaceId === session.workspaceId
        ? { ...session, messages: existing.messages }
        : session;
    appStore.dispatch(
      bulkUpsertSessions(
        [merged],
        staleRuntimeFlagClearUpsertOptions(hadInFlightPairBeforeFetch, session),
      ),
    );
    appStore.dispatch(upsertSession(merged));
    if (detail) appStore.dispatch(markAgentDetailHydrated(agentId));
    return merged;
  }

  return {
    receiveAgentSession,
    readAgentSession,
    ensureAgentSession,
    refreshAgentSessionAfterEvent,
    notePendingQuestionMarkerProjection,
    start() {
      disposed = false;
      readKey('', undefined);
    },
    invalidate() {
      connectionGeneration += 1;
      inFlight.clear();
      hydrationInFlight.clear();
      pendingEventRerun.clear();
      markerProjectionGeneration.clear();
      ownership.invalidate();
    },
    dispose() {
      disposed = true;
      connectionGeneration += 1;
      stop?.();
      stop = undefined;
      lifecycleInstalled = false;
      inFlight.clear();
      hydrationInFlight.clear();
      pendingEventRerun.clear();
      markerProjectionGeneration.clear();
      ownership.dispose();
    },
  };
}
