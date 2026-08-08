/**
 * Shared helpers for the live domain clients.
 *
 * Several daemon read methods are workspace-scoped (`note.get`, `comment.list`,
 * `file.read`, …) while the corresponding AppClient signatures only carry an
 * entity id (the interface is fixed). These helpers bridge that gap:
 *  - `listWorkspaceIds()` enumerates the daemon's workspaces so a no-arg
 *    `subscribe()` can aggregate workspace-scoped collections.
 *  - a small note→workspace index, populated by `LiveNotesClient.list`, lets the
 *    note-scoped clients (`notes.get`, `tasks.get`, `comments.list`) resolve a
 *    workspace without an extra parameter; when the cache misses they fall back
 *    to scanning the workspace list.
 */
import type { MutationResult, Unsubscribe } from '../app-client';
import { backendRequest, onBackendNotification, onBackendReconnected } from './backend-transport';

/**
 * Generate an idempotency key for create/commit/merge mutations (§5.6): a UUID
 * when the platform exposes `crypto.randomUUID`, otherwise a best-effort unique
 * string. The server dedupes retried requests by this key.
 */
export function newIdempotencyKey(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoObj?.randomUUID === 'function') return cryptoObj.randomUUID();
  return `idk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Human-readable message for a failed mutation. The daemon maps
 * `Error::Internal` to JSON-RPC -32603 with the hardcoded message
 * "Internal error" and carries the real cause as a string in `error.data`; the
 * main-process bridge (`json-rpc-errors.ts`) normalizes that string onto
 * `data.detail` before it crosses the IPC boundary. When the generic message
 * is all we have, fold the detail into the message so toasts stay actionable.
 * A raw string `data` is handled too for transports that skip the
 * normalization.
 */
export function mutationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'Internal error' && error && typeof error === 'object') {
    const data = (error as { data?: unknown }).data;
    if (typeof data === 'string' && data.length > 0) return `${message}: ${data}`;
    if (data && typeof data === 'object') {
      const detail = (data as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.length > 0) return `${message}: ${detail}`;
    }
  }
  return message;
}

/** Numeric JSON-RPC code the daemon returns for an optimistic-concurrency conflict (§11.4-D). */
export const CONFLICT_RPC_CODE = -32005;

/**
 * Detect the daemon's optimistic-concurrency conflict response EXACTLY: numeric
 * `rpcCode === -32005` AND `data.code === "conflict"`. On a match it returns the
 * authoritative server entity (`data.current`, which carries the advanced `rev`)
 * wrapped for the MutationResult; every other error returns `undefined` so
 * generic failures behave exactly as today. Duck-typed (no `instanceof`) so it
 * works regardless of how the transport layer is mocked in tests.
 */
export function extractConflict(error: unknown): { current: unknown } | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ((error as { rpcCode?: unknown }).rpcCode !== CONFLICT_RPC_CODE) return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return undefined;
  if ((data as { code?: unknown }).code !== 'conflict') return undefined;
  return { current: (data as { current?: unknown }).current };
}

/**
 * Extract the daemon's echoed authoritative note revision (`noteRev`, #638)
 * from a mutation response. Returned by mutations that rewrite a note's
 * content daemon-side (e.g. `comment.add`'s anchor insertion). Tolerant of
 * older daemons that omit the field: returns `undefined` unless the response
 * carries a finite number.
 */
function extractNoteRev(result: unknown): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const noteRev = (result as { noteRev?: unknown }).noteRev;
  return typeof noteRev === 'number' && Number.isFinite(noteRev) ? noteRev : undefined;
}

/**
 * Issue a mutating JSON-RPC request and fold the outcome into a `MutationResult`:
 * success on resolve, `{ success: false, error }` on any transport/daemon error.
 * An optimistic-concurrency conflict (§11.4-D) additionally carries the raw
 * `conflict.current` so callers can reload-to-latest. When the daemon echoes an
 * authoritative `noteRev` (#638), it is surfaced on the result so rev
 * bookkeeping can consume it instead of inferring `rev + 1`. The seam never
 * throws from a mutation. State convergence is otherwise left to the existing
 * subscribe→refetch loops driven by daemon events.
 *
 * `options.timeoutMs` overrides the JSON-RPC client's default 30s timeout for
 * long-running operations (e.g. `workspace.delete` bulk operations on large
 * checkouts).
 */
export async function runMutation(
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number },
): Promise<MutationResult> {
  try {
    // Only forward options when defined to preserve 2-arg wire protocol shape
    const result = await (options !== undefined
      ? backendRequest(method, params, options)
      : backendRequest(method, params));
    const noteRev = extractNoteRev(result);
    return noteRev !== undefined ? { success: true, noteRev } : { success: true };
  } catch (error) {
    const conflict = extractConflict(error);
    if (conflict) return { success: false, error: mutationErrorMessage(error), conflict };
    return { success: false, error: mutationErrorMessage(error) };
  }
}

/**
 * Extract the canonical entity id from a daemon mutation response. Handles a
 * bare entity (`{ id }`) and the common single-entity wrappers the daemon uses
 * (`{ task }`, `{ note }`, `{ entity }`). Returns undefined when no id is found.
 */
function extractEntityId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  const direct = record.id;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  for (const key of ['task', 'note', 'entity']) {
    const nested = record[key];
    if (nested && typeof nested === 'object') {
      const nestedId = (nested as Record<string, unknown>).id;
      if (typeof nestedId === 'string' && nestedId.length > 0) return nestedId;
    }
  }
  return undefined;
}

/**
 * Like `runMutation`, but also surfaces the created/affected entity's canonical
 * id on success when the daemon returns one (e.g. the Rev 2 §7.9 task mutations
 * return a WorkspaceTask). Call sites that need the new id — such as creating a
 * prerequisite task and then linking to it — use this variant; the id is omitted
 * when the response carries none.
 */
export async function runMutationWithId(
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number },
): Promise<MutationResult> {
  try {
    // Only forward options when defined to preserve 2-arg wire protocol shape
    const result = await (options !== undefined
      ? backendRequest(method, params, options)
      : backendRequest(method, params));
    const id = extractEntityId(result);
    return id !== undefined ? { success: true, id } : { success: true };
  } catch (error) {
    const conflict = extractConflict(error);
    if (conflict) return { success: false, error: mutationErrorMessage(error), conflict };
    return { success: false, error: mutationErrorMessage(error) };
  }
}

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
export async function listWorkspaceIds(tag = 'explicit'): Promise<string[]> {
  return listWorkspaceIdsOrThrow(tag).catch(() => []);
}

/** Test-only: clear the module-level workspace.list / note-resolution caches. */
export function __resetLiveSupportCachesForTests(): void {
  workspaceListCache = null;
  workspaceListRpcInFlight = null;
  noteResolveNegativeCache.clear();
  noteResolveScansInFlight.clear();
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
export function subscribeWorkspaceIds(listener: (ids: readonly string[]) => void): Unsubscribe {
  let disposed = false;
  workspaceIdRefCount += 1;
  const listenerId = nextWorkspaceIdListenerId++;
  workspaceIdListeners.set(listenerId, listener);

  if (workspaceIdRefCount === 1) {
    offWorkspaceIdNotify = onBackendNotification((n) => applyWorkspaceIdEvent(n.method, n.params));
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

/** noteId → workspaceId, populated as notes are listed so note-scoped reads resolve. */
const noteWorkspaceIndex = new Map<string, string>();

/**
 * Record the workspace a note belongs to (called from `LiveNotesClient.list`).
 * Discovering a note also clears any negative-cache entry for it so a note
 * that appears within the negative TTL resolves immediately.
 */
export function rememberNoteWorkspace(noteId: string, workspaceId: string): void {
  if (noteId && workspaceId) {
    noteWorkspaceIndex.set(noteId, workspaceId);
    noteResolveNegativeCache.delete(noteId);
  }
}

/**
 * Negative-cache TTL for `resolveNoteWorkspaceId`: a noteId no workspace
 * claimed is remembered for this long so repeated resolution attempts (e.g.
 * a component retrying a dangling note reference) don't re-scan every
 * workspace's `note.list` back to back (intent-hq/monorepo#1716).
 */
const NOTE_RESOLVE_NEGATIVE_TTL_MS = 5_000;

/** noteId → time the last COMPLETE full scan found NO owning workspace. */
const noteResolveNegativeCache = new Map<string, number>();

/** noteId → in-flight full scan, so concurrent resolutions coalesce onto one. */
const noteResolveScansInFlight = new Map<string, Promise<string | null>>();

/**
 * Full workspace scan for one noteId: walks each workspace's `note.list`
 * (caching every note it sees) until the note is found. A miss is
 * negative-cached ONLY when the scan actually established it: the workspace
 * enumeration succeeded, at least one workspace was scanned, and every
 * `note.list` call succeeded. A vacuous scan (failed `workspace.list`) or one
 * with a failed workspace has not proven that no workspace claims the note,
 * so the next resolution retries instead of serving a stale `null`.
 */
async function scanForNoteWorkspace(noteId: string): Promise<string | null> {
  let workspaceIds: string[];
  try {
    workspaceIds = await listWorkspaceIdsOrThrow('resolver');
  } catch {
    return null;
  }
  let scanComplete = true;
  for (const workspaceId of workspaceIds) {
    try {
      const result = await backendRequest<{ notes?: unknown[] }>('note.list', { workspaceId });
      const notes = Array.isArray(result?.notes) ? result.notes : [];
      let found = false;
      for (const note of notes) {
        const id = String((note as { id?: unknown }).id ?? '');
        if (id) rememberNoteWorkspace(id, workspaceId);
        if (id === noteId) found = true;
      }
      if (found) return workspaceId;
    } catch {
      // Skip workspaces whose notes cannot be listed — but remember the scan
      // is incomplete so the miss is not negative-cached.
      scanComplete = false;
    }
  }
  if (scanComplete && workspaceIds.length > 0) noteResolveNegativeCache.set(noteId, Date.now());
  return null;
}

/**
 * Resolve the workspace a note belongs to. Returns the cached value when known,
 * otherwise scans each workspace's `note.list` (caching every note it sees)
 * until the note is found. Concurrent resolutions of the same noteId coalesce
 * onto ONE in-flight scan. Returns `null` when no workspace claims the note;
 * a COMPLETE-scan miss is negative-cached for
 * {@link NOTE_RESOLVE_NEGATIVE_TTL_MS} so a burst of retries for the same
 * unknown note performs one scan, not many.
 */
export async function resolveNoteWorkspaceId(noteId: string): Promise<string | null> {
  const cached = noteWorkspaceIndex.get(noteId);
  if (cached) return cached;

  const missedAt = noteResolveNegativeCache.get(noteId);
  if (missedAt !== undefined) {
    if (Date.now() - missedAt < NOTE_RESOLVE_NEGATIVE_TTL_MS) return null;
    noteResolveNegativeCache.delete(noteId);
  }

  const inFlight = noteResolveScansInFlight.get(noteId);
  if (inFlight) return inFlight;

  const scan = scanForNoteWorkspace(noteId).finally(() => {
    noteResolveScansInFlight.delete(noteId);
  });
  noteResolveScansInFlight.set(noteId, scan);
  return scan;
}

/**
 * Resolve the event `type` from an `events.event` notification's params. The
 * daemon wraps each domain event as `{ event: { type, … }, subscriptionId? }`
 * (mirrors extractEvent in features/events/daemon-events-bridge.ts); legacy /
 * flat payloads place `type` directly on params. Returns `undefined` only when
 * the type is genuinely absent AFTER unwrapping, so the family/type matchers'
 * defensive-match branch still fires for truly typeless payloads but not for
 * properly wrapped events of an unrelated family.
 */
function resolveEventType(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const wrapped = (params as { event?: unknown }).event;
  if (wrapped && typeof wrapped === 'object') {
    const wrappedType = (wrapped as { type?: unknown }).type;
    if (typeof wrappedType === 'string') return wrappedType;
  }
  const flat = (params as { type?: unknown }).type;
  return typeof flat === 'string' ? flat : undefined;
}

/** Whether a daemon notification belongs to the given colon-delimited event family. */
export function isEventInFamily(method: string, params: unknown, family: string): boolean {
  if (method !== 'events.event') return false;
  const type = resolveEventType(params);
  // Refetch on any event whose type starts with the family; if the type is
  // absent (older daemons) refetch defensively.
  return type === undefined || type.startsWith(family);
}

/** Whether a daemon notification's event type is one of the listed types. */
export function isEventOneOf(method: string, params: unknown, types: readonly string[]): boolean {
  if (method !== 'events.event') return false;
  const type = resolveEventType(params);
  if (type === undefined) return true;
  return types.includes(type);
}
