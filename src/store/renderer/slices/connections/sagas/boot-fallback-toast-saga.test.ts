import { runSaga } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isElectron: vi.fn(() => true),
  invoke: vi.fn(),
  toast: vi.fn(),
  notice: vi.fn(({ label }: { label: string }) => `Couldn't reach ${label}; using this machine.`),
  toastModuleLoaded: vi.fn(),
  messagesModuleLoaded: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron }));
vi.mock('svelte-sonner', () => {
  mocks.toastModuleLoaded();
  return { toast: mocks.toast };
});
vi.mock('$shared/paraglide/messages.js', () => {
  mocks.messagesModuleLoaded();
  return { m: { layout_daemonStatus_bootFallback_notice: mocks.notice } };
});

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { bootFallbackToastSaga } from './boot-fallback-toast-saga';

describe('bootFallbackToastSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isElectron.mockReturnValue(true);
    mocks.invoke.mockResolvedValue({ bootFallback: null });
    Object.assign(window, { electronAPI: { invoke: mocks.invoke } });
  });

  it('consumes the exact one-shot channel once without loading toast code when no notice exists', async () => {
    await runSaga({}, bootFallbackToastSaga).toPromise();

    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.CONNECTIONS.GET_BOOT_FALLBACK);
    expect(IPC_CHANNELS.CONNECTIONS.GET_BOOT_FALLBACK).toBe('connections:get-boot-fallback');
    expect(mocks.toastModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.messagesModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('surfaces a protocol-shaped fallback notice through the lazy localized toast', async () => {
    mocks.invoke.mockResolvedValue({
      bootFallback: { id: 'remote-1', label: 'Studio Mac' },
    });

    await runSaga({}, bootFallbackToastSaga).toPromise();

    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.notice).toHaveBeenCalledWith({ label: 'Studio Mac' });
    expect(mocks.toast).toHaveBeenCalledWith("Couldn't reach Studio Mac; using this machine.");
  });

  it('does not consume the notice outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);

    await runSaga({}, bootFallbackToastSaga).toPromise();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('swallows advisory pull failures without showing a toast', async () => {
    mocks.invoke.mockRejectedValue(new Error('bridge gone'));

    await expect(runSaga({}, bootFallbackToastSaga).toPromise()).resolves.toBeUndefined();

    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
