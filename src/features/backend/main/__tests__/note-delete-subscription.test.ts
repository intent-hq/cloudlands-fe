import { beforeEach, expect, it, vi } from 'vitest';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { NoteDeleteSubscriptionOrigin } from '$shared/note-delete-subscription-ledger';
beforeEach(() => vi.resetModules());
const event = () =>
  ({ sender: { isDestroyed: () => false }, senderFrame: {} }) as IpcMainInvokeEvent;
async function fixture() {
  const { registerNoteDeleteSubscriptionHandlers } = await import('../note-delete-subscription');
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value: unknown) => Promise<any>>();
  const socketA = {},
    socketB = {};
  let current = socketA;
  const wireA = vi.fn(async (method: string) =>
    method === 'events.subscribe' ? { subscriptionId: 'same-id' } : { success: true },
  );
  const wireB = vi.fn(async (method: string) =>
    method === 'events.subscribe' ? { subscriptionId: 'same-id' } : { success: true },
  );
  const capture = vi.fn((e: IpcMainInvokeEvent): NoteDeleteSubscriptionOrigin => {
    const captured = current,
      wire = captured === socketA ? wireA : wireB;
    return { incarnation: captured, principal: e.senderFrame!, isLive: () => true, request: wire };
  });
  registerNoteDeleteSubscriptionHandlers(
    {
      handle: (channel: string, fn: any) => {
        handlers.set(channel, fn);
      },
    } as Pick<IpcMain, 'handle'>,
    {
      capture,
      errorPayload: (error) => ({ code: 'TRANSPORT_ERROR', message: String(error) }),
    },
  );
  return {
    wireA,
    wireB,
    capture,
    switchBackend: () => {
      current = socketB;
    },
    subscribe: (e: IpcMainInvokeEvent) =>
      handlers.get(IPC_CHANNELS.BACKEND.NOTE_DELETE_SUBSCRIPTION.SUBSCRIBE)!(e, 'ws'),
    cleanup: (e: IpcMainInvokeEvent, handle: string) =>
      handlers.get(IPC_CHANNELS.BACKEND.NOTE_DELETE_SUBSCRIPTION.UNSUBSCRIBE)!(e, handle),
  };
}
it('shares native debt across renderer frames and does not refill on a new frame', async () => {
  const f = await fixture();
  for (let i = 0; i < 64; i++) expect((await f.subscribe(event())).ok).toBe(true);
  const refused = await f.subscribe(event());
  expect(refused).toMatchObject({ ok: false, error: { code: 'NOTE_DELETE_REGISTRATION_LIMIT' } });
  expect(f.wireA).toHaveBeenCalledTimes(64);
});
it('uses captured native cleanup after backend switch and refuses a different renderer frame', async () => {
  const f = await fixture(),
    a = event(),
    b = event();
  const first = await f.subscribe(a);
  f.switchBackend();
  const second = await f.subscribe(b);
  expect(first.result.subscriptionId).toBe(second.result.subscriptionId);
  expect((await f.cleanup(b, first.result.handle)).ok).toBe(false);
  const captures = f.capture.mock.calls.length;
  expect((await f.cleanup(a, first.result.handle)).ok).toBe(true);
  expect(f.capture).toHaveBeenCalledTimes(captures);
  expect(f.wireA).toHaveBeenLastCalledWith('events.unsubscribe', {
    subscriptionId: 'same-id',
    workspaceId: 'ws',
  });
  expect(f.wireB).toHaveBeenCalledTimes(1);
});
it('retains native lost-cleanup-ACK debt across fresh renderers', async () => {
  const f = await fixture(),
    a = event();
  const first = await f.subscribe(a);
  for (let i = 1; i < 64; i++) await f.subscribe(event());
  f.wireA.mockRejectedValueOnce(new Error('Lost ACK'));
  expect((await f.cleanup(a, first.result.handle)).ok).toBe(false);
  expect(await f.subscribe(event())).toMatchObject({
    ok: false,
    error: { code: 'NOTE_DELETE_REGISTRATION_LIMIT' },
  });
  expect(f.wireA).toHaveBeenCalledTimes(65);
});
