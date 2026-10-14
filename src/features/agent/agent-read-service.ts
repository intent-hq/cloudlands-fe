import { trackAgentMetadataRead } from './agent-metadata-read-lane';
import { acquireAgentMetadataDemand } from './agent-metadata-demand';
import { getPhysicalRequestCompletion } from '$shared/event-recovery/session';
import { withRecoveryLifetime } from '$store/renderer/middlewares/event-recovery';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { agentMetadataRecoveryKey } from './agent-recovery-keys';
import { claimAgentReadOwnership, getAgentReadContext } from './agent-read-ownership';
import { onBackendReconnected } from '$lib/client/live/backend-transport';
/**
 * Reusable agent-session read seam used by the agent read saga and event router.
 *
 * `ensureAgentSession(agentId, workspaceId)` fetches `appClient.agents.get` and hydrates the
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
 * `agent.get` returns message COUNTS only. chat.subscribe owns live history;
 * metadata reads preserve that separately hydrated transcript.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam, the
 * configured store, the slice actions, and the logger.
 */
import { appClient } from '$lib/client';
import type { AgentSession } from '$shared/types';
import type { AgentSessionProjectionVersions } from '$store/renderer/slices/agent-session/agent-session-types';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  markAgentDetailHydrated,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { createLogger } from '$lib/utils/client-logger';
import { isAgentDeletionPending } from './utils/pending-agent-deletions';
import { isAgentNotFoundError } from './utils/agent-not-found-error';
import { staleRuntimeFlagClearUpsertOptions } from './utils/stale-runtime-flag-clear';

const logger = createLogger('AgentReadService');
let connectionGeneration = 0;
let lifecycleInstalled = false;
function readKey(agentId: string, workspaceId?: string): string {
  if (!lifecycleInstalled) {
    lifecycleInstalled = true;
    onBackendReconnected(() => {
      connectionGeneration += 1;
      inFlight.clear();
      hydrationInFlight.clear();
      pendingEventRerun.clear();
      markerProjectionGeneration.clear();
    });
  }
  return JSON.stringify([
    connectionGeneration,
    getAgentReadContext(),
    workspaceId ?? null,
    agentId,
  ]);
}

/** In-flight wire reads keyed by agent id; shared by every metadata caller. */
const inFlight = new Map<string, Promise<AgentSession | null>>();

/** Logical deadlines release callers, but confirmation must await the actual wire replies. */
const physicalReads = new WeakMap<object, Map<string, Set<Promise<void>>>>();

function physicalReadKey(agentId: string, workspaceId?: string): string {
  return JSON.stringify([workspaceId ?? null, agentId]);
}

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

