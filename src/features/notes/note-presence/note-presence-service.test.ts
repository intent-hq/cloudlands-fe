/**
 * Note presence session over a FAKE transport (PROTOCOL §5.46
 * `note.presence.*`): exact request shapes, the channel's object snapshot and
 * payload-only deltas, own-row filtering, caret TTL (AC 3b), publish
 * throttle and heartbeat, and lease release.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
  notificationHandlers: new Set<(n: { method: string; params: unknown }) => void>(),
  reconnectHandlers: new Set<() => void>(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: transport.request,
  onBackendNotification: (handler: (n: { method: string; params: unknown }) => void) => {
    transport.notificationHandlers.add(handler);
    return () => transport.notificationHandlers.delete(handler);
  },
  onBackendReconnected: (handler: () => void) => {
    transport.reconnectHandlers.add(handler);
    return () => transport.reconnectHandlers.delete(handler);
  },
}));

import {
  CURSOR_HEARTBEAT_MS,
  CURSOR_PUBLISH_MIN_INTERVAL_MS,
  CURSOR_TTL_MS,
  joinNotePresence,
  resetNotePresenceSessionsForTests,
  type RemoteNoteViewer,
} from './note-presence-service';
import { resetOwnPrincipalIdForTests } from './own-principal';

const SUB = 'sub-presence-1';

/** PROTOCOL §5.46 NoteViewer row. */
function viewer(principalId: string, cursor: { rev: number; anchor: number; head: number } | null) {
  return { principalId, login: principalId, displayName: null, avatarUrl: null, cursor };
}

function push(params: Record<string, unknown>) {
  for (const handler of transport.notificationHandlers) {
    handler({ method: 'subscription.push', params: { subscriptionId: SUB, ...params } });
  }
}

