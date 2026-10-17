import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserWebSocketTransport,
  type BrowserWebSocketLike,
} from '$lib/client/live/browser-websocket-transport';
import * as factory from '$lib/client/live/backend-transport-factory';
import { LiveCommentsClient } from '$lib/client/live/live-comments-client';
import { LiveNotesClient } from '$lib/client/live/live-notes-client';
import { LiveTasksClient } from '$lib/client/live/live-tasks-client';
import { rememberNoteWorkspace } from './live-support';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { runRecoveryRead, retireRecoveryReads } from '$lib/client/live/recovery-read-queue';

class Socket implements BrowserWebSocketLike {
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  frames: Array<{ id: number; method: string }> = [];
  outstanding = new Set<number>();
  peak = 0;
  send(raw: string) {
    const f = JSON.parse(raw);
    this.frames.push(f);
    if (f.method !== 'client.hello') {
      this.outstanding.add(f.id);
      this.peak = Math.max(this.peak, this.outstanding.size);
    }
  }
  receive(f: { id: number; result: unknown }) {
    this.outstanding.delete(f.id);
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  close() {}
}
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
let transport: BrowserWebSocketTransport;
const transports: BrowserWebSocketTransport[] = [];
afterEach(() => {
  rendererEventRecovery.dispose();
  for (const transport of transports.splice(0)) transport.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const cases = [
  {
    name: 'task get',
    method: 'note.get',
    params: { workspaceId: 'ws', noteId: 'task-1' },
    read: () => {
      rememberNoteWorkspace('task-1', 'ws');
      return new LiveTasksClient().get('task-1');
    },
    result: { note: { id: 'task-1', title: 'fresh' } },
  },
  {
    name: 'comments',
    method: 'comment.list',
    params: { workspaceId: 'ws', noteId: 'spec', includeComments: true },
    read: () => new LiveCommentsClient().list('spec', 'ws'),
    result: { threads: [] },
  },
  {
    name: 'note get',
    method: 'note.get',
    params: { workspaceId: 'ws', noteId: 'spec' },
    read: () => new LiveNotesClient().get('spec', 'ws'),
    result: { note: { id: 'spec', title: 'fresh' } },
  },
  {
    name: 'note list',
    method: 'note.list',
    params: { workspaceId: 'ws' },
    read: () => new LiveNotesClient().list('ws'),
    result: { notes: [] },
  },
  {
    name: 'attribution',
    method: 'note.lineAttribution.load',
    params: { workspaceId: 'ws', noteId: 'spec' },
    read: () => new LiveNotesClient().lineAttribution.load('ws', 'spec'),
    result: null,
  },
  {
    name: 'task list',
    method: 'task.list',
    params: { workspaceId: 'ws' },
    read: () => new LiveTasksClient().list('ws'),
    result: { tasks: [] },
  },
];
async function attachSocket() {
  const socket = new Socket();
  transport = new BrowserWebSocketTransport({
    url: 'ws://127.0.0.1:9100/rpc',
    webSocketFactory: () => socket,
    requestTimeoutMs: 50,
  });
  transports.push(transport);
  vi.spyOn(factory, 'resolveBackendTransport').mockReturnValue(transport);
  const capture = transport.captureEventRecovery();
  socket.onopen?.();
  await flush();
  const hello = socket.frames.at(-1)!;
  expect(hello.method).toBe('client.hello');
  socket.receive({
    id: hello.id,
    result: {
      clientId: 'browser-1',
      protocolVersion: '2.2',
      server: {
        locality: 'local',
        hasDisplay: false,
        osArch: 'linux/x86_64',
        version: '0.1.0',
        protocolVersion: '2.2',
        capabilities: { liveState: true, eventStreamRecovery: 1 },
      },
    },
  });
  const scope = rendererEventRecovery.attach(await capture);
  return { socket, scope };
}
describe('ordinary client wire deadlines and recovery capacity', () => {
  it.each(
    // Every client must preserve timeout completion through its own wrapper. The
    // comments route also covers the shared queue's remaining scheduling choices.
    cases.flatMap((c) => [
      { ...c, deadline: true, remount: false, mode: 'ordinary' as const },
      ...(c.name === 'comments'
        ? [
            { ...c, deadline: true, remount: true, mode: 'ordinary' as const },
            { ...c, deadline: true, remount: false, mode: 'recovery' as const },
            { ...c, deadline: false, remount: false, mode: 'recovery' as const },
            { ...c, deadline: true, remount: true, mode: 'recovery' as const },
          ]
        : []),
    ]),
  )(
    '$name retains capacity until original wire reply (deadline=$deadline, remount=$remount, next=$mode)',
    async (c) => {
      vi.useFakeTimers();
      const { socket, scope } = await attachSocket();
      const key = `actual-timeout-${c.name}`;
      const owner = {
        key,
        workspaceId: 'ws',
        eventTypes: ['note:*'],
        isCurrent: () => true,
        read: async () => null,
        apply: () => undefined,
        invalidate: () => {},
        retire: () => undefined,
      };
      const handle = scope.registerResource(owner);
      const original = runRecoveryRead(
        key,
        rendererEventRecovery.capture(key),
        'ordinary',
        c.method,
        c.read as () => Promise<unknown>,
      ).then(
        (v) => ({ v }),
        (e) => ({ e }),
      );
      await flush();
      expect(socket.frames.filter((f) => f.method === c.method)).toHaveLength(1);
      const first = socket.frames.at(-1)!;
      expect(first).toMatchObject({ method: c.method, params: c.params });
      if (c.deadline) {
        await vi.advanceTimersByTimeAsync(51);
        expect(await original).toMatchObject({ e: { code: 'TIMEOUT' } });
      }
      await flush();
      expect(socket.outstanding.size).toBe(1);
      if (c.remount) {
        handle.dispose();
        retireRecoveryReads(key);
        scope.registerResource(owner);
      }
      const next = runRecoveryRead(
        key,
        rendererEventRecovery.capture(key),
        c.mode,
        c.method,
        c.mode === 'recovery'
          ? () => scope.request(c.method, c.params)
          : (c.read as () => Promise<unknown>),
      );
      await flush();
      expect
        .soft(
          socket.frames.filter((f) => f.method === c.method),
          'no second request before original wire completion',
        )
        .toHaveLength(1);
      expect.soft(socket.peak, 'one physical request per resource').toBe(1);
      socket.receive({ id: first.id, result: c.result });
      await original;
      await flush();
      expect(socket.frames.filter((f) => f.method === c.method)).toHaveLength(2);
      expect(socket.frames.at(-1)).toMatchObject({ method: c.method, params: c.params });
      socket.receive({ id: socket.frames.at(-1)!.id, result: c.result });
      await next;
    },
  );
});

describe('timed out ordinary requests across authority retirement', () => {
  it.each([false, true])(
    'does not start queued recovery after its owner retires (deadlineBeforeQueue=%s)',
    async (deadlineBeforeQueue) => {
      vi.useFakeTimers();
      const { socket, scope } = await attachSocket();
      const key = 'wire-retire';
      const owner = scope.registerResource({
        key,
        workspaceId: 'ws',
        eventTypes: ['note:*'],
        isCurrent: () => true,
        read: async () => null,
        apply: () => undefined,
        invalidate: () => {},
        retire: () => undefined,
      });
      const original = runRecoveryRead(
        key,
        rendererEventRecovery.capture(key),
        'ordinary',
        'list',
        () => new LiveCommentsClient().list('spec', 'ws'),
      ).catch((error) => error);
      await flush();
      const first = socket.frames.at(-1)!;
      if (deadlineBeforeQueue) {
        await vi.advanceTimersByTimeAsync(51);
        expect(await original).toMatchObject({ code: 'TIMEOUT' });
      }
      const next = runRecoveryRead(
        key,
        rendererEventRecovery.capture(key),
        'recovery',
        'list',
        () => scope.request('comment.list', { workspaceId: 'ws', noteId: 'spec' }),
      ).catch((error) => error);
      await flush();
      owner.dispose();
      retireRecoveryReads(key);
      await vi.advanceTimersByTimeAsync(51);
      expect(await original).toMatchObject({ code: 'TIMEOUT' });
      socket.receive({ id: first.id, result: { threads: [] } });
      await next;
      expect(socket.frames.filter((frame) => frame.method === 'comment.list')).toHaveLength(1);
    },
  );
  it('lets a new physical session read without waiting for the retired socket', async () => {
    vi.useFakeTimers();
    const old = await attachSocket();
    const key = 'wire-new-session';
    const register = (scope: typeof old.scope) =>
      scope.registerResource({
        key,
        workspaceId: 'ws',
        eventTypes: ['note:*'],
        isCurrent: () => true,
        read: async () => null,
        apply: () => undefined,
        invalidate: () => {},
        retire: () => undefined,
      });
    register(old.scope);
    const original = runRecoveryRead(
      key,
      rendererEventRecovery.capture(key),
      'ordinary',
      'list',
      () => new LiveCommentsClient().list('spec', 'ws'),
    ).catch((error) => error);
    await flush();
    await vi.advanceTimersByTimeAsync(51);
    expect(await original).toMatchObject({ code: 'TIMEOUT' });
    const fresh = await attachSocket();
    register(fresh.scope);
    const next = runRecoveryRead(key, rendererEventRecovery.capture(key), 'recovery', 'list', () =>
      fresh.scope.request('comment.list', { workspaceId: 'ws', noteId: 'spec' }),
    );
    await flush();
    expect(old.socket.outstanding.size).toBe(1);
    expect(fresh.socket.frames.filter((frame) => frame.method === 'comment.list')).toHaveLength(1);
    fresh.socket.receive({ id: fresh.socket.frames.at(-1)!.id, result: { threads: [] } });
    await next;
  });
});
