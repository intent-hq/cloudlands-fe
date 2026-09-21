import { runSaga, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';

const mocks = vi.hoisted(() => ({ isElectron: vi.fn(() => true) }));

vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron }));
vi.mock('typed-redux-saga', async () => {
  const effects = await import('redux-saga/effects');
  return {
    ...Object.fromEntries(
      ['all', 'join', 'put', 'fork', 'take'].map((name) => [
        name,
        function* (...args: unknown[]) {
          return yield (effects as any)[name](...args);
        },
      ]),
    ),
    call: function* (fnOrDescriptor: any, ...args: any[]) {
      return yield Array.isArray(fnOrDescriptor)
        ? effects.call(fnOrDescriptor as any, ...args)
        : effects.call(fnOrDescriptor, ...args);
    },
  };
});

import { resolveIpcChannelBufferPolicy } from '../../../utils/ipc-channel';
import { initialState, userPreferencesReducer } from '../user-preferences-slice';
import { zoomIpcSaga } from './zoom-ipc-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('zoomIpcSaga', () => {
  let handlers: Array<(payload: unknown) => void>;
  let on: ReturnType<typeof vi.fn>;
  let offById: ReturnType<typeof vi.fn>;
  let invoke: ReturnType<typeof vi.fn>;
  let tasks: Task[];

  function start() {
    let state = initialState;
    const task = runSaga(
      { dispatch: (action) => (state = userPreferencesReducer(state, action)) },
      zoomIpcSaga,
    );
    tasks.push(task);
    return { task, getState: () => state };
  }

  beforeEach(() => {
    handlers = [];
    tasks = [];
    resetMockIpcRouter();
    registerMockIpcHandler(WINDOW_CHANNELS.GET_ZOOM_FACTOR, () => ({ success: true, data: 1 }));
    invoke = vi.fn(mockInvoke);
    on = vi.fn((_channel: string, handler: (payload: unknown) => void) => {
      handlers.push(handler);
      return 'zoom-listener';
    });
    offById = vi.fn();
    window.electronAPI = { ...window.electronAPI, on, offById, invoke };
    mocks.isElectron.mockReturnValue(true);
  });

  afterEach(async () => {
    for (const task of tasks) task.cancel();
    await Promise.all(tasks.map((task) => task.toPromise()));
    delete (window as Partial<Window>).electronAPI;
    resetMockIpcRouter();
    vi.clearAllMocks();
  });

  it('uses latest-only buffering and maps only valid zoom payloads exactly', async () => {
    expect(resolveIpcChannelBufferPolicy('window:zoom-changed')).toEqual({
      kind: 'sliding',
      limit: 1,
      rationale: 'Only the latest status or progress event is actionable.',
    });
    const actions: unknown[] = [];
    const task = runSaga({ dispatch: (action) => actions.push(action) }, zoomIpcSaga);
    tasks.push(task);

    handlers[0]({ zoomFactor: 1.5, zoom_factor: 9 });
    handlers[0]({ zoomFactor: -1 });
    handlers[0]({ zoomFactor: 0 });
    handlers[0]({ zoomFactor: '2' });
    handlers[0]({ zoomFactor: Number.NaN });
    handlers[0]({ zoomFactor: Infinity });
    await settle();

    expect(actions).toEqual([{ type: 'userPreferences/setZoomFactor', payload: [1.5] }]);
    task.cancel();
    await task.toPromise();
  });

  it('prevents duplicate starts, removes its listener on cancellation, and can restart', async () => {
    const first = runSaga({ dispatch: vi.fn() }, zoomIpcSaga);
    tasks.push(first);
    const duplicate = runSaga({ dispatch: vi.fn() }, zoomIpcSaga);
    await duplicate.toPromise();
    expect(on.mock.calls).toEqual([['window:zoom-changed', handlers[0]]]);

    first.cancel();
    await first.toPromise();
    expect(offById.mock.calls).toEqual([['window:zoom-changed', 'zoom-listener']]);

    const restarted = runSaga({ dispatch: vi.fn() }, zoomIpcSaga);
    tasks.push(restarted);
    expect(on).toHaveBeenCalledTimes(2);
    restarted.cancel();
    await restarted.toPromise();
  });

  it('does not subscribe outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    await runSaga({ dispatch: vi.fn() }, zoomIpcSaga).toPromise();
    expect(on.mock.calls).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('hydrates startup through the existing query and response contract', async () => {
    registerMockIpcHandler(WINDOW_CHANNELS.GET_ZOOM_FACTOR, () => ({ success: true, data: 0.75 }));
    const renderer = start();
    await vi.waitFor(() => expect(renderer.getState().zoomFactor).toBe(0.75));
    expect(invoke.mock.calls).toEqual([['window:get-zoom-factor', undefined]]);
    expect(on.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0]);
  });

  it('never lets a delayed startup response overwrite a newer event', async () => {
    let resolve!: (response: unknown) => void;
    registerMockIpcHandler(
      WINDOW_CHANNELS.GET_ZOOM_FACTOR,
      () => new Promise((done) => (resolve = done)),
    );
    const renderer = start();
    handlers[0]({ zoomFactor: 0.8 });
    handlers[0]({ zoomFactor: 1.2 });
    resolve({ success: true, data: 0.5 });
    await settle();
    expect(renderer.getState().zoomFactor).toBe(1.2);
  });

  it('rehydrates on remount and ignores the cancelled renderer query', async () => {
    let resolveOld!: (response: unknown) => void;
    registerMockIpcHandler(
      WINDOW_CHANNELS.GET_ZOOM_FACTOR,
      () => new Promise((done) => (resolveOld = done)),
    );
    const oldRenderer = start();
    oldRenderer.task.cancel();
    await oldRenderer.task.toPromise();
    registerMockIpcHandler(WINDOW_CHANNELS.GET_ZOOM_FACTOR, () => ({ success: true, data: 0.67 }));
    const newRenderer = start();
    await settle();
    resolveOld({ success: true, data: 2 });
    await settle();
    expect(newRenderer.getState().zoomFactor).toBe(0.67);
    expect(oldRenderer.getState().zoomFactor).toBe(1);
    expect(invoke.mock.calls).toEqual([
      ['window:get-zoom-factor', undefined],
      ['window:get-zoom-factor', undefined],
    ]);
  });

  it.each([
    { success: false, error: 'window closed' },
    { success: true, data: 0 },
    { success: true, data: '0.8' },
    { success: true, data: Infinity },
  ])('keeps listening after an unsuccessful or invalid query: %j', async (response) => {
    registerMockIpcHandler(WINDOW_CHANNELS.GET_ZOOM_FACTOR, () => response);
    const renderer = start();
    await settle();
    expect(renderer.getState().zoomFactor).toBe(1);
    handlers[0]({ zoomFactor: 0.8 });
    expect(renderer.getState().zoomFactor).toBe(0.8);
  });

  it('keeps listening after the query rejects', async () => {
    registerMockIpcHandler(WINDOW_CHANNELS.GET_ZOOM_FACTOR, () => {
      throw new Error('reload');
    });
    const renderer = start();
    await settle();
    handlers[0]({ zoomFactor: 1.25 });
    expect(renderer.getState().zoomFactor).toBe(1.25);
  });
});
