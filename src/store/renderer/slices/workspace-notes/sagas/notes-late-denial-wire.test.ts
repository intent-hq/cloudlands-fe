import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { notesReadSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-read-saga';
import {
  commentLoadRequested,
  replaceNoteCommentsAction,
} from '$store/renderer/slices/comments/comments-slice';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  BrowserWebSocketTransport,
  type BrowserWebSocketLike,
} from '$lib/client/live/browser-websocket-transport';
import * as factory from '$lib/client/live/backend-transport-factory';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { commentsRecoveryKey } from '$store/renderer/slices/workspace-notes/sagas/notes-recovery';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

class Socket implements BrowserWebSocketLike {
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  onSend?: (f: { id: number; method: string; params?: unknown }) => void;
  frames: Array<{ id: number; method: string; params?: unknown }> = [];
  outstanding = new Set<number>();
  peak = 0;
  send(raw: string) {
    const f = JSON.parse(raw);
    this.frames.push(f);
    if (f.method !== 'client.hello') {
      this.outstanding.add(f.id);
      this.peak = Math.max(this.peak, this.outstanding.size);
    }
    this.onSend?.(f);
  }
  receive(f: {
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
  }) {
    if (f.id !== undefined) this.outstanding.delete(f.id);
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  close() {}
}
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
let transport: BrowserWebSocketTransport;
let stop: (() => void) | undefined;
beforeAll(() => store.init());
afterAll(() => store.dispose());
afterEach(() => {
  stop?.();
  rendererEventRecovery.dispose();
  transport?.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('late physical ordinary denial at actual comment owner', () => {
  it.each(
    (
      [
        'denial',
        'unauthorized',
        'not-found',
        'transient',
        'invalid-params',
        'replaced-denial',
      ] as const
    ).flatMap((outcome) => [true, false].map((deadline) => ({ outcome, deadline }))),
  )(
    'retains original authority for $outcome (deadline=$deadline)',
    async ({ outcome, deadline }) => {
      vi.useFakeTimers();
      const socket = new Socket();
      transport = new BrowserWebSocketTransport({
        url: 'ws://127.0.0.1:9100/rpc',
        webSocketFactory: () => socket,
        requestTimeoutMs: 50,
      });
      vi.spyOn(factory, 'resolveBackendTransport').mockReturnValue(transport);
      const capture = transport.captureEventRecovery();
      socket.onopen?.();
      await flush();
      const hello = socket.frames.at(-1)!;
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
      socket.onSend = (f) => {
        if (f.method === 'events.subscribe' || f.method === 'events.fence')
          queueMicrotask(() =>
            socket.receive({
              id: f.id,
              result:
                f.method === 'events.subscribe'
                  ? { subscriptionId: 'generic', lossRecovery: 1 }
                  : f.params,
            }),
          );
      };
      const scope = rendererEventRecovery.attach(await capture);
      admitLegacyPrincipal();
      stop = store.runSaga(notesReadSaga);
      const ws = `late-${outcome}-${deadline}`;
      const key = commentsRecoveryKey(ws, 'spec');
      await scope.subscribe({ workspaceId: ws, eventTypes: ['comment:*'] }, { recover: true });
      const seed = (content: string) =>
        store.dispatch(
          replaceNoteCommentsAction(ws, 'spec', [
            {
              id: 'c',
              threadId: 'thread',
              noteId: 'spec',
              workspaceId: ws,
              content,
              type: 'comment',
            },
          ] as never),
        );
      seed('known private');
      store.dispatch(commentLoadRequested('view', 'read', ws, 'spec'));
      await flush();
      const original = rendererEventRecovery.captureAuthority(key);
      const reads = () => socket.frames.filter((f) => f.method === 'comment.list');
      expect(reads()).toHaveLength(1);
      const first = reads()[0]!;
      if (deadline) await vi.advanceTimersByTimeAsync(51);
      expect(getItem(store.state.comments.commentsById, 'c')?.content).toBe('known private');
      if (outcome === 'replaced-denial') {
        store.dispatch(workspaceUnmounted(ws));
        await flush();
        expect(original.isCurrent()).toBe(false);
        seed('replacement private');
        store.dispatch(commentLoadRequested('view-new', 'read-new', ws, 'spec'));
        await flush();
      } else {
        socket.receive({
          method: 'events.lost',
          params: { subscriptionId: 'generic', generation: '1', scope: { workspaceId: ws } },
        });
        await flush();
      }
      expect(reads()).toHaveLength(1);
      socket.receive({
        id: first.id,
        error:
          outcome === 'transient'
            ? { code: -32603, message: 'Temporary', data: { code: 'INTERNAL' } }
            : outcome === 'invalid-params'
              ? { code: -32602, message: 'Invalid params' }
              : outcome === 'not-found'
                ? { code: -32602, message: 'Not found', data: { code: 'not-found' } }
                : outcome === 'unauthorized'
                  ? { code: -32001, message: 'Unauthorized' }
                  : { code: -32003, message: 'Denied', data: { code: 'forbidden' } },
      });
      await flush();
      if (['denial', 'unauthorized', 'not-found'].includes(outcome)) {
        expect
          .soft(original.isCurrent(), 'current original owner retires on canonical late denial')
          .toBe(false);
        expect
          .soft(
            getItem(store.state.comments.commentsById, 'c'),
            'protected rows clear on canonical late denial',
          )
          .toBeUndefined();
        expect.soft(reads(), 'canonical denial must not start a queued fresh read').toHaveLength(1);
        if (reads().length > 1) {
          socket.receive({ id: reads()[1]!.id, result: { threads: [] } });
          await flush();
        }
      } else {
        expect(rendererEventRecovery.captureAuthority(key).isCurrent()).toBe(true);
        expect(getItem(store.state.comments.commentsById, 'c')?.content).toBe(
          outcome === 'replaced-denial' ? 'replacement private' : 'known private',
        );
        expect(reads()).toHaveLength(2);
        socket.receive({
          id: reads()[1]!.id,
          result: {
            threads: [
              {
                comments: [
                  {
                    id: 'c',
                    threadId: 'thread',
                    noteId: 'spec',
                    workspaceId: ws,
                    content: 'fresh',
                    type: 'comment',
                  },
                ],
              },
            ],
          },
        });
        await flush();
        expect(getItem(store.state.comments.commentsById, 'c')?.content).toBe('fresh');
      }
    },
  );
});
