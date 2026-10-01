import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectDevConsole } from './dev-console-bridge';
import { consoleUpdated, consoleReset, devConsoleReducer } from './dev-console-slice';
import { DevConsoleCaptureService } from '$features/dev-console/main/dev-console-capture';
import type { RpcTrafficObserver } from '$features/backend/main/rpc-traffic';

const original = window.electronAPI;
afterEach(() => {
  window.electronAPI = original;
});
it('subscribes before first read, coalesces overlapping reads and ignores late responses after unmount', async () => {
  const callbacks = new Map<string, (...args: any[]) => void>();
  let finish!: (value: any) => void;
  const invoke = vi.fn(async (channel: string) =>
    channel.endsWith('connect')
      ? { backendId: 'one', sessionId: 'session' }
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  window.electronAPI = {
    invoke,
    on: (channel: string, callback: any) => {
      callbacks.set(channel, callback);
      return channel;
    },
    offById: vi.fn(),
  } as any;
  const update = vi.fn();
  const error = vi.fn();
  const bridge = connectDevConsole(update, error);
  await vi.waitFor(() =>
    expect(invoke.mock.calls.filter(([channel]) => channel.endsWith('read'))).toHaveLength(1),
  );
  callbacks.get('dev-console:changed')!({ sessionId: 'session' });
  callbacks.get('dev-console:changed')!({ sessionId: 'session' });
  expect(invoke.mock.calls.filter(([channel]) => channel.endsWith('read'))).toHaveLength(1);
  finish({ sessionId: 'session', revision: 1 });
  await Promise.resolve();
  await Promise.resolve();
  await vi.waitFor(() =>
    expect(invoke.mock.calls.filter(([channel]) => channel.endsWith('read'))).toHaveLength(2),
  );
  bridge.dispose();
  finish({ sessionId: 'session', revision: 2 });
  await Promise.resolve();
  await Promise.resolve();
  expect(update).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
  expect(window.electronAPI.offById).toHaveBeenCalledWith(
    'dev-console:changed',
    'dev-console:changed',
  );
});

describe('capture delta and dedicated Redux state', () => {
  it('applies new and completed rows, evictions, clears and stale revisions without copying payloads', () => {
    const capture = new DevConsoleCaptureService({ maxRecords: 2 });
    let observe!: RpcTrafficObserver;
    capture.registerClient('one', 'main', {
      observeTraffic(fn) {
        observe = fn;
        return () => {};
      },
    });
    const { sessionId } = capture.openSession('one');
    const store = {
      state: { devConsole: devConsoleReducer(undefined, { type: '@@init' }) },
      dispatch(action: any) {
        this.state.devConsole = devConsoleReducer(this.state.devConsole, action);
      },
      dispose() {},
    };
    const read = (revision = -1) => capture.getUpdate('one', sessionId, revision)!;
    try {
      observe({
        type: 'request',
        direction: 'outbound',
        key: '1',
        requestId: 1,
        method: 'test',
        payload: { secret: 'value' },
        connectionGeneration: 1,
      });
      const initial = read();
      store.dispatch(consoleUpdated(initial));
      expect(Object.values(store.state.devConsole.rows)[0].status).toBe('pending');
      expect(Object.values(store.state.devConsole.rows)[0].payload).not.toHaveProperty('text');
      observe({
        type: 'response',
        key: '1',
        status: 'success',
        payload: { secret: 'response' },
        connectionGeneration: 1,
      });
      const complete = read(initial.revision);
      store.dispatch(consoleUpdated(complete));
      expect(complete.upserts).toHaveLength(1);
      expect(Object.values(store.state.devConsole.rows)[0].status).toBe('success');
      store.dispatch(consoleUpdated(initial));
      expect(Object.values(store.state.devConsole.rows)[0].status).toBe('success');
      expect(read(complete.revision).upserts).toEqual([]);
      for (let i = 0; i < 3; i++)
        observe({ type: 'notification', method: 'notice', payload: i, connectionGeneration: 1 });
      store.dispatch(consoleUpdated(read(complete.revision)));
      expect(Object.keys(store.state.devConsole.rows)).toHaveLength(2);
      expect(capture.getRecord('one', sessionId, initial.recordIds[0])).toBeNull();
      capture.clearSession('one', sessionId);
      store.dispatch(consoleUpdated(read()));
      expect(store.state.devConsole.rows).toEqual({});
      store.dispatch(consoleReset());
      expect(store.state.devConsole.update).toBeNull();
    } finally {
      store.dispose();
    }
  });
});
