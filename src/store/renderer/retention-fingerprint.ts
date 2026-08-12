/**
 * Renderer retention fingerprint.
 *
 * Emits one greppable `[RetentionFingerprint]` line per interval describing
 * *how many* things the renderer is holding — store entities, diff caches,
 * diff worker pool leases and IPC listener registrations. It exists so a
 * growing renderer heap in a user's `console-output.log` can be attributed to
 * a collection without asking that user for a heap snapshot.
 *
 * Two IPC-shaped numbers are reported and they measure different things — the
 * line labels them apart because confusing one for the other reads a healthy
 * session as broken, or a leaking one as fine:
 *
 * - `ipcBackendListeners` counts *bridge listener registrations*. The transport
 *   fans every subscriber out from one shared listener per channel, so this is
 *   a tripwire pinned at 0 or 1 per live channel; a climbing value means the
 *   fan-out regressed, not that subscribers accumulated.
 * - `fanoutSubscribers` (and the per-channel `fanout.<channel>` fields) counts
 *   the *renderer subscribers* behind that shared listener. This is the gauge
 *   the pile-up in monorepo#2034 would move today.
 *
 * Two properties matter and are load-bearing:
 *
 * - **Counts only.** Every reader below is a `.length`, a `.size` or an
 *   `Object.keys()` over a scope map. Nothing walks an entity, serializes
 *   state, or touches message bodies, so the cost is proportional to the
 *   number of collections (~10²), not to the bytes they retain.
 * - **Samples during boot.** The `backend:notification` listener pile-up
 *   observed in the field (monorepo#2034) reached its warning threshold 2.05 s
 *   and 5.75 s after session start, so a 5-minute-only cadence would miss the
 *   registration burst entirely and report a steady state that looks fine. The
 *   first sample is therefore taken shortly after start, before the interval
 *   takes over.
 *
 * This module only measures. Changing what the renderer retains is a separate
 * decision; nothing here evicts, trims or unsubscribes.
 */
import { inspectChannelFanoutSubscribers } from '$lib/client/live/electron-ipc-transport';
import { createLogger } from '$lib/utils/client-logger';
import {
  inspectDiffCaches,
  inspectDiffWorkerPoolLifecycle,
} from '$lib/utils/diff-highlighter-preloader';

const logger = createLogger('retention-fingerprint');

/** Prefix every emitted line carries, so a bundle can be filtered with one grep. */
export const RETENTION_FINGERPRINT_PREFIX = '[RetentionFingerprint]';

/** Steady-state cadence. */
export const RETENTION_FINGERPRINT_INTERVAL_MS = 5 * 60_000;

/**
 * Delay before the first sample. Long enough for boot subscriptions to have
 * registered (the observed listener warnings land by ~5.8 s), short enough
 * that the boot-time picture is still recorded if the session is closed early.
 */
export const RETENTION_FINGERPRINT_FIRST_SAMPLE_MS = 10_000;

/** Channel prefix whose listener registrations are broken out individually. */
const BACKEND_CHANNEL_PREFIX = 'backend:';

/** Field-name prefix for the per-channel fan-out subscriber counts. */
const FANOUT_FIELD_PREFIX = 'fanout.';

/**
 * Structural view of the slices the fingerprint reads.
 *
 * Deliberately *not* the real `StoreState`: every field is optional and read
 * defensively, so a slice being renamed or removed degrades that one count to
 * 0 instead of throwing inside a diagnostic timer, and the collector stays
 * unit-testable without constructing the full store.
 */
export interface RetentionFingerprintState {
  [sliceName: string]: unknown;
}

/** A single emitted sample: ordered key/value pairs, all numeric. */
export type RetentionFingerprintSample = Array<[key: string, value: number]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readSlice(state: RetentionFingerprintState, name: string): Record<string, unknown> | null {
  const slice = state[name];
  return isRecord(slice) ? slice : null;
}

/** Size of a themis `Collection` (`{ idField, ids, map, refsCount }`). */
function countCollection(value: unknown): number {
  if (!isRecord(value)) return 0;
  const { ids } = value;
  return Array.isArray(ids) ? ids.length : 0;
}

/** Number of keys in a `byWorkspaceId` / `byAgentId` style scope map. */
function countKeys(value: unknown): number {
  return isRecord(value) ? Object.keys(value).length : 0;
}

/** Length of a plain array field. */
function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Sum `per(entry)` across the values of a scope map. One shallow pass over the
 * scopes; `per` must itself be O(1).
 */
function sumScopes(value: unknown, per: (entry: Record<string, unknown>) => number): number {
  if (!isRecord(value)) return 0;
  let total = 0;
  for (const entry of Object.values(value)) {
    if (isRecord(entry)) total += per(entry);
  }
  return total;
}

