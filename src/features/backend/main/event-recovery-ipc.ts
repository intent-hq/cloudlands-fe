import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import type { JsonRpcClient, RepositoryConnection } from './json-rpc-client';

const MAX_SESSIONS = 64;
const MAX_REQUESTS_PER_SESSION = 64;
const channels = IPC_CHANNELS.BACKEND.EVENT_RECOVERY;
const reference = z.object({ id: z.string().min(1).max(128) }).strict();
const request = reference
  .extend({
    method: z.string().min(1),
    params: z.unknown().optional(),
    fenceId: z.string().min(1).max(128).optional(),
  })
  .strict();
const unavailable = () => ({
  ok: false,
  error: { code: 'EVENT_RECOVERY_UNAVAILABLE', message: 'EVENT_RECOVERY_UNAVAILABLE' },
});

/** Recovery control replies travel in the same IPC FIFO as this session's notifications. */
export function registerEventRecoveryHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  deps: { readBackend(id: string): JsonRpcClient | undefined },
) {
  type Binding = NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;
  interface Entry {
    sender: WebContents;
    binding: Binding;
    client: JsonRpcClient;
    connection: RepositoryConnection;
    stop: () => void;
    leases: Set<string>;
    requests: number;
  }
  const entries = new Map<string, Entry>();
  let disposed = false;
  const current = (entry: Entry) =>
    !disposed &&
    !entry.sender.isDestroyed() &&
    entry.sender.mainFrame === entry.binding.frame &&
    getStrictBackendBindingForWebContents(entry.sender) === entry.binding &&
    deps.readBackend(entry.binding.backendId) === entry.client &&
    entry.client.getRepositoryConnection() === entry.connection;
  const send = (entry: Entry, payload: unknown) => {
    if (!entry.sender.isDestroyed() && entry.sender.mainFrame === entry.binding.frame)
      entry.binding.frame.send(channels.FRAME, payload);
  };
  function drop(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    entry.stop();
    try {
      send(entry, { id, kind: 'retired' });
    } catch {
      /* Original document may be gone. */
    }
    for (const subscriptionId of entry.leases)
      void entry.client
        .requestOnCapturedConnection(entry.connection, 'events.unsubscribe', { subscriptionId })
        .catch(() => {});
    entry.leases.clear();
  }
  function admitted(event: IpcMainInvokeEvent, id: string) {
    const entry = entries.get(id);
    if (!entry || entry.sender !== event.sender || entry.binding.frame !== event.senderFrame)
      return;
    if (!current(entry)) {
      drop(id);
      return;
    }
    return entry;
  }
  ipc.handle(channels.CAPTURE, (event) => {
    const binding = getStrictBackendBindingForWebContents(event.sender);
    if (disposed || !binding || binding.frame !== event.senderFrame || entries.size >= MAX_SESSIONS)
      return unavailable();
    const client = deps.readBackend(binding.backendId),
      connection = client?.getRepositoryConnection();
    if (!client || !connection) return unavailable();
    const id = randomUUID();
    const entry: Entry = {
      sender: event.sender,
      binding,
      client,
      connection,
      stop: () => {},
      leases: new Set(),
      requests: 0,
    };
    entries.set(id, entry);
    const retire = () => drop(id);
    const off = client.onRepositoryConnectionEvent((source) => {
      if (!current(entry)) {
        drop(id);
        return;
      }
      if (source.type === 'notification' && source.incarnation === connection.incarnation) {
        try {
          send(entry, { id, kind: 'notification', notification: source.notification });
        } catch {
          drop(id);
        }
      }
    });
    const offBinding = onStrictBackendBindingRetired(event.sender, retire);
    const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) retire();
    };
    event.sender.on('did-start-navigation', navigation);
    event.sender.on('render-process-gone', retire);
    event.sender.once('destroyed', retire);
    entry.stop = () => {
      off();
      offBinding();
      event.sender.removeListener('did-start-navigation', navigation);
      event.sender.removeListener('render-process-gone', retire);
      event.sender.removeListener('destroyed', retire);
    };
    return { ok: true, result: { id, supported: connection.eventStreamRecovery === true } };
  });
  ipc.handle(channels.REQUEST, async (event, payload: unknown) => {
    const parsed = request.safeParse(payload);
    if (!parsed.success) return unavailable();
    const { id, method, params, fenceId } = parsed.data;
    const entry = admitted(event, id);
    if (
      !entry ||
      entry.requests >= MAX_REQUESTS_PER_SESSION ||
      method === 'client.hello' ||
      (method === 'events.fence' && (!fenceId || !entry.connection.eventStreamRecovery))
    )
      return unavailable();
    entry.requests++;
    try {
      const result = await entry.client.requestOnCapturedConnection(
        entry.connection,
        method,
        params,
        {
          timeoutMs: method === 'events.fence' ? 5000 : 30000,
          observe:
            method === 'events.fence'
              ? (result) => {
                  if (current(entry) && entries.get(id) === entry)
                    send(entry, { id, kind: 'fence', fenceId, result });
                }
              : undefined,
        },
      );
      if (method === 'events.subscribe') {
        const subscriptionId = (result as { subscriptionId?: unknown } | null)?.subscriptionId;
        if (typeof subscriptionId === 'string') {
          if (!current(entry) || entries.get(id) !== entry)
            void entry.client
              .requestOnCapturedConnection(entry.connection, 'events.unsubscribe', {
                subscriptionId,
              })
              .catch(() => {});
          else entry.leases.add(subscriptionId);
        }
      }
      if (!current(entry) || entries.get(id) !== entry) return unavailable();
      if (
        method === 'events.unsubscribe' &&
        params &&
        typeof params === 'object' &&
        'subscriptionId' in params &&
        typeof params.subscriptionId === 'string'
      )
        entry.leases.delete(params.subscriptionId);
      return { ok: true, result };
    } catch (error) {
      const failure = error as { message?: string; code?: unknown; toErrorPayload?: () => unknown };
      return {
        ok: false,
        error: failure.toErrorPayload?.() ?? {
          code: 'EVENT_RECOVERY_FAILED',
          message: failure.message ?? 'EVENT_RECOVERY_FAILED',
        },
      };
    } finally {
      entry.requests--;
    }
  });
  ipc.handle(channels.RELEASE, (event, payload: unknown) => {
    const parsed = reference.safeParse(payload);
    if (parsed.success && admitted(event, parsed.data.id)) drop(parsed.data.id);
    return { ok: true };
  });
  return {
    retireBackend(backendId: string) {
      for (const [id, entry] of entries) if (entry.binding.backendId === backendId) drop(id);
    },
    dispose() {
      for (const id of entries.keys()) drop(id);
      disposed = true;
    },
  };
}