function calls(method: string) {
  return transport.request.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

describe('note presence session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    transport.request.mockReset();
    transport.request.mockImplementation(async (method) => {
      if (method === 'principal.me') return { id: 'principal-me', login: 'me' };
      if (method === 'note.presence.subscribe') return { subscriptionId: SUB };
      return {};
    });
  });

  afterEach(() => {
    resetNotePresenceSessionsForTests();
    resetOwnPrincipalIdForTests();
    vi.useRealTimers();
  });

  it('registers the channel with the documented params and filters its own row from the snapshot', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    const seen: RemoteNoteViewer[][] = [];
    session.subscribe((v) => seen.push(v));
    await settle();

    expect(calls('note.presence.subscribe')).toEqual([{ workspaceId: 'ws-1', noteId: 'note-1' }]);

    push({
      seq: 0,
      kind: 'snapshot',
      snapshot: {
        viewers: [
          viewer('principal-me', { rev: 3, anchor: 1, head: 1 }),
          viewer('principal-b', { rev: 3, anchor: 5, head: 9 }),
        ],
      },
    });
    expect(seen.at(-1)?.map((v) => v.principalId)).toEqual(['principal-b']);
    expect(seen.at(-1)?.[0].cursor).toEqual({ rev: 3, anchor: 5, head: 9 });
  });

  it('applies joined / updated / left deltas and ignores pushes for other subscriptions', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    push({ seq: 0, kind: 'snapshot', snapshot: { viewers: [] } });

    push({ seq: 1, kind: 'delta', delta: { kind: 'joined', viewer: viewer('principal-b', null) } });
    expect(session.getViewers().map((v) => [v.principalId, v.cursor])).toEqual([
      ['principal-b', null],
    ]);

    push({
      seq: 2,
      kind: 'delta',
      delta: { kind: 'updated', viewer: viewer('principal-b', { rev: 4, anchor: 2, head: 2 }) },
    });
    expect(session.getViewers()[0].cursor).toEqual({ rev: 4, anchor: 2, head: 2 });

    for (const handler of transport.notificationHandlers) {
      handler({
        method: 'subscription.push',
        params: {
          subscriptionId: 'someone-else',
          seq: 9,
          kind: 'delta',
          delta: { kind: 'joined', viewer: viewer('principal-z', null) },
        },
      });
    }
    expect(session.getViewers()).toHaveLength(1);

    push({ seq: 3, kind: 'delta', delta: { kind: 'left', viewer: viewer('principal-b', null) } });
    expect(session.getViewers()).toEqual([]);
  });

  it('drops a caret not refreshed within the TTL but keeps the viewer (AC 3b)', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    const seen: RemoteNoteViewer[][] = [];
    session.subscribe((v) => seen.push(v));
    await settle();
    push({
      seq: 0,
      kind: 'snapshot',
      snapshot: { viewers: [viewer('principal-b', { rev: 3, anchor: 5, head: 5 })] },
    });

    await vi.advanceTimersByTimeAsync(CURSOR_TTL_MS - 1_500);
    expect(session.getViewers()[0].cursor).not.toBeNull();

    push({
      seq: 1,
      kind: 'delta',
      delta: { kind: 'updated', viewer: viewer('principal-b', { rev: 3, anchor: 6, head: 6 }) },
    });
    await vi.advanceTimersByTimeAsync(CURSOR_TTL_MS - 1_500);
    expect(session.getViewers()[0].cursor).toEqual({ rev: 3, anchor: 6, head: 6 });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(session.getViewers()).toEqual([
      expect.objectContaining({ principalId: 'principal-b', cursor: null }),
    ]);
    expect(seen.at(-1)?.[0].cursor).toBeNull();
  });

  it('publishes the caret with the documented params, throttled with the latest kept, and heartbeats it', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();

    session.publishCursor({ rev: 7, anchor: 1, head: 1 });
    session.publishCursor({ rev: 7, anchor: 2, head: 2 });
    session.publishCursor({ rev: 7, anchor: 3, head: 4 });
    expect(calls('note.presence.update')).toEqual([
      { workspaceId: 'ws-1', noteId: 'note-1', rev: 7, anchor: 1, head: 1 },
    ]);

    await vi.advanceTimersByTimeAsync(CURSOR_PUBLISH_MIN_INTERVAL_MS);
    expect(calls('note.presence.update')).toEqual([
      { workspaceId: 'ws-1', noteId: 'note-1', rev: 7, anchor: 1, head: 1 },
      { workspaceId: 'ws-1', noteId: 'note-1', rev: 7, anchor: 3, head: 4 },
    ]);

    await vi.advanceTimersByTimeAsync(CURSOR_HEARTBEAT_MS * 2);
    const updates = calls('note.presence.update');
    expect(updates.length).toBeGreaterThan(2);
    expect(updates.at(-1)).toEqual({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      rev: 7,
      anchor: 3,
      head: 4,
    });
  });

  it('does not publish before the lease is acked and never heartbeats without a caret', async () => {
    transport.request.mockImplementation(async (method) => {
      if (method === 'principal.me') return { id: 'principal-me' };
      if (method === 'note.presence.subscribe') return new Promise(() => {});
      return {};
    });
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    session.publishCursor({ rev: 1, anchor: 0, head: 0 });
    await vi.advanceTimersByTimeAsync(CURSOR_HEARTBEAT_MS * 2);
    expect(calls('note.presence.update')).toEqual([]);
  });

  it('shares one lease between consumers and releases it with the last one', async () => {
    const a = joinNotePresence('ws-1', 'note-1');
    const b = joinNotePresence('ws-1', 'note-1');
    await settle();
    expect(calls('note.presence.subscribe')).toHaveLength(1);

    a.release();
    expect(calls('note.presence.unsubscribe')).toEqual([]);
    b.release();
    expect(calls('note.presence.unsubscribe')).toEqual([{ subscriptionId: SUB }]);

    const c = joinNotePresence('ws-1', 'note-1');
    await settle();
    expect(calls('note.presence.subscribe')).toHaveLength(2);
    c.release();
  });

  it('re-registers for a fresh snapshot on reconnect and drops the stale roster', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    push({ seq: 0, kind: 'snapshot', snapshot: { viewers: [viewer('principal-b', null)] } });
    expect(session.getViewers()).toHaveLength(1);

    for (const handler of transport.reconnectHandlers) handler();
    expect(session.getViewers()).toEqual([]);
    await settle();
    expect(calls('note.presence.subscribe')).toHaveLength(2);
    expect(calls('note.presence.unsubscribe')).toEqual([]);
  });

  it('retries a failed registration with backoff', async () => {
    transport.request.mockImplementation(async (method) => {
      if (method === 'principal.me') return { id: 'principal-me' };
      if (method === 'note.presence.subscribe') throw new Error('boom');
      return {};
    });
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    expect(calls('note.presence.subscribe')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls('note.presence.subscribe')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls('note.presence.subscribe')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls('note.presence.subscribe')).toHaveLength(3);
    session.release();
  });
});