/**
 * Per-channel IPC listener registrations, as tracked by the preload bridge.
 *
 * Returns `null` when the bridge is absent (web/mock builds) or predates the
 * diagnostic, which is reported as `ipc*=-1` rather than a misleading 0.
 * Note the preload registry does not track `once()` listeners, so these counts
 * are a floor for short-lived subscriptions and exact for `on()`/`offById()`
 * ones.
 *
 * These are *not* the renderer's subscriber count on `backend:*` channels —
 * see the `fanout*` fields for that. The transport multiplexes every
 * subscriber onto one bridge listener per channel, so a growing subscriber set
 * does not move these numbers at all.
 */
function readIpcListenerCounts(): Record<string, number> | null {
  if (typeof window === 'undefined') return null;
  const getCounts = window.electronAPI?.getIpcListenerCounts;
  if (typeof getCounts !== 'function') return null;
  try {
    const counts = getCounts();
    return isRecord(counts) ? (counts as Record<string, number>) : null;
  } catch {
    return null;
  }
}

/**
 * Build one sample. Pure with respect to the store: reads state and the two
 * diff-module inspectors, mutates nothing.
 */
export function collectRetentionFingerprint(
  state: RetentionFingerprintState,
  context: { sample: number; uptimeMs: number },
): RetentionFingerprintSample {
  const workspace = readSlice(state, 'workspace');
  const workspaceTasks = readSlice(state, 'workspaceTasks');
  const workspaceNotes = readSlice(state, 'workspaceNotes');
  const workspaceAgents = readSlice(state, 'workspaceAgents');
  const workspaceEvents = readSlice(state, 'workspaceEvents');
  const agentSessions = readSlice(state, 'agentSessions');
  const chatState = readSlice(state, 'chatState');
  const comments = readSlice(state, 'comments');

  const caches = safeInspect(inspectDiffCaches, null);
  const pool = safeInspect(inspectDiffWorkerPoolLifecycle, null);
  const ipcCounts = readIpcListenerCounts();
  const fanoutCounts = safeInspect<Record<string, number> | null>(
    inspectChannelFanoutSubscribers,
    null,
  );

  let ipcTotal = -1;
  let ipcBackend = -1;
  let ipcChannels = -1;
  if (ipcCounts) {
    ipcTotal = 0;
    ipcBackend = 0;
    ipcChannels = 0;
    for (const [channel, count] of Object.entries(ipcCounts)) {
      if (typeof count !== 'number') continue;
      ipcChannels += 1;
      ipcTotal += count;
      if (channel.startsWith(BACKEND_CHANNEL_PREFIX)) ipcBackend += count;
    }
  }

  // Fan-out subscribers, broken out per channel. Unlike the IPC counts above
  // these have no bridge to be absent, so -1 means only "the inspector threw".
  let fanoutChannels = -1;
  let fanoutSubscribers = -1;
  const fanoutPerChannel: RetentionFingerprintSample = [];
  if (fanoutCounts) {
    fanoutChannels = 0;
    fanoutSubscribers = 0;
    for (const [channel, count] of Object.entries(fanoutCounts)) {
      if (typeof count !== 'number') continue;
      fanoutChannels += 1;
      fanoutSubscribers += count;
      fanoutPerChannel.push([`${FANOUT_FIELD_PREFIX}${channel}`, count]);
    }
  }

  return [
    ['sample', context.sample],
    ['uptimeMs', context.uptimeMs],

    // Store: workspace-scoped retention. `*Scopes` is how many workspaces the
    // renderer still holds a bucket for; the paired count is the entities in
    // them. A scope count that keeps climbing while the entity count is flat
    // means buckets are never released.
    ['workspaces', countCollection(workspace?.workspaces)],
    ['taskScopes', countKeys(workspaceTasks?.byWorkspaceId)],
    ['tasks', sumScopes(workspaceTasks?.byWorkspaceId, (s) => countCollection(s.tasks))],
    ['noteScopes', countKeys(workspaceNotes?.byWorkspaceId)],
    ['notes', sumScopes(workspaceNotes?.byWorkspaceId, (s) => countCollection(s.notes))],
    ['agentScopes', countKeys(workspaceAgents?.byWorkspaceId)],
    ['eventScopes', countKeys(workspaceEvents?.byWorkspaceId)],
    ['events', sumScopes(workspaceEvents?.byWorkspaceId, (s) => countArray(s.events))],

    // Store: agent-scoped retention. `agentMessages` is the single largest
    // renderer collection — transcripts are retained per agent for the session.
    ['agentSessions', countKeys(agentSessions?.byAgentId)],
    ['agentMessages', sumScopes(agentSessions?.byAgentId, (s) => countArray(s.messages))],
    ['chatAgents', countKeys(chatState?.byAgentId)],
    ['chatStatusEvents', sumScopes(chatState?.byAgentId, (s) => countArray(s.statusEvents))],
    ['comments', countCollection(comments?.commentsById)],
    ['commentThreads', countCollection(comments?.threadsById)],

    // Diff highlighter: -1 when no pool exists, so "no pool" is distinguishable
    // from "pool with empty caches".
    ['diffFileCache', caches ? caches.fileCacheSize : -1],
    ['diffAstCache', caches ? caches.diffCacheSize : -1],
    ['diffPoolsCreated', pool ? pool.created : -1],
    ['diffPoolsTerminated', pool ? pool.terminated : -1],
    ['diffPoolsLive', pool ? pool.live : -1],
    ['diffPoolLeases', pool ? pool.activeLeases : -1],
    ['diffPoolSize', pool ? pool.poolSize : -1],

    // IPC listener registrations: -1 when the preload bridge cannot report
    // them. `ipcBackendListeners` is a fan-out TRIPWIRE, not a subscriber
    // gauge — the transport multiplexes all subscribers onto one bridge
    // listener per channel, so anything above one listener per live `backend:*`
    // channel means the fan-out itself regressed.
    ['ipcChannels', ipcChannels],
    ['ipcListeners', ipcTotal],
    ['ipcBackendListeners', ipcBackend],

    // Renderer subscribers behind that fan-out — the real gauge, and where
    // subscriber accumulation (monorepo#2034) is now visible. A channel with no
    // subscribers has no `fanout.*` field at all, so `fanoutSubscribers=0` is
    // the unambiguous idle reading and the per-channel fields are a
    // sorted-by-channel suffix.
    ['fanoutChannels', fanoutChannels],
    ['fanoutSubscribers', fanoutSubscribers],
    ...fanoutPerChannel,
  ];
}

