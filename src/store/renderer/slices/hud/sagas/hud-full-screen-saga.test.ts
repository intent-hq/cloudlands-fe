import { stdChannel } from 'redux-saga';
import { runSaga } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenSync: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
  listenSync: mocks.listenSync,
}));

import { hudFullScreenChanged, hudFullScreenRequested } from '../hud-slice';
import { hudFullScreenSaga } from './hud-saga';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('hudFullScreenSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI = {} as typeof window.electronAPI;
    mocks.listenSync.mockReturnValue(vi.fn());
    mocks.invoke.mockResolvedValue({ success: true, fullScreen: false });
  });

  it('gets, sets, and tracks full-screen state through the exact IPC contract', async () => {
    const channel = stdChannel();
    const dispatched: unknown[] = [];
    let listener: ((event: { payload: boolean }) => void) | undefined;
    mocks.listenSync.mockImplementation((_eventName, handler) => {
      listener = handler;
      return vi.fn();
    });
    const task = runSaga(
      { channel, dispatch: (action) => dispatched.push(action) },
      hudFullScreenSaga,
    );
    await flush();

    expect(mocks.invoke).toHaveBeenCalledWith('window:get-full-screen', {});
    expect(dispatched).toContainEqual(hudFullScreenChanged(false));

    mocks.invoke.mockResolvedValueOnce({ success: true, fullScreen: true });
    channel.put(hudFullScreenRequested(true));
    await flush();
    expect(mocks.invoke).toHaveBeenLastCalledWith('window:set-full-screen', { fullScreen: true });
    expect(dispatched).toContainEqual(hudFullScreenChanged(true));

    listener?.({ payload: false });
    await flush();
    expect(dispatched.at(-1)).toEqual(hudFullScreenChanged(false));

    task.cancel();
    await task.toPromise();
  });
});
