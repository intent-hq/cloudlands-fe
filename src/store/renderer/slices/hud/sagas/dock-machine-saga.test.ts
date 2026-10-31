import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { dockMachineSaga } from './dock-machine-saga';
import { dockMachineSwitchRequested, hudReducer, initialState } from '../hud-slice';

afterEach(() => vi.unstubAllGlobals());

function setup(invoke: ReturnType<typeof vi.fn>) {
  const listeners = new Map<string, (payload: { backendId: string }) => void>();
  const off = vi.fn((channel: string) => listeners.delete(channel));
  vi.stubGlobal('window', {
    electronAPI: {
      invoke,
      on: (channel: string, callback: (payload: { backendId: string }) => void) => {
        listeners.set(channel, callback);
        return channel;
      },
      offById: off,
    },
  });
  const channel = stdChannel();
  let state = initialState;
  const dispatch = (action: ReturnType<typeof dockMachineSwitchRequested>) => {
    state = hudReducer(state, action);
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => ({ hud: state }) }, dockMachineSaga);
  return { task, dispatch, state: () => state, listeners, off };
}

describe('dock machine switching', () => {
  it('uses the dock-only IPC and keeps a duplicate request from changing pending ownership', async () => {
    let resolve!: (value: unknown) => void;
    const invoke = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const test = setup(invoke);
    try {
      test.dispatch(dockMachineSwitchRequested('remote-build'));
      test.dispatch(dockMachineSwitchRequested('other-machine'));
      expect(invoke).toHaveBeenCalledExactlyOnceWith(WINDOW_CHANNELS.SWITCH_DOCK_BACKEND, {
        backendId: 'remote-build',
      });
      expect(test.state().dockMachineSwitching).toBe('remote-build');
      resolve({ success: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(test.state().dockMachineSwitching).toBe('remote-build');
      expect(test.state().dockMachineSwitchError).toBe(false);
    } finally {
      test.task.cancel();
    }
  });

  it('shows a failed connection without changing machines and admits a retry', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true });
    const test = setup(invoke);
    try {
      test.dispatch(dockMachineSwitchRequested('offline'));
      await vi.waitFor(() => expect(test.state().dockMachineSwitchError).toBe(true));
      test.dispatch(dockMachineSwitchRequested('remote-build'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(test.state().dockMachineSwitching).toBe('remote-build');
      expect(test.state().dockMachineSwitchError).toBe(false);
      expect(invoke).toHaveBeenCalledTimes(2);
    } finally {
      test.task.cancel();
    }
  });

  it('unlocks a cancelled accepted handoff only for its pending target', async () => {
    const test = setup(vi.fn().mockResolvedValue({ success: true }));
    try {
      test.dispatch(dockMachineSwitchRequested('remote-build'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      test.listeners.get(WINDOW_CHANNELS.DOCK_BACKEND_SWITCH_FAILED)?.({ backendId: 'stale' });
      expect(test.state().dockMachineSwitching).toBe('remote-build');
      test.listeners.get(WINDOW_CHANNELS.DOCK_BACKEND_SWITCH_FAILED)?.({
        backendId: 'remote-build',
      });
      expect(test.state().dockMachineSwitching).toBeNull();
      expect(test.state().dockMachineSwitchError).toBe(true);
    } finally {
      test.task.cancel();
    }
    expect(test.off).toHaveBeenCalled();
  });

  it('does not publish late completion after the dock lifetime ends', async () => {
    let resolve!: (value: unknown) => void;
    const invoke = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const test = setup(invoke);
    test.dispatch(dockMachineSwitchRequested('remote-build'));
    test.task.cancel();
    resolve({ success: true });
    await test.task.toPromise();
    expect(test.state().dockMachineSwitching).toBe('remote-build');
  });
});