/** Call an inspector that reaches into third-party state, tolerating throws. */
function safeInspect<T>(inspect: () => T, fallback: T): T {
  try {
    return inspect();
  } catch {
    return fallback;
  }
}

/** Render a sample as the single `key=value` line written to the console. */
export function formatRetentionFingerprint(sample: RetentionFingerprintSample): string {
  const fields = sample.map(([key, value]) => `${key}=${value}`).join(' ');
  return `${RETENTION_FINGERPRINT_PREFIX} ${fields}`;
}

export interface RetentionFingerprintOptions {
  /** Steady-state cadence. */
  intervalMs?: number;
  /** Delay before the first (boot-window) sample. */
  firstSampleMs?: number;
  /** Injected for tests; defaults to `performance.now`/`Date.now`. */
  now?: () => number;
}

/**
 * Minimal view of the themis store.
 *
 * `state` — not `getState()` — is the accessor themis exposes; it proxies
 * straight through to the underlying redux `getState()` with no cloning, so
 * reading it is free. It throws if touched before `Store.init()`, which is why
 * every read below is inside the guarded emit path.
 */
export interface RetentionFingerprintStoreLike {
  readonly state: unknown;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Start emitting fingerprints. Returns a stop handler; calling it clears both
 * the boot timer and the interval.
 */
export function startRetentionFingerprint(
  store: RetentionFingerprintStoreLike,
  options: RetentionFingerprintOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? RETENTION_FINGERPRINT_INTERVAL_MS;
  const firstSampleMs = options.firstSampleMs ?? RETENTION_FINGERPRINT_FIRST_SAMPLE_MS;
  const now = options.now ?? defaultNow;

  const startedAt = now();
  let sampleCount = 0;
  let firstSampleTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  const emit = (): void => {
    try {
      const state = store?.state;
      if (!isRecord(state)) return;
      sampleCount += 1;
      const sample = collectRetentionFingerprint(state, {
        sample: sampleCount,
        uptimeMs: Math.round(now() - startedAt),
      });
      logger.info(formatRetentionFingerprint(sample));
    } catch (error) {
      // A diagnostic must never take the renderer down with it.
      logger.warn('Failed to emit retention fingerprint', error);
    }
  };

  firstSampleTimer = setTimeout(() => {
    firstSampleTimer = null;
    emit();
    intervalTimer = setInterval(emit, intervalMs);
  }, firstSampleMs);

  return () => {
    if (firstSampleTimer !== null) {
      clearTimeout(firstSampleTimer);
      firstSampleTimer = null;
    }
    if (intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  };
}
