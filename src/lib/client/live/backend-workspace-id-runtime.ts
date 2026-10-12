import type { Unsubscribe } from '../app-client';
import type { BackendTransport } from './backend-transport-types';
import { isEventOneOf, resolveEventType } from './backend-event-matchers';

/** One owner for the existing workspace enumeration cache and push subscription. */
export function createWorkspaceIdRuntime({
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
}: {
  backendRequest: BackendTransport['request'];
  onBackendNotification: BackendTransport['onNotification'];
  onBackendReconnected: BackendTransport['onReconnected'];
}) {
  /**
   * TTL for the module-level `workspace.list` result cache (intent-hq/monorepo#1716):
   * callers within this window share the last fetched id list instead of
   * re-issuing the RPC. Short on purpose — the push-driven shared set (below)
   * is the durable zero-RPC path; the TTL only absorbs pre-seed call bursts.
   */
  const WORKSPACE_LIST_TTL_MS = 2_000;

  let workspaceListCache: { ids: readonly string[]; fetchedAt: number } | null = null;
  let workspaceListRpcInFlight: Promise<string[]> | null = null;

  /**
   * Debug-log every REAL `workspace.list` RPC issue with its caller tag
   * (seed | reconnect | defensive-resync | follow-up | resolver | explicit) so
   * any future flood identifies its source (intent-hq/monorepo#1716).
   * Deliberately `console.debug` (hidden unless devtools Verbose is enabled)
   * rather than the shared ClientLogger, whose default `info` level would
   * suppress the diagnostic entirely.
   */
  function logWorkspaceListRpc(tag: string, detail?: string): void {
    console.debug(`[live-support] workspace.list RPC (${tag})${detail ? `: ${detail}` : ''}`);
  }

  /**
   * Single-flighted raw `workspace.list` RPC: concurrent callers await the one
   * in-flight promise. A successful result populates the TTL cache; failures
   * REJECT (never cached) so every consumer decides its own fallback —
   * `listWorkspaceIds()` resolves `[]` (historical contract) and
   * `runWorkspaceIdResyncFetch` declines to install a set, keeping both paths
   * retryable after the transport recovers.
   */
  function fetchWorkspaceIdsRpc(tag: string, detail?: string): Promise<string[]> {
    if (workspaceListRpcInFlight) return workspaceListRpcInFlight;
    logWorkspaceListRpc(tag, detail);
    const fetch = backendRequest<{ workspaces?: unknown[] }>('workspace.list').then((result) => {
      const workspaces = Array.isArray(result?.workspaces) ? result.workspaces : [];
      const ids = workspaces
        .map((w) =>
          String(
            (w as { id?: unknown; workspaceId?: unknown }).id ??
              (w as { workspaceId?: unknown }).workspaceId ??
              '',
          ),
        )
        .filter((id) => id.length > 0);
      workspaceListCache = { ids, fetchedAt: Date.now() };
      return ids;
    });
    workspaceListRpcInFlight = fetch;
    fetch
      .catch(() => {})
      .finally(() => {
        if (workspaceListRpcInFlight === fetch) workspaceListRpcInFlight = null;
      });
    return fetch;
  }

  /**
   * `listWorkspaceIds` minus the swallow: rejects on transport failure so
   * internal callers that must distinguish "no workspaces" from "fetch failed"
   * (e.g. the note resolver's negative cache) can. Same layered read path:
   *  1. when the push-driven shared set is seeded, serve it directly — zero RPC;
   *  2. otherwise serve the TTL cache when fresh — zero RPC;
   *  3. otherwise issue ONE single-flighted `workspace.list` (concurrent
   *     callers coalesce onto the same promise).
   */
  async function listWorkspaceIdsOrThrow(tag: string): Promise<string[]> {
    if (sharedWorkspaceIds !== null) return [...sharedWorkspaceIds];
    if (
      workspaceListCache !== null &&
      Date.now() - workspaceListCache.fetchedAt < WORKSPACE_LIST_TTL_MS
    ) {
      return [...workspaceListCache.ids];
    }
    return fetchWorkspaceIdsRpc(tag);
  }

  /**
   * Enumerate the daemon's workspace ids (best-effort; empty on transport
   * error). Shared cached read path for ALL renderer callers
   * (intent-hq/monorepo#1716) — see {@link listWorkspaceIdsOrThrow} for the
   * layering. `tag` names the caller in the RPC debug log when a real fetch is
   * issued.
   */
  async function listWorkspaceIds(tag = 'explicit'): Promise<string[]> {
    return listWorkspaceIdsOrThrow(tag).catch(() => []);
  }

  /** Test-only: clear only the workspace.list TTL and raw request caches. */
  function resetListCachesForTests(): void {
    workspaceListCache = null;
    workspaceListRpcInFlight = null;
  }

  /**
   * Legacy workspace events that can change the id SET `listWorkspaceIds()`
   * yields (`workspace.list` is archived-EXCLUSIVE by default, §5.1):
   * create/delete change membership directly, and archive/unarchive land as
   * `workspace:updated` carrying the `changes.archived` delta (§6.5 — there is
   * no dedicated archive event), moving a workspace out of / back into the
   * default listing. High-frequency siblings (`workspace:activity-changed`,
   * `workspace:attention-changed`, …) never change the set and are excluded so
   * the id source does not issue a `workspace.list` round-trip on every
   * activity tick.
   */
  const WORKSPACE_ID_SET_EVENTS = [
    'workspace:created',
    'workspace:updated',
    'workspace:deleted',
  ] as const;

  /**
   * Trailing-coalesce window for the shared id source's resync fetch (seed,
   * reconnect, or a defensive re-enumeration on a malformed payload) — mirrors
   * `LEGACY_REFETCH_COALESCE_MS` in `delta-subscription.ts` so a burst of
   * triggers collapses to at most one in-flight `workspace.list` call plus one
   * trailing follow-up.
   */
  const WORKSPACE_ID_RESYNC_COALESCE_MS = 250;

  /**
   * Ref-counted, push-driven workspace-id broadcaster shared by every
   * `subscribeWorkspaceIds()` caller (the notes/tasks/agents clients each wire
   * one per-workspace typed channel off it, PROTOCOL §6.9). `listWorkspaceIds()`
   * (`workspace.list`) is called ONLY to seed the first subscriber, to recover
   * after `onBackendReconnected`, or defensively when an event that should
   * change the set arrives without the id/fields needed to apply it
   * incrementally — never on every event (the flood this replaces). `null`
   * means "not yet seeded"; teardown at refcount 0 resets it so the next
   * subscriber re-seeds fresh.
   */
  let sharedWorkspaceIds: Set<string> | null = null;
  let workspaceIdRefCount = 0;
  // Keyed by a per-subscription id (not the listener function itself) so two
  // subscriptions passing the same callback reference are tracked
  // independently — a `Set<listener>` would collapse them into one entry and
  // unsubscribing either would silently drop the other's updates.
  const workspaceIdListeners = new Map<number, (ids: readonly string[]) => void>();
  let nextWorkspaceIdListenerId = 0;
  let offWorkspaceIdNotify: Unsubscribe | null = null;
  let offWorkspaceIdReconnect: Unsubscribe | null = null;

  /**
   * Bumped on every direct mutation of `sharedWorkspaceIds` (an incremental
   * add/remove applied from an event payload). A resync fetch captures this
   * value when it starts and only applies its result if it is unchanged at
   * resolve-time — otherwise an incremental update raced the fetch and the set
   * already reflects the current truth, so the (now-stale) fetch result is
   * discarded instead of clobbering it.
   */
  let workspaceIdMutationGeneration = 0;

  let workspaceIdFetchInFlight = false;
  let workspaceIdFetchFollowUpWanted = false;
  let workspaceIdFetchFollowUpTimer: ReturnType<typeof setTimeout> | undefined;

  function notifyWorkspaceIdListeners(): void {
    const ids = sharedWorkspaceIds ? [...sharedWorkspaceIds] : [];
    for (const listener of workspaceIdListeners.values()) listener(ids);
  }

  function runWorkspaceIdResyncFetch(tag: string, detail?: string): void {
    workspaceIdFetchInFlight = true;
    const startGeneration = workspaceIdMutationGeneration;
    // Raw single-flighted RPC on purpose: `listWorkspaceIds()` would serve the
    // (possibly stale) shared set / TTL cache right back, defeating the resync.
    // Joining an ALREADY-in-flight RPC (e.g. an earlier resolver fetch) means
    // the adopted response may have been computed before this trigger — arm the
    // trailing follow-up so one fresh fetch reconciles, exactly like a raced
    // incremental event.
    if (workspaceListRpcInFlight !== null) workspaceIdFetchFollowUpWanted = true;
    void fetchWorkspaceIdsRpc(tag, detail)
      .then((ids) => {
        // An incremental update raced this fetch, so its result may already be
        // stale (it was computed before that update landed). Arm the trailing
        // coalesced follow-up (below) so we reconcile with one more fetch
        // instead of silently losing the race. While the set is still unseeded
        // (`null`) the raced result is nonetheless applied as the BASE set —
        // never discarded — so the set can't stay null under event pressure
        // (intent-hq/monorepo#1716 seed race); the follow-up then reconciles
        // the raced events. `workspaceIdRefCount === 0` means teardown bumped
        // the generation to invalidate this fetch: never repopulate after it.
        if (workspaceIdMutationGeneration !== startGeneration) {
          if (workspaceIdRefCount === 0) return;
          workspaceIdFetchFollowUpWanted = true;
          if (sharedWorkspaceIds !== null) return;
        }
        sharedWorkspaceIds = new Set(ids);
        workspaceIdMutationGeneration += 1;
        notifyWorkspaceIdListeners();
      })
      .catch(() => {
        // Transport failure: deliver a best-effort empty list to listeners so
        // they are not left waiting, but do NOT install an empty set — the set
        // stays unseeded (`null`) so `listWorkspaceIds()` keeps falling through
        // to a real RPC and the next event / reconnect / subscriber re-seeds
        // once the transport recovers. Installing `new Set()` here would lock
        // every caller onto an empty fast path until an unrelated event.
        if (sharedWorkspaceIds === null) {
          for (const listener of workspaceIdListeners.values()) listener([]);
        }
      })
      .finally(() => {
        workspaceIdFetchInFlight = false;
        if (!workspaceIdFetchFollowUpWanted) return;
        workspaceIdFetchFollowUpWanted = false;
        workspaceIdFetchFollowUpTimer = setTimeout(() => {
          workspaceIdFetchFollowUpTimer = undefined;
          if (workspaceIdRefCount > 0) runWorkspaceIdResyncFetch('follow-up');
        }, WORKSPACE_ID_RESYNC_COALESCE_MS);
      });
  }

  /**
   * Single-flighted, trailing-coalesced resync trigger (seed/reconnect/
   * defensive), mirroring `coalescedRefetchEmit` in `delta-subscription.ts`: a
   * trigger while a trailing follow-up is already scheduled is absorbed (that
   * follow-up will re-fetch the latest state); a trigger while a fetch is
   * in-flight arms exactly one trailing follow-up; otherwise fetch immediately.
   * `tag`/`detail` name the trigger in the RPC debug log.
   */
  function resyncWorkspaceIds(tag: string, detail?: string): void {
    if (workspaceIdFetchFollowUpTimer !== undefined) return;
    if (workspaceIdFetchInFlight) {
      workspaceIdFetchFollowUpWanted = true;
      return;
    }
    runWorkspaceIdResyncFetch(tag, detail);
  }

  /**
   * Add `id` to the shared set and notify listeners, but only if it changed.
   * While the initial seed fetch is still in flight (`sharedWorkspaceIds ===
   * null`) the id can't be applied yet, but the event must not be silently
   * dropped: bump the generation so the in-flight `workspace.list` snapshot
   * (taken before this event) is treated as stale, and arm a trailing resync
   * so the set is reconciled once that fetch settles.
   */
  function addWorkspaceId(id: string): void {
    if (!sharedWorkspaceIds) {
      workspaceIdMutationGeneration += 1;
      resyncWorkspaceIds('defensive-resync', 'workspace event before seed settled');
      return;
    }
    if (sharedWorkspaceIds.has(id)) return;
    sharedWorkspaceIds.add(id);
    workspaceIdMutationGeneration += 1;
    // The set changed: any TTL-cached snapshot predates this event. Drop it so
    // a post-teardown caller can't be served a pre-event id list.
    workspaceListCache = null;
    notifyWorkspaceIdListeners();
  }

  /**
   * Remove `id` from the shared set and notify listeners, but only if it
   * changed. See {@link addWorkspaceId} for the seed-time (`null` set) race
   * handling.
   */
  function removeWorkspaceId(id: string): void {
    if (!sharedWorkspaceIds) {
      workspaceIdMutationGeneration += 1;
      resyncWorkspaceIds('defensive-resync', 'workspace event before seed settled');
      return;
    }
    if (!sharedWorkspaceIds.has(id)) return;
    sharedWorkspaceIds.delete(id);
    workspaceIdMutationGeneration += 1;
    // See addWorkspaceId: keep the TTL cache consistent with the push source.
    workspaceListCache = null;
    notifyWorkspaceIdListeners();
  }

  /** Resolve the `data` payload of an `events.event` notification (mirrors `resolveEventType`'s envelope unwrap). */
  function resolveEventData(params: unknown): unknown {
    if (!params || typeof params !== 'object') return undefined;
    const wrapped = (params as { event?: unknown }).event;
    if (wrapped && typeof wrapped === 'object') return (wrapped as { data?: unknown }).data;
    return (params as { data?: unknown }).data;
  }

  /** Extract a workspace id from a `workspace:created`/`workspace:deleted` payload's `workspaceId` or `workspace.id`. */
  function extractCreatedOrDeletedWorkspaceId(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const rec = data as Record<string, unknown>;
    if (typeof rec.workspaceId === 'string' && rec.workspaceId.length > 0) return rec.workspaceId;
    const nested = rec.workspace;
    if (nested && typeof nested === 'object') {
      const nestedId = (nested as Record<string, unknown>).id;
      if (typeof nestedId === 'string' && nestedId.length > 0) return nestedId;
    }
    return undefined;
  }

  /** Whether a `workspace:created` payload's embedded workspace is (unexpectedly) already archived. */
  function isCreatedWorkspaceArchived(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    const nested = (data as Record<string, unknown>).workspace;
    if (!nested || typeof nested !== 'object') return false;
    return (nested as Record<string, unknown>).archived === true;
  }

  /**
   * Apply one `events.event` notification to the shared id set. Valid
   * `workspace:created`/`workspace:deleted` mutate the set directly from the
   * payload's id; `workspace:updated` inspects ONLY `changes.archived` (every
   * other delta — lastActivity, git fields, status text, … — is ignored: no
   * fetch, no notify). A payload that arrives without the id/fields needed to
   * apply it incrementally — or a truly typeless payload — falls back to a
   * defensive coalesced resync (older daemons / malformed payloads).
   */
  function applyWorkspaceIdEvent(method: string, params: unknown): void {
    if (!isEventOneOf(method, params, WORKSPACE_ID_SET_EVENTS)) return;
    const type = resolveEventType(params);
    if (type === undefined) {
      resyncWorkspaceIds('defensive-resync', 'typeless event payload');
      return;
    }
    const data = resolveEventData(params);
    if (type === 'workspace:created') {
      const id = extractCreatedOrDeletedWorkspaceId(data);
      if (!id) {
        resyncWorkspaceIds('defensive-resync', `${type} without workspace id`);
        return;
      }
      if (isCreatedWorkspaceArchived(data)) return;
      addWorkspaceId(id);
      return;
    }
    if (type === 'workspace:deleted') {
      const id = extractCreatedOrDeletedWorkspaceId(data);
      if (!id) {
        resyncWorkspaceIds('defensive-resync', `${type} without workspace id`);
        return;
      }
      removeWorkspaceId(id);
      return;
    }
    if (type === 'workspace:updated') {
      const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
      const id = typeof rec?.workspaceId === 'string' ? rec.workspaceId : undefined;
      const changes = rec?.changes;
      if (!id || !changes || typeof changes !== 'object') {
        resyncWorkspaceIds('defensive-resync', `${type} without workspaceId/changes`);
        return;
      }
      const archived = (changes as Record<string, unknown>).archived;
      if (archived === true) removeWorkspaceId(id);
      else if (archived === false) addWorkspaceId(id);
      // Any other delta (lastActivity, git fields, status text, …) is ignored.
    }
  }

  /**
   * Dynamic workspace-id source for the per-workspace typed channels (one
   * `note`/`task`/`agent.subscribe` per workspace, PROTOCOL §6.9): a shared,
   * ref-counted, push-driven broadcaster. The first subscriber wires the
   * notification/reconnect listeners and seeds the set via ONE
   * `listWorkspaceIds()` call; every subsequent event that can change set
   * membership ({@link WORKSPACE_ID_SET_EVENTS}) is applied incrementally from
   * its own payload — steady-state operation issues ZERO `workspace.list`
   * calls. The last unsubscribe tears the shared listeners down and resets the
   * seed so the next subscriber starts fresh.
   */
  function subscribeWorkspaceIds(listener: (ids: readonly string[]) => void): Unsubscribe {
    let disposed = false;
    workspaceIdRefCount += 1;
    const listenerId = nextWorkspaceIdListenerId++;
    workspaceIdListeners.set(listenerId, listener);

    if (workspaceIdRefCount === 1) {
      offWorkspaceIdNotify = onBackendNotification((n) =>
        applyWorkspaceIdEvent(n.method, n.params),
      );
      offWorkspaceIdReconnect = onBackendReconnected(() => resyncWorkspaceIds('reconnect'));
      resyncWorkspaceIds('seed');
    } else if (sharedWorkspaceIds !== null) {
      // Already seeded: give the new subscriber the current set immediately.
      listener([...sharedWorkspaceIds]);
    }

    return () => {
      if (disposed) return;
      disposed = true;
      workspaceIdListeners.delete(listenerId);
      workspaceIdRefCount -= 1;
      if (workspaceIdRefCount > 0) return;
      offWorkspaceIdNotify?.();
      offWorkspaceIdNotify = null;
      offWorkspaceIdReconnect?.();
      offWorkspaceIdReconnect = null;
      if (workspaceIdFetchFollowUpTimer !== undefined) {
        clearTimeout(workspaceIdFetchFollowUpTimer);
        workspaceIdFetchFollowUpTimer = undefined;
      }
      workspaceIdFetchFollowUpWanted = false;
      sharedWorkspaceIds = null;
      // Invalidate any still-in-flight fetch from this cycle so a late resolve
      // cannot repopulate the set after the last subscriber has torn it down.
      workspaceIdMutationGeneration += 1;
    };
  }

  return {
    listWorkspaceIds,
    listWorkspaceIdsOrThrow,
    subscribeWorkspaceIds,
    resetListCachesForTests,
  };
}
