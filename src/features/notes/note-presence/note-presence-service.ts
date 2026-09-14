/**
 * Note presence sessions: one ref-counted `note.presence.subscribe` lease per
 * (workspace, note) shared by every consumer on the page (header avatar stack,
 * editor cursors), fed by the channel's snapshot and `joined | updated | left`
 * deltas. The connection's own viewer row is filtered out via `principal.me`.
 *
 * Roster membership is the daemon's (lease-based); carets are ephemeral on
 * top of it: a caret not refreshed within `CURSOR_TTL_MS` is dropped, and the
 * session re-publishes its own caret every `CURSOR_HEARTBEAT_MS` so an idle
 * peer's caret stays visible — recomputed by the registered cursor provider
 * (the editor binding) so a base that advanced under an idle caret is picked
 * up, else the last published tuple. Outgoing carets are throttled to the
 * daemon's own floor (≤10/s, trailing edge kept).
 */
import { onBackendNotification, onBackendReconnected } from '$lib/client/live/backend-transport';
import {
  parseNotePresencePush,
  publishNoteCursor,
  subscribeNotePresence,
  unsubscribeNotePresence,
  type NotePresencePush,
  type NoteViewer,
  type NoteViewerCursor,
} from './note-presence.client';
import { resolveOwnPrincipalId } from './own-principal';

export const CURSOR_TTL_MS = 10_000;
export const CURSOR_HEARTBEAT_MS = 5_000;
export const CURSOR_PUBLISH_MIN_INTERVAL_MS = 100;
const CURSOR_SWEEP_INTERVAL_MS = 1_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/**
 * Bound for pushes that race their own subscribe reply: Electron forwards
 * the reply and the seq-0 snapshot from one socket chunk, so the notification
 * can be dispatched before the reply's promise callbacks set the id.
 */
const MAX_PRE_ACK_PUSHES = 16;

/** Reports the connection's current caret, or `undefined` when there is none to publish. */
type NoteCursorProvider = () => NoteViewerCursor | undefined;

function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

/** A peer viewing the note; `cursor` is `null` until seen or once expired. */
export interface RemoteNoteViewer extends NoteViewer {
  /** `Date.now()` of the last delta that carried this viewer's cursor. */
  cursorSeenAt: number | null;
}

export type NotePresenceListener = (viewers: RemoteNoteViewer[]) => void;

export interface NotePresenceSession {
  /** Current peers (own row excluded), stable order by principal id. */
  getViewers(): RemoteNoteViewer[];
  /** Called with the full peer list after every change; returns a disposer. */
  subscribe(listener: NotePresenceListener): () => void;
  /** Publish this connection's caret (throttled; the latest always lands). */
  publishCursor(cursor: NoteViewerCursor): void;
  /**
   * Register the source the heartbeat consults for the current caret, so an
   * idle caret is re-published against the current base rather than replayed
   * from the last publish; returns a disposer.
   */
  provideCursor(provider: NoteCursorProvider): () => void;
  /** Drop this consumer; the lease is released when the last consumer leaves. */
  release(): void;
}

interface SessionState {
  workspaceId: string;
  noteId: string;
  refs: number;
  disposed: boolean;
  ownPrincipalId: string | undefined;
  subscriptionId: string | undefined;
  generation: number;
  /** A subscribe request of the current generation awaits its reply. */
  registering: boolean;
  /** Pushes received while `registering`, replayed for the acked id. */
  preAckPushes: NotePresencePush[];
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  viewers: Map<string, RemoteNoteViewer>;
  listeners: Set<NotePresenceListener>;
  cursorProviders: Set<NoteCursorProvider>;
  sweepTimer: ReturnType<typeof setInterval> | undefined;
  lastCursor: NoteViewerCursor | undefined;
  pendingCursor: NoteViewerCursor | undefined;
  lastPublishAt: number;
  publishTimer: ReturnType<typeof setTimeout> | undefined;
  heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  offNotification: () => void;
  offReconnect: () => void;
}

const sessions = new Map<string, SessionState>();

function sessionKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}\u0000${noteId}`;
}

function sortedViewers(state: SessionState): RemoteNoteViewer[] {
  return [...state.viewers.values()].sort((a, b) => a.principalId.localeCompare(b.principalId));
}

function emit(state: SessionState): void {
  const viewers = sortedViewers(state);
  for (const listener of state.listeners) listener(viewers);
}

function clearRetry(state: SessionState): void {
  if (state.retryTimer !== undefined) {
    clearTimeout(state.retryTimer);
    state.retryTimer = undefined;
  }
}

function scheduleRegister(state: SessionState): void {
  clearRetry(state);
  const delay = retryDelayMs(state.retryAttempt);
  state.retryAttempt += 1;
  state.retryTimer = setTimeout(() => {
    state.retryTimer = undefined;
    if (!state.disposed) register(state);
  }, delay);
}

function register(state: SessionState): void {
  clearRetry(state);
  state.generation += 1;
  state.registering = true;
  state.preAckPushes = [];
  const generation = state.generation;
  subscribeNotePresence(state.workspaceId, state.noteId)
    .then((id) => {
      if (generation !== state.generation || state.disposed) {
        if (id) unsubscribeNotePresence(id);
        return;
      }
      state.registering = false;
      const buffered = state.preAckPushes;
      state.preAckPushes = [];
      if (!id) {
        scheduleRegister(state);
        return;
      }
      state.subscriptionId = id;
      state.retryAttempt = 0;
      for (const push of buffered) {
        if (push.subscriptionId === id) applyPush(state, push);
      }
      // The lease is fresh: the daemon has no caret for us yet.
      if (state.lastCursor) sendCursor(state, state.lastCursor);
    })
    .catch(() => {
      if (generation !== state.generation || state.disposed) return;
      state.registering = false;
      state.preAckPushes = [];
      scheduleRegister(state);
    });
}

function sendCursor(state: SessionState, cursor: NoteViewerCursor): void {
  state.lastPublishAt = Date.now();
  void publishNoteCursor(state.workspaceId, state.noteId, cursor).catch(() => {
    // Best-effort: the next throttled publish or heartbeat carries the caret.
  });
}

function flushPendingCursor(state: SessionState): void {
  state.publishTimer = undefined;
  const pending = state.pendingCursor;
  state.pendingCursor = undefined;
  if (pending && !state.disposed && state.subscriptionId) sendCursor(state, pending);
}

function publishCursor(state: SessionState, cursor: NoteViewerCursor): void {
  state.lastCursor = cursor;
  if (state.disposed || !state.subscriptionId) return;
  const elapsed = Date.now() - state.lastPublishAt;
  if (state.publishTimer !== undefined) {
    state.pendingCursor = cursor;
    return;
  }
  if (elapsed >= CURSOR_PUBLISH_MIN_INTERVAL_MS) {
    sendCursor(state, cursor);
    return;
  }
  state.pendingCursor = cursor;
  state.publishTimer = setTimeout(
    () => flushPendingCursor(state),
    CURSOR_PUBLISH_MIN_INTERVAL_MS - elapsed,
  );
}

function heartbeat(state: SessionState): void {
  if (state.disposed || !state.subscriptionId) return;
  if (Date.now() - state.lastPublishAt < CURSOR_HEARTBEAT_MS) return;
  let cursor = state.lastCursor;
  for (const provider of state.cursorProviders) cursor = provider() ?? cursor;
  if (!cursor) return;
  state.lastCursor = cursor;
  sendCursor(state, cursor);
}

function sweepExpiredCursors(state: SessionState, now: number): void {
  let changed = false;
  for (const viewer of state.viewers.values()) {
    if (
      viewer.cursor &&
      viewer.cursorSeenAt !== null &&
      now - viewer.cursorSeenAt > CURSOR_TTL_MS
    ) {
      viewer.cursor = null;
      viewer.cursorSeenAt = null;
      changed = true;
    }
  }
  if (changed) emit(state);
}

function toRemoteViewer(viewer: NoteViewer, now: number): RemoteNoteViewer {
  return { ...viewer, cursorSeenAt: viewer.cursor ? now : null };
}

function bufferPreAckPush(state: SessionState, push: NotePresencePush): void {
  state.preAckPushes.push(push);
  if (state.preAckPushes.length > MAX_PRE_ACK_PUSHES) state.preAckPushes.shift();
}

function onNotification(state: SessionState, method: string, params: unknown): void {
  const push = parseNotePresencePush(method, params);
  if (!push) return;
  if (push.subscriptionId === state.subscriptionId) {
    applyPush(state, push);
    return;
  }
  // Not ours yet — either a foreign channel, or our own snapshot that beat
  // the subscribe reply: keep it until the ack tells the two apart.
  if (state.subscriptionId === undefined && state.registering) bufferPreAckPush(state, push);
}

function applyPush(state: SessionState, push: NotePresencePush): void {
  const now = Date.now();
  if (push.kind === 'snapshot') {
    const next = new Map<string, RemoteNoteViewer>();
    for (const viewer of push.viewers) {
      if (viewer.principalId === state.ownPrincipalId) continue;
      next.set(viewer.principalId, toRemoteViewer(viewer, now));
    }
    state.viewers = next;
    emit(state);
    return;
  }
  if (push.viewer.principalId === state.ownPrincipalId) return;
  if (push.deltaKind === 'left') {
    if (state.viewers.delete(push.viewer.principalId)) emit(state);
    return;
  }
  state.viewers.set(push.viewer.principalId, toRemoteViewer(push.viewer, now));
  emit(state);
}

function start(state: SessionState): void {
  state.offNotification = onBackendNotification((n) => onNotification(state, n.method, n.params));
  // The daemon dropped every lease on restart: re-register for a fresh
  // snapshot on a bumped generation so a pre-restart in-flight ack cannot land.
  state.offReconnect = onBackendReconnected(() => {
    if (state.disposed) return;
    state.subscriptionId = undefined;
    state.registering = false;
    state.preAckPushes = [];
    state.retryAttempt = 0;
    state.viewers = new Map();
    emit(state);
    register(state);
  });
  state.sweepTimer = setInterval(
    () => sweepExpiredCursors(state, Date.now()),
    CURSOR_SWEEP_INTERVAL_MS,
  );
  state.heartbeatTimer = setInterval(() => heartbeat(state), CURSOR_HEARTBEAT_MS);
  void resolveOwnPrincipalId().then((ownPrincipalId) => {
    if (state.disposed) return;
    state.ownPrincipalId = ownPrincipalId;
    register(state);
  });
}

function dispose(state: SessionState): void {
  state.disposed = true;
  state.generation += 1;
  clearRetry(state);
  if (state.publishTimer !== undefined) clearTimeout(state.publishTimer);
  if (state.sweepTimer !== undefined) clearInterval(state.sweepTimer);
  if (state.heartbeatTimer !== undefined) clearInterval(state.heartbeatTimer);
  state.offNotification();
  state.offReconnect();
  if (state.subscriptionId) unsubscribeNotePresence(state.subscriptionId);
  state.subscriptionId = undefined;
  state.registering = false;
  state.preAckPushes = [];
  state.listeners.clear();
  state.cursorProviders.clear();
  sessions.delete(sessionKey(state.workspaceId, state.noteId));
}

/**
 * Join the note's presence channel. Consumers of the same (workspace, note)
 * share one lease; each must `release()` exactly once.
 */
export function joinNotePresence(workspaceId: string, noteId: string): NotePresenceSession {
  const key = sessionKey(workspaceId, noteId);
  let state = sessions.get(key);
  if (!state) {
    state = {
      workspaceId,
      noteId,
      refs: 0,
      disposed: false,
      ownPrincipalId: undefined,
      subscriptionId: undefined,
      generation: 0,
      registering: false,
      preAckPushes: [],
      retryAttempt: 0,
      retryTimer: undefined,
      viewers: new Map(),
      listeners: new Set(),
      cursorProviders: new Set(),
      sweepTimer: undefined,
      lastCursor: undefined,
      pendingCursor: undefined,
      lastPublishAt: 0,
      publishTimer: undefined,
      heartbeatTimer: undefined,
      offNotification: () => {},
      offReconnect: () => {},
    };
    sessions.set(key, state);
    start(state);
  }
  const session = state;
  session.refs += 1;
  let released = false;
  const ownListeners = new Set<NotePresenceListener>();
  const ownProviders = new Set<NoteCursorProvider>();
  return {
    getViewers: () => sortedViewers(session),
    subscribe(listener) {
      session.listeners.add(listener);
      ownListeners.add(listener);
      return () => {
        session.listeners.delete(listener);
        ownListeners.delete(listener);
      };
    },
    publishCursor: (cursor) => publishCursor(session, cursor),
    provideCursor(provider) {
      session.cursorProviders.add(provider);
      ownProviders.add(provider);
      return () => {
        session.cursorProviders.delete(provider);
        ownProviders.delete(provider);
      };
    },
    release() {
      if (released) return;
      released = true;
      for (const listener of ownListeners) session.listeners.delete(listener);
      ownListeners.clear();
      for (const provider of ownProviders) session.cursorProviders.delete(provider);
      ownProviders.clear();
      session.refs -= 1;
      if (session.refs <= 0) dispose(session);
    },
  };
}

/** Test seam: tear down every live session. */
export function resetNotePresenceSessionsForTests(): void {
  for (const state of [...sessions.values()]) dispose(state);
}
