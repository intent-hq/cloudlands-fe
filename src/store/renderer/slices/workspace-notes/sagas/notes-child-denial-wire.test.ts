import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { notesReadSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-read-saga';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  BrowserWebSocketTransport,
  type BrowserWebSocketLike,
} from '$lib/client/live/browser-websocket-transport';
import * as factory from '$lib/client/live/backend-transport-factory';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';

import type { Note } from '$shared/types';
import { notesRecoveryKey } from '$store/renderer/slices/workspace-notes/sagas/notes-recovery';
import { noteVersionsSaga } from '$store/renderer/slices/workspace-notes/sagas/note-versions-saga';
import {
  loadWorkspaceNotesSucceeded,
  workspaceNotesHydrationRequested,
  readNoteRequested,
  fetchNoteVersions,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';

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

describe('note child completion scope through the browser transport', () => {
  it.each([
    ['get', 'missing'],
    ['get', 'denied'],
    ['versions', 'missing'],
    ['versions', 'denied'],
  ] as const)('keeps child %s %s scoped to its original owner', async (kind, outcome) => {
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
    socket.receive({
      id: socket.frames.at(-1)!.id,
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
    const stopRead = store.runSaga(notesReadSaga);
    const stopVersions = store.runSaga(noteVersionsSaga);
    stop = () => {
      stopRead();
      stopVersions();
    };
    const ws = `child-${kind}-${outcome}`;
    const key = notesRecoveryKey(ws);
    await scope.subscribe({ workspaceId: ws, eventTypes: ['note:*'] }, { recover: true });
    const raw = (id: string) => ({
      id,
      workspaceId: ws,
      title: id,
      content: 'known ' + id,
      contentType: 'markdown',
      tags: [],
      isPinned: false,
      isArchived: false,
      visibility: 'workspace',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    });
    store.dispatch(
      loadWorkspaceNotesSucceeded([ws], { [ws]: [raw('child'), raw('sibling')] } as never),
    );
    store.dispatch(workspaceNotesHydrationRequested(ws, 1, false));
    await flush();
    expect(rendererEventRecovery.hasOwner(key)).toBe(true);
    const method = kind === 'get' ? 'note.get' : 'note.listVersions';
    const read = kind === 'get' ? readNoteRequested(ws, 'child') : fetchNoteVersions(ws, 'child');
    if ('promise' in read) void (read.promise as Promise<unknown>).catch(() => {});
    store.dispatch(read);
    await flush();
    const reads = () =>
      socket.frames.filter(
        (f) =>
          f.method === 'note.get' || f.method === 'note.listVersions' || f.method === 'note.list',
      );
    expect(reads()).toHaveLength(1);
    expect(reads()[0]!.method).toBe(method);
    const first = reads()[0]!;
    const original = rendererEventRecovery.captureAuthority(key);
    await vi.advanceTimersByTimeAsync(51);
    const sibling = () => {
      const row = store.state.workspaceNotes.byWorkspaceId[ws];
      return row ? getItem(row.notes, 'sibling' as Note['id']) : undefined;
    };
    expect(sibling()?.content).toBe('known sibling');
    socket.receive({
      method: 'events.lost',
      params: { subscriptionId: 'generic', generation: '1', scope: { workspaceId: ws } },
    });
    await flush();
    expect(reads()).toHaveLength(1);
    socket.receive({
      id: first.id,
      error:
        outcome === 'missing'
          ? { code: -32602, message: 'Missing', data: { code: 'not-found' } }
          : { code: -32003, message: 'Denied', data: { code: 'forbidden' } },
    });
    await flush();
    if (outcome === 'denied') {
      expect.soft(original.isCurrent()).toBe(false);
      expect.soft(sibling()).toBeUndefined();
      expect.soft(reads()).toHaveLength(1);
    } else {
      expect(original.isCurrent()).toBe(true);
      expect(sibling()?.content).toBe('known sibling');
      expect(reads()).toHaveLength(2);
      expect(reads()[1]!.method).toBe('note.list');
    }
    const recovery = reads().find((f) => f.method === 'note.list');
    if (recovery) {
      socket.receive({
        id: recovery.id,
        result: { notes: [{ ...raw('sibling'), content: 'fresh sibling' }] },
      });
      await flush();
      if (outcome === 'missing') expect(sibling()?.content).toBe('fresh sibling');
    }
  });
});
