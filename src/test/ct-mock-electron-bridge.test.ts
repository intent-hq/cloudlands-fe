import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emitMockIpcEvent,
  mockIpcListenerCount,
  resetMockIpcRouter,
} from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createElectronChannel } from '$store/renderer/utils/ipc-channel';
import { installMockElectronBridge } from './ct-mock-electron-bridge';

const PROGRESS = IPC_CHANNELS.TRANSFER.PROGRESS;
const OTHER = 'agent:status-changed';

afterEach(() => {
  resetMockIpcRouter();
  vi.restoreAllMocks();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('CT mock electron bridge events', () => {
  it('delivers router events to on() listeners of that channel only', () => {
    installMockElectronBridge({});
    const progress = vi.fn();
    const other = vi.fn();
    window.electronAPI.on(PROGRESS, progress);
    window.electronAPI.on(OTHER, other);

    emitMockIpcEvent(PROGRESS, { workspaceId: 'w1' });

    expect(progress).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'w1' });
    expect(other).not.toHaveBeenCalled();
  });

  it('offById removes only the listener with that id', () => {
    installMockElectronBridge({});
    const first = vi.fn();
    const second = vi.fn();
    const firstId = window.electronAPI.on(PROGRESS, first);
    const secondId = window.electronAPI.on(PROGRESS, second);
    expect(firstId).not.toBe(secondId);

    window.electronAPI.offById(PROGRESS, firstId);
    window.electronAPI.offById(PROGRESS, 'unknown-id');
    emitMockIpcEvent(PROGRESS, 1);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('off and removeAllListeners detach by callback and by channel', () => {
    installMockElectronBridge({});
    const byCallback = vi.fn();
    const rest = vi.fn();
    const other = vi.fn();
    window.electronAPI.on(PROGRESS, byCallback);
    window.electronAPI.on(PROGRESS, rest);
    window.electronAPI.on(OTHER, other);

    window.electronAPI.off(PROGRESS, byCallback);
    emitMockIpcEvent(PROGRESS, 'a');
    window.electronAPI.removeAllListeners(PROGRESS);
    emitMockIpcEvent(PROGRESS, 'b');
    emitMockIpcEvent(OTHER, 'c');

    expect(byCallback).not.toHaveBeenCalled();
    expect(rest).toHaveBeenCalledExactlyOnceWith('a');
    expect(other).toHaveBeenCalledExactlyOnceWith('c');
    expect(mockIpcListenerCount(PROGRESS)).toBe(0);
  });

  it('does not report main-process channels as unemitted mock listeners', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    installMockElectronBridge({});
    window.electronAPI.on(PROGRESS, () => {});
    expect(error).not.toHaveBeenCalled();
  });

  it('feeds saga electron channels and unsubscribes when they close', () => {
    installMockElectronBridge({});
    const channel = createElectronChannel<{ n: number }>(PROGRESS);
    const received: unknown[] = [];
    channel.take((event) => received.push(event));

    emitMockIpcEvent(PROGRESS, { n: 1 });
    channel.close();

    expect(received).toEqual([{ n: 1 }]);
    expect(mockIpcListenerCount(PROGRESS)).toBe(0);
  });
});

describe('CT mock electron bridge daemon requests', () => {
  const request = (method: string, params?: unknown) =>
    window.electronAPI.invoke(IPC_CHANNELS.BACKEND.REQUEST, { method, params });

  it('answers through a request function and reports its errors as unhandled', async () => {
    installMockElectronBridge((method, params) => {
      if (method === 'echo') return params;
      throw new Error(`Unscripted: ${method}`);
    });

    await expect(request('echo', { a: 1 })).resolves.toEqual({ ok: true, result: { a: 1 } });
    await expect(request('missing')).resolves.toEqual({
      ok: false,
      error: { code: 'MOCK_UNHANDLED_METHOD', message: 'Error: Unscripted: missing' },
    });
  });

  it('restore detaches its listeners and reinstates the previous bridge', () => {
    const previous = { marker: true } as unknown as Window['electronAPI'];
    window.electronAPI = previous;
    const restore = installMockElectronBridge({});
    const listener = vi.fn();
    window.electronAPI.on(PROGRESS, listener);

    restore();
    emitMockIpcEvent(PROGRESS, 1);

    expect(listener).not.toHaveBeenCalled();
    expect(mockIpcListenerCount(PROGRESS)).toBe(0);
    expect(window.electronAPI).toBe(previous);
  });
});
