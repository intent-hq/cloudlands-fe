import { afterEach, describe, expect, it, vi } from 'vitest';
import { getItem, createCollection } from '@themislib/themis/utils/collections/collection-utils';
import {
  BrowserWebSocketTransport,
  type BrowserWebSocketLike,
} from '$lib/client/live/browser-websocket-transport';
import * as factory from '$lib/client/live/backend-transport-factory';
import { LiveFilesClient } from '$lib/client/live/live-files-client';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { trackWorktreeSnapshotRead } from '$features/file-tracking/worktree-read-lane';
import {
  filesReducer,
  loadFileContentSucceeded,
  removeFileContentEntry,
} from '$store/renderer/slices/files/files-slice';
import { fileExplorerReducer } from '$store/renderer/slices/file-explorer/file-explorer-slice';
import { createAdmittedLegacyPrincipal } from '../../test/fixtures/admitted-legacy-principal';
import type { StoreState } from '$store/renderer/types';
import { installFileEventRecovery } from './file-event-recovery';
import { fileContentRecoveryKey } from './file-recovery-keys';
import { readFileSnapshot } from './file-recovery-effects';

class Socket implements BrowserWebSocketLike {
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  frames: Array<{ id: number; method: string }> = [];
  outstanding = new Set<number>();
  peak = 0;
  send(data: string) {
    const frame = JSON.parse(data);
    this.frames.push(frame);
    if (frame.method !== 'client.hello') {
      this.outstanding.add(frame.id);
      this.peak = Math.max(this.peak, this.outstanding.size);
    }
  }
  receive(frame: { id: number; result?: unknown; error?: unknown }) {
    this.outstanding.delete(frame.id);
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  close() {}
}
const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
const transports: BrowserWebSocketTransport[] = [];
const offs: Array<() => void> = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  rendererEventRecovery.dispose();
  for (const transport of transports.splice(0)) transport.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function setup() {
  vi.useFakeTimers();
  const socket = new Socket();
  const transport = new BrowserWebSocketTransport({
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
  socket.receive({
    id: hello.id,
    result: {
      clientId: 'browser',
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
  let files = filesReducer(undefined, { type: 'init' });
  const listeners = new Set<() => void>();
  const state = () =>
    ({
      files,
      fileExplorer: fileExplorerReducer.initialState,
      workspace: {
        workspaces: createCollection('id', [{ id: 'ws', myRole: 'owner', worktreePath: '/repo' }]),
        deletionTokens: {},
      },
      tabState: { currentTabId: 'ws' },
      ...authority,
    }) as StoreState;
  const authority = createAdmittedLegacyPrincipal();
  const dispatch = (action: { type: string; payload?: unknown }) => {
    files = filesReducer(files, action);
    for (const listener of listeners) listener();
    return action;
  };
  offs.push(
    installFileEventRecovery(scope, {
      getState: state,
      dispatch,
      subscribe: (fn) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    }),
  );
  dispatch(
    loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', {
      kind: 'editable-text',
      content: 'private old',
    }),
  );
  const key = fileContentRecoveryKey('ws', 'a.ts');
  return {
    socket,
    scope,
    key,
    dispatch,
    entry: () => getItem(files.byWorkspaceId.ws.files, 'a.ts'),
    start: () =>
      readFileSnapshot(key, rendererEventRecovery.capture(key), () =>
        new LiveFilesClient().read('ws', 'a.ts'),
      ).catch((error) => error),
  };
}

describe('ordinary file client physical completion over browser wire', () => {
  it('returns the deadline promptly but holds recovery until the ordinary frame drains', async () => {
    const h = await setup();
    const original = h.start();
    await flush();
    const first = h.socket.frames.at(-1)!;
    await vi.advanceTimersByTimeAsync(51);
    expect(await original).toMatchObject({ code: 'TIMEOUT' });
    const next = trackWorktreeSnapshotRead(
      h.key,
      () => h.scope.request<string>('file.read', { workspaceId: 'ws', path: 'a.ts' }),
      'recovery',
    );
    await flush();
    expect(h.socket.frames.filter((f) => f.method === 'file.read')).toHaveLength(1);
    expect(h.socket.peak).toBe(1);
    h.socket.receive({ id: first.id, result: 'stale reply' });
    await flush();
    expect(h.socket.frames.filter((f) => f.method === 'file.read')).toHaveLength(2);
    expect(h.entry()?.originalContent).toBe('private old');
    h.socket.receive({ id: h.socket.frames.at(-1)!.id, result: 'fresh' });
    const value = await next;
    h.dispatch(
      loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', {
        kind: 'editable-text',
        content: value,
      }),
    );
    expect(h.entry()?.originalContent).toBe('fresh');
  });

  it.each([false, true])(
    'late canonical denial retires only its original file owner (replaced=%s)',
    async (replaced) => {
      const h = await setup();
      const original = h.start();
      await flush();
      const first = h.socket.frames.at(-1)!;
      await vi.advanceTimersByTimeAsync(51);
      await original;
      if (replaced) {
        h.dispatch(removeFileContentEntry('ws', 'a.ts'));
        h.dispatch(
          loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', {
            kind: 'editable-text',
            content: 'new owner',
          }),
        );
      }
      h.socket.receive({ id: first.id, error: { code: -32003, message: 'Forbidden' } });
      await flush();
      if (replaced) expect(h.entry()?.originalContent).toBe('new owner');
      else expect(h.entry()).toBeUndefined();
    },
  );

  it('a real replacement transport does not inherit the old file drain barrier', async () => {
    const old = await setup();
    const original = old.start();
    await flush();
    const first = old.socket.frames.at(-1)!;
    await vi.advanceTimersByTimeAsync(51);
    await original;
    const current = await setup();
    const next = trackWorktreeSnapshotRead(
      current.key,
      () => current.scope.request('file.read', { workspaceId: 'ws', path: 'a.ts' }),
      'recovery',
    );
    try {
      await flush();
      expect(current.socket.frames.filter((f) => f.method === 'file.read')).toHaveLength(1);
    } finally {
      old.socket.receive({ id: first.id, result: 'old' });
      await flush();
      current.socket.receive({ id: current.socket.frames.at(-1)!.id, result: 'current' });
      await next;
    }
  });
});