export function notePendingQuestionMarkerProjection(agentId: string, workspaceId?: string): void {
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

/** A read started before a push must not roll its fields back on arrival. */
function preserveLocalUpdates(
  before: AgentSession | undefined,
  incoming: AgentSession | null,
  beforeProjection: AgentSessionProjectionVersions | undefined,
): AgentSession | null {
  if (!incoming || !before || before.workspaceId !== incoming.workspaceId) return incoming;
  const current = appStore.state.agentSessions?.byAgentId[String(incoming.id)];
  if (!current || current.workspaceId !== incoming.workspaceId) return incoming;
  const projected = appStore.state.agentSessions.projectionVersions?.[String(incoming.id)];
  const merged = { ...incoming };
  for (const key of new Set([
    ...Object.keys(current),
    ...Object.keys(projected?.fields ?? {}),
  ]) as Set<keyof AgentSession>) {
    if (key === 'metadata') continue;
    if (current[key] !== before[key] || projected?.fields[key] !== beforeProjection?.fields[key])
      Object.assign(merged, { [key]: current[key] });
  }
  const metadata = { ...incoming.metadata };
  for (const key of new Set([
    ...Object.keys(before.metadata ?? {}),
    ...Object.keys(current.metadata ?? {}),
    ...Object.keys(projected?.metadata ?? {}),
  ])) {
    // Extension keys can name Object.prototype members. Only own values and
    // revisions represent metadata; a missing own key is an explicit deletion.
    const hasCurrent = Object.hasOwn(current.metadata ?? {}, key);
    const hasBefore = Object.hasOwn(before.metadata ?? {}, key);
    const currentValue = hasCurrent ? current.metadata?.[key] : undefined;
    const beforeValue = hasBefore ? before.metadata?.[key] : undefined;
    const revision = Object.hasOwn(projected?.metadata ?? {}, key)
      ? projected?.metadata[key]
      : undefined;
    const beforeRevision = Object.hasOwn(beforeProjection?.metadata ?? {}, key)
      ? beforeProjection?.metadata[key]
      : undefined;
    if (hasCurrent !== hasBefore || currentValue !== beforeValue || revision !== beforeRevision) {
      if (hasCurrent) {
        Object.defineProperty(metadata, key, {
          value: currentValue,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      } else delete metadata[key];
    }
  }
  merged.metadata = metadata;
  return merged;
}

/**
 * Refresh after a daemon event without losing an update behind an older read.
 * If a read is already in flight, one trailing read is scheduled after it;
 * further events during that read share the same trailing promise.
 */
async function refreshAgentSessionAfterEventWithDemand(
  agentId: string,
  workspaceId?: string,
): Promise<void> {
  workspaceId ??= appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
  const recovery = rendererEventRecovery.capture(agentMetadataRecoveryKey(workspaceId));
  if (!recovery.commit(() => undefined)) return;
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
      if (
        connection === connectionGeneration &&
        ownership.isCurrent() &&
        recovery.commit(() => undefined)
      )
        return ensureAgentSession(agentId, workspaceId);
    },
    () => {
      // A rejected leading read is not cached and must not suppress the event's
      // authoritative trailing retry.
      pendingEventRerun.delete(key);
      if (
        connection === connectionGeneration &&
        ownership.isCurrent() &&
        recovery.commit(() => undefined)
      )
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
 * Fields changed by local pushes while the request was in flight stay current;
 * the explicit question-marker guard also protects repeated marker clears.
 */
export function readAgentSession(
  agentId: string,
  workspaceId?: string,
): Promise<AgentSession | null> {
  workspaceId ??= appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
  const release = workspaceId ? acquireAgentMetadataDemand(workspaceId, { agentId }) : () => {};
  const recovery = rendererEventRecovery.capture(agentMetadataRecoveryKey(workspaceId));
  if (!recovery.commit(() => undefined)) {
    release();
    return Promise.resolve(null);
  }
  const key = readKey(agentId, workspaceId);
  const pending = inFlight.get(key);
  if (pending) {
    release();
    return pending;
  }

  // Explicit-workspace raw readers also run outside the initialized renderer
  // (for example isolated saga stores). Only renderer reads have local pushes
  // to preserve; keep the raw seam usable without a mounted store.
  let beforeRead: AgentSession | undefined;
  let beforeProjection: AgentSessionProjectionVersions | undefined;
  try {
    beforeRead = appStore.state.agentSessions?.byAgentId[agentId];
    beforeProjection = appStore.state.agentSessions?.projectionVersions?.[agentId];
  } catch {
    beforeRead = undefined;
  }
  const context = getAgentReadContext();
  const generation = ++readGeneration;
  const connection = connectionGeneration;
  const physicalSession = rendererEventRecovery.capturePhysicalSessionIdentity();
  const request = () =>
    connection === connectionGeneration &&
    context === getAgentReadContext() &&
    recovery.commit(() => undefined)
      ? appClient.agents.get(agentId, workspaceId)
      : Promise.resolve(null);
  const run = (workspaceId ? trackAgentMetadataRead(workspaceId, request) : request())
    .then((session) =>
      connection === connectionGeneration &&
      context === getAgentReadContext() &&
      recovery.commit(() => undefined)
        ? preserveLocalUpdates(
            beforeRead,
            preserveProjectedQuestionMarkers(agentId, generation, session),
            beforeProjection,
          )
        : null,
    )
    .finally(() => {
      release();
      if (inFlight.get(key) === run) inFlight.delete(key);
    });
  inFlight.set(key, run);
  const reads = physicalReads.get(physicalSession) ?? new Map<string, Set<Promise<void>>>();
  physicalReads.set(physicalSession, reads);
  const physicalKey = physicalReadKey(agentId, workspaceId);
  const active = reads.get(physicalKey) ?? new Set<Promise<void>>();
  reads.set(physicalKey, active);
  const completed = run.then(
    () => {},
    async (error: unknown) => {
      await getPhysicalRequestCompletion(error);
    },
  );
  active.add(completed);
  void completed.then(() => {
    active.delete(completed);
    if (!active.size && reads.get(physicalKey) === active) reads.delete(physicalKey);
  });
  return run;
}

/**
 * Confirm state after a caller's observation. A shared read already in flight
 * may predate that observation: drain it once, then use the existing raw lane
 * for a fresh request. Concurrent callers behind that read coalesce there.
 * This performs no hydration and never retries its own confirmation request.
 */
export async function readAgentSessionAfterCurrent(
  agentId: string,
  workspaceId: string,
  isCurrent: () => boolean,
): Promise<AgentSession | null> {
  const release = acquireAgentMetadataDemand(workspaceId, { agentId });
  const recovery = rendererEventRecovery.capture(agentMetadataRecoveryKey(workspaceId));
  readKey(agentId, workspaceId);
  const connection = connectionGeneration;
  const ownership = claimAgentReadOwnership(agentId, workspaceId);
  const current = () =>
    connection === connectionGeneration &&
    ownership.isCurrent() &&
    recovery.commit(() => undefined) &&
    isCurrent();
  try {
    if (!current()) return null;
    const pending = physicalReads
      .get(rendererEventRecovery.capturePhysicalSessionIdentity())
      ?.get(physicalReadKey(agentId, workspaceId));
    if (pending?.size) await Promise.all([...pending]);
    if (!current()) return null;
    const session = await readAgentSession(agentId, workspaceId);
    return current() ? session : null;
  } finally {
    release();
  }
}

async function hydrateAgentSession(
  agentId: string,
  ownership: ReturnType<typeof claimAgentReadOwnership>,
  workspaceId?: string,
): Promise<AgentSession | null> {
  workspaceId ??= appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
  const recovery = rendererEventRecovery.capture(agentMetadataRecoveryKey(workspaceId));
  if (!recovery.commit(() => undefined)) return null;
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
      ownership.isCurrent() &&
      recovery.commit(() => undefined) &&
      session &&
      !session.pendingDeleteAt &&
      !isAgentDeletionPending(agentId)
    ) {
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
        withRecoveryLifetime(
          bulkUpsertSessions(
            [merged],
            staleRuntimeFlagClearUpsertOptions(hadInFlightPairBeforeFetch, session),
          ),
          recovery,
        ),
      );
      appStore.dispatch(withRecoveryLifetime(upsertSession(merged), recovery));
      appStore.dispatch(withRecoveryLifetime(markAgentDetailHydrated(agentId), recovery));
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
    hydrationInFlight.delete(ownership.key);
  }
}

/**
 * Fetch a single agent's session from the seam and hydrate the store with it.
 * Errors are swallowed (logged only) so a failed read leaves any prior session
 * intact rather than clearing it. Concurrent calls for the same agent share one
 * fetch.
 */
async function ensureAgentSessionWithDemand(agentId: string, workspaceId?: string): Promise<void> {
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

export async function ensureAgentSession(agentId: string, workspaceId?: string): Promise<void> {
  workspaceId ??= appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
  const release = workspaceId ? acquireAgentMetadataDemand(workspaceId, { agentId }) : () => {};
  try {
    return await ensureAgentSessionWithDemand(agentId, workspaceId);
  } finally {
    release();
  }
}

export async function refreshAgentSessionAfterEvent(
  agentId: string,
  workspaceId?: string,
): Promise<void> {
  workspaceId ??= appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId;
  const release = workspaceId ? acquireAgentMetadataDemand(workspaceId, { agentId }) : () => {};
  try {
    return await refreshAgentSessionAfterEventWithDemand(agentId, workspaceId);
  } finally {
    release();
  }
}
