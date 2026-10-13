import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../../store';
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
  receive(f: { id?: number; method?: string; params?: unknown; result?: unknown }) {
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

describe('actual browser timeout through comment saga and generic loss', () => {
  it.each([true, false])(
    'retains physical comment capacity after generic loss (deadline=%s)',
    async (deadline) => {
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
      await scope.subscribe(
        { workspaceId: `timeout-${deadline}`, eventTypes: ['comment:*'] },
        { recover: true },
      );
      store.dispatch(
        replaceNoteCommentsAction(`timeout-${deadline}`, 'spec', [
          {
            id: 'c',
            threadId: 'thread',
            noteId: 'spec',
            workspaceId: `timeout-${deadline}`,
            content: 'known',
            type: 'comment',
          },
        ] as never),
      );
      store.dispatch(commentLoadRequested('view', 'read', `timeout-${deadline}`, 'spec'));
      await flush();
      const reads = () => socket.frames.filter((f) => f.method === 'comment.list');
      expect(reads()).toHaveLength(1);
      const first = reads()[0]!;
      if (deadline) await vi.advanceTimersByTimeAsync(51);
      expect(getItem(store.state.comments.commentsById, 'c')?.content).toBe('known');
      socket.receive({
        method: 'events.lost',
        params: {
          subscriptionId: 'generic',
          generation: '1',
          scope: { workspaceId: `timeout-${deadline}` },
        },
      });
      await flush();
      expect.soft(reads(), 'generic recovery waits for ordinary physical read').toHaveLength(1);
      socket.receive({
        id: first.id,
        result: {
          threads: [
            {
              comments: [
                {
                  id: 'c',
                  threadId: 'thread',
                  noteId: 'spec',
                  workspaceId: `timeout-${deadline}`,
                  content: 'old reply',
                  type: 'comment',
                },
              ],
            },
          ],
        },
      });
      await flush();
      expect(reads()).toHaveLength(2);
      expect(getItem(store.state.comments.commentsById, 'c')?.content).toBe('known');
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
                  workspaceId: `timeout-${deadline}`,
                  content: 'recovered',
                  type: 'comment',
                },
              ],
            },
          ],
        },
      });
      await flush();
      expect(getItem(store.state.comments.commentsById, 'c')?.content).toBe('recovered');
      expect(reads()).toHaveLength(2);
      expect(socket.frames.filter((f) => f.method === 'events.fence')).toHaveLength(2);
    },
  );
});
