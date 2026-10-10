import { afterEach, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createElectronIpcBackendTransport } from './electron-ipc-transport';
afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});
it('uses the captured private cleanup handle after the visible bridge changes, with no generic unsubscribe', async () => {
  const api = {
    invoke: vi.fn(async (channel: string, _payload: unknown) => ({
      ok: true,
      result:
        channel === IPC_CHANNELS.BACKEND.NOTE_DELETE_SUBSCRIPTION.SUBSCRIBE
          ? { handle: 'original-handle', subscriptionId: 'server-id' }
          : undefined,
    })),
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  const binding = await createElectronIpcBackendTransport().subscribeNoteDeletion!('ws');
  const replacement = { invoke: vi.fn() };
  (window as unknown as { electronAPI?: unknown }).electronAPI = replacement;
  await binding.unsubscribe();
  expect(api.invoke.mock.calls).toEqual([
    [IPC_CHANNELS.BACKEND.NOTE_DELETE_SUBSCRIPTION.SUBSCRIBE, 'ws'],
    [IPC_CHANNELS.BACKEND.NOTE_DELETE_SUBSCRIPTION.UNSUBSCRIBE, 'original-handle'],
  ]);
  expect(replacement.invoke).not.toHaveBeenCalled();
});
it('preserves a typed owner-budget error and never falls back to generic subscriptions', async () => {
  const api = {
    invoke: vi.fn(async () => ({
      ok: false,
      error: { code: 'NOTE_DELETE_REGISTRATION_LIMIT', message: 'paused' },
    })),
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  await expect(
    createElectronIpcBackendTransport().subscribeNoteDeletion!('ws'),
  ).rejects.toMatchObject({ code: 'NOTE_DELETE_REGISTRATION_LIMIT' });
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith(
    IPC_CHANNELS.BACKEND.NOTE_DELETE_SUBSCRIPTION.SUBSCRIBE,
    'ws',
  );
});
