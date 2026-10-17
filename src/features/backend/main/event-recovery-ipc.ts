import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import {
  captureRecoveryRequests,
  onRecoveryRequestsReady,
  type JsonRpcClient,
  type RepositoryConnection,
} from './json-rpc-client';

import { requiresRepositoryRoute, isRepositoryCheckoutCreate } from './repository-request-policy';

const typedUnsubscribeMethods = new Map([
  ['note.subscribe', 'note.unsubscribe'],
  ['task.subscribe', 'task.unsubscribe'],
  ['comment.subscribe', 'comment.unsubscribe'],
  ['workspace.subscribe', 'workspace.unsubscribe'],
  ['agent.subscribe', 'events.unsubscribe'],
]);
const ownedUnsubscribeMethods = new Set([
  'events.unsubscribe',
  ...typedUnsubscribeMethods.values(),
]);
const MAX_SESSIONS = 64;
const MAX_REQUESTS_PER_SESSION = 64;
const channels = IPC_CHANNELS.BACKEND.EVENT_RECOVERY;
const reference = z.object({ id: z.string().min(1).max(128) }).strict();
const request = reference
  .extend({
    method: z.string().min(1),
    params: z.unknown().optional(),
    replyId: z.string().min(1).max(128).optional(),
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
    // Typed controls own cleanup, but never confer generic notification/fence authority.
    typedLeases: Map<
      string,
      { method: string; params: { subscriptionId: string; workspaceId?: string } }
    >;
    requests: number;
    physical: NonNullable<ReturnType<typeof captureRecoveryRequests>>;
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
    entry.physical.dispose();
    entry.stop();
    try {
      send(entry, { id, kind: 'retired' });
    } catch {
      /* Original document may be gone. */
    }
    entry.leases.clear();
    entry.typedLeases.clear();
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
  const readyWatches = new Map<
    string,
    { sender: WebContents; binding: Binding; stop: () => void }
  >();
  const stopReadyWatch = (id: string) => {
    const watch = readyWatches.get(id);
    readyWatches.delete(id);
    watch?.stop();
  };
  ipc.handle(channels.WATCH_READY, (event, payload) => {
    const parsed = reference.safeParse(payload);
    const binding = getStrictBackendBindingForWebContents(event.sender);
    if (
      !parsed.success ||
      disposed ||
      !binding ||
      binding.frame !== event.senderFrame ||
      readyWatches.size >= MAX_SESSIONS ||
      readyWatches.has(parsed.data.id)
    )
      return unavailable();
    const client = deps.readBackend(binding.backendId);
    if (!client) return unavailable();
    const { id } = parsed.data;
    const stop = () => stopReadyWatch(id);
    const valid = () =>
      !disposed &&
      !event.sender.isDestroyed() &&
      event.sender.mainFrame === binding.frame &&
      getStrictBackendBindingForWebContents(event.sender) === binding &&
      deps.readBackend(binding.backendId) === client;
    const offReady = onRecoveryRequestsReady(client, () => {
      if (!valid()) {
        stop();
        return;
      }
      try {
        binding.frame.send(channels.READY, { id });
      } catch {
        stop();
      }
    });
    const offBinding = onStrictBackendBindingRetired(event.sender, stop);
    const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) stop();
    };
    event.sender.on('did-start-navigation', navigation);
    event.sender.on('render-process-gone', stop);
    event.sender.once('destroyed', stop);
    readyWatches.set(id, {
      sender: event.sender,
      binding,
      stop: () => {
        offReady();
        offBinding();
        event.sender.removeListener('did-start-navigation', navigation);
        event.sender.removeListener('render-process-gone', stop);
        event.sender.removeListener('destroyed', stop);
      },
    });
    return { ok: true };
  });
  ipc.handle(channels.UNWATCH_READY, (event, payload) => {
    const parsed = reference.safeParse(payload);
    if (!parsed.success) return unavailable();
    const watch = readyWatches.get(parsed.data.id);
    if (!watch || watch.sender !== event.sender || watch.binding.frame !== event.senderFrame)
      return unavailable();
    stopReadyWatch(parsed.data.id);
    return { ok: true };
  });
  ipc.handle(channels.CAPTURE, (event) => {
    const binding = getStrictBackendBindingForWebContents(event.sender);
    if (disposed || !binding || binding.frame !== event.senderFrame || entries.size >= MAX_SESSIONS)
      return unavailable();
    const client = deps.readBackend(binding.backendId),
      connection = client?.getRepositoryConnection();
    if (!client || !connection) return unavailable();
    const physical = captureRecoveryRequests(client, connection);
    if (!physical) return unavailable();
    const id = randomUUID();
    const entry: Entry = {
      sender: event.sender,
      binding,
      client,
      connection,
      stop: () => {},
      leases: new Set(),
      typedLeases: new Map(),
      requests: 0,
      physical,
    };
    entries.set(id, entry);
    const retire = () => drop(id);
    const off = client.onRepositoryConnectionEvent((source) => {
      if (!current(entry)) {
        drop(id);
        return;
      }
      if (source.type === 'notification' && source.incarnation === connection.incarnation) {
        const notification = source.notification;
        // The source feed also carries private repository authority IDs. None of
        // those frames may escape through this generic subscription-only route.
        if (notification.method !== 'events.event' && notification.method !== 'events.lost') return;
        const subscriptionId = (notification.params as { subscriptionId?: unknown } | null)
          ?.subscriptionId;
        if (typeof subscriptionId !== 'string') return;
        // The daemon is ack-first and ownership is installed synchronously at
        // reply decode. Unknown IDs belong to other owners; do not stage them.
        if (!entry.leases.has(subscriptionId)) return;
        try {
          send(entry, { id, kind: 'notification', notification });
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
    const { id, method, params, replyId } = parsed.data;
    const entry = admitted(event, id);
    if (
      !entry ||
      entry.requests >= MAX_REQUESTS_PER_SESSION ||
      method === 'client.hello' ||
      (method.endsWith('.subscribe') &&
        method !== 'events.subscribe' &&
        !typedUnsubscribeMethods.has(method)) ||
      requiresRepositoryRoute(method, params) ||
      isRepositoryCheckoutCreate(method, params) ||
      (method === 'events.subscribe' && !replyId) ||
      (method === 'events.fence' && (!replyId || !entry.connection.eventStreamRecovery))
    )
      return unavailable();
    const controls = params as { subscriptionId?: unknown; subscriptionIds?: unknown } | null;
    const controlId = controls?.subscriptionId;
    const typedControl =
      typeof controlId === 'string' ? entry.typedLeases.get(`${method}:${controlId}`) : undefined;
    if (
      method.endsWith('.unsubscribe') &&
      !(
        ownedUnsubscribeMethods.has(method) &&
        typeof controlId === 'string' &&
        ((method === 'events.unsubscribe' && entry.leases.has(controlId)) || typedControl)
      )
    )
      return unavailable();
    if (
      method === 'events.fence' &&
      (!Array.isArray(controls?.subscriptionIds) ||
        !controls.subscriptionIds.length ||
        controls.subscriptionIds.length > 64 ||
        new Set(controls.subscriptionIds).size !== controls.subscriptionIds.length ||
        controls.subscriptionIds.some(
          (lease) => typeof lease !== 'string' || !entry.leases.has(lease),
        ))
    )
      return unavailable();
    const subscription = params as { replaceGroup?: unknown } | null;
    // Replace-group names are connection-wide on the daemon, but renderer owners
    // are narrower. Never let one captured sender replace another sender's lease.
    const routedParams =
      typedControl?.params ??
      ((method === 'events.subscribe' || typedUnsubscribeMethods.has(method)) &&
      typeof subscription?.replaceGroup === 'string'
        ? { ...subscription, replaceGroup: `${id}:${subscription.replaceGroup}` }
        : params);
    const typedUnsubscribe = typedUnsubscribeMethods.get(method);
    const typedLease = (method: string, subscriptionId: string) => ({
      method,
      params: {
        subscriptionId,
        ...(typeof (params as { workspaceId?: unknown } | null)?.workspaceId === 'string'
          ? { workspaceId: (params as { workspaceId: string }).workspaceId }
          : {}),
      },
    });
    entry.requests++;
    try {
      const result = await entry.physical.request(method, routedParams, (result, abandoned) => {
        if (!current(entry) || entries.get(id) !== entry) return;
        const subscriptionId = (result as { subscriptionId?: unknown } | null)?.subscriptionId;
        // Ownership must be recorded at decode, before any following frame.
        if (!abandoned && method === 'events.subscribe' && typeof subscriptionId === 'string') {
          entry.leases.add(subscriptionId);
        }
        if (!abandoned && typedUnsubscribe && typeof subscriptionId === 'string') {
          entry.typedLeases.set(
            `${typedUnsubscribe}:${subscriptionId}`,
            typedLease(typedUnsubscribe, subscriptionId),
          );
        }
        if (typedControl && typeof controlId === 'string')
          entry.typedLeases.delete(`${method}:${controlId}`);
        if (method === 'events.unsubscribe' && typeof controls?.subscriptionId === 'string')
          entry.leases.delete(controls.subscriptionId);
        if (replyId) send(entry, { id, kind: 'reply', replyId, result });
      });
      if (!current(entry)) drop(id);
      if (!current(entry) || entries.get(id) !== entry) return unavailable();
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
      for (const id of readyWatches.keys()) stopReadyWatch(id);
      for (const id of entries.keys()) drop(id);
      disposed = true;
    },
  };
}
