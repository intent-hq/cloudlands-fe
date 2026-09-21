/**
 * Note presence wire client (PROTOCOL §5.46 `note.presence.*`, multiplayer w5).
 *
 * `note.presence.subscribe { workspaceId, noteId }` is a §6.9 channel whose
 * subscription IS the "I am viewing" signal (the daemon holds a viewer lease
 * for the connection). Its seq-0 snapshot is the OBJECT `{ viewers }` and its
 * deltas are payload-only `{ kind: "joined" | "updated" | "left", viewer }` —
 * not the `added / updated / removedIds` collection shape — so the generic
 * `delta-subscription` reconciler does not apply; this module parses the
 * envelope itself. `note.presence.update { workspaceId, noteId, rev, anchor,
 * head }` moves the caller's own caret (UTF-16 offsets into the daemon text at
 * `rev`). Presence is never persisted, so a sequence gap is recovered by
 * re-registering for a fresh snapshot rather than by any refetch.
 */
import { backendRequest } from '$lib/client/live/backend-transport';

export interface NoteViewerCursor {
  rev: number;
  anchor: number;
  head: number;
}

/** One viewer of a note (snapshot row and delta `viewer`). */
export interface NoteViewer {
  principalId: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** `null` until the principal's first `note.presence.update` on the note. */
  cursor: NoteViewerCursor | null;
}

type NotePresenceDeltaKind = 'joined' | 'updated' | 'left';

export type NotePresencePush =
  | { subscriptionId: string; seq: number; kind: 'snapshot'; viewers: NoteViewer[] }
  | {
      subscriptionId: string;
      seq: number;
      kind: 'delta';
      deltaKind: NotePresenceDeltaKind;
      viewer: NoteViewer;
    };

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseCursor(raw: unknown): NoteViewerCursor | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.rev !== 'number' || typeof c.anchor !== 'number' || typeof c.head !== 'number') {
    return null;
  }
  return { rev: c.rev, anchor: c.anchor, head: c.head };
}

/** Parse a wire `NoteViewer` row; `null` when it carries no `principalId`. */
function parseNoteViewer(raw: unknown): NoteViewer | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.principalId !== 'string' || v.principalId.length === 0) return null;
  return {
    principalId: v.principalId,
    login: asNullableString(v.login),
    displayName: asNullableString(v.displayName),
    avatarUrl: asNullableString(v.avatarUrl),
    cursor: parseCursor(v.cursor),
  };
}

/**
 * Parse a daemon notification into a note-presence push, or `null` when it is
 * not a `subscription.push` of this channel's shape. The caller matches
 * `subscriptionId` against its own registration.
 */
export function parseNotePresencePush(method: string, params: unknown): NotePresencePush | null {
  if (method !== 'subscription.push' || !params || typeof params !== 'object') return null;
  const p = params as Record<string, unknown>;
  const subscriptionId = typeof p.subscriptionId === 'string' ? p.subscriptionId : undefined;
  const seq = typeof p.seq === 'number' ? p.seq : undefined;
  if (!subscriptionId || seq === undefined) return null;
  if (p.kind === 'snapshot') {
    const snapshot = p.snapshot as { viewers?: unknown } | undefined;
    const rows = Array.isArray(snapshot?.viewers) ? snapshot.viewers : [];
    const viewers: NoteViewer[] = [];
    for (const row of rows) {
      const viewer = parseNoteViewer(row);
      if (viewer) viewers.push(viewer);
    }
    return { subscriptionId, seq, kind: 'snapshot', viewers };
  }
  if (p.kind === 'delta') {
    const delta = p.delta as Record<string, unknown> | undefined;
    const deltaKind = delta?.kind;
    if (deltaKind !== 'joined' && deltaKind !== 'updated' && deltaKind !== 'left') return null;
    const viewer = parseNoteViewer(delta?.viewer);
    if (!viewer) return null;
    return { subscriptionId, seq, kind: 'delta', deltaKind, viewer };
  }
  return null;
}

/** Register the channel; the ack carries the `subscriptionId` the pushes are keyed by. */
export async function subscribeNotePresence(
  workspaceId: string,
  noteId: string,
): Promise<string | undefined> {
  const result = await backendRequest<{ subscriptionId?: string }>('note.presence.subscribe', {
    workspaceId,
    noteId,
  });
  return result?.subscriptionId;
}

/** Release the lease; best-effort (the daemon drops it on close anyway). */
export function unsubscribeNotePresence(subscriptionId: string): void {
  void backendRequest('note.presence.unsubscribe', { subscriptionId }).catch(() => {
    // Best-effort: a dropped connection has already released the lease.
  });
}

/** Publish the caller's own caret; requires a live subscription on this connection. */
export async function publishNoteCursor(
  workspaceId: string,
  noteId: string,
  cursor: NoteViewerCursor,
): Promise<void> {
  await backendRequest('note.presence.update', {
    workspaceId,
    noteId,
    rev: cursor.rev,
    anchor: cursor.anchor,
    head: cursor.head,
  });
}
