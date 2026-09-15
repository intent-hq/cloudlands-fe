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

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { bindRemoteCursors } from '$lib/components/workspace/note-with-comments/remote-cursors-binding';
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

  it('retains a snapshot forwarded before the subscribe promise resolves', async () => {
    let resolveSubscribe!: (value: unknown) => void;
    transport.request.mockImplementation(async (method) => {
      if (method === 'principal.me') return { id: 'principal-me' };
      if (method === 'note.presence.subscribe') {
        return new Promise((resolve) => {
          resolveSubscribe = resolve;
        });
      }
      return {};
    });
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();

    // The reply and its seq-0 snapshot arrive from the same socket chunk: the
    // notification is dispatched before the reply's promise callbacks run.
    resolveSubscribe({ subscriptionId: SUB });
    push({ seq: 0, kind: 'snapshot', snapshot: { viewers: [viewer('principal-b', null)] } });
    push({ seq: 1, kind: 'delta', delta: { kind: 'joined', viewer: viewer('principal-c', null) } });
    for (const handler of transport.notificationHandlers) {
      handler({
        method: 'subscription.push',
        params: {
          subscriptionId: 'someone-else',
          seq: 0,
          kind: 'snapshot',
          snapshot: { viewers: [viewer('principal-z', null)] },
        },
      });
    }
    expect(session.getViewers()).toEqual([]);

    await settle();
    expect(session.getViewers().map((v) => v.principalId)).toEqual(['principal-b', 'principal-c']);
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

  it.each([0, 250, 999])(
    'expires a caret exactly CURSOR_TTL_MS after receipt when it arrived %i ms off the join, keeping the viewer',
    async (phase) => {
      const session = joinNotePresence('ws-1', 'note-1');
      await vi.advanceTimersByTimeAsync(phase);
      push({
        seq: 0,
        kind: 'snapshot',
        snapshot: { viewers: [viewer('principal-b', { rev: 1, anchor: 2, head: 2 })] },
      });

      await vi.advanceTimersByTimeAsync(CURSOR_TTL_MS - 1);
      expect(session.getViewers()[0].cursor).toEqual({ rev: 1, anchor: 2, head: 2 });

      await vi.advanceTimersByTimeAsync(1);
      expect(session.getViewers()).toEqual([
        expect.objectContaining({ principalId: 'principal-b', cursor: null }),
      ]);
    },
  );

  it('re-arms the expiry for the next caret after one lapses', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    push({
      seq: 0,
      kind: 'snapshot',
      snapshot: { viewers: [viewer('principal-b', { rev: 1, anchor: 2, head: 2 })] },
    });
    await vi.advanceTimersByTimeAsync(4_000);
    push({
      seq: 1,
      kind: 'delta',
      delta: { kind: 'joined', viewer: viewer('principal-c', { rev: 1, anchor: 7, head: 7 }) },
    });

    await vi.advanceTimersByTimeAsync(CURSOR_TTL_MS - 4_000);
    expect(session.getViewers().map((v) => v.cursor)).toEqual([
      null,
      { rev: 1, anchor: 7, head: 7 },
    ]);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(session.getViewers().map((v) => v.cursor)).toEqual([null, null]);
  });

  it('re-publishes no later than CURSOR_HEARTBEAT_MS after an off-phase publication', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    await vi.advanceTimersByTimeAsync(100);
    session.publishCursor({ rev: 1, anchor: 11, head: 11 });
    session.provideCursor(() => ({ rev: 2, anchor: 14, head: 14 }));
    expect(calls('note.presence.update')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(CURSOR_HEARTBEAT_MS - 1);
    expect(calls('note.presence.update')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(calls('note.presence.update')).toEqual([
      { workspaceId: 'ws-1', noteId: 'note-1', rev: 1, anchor: 11, head: 11 },
      { workspaceId: 'ws-1', noteId: 'note-1', rev: 2, anchor: 14, head: 14 },
    ]);

    await vi.advanceTimersByTimeAsync(CURSOR_HEARTBEAT_MS);
    expect(calls('note.presence.update')).toHaveLength(3);
  });

  it('measures the heartbeat from the latest publication, not from the join', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    session.publishCursor({ rev: 1, anchor: 1, head: 1 });
    await vi.advanceTimersByTimeAsync(CURSOR_HEARTBEAT_MS - 200);
    session.publishCursor({ rev: 1, anchor: 2, head: 2 });
    expect(calls('note.presence.update')).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(CURSOR_HEARTBEAT_MS - 1);
    expect(calls('note.presence.update')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls('note.presence.update')).toHaveLength(3);
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

  it('heartbeats the caret a provider reports instead of the last published one', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    session.publishCursor({ rev: 1, anchor: 11, head: 11 });
    let current = { rev: 1, anchor: 11, head: 11 };
    const off = session.provideCursor(() => current);

    current = { rev: 2, anchor: 14, head: 14 };
    await vi.advanceTimersByTimeAsync(CURSOR_HEARTBEAT_MS * 2);
    expect(calls('note.presence.update').at(-1)).toEqual({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      rev: 2,
      anchor: 14,
      head: 14,
    });

    off();
    current = { rev: 3, anchor: 0, head: 0 };
    await vi.advanceTimersByTimeAsync(CURSOR_HEARTBEAT_MS * 2);
    expect(calls('note.presence.update').at(-1)).toEqual({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      rev: 2,
      anchor: 14,
      head: 14,
    });
  });

  it('heartbeat recomputes the editor caret against the acknowledged base without a keystroke', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit],
      content: '<p>hello world</p>',
    });
    let base = 'hello world';
    let rev = 1;
    const unbind = bindRemoteCursors({
      editor,
      session,
      getBaseText: () => base,
      getBaseRev: () => rev,
    });
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 12)),
      );
      editor.view.dispatch(editor.state.tr.insertText('XYZ', 12));
      await vi.advanceTimersByTimeAsync(32);
      expect(calls('note.presence.update').at(-1)).toEqual({
        workspaceId: 'ws-1',
        noteId: 'note-1',
        rev: 1,
        anchor: 11,
        head: 11,
      });

      // The save is acknowledged: the baseline advances, the editor is idle.
      base = 'hello worldXYZ';
      rev = 2;
      await vi.advanceTimersByTimeAsync(CURSOR_HEARTBEAT_MS * 3);
      const updates = calls('note.presence.update');
      expect(updates.length).toBeGreaterThan(1);
      expect(updates.at(-1)).toEqual({
        workspaceId: 'ws-1',
        noteId: 'note-1',
        rev: 2,
        anchor: 14,
        head: 14,
      });
    } finally {
      unbind();
      editor.destroy();
    }
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

  it('releases the lease and re-registers for a fresh snapshot on a sequence gap', async () => {
    const SUB2 = 'sub-presence-2';
    let subscribes = 0;
    transport.request.mockImplementation(async (method) => {
      if (method === 'principal.me') return { id: 'principal-me' };
      if (method === 'note.presence.subscribe')
        return { subscriptionId: [SUB, SUB2][subscribes++] };
      return {};
    });
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    push({ seq: 0, kind: 'snapshot', snapshot: { viewers: [viewer('principal-b', null)] } });
    push({ seq: 1, kind: 'delta', delta: { kind: 'joined', viewer: viewer('principal-c', null) } });
    expect(session.getViewers().map((v) => v.principalId)).toEqual(['principal-b', 'principal-c']);

    // seq 2 (a `left`) was lost: the roster can no longer be trusted.
    push({ seq: 3, kind: 'delta', delta: { kind: 'joined', viewer: viewer('principal-d', null) } });
    expect(calls('note.presence.unsubscribe')).toEqual([{ subscriptionId: SUB }]);
    // The stale roster is kept (not flashed empty) until the fresh snapshot lands.
    expect(session.getViewers().map((v) => v.principalId)).toEqual(['principal-b', 'principal-c']);
    await settle();
    expect(calls('note.presence.subscribe')).toHaveLength(2);

    // Pushes on the released lease are ignored; the new lease's snapshot rebuilds.
    push({ seq: 4, kind: 'delta', delta: { kind: 'joined', viewer: viewer('principal-e', null) } });
    for (const handler of transport.notificationHandlers) {
      handler({
        method: 'subscription.push',
        params: {
          subscriptionId: SUB2,
          seq: 0,
          kind: 'snapshot',
          snapshot: { viewers: [viewer('principal-b', null)] },
        },
      });
    }
    expect(session.getViewers().map((v) => v.principalId)).toEqual(['principal-b']);
    session.release();
    expect(calls('note.presence.unsubscribe')).toEqual([
      { subscriptionId: SUB },
      { subscriptionId: SUB2 },
    ]);
  });

  it('re-registers when a delta arrives before the snapshot', async () => {
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    push({ seq: 1, kind: 'delta', delta: { kind: 'joined', viewer: viewer('principal-b', null) } });
    expect(session.getViewers()).toEqual([]);
    expect(calls('note.presence.unsubscribe')).toEqual([{ subscriptionId: SUB }]);
    await settle();
    expect(calls('note.presence.subscribe')).toHaveLength(2);
    session.release();
  });

  it('retries a failed identity read with backoff before registering', async () => {
    let identityReads = 0;
    transport.request.mockImplementation(async (method) => {
      if (method === 'principal.me') {
        identityReads += 1;
        if (identityReads === 1) throw new Error('transport down');
        return { id: 'principal-me' };
      }
      if (method === 'note.presence.subscribe') return { subscriptionId: SUB };
      return {};
    });
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    expect(calls('note.presence.subscribe')).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(identityReads).toBe(2);
    expect(calls('note.presence.subscribe')).toHaveLength(1);
    push({
      seq: 0,
      kind: 'snapshot',
      snapshot: { viewers: [viewer('principal-me', null), viewer('principal-b', null)] },
    });
    expect(session.getViewers().map((v) => v.principalId)).toEqual(['principal-b']);
    session.release();
  });

  it('registers once the daemon reports no principal id', async () => {
    transport.request.mockImplementation(async (method) => {
      if (method === 'principal.me') return {};
      if (method === 'note.presence.subscribe') return { subscriptionId: SUB };
      return {};
    });
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    expect(calls('note.presence.subscribe')).toHaveLength(1);
    session.release();
  });

  it('holds one lease when reconnect fires while the identity read is pending', async () => {
    let resolveIdentity!: (value: unknown) => void;
    transport.request.mockImplementation(async (method) => {
      if (method === 'principal.me') {
        return new Promise((resolve) => {
          resolveIdentity = resolve;
        });
      }
      if (method === 'note.presence.subscribe') return { subscriptionId: SUB };
      return {};
    });
    const session = joinNotePresence('ws-1', 'note-1');
    await settle();
    for (const handler of transport.reconnectHandlers) handler();
    await settle();
    expect(calls('note.presence.subscribe')).toEqual([]);

    resolveIdentity({ id: 'principal-me' });
    await settle();
    expect(calls('note.presence.subscribe')).toHaveLength(1);
    expect(calls('note.presence.unsubscribe')).toEqual([]);
    push({
      seq: 0,
      kind: 'snapshot',
      snapshot: { viewers: [viewer('principal-me', null), viewer('principal-b', null)] },
    });
    expect(session.getViewers().map((v) => v.principalId)).toEqual(['principal-b']);
    session.release();
    expect(calls('note.presence.unsubscribe')).toEqual([{ subscriptionId: SUB }]);
  });
});
