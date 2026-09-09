import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { END, runSaga } from 'redux-saga';

vi.mock(
  '$lib/electron-bridge',
  async () => await import('$store/renderer/utils/test-helpers/electron-bridge-mock'),
);

import { listenSync } from '$lib/electron-bridge';
import {
  createElectronChannel,
  createWindowEventChannel,
  takeEveryFromElectronChannel,
  takeEveryFromListenSync,
  takeEveryFromWindowEvent,
} from './ipc-channel';

const flushSaga = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('renderer saga event channels', () => {
  let originalElectronApi: typeof window.electronAPI | undefined;

  beforeEach(() => {
    originalElectronApi = window.electronAPI;
  });

  afterEach(() => {
    if (originalElectronApi) window.electronAPI = originalElectronApi;
    else delete (window as Partial<Window>).electronAPI;
    vi.clearAllMocks();
  });

  it('bridges window details and removes the listener on close', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const channel = createWindowEventChannel<{ id: string }>('window:test');
    const values: Array<{ id: string }> = [];
    channel.take((value) => values.push(value));

    window.dispatchEvent(new CustomEvent('window:test', { detail: { id: 'one' } }));
    channel.close();

    expect(values).toEqual([{ id: 'one' }]);
    expect(remove).toHaveBeenCalledWith('window:test', expect.any(Function), false);
  });

  it('unwraps listenSync payloads and closes the subscription on cancellation', async () => {
    let emit: ((value: { payload: { id: string } }) => void) | undefined;
    const cleanup = vi.fn();
    vi.mocked(listenSync).mockImplementation((_event, handler) => {
      emit = handler;
      return cleanup;
    });
    const values: string[] = [];
    function* root() {
      yield* takeEveryFromListenSync<{ id: string }>('terminal:disposed', function* (value) {
        values.push(value.id);
      });
    }

    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, root);
    await flushSaga();
    emit?.({ payload: { id: 'term-1' } });
    await flushSaga();
    task.cancel();
    await task.toPromise();

    expect(values).toEqual(['term-1']);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('ends unavailable Electron channels without registering listeners', () => {
    delete (window as Partial<Window>).electronAPI;
    const channel = createElectronChannel('agent:plan-required');
    let value: unknown;
    channel.take((next) => (value = next));
    expect(value).toBe(END);
    channel.close();
  });

  it('removes Electron listeners when a watcher is cancelled', async () => {
    const offById = vi.fn();
    let emit: ((value: { message: string }) => void) | undefined;
    window.electronAPI = {
      ...window.electronAPI,
      on: vi.fn((_event, handler) => {
        emit = handler;
        return 'listener-1';
      }),
      offById,
    };
    function* root() {
      yield* takeEveryFromElectronChannel('agent:plan-required', function* () {});
    }
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, root);
    await flushSaga();
    emit?.({ message: 'upgrade' });
    task.cancel();
    await task.toPromise();
    expect(offById).toHaveBeenCalledWith('agent:plan-required', 'listener-1');
  });

  it('keeps the window watcher cancellable', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    function* root() {
      yield* takeEveryFromWindowEvent('window:test', function* () {});
    }
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, root);
    await flushSaga();
    task.cancel();
    await task.toPromise();
    expect(remove).toHaveBeenCalledWith('window:test', expect.any(Function), false);
  });
});
