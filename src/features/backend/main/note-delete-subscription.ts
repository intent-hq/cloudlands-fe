import type { JsonRpcClient } from './json-rpc-client';
import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  NoteDeleteSubscriptionLedger,
  NoteDeleteSubscriptionError,
  noteDeleteWorkspace,
  type NoteDeleteSubscriptionOrigin,
} from '$shared/note-delete-subscription-ledger';

// One ledger for every renderer and handler lifetime in this main process.
const ledger = new NoteDeleteSubscriptionLedger(randomUUID);
type PhysicalCloseSource = Pick<JsonRpcClient, 'onPhysicalSocketClosed'>;
export type NativeNoteDeleteSubscriptionOrigin = NoteDeleteSubscriptionOrigin & {
  physicalCloseSource: PhysicalCloseSource;
};
const observedClients = new WeakSet<PhysicalCloseSource>();
export function registerNoteDeleteSubscriptionHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  deps: {
    capture(event: IpcMainInvokeEvent): NativeNoteDeleteSubscriptionOrigin;
    errorPayload(error: unknown): unknown;
  },
) {
  const errorPayload = (error: unknown) =>
    error instanceof NoteDeleteSubscriptionError
      ? { code: error.code, message: error.message }
      : deps.errorPayload(error);
  const channels = IPC_CHANNELS.BACKEND.NOTE_DELETE_SUBSCRIPTION;
  ipc.handle(channels.SUBSCRIBE, async (event, workspaceId: unknown) => {
    try {
      const workspace = noteDeleteWorkspace(workspaceId);
      const origin = deps.capture(event);
      if (!observedClients.has(origin.physicalCloseSource)) {
        origin.physicalCloseSource.onPhysicalSocketClosed((incarnation) =>
          ledger.connectionClosed(incarnation),
        );
        observedClients.add(origin.physicalCloseSource);
      }
      return { ok: true, result: await ledger.subscribe(origin, workspace) };
    } catch (error) {
      return { ok: false, error: errorPayload(error) };
    }
  });
  ipc.handle(channels.UNSUBSCRIBE, async (event, handle: unknown) => {
    try {
      if (!event.senderFrame || event.sender.isDestroyed())
        throw new Error('Note deletion subscriber retired');
      // Lookup by main-minted authority, never by a server ID on the current route.
      await ledger.cleanup(event.senderFrame, handle);
      return { ok: true, result: undefined };
    } catch (error) {
      return { ok: false, error: errorPayload(error) };
    }
  });
}
